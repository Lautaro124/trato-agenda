/** Espejo de PASSWORD_MIN/PASSWORD_MAX en la API (api/src/auth/password.ts). */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** null si la contraseña nueva y su confirmación sirven; si no, qué decirle a la persona. */
export function problemaDePassword(nueva: string, confirmacion: string): string | null {
  if (nueva.length < PASSWORD_MIN) return `Tiene que tener al menos ${PASSWORD_MIN} caracteres.`;
  if (nueva.length > PASSWORD_MAX) return `Puede tener hasta ${PASSWORD_MAX} caracteres.`;
  if (nueva !== confirmacion) return "Las dos contraseñas no coinciden.";
  return null;
}

export const INPUT_FORM =
  "w-full box-border rounded-md border border-line bg-card px-3.5 py-[11px] font-body text-[15px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";
