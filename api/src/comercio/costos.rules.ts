/**
 * Materiales y costos de un comercio a pedido (LAU-26), como funciones puras.
 * Tres piezas:
 *
 * - **Insumos** (`Insumo`): lo que cuesta hacer algo, por unidad. Materiales
 *   ("Melamina 18 mm", $ por m²), fabricación y máquinas ("Corte láser", $
 *   por hora) y mano de obra ("Carpintero", $ por hora).
 * - **Configuración** (`ConfigCotizacion`): los extras que se suman a toda
 *   cotización (ganancia, IVA si lo quiere), el redondeo, si el presupuesto
 *   del asistente es estimativo, la vigencia y cuánto detalle ve el cliente.
 * - **Receta** (`Producto.receta`): qué insumos lleva un producto y cuánto de
 *   cada uno, como fórmula sobre las preguntas de número; y sus extras, fijos
 *   o que dependen de una opción elegida ("con instalación").
 *
 * La cuenta la hace cotizacion.rules.ts, siempre en el código.
 */
import { PRECIO_MAX_PESOS } from './catalogo.rules.js';
import { claveDeCampo } from './datos-cliente.rules.js';
import { LARGO_MAX_FORMULA, parsearFormula } from './formula.rules.js';
import { enUnaLinea, esObjeto, variablesDeSolicitud, type SolicitudADemanda } from './solicitud.rules.js';

export const TIPOS_INSUMO = ['material', 'proceso', 'mano_obra'] as const;
export type TipoInsumo = (typeof TIPOS_INSUMO)[number];

export const UNIDADES_INSUMO = ['unidad', 'm', 'm2', 'm3', 'cm', 'cm2', 'litro', 'kg', 'g', 'hora', 'minuto'] as const;
export type UnidadInsumo = (typeof UNIDADES_INSUMO)[number];

/** Cómo se escribe cada unidad para el dueño y en el presupuesto. */
export const ETIQUETA_UNIDAD: Record<UnidadInsumo, string> = {
  unidad: 'u',
  m: 'm',
  m2: 'm²',
  m3: 'm³',
  cm: 'cm',
  cm2: 'cm²',
  litro: 'l',
  kg: 'kg',
  g: 'g',
  hora: 'h',
  minuto: 'min',
};

export const MAX_INSUMOS = 200;
export const LARGO_MAX_NOMBRE_INSUMO = 60;
export const COSTO_MAX_CENTAVOS = PRECIO_MAX_PESOS * 100;

export const MAX_RENGLONES_RECETA = 20;
export const MAX_EXTRAS = 10;
export const LARGO_MAX_NOMBRE_EXTRA = 60;
/** Un porcentaje de extra (ganancia, IVA): hasta 10 veces el costo. */
export const PORCENTAJE_MAX_EXTRA = 1000;
export const REDONDEO_MAX_CENTAVOS = 10_000_000;
export const VIGENCIA_MAX_DIAS = 365;

export const POLITICAS_COTIZACION = ['manual', 'revision', 'automatica'] as const;
export type PoliticaCotizacion = (typeof POLITICAS_COTIZACION)[number];

export const DESGLOSES = ['total', 'detallado'] as const;
export type Desglose = (typeof DESGLOSES)[number];

export type Insumo = {
  id: string;
  tipo: TipoInsumo;
  nombre: string;
  unidad: UnidadInsumo;
  costoCentavos: number;
  activo: boolean;
};

/** "Sólo si la respuesta a … es …": un renglón o extra que depende de una opción elegida. */
export type Condicion = { pregunta: string; opcion: string };

export const MODOS_EXTRA = ['fijo', 'porcentaje', 'formula'] as const;
export type ModoExtra = (typeof MODOS_EXTRA)[number];

/**
 * Un extra. `fijo`: `valor` en centavos. `porcentaje`: `valor` en % sobre lo
 * que va sumando la cotización hasta ese momento (en orden, así "ganancia" y
 * después "IVA" da el IVA sobre el precio con ganancia). `formula`: pesos
 * calculados con los datos del cliente (sólo en la receta, no en los generales).
 */
