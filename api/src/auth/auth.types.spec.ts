import { describe, expect, it } from 'vitest';
import type { User } from '../generated/prisma/client.js';
import { aUsuarioPublico } from './auth.types.js';

function usuario(parcial: Partial<User>): User {
  return {
    id: 'user-1',
    googleId: null,
    email: null,
    name: null,
    avatarUrl: null,
    phoneNumber: '5491122334455',
    emailRecuperacion: null,
    emailVerificadoAt: null,
    passwordHash: 'scrypt$x',
    calendario: 'local',
    tutorialesVistos: [],
    ...parcial,
  } as User;
}

describe('aUsuarioPublico: email de recuperación (LAU-109)', () => {
  it('una cuenta de WhatsApp sin email ni Google tiene que sumarlo si hay proveedor', () => {
    expect(aUsuarioPublico(usuario({}), null, { emailDisponible: true })).toMatchObject({
      puedeSumarEmailRecuperacion: true,
      debeSumarEmailRecuperacion: true,
      emailRecuperacion: null,
    });
  });

  it('sin proveedor de email no se le ofrece nada', () => {
    expect(aUsuarioPublico(usuario({}))).toMatchObject({
      puedeSumarEmailRecuperacion: false,
      debeSumarEmailRecuperacion: false,
    });
  });

  it('con el email ya verificado o con Google no muestra el aviso', () => {
    const conEmail = aUsuarioPublico(usuario({ emailRecuperacion: 'a@b.com' }), null, { emailDisponible: true });
    const conGoogle = aUsuarioPublico(usuario({ googleId: 'g-1' }), null, { emailDisponible: true });

    expect(conEmail).toMatchObject({ debeSumarEmailRecuperacion: false, emailRecuperacion: 'a@b.com' });
    expect(conGoogle).toMatchObject({ debeSumarEmailRecuperacion: false, puedeSumarEmailRecuperacion: true });
  });

  it('una cuenta sólo de Google no tiene número con el que recuperar', () => {
    expect(
      aUsuarioPublico(usuario({ googleId: 'g-1', phoneNumber: null }), null, { emailDisponible: true }),
    ).toMatchObject({ puedeSumarEmailRecuperacion: false, debeSumarEmailRecuperacion: false });
  });
});
