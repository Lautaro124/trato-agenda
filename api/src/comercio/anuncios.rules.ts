import { getContentType, isJidStatusBroadcast, normalizeMessageContent, type proto } from '@whiskeysockets/baileys';
import { normalizarTexto } from './catalogo.rules.js';

/**
 * Anuncios de origen (LAU-103). Cuando un cliente toca un anuncio de Meta
 * (Click-to-WhatsApp), WhatsApp manda los datos del anuncio en
 * `contextInfo.externalAdReply` del primer mensaje. La campaña no viene ni se
 * puede pedir sin la Marketing API: la unidad es el anuncio (`sourceId`).
 *
 * Un cliente que responde un estado (historia) del negocio no trae
 * `externalAdReply`: trae el estado citado en `contextInfo.quotedMessage`.
 * Se registra igual, como un anuncio de tipo `estado`.
 */

/** `sourceType` de un estado del negocio; su `sourceId` lleva PREFIJO_ESTADO para no chocar con un id de Meta. */
export const TIPO_ESTADO = 'estado';
export const PREFIJO_ESTADO = 'estado:';

/** Tope de los textos del anuncio que se guardan y llegan al modelo. */
export const MAX_CARACTERES_TEXTO_ANUNCIO = 300;
/** Tope de la URL del anuncio que se guarda (sólo se muestra, nunca se descarga). */
export const MAX_CARACTERES_URL_ANUNCIO = 500;
/** Una miniatura de WhatsApp pesa pocos KB: más que esto no es una miniatura y no se guarda. */
export const MAX_BYTES_MINIATURA = 512 * 1024;

export const ASOCIACIONES = ['pendiente', 'automatica', 'manual', 'sin_producto'] as const;
export type Asociacion = (typeof ASOCIACIONES)[number];

/** Lo que se usa del anuncio. `ctwaClid` (id de tracking) y las URLs de media no se toman. */
export type ReferenciaAnuncio = {
  sourceId: string;
  sourceType: string | null;
  sourceUrl: string | null;
  titulo: string | null;
  cuerpo: string | null;
  miniatura: Buffer | null;
  /** Sólo de un estado: la imagen citada, para bajarla completa (la miniatura es borrosa). */
  imagen?: proto.Message.IImageMessage;
};

/** Texto libre de un tercero en una línea, sin caracteres de control y recortado. */
function limpiar(texto: string | null | undefined, maximo: number): string | null {
  if (typeof texto !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const limpio = texto.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, ' ').replace(/\s+/g, ' ').trim();
  return limpio ? limpio.slice(0, maximo) : null;
}

/** Un texto del anuncio (el nombre que le pone el dueño, por ejemplo) limpio como los que manda WhatsApp. */
export function textoDeAnuncioLimpio(texto: string | null | undefined): string | null {
  return limpiar(texto, MAX_CARACTERES_TEXTO_ANUNCIO);
}

/** Sólo URLs http(s): se muestran en el panel como texto, nunca se descargan. */
function urlSegura(url: string | null | undefined): string | null {
  const limpia = limpiar(url, MAX_CARACTERES_URL_ANUNCIO);
  if (!limpia) return null;
  try {
    const { protocol } = new URL(limpia);
    return protocol === 'https:' || protocol === 'http:' ? limpia : null;
  } catch {
    return null;
  }
}

/** Una miniatura de WhatsApp, si tiene un tamaño de miniatura. */
function miniaturaDe(bytes: Uint8Array | null | undefined): Buffer | null {
  return bytes && bytes.length > 0 && bytes.length <= MAX_BYTES_MINIATURA ? Buffer.from(bytes) : null;
}

/**
 * El anuncio desde el que escribió el cliente, si el mensaje lo trae. Lo
 * busca en el `contextInfo` del contenido principal, sea texto, imagen, audio
 * o un mensaje efímero: primero un anuncio de Meta y, si no, un estado del
 * negocio que el cliente está respondiendo. Sin id no hay cómo reconocerlo y
 * se ignora.
 */
