/**
 * Lo que manda el webhook de la Cloud API, ya validado y achicado a lo que
 * usa Trato. Puro: sin base ni red. El cuerpo viene de Meta (la firma ya se
 * verificó), pero los textos los escribió un cliente: son datos.
 *
 * Campos que se miran:
 * - `messages`: mensajes de clientes (y estados de envío, que se ignoran).
 * - `smb_message_echoes`: con Coexistence, lo que el dueño escribe desde la app
 *   WhatsApp Business de su celular.
 * - `account_update` con `PARTNER_REMOVED`: el comercio desconectó a Trato.
 */

/** Un id de Meta (WABA, número, media): sólo dígitos. Lo que no lo sea no se usa en una URL. */
export function esIdDeMeta(valor: unknown): valor is string {
  return typeof valor === 'string' && /^\d{1,25}$/.test(valor);
}

export type ReferenciaCloud = {
  sourceId: string;
  sourceType: string | null;
  sourceUrl: string | null;
  titulo: string | null;
  cuerpo: string | null;
};

export type ContenidoCloud =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'audio'; mediaId: string; mime: string | null }
  | { tipo: 'imagen'; mediaId: string; mime: string | null; caption: string | null }
  | { tipo: 'otro' };

export type EventoCloud =
  | {
      tipo: 'mensaje';
      phoneNumberId: string;
      /** `wa_id` del cliente. */
      de: string;
      id: string;
      enviadoEn: number | null;
      contenido: ContenidoCloud;
      anuncio: ReferenciaCloud | null;
    }
  | {
      tipo: 'eco';
      phoneNumberId: string;
      /** `wa_id` del cliente al que le escribió el dueño. */
      para: string;
      id: string;
      enviadoEn: number | null;
      texto: string | null;
    }
  | { tipo: 'desconectado'; wabaId: string };

type Objeto = Record<string, unknown>;

function objeto(valor: unknown): Objeto | null {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Objeto) : null;
}

function lista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

/** Los timestamps vienen en segundos y como texto. */
function milisegundos(valor: unknown): number | null {
  const segundos = typeof valor === 'string' ? Number(valor) : typeof valor === 'number' ? valor : NaN;
  return Number.isFinite(segundos) && segundos > 0 ? Math.round(segundos * 1000) : null;
}

function contenidoDe(mensaje: Objeto): ContenidoCloud {
  switch (mensaje.type) {
    case 'text': {
      const cuerpo = texto(objeto(mensaje.text)?.body);
      return cuerpo ? { tipo: 'texto', texto: cuerpo } : { tipo: 'otro' };
    }
    case 'audio': {
      const audio = objeto(mensaje.audio);
      return audio && esIdDeMeta(audio.id) ? { tipo: 'audio', mediaId: audio.id, mime: texto(audio.mime_type) } : { tipo: 'otro' };
    }
    case 'image': {
      const imagen = objeto(mensaje.image);
      return imagen && esIdDeMeta(imagen.id)
        ? { tipo: 'imagen', mediaId: imagen.id, mime: texto(imagen.mime_type), caption: texto(imagen.caption) }
        : { tipo: 'otro' };
    }
    // Un botón de respuesta rápida es texto para el asistente.
    case 'button': {
      const cuerpo = texto(objeto(mensaje.button)?.text);
      return cuerpo ? { tipo: 'texto', texto: cuerpo } : { tipo: 'otro' };
    }
    default:
      return { tipo: 'otro' };
  }
}

/** El anuncio de "clic a WhatsApp" desde el que escribió el cliente, si vino de uno. */
function anuncioDe(mensaje: Objeto): ReferenciaCloud | null {
  const referral = objeto(mensaje.referral);
  const sourceId = texto(referral?.source_id);
  if (!referral || !sourceId) return null;
  return {
    sourceId,
    sourceType: texto(referral.source_type),
    sourceUrl: texto(referral.source_url),
    titulo: texto(referral.headline),
    cuerpo: texto(referral.body),
  };
}

function mensajesDe(valor: Objeto, phoneNumberId: string): EventoCloud[] {
  const eventos: EventoCloud[] = [];
  for (const crudo of lista(valor.messages)) {
    const mensaje = objeto(crudo);
    const de = texto(mensaje?.from);
    const id = texto(mensaje?.id);
    if (!mensaje || !de || !id) continue;
    eventos.push({
      tipo: 'mensaje',
      phoneNumberId,
      de,
      id,
      enviadoEn: milisegundos(mensaje.timestamp),
      contenido: contenidoDe(mensaje),
      anuncio: anuncioDe(mensaje),
    });
  }
  return eventos;
}

function ecosDe(valor: Objeto, phoneNumberId: string): EventoCloud[] {
  const eventos: EventoCloud[] = [];
  for (const crudo of lista(valor.message_echoes)) {
    const eco = objeto(crudo);
    const para = texto(eco?.to);
    const id = texto(eco?.id);
    if (!eco || !para || !id) continue;
    eventos.push({
      tipo: 'eco',
      phoneNumberId,
      para,
      id,
      enviadoEn: milisegundos(eco.timestamp),
      texto: eco.type === 'text' ? texto(objeto(eco.text)?.body) : null,
    });
  }
  return eventos;
}

/** Todos los eventos que interesan de un POST del webhook, en el orden en que vinieron. */
export function eventosDelWebhook(cuerpo: unknown): EventoCloud[] {
  const raiz = objeto(cuerpo);
  if (!raiz || raiz.object !== 'whatsapp_business_account') return [];
  const eventos: EventoCloud[] = [];
  for (const crudaEntrada of lista(raiz.entry)) {
    const entrada = objeto(crudaEntrada);
    if (!entrada) continue;
    for (const crudoCambio of lista(entrada.changes)) {
      const cambio = objeto(crudoCambio);
      const valor = objeto(cambio?.value);
      if (!cambio || !valor) continue;
      if (cambio.field === 'account_update') {
        if (valor.event === 'PARTNER_REMOVED' && esIdDeMeta(entrada.id)) {
          eventos.push({ tipo: 'desconectado', wabaId: entrada.id });
        }
        continue;
      }
      const phoneNumberId = objeto(valor.metadata)?.phone_number_id;
      if (!esIdDeMeta(phoneNumberId)) continue;
      if (cambio.field === 'messages') eventos.push(...mensajesDe(valor, phoneNumberId));
      else if (cambio.field === 'smb_message_echoes') eventos.push(...ecosDe(valor, phoneNumberId));
    }
  }
  return eventos;
}
