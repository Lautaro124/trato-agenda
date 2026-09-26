import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { CABECERAS_DE_SEGURIDAD, cabecerasDeSeguridad } from './security-headers.js';

describe('cabecerasDeSeguridad', () => {
  it('pone todas las cabeceras y sigue con la cadena', () => {
    const setHeader = vi.fn();
    const next = vi.fn() as NextFunction;

    cabecerasDeSeguridad()({} as Request, { setHeader } as unknown as Response, next);

    for (const [nombre, valor] of Object.entries(CABECERAS_DE_SEGURIDAD)) {
      expect(setHeader).toHaveBeenCalledWith(nombre, valor);
    }
    expect(next).toHaveBeenCalledOnce();
  });

  it('prohíbe embeber la API en un iframe', () => {
    expect(CABECERAS_DE_SEGURIDAD['X-Frame-Options']).toBe('DENY');
    expect(CABECERAS_DE_SEGURIDAD['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });
});
