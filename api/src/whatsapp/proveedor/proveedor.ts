import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { ReferenciaAnuncio } from '../../comercio/anuncios.rules.js';
import type { WhatsappStatus } from '../whatsapp.types.js';

/**
 * El canal de WhatsApp separado de quién lo transporta (LAU-110). Hoy el único
 * proveedor es Baileys; el oficial se suma implementando estas interfaces, sin
 * tocar la lógica de conversación de `WhatsappService` (ráfagas, atención
 * humana, suscripción, horario, audios, imágenes).
 */
export const PROVEEDORES_WHATSAPP = ['baileys', 'cloud'] as const;
export type IdProveedor = (typeof PROVEEDORES_WHATSAPP)[number];

/** Proveedor de las cuentas que nunca eligieron otro: las de antes de LAU-110. */
export const PROVEEDOR_POR_DEFECTO: IdProveedor = 'baileys';

export function esProveedor(valor: unknown): valor is IdProveedor {
  return typeof valor === 'string' && (PROVEEDORES_WHATSAPP as readonly string[]).includes(valor);
}

/** Lo que sale hacia un chat. La imagen ya viene procesada (JPEG chico, sin metadatos). */
export type ContenidoSaliente = { texto: string } | { imagen: Buffer; leyenda?: string };

/** Un audio o una imagen que mandó el cliente, todavía sin bajar. */
export type MediaEntrante = {
  /** Lo que declara el que manda: puede mentir, por eso `descargar` tiene topes propios. */
  bytes: number;
  mime?: string | null;
  /** Si apunta al host del proveedor: si no, ni se intenta bajar. */
  descargable: boolean;
  /**
   * Baja el contenido con tope de bytes y de tiempo, sólo desde el host del
   * proveedor. null si pasa del tope; rechaza si falla o vence el plazo.
   */
  descargar(maxBytes: number, plazoMs: number): Promise<Buffer | null>;
};

export type ContenidoEntrante =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'audio'; segundos: number; media: MediaEntrante }
  | { tipo: 'imagen'; caption?: string | null; media: MediaEntrante }
  /** Algo que el asistente no mira (stickers, documentos…): sólo sirve su `telefono`. */
  | { tipo: 'otro' };

/**
 * Una conexión viva de un comercio con su proveedor. Lo que se arma para
 * contestar viaja con su sesión y sale por la misma: si se cerró o la
 * reemplazó otra, `vigente` lo dice y no se manda.
 */
export interface SesionCanal {
  readonly proveedor: IdProveedor;
  readonly userId: string;
  /** Sigue siendo la conexión de la cuenta (no se cerró ni la reemplazó otra). */
  vigente(): boolean;
  /** Toda salida a un cliente: lo enviado queda para reenvíos y para reconocer su eco. */
  enviar(chat: string, contenido: ContenidoSaliente): Promise<void>;
  /** Si `idExterno` es de un mensaje que salió por esta API (su eco no es del dueño). */
  esEnviadoPorTrato(idExterno: string | null | undefined): boolean;
  /** El chat consigo mismo del titular, si se sabe: ahí van los códigos de acceso. */
  chatPropio(): string | null;
  /** Lo cosmético nunca frena nada: estos tres no fallan. */
  marcarLeido(entrante: EntranteCanal): void;
  escribiendo(chat: string, escribe: boolean): void;
  seguirPresencia(chat: string): void;
}

/** Un evento entrante ya normalizado, venga del proveedor que venga. */
export type EntranteCanal = {
  sesion: SesionCanal;
  /** Clave del chat en `Conversation.remoteJid`. */
  chat: string;
  /** Id del mensaje en el proveedor, para no atenderlo dos veces. */
  idExterno: string | null;
  /** Lo escribió el titular (desde su teléfono o desde Trato). */
  deMi: boolean;
  /** Número del cliente cuando el proveedor lo da aparte de `chat` (chats LID). */
  telefono: string | null;
  enviadoEn: number | null;
  /** El anuncio o el estado propio desde el que escribió (LAU-103). */
  anuncio: Omit<ReferenciaAnuncio, 'imagen'> | null;
  /** La imagen completa del estado citado (la miniatura es borrosa), si la hay. */
  imagenDelAnuncio?: MediaEntrante;
  contenido: ContenidoEntrante;
  /** Lo que el proveedor necesite para marcarlo leído; el resto no lo mira. */
  ref?: unknown;
};

/** Lo que un fallo le pide al dueño. Sin datos personales: va a la base y al panel. */
export type FalloCanal = 'volver_a_vincular' | 'sin_conexion';

/** Quien atiende lo que llega por un proveedor: `WhatsappService`. */
export interface ReceptorCanal {
  /** Un lote de eventos de una sola cuenta, tal como llegó (cada chat en orden, los chats en paralelo). */
  recibir(entrantes: EntranteCanal[]): Promise<void>;
  /** "Escribiendo…" o "grabando…" del cliente. */
  clienteEscribiendo(sesion: SesionCanal, chat: string, escribe: boolean): void;
  /** Se cerró la conexión de la cuenta: lo que no se contestó no sale por ella. */
  sesionCerrada(userId: string): void;
  /** La conexión quedó en un estado que el dueño tiene que ver (null: se recuperó). */
  fallo(userId: string, proveedor: IdProveedor, fallo: FalloCanal | null): void;
}

/**
 * Un proveedor de WhatsApp. La vinculación es propia de cada uno (Baileys:
 * QR o código con SSE); envío y recepción pasan por `SesionCanal` y `ReceptorCanal`.
 */
export interface ProveedorWhatsapp {
  readonly id: IdProveedor;
  escuchar(receptor: ReceptorCanal): void;
  /** La sesión vinculada de la cuenta, o null si no hay por dónde mandar. */
  sesionVinculada(userId: string): SesionCanal | null;
  status(userId: string): Promise<WhatsappStatus>;
  linkEvents$(userId: string): Observable<MessageEvent>;
  /** Cierra la conexión y borra las credenciales de la cuenta. */
  unlink(userId: string): Promise<void>;
  /** Un mensaje al chat propio del titular, sin guardarlo en memoria. false si no hay por dónde. */
  enviarAlPropioChat(userId: string, texto: string): Promise<boolean>;
  /** El número detrás de un chat que no lo trae, según el proveedor. */
  telefonoDeChat(userId: string, chat: string): Promise<string | null>;
}
