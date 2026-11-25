/**
 * Preguntas del pedido (LAU-100): lo que el asistente le pregunta al cliente
 * mientras arma el pedido. Son de la cuenta, en un solo orden:
 *
 * - `global`: una vez por pedido, tenga los productos que tenga.
 * - `producto`: una vez por cada producto del pedido que la tenga.
 *
 * Una pregunta de opciones puede depender de otra anterior (`dependeDe`): sólo
 * se hace si el cliente eligió ahí una opción (o una de `siRespuestas`) y cada
 * opción puede valer sólo para algunas de las opciones de la anterior
 * (`soloSi`). Así "¿Qué color?" ofrece Verde y Rojo para Lino y otros para
 * Pana. La dependiente hereda el alcance y los productos de la anterior.
 *
 * Las respuestas de opciones quedan copiadas en el pedido (ItemVenta.respuestas
 * las de producto, Venta.respuestas las globales). Lo que no es una opción —el
 * texto libre o un pedido especial ("Otro")— queda como nota del pedido
 * (Venta.notas), con su contexto, y nunca se toma como una opción del catálogo.
 * Ninguna respuesta cambia el precio.
 *
 * Se guardan en ConfiguracionPreguntas.preguntas; las imágenes, en
 * ImagenPregunta, referidas por id.
 */
import { normalizarTexto } from './catalogo.rules.js';
import { pideDocumentoEnTexto } from './datos-cliente.rules.js';

export const MAX_PREGUNTAS = 40;
export const MAX_OPCIONES_POR_RAMA = 12;
export const MAX_OPCIONES_TOTAL = 60;
export const MAX_PRODUCTOS_POR_PREGUNTA = 500;
export const LARGOS_PREGUNTA = { texto: 120, opcion: 40, respuesta: 200, ayuda: 120, etiqueta: 40 } as const;
export const ETIQUETA_OTRA_POR_DEFECTO = 'Otro';

/** Ids de preguntas y opciones: los arma la web; sólo tienen que ser únicos en la cuenta y en la pregunta. */
const PATRON_ID = /^[A-Za-z0-9_-]{1,40}$/;

export const TIPOS_PREGUNTA = ['opciones', 'texto'] as const;
export type TipoPregunta = (typeof TIPOS_PREGUNTA)[number];
export const ALCANCES_PREGUNTA = ['global', 'producto'] as const;
export type AlcancePregunta = (typeof ALCANCES_PREGUNTA)[number];

export type OpcionPregunta = {
  id: string;
  texto: string;
  imagenId: string | null;
  /** Ids de opciones de la pregunta de la que depende: vale sólo si eligió una de esas. Vacío = siempre. */
  soloSi: string[];
};

export type PreguntaPedido = {
  id: string;
  texto: string;
  tipo: TipoPregunta;
  obligatoria: boolean;
  alcance: AlcancePregunta;
  /** Ids de productos; vacío en las globales. */
  productos: string[];
  imagenId: string | null;
  /** Sólo en las de texto libre: una pista para el cliente ("medidas, dedicatoria…"). */
  ayuda: string | null;
  /** Se hace sólo si en `preguntaId` (anterior y de opciones) eligió una opción; con `siRespuestas`, una de esas. */
  dependeDe: { preguntaId: string; siRespuestas: string[] } | null;
  /** Vacío en las de texto libre. */
  opciones: OpcionPregunta[];
  /** Acepta un pedido especial fuera de las opciones; `etiqueta` es como se le ofrece ("Personalizar"). */
  otra: { etiqueta: string } | null;
};

/** Una respuesta de opciones copiada al pedido: la pregunta y la opción, con el texto del dueño. */
export type RespuestaGuardada = { pregunta: string; respuesta: string };

/** Lo que va a las notas del pedido: una respuesta libre o un pedido especial, con lo que había elegido antes. */
export type NotaPedido = {
  tipo: 'texto' | 'otra';
  pregunta: string;
  respuesta: string;
  /** El producto al que responde; null en las globales. */
  producto: string | null;
  /** Las respuestas anteriores de las que dependía (Tela: Lino). */
  contexto: RespuestaGuardada[];
};

/** Lo que manda el modelo: la pregunta por su id, el producto si es de producto, y lo que dijo el cliente. */
export type RespuestaDelModelo = { preguntaId: string; productoId?: string; respuesta: string };

