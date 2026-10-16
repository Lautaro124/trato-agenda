/**
 * Sugerencias de mejora (LAU-14). Las reglas son una copia a mano de
 * api/src/mejoras/mejoras.rules.ts: la API es la que decide, esto sólo evita
 * mandar algo que va a rechazar y avisa mientras se escribe.
 *
 * "Solo texto" es una lista blanca: letras, números, espacios, saltos de
 * línea y puntuación básica. Todo lo demás (HTML, markdown, @, /, emojis,
 * caracteres invisibles) se rechaza, y los dominios sueltos también.
 */
import { apiFetch } from "@/lib/api";

export const TIPOS_SUGERENCIA = [
  { id: "idea", label: "Una idea nueva" },
  { id: "problema", label: "Algo no anda bien" },
  { id: "otro", label: "Otra cosa" },
] as const;
export type TipoSugerencia = (typeof TIPOS_SUGERENCIA)[number]["id"];

export const MIN_CARACTERES = 10;
export const MAX_CARACTERES = 1000;
export const MAX_LINEAS = 30;

const PERMITIDO = /^[\p{Script=Latin}\p{M}0-9 \n.,;:¿?¡!'"()%$°\-‘’“”–—…]*$/u;
const CARACTER_PERMITIDO = /^[\p{Script=Latin}\p{M}0-9 \n.,;:¿?¡!'"()%$°\-‘’“”–—…]$/u;
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
const ESQUEMA = /(?:^|[^\p{L}\p{N}])(?:javascript|vbscript|mailto|https?|ftp)\s*:/iu;

export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\p{Zs}]/gu, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ResultadoValidacion =
  | { ok: true; texto: string }
  | { ok: false; error: string; muyCorta: boolean };

export function validarSugerencia(crudo: string): ResultadoValidacion {
  const texto = normalizarTexto(crudo);

  if (texto.length < MIN_CARACTERES) {
    return { ok: false, muyCorta: true, error: `Contanos un poco más: al menos ${MIN_CARACTERES} caracteres.` };
  }
  if (texto.length > MAX_CARACTERES) {
    return { ok: false, muyCorta: false, error: `Es muy larga: hasta ${MAX_CARACTERES} caracteres.` };
  }
  if (texto.split("\n").length > MAX_LINEAS) {
    return { ok: false, muyCorta: false, error: `Son muchas líneas: hasta ${MAX_LINEAS}.` };
  }
  if (!PERMITIDO.test(texto)) {
    const malo = Array.from(texto).find((c) => !CARACTER_PERMITIDO.test(c)) ?? "";
    return {
      ok: false,
      muyCorta: false,
      error: INVISIBLE.test(malo)
        ? "Hay un carácter invisible o especial que no se puede usar. Probá escribirlo de nuevo."
        : `No se puede usar «${malo}»: acá va solo texto.`,
    };
  }
  if (ESQUEMA.test(texto) || IPV4.test(texto) || DOMINIO.test(texto.replace(ABREVIATURAS, " "))) {
    return {
      ok: false,
      muyCorta: false,
      error: "Sacá el link: acá va solo texto. Si no es un link, dejá un espacio después del punto.",
    };
  }
  if (NUMERO_LARGO.test(texto)) {
    return {
      ok: false,
      muyCorta: false,
      error: "No pongas teléfonos, documentos ni datos de clientes: contanos sólo la idea.",
    };
  }
  return { ok: true, texto };
}

/** Error de la API con el mensaje que ya viene en español (400, 429). */
export class ErrorDeApi extends Error {}

export async function enviarSugerencia(tipo: TipoSugerencia, texto: string): Promise<void> {
  const res = await apiFetch("/mejoras", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo, texto }),
  });
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const mensaje = Array.isArray(cuerpo?.message) ? cuerpo.message[0] : cuerpo?.message;
    throw new ErrorDeApi(
      res.status < 500 && typeof mensaje === "string" && mensaje
        ? mensaje
        : "No pudimos mandar la sugerencia. Probá de nuevo en un rato.",
    );
  }
}
