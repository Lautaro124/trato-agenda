"use client";

import type { ReactNode } from "react";
import type { Onboarding } from "@/app/contanos/useOnboarding";
import { Button } from "@/components/ui/Button";
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

function Seccion({ numero, titulo, children }: { numero: number; titulo: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[12.5px] font-semibold text-ink-secondary">
        {numero} · {titulo}
      </p>
      {children}
    </div>
  );
}

/** Las mismas cinco preguntas del wizard, en una sola pantalla scrolleable. */
export function FormularioMovil({
  ob,
  enviando,
  onFinalizar,
}: {
  ob: Onboarding;
  enviando: boolean;
  onFinalizar: () => void;
}) {
  return (
    <div className="flex min-h-dvh w-full flex-col bg-page">
      <div className="flex items-center gap-3 px-5 pt-4 pb-2.5">
        <span className="text-sm font-semibold text-ink">Contanos de vos</span>
        <span className="ml-auto text-xs text-muted">Paso 2 de 3</span>
      </div>

      <div className="flex flex-1 flex-col gap-[22px] overflow-auto px-5 pb-4">
        <Seccion numero={1} titulo="Nombre de la persona o del negocio">
          <div className="mb-2.5">
            <ChipsTitular ob={ob} />
          </div>
          <CampoNombreTitular ob={ob} conLabel={false} />
        </Seccion>

        <Seccion numero={2} titulo="Tipo de uso">
          <GrillaTiposUso ob={ob} conHint={false} />
        </Seccion>

        <Seccion numero={3} titulo="Tipos de evento">
          <ListaEventos ob={ob} className="flex flex-col gap-2" />
          <div className="mt-2.5">
            <AgregarEvento ob={ob} />
          </div>
        </Seccion>

        <Seccion numero={4} titulo="Franja horaria">
          <SelectoresFranja ob={ob} />
          <div className="mt-2.5">
            <TextoRango ob={ob} />
          </div>
          <div className="mt-2.5">
            <PresetsFranja ob={ob} />
          </div>
        </Seccion>

        <Seccion numero={5} titulo="Nombre del asistente">
          <CampoBot ob={ob} />
          <div className="mt-3 rounded-md border border-line bg-card p-3.5">
            <span className="mb-2 block text-[11px] text-muted">Vista previa del saludo</span>
            <PreviewSaludo ob={ob} conCliente={false} />
          </div>
        </Seccion>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-line px-5 pt-3.5 pb-8">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={!ob.completo || enviando}
          onClick={onFinalizar}
        >
          {enviando ? "Creando tu asistente…" : "Continuar"}
        </Button>
      </div>
    </div>
  );
}