type Resultado<T> = { valor: T } | { error: string };

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Espacios colapsados y sin bordes: como se guarda y se compara un texto del dueño. */
function limpiar(texto: string): string {
  return texto.trim().replace(/\s+/g, ' ');
}

function esId(valor: unknown): valor is string {
  return typeof valor === 'string' && PATRON_ID.test(valor);
}

/** Un texto opcional del dueño: null si viene vacío, error si pasa el largo. */
function textoOpcional(valor: unknown, largo: number, lugar: string): Resultado<string | null> {
  if (valor === null || valor === undefined) return { valor: null };
  if (typeof valor !== 'string') return { error: `${lugar} no es válido.` };
  const limpio = limpiar(valor);
  if (!limpio) return { valor: null };
  if (limpio.length > largo) return { error: `${lugar} tiene más de ${largo} caracteres.` };
  return { valor: limpio };
}

function idsDe(valor: unknown, validos: ReadonlySet<string>, lugar: string): Resultado<string[]> {
  if (valor === null || valor === undefined) return { valor: [] };
  if (!Array.isArray(valor)) return { error: `${lugar} no es válido.` };
  const ids: string[] = [];
  for (const id of valor) {
    if (!esId(id) || !validos.has(id)) return { error: `${lugar} se refiere a una opción que ya no existe.` };
    if (!ids.includes(id)) ids.push(id);
  }
  return { valor: ids };
}

type Opciones = { estricto: boolean };

function normalizarOpciones(
  crudas: unknown,
  lugar: string,
  padre: PreguntaPedido | null,
  { estricto }: Opciones,
): Resultado<OpcionPregunta[]> {
  if (!Array.isArray(crudas)) return { error: `${lugar} necesita opciones.` };
  const deLaAnterior = new Set(padre?.opciones.map((opcion) => opcion.id) ?? []);
  const opciones: OpcionPregunta[] = [];
  const ids = new Set<string>();
  for (const cruda of crudas) {
    if (!esObjeto(cruda) || typeof cruda.texto !== 'string') return { error: `${lugar} tiene una opción inválida.` };
    const texto = limpiar(cruda.texto);
    if (!texto) continue;
    if (texto.length > LARGOS_PREGUNTA.opcion) {
      return { error: `Una opción de ${lugar.toLowerCase()} tiene más de ${LARGOS_PREGUNTA.opcion} caracteres.` };
    }
    if (!esId(cruda.id) || ids.has(cruda.id)) return { error: `${lugar} tiene una opción con un id inválido.` };
    ids.add(cruda.id);
    if (cruda.imagenId !== null && cruda.imagenId !== undefined && !esId(cruda.imagenId)) {
      return { error: `La imagen de una opción de ${lugar.toLowerCase()} no es válida.` };
    }
    let soloSi: string[] = [];
    if (padre) {
      const ramas = idsDe(cruda.soloSi, deLaAnterior, `La opción ${JSON.stringify(texto)} de ${lugar.toLowerCase()}`);
      if ('error' in ramas) return ramas;
      soloSi = ramas.valor;
    } else if (Array.isArray(cruda.soloSi) && cruda.soloSi.length > 0) {
      return { error: `${lugar} no depende de otra pregunta: sus opciones valen siempre.` };
    }
    opciones.push({ id: cruda.id, texto, imagenId: esId(cruda.imagenId) ? cruda.imagenId : null, soloSi });
  }
  if (opciones.length === 0) return { error: `${lugar} necesita al menos una opción.` };
  if (estricto && opciones.length > MAX_OPCIONES_TOTAL) {
    return { error: `${lugar} puede tener hasta ${MAX_OPCIONES_TOTAL} opciones en total.` };
  }
  // En cada rama (cada opción de la anterior, o la única si no depende) no se repiten ni pasan del tope.
  const ramas: Array<string | null> = padre ? padre.opciones.map((opcion) => opcion.id) : [null];
  for (const rama of ramas) {
    const visibles = opcionesDeRama(opciones, rama);
    const vistas = new Set<string>();
    for (const opcion of visibles) {
      const clave = normalizarTexto(opcion.texto);
      if (vistas.has(clave)) return { error: `${lugar} tiene una opción repetida: ${opcion.texto}.` };
      vistas.add(clave);
    }
    if (estricto && visibles.length > MAX_OPCIONES_POR_RAMA) {
      return { error: `${lugar} puede ofrecer hasta ${MAX_OPCIONES_POR_RAMA} opciones a la vez.` };
    }
  }
  return { valor: opciones };
}

