/**
 * Límite de intentos por clave en una ventana deslizante, en memoria. Alcanza
 * porque la API corre en una sola réplica (Baileys lo exige, ver README); si
 * eso cambia, esto tiene que pasar a la base o a un store compartido.
 */
export class Limitador {
  private readonly intentos = new Map<string, number[]>();

  constructor(
    private readonly maximo: number,
    private readonly ventanaMs: number,
  ) {}

  /** Registra un intento y dice si entra en el límite. */
  permitir(clave: string, ahora = Date.now()): boolean {
    const vigentes = (this.intentos.get(clave) ?? []).filter((t) => ahora - t < this.ventanaMs);
    if (vigentes.length >= this.maximo) {
      this.intentos.set(clave, vigentes);
      return false;
    }
    vigentes.push(ahora);
    this.intentos.set(clave, vigentes);
    this.podar(ahora);
    return true;
  }

  /** Sin esto el mapa crece con cada IP o número que pasó alguna vez. */
  private podar(ahora: number): void {
    if (this.intentos.size < 1000) return;
    for (const [clave, tiempos] of this.intentos) {
      if (tiempos.every((t) => ahora - t >= this.ventanaMs)) this.intentos.delete(clave);
    }
  }
}

/** Sólo dígitos: "+54 9 11 2233-4455" y "5491122334455" son el mismo número. */
export function normalizarTelefono(crudo: string): string {
  return crudo.replace(/\D/g, '');
}
