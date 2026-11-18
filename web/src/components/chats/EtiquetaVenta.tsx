import { cn } from "@/lib/cn";
import { ETAPAS_VISIBLES, type EtiquetaVenta as Etiqueta, type Tono } from "@/lib/chats";

const TONOS: Record<Tono, string> = {
  neutral: "bg-sunken text-ink-secondary",
  info: "bg-[var(--color-semantic-info-subtle)] text-[var(--color-semantic-info-text)]",
  warning: "bg-warning-subtle text-warning-text",
  primary: "bg-primary-subtle text-primary-active",
  success: "bg-success-subtle text-success-text",
  danger: "bg-danger-subtle text-danger-text",
};

/**
 * En qué etapa de la venta está el chat. Los puntitos repiten el avance para
 * que no dependa sólo del color; el texto es lo que lee el lector de pantalla.
 */
export function EtiquetaVenta({ etiqueta }: Readonly<{ etiqueta: Etiqueta }>) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-xs font-bold whitespace-nowrap",
        TONOS[etiqueta.tono],
      )}
    >
      {etiqueta.paso !== null && (
        <span aria-hidden className="inline-flex gap-0.5">
          {ETAPAS_VISIBLES.map((etapa, indice) => (
            <span
              key={etapa.id}
              className={cn("size-[5px] rounded-full bg-current", indice + 1 > (etiqueta.paso ?? 0) && "opacity-25")}
            />
          ))}
        </span>
      )}
      {etiqueta.label}
    </span>
  );
}
