import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptToken, encryptToken } from '../auth/token-crypto.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MercadoPagoClient, type TokensOAuth } from '../subscription/mercadopago.client.js';

/** Lo que tiene el comercio para volver de la pantalla de Mercado Pago. */
const MINUTOS_CONEXION = 10;

/** Con menos que esto de vida, el token se renueva antes de usarlo. */
const DIAS_ANTES_DE_RENOVAR = 7;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export type EstadoCuentaMp = { conectada: boolean; mpUserId: string | null; conectadaAt: Date | null };

/** Se lanza cuando la vuelta del OAuth no corresponde a una conexión iniciada por este usuario. */
export class ConexionInvalidaError extends Error {}

type ConexionPendiente = { userId: string; verificador: string; expira: number };

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

/**
 * La cuenta de Mercado Pago de cada comercio, conectada por OAuth (con PKCE).
 * Con su token se crean los links de pago a nombre del comercio: la plata va
 * directo a su cuenta, Trato no la toca.
 *
 * El `state` y el `code_verifier` de una conexión en curso viven en memoria
 * diez minutos. Alcanza por lo mismo que el Limitador del login: la API corre
 * en una sola réplica; un reinicio a mitad de camino sólo obliga a apretar
 * "Conectar" de nuevo.
 */
@Injectable()
export class CuentaMercadoPagoService {
  private readonly logger = new Logger(CuentaMercadoPagoService.name);
  private readonly pendientes = new Map<string, ConexionPendiente>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mp: MercadoPagoClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** false sin las credenciales de OAuth: la web no ofrece conectar. */
  get configurado(): boolean {
    return Boolean(
      this.config.get('MERCADOPAGO_CLIENT_ID', { infer: true }) && this.config.get('MERCADOPAGO_CLIENT_SECRET', { infer: true }),
    );
  }

  redirectUri(): string {
    return `${this.config.get('API_PUBLIC_URL', { infer: true })}/mercadopago/callback`;
  }

  /** Arranca la conexión: devuelve la URL de autorización de Mercado Pago. */
  iniciarConexion(userId: string, ahora = Date.now()): string {
    this.purgar(ahora);
    const state = base64url(randomBytes(32));
    const verificador = base64url(randomBytes(48));
    const desafio = base64url(createHash('sha256').update(verificador).digest());
    this.pendientes.set(state, { userId, verificador, expira: ahora + MINUTOS_CONEXION * 60_000 });

    const params = new URLSearchParams({
      client_id: this.config.get('MERCADOPAGO_CLIENT_ID', { infer: true }),
      response_type: 'code',
      platform_id: 'mp',
      state,
      redirect_uri: this.redirectUri(),
      code_challenge: desafio,
      code_challenge_method: 'S256',
    });
    return `${this.config.get('MERCADOPAGO_AUTH_URL', { infer: true })}/authorization?${params}`;
  }

  /**
   * La vuelta del OAuth. El `state` tiene que ser uno emitido para este mismo
   * usuario y todavía vigente, y se usa una sola vez: si no, es una vuelta
   * ajena (o repetida) y no se canjea nada.
   */
  async completarConexion(userId: string, state: string, code: string, ahora = Date.now()): Promise<void> {
    const pendiente = this.pendientes.get(state);
    this.pendientes.delete(state);
    if (!pendiente || pendiente.userId !== userId || pendiente.expira < ahora) {
      throw new ConexionInvalidaError('La conexión con Mercado Pago venció o no es de esta cuenta.');
    }
    const tokens = await this.mp.canjearCodigo({ code, redirectUri: this.redirectUri(), codeVerifier: pendiente.verificador });
    await this.guardar(userId, tokens, ahora);
  }

  async estado(userId: string): Promise<EstadoCuentaMp> {
    const cuenta = await this.prisma.cuentaMercadoPago.findUnique({ where: { userId } });
    return { conectada: cuenta !== null, mpUserId: cuenta?.mpUserId ?? null, conectadaAt: cuenta?.conectadaAt ?? null };
  }

  async desconectar(userId: string): Promise<void> {
    await this.prisma.cuentaMercadoPago.deleteMany({ where: { userId } });
  }

  /**
   * El access token del comercio listo para usar, renovado si le queda poco.
   * null si no conectó Mercado Pago (o el token venció y no se pudo renovar).
   */
  async tokenDe(userId: string, ahora = Date.now()): Promise<{ accessToken: string; mpUserId: string } | null> {
    const cuenta = await this.prisma.cuentaMercadoPago.findUnique({ where: { userId } });
    if (!cuenta) return null;
    const clave = this.config.get('TOKEN_ENCRYPTION_KEY', { infer: true });

    if (cuenta.expiraAt.getTime() - ahora < DIAS_ANTES_DE_RENOVAR * MS_POR_DIA) {
      try {
        const tokens = await this.mp.refrescarToken(decryptToken(cuenta.refreshToken, clave));
        const guardada = await this.guardar(userId, tokens, ahora);
        return { accessToken: tokens.access_token, mpUserId: guardada.mpUserId };
      } catch (error) {
        this.logger.warn(`No se pudo renovar el token de Mercado Pago de ${userId}: ${(error as Error).message}`);
        // Mientras no haya vencido del todo, el token viejo sigue sirviendo.
        if (cuenta.expiraAt.getTime() <= ahora) return null;
      }
    }
    return { accessToken: decryptToken(cuenta.accessToken, clave), mpUserId: cuenta.mpUserId };
  }

  private async guardar(userId: string, tokens: TokensOAuth, ahora: number) {
    const clave = this.config.get('TOKEN_ENCRYPTION_KEY', { infer: true });
    const datos = {
      mpUserId: String(tokens.user_id),
      accessToken: encryptToken(tokens.access_token, clave),
      refreshToken: encryptToken(tokens.refresh_token, clave),
      expiraAt: new Date(ahora + tokens.expires_in * 1000),
    };
    return this.prisma.cuentaMercadoPago.upsert({
      where: { userId },
      create: { userId, ...datos },
      update: datos,
    });
  }

  private purgar(ahora: number): void {
    for (const [state, pendiente] of this.pendientes) {
      if (pendiente.expira < ahora) this.pendientes.delete(state);
    }
  }
}
