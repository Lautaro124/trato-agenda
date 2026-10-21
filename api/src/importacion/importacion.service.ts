import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Limitador } from '../auth/limitador.js';
import { MAX_BYTES_SUBIDA } from '../comercio/imagenes.rules.js';
import { ImagenesService } from '../comercio/imagenes.service.js';
import { ProductosService } from '../comercio/productos.service.js';
import type { Env } from '../config/env.js';
import { resumenDeError } from '../agents/openrouter.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubscriptionService } from '../subscription/subscription.service.js';
import { funcionesDelPlan } from '../subscription/subscription.rules.js';
import { descargar, DescargaError, textoDe } from './fetch-seguro.js';
import { firmaValida, firmarBorrador } from './firma.js';
import { hostsDePrueba } from './hosts-de-prueba.js';
import type { ItemConfirmadoDto } from './importacion.types.js';
import { leerHtml } from './html.rules.js';
import { leerJsonLd, leerMetas } from './jsonld.rules.js';
import { IDS_POR_MULTIGET, MercadoLibreClient, MercadoLibreNoDisponibleError } from './mercadolibre.client.js';
import {
  descripcionDesde,
  idsDeBusqueda,
  itemDeCatalogo,
  itemsDeMultiget,
  productoDesdeItem,
} from './mercadolibre.rules.js';
import {
  MAX_PRODUCTOS_LISTADO_ML,
  type BorradorProducto,
  type CodigoErrorImportacion,
  type DuplicadoDe,
  type ErrorDeEnlace,
  type ProductoExtraido,
  type ResultadoConfirmacion,
  type ResultadoExtraccion,
} from './modelo.js';
import { revisarUrl } from './ssrf.rules.js';
import { canonizarUrl, claveDeOrigen, codigoLibre, codigoSugerido, enlaceMercadoLibre, fuenteDe } from './url.rules.js';

/** Una página: hasta 2 MB ya descomprimida, 10 segundos. */
const MAX_BYTES_PAGINA = 2 * 1024 * 1024;
const TIMEOUT_PAGINA_MS = 10_000;
const TIPOS_HTML = ['text/html', 'application/xhtml+xml'];
const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];
/** Lo que puede tardar una extracción entera: lo que no entra queda como "tiempo agotado". */
const PRESUPUESTO_EXTRACCION_MS = 45_000;
/** Páginas de un listado que se piden a la vez. */
const EN_PARALELO = 4;

/** Uso por cuenta (en memoria: la API corre en una sola réplica, como los sockets de WhatsApp). */
const ENLACES_POR_HORA = 30;
const CONFIRMADOS_POR_HORA = 60;
/** Extracciones a la vez en toda la API: cada una abre conexiones hacia afuera. */
const MAX_EXTRACCIONES_EN_CURSO = 5;

type Encontrado = { producto: ProductoExtraido; url: URL; fuente: BorradorProducto['fuente'] };

class ErrorDeImportacion extends Error {
  constructor(readonly codigo: CodigoErrorImportacion) {
    super(codigo);
  }
}

function codigoDe(error: unknown): CodigoErrorImportacion | null {
  if (error instanceof ErrorDeImportacion) return error.codigo;
  if (error instanceof DescargaError) return error.codigo;
  if (error instanceof MercadoLibreNoDisponibleError) return 'mercadolibre_no_disponible';
  return null;
}

/** Corre `tarea` sobre cada elemento, de a `n` a la vez, en orden. */
async function deA<T, R>(elementos: T[], n: number, tarea: (elemento: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = [];
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < elementos.length) {
      const indice = siguiente++;
      resultados[indice] = await tarea(elementos[indice]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, elementos.length) }, trabajador));
  return resultados;
}

