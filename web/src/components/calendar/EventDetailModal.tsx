"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { isoDate } from "@/lib/calendarWeek";
import { Button } from "@/components/ui/Button";
import type { EventoSemana } from "./WeekGrid";

const TIMEZONE = "America/Argentina/Buenos_Aires";
const OFFSET_BUENOS_AIRES = "-03:00";

function horaInputDe(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function aIso(fecha: string, hora: string): string {
  return `${fecha}T${hora}:00${OFFSET_BUENOS_AIRES}`;
}

export function EventDetailModal({
  evento,
  onClose,
  onChanged,
}: {
  evento: EventoSemana;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [modo, setModo] = useState<"ver" | "editar">("ver");
  const [titulo, setTitulo] = useState(evento.resumen);
  const [fecha, setFecha] = useState(evento.inicio ? isoDate(new Date(evento.inicio)) : "");
  const [horaInicio, setHoraInicio] = useState(horaInputDe(evento.inicio));
  const [horaFin, setHoraFin] = useState(horaInputDe(evento.fin));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function eliminar() {
    if (!window.confirm(`¿Eliminar "${evento.resumen || "este evento"}" del calendario?`)) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await apiFetch(`/calendar/eventos/${evento.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo eliminar");
      onChanged();
      onClose();
    } catch {
      setError("No pudimos eliminar el evento. Probá de nuevo.");
      setGuardando(false);
    }
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await apiFetch(`/calendar/eventos/${evento.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inicio: aIso(fecha, horaInicio),
          fin: aIso(fecha, horaFin),
          resumen: titulo,
        }),
      });
      if (!res.ok) throw new Error("No se pudo guardar");
      onChanged();
      onClose();
    } catch {
      setError("No pudimos guardar los cambios. Probá de nuevo.");
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg bg-card p-5 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        {modo === "ver" ? (
          <>
            <h2 className="font-display text-lg font-bold text-ink">{evento.resumen || "(Sin título)"}</h2>
            <p className="mt-1 text-[13px] text-ink-secondary">
              {evento.inicio ? new Intl.DateTimeFormat("es-AR", {
                timeZone: TIMEZONE,
                weekday: "long",
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(evento.inicio)) : "Sin horario"}
            </p>
            {error && <p className="mt-2 text-[12.5px] text-danger-text">{error}</p>}
            <div className="mt-5 flex gap-2">
              <Button variant="secondary" onClick={() => setModo("editar")} disabled={guardando}>
                Editar
              </Button>
              <Button variant="danger" onClick={eliminar} disabled={guardando}>
                Eliminar
              </Button>
              <Button variant="ghost" onClick={onClose} disabled={guardando} className="ml-auto">
                Cerrar
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-display text-lg font-bold text-ink">Editar evento</h2>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-secondary">
                Título
                <input
                  className="rounded-md border border-line bg-page px-3 py-2 text-[14px] text-ink"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-secondary">
                Fecha
                <input
                  type="date"
                  className="rounded-md border border-line bg-page px-3 py-2 text-[14px] text-ink"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1 text-[12.5px] font-semibold text-ink-secondary">
                  Desde
                  <input
                    type="time"
                    className="rounded-md border border-line bg-page px-3 py-2 text-[14px] text-ink"
                    value={horaInicio}
                    onChange={(e) => setHoraInicio(e.target.value)}
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-[12.5px] font-semibold text-ink-secondary">
                  Hasta
                  <input
                    type="time"
                    className="rounded-md border border-line bg-page px-3 py-2 text-[14px] text-ink"
                    value={horaFin}
                    onChange={(e) => setHoraFin(e.target.value)}
                  />
                </label>
              </div>
            </div>
            {error && <p className="mt-2 text-[12.5px] text-danger-text">{error}</p>}
            <div className="mt-5 flex gap-2">
              <Button onClick={guardar} disabled={guardando || !fecha || !horaInicio || !horaFin}>
                Guardar
              </Button>
              <Button variant="ghost" onClick={() => setModo("ver")} disabled={guardando} className="ml-auto">
                Cancelar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
