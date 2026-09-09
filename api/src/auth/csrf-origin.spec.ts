import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { chequeoDeOrigen, origenPermitido } from './csrf-origin.js';

const FRONT = 'https://web-production.up.railway.app';

function pedido(method: string, origin?: string): Request {
  return { method, headers: origin === undefined ? {} : { origin } } as Request;
}

function respuesta(): Response & { statusMock: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, statusMock: status } as unknown as Response & {
    statusMock: ReturnType<typeof vi.fn>;
  };
}

describe('origenPermitido', () => {
  it('acepta el origen del frontend', () => {
    expect(origenPermitido(FRONT, FRONT)).toBe(true);
  });

  it('rechaza cualquier otro origen', () => {
    expect(origenPermitido('https://sitio-malicioso.com', FRONT)).toBe(false);
  });

  it('acepta un pedido sin Origin: no sale de un browser (webhook de Mercado Pago)', () => {
    expect(origenPermitido(undefined, FRONT)).toBe(true);
  });
});

describe('chequeoDeOrigen', () => {
  it('deja pasar un GET de cualquier origen: no cambia estado', () => {
    const next = vi.fn() as unknown as NextFunction;
    chequeoDeOrigen(FRONT)(pedido('GET', 'https://sitio-malicioso.com'), respuesta(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('corta un POST cross-site con 403 sin llegar al controlador', () => {
    const next = vi.fn() as unknown as NextFunction;
    const res = respuesta();
    chequeoDeOrigen(FRONT)(pedido('POST', 'https://sitio-malicioso.com'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusMock).toHaveBeenCalledWith(403);
  });

  it('deja pasar el POST del frontend', () => {
    const next = vi.fn() as unknown as NextFunction;
    chequeoDeOrigen(FRONT)(pedido('POST', FRONT), respuesta(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});
