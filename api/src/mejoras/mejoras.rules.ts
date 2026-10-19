/**
 * Reglas de las sugerencias de mejora (LAU-14), como funciones puras. La web
 * tiene una copia a mano en `web/src/lib/sugerencias.ts` para avisar antes de
 * mandar; la que decide es esta.
 *
 * "Solo texto" es una lista blanca y no una lista negra: lo que no está
 * permitido explícitamente se rechaza. Así quedan afuera de una vez el HTML
 * (`< > &`), el markdown que Linear renderiza (`[ ] * _ # \` |`), los mails y
 * las URLs con esquema (`@ /`), los emojis y los caracteres invisibles o de
 * dirección (zero-width, bidi), que son categoría `Cf` y no entran en la
 * lista. Los dominios sueltos (`trato.com`) sí se escriben con caracteres
 * permitidos, por eso tienen su propio chequeo.
 */

export const TIPOS_SUGERENCIA = ['idea', 'problema', 'otro'] as const;
export type TipoSugerencia = (typeof TIPOS_SUGERENCIA)[number];

export const MIN_CARACTERES = 10;
export const MAX_CARACTERES = 1000;
export const MAX_LINEAS = 30;

/** Cuántas sugerencias puede mandar una cuenta en 24 horas. */
export const MAX_POR_DIA = 5;

/**
 * Letras latinas (con tildes, ñ y diacríticos), dígitos 0-9, espacio, salto de línea y
 * puntuación básica, incluidas las comillas y rayas que el teclado del
 * celular pone solo.
 */
const PERMITIDO = /^[\p{Script=Latin}\p{M}0-9 \n.,;:¿?¡!'"()%$°\-‘’“”–—…]*$/u;
const CARACTER_PERMITIDO = /^[\p{Script=Latin}\p{M}0-9 \n.,;:¿?¡!'"()%$°\-‘’“”–—…]$/u;

/** Separadores y caracteres de control o formato: no tiene sentido mostrarlos en el error. */
const INVISIBLE = /^[\p{C}\p{Z}]$/u;

/**
 * Cualquier palabra pegada a un punto y a dos letras o más (`trato.com`,
 * `evil.zip`, `bien.Como`) cuenta como dominio: una lista de TLDs siempre se
 * queda corta. El costo es que hay que dejar un espacio después del punto, y
 * el error lo dice. Las etiquetas acotadas a 63 evitan el backtracking.
 */
const DOMINIO = /(?:^|[^\p{L}\p{N}])(?:www\.|[\p{L}\p{N}-]{1,63}\.\p{L}{2,})/iu;
const IPV4 = /(?:^|\D)\d{1,3}(?:\.\d{1,3}){3}(?!\d)/u;
/** Abreviaturas con punto pegado que no son dominios. */
const ABREVIATURAS = /(?:^|[^\p{L}])(?:p\.\s?ej|ee\.\s?uu|s\.\s?r\.\s?l|s\.\s?a)\.?(?![\p{L}\p{N}.])/giu;
/**
 * Un teléfono o un documento: siete dígitos o más, con o sin espacios,
 * puntos, comas o guiones ("30.123.456"). La sugerencia es sobre Trato, no sobre nadie en particular.
 */
const NUMERO_LARGO = /\d(?:[ .,-]?\d){6,}/u;

/**
 * Esquemas que algunos visores convierten en link aunque falte la barra. No
 * están `tel` ni `data`: "tel: 11…" es como la gente escribe su teléfono, y
 * un data URI necesita `/`, que ya no pasa la lista blanca.
 */
const ESQUEMA = /(?:^|[^\p{L}\p{N}])(?:javascript|vbscript|mailto|https?|ftp)\s*:/iu;

export const ETIQUETA_TIPO: Record<TipoSugerencia, string> = {
  idea: 'Idea',
  problema: 'Problema',
  otro: 'Otra',
};

export function esTipoSugerencia(valor: unknown): valor is TipoSugerencia {
  return typeof valor === 'string' && (TIPOS_SUGERENCIA as readonly string[]).includes(valor);
}

/**
 * NFC, saltos de línea de Windows, tabs y espacios raros (el duro que trae
 * un copiar y pegar) a lo simple, sin espacios a los costados y sin más de
 * una línea en blanco seguida.
 */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\p{Zs}]/gu, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type ResultadoValidacion = { ok: true; texto: string } | { ok: false; error: string };

export function validarSugerencia(crudo: string): ResultadoValidacion {
  const texto = normalizarTexto(crudo);

  if (texto.length < MIN_CARACTERES) {
    return { ok: false, error: `Contanos un poco más: al menos ${MIN_CARACTERES} caracteres.` };
  }
  if (texto.length > MAX_CARACTERES) {
    return { ok: false, error: `Es muy larga: hasta ${MAX_CARACTERES} caracteres.` };
  }
  if (texto.split('\n').length > MAX_LINEAS) {
    return { ok: false, error: `Son muchas líneas: hasta ${MAX_LINEAS}.` };
  }
  if (!PERMITIDO.test(texto)) {
    const malo = Array.from(texto).find((c) => !CARACTER_PERMITIDO.test(c)) ?? '';
    return {
      ok: false,
      error: INVISIBLE.test(malo)
        ? 'Hay un carácter invisible o especial que no se puede usar. Probá escribirlo de nuevo.'
        : `No se puede usar «${malo}»: acá va solo texto.`,
    };
  }
  if (ESQUEMA.test(texto) || IPV4.test(texto) || DOMINIO.test(texto.replace(ABREVIATURAS, ' '))) {
    return { ok: false, error: 'Sacá el link: acá va solo texto. Si no es un link, dejá un espacio después del punto.' };
  }
  if (NUMERO_LARGO.test(texto)) {
    return { ok: false, error: 'No pongas teléfonos, documentos ni datos de clientes: contanos sólo la idea.' };
  }
  return { ok: true, texto };
}

const LARGO_TITULO = 60;

/** Título del issue: tipo y el principio del texto, en una sola línea. */
export function tituloParaLinear(tipo: TipoSugerencia, texto: string): string {
  const linea = texto.replace(/\s+/g, ' ').trim();
  const corto = linea.length > LARGO_TITULO ? `${linea.slice(0, LARGO_TITULO).trimEnd()}…` : linea;
  return `Sugerencia · ${ETIQUETA_TIPO[tipo]}: ${corto}`;
}

/**
 * Cuerpo del issue. Lleva el id interno de la cuenta para poder ubicarla, y
 * nada más de ella: ni teléfono ni mail.
 */
export function descripcionParaLinear(tipo: TipoSugerencia, texto: string, userId: string): string {
  return `${texto}\n\n---\nTipo: ${ETIQUETA_TIPO[tipo]} · Cuenta: ${userId}`;
}
