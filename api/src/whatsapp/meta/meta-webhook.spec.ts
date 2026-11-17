import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eventosDeWebhook, firmaDeMetaValida, jidDeWaId, tokenDeVerificacionValido, waIdDeJid } from './meta-webhook.js';

const SECRETO = 'secreto-de-la-app';
const firmar = (cuerpo: Buffer, secreto = SECRETO) => `sha256=${createHmac('sha256', secreto).update(cuerpo).digest('hex')}`;

function webhook(field: string, value: object, entradaId = '1029384756') {
  return { object: 'whatsapp_business_account', entry: [{ id: entradaId, changes: [{ field, value }] }] };
}

const METADATA = { display_phone_number: '5491100000000', phone_number_id: '5647382910' };

describe('firmaDeMetaValida', () => {
  const cuerpo = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');

  it('acepta el HMAC del cuerpo crudo con el secreto de la app', () => {
    expect(firmaDeMetaValida(cuerpo, firmar(cuerpo), SECRETO)).toBe(true);
  });

  it('rechaza otra firma, otro secreto, un cuerpo re-serializado o sin cuerpo', () => {
    expect(firmaDeMetaValida(cuerpo, firmar(cuerpo, 'otro'), SECRETO)).toBe(false);
    expect(firmaDeMetaValida(Buffer.from(JSON.stringify(JSON.parse(cuerpo.toString()), null, 1)), firmar(cuerpo), SECRETO)).toBe(false);
    expect(firmaDeMetaValida(undefined, firmar(cuerpo), SECRETO)).toBe(false);
    expect(firmaDeMetaValida(cuerpo, undefined, SECRETO)).toBe(false);
    expect(firmaDeMetaValida(cuerpo, firmar(cuerpo).replace('sha256=', 'sha1='), SECRETO)).toBe(false);
    expect(firmaDeMetaValida(cuerpo, 'sha256=corta', SECRETO)).toBe(false);
  });

  it('sin secreto configurado no valida nada', () => {
    expect(firmaDeMetaValida(cuerpo, firmar(cuerpo, ''), '')).toBe(false);
  });
});

describe('tokenDeVerificacionValido', () => {
  it('compara el token del alta del webhook', () => {
    expect(tokenDeVerificacionValido('token-largo-de-verificacion', 'token-largo-de-verificacion')).toBe(true);
    expect(tokenDeVerificacionValido('otro', 'token-largo-de-verificacion')).toBe(false);
    expect(tokenDeVerificacionValido(undefined, 'token-largo-de-verificacion')).toBe(false);
    expect(tokenDeVerificacionValido('', '')).toBe(false);
  });
});

describe('jid ↔ wa_id', () => {
  it('usa el mismo JID que Baileys para el chat del cliente', () => {
    expect(jidDeWaId('5491122334455')).toBe('5491122334455@s.whatsapp.net');
    expect(waIdDeJid('5491122334455@s.whatsapp.net')).toBe('5491122334455');
  });

  it('no manda a grupos, LIDs ni nada que no sea un número', () => {
    expect(waIdDeJid('123456789-1234@g.us')).toBeNull();
    expect(waIdDeJid('12345678901234@lid')).toBeNull();
    expect(waIdDeJid('../me@s.whatsapp.net')).toBeNull();
  });
});

