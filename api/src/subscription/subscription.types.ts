import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import type { Subscription } from '../generated/prisma/client.js';
import { IDS_DE_PLAN, planVigente, type EstadoSuscripcion, type PlanId } from './subscription.rules.js';

/** Lo único que el frontend ve de la suscripción. */
export type SuscripcionPublica = {
  estado: EstadoSuscripcion['estado'];
  diasRestantes: number;
  pruebaHasta: Date;
  proximoCobroAt: Date | null;
  /** Plan contratado; null mientras no esté pagando (prueba, vencida, pendiente). */
  plan: PlanId | null;
  /** Importe mensual en pesos (no en centavos), listo para mostrar. */
  monto: number;
  moneda: string;
  /** Chats (clientes distintos) del mes en curso contra el tope del plan. */
  uso: { chats: number; limite: number };
};

export type PlanPublico = { id: PlanId; nombre: string; chats: number; monto: number };

/** Lo que muestra la landing antes de que haya sesión: los precios de env, nada más. */
export type PrecioPublico = { moneda: 'ARS'; planes: PlanPublico[] };

/**
 * El monto guardado en la fila sólo vale mientras la suscripción está activa:
 * es lo que efectivamente se cobra. Una fila pendiente o cancelada puede tener
 * un precio viejo, y el próximo checkout cobra el de env — que es el que hay
 * que mostrar, igual que en la landing.
 */
export function aSuscripcionPublica(
  estado: EstadoSuscripcion,
  suscripcion: Subscription | null,
  montoPorDefecto: number,
  uso: { chats: number; limite: number },
): SuscripcionPublica {
  const pagando = estado.estado === 'activa' && suscripcion !== null;
  const plan = planVigente(estado, suscripcion?.plan);
  return {
    estado: estado.estado,
    diasRestantes: estado.diasRestantes,
    pruebaHasta: estado.pruebaHasta,
    proximoCobroAt: suscripcion?.proximoCobroAt ?? null,
    plan,
    monto: pagando ? suscripcion.montoCentavos / 100 : montoPorDefecto,
    moneda: pagando ? suscripcion.moneda : 'ARS',
    uso,
  };
}

/** Body de POST /suscripcion/checkout: el plan es obligatorio; el email sólo hace falta si la cuenta no tiene uno. */
export class CheckoutDto {
  @IsIn(IDS_DE_PLAN)
  plan!: PlanId;

  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;
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
