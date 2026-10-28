"use client";

import { dondeSeQuedan, ETIQUETA_ETAPA, type Performance } from "@/lib/performance";

/** "2 activos · 1 estancado · 3 abandonados": sólo lo que hay. */
function desglose(etapa: Performance["etapas"][number]): string {
  const partes = [
    etapa.activos > 0 && `${etapa.activos} ${etapa.activos === 1 ? "activo" : "activos"}`,
    etapa.estancados > 0 && `${etapa.estancados} ${etapa.estancados === 1 ? "estancado" : "estancados"}`,
    etapa.abandonados > 0 && `${etapa.abandonados} ${etapa.abandonados === 1 ? "abandonado" : "abandonados"}`,
    etapa.derivados > 0 && `${etapa.derivados} ${etapa.derivados === 1 ? "pasó" : "pasaron"} a una persona`,
  ].filter(Boolean);
  return partes.join(" · ");
}

/**
 * Dónde está cada chat nuevo del período: una barra por etapa (una sola
 * serie), con el desglose en texto. Arriba, la etapa donde más se quedan.
 */
export function Etapas({ performance }: { performance: Performance }) {
  const { etapas, definiciones } = performance;
  // "Eligiendo" y "Listo para comprar" sólo existen si la cuenta pide datos del cliente: vacías, no se muestran.
  const visibles = etapas.filter((etapa) => etapa.total > 0 || (etapa.etapa !== "eligiendo" && etapa.etapa !== "lista"));
  const maximo = Math.max(...visibles.map((etapa) => etapa.total), 1);
  const quietos = dondeSeQuedan(etapas);

  return (
    <section aria-labelledby="titulo-etapas" className="flex flex-col gap-3">
      <div>
        <h2 id="titulo-etapas" className="font-display text-[17px] font-bold text-ink">
          Dónde están los chats
        </h2>
        <p className="text-[13px] text-ink-secondary">
          La etapa más avanzada a la que llegó cada chat nuevo del período.
        </p>
      </div>
      {quietos && (
        <p className="rounded-md border border-line bg-sunken px-3 py-2 text-[13.5px] text-ink">
          Donde más se quedan: <strong>{ETIQUETA_ETAPA[quietos.etapa]}</strong> —{" "}
          {quietos.estancados + quietos.abandonados} {quietos.estancados + quietos.abandonados === 1 ? "chat" : "chats"} sin
          movimiento.
        </p>
      )}
      <div className="rounded-lg border border-line bg-card p-5">
        <ol className="flex flex-col gap-3">
          {visibles.map((etapa) => (
            <li key={etapa.etapa}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-ink">{ETIQUETA_ETAPA[etapa.etapa]}</span>
                <span className="font-semibold text-ink tabular-nums">{etapa.total.toLocaleString("es-AR")}</span>
              </div>
              <div
                aria-hidden="true"
                className="h-3 rounded-r-[4px] bg-primary"
                style={{ width: `${etapa.total === 0 ? 0 : Math.max((etapa.total / maximo) * 100, 1.5)}%` }}
              />
              {etapa.total > 0 && etapa.etapa !== "pagado" && (
                <p className="mt-1 text-[12px] text-ink-secondary">{desglose(etapa)}</p>
              )}
            </li>
          ))}
        </ol>
      </div>
      <p className="text-[12px] text-muted">
        {definiciones.estancado} {definiciones.abandonado}
      </p>
    </section>
  );
}
