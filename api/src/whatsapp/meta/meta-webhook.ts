import { createHmac, timingSafeEqual } from 'node:crypto';
import { referenciaDeReferral, type ReferenciaAnuncio } from '../../comercio/anuncios.rules.js';

/**
 * `X-Hub-Signature-256` = "sha256=" + HMAC-SHA256 del cuerpo crudo con el
 * secreto de la app. Sin el cuerpo byte a byte (re-serializar el JSON cambia
 * espacios y escapes) no se puede verificar: por eso la ruta del webhook
 * tiene su propio parser `raw` en main.ts.
 */
export function firmaDeMetaValida(cuerpo: Buffer | undefined, firma: string | undefined, secreto: string): boolean {
  if (!secreto || !cuerpo || !firma?.startsWith('sha256=')) return false;
  const esperado = Buffer.from(createHmac('sha256', secreto).update(cuerpo).digest('hex'), 'utf8');
  const recibido = Buffer.from(firma.slice('sha256='.length), 'utf8');
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}

/** Compara el `hub.verify_token` del alta del webhook en tiempo constante. */
export function tokenDeVerificacionValido(recibido: string | undefined, esperado: string): boolean {
  if (!esperado || typeof recibido !== 'string') return false;
  const a = createHmac('sha256', 'verify').update(recibido).digest();
  const b = createHmac('sha256', 'verify').update(esperado).digest();
  return timingSafeEqual(a, b);
}

/** El JID con el que Baileys identifica un chat: así la conversación, las ventas y el panel no distinguen el canal. */
export function jidDeWaId(waId: string): string {
  return `${waId}@s.whatsapp.net`;
}

/** Al revés: el `to` para mandar por la Cloud API. null si no es un chat 1:1 de un número. */
export function waIdDeJid(remoteJid: string): string | null {
  const coincidencia = /^(\d{6,20})@s\.whatsapp\.net$/.exec(remoteJid);
  return coincidencia ? coincidencia[1]! : null;
}

export type ContenidoMeta =
  | { texto: string }
  | { audio: { mediaId: string; mimeType: string | null } }
  | { imagen: { mediaId: string; mimeType: string | null; epigrafe: string | null } };

export type EventoMeta =
  /** Un mensaje de un cliente al negocio. */
  | {
      tipo: 'mensaje';
      phoneNumberId: string;
      /** El wamid: identifica el mensaje para no atenderlo dos veces. */
      waId: string;
      remoteJid: string;
      enviadoEn: number | null;
      contenido: ContenidoMeta;
      anuncio: ReferenciaAnuncio | null;
    }
  /** Coexistencia: lo que el dueño escribió desde la app WhatsApp Business. */
  | { tipo: 'eco'; phoneNumberId: string; waId: string; remoteJid: string; texto: string }
  /** El negocio sacó a Trato de su WABA (o la dio de baja). */
  | { tipo: 'baja'; wabaId: string };

type Objeto = Record<string, unknown>;

function objeto(valor: unknown): Objeto | null {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Objeto) : null;
}

function lista(valor: unknown): Objeto[] {
  return Array.isArray(valor) ? valor.map(objeto).filter((o): o is Objeto => o !== null) : [];
}

function texto(valor: unknown, maximo = 256): string | null {
  return typeof valor === 'string' && valor.length > 0 && valor.length <= maximo ? valor : null;
}

/** Ids de Meta: numéricos (WABA, número, media) o un wamid en base64. */
function id(valor: unknown): string | null {
  const t = texto(valor, 256);
  return t && /^[\w.=:+/-]+$/.test(t) ? t : null;
}

function waIdDe(valor: unknown): string | null {
  const t = texto(valor, 20);
  return t && /^\d{6,20}$/.test(t) ? t : null;
}

function timestampMs(valor: unknown): number | null {
  const segundos = Number(valor);
  return Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : null;
}

/** Tope de lo que se lee de un texto: el cuerpo de un webhook ya está acotado, esto es por las dudas. */
const MAX_TEXTO = 8_000;

function contenidoDe(mensaje: Objeto): ContenidoMeta | null {
  switch (mensaje.type) {
    case 'text': {
      const cuerpo = texto(objeto(mensaje.text)?.body, MAX_TEXTO);
      return cuerpo ? { texto: cuerpo } : null;
    }
    case 'audio': {
      const audio = objeto(mensaje.audio);
      const mediaId = id(audio?.id);
      return mediaId ? { audio: { mediaId, mimeType: texto(audio?.mime_type, 128) } } : null;
    }
    case 'image': {
      const imagen = objeto(mensaje.image);
      const mediaId = id(imagen?.id);
      return mediaId
        ? { imagen: { mediaId, mimeType: texto(imagen?.mime_type, 128), epigrafe: texto(imagen?.caption, MAX_TEXTO) } }
        : null;
    }
    default:
      // Stickers, ubicaciones, reacciones…: como con Baileys, no se contestan.
      return null;
  }
}

/**
 * Los eventos que le importan a Trato de un webhook de WhatsApp. El cuerpo ya
 * pasó la firma: viene de Meta, pero igual se valida forma por forma y lo
 * que no se reconoce se ignora (estados de entrega, historial y contactos de
 * la coexistencia, plantillas…).
 */
export function eventosDeWebhook(cuerpo: unknown): EventoMeta[] {
  const raiz = objeto(cuerpo);
  if (raiz?.object !== 'whatsapp_business_account') return [];
  const eventos: EventoMeta[] = [];
  for (const entrada of lista(raiz.entry)) {
    for (const cambio of lista(entrada.changes)) {
      const valor = objeto(cambio.value);
      if (!valor) continue;
      if (cambio.field === 'account_update') {
        const wabaId = id(entrada.id);
        if (wabaId && valor.event === 'PARTNER_REMOVED') eventos.push({ tipo: 'baja', wabaId });
        continue;
      }
      const phoneNumberId = id(objeto(valor.metadata)?.phone_number_id);
      if (!phoneNumberId) continue;
      if (cambio.field === 'messages') {
        for (const mensaje of lista(valor.messages)) {
          const waId = id(mensaje.id);
          const de = waIdDe(mensaje.from);
          const contenido = contenidoDe(mensaje);
          if (!waId || !de || !contenido) continue;
          eventos.push({
            tipo: 'mensaje',
            phoneNumberId,
            waId,
            remoteJid: jidDeWaId(de),
            enviadoEn: timestampMs(mensaje.timestamp),
            contenido,
            anuncio: referenciaDeReferral(mensaje.referral),
          });
        }
      } else if (cambio.field === 'smb_message_echoes') {
        for (const eco of lista(valor.message_echoes)) {
          const waId = id(eco.id);
          const para = waIdDe(eco.to);
          const cuerpoEco = eco.type === 'text' ? texto(objeto(eco.text)?.body, MAX_TEXTO) : null;
          if (waId && para && cuerpoEco) eventos.push({ tipo: 'eco', phoneNumberId, waId, remoteJid: jidDeWaId(para), texto: cuerpoEco });
        }
      }
    }
  }
  return eventos;
}
