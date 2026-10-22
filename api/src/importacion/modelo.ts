/**
 * Las formas de la importación rápida que no son DTOs: lo que vuelve a la
 * vista previa y sus topes. Sin decoradores, para que las reglas puras se
 * puedan usar (y testear) sin cargar class-validator.
 */
import type { Moneda } from '../comercio/catalogo.rules.js';

/** Enlaces por pedido de extracción y productos por confirmación. */
export const MAX_URLS_POR_PEDIDO = 10;
export const MAX_PRODUCTOS_POR_CONFIRMACION = 10;
/** Fotos que se ofrecen por producto (se guarda una: el catálogo tiene una por producto). */
export const MAX_IMAGENES_OFRECIDAS = 6;
/** Productos que se leen de un listado genérico y de uno de Mercado Libre. */
export const MAX_PRODUCTOS_LISTADO_WEB = 20;
export const MAX_PRODUCTOS_LISTADO_ML = 50;

export type FuenteImportacion = 'mercadolibre' | 'tiendamia' | 'web';

/** Lo que la vista previa le avisa al dueño de un producto: nada se completa inventando. */
export type AvisoBorrador =
  | 'sin_precio'
  | 'sin_moneda'
  | 'moneda_no_soportada'
  | 'variantes_recortadas'
  | 'descripcion_recortada'
  | 'sin_descripcion'
  | 'sin_imagen'
  /** La página habla de hacerlo a medida o de cotizarlo: se sugiere cargarlo como producto a medida. */
  | 'parece_a_medida';

/** Cómo se vende lo importado: con precio y stock, o a medida (se cotiza). */
export type TipoImportado = 'stock' | 'a_medida';
export const TIPOS_IMPORTADO: readonly TipoImportado[] = ['stock', 'a_medida'];

/** Por qué un enlace no dio productos, en un código que la pantalla sabe explicar. */
export type CodigoErrorImportacion =
  | 'url_invalida'
  | 'host_no_permitido'
  | 'acceso_denegado'
  | 'no_encontrada'
  | 'error_del_sitio'
  | 'tipo_no_soportado'
  | 'demasiado_grande'
  | 'tiempo_agotado'
  | 'sin_conexion'
  | 'pagina_no_soportada'
  | 'sin_datos_de_producto'
  | 'mercadolibre_no_disponible'
  | 'listado_no_soportado';

export type VarianteExtraida = {
  nombre: string;
  sku: string | null;
  /** null = la página no lo dice (o no en una moneda que se pueda vender): lo carga el dueño. */
  precioCentavos: number | null;
};

/** Un producto tal como salió de la página, ya con el texto limpio. */
export type ProductoExtraido = {
  nombre: string;
  descripcion: string;
  categoria: string | null;
  moneda: Moneda | null;
  variantes: VarianteExtraida[];
  imagenes: string[];
  avisos: AvisoBorrador[];
  /** Un id estable que da el sitio (el de la publicación de Mercado Libre, un ASIN…), si lo hay. */
  idExterno: string | null;
  /** La URL canónica del producto, si la página la dice. */
  url: string | null;
  /**
   * El producto es una sección de una página con varios (una landing sin
   * páginas por producto): distingue su clave de origen de la de los demás.
   */
  seccion?: string | null;
};

/** Ya existe en el catálogo: por qué se lo considera el mismo. */
export type DuplicadoDe = { motivo: 'origen' | 'codigo' | 'sku'; productoId: string; nombre: string };

/** Lo que vuelve a la vista previa por cada producto encontrado. */
export type BorradorProducto = Omit<ProductoExtraido, 'idExterno' | 'url' | 'seccion'> & {
  claveOrigen: string;
  origenUrl: string;
  fuente: FuenteImportacion;
  codigoSugerido: string;
  duplicado: DuplicadoDe | null;
  /**
   * Cómo conviene cargarlo: de stock si la página trae precio, a medida si
   * habla de cotizar o de medidas a pedido; null = el dueño lo tiene que elegir.
   */
  tipoSugerido: TipoImportado | null;
  /** Firma de { claveOrigen, origenUrl, imagenes }: la confirmación sólo acepta lo que salió de acá. */
  firma: string;
  emitidaAt: string;
};

export type ErrorDeEnlace = { url: string; codigo: CodigoErrorImportacion };

export type ResultadoExtraccion = {
  productos: BorradorProducto[];
  errores: ErrorDeEnlace[];
  /** Un listado tenía más productos de los que se leen. */
  recortado: boolean;
};

export type EstadoConfirmado = 'creado' | 'actualizado' | 'salteado' | 'error';
export type EstadoFoto = 'guardada' | 'sin_foto' | 'fallo' | 'limite';

export type ResultadoConfirmacion = {
  resultados: Array<{
    claveOrigen: string;
    estado: EstadoConfirmado;
    productoId?: string;
    /** Con qué tipo quedó guardado, para mandar al editor que corresponde. */
    tipo?: TipoImportado;
    /** Por qué se salteó o falló, en una frase para el dueño. */
    motivo?: string;
    foto: EstadoFoto;
  }>;
};
