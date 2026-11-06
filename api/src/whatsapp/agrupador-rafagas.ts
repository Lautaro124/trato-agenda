import { Cancelacion, VueltaCancelada } from '../conversation/cancelacion.js';
import {
  ESCRIBIENDO_VENCE_POR_DEFECTO_MS,
  ESPERA_TRAS_ESCRIBIR_MS,
  MAX_CANCELACIONES_POR_RAFAGA,
  MAX_CARACTERES_RAFAGA,
  MAX_MENSAJES_RAFAGA,
  esperaDeRafaga,
} from './ritmo-humano.js';

type Rafaga<T> = {
  items: T[];
  caracteres: number;
  /** Primer mensaje (para el tope) y último (para el silencio). */
  desde: number;
  ultimo: number;
  /** Hasta cuándo esperar por el "escribiendo…" del cliente; ausente si no está escribiendo. */
  escribiendoHasta?: number;
  timer?: ReturnType<typeof setTimeout>;
  lista: boolean;
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
 * Si llega otro mensaje mientras la respuesta se está armando, esa respuesta
 * se descarta (`Cancelacion`) y los mensajes vuelven a la ráfaga para
 * contestarlos junto con lo nuevo; si ya hizo algo que no se deshace (un
 * pedido, un turno, guardarla), sale igual y lo nuevo espera a que termine.
 *
 * Si WhatsApp avisa que el cliente está escribiendo (`escribiendo`), la
 * ráfaga espera a que pare y ESPERA_TRAS_ESCRIBIR_MS más; un aviso de que
 * empezó sin otro de que paró vence a los `escribiendoVenceMs`. El aviso
 * puede no llegar nunca: WhatsApp lo manda a dispositivos en línea, y el
 * socket conecta sin estarlo (`markOnlineOnConnect: false`) porque en línea
 * el teléfono del dueño deja de sonar. Sin aviso queda el silencio de
 * ESPERA_RAFAGA_MS desde el último mensaje.
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
    private readonly escribiendoVenceMs: number = ESCRIBIENDO_VENCE_POR_DEFECTO_MS,
  ) {}

  agregar(clave: string, item: T): void {
    this.cancelarEnCurso(clave);
    const rafaga = this.rafagaDe(clave);
    // Llena y esperando a que salga la respuesta anterior: lo que sobra se descarta.
    if (estaLlena(rafaga)) return;
    rafaga.items.push(item);
    rafaga.caracteres += this.medir(item);
    // Mandar el mensaje es dejar de escribirlo; la cuenta del silencio arranca de nuevo.
    rafaga.ultimo = this.ahora();
    rafaga.escribiendoHasta = undefined;
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
   * El cliente empezó (`true`) o dejó (`false`) de escribir. Sólo cuenta para
   * una ráfaga que todavía espera: sin mensajes pendientes no hay nada que
   * demorar, y una que ya se está contestando no se frena por esto.
   */
  escribiendo(clave: string, escribe: boolean): void {
    const rafaga = this.rafagas.get(clave);
    if (!rafaga || rafaga.lista || !rafaga.timer) return;
    if (escribe) {
      rafaga.escribiendoHasta = this.ahora() + this.escribiendoVenceMs;
    } else if (rafaga.escribiendoHasta !== undefined) {
      rafaga.escribiendoHasta = this.ahora() + ESPERA_TRAS_ESCRIBIR_MS;
    } else {
      return;
    }
    this.programar(clave);
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
  }

  /**
   * El chat pasó a una persona (LAU-81): se descarta la respuesta que se
   * está armando aunque ya se haya descartado otras veces. Sus mensajes
   * vuelven a la ráfaga y, al salir, el asistente ve que el chat no es suyo y
   * sólo los guarda. Lo ya comprometido sale igual (`Cancelacion`).
   */
  interrumpir(clave: string): void {
    this.enCurso.get(clave)?.corrida.cancelacion.cancelar();
  }

  /** Corta los temporizadores pendientes (al apagar la API). Lo que no se contestó se pierde, como antes. */
  cerrar(): void {
    for (const rafaga of this.rafagas.values()) {
      if (rafaga.timer) clearTimeout(rafaga.timer);
    }
    this.rafagas.clear();
    for (const { corrida } of this.enCurso.values()) corrida.olvidada = true;
  }

  private rafagaDe(clave: string): Rafaga<T> {
    let rafaga = this.rafagas.get(clave);
    if (!rafaga) {
      const ahora = this.ahora();
      rafaga = { items: [], caracteres: 0, desde: ahora, ultimo: ahora, lista: false, cancelaciones: 0 };
      this.rafagas.set(clave, rafaga);
    }
    return rafaga;
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
    const espera = esperaDeRafaga(rafaga.desde, rafaga.ultimo, this.ahora(), rafaga.escribiendoHasta);
    rafaga.timer = setTimeout(() => this.vaciar(clave), espera);
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
        if (this.rafagas.get(clave)?.lista) this.vaciar(clave);
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
    rafaga.ultimo = rafaga.desde;
    rafaga.escribiendoHasta = undefined;
    rafaga.cancelaciones = corrida.cancelaciones + 1;
    rafaga.lista = false;
    this.programar(clave);
  }
}

function estaLlena(rafaga: { items: unknown[]; caracteres: number }): boolean {
  return rafaga.items.length >= MAX_MENSAJES_RAFAGA || rafaga.caracteres >= MAX_CARACTERES_RAFAGA;
}
