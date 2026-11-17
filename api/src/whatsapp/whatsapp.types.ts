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
  /** Por dónde atiende: la API oficial de Meta o la vinculación por QR o código (Baileys, no oficial). */
  canal: 'meta' | 'baileys' | null;
  /** Si la API tiene la app de Meta configurada: sin ella no se ofrece la conexión oficial. */
  metaDisponible: boolean;
};
