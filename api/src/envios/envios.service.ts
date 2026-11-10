import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { leerLocal } from '../agents/local.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FECHA_GEOREF } from './geo/georef-ar.data.js';
import { buscarUbicaciones, localidadPorIdOrNull, provinciaPorIdOrNull, type Ubicacion } from './geo/catalogo.js';
import {
  ACCIONES_SIN_TARIFA,
  MAX_COBERTURAS_POR_CUENTA,
  MAX_ZONAS,
  MONEDAS_ENVIO,
  PAISES_ENVIO,
  detectarConflictos,
  etiquetaDeCobertura,
  motivoSinResolver,
  resolucionConError,
  resolverEnvio,
  validarZona,
  type AccionSinTarifa,
  type CoberturaRegla,
  type ConfigRegla,
  type Conflicto,
  type ConsultaEnvio,
  type DatosZona,
  type EstadoZona,
  type Nivel,
  type ResolucionEnvio,
  type ZonaRegla,
} from './envios.rules.js';

export class ZonaInvalidaError extends Error {}

export type ConfiguracionEnviosVista = ConfigRegla & {
  /** De Agent: si el comercio hace envíos y si se puede retirar por el local. */
  haceEnvios: boolean;
  retiroEnLocal: boolean;
  fechaCatalogo: string;
};

export type ZonaVista = ZonaRegla & { coberturas: Array<CoberturaRegla & { etiqueta: string }> };

export type ConsultaSinResolverVista = {
  motivo: string;
  lugar: string;
  provinciaId: string | null;
  localidadId: string | null;
  cp: string | null;
  cantidad: number;
  ultima: string;
};

const DIAS_SIN_RESOLVER_VISIBLES = 30;

const conCoberturas = { coberturas: { select: { nivel: true, provinciaId: true, localidadId: true, cp: true } } } as const;

type FilaZona = Prisma.ZonaEnvioGetPayload<{ include: typeof conCoberturas }>;

function zonaDeFila(fila: FilaZona): ZonaRegla {
  return {
    id: fila.id,
    nombre: fila.nombre,
    activa: fila.activa,
    estado: fila.estado as EstadoZona,
    domicilio: fila.domicilio,
    sucursal: fila.sucursal,
    tarifaDomicilioCentavos: fila.tarifaDomicilioCentavos,
    tarifaSucursalCentavos: fila.tarifaSucursalCentavos,
    gratisDesdeCentavos: fila.gratisDesdeCentavos,
    preparacionDias: fila.preparacionDias,
    transporteDesdeDias: fila.transporteDesdeDias,
    transporteHastaDias: fila.transporteHastaDias,
    diasDespacho: fila.diasDespacho,
    instrucciones: fila.instrucciones,
    coberturas: fila.coberturas.map((c) => ({ nivel: c.nivel as Nivel, provinciaId: c.provinciaId, localidadId: c.localidadId, cp: c.cp })),
  };
}

function configDeFila(fila: { activo: boolean; pais: string; moneda: string; sinTarifa: string } | null): ConfigRegla | null {
  if (!fila) return null;
  return {
    activo: fila.activo,
    pais: fila.pais,
    moneda: fila.moneda,
    sinTarifa: (ACCIONES_SIN_TARIFA as readonly string[]).includes(fila.sinTarifa) ? (fila.sinTarifa as AccionSinTarifa) : 'derivar',
  };
}

/**
 * Módulo de envíos de un comercio (LAU-102): configuración, zonas y el
 * resolvedor que comparten el panel, el probador y el asistente. Todo por
 * `userId`; sólo cuentas de ventas. Las reglas se leen en cada consulta (sin
 * caché): una pausa o un cambio vale desde la consulta siguiente.
 */
@Injectable()
export class EnviosService {
  private readonly logger = new Logger(EnviosService.name);

  constructor(private readonly prisma: PrismaService) {}

