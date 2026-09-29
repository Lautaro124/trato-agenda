import type { ErrorEvent } from '@sentry/nestjs';
import { describe, expect, it } from 'vitest';
import { MAX_TEXTO, limpiarBreadcrumb, limpiarEvento, limpiarSpan, limpiarTexto, sinQuery } from './scrubbing.js';

describe('limpiarTexto', () => {
  it.each([
    ['Fallo con +54 9 11 2233-4455', 'Fallo con [tel]'],
    ['jid 5491122334455@s.whatsapp.net', 'jid [email]'],
    ['numero 5491122334455 sin arroba', 'numero [tel] sin arroba'],
    ['mandale a ana@ejemplo.com', 'mandale a [email]'],
  ])('saca teléfonos y emails de %j', (entrada, esperado) => {
    expect(limpiarTexto(entrada)).toBe(esperado);
  });

  it('deja los ids cortos y las fechas', () => {
    expect(limpiarTexto('Venta 42 del 2026-09-29 a las 10:00')).toBe('Venta 42 del 2026-09-29 a las 10:00');
  });

  it('recorta los textos largos (un error de proveedor puede repetir el prompt)', () => {
    expect(limpiarTexto('a'.repeat(MAX_TEXTO * 2))).toHaveLength(MAX_TEXTO + 1);
  });
});

describe('sinQuery', () => {
  it('saca la query de las URLs dentro del texto', () => {
    expect(sinQuery('POST https://oauth2.googleapis.com/revoke?token=ya29.secreto')).toBe(
      'POST https://oauth2.googleapis.com/revoke',
    );
    expect(sinQuery('/auth/dev/ultimo-codigo?telefono=5491122334455')).toBe('/auth/dev/ultimo-codigo');
  });
});

describe('limpiarEvento', () => {
  it('deja del request sólo método, URL sin query y cabeceras inocuas', () => {
    const evento: ErrorEvent = {
      type: undefined,
      request: {
        method: 'POST',
        url: 'https://api.tratoagenda.com/auth/whatsapp/login?x=1',
        headers: { cookie: 'trato_session=jwt', 'x-signature': 'abc', 'user-agent': 'Mozilla' },
        cookies: { trato_session: 'jwt' },
        data: { telefono: '5491122334455', password: 'secreta' },
        query_string: 'x=1',
      },
    };

    expect(limpiarEvento(evento).request).toEqual({
      method: 'POST',
      url: 'https://api.tratoagenda.com/auth/whatsapp/login',
      headers: { 'user-agent': 'Mozilla' },
    });
  });

  it('conserva sólo el id del usuario', () => {
    const evento: ErrorEvent = { type: undefined, user: { id: 'u1', email: 'ana@ejemplo.com', ip_address: '1.2.3.4' } };
    expect(limpiarEvento(evento).user).toEqual({ id: 'u1' });
  });

  it('limpia el mensaje y el valor de cada excepción', () => {
    const evento: ErrorEvent = {
      type: undefined,
      message: 'Fallo con 5491122334455',
      exception: { values: [{ type: 'Error', value: 'No se pudo mandar a ana@ejemplo.com' }] },
    };

    const limpio = limpiarEvento(evento);
    expect(limpio.message).toBe('Fallo con [tel]');
    expect(limpio.exception?.values?.[0]?.value).toBe('No se pudo mandar a [email]');
  });

  it('descarta los breadcrumbs de consola y saca la query de los de http', () => {
    const evento: ErrorEvent = {
      type: undefined,
      breadcrumbs: [
        { category: 'console', message: 'cualquier cosa' },
        { category: 'http', data: { url: 'https://oauth2.googleapis.com/revoke?token=ya29', 'http.query': 'token=ya29' } },
      ],
    };

    expect(limpiarEvento(evento).breadcrumbs).toEqual([
      { category: 'http', message: undefined, data: { url: 'https://oauth2.googleapis.com/revoke' } },
    ]);
  });

  it('saca las variables locales de los frames', () => {
    const evento: ErrorEvent = {
      type: undefined,
      exception: {
        values: [{ type: 'Error', stacktrace: { frames: [{ function: 'crear', vars: { texto: 'hola, soy Ana' } }] } }],
      },
    };

    expect(limpiarEvento(evento).exception?.values?.[0]?.stacktrace?.frames).toEqual([{ function: 'crear' }]);
  });

  it('no muta el evento original', () => {
    const evento: ErrorEvent = { type: undefined, message: 'tel 5491122334455' };
    limpiarEvento(evento);
    expect(evento.message).toBe('tel 5491122334455');
  });
});

describe('limpiarBreadcrumb', () => {
  it('limpia el mensaje de un breadcrumb que no es de consola', () => {
    expect(limpiarBreadcrumb({ category: 'app', message: 'aviso a 5491122334455' })?.message).toBe('aviso a [tel]');
  });
});

describe('limpiarSpan', () => {
  it('saca la query del nombre y de los atributos, en valor plano o con unidad', () => {
    const span = limpiarSpan({
      trace_id: '1',
      span_id: '2',
      name: 'POST https://oauth2.googleapis.com/revoke?token=ya29',
      start_timestamp: 0,
      status: 'ok',
      is_segment: false,
      attributes: {
        'url.full': 'https://oauth2.googleapis.com/revoke?token=ya29',
        'url.query': '?token=ya29',
        'http.target': { value: '/auth/dev/ultimo-codigo?telefono=5491122334455' },
        'http.response.status_code': 200,
      },
    });

    expect(span.name).toBe('POST https://oauth2.googleapis.com/revoke');
    expect(span.attributes).toEqual({
      'url.full': 'https://oauth2.googleapis.com/revoke',
      'http.target': { value: '/auth/dev/ultimo-codigo' },
      'http.response.status_code': 200,
    });
  });
});
