import { ConsoleLogger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

/**
 * Contexto del filtro de excepciones de Nest: esos errores ya los captura
 * SentryGlobalFilter con el request en la mano, reportarlos acá los duplicaría.
 */
const CONTEXTOS_YA_REPORTADOS = new Set(['ExceptionsHandler']);

/**
 * Agrupa los mensajes que sólo difieren en un id (usuario, conversación,
 * venta): sin esto cada usuario abriría su propio issue.
 */
export function huellaDeMensaje(mensaje: string): string {
  return mensaje
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b(?=[a-z0-9]*\d)[a-z0-9]{16,}\b/gi, '<id>')
    .replace(/\d+/g, '<n>');
}

function textoDe(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  return String(message);
}

/**
 * Logger de la app: escribe igual que el de Nest y además manda a Sentry cada
 * `logger.error`. Así los errores de fondo que se atrapan y se loguean (Baileys,
 * el grafo, los barridos, los webhooks) llegan a Sentry sin tocar cada `catch`.
 * Si Sentry no se inicializó (sin DSN), `captureException` no hace nada.
 */
export class LoggerConSentry extends ConsoleLogger {
  override error(message: unknown, ...parametros: unknown[]): void {
    super.error(message, ...parametros);

    const ultimo = parametros.at(-1);
    const contexto = typeof ultimo === 'string' ? ultimo : this.context;
    if (contexto && CONTEXTOS_YA_REPORTADOS.has(contexto)) return;

    const texto = textoDe(message);
    const error = message instanceof Error ? message : parametros.find((p): p is Error => p instanceof Error);

    Sentry.withScope((scope) => {
      if (contexto) scope.setTag('contexto', contexto);
      if (error) {
        scope.setExtra('mensaje', texto);
        Sentry.captureException(error);
      } else {
        scope.setFingerprint([contexto ?? 'sin-contexto', huellaDeMensaje(texto)]);
        Sentry.captureMessage(texto, 'error');
      }
    });
  }
}