function normalizarPregunta(
  cruda: unknown,
  indice: number,
  anteriores: PreguntaPedido[],
  opciones: Opciones,
): Resultado<PreguntaPedido> {
  const lugar = `La pregunta ${indice + 1}`;
  if (!esObjeto(cruda) || typeof cruda.texto !== 'string') return { error: `${lugar} no es válida.` };
  if (!esId(cruda.id) || anteriores.some((otra) => otra.id === cruda.id)) return { error: `${lugar} tiene un id inválido.` };
  const texto = limpiar(cruda.texto);
  if (!texto) return { error: `${lugar} está vacía.` };
  if (texto.length > LARGOS_PREGUNTA.texto) return { error: `${lugar} tiene más de ${LARGOS_PREGUNTA.texto} caracteres.` };
  if (pideDocumentoEnTexto(texto) || (typeof cruda.ayuda === 'string' && pideDocumentoEnTexto(cruda.ayuda))) {
    return { error: `${lugar} pide un documento de identidad: el asistente no puede pedir el DNI ni similares.` };
  }
  if (!(TIPOS_PREGUNTA as readonly unknown[]).includes(cruda.tipo)) return { error: `${lugar} tiene un tipo inválido.` };
  const tipo = cruda.tipo as TipoPregunta;
  if (cruda.imagenId !== null && cruda.imagenId !== undefined && !esId(cruda.imagenId)) {
    return { error: `La imagen de ${lugar.toLowerCase()} no es válida.` };
  }

  let dependeDe: PreguntaPedido['dependeDe'] = null;
  let padre: PreguntaPedido | null = null;
  const depende = cruda.dependeDe;
  if (depende !== null && depende !== undefined) {
    if (!esObjeto(depende)) return { error: `${lugar} depende de una pregunta inválida.` };
    padre = anteriores.find((otra) => otra.id === depende.preguntaId) ?? null;
    if (!padre) return { error: `${lugar} sólo puede depender de una pregunta que esté antes en la lista.` };
    if (padre.tipo !== 'opciones') return { error: `${lugar} sólo puede depender de una pregunta con opciones.` };
    const si = idsDe(depende.siRespuestas, new Set(padre.opciones.map((opcion) => opcion.id)), lugar);
    if ('error' in si) return si;
    dependeDe = { preguntaId: padre.id, siRespuestas: si.valor };
  }

  // La dependiente se hace en los mismos pedidos que la anterior.
  let alcance: AlcancePregunta;
  let productos: string[];
  if (padre) {
    alcance = padre.alcance;
    productos = [...padre.productos];
  } else {
    if (!(ALCANCES_PREGUNTA as readonly unknown[]).includes(cruda.alcance)) return { error: `${lugar} no dice a qué pedidos aplica.` };
    alcance = cruda.alcance as AlcancePregunta;
    productos = [];
    if (alcance === 'producto') {
      if (!Array.isArray(cruda.productos)) return { error: `${lugar} no dice a qué productos aplica.` };
      for (const id of cruda.productos) {
        if (!esId(id)) return { error: `${lugar} tiene un producto inválido.` };
        if (!productos.includes(id)) productos.push(id);
      }
      if (productos.length === 0) return { error: `${lugar} tiene que aplicar a algún producto.` };
      if (opciones.estricto && productos.length > MAX_PRODUCTOS_POR_PREGUNTA) {
        return { error: `${lugar} puede aplicar a hasta ${MAX_PRODUCTOS_POR_PREGUNTA} productos.` };
      }
    }
  }

  const base = {
    id: cruda.id,
    texto,
    tipo,
    obligatoria: cruda.obligatoria === true,
    alcance,
    productos,
    imagenId: esId(cruda.imagenId) ? cruda.imagenId : null,
    dependeDe,
  };
  if (tipo === 'texto') {
    const ayuda = textoOpcional(cruda.ayuda, LARGOS_PREGUNTA.ayuda, `La ayuda de ${lugar.toLowerCase()}`);
    if ('error' in ayuda) return ayuda;
    return { valor: { ...base, ayuda: ayuda.valor, opciones: [], otra: null } };
  }
  const lista = normalizarOpciones(cruda.opciones, lugar, padre, opciones);
  if ('error' in lista) return lista;
  let otra: PreguntaPedido['otra'] = null;
  if (cruda.otra !== null && cruda.otra !== undefined) {
    const etiqueta = textoOpcional(
      esObjeto(cruda.otra) ? cruda.otra.etiqueta : null,
      LARGOS_PREGUNTA.etiqueta,
      `El nombre de la opción "otra" de ${lugar.toLowerCase()}`,
    );
    if ('error' in etiqueta) return etiqueta;
    otra = { etiqueta: etiqueta.valor ?? ETIQUETA_OTRA_POR_DEFECTO };
  }
  return { valor: { ...base, ayuda: null, opciones: lista.valor, otra } };
}