export function referenciaDeAnuncio(mensaje: proto.IMessage | null | undefined): ReferenciaAnuncio | null {
  const contenido = normalizeMessageContent(mensaje);
  const tipo = getContentType(contenido);
  if (!contenido || !tipo) return null;
  const valor = contenido[tipo] as { contextInfo?: proto.IContextInfo | null } | null | undefined;
  const contexto = typeof valor === 'object' && valor ? valor.contextInfo : null;
  if (!contexto) return null;
  if (contexto.externalAdReply) return deAnuncio(contexto.externalAdReply);
  // Un cliente sólo puede responder un estado de quien lo publicó: el del negocio.
  if (isJidStatusBroadcast(contexto.remoteJid ?? '') && contexto.quotedMessage) return deEstado(contexto);
  return null;
}

function deAnuncio(anuncio: proto.ContextInfo.IExternalAdReplyInfo): ReferenciaAnuncio | null {
  const sourceId = limpiar(anuncio.sourceId, 128);
  // El prefijo es de los estados: un anuncio que lo trae es inventado.
  if (!sourceId || sourceId.startsWith(PREFIJO_ESTADO)) return null;
  return {
    sourceId,
    sourceType: limpiar(anuncio.sourceType, 32),
    sourceUrl: urlSegura(anuncio.sourceUrl),
    titulo: limpiar(anuncio.title, MAX_CARACTERES_TEXTO_ANUNCIO),
    cuerpo: limpiar(anuncio.body, MAX_CARACTERES_TEXTO_ANUNCIO),
    miniatura: miniaturaDe(anuncio.thumbnail),
  };
}

/** El estado citado: su epígrafe (o su texto) y su imagen. El id del estado identifica al "anuncio". */
function deEstado(contexto: proto.IContextInfo): ReferenciaAnuncio | null {
  const id = limpiar(contexto.stanzaId, 128);
  const citado = normalizeMessageContent(contexto.quotedMessage);
  if (!id || !citado) return null;
  const { imageMessage: imagen, videoMessage: video } = citado;
  const texto = imagen?.caption ?? video?.caption ?? citado.extendedTextMessage?.text ?? citado.conversation;
  return {
    sourceId: `${PREFIJO_ESTADO}${id}`,
    sourceType: TIPO_ESTADO,
    sourceUrl: null,
    titulo: null,
    cuerpo: limpiar(texto, MAX_CARACTERES_TEXTO_ANUNCIO),
    miniatura: miniaturaDe(imagen?.jpegThumbnail ?? video?.jpegThumbnail),
    ...(imagen ? { imagen } : {}),
  };
}

/** Lo que se busca en el catálogo con un anuncio: su título y su texto. */
export function textoDeAnuncio(anuncio: { titulo: string | null; cuerpo: string | null }): string {
  return [anuncio.titulo, anuncio.cuerpo].filter(Boolean).join(' ');
}

/** `texto` normalizado contiene `frase` como palabras enteras. */
function contienePalabras(texto: string, frase: string): boolean {
  const palabras = (valor: string) => ` ${normalizarTexto(valor).replace(/[^a-z0-9ñ]+/g, ' ').trim()} `;
  const buscada = palabras(frase);
  return buscada.trim().length > 0 && palabras(texto).includes(buscada);
}

type Candidato = { productoId: string; nombre: string; codigo: string; soloParecido?: boolean };

/**
 * El producto del anuncio, sólo si no hay dudas: entre lo que encontró la
 * búsqueda por texto (no lo "parecido" por embeddings), el único cuyo nombre
 * o código aparece entero en el texto del anuncio. Si aparecen varios y uno
 * los contiene a todos ("Rinconero brick 3c" sobre "Rinconero brick"), ése.
 * Si no, null: el anuncio queda para que el dueño lo elija y el asistente
 * usa el texto como pista, sin inventar.
 */