/**
 * Importación rápida (LAU-31): de enlaces de Mercado Libre, Tiendamia o
 * cualquier tienda a productos del catálogo, en dos pasos. `extraer` lee los
 * enlaces y devuelve borradores sin escribir nada; el dueño los revisa,
 * corrige y elige, y `confirmar` los guarda (con su foto). Sólo para cuentas
 * de ventas con el plan Pro pagando.
 */
@Injectable()
export class ImportacionService {
  private readonly logger = new Logger(ImportacionService.name);
  private readonly enlaces = new Limitador(ENLACES_POR_HORA, 60 * 60 * 1000);
  private readonly confirmados = new Limitador(CONFIRMADOS_POR_HORA, 60 * 60 * 1000);
  private readonly enCurso = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly productos: ProductosService,
    private readonly imagenes: ImagenesService,
    private readonly suscripciones: SubscriptionService,
    private readonly mercadoLibre: MercadoLibreClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get hosts(): ReadonlySet<string> {
    return hostsDePrueba(this.config.get('IMPORTACION_HOSTS_DE_PRUEBA', { infer: true }));
  }

  /** Cuenta de ventas (409 si no) con el Pro pagando (403 si no): en ese orden, como /costos. */
  async exigirAcceso(userId: string): Promise<void> {
    const agent = await this.prisma.agent.findUnique({ where: { userId }, select: { tipoAsistente: true } });
    if (!agent || agent.tipoAsistente !== 'ventas') {
      throw new ConflictException('La importación de productos es para las cuentas que venden.');
    }
    const plan = await this.suscripciones.planVigente(userId);
    if (!funcionesDelPlan(plan).importacionRapida) {
      throw new ForbiddenException({
        statusCode: 403,
        motivo: 'plan_pro_requerido',
        message: 'La importación rápida de productos es del plan Pro.',
      });
    }
  }

