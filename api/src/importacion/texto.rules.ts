/**
 * El texto que viene de una página ajena (nombre, descripción, categoría,
 * variantes) termina en el catálogo, y el catálogo lo lee el asistente en
 * cada búsqueda. No es del dueño: lo escribió cualquiera. Antes de que llegue
 * a la vista previa pasa por acá, que lo deja como texto plano y acotado y le
 * saca lo que el resto del sistema trata como señal:
 *
 * - etiquetas HTML y entidades;
 * - caracteres de control, de ancho cero y de dirección (bidi), que esconden
 *   texto a la vista del dueño pero no del modelo;
 * - la frase con la que el código pide mandar algo tal cual (neutralizarMarcador);
 * - los marcadores internos "[producto …]", "[variante …]", "[pedido …]" que
 *   leen variantesMostradas, productosMostrados y el stub de los e2e;
 * - en las descripciones, los montos: el chequeo de precios del asistente
 *   (preciosSinRespaldo) acepta cualquier monto que aparezca en un resultado
 *   de búsqueda, así que un "$ 1" en la descripción respaldaría un precio falso.
 *
 * Igual el dueño revisa y edita todo antes de confirmar.
 */
import { neutralizarMarcador } from '../agents/mensajes.rules.js';

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  uuml: 'ü',
  iexcl: '¡',
  iquest: '¿',
  deg: '°',
  ordm: 'º',
  ordf: 'ª',
  reg: '®',
  trade: '™',
  copy: '©',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
};

/** "&amp;", "&#225;", "&#xE1;" → el carácter. Lo que no conoce lo deja como está. */
export function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (entera, nombre: string) => {
    if (nombre[0] === '#') {
      const codigo = nombre[1] === 'x' || nombre[1] === 'X' ? parseInt(nombre.slice(2), 16) : Number(nombre.slice(1));
      return Number.isInteger(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : '';
    }
    return Object.hasOwn(ENTIDADES, nombre) ? ENTIDADES[nombre] : entera;
  });
}

/** Saca las etiquetas, recorriendo una sola vez (sin regex que pueda volverse cuadrática). */
export function sinEtiquetas(texto: string): string {
  let salida = '';
  let dentro = false;
  for (const caracter of texto) {
    if (caracter === '<') {
      dentro = true;
      salida += ' ';
    } else if (caracter === '>' && dentro) {
      dentro = false;
    } else if (!dentro) {
      salida += caracter;
    }
  }
  return salida;
}

// Control (menos el salto de línea y el tab), de ancho cero, separadores de línea y de dirección.
// oxlint-disable-next-line no-control-regex -- sacar los caracteres de control es justamente lo que hace.
const INVISIBLES = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;
const MARCADORES_INTERNOS = /\[(\s*)(producto|variante|pedido)\b/gi;
const MONTOS = /(?:US\$|U\$S|USD|AR\$|ARS|\$)\s?\d[\d.,]*/gi;

export type OpcionesTexto = {
  largo: number;
  /** Si conserva los saltos de línea (la descripción) o queda en una sola línea. */
  multilinea?: boolean;
  /** Si saca los montos (las descripciones). */
  sinMontos?: boolean;
};

/** Cualquier valor de una página → texto plano seguro de guardar, o "" si no había texto. */
export function textoSeguro(valor: unknown, opciones: OpcionesTexto): string {
  if (typeof valor !== 'string' && typeof valor !== 'number') return '';
  // Un tope antes de recorrer: una página puede mandar megas en un solo campo.
  let texto = String(valor).slice(0, opciones.largo * 8);
  texto = decodificarEntidades(sinEtiquetas(decodificarEntidades(texto)));
  texto = texto.replace(INVISIBLES, '');
  texto = neutralizarMarcador(texto);
  texto = texto.replace(MARCADORES_INTERNOS, '($1$2');
  if (opciones.sinMontos) texto = texto.replace(MONTOS, '');
  texto = opciones.multilinea
    ? texto
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((linea) => linea.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : texto.replace(/\s+/g, ' ').trim();
  // Por caracteres, no por unidades de UTF-16: así no queda medio emoji al final.
  const caracteres = Array.from(texto);
  return caracteres.length > opciones.largo ? caracteres.slice(0, opciones.largo).join('').trimEnd() : texto;
}
