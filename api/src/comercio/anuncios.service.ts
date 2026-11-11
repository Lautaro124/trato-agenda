import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { resumenDeError } from '../agents/openrouter.client.js';
import { Prisma } from '../generated/prisma/client.js';
import { Limitador } from '../auth/limitador.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  claveDeLink,
  elegirProducto,
  ganadorPromedio,
  identificarAnuncio,
  textoDeAnuncio,
  textoDeAnuncioLimpio,
  type Asociacion,
  type ReferenciaAnuncio,
} from './anuncios.rules.js';
import { BusquedaService } from './busqueda.service.js';
import { DecisionesClient } from './decisiones.client.js';
import { LARGO_MAX_ESTADO, MAX_OPCIONES_DECISION } from './sugerencias.rules.js';
import { procesarImagen } from './imagenes.rules.js';
import { VisionClient } from './vision.client.js';

/** Lo que ve el dueño de un anuncio en el panel: sin los bytes de la miniatura. */
export type AnuncioPublico = {
  id: string;
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  titulo: string | null;
  cuerpo: string | null;
  tieneMiniatura: boolean;
  asociacion: Asociacion;
  producto: { id: string; nombre: string; activo: boolean } | null;
  chats: number;
  /** `null`: lo cargó el dueño y todavía no llegó ningún chat. */
  ultimoChatAt: string | null;
};

const SELECT_PUBLICO = {
  id: true,
  sourceId: true,
  sourceType: true,
  sourceUrl: true,
  titulo: true,
  cuerpo: true,
  miniatura: true,
  asociacion: true,
  chats: true,
  ultimoChatAt: true,
  producto: { select: { id: true, nombre: true, activo: true } },
} satisfies Prisma.AnuncioSelect;

function aPublico({
  miniatura,
  ultimoChatAt,
  asociacion,
  ...fila
}: Prisma.AnuncioGetPayload<{ select: typeof SELECT_PUBLICO }>): AnuncioPublico {
  return {
    ...fila,
    asociacion: asociacion as Asociacion,
    tieneMiniatura: miniatura !== null,
    ultimoChatAt: ultimoChatAt?.toISOString() ?? null,
  };
}

function sinNulos<T extends Record<string, unknown>>(valores: T): { [K in keyof T]?: NonNullable<T[K]> } {
  return Object.fromEntries(Object.entries(valores).filter(([, valor]) => valor !== null && valor !== undefined)) as {
    [K in keyof T]?: NonNullable<T[K]>;
  };
}

/** De `nuevos`, los campos que `actual` todavía no tiene: lo ya guardado no se pisa. */
function soloVacios<T extends Record<string, unknown>>(actual: Partial<Record<keyof T, unknown>>, nuevos: T): { [K in keyof T]: T[K] | null } {
  return Object.fromEntries(Object.entries(nuevos).map(([k, v]) => [k, actual[k] === null || actual[k] === undefined ? v : null])) as {
    [K in keyof T]: T[K] | null;
  };
}

/**
 * Anuncios nuevos que se registran por cuenta y por hora. Los datos del
 * anuncio (o del estado) los manda el cliente: sin tope, ids inventados
 * crearían filas, descargas y llamadas de visión sin fin.
 */
export const MAX_ANUNCIOS_NUEVOS_POR_HORA = 30;
const UNA_HORA_MS = 60 * 60 * 1000;

const INSTRUCCIONES_ANUNCIO =
  'The state is an ad or status post (in Spanish) from an online shop on WhatsApp: its title, text and a ' +
  'description of its image. A customer wrote from it. Pick the product the ad shows or names. Pick none if ' +
  'the ad does not clearly show one of these products.';

const NINGUNO = 'The ad does not clearly show any of these products.';

/** Los anuncios que se listan en el panel, del más reciente al más viejo. */
const MAX_ANUNCIOS_LISTADOS = 100;

/**
 * Anuncios de origen (LAU-103): registra el anuncio desde el que llega un
 * cliente, lo vincula a su conversación y trata de asociarlo a un producto
 * del catálogo. El dueño confirma o cambia esa asociación desde el panel.
 */
@Injectable()
export class AnunciosService {
  private readonly logger = new Logger(AnunciosService.name);
  /** Una resolución por anuncio a la vez: dos chats del mismo anuncio nuevo no lo resuelven dos veces. */
  private readonly resolviendo = new Map<string, Promise<void>>();
  private readonly nuevosPorCuenta = new Limitador(MAX_ANUNCIOS_NUEVOS_POR_HORA, UNA_HORA_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly busqueda: BusquedaService,
    private readonly vision: VisionClient,
    private readonly decisiones: DecisionesClient,
  ) {}