  async extraer(userId: string, urls: string[]): Promise<ResultadoExtraccion> {
    await this.exigirAcceso(userId);
    if (this.enCurso.has(userId) || this.enCurso.size >= MAX_EXTRACCIONES_EN_CURSO) {
      throw new HttpException('Ya hay una importación leyendo enlaces. Esperá a que termine.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const unicas = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
    if (!unicas.every(() => this.enlaces.permitir(userId))) {
      throw new HttpException('Leíste muchos enlaces en la última hora. Probá de nuevo en un rato.', HttpStatus.TOO_MANY_REQUESTS);
    }

    this.enCurso.add(userId);
    try {
      const limite = Date.now() + PRESUPUESTO_EXTRACCION_MS;
      const encontrados: Encontrado[] = [];
      const errores: ErrorDeEnlace[] = [];
      let recortado = false;
      for (const url of unicas) {
        if (Date.now() > limite) {
          errores.push({ url, codigo: 'tiempo_agotado' });
          continue;
        }
        try {
          const resultado = await this.leerEnlace(url, limite);
          encontrados.push(...resultado.encontrados);
          errores.push(...resultado.errores);
          recortado ||= resultado.recortado;
        } catch (error) {
          const codigo = codigoDe(error);
          if (!codigo) throw error;
          errores.push({ url, codigo });
          this.logger.warn(`Importación: un enlace no se pudo leer (${codigo}).`);
        }
      }
      return { productos: await this.borradores(userId, encontrados), errores, recortado };
    } finally {
      this.enCurso.delete(userId);
    }
  }

  /** Un enlace → los productos que tiene (uno, o los de un listado). */
  private async leerEnlace(
    texto: string,
    limite: number,
  ): Promise<{ encontrados: Encontrado[]; errores: ErrorDeEnlace[]; recortado: boolean }> {
    const revisada = revisarUrl(texto, this.hosts);
    if ('motivo' in revisada) throw new ErrorDeImportacion(revisada.motivo);
    const url = revisada.url;
    const fuente = fuenteDe(url);

    const ml = enlaceMercadoLibre(url);
    if (ml) {
      try {
        if (ml.tipo === 'listado') return await this.listadoMercadoLibre(ml.sitio, ml.filtro);
        const id = ml.tipo === 'item' ? ml.id : itemDeCatalogo(await this.mercadoLibre.catalogo(ml.id));
        if (!id) throw new ErrorDeImportacion('sin_datos_de_producto');
        const [item, descripcion] = await Promise.all([this.mercadoLibre.item(id), this.mercadoLibre.descripcion(id)]);
        if (item === null) throw new ErrorDeImportacion('no_encontrada');
        const producto = productoDesdeItem(item, descripcionDesde(descripcion));
        if (!producto) throw new ErrorDeImportacion('sin_datos_de_producto');
        return { encontrados: [{ producto, url, fuente }], errores: [], recortado: false };
      } catch (error) {
        // Sin la API (sin app configurada, o Mercado Libre la cortó), un listado no se puede leer;
        // una publicación sí, desde su página, como cualquier otra tienda.
        if (!(error instanceof MercadoLibreNoDisponibleError) || ml.tipo === 'listado') throw error;
      }
    }

    const pagina = await this.pagina(url);
    if (pagina.tipo === 'producto') {
      return { encontrados: [{ producto: pagina.producto, url: pagina.url, fuente }], errores: [], recortado: false };
    }
    if (pagina.tipo === 'nada') throw new ErrorDeImportacion(fuente === 'mercadolibre' ? 'mercadolibre_no_disponible' : 'sin_datos_de_producto');

    // Un listado: cada producto, del mismo sitio (lo garantiza leerJsonLd), de a varios a la vez.
    const errores: ErrorDeEnlace[] = [];
    const encontrados = (
      await deA(pagina.urls, EN_PARALELO, async (enlace): Promise<Encontrado | null> => {
        if (Date.now() > limite) {
          errores.push({ url: enlace, codigo: 'tiempo_agotado' });
          return null;
        }
        try {
          const producto = await this.pagina(new URL(enlace));
          if (producto.tipo === 'producto') return { producto: producto.producto, url: producto.url, fuente };
          errores.push({ url: enlace, codigo: 'sin_datos_de_producto' });
        } catch (error) {
          const codigo = codigoDe(error);
          if (!codigo) throw error;
          errores.push({ url: enlace, codigo });
        }
        return null;
      })
    ).filter((encontrado): encontrado is Encontrado => encontrado !== null);
    return { encontrados, errores, recortado: pagina.recortado };
  }

  /** Lo que dice una página: su JSON-LD y, si no tiene, sus <meta>. */
  private async pagina(
    url: URL,
  ): Promise<
    | { tipo: 'producto'; producto: ProductoExtraido; url: URL }
    | { tipo: 'listado'; urls: string[]; recortado: boolean }
    | { tipo: 'nada' }
  > {
    const descarga = await descargar(url.href, {
      maxBytes: MAX_BYTES_PAGINA,
      tipos: TIPOS_HTML,
      timeoutMs: TIMEOUT_PAGINA_MS,
      hostsDePrueba: this.hosts,
    });
    const html = leerHtml(textoDe(descarga));
    const leido = leerJsonLd(html.jsonld, descarga.url, this.hosts);
    if (leido.tipo === 'producto') return { tipo: 'producto', producto: leido.producto, url: descarga.url };
    if (leido.tipo === 'listado') return leido;
    const porMetas = leerMetas(html.metas, descarga.url, this.hosts);
    return porMetas ? { tipo: 'producto', producto: porMetas, url: descarga.url } : { tipo: 'nada' };
  }

  private async listadoMercadoLibre(
    sitio: string,
    filtro: { vendedor: string } | { nickname: string } | { busqueda: string },
  ): Promise<{ encontrados: Encontrado[]; errores: ErrorDeEnlace[]; recortado: boolean }> {
    const { ids, total } = idsDeBusqueda(await this.mercadoLibre.buscar(sitio, filtro, MAX_PRODUCTOS_LISTADO_ML), MAX_PRODUCTOS_LISTADO_ML);
    if (ids.length === 0) throw new ErrorDeImportacion('sin_datos_de_producto');
    const tandas: string[][] = [];
    for (let desde = 0; desde < ids.length; desde += IDS_POR_MULTIGET) tandas.push(ids.slice(desde, desde + IDS_POR_MULTIGET));
    const items = (await deA(tandas, 2, (tanda) => this.mercadoLibre.items(tanda))).flatMap(itemsDeMultiget);
    const encontrados = (
      await deA(items, EN_PARALELO, async (item): Promise<Encontrado | null> => {
        const id = typeof item === 'object' && item !== null && 'id' in item ? String((item as { id: unknown }).id) : '';
        const producto = productoDesdeItem(item, id ? descripcionDesde(await this.mercadoLibre.descripcion(id)) : null);
        if (!producto) return null;
        const permalink = producto.url ?? `https://articulo.mercadolibre.com.ar/${id}`;
        return { producto, url: new URL(permalink), fuente: 'mercadolibre' };
      })
    ).filter((encontrado): encontrado is Encontrado => encontrado !== null);
    return { encontrados, errores: [], recortado: total > ids.length };
  }

  /**
   * Los productos encontrados → borradores para la vista previa: con su
   * clave de origen, un código libre, si ya está en el catálogo y la firma.
   */
  private async borradores(userId: string, encontrados: Encontrado[]): Promise<BorradorProducto[]> {
    // El mismo producto dos veces (dos enlaces al mismo, o un listado que lo repite) va una sola.
    const unicos = new Map<string, Encontrado & { clave: string; origenUrl: string }>();
    for (const encontrado of encontrados) {
      const url = encontrado.producto.url ? new URL(encontrado.producto.url) : encontrado.url;
      const clave = claveDeOrigen(encontrado.fuente, url, encontrado.producto.idExterno);
      if (!unicos.has(clave)) unicos.set(clave, { ...encontrado, clave, origenUrl: canonizarUrl(url) });
    }
    const lista = [...unicos.values()];
    if (lista.length === 0) return [];

    const skus = lista.flatMap(({ producto }) => producto.variantes.map((variante) => variante.sku).filter((sku): sku is string => Boolean(sku)));
    const [porOrigen, codigos, porSku] = await Promise.all([
      this.prisma.producto.findMany({
        where: { userId, activo: true, origenId: { in: lista.map(({ clave }) => clave) } },
        select: { id: true, nombre: true, origenId: true, codigo: true },
      }),
      this.prisma.producto.findMany({ where: { userId }, select: { id: true, nombre: true, codigo: true, activo: true } }),
      skus.length > 0
        ? this.prisma.variante.findMany({
            where: { activo: true, sku: { in: skus }, producto: { userId, activo: true } },
            select: { sku: true, producto: { select: { id: true, nombre: true } } },
          })
        : Promise.resolve([]),
    ]);
    const usados = new Set(codigos.map((producto) => producto.codigo));
    const emitidaAt = new Date().toISOString();
    const clave = this.config.get('TOKEN_ENCRYPTION_KEY', { infer: true });

    return lista.map(({ producto, fuente, clave: claveOrigen, origenUrl }) => {
      const mismoOrigen = porOrigen.find((existente) => existente.origenId === claveOrigen);
      const sugerido = codigoSugerido(producto.nombre, producto.idExterno);
      // Un id de publicación es identidad: si ese código ya está, es el mismo producto. Un código armado
      // con el nombre, no: se busca uno libre.
      const mismoCodigo = producto.idExterno ? codigos.find((existente) => existente.activo && existente.codigo === sugerido) : undefined;
      const mismoSku = porSku.find((variante) => producto.variantes.some((propia) => propia.sku === variante.sku));
      const duplicado: DuplicadoDe | null = mismoOrigen
        ? { motivo: 'origen', productoId: mismoOrigen.id, nombre: mismoOrigen.nombre }
        : mismoCodigo
          ? { motivo: 'codigo', productoId: mismoCodigo.id, nombre: mismoCodigo.nombre }
          : mismoSku
            ? { motivo: 'sku', productoId: mismoSku.producto.id, nombre: mismoSku.producto.nombre }
            : null;
      const codigo = mismoOrigen?.codigo ?? (mismoCodigo ? sugerido : codigoLibre(sugerido, usados));
      usados.add(codigo);
      const { idExterno: _id, url: _url, ...resto } = producto;
      return {
        ...resto,
        claveOrigen,
        origenUrl,
        fuente,
        codigoSugerido: codigo,
        duplicado,
        emitidaAt,
        firma: firmarBorrador({ userId, claveOrigen, origenUrl, imagenes: producto.imagenes, emitidaAt }, clave),
      };
    });
  }

  async confirmar(userId: string, items: ItemConfirmadoDto[]): Promise<ResultadoConfirmacion> {
    await this.exigirAcceso(userId);
    if (!items.every(() => this.confirmados.permitir(userId))) {
      throw new HttpException('Importaste muchos productos en la última hora. Probá de nuevo en un rato.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const clave = this.config.get('TOKEN_ENCRYPTION_KEY', { infer: true });
    const resultados: ResultadoConfirmacion['resultados'] = [];
    for (const item of items) {
      const firmado = { userId, claveOrigen: item.claveOrigen, origenUrl: item.origenUrl, imagenes: item.imagenes, emitidaAt: item.emitidaAt };
      if (!firmaValida(firmado, item.firma, clave)) {
        resultados.push({
          claveOrigen: item.claveOrigen,
          estado: 'error',
          motivo: 'La vista previa venció o no es de esta cuenta: volvé a leer el enlace.',
          foto: 'sin_foto',
        });
        continue;
      }
      try {
        const guardado = await this.productos.guardarImportado(
          userId,
          { ...item.producto, origen: { id: item.claveOrigen, url: item.origenUrl } },
          { actualizar: item.accion === 'actualizar' },
        );
        if (guardado.estado === 'salteado') {
          resultados.push({ claveOrigen: item.claveOrigen, ...guardado, foto: 'sin_foto' });
          continue;
        }
        const imagen = item.imagenElegida === null || item.imagenElegida === undefined ? null : item.imagenes[item.imagenElegida];
        resultados.push({ claveOrigen: item.claveOrigen, ...guardado, foto: imagen ? await this.guardarFoto(userId, guardado.productoId, imagen) : 'sin_foto' });
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        const respuesta = error.getResponse();
        const mensaje = typeof respuesta === 'object' && respuesta !== null && 'message' in respuesta ? respuesta.message : error.message;
        resultados.push({
          claveOrigen: item.claveOrigen,
          estado: 'error',
          motivo: Array.isArray(mensaje) ? String(mensaje[0]) : String(mensaje),
          foto: 'sin_foto',
        });
      }
    }
    return { resultados };
  }

  /** Baja la foto elegida (por la misma descarga segura) y la guarda como la del producto. Si falla, el producto queda igual. */
  private async guardarFoto(userId: string, productoId: string, url: string): Promise<'guardada' | 'fallo' | 'limite'> {
    try {
      const descarga = await descargar(url, {
        maxBytes: MAX_BYTES_SUBIDA,
        tipos: TIPOS_IMAGEN,
        timeoutMs: TIMEOUT_PAGINA_MS,
        hostsDePrueba: this.hosts,
      });
      await this.imagenes.guardar(userId, productoId, descarga.cuerpo);
      return 'guardada';
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.CONFLICT) return 'limite';
      if (!(error instanceof DescargaError) && !(error instanceof HttpException)) {
        this.logger.error(`No se pudo guardar la foto importada del producto ${productoId}: ${resumenDeError(error)}`);
      }
      return 'fallo';
    }
  }
}
