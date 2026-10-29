/**
 * Reglas del catálogo como funciones puras, igual que agenda-rules.ts y
 * subscription.rules.ts: normalización del texto de búsqueda, stock visible,
 * parseo de las filas de una importación y fusión de rankings del RAG. Nada
 * acá toca la base ni la red.
 */
import { createHash } from 'node:crypto';

/** Tope de productos/filas de una importación. Un catálogo más grande se sube en partes. */
export const MAX_FILAS_IMPORTACION = 5_000;

/** Tope de variantes por producto (talles × colores de un mismo artículo). */
export const MAX_VARIANTES = 50;

/** Tope de precio, en pesos. El mismo orden de magnitud que PRECIO_MAX de los turnos. */
export const PRECIO_MAX_PESOS = 100_000_000;

/** Tope de stock por variante: más que eso es casi seguro un error de tipeo. */
export const STOCK_MAX = 1_000_000;

/** Con esto o menos unidades el asistente dice "quedan pocas" en vez de "hay". */
export const ULTIMAS_UNIDADES = 3;

export const LARGOS = {
  codigo: 60,
  nombre: 120,
  descripcion: 500,
  categoria: 60,
  variante: 60,
  sku: 60,
} as const;

/**
 * Minúsculas, sin tildes y con un solo espacio. Se usa igual para lo que se
 * guarda (`Producto.textoBusqueda`) y para lo que busca el cliente, así
 * "Café" y "cafe" son la misma palabra para el full-text, los trigramas y el
 * embedding. La ñ se conserva: "año" y "ano" no son lo mismo.
 */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    // Todas las marcas combinables (U+0300..U+036F) menos la tilde (U+0303)
    // que sigue a una n; NFC la vuelve a pegar como ñ.
    .replace(/[\u0300-\u0302\u0304-\u036f]|(?<![nN])\u0303/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export type ProductoParaIndexar = {
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: string | null;
  variantes: Array<{ sku: string; nombre: string }>;
  /** Los materiales de un producto a medida: "placard de melamina" lo encuentra. */
  materiales?: readonly string[];
};

/** Todo lo buscable de un producto en un solo texto normalizado. */
export function textoBusquedaDe(producto: ProductoParaIndexar): string {
  const variantes = producto.variantes
    .flatMap((variante) => [variante.nombre, variante.sku])
    .filter((parte) => parte.length > 0);
  return normalizarTexto(
    [
      producto.nombre,
      producto.categoria ?? '',
      producto.descripcion,
      producto.codigo,
      ...variantes,
      ...(producto.materiales ?? []),
    ]
      .filter((parte) => parte.length > 0)
      .join(' | '),
  );
}

/**
 * md5 hex del texto indexado. Es el mismo `md5()` de Postgres, así la consulta
 * de "qué productos tienen el embedding desactualizado" se resuelve en SQL
 * (`"embeddingHash" IS DISTINCT FROM md5("textoBusqueda")`). No es seguridad:
 * sólo detecta cambios.
 */
export function hashTexto(texto: string): string {
  return createHash('md5').update(texto, 'utf8').digest('hex');
}

// --- Stock -----------------------------------------------------------------

export type VarianteConStock = {
  stock: number | null;
  disponible: boolean;
  activo: boolean;
};

/**
 * Unidades que se pueden vender ya descontadas las reservas vigentes. `null`
 * cuando el dueño no controla cantidad (vale el switch `disponible`).
 */
export function unidadesDisponibles(variante: VarianteConStock, reservadas = 0): number | null {
  if (variante.stock === null) return null;
  return Math.max(variante.stock - reservadas, 0);
}

/** true si alcanza para vender `cantidad` unidades. */
export function hayStock(variante: VarianteConStock, cantidad = 1, reservadas = 0): boolean {
  if (!variante.activo) return false;
  const unidades = unidadesDisponibles(variante, reservadas);
  return unidades === null ? variante.disponible : unidades >= cantidad;
}

/**
 * Lo que el asistente puede decir del stock. A propósito no expone la cantidad
 * exacta salvo cuando quedan pocas: es información del negocio.
 */
export function describirStock(variante: VarianteConStock, reservadas = 0): string {
  if (!hayStock(variante, 1, reservadas)) return 'sin stock';
  const unidades = unidadesDisponibles(variante, reservadas);
  if (unidades !== null && unidades <= ULTIMAS_UNIDADES) {
    return unidades === 1 ? 'queda 1 unidad' : `quedan ${unidades} unidades`;
  }
  return 'disponible';
}

/** true si la variante quedó en o por debajo de su mínimo (y lo tiene definido). */
export function stockBajo(variante: { stock: number | null; stockMinimo: number | null }): boolean {
  return variante.stock !== null && variante.stockMinimo !== null && variante.stock <= variante.stockMinimo;
}

// --- Precios -----------------------------------------------------------------

const FORMATO_PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const FORMATO_PESOS_CON_CENTAVOS = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 150000 → "$ 1.500"; 150050 → "$ 1.500,50". Va al prompt, así que el formato es fijo. */
export function formatearCentavos(centavos: number): string {
  return formatearMonto(centavos, 'ARS');
}

/**
 * Monedas en las que se puede cargar un producto. Todo lo que no es del
 * catálogo de stock (a medida, presupuestos, costos, la suscripción) sigue
 * en pesos.
 */
export const MONEDAS = ['ARS', 'USD'] as const;
export type Moneda = (typeof MONEDAS)[number];

export function esMoneda(valor: unknown): valor is Moneda {
  return typeof valor === 'string' && (MONEDAS as readonly string[]).includes(valor);
}

/** La moneda de una fila de la base: cualquier cosa rara cuenta como pesos. */
export function monedaDe(valor: unknown): Moneda {
  return esMoneda(valor) ? valor : 'ARS';
}

/**
 * 150000 en pesos → "$ 1.500"; en dólares → "US$ 1.500". El prefijo de los
 * dólares es fijo porque `montosEnTexto` lo lee para no confundirlo con pesos.
 */
export function formatearMonto(centavos: number, moneda: string = 'ARS'): string {
  const unidades = centavos / 100;
  const numero = Number.isInteger(unidades)
    ? FORMATO_PESOS.format(unidades)
    : FORMATO_PESOS_CON_CENTAVOS.format(unidades);
  return `${monedaDe(moneda) === 'USD' ? 'US$' : '$'} ${numero}`;
}

/**
 * Precio escrito como lo escribe alguien en Argentina, a centavos:
 * "1500", "1.500", "1.500,50", "$ 1500.5", "1,5". Devuelve null si no es un
 * número válido. Un solo punto seguido de exactamente tres dígitos es de
 * miles ("1.500"), igual que en una planilla en español.
 */
export function parsearPrecio(texto: string): number | null {
  const limpio = texto.replace(/u\$s|us\$|usd|\$|\s|ars/gi, '');
  if (!/^\d[\d.,]*$/.test(limpio)) return null;

  let normalizado: string;
  const tienePunto = limpio.includes('.');
  const tieneComa = limpio.includes(',');
  if (tienePunto && tieneComa) {
    // El último separador es el decimal y el otro tiene que agrupar de a tres.
    const decimalEsComa = limpio.lastIndexOf(',') > limpio.lastIndexOf('.');
    const valido = decimalEsComa ? /^\d{1,3}(\.\d{3})+,\d{1,2}$/ : /^\d{1,3}(,\d{3})+\.\d{1,2}$/;
    if (!valido.test(limpio)) return null;
    normalizado = decimalEsComa ? limpio.replace(/\./g, '').replace(',', '.') : limpio.replace(/,/g, '');
  } else if (tieneComa) {
    normalizado = /^\d{1,3}(,\d{3})+$/.test(limpio) ? limpio.replace(/,/g, '') : limpio.replace(',', '.');
  } else if (tienePunto) {
    normalizado = /^\d{1,3}(\.\d{3})+$/.test(limpio) ? limpio.replace(/\./g, '') : limpio;
  } else {
    normalizado = limpio;
  }

  // Un .xlsx guarda 15000.000000000002 donde se ve 15000: el ruido de float no es un error.
  if (/^\d+\.\d{3,}$/.test(normalizado)) {
    const centavosFlotantes = Number(normalizado) * 100;
    if (Math.abs(centavosFlotantes - Math.round(centavosFlotantes)) > 1e-4) return null;
    normalizado = (Math.round(centavosFlotantes) / 100).toFixed(2);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalizado)) return null;
  const centavos = Math.round(Number(normalizado) * 100);
  if (!Number.isFinite(centavos) || centavos > PRECIO_MAX_PESOS * 100) return null;
  return centavos;
}