  /**
   * Un mensaje de `remoteJid` llegó desde un anuncio. Guarda el anuncio,
   * lo vincula a la conversación si ya existe (no la crea: un chat nuevo se
   * crea al contestarlo) y, si todavía no tiene producto, lo busca. Devuelve
   * el id del anuncio para vincularlo al contestar, o null si la cuenta pasó
   * el tope de anuncios nuevos. `imagenCompleta` (la de un estado) se baja
   * sólo la primera vez que llega ese anuncio.
   */
  async registrar(
    userId: string,
    remoteJid: string,
    ref: ReferenciaAnuncio,
    imagenCompleta?: () => Promise<Buffer | null>,
  ): Promise<string | null> {
    const ahora = new Date();
    const existente = await this.prisma.anuncio.findUnique({
      where: { userId_sourceId: { userId, sourceId: ref.sourceId } },
      select: { id: true, sourceType: true, sourceUrl: true, titulo: true, cuerpo: true, miniatura: true },
    });
    if (!existente && !this.nuevosPorCuenta.permitir(userId)) {
      this.logger.warn(`Anuncio sin registrar para ${userId}: pasó ${MAX_ANUNCIOS_NUEVOS_POR_HORA} anuncios nuevos en una hora.`);
      return null;
    }
    // Con miniatura ya guardada no se procesa otra: no se usaría.
    const original = existente?.miniatura ? null : ((!existente && imagenCompleta ? await imagenCompleta() : null) ?? ref.miniatura);
    // La miniatura pasa por la misma validación que las fotos: firma, tope de píxeles, JPEG sin metadatos.
    const miniatura = original
      ? await procesarImagen(original).then((r) => new Uint8Array(r.datos)).catch(() => null)
      : null;
    const textos = { sourceType: ref.sourceType, sourceUrl: ref.sourceUrl, titulo: ref.titulo, cuerpo: ref.cuerpo };
    const heredado = await this.reconocerCargado(userId, ref);
    // Un anuncio que cargó el dueño con su link recibe su sourceId recién en reconocerCargado: se lee ahí.
    const actual =
      existente ??
      (await this.prisma.anuncio.findUnique({
        where: { userId_sourceId: { userId, sourceId: ref.sourceId } },
        select: { id: true, sourceType: true, sourceUrl: true, titulo: true, cuerpo: true, miniatura: true },
      }));
    const anuncio = await this.prisma.anuncio.upsert({
      where: { userId_sourceId: { userId, sourceId: ref.sourceId } },
      create: { userId, sourceId: ref.sourceId, ...textos, miniatura, chats: 1, ultimoChatAt: ahora, ...heredado },
      // Gana lo primero que se guardó: el cliente manda estos datos y un mensaje posterior (o falso) no
      // puede reescribir lo que el asistente le cuenta a los demás. Sólo se completa lo que falta.
      update: { ...(actual ? sinNulos(soloVacios(actual, { ...textos, miniatura })) : {}), chats: { increment: 1 }, ultimoChatAt: ahora },
      select: { id: true, asociacion: true },
    });
    await this.prisma.conversation.updateMany({
      where: { userId, remoteJid },
      data: { anuncioId: anuncio.id, anuncioAt: ahora },
    });
    if (anuncio.asociacion === 'pendiente') await this.resolver(userId, anuncio.id);
    return anuncio.id;
  }

