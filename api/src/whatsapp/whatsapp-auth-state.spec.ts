/**
 * Reglas puras de las credenciales. Lo que se guarda en Postgres (una fila
 * por clave, la migración del blob viejo) está en whatsapp-auth-state.db.spec.ts.
 */
import { initAuthCreds, type AuthenticationCreds } from '@whiskeysockets/baileys';
import { describe, expect, it } from 'vitest';
import { estaVinculado, extraerTelefono } from './whatsapp-auth-state.js';

describe('extraerTelefono', () => {
  it('se queda con el número, sin el dispositivo ni el dominio', () => {
    const creds = { ...initAuthCreds(), me: { id: '5491155551234:7@s.whatsapp.net' } };
    expect(extraerTelefono(creds)).toBe('5491155551234');
  });

  it('prefiere el número en formato PN cuando Baileys sólo tiene el LID en `id`', () => {
    const creds = { ...initAuthCreds(), me: { id: '1234567890:7@lid', phoneNumber: '5491155551234@s.whatsapp.net' } };
    expect(extraerTelefono(creds)).toBe('5491155551234');
  });
});

describe('estaVinculado', () => {
  const me = { id: '5491155551234:1@s.whatsapp.net', name: '~' };
  const creds = (cambios: Partial<AuthenticationCreds>): AuthenticationCreds => ({ ...initAuthCreds(), ...cambios });

  it('sin `me` no hay vinculación', () => {
    expect(estaVinculado(creds({}))).toBe(false);
  });

  it('con QR alcanza con `me`: Baileys nunca marca `registered`', () => {
    expect(estaVinculado(creds({ me }))).toBe(true);
  });

  it('con un código pendiente no está vinculado aunque `me` ya tenga el número', () => {
    expect(estaVinculado(creds({ me, pairingCode: 'ABCD1234', registered: false }))).toBe(false);
  });

  it('con el código confirmado (`registered`) sí', () => {
    expect(estaVinculado(creds({ me, pairingCode: 'ABCD1234', registered: true }))).toBe(true);
  });
});
