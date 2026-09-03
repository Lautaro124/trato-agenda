"use client";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  HORAS,
  PRESETS_FRANJA,
  SUGERENCIAS_BOT,
  TIPOS_USO,
  type Onboarding,
} from "@/app/contanos/useOnboarding";

/** Controles compartidos por el wizard de escritorio y el formulario móvil. */

const INPUT =
  "w-full box-border rounded-md border border-line bg-card px-3.5 py-[13px] font-body text-[15px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";

function chip(activo: boolean): string {
  return cn(
    "cursor-pointer rounded-full border px-3 py-[7px] text-[13px] select-none",
    activo
      ? "border-primary bg-primary font-semibold text-primary-on"
      : "border-line bg-card text-ink hover:border-line-strong",
  );
}

export function ChipsTitular({ ob }: { ob: Onboarding }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => ob.setTipoTitular("persona")} className={chip(ob.tipoTitular === "persona")}>
        Soy una persona
      </button>
      <button type="button" onClick={() => ob.setTipoTitular("negocio")} className={chip(ob.tipoTitular === "negocio")}>
        Tengo un negocio
      </button>
    </div>
  );
}

export function CampoNombreTitular({ ob, conLabel = true }: { ob: Onboarding; conLabel?: boolean }) {
  const esPersona = ob.tipoTitular === "persona";
  return (
    <>
      {conLabel && (
        <label htmlFor="nombre-titular" className="mb-2 block text-[12.5px] font-semibold text-ink-secondary">
          {esPersona ? "¿Cómo te llamás?" : "¿Cómo se llama tu negocio?"}
        </label>
      )}
      <input
        id="nombre-titular"
        value={ob.nombreTitular}
        onChange={(e) => ob.setNombreTitular(e.target.value)}
        placeholder={esPersona ? "Ej.: Lucía Fernández" : "Ej.: Consultorio Belgrano"}
        className={INPUT}
      />
    </>
  );
}

export function GrillaTiposUso({ ob, conHint = true }: { ob: Onboarding; conHint?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {TIPOS_USO.map((tipo) => {
        const activo = tipo.id === ob.tipoUso;
        return (
          <button
            key={tipo.id}
            type="button"
            onClick={() => ob.elegirTipoUso(tipo.id)}
            className={cn(
              "cursor-pointer rounded-md border p-4 text-left transition-colors",
              activo ? "border-primary bg-primary-subtle" : "border-line bg-card hover:border-line-strong",
            )}
          >
            <div className="mb-[3px] font-display text-[15px] font-semibold text-ink">{tipo.label}</div>
            {conHint && <div className="text-[12.5px] leading-[1.5] text-ink-secondary">{tipo.hint}</div>}
          </button>
        );
      })}
    </div>
  );
}

