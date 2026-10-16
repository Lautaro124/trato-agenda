/**
 * Una vuelta del grafo que todavía se puede descartar. Si el cliente vuelve a
 * escribir mientras el asistente prepara la respuesta, esa respuesta ya no
 * contesta todo lo que dijo: se tira y se rehace con todo junto (lo decide
 * AgrupadorDeRafagas). Pero sólo mientras no haya hecho nada que se vea
 * afuera: antes de un pedido, un turno, un aviso al dueño o de guardar la
 * respuesta en `Message`, el nodo que lo hace llama `comprometer()` y desde
 * ahí la vuelta sigue hasta el final pase lo que pase.
 *
 * Todo corre en el mismo hilo de JS, así que `cancelar` y `comprometer` no
 * pueden pisarse: o se canceló antes y `comprometer` corta, o se comprometió
 * antes y `cancelar` no hace nada.
 */
export class Cancelacion {
  private readonly controller = new AbortController();
  private comprometida = false;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get cancelada(): boolean {
    return this.controller.signal.aborted;
  }

  /** true si la canceló (o ya estaba cancelada); false si ya hizo algo que no se deshace. */
  cancelar(): boolean {
    if (this.comprometida) return false;
    if (!this.cancelada) this.controller.abort(new VueltaCancelada());
    return true;
  }

  /** Lo llama un nodo justo antes de un efecto que no se deshace. Si ya se canceló, corta la vuelta ahí. */
  comprometer(): void {
    if (this.cancelada) throw new VueltaCancelada();
    this.comprometida = true;
  }
}

/** La vuelta se descartó porque el cliente siguió escribiendo: no se manda nada. */
export class VueltaCancelada extends Error {
  constructor() {
    super('La vuelta se descartó: el cliente siguió escribiendo.');
    this.name = 'VueltaCancelada';
  }
}
