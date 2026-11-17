import { Controller, Get, Headers, HttpCode, HttpStatus, Logger, NotFoundException, Post, Query, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { resumenDeError } from '../../agents/openrouter.client.js';
import type { Env } from '../../config/env.js';
import { WhatsappService } from '../whatsapp.service.js';
import { eventosDeWebhook, firmaDeMetaValida, tokenDeVerificacionValido, type EventoMeta } from './meta-webhook.js';
import { MetaWhatsappService } from './meta-whatsapp.service.js';

/**
 * Webhook de la Cloud API de WhatsApp. Público: lo autentica la firma
 * `X-Hub-Signature-256` (HMAC del cuerpo crudo con el secreto de la app), que
 * necesita el parser `raw` que main.ts le pone sólo a esta ruta.
 *
 * Siempre 200 rápido: Meta reintenta lo que no se confirma, y los mensajes
 * repetidos los frena `MensajeRecibido`. Nada del cuerpo va a los logs.
 */
@Controller('whatsapp/meta/webhook')
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly meta: MetaWhatsappService,
    private readonly whatsapp: WhatsappService,
  ) {}

  /** Alta del webhook en la consola de Meta: devuelve el desafío si el token coincide. */
  @Get()
  verificar(
    @Query('hub.mode') modo: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') desafio: string | undefined,
  ): string {
    const esperado = this.config.get('META_WEBHOOK_VERIFY_TOKEN', { infer: true });
    if (modo !== 'subscribe' || !tokenDeVerificacionValido(token, esperado) || !desafio || !/^\w{1,128}$/.test(desafio)) {
      throw new NotFoundException();
    }
    return desafio;
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  recibir(@Req() req: Request, @Headers('x-hub-signature-256') firma: string | undefined): { recibido: boolean } {
    const cuerpo = Buffer.isBuffer(req.body) ? req.body : undefined;
    const secreto = this.config.get('META_APP_SECRET', { infer: true });
    if (!this.meta.configurado || !firmaDeMetaValida(cuerpo, firma, secreto)) {
      // debug y no warn: es un endpoint público y cualquiera podría llenar los logs.
      this.logger.debug('Webhook de Meta con firma inválida: se ignora.');
      return { recibido: false };
    }
    let datos: unknown;
    try {
      datos = JSON.parse(cuerpo!.toString('utf8'));
    } catch {
      return { recibido: false };
    }
    void this.procesar(eventosDeWebhook(datos));
    return { recibido: true };
  }

  private async procesar(eventos: EventoMeta[]): Promise<void> {
    await Promise.all(
      eventos.map(async (evento) => {
        try {
          if (evento.tipo === 'baja') {
            await this.meta.darDeBaja(evento.wabaId);
            return;
          }
          const conexion = await this.meta.conexionPorNumero(evento.phoneNumberId);
          // Un número que ya no está conectado (o de otra app): no se atiende.
          if (!conexion) return;
          await this.whatsapp.recibirDeMeta(conexion, evento);
        } catch (error) {
          // Sólo el tipo y el motivo: ni el teléfono ni el texto del cliente.
          this.logger.error(`Fallo procesando un evento de Meta (${evento.tipo}): ${resumenDeError(error)}`);
        }
      }),
    );
  }
}
