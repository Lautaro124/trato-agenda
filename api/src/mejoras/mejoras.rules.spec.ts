import { describe, expect, it } from 'vitest';
import {
  MAX_CARACTERES,
  MAX_LINEAS,
  descripcionParaLinear,
  esTipoSugerencia,
  normalizarTexto,
  tituloParaLinear,
  validarSugerencia,
} from './mejoras.rules.js';

const LINK = 'Sacá el link: acá va solo texto. Si no es un link, dejá un espacio después del punto.';

function rechaza(texto: string): string {
  const resultado = validarSugerencia(texto);
  if (resultado.ok) throw new Error(`Se esperaba rechazo para ${JSON.stringify(texto)}`);
  return resultado.error;
}

describe('validarSugerencia', () => {
  it('acepta texto común con tildes, ñ, números y puntuación', () => {
    const texto = '¿Podrían agregar recordatorios? Me pasa que el 30% de mis clientes se olvida (sobre todo los lunes).';
    expect(validarSugerencia(texto)).toEqual({ ok: true, texto });
    expect(validarSugerencia('Año nuevo: cerrar la agenda el 1° de enero, ¡gracias!').ok).toBe(true);
  });

  it('acepta las comillas y rayas que pone el teclado del celular', () => {
    expect(validarSugerencia('Que el bot diga “ya te lo agendé” — y listo… ‘gracias’ – fin').ok).toBe(true);
  });

  it('rechaza teléfonos y documentos, pero no números cortos', () => {
    const datos = 'No pongas teléfonos, documentos ni datos de clientes: contanos sólo la idea.';
    expect(rechaza('Que muestre mi tel: 11 4444 5555 en el saludo')).toBe(datos);
    expect(rechaza('Mi DNI es 30-123-456 por si sirve')).toBe(datos);
    expect(rechaza('Mi DNI es 30.123.456 por si sirve')).toBe(datos);
    expect(rechaza('Llamen al 11,4444,5555 cuando puedan')).toBe(datos);
    expect(validarSugerencia('Que avise 24 horas antes, o 2 días, para el 30% que se olvida').ok).toBe(true);
  });

  it('convierte el espacio duro de un copiar y pegar en espacio común', () => {
    expect(validarSugerencia('Texto\u00A0con espacio duro')).toEqual({ ok: true, texto: 'Texto con espacio duro' });
  });

  it('normaliza antes de validar', () => {
    expect(validarSugerencia('  Hola\r\n\r\n\r\n\r\nmundo  feliz\t!  ')).toEqual({
      ok: true,
      texto: 'Hola\n\nmundo  feliz !',
    });
  });

  it('rechaza HTML', () => {
    expect(rechaza('Me gustaría <b>negritas</b> en el chat')).toContain('«<»');
    expect(rechaza('Probá esto &lt;script&gt; por favor')).toContain('«&»');
  });

  it('rechaza markdown que Linear renderiza', () => {
    expect(rechaza('Miren [esto] que está bueno')).toContain('«[»');
    expect(rechaza('Quiero **negritas** en todo')).toContain('«*»');
    expect(rechaza('Un título # grande por favor')).toContain('«#»');
    expect(rechaza('Código `inline` en el chat')).toContain('«`»');
  });

  it('rechaza links, mails y dominios', () => {
    expect(rechaza('Miren https://trato.com por favor')).toContain('«/»');
    expect(rechaza('Escribanme a yo@gmail.com cuando puedan')).toContain('«@»');
    expect(rechaza('Como hace trato.com con los turnos')).toBe('Sacá el link: acá va solo texto. Si no es un link, dejá un espacio después del punto.');
    expect(rechaza('Mandame por wa.me que es más fácil')).toBe('Sacá el link: acá va solo texto. Si no es un link, dejá un espacio después del punto.');
    expect(rechaza('Entren a www.algo que ahí lo explica')).toBe('Sacá el link: acá va solo texto. Si no es un link, dejá un espacio después del punto.');
    expect(rechaza('Igual que BIT.LY para acortar')).toBe('Sacá el link: acá va solo texto. Si no es un link, dejá un espacio después del punto.');
    expect(rechaza('Prueben javascript:alert(1) en el chat')).toBe('Sacá el link: acá va solo texto. Si no es un link, dejá un espacio después del punto.');
    expect(rechaza('Prueben http: sin barras igual')).toBe('Sacá el link: acá va solo texto. Si no es un link, dejá un espacio después del punto.');
  });

  it('rechaza cualquier dominio pegado, no sólo los TLDs conocidos, y las IP', () => {
    expect(rechaza('Miren evil.zip que está bueno')).toBe(LINK);
    expect(rechaza('Miren evil.ru que está bueno')).toBe(LINK);
    expect(rechaza('Entren a 192.168.1.1 desde la casa')).toBe(LINK);
    // El costo: un punto sin espacio después se toma como link, y el error lo explica.
    expect(rechaza('Está todo bien.Como digo siempre')).toBe(LINK);
  });

  it('una abreviatura no sirve para colar un dominio', () => {
    expect(rechaza('Miren p.ej.cc que está bueno')).toBe(LINK);
    expect(rechaza('Miren s.a.ru que está bueno')).toBe(LINK);
    expect(rechaza('Miren ee.uu.xyz que está bueno')).toBe(LINK);
    expect(rechaza('Miren p.ej.evil.com que está bueno')).toBe(LINK);
    expect(rechaza('Miren evil-s.a.com que está bueno')).toBe(LINK);
    expect(validarSugerencia('Algo así, p.ej. el día antes').ok).toBe(true);
  });

  it('acepta el punto con espacio y las abreviaturas comunes', () => {
    expect(validarSugerencia('Me gusta. Comer temprano también.').ok).toBe(true);
    expect(validarSugerencia('Algo como p.ej. recordatorios, igual que en EE.UU. y en una S.R.L.').ok).toBe(true);
    expect(validarSugerencia('Que cobre $ 1.500 la seña, no 2.000').ok).toBe(true);
  });

  it('acepta sólo dígitos comunes', () => {
    expect(rechaza('Que avise ½ hora antes del turno')).toContain('«½»');
    expect(rechaza('Llamen al ٠١٢٣٤٥٦٧٨ por favor')).toContain('«٠»');
  });

  it('acepta sólo letras latinas', () => {
    expect(rechaza('Hola مرحبا a todos los clientes')).toContain('«م»');
    expect(validarSugerencia('Être plus rapide, ça serait génial ñandú').ok).toBe(true);
  });

  it('rechaza emojis y símbolos', () => {
    expect(rechaza('Me encanta la app 😍 de verdad')).toContain('«😍»');
    expect(rechaza('Precio + envío = total')).toContain('«+»');
  });

  it('rechaza caracteres invisibles y de dirección sin mostrarlos', () => {
    expect(rechaza('Texto con zero\u200Bwidth adentro')).toContain('invisible');
    expect(rechaza('Texto con \u202Ebidi override')).toContain('invisible');
    expect(rechaza('Texto con \u0000 nulo adentro')).toContain('invisible');
  });

  it('controla el largo y las líneas', () => {
    expect(rechaza('corto')).toContain('al menos');
    expect(rechaza('a'.repeat(MAX_CARACTERES + 1))).toContain('muy larga');
    expect(validarSugerencia('a'.repeat(MAX_CARACTERES)).ok).toBe(true);
    expect(rechaza(Array.from({ length: MAX_LINEAS + 1 }, () => 'línea').join('\n'))).toContain('líneas');
  });
});

describe('normalizarTexto', () => {
  it('compone los acentos en NFC', () => {
    expect(normalizarTexto('café')).toBe('café');
  });
});

describe('esTipoSugerencia', () => {
  it('solo acepta los tres tipos', () => {
    expect(esTipoSugerencia('idea')).toBe(true);
    expect(esTipoSugerencia('otro')).toBe(true);
    expect(esTipoSugerencia('Idea')).toBe(false);
    expect(esTipoSugerencia(1)).toBe(false);
  });
});

describe('título y descripción del issue', () => {
  it('arma el título en una línea y lo corta', () => {
    expect(tituloParaLinear('idea', 'Recordatorios\nel día antes')).toBe('Sugerencia · Idea: Recordatorios el día antes');
    const largo = tituloParaLinear('problema', 'x'.repeat(100));
    expect(largo).toBe(`Sugerencia · Problema: ${'x'.repeat(60)}…`);
  });

  it('la descripción lleva solo el id de la cuenta', () => {
    expect(descripcionParaLinear('otro', 'Hola mundo', 'u1')).toBe('Hola mundo\n\n---\nTipo: Otra · Cuenta: u1');
  });
});
