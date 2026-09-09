import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import type { Subscription } from '../generated/prisma/client.js';
import type { EstadoSuscripcion } from './subscription.rules.js';

/** Lo único que el frontend ve de la suscripción. */
export type SuscripcionPublica = {
  estado: EstadoSuscripcion['estado'];
  diasRestantes: number;
  pruebaHasta: Date;
  proximoCobroAt: Date | null;
  /** Importe mensual en pesos (no en centavos), listo para mostrar. */
  monto: number;
  moneda: string;
};

export function aSuscripcionPublica(
  estado: EstadoSuscripcion,
  suscripcion: Subscription | null,
  montoPorDefecto: number,
): SuscripcionPublica {
  return {
    estado: estado.estado,
    diasRestantes: estado.diasRestantes,
    pruebaHasta: estado.pruebaHasta,
    proximoCobroAt: suscripcion?.proximoCobroAt ?? null,
    monto: suscripcion ? suscripcion.montoCentavos / 100 : montoPorDefecto,
    moneda: suscripcion?.moneda ?? 'ARS',
  };
}

class WebhookDataDto {
  @IsString()
  id!: string;
}

/**
 * Cuerpo de la notificación de Mercado Pago. El ValidationPipe global corre con
 * `whitelist: true`, así que hay que declarar lo que leemos o llega vacío.
 * Igual nunca confiamos en estos campos más allá del id: el estado se vuelve a
 * pedir con obtenerPreapproval().
 */
export class MercadoPagoWebhookDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WebhookDataDto)
  data?: WebhookDataDto;
}
