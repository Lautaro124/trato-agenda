import { Body, ConflictException, Controller, HttpCode, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Limitador } from '../auth/limitador.js';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { ResolucionEnvio } from '../envios/envios.rules.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubscriptionService } from '../subscription/subscription.service.js';
import { CheckpointerService } from './checkpointer.provider.js';
import { ConversationService, jidDePruebaEnvios } from './conversation.service.js';
import { MENSAJE_SUSCRIPCION_VENCIDA } from './mensajes.js';

/** Cada prueba es una llamada real al modelo: un tope por cuenta para no quemar costo. */
const PRUEBAS_POR_HORA = 60;

class ProbarEnvioDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  mensaje!: string;
}

/**
 * Probador del módulo de envíos (LAU-102): el dueño escribe como un cliente
 * y ve la respuesta del mismo asistente que atiende WhatsApp, con lo que
 * resolvió consultar_envio (zona, regla y datos faltantes). Cada prueba
 * arranca un hilo nuevo, separado del banco de pruebas del Home, y como
 * habla el dueño no se registra como consulta sin resolver.
 */
@Controller('envios')
@UseGuards(JwtAuthGuard)
export class ProbadorEnviosController {
  private readonly pruebas = new Limitador(PRUEBAS_POR_HORA, 60 * 60 * 1000);
  /** Una prueba a la vez por cuenta: cada una borra el hilo de la anterior. */
  private readonly enCurso = new Set<string>();

  constructor(
    private readonly conversationService: ConversationService,
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
    private readonly checkpointer: CheckpointerService,
  ) {}

  @Post('probar')
  @HttpCode(HttpStatus.OK)
  async probar(
    @CurrentUser() user: User,
    @Body() dto: ProbarEnvioDto,
  ): Promise<{ reply: string; resoluciones: ResolucionEnvio[] }> {
    const agent = await this.prisma.agent.findUnique({ where: { userId: user.id }, select: { tipoAsistente: true } });
    if (agent?.tipoAsistente !== 'ventas') throw new ConflictException('Los envíos son para las cuentas que venden.');
    if (!(await this.subscriptionService.asistenteActivo(user.id))) {
      return { reply: MENSAJE_SUSCRIPCION_VENCIDA, resoluciones: [] };
    }
    if (this.enCurso.has(user.id)) {
      throw new HttpException('Ya hay una prueba en curso. Esperá a que termine.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!this.pruebas.permitir(user.id)) {
      throw new HttpException('Hiciste muchas pruebas en la última hora. Probá de nuevo en un rato.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.enCurso.add(user.id);
    try {
      return await this.probarSinCompetir(user.id, dto.mensaje.trim());
    } finally {
      this.enCurso.delete(user.id);
    }
  }

  private async probarSinCompetir(userId: string, mensaje: string): Promise<{ reply: string; resoluciones: ResolucionEnvio[] }> {
    const user = { id: userId };
    const remoteJid = jidDePruebaEnvios(user.id);
    // Cada prueba es una charla nueva: sin precios ni destinos de la anterior.
    const anteriores = await this.prisma.conversation.findMany({ where: { userId: user.id, remoteJid }, select: { id: true } });
    for (const { id } of anteriores) await this.checkpointer.saver.deleteThread(id);
    await this.prisma.conversation.deleteMany({ where: { userId: user.id, remoteJid } });

    const respuesta = await this.conversationService.responder(user.id, remoteJid, mensaje);
    return { reply: respuesta.texto, resoluciones: respuesta.resolucionesEnvio ?? [] };
  }
}
