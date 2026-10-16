import { Cancelacion, VueltaCancelada } from '../conversation/cancelacion.js';
import {
  ESCRIBIENDO_VENCE_MS,
  MAX_CANCELACIONES_POR_RAFAGA,
  MAX_CARACTERES_RAFAGA,
  MAX_MENSAJES_RAFAGA,
  MAXIMO_RAFAGA_ESCRIBIENDO_MS,
  esperaDeRafaga,
} from './ritmo-humano.js';

type Rafaga<T> = {
  items: T[];
  caracteres: number;
  desde: number;
  timer?: ReturnType<typeof setTimeout>;
  lista: boolean;
  /** En esta ráfaga se lo vio escribir: el tope de espera es MAXIMO_RAFAGA_ESCRIBIENDO_MS. */
  huboEscritura: boolean;
  /** Cuántas veces ya se descartó la respuesta a estos mensajes. */
  cancelaciones: number;
};

/** La ráfaga que se está contestando ahora. */
type Corrida<T> = {
  items: T[];
  cancelacion: Cancelacion;
  cancelaciones: number;
  /** Se cerró la sesión o se apaga la API: si se cancela, no se vuelve a encolar. */
  olvidada: boolean;
};

/**
 * Junta los mensajes que un cliente manda seguidos ("hola" / "quería un turno"
 * / "para mañana") y los entrega juntos cuando hace ESPERA_RAFAGA_MS que no
 * escribe, así se contestan en una sola respuesta como haría una persona.
 *
 * Si WhatsApp avisa que el cliente está escribiendo (`escribiendo`), se espera
 * a que pare. Y si vuelve a escribir mientras la respuesta se está armando, esa
 * respuesta se descarta (`Cancelacion`) y los mensajes vuelven a la ráfaga
 * para contestarlos junto con lo nuevo; si ya hizo algo que no se deshace
 * (un pedido, un turno, guardarla), sale igual y lo nuevo espera a que termine.
 *
 * También serializa por chat: mientras se contesta una ráfaga, lo que llega
 * después espera a que esa respuesta termine. Antes dos mensajes casi juntos
 * corrían el grafo en paralelo sobre el mismo hilo.
 *
 * Vive en memoria, igual que los sockets de Baileys: sólo sirve con una única
 * réplica de la API, que es como corre.
 */
export class AgrupadorDeRafagas<T> {
  private readonly rafagas = new Map<string, Rafaga<T>>();
  private readonly enCurso = new Map<string, { tarea: Promise<void>; corrida: Corrida<T> }>();
  /** Hasta cuándo vale el último "escribiendo…" de cada chat. */
  private readonly escribiendoHasta = new Map<string, number>();
  /** Quienes esperan a que un chat deje de escribir (esperarSilencio). */
  private readonly enSilencio = new Map<string, Set<() => void>>();

  /**
   * `medir` da el tamaño de un item en caracteres: con eso se aplica
   * MAX_CARACTERES_RAFAGA (el que llama trunca cada mensaje a ese tope).
   * `procesar` recibe la `Cancelacion` de la vuelta: si la vuelta se descarta,
   * tiene que terminar con VueltaCancelada (o sin mandar nada).
   */
  constructor(
    private readonly procesar: (clave: string, items: T[], cancelacion: Cancelacion) => Promise<void>,
    private readonly alFallar: (clave: string, error: unknown) => void,
    private readonly medir: (item: T) => number,
    private readonly ahora: () => number = Date.now,
  ) {}

  agregar(clave: string, item: T): void {
    // Si mandó el mensaje, ya no está escribiendo.
    this.dejarDeEscribir(clave);
    this.cancelarEnCurso(clave);
    const rafaga = this.rafagaDe(clave);
    // Llena y esperando a que salga la respuesta anterior: lo que sobra se descarta.
    if (estaLlena(rafaga)) return;
    rafaga.items.push(item);
    rafaga.caracteres += this.medir(item);
    if (estaLlena(rafaga)) {
      if (rafaga.timer) clearTimeout(rafaga.timer);
      rafaga.timer = undefined;
      this.vaciar(clave);
      return;
    }
    rafaga.lista = false;
    this.programar(clave);
  }

