"use client";

import type { LocalState } from "@/app/contanos/useLocal";
import { cn } from "@/lib/cn";
import { HORAS_LOCAL, LARGO_MAX_DIRECCION, LARGO_MAX_ENLACE } from "@/lib/local";
import { INPUT } from "./controles";
import { EditorSemana, TEXTOS_LOCAL } from "./EditorSemana";

/** Controles del local a la calle: el paso "Tu local" de /contanos y la sección de /cuenta. */

/**
 * La dirección y el link de Google Maps: lo que tienen en común el local de
 * un comercio y el lugar de los turnos (`ControlesLugar`).
 */
export function CamposDireccion({
  local,
  placeholder = "Ej.: Av. Corrientes 1234, CABA",
}: Readonly<{ local: LocalState; placeholder?: string }>) {
  return (
    <>
      <div>
        <label htmlFor="local-direccion" className="mb-2 block text-[13px] font-semibold text-ink-secondary">
          Dirección
        </label>
        <input
          id="local-direccion"
          value={local.direccion}
          onChange={(e) => local.setDireccion(e.target.value)}
          maxLength={LARGO_MAX_DIRECCION}
          autoComplete="street-address"
          placeholder={placeholder}
          className={INPUT}
        />
        {local.problemas.direccion && (
          <p role="alert" className="mt-1.5 text-[12.5px] text-danger-text">
            {local.problemas.direccion}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="local-enlace" className="mb-2 block text-[13px] font-semibold text-ink-secondary">
          Link de Google Maps <span className="font-normal text-muted">(opcional)</span>
        </label>
        <input
          id="local-enlace"
          type="url"
          inputMode="url"
          value={local.enlaceUbicacion}
          onChange={(e) => local.setEnlaceUbicacion(e.target.value)}
          maxLength={LARGO_MAX_ENLACE}
          autoComplete="url"
          placeholder="https://maps.app.goo.gl/…"
          className={INPUT}
        />
        {local.problemas.enlace ? (
          <p role="alert" className="mt-1.5 text-[12.5px] text-danger-text">
            {local.problemas.enlace}
          </p>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-ink-secondary">
            El asistente lo manda cuando te preguntan cómo llegar.
          </p>
        )}
      </div>
    </>
  );
}

export function ControlesLocal({ local }: Readonly<{ local: LocalState }>) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span id="tiene-local" className="text-[13px] font-semibold text-ink-secondary">
          ¿Tenés local a la calle?
        </span>
        <div
          role="radiogroup"
          aria-labelledby="tiene-local"
          className="grid grid-cols-2 gap-0.5 self-start rounded-md bg-sunken p-[3px]"
        >
          {[
            { valor: true, label: "Sí, tengo local" },
            { valor: false, label: "No, vendo sólo online" },
          ].map((opcion) => {
            const activo = local.tieneLocal === opcion.valor;
            return (
              <button
                key={opcion.label}
                type="button"
                role="radio"
                aria-checked={activo}
                onClick={() => local.setTieneLocal(opcion.valor)}
                className={cn(
                  "min-h-10 cursor-pointer rounded-sm px-3.5 text-[13px] whitespace-nowrap",
                  activo ? "bg-card font-bold text-ink shadow-sm" : "text-ink-secondary hover:text-ink",
                )}
              >
                {opcion.label}
              </button>
            );
          })}
        </div>
      </div>

      {local.tieneLocal && (
        <>
          <CamposDireccion local={local} />

          <EditorSemana
            semana={local.horarios}
            leyenda="Horarios del local"
            textos={TEXTOS_LOCAL}
            horas={HORAS_LOCAL}
          />

          <div className="flex items-start gap-2.5 rounded-md border border-line bg-card px-3.5 py-3">
            <input
              id="local-retiro"
              type="checkbox"
              checked={local.retiroEnLocal}
              onChange={(e) => local.setRetiroEnLocal(e.target.checked)}
              aria-describedby="local-retiro-ayuda"
              className="mt-0.5 size-[18px] flex-none cursor-pointer accent-[var(--color-semantic-primary-default)]"
            />
            <span className="flex flex-col gap-0.5">
              <label htmlFor="local-retiro" className="cursor-pointer text-[14px] font-semibold text-ink">
                Se pueden retirar las compras en el local
              </label>
              <span id="local-retiro-ayuda" className="text-[13px] leading-[1.5] text-ink-secondary">
                Si no lo tildás, el asistente no ofrece retiro y la entrega la coordinás vos.
              </span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
