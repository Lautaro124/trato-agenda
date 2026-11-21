import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hayStock } from './catalogo.rules.js';
import { PreguntasService } from './preguntas.service.js';
import {
  leerConfiguracion,
  normalizarConfiguracion,
  productosUsados,
  resolverRecomendacion,
  textoParaElModelo,
  type ConfiguracionRecomendaciones,
  type ConsultaRecomendacion,
  type ProductoParaRecomendar,
  type ResultadoRecomendacion,
} from './recomendaciones.rules.js';
import { reservadasPorProducto } from './reservas.js';

const SELECCION = { recomendaciones: true, propiedades: true, sinCoincidencia: true } as const;

/**
 * Recomendaciones y flujos de la cuenta (LAU-105). Todo scopeado al usuario:
 * los productos que nombra una regla tienen que ser de su catálogo y las
 * preguntas, de su configuración (LAU-100).
 */
@Injectable()
export class RecomendacionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preguntas: PreguntasService,
  ) {}

  async obtener(userId: string): Promise<ConfiguracionRecomendaciones> {
    const [fila, preguntas] = await Promise.all([
      this.prisma.configuracionRecomendaciones.findUnique({ where: { userId }, select: SELECCION }),
      this.preguntas.obtener(userId),
    ]);
    return leerConfiguracion(fila, preguntas);
  }

  /** Reemplaza toda la configuración: una edición se ve en todos los productos que usan la regla. */
  async guardar(userId: string, entrada: unknown): Promise<ConfiguracionRecomendaciones> {
    const preguntas = await this.preguntas.obtener(userId);
    const resultado = normalizarConfiguracion(entrada, preguntas);
    if ('error' in resultado) throw new UnprocessableEntityException(resultado.error);
    const { configuracion } = resultado;

    const productos = productosUsados(configuracion);
    if (productos.length > 0) {
      const propios = await this.prisma.producto.count({ where: { userId, activo: true, id: { in: productos } } });
      if (propios !== productos.length) {
        throw new UnprocessableEntityException('Alguno de los productos elegidos ya no está en el catálogo. Revisá las recomendaciones.');
      }
    }
    const datos = {
      recomendaciones: configuracion.recomendaciones as unknown as Prisma.InputJsonValue,
      propiedades: configuracion.propiedades as unknown as Prisma.InputJsonValue,
      sinCoincidencia: configuracion.sinCoincidencia,
    };
    await this.prisma.configuracionRecomendaciones.upsert({ where: { userId }, create: { userId, ...datos }, update: datos });
    return configuracion;
  }

  /**
   * Para el asistente (consultar_recomendacion): resuelve la consulta con el
   * catálogo de hoy —un producto borrado no se nombra y uno sin stock, con
   * las reservas vigentes descontadas, no se recomienda— y arma el texto que
   * vuelve al modelo.
   */
  async consultar(
    userId: string,
    consulta: ConsultaRecomendacion,
  ): Promise<{ resultado: ResultadoRecomendacion; texto: string }> {
    const [fila, preguntas] = await Promise.all([
      this.prisma.configuracionRecomendaciones.findUnique({ where: { userId }, select: SELECCION }),
      this.preguntas.obtener(userId),
    ]);
    const configuracion = leerConfiguracion(fila, preguntas);
    const pedidas = new Set(consulta.reglaIds);
    const ids = new Set<string>();
    for (const regla of configuracion.recomendaciones) {
      if (!pedidas.has(regla.id) || regla.accion.tipo !== 'recomendar') continue;
      for (const id of regla.accion.productos) ids.add(id);
    }
    const productos = new Map<string, ProductoParaRecomendar>();
    if (ids.size > 0) {
      const filas = await this.prisma.producto.findMany({
        where: { userId, activo: true, id: { in: [...ids] } },
        select: { id: true, nombre: true, stock: true, disponible: true, activo: true },
      });
      const reservadas = await reservadasPorProducto(this.prisma, filas.map((fila) => fila.id));
      for (const fila of filas) {
        productos.set(fila.id, { id: fila.id, nombre: fila.nombre, disponible: hayStock(fila, 1, reservadas.get(fila.id) ?? 0) });
      }
    }
    // Un producto de otra cuenta no es "el producto del que habla el cliente".
    let productoId = consulta.productoId;
    if (productoId) {
      const propio = await this.prisma.producto.count({ where: { userId, id: productoId } });
      if (propio === 0) productoId = undefined;
    }
    const resultado = resolverRecomendacion(configuracion, { ...consulta, productoId }, preguntas, productos);
    return { resultado, texto: textoParaElModelo(resultado, configuracion, preguntas) };
  }
}
