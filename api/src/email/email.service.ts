import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

export type Email = { para: string; asunto: string; texto: string };

const TIMEOUT_MS = 10_000;

/** Escapa lo mínimo para meter texto plano dentro del HTML del email. */
function aHtml(texto: string): string {
  const escapado = texto.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<div style="font-family:sans-serif;font-size:15px;line-height:1.6">${escapado.replaceAll('\n', '<br>')}</div>`;
}

/**
 * Emails transaccionales de la cuenta (LAU-109) por la API HTTP de Resend: el
 * canal para verificar el email de recuperación y para mandar códigos de
 * acceso sin depender de la sesión de Baileys.
 *
 * Sin `EMAIL_API_KEY` en producción no manda nada y `disponible()` da false
 * (la web no ofrece sumar un email). Fuera de producción, sin key, guarda el
 * último email por destinatario en memoria para los E2E y el login dev.
 *
 * Nunca loguea direcciones, asuntos ni cuerpos: los cuerpos llevan códigos de
 * acceso. Sólo el status del proveedor.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly ultimosDev = new Map<string, Email>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  private enProduccion(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }

  private apiKey(): string {
    return this.config.get('EMAIL_API_KEY', { infer: true });
  }

  /** Si hay por dónde mandar emails. */
  disponible(): boolean {
    return Boolean(this.apiKey()) || !this.enProduccion();
  }

  /** true si el proveedor lo aceptó (o quedó guardado en dev). Nunca lanza. */
  async enviar(email: Email): Promise<boolean> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      if (this.enProduccion()) return false;
      this.ultimosDev.set(email.para.toLowerCase(), email);
      return true;
    }
    try {
      const res = await fetch(`${this.config.get('EMAIL_API_URL', { infer: true })}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: this.config.get('EMAIL_FROM', { infer: true }),
          to: [email.para],
          subject: email.asunto,
          text: email.texto,
          html: aHtml(email.texto),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        // Sin el cuerpo: puede repetir la dirección del destinatario.
        this.logger.warn(`El proveedor de email rechazó un envío (HTTP ${res.status}).`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`No se pudo mandar un email: ${(error as Error).name}`);
      return false;
    }
  }

  /** Nunca en producción: lo expone DevAuthController, que ahí ni se registra. */
  ultimoDev(para: string): Email | null {
    if (this.enProduccion()) return null;
    return this.ultimosDev.get(para.toLowerCase()) ?? null;
  }
}
