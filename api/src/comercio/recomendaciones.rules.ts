/**
 * Recomendaciones y flujos conversacionales (LAU-105). Una regla se define una
 * vez en la cuenta y se vincula con productos, preguntas u opciones:
 *
 * - Disparador: una consulta del cliente (una necesidad descrita por el dueño,
 *   con ejemplos), un paso del pedido (una pregunta de LAU-100 y, si hace
 *   falta, las opciones que la activan) o una duda mientras se responde una
 *   pregunta del pedido (le pregunta la tela y cuenta que tiene mascotas: el
 *   asistente le recomienda una de las opciones de esa pregunta).
 * - Alcance: todo el catálogo o los productos vinculados.
 * - Acción: responder, hacer una pregunta, recomendar productos u opciones del
 *   catálogo o continuar con otra pregunta del pedido.
 * - Requisito: un dato que cambia la recomendación; si falta, se pregunta.
 * - Excepciones por producto: quitan candidatos o suman una nota.
 *
 * El modelo decide si el mensaje del cliente se parece a una necesidad (eso es
 * lenguaje natural), pero lo demás se resuelve acá: qué regla gana si
 * coinciden varias, si aplica al producto y al paso, si falta el dato, qué
 * candidatos están disponibles y con qué propiedades se explica. Ningún precio
 * sale de acá: el asistente los toma del catálogo.
 *
 * Las propiedades (nombre y valor) son de un producto o de una opción, y se
 * comparten entre reglas: un dato de una opción nunca se le atribuye al
 * producto entero.
 */
import { normalizarTexto } from './catalogo.rules.js';
import type { PreguntaPedido } from './preguntas-pedido.rules.js';

export const MAX_RECOMENDACIONES = 40;
export const MAX_EJEMPLOS = 8;
export const MAX_PRODUCTOS_POR_RECOMENDACION = 500;
export const MAX_CANDIDATOS = 50;
export const MAX_EXCEPCIONES = 50;
export const MAX_ELEMENTOS_CON_PROPIEDADES = 500;
export const MAX_PROPIEDADES_POR_ELEMENTO = 12;
/** Cuántas reglas puede proponer el modelo en una consulta. */
export const MAX_REGLAS_POR_CONSULTA = 10;
export const LARGOS_RECOMENDACION = {
  nombre: 60,
  necesidad: 240,
  ejemplo: 120,
  texto: 500,
  pregunta: 160,
  dato: 100,
  criterio: 240,
  nota: 240,
  propiedadNombre: 40,
  propiedadValor: 120,
  respuesta: 120,
} as const;

const PATRON_ID = /^[A-Za-z0-9_-]{1,40}$/;

export const SIN_COINCIDENCIA = ['catalogo', 'derivar'] as const;
export type SinCoincidencia = (typeof SIN_COINCIDENCIA)[number];
export const ALCANCES_RECOMENDACION = ['global', 'producto'] as const;
export type AlcanceRecomendacion = (typeof ALCANCES_RECOMENDACION)[number];
export const SI_NO_CUMPLE = ['explicar', 'derivar'] as const;
export type SiNoCumple = (typeof SI_NO_CUMPLE)[number];
export const ESTADOS_REQUISITO = ['cumple', 'no_cumple', 'no_se'] as const;
export type EstadoRequisito = (typeof ESTADOS_REQUISITO)[number];

export type Disparador =
  | { tipo: 'consulta'; necesidad: string; ejemplos: string[] }
  /** `opciones` vacío: cualquier respuesta de la pregunta la activa. */
  | { tipo: 'paso'; preguntaId: string; opciones: string[] }
  /** Mientras le hace `preguntaId`, el cliente cuenta una necesidad en vez de elegir una opción. */
  | { tipo: 'pregunta'; preguntaId: string; necesidad: string; ejemplos: string[] };

export type Accion =
  | { tipo: 'responder'; texto: string }
  | { tipo: 'preguntar'; pregunta: string }
  | {
      tipo: 'recomendar';
      /** Productos que puede recomendar. */
      productos: string[];
      /** Opciones de una pregunta que puede recomendar; `opcionIds` vacío = todas. */
      opciones: { preguntaId: string; opcionIds: string[] } | null;
      /** En qué casos aplica cada uno, en palabras del dueño. */
      criterio: string | null;
    }
  | { tipo: 'continuar'; preguntaId: string };

export type Requisito = { dato: string; pregunta: string; siNoCumple: SiNoCumple };

export type Excepcion = {
  productoId: string;
  excluirProductos: string[];
  excluirOpciones: string[];
  nota: string | null;
};

export type Recomendacion = {
  id: string;
  nombre: string;
  activa: boolean;
  disparador: Disparador;
  alcance: AlcanceRecomendacion;
  /** Ids de productos; vacío en las globales. */
  productos: string[];
  accion: Accion;
  requisito: Requisito | null;
  /** Si el cliente estaba armando un pedido, después de esto se retoma el paso pendiente. */
  retomarPedido: boolean;
  excepciones: Excepcion[];
};

export type Elemento = { tipo: 'producto'; productoId: string } | { tipo: 'opcion'; preguntaId: string; opcionId: string };
export type Propiedad = { nombre: string; valor: string };
export type PropiedadesDeElemento = { elemento: Elemento; propiedades: Propiedad[] };

export type ConfiguracionRecomendaciones = {
  recomendaciones: Recomendacion[];
  propiedades: PropiedadesDeElemento[];
  sinCoincidencia: SinCoincidencia;
};

export const CONFIGURACION_VACIA: ConfiguracionRecomendaciones = { recomendaciones: [], propiedades: [], sinCoincidencia: 'catalogo' };

type Resultado<T> = { valor: T } | { error: string };
type Opciones = { estricto: boolean };
const ESTRICTO: Opciones = { estricto: true };

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function limpiar(texto: string): string {
  return texto.trim().replace(/\s+/g, ' ');
}

function esId(valor: unknown): valor is string {
  return typeof valor === 'string' && PATRON_ID.test(valor);
}

function textoRequerido(valor: unknown, largo: number, lugar: string): Resultado<string> {
  if (typeof valor !== 'string') return { error: `${lugar} no es válido.` };
  const limpio = limpiar(valor);
  if (!limpio) return { error: `${lugar} está vacío.` };
  if (limpio.length > largo) return { error: `${lugar} tiene más de ${largo} caracteres.` };
  return { valor: limpio };
}

