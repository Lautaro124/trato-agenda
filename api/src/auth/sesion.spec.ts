import { describe, expect, it, vi } from 'vitest';
import { destinoTrasLogin } from './sesion.js';

const conAgente = { findByUserId: vi.fn().mockResolvedValue({ id: 'agent-1' }) };
const sinAgente = { findByUserId: vi.fn().mockResolvedValue(null) };

describe('destinoTrasLogin', () => {
  it('una cuenta de WhatsApp sin contraseña la elige primero, tenga agente o no', async () => {
    const user = { id: 'u', googleId: null, phoneNumber: '549', passwordHash: null };

    expect(await destinoTrasLogin(conAgente, user)).toBe('/contrasena');
    expect(await destinoTrasLogin(sinAgente, user)).toBe('/contrasena');
  });

  it('con contraseña, o con Google, sigue al onboarding o a la Home', async () => {
    const conPassword = { id: 'u', googleId: null, phoneNumber: '549', passwordHash: 'scrypt$...' };
    const deGoogle = { id: 'u', googleId: 'g-1', phoneNumber: '549', passwordHash: null };

    expect(await destinoTrasLogin(conAgente, conPassword)).toBe('/inicio');
    expect(await destinoTrasLogin(sinAgente, deGoogle)).toBe('/contanos');
  });
});
