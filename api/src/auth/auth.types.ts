import type { User } from '../generated/prisma/client.js';

/** Datos que devuelve Google después del consentimiento. */
export type PerfilGoogle = {
  googleId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  refreshToken?: string;
};

/** Payload del JWT propio: nada sensible, sólo para identificar la sesión. */
export type JwtPayload = {
  sub: string;
  email: string;
};

/** Vista pública del usuario: nunca incluye el refresh token de Google. */
export type UsuarioPublico = Pick<User, 'id' | 'email' | 'name' | 'avatarUrl'>;

export function aUsuarioPublico(user: User): UsuarioPublico {
  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
}
