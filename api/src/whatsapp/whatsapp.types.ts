import type { FalloCanal, IdProveedor } from './proveedor/proveedor.js';

/** Estados que puede mostrar /vincular, empujados por SSE desde el backend. */
export type LinkState = 'active' | 'connecting' | 'connected' | 'expired' | 'error';

export type LinkEvent = {
  state: LinkState;
  /** Presente sólo en estado "active": el string a renderizar como QR. */
  qr?: string;
  /** Presente sólo en estado "connected": el número recién vinculado. */
  phoneNumber?: string;
  /** Presente sólo en estado "error" cuando se sabe por qué falló. */
  motivo?: MotivoError;
};

/** `numero_en_uso`: ese WhatsApp ya es la cuenta de otra persona en Trato. */
export type MotivoError = 'numero_en_uso';

/** Estado de vinculación consultable fuera del SSE, para mostrar en el header. */
export type WhatsappStatus = {
  linked: boolean;
  phoneNumber: string | null;
  /** Lo siguiente es del canal del comercio (LAU-110); un proveedor sólo informa lo de arriba. */
  proveedor?: IdProveedor;
  /** Las respuestas automáticas están en pausa: atiende el dueño desde Chats o su teléfono. */
  automatizacionPausada?: boolean;
  /** Lo que el dueño tiene que resolver para que el canal vuelva a andar. */
  fallo?: FalloCanal | null;
};
