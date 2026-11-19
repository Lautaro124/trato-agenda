import { cn } from "@/lib/cn";
import type { EtiquetaVenta as Etiqueta, Tono } from "@/lib/chats";

const TONOS: Record<Tono, string> = {
  neutral: "bg-sunken text-ink-secondary",
  info: "bg-[var(--color-semantic-info-subtle)] text-[var(--color-semantic-info-text)]",
  warning: "bg-warning-subtle text-warning-text",
  primary: "bg-primary-subtle text-primary-active",
  success: "bg-success-subtle text-success-text",
  danger: "bg-danger-subtle text-danger-text",
};

/**
 * En qué etapa de la venta está el chat.
 */
export function EtiquetaVenta({ etiqueta }: Readonly<{ etiqueta: Etiqueta }>) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-xs font-bold whitespace-nowrap",
        TONOS[etiqueta.tono],
      )}
    >
      {etiqueta.label}
    </span>
  );
}
