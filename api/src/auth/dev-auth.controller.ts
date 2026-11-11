import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AgentsService } from '../agents/agents.service.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { AuthService } from './auth.service.js';
import type { DestinoTrasLogin } from './auth.types.js';
import { CodigoAccesoService } from './codigo-acceso.service.js';
import { normalizarTelefono } from './telefono.js';
import { destinoTrasLogin, ponerCookieDeSesion } from './sesion.js';
import { EMAIL_DEV_POR_DEFECTO, loginDevPermitido } from './usuario-dev.js';

export class DevLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  /** Cada email es un usuario dev distinto: sirve para probar altas desde cero. */
  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;

  /** Con teléfono, el usuario imita una cuenta creada sólo con WhatsApp. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizarTelefono(value) : value))
  @Matches(/^\d{8,15}$/)
  telefono?: string;
}

class MensajeSembradoDto {
  @IsIn(['cliente', 'asistente'])
  de!: 'cliente' | 'asistente';

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  texto!: string;
}

/** El anuncio de Meta desde el que llegó el chat sembrado (LAU-103). */
class AnuncioSembradoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sourceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  titulo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  cuerpo?: string;
}

/** Un chat de WhatsApp sembrado para los E2E de Chats (LAU-81): no hay WhatsApp real en el stack. */
export class ChatSembradoDto {
  @Matches(/^\d{8,15}$/)
  telefono!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nombre?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MensajeSembradoDto)
  mensajes!: MensajeSembradoDto[];
  @IsOptional()
  @ValidateNested()
  @Type(() => AnuncioSembradoDto)
  anuncio?: AnuncioSembradoDto;
}

/**
 * El login con contraseña sólo existe fuera de producción (o en el entorno
 * develop de Railway, ver `loginDevPermitido`) y con
 * DEV_LOGIN_PASSWORD definida. Es el segundo candado: el primero es que
 * AuthModule ni siquiera registra este controller en producción, y el
 * tercero que validateEnv no arranca si la contraseña llega a un deploy.
 */
export function loginDevHabilitado(config: ConfigService<Env, true>): boolean {
  return (
    loginDevPermitido(config.get('NODE_ENV', { infer: true }), config.get('RAILWAY_ENVIRONMENT_NAME', { infer: true })) &&
    Boolean(config.get('DEV_LOGIN_PASSWORD', { infer: true }))
  );
}

/**
 * Comparación en tiempo constante. timingSafeEqual exige el mismo largo, así
 * que las dos se copian a buffers del largo de la mayor; el largo se compara
 * aparte y al final. No se hashea: un SHA-256 de una contraseña es justo lo
 * que CodeQL marca (js/insufficient-password-hash) y acá no hace falta.
 */
export function contrasenaCorrecta(recibida: string, esperada: string): boolean {
  const a = Buffer.from(recibida, 'utf8');
  const b = Buffer.from(esperada, 'utf8');
  const largo = Math.max(a.length, b.length, 1);
  const pa = Buffer.alloc(largo);
  const pb = Buffer.alloc(largo);
  a.copy(pa);
  b.copy(pb);
  return timingSafeEqual(pa, pb) && a.length === b.length;
}

@Controller('auth/dev')
export class DevAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly agentsService: AgentsService,
    private readonly codigos: CodigoAccesoService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  /** Le dice a /entrar si tiene que mostrar el formulario de contraseña. */
  @Get()
  estado(): { habilitado: boolean } {
    return { habilitado: loginDevHabilitado(this.config) };
  }

  /**
   * Misma cookie que el callback de Google, pero contesta JSON en vez de
   * redirigir: lo llama un `fetch` del front, que después navega a `destino`.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: DevLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ destino: DestinoTrasLogin }> {
    if (!loginDevHabilitado(this.config)) {
      throw new NotFoundException();
    }
    if (!contrasenaCorrecta(dto.password, this.config.get('DEV_LOGIN_PASSWORD', { infer: true }))) {
      throw new UnauthorizedException('Contraseña incorrecta.');
    }

    const user = await this.authService.upsertUsuarioDev(
      dto.email?.trim().toLowerCase() || EMAIL_DEV_POR_DEFECTO,
      dto.telefono,
    );
    ponerCookieDeSesion(res, this.config, await this.authService.issueSessionToken(user));
    return { destino: await destinoTrasLogin(this.agentsService, user) };
  }

  /**
   * Un usuario dev no tiene WhatsApp por donde recibir el código de acceso:
   * los E2E lo leen de acá. Mismos candados que el login.
   */
  @Get('ultimo-codigo')
  ultimoCodigo(@Query('telefono') telefono = ''): { codigo: string | null } {
    if (!loginDevHabilitado(this.config)) {
      throw new NotFoundException();
    }
    return { codigo: this.codigos.ultimoCodigoDev(normalizarTelefono(telefono)) };
  }

  /**
   * Siembra un chat de WhatsApp del usuario logueado, como si el cliente le
   * hubiera escrito: los E2E de Chats no tienen un WhatsApp real. Mismos
   * candados que el login; sólo escribe en la cuenta propia.
   */
  @Post('chat')
  @UseGuards(JwtAuthGuard)
  async sembrarChat(@CurrentUser() user: User, @Body() dto: ChatSembradoDto): Promise<{ id: string }> {
    if (!loginDevHabilitado(this.config)) {
      throw new NotFoundException();
    }
    const remoteJid = `${dto.telefono}@s.whatsapp.net`;
    const anuncio = dto.anuncio
      ? await this.prisma.anuncio.upsert({
          where: { userId_sourceId: { userId: user.id, sourceId: dto.anuncio.sourceId } },
          create: {
            userId: user.id,
            sourceId: dto.anuncio.sourceId,
            sourceType: 'ad',
            titulo: dto.anuncio.titulo ?? null,
            cuerpo: dto.anuncio.cuerpo ?? null,
            chats: 1,
          },
          update: { chats: { increment: 1 }, ultimoChatAt: new Date() },
          select: { id: true },
        })
      : null;
    const delAnuncio = anuncio ? { anuncioId: anuncio.id, anuncioAt: new Date() } : {};
    const conversation = await this.prisma.conversation.upsert({
      where: { userId_remoteJid: { userId: user.id, remoteJid } },
      create: { userId: user.id, remoteJid, nombreCliente: dto.nombre ?? null, ...delAnuncio },
      update: delAnuncio,
    });
    for (const mensaje of dto.mensajes) {
      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: mensaje.de === 'cliente' ? 'user' : 'assistant',
          content: { content: mensaje.texto },
        },
      });
    }
    return { id: conversation.id };
  }
}
