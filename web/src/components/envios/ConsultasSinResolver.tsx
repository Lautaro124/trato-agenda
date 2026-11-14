"use client";

import { Badge } from "@/components/ui/Badge";
import { ETIQUETA_MOTIVO, type ConsultaSinResolver } from "@/lib/envios";

const TONO: Record<ConsultaSinResolver["motivo"], "neutral" | "warning" | "info" | "danger"> = {
  sin_configurar: "neutral",
  conflicto: "warning",
  ambigua: "info",
  contradiccion: "info",
  error: "danger",
};

/** Lo que el asistente no pudo responder: pistas de qué zona falta cargar. */
export function ConsultasSinResolver({ consultas }: Readonly<{ consultas: ConsultaSinResolver[] }>) {
  return (
    <section aria-labelledby="t-pendientes" className="flex flex-col rounded-lg border border-line bg-card">
      <div className="flex flex-col gap-0.5 px-5 py-4 md:px-6">
        <h2 id="t-pendientes" className="font-display text-[19px] font-bold text-ink">
          Consultas que el asistente no pudo responder
        </h2>
        <p className="text-[14px] text-ink-secondary">
          Últimos 30 días. Guardamos sólo la ubicación consultada, nunca la dirección ni el teléfono.
        </p>
      </div>
      {consultas.length === 0 ? (
        <p className="border-t border-line px-5 py-5 text-[14.5px] text-ink-secondary md:px-6">
          Ninguna por ahora.
        </p>
      ) : (
        <ul className="border-t border-line">
          {consultas.map((consulta) => (
            <li
              key={`${consulta.motivo}-${consulta.lugar}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 last:border-b-0 md:px-6"
            >
              <span className="flex-[1_1_220px] text-[15px] font-semibold text-ink">{consulta.lugar}</span>
              <Badge tone={TONO[consulta.motivo]}>{ETIQUETA_MOTIVO[consulta.motivo]}</Badge>
              <span className="min-w-24 text-[14px] text-ink-secondary">
                {consulta.cantidad === 1 ? "1 consulta" : `${consulta.cantidad} consultas`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
