import { IsBoolean, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { LARGO_MAX_NOTA } from '../comercio/pedido-a-medida.rules.js';
import type { MensajePublico } from '../comercio/ventas.types.js';
import type { AtencionChat } from './atencion.js';

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
  pedido: { estado: string; tipo: string } | null;
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
