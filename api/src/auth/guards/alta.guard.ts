import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth.service.js';
import { COOKIE_ALTA } from '../cookies-de-paso.js';

export type RequestConAlta = Request & { altaUserId: string };

/**
 * Protege los pasos del alta por WhatsApp: exige la cookie `trato_alta` y deja
 * el id del usuario pendiente en `req.altaUserId`. No es una sesión: con esta
 * cookie no se entra a nada más.
 */
@Injectable()
export class AltaGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestConAlta>();
    const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_ALTA];
    const userId = await this.authService.verificarTokenDePaso(token, 'alta');
    if (!userId) throw new UnauthorizedException('El alta venció: empezá de nuevo.');
    req.altaUserId = userId;
    return true;
  }
}