/** ¿Es una pregunta guardada que pide un documento, o depende de una que se omitió por eso? */
function pidePapeles(cruda: Record<string, unknown>, omitidas: Set<string>): boolean {
  const depende = cruda.dependeDe;
  if (esObjeto(depende) && typeof depende.preguntaId === 'string' && omitidas.has(depende.preguntaId)) return true;
  return (
    (typeof cruda.texto === 'string' && pideDocumentoEnTexto(cruda.texto)) ||
    (typeof cruda.ayuda === 'string' && pideDocumentoEnTexto(cruda.ayuda))
  );
}

/**
 * Las preguntas del formulario, validadas y en orden. `estricto` (al guardar)
 * aplica además los topes de cantidad; lo leído de la base se acepta aunque
 * pase un tope que cambió después.
 */
export function normalizarPreguntas(
  entrada: unknown,
  opciones: Opciones = { estricto: true },
): { preguntas: PreguntaPedido[] } | { error: string } {
  if (entrada === null || entrada === undefined) return { preguntas: [] };
  if (!Array.isArray(entrada)) return { error: 'Las preguntas no son válidas.' };
  if (opciones.estricto && entrada.length > MAX_PREGUNTAS) {
    return { error: `Podés tener hasta ${MAX_PREGUNTAS} preguntas.` };
  }
  const preguntas: PreguntaPedido[] = [];
  // Lo guardado antes de LAU-106 puede tener una pregunta que pide el DNI: al leerla se
  // saca (y las que dependen de ella), así no traba el pedido ni se le hace al cliente.
  const omitidas = new Set<string>();
  for (const [indice, cruda] of entrada.entries()) {
    if (!opciones.estricto && esObjeto(cruda) && pidePapeles(cruda, omitidas)) {
      if (typeof cruda.id === 'string') omitidas.add(cruda.id);
      continue;
    }
    const pregunta = normalizarPregunta(cruda, indice, preguntas, opciones);
    if ('error' in pregunta) return pregunta;
    preguntas.push(pregunta.valor);
  }
  return { preguntas };
}

/** Lo guardado en la base, sin confiar en su forma ([] si no hay o está dañado). */
export function leerPreguntas(guardado: unknown): PreguntaPedido[] {
  const resultado = normalizarPreguntas(guardado, { estricto: false });
  return 'error' in resultado ? [] : resultado.preguntas;
}

/** Las imágenes que usan las preguntas: las que hay que verificar al guardar y las que no se pueden borrar. */
export function imagenesUsadas(preguntas: PreguntaPedido[]): string[] {
  const ids = new Set<string>();
  for (const pregunta of preguntas) {
    if (pregunta.imagenId) ids.add(pregunta.imagenId);
    for (const opcion of pregunta.opciones) if (opcion.imagenId) ids.add(opcion.imagenId);
  }
  return [...ids];
}

export function productosUsados(preguntas: PreguntaPedido[]): string[] {
  return [...new Set(preguntas.flatMap((pregunta) => pregunta.productos))];
}

/** Las preguntas que se le hacen a un producto, o las globales con `null`, en el orden de la cuenta. */
export function preguntasDe(preguntas: PreguntaPedido[], productoId: string | null): PreguntaPedido[] {
  return preguntas.filter((pregunta) =>
    productoId === null ? pregunta.alcance === 'global' : pregunta.alcance === 'producto' && pregunta.productos.includes(productoId),
  );
}

/** Las opciones que se ofrecen cuando en la anterior eligió `rama` (null: la pregunta no depende de otra). */
export function opcionesDeRama(opciones: OpcionPregunta[], rama: string | null): OpcionPregunta[] {
  return opciones.filter((opcion) => opcion.soloSi.length === 0 || (rama !== null && opcion.soloSi.includes(rama)));
}

/** Palabras que identifican una pregunta (sin acentos ni signos), para reconocerla aunque el modelo la reformule. */
function palabrasDe(texto: string): string[] {
  return normalizarTexto(texto)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((palabra) => palabra.length >= 3);
}

