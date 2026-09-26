"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { leerPrecio, precioParaInput } from "@/lib/precio";
import {
  HORAS,
  LARGO_MAX_BOT,
  LARGO_MAX_NOMBRE_EVENTO,
  LARGO_MAX_TITULAR,
  MAX_TIPOS_EVENTO,
  PRESETS_FRANJA,
  SUGERENCIAS_BOT,
  TIPOS_USO,
  duracionVecina,
  type Onboarding,
  type TiposEventoState,
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
        maxLength={LARGO_MAX_TITULAR}
        // En móvil no hay <label>: sin esto el campo no tiene nombre accesible.
        aria-label={conLabel ? undefined : "Nombre de la persona o del negocio"}
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

/** Campo de precio en pesos: sólo dígitos, se muestra con separador de miles. Vacío = sin precio. */
function CampoPrecio({
  valor,
  onChange,
  etiqueta,
  placeholder = "Opcional",
  deshabilitado = false,
}: {
  valor: number | undefined;
  onChange: (precio: number | undefined) => void;
  etiqueta: string;
  placeholder?: string;
  deshabilitado?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center rounded-sm border border-line focus-within:border-[var(--color-semantic-border-focus)]",
        deshabilitado ? "bg-sunken" : "bg-card",
      )}
    >
      <span aria-hidden className="pl-3 text-[14px] text-muted">
        $
      </span>
      <input
        value={precioParaInput(valor)}
        onChange={(e) => onChange(leerPrecio(e.target.value))}
        inputMode="numeric"
        autoComplete="off"
        aria-label={etiqueta}
        placeholder={deshabilitado ? "—" : placeholder}
        disabled={deshabilitado}
        className="w-full min-w-0 bg-transparent px-2 py-[9px] font-mono text-[14px] text-ink outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}

/** − duración + de un tipo activado: recorre `DURACIONES` y se traba en los extremos. */
function SelectorDuracion({
  nombre,
  duracion,
  onChange,
}: {
  nombre: string;
  duracion: number;
  onChange: (min: number) => void;
}) {
  const menos = duracionVecina(duracion, -1);
  const mas = duracionVecina(duracion, 1);
  const boton =
    "grid size-10 cursor-pointer place-items-center text-[18px] leading-none text-ink-secondary disabled:cursor-not-allowed disabled:text-line-strong sm:size-8 sm:text-[16px]";
  return (
    <div
      role="group"
      aria-label={`Duración de ${nombre}`}
      className="flex flex-none items-center self-start rounded-sm border border-line bg-card sm:self-auto"
    >
      <button
        type="button"
        aria-label="Menos tiempo"
        disabled={menos === undefined}
        onClick={() => menos !== undefined && onChange(menos)}
        className={boton}
      >
        −
      </button>
      <output aria-live="polite" className="min-w-[60px] text-center font-mono text-[13px] font-semibold text-ink">
        {duracion} min
      </output>
      <button
        type="button"
        aria-label="Más tiempo"
        disabled={mas === undefined}
        onClick={() => mas !== undefined && onChange(mas)}
        className={boton}
      >
        +
      </button>
    </div>
  );
}

/**
 * Un tipo de evento por fila. Tildarlo muestra la duración y el precio en la
 * misma fila (debajo en móvil), así la lista no salta al activar uno.
 */
export function ListaEventos({ ob }: { ob: TiposEventoState }) {
  return (
    <div className="flex flex-col gap-1.5">
      {ob.eventos.map((evento) => {
        const datos = ob.elegidos[evento.nombre];
        const activo = Boolean(datos);
        const duracion = datos?.duracionMin ?? evento.duracionMin;
        return (
          <div
            key={evento.nombre}
            className={cn(
              "flex flex-col gap-2.5 rounded-sm border px-[13px] py-[9px] sm:flex-row sm:items-center",
              activo ? "border-primary bg-primary-subtle" : "border-line bg-card hover:border-line-strong",
            )}
          >
            <button
              type="button"
              aria-pressed={activo}
              onClick={() => ob.alternarEvento(evento.nombre, evento.duracionMin)}
              className="flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left select-none"
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-[18px] flex-none place-items-center rounded-[6px] border",
                  activo ? "border-primary bg-primary text-primary-on" : "border-line-strong bg-card",
                )}
              >
                {activo && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
              <span className={cn("min-w-0 flex-1 text-[14px] break-words text-ink", activo && "font-semibold")}>
                {evento.nombre}
              </span>
              {!activo && (
                <span aria-hidden className="flex-none rounded-full bg-sunken px-[9px] py-[3px] font-mono text-[11.5px] font-semibold text-muted">
                  {duracion} min
                </span>
              )}
            </button>
            {activo && (
              // En móvil el precio y "Sin precio" bajan a su propia línea: al lado del − / + no entran.
              <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <SelectorDuracion
                  nombre={evento.nombre}
                  duracion={duracion}
                  onChange={(min) => ob.fijarDuracion(evento.nombre, min)}
                />
                <div className="flex min-w-[200px] flex-1 items-center gap-2 sm:min-w-0 sm:flex-none">
                  <div className="min-w-0 flex-1 sm:w-[120px] sm:flex-none">
                    <CampoPrecio
                      valor={datos.precio}
                      onChange={(precio) => ob.fijarPrecio(evento.nombre, precio)}
                      etiqueta={`Precio de ${evento.nombre}`}
                      deshabilitado={Boolean(datos.sinPrecio)}
                    />
                  </div>
                  <button
                    type="button"
                    aria-pressed={Boolean(datos.sinPrecio)}
                    aria-label={`Sin precio para ${evento.nombre}`}
                    onClick={() => ob.fijarSinPrecio(evento.nombre, !datos.sinPrecio)}
                    className={cn(chip(Boolean(datos.sinPrecio)), "flex-none whitespace-nowrap")}
                  >
                    Sin precio
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Atajo para cuando todos los tipos elegidos cuestan lo mismo, o ninguno tiene precio. */
export function PrecioParaTodos({ ob }: { ob: TiposEventoState }) {
  const [precio, setPrecio] = useState<number | undefined>(undefined);
  if (ob.seleccionados.length < 2) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 sm:flex-nowrap">
      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
        <CampoPrecio valor={precio} onChange={setPrecio} etiqueta="Mismo precio para todos" placeholder="Mismo precio para todos" />
      </div>
      <Button variant="secondary" size="md" onClick={() => ob.fijarPrecioATodos(precio)} disabled={precio === undefined}>
        Aplicar
      </Button>
      <Button variant="secondary" size="md" onClick={() => ob.fijarPrecioATodos(undefined)} aria-label="Sin precio para todos">
        Sin precio
      </Button>
    </div>
  );
}

export function AgregarEvento({ ob }: { ob: TiposEventoState }) {
  return (
    <div>
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
          maxLength={LARGO_MAX_NOMBRE_EVENTO}
          disabled={ob.tiposLlenos}
          aria-label="Nuevo tipo de evento"
          placeholder="Agregar otro tipo (ej.: control anual)"
          className="box-border flex-1 rounded-md border border-line bg-card px-[13px] py-[11px] font-body text-[13.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)] disabled:bg-sunken"
        />
        <Button variant="secondary" size="md" onClick={ob.agregarPersonalizado} disabled={ob.tiposLlenos}>
          Agregar
        </Button>
      </div>
      {ob.tiposLlenos && (
        <p className="mt-2 text-[12.5px] text-muted">Llegaste al máximo de {MAX_TIPOS_EVENTO} tipos de evento.</p>
      )}
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
        maxLength={LARGO_MAX_BOT}
        aria-label="Nombre del asistente"
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