export type Extra = { nombre: string; modo: ModoExtra; valor: number; formula?: string; cuando?: Condicion };

export type RenglonReceta = { insumoId: string; cantidad: string; cuando?: Condicion };

export type Receta = { renglones: RenglonReceta[]; extras: Extra[] };

export type ConfigCotizacion = {
  extras: Extra[];
  redondeoCentavos: number;
  estimativo: boolean;
  vigenciaDias: number | null;
  desgloseAlCliente: Desglose;
};

export const CONFIG_POR_DEFECTO: ConfigCotizacion = {
  extras: [],
  redondeoCentavos: 0,
  estimativo: true,
  vigenciaDias: null,
  desgloseAlCliente: 'total',
};

function esUno<T extends string>(lista: readonly T[], valor: unknown): valor is T {
  return typeof valor === 'string' && (lista as readonly string[]).includes(valor);
}

export function leerPolitica(valor: unknown): PoliticaCotizacion {
  return esUno(POLITICAS_COTIZACION, valor) ? valor : 'manual';
}

// --- Insumos ---------------------------------------------------------------------

export type InsumoEntrada = { tipo?: unknown; nombre?: unknown; unidad?: unknown; costoCentavos?: unknown };

export function normalizarInsumo(
  entrada: InsumoEntrada,
): { insumo: Omit<Insumo, 'id' | 'activo'> } | { error: string } {
  if (!esUno(TIPOS_INSUMO, entrada.tipo)) return { error: 'Elegí si es un material, fabricación o mano de obra.' };
  const nombre = typeof entrada.nombre === 'string' ? enUnaLinea(entrada.nombre) : '';
  if (!nombre) return { error: 'Escribí el nombre.' };
  if (nombre.length > LARGO_MAX_NOMBRE_INSUMO) return { error: `El nombre puede tener hasta ${LARGO_MAX_NOMBRE_INSUMO} caracteres.` };
  if (!esUno(UNIDADES_INSUMO, entrada.unidad)) return { error: 'Elegí la unidad en que lo comprás o lo cobrás.' };
  const costo = entrada.costoCentavos;
  if (typeof costo !== 'number' || !Number.isInteger(costo) || costo < 1 || costo > COSTO_MAX_CENTAVOS) {
    return { error: `El costo de ${JSON.stringify(nombre)} tiene que ser mayor que cero.` };
  }
  return { insumo: { tipo: entrada.tipo, nombre, unidad: entrada.unidad, costoCentavos: costo } };
}

/** Una fila de `Insumo` con la forma validada; null si el tipo o la unidad no son conocidos. */
export function leerInsumo(fila: {
  id: string;
  tipo: string;
  nombre: string;
  unidad: string;
  costoCentavos: number;
  activo: boolean;
}): Insumo | null {
  if (!esUno(TIPOS_INSUMO, fila.tipo) || !esUno(UNIDADES_INSUMO, fila.unidad)) return null;
  return { id: fila.id, tipo: fila.tipo, nombre: fila.nombre, unidad: fila.unidad, costoCentavos: fila.costoCentavos, activo: fila.activo };
}

/** Los insumos por id, para validar y calcular recetas. */
export function mapaDeInsumos(filas: Parameters<typeof leerInsumo>[0][]): Map<string, Insumo> {
  return new Map(filas.flatMap((fila) => {
    const insumo = leerInsumo(fila);
    return insumo ? [[insumo.id, insumo] as const] : [];
  }));
}

// --- Extras y configuración ------------------------------------------------------------

type ContextoReceta = {
  /** Las preguntas del producto: de ahí salen los datos de las fórmulas y las opciones de las condiciones. */
  solicitud: SolicitudADemanda | null;
  /** Insumos activos del dueño, por id. */
  insumos?: ReadonlyMap<string, Insumo>;
};

