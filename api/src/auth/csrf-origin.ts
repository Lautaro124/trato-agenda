import type { NextFunction, Request, Response } from 'express';

/** Métodos que no cambian estado: no hace falta mirarles el Origin. */
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * ¿Puede este `Origin` mandar una request que cambia estado?
 *
 * En producción la cookie de sesión va con `sameSite: 'none'` (front y API
 * viven en dominios distintos), así que el browser ya no filtra los pedidos
 * cross-site: cualquier página podría hacer un `POST /whatsapp/unlink` con la
 * sesión de la víctima adentro. Un POST sin preflight (form o text/plain) no lo
 * frena el CORS, que sólo tapa la *lectura* de la respuesta.
 *
 * `undefined` es válido a propósito: los pedidos que no salen de un browser no
 * mandan `Origin`, y de ahí llega el webhook de Mercado Pago, que se autentica
 * por su firma HMAC y no por la cookie.
 */
export function origenPermitido(origin: string | undefined, frontendUrl: string): boolean {
  return origin === undefined || origin === frontendUrl;
}

/** Middleware con esa regla, para montar antes de las rutas. */
export function chequeoDeOrigen(frontendUrl: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (METODOS_SEGUROS.has(req.method) || origenPermitido(req.headers.origin, frontendUrl)) {
      next();
      return;
    }

    res.status(403).json({ statusCode: 403, message: 'Origen no permitido' });
  };
}
