"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AvisoSuscripcion } from "@/components/AvisoSuscripcion";
import { DayGrid } from "@/components/calendar/DayGrid";
import { EventDetailModal } from "@/components/calendar/EventDetailModal";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { type EventoSemana, WeekGrid } from "@/components/calendar/WeekGrid";
import { WeekStrip } from "@/components/calendar/WeekStrip";
import { MobileTabBar } from "@/components/MobileTabBar";
import { Button } from "@/components/ui/Button";
import {
  addDays,
  addMonths,
  firstDayOfMonth,
  formatDayLabel,
  formatMonthYear,
  formatWeekLabel,
  isoDate,
  mondayOf,
} from "@/lib/calendarWeek";
import { apiFetch } from "@/lib/api";
import { useRequireSession } from "@/lib/session";

type EventosAgenda = { eventos: EventoSemana[] };
type Vista = "dia" | "semana" | "mes";

function rangoDe(vista: Vista, fecha: Date): [Date, Date] {
  if (vista === "dia") return [fecha, addDays(fecha, 1)];
  if (vista === "mes") {
    const inicio = mondayOf(firstDayOfMonth(fecha));
    return [inicio, addDays(inicio, 42)];
  }
  const inicio = mondayOf(fecha);
  return [inicio, addDays(inicio, 6)];
}

export default function CalendarioPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const [vista, setVista] = useState<Vista>("semana");
  const [fecha, setFecha] = useState(() => new Date());
  const [eventos, setEventos] = useState<EventoSemana[] | null>(null);
  const [error, setError] = useState(false);
  const [eventoSeleccionado, setEventoSeleccionado] = useState<EventoSemana | null>(null);

  const cargarEventos = useCallback(() => {
    if (status !== "authenticated") return;
    const [desde, hasta] = rangoDe(vista, fecha);
    apiFetch(`/calendar/eventos?desde=${isoDate(desde)}&hasta=${isoDate(hasta)}`)
      .then((res) => {
        if (!res.ok) throw new Error("eventos no disponibles");
        return res.json() as Promise<EventosAgenda>;
      })
      .then((data) => {
        setEventos(data.eventos);
        setError(false);
      })
      .catch(() => setError(true));
  }, [status, vista, fecha]);

  useEffect(() => {
    cargarEventos();
  }, [cargarEventos]);

  function avanzar(direccion: 1 | -1) {
    setFecha((f) => {
      if (vista === "dia") return addDays(f, direccion);
      if (vista === "mes") return addMonths(f, direccion);
      return addDays(f, direccion * 7);
    });
  }

  function tabClase(v: Vista): string {
    return `cursor-pointer px-3 py-1.5 text-[12.5px] ${
      vista === v ? "bg-primary font-semibold text-primary-on" : "text-muted"
    }`;
  }

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
      <AvisoSuscripcion />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-5 bg-page p-5 pb-24 md:pb-5 lg:grid-cols-[1fr_320px]">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink">
                {formatMonthYear(fecha)}
              </h1>
              <p className="text-[13px] text-ink-secondary">
                {vista === "semana" ? formatWeekLabel(mondayOf(fecha)) : vista === "dia" ? formatDayLabel(fecha) : ""}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => avanzar(-1)}
                className="grid size-8 cursor-pointer place-items-center rounded-sm border border-line bg-card text-sm text-ink-secondary"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setFecha(new Date())}
                className="cursor-pointer rounded-sm border border-line bg-card px-3 py-1.5 text-[12.5px] font-semibold text-ink"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() => avanzar(1)}
                className="grid size-8 cursor-pointer place-items-center rounded-sm border border-line bg-card text-sm text-ink-secondary"
              >
                ›
              </button>
              <div className="ml-1.5 hidden overflow-hidden rounded-sm border border-line bg-card md:flex">
                <button type="button" onClick={() => setVista("dia")} className={tabClase("dia")}>
                  Día
                </button>
                <button type="button" onClick={() => setVista("semana")} className={tabClase("semana")}>
                  Semana
                </button>
                <button type="button" onClick={() => setVista("mes")} className={tabClase("mes")}>
                  Mes
                </button>
              </div>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-danger-text">
              No pudimos cargar tu agenda de Google Calendar ahora mismo.
            </p>
          ) : (
            <>
              {/* Móvil: solo tira de días + agenda del día elegido (5c del canvas) */}
              <div className="flex min-h-0 flex-1 flex-col gap-3 md:hidden">
                <WeekStrip
                  weekStart={mondayOf(fecha)}
                  eventos={eventos ?? []}
                  selected={fecha}
                  onSelect={setFecha}
                />
                <DayGrid fecha={fecha} eventos={eventos ?? []} onSelectEvento={setEventoSeleccionado} />
              </div>

              {/* Escritorio: selector Día/Semana/Mes */}
              <div className="hidden min-h-0 flex-1 md:flex md:flex-col">
                {vista === "dia" ? (
                  <DayGrid fecha={fecha} eventos={eventos ?? []} onSelectEvento={setEventoSeleccionado} />
                ) : vista === "mes" ? (
                  <MonthGrid fecha={fecha} eventos={eventos ?? []} onSelectEvento={setEventoSeleccionado} />
                ) : (
                  <WeekGrid weekStart={mondayOf(fecha)} eventos={eventos ?? []} onSelectEvento={setEventoSeleccionado} />
                )}
              </div>
            </>
          )}
        </div>

        <div className="hidden min-h-0 flex-col gap-4 lg:flex">
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

      <MobileTabBar active="calendario" />

      {eventoSeleccionado && (
        <EventDetailModal
          evento={eventoSeleccionado}
          onClose={() => setEventoSeleccionado(null)}
          onChanged={cargarEventos}
        />
      )}
    </div>
  );
}