function normalizarCondicion(valor: unknown, contexto: ContextoReceta, donde: string): { cuando?: Condicion } | { error: string } {
  if (valor === undefined || valor === null) return {};
  if (!esObjeto(valor) || typeof valor.pregunta !== 'string' || typeof valor.opcion !== 'string') {
    return { error: `La condición de ${donde} no es válida.` };
  }
  const pregunta = (contexto.solicitud?.preguntas ?? []).find((p) => claveDeCampo(p.texto) === claveDeCampo(valor.pregunta as string));
  if (!pregunta || pregunta.opciones.length === 0) {
    return { error: `La condición de ${donde} usa una pregunta que no existe o no tiene opciones.` };
  }
  const opcion = pregunta.opciones.find((o) => claveDeCampo(o) === claveDeCampo(valor.opcion as string));
  if (!opcion) return { error: `La condición de ${donde} usa una opción que la pregunta no tiene.` };
  return { cuando: { pregunta: pregunta.texto, opcion } };
}

function normalizarExtra(
  crudo: unknown,
  numero: number,
  contexto: ContextoReceta,
  general: boolean,
): { extra: Extra } | { error: string } {
  if (!esObjeto(crudo)) return { error: `El extra ${numero} no es válido.` };
  const nombre = typeof crudo.nombre === 'string' ? enUnaLinea(crudo.nombre) : '';
  if (!nombre) return { error: `Al extra ${numero} le falta el nombre.` };
  if (nombre.length > LARGO_MAX_NOMBRE_EXTRA) return { error: `El nombre del extra ${numero} es demasiado largo.` };
  const donde = `"${nombre}"`;
  if (!esUno(MODOS_EXTRA, crudo.modo) || (general && crudo.modo === 'formula')) {
    return { error: `Elegí si ${donde} es un monto fijo${general ? '' : ', un porcentaje o una cuenta'} o un porcentaje.` };
  }
  const condicion = general ? {} : normalizarCondicion(crudo.cuando, contexto, donde);
  if ('error' in condicion) return condicion;
  if (crudo.modo === 'formula') {
    const formula = typeof crudo.formula === 'string' ? crudo.formula.trim() : '';
    const parseo = parsearFormula(formula, new Set(variablesDeSolicitud(contexto.solicitud)));
    if (!parseo.ok) return { error: `${donde}: ${parseo.error}` };
    return { extra: { nombre, modo: 'formula', valor: 0, formula, ...condicion } };
  }
  const valor = crudo.valor;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) return { error: `${donde} tiene que tener un valor mayor que cero.` };
  if (crudo.modo === 'fijo' && (!Number.isInteger(valor) || valor > COSTO_MAX_CENTAVOS)) return { error: `El monto de ${donde} no es válido.` };
  if (crudo.modo === 'porcentaje' && valor > PORCENTAJE_MAX_EXTRA) return { error: `El porcentaje de ${donde} es demasiado alto.` };
  return { extra: { nombre, modo: crudo.modo, valor: crudo.modo === 'porcentaje' ? Math.round(valor * 100) / 100 : valor, ...condicion } };
}

function normalizarExtras(lista: unknown, contexto: ContextoReceta, general: boolean): { extras: Extra[] } | { error: string } {
  const crudos = Array.isArray(lista) ? lista : [];
  if (crudos.length > MAX_EXTRAS) return { error: `Puede haber hasta ${MAX_EXTRAS} extras.` };
  const extras: Extra[] = [];
  for (const [indice, crudo] of crudos.entries()) {
    const resultado = normalizarExtra(crudo, indice + 1, contexto, general);
    if ('error' in resultado) return resultado;
    extras.push(resultado.extra);
  }
  return { extras };
}

export type ConfigEntrada = {
  extras?: unknown;
  redondeoCentavos?: unknown;
  estimativo?: unknown;
  vigenciaDias?: unknown;
  desgloseAlCliente?: unknown;
};