  async configuracion(userId: string): Promise<ConfiguracionEnviosVista> {
    const agent = await this.exigirVentas(userId);
    const fila = await this.prisma.configuracionEnvios.findUnique({ where: { userId } });
    const config = configDeFila(fila) ?? { activo: false, pais: 'AR', moneda: 'ARS', sinTarifa: 'derivar' as const };
    return {
      ...config,
      haceEnvios: agent.haceEnvios,
      retiroEnLocal: leerLocal(agent)?.retiroEnLocal === true,
      fechaCatalogo: FECHA_GEOREF,
    };
  }

  async guardarConfiguracion(
    userId: string,
    entrada: { activo?: boolean; pais?: string; moneda?: string; sinTarifa?: string },
  ): Promise<ConfiguracionEnviosVista> {
    await this.exigirVentas(userId);
    if (entrada.pais !== undefined && !(PAISES_ENVIO as readonly string[]).includes(entrada.pais)) {
      throw new ZonaInvalidaError('Por ahora los envíos son sólo dentro de Argentina.');
    }
    if (entrada.moneda !== undefined && !(MONEDAS_ENVIO as readonly string[]).includes(entrada.moneda)) {
      throw new ZonaInvalidaError('La moneda tiene que ser pesos o dólares.');
    }
    if (entrada.sinTarifa !== undefined && !(ACCIONES_SIN_TARIFA as readonly string[]).includes(entrada.sinTarifa)) {
      throw new ZonaInvalidaError('Elegí qué hacer cuando un destino no tiene tarifa.');
    }
    const datos = {
      ...(entrada.activo !== undefined ? { activo: entrada.activo } : {}),
      ...(entrada.pais !== undefined ? { pais: entrada.pais } : {}),
      ...(entrada.moneda !== undefined ? { moneda: entrada.moneda } : {}),
      ...(entrada.sinTarifa !== undefined ? { sinTarifa: entrada.sinTarifa } : {}),
    };
    await this.prisma.configuracionEnvios.upsert({ where: { userId }, create: { userId, ...datos }, update: datos });
    return this.configuracion(userId);
  }

  async listarZonas(userId: string): Promise<ZonaVista[]> {
    await this.exigirVentas(userId);
    return (await this.zonas(userId)).map((zona) => ({
      ...zona,
      coberturas: zona.coberturas.map((c) => ({ ...c, etiqueta: etiquetaDeCobertura(c) })),
    }));
  }

  async conflictos(userId: string): Promise<Conflicto[]> {
    await this.exigirVentas(userId);
    return detectarConflictos(await this.zonas(userId));
  }

