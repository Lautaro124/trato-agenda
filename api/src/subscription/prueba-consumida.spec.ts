import { describe, expect, it } from 'vitest';
import { huellasDeIdentidad, inicioDePrueba } from './prueba-consumida.js';

const CLAVE = 'ab'.repeat(32);
const sinNada = { googleId: null, email: null, phoneNumber: null };

describe('huellasDeIdentidad', () => {
  it('es estable y no contiene el dato legible', () => {
    const [, huella] = huellasDeIdentidad({ ...sinNada, googleId: 'g1', email: 'Ana@Mail.com' }, CLAVE);
    expect(huellasDeIdentidad({ ...sinNada, googleId: 'g1', email: 'ana@mail.com' }, CLAVE)[1]).toEqual(huella);
    expect(huella).not.toContain('ana');
  });

  it('un mail sin Google (tipeado en el checkout) no deja huella', () => {
    expect(huellasDeIdentidad({ ...sinNada, email: 'victima@mail.com' }, CLAVE)).toEqual([]);
  });

  it('las formas de escribir el mismo teléfono dan la misma huella', () => {
    const a = huellasDeIdentidad({ ...sinNada, phoneNumber: '5491122334455' }, CLAVE);
    const b = huellasDeIdentidad({ ...sinNada, phoneNumber: '541122334455' }, CLAVE);
    expect(a).toEqual(b);
  });

  it('cambia con la clave y no genera huella para cuentas dev ni vacías', () => {
    expect(huellasDeIdentidad({ ...sinNada, phoneNumber: '5491122334455' }, 'cd'.repeat(32))).not.toEqual(
      huellasDeIdentidad({ ...sinNada, phoneNumber: '5491122334455' }, CLAVE),
    );
    expect(huellasDeIdentidad({ ...sinNada, googleId: 'dev:a@b.com' }, CLAVE)).toEqual([]);
    expect(huellasDeIdentidad(sinNada, CLAVE)).toEqual([]);
  });

  it('una huella por identidad presente', () => {
    expect(huellasDeIdentidad({ googleId: 'g1', email: 'a@b.com', phoneNumber: '5491122334455' }, CLAVE)).toHaveLength(3);
  });
});

describe('inicioDePrueba', () => {
  it('toma el más antiguo entre el alta y las lápidas', () => {
    const hoy = new Date('2026-10-20T00:00:00Z');
    const viejo = new Date('2026-09-21T00:00:00Z');
    expect(inicioDePrueba(hoy, [])).toEqual(hoy);
    expect(inicioDePrueba(hoy, [viejo, new Date('2026-10-01T00:00:00Z')])).toEqual(viejo);
  });
});