// --- Importación ---------------------------------------------------------------

/** Columnas de la plantilla, en el orden en que se descargan. */
export const COLUMNAS_IMPORTACION = [
  'codigo',
  'nombre',
  'descripcion',
  'categoria',
  'variante',
  'sku',
  'precio',
  'stock',
  'stock_minimo',
  'disponible',
  'moneda',
] as const;

export type ColumnaImportacion = (typeof COLUMNAS_IMPORTACION)[number];

/** "Stock mínimo" → "stock_minimo", "Código" → "codigo". */
export function normalizarColumna(nombre: string): string {
  return normalizarTexto(nombre).replace(/[^a-z0-9ñ]+/g, '_').replace(/^_+|_+$/g, '');
}

export type VarianteImportada = {
  sku: string;
  nombre: string;
  precioCentavos: number;
  stock: number | null;
  stockMinimo: number | null;
  disponible: boolean;
};

export type ProductoImportado = {
  codigo: string;
  nombre: string;
  /** Sólo si la planilla tiene la columna; si no, no se toca (el export de Mercado Libre no la trae). */
  descripcion?: string;
  categoria?: string | null;
  /** Sólo si la planilla la dice (columna o "US$" en el precio); si no, no se toca. */
  moneda?: Moneda;
  variantes: VarianteImportada[];
  /** Números de fila (1 = primera fila de datos) de donde salió, para los errores. */
  filas: number[];
};