export function elegirProducto<T extends Candidato>(candidatos: T[], textoAnuncio: string): T | null {
  if (!textoAnuncio.trim()) return null;
  const nombrados = candidatos.filter(
    (candidato) =>
      !candidato.soloParecido &&
      (contienePalabras(textoAnuncio, candidato.nombre) ||
        (candidato.codigo.length >= 3 && contienePalabras(textoAnuncio, candidato.codigo))),
  );
  if (nombrados.length === 0) return null;
  const [masLargo] = [...nombrados].sort((a, b) => b.nombre.length - a.nombre.length);
  const unicos = new Set(nombrados.map((candidato) => candidato.productoId));
  if (unicos.size === 1) return masLargo;
  return nombrados.every((otro) => contienePalabras(masLargo.nombre, otro.nombre)) ? masLargo : null;
}

/** Parámetros de un link de Facebook/Instagram que identifican la publicación; el resto (tracking) se descarta. */
const PARAMETROS_DE_PUBLICACION = new Set(['story_fbid', 'fbid', 'id', 'v', 'ad_id']);

/**
 * Un link de anuncio reducido a lo que lo identifica: sin protocolo, `www.`
 * ni `m.`, sin parámetros de tracking, sin barra final. Así el link que pega
 * el dueño y el `sourceUrl` que manda WhatsApp coinciden aunque difieran en
 * esos detalles. `null` si no es un link http(s).
 */
export function claveDeLink(url: string | null | undefined): string | null {
  const limpia = limpiar(url, MAX_CARACTERES_URL_ANUNCIO);
  if (!limpia) return null;
  let link: URL;
  try {
    link = new URL(/^[a-z][a-z0-9+.-]*:/i.test(limpia) ? limpia : `https://${limpia}`);
  } catch {
    return null;
  }
  if (link.protocol !== 'https:' && link.protocol !== 'http:') return null;
  const host = link.hostname.toLowerCase().replace(/^(www|m|l|web)\./, '');
  // Un dominio de verdad (fb.me, facebook.com): "123" o una IP no son el link de un anuncio.
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) return null;
  const parametros = [...link.searchParams]
    .filter(([clave]) => PARAMETROS_DE_PUBLICACION.has(clave))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clave, valor]) => `${clave}=${valor}`);
  const ruta = link.pathname.replace(/\/+$/, '');
  return `${host}${ruta}${parametros.length ? `?${parametros.join('&')}` : ''}`;
}

/** Lo que identifica un anuncio que carga el dueño: el id de Meta o su link. */
export type IdentidadDeAnuncio = { sourceId: string; sourceUrl: null; urlClave: null } | { sourceId: null; sourceUrl: string; urlClave: string };

/**
 * Lo que pegó el dueño para cargar un anuncio: el "ID del anuncio" del
 * Administrador de anuncios de Meta (sólo dígitos) o el link del anuncio o
 * la publicación. `null` si no es ninguna de las dos cosas.
 */
export function identificarAnuncio(entrada: string): IdentidadDeAnuncio | null {
  const texto = entrada.trim();
  if (/^\d{6,30}$/.test(texto)) return { sourceId: texto, sourceUrl: null, urlClave: null };
  const urlClave = claveDeLink(texto);
  if (!urlClave) return null;
  const sourceUrl = urlSegura(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
  return sourceUrl ? { sourceId: null, sourceUrl, urlClave } : null;
}

/**
 * El producto que gana tras revisar el anuncio más de una vez con Jev: el de
 * mayor probabilidad promedio entre las revisiones. Sólo si le gana a "ninguna"
 * (también promediada): si el anuncio no muestra claramente un producto del
 * catálogo, no se inventa uno. Devuelve la compatibilidad (0 a 1) de cada lado
 * para poder verla en los logs.
 */
export function ganadorPromedio(
  ids: string[],
  revisiones: Array<Record<string, number>>,
): { id: string; compatibilidad: number; ninguna: number } | null {
  if (revisiones.length === 0) return null;
  const promedio = (id: string) =>
    revisiones.reduce((suma, r) => suma + (Object.hasOwn(r, id) ? r[id] : 0), 0) / revisiones.length;
  let mejor: { id: string; compatibilidad: number } | null = null;
  for (const id of ids) {
    const compatibilidad = promedio(id);
    if (!mejor || compatibilidad > mejor.compatibilidad) mejor = { id, compatibilidad };
  }
  const ninguna = promedio('none');
  return mejor && mejor.compatibilidad > ninguna ? { ...mejor, ninguna } : null;
}
