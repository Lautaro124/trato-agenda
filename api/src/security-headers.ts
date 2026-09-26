import type { NextFunction, Request, Response } from 'express';

/**
 * Cabeceras de seguridad para todas las respuestas de la API. Es una API JSON
 * (más el SSE de vinculación): nada de lo que devuelve tiene que renderizarse
 * como página ni embeberse en un iframe, así que la política es la más cerrada.
 * Sin helmet a propósito: son cuatro cabeceras fijas y no vale una dependencia.
 */
export const CABECERAS_DE_SEGURIDAD: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
};

export function cabecerasDeSeguridad() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    for (const [nombre, valor] of Object.entries(CABECERAS_DE_SEGURIDAD)) {
      res.setHeader(nombre, valor);
    }
    next();
  };
}