  /**
   * El dueño puede haber cargado este anuncio con su link antes del primer
   * chat. Si es así y todavía no tiene id, se lo pone: el upsert de
   * `registrar` lo encuentra con su producto. Si ese link ya es de otro
   * anuncio (varios anuncios de la misma publicación), el nuevo hereda el
   * producto que eligió el dueño.
   */
  private async reconocerCargado(
    userId: string,
    ref: ReferenciaAnuncio,
  ): Promise<{ productoId: string | null; asociacion: Asociacion } | Record<string, never>> {
    const urlClave = claveDeLink(ref.sourceUrl);
    if (!urlClave) return {};
    const cargado = await this.prisma.anuncio.findFirst({
      where: { userId, urlClave },
      select: { id: true, sourceId: true, productoId: true, asociacion: true },
    });
    if (!cargado || cargado.sourceId === ref.sourceId) return {};
    if (cargado.sourceId === null) {
      try {
        await this.prisma.anuncio.updateMany({ where: { id: cargado.id, userId, sourceId: null }, data: { sourceId: ref.sourceId } });
        return {};
      } catch (error) {
        // Ya había otra fila con este sourceId (llegó un chat antes de cargarlo): queda ésa.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }
    const asociacion = cargado.asociacion as Asociacion;
    return asociacion === 'manual' || asociacion === 'sin_producto' ? { productoId: cargado.productoId, asociacion } : {};
  }

  /** Busca el producto de un anuncio pendiente. Nunca lanza: sin producto, el asistente usa el texto como pista. */
  private resolver(userId: string, anuncioId: string): Promise<void> {
    const enCurso = this.resolviendo.get(anuncioId);
    if (enCurso) return enCurso;
    const tarea = this.buscarProducto(userId, anuncioId)
      .catch((error: unknown) =>
        this.logger.warn(`No se pudo resolver el anuncio ${anuncioId} de ${userId}: ${resumenDeError(error)}`),
      )
      .finally(() => this.resolviendo.delete(anuncioId));
    this.resolviendo.set(anuncioId, tarea);
    return tarea;
  }

  /**
   * Primero con el título y el texto del anuncio (el nombre del producto tal cual). Si no
   * alcanza, Jev elige con ese texto y lo que lee el modelo de visión en la miniatura (una
   * sola vez por anuncio). Sólo asocia sin dudas, y nunca pisa la elección del dueño.
   */
  private async buscarProducto(userId: string, anuncioId: string): Promise<void> {
    const anuncio = await this.prisma.anuncio.findFirst({
      where: { id: anuncioId, userId },
      select: { titulo: true, cuerpo: true, miniatura: true, descripcionMiniatura: true, asociacion: true },
    });
    if (!anuncio || anuncio.asociacion !== 'pendiente') return;

    const texto = textoDeAnuncio(anuncio);
    let elegido: { productoId: string } | null = texto ? elegirProducto(await this.busqueda.buscar(userId, texto), texto) : null;
    let via = 'texto';

    let descripcion = anuncio.descripcionMiniatura;
    if (!elegido && !descripcion && anuncio.miniatura && this.vision.configurado) {
      descripcion = await this.vision.describir(Buffer.from(anuncio.miniatura)).catch((error: unknown) => {
        this.logger.warn(`No se pudo ver la miniatura del anuncio ${anuncioId}: ${resumenDeError(error)}`);
        return null;
      });
      if (descripcion) {
        await this.prisma.anuncio.updateMany({ where: { id: anuncioId, userId }, data: { descripcionMiniatura: descripcion } });
      }
    }
    if (!elegido) {
      // El nombre no aparece tal cual en el texto: Jev elige entre el catálogo con el texto y lo que se ve en la imagen.
      elegido = await this.elegirConJev(userId, anuncioId, texto, descripcion);
      via = 'jev';
    }

    if (!elegido) {
      // Sólo ids y números: los textos del anuncio no van a los logs.
      this.logger.log(`Anuncio ${anuncioId} de ${userId}: sin producto claro.`);
      return;
    }
    const { count } = await this.prisma.anuncio.updateMany({
      where: { id: anuncioId, userId, asociacion: 'pendiente' },
      data: { productoId: elegido.productoId, asociacion: 'automatica' },
    });
    if (count > 0) this.logger.log(`Anuncio ${anuncioId} de ${userId} → producto ${elegido.productoId} (por ${via}).`);
  }

  /**
   * Jev elige entre los productos activos (hasta MAX_OPCIONES_DECISION; si hay más, los que mejor
   * puntúa la búsqueda). Lo revisa dos veces, con todo lo que dice el anuncio y con la imagen sola, y
   * gana el de mayor compatibilidad promedio (ganadorPromedio). Nunca lanza: si Jev falla, el anuncio
   * queda pendiente. Sin los textos en los logs (son de un tercero): sólo ids y porcentajes.
   */
  private async elegirConJev(
    userId: string,
    anuncioId: string,
    texto: string,
    descripcion: string | null,
  ): Promise<{ productoId: string } | null> {
    const todo = [texto, descripcion].filter(Boolean).join(' ').trim();
    const estados = [...new Set([todo, descripcion?.trim() ?? ''].filter(Boolean))].map((e) => e.slice(0, LARGO_MAX_ESTADO));
    if (estados.length === 0 || !this.decisiones.configurado) return null;
    try {
      let candidatos = await this.prisma.producto.findMany({
        where: { userId, activo: true },
        select: { id: true, nombre: true, descripcion: true },
        orderBy: { id: 'asc' },
        take: MAX_OPCIONES_DECISION + 1,
      });
      if (candidatos.length > MAX_OPCIONES_DECISION) {
        const mejores = await this.busqueda.buscar(userId, todo, { limite: MAX_OPCIONES_DECISION });
        candidatos = mejores.map((p) => ({ id: p.productoId, nombre: p.nombre, descripcion: p.descripcion }));
      }
      const opciones = Object.fromEntries(
        candidatos.map((producto, indice) => [
          `p${indice}`,
          `Product ${JSON.stringify(producto.nombre)}` +
            (producto.descripcion ? `: ${JSON.stringify(producto.descripcion.slice(0, 120))}` : ''),
        ]),
      );
      const revisiones = await Promise.all(
        estados.map((estado) =>
          this.decisiones.probabilidades({ estado, instrucciones: INSTRUCCIONES_ANUNCIO, opciones, ninguna: NINGUNO }),
        ),
      );
      const ganador = ganadorPromedio(Object.keys(opciones), revisiones);
      if (ganador) {
        const pct = (n: number) => `${Math.round(n * 100)}%`;
        this.logger.log(
          `Anuncio ${anuncioId} de ${userId}: Jev (${revisiones.length} revisiones) → ${pct(ganador.compatibilidad)} contra ${pct(ganador.ninguna)} de ninguno.`,
        );
      }
      return ganador ? { productoId: candidatos[Number(ganador.id.slice(1))].id } : null;
    } catch (error) {
      this.logger.error(`Anuncio ${anuncioId} de ${userId} sin Jev: ${resumenDeError(error)}`);
      return null;
    }
  }

  async listar(userId: string): Promise<AnuncioPublico[]> {
    const filas = await this.prisma.anuncio.findMany({
      where: { userId },
      // Los recién cargados, sin chats todavía, arriba: el dueño acaba de agregarlos.
      orderBy: [{ ultimoChatAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }, { id: 'asc' }],
      take: MAX_ANUNCIOS_LISTADOS,
      select: SELECT_PUBLICO,
    });
    return filas.map(aPublico);
  }

  async miniatura(userId: string, id: string): Promise<Buffer> {
    const fila = await this.prisma.anuncio.findFirst({ where: { id, userId }, select: { miniatura: true } });
    if (!fila?.miniatura) throw new NotFoundException('El anuncio no tiene miniatura.');
    return Buffer.from(fila.miniatura);
  }

  /**
   * El dueño carga un anuncio antes de que llegue un chat: pega el ID del
   * anuncio de Meta o su link y elige el producto. Cuando un cliente escriba
   * desde ese anuncio, el asistente ya sabe de qué producto le habla.
   */
  async crear(userId: string, entrada: string, productoId: string, nombre: string | null): Promise<AnuncioPublico> {
    const identidad = identificarAnuncio(entrada);
    if (!identidad) throw new UnprocessableEntityException('Pegá el link del anuncio o su ID (sólo números).');
    await this.validarProducto(userId, productoId);
    try {
      const fila = await this.prisma.anuncio.create({
        data: { userId, ...identidad, titulo: textoDeAnuncioLimpio(nombre), productoId, asociacion: 'manual' },
        select: SELECT_PUBLICO,
      });
      return aPublico(fila);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ese anuncio ya está en la lista: cambiale el producto desde ahí.');
      }
      throw error;
    }
  }

  /** Quita un anuncio cargado por error. Uno con consultas no: sus conversaciones lo usan. */
  async eliminar(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.anuncio.deleteMany({ where: { id, userId, chats: 0 } });
    if (count === 0) throw new NotFoundException('No se encontró el anuncio o ya tiene consultas.');
  }

  private async validarProducto(userId: string, productoId: string): Promise<void> {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, userId, activo: true },
      select: { id: true },
    });
    if (!producto) throw new UnprocessableEntityException('Ese producto no está en tu catálogo.');
  }

  /** El dueño elige el producto del anuncio (`null`: el anuncio no es de un producto). */
  async asociar(userId: string, id: string, productoId: string | null): Promise<AnuncioPublico> {
    if (productoId !== null) await this.validarProducto(userId, productoId);
    const { count } = await this.prisma.anuncio.updateMany({
      where: { id, userId },
      data: { productoId, asociacion: productoId === null ? 'sin_producto' : 'manual' },
    });
    if (count === 0) throw new NotFoundException('No se encontró el anuncio.');
    return aPublico(await this.prisma.anuncio.findFirstOrThrow({ where: { id, userId }, select: SELECT_PUBLICO }));
  }
}