/** Si alguno de los mensajes del asistente ya hizo esa pregunta (con sus palabras o muy parecidas). */
export function yaSeHizo(pregunta: PreguntaPedido, mensajesDelAsistente: string[]): boolean {
  const clave = palabrasDe(pregunta.texto);
  if (clave.length === 0) return true;
  return mensajesDelAsistente.some((mensaje) => {
    const dichas = new Set(palabrasDe(mensaje));
    return clave.filter((palabra) => dichas.has(palabra)).length / clave.length >= 0.6;
  });
}

/**
 * Las preguntas de entrada (las que no dependen de otra) que se le tienen que
 * hacer al cliente con estos productos —las globales y las de cada producto— y
 * todavía no se le hicieron ni respondió el modelo. Las dependientes las
 * resuelve `evaluarRespuestas` al crear el pedido.
 */
export function preguntasSinHacer(
  preguntas: PreguntaPedido[],
  productoIds: string[],
  mensajesDelAsistente: string[],
  respondidas: ReadonlySet<string> = new Set(),
): PreguntaPedido[] {
  const aplican = [...preguntasDe(preguntas, null), ...productoIds.flatMap((id) => preguntasDe(preguntas, id))];
  const vistas = new Set<string>();
  return aplican.filter((pregunta) => {
    if (pregunta.dependeDe || vistas.has(pregunta.id)) return false;
    vistas.add(pregunta.id);
    return !respondidas.has(pregunta.id) && !yaSeHizo(pregunta, mensajesDelAsistente);
  });
}

export function tieneImagenes(pregunta: PreguntaPedido): boolean {
  return pregunta.imagenId !== null || pregunta.opciones.some((opcion) => opcion.imagenId !== null);
}

function lista(textos: string[]): string {
  return textos.map((texto) => JSON.stringify(texto)).join(' / ');
}

/**
 * Una pregunta como la lee el modelo. Los textos del dueño van con
 * JSON.stringify: son datos, no instrucciones.
 */
export function describirPregunta(pregunta: PreguntaPedido, todas: PreguntaPedido[]): string {
  const partes: string[] = [];
  const padre = pregunta.dependeDe ? todas.find((otra) => otra.id === pregunta.dependeDe?.preguntaId) : undefined;
  if (pregunta.dependeDe && padre) {
    const habilitan = padre.opciones.filter(
      (opcion) => pregunta.dependeDe?.siRespuestas.length === 0 || pregunta.dependeDe?.siRespuestas.includes(opcion.id),
    );
    partes.push(
      `hacela sólo después de [pregunta ${padre.id}]` +
        (pregunta.dependeDe.siRespuestas.length > 0
          ? ` y sólo si eligió ${lista(habilitan.map((opcion) => opcion.texto))}`
          : ' (si ahí pidió algo especial, no la hagas)'),
    );
    if (pregunta.tipo === 'opciones') {
      const ramas = habilitan
        .map((opcion) => ({ opcion, visibles: opcionesDeRama(pregunta.opciones, opcion.id) }))
        .filter(({ visibles }) => visibles.length > 0 || pregunta.otra);
      partes.push(
        'las opciones dependen de lo que eligió ahí: ' +
          ramas
            .map(({ opcion, visibles }) => `si ${JSON.stringify(opcion.texto)}: ${visibles.length > 0 ? lista(visibles.map((o) => o.texto)) : 'sólo pedido especial'}`)
            .join('; '),
      );
    }
  } else if (pregunta.tipo === 'opciones') {
    partes.push(`opciones: ${lista(pregunta.opciones.map((opcion) => opcion.texto))}`);
  }
  if (pregunta.tipo === 'texto') {
    partes.push(`respuesta libre${pregunta.ayuda ? ` (ayuda para el cliente: ${JSON.stringify(pregunta.ayuda)})` : ''}`);
  }
  if (pregunta.otra) {
    partes.push(
      `acepta otra cosa: si pide algo que no está en las opciones (o elige ${JSON.stringify(pregunta.otra.etiqueta)} y te ` +
        'lo describe), eso es su respuesta: decile que lo anotás como pedido especial (sin preguntarle si prefiere una ' +
        'de las opciones) y seguí con la próxima pregunta; al crear el pedido mandá lo que pidió, con sus palabras',
    );
  }
  partes.push(pregunta.obligatoria ? 'obligatoria' : 'opcional');
  if (tieneImagenes(pregunta)) partes.push('tiene imágenes: mandalas con enviar_imagenes_pregunta al hacerla');
  return `[pregunta ${pregunta.id}] ${JSON.stringify(pregunta.texto)} (${partes.join('; ')})`;
}

