import { describe, expect, it } from 'vitest';
import { eventosDelWebhook } from './webhook.js';

function cambio(field: string, value: Record<string, unknown>, wabaId = '102290129340398') {
  return { object: 'whatsapp_business_account', entry: [{ id: wabaId, changes: [{ field, value }] }] };
}

const METADATA = { display_phone_number: '15550783881', phone_number_id: '106540352242922' };

describe('eventosDelWebhook', () => {
  it('saca un texto con su remitente, id y fecha', () => {
    const eventos = eventosDelWebhook(
      cambio('messages', {
        messaging_product: 'whatsapp',
        metadata: METADATA,
        contacts: [{ wa_id: '5491122334455', profile: { name: 'Ana' } }],
        messages: [{ from: '5491122334455', id: 'wamid.A', timestamp: '1749416383', type: 'text', text: { body: 'Hola' } }],
      }),
    );
    expect(eventos).toEqual([
      {
        tipo: 'mensaje',
        phoneNumberId: '106540352242922',
        de: '5491122334455',
        id: 'wamid.A',
        enviadoEn: 1749416383000,
        contenido: { tipo: 'texto', texto: 'Hola' },
        anuncio: null,
      },
    ]);
  });

  it('saca audios e imágenes con su id de media, y el anuncio de clic a WhatsApp', () => {
    const eventos = eventosDelWebhook(
      cambio('messages', {
        metadata: METADATA,
        messages: [
          { from: '549', id: 'a', type: 'audio', audio: { id: '123', mime_type: 'audio/ogg; codecs=opus', voice: true } },
          {
            from: '549',
            id: 'b',
            type: 'image',
            image: { id: '456', mime_type: 'image/jpeg', caption: '¿Lo tenés?' },
            referral: { source_id: '120', source_type: 'ad', source_url: 'https://fb.me/x', headline: 'Sillón', body: 'Oferta' },
          },
        ],
      }),
    );
    expect(eventos.map((evento) => evento.tipo === 'mensaje' && evento.contenido)).toEqual([
      { tipo: 'audio', mediaId: '123', mime: 'audio/ogg; codecs=opus' },
      { tipo: 'imagen', mediaId: '456', mime: 'image/jpeg', caption: '¿Lo tenés?' },
    ]);
    expect(eventos[1]).toMatchObject({
      anuncio: { sourceId: '120', sourceType: 'ad', sourceUrl: 'https://fb.me/x', titulo: 'Sillón', cuerpo: 'Oferta' },
    });
  });

  it('no usa ids de media que no sean de Meta', () => {
    const eventos = eventosDelWebhook(
      cambio('messages', { metadata: METADATA, messages: [{ from: '549', id: 'a', type: 'image', image: { id: '../me' } }] }),
    );
    expect(eventos[0]).toMatchObject({ contenido: { tipo: 'otro' } });
  });

  it('ignora los estados de envío y lo que no es de WhatsApp Business', () => {
    expect(eventosDelWebhook(cambio('messages', { metadata: METADATA, statuses: [{ id: 'x', status: 'read' }] }))).toEqual([]);
    expect(eventosDelWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(eventosDelWebhook(null)).toEqual([]);
    expect(eventosDelWebhook(cambio('messages', { metadata: { phone_number_id: 'abc' }, messages: [{}] }))).toEqual([]);
  });

  it('saca lo que el dueño escribió desde la app con Coexistence', () => {
    const eventos = eventosDelWebhook(
      cambio('smb_message_echoes', {
        metadata: METADATA,
        message_echoes: [{ from: '15550783881', to: '5491122334455', id: 'wamid.E', timestamp: '1700000000', type: 'text', text: { body: 'Ya te atiendo' } }],
      }),
    );
    expect(eventos).toEqual([
      { tipo: 'eco', phoneNumberId: '106540352242922', para: '5491122334455', id: 'wamid.E', enviadoEn: 1700000000000, texto: 'Ya te atiendo' },
    ]);
  });

  it('avisa cuando el comercio desconectó a Trato', () => {
    expect(eventosDelWebhook(cambio('account_update', { event: 'PARTNER_REMOVED' }))).toEqual([
      { tipo: 'desconectado', wabaId: '102290129340398' },
    ]);
    expect(eventosDelWebhook(cambio('account_update', { event: 'VERIFIED_ACCOUNT' }))).toEqual([]);
  });
});