/** `columna` dice qué campo de la planilla arreglar; sin ella el error es de la fila o del producto entero. */
export type ErrorDeFila = { fila: number; mensaje: string; columna?: ColumnaImportacion };

export type ResultadoImportacion = {
  productos: ProductoImportado[];
  errores: ErrorDeFila[];
};

function celda(fila: Record<string, unknown>, columna: ColumnaImportacion): string {
  const valor = fila[columna];
  if (valor === undefined || valor === null) return '';
  return String(valor).replace(/\s+/g, ' ').trim();
}

/** Deja sólo las columnas conocidas, con los encabezados ya normalizados. */
function normalizarFila(fila: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(fila)) {
    const columna = normalizarColumna(clave);
    if ((COLUMNAS_IMPORTACION as readonly string[]).includes(columna)) salida[columna] = valor;
  }
  return salida;
}

function parsearEntero(texto: string, maximo: number): number | null | 'invalido' {
  if (texto === '') return null;
  const sinEspacios = texto.replace(/\s/g, '');
  // "10.0" (Excel) es 10; "1.000" son miles; "1.5" no es un entero y no se adivina.
  let limpio: string;
  if (/^\d+\.0{1,2}$/.test(sinEspacios)) limpio = sinEspacios.replace(/\.0+$/, '');
  else if (/^\d{1,3}(\.\d{3})+$/.test(sinEspacios)) limpio = sinEspacios.replaceAll('.', '');
  else limpio = sinEspacios;
  if (!/^\d+$/.test(limpio)) return 'invalido';
  const valor = Number(limpio);
  return valor > maximo ? 'invalido' : valor;
}

/** "pesos", "ARS", "$" → ARS; "dólares", "USD", "US$" → USD; vacío → undefined (no se toca). */
export function parsearMoneda(texto: string): Moneda | undefined | 'invalido' {
  const valor = normalizarTexto(texto).replace(/\s/g, '');
  if (valor === '') return undefined;
  if (['ars', 'pesos', 'peso', '$', 'ar$'].includes(valor)) return 'ARS';
  if (['usd', 'us$', 'u$s', 'dolares', 'dolar', 'u$d'].includes(valor)) return 'USD';
  return 'invalido';
}

/** Un precio escrito "US$ 10" o "USD 10" dice la moneda aunque no haya columna. */
function monedaDelPrecio(texto: string): Moneda | undefined {
  return /^\s*(us\$|u\$s|usd)/i.test(texto) ? 'USD' : undefined;
}

function parsearBooleano(texto: string): boolean | 'invalido' {
  const valor = normalizarTexto(texto);
  if (valor === '') return true;
  if (['si', 'sí', 's', 'true', '1', 'x', 'hay', 'disponible'].includes(valor)) return true;
  if (['no', 'n', 'false', '0', 'sin stock', 'agotado'].includes(valor)) return false;
  return 'invalido';
}

/** "MLA123456789" (o MLB, MCO…): el número de una publicación de Mercado Libre. */
export function esIdMercadoLibre(codigo: string): boolean {
  return /^M[A-Z]{2}\d{6,}$/.test(codigo);
}

/** SKU por defecto: el código si es la variante única, o código + variante. */
export function skuPorDefecto(codigo: string, variante: string): string {
  if (!variante) return codigo;
  const sufijo = normalizarTexto(variante).replace(/[^a-z0-9ñ]+/g, '-').replace(/^-+|-+$/g, '');
  return `${codigo}-${sufijo}`.slice(0, LARGOS.sku);
}