  /**
   * WhatsApp avisó que el cliente empezó (true) o dejó (false) de escribir.
   * Mientras escribe no se le contesta, y si había una respuesta armándose, se
   * descarta para rehacerla con lo que mande.
   */
  escribiendo(clave: string, activo: boolean): void {
    if (!activo) {
      this.dejarDeEscribir(clave);
      if (this.rafagas.has(clave)) this.programar(clave);
      return;
    }
    // Sólo importa si hay algo que contestar o que se está contestando: si no, el
    // próximo mensaje llega igual y no hace falta guardar nada (ni acumular chats).
    if (!this.rafagas.has(clave) && !this.enCurso.has(clave)) return;
    this.escribiendoHasta.set(clave, this.ahora() + ESCRIBIENDO_VENCE_MS);
    this.cancelarEnCurso(clave);
    const rafaga = this.rafagas.get(clave);
    if (rafaga) {
      rafaga.huboEscritura = true;
      this.programar(clave);
    }
  }

  /** Si el último "escribiendo…" de ese chat todavía vale. */
  estaEscribiendo(clave: string): boolean {
    const hasta = this.escribiendoHasta.get(clave);
    if (hasta === undefined) return false;
    if (hasta > this.ahora()) return true;
    // Vencido: no se guarda más.
    this.escribiendoHasta.delete(clave);
    return false;
  }

  /** Espera a que el chat deje de escribir, como mucho `maximoMs`. Para frenar el envío de una respuesta ya lista. */
  async esperarSilencio(clave: string, maximoMs: number): Promise<void> {
    const limite = this.ahora() + maximoMs;
    while (this.estaEscribiendo(clave) && this.ahora() < limite) {
      const hasta = Math.min(limite, this.escribiendoHasta.get(clave) ?? limite);
      await new Promise<void>((resolve) => {
        const esperando = this.enSilencio.get(clave) ?? new Set();
        this.enSilencio.set(clave, esperando);
        const listo = () => {
          clearTimeout(timer);
          esperando.delete(listo);
          if (esperando.size === 0) this.enSilencio.delete(clave);
          resolve();
        };
        const timer = setTimeout(listo, Math.max(0, hasta - this.ahora()));
        esperando.add(listo);
      });
    }
  }

  /** Olvida lo pendiente de un dueño (sesión cerrada o transferida): no se contesta por un socket que ya no es suyo. */
  descartar(prefijo: string): void {
    for (const [clave, rafaga] of this.rafagas) {
      if (!clave.startsWith(prefijo)) continue;
      if (rafaga.timer) clearTimeout(rafaga.timer);
      this.rafagas.delete(clave);
    }
    for (const [clave, { corrida }] of this.enCurso) {
      if (!clave.startsWith(prefijo)) continue;
      corrida.olvidada = true;
      corrida.cancelacion.cancelar();
    }
    for (const clave of this.escribiendoHasta.keys()) {
      if (clave.startsWith(prefijo)) this.dejarDeEscribir(clave);
    }
  }

  /** Corta los temporizadores pendientes (al apagar la API). Lo que no se contestó se pierde, como antes. */
  cerrar(): void {
    for (const rafaga of this.rafagas.values()) {
      if (rafaga.timer) clearTimeout(rafaga.timer);
    }
    this.rafagas.clear();
    for (const { corrida } of this.enCurso.values()) corrida.olvidada = true;
    for (const clave of this.escribiendoHasta.keys()) this.dejarDeEscribir(clave);
  }

  private rafagaDe(clave: string): Rafaga<T> {
    let rafaga = this.rafagas.get(clave);
    if (!rafaga) {
      rafaga = { items: [], caracteres: 0, desde: this.ahora(), lista: false, huboEscritura: false, cancelaciones: 0 };
      this.rafagas.set(clave, rafaga);
    }
    return rafaga;
  }

