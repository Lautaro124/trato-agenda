import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.js';
import { MetaGraphClient } from './meta-graph.client.js';

const config = { get: (clave: string) => (clave === 'META_GRAPH_URL' ? 'https://graph.example' : 'x') } as unknown as ConfigService<Env, true>;

function conNumeros(numeros: object[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: numeros }), { status: 200 })));
}

describe('MetaGraphClient.numeroDeWaba', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('devuelve el número verificado de esa WABA, sin el +', async () => {
    conNumeros([{ id: '22', display_phone_number: '+54 9 11 2233-4455', code_verification_status: 'VERIFIED' }]);
    await expect(new MetaGraphClient(config).numeroDeWaba('t', '11', '22')).resolves.toEqual({ id: '22', telefono: '5491122334455' });
  });

  it('un número agregado sin verificar no prueba que se lo controla', async () => {
    conNumeros([{ id: '22', display_phone_number: '+5491122334455', code_verification_status: 'NOT_VERIFIED' }]);
    await expect(new MetaGraphClient(config).numeroDeWaba('t', '11', '22')).resolves.toBeNull();
    conNumeros([{ id: '22', display_phone_number: '+5491122334455' }]);
    await expect(new MetaGraphClient(config).numeroDeWaba('t', '11', '22')).resolves.toBeNull();
  });

  it('otro phone_number_id de la WABA no sirve', async () => {
    conNumeros([{ id: '33', display_phone_number: '+5491122334455', code_verification_status: 'VERIFIED' }]);
    await expect(new MetaGraphClient(config).numeroDeWaba('t', '11', '22')).resolves.toBeNull();
  });
});
