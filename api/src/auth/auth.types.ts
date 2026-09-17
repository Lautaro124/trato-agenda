import type { User } from '../generated/prisma/client.js';

/** Datos que devuelve Google después del consentimiento. */
export type PerfilGoogle = {
  googleId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  refreshToken?: string;
};

/**
 * Payload de los JWT propios: nada sensible, sólo para identificar al usuario.
 * `tipo` separa la sesión de los tokens cortos de un paso intermedio (el alta
 * por WhatsApp antes de escanear, o conectar Google a una cuenta existente):
 * esos nunca valen como sesión.
 */
export type JwtPayload = {
  sub: string;
  email?: string | null;
  tipo?: 'alta' | 'conectar';
};

/** Vista pública del usuario: nunca incluye el refresh token de Google. */
export type UsuarioPublico = Pick<User, 'id' | 'email' | 'name' | 'avatarUrl' | 'phoneNumber'> & {
  calendario: 'google' | 'local';
  /** Nunca el hash: sólo si hay una contraseña puesta. */
  tienePassword: boolean;
  /** Cuenta de WhatsApp (sin Google) que todavía no eligió contraseña. */
  debePonerPassword: boolean;
};

/**
 * Las cuentas creadas sólo con WhatsApp entran con número + contraseña, así
 * que una que no la tiene la tiene que elegir. Las de Google no la necesitan.
 */
export function debePonerPassword(user: Pick<User, 'googleId' | 'phoneNumber' | 'passwordHash'>): boolean {
  return user.googleId === null && user.phoneNumber !== null && user.passwordHash === null;
}

export function aUsuarioPublico(user: User): UsuarioPublico {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    phoneNumber: user.phoneNumber,
    calendario: user.calendario === 'local' ? 'local' : 'google',
    tienePassword: user.passwordHash !== null,
    debePonerPassword: debePonerPassword(user),
  };
}

/** A dónde manda el front después de cualquier login. */
export type DestinoTrasLogin = '/inicio' | '/contanos' | '/contrasena';