export function ListaEventos({ ob, className }: { ob: Onboarding; className?: string }) {
  return (
    <div className={className ?? "grid grid-cols-1 gap-2 sm:grid-cols-2"}>
      {ob.eventos.map((evento) => {
        const activo = Boolean(ob.elegidos[evento.nombre]);
        const duracion = ob.elegidos[evento.nombre] ?? evento.duracionMin;
        return (
          <div
            key={evento.nombre}
            role="button"
            tabIndex={0}
            onClick={() => ob.alternarEvento(evento.nombre, evento.duracionMin)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                ob.alternarEvento(evento.nombre, evento.duracionMin);
              }
            }}
            className={cn(
              "flex cursor-pointer items-center justify-between gap-2.5 rounded-sm border px-[13px] py-[11px] select-none",
              activo ? "border-primary bg-primary-subtle" : "border-line bg-card hover:border-line-strong",
            )}
          >
            <span className="text-[14px] text-ink">{evento.nombre}</span>
            <span
              role="button"
              tabIndex={-1}
              title="Tocá para cambiar la duración"
              onClick={(e) => {
                // El pill cicla la duración sin apagar el tipo de evento.
                e.stopPropagation();
                ob.ciclarDuracion(evento.nombre);
              }}
              className={cn(
                "rounded-full px-[9px] py-[3px] font-mono text-[11.5px] font-semibold",
                activo ? "bg-primary text-primary-on" : "bg-sunken text-muted",
              )}
            >
              {duracion} min
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function AgregarEvento({ ob }: { ob: Onboarding }) {
  return (
    <div className="flex items-center gap-2">
      <input
        value={ob.personalizado}
        onChange={(e) => ob.setPersonalizado(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            ob.agregarPersonalizado();
          }
        }}
        placeholder="Agregar otro tipo (ej.: control anual)"
        className="box-border flex-1 rounded-md border border-line bg-card px-[13px] py-[11px] font-body text-[13.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]"
      />
      <Button variant="secondary" size="md" onClick={ob.agregarPersonalizado}>
        Agregar
      </Button>
    </div>
  );
}

export function SelectoresFranja({ ob }: { ob: Onboarding }) {
  return (
    <div className="flex items-end gap-4">
      <div className="flex-1">
        <label htmlFor="hora-desde" className="mb-2 block text-[12.5px] font-semibold text-ink-secondary">
          Desde
        </label>
        <select
          id="hora-desde"
          value={ob.horaDesde}
          onChange={(e) => ob.setHoraDesde(e.target.value)}
          className={INPUT}
        >
          {HORAS.map((hora) => (
            <option key={hora} value={hora}>
              {hora}
            </option>
          ))}
        </select>
      </div>
      <span className="pb-3.5 text-sm text-muted">a</span>
      <div className="flex-1">
        <label htmlFor="hora-hasta" className="mb-2 block text-[12.5px] font-semibold text-ink-secondary">
          Hasta
        </label>
        <select
          id="hora-hasta"
          value={ob.horaHasta}
          onChange={(e) => ob.setHoraHasta(e.target.value)}
          className={INPUT}
        >
          {HORAS.map((hora) => (
            <option key={hora} value={hora}>
              {hora}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function PresetsFranja({ ob }: { ob: Onboarding }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PRESETS_FRANJA.map((preset) => (
        <button
          key={preset.label}
          type="button"
          onClick={() => ob.elegirPreset(preset.desde, preset.hasta)}
          className={chip(ob.horaDesde === preset.desde && ob.horaHasta === preset.hasta)}
        >
          {preset.label} · {preset.desde}–{preset.hasta}
        </button>
      ))}
    </div>
  );
}

export function TextoRango({ ob }: { ob: Onboarding }) {
  return ob.rangoValido ? (
    <p className="text-[12.5px] leading-[1.6] text-ink-secondary">
      Agendo entre las {ob.horaDesde} y las {ob.horaHasta}.
    </p>
  ) : (
    <p className="text-[12.5px] leading-[1.6] text-danger-text">
      La hora de fin tiene que ser posterior a la de inicio.
    </p>
  );
}

export function CampoBot({ ob }: { ob: Onboarding }) {
  return (
    <>
      <input
        value={ob.nombreBot}
        onChange={(e) => ob.setNombreBot(e.target.value)}
        placeholder="Ej.: Tati"
        className={INPUT}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGERENCIAS_BOT.map((nombre) => (
          <button
            key={nombre}
            type="button"
            onClick={() => ob.setNombreBot(nombre)}
            className={chip(ob.nombreBot === nombre)}
          >
            {nombre}
          </button>
        ))}
      </div>
    </>
  );
}

/** Vista previa de cómo arranca la conversación con los datos cargados. */
export function PreviewSaludo({ ob, conCliente = true }: { ob: Onboarding; conCliente?: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-sunken p-4">
      <div className="max-w-[88%] self-start rounded-[16px_16px_16px_4px] border border-line bg-card px-[13px] py-[11px] text-[13.5px] leading-[1.5] text-ink shadow-sm">
        {ob.saludo}
      </div>
      <div className="max-w-[88%] self-start rounded-2xl border border-line bg-card px-[13px] py-[11px] text-[13.5px] leading-[1.5] text-ink-secondary shadow-sm">
        {ob.saludoEventos} {ob.saludoHorarios}
      </div>
      {conCliente && (
        <div className="max-w-[80%] self-end rounded-[16px_16px_4px_16px] border border-[#c9e9d6] bg-accent-subtle px-[13px] py-[11px] text-[13.5px] leading-[1.5] text-ink">
          Quiero un turno para el jueves a la tarde
        </div>
      )}
    </div>
  );
}
