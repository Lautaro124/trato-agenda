"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { EventDetailModal } from "@/components/calendar/EventDetailModal";
import { type EventoSemana, WeekGrid } from "@/components/calendar/WeekGrid";
import { Button } from "@/components/ui/Button";
import { addDays, formatMonthYear, formatWeekLabel, isoDate, mondayOf } from "@/lib/calendarWeek";
import { apiFetch } from "@/lib/api";
import { useRequireSession } from "@/lib/session";

type SemanaAgenda = { desde: string; eventos: EventoSemana[] };

export default function CalendarioPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [eventos, setEventos] = useState<EventoSemana[] | null>(null);
  const [error, setError] = useState(false);
  const [eventoSeleccionado, setEventoSeleccionado] = useState<EventoSemana | null>(null);

  const cargarSemana = useCallback(() => {
    if (status !== "authenticated") return;
    apiFetch(`/calendar/semana?desde=${isoDate(weekStart)}`)
      .then((res) => {
        if (!res.ok) throw new Error("semana no disponible");
        return res.json() as Promise<SemanaAgenda>;
      })
      .then((data) => {
        setEventos(data.eventos);
        setError(false);
      })
      .catch(() => setError(true));
  }, [status, weekStart]);

  useEffect(() => {
    cargarSemana();
  }, [cargarSemana]);

  if (status !== "authenticated" || !user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando tu agenda…</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="calendario" user={user} />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-5 bg-page p-5 lg:grid-cols-[1fr_320px]">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink">
                {formatMonthYear(weekStart)}
              </h1>
              <p className="text-[13px] text-ink-secondary">{formatWeekLabel(weekStart)}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setWeekStart((w) => addDays(w, -7))}
                className="grid size-8 cursor-pointer place-items-center rounded-sm border border-line bg-card text-sm text-ink-secondary"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setWeekStart(mondayOf(new Date()))}
                className="cursor-pointer rounded-sm border border-line bg-card px-3 py-1.5 text-[12.5px] font-semibold text-ink"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() => setWeekStart((w) => addDays(w, 7))}
                className="grid size-8 cursor-pointer place-items-center rounded-sm border border-line bg-card text-sm text-ink-secondary"
              >
                ›
              </button>
              <div className="ml-1.5 flex overflow-hidden rounded-sm border border-line bg-card">
                <span className="cursor-not-allowed px-3 py-1.5 text-[12.5px] text-muted">Día</span>
                <span className="bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-on">Semana</span>
                <span className="cursor-not-allowed px-3 py-1.5 text-[12.5px] text-muted">Mes</span>
              </div>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-danger-text">
              No pudimos cargar tu agenda de Google Calendar ahora mismo.
            </p>
          ) : (
            <WeekGrid weekStart={weekStart} eventos={eventos ?? []} onSelectEvento={setEventoSeleccionado} />
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <div className="rounded-lg border border-line bg-card p-4">
            <h2 className="mb-3 font-display text-[14.5px] font-bold text-ink">Referencias</h2>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5 text-[12.5px] text-ink-secondary">
                <span className="size-3 flex-none rounded-[3px] bg-primary" />
                Agendado por el agente
              </div>
              <div className="flex items-center gap-2.5 text-[12.5px] text-ink-secondary">
                <span className="size-3 flex-none rounded-[3px] border border-line-strong bg-sunken" />
                De tu Google Calendar
              </div>
            </div>
          </div>

          <div className="mt-auto rounded-lg bg-sunken p-4">
            <p className="mb-3 text-[12.5px] leading-[1.6] text-ink-secondary">
              ¿Querés mover algo? Pedíselo al agente en palabras y él reacomoda la semana.
            </p>
            <Button variant="secondary" fullWidth onClick={() => router.push("/inicio")}>
              Abrir el chat
            </Button>
          </div>
        </div>
      </main>

      {eventoSeleccionado && (
        <EventDetailModal
          evento={eventoSeleccionado}
          onClose={() => setEventoSeleccionado(null)}
          onChanged={cargarSemana}
        />
      )}
    </div>
  );
}
