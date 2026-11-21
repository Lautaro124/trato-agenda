import { Body, ConflictException, Controller, HttpCode, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Limitador } from '../auth/limitador.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { ResultadoRecomendacion } from '../comercio/recomendaciones.rules.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubscriptionService } from '../subscription/subscription.service.js';
import { CheckpointerService } from './checkpointer.provider.js';
import { ConversationService, jidDePruebaRecomendaciones } from './conversation.service.js';
import { MENSAJE_SUSCRIPCION_VENCIDA } from './mensajes.js';

/** Cada prueba es una llamada real al modelo: un tope por cuenta para no quemar costo. */
const PRUEBAS_POR_HORA = 60;

class ProbarRecomendacionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  mensaje!: string;
}

type Prueba = { reply: string; recomendaciones: ResultadoRecomendacion[] };

/**
 * Probador de recomendaciones (LAU-105): el dueño escribe como un cliente y
 * ve la respuesta del mismo asistente que atiende WhatsApp, con lo que
 * resolvió consultar_recomendacion (qué regla aplicó, cuáles descartó, si
 * falta el dato y qué candidatos tenía). Usa las reglas guardadas; las
 * pausadas también cuentan acá, para probarlas antes de activarlas en
 * WhatsApp. Cada prueba arranca un hilo nuevo, aparte del Home.
 */
@Controller('recomendaciones')
@UseGuards(JwtAuthGuard)
export class ProbadorRecomendacionesController {
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
  async probar(@CurrentUser() user: User, @Body() dto: ProbarRecomendacionDto): Promise<Prueba> {
    const agent = await this.prisma.agent.findUnique({ where: { userId: user.id }, select: { tipoAsistente: true } });
    if (agent?.tipoAsistente !== 'ventas') throw new ConflictException('Las recomendaciones son para las cuentas que venden.');
    if (!(await this.subscriptionService.asistenteActivo(user.id))) {
      return { reply: MENSAJE_SUSCRIPCION_VENCIDA, recomendaciones: [] };
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

  private async probarSinCompetir(userId: string, mensaje: string): Promise<Prueba> {
    const remoteJid = jidDePruebaRecomendaciones(userId);
    // Cada prueba es una charla nueva: sin respuestas ni datos de la anterior.
    const anteriores = await this.prisma.conversation.findMany({ where: { userId, remoteJid }, select: { id: true } });
    for (const { id } of anteriores) await this.checkpointer.saver.deleteThread(id);
    await this.prisma.conversation.deleteMany({ where: { userId, remoteJid } });

    const respuesta = await this.conversationService.responder(userId, remoteJid, mensaje);
    return { reply: respuesta.texto, recomendaciones: respuesta.recomendaciones ?? [] };
  }
}
