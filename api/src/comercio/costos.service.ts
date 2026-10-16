import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { leerModalidad } from '../agents/modalidad-venta.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  leerConfig,
  leerInsumo,
  mapaDeInsumos,
  MAX_INSUMOS,
  normalizarConfig,
  normalizarInsumo,
  normalizarReceta,
  type ConfigCotizacion,
  type ConfigEntrada,
  type Insumo,
  type InsumoEntrada,
} from './costos.rules.js';
import { cotizar, type Cotizacion, type CotizacionFallida } from './cotizacion.rules.js';
import { normalizarSolicitud, type RespuestaSolicitud, type SolicitudADemanda, type SolicitudEntrada } from './solicitud.rules.js';

export type CostosDelComercio = { insumos: Insumo[]; config: ConfigCotizacion };

export class CostosInvalidosError extends Error {}

/**
 * Materiales y costos de un comercio a pedido (LAU-26): sus insumos, la
 * configuración de cómo cotiza el asistente y la simulación que usa el editor
 * de recetas. Sólo para cuentas a pedido (409 si no); todo por `userId`.
 */
@Injectable()
export class CostosService {
  constructor(private readonly prisma: PrismaService) {}

  async obtener(userId: string): Promise<CostosDelComercio> {
    await this.exigirAPedido(userId);
    const [insumos, config] = await Promise.all([this.insumosActivos(userId), this.config(userId)]);
    return { insumos: [...insumos.values()], config };
  }

  /** Los insumos activos del dueño, por id. Para validar y calcular recetas. */
  async insumosActivos(userId: string): Promise<Map<string, Insumo>> {
    const filas = await this.prisma.insumo.findMany({ where: { userId, activo: true }, orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }] });
    return mapaDeInsumos(filas);
  }

  /** Todos los insumos del dueño, también los dados de baja: una receta vieja los nombra. */
  async todosLosInsumos(userId: string): Promise<Map<string, Insumo>> {
    return mapaDeInsumos(await this.prisma.insumo.findMany({ where: { userId } }));
  }

  async config(userId: string): Promise<ConfigCotizacion> {
    return leerConfig(await this.prisma.configCotizacion.findUnique({ where: { userId } }));
  }

  /**
   * Un insumo nuevo. Si había uno dado de baja con el mismo nombre y tipo, se
   * reactiva con los datos nuevos (el nombre es único por tipo).
   */
  async crearInsumo(userId: string, entrada: InsumoEntrada): Promise<Insumo> {
    await this.exigirAPedido(userId);
    const datos = this.validarInsumo(entrada);
    const existente = await this.prisma.insumo.findUnique({
      where: { userId_tipo_nombre: { userId, tipo: datos.tipo, nombre: datos.nombre } },
    });
    if (existente?.activo) throw new ConflictException(`Ya tenés cargado ${JSON.stringify(datos.nombre)}.`);
    if (!existente && (await this.prisma.insumo.count({ where: { userId, activo: true } })) >= MAX_INSUMOS) {
      throw new ConflictException(`Podés cargar hasta ${MAX_INSUMOS} materiales y costos.`);
    }
    const fila = await this.prisma.insumo.upsert({
      where: { userId_tipo_nombre: { userId, tipo: datos.tipo, nombre: datos.nombre } },
      create: { userId, ...datos },
      update: { ...datos, activo: true },
    });
    return leerInsumo(fila) as Insumo;
  }

  async actualizarInsumo(userId: string, id: string, entrada: InsumoEntrada): Promise<Insumo> {
    await this.exigirAPedido(userId);
    const actual = await this.prisma.insumo.findFirst({ where: { id, userId, activo: true } });
    if (!actual) throw new NotFoundException('No existe ese material o costo.');
    const datos = this.validarInsumo(entrada);
    const otro = await this.prisma.insumo.findUnique({
      where: { userId_tipo_nombre: { userId, tipo: datos.tipo, nombre: datos.nombre } },
    });
    if (otro && otro.id !== id) {
      if (otro.activo) throw new ConflictException(`Ya tenés cargado ${JSON.stringify(datos.nombre)}.`);
      // Libera el nombre de uno dado de baja para que este lo pueda usar.
      await this.prisma.insumo.update({ where: { id: otro.id }, data: { nombre: `${otro.nombre} (baja ${otro.id})` } });
    }
    const fila = await this.prisma.insumo.update({ where: { id }, data: datos });
    return leerInsumo(fila) as Insumo;
  }

  /** Se da de baja, no se borra: las recetas lo nombran por id y la cotización avisa que ya no está. */
  async borrarInsumo(userId: string, id: string): Promise<void> {
    await this.exigirAPedido(userId);
    const { count } = await this.prisma.insumo.updateMany({ where: { id, userId, activo: true }, data: { activo: false } });
    if (count === 0) throw new NotFoundException('No existe ese material o costo.');
  }

  async guardarConfig(userId: string, entrada: ConfigEntrada): Promise<ConfigCotizacion> {
    await this.exigirAPedido(userId);
    const resultado = normalizarConfig(entrada);
    if ('error' in resultado) throw new CostosInvalidosError(resultado.error);
    const datos = { ...resultado.config, extras: resultado.config.extras as unknown as Prisma.InputJsonValue };
    await this.prisma.configCotizacion.upsert({ where: { userId }, create: { userId, ...datos }, update: datos });
    return resultado.config;
  }

  /**
   * Cómo daría la cotización de una receta que todavía no se guardó, con
   * respuestas de ejemplo: la vista previa del editor. La cuenta es la misma
   * que usa el asistente, así la web no la copia.
   */
  async simular(
    userId: string,
    entrada: { receta: unknown; solicitud?: SolicitudEntrada | null; respuestas: RespuestaSolicitud[] },
  ): Promise<Cotizacion | CotizacionFallida> {
    await this.exigirAPedido(userId);
    let solicitud: SolicitudADemanda | null = null;
    if (entrada.solicitud) {
      const normalizada = normalizarSolicitud(entrada.solicitud);
      if ('error' in normalizada) return { ok: false, motivo: normalizada.error, faltan: [] };
      solicitud = normalizada.solicitud;
    }
    const [insumos, config] = await Promise.all([this.insumosActivos(userId), this.config(userId)]);
    const receta = normalizarReceta(entrada.receta, { solicitud, insumos });
    if ('error' in receta) return { ok: false, motivo: receta.error, faltan: [] };
    return cotizar({ receta: receta.receta, solicitud, insumos, config, respuestas: entrada.respuestas });
  }

  private validarInsumo(entrada: InsumoEntrada) {
    const resultado = normalizarInsumo(entrada);
    if ('error' in resultado) throw new CostosInvalidosError(resultado.error);
    return resultado.insumo;
  }

  private async exigirAPedido(userId: string): Promise<void> {
    const agent = await this.prisma.agent.findUnique({ where: { userId }, select: { modalidadVenta: true, tipoAsistente: true } });
    if (!agent || agent.tipoAsistente !== 'ventas' || leerModalidad(agent) !== 'pedido') {
      throw new ConflictException('Los materiales y costos son para las cuentas que venden a pedido.');
    }
  }
}