/** Las preguntas de un producto (o las globales) en una línea para el modelo; '' si no hay. */
export function describirPreguntas(preguntas: PreguntaPedido[], todas: PreguntaPedido[]): string {
  return preguntas.map((pregunta) => describirPregunta(pregunta, todas)).join(' · ');
}

type Elegida = { opcionId: string | null; texto: string };

/** Las respuestas anteriores de las que depende una pregunta, de la primera a la última. */
function contextoDe(pregunta: PreguntaPedido, porId: Map<string, PreguntaPedido>, elegidas: Map<string, Elegida>): RespuestaGuardada[] {
  const contexto: RespuestaGuardada[] = [];
  let actual = pregunta.dependeDe ? porId.get(pregunta.dependeDe.preguntaId) : undefined;
  while (actual) {
    const elegida = elegidas.get(actual.id);
    if (elegida) contexto.unshift({ pregunta: actual.texto, respuesta: elegida.texto });
    actual = actual.dependeDe ? porId.get(actual.dependeDe.preguntaId) : undefined;
  }
  return contexto;
}

type EstadoDePregunta = { activa: false } | { activa: true; validas: OpcionPregunta[] };

/** Si la pregunta se hace con lo elegido hasta acá y qué opciones ofrece. */
function estadoDe(pregunta: PreguntaPedido, elegidas: Map<string, Elegida>): EstadoDePregunta {
  let rama: string | null = null;
  if (pregunta.dependeDe) {
    const anterior = elegidas.get(pregunta.dependeDe.preguntaId);
    // Sin una opción elegida en la anterior (no contestó o pidió algo especial) la que depende no se hace.
    if (!anterior || anterior.opcionId === null) return { activa: false };
    const { siRespuestas } = pregunta.dependeDe;
    if (siRespuestas.length > 0 && !siRespuestas.includes(anterior.opcionId)) return { activa: false };
    rama = anterior.opcionId;
  }
  if (pregunta.tipo === 'texto') return { activa: true, validas: [] };
  const validas = opcionesDeRama(pregunta.opciones, rama);
  if (validas.length === 0 && !pregunta.otra) return { activa: false };
  return { activa: true, validas };
}

export type ProductoDelPedido = { id: string; nombre: string };

export type RespuestasEvaluadas = {
  globales: RespuestaGuardada[];
  porProducto: Map<string, RespuestaGuardada[]>;
  notas: NotaPedido[];
};

/**
 * Las respuestas del pedido contra las preguntas que tiene hoy la cuenta.
 * Recorre cada pregunta en orden con lo que el cliente eligió antes: una que
 * depende de una respuesta que cambió ya no se hace (lo que mande el modelo
 * para ella se ignora) y una opción que no es de la rama elegida se rechaza
 * para que el asistente la vuelva a preguntar. Devuelve lo que se guarda o el
 * motivo, listo para el modelo.
 */
