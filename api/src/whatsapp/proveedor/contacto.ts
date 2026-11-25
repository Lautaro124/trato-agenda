/**
 * Identificar al cliente sin depender del proveedor (LAU-110). Hoy cada chat
 * es `Conversation.remoteJid`, el JID de Baileys ("5491122334455@s.whatsapp.net",
 * o "…@lid" con el número aparte en `telefono`). Un proveedor oficial
 * identifica al cliente por su número (`wa_id`): para no duplicar chats ni
 * perder el contexto, ese número se asocia a la conversación que ya existe.
 *
 * Sólo por equivalencias que define WhatsApp, nunca por parecido: el 9 que
 * Argentina intercala después del 54 y el 1 de los móviles viejos de México
 * no cambian de cliente (un número nacional no puede ser fijo y móvil a la
 * vez). El 0 del área y el 15 nunca aparecen en un id de WhatsApp: si
 * vinieran, no se sacan y el chat no se asocia. Más de una coincidencia
 * tampoco se asocia: se avisa y se deja para revisar.
 */
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

/** País → dígito de móvil que WhatsApp intercala tras el código. */
const DIGITO_MOVIL: Record<string, string> = { '54': '9', '52': '1' };

/** El id de WhatsApp del cliente: sólo dígitos, en el largo de un número E.164. null si no lo es. */
export function idDeWhatsapp(crudo: string | null | undefined): string | null {
  if (typeof crudo !== 'string') return null;
  const digitos = crudo.replace(/[\s+\-().]/g, '');
  return /^\d{8,15}$/.test(digitos) ? digitos : null;
}

/** Las dos formas del mismo id (con y sin el dígito de móvil); una sola si el país no lo usa. */
export function formasDelId(id: string): string[] {
  for (const [pais, movil] of Object.entries(DIGITO_MOVIL)) {
    if (!id.startsWith(pais)) continue;
    const nacional = id.slice(pais.length);
    const sinMovil = nacional.startsWith(movil) ? nacional.slice(movil.length) : nacional;
    return [...new Set([`${pais}${movil}${sinMovil}`, `${pais}${sinMovil}`])];
  }
  return [id];
}

/** La clave con la que se comparan dos ids: la forma sin el dígito de móvil. */
export function claveDelId(id: string): string {
  return formasDelId(id).at(-1)!;
}

/** El chat (`remoteJid`) de un cliente nuevo que llega por su número: el mismo formato que usa Baileys. */
export function chatDeId(id: string): string {
  return `${id}@s.whatsapp.net`;
}

/** El id de WhatsApp de un chat existente: el del JID, o el guardado aparte de un chat LID. */
function idDeChat(chat: { remoteJid: string; telefono: string | null }): string | null {
  const [usuario, dominio] = chat.remoteJid.split('@');
  if (dominio === 's.whatsapp.net') return idDeWhatsapp(usuario);
  return idDeWhatsapp(chat.telefono);
}

export type ResolucionDeChat =
  | { tipo: 'existente'; chat: string }
  | { tipo: 'nuevo'; chat: string }
  /** Más de un chat del comercio es de ese número: no se elige uno a ojo. */
  | { tipo: 'ambiguo' }
  | { tipo: 'invalido' };

/** Elige entre los chats candidatos del comercio. Pura: la consulta la hace `resolverChat`. */
export function elegirChat(crudo: string, candidatos: { remoteJid: string; telefono: string | null }[]): ResolucionDeChat {
  const id = idDeWhatsapp(crudo);
  if (!id) return { tipo: 'invalido' };
  const clave = claveDelId(id);
  const coincidencias = [
    ...new Set(
      candidatos.filter((candidato) => {
        const delChat = idDeChat(candidato);
        return delChat !== null && claveDelId(delChat) === clave;
      }).map((candidato) => candidato.remoteJid),
    ),
  ];
  if (coincidencias.length === 1) return { tipo: 'existente', chat: coincidencias[0]! };
  if (coincidencias.length > 1) return { tipo: 'ambiguo' };
  return { tipo: 'nuevo', chat: chatDeId(id) };
}

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * La conversación de un cliente que llega por su número (el `wa_id` de un
 * proveedor oficial), dentro de un único comercio: nunca cruza cuentas.
 */
export async function resolverChat(db: Db, userId: string, crudo: string): Promise<ResolucionDeChat> {
  const id = idDeWhatsapp(crudo);
  if (!id) return { tipo: 'invalido' };
  const formas = formasDelId(id);
  const candidatos = await db.conversation.findMany({
    where: { userId, OR: [{ remoteJid: { in: formas.map(chatDeId) } }, { telefono: { in: formas } }] },
    select: { remoteJid: true, telefono: true },
  });
  return elegirChat(id, candidatos);
}