type FilaParseada = {
  fila: number;
  codigo: string;
  nombre: string;
  descripcion: string | undefined;
  categoria: string | null | undefined;
  moneda: Moneda | undefined;
  variante: VarianteImportada;
};

function parsearFila(crudo: Record<string, unknown>, numero: number): FilaParseada | ErrorDeFila[] {
  const fila = normalizarFila(crudo);
  const errores: Array<{ columna: ColumnaImportacion; mensaje: string }> = [];
  const error = (columna: ColumnaImportacion, mensaje: string) => errores.push({ columna, mensaje });

  const codigo = celda(fila, 'codigo');
  const nombre = celda(fila, 'nombre');
  const descripcion = celda(fila, 'descripcion');
  const categoria = celda(fila, 'categoria');
  const variante = celda(fila, 'variante');
  const sku = celda(fila, 'sku') || skuPorDefecto(codigo, variante);

  if (!codigo) error('codigo', 'Falta el código');
  else if (codigo.length > LARGOS.codigo) error('codigo', `Máximo ${LARGOS.codigo} caracteres`);
  if (!nombre) error('nombre', 'Falta el nombre');
  else if (nombre.length < 2) error('nombre', 'Muy corto (mínimo 2 letras)');
  else if (nombre.length > LARGOS.nombre) error('nombre', `Máximo ${LARGOS.nombre} caracteres`);
  if (descripcion.length > LARGOS.descripcion)
    error('descripcion', `Máximo ${LARGOS.descripcion} caracteres`);
  if (categoria.length > LARGOS.categoria) error('categoria', `Máximo ${LARGOS.categoria} caracteres`);
  if (variante.length > LARGOS.variante) error('variante', `Máximo ${LARGOS.variante} caracteres`);
  if (sku.length > LARGOS.sku) error('sku', `Máximo ${LARGOS.sku} caracteres`);

  const precioTexto = celda(fila, 'precio');
  const precioCentavos = precioTexto ? parsearPrecio(precioTexto) : null;
  if (!precioTexto) error('precio', 'Falta el precio');
  else if (precioCentavos === null) error('precio', `Precio inválido: «${precioTexto.slice(0, 20)}»`);

  const stock = parsearEntero(celda(fila, 'stock'), STOCK_MAX);
  if (stock === 'invalido') error('stock', 'Tiene que ser un número entero (o vacío)');
  const stockMinimo = parsearEntero(celda(fila, 'stock_minimo'), STOCK_MAX);
  if (stockMinimo === 'invalido') error('stock_minimo', 'Tiene que ser un número entero (o vacío)');
  const disponible = parsearBooleano(celda(fila, 'disponible'));
  if (disponible === 'invalido') error('disponible', 'Poné «sí» o «no»');
  const monedaColumna = parsearMoneda(celda(fila, 'moneda'));
  if (monedaColumna === 'invalido') error('moneda', 'Poné «ARS» (pesos) o «USD» (dólares), o dejala vacía');
  const moneda = monedaColumna === 'invalido' ? undefined : (monedaColumna ?? monedaDelPrecio(precioTexto));

  if (errores.length > 0) return errores.map((e) => ({ fila: numero, ...e }));

  return {
    fila: numero,
    codigo,
    nombre,
    descripcion: 'descripcion' in fila ? descripcion : undefined,
    categoria: 'categoria' in fila ? categoria || null : undefined,
    moneda,
    variante: {
      sku,
      nombre: variante,
      precioCentavos: precioCentavos as number,
      stock: stock as number | null,
      stockMinimo: stockMinimo as number | null,
      disponible: disponible as boolean,
    },
  };
}

/**
 * Filas de una planilla (una por variante) → productos con sus variantes.
 *
 * Las filas con el mismo `codigo` son variantes del mismo producto: nombre,
 * descripción y categoría salen de la primera. Si alguna fila de un producto
 * tiene errores, se descarta el producto entero en vez de importarlo con
 * variantes de menos.
 */
