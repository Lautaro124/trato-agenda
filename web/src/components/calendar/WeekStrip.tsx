import { addDays, DIAS_SEMANA, formatDayNumber, isoDate } from "@/lib/calendarWeek";
import type { EventoSemana } from "./WeekGrid";

/** Tira de días para elegir fecha en el calendario móvil (variante 5c del canvas). */
export function WeekStrip({
  weekStart,
  eventos,
  selected,
  onSelect,
}: {
  weekStart: Date;
  eventos: EventoSemana[];
  selected: Date;
  onSelect: (dia: Date) => void;
}) {
  const hoyIso = isoDate(new Date());
  const seleccionadoIso = isoDate(selected);

  const diasConEventos = new Set(
    eventos.filter((e) => e.inicio).map((e) => isoDate(new Date(e.inicio as string))),
  );

  const dias = DIAS_SEMANA.map((_, i) => addDays(weekStart, i));

  return (
    <div className="grid flex-none grid-cols-6 gap-1.5 rounded-lg border border-line bg-card p-2 md:hidden">
      {dias.map((dia, i) => {
        const diaIso = isoDate(dia);
        const esHoy = diaIso === hoyIso;
        const esSeleccionado = diaIso === seleccionadoIso;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(dia)}
            className={`flex min-h-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md ${
              esSeleccionado ? "bg-primary" : esHoy ? "bg-primary-subtle" : ""
            }`}
          >
            <span
              className={`text-[10px] tracking-[.06em] uppercase ${
                esSeleccionado ? "text-primary-on/85" : esHoy ? "text-primary" : "text-muted"
              }`}
            >
              {DIAS_SEMANA[i]}
            </span>
            <span
              className={`font-display text-[15px] font-bold ${
                esSeleccionado ? "text-primary-on" : esHoy ? "text-primary" : "text-ink"
              }`}
            >
              {formatDayNumber(dia)}
            </span>
            <span
              className={`size-1 rounded-full ${
                diasConEventos.has(diaIso) ? (esSeleccionado ? "bg-primary-on" : "bg-accent") : "bg-transparent"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