export function evaluarRespuestas(
  preguntas: PreguntaPedido[],
  productos: ProductoDelPedido[],
  respuestas: RespuestaDelModelo[],
): RespuestasEvaluadas | { error: string } {
  const porId = new Map(preguntas.map((pregunta) => [pregunta.id, pregunta]));
  // Por contexto ('' = el pedido; si no, el id del producto) y por pregunta.
  const dadas = new Map<string, Map<string, string>>();
  for (const respuesta of respuestas) {
    const pregunta = porId.get(respuesta.preguntaId);
    if (!pregunta) {
      return { error: `No existe la pregunta [pregunta ${respuesta.preguntaId}]. Usá los ids de las preguntas que tenés.` };
    }
    const texto = limpiar(String(respuesta.respuesta ?? ''));
    if (!texto) continue;
    let contexto = '';
    if (pregunta.alcance === 'producto') {
      const aplica = productos.filter((producto) => pregunta.productos.includes(producto.id));
      if (respuesta.productoId) {
        const producto = productos.find((candidato) => candidato.id === respuesta.productoId);
        if (!producto) return { error: 'Mandaste una respuesta de un producto que no está en el pedido.' };
        if (!pregunta.productos.includes(producto.id)) {
          return { error: `${JSON.stringify(pregunta.texto)} no se le pregunta a ${JSON.stringify(producto.nombre)}.` };
        }
        contexto = producto.id;
      } else if (aplica.length === 1) {
        contexto = aplica[0].id;
      } else if (aplica.length === 0) {
        return { error: `${JSON.stringify(pregunta.texto)} no es de ningún producto del pedido: no la mandes.` };
      } else {
        return { error: `${JSON.stringify(pregunta.texto)} es de varios productos del pedido: mandá una respuesta por producto con su productoId.` };
      }
    }
    const delContexto = dadas.get(contexto) ?? new Map<string, string>();
    delContexto.set(pregunta.id, texto);
    dadas.set(contexto, delContexto);
  }

  const evaluadas: RespuestasEvaluadas = { globales: [], porProducto: new Map(), notas: [] };
  const contextos: Array<{ producto: ProductoDelPedido | null }> = [
    { producto: null },
    ...productos.map((producto) => ({ producto })),
  ];
  for (const { producto } of contextos) {
    const deEste = dadas.get(producto?.id ?? '') ?? new Map<string, string>();
    const elegidas = new Map<string, Elegida>();
    const guardadas: RespuestaGuardada[] = [];
    for (const pregunta of preguntasDe(preguntas, producto?.id ?? null)) {
      const estado = estadoDe(pregunta, elegidas);
      if (!estado.activa) continue;
      const texto = deEste.get(pregunta.id);
      const dePara = producto ? ` por ${JSON.stringify(producto.nombre)}` : '';
      if (texto === undefined) {
        if (!pregunta.obligatoria) continue;
        const opciones = estado.validas.length > 0 ? ` (opciones: ${estado.validas.map((opcion) => opcion.texto).join(', ')})` : '';
        return {
          error:
            `Falta preguntarle al cliente ${JSON.stringify(pregunta.texto)}${dePara}${opciones}: es obligatoria. ` +
            'Preguntáselo y volvé a crear el pedido con su respuesta.',
        };
      }
      const muyLarga = {
        error: `La respuesta a ${JSON.stringify(pregunta.texto)} es muy larga (máximo ${LARGOS_PREGUNTA.respuesta} caracteres): resumila.`,
      };
      const nota = (tipo: NotaPedido['tipo']): NotaPedido => ({
        tipo,
        pregunta: pregunta.texto,
        respuesta: texto,
        producto: producto?.nombre ?? null,
        contexto: contextoDe(pregunta, porId, elegidas),
      });
      if (pregunta.tipo === 'texto') {
        if (texto.length > LARGOS_PREGUNTA.respuesta) return muyLarga;
        evaluadas.notas.push(nota('texto'));
        elegidas.set(pregunta.id, { opcionId: null, texto });
        continue;
      }
      const elegida = estado.validas.find((opcion) => normalizarTexto(opcion.texto) === normalizarTexto(texto));
      if (elegida) {
        guardadas.push({ pregunta: pregunta.texto, respuesta: elegida.texto });
        elegidas.set(pregunta.id, { opcionId: elegida.id, texto: elegida.texto });
        continue;
      }
      const anteriores = contextoDe(pregunta, porId, elegidas);
      const segun = anteriores.length > 0 ? ` para ${anteriores.map((anterior) => JSON.stringify(anterior.respuesta)).join(' y ')}` : '';
      // Una opción de otra rama no es un pedido especial: casi siempre quedó de antes de que cambiara la
      // respuesta anterior. Se vuelve a preguntar.
      if (pregunta.opciones.some((opcion) => normalizarTexto(opcion.texto) === normalizarTexto(texto))) {
        return {
          error:
            `${JSON.stringify(texto)} no se ofrece en ${JSON.stringify(pregunta.texto)}${dePara}${segun}. ` +
            `Las opciones son: ${estado.validas.map((opcion) => opcion.texto).join(', ')}. Preguntale al cliente cuál prefiere` +
            (pregunta.otra ? ' o, si igual lo quiere, mandá lo que pide con sus palabras como pedido especial.' : '.'),
        };
      }
      if (pregunta.otra) {
        if (normalizarTexto(texto) === normalizarTexto(pregunta.otra.etiqueta)) {
          return {
            error:
              `En ${JSON.stringify(pregunta.texto)}${dePara} el cliente eligió ${JSON.stringify(pregunta.otra.etiqueta)}: pedile ` +
              'que te cuente qué quiere y mandá eso como respuesta.',
          };
        }
        if (texto.length > LARGOS_PREGUNTA.respuesta) return muyLarga;
        evaluadas.notas.push(nota('otra'));
        elegidas.set(pregunta.id, { opcionId: null, texto });
        continue;
      }
      return {
        error:
          `${JSON.stringify(texto)} no es una opción de ${JSON.stringify(pregunta.texto)}${dePara}${segun}. ` +
          `Las opciones son: ${estado.validas.map((opcion) => opcion.texto).join(', ')}. Preguntale al cliente cuál prefiere.`,
      };
    }
    if (producto) evaluadas.porProducto.set(producto.id, guardadas);
    else evaluadas.globales = guardadas;
  }
  return evaluadas;
}

