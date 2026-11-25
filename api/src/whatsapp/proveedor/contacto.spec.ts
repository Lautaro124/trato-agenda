import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { claveDelId, elegirChat, formasDelId, idDeWhatsapp, resolverChat } from './contacto.js';

describe('idDeWhatsapp', () => {
  it.each([
    ['5491122334455', '5491122334455'],
    ['+54 9 11 2233-4455', '5491122334455'],
    ['(54) 9 11 2233 4455', '5491122334455'],
  ])('%s → %s', (crudo, esperado) => {
    expect(idDeWhatsapp(crudo)).toBe(esperado);
  });

  it.each([null, undefined, '', '1234567', '1234567890123456', '54911abc4455', '5491122334455@s.whatsapp.net'])(
    'rechaza %s',
    (crudo) => {
      expect(idDeWhatsapp(crudo)).toBeNull();
    },
  );
});

describe('formasDelId y claveDelId', () => {
  it('Argentina: con y sin el 9 son el mismo cliente', () => {
    expect(formasDelId('5491122334455')).toEqual(['5491122334455', '541122334455']);
    expect(formasDelId('541122334455')).toEqual(['5491122334455', '541122334455']);
    expect(claveDelId('5491122334455')).toBe(claveDelId('541122334455'));
  });

  it('México: con y sin el 1 de los móviles viejos', () => {
    expect(claveDelId('5215512345678')).toBe(claveDelId('525512345678'));
  });

  it('el 15 y el 0 no se sacan: no son parte de un id de WhatsApp', () => {
    expect(claveDelId('54915112233445')).not.toBe(claveDelId('5491122334455'));
    expect(claveDelId('5401122334455')).not.toBe(claveDelId('541122334455'));
  });

  it('otro país queda tal cual', () => {
    expect(formasDelId('34612345678')).toEqual(['34612345678']);
  });
});

describe('elegirChat', () => {
  const jid = (id: string) => ({ remoteJid: `${id}@s.whatsapp.net`, telefono: null });

  it('asocia al chat de Baileys con el mismo número, escrito con o sin el 9', () => {
    expect(elegirChat('541122334455', [jid('5491122334455')])).toEqual({
      tipo: 'existente',
      chat: '5491122334455@s.whatsapp.net',
    });
  });

  it('asocia a un chat LID por el número que WhatsApp dio aparte', () => {
    const lid = { remoteJid: '123456789012345@lid', telefono: '5491122334455' };
    expect(elegirChat('5491122334455', [lid])).toEqual({ tipo: 'existente', chat: '123456789012345@lid' });
  });

  it('un LID sin número no se asocia por conjetura: el cliente queda como chat nuevo', () => {
    const lid = { remoteJid: '123456789012345@lid', telefono: null };
    expect(elegirChat('5491122334455', [lid])).toEqual({ tipo: 'nuevo', chat: '5491122334455@s.whatsapp.net' });
  });

  it('dos chats del mismo número no se eligen a ojo', () => {
    const lid = { remoteJid: '123456789012345@lid', telefono: '5491122334455' };
    expect(elegirChat('5491122334455', [jid('5491122334455'), lid])).toEqual({ tipo: 'ambiguo' });
  });

  it('un número parecido no es el mismo cliente', () => {
    expect(elegirChat('5491122334456', [jid('5491122334455')])).toEqual({
      tipo: 'nuevo',
      chat: '5491122334456@s.whatsapp.net',
    });
  });

  it('un id que no es un número no resuelve nada', () => {
    expect(elegirChat('hola', [jid('5491122334455')])).toEqual({ tipo: 'invalido' });
  });
});

describe('resolverChat', () => {
  it('busca sólo en los chats del comercio, por las dos formas del número', async () => {
    const findMany = vi.fn().mockResolvedValue([{ remoteJid: '5491122334455@s.whatsapp.net', telefono: null }]);
    const db = { conversation: { findMany } } as unknown as PrismaClient;

    const resolucion = await resolverChat(db, 'user-1', '+54 11 2233-4455');

    expect(resolucion).toEqual({ tipo: 'existente', chat: '5491122334455@s.whatsapp.net' });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        OR: [
          { remoteJid: { in: ['5491122334455@s.whatsapp.net', '541122334455@s.whatsapp.net'] } },
          { telefono: { in: ['5491122334455', '541122334455'] } },
        ],
      },
      select: { remoteJid: true, telefono: true },
    });
  });

  it('con un id inválido ni consulta', async () => {
    const findMany = vi.fn();
    const db = { conversation: { findMany } } as unknown as PrismaClient;

    expect(await resolverChat(db, 'user-1', 'x')).toEqual({ tipo: 'invalido' });
    expect(findMany).not.toHaveBeenCalled();
  });
});
