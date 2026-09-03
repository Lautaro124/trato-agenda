"use client";

import type { ReactNode } from "react";
import {
  AYUDA_POR_PASO,
  PASOS,
  TIPOS_USO,
  ULTIMO_PASO,
  type Onboarding,
} from "@/app/contanos/useOnboarding";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  AgregarEvento,
  CampoBot,
  CampoNombreTitular,
  ChipsTitular,
  GrillaTiposUso,
  ListaEventos,
  PresetsFranja,
  PreviewSaludo,
  SelectoresFranja,
  TextoRango,
} from "./controles";

function Encabezado({ titulo, bajada }: { titulo: string; bajada: ReactNode }) {
  return (
    <>
      <h1 className="mb-2 font-display text-[25px] leading-[1.18] font-bold tracking-[-0.02em] text-ink text-pretty">
        {titulo}
      </h1>
      <p className="mb-5 text-sm leading-[1.6] text-ink-secondary text-pretty">{bajada}</p>
    </>
  );
}

/** Riel izquierdo: los cinco pasos, clickeables para volver a cualquiera. */
function RielPasos({ ob }: { ob: Onboarding }) {
  return (
    <div className="flex flex-col gap-1">
      {PASOS.map((label, i) => {
        const actual = i === ob.paso;
        const hecho = i < ob.paso;
        return (
          <button
            key={label}
            type="button"
            onClick={() => ob.setPaso(i)}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-sm px-3 py-2.5 text-left text-[13.5px]",
              actual ? "bg-card font-semibold shadow-sm" : "bg-transparent",
              i <= ob.paso ? "text-ink" : "text-muted",
            )}
          >
            <span
              className={cn(
                "grid h-[22px] w-[22px] flex-none place-items-center rounded-full text-[11px] font-bold",
                hecho && "bg-accent text-white",
                actual && "bg-primary text-white",
                !hecho && !actual && "border border-line bg-card text-muted",
              )}
            >
              {i + 1}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function WizardEscritorio({
  ob,
  enviando,
  onFinalizar,
}: {
  ob: Onboarding;
  enviando: boolean;
  onFinalizar: () => void;
}) {
  const enUltimo = ob.paso === ULTIMO_PASO;
  const usoElegido = TIPOS_USO.find((tipo) => tipo.id === ob.tipoUso)?.label ?? "";

  return (
    <div className="flex w-full max-w-[940px] overflow-hidden rounded-lg border border-line bg-card shadow-md">
      <div className="flex w-[34%] flex-col border-r border-line bg-sunken p-5">
        <div>
          <Badge tone="primary">Paso 2 de 3</Badge>
        </div>
        <h2 className="mt-4 mb-2 font-display text-[21px] leading-[1.2] font-bold tracking-[-0.02em] text-ink">
          Contanos de vos
        </h2>
        <p className="mb-4 text-[13px] leading-[1.55] text-ink-secondary">
          Cinco datos y el asistente ya sabe cómo hablar y qué agendar.
        </p>
        <RielPasos ob={ob} />
        <div className="mt-auto pt-5">
          <p className="text-xs leading-[1.6] text-muted">{AYUDA_POR_PASO[ob.paso]}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-6">
        {ob.paso === 0 && (
          <div>
            <Encabezado
              titulo="¿A nombre de quién agendamos?"
              bajada="Puede ser tu nombre o el de tu negocio. Es el nombre que va a usar el asistente cuando se presente."
            />
            <div className="mb-5">
              <ChipsTitular ob={ob} />
            </div>
            <CampoNombreTitular ob={ob} />
            <p className="mt-3 text-[12.5px] leading-[1.6] text-muted">
              Ejemplo: “Hola, soy Tati, el asistente de Consultorio Belgrano.”
            </p>
          </div>
        )}

        {ob.paso === 1 && (
          <div>
            <Encabezado
              titulo="¿Para qué lo vas a usar?"
              bajada="Elegí el que más se parezca. Con esto te proponemos los tipos de evento del próximo paso."
            />
            <GrillaTiposUso ob={ob} />
          </div>
        )}

        {ob.paso === 2 && (
          <div>
            <h1 className="mb-2 font-display text-[25px] leading-[1.18] font-bold tracking-[-0.02em] text-ink text-pretty">
              ¿Qué tipos de evento tomás?
            </h1>
            <p className="mb-4 text-sm leading-[1.6] text-ink-secondary text-pretty">
              Sugerencias para <strong className="font-semibold">{usoElegido}</strong>. Tocá para
              activar; tocá la duración para cambiarla.
            </p>
            <ListaEventos ob={ob} className="grid grid-cols-2 gap-2" />
            <div className="mt-4">
              <AgregarEvento ob={ob} />
            </div>
            <p className="mt-3 text-[12.5px] text-muted">
              {ob.seleccionados.length}{" "}
              {ob.seleccionados.length === 1 ? "tipo elegido" : "tipos elegidos"}
            </p>
          </div>
        )}

        {ob.paso === 3 && (
          <div>
            <Encabezado
              titulo="¿En qué franja horaria agendás?"
              bajada="De qué hora a qué hora querés que se puedan registrar eventos. El asistente no ofrece horarios fuera de esta franja."
            />
            <SelectoresFranja ob={ob} />
            <div className="mt-3 mb-5">
              <TextoRango ob={ob} />
            </div>
            <p className="mb-2 text-[12.5px] font-semibold text-ink-secondary">
              O elegí una franja armada
            </p>
            <PresetsFranja ob={ob} />
          </div>
        )}

        {ob.paso === 4 && (
          <div>
            <h1 className="mb-2 font-display text-[25px] leading-[1.18] font-bold tracking-[-0.02em] text-ink text-pretty">
              ¿Cómo se llama tu asistente?
            </h1>
            <p className="mb-4 text-sm leading-[1.6] text-ink-secondary text-pretty">
              Con este nombre saluda a quien te escribe por WhatsApp.
            </p>
            <CampoBot ob={ob} />
            <p className="mt-5 mb-3 text-[12.5px] font-semibold text-ink-secondary">
              Así arranca la conversación
            </p>
            <PreviewSaludo ob={ob} />
          </div>
        )}

        <div className="mt-auto flex items-center gap-3 pt-5">
          <Button variant="ghost" size="md" onClick={ob.irAtras} disabled={ob.paso === 0}>
            Atrás
          </Button>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[12.5px] text-muted">Podés cambiar todo después</span>
            <Button
              variant="primary"
              size="lg"
              disabled={!ob.puedeAvanzar[ob.paso] || enviando}
              onClick={enUltimo ? onFinalizar : ob.irAdelante}
            >
              {enUltimo ? (enviando ? "Creando tu asistente…" : "Vincular WhatsApp") : "Continuar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
