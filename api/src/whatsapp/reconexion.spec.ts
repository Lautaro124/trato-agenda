import { DisconnectReason } from '@whiskeysockets/baileys';
import { describe, expect, it } from 'vitest';
import {
  MAX_RECONEXIONES_SIN_VINCULAR,
  MAX_SESIONES_MALAS_SEGUIDAS,
  MINIMO_TRAS_REEMPLAZO_MS,
  MINUTOS_CAIDO_PARA_AVISAR,
  TECHO_RECONEXION_MS,
  correspondeAvisarCaida,
  demoraDeReconexion,
  politicaDeCierre,
  type EstadoAlCerrar,
} from './reconexion.js';

const vinculada: EstadoAlCerrar = { vinculado: true, modoCodigo: false, intentos: 0, sesionesMalas: 0 };
const sinVincular: EstadoAlCerrar = { vinculado: false, modoCodigo: false, intentos: 0, sesionesMalas: 0 };

describe('politicaDeCierre', () => {
  it('loggedOut desvincula siempre, aun con un código pendiente', () => {
    expect(politicaDeCierre(DisconnectReason.loggedOut, vinculada)).toBe('desvincular');
    expect(politicaDeCierre(DisconnectReason.loggedOut, { ...sinVincular, modoCodigo: true })).toBe('desvincular');
  });

  it('con un código sin confirmar no se reconecta, sea cual sea el motivo', () => {
    const conCodigo = { ...sinVincular, modoCodigo: true };
    expect(politicaDeCierre(DisconnectReason.connectionLost, conCodigo)).toBe('codigo_vencido');
    expect(politicaDeCierre(DisconnectReason.restartRequired, conCodigo)).toBe('codigo_vencido');
    expect(politicaDeCierre(DisconnectReason.connectionReplaced, conCodigo)).toBe('codigo_vencido');
  });

  it('con el código ya confirmado, restartRequired reinicia como con el QR', () => {
    expect(politicaDeCierre(DisconnectReason.restartRequired, { ...vinculada, modoCodigo: true })).toBe('reiniciar');
  });

  it('una sesión vinculada reintenta sin tope ante cortes de red o un reemplazo', () => {
    expect(politicaDeCierre(DisconnectReason.connectionLost, { ...vinculada, intentos: 500 })).toBe('reintentar');
    expect(politicaDeCierre(DisconnectReason.connectionClosed, vinculada)).toBe('reintentar');
    expect(politicaDeCierre(DisconnectReason.unavailableService, vinculada)).toBe('reintentar');
    expect(politicaDeCierre(DisconnectReason.connectionReplaced, vinculada)).toBe('reintentar');
    expect(politicaDeCierre(undefined, vinculada)).toBe('reintentar');
  });

  it('sin vincular (un QR que nadie escanea) se rinde al llegar al tope', () => {
    const casi = { ...sinVincular, intentos: MAX_RECONEXIONES_SIN_VINCULAR - 1 };
    expect(politicaDeCierre(DisconnectReason.connectionLost, casi)).toBe('reintentar');
    expect(politicaDeCierre(DisconnectReason.connectionLost, { ...casi, intentos: MAX_RECONEXIONES_SIN_VINCULAR })).toBe(
      'rendirse',
    );
  });

  it('badSession se tolera unas veces seguidas y después pide volver a vincular', () => {
    const malas = (n: number) => ({ ...vinculada, sesionesMalas: n });
    expect(politicaDeCierre(DisconnectReason.badSession, malas(1))).toBe('reintentar');
    expect(politicaDeCierre(DisconnectReason.badSession, malas(MAX_SESIONES_MALAS_SEGUIDAS - 1))).toBe('reintentar');
    expect(politicaDeCierre(DisconnectReason.badSession, malas(MAX_SESIONES_MALAS_SEGUIDAS))).toBe('rendirse');
  });

  it('forbidden y multideviceMismatch no se arreglan reconectando', () => {
    expect(politicaDeCierre(DisconnectReason.forbidden, vinculada)).toBe('rendirse');
    expect(politicaDeCierre(DisconnectReason.multideviceMismatch, vinculada)).toBe('rendirse');
  });
});

describe('demoraDeReconexion', () => {
  it('crece exponencialmente con jitter entre la mitad y el total', () => {
    expect(demoraDeReconexion(1, 0)).toBe(1_000);
    expect(demoraDeReconexion(1, 1)).toBe(2_000);
    expect(demoraDeReconexion(2, 0)).toBe(2_000);
    expect(demoraDeReconexion(3, 1)).toBe(8_000);
  });

  it('nunca pasa el techo, por más intentos que lleve', () => {
    expect(demoraDeReconexion(9, 1)).toBe(TECHO_RECONEXION_MS);
    expect(demoraDeReconexion(10_000, 1)).toBe(TECHO_RECONEXION_MS);
    expect(demoraDeReconexion(10_000, 0)).toBe(TECHO_RECONEXION_MS / 2);
  });

  it('tras un connectionReplaced espera al menos un minuto', () => {
    expect(demoraDeReconexion(1, 0, DisconnectReason.connectionReplaced)).toBe(MINIMO_TRAS_REEMPLAZO_MS);
    expect(demoraDeReconexion(9, 1, DisconnectReason.connectionReplaced)).toBe(TECHO_RECONEXION_MS);
  });
});

describe('correspondeAvisarCaida', () => {
  it('avisa recién pasados MINUTOS_CAIDO_PARA_AVISAR', () => {
    const umbral = MINUTOS_CAIDO_PARA_AVISAR * 60_000;
    expect(correspondeAvisarCaida(0, umbral - 1)).toBe(false);
    expect(correspondeAvisarCaida(0, umbral)).toBe(true);
  });
});
