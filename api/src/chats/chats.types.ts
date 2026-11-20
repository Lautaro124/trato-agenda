import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { FORMAS_DE_PAGO, type FormaDePago } from '../comercio/condiciones-pago.rules.js';
import { LARGO_MAX_NOTA, MAX_CANTIDAD_POR_ITEM, MAX_ITEMS_POR_PEDIDO } from '../comercio/ventas.rules.js';
import type { MensajePublico } from '../comercio/ventas.types.js';
import type { EstadoChat } from '../performance/lectura.rules.js';
import type { Etapa } from '../performance/etapas.rules.js';
import type { AccionChat, AnalisisVenta, Temperatura } from './analisis.rules.js';
import type { AtencionChat } from './atencion.js';
import { ESTADOS_TRATO, type EstadoTrato } from './trato.rules.js';

/** Tope de un mensaje que el dueño manda desde el panel (sincronizado con web/src/lib/chats.ts). */
export const LARGO_MAX_MENSAJE_PANEL = 1000;

/** Un chat de la lista: sólo lo que muestra la pantalla de Chats. */
export type ChatResumen = {
  id: string;
  /** El nombre que dio el cliente, si lo dio. */
  nombre: string | null;
  /** El número del cliente; null si el JID no es un número (cuentas con LID). */
  telefono: string | null;
  atencion: AtencionChat;
  ultimo: MensajePublico | null;
  /** Lo atiende una persona y el último mensaje es del cliente: nadie le contestó. */
  teEspera: boolean;
  /** Contexto del negocio: el próximo turno (agenda) o el pedido abierto (ventas). */
  turno: { inicio: Date } | null;
  pedido: { estado: string } | null;
  /** Sólo en cuentas de ventas: la etapa más avanzada del chat y si está activo, estancado o abandonado. */
  venta: { etapa: Etapa; estado: EstadoChat; derivado: boolean } | null;
  /** Sólo en cuentas de ventas: lo que marcó el dueño o salió del último pedido. */
  trato: EstadoTrato | null;
  /** Sólo en ventas, con análisis y sin trato cerrado: qué tan cerca está de comprar (estimado). */
  temperatura: Temperatura | null;
  /** Sólo en ventas: el producto que más le interesa (de la base) o, si no hay, el tema que le importa. */
  tema: { tipo: 'producto' | 'tema'; texto: string } | null;
  /** Por qué necesita al dueño ahora; null si el bot se encarga. */
  accion: AccionChat | null;
};

export type ListaChats = {
  chats: ChatResumen[];
  cuenta: { todos: number; asistente: number; humana: number };
};

export type MensajeChat = MensajePublico & { id: string };

export type DetalleChat = { chat: ChatResumen; mensajes: MensajeChat[] };

/** Resultado de cambiar quién contesta: el chat y si el asistente va a contestar lo pendiente. */
export type CambioDeAtencion = { chat: ChatResumen; contesta: boolean };

export class CambiarAtencionDto {
  /** true: lo atiende el dueño. false: vuelve al asistente. */
  @IsBoolean()
  humana!: boolean;

  /** Al devolverlo: que el asistente conteste lo que el cliente escribió sin respuesta. */
  @IsOptional()
  @IsBoolean()
  contestar?: boolean;

  /** Contexto breve para el asistente al devolverlo. Es un dato, nunca una instrucción. */
  @IsOptional()
  @IsString()
  @MaxLength(LARGO_MAX_NOTA)
  nota?: string;
}

export class EnviarMensajeDto {
  @IsString()
  @Length(1, LARGO_MAX_MENSAJE_PANEL)
  texto!: string;

  /** Llave de idempotencia que genera la web: reintentar con la misma no manda el mensaje dos veces. */
  @IsUUID()
  clave!: string;
}

/** Los indicadores rápidos de Inicio, de los últimos `dias` días. */
export type IndicadoresChats = {
  dias: number;
  /** Chats que escribieron por primera vez en el período. */
  nuevos: number;
  /** Chats en los que el dueño tomó el control en el período. */
  intervenciones: number;
  /** De los nuevos, los que llegaron a una venta pagada (ventas) o a un turno (agenda). */
  convertidos: number;
  /** "venta" o "turno", según el tipo de asistente. */
  conversionA: 'venta' | 'turno';
};

/** Un producto que el cliente vio o pidió, con lo que sale hoy (precios de la base, nunca del modelo). */
export type ProductoDeInteres = {
  id: string;
  nombre: string;
  /** "pidio" si llegó a pedirlo; si no, "vio". */
  tipo: 'vio' | 'pidio';
  moneda: string;
  precioListaCentavos: number;
  /** Con la mejor promo vigente; igual al de lista si no hay. */
  contadoCentavos: number;
  /** Con el descuento por pagar en efectivo; null si el comercio no lo ofrece. */
  efectivoCentavos: number | null;
  planes: Array<{ cuotas: number; totalCentavos: number; cuotaCentavos: number; recargoCentavos: number }>;
  /** Sólo en productos a demanda: días hábiles para tenerlo. */
  plazoEntregaDias: number | null;
};

/** Lo que el dueño necesita para cerrar la venta: resumen, interés y el pedido actual. */
export type FichaChat = {
  /** El resumen que guarda el asistente del cliente. */
  resumen: string | null;
  productos: ProductoDeInteres[];
  pedido: { id: string; estado: string; totalCentavos: number | null; moneda: string } | null;
  trato: EstadoTrato | null;
  /** Inteligencia comercial estimada por el asistente; null si todavía no hay. */
  analisis: (AnalisisVenta & { temperatura: Temperatura }) | null;
};

export class ItemTratoDto {
  @IsString()
  @Length(1, 64)
  productoId!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_CANTIDAD_POR_ITEM)
  cantidad!: number;
}

/** El dueño marca el trato del chat. Para crear el pedido hacen falta los productos. */
export class CambiarTratoDto {
  @IsIn(ESTADOS_TRATO)
  estado!: EstadoTrato;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS_POR_PEDIDO)
  @ValidateNested({ each: true })
  @Type(() => ItemTratoDto)
  items?: ItemTratoDto[];

  @IsOptional()
  @IsIn(FORMAS_DE_PAGO)
  formaPago?: FormaDePago;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(48)
  cuotas?: number;
}
