import { describe, expect, it } from 'vitest';
import { esZona, zonaDeCodigoPostal, zonaDeDatosCliente, zonaDeJid, zonaDeTexto } from './zona.rules.js';

describe('zonaDeTexto', () => {
  it('reconoce la provincia sin importar tildes, mayúsculas ni lo que la rodee', () => {
    expect(zonaDeTexto('Córdoba')).toBe('cordoba');
    expect(zonaDeTexto('  ENTRE RIOS ')).toBe('entre_rios');
    expect(zonaDeTexto('Neuquén capital')).toBe('neuquen');
    expect(zonaDeTexto('Bs. As.')).toBe('buenos_aires');
  });

  it('la Ciudad no se confunde con la provincia de Buenos Aires', () => {
    expect(zonaDeTexto('Ciudad Autónoma de Buenos Aires')).toBe('caba');
    expect(zonaDeTexto('Capital Federal')).toBe('caba');
    expect(zonaDeTexto('Provincia de Buenos Aires')).toBe('buenos_aires');
  });

  it('lo que no nombra una provincia queda sin zona', () => {
    expect(zonaDeTexto('capital')).toBeNull();
    expect(zonaDeTexto('Montevideo')).toBeNull();
    expect(zonaDeTexto('')).toBeNull();
    // "santa" sola no es Santa Fe ni Santa Cruz.
    expect(zonaDeTexto('santa')).toBeNull();
  });
});

describe('zonaDeCodigoPostal', () => {
  it('la letra del CPA es la provincia', () => {
    expect(zonaDeCodigoPostal('C1414BAD')).toBe('caba');
    expect(zonaDeCodigoPostal('x5000')).toBe('cordoba');
    expect(zonaDeCodigoPostal('S2000 ABC')).toBe('santa_fe');
  });

  it('de los números sólo se lee la Ciudad', () => {
    expect(zonaDeCodigoPostal('1414')).toBe('caba');
    expect(zonaDeCodigoPostal('5000')).toBeNull();
    expect(zonaDeCodigoPostal('I1234')).toBeNull();
  });
});

describe('zonaDeDatosCliente', () => {
  it('la provincia escrita gana sobre el código postal', () => {
    expect(
      zonaDeDatosCliente([
        { etiqueta: 'Código postal', valor: 'C1414BAD' },
        { etiqueta: 'Provincia', valor: 'Mendoza' },
      ]),
    ).toBe('mendoza');
    expect(zonaDeDatosCliente([{ etiqueta: 'Código postal', valor: 'X5000' }])).toBe('cordoba');
  });

  it('un país que no es Argentina no tiene provincia argentina', () => {
    expect(
      zonaDeDatosCliente([
        { etiqueta: 'País', valor: 'Uruguay' },
        { etiqueta: 'Provincia', valor: 'Salta' },
      ]),
    ).toBeNull();
    expect(zonaDeDatosCliente([{ etiqueta: 'Dirección', valor: 'Corrientes 1234' }])).toBeNull();
  });
});

describe('zonaDeJid', () => {
  it('sale de la característica, la más larga primero', () => {
    expect(zonaDeJid('5493511234567@s.whatsapp.net')).toBe('cordoba');
    expect(zonaDeJid('5493541123456@s.whatsapp.net')).toBe('cordoba');
    expect(zonaDeJid('5492954123456@s.whatsapp.net')).toBe('la_pampa');
    expect(zonaDeJid('5491122334455@s.whatsapp.net')).toBe('amba');
  });

  it('sin zona para otros países, fijos, ids que no son números o características que no conoce', () => {
    expect(zonaDeJid('59899123456@s.whatsapp.net')).toBeNull();
    expect(zonaDeJid('541143210000@s.whatsapp.net')).toBeNull();
    expect(zonaDeJid('123456789012345@lid')).toBeNull();
    expect(zonaDeJid('web-test:user-1')).toBeNull();
    expect(zonaDeJid('5492202123456@s.whatsapp.net')).toBe('buenos_aires');
    expect(zonaDeJid('5492999123456@s.whatsapp.net')).toBe('neuquen');
    expect(zonaDeJid('5493999123456@s.whatsapp.net')).toBeNull();
  });
});

describe('esZona', () => {
  it('no acepta claves heredadas de Object', () => {
    expect(esZona('cordoba')).toBe(true);
    expect(esZona('constructor')).toBe(false);
    expect(esZona('__proto__')).toBe(false);
  });
});