function textoOpcional(valor: unknown, largo: number, lugar: string): Resultado<string | null> {
  if (valor === null || valor === undefined) return { valor: null };
  if (typeof valor !== 'string') return { error: `${lugar} no es válido.` };
  const limpio = limpiar(valor);
  if (!limpio) return { valor: null };
  if (limpio.length > largo) return { error: `${lugar} tiene más de ${largo} caracteres.` };
  return { valor: limpio };
}

function idsDeProductos(valor: unknown, tope: number, lugar: string, { estricto }: Opciones): Resultado<string[]> {
  if (valor === null || valor === undefined) return { valor: [] };
  if (!Array.isArray(valor)) return { error: `${lugar} no es válido.` };
  const ids: string[] = [];
  for (const id of valor) {
    if (!esId(id)) return { error: `${lugar} tiene un producto inválido.` };
    if (!ids.includes(id)) ids.push(id);
  }
  if (estricto && ids.length > tope) return { error: `${lugar} puede tener hasta ${tope} productos.` };
  return { valor: ids };
}

/**
 * Ids de opciones de una pregunta. Al guardar, una opción que no existe es un
 * error; lo leído de la base suelta las que el dueño borró después.
 */
function idsDeOpciones(valor: unknown, pregunta: PreguntaPedido, lugar: string, { estricto }: Opciones): Resultado<string[]> {
  if (valor === null || valor === undefined) return { valor: [] };
  if (!Array.isArray(valor)) return { error: `${lugar} no es válido.` };
  const validas = new Set(pregunta.opciones.map((opcion) => opcion.id));
  const ids: string[] = [];
  for (const id of valor) {
    if (!esId(id) || !validas.has(id)) {
      if (estricto) return { error: `${lugar} se refiere a una opción que ya no existe.` };
      continue;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return { valor: ids };
}

/** La pregunta de opciones de LAU-100 a la que apunta una regla, o el motivo. */
function preguntaDeOpciones(id: unknown, preguntas: PreguntaPedido[], lugar: string): Resultado<PreguntaPedido> {
  const pregunta = esId(id) ? preguntas.find((candidata) => candidata.id === id) : undefined;
  if (!pregunta) return { error: `${lugar} se refiere a una pregunta que ya no existe.` };
  if (pregunta.tipo !== 'opciones') return { error: `${lugar} tiene que ser una pregunta con opciones.` };
  return { valor: pregunta };
}

function necesidadYEjemplos(
  crudo: Record<string, unknown>,
  lugar: string,
  opciones: Opciones,
): Resultado<{ necesidad: string; ejemplos: string[] }> {
  const necesidad = textoRequerido(crudo.necesidad, LARGOS_RECOMENDACION.necesidad, `Lo que necesita el cliente en ${lugar.toLowerCase()}`);
  if ('error' in necesidad) return necesidad;
  const ejemplos: string[] = [];
  if (crudo.ejemplos !== null && crudo.ejemplos !== undefined) {
    if (!Array.isArray(crudo.ejemplos)) return { error: `Los ejemplos de ${lugar.toLowerCase()} no son válidos.` };
    for (const ejemplo of crudo.ejemplos) {
      const limpio = textoOpcional(ejemplo, LARGOS_RECOMENDACION.ejemplo, `Un ejemplo de ${lugar.toLowerCase()}`);
      if ('error' in limpio) return limpio;
      if (limpio.valor && !ejemplos.some((otro) => normalizarTexto(otro) === normalizarTexto(limpio.valor as string))) {
        ejemplos.push(limpio.valor);
      }
    }
    if (opciones.estricto && ejemplos.length > MAX_EJEMPLOS) {
      return { error: `${lugar} puede tener hasta ${MAX_EJEMPLOS} ejemplos.` };
    }
  }
  return { valor: { necesidad: necesidad.valor, ejemplos } };
}

function normalizarDisparador(
  crudo: unknown,
  preguntas: PreguntaPedido[],
  lugar: string,
  opciones: Opciones,
): Resultado<Disparador> {
  if (!esObjeto(crudo)) return { error: `${lugar} no dice cuándo se activa.` };
  if (crudo.tipo === 'consulta') {
    const necesidad = necesidadYEjemplos(crudo, lugar, opciones);
    if ('error' in necesidad) return necesidad;
    return { valor: { tipo: 'consulta', ...necesidad.valor } };
  }
  if (crudo.tipo === 'pregunta') {
    const pregunta = preguntaDeOpciones(crudo.preguntaId, preguntas, `La pregunta de ${lugar.toLowerCase()}`);
    if ('error' in pregunta) return pregunta;
    const necesidad = necesidadYEjemplos(crudo, lugar, opciones);
    if ('error' in necesidad) return necesidad;
    return { valor: { tipo: 'pregunta', preguntaId: pregunta.valor.id, ...necesidad.valor } };
  }
  if (crudo.tipo === 'paso') {
    const pregunta = preguntaDeOpciones(crudo.preguntaId, preguntas, `El paso de ${lugar.toLowerCase()}`);
    if ('error' in pregunta) return pregunta;
    const ids = idsDeOpciones(crudo.opciones, pregunta.valor, `Las respuestas que activan ${lugar.toLowerCase()}`, opciones);
    if ('error' in ids) return ids;
    return { valor: { tipo: 'paso', preguntaId: pregunta.valor.id, opciones: ids.valor } };
  }
  return { error: `${lugar} tiene un disparador inválido.` };
}

function normalizarAccion(crudo: unknown, preguntas: PreguntaPedido[], lugar: string, opciones: Opciones): Resultado<Accion> {
  if (!esObjeto(crudo)) return { error: `${lugar} no dice qué hace el asistente.` };
  const de = lugar.toLowerCase();
  switch (crudo.tipo) {
    case 'responder': {
      const texto = textoRequerido(crudo.texto, LARGOS_RECOMENDACION.texto, `La respuesta de ${de}`);
      return 'error' in texto ? texto : { valor: { tipo: 'responder', texto: texto.valor } };
    }
    case 'preguntar': {
      const pregunta = textoRequerido(crudo.pregunta, LARGOS_RECOMENDACION.pregunta, `La pregunta de ${de}`);
      return 'error' in pregunta ? pregunta : { valor: { tipo: 'preguntar', pregunta: pregunta.valor } };
    }
    case 'continuar': {
      const pregunta = preguntas.find((candidata) => esId(crudo.preguntaId) && candidata.id === crudo.preguntaId);
      if (!pregunta) return { error: `El paso con el que sigue ${de} ya no existe.` };
      return { valor: { tipo: 'continuar', preguntaId: pregunta.id } };
    }
    case 'recomendar': {
      const productos = idsDeProductos(crudo.productos, MAX_CANDIDATOS, `Lo que puede recomendar ${de}`, opciones);
      if ('error' in productos) return productos;
      let deOpciones: Extract<Accion, { tipo: 'recomendar' }>['opciones'] = null;
      if (crudo.opciones !== null && crudo.opciones !== undefined) {
        if (!esObjeto(crudo.opciones)) return { error: `Las opciones que recomienda ${de} no son válidas.` };
        const pregunta = preguntaDeOpciones(crudo.opciones.preguntaId, preguntas, `La pregunta de las opciones de ${de}`);
        if ('error' in pregunta) {
          if (opciones.estricto) return pregunta;
        } else {
          const ids = idsDeOpciones(crudo.opciones.opcionIds, pregunta.valor, `Las opciones que recomienda ${de}`, opciones);
          if ('error' in ids) return ids;
          deOpciones = { preguntaId: pregunta.valor.id, opcionIds: ids.valor };
        }
      }
      if (productos.valor.length === 0 && !deOpciones) {
        return { error: `${lugar} tiene que poder recomendar algún producto u opción.` };
      }
      const criterio = textoOpcional(crudo.criterio, LARGOS_RECOMENDACION.criterio, `El criterio de ${de}`);
      if ('error' in criterio) return criterio;
      return { valor: { tipo: 'recomendar', productos: productos.valor, opciones: deOpciones, criterio: criterio.valor } };
    }
    default:
      return { error: `${lugar} tiene una acción inválida.` };
  }
}

function normalizarRequisito(crudo: unknown, lugar: string): Resultado<Requisito | null> {
  if (crudo === null || crudo === undefined) return { valor: null };
  if (!esObjeto(crudo)) return { error: `El dato que necesita ${lugar.toLowerCase()} no es válido.` };
  const dato = textoRequerido(crudo.dato, LARGOS_RECOMENDACION.dato, `El dato que necesita ${lugar.toLowerCase()}`);
  if ('error' in dato) return dato;
  const pregunta = textoRequerido(crudo.pregunta, LARGOS_RECOMENDACION.pregunta, `La pregunta para pedir el dato de ${lugar.toLowerCase()}`);
  if ('error' in pregunta) return pregunta;
  const siNoCumple: SiNoCumple = crudo.siNoCumple === 'derivar' ? 'derivar' : 'explicar';
  return { valor: { dato: dato.valor, pregunta: pregunta.valor, siNoCumple } };
}

function normalizarExcepciones(
  crudas: unknown,
  productosDeLaRegla: string[],
  accion: Accion,
  preguntas: PreguntaPedido[],
  lugar: string,
  opciones: Opciones,
): Resultado<Excepcion[]> {
  if (crudas === null || crudas === undefined) return { valor: [] };
  if (!Array.isArray(crudas)) return { error: `Las excepciones de ${lugar.toLowerCase()} no son válidas.` };
  if (opciones.estricto && crudas.length > MAX_EXCEPCIONES) {
    return { error: `${lugar} puede tener hasta ${MAX_EXCEPCIONES} excepciones.` };
  }
  const preguntaOpciones =
    accion.tipo === 'recomendar' && accion.opciones ? preguntas.find((p) => p.id === accion.opciones?.preguntaId) : undefined;
  const excepciones: Excepcion[] = [];
  for (const cruda of crudas) {
    if (!esObjeto(cruda) || !esId(cruda.productoId)) return { error: `${lugar} tiene una excepción inválida.` };
    if (excepciones.some((otra) => otra.productoId === cruda.productoId)) {
      return { error: `${lugar} tiene dos excepciones para el mismo producto.` };
    }
    if (productosDeLaRegla.length > 0 && !productosDeLaRegla.includes(cruda.productoId)) {
      if (opciones.estricto) return { error: `Una excepción de ${lugar.toLowerCase()} es de un producto que no está vinculado.` };
      continue;
    }
    const excluirProductos = idsDeProductos(cruda.excluirProductos, MAX_CANDIDATOS, `Una excepción de ${lugar.toLowerCase()}`, opciones);
    if ('error' in excluirProductos) return excluirProductos;
    const excluirOpciones = preguntaOpciones
      ? idsDeOpciones(cruda.excluirOpciones, preguntaOpciones, `Una excepción de ${lugar.toLowerCase()}`, opciones)
      : ({ valor: [] } as Resultado<string[]>);
    if ('error' in excluirOpciones) return excluirOpciones;
    const nota = textoOpcional(cruda.nota, LARGOS_RECOMENDACION.nota, `La nota de una excepción de ${lugar.toLowerCase()}`);
    if ('error' in nota) return nota;
    if (excluirProductos.valor.length === 0 && excluirOpciones.valor.length === 0 && !nota.valor) {
      if (opciones.estricto) return { error: `Una excepción de ${lugar.toLowerCase()} no cambia nada: quitá algo o escribí una nota.` };
      continue;
    }
    excepciones.push({
      productoId: cruda.productoId,
      excluirProductos: excluirProductos.valor,
      excluirOpciones: excluirOpciones.valor,
      nota: nota.valor,
    });
  }
  return { valor: excepciones };
}

/** Un paso o una duda cuya pregunta ya no existe, tal como quedó: la regla se pausa y el panel pide arreglarla. */
function rescatarDisparador(crudo: unknown): Disparador | null {
  if (!esObjeto(crudo) || !esId(crudo.preguntaId)) return null;
  if (crudo.tipo === 'paso') return { tipo: 'paso', preguntaId: crudo.preguntaId, opciones: [] };
  if (crudo.tipo === 'pregunta') {
    const necesidad = necesidadYEjemplos(crudo, 'La recomendación', { estricto: false });
    if ('error' in necesidad) return null;
    return { tipo: 'pregunta', preguntaId: crudo.preguntaId, ...necesidad.valor };
  }
  return null;
}

/** Una acción que apunta a una pregunta que ya no existe, o que se quedó sin candidatos. */
function rescatarAccion(crudo: unknown): Accion | null {
  if (!esObjeto(crudo)) return null;
  if (crudo.tipo === 'continuar' && esId(crudo.preguntaId)) return { tipo: 'continuar', preguntaId: crudo.preguntaId };
  if (crudo.tipo === 'recomendar') {
    const productos = Array.isArray(crudo.productos) ? crudo.productos.filter(esId) : [];
    const criterio = typeof crudo.criterio === 'string' ? limpiar(crudo.criterio).slice(0, LARGOS_RECOMENDACION.criterio) || null : null;
    return { tipo: 'recomendar', productos: [...new Set(productos)], opciones: null, criterio };
  }
  return null;
}

function normalizarRecomendacion(
  cruda: unknown,
  indice: number,
  anteriores: Recomendacion[],
  preguntas: PreguntaPedido[],
  opciones: Opciones,
): Resultado<Recomendacion | null> {
  const lugar = `La recomendación ${indice + 1}`;
  if (!esObjeto(cruda)) return { error: `${lugar} no es válida.` };
  if (!esId(cruda.id) || anteriores.some((otra) => otra.id === cruda.id)) return { error: `${lugar} tiene un id inválido.` };
  const nombre = textoRequerido(cruda.nombre, LARGOS_RECOMENDACION.nombre, `El nombre de ${lugar.toLowerCase()}`);
  if ('error' in nombre) return nombre;
  const conNombre = `«${nombre.valor}»`;
  if (opciones.estricto && anteriores.some((otra) => normalizarTexto(otra.nombre) === normalizarTexto(nombre.valor))) {
    return { error: `Ya hay una recomendación llamada ${conNombre}.` };
  }

  let activa = cruda.activa === true;
  let disparador = normalizarDisparador(cruda.disparador, preguntas, conNombre, opciones);
  let accion = normalizarAccion(cruda.accion, preguntas, conNombre, opciones);
  if (opciones.estricto) {
    if ('error' in disparador) return disparador;
    if ('error' in accion) return accion;
  }
  // Lo leído de la base no se pierde porque el dueño borró una pregunta: queda pausada hasta que la arregle.
  if ('error' in disparador) {
    const rescatado = rescatarDisparador(cruda.disparador);
    if (!rescatado) return { valor: null };
    disparador = { valor: rescatado };
    activa = false;
  }
  if ('error' in accion) {
    const rescatada = rescatarAccion(cruda.accion);
    if (!rescatada) return { valor: null };
    accion = { valor: rescatada };
    activa = false;
  }

  if (!(ALCANCES_RECOMENDACION as readonly unknown[]).includes(cruda.alcance)) return { error: `${conNombre} no dice a qué productos aplica.` };
  const alcance = cruda.alcance as AlcanceRecomendacion;
  const productos = alcance === 'producto'
    ? idsDeProductos(cruda.productos, MAX_PRODUCTOS_POR_RECOMENDACION, `Los productos de ${conNombre}`, opciones)
    : ({ valor: [] } as Resultado<string[]>);
  if ('error' in productos) return productos;
  if (alcance === 'producto' && productos.valor.length === 0) {
    if (opciones.estricto) return { error: `${conNombre} tiene que aplicar a algún producto o a todo el catálogo.` };
    activa = false;
  }

  const requisito = normalizarRequisito(cruda.requisito, conNombre);
  if ('error' in requisito) return requisito;
  const excepciones = normalizarExcepciones(cruda.excepciones, productos.valor, accion.valor, preguntas, conNombre, opciones);
  if ('error' in excepciones) return excepciones;

  return {
    valor: {
      id: cruda.id,
      nombre: nombre.valor,
      activa,
      disparador: disparador.valor,
      alcance,
      productos: productos.valor,
      accion: accion.valor,
      requisito: requisito.valor,
      retomarPedido: cruda.retomarPedido !== false,
      excepciones: excepciones.valor,
    },
  };
}

function normalizarElemento(crudo: unknown, preguntas: PreguntaPedido[], opciones: Opciones): Resultado<Elemento | null> {
  if (!esObjeto(crudo)) return { error: 'Hay propiedades de un elemento inválido.' };
  if (crudo.tipo === 'producto' && esId(crudo.productoId)) return { valor: { tipo: 'producto', productoId: crudo.productoId } };
  if (crudo.tipo === 'opcion' && esId(crudo.preguntaId) && esId(crudo.opcionId)) {
    const pregunta = preguntas.find((candidata) => candidata.id === crudo.preguntaId);
    if (!pregunta?.opciones.some((opcion) => opcion.id === crudo.opcionId)) {
      // Una opción borrada se lleva sus propiedades.
      return opciones.estricto ? { error: 'Hay propiedades de una opción que ya no existe.' } : { valor: null };
    }
    return { valor: { tipo: 'opcion', preguntaId: crudo.preguntaId, opcionId: crudo.opcionId } };
  }
  return { error: 'Hay propiedades de un elemento inválido.' };
}

export function claveDeElemento(elemento: Elemento): string {
  return elemento.tipo === 'producto' ? `p:${elemento.productoId}` : `o:${elemento.preguntaId}:${elemento.opcionId}`;
}

function normalizarPropiedades(
  crudas: unknown,
  preguntas: PreguntaPedido[],
  opciones: Opciones,
): Resultado<PropiedadesDeElemento[]> {
  if (crudas === null || crudas === undefined) return { valor: [] };
  if (!Array.isArray(crudas)) return { error: 'Las propiedades no son válidas.' };
  if (opciones.estricto && crudas.length > MAX_ELEMENTOS_CON_PROPIEDADES) {
    return { error: `Podés cargar propiedades en hasta ${MAX_ELEMENTOS_CON_PROPIEDADES} productos u opciones.` };
  }
  const lista: PropiedadesDeElemento[] = [];
  const vistos = new Set<string>();
  for (const cruda of crudas) {
    if (!esObjeto(cruda)) return { error: 'Las propiedades no son válidas.' };
    const elemento = normalizarElemento(cruda.elemento, preguntas, opciones);
    if ('error' in elemento) return elemento;
    if (!elemento.valor) continue;
    const clave = claveDeElemento(elemento.valor);
    if (vistos.has(clave)) return { error: 'Hay dos listas de propiedades para el mismo producto u opción.' };
    vistos.add(clave);
    if (!Array.isArray(cruda.propiedades)) return { error: 'Las propiedades no son válidas.' };
    const propiedades: Propiedad[] = [];
    for (const propiedad of cruda.propiedades) {
      if (!esObjeto(propiedad)) return { error: 'Hay una propiedad inválida.' };
      const nombre = textoOpcional(propiedad.nombre, LARGOS_RECOMENDACION.propiedadNombre, 'El nombre de una propiedad');
      if ('error' in nombre) return nombre;
      const valor = textoOpcional(propiedad.valor, LARGOS_RECOMENDACION.propiedadValor, 'El valor de una propiedad');
      if ('error' in valor) return valor;
      if (!nombre.valor && !valor.valor) continue;
      if (!nombre.valor || !valor.valor) {
        if (opciones.estricto) return { error: 'Cada propiedad necesita nombre y valor.' };
        continue;
      }
      if (propiedades.some((otra) => normalizarTexto(otra.nombre) === normalizarTexto(nombre.valor as string))) {
        if (opciones.estricto) return { error: `La propiedad «${nombre.valor}» está repetida en el mismo elemento.` };
        continue;
      }
      propiedades.push({ nombre: nombre.valor, valor: valor.valor });
    }
    if (opciones.estricto && propiedades.length > MAX_PROPIEDADES_POR_ELEMENTO) {
      return { error: `Cada producto u opción puede tener hasta ${MAX_PROPIEDADES_POR_ELEMENTO} propiedades.` };
    }
    if (propiedades.length > 0) lista.push({ elemento: elemento.valor, propiedades });
  }
  return { valor: lista };
}

/**
 * La configuración del formulario, validada contra las preguntas que tiene hoy
 * la cuenta. `estricto` (al guardar) rechaza referencias rotas y aplica los
 * topes; lo leído de la base suelta lo que ya no existe y pausa una regla
 * que se quedó sin disparador o sin acción.
 */
export function normalizarConfiguracion(
  entrada: unknown,
  preguntas: PreguntaPedido[],
  opciones: Opciones = ESTRICTO,
): { configuracion: ConfiguracionRecomendaciones } | { error: string } {
  if (!esObjeto(entrada)) return { error: 'La configuración no es válida.' };
  const crudas = entrada.recomendaciones ?? [];
  if (!Array.isArray(crudas)) return { error: 'Las recomendaciones no son válidas.' };
  if (opciones.estricto && crudas.length > MAX_RECOMENDACIONES) {
    return { error: `Podés tener hasta ${MAX_RECOMENDACIONES} recomendaciones.` };
  }
  const recomendaciones: Recomendacion[] = [];
  for (const [indice, cruda] of crudas.entries()) {
    const recomendacion = normalizarRecomendacion(cruda, indice, recomendaciones, preguntas, opciones);
    if ('error' in recomendacion) {
      if (opciones.estricto) return recomendacion;
      continue;
    }
    if (recomendacion.valor) recomendaciones.push(recomendacion.valor);
  }
  const propiedades = normalizarPropiedades(entrada.propiedades, preguntas, opciones);
  if ('error' in propiedades) {
    if (opciones.estricto) return propiedades;
  }
  const sinCoincidencia: SinCoincidencia = entrada.sinCoincidencia === 'derivar' ? 'derivar' : 'catalogo';
  return {
    configuracion: {
      recomendaciones,
      propiedades: 'error' in propiedades ? [] : propiedades.valor,
      sinCoincidencia,
    },
  };
}

/** Lo guardado en la base, sin confiar en su forma. */
export function leerConfiguracion(
  guardado: { recomendaciones: unknown; propiedades: unknown; sinCoincidencia: unknown } | null | undefined,
  preguntas: PreguntaPedido[],
): ConfiguracionRecomendaciones {
  if (!guardado) return CONFIGURACION_VACIA;
  const resultado = normalizarConfiguracion(guardado, preguntas, { estricto: false });
  return 'error' in resultado ? CONFIGURACION_VACIA : resultado.configuracion;
}

/** Los productos que nombra la configuración: los que hay que verificar al guardar. */
export function productosUsados(configuracion: ConfiguracionRecomendaciones): string[] {
  const ids = new Set<string>();
  for (const regla of configuracion.recomendaciones) {
    for (const id of regla.productos) ids.add(id);
    if (regla.accion.tipo === 'recomendar') for (const id of regla.accion.productos) ids.add(id);
    for (const excepcion of regla.excepciones) {
      ids.add(excepcion.productoId);
      for (const id of excepcion.excluirProductos) ids.add(id);
    }
  }
  for (const { elemento } of configuracion.propiedades) if (elemento.tipo === 'producto') ids.add(elemento.productoId);
  return [...ids];
}

export function activas(configuracion: ConfiguracionRecomendaciones): Recomendacion[] {
  return configuracion.recomendaciones.filter((regla) => regla.activa);
}

/** Los productos que se nombran al describirle las reglas al modelo. */
export function productosDeAlcance(reglas: Recomendacion[]): string[] {
  return [...new Set(reglas.flatMap((regla) => regla.productos))];
}

function lista(textos: string[]): string {
  return textos.map((texto) => JSON.stringify(texto)).join(' / ');
}

function textoDeOpcion(preguntas: PreguntaPedido[], preguntaId: string, opcionId: string): string | null {
  return preguntas.find((p) => p.id === preguntaId)?.opciones.find((o) => o.id === opcionId)?.texto ?? null;
}

function cuandoSeActiva(disparador: Disparador, preguntas: PreguntaPedido[]): string {
  if (disparador.tipo === 'consulta') {
    return (
      `cuando el cliente cuenta que ${JSON.stringify(disparador.necesidad)}` +
      (disparador.ejemplos.length > 0 ? ` (por ejemplo: ${lista(disparador.ejemplos)})` : '')
    );
  }
  const pregunta = preguntas.find((p) => p.id === disparador.preguntaId);
  if (disparador.tipo === 'pregunta') {
    return (
      `cuando le hacés [pregunta ${disparador.preguntaId}] ${JSON.stringify(pregunta?.texto ?? '')} y el cliente, en vez ` +
      `de elegir una opción (o para que lo ayudes a elegir), cuenta que ${JSON.stringify(disparador.necesidad)}` +
      (disparador.ejemplos.length > 0 ? ` (por ejemplo: ${lista(disparador.ejemplos)})` : '')
    );
  }
  const opciones = disparador.opciones
    .map((id) => textoDeOpcion(preguntas, disparador.preguntaId, id))
    .filter((texto): texto is string => texto !== null);
  return (
    `cuando el cliente responde [pregunta ${disparador.preguntaId}] ${JSON.stringify(pregunta?.texto ?? '')}` +
    (opciones.length > 0 ? ` con ${lista(opciones)}` : '') +
    ' (o cambia esa respuesta)'
  );
}

/**
 * Las reglas activas como las lee el modelo, para el system prompt. Los
 * textos del dueño van con JSON.stringify: son datos, no instrucciones. Sólo
 * dice cuándo se activa cada una: qué hacer lo devuelve consultar_recomendacion.
 */
export function bloqueRecomendaciones(
  configuracion: ConfiguracionRecomendaciones,
  preguntas: PreguntaPedido[],
  nombres: ReadonlyMap<string, string>,
  incluirPausadas = false,
): string {
  const reglas = incluirPausadas ? configuracion.recomendaciones : activas(configuracion);
  if (reglas.length === 0) return '';
  const lineas = reglas.map((regla) => {
    const cuando = cuandoSeActiva(regla.disparador, preguntas);
    const donde =
      regla.alcance === 'global'
        ? 'en todo el catálogo'
        : `con ${regla.productos
            .slice(0, 12)
            .map((id) => `[producto ${id}] ${JSON.stringify(nombres.get(id) ?? 'producto')}`)
            .join(', ')}${regla.productos.length > 12 ? ` y ${regla.productos.length - 12} más` : ''}`;
    return `- [recomendacion ${regla.id}] ${cuando}; aplica ${donde}`;
  });
  const sinNinguna =
    configuracion.sinCoincidencia === 'derivar'
      ? 'Si no aplica ninguna y no podés responder con el catálogo, usá derivar_consulta.'
      : 'Si no aplica ninguna, seguí como siempre con el catálogo.';
  return (
    'Recomendaciones del comercio: si lo que dice el cliente coincide con alguna de estas situaciones (aunque lo diga ' +
    'con otras palabras), llamá a consultar_recomendacion con los ids de todas las que coinciden antes de responder: ' +
    'te dice cuál aplica, qué hacer y con qué datos explicarlo. No recomiendes ni expliques por tu cuenta lo que cubre una ' +
    'recomendación. Si no estás seguro de que sea esa situación, hacele al cliente una pregunta breve para distinguir. Si ' +
    'no queda claro de qué producto habla, preguntale cuál antes. Si al hacerle una pregunta del pedido el cliente te ' +
    'cuenta su situación en vez de elegir (o te pide ayuda para elegir), fijate si coincide con alguna de estas antes de ' +
    'repetirle las opciones. Si pregunta algo a mitad del pedido, respondé y retomá ' +
    `el paso pendiente. ${sinNinguna}\n${lineas.join('\n')}`
  );
}

// ---------------------------------------------------------------------------
// La consulta del asistente.

export type ConsultaRecomendacion = {
  reglaIds: string[];
  /** El producto del que habla el cliente, si hay uno. */
  productoId?: string;
  /** En un paso del pedido: lo que eligió el cliente, tal cual. */
  respuesta?: string;
  /** Si el cliente ya dijo el dato que necesita la regla. */
  requisito?: EstadoRequisito;
  /** En el probador del panel: las pausadas también cuentan, para probarlas antes de activarlas. */
  incluirPausadas?: boolean;
};

/** Lo que el servicio sabe de un producto para recomendarlo. */
export type ProductoParaRecomendar = { id: string; nombre: string; disponible: boolean };

export type CandidatoEvaluado = {
  tipo: 'producto' | 'opcion';
  id: string;
  nombre: string;
  /** La pregunta de la opción, en las opciones. */
  pregunta: string | null;
  disponible: boolean;
  propiedades: Propiedad[];
};

export type ReglaEvaluada = { id: string; nombre: string; aplica: boolean; motivo: string };

export type ResultadoRecomendacion = {
  estado: 'aplicada' | 'falta_dato' | 'no_cumple' | 'ninguna';
  regla: { id: string; nombre: string; accion: Accion['tipo']; activa: boolean } | null;
  requisito: { dato: string; estado: EstadoRequisito } | null;
  candidatos: CandidatoEvaluado[];
  /** Las propiedades del producto del que habla el cliente, si tiene. */
  propiedadesDelProducto: Propiedad[];
  evaluadas: ReglaEvaluada[];
  nota: string | null;
};

type Evaluacion = { regla: Recomendacion; especifica: boolean } | { regla: Recomendacion; motivo: string };

function evaluarRegla(
  regla: Recomendacion,
  consulta: ConsultaRecomendacion,
  preguntas: PreguntaPedido[],
): Evaluacion {
  if (!regla.activa && !consulta.incluirPausadas) return { regla, motivo: 'está pausada' };
  const productoId = consulta.productoId;
  let especifica = false;
  if (regla.alcance === 'producto') {
    if (productoId) {
      if (!regla.productos.includes(productoId)) return { regla, motivo: 'no está vinculada a ese producto' };
      especifica = true;
    } else if (regla.disparador.tipo !== 'consulta') {
      return { regla, motivo: 'falta saber de qué producto es el paso' };
    }
  }
  if (regla.disparador.tipo === 'paso') {
    const disparador = regla.disparador;
    const pregunta = preguntas.find((p) => p.id === disparador.preguntaId);
    const respuesta = consulta.respuesta?.trim();
    if (!pregunta) return { regla, motivo: 'su pregunta ya no existe' };
    if (!respuesta) return { regla, motivo: `falta la respuesta a ${JSON.stringify(pregunta.texto)}` };
    const elegida = pregunta.opciones.find((opcion) => normalizarTexto(opcion.texto) === normalizarTexto(respuesta));
    if (!elegida) return { regla, motivo: `${JSON.stringify(respuesta)} no es una opción de ${JSON.stringify(pregunta.texto)}` };
    if (disparador.opciones.length > 0 && !disparador.opciones.includes(elegida.id)) {
      return { regla, motivo: `no se activa con ${JSON.stringify(elegida.texto)}` };
    }
  }
  if (regla.disparador.tipo === 'pregunta') {
    const preguntaId = regla.disparador.preguntaId;
    if (!preguntas.some((p) => p.id === preguntaId)) return { regla, motivo: 'su pregunta ya no existe' };
  }
  return { regla, especifica };
}

/**
 * Entre las reglas que propuso el modelo, la que aplica: primero las
 * vinculadas al producto del que habla el cliente, después las demás; entre
 * iguales, la que está antes en la lista del dueño.
 */
export function elegirRegla(
  configuracion: ConfiguracionRecomendaciones,
  consulta: ConsultaRecomendacion,
  preguntas: PreguntaPedido[],
): { elegida: Recomendacion | null; evaluadas: ReglaEvaluada[] } {
  const pedidas = new Set(consulta.reglaIds);
  const evaluaciones = configuracion.recomendaciones.filter((regla) => pedidas.has(regla.id)).map((regla) => evaluarRegla(regla, consulta, preguntas));
  const aplican = evaluaciones.filter((evaluacion): evaluacion is { regla: Recomendacion; especifica: boolean } => 'especifica' in evaluacion);
  const elegida = aplican.find((evaluacion) => evaluacion.especifica)?.regla ?? aplican[0]?.regla ?? null;
  const evaluadas: ReglaEvaluada[] = evaluaciones.map((evaluacion) => {
    const base = { id: evaluacion.regla.id, nombre: evaluacion.regla.nombre };
    if ('motivo' in evaluacion) return { ...base, aplica: false, motivo: evaluacion.motivo };
    if (evaluacion.regla === elegida) return { ...base, aplica: true, motivo: evaluacion.especifica ? 'vinculada al producto' : 'coincide' };
    return { ...base, aplica: false, motivo: 'otra regla tiene prioridad' };
  });
  return { elegida, evaluadas };
}

function propiedadesDe(configuracion: ConfiguracionRecomendaciones, elemento: Elemento): Propiedad[] {
  const clave = claveDeElemento(elemento);
  return configuracion.propiedades.find((entrada) => claveDeElemento(entrada.elemento) === clave)?.propiedades ?? [];
}

/** Los candidatos de una regla de recomendar, con la excepción del producto aplicada. */
function candidatosDe(
  regla: Recomendacion,
  accion: Extract<Accion, { tipo: 'recomendar' }>,
  configuracion: ConfiguracionRecomendaciones,
  preguntas: PreguntaPedido[],
  productos: ReadonlyMap<string, ProductoParaRecomendar>,
  excepcion: Excepcion | undefined,
): CandidatoEvaluado[] {
  const candidatos: CandidatoEvaluado[] = [];
  for (const id of accion.productos) {
    if (excepcion?.excluirProductos.includes(id)) continue;
    const producto = productos.get(id);
    // Un producto borrado del catálogo no se ofrece ni se nombra.
    if (!producto) continue;
    candidatos.push({
      tipo: 'producto',
      id,
      nombre: producto.nombre,
      pregunta: null,
      disponible: producto.disponible,
      propiedades: propiedadesDe(configuracion, { tipo: 'producto', productoId: id }),
    });
  }
  if (accion.opciones) {
    const { preguntaId, opcionIds } = accion.opciones;
    const pregunta = preguntas.find((p) => p.id === preguntaId);
    for (const opcion of pregunta?.opciones ?? []) {
      if (opcionIds.length > 0 && !opcionIds.includes(opcion.id)) continue;
      if (excepcion?.excluirOpciones.includes(opcion.id)) continue;
      candidatos.push({
        tipo: 'opcion',
        id: opcion.id,
        nombre: opcion.texto,
        pregunta: pregunta?.texto ?? null,
        disponible: true,
        propiedades: propiedadesDe(configuracion, { tipo: 'opcion', preguntaId, opcionId: opcion.id }),
      });
    }
  }
  return candidatos;
}

/**
 * Resuelve una consulta del asistente: qué regla aplica, si falta el dato que
 * la cambia y qué candidatos disponibles puede recomendar con sus propiedades.
 * `productos` trae los del catálogo de la cuenta que nombra la regla.
 */
export function resolverRecomendacion(
  configuracion: ConfiguracionRecomendaciones,
  consulta: ConsultaRecomendacion,
  preguntas: PreguntaPedido[],
  productos: ReadonlyMap<string, ProductoParaRecomendar>,
): ResultadoRecomendacion {
  const { elegida, evaluadas } = elegirRegla(configuracion, consulta, preguntas);
  const propiedadesDelProducto = consulta.productoId
    ? propiedadesDe(configuracion, { tipo: 'producto', productoId: consulta.productoId })
    : [];
  const base = { candidatos: [], propiedadesDelProducto, evaluadas, nota: null };
  if (!elegida) return { ...base, estado: 'ninguna', regla: null, requisito: null };

  const regla = { id: elegida.id, nombre: elegida.nombre, accion: elegida.accion.tipo, activa: elegida.activa };
  const excepcion = consulta.productoId ? elegida.excepciones.find((e) => e.productoId === consulta.productoId) : undefined;
  const nota = excepcion?.nota ?? null;
  if (elegida.requisito) {
    const estado = consulta.requisito ?? 'no_se';
    const requisito = { dato: elegida.requisito.dato, estado };
    if (estado === 'no_se') return { ...base, estado: 'falta_dato', regla, requisito, nota };
    if (estado === 'no_cumple') return { ...base, estado: 'no_cumple', regla, requisito, nota };
  }
  const candidatos =
    elegida.accion.tipo === 'recomendar'
      ? candidatosDe(elegida, elegida.accion, configuracion, preguntas, productos, excepcion)
      : [];
  return {
    ...base,
    estado: 'aplicada',
    regla,
    requisito: elegida.requisito ? { dato: elegida.requisito.dato, estado: 'cumple' } : null,
    candidatos,
    nota,
  };
}

function lineaDePropiedades(propiedades: Propiedad[]): string {
  return propiedades.map((p) => `${JSON.stringify(p.nombre)}: ${JSON.stringify(p.valor)}`).join('; ');
}

/** Lo que vuelve al modelo después de consultar_recomendacion. */
export function textoParaElModelo(
  resultado: ResultadoRecomendacion,
  configuracion: ConfiguracionRecomendaciones,
  preguntas: PreguntaPedido[],
): string {
  if (!resultado.regla) {
    const motivos = resultado.evaluadas.map((r) => `${JSON.stringify(r.nombre)}: ${r.motivo}`).join('; ');
    const seguir =
      configuracion.sinCoincidencia === 'derivar'
        ? 'Si no podés responderle con el catálogo, usá derivar_consulta.'
        : 'Seguí como siempre: respondé con lo que dice el catálogo.';
    return `No aplica ninguna recomendación${motivos ? ` (${motivos})` : ''}. ${seguir}`;
  }
  const regla = configuracion.recomendaciones.find((r) => r.id === resultado.regla?.id);
  if (!regla) return 'No aplica ninguna recomendación. Seguí como siempre.';
  const partes: string[] = [`Aplica la recomendación ${JSON.stringify(regla.nombre)}.`];
  if (resultado.nota) partes.push(`Para este producto el negocio aclara: ${JSON.stringify(resultado.nota)}.`);

  if (resultado.estado === 'falta_dato' && regla.requisito) {
    partes.push(
      `Antes necesitás saber ${JSON.stringify(regla.requisito.dato)}. Preguntale al cliente, con tus palabras: ` +
        `${JSON.stringify(regla.requisito.pregunta)} No le recomiendes nada todavía. Cuando conteste, volvé a llamar a ` +
        'consultar_recomendacion con requisito "cumple" o "no_cumple".',
    );
    return partes.join(' ');
  }
  if (resultado.estado === 'no_cumple' && regla.requisito) {
    partes.push(
      regla.requisito.siNoCumple === 'derivar'
        ? `El cliente no cumple ${JSON.stringify(regla.requisito.dato)}: no le recomiendes nada de esta regla y usá derivar_consulta para que le responda el negocio.`
        : `El cliente no cumple ${JSON.stringify(regla.requisito.dato)}: explicale con amabilidad que lo que tenés para esto lo necesita y no se lo recomiendes.`,
    );
    return partes.join(' ');
  }

  const accion = regla.accion;
  switch (accion.tipo) {
    case 'responder':
      partes.push(`Respondele esto, con tus palabras y sin agregar datos: ${JSON.stringify(accion.texto)}`);
      break;
    case 'preguntar':
      partes.push(`Hacele esta pregunta, con tus palabras: ${JSON.stringify(accion.pregunta)}`);
      break;
    case 'continuar': {
      const pregunta = preguntas.find((p) => p.id === accion.preguntaId);
      partes.push(
        pregunta
          ? `Seguí con [pregunta ${pregunta.id}] ${JSON.stringify(pregunta.texto)}` +
              (pregunta.opciones.length > 0 ? ` (opciones: ${lista(pregunta.opciones.map((o) => o.texto))})` : '') +
              '.'
          : 'Seguí con el paso pendiente del pedido.',
      );
      break;
    }
    case 'recomendar': {
      const disponibles = resultado.candidatos.filter((c) => c.disponible);
      const sinStock = resultado.candidatos.filter((c) => !c.disponible);
      if (disponibles.length === 0) {
        partes.push(
          'Ahora no hay nada disponible para recomendarle en este caso: decíselo y ofrecele seguir con otra cosa del ' +
            'catálogo. No inventes alternativas.',
        );
        break;
      }
      partes.push(
        'Recomendale sólo entre estos (están disponibles)' +
          (accion.criterio ? `, según este criterio del negocio: ${JSON.stringify(accion.criterio)}` : '') +
          ':\n' +
          disponibles
            .map((c) => {
              const quien =
                c.tipo === 'producto'
                  ? `[producto ${c.id}] ${JSON.stringify(c.nombre)}`
                  : `la opción ${JSON.stringify(c.nombre)} de ${JSON.stringify(c.pregunta ?? '')}`;
              return `- ${quien}${c.propiedades.length > 0 ? ` — propiedades: ${lineaDePropiedades(c.propiedades)}` : ' — sin propiedades cargadas'}`;
            })
            .join('\n'),
      );
      partes.push(
        'Explicale en una o dos frases por qué le sirve, usando sólo esas propiedades y atribuyendo cada una al producto ' +
          'u opción que la tiene. Si no tienen propiedades, recomendalo sin inventar motivos. Precio y stock, sólo los ' +
          'del catálogo (buscar_productos).',
      );
      if (sinStock.length > 0) {
        partes.push(`No recomiendes ${lista(sinStock.map((c) => c.nombre))}: no hay stock.`);
      }
      break;
    }
  }
  if (resultado.propiedadesDelProducto.length > 0) {
    partes.push(`Del producto del que habla el cliente: ${lineaDePropiedades(resultado.propiedadesDelProducto)}.`);
  }
  if (regla.retomarPedido) {
    partes.push('Si el cliente estaba armando un pedido, después de responder retomá el paso pendiente.');
  }
  if (regla.disparador.tipo === 'paso') {
    partes.push('Si el cliente cambia esa respuesta, volvé a consultar con la nueva.');
  }
  if (regla.disparador.tipo === 'pregunta') {
    const preguntaId = regla.disparador.preguntaId;
    const pregunta = preguntas.find((p) => p.id === preguntaId);
    if (pregunta) {
      partes.push(
        `Esto surge mientras le hacés [pregunta ${pregunta.id}] ${JSON.stringify(pregunta.texto)}: esa pregunta sigue ` +
          'pendiente. Después de recomendar, preguntale si quiere esa opción (o cuál, si le recomendaste más de una) y ' +
          'tomá lo que elija como su respuesta. No la des por respondida hasta que elija.',
      );
    }
  }
  return partes.join('\n');
}
