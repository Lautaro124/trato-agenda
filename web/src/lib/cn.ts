/** Une clases condicionales. Sin dependencias: el proyecto no tiene clases en conflicto. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
