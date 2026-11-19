import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { IndicadoresChats } from "@/lib/chats";

export type AtajoIndicador = "nuevos" | "intervenciones" | "convertidos";

function porcentaje(parte: number, total: number): string {
  // Sin chats nuevos no hay tasa: "sin datos" no es 0 %.
  return total > 0 ? `${Math.round((parte / total) * 100)} %` : "–";
}

/**
 * Los indicadores rápidos de Inicio. Cada uno es un atajo: filtra la lista de
 * chats a lo que cuenta.
 */
export function Indicadores({
  indicadores,
  teEsperan,
  activo,
  onElegir,
}: Readonly<{
  indicadores: IndicadoresChats | null;
  /** Chats que atendés vos y esperan respuesta, de la lista. */
  teEsperan: number;
  activo: AtajoIndicador | null;
  onElegir: (atajo: AtajoIndicador) => void;
}>) {
  const i = indicadores;
  const periodo = i ? `en los últimos ${i.dias} días` : "";
  return (
    <section aria-label="Indicadores rápidos" data-tutorial="indicadores" className="flex flex-wrap gap-2">
      <Atajo
        activo={activo === "nuevos"}
        onClick={() => onElegir("nuevos")}
        valor={i?.nuevos ?? "–"}
        label="chats nuevos"
        titulo={`Chats que te escribieron por primera vez ${periodo}`}
      />
      <Atajo
        activo={activo === "intervenciones"}
        onClick={() => onElegir("intervenciones")}
        valor={i?.intervenciones ?? "–"}
        label="intervenciones"
        titulo={`Chats en los que tomaste el control ${periodo}`}
        extra={
          teEsperan > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-danger-text">
              <span aria-hidden className="size-[7px] rounded-full bg-danger" />
              {teEsperan} te {teEsperan === 1 ? "espera" : "esperan"}
            </span>
          )
        }
      />
      <Atajo
        activo={activo === "convertidos"}
        onClick={() => onElegir("convertidos")}
        valor={i ? porcentaje(i.convertidos, i.nuevos) : "–"}
        label={i?.conversionA === "turno" ? "chat a turno" : "chat a venta"}
        titulo={
          i
            ? `${i.convertidos} de ${i.nuevos} chats nuevos ${periodo} ${i.conversionA === "turno" ? "sacaron un turno" : "pagaron"}`
            : ""
        }
      />
    </section>
  );
}

function Atajo({
  activo,
  onClick,
  valor,
  label,
  titulo,
  extra,
}: Readonly<{
  activo: boolean;
  onClick: () => void;
  valor: ReactNode;
  label: string;
  titulo: string;
  extra?: ReactNode;
}>) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      title={titulo}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border bg-card px-3.5 text-left [@media(max-height:820px)]:min-h-9",
        activo ? "border-2 border-primary px-[13px]" : "border-line hover:bg-sunken",
      )}
    >
      <span className="font-display text-[18px] font-bold text-ink [@media(max-height:820px)]:text-[16px]">{valor}</span>
      <span className="text-[13px] font-semibold text-ink-secondary">{label}</span>
      {extra}
      <span className="sr-only">. {titulo}</span>
    </button>
  );
}
