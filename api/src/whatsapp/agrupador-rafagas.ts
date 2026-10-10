import { esperaDeRafaga } from './ritmo-humano.js';

type Rafaga<T> = { items: T[]; desde: number; timer?: ReturnType<typeof setTimeout>; lista: boolean };

/**
 * Junta los mensajes que un cliente manda seguidos ("hola" / "quería un turno"
 * / "para mañana") y los entrega juntos cuando hace ESPERA_RAFAGA_MS que no
 * escribe, así se contestan en una sola respuesta como haría una persona.
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
  private readonly enCurso = new Map<string, Promise<void>>();

  constructor(
    private readonly procesar: (clave: string, items: T[]) => Promise<void>,
    private readonly alFallar: (clave: string, error: unknown) => void,
    private readonly ahora: () => number = Date.now,
  ) {}

  agregar(clave: string, item: T): void {
    let rafaga = this.rafagas.get(clave);
    if (!rafaga) {
      rafaga = { items: [], desde: this.ahora(), lista: false };
      this.rafagas.set(clave, rafaga);
    }
    rafaga.items.push(item);
    rafaga.lista = false;
    if (rafaga.timer) clearTimeout(rafaga.timer);
    rafaga.timer = setTimeout(() => this.vaciar(clave), esperaDeRafaga(rafaga.desde, this.ahora()));
  }

  /** Corta los temporizadores pendientes (al apagar la API). Lo que no se contestó se pierde, como antes. */
  cerrar(): void {
    for (const rafaga of this.rafagas.values()) {
      if (rafaga.timer) clearTimeout(rafaga.timer);
    }
    this.rafagas.clear();
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
    const tarea = this.procesar(clave, rafaga.items)
      .catch((error: unknown) => this.alFallar(clave, error))
      .finally(() => {
        this.enCurso.delete(clave);
        if (this.rafagas.get(clave)?.lista) this.vaciar(clave);
      });
    this.enCurso.set(clave, tarea);
  }
}
