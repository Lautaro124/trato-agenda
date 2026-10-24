"use client";

import { useEffect, useState } from "react";
import { useSemana } from "@/app/contanos/useSemana";
import { EVENTO_HORARIO_GUARDADO } from "@/components/EstadoAsistente";
import { ControlesHorarioAtencion } from "@/components/onboarding/ControlesHorarioAtencion";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import type { HorarioAtencion } from "@/lib/horario-atencion";
import { DIAS_SEMANA, semanaDesde } from "@/lib/local";

/** El 400 de la API trae el motivo en castellano (horario-atencion.rules.ts). */
async function motivoDelError(res: Response): Promise<string | null> {
  try {
    const cuerpo = (await res.json()) as { message?: unknown };
    return typeof cuerpo.message === "string" ? cuerpo.message : null;
  } catch {
    return null;
  }
}

function EditorHorario({ inicial }: Readonly<{ inicial: HorarioAtencion }>) {
  const semana = useSemana(() => semanaDesde(inicial.franjas));
  const [atenderSiempre, setAtenderSiempre] = useState(!inicial.activo);
  const [zona, setZona] = useState(inicial.zona);
  const [resumen, setResumen] = useState(inicial.resumen);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "error" } | null>(null);

  const conDias = DIAS_SEMANA.some((dia) => semana.semana[dia].abierto);
  const valido = atenderSiempre || (semana.valida && conDias);

  const guardar = () => {
    setGuardando(true);
    setAviso(null);
    apiFetch("/horario-atencion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // Sin restricción las franjas se guardan igual (si están bien), para cuando la vuelva a activar.
      body: JSON.stringify({ activo: !atenderSiempre, franjas: semana.valida ? semana.franjas() : [], zona }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await motivoDelError(res)) ?? "no se pudo guardar");
        const guardado = (await res.json()) as HorarioAtencion;
        setResumen(guardado.resumen);
        setAviso({ texto: "Listo: el asistente ya usa este horario.", tono: "ok" });
        window.dispatchEvent(new Event(EVENTO_HORARIO_GUARDADO));
      })
      .catch((error: unknown) => {
        const motivo = error instanceof Error && error.message !== "no se pudo guardar" ? ` ${error.message}` : "";
        setAviso({ texto: `No pudimos guardar el horario.${motivo}`, tono: "error" });
      })
      .finally(() => setGuardando(false));
  };

  return (
    <>
      <p className="mb-4 text-[13.5px] text-ink">
        Hoy: <span className="font-semibold">{resumen}</span>
      </p>
      <div className="mb-5 flex items-start gap-2.5 rounded-md border border-line bg-page px-3.5 py-3">
        <input
          id="horario-siempre"
          type="checkbox"
          checked={atenderSiempre}
          onChange={(e) => setAtenderSiempre(e.target.checked)}
          aria-describedby="horario-siempre-ayuda"
          className="mt-0.5 size-[18px] flex-none cursor-pointer accent-[var(--color-semantic-primary-default)]"
        />
        <span className="flex flex-col gap-0.5">
          <label htmlFor="horario-siempre" className="cursor-pointer text-[14px] font-semibold text-ink">
            Atender siempre, sin límite de horario
          </label>
          <span id="horario-siempre-ayuda" className="text-[13px] leading-[1.5] text-ink-secondary">
            El asistente contesta a cualquier hora, todos los días. Tu horario queda guardado por si lo volvés a usar.
          </span>
        </span>
      </div>
      {!atenderSiempre && <ControlesHorarioAtencion semana={semana} zona={zona} onZona={setZona} />}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={guardar} disabled={!valido || guardando}>
          {guardando ? "Guardando…" : "Guardar horario"}
        </Button>
        {!valido && !guardando && (
          <p className="text-[13px] text-ink-secondary">Marcá al menos un día con un horario válido.</p>
        )}
        {aviso && (
          <p
            role={aviso.tono === "ok" ? "status" : "alert"}
            className={aviso.tono === "ok" ? "text-[13.5px] text-success-text" : "text-[13.5px] text-danger-text"}
          >
            {aviso.texto}
          </p>
        )}
      </div>
    </>
  );
}

/**
 * Cuándo atiende el asistente por WhatsApp (LAU-29), igual para turnos y
 * ventas. Fuera del horario no empieza chats nuevos; con "Atender siempre"
 * no hay límite.
 */
export function SeccionHorarioAtencion() {
  // undefined = cargando; null = no se pudo cargar.
  const [horario, setHorario] = useState<HorarioAtencion | null | undefined>(undefined);

  useEffect(() => {
    apiFetch("/horario-atencion")
      .then((res) => (res.ok ? (res.json() as Promise<HorarioAtencion>) : null))
      .then(setHorario)
      .catch(() => setHorario(null));
  }, []);

  return (
    <section aria-label="Horario de atención" className="rounded-lg border border-line bg-card p-5">
      <h2 className="mb-2 font-display text-[15px] font-bold text-ink">Horario de atención</h2>
      <p className="mb-4 text-[13.5px] leading-[1.6] text-ink-secondary">
        En estos días y horarios el asistente contesta los chats nuevos. Fuera de ellos no empieza ninguna conversación
        y los mensajes te quedan a vos; si un chat ya venía en curso, lo termina de atender.
      </p>
      {horario === undefined && <p className="text-[13px] text-muted">Cargando…</p>}
      {horario === null && (
        <p className="text-[13px] text-danger-text">No pudimos cargar tu horario de atención. Recargá la página.</p>
      )}
      {horario && <EditorHorario inicial={horario} />}
    </section>
  );
}
