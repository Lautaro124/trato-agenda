import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import type { Env } from '../../config/env.js';
import type { User } from '../../generated/prisma/client.js';
import { WhatsappService } from '../whatsapp.service.js';
import type { WhatsappStatus } from '../whatsapp.types.js';
import { CloudProveedor } from './cloud.proveedor.js';
import { challengeDeVerificacion, firmaDeMetaValida } from './firma.js';
import { eventosDelWebhook } from './webhook.js';

export class AltaCloudDto {
  @IsString()
  @Length(1, 2048)
  codigo!: string;

  @Matches(/^\d{1,25}$/)
  wabaId!: string;

  @Matches(/^\d{1,25}$/)
  phoneNumberId!: string;

  @IsBoolean()
  coexistencia!: boolean;

  @IsOptional()
  @Matches(/^\d{6}$/)
  pin?: string;
}

/** Lo que necesita el SDK de Meta en el navegador. Son datos públicos de la app. */
export type ConfigCloud =
  | { disponible: false }
  | { disponible: true; appId: string; configId: string; graphVersion: string };

/** La conexión por la API oficial, para el dueño con sesión. */
@Controller('whatsapp/cloud')
@UseGuards(JwtAuthGuard)
export class CloudController {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly whatsapp: WhatsappService,
  ) {}

  @Get('config')
  configuracion(): ConfigCloud {
    const appId = this.config.get('META_APP_ID', { infer: true });
    if (!appId) return { disponible: false };
    return {
      disponible: true,
      appId,
      configId: this.config.get('META_WHATSAPP_CONFIG_ID', { infer: true }),
      graphVersion: this.config.get('META_GRAPH_VERSION', { infer: true }),
    };
  }

  /** Lo que devolvió Embedded Signup: el código se canjea acá, nunca en el navegador. */
  @Post('alta')
  @HttpCode(HttpStatus.OK)
  alta(@CurrentUser() user: User, @Body() dto: AltaCloudDto): Promise<WhatsappStatus> {
    return this.whatsapp.conectarCloud(user.id, dto);
  }
}

/**
 * El webhook de la Cloud API. No tiene sesión: el GET se autentica con el
 * token de verificación y el POST con la firma del secreto de la app sobre el
 * cuerpo crudo (`main.ts` lo deja sin parsear para esta ruta).
 */
@Controller('whatsapp/cloud/webhook')
export class CloudWebhookController {
  private readonly logger = new Logger(CloudWebhookController.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly cloud: CloudProveedor,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  verificar(@Query() query: Record<string, unknown>): string {
    const challenge = challengeDeVerificacion(query, this.config.get('META_WEBHOOK_VERIFY_TOKEN', { infer: true }));
    if (challenge === null) throw new ForbiddenException();
    return challenge;
  }

  /**
   * Responde enseguida: Meta reintenta si tarda. Lo que llegó se atiende
   * después; los duplicados los frena `MensajeRecibido`.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  recibir(@Req() req: Request, @Headers('x-hub-signature-256') firma?: string): { recibido: true } {
    const cuerpo: unknown = req.body;
    if (!Buffer.isBuffer(cuerpo) || !firmaDeMetaValida(cuerpo, firma, this.config.get('META_APP_SECRET', { infer: true }))) {
      // debug y no warn: la ruta es pública y cualquiera puede llenar los logs con pedidos sin firma.
      this.logger.debug('Webhook de la API oficial de WhatsApp con firma inválida: se ignora.');
      throw new UnauthorizedException();
    }
    let datos: unknown;
    try {
      datos = JSON.parse(cuerpo.toString('utf8'));
    } catch {
      return { recibido: true };
    }
    void this.cloud
      .recibirWebhook(eventosDelWebhook(datos))
      .catch((error: unknown) => this.logger.error(`Fallo atendiendo el webhook de la API oficial: ${(error as Error).name}`));
    return { recibido: true };
  }
}