export function normalizarConfig(entrada: ConfigEntrada): { config: ConfigCotizacion } | { error: string } {
  const extras = normalizarExtras(entrada.extras, { solicitud: null }, true);
  if ('error' in extras) return extras;
  const redondeo = entrada.redondeoCentavos ?? 0;
  if (typeof redondeo !== 'number' || !Number.isInteger(redondeo) || redondeo < 0 || redondeo > REDONDEO_MAX_CENTAVOS) {
    return { error: 'El redondeo no es válido.' };
  }
  const vigencia = entrada.vigenciaDias ?? null;
  if (vigencia !== null && (typeof vigencia !== 'number' || !Number.isInteger(vigencia) || vigencia < 1 || vigencia > VIGENCIA_MAX_DIAS)) {
    return { error: `La vigencia tiene que ser de 1 a ${VIGENCIA_MAX_DIAS} días.` };
  }
  return {
    config: {
      extras: extras.extras,
      redondeoCentavos: redondeo,
      estimativo: entrada.estimativo !== false,
      vigenciaDias: vigencia as number | null,
      desgloseAlCliente: esUno(DESGLOSES, entrada.desgloseAlCliente) ? entrada.desgloseAlCliente : 'total',
    },
  };
}

/** Lee la fila guardada sin confiar en la forma: lo que no cierra vuelve al valor por defecto. */
export function leerConfig(fila: ConfigEntrada | null): ConfigCotizacion {
  if (!fila) return CONFIG_POR_DEFECTO;
  const resultado = normalizarConfig(fila);
  if ('config' in resultado) return resultado.config;
  // Unos extras rotos no se llevan el resto de la configuración.
  const sinExtras = normalizarConfig({ ...fila, extras: [] });
  return 'config' in sinExtras ? sinExtras.config : CONFIG_POR_DEFECTO;
}

// --- Receta -----------------------------------------------------------------------------

/**
 * Valida la receta de un producto. Con `insumos`, además cada renglón tiene
 * que usar uno del dueño y activo (al guardar); sin ellos (al leer) sólo se
 * revisa la forma, y un insumo que ya no está lo detecta la cotización.
 */
export function normalizarReceta(entrada: unknown, contexto: ContextoReceta): { receta: Receta } | { error: string } {
  if (!esObjeto(entrada)) return { error: 'La receta no es válida.' };
  const crudos = Array.isArray(entrada.renglones) ? entrada.renglones : [];
  if (crudos.length > MAX_RENGLONES_RECETA) return { error: `Una receta puede tener hasta ${MAX_RENGLONES_RECETA} renglones.` };
  const variables = new Set(variablesDeSolicitud(contexto.solicitud));
  const renglones: RenglonReceta[] = [];
  for (const [indice, crudo] of crudos.entries()) {
    const numero = indice + 1;
    if (!esObjeto(crudo) || typeof crudo.insumoId !== 'string' || !crudo.insumoId) {
      return { error: `Elegí qué usa el renglón ${numero} de la receta.` };
    }
    const insumo = contexto.insumos?.get(crudo.insumoId);
    if (contexto.insumos && !insumo) return { error: `El renglón ${numero} usa algo que no está en tus materiales y costos.` };
    const donde = insumo ? `"${insumo.nombre}"` : `el renglón ${numero}`;
    const cantidad = typeof crudo.cantidad === 'string' ? crudo.cantidad.trim() : String(crudo.cantidad ?? '').trim();
    if (cantidad.length > LARGO_MAX_FORMULA) return { error: `La cantidad de ${donde} es demasiado larga.` };
    const parseo = parsearFormula(cantidad, variables);
    if (!parseo.ok) return { error: `Cantidad de ${donde}: ${parseo.error}` };
    const condicion = normalizarCondicion(crudo.cuando, contexto, donde);
    if ('error' in condicion) return condicion;
    renglones.push({ insumoId: crudo.insumoId, cantidad, ...condicion });
  }
  const extras = normalizarExtras(entrada.extras, contexto, false);
  if ('error' in extras) return extras;
  return { receta: { renglones, extras: extras.extras } };
}

/** Lee `Producto.receta`. null si no hay o si no cierra (= no se cotiza solo). */
export function leerReceta(valor: unknown, solicitud: SolicitudADemanda | null): Receta | null {
  if (valor === null || valor === undefined) return null;
  const resultado = normalizarReceta(valor, { solicitud });
  return 'receta' in resultado ? resultado.receta : null;
}

/** true si la receta tiene algo con qué calcular un precio. */
export function recetaConContenido(receta: Receta | null): receta is Receta {
  return receta !== null && (receta.renglones.length > 0 || receta.extras.some((extra) => extra.modo !== 'porcentaje'));
}
