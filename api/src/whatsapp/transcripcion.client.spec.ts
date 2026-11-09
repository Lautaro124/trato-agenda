import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLITICA_DE_PROVEEDOR } from '../agents/openrouter.client.js';
import type { Env } from '../config/env.js';
import {
  MAX_SEGUNDOS_AUDIO,
  MODELO_TRANSCRIPCION,
  TranscripcionClient,
  TranscripcionError,
  formatoDeAudio,
  plazoDeTranscripcion,
} from './transcripcion.client.js';

function cliente(apiKey = 'clave') {
  const valores: Record<string, string> = { OPENROUTER_API_KEY: apiKey, OPENROUTER_BASE_URL: 'https://openrouter.test/api/v1' };
  return new TranscripcionClient({ get: (clave: string) => valores[clave] } as unknown as ConfigService<Env, true>);
}

describe('TranscripcionClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('manda el audio en base64 con whisper turbo, español y la política ZDR', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '  hola  ' })));
    vi.stubGlobal('fetch', fetch);

    await expect(cliente().transcribir(Buffer.from('opus'), 'ogg')).resolves.toBe('hola');

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://openrouter.test/api/v1/audio/transcriptions');
    expect(JSON.parse(init.body)).toEqual({
      model: MODELO_TRANSCRIPCION,
      input_audio: { data: Buffer.from('opus').toString('base64'), format: 'ogg' },
      language: 'es',
      provider: POLITICA_DE_PROVEEDOR,
    });
  });

  it('un error HTTP no arrastra el cuerpo del proveedor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('lo que dijo el cliente', { status: 500 })));

    const error = await cliente().transcribir(Buffer.from('x'), 'ogg').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TranscripcionError);
    expect((error as Error).message).not.toContain('lo que dijo');
  });

  it('sin OPENROUTER_API_KEY no llama a nadie', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(cliente('').transcribir(Buffer.from('x'), 'ogg')).rejects.toBeInstanceOf(TranscripcionError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('formatoDeAudio', () => {
  it('traduce los mimetypes de WhatsApp', () => {
    expect(formatoDeAudio('audio/ogg; codecs=opus')).toBe('ogg');
    expect(formatoDeAudio('audio/mpeg')).toBe('mp3');
    expect(formatoDeAudio('audio/mp4')).toBe('m4a');
    expect(formatoDeAudio(undefined)).toBe('ogg');
    expect(formatoDeAudio('video/mp4')).toBeUndefined();
    expect(formatoDeAudio('__proto__')).toBeUndefined();
  });
});

describe('plazoDeTranscripcion', () => {
  it('da 30 s a un audio corto y unos 5 min a uno de 1 h 30 min', () => {
    expect(plazoDeTranscripcion(0)).toBe(30_000);
    expect(plazoDeTranscripcion(MAX_SEGUNDOS_AUDIO)).toBe(300_000);
  });

  it('no se estira con una duración declarada más allá del tope ni negativa', () => {
    expect(plazoDeTranscripcion(MAX_SEGUNDOS_AUDIO * 100)).toBe(plazoDeTranscripcion(MAX_SEGUNDOS_AUDIO));
    expect(plazoDeTranscripcion(-10)).toBe(30_000);
    expect(plazoDeTranscripcion(Number.NaN)).toBe(30_000);
  });
});
