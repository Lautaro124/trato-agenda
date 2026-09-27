import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { ConexionInvalidaError, type CuentaMercadoPagoService } from './cuenta-mercadopago.service.js';
import { MercadoPagoController } from './mercadopago.controller.js';

const USUARIO = { id: 'user-1' } as User;

function crear(configurado = true) {
  const cuentas = {
    configurado,
    iniciarConexion: vi.fn().mockReturnValue('https://auth.mercadopago.com/authorization?x=1'),
    completarConexion: vi.fn().mockResolvedValue(undefined),
  };
  const config = { get: () => 'https://tratoagenda.com' } as unknown as ConfigService<Env, true>;
  const res = { redirect: vi.fn() } as unknown as Response & { redirect: ReturnType<typeof vi.fn> };
  return { controller: new MercadoPagoController(cuentas as unknown as CuentaMercadoPagoService, config), cuentas, res };
}

describe('MercadoPagoController', () => {
  it('conectar redirige a la autorización, o vuelve con error si no está configurado', () => {
    const { controller, res } = crear();
    controller.conectar(USUARIO, res);
    expect(res.redirect).toHaveBeenCalledWith('https://auth.mercadopago.com/authorization?x=1');

    const sinConfigurar = crear(false);
    sinConfigurar.controller.conectar(USUARIO, sinConfigurar.res);
    expect(sinConfigurar.res.redirect).toHaveBeenCalledWith('https://tratoagenda.com/cuenta?mp=error');
  });

  it('la vuelta sin code es que el dueño canceló', async () => {
    const { controller, cuentas, res } = crear();
    await controller.callback(USUARIO, undefined, 'state', res);
    expect(res.redirect).toHaveBeenCalledWith('https://tratoagenda.com/cuenta?mp=cancelado');
    expect(cuentas.completarConexion).not.toHaveBeenCalled();
  });

  it('canjea el código y vuelve a /cuenta con el resultado', async () => {
    const { controller, cuentas, res } = crear();
    await controller.callback(USUARIO, 'code', 'state', res);
    expect(cuentas.completarConexion).toHaveBeenCalledWith('user-1', 'state', 'code');
    expect(res.redirect).toHaveBeenCalledWith('https://tratoagenda.com/cuenta?mp=conectado');

    cuentas.completarConexion.mockRejectedValue(new ConexionInvalidaError('venció'));
    await controller.callback(USUARIO, 'code', 'state', res);
    expect(res.redirect).toHaveBeenLastCalledWith('https://tratoagenda.com/cuenta?mp=error');
  });
});