export type ImagenDePregunta = { imagenId: string; leyenda: string };

/**
 * Las imágenes que salen al hacer una pregunta: la de la pregunta y las de
 * las opciones que se ofrecen en la rama elegida (`segun` es lo que eligió el
 * cliente en la anterior, si la pregunta depende de otra).
 */
export function imagenesDePregunta(
  pregunta: PreguntaPedido,
  todas: PreguntaPedido[],
  segun: string | undefined,
): { imagenes: ImagenDePregunta[] } | { error: string } {
  let rama: string | null = null;
  if (pregunta.dependeDe) {
    const padre = todas.find((otra) => otra.id === pregunta.dependeDe?.preguntaId);
    if (!padre) return { imagenes: [] };
    if (!segun?.trim()) {
      return { error: `Esta pregunta depende de [pregunta ${padre.id}]: mandá en \`segun\` qué eligió ahí el cliente.` };
    }
    const elegida = padre.opciones.find((opcion) => normalizarTexto(opcion.texto) === normalizarTexto(segun));
    if (!elegida) {
      return { error: `${JSON.stringify(segun)} no es una opción de ${JSON.stringify(padre.texto)}: mandá la que eligió, tal cual.` };
    }
    const { siRespuestas } = pregunta.dependeDe;
    if (siRespuestas.length > 0 && !siRespuestas.includes(elegida.id)) {
      return { error: `Con ${JSON.stringify(elegida.texto)} esta pregunta no se hace: seguí con la próxima.` };
    }
    rama = elegida.id;
  }
  const imagenes: ImagenDePregunta[] = [];
  if (pregunta.imagenId) imagenes.push({ imagenId: pregunta.imagenId, leyenda: pregunta.texto });
  for (const opcion of opcionesDeRama(pregunta.opciones, rama)) {
    if (opcion.imagenId) imagenes.push({ imagenId: opcion.imagenId, leyenda: opcion.texto });
  }
  return { imagenes };
}

/** Una nota del pedido en una línea: para el dueño (panel, avisos) y el modelo. */
export function textoDeNota(nota: NotaPedido): string {
  const antes = nota.contexto.map((anterior) => `${anterior.pregunta} ${anterior.respuesta}`).join('; ');
  return (
    (nota.tipo === 'otra' ? `Pedido especial en "${nota.pregunta}": ${nota.respuesta}` : `"${nota.pregunta}": ${nota.respuesta}`) +
    (antes ? ` (${antes})` : '') +
    (nota.producto ? ` · ${nota.producto}` : '')
  );
}

/** Las respuestas guardadas en un pedido o renglón, sin confiar en su forma. */
export function leerRespuestas(guardado: unknown): RespuestaGuardada[] {
  if (!Array.isArray(guardado)) return [];
  return guardado.flatMap((dato) =>
    esObjeto(dato) && typeof dato.pregunta === 'string' && typeof dato.respuesta === 'string'
      ? [{ pregunta: dato.pregunta, respuesta: dato.respuesta }]
      : [],
  );
}

/** Las notas guardadas en un pedido, sin confiar en su forma. */
export function leerNotas(guardado: unknown): NotaPedido[] {
  if (!Array.isArray(guardado)) return [];
  return guardado.flatMap((dato) => {
    if (!esObjeto(dato) || typeof dato.pregunta !== 'string' || typeof dato.respuesta !== 'string') return [];
    return [
      {
        tipo: dato.tipo === 'otra' ? 'otra' : 'texto',
        pregunta: dato.pregunta,
        respuesta: dato.respuesta,
        producto: typeof dato.producto === 'string' ? dato.producto : null,
        contexto: leerRespuestas(dato.contexto),
      } satisfies NotaPedido,
    ];
  });
}
