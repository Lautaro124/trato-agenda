import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { EmailService } from './email.service.js';

function crear(valores: Partial<Env>) {
  const config = {
    get: (clave: keyof Env) =>
      ({ NODE_ENV: 'production', EMAIL_API_KEY: '', EMAIL_FROM: 'Trato <a@b.com>', EMAIL_API_URL: 'https://api.resend.com', ...valores })[
        clave as 'NODE_ENV'
      ],
  } as unknown as ConfigService<Env, true>;
  return new EmailService(config);
}

const EMAIL = { para: 'Titular@Ejemplo.com', asunto: 'Asunto', texto: 'Tu código es 123456 <b>' };

describe('EmailService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('en producción sin API key no está disponible y no manda nada', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const service = crear({});

    expect(service.disponible()).toBe(false);
    await expect(service.enviar(EMAIL)).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(service.ultimoDev(EMAIL.para)).toBeNull();
  });

  it('fuera de producción sin API key lo guarda para los E2E', async () => {
    const service = crear({ NODE_ENV: 'development' });

    expect(service.disponible()).toBe(true);
    await expect(service.enviar(EMAIL)).resolves.toBe(true);
    expect(service.ultimoDev('titular@ejemplo.com')).toMatchObject({ texto: EMAIL.texto });
  });

  it('con API key lo manda a Resend con el remitente configurado y el HTML escapado', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetch);
    const service = crear({ EMAIL_API_KEY: 're_test' });

    await expect(service.enviar(EMAIL)).resolves.toBe(true);

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    const cuerpo = JSON.parse(String(init.body)) as { from: string; to: string[]; html: string };
    expect(cuerpo.from).toBe('Trato <a@b.com>');
    expect(cuerpo.to).toEqual([EMAIL.para]);
    expect(cuerpo.html).toContain('&lt;b&gt;');
  });

  it('un rechazo o un corte del proveedor da false y no lanza', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    await expect(crear({ EMAIL_API_KEY: 're_test' }).enviar(EMAIL)).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(crear({ EMAIL_API_KEY: 're_test' }).enviar(EMAIL)).resolves.toBe(false);
  });
});