export function agruparFilasImportacion(filas: Array<Record<string, unknown>>): ResultadoImportacion {
  const errores: ErrorDeFila[] = [];
  const porCodigo = new Map<string, ProductoImportado>();
  const conErrores = new Set<string>();

  filas.forEach((crudo, indice) => {
    const numero = indice + 1;
    // Una fila vacía (típico al final de una planilla) no es un error.
    if (Object.values(crudo).every((valor) => String(valor ?? '').trim() === '')) return;

    const parseada = parsearFila(crudo, numero);
    const codigo = celda(normalizarFila(crudo), 'codigo');
    if (Array.isArray(parseada)) {
      errores.push(...parseada);
      if (codigo) conErrores.add(codigo);
      return;
    }

    const existente = porCodigo.get(parseada.codigo);
    if (!existente) {
      porCodigo.set(parseada.codigo, {
        codigo: parseada.codigo,
        nombre: parseada.nombre,
        ...(parseada.descripcion !== undefined && { descripcion: parseada.descripcion }),
        ...(parseada.categoria !== undefined && { categoria: parseada.categoria }),
        ...(parseada.moneda !== undefined && { moneda: parseada.moneda }),
        variantes: [parseada.variante],
        filas: [numero],
      });
      return;
    }

    if (existente.variantes.some((variante) => variante.sku === parseada.variante.sku)) {
      errores.push({ fila: numero, mensaje: `SKU repetido en el producto ${parseada.codigo}` });
      conErrores.add(parseada.codigo);
      return;
    }
    if (parseada.moneda !== undefined && existente.moneda !== undefined && parseada.moneda !== existente.moneda) {
      errores.push({ fila: numero, mensaje: `las variantes del producto ${parseada.codigo} tienen que estar en la misma moneda`, columna: 'moneda' });
      conErrores.add(parseada.codigo);
      return;
    }
    if (existente.moneda === undefined && parseada.moneda !== undefined) existente.moneda = parseada.moneda;
    if (existente.variantes.length >= MAX_VARIANTES) {
      errores.push({ fila: numero, mensaje: `el producto ${parseada.codigo} tiene más de ${MAX_VARIANTES} variantes` });
      conErrores.add(parseada.codigo);
      return;
    }
    existente.variantes.push(parseada.variante);
    existente.filas.push(numero);
  });

  const productos = [...porCodigo.values()].filter((producto) => !conErrores.has(producto.codigo));
  for (const producto of porCodigo.values()) {
    if (conErrores.has(producto.codigo)) {
      errores.push({
        fila: producto.filas[0],
        mensaje: `el producto ${producto.codigo} no se importa porque otra de sus filas tiene errores`,
      });
    }
  }
  errores.sort((a, b) => a.fila - b.fila);
  return { productos, errores };
}

// --- Búsqueda ------------------------------------------------------------------

/** Constante de Reciprocal Rank Fusion: la de siempre en la literatura (Cormack et al.). */
export const RRF_K = 60;

export type Ranking = {
  /** Ids ordenados del más relevante al menos relevante. */
  ids: string[];
  /** Multiplicador del aporte de este ranking. */
  peso?: number;
};

/**
 * Reciprocal Rank Fusion: cada ranking aporta `peso / (k + posición)` a cada
 * id. No necesita que los puntajes de full-text, trigramas y coseno estén en la
 * misma escala — sólo usa las posiciones —, que es lo que hace posible mezclar
 * búsquedas tan distintas.
 */
export function fusionarRankings(rankings: Ranking[], limite: number): string[] {
  const puntajes = new Map<string, number>();
  for (const { ids, peso = 1 } of rankings) {
    ids.forEach((id, posicion) => {
      puntajes.set(id, (puntajes.get(id) ?? 0) + peso / (RRF_K + posicion + 1));
    });
  }
  return [...puntajes.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limite)
    .map(([id]) => id);
}

/**
 * Consulta del cliente → tsquery de Postgres con OR y prefijo por palabra
 * ("remera negr" → "remera:* | negr:*"). OR y no AND: el cliente escribe de
 * más ("tenés la remera negra en talle m?") y exigir todas las palabras no
 * encontraría nada. Los números van sin prefijo: "42" no es "420". Sólo
 * quedan letras y números, así que el texto del cliente nunca llega a la
 * sintaxis de tsquery.
 */
export function consultaTsquery(consulta: string): string | null {
  const palabras = normalizarTexto(consulta)
    .split(' ')
    .map((palabra) => palabra.replace(/[^a-z0-9ñ]/g, ''))
    .filter((palabra) => palabra.length >= 2);
  const unicas = [...new Set(palabras)].slice(0, 12);
  return unicas.length > 0
    ? unicas.map((palabra) => (/^\d+$/.test(palabra) ? palabra : `${palabra}:*`)).join(' | ')
    : null;
}