  /**
   * Crea o reemplaza una zona. Si queda activa y choca con otra (mismo lugar,
   * nivel y modalidad), se guarda pausada y se devuelven los conflictos: una
   * configuración ambigua nunca queda activa. La cuenta se bloquea mientras
   * tanto para que dos guardados a la vez no activen dos zonas que chocan.
   */
  async guardarZona(userId: string, zonaId: string | null, datos: DatosZona): Promise<{ zona: ZonaVista; conflictos: Conflicto[] }> {
    await this.exigirVentas(userId);
    const validacion = validarZona(datos);
    if (!validacion.ok) throw new ZonaInvalidaError(validacion.problema);
    const fila = {
      nombre: datos.nombre.trim(),
      estado: datos.estado,
      domicilio: datos.domicilio,
      sucursal: datos.sucursal,
      tarifaDomicilioCentavos: datos.tarifaDomicilioCentavos,
      tarifaSucursalCentavos: datos.tarifaSucursalCentavos,
      gratisDesdeCentavos: datos.gratisDesdeCentavos,
      preparacionDias: datos.preparacionDias,
      transporteDesdeDias: datos.transporteDesdeDias,
      transporteHastaDias: datos.transporteHastaDias,
      diasDespacho: datos.diasDespacho,
      instrucciones: datos.instrucciones?.trim() || null,
    };
    const resultado = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
      let id = zonaId;
      if (id) {
        const existe = await tx.zonaEnvio.findFirst({ where: { id, userId }, select: { id: true } });
        if (!existe) throw new NotFoundException('No encontramos esa zona.');
        await tx.coberturaZona.deleteMany({ where: { zonaId: id } });
        await tx.zonaEnvio.update({ where: { id }, data: { ...fila, activa: false } });
      } else {
        if ((await tx.zonaEnvio.count({ where: { userId } })) >= MAX_ZONAS) {
          throw new ZonaInvalidaError(`Podés tener hasta ${MAX_ZONAS} zonas.`);
        }
        id = (await tx.zonaEnvio.create({ data: { ...fila, userId, activa: false }, select: { id: true } })).id;
      }
      const deOtrasZonas = await tx.coberturaZona.count({ where: { zona: { userId }, zonaId: { not: id } } });
      if (deOtrasZonas + validacion.coberturas.length > MAX_COBERTURAS_POR_CUENTA) {
        throw new ZonaInvalidaError(`Entre todas tus zonas podés cargar hasta ${MAX_COBERTURAS_POR_CUENTA} lugares.`);
      }
      await tx.coberturaZona.createMany({ data: validacion.coberturas.map((c) => ({ ...c, zonaId: id })) });
      return this.activarSiNoChoca(tx, userId, id, datos.activa);
    });
    return resultado;
  }

  async cambiarActiva(userId: string, zonaId: string, activa: boolean): Promise<{ zona: ZonaVista; conflictos: Conflicto[] }> {
    await this.exigirVentas(userId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
      const existe = await tx.zonaEnvio.findFirst({ where: { id: zonaId, userId }, select: { id: true } });
      if (!existe) throw new NotFoundException('No encontramos esa zona.');
      await tx.zonaEnvio.update({ where: { id: zonaId }, data: { activa: false } });
      return this.activarSiNoChoca(tx, userId, zonaId, activa);
    });
  }

  async eliminarZona(userId: string, zonaId: string): Promise<void> {
    await this.exigirVentas(userId);
    const { count } = await this.prisma.zonaEnvio.deleteMany({ where: { id: zonaId, userId } });
    if (count === 0) throw new NotFoundException('No encontramos esa zona.');
  }

  /** La zona ya está guardada pausada: se activa sólo si con ella no aparece un conflicto. */
  private async activarSiNoChoca(
    tx: Prisma.TransactionClient,
    userId: string,
    zonaId: string,
    activa: boolean,
  ): Promise<{ zona: ZonaVista; conflictos: Conflicto[] }> {
    let conflictos: Conflicto[] = [];
    if (activa) {
      const zonas = (await tx.zonaEnvio.findMany({ where: { userId }, include: conCoberturas })).map(zonaDeFila);
      const conEsta = zonas.map((z) => (z.id === zonaId ? { ...z, activa: true } : z));
      conflictos = detectarConflictos(conEsta).filter((c) => c.zonas.some((z) => z.id === zonaId));
      if (conflictos.length === 0) await tx.zonaEnvio.update({ where: { id: zonaId }, data: { activa: true } });
    }
    const fila = await tx.zonaEnvio.findUniqueOrThrow({ where: { id: zonaId }, include: conCoberturas });
    const zona = zonaDeFila(fila);
    return { zona: { ...zona, coberturas: zona.coberturas.map((c) => ({ ...c, etiqueta: etiquetaDeCobertura(c) })) }, conflictos };
  }

  ubicaciones(texto: string): Ubicacion[] {
    return buscarUbicaciones(texto.slice(0, 80));
  }

  /** Si el asistente de esta cuenta tiene que ofrecer consultar_envio. */
  async activoPara(userId: string): Promise<boolean> {
    const fila = await this.prisma.configuracionEnvios.findUnique({ where: { userId }, select: { activo: true } });
    return fila?.activo === true;
  }

  /**
   * La resolución con las reglas vigentes. Nunca tira: si algo falla devuelve
   * `error`, que el asistente maneja sin inventar un precio. Las que no se
   * pudieron responder se registran (sin datos personales) salvo en pruebas.
   */
  async resolver(
    userId: string,
    consulta: ConsultaEnvio,
    opciones: { subtotalCentavos?: number | null; monedaSubtotal?: string | null; registrar: boolean },
  ): Promise<ResolucionEnvio> {
    let config: ConfigRegla | null = null;
    let retiroEnLocal = false;
    try {
      const [fila, agent, zonas] = await Promise.all([
        this.prisma.configuracionEnvios.findUnique({ where: { userId } }),
        this.prisma.agent.findUnique({ where: { userId }, select: { local: true, tipoAsistente: true } }),
        this.zonas(userId),
      ]);
      config = configDeFila(fila);
      retiroEnLocal = agent ? leerLocal(agent)?.retiroEnLocal === true : false;
      const resolucion = resolverEnvio(config, zonas, consulta, {
        retiroEnLocal,
        subtotalCentavos: opciones.subtotalCentavos ?? null,
        monedaSubtotal: opciones.monedaSubtotal ?? null,
      });
      if (opciones.registrar) await this.registrarSinResolver(userId, resolucion);
      return resolucion;
    } catch (error) {
      this.logger.error(`No se pudo resolver un envío de la cuenta ${userId}: ${(error as Error).message}`);
      const resolucion = resolucionConError(config, retiroEnLocal);
      if (opciones.registrar) await this.registrarSinResolver(userId, resolucion);
      return resolucion;
    }
  }

  /** De mejor esfuerzo: un fallo acá no cambia la respuesta al cliente. */
  private async registrarSinResolver(userId: string, resolucion: ResolucionEnvio): Promise<void> {
    const motivo = motivoSinResolver(resolucion);
    if (!motivo) return;
    try {
      await this.prisma.consultaEnvioSinResolver.create({
        data: {
          userId,
          motivo,
          provinciaId: resolucion.destino.provinciaId,
          localidadId: resolucion.destino.localidadId,
          cp: resolucion.destino.cp,
        },
      });
    } catch (error) {
      this.logger.warn(`No se pudo registrar una consulta de envío sin resolver de la cuenta ${userId}: ${(error as Error).message}`);
    }
  }

  async sinResolver(userId: string): Promise<ConsultaSinResolverVista[]> {
    await this.exigirVentas(userId);
    const desde = new Date(Date.now() - DIAS_SIN_RESOLVER_VISIBLES * 24 * 60 * 60 * 1000);
    const grupos = await this.prisma.consultaEnvioSinResolver.groupBy({
      by: ['motivo', 'provinciaId', 'localidadId', 'cp'],
      where: { userId, createdAt: { gte: desde } },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    return grupos
      .map((g) => {
        const localidad = localidadPorIdOrNull(g.localidadId);
        const provincia = provinciaPorIdOrNull(g.provinciaId);
        const lugar =
          [localidad?.nombre, provincia && provincia.nombre !== localidad?.nombre ? provincia.nombre : null, g.cp ? `CP ${g.cp}` : null]
            .filter(Boolean)
            .join(', ') || 'Ubicación sin identificar';
        return {
          motivo: g.motivo,
          lugar,
          provinciaId: g.provinciaId,
          localidadId: g.localidadId,
          cp: g.cp,
          cantidad: g._count._all,
          ultima: (g._max.createdAt ?? new Date()).toISOString(),
        };
      })
      .sort((a, b) => b.cantidad - a.cantidad || b.ultima.localeCompare(a.ultima))
      .slice(0, 50);
  }

  private async zonas(userId: string): Promise<ZonaRegla[]> {
    const filas = await this.prisma.zonaEnvio.findMany({ where: { userId }, include: conCoberturas, orderBy: { createdAt: 'asc' } });
    return filas.map(zonaDeFila);
  }

  private async exigirVentas(userId: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { userId },
      select: { tipoAsistente: true, haceEnvios: true, local: true },
    });
    if (!agent || agent.tipoAsistente !== 'ventas') {
      throw new ConflictException('Los envíos son para las cuentas que venden.');
    }
    return agent;
  }
}
