"use client";

import Link from "next/link";
import { FilaInterruptor } from "@/components/ui/FilaInterruptor";
import { cn } from "@/lib/cn";
import type { AccionSinTarifa, ConfiguracionEnvios } from "@/lib/envios";

const OPCIONES_SIN_TARIFA: Array<{ valor: AccionSinTarifa; titulo: string; ayuda: string }> = [
  {
    valor: "derivar",
    titulo: "Derivarme la consulta",
    ayuda: "Te llega un aviso y le respondés vos por el chat.",
  },
  {
    valor: "cotizar_aparte",
    titulo: "Avisar que se cotiza aparte",
    ayuda: "“El costo a esa zona te lo confirmamos por acá.”",
  },
];

/**
 * Lo que vale para todas las zonas. Si hace envíos y el retiro por el local
 * se editan donde ya estaban (Cuenta y Asistente): acá sólo se muestran.
 */
export function ConfiguracionGeneral({
  config,
  guardando,
  onCambiar,
}: Readonly<{
  config: ConfiguracionEnvios;
  guardando: boolean;
  onCambiar: (cambios: Partial<Pick<ConfiguracionEnvios, "activo" | "moneda" | "sinTarifa">>) => void;
}>) {
  return (
    <section aria-labelledby="t-general" className="flex flex-col gap-5 rounded-lg border border-line bg-card p-5 md:p-6">
      <div className="flex flex-col gap-0.5">
        <h2 id="t-general" className="font-display text-[19px] font-bold text-ink">
          Configuración general
        </h2>
        <p className="text-[14px] text-ink-secondary">Aplica a todas las zonas.</p>
      </div>

      <FilaInterruptor
        titulo="Usar mis tarifas de envío"
        ayuda="Apagado, el asistente coordina el envío por el chat como hasta ahora y no informa costos."
        checked={config.activo}
        onChange={(activo) => onCambiar({ activo })}
      />

      {!config.haceEnvios && (
        <p role="status" className="rounded-md bg-warning-subtle px-3.5 py-2.5 text-[14px] text-warning-text">
          Tu asistente todavía no ofrece envíos, así que no va a usar estas tarifas. Activalo en{" "}
          <Link href="/cuenta" className="font-semibold underline">
            Cuenta › Datos del cliente
          </Link>
          .
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5 text-[14px]">
          <span className="font-semibold text-ink">País de cobertura</span>
          <span className="rounded-md border border-line bg-sunken px-3 py-2.5 text-ink">Argentina</span>
        </div>
        <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-ink">
          Moneda de las tarifas
          <select
            value={config.moneda}
            disabled={guardando}
            onChange={(e) => onCambiar({ moneda: e.target.value as ConfiguracionEnvios["moneda"] })}
            className="min-h-11 rounded-md border border-line-strong bg-card px-3 font-medium text-ink"
          >
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
          </select>
        </label>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2 text-[14px]">
          <span className="font-semibold text-ink">Cómo entregás</span>
          <p className="text-ink-secondary">
            Envíos: <strong className="text-ink">{config.haceEnvios ? "sí" : "no"}</strong> ·{" "}
            <Link href="/cuenta" className="text-link underline">
              cambiar
            </Link>
          </p>
          <p className="text-ink-secondary">
            Retiro por el local: <strong className="text-ink">{config.retiroEnLocal ? "sí" : "no"}</strong> ·{" "}
            <Link href="/asistente" className="text-link underline">
              dirección y horarios
            </Link>
          </p>
        </div>

        <fieldset className="flex flex-col gap-2" disabled={guardando}>
          <legend className="mb-2 text-[14px] font-semibold text-ink">Si un destino no tiene tarifa cargada</legend>
          {OPCIONES_SIN_TARIFA.map((opcion) => {
            const elegida = config.sinTarifa === opcion.valor;
            return (
              <label
                key={opcion.valor}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-md border p-3",
                  elegida ? "border-2 border-primary bg-primary-subtle" : "border-line",
                )}
              >
                <input
                  type="radio"
                  name="sin-tarifa"
                  checked={elegida}
                  onChange={() => onCambiar({ sinTarifa: opcion.valor })}
                  className="mt-1 size-4 accent-[var(--color-semantic-primary-hover)]"
                />
                <span className="flex flex-col">
                  <span className="text-[14.5px] font-semibold text-ink">{opcion.titulo}</span>
                  <span className="text-[13.5px] text-ink-secondary">{opcion.ayuda}</span>
                </span>
              </label>
            );
          })}
          <p className="text-[13px] text-ink-secondary">
            Nunca contesta “no llegamos” si no marcaste esa zona como sin cobertura.
          </p>
        </fieldset>
      </div>
    </section>
  );
}
