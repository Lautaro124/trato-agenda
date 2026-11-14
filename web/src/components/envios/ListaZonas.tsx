"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ETIQUETA_ESTADO, ETIQUETA_NIVEL, plazoDeZona, type EstadoZona, type Zona } from "@/lib/envios";
import { formatearMonto } from "@/lib/productos";

const TONO_ESTADO: Record<EstadoZona, "success" | "info" | "danger"> = {
  tarifa: "success",
  cotizacion: "info",
  sin_cobertura: "danger",
};

function tarifas(zona: Zona, moneda: string): string {
  if (zona.estado === "sin_cobertura") return "—";
  if (zona.estado === "cotizacion") {
    return [zona.domicilio && "Domicilio", zona.sucursal && "Sucursal"].filter(Boolean).join(" · ") + " · se cotiza";
  }
  const precio = (c: number | null) => (c === 0 ? "sin cargo" : c === null ? "—" : formatearMonto(c, moneda));
  return [
    zona.domicilio && `Domicilio ${precio(zona.tarifaDomicilioCentavos)}`,
    zona.sucursal && `Sucursal ${precio(zona.tarifaSucursalCentavos)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Las zonas del comercio, con lo que el asistente respondería en cada una. */
export function ListaZonas({
  zonas,
  moneda,
  ocupada,
  onNueva,
  onEditar,
  onActiva,
  onEliminar,
}: Readonly<{
  zonas: Zona[];
  moneda: string;
  ocupada: string | null;
  onNueva: () => void;
  onEditar: (zona: Zona) => void;
  onActiva: (zona: Zona, activa: boolean) => void;
  onEliminar: (zona: Zona) => void;
}>) {
  return (
    <section aria-labelledby="t-zonas" className="flex flex-col rounded-lg border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-6">
        <div className="flex flex-col gap-0.5">
          <h2 id="t-zonas" className="font-display text-[19px] font-bold text-ink">
            Zonas
          </h2>
          <p className="text-[14px] text-ink-secondary">
            Si un destino entra en varias, gana la más específica: código postal, después localidad, provincia y país.
          </p>
        </div>
        <Button variant="secondary" onClick={onNueva}>
          Nueva zona
        </Button>
      </div>

      {zonas.length === 0 ? (
        <p className="border-t border-line px-5 py-6 text-[14.5px] text-ink-secondary md:px-6">
          Todavía no cargaste zonas. Sin zonas, el asistente responde lo que elegiste para los destinos sin tarifa.
        </p>
      ) : (
        <ul className="border-t border-line">
          {zonas.map((zona) => {
            const plazo = plazoDeZona(zona);
            const ocupadaEsta = ocupada === zona.id;
            return (
              <li key={zona.id} className="flex flex-wrap items-start gap-x-5 gap-y-2 border-b border-line px-5 py-4 last:border-b-0 md:px-6">
                <div className="flex min-w-[220px] flex-[2_1_260px] flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => onEditar(zona)}
                    className="cursor-pointer self-start text-left text-[15.5px] font-bold text-ink underline-offset-2 hover:underline"
                  >
                    {zona.nombre}
                  </button>
                  <p className="text-[13.5px] text-ink-secondary">
                    {zona.coberturas
                      .slice(0, 4)
                      .map((c) => `${ETIQUETA_NIVEL[c.nivel]}: ${c.etiqueta}`)
                      .join(" · ")}
                    {zona.coberturas.length > 4 ? ` y ${zona.coberturas.length - 4} más` : ""}
                  </p>
                </div>
                <div className="flex flex-[1_1_160px] flex-col items-start gap-1">
                  <Badge tone={TONO_ESTADO[zona.estado]}>{ETIQUETA_ESTADO[zona.estado]}</Badge>
                  {!zona.activa && <Badge>Pausada</Badge>}
                </div>
                <div className="flex flex-[2_1_220px] flex-col text-[14px] text-ink">
                  <span>{tarifas(zona, moneda)}</span>
                  {zona.gratisDesdeCentavos !== null && (
                    <span className="text-ink-secondary">Gratis desde {formatearMonto(zona.gratisDesdeCentavos, moneda)}</span>
                  )}
                  {plazo && <span className="text-ink-secondary">{plazo} (estimado)</span>}
                </div>
                <div className="flex flex-[1_1_200px] flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={ocupadaEsta}
                    onClick={() => onActiva(zona, !zona.activa)}
                    aria-label={`${zona.activa ? "Pausar" : "Activar"} ${zona.nombre}`}
                    className="min-h-11"
                  >
                    {zona.activa ? "Pausar" : "Activar"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={ocupadaEsta}
                    onClick={() => onEliminar(zona)}
                    aria-label={`Borrar ${zona.nombre}`}
                    className="min-h-11 text-danger-text"
                  >
                    Borrar
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
