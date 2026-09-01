import { HORA_FIN, HORA_INICIO, formatDayLabel, formatHourLabel, isoDate, posicionEvento } from "@/lib/calendarWeek";
import type { EventoSemana } from "./WeekGrid";

const HORAS = Array.from({ length: HORA_FIN - HORA_INICIO }, (_, i) => HORA_INICIO + i);

function formatHoraCorta(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function DayGrid({
  fecha,
  eventos,
  onSelectEvento,
}: {
  fecha: Date;
  eventos: EventoSemana[];
  onSelectEvento?: (evento: EventoSemana) => void;
}) {
  const fechaIso = isoDate(fecha);
  const eventosDelDia = eventos.filter((evento) => evento.inicio && isoDate(new Date(evento.inicio)) === fechaIso);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-card">
      <div className="flex-none border-b border-line px-4 py-2.5">
        <span className="font-display text-base font-bold text-primary">{formatDayLabel(fecha)}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className="relative grid grid-cols-[56px_1fr]"
          style={{ gridTemplateRows: `repeat(${HORAS.length * 2}, 32px)` }}
        >
          {HORAS.map((hora, i) => (
            <div
              key={hora}
              style={{ gridColumn: 1, gridRow: i * 2 + 1 }}
              className="px-2 text-right font-mono text-[10.5px] text-muted"
            >
              {formatHourLabel(hora)}
            </div>
          ))}

          <div style={{ gridColumn: 2, gridRow: "1 / -1" }} className="border-l border-line bg-sunken" />

          {HORAS.map(
            (hora, i) =>
              i > 0 && (
                <div
                  key={hora}
                  style={{ gridColumn: 2, gridRow: i * 2 + 1 }}
                  className="border-t border-line"
                />
              ),
          )}

          {eventosDelDia.map((evento) => {
            const posicion = posicionEvento(evento.inicio, evento.fin);
            if (!posicion) return null;
            return (
              <button
                key={evento.id}
                type="button"
                onClick={() => onSelectEvento?.(evento)}
                style={{
                  gridColumn: 2,
                  gridRow: `${posicion.gridRowStart} / span ${posicion.gridRowSpan}`,
                }}
                className={`m-[1px] mx-2 cursor-pointer overflow-hidden rounded-md px-3 py-1.5 text-left ${
                  evento.agendadoPorAgente
                    ? "bg-primary text-primary-on"
                    : "border-l-[3px] border-muted bg-card text-ink"
                }`}
              >
                <div className="truncate text-[13px] font-semibold">{evento.resumen || "(Sin título)"}</div>
                <div
                  className={`font-mono text-[11px] ${evento.agendadoPorAgente ? "text-primary-on/85" : "text-muted"}`}
                >
                  {formatHoraCorta(evento.inicio)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
