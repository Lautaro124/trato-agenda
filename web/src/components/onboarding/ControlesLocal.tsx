"use client";

import type { LocalState } from "@/app/contanos/useLocal";
import { cn } from "@/lib/cn";
import {
  DIAS_SEMANA,
  HORAS_LOCAL,
  LARGO_MAX_DIRECCION,
  LARGO_MAX_ENLACE,
  NOMBRE_DIA,
  type DiaSemana,
} from "@/lib/local";
import { INPUT } from "./controles";

/** Controles del local a la calle: el paso "Tu local" de /contanos y la sección de /cuenta. */

const SELECT_HORA =
  "box-border min-h-10 rounded-sm border border-line bg-card px-2 text-[14px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";

const BOTON_TEXTO = "min-h-9 cursor-pointer text-[13px] font-semibold text-primary-hover hover:underline";

function SelectorHora({
  valor,
  onChange,
  etiqueta,
}: Readonly<{
  valor: string;
  onChange: (hora: string) => void;
  etiqueta: string;
}>) {
  // Una hora guardada que no está en la grilla (09:15 cargado por API) se sigue mostrando.
  const opciones = HORAS_LOCAL.includes(valor)
    ? HORAS_LOCAL
    : [...HORAS_LOCAL, valor].sort((a, b) => a.localeCompare(b));
  return (
    <select aria-label={etiqueta} value={valor} onChange={(e) => onChange(e.target.value)} className={SELECT_HORA}>
      {opciones.map((hora) => (
        <option key={hora} value={hora}>
          {hora}
        </option>
      ))}
    </select>
  );
}

/** Cómo se nombra cada franja en las etiquetas: con corte, "(mañana)" y "(tarde)". */
const PARTES_CON_CORTE = ["mañana", "tarde"];

function FilaDia({ local, dia }: Readonly<{ local: LocalState; dia: DiaSemana }>) {
  const { abierto, franjas } = local.semana[dia];
  const nombre = NOMBRE_DIA[dia];
  const problema = local.problemas.dias[dia];
  const partes = franjas.length > 1 ? PARTES_CON_CORTE : ["única"];
  return (
    <li className="flex flex-col gap-2 border-b border-sunken py-3 last:border-b-0 sm:flex-row sm:items-start sm:gap-4">
      <label className="flex min-h-10 w-[130px] flex-none cursor-pointer items-center gap-2.5 text-[14px] text-ink">
        <input
          type="checkbox"
          checked={abierto}
          onChange={() => local.alternarDia(dia)}
          className="size-[18px] accent-[var(--color-semantic-primary-default)]"
        />
        {nombre}
      </label>
      {abierto ? (
        <div className="flex flex-1 flex-col gap-2">
          {franjas.map((franja, indice) => {
            const parte = partes[indice];
            const cual = franjas.length > 1 ? ` (${parte})` : "";
            return (
              <div key={parte} className="flex flex-wrap items-center gap-2">
                <SelectorHora
                  etiqueta={`${nombre}${cual}: abre`}
                  valor={franja.desde}
                  onChange={(hora) => local.fijarHora(dia, indice, "desde", hora)}
                />
                <span className="text-[13px] text-muted">a</span>
                <SelectorHora
                  etiqueta={`${nombre}${cual}: cierra`}
                  valor={franja.hasta}
                  onChange={(hora) => local.fijarHora(dia, indice, "hasta", hora)}
                />
                {indice === franjas.length - 1 && (
                  <button
                    type="button"
                    onClick={() => (franjas.length > 1 ? local.quitarCorte(dia) : local.agregarCorte(dia))}
                    className={BOTON_TEXTO}
                  >
                    {franjas.length > 1 ? "Sin corte" : "Cierra al mediodía"}
                  </button>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-3">
            {problema && (
              <p role="alert" className="text-[12.5px] text-danger-text">
                {problema}
              </p>
            )}
            <button
              type="button"
              onClick={() => local.copiarATodos(dia)}
              aria-label={`Copiar el horario del ${nombre.toLowerCase()} a los demás días`}
              className={cn(BOTON_TEXTO, "text-ink-secondary")}
            >
              Copiar a los demás días
            </button>
          </div>
        </div>
      ) : (
        <span className="flex min-h-10 items-center text-[13.5px] text-muted">Cerrado</span>
      )}
    </li>
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
              placeholder="Ej.: Av. Corrientes 1234, CABA"
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

          <fieldset>
            <legend className="mb-1 text-[13px] font-semibold text-ink-secondary">Horarios del local</legend>
            <ul className="rounded-md border border-line bg-card px-3.5">
              {DIAS_SEMANA.map((dia) => (
                <FilaDia key={dia} local={local} dia={dia} />
              ))}
            </ul>
          </fieldset>

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