  private dejarDeEscribir(clave: string): void {
    this.escribiendoHasta.delete(clave);
    for (const listo of this.enSilencio.get(clave) ?? []) listo();
  }

  /** Descarta la respuesta que se está armando para ese chat, si todavía se puede y no se pasó del tope. */
  private cancelarEnCurso(clave: string): void {
    const corrida = this.enCurso.get(clave)?.corrida;
    if (!corrida || corrida.cancelaciones >= MAX_CANCELACIONES_POR_RAFAGA) return;
    corrida.cancelacion.cancelar();
  }

  /** (Re)arma el temporizador de la ráfaga según cuánto falta (esperaDeRafaga). */
  private programar(clave: string): void {
    const rafaga = this.rafagas.get(clave);
    if (!rafaga) return;
    if (rafaga.timer) clearTimeout(rafaga.timer);
    const espera = esperaDeRafaga(rafaga.desde, this.ahora(), {
      escribiendoHasta: this.escribiendoHasta.get(clave),
      huboEscritura: rafaga.huboEscritura,
    });
    rafaga.timer = setTimeout(() => this.alVencer(clave), espera);
  }

  private alVencer(clave: string): void {
    const rafaga = this.rafagas.get(clave);
    if (!rafaga) return;
    rafaga.timer = undefined;
    // Renovó el "escribiendo…" y todavía no llegó al tope: se lo sigue esperando.
    if (this.estaEscribiendo(clave) && this.ahora() < rafaga.desde + MAXIMO_RAFAGA_ESCRIBIENDO_MS) {
      this.programar(clave);
      return;
    }
    this.vaciar(clave);
  }

  private vaciar(clave: string): void {
    const rafaga = this.rafagas.get(clave);
    if (!rafaga) return;
    rafaga.timer = undefined;
    if (this.enCurso.has(clave)) {
      // Todavía se está contestando la anterior: sale cuando esa termine.
      rafaga.lista = true;
      return;
    }
    this.rafagas.delete(clave);
    const corrida: Corrida<T> = {
      items: rafaga.items,
      cancelacion: new Cancelacion(),
      cancelaciones: rafaga.cancelaciones,
      olvidada: false,
    };
    const tarea = this.procesar(clave, rafaga.items, corrida.cancelacion)
      .catch((error: unknown) => {
        if (error instanceof VueltaCancelada || corrida.cancelacion.cancelada) {
          if (!corrida.olvidada) this.reencolar(clave, corrida);
          return;
        }
        this.alFallar(clave, error);
      })
      .finally(() => {
        this.enCurso.delete(clave);
        if (!this.rafagas.has(clave)) this.dejarDeEscribir(clave);
        else if (this.rafagas.get(clave)?.lista) this.vaciar(clave);
      });
    this.enCurso.set(clave, { tarea, corrida });
  }

  /**
   * La respuesta se descartó: sus mensajes vuelven adelante de la ráfaga (con
   * lo que haya llegado después) y se espera otra vez, con la cuenta de la
   * espera de nuevo en cero.
   */
  private reencolar(clave: string, corrida: Corrida<T>): void {
    const rafaga = this.rafagaDe(clave);
    rafaga.items = [...corrida.items, ...rafaga.items];
    rafaga.caracteres = rafaga.items.reduce((suma, item) => suma + this.medir(item), 0);
    rafaga.desde = this.ahora();
    rafaga.huboEscritura = true;
    rafaga.cancelaciones = corrida.cancelaciones + 1;
    rafaga.lista = false;
    this.programar(clave);
  }
}

function estaLlena(rafaga: { items: unknown[]; caracteres: number }): boolean {
  return rafaga.items.length >= MAX_MENSAJES_RAFAGA || rafaga.caracteres >= MAX_CARACTERES_RAFAGA;
}