describe('eventosDeWebhook', () => {
  it('saca un texto del cliente con su número, su wamid y su timestamp', () => {
    const eventos = eventosDeWebhook(
      webhook('messages', {
        messaging_product: 'whatsapp',
        metadata: METADATA,
        contacts: [{ wa_id: '5491122334455', profile: { name: 'Ana' } }],
        messages: [{ from: '5491122334455', id: 'wamid.ABC=', timestamp: '1763400000', type: 'text', text: { body: 'Hola' } }],
      }),
    );
    expect(eventos).toEqual([
      {
        tipo: 'mensaje',
        phoneNumberId: '5647382910',
        waId: 'wamid.ABC=',
        remoteJid: '5491122334455@s.whatsapp.net',
        enviadoEn: 1763400000000,
        contenido: { texto: 'Hola' },
        anuncio: null,
      },
    ]);
  });

  it('audio e imagen llegan como ids de media, con el epígrafe de la imagen', () => {
    const eventos = eventosDeWebhook(
      webhook('messages', {
        metadata: METADATA,
        messages: [
          { from: '5491122334455', id: 'wamid.1', type: 'audio', audio: { id: '111', mime_type: 'audio/ogg; codecs=opus', voice: true } },
          { from: '5491122334455', id: 'wamid.2', type: 'image', image: { id: '222', mime_type: 'image/jpeg', caption: '¿Lo tenés?' } },
        ],
      }),
    );
    expect(eventos.map((e) => e.tipo === 'mensaje' && e.contenido)).toEqual([
      { audio: { mediaId: '111', mimeType: 'audio/ogg; codecs=opus' } },
      { imagen: { mediaId: '222', mimeType: 'image/jpeg', epigrafe: '¿Lo tenés?' } },
    ]);
  });

  it('un mensaje desde un anuncio (Click-to-WhatsApp) trae su referencia', () => {
    const [evento] = eventosDeWebhook(
      webhook('messages', {
        metadata: METADATA,
        messages: [
          {
            from: '5491122334455',
            id: 'wamid.3',
            type: 'text',
            text: { body: 'Info' },
            referral: { source_id: '120200000', source_type: 'ad', source_url: 'https://fb.me/abc', headline: 'Sillón', body: 'Oferta' },
          },
        ],
      }),
    );
    expect(evento).toMatchObject({
      anuncio: { sourceId: '120200000', sourceType: 'ad', sourceUrl: 'https://fb.me/abc', titulo: 'Sillón', cuerpo: 'Oferta' },
    });
  });

  it('el eco de lo que el dueño escribió desde la app (coexistencia)', () => {
    const eventos = eventosDeWebhook(
      webhook('smb_message_echoes', {
        metadata: METADATA,
        message_echoes: [{ from: '5491100000000', to: '5491122334455', id: 'wamid.4', type: 'text', text: { body: 'Te atiendo yo' } }],
      }),
    );
    expect(eventos).toEqual([
      { tipo: 'eco', phoneNumberId: '5647382910', waId: 'wamid.4', remoteJid: '5491122334455@s.whatsapp.net', texto: 'Te atiendo yo' },
    ]);
  });

  it('la baja de Trato desde Meta', () => {
    expect(eventosDeWebhook(webhook('account_update', { event: 'PARTNER_REMOVED' }))).toEqual([
      { tipo: 'baja', wabaId: '1029384756' },
    ]);
    expect(eventosDeWebhook(webhook('account_update', { event: 'VERIFIED_ACCOUNT' }))).toEqual([]);
  });

  it('ignora estados, historial, tipos que no contesta y formas raras', () => {
    expect(eventosDeWebhook(webhook('messages', { metadata: METADATA, statuses: [{ id: 'wamid.5', status: 'read' }] }))).toEqual([]);
    expect(eventosDeWebhook(webhook('history', { metadata: METADATA, history: [{ threads: [] }] }))).toEqual([]);
    expect(
      eventosDeWebhook(webhook('messages', { metadata: METADATA, messages: [{ from: '5491122334455', id: 'wamid.6', type: 'sticker', sticker: { id: '1' } }] })),
    ).toEqual([]);
    expect(
      eventosDeWebhook(webhook('messages', { metadata: METADATA, messages: [{ from: 'no-es-numero', id: 'wamid.7', type: 'text', text: { body: 'x' } }] })),
    ).toEqual([]);
    expect(eventosDeWebhook(webhook('messages', { messages: [{ from: '5491122334455', id: 'w', type: 'text', text: { body: 'x' } }] }))).toEqual([]);
    expect(eventosDeWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(eventosDeWebhook(null)).toEqual([]);
  });
});
