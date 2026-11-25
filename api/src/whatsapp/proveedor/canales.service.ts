import { Injectable, Logger } from '@nestjs/common';
import { resumenDeError } from '../../agents/openrouter.client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PROVEEDOR_POR_DEFECTO, esProveedor, type FalloCanal, type IdProveedor } from './proveedor.js';

/**
 * Cómo atiende WhatsApp un comercio (LAU-110): por qué proveedor, si las
 * respuestas automáticas están en pausa y en qué "generación" está el canal.
 */
export type EstadoCanal = {
  proveedor: IdProveedor;
  automatizacionPausada: boolean;
  /**
   * Sube con cada cambio de proveedor o de pausa. Lo que se recibió o armó con
   * otra generación no sale: así nada pendiente de la conexión anterior se
   * manda por la nueva, ni por las dos.
   */
  generacion: number;
  fallo: FalloCanal | null;
};

/** Una cuenta sin fila (todas las de antes de LAU-110): Baileys, sin pausa. */
export const CANAL_POR_DEFECTO: EstadoCanal = {
  proveedor: PROVEEDOR_POR_DEFECTO,
  automatizacionPausada: false,
  generacion: 0,
  fallo: null,
};

const FALLOS: readonly string[] = ['volver_a_vincular', 'sin_conexion'] satisfies FalloCanal[];

type Fila = {
  proveedor: string;
  automatizacionPausada: boolean;
  generacion: number;
  ultimoFallo: string | null;
};

function aEstado(fila: Fila | null): EstadoCanal {
  if (!fila) return CANAL_POR_DEFECTO;
  return {
    // Un valor desconocido (de una versión más nueva, a mano) no se inventa: queda el de siempre.
    proveedor: esProveedor(fila.proveedor) ? fila.proveedor : PROVEEDOR_POR_DEFECTO,
    automatizacionPausada: fila.automatizacionPausada,
    generacion: fila.generacion,
    fallo: fila.ultimoFallo && FALLOS.includes(fila.ultimoFallo) ? (fila.ultimoFallo as FalloCanal) : null,
  };
}

const SELECCION = { proveedor: true, automatizacionPausada: true, generacion: true, ultimoFallo: true } as const;

/**
 * El estado del canal de cada comercio, con caché en memoria. La caché es la
 * fuente de verdad mientras dura el proceso: todo cambio pasa por acá, y la
 * API corre con una sola réplica (dos procesos ya competirían por las
 * sesiones de Baileys). `vigente` es sincrónico para poder chequearlo justo
 * antes de cada envío, sin una consulta en el medio.
 */
@Injectable()
export class CanalesWhatsapp {
  private readonly logger = new Logger(CanalesWhatsapp.name);
  private readonly cache = new Map<string, EstadoCanal>();
  private readonly leyendo = new Map<string, Promise<EstadoCanal>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * El estado vigente. Si la base falla, el de siempre (Baileys, sin pausa):
   * como el resto de la recepción, ante la duda se atiende.
   */
  estado(userId: string): Promise<EstadoCanal> {
    const enCache = this.cache.get(userId);
    if (enCache) return Promise.resolve(enCache);
    let lectura = this.leyendo.get(userId);
    if (!lectura) {
      lectura = this.prisma.canalWhatsapp
        .findUnique({ where: { userId }, select: SELECCION })
        .then((fila) => {
          // Un cambio que terminó mientras se leía manda: la lectura ya es vieja.
          const estado = this.cache.get(userId) ?? aEstado(fila);
          this.cache.set(userId, estado);
          return estado;
        })
        .catch((error: unknown) => {
          this.logger.error(`No se pudo leer el canal de WhatsApp de ${userId}: ${resumenDeError(error)}`);
          return this.cache.get(userId) ?? CANAL_POR_DEFECTO;
        })
        .finally(() => this.leyendo.delete(userId));
      this.leyendo.set(userId, lectura);
    }
    return lectura;
  }

  /**
   * Si lo que se recibió por `proveedor` en `generacion` todavía puede salir.
   * Sin estado leído compara contra el de una cuenta sin fila.
   */
  vigente(userId: string, proveedor: IdProveedor, generacion: number): boolean {
    const estado = this.cache.get(userId) ?? CANAL_POR_DEFECTO;
    return estado.proveedor === proveedor && estado.generacion === generacion;
  }

  /** Pausa o reanuda las respuestas automáticas. Sube la generación: lo que estaba en armado no sale. */
  async pausar(userId: string, pausada: boolean): Promise<EstadoCanal> {
    const fila = await this.prisma.canalWhatsapp.upsert({
      where: { userId },
      create: { userId, automatizacionPausada: pausada, generacion: 1 },
      update: { automatizacionPausada: pausada, generacion: { increment: 1 } },
      select: SELECCION,
    });
    return this.recordar(userId, fila);
  }

  /**
   * Pasa el comercio a otro proveedor. Historial, usuario y configuración no
   * se tocan: viven en Conversation, User y Agent, que no dependen de él.
   */
  async cambiarProveedor(userId: string, proveedor: IdProveedor): Promise<EstadoCanal> {
    const fila = await this.prisma.canalWhatsapp.upsert({
      where: { userId },
      create: { userId, proveedor, generacion: 1 },
      update: { proveedor, generacion: { increment: 1 }, ultimoFallo: null, ultimoFalloAt: null },
      select: SELECCION,
    });
    return this.recordar(userId, fila);
  }

  /**
   * Deja a la vista lo que el dueño tiene que resolver (volver a vincular, una
   * caída larga), o lo borra al recuperarse. Sólo del proveedor activo: lo
   * que pase con otro no es el estado del canal. Nunca falla.
   */
  async registrarFallo(userId: string, proveedor: IdProveedor, fallo: FalloCanal | null): Promise<void> {
    try {
      const actual = await this.estado(userId);
      if (actual.proveedor !== proveedor || actual.fallo === fallo) return;
      const fila =
        fallo === null
          ? await this.prisma.canalWhatsapp.update({
              where: { userId },
              data: { ultimoFallo: null, ultimoFalloAt: null },
              select: SELECCION,
            })
          : await this.prisma.canalWhatsapp.upsert({
              where: { userId },
              create: { userId, ultimoFallo: fallo, ultimoFalloAt: new Date() },
              update: { ultimoFallo: fallo, ultimoFalloAt: new Date() },
              select: SELECCION,
            });
      this.recordar(userId, fila);
    } catch (error) {
      this.logger.warn(`No se pudo registrar el estado del canal de ${userId}: ${resumenDeError(error)}`);
    }
  }

  /** Dos cambios en paralelo pueden terminar en otro orden: queda el de generación más alta. */
  private recordar(userId: string, fila: Fila): EstadoCanal {
    const estado = aEstado(fila);
    const previo = this.cache.get(userId);
    if (!previo || estado.generacion >= previo.generacion) this.cache.set(userId, estado);
    return this.cache.get(userId)!;
  }
}
