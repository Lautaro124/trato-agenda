"use client";

import type { SemanaState } from "@/app/contanos/useSemana";
import { HORAS_ATENCION, ZONAS_HORARIAS } from "@/lib/horario-atencion";
import { INPUT } from "./controles";
import { EditorSemana, type TextosSemana } from "./EditorSemana";

/** Distintos de los del local: en /cuenta de un comercio están los dos editores juntos. */
export const TEXTOS_ASISTENTE: TextosSemana = {
  dia: (nombre) => `Atiende el ${nombre.toLowerCase()}`,
  desde: "empieza a atender",
  hasta: "deja de atender",
  cerrado: "No atiende",
  deQuien: "del asistente",
};

/** La zona horaria en que se leen las franjas del horario de atención. */
export function SelectorZona({ zona, onZona }: Readonly<{ zona: string; onZona: (zona: string) => void }>) {
  return (
    <div>
      <label htmlFor="horario-zona" className="mb-2 block text-[13px] font-semibold text-ink-secondary">
        Zona horaria
      </label>
      <select id="horario-zona" value={zona} onChange={(e) => onZona(e.target.value)} className={INPUT}>
        {ZONAS_HORARIAS.map((opcion) => (
          <option key={opcion.zona} value={opcion.zona}>
            {opcion.nombre}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-[12.5px] text-ink-secondary">
        Los horarios se leen en la hora de este país, con sus cambios de horario de verano.
      </p>
    </div>
  );
}

/**
 * El horario de atención del asistente (LAU-29) día por día: los días y
 * franjas en que empieza a atender chats nuevos, y la zona horaria en que se
 * leen. Lo usa la sección de /cuenta; el onboarding carga lo mismo con
 * PasoCuandoAtiende.
 */
export function ControlesHorarioAtencion({
  semana,
  zona,
  onZona,
}: Readonly<{ semana: SemanaState; zona: string; onZona: (zona: string) => void }>) {
  return (
    <div className="flex flex-col gap-5">
      <SelectorZona zona={zona} onZona={onZona} />
      <EditorSemana semana={semana} leyenda="Días y horarios" textos={TEXTOS_ASISTENTE} horas={HORAS_ATENCION} />
    </div>
  );
}
