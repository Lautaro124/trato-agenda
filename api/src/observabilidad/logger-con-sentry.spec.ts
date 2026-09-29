import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => {
  const scope = { setTag: vi.fn(), setExtra: vi.fn(), setFingerprint: vi.fn() };
  return {
    scope,
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    withScope: vi.fn((callback: (s: typeof scope) => void) => callback(scope)),
  };
});
vi.mock('@sentry/nestjs', () => sentry);

const { LoggerConSentry, huellaDeMensaje } = await import('./logger-con-sentry.js');

describe('LoggerConSentry', () => {
  beforeEach(() => {
    Logger.overrideLogger(new LoggerConSentry());
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('manda la excepción que acompaña a un logger.error de un servicio', () => {
    const error = new Error('se cayó Baileys');
    new Logger('WhatsappService').error('Fallo procesando mensajes entrantes de u1', error);

    expect(sentry.captureException).toHaveBeenCalledWith(error);
    expect(sentry.scope.setTag).toHaveBeenCalledWith('contexto', 'WhatsappService');
    expect(sentry.scope.setExtra).toHaveBeenCalledWith('mensaje', 'Fallo procesando mensajes entrantes de u1');
  });

  it('sin excepción manda el mensaje, agrupado sin los ids', () => {
    new Logger('ConciliacionService').error('Falló la conciliación de ventas: timeout 30000');

    expect(sentry.captureMessage).toHaveBeenCalledWith('Falló la conciliación de ventas: timeout 30000', 'error');
    expect(sentry.scope.setFingerprint).toHaveBeenCalledWith([
      'ConciliacionService',
      'Falló la conciliación de ventas: timeout <n>',
    ]);
  });

  it('no repite lo que ya reportó SentryGlobalFilter', () => {
    new Logger('ExceptionsHandler').error('boom', 'stack');

    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
});

describe('huellaDeMensaje', () => {
  it('iguala mensajes que sólo difieren en el id', () => {
    expect(huellaDeMensaje('El grafo falló en la conversación cmg1a2b3c4d5e6f7g8h9i0j1k')).toBe(
      huellaDeMensaje('El grafo falló en la conversación cmgz9y8x7w6v5u4t3s2r1q0p9'),
    );
    expect(huellaDeMensaje('Venta 3f2b8c1e-1d2a-4b5c-8d9e-0a1b2c3d4e5f')).toBe('Venta <id>');
  });
});
