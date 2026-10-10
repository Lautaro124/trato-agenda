"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  CAMPOS_ESTANDAR,
  LARGO_MAX_ETIQUETA,
  MAX_CAMPOS_PERSONALIZADOS,
  type DatosClienteState,
} from "@/lib/datos-cliente";
import { chip } from "./controles";

/**
 * Qué datos le pide el asistente de ventas al cliente. Lo usan el paso
 * "Datos del cliente" de /contanos y la sección de /cuenta.
 */

const TILDE = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

function HaceEnvios({ datos }: { datos: DatosClienteState }) {
  const opciones = [
    { valor: true, label: "Sí, hago envíos" },
    { valor: false, label: "No hago envíos" },
  ];
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <span id="hace-envios" className="text-[13px] font-semibold text-ink-secondary">
        ¿Hacés envíos?
      </span>
      <div
        role="radiogroup"
        aria-labelledby="hace-envios"
        className="grid grid-cols-2 gap-0.5 rounded-md bg-sunken p-[3px] sm:inline-grid"
      >
        {opciones.map((opcion) => {
          const activo = opcion.valor === datos.haceEnvios;
          return (
            <button
              key={opcion.label}
              type="button"
              role="radio"
              aria-checked={activo}
              onClick={() => datos.setHaceEnvios(opcion.valor)}
              className={cn(
                "min-h-9 cursor-pointer rounded-sm px-3.5 text-[13px] whitespace-nowrap",
                activo ? "bg-card font-bold text-ink shadow-sm" : "text-ink-secondary hover:text-ink",
              )}
            >
              {opcion.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** El chip "Obligatorio" de un campo tildado: apagado, el asistente lo pide pero no lo exige. */
function ChipObligatorio({
  etiqueta,
  obligatorio,
  onCambio,
}: {
  etiqueta: string;
  obligatorio: boolean;
  onCambio: (obligatorio: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={obligatorio}
      aria-label={`${etiqueta} obligatorio`}
      onClick={() => onCambio(!obligatorio)}
      className={cn(chip(obligatorio), "flex-none whitespace-nowrap")}
    >
      Obligatorio
    </button>
  );
}

function FilaCampo({
  etiqueta,
  activo,
  onAlternar,
  children,
}: {
  etiqueta: string;
  activo: boolean;
  onAlternar?: () => void;
  children?: ReactNode;
}) {
  const marca = (
    <span
      aria-hidden
      className={cn(
        "grid size-[18px] flex-none place-items-center rounded-[6px] border",
        activo ? "border-primary bg-primary text-primary-on" : "border-line-strong bg-card",
      )}
    >
      {activo && TILDE}
    </span>
  );
  const texto = (
    <span className={cn("min-w-0 flex-1 text-[14px] break-words text-ink", activo && "font-semibold")}>{etiqueta}</span>
  );
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2.5 rounded-sm border px-[13px] py-[9px]",
        activo ? "border-primary bg-primary-subtle" : "border-line bg-card hover:border-line-strong",
      )}
    >
      {onAlternar ? (
        <button
          type="button"
          aria-pressed={activo}
          onClick={onAlternar}
          className="flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left select-none"
        >
          {marca}
          {texto}
        </button>
      ) : (
        <span className="flex min-h-8 min-w-0 flex-1 items-center gap-2.5">
          {marca}
          {texto}
        </span>
      )}
      {children}
    </div>
  );
}

/**
 * `puedeRetirar`: lo que dice el paso "Tu local". Sin saberlo (en /cuenta, que
 * edita el local en otra sección) la explicación cubre los dos casos.
 */
export function EditorDatosCliente({ datos, puedeRetirar }: { datos: DatosClienteState; puedeRetirar?: boolean }) {
  const conRetiro =
    "Si el cliente puede retirar en tu local, el asistente le pregunta primero si lo quiere con envío o si lo retira, y los datos tildados los pide sólo si es con envío.";
  const sinRetiro = "Como no hay retiro en el local, todos los pedidos van con envío: el asistente pide los datos tildados siempre.";
  const explicacion = !datos.haceEnvios
    ? "Si tildás algún dato, el asistente se lo pide al cliente en cada pedido, antes de cerrarlo."
    : puedeRetirar === undefined
      ? `${conRetiro} Si no hay retiro, los pide siempre.`
      : puedeRetirar
        ? conRetiro
        : sinRetiro;
  return (
    <div className="flex max-w-[560px] flex-col gap-5">
      <div>
        <HaceEnvios datos={datos} />
        <p className="mt-2 text-[12.5px] leading-[1.5] text-muted">{explicacion}</p>
      </div>

      <div>
        <p className="mb-2 text-[13px] font-semibold text-ink-secondary">Qué le pide</p>
        <div className="flex flex-col gap-1.5">
          <FilaCampo etiqueta="Nombre (lo pide siempre)" activo />
          {CAMPOS_ESTANDAR.map((campo) => {
            const obligatorio = datos.estandar[campo.tipo];
            const activo = obligatorio !== undefined;
            return (
              <FilaCampo
                key={campo.tipo}
                etiqueta={campo.etiqueta}
                activo={activo}
                onAlternar={() => datos.alternarEstandar(campo.tipo)}
              >
                {activo && (
                  <ChipObligatorio
                    etiqueta={campo.etiqueta}
                    obligatorio={obligatorio}
                    onCambio={(valor) => datos.fijarObligatorioEstandar(campo.tipo, valor)}
                  />
                )}
              </FilaCampo>
            );
          })}
          {datos.personalizados.map((campo) => (
            <FilaCampo key={campo.etiqueta} etiqueta={campo.etiqueta} activo>
              <ChipObligatorio
                etiqueta={campo.etiqueta}
                obligatorio={campo.obligatorio}
                onCambio={(valor) => datos.fijarObligatorioPersonalizado(campo.etiqueta, valor)}
              />
              <button
                type="button"
                aria-label={`Quitar ${campo.etiqueta}`}
                onClick={() => datos.quitarPersonalizado(campo.etiqueta)}
                className="grid size-8 flex-none cursor-pointer place-items-center rounded-full text-ink-secondary hover:bg-sunken hover:text-ink"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </FilaCampo>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <input
            value={datos.nuevo}
            onChange={(e) => datos.cambiarNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                datos.agregarPersonalizado();
              }
            }}
            maxLength={LARGO_MAX_ETIQUETA}
            disabled={datos.personalizadosLlenos}
            aria-label="Nuevo dato del cliente"
            placeholder="Agregar otro dato (ej.: entre calles)"
            className="box-border min-w-0 flex-1 rounded-md border border-line bg-card px-[13px] py-[11px] font-body text-[13.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)] disabled:bg-sunken"
          />
          <Button variant="secondary" size="md" onClick={datos.agregarPersonalizado} disabled={datos.personalizadosLlenos}>
            Agregar
          </Button>
        </div>
        {datos.avisoNuevo && (
          <p role="status" className="mt-2 text-[12.5px] text-danger-text">
            {datos.avisoNuevo}
          </p>
        )}
        {datos.personalizadosLlenos && (
          <p className="mt-2 text-[12.5px] text-muted">Llegaste al máximo de {MAX_CAMPOS_PERSONALIZADOS} datos propios.</p>
        )}
      </div>
    </div>
  );
}
