/** Estados que puede mostrar /vincular, empujados por SSE desde el backend. */
export type LinkState = 'active' | 'connecting' | 'connected' | 'expired' | 'error';

export type LinkEvent = {
  state: LinkState;
  /** Presente sólo en estado "active": el string a renderizar como QR. */
  qr?: string;
  /** Presente sólo en estado "connected": el número recién vinculado. */
  phoneNumber?: string;
};
