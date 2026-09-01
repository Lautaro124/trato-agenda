import {
  DIAS_SEMANA,
  HORA_FIN,
  HORA_INICIO,
  addDays,
  columnaEvento,
  formatDayNumber,
  formatHourLabel,
  isoDate,
  posicionEvento,
} from "@/lib/calendarWeek";

export type EventoSemana = {
  id: string;
  resumen: string;
  inicio: string | null;
  fin: string | null;
  agendadoPorAgente: boolean;
};

const HORAS = Array.from({ length: HORA_FIN - HORA_INICIO }, (_, i) => HORA_INICIO + i);

function formatHoraCorta(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function WeekGrid({
  weekStart,
  eventos,
  onSelectEvento,
}: {
  weekStart: Date;
  eventos: EventoSemana[];
  onSelectEvento?: (evento: EventoSemana) => void;
}) {
  const hoyIso = isoDate(new Date());
  const dias = DIAS_SEMANA.map((_, i) => addDays(weekStart, i));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-card">
      <div className="grid flex-none grid-cols-[56px_repeat(6,1fr)] border-b border-line">
        <div />
        {dias.map((dia, i) => {
          const esHoy = isoDate(dia) === hoyIso;
          return (
            <div
              key={i}
              className={`border-l border-line px-2 py-2.5 text-center ${esHoy ? "bg-primary-subtle" : ""}`}
            >
              <div className={`text-[11px] tracking-[.06em] uppercase ${esHoy ? "text-primary" : "text-muted"}`}>
                {DIAS_SEMANA[i]}
              </div>
              <div className={`font-display text-base font-bold ${esHoy ? "text-primary" : "text-ink"}`}>
                {formatDayNumber(dia)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className="relative grid grid-cols-[56px_repeat(6,1fr)]"
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

          {dias.map((dia, i) => (
            <div
              key={i}
              style={{ gridColumn: i + 2, gridRow: "1 / -1" }}
              className={`border-l border-line ${isoDate(dia) === hoyIso ? "bg-sunken" : ""}`}
            />
          ))}

          {HORAS.map(
            (hora, i) =>
              i > 0 && (
                <div
                  key={hora}
                  style={{ gridColumn: "2 / -1", gridRow: i * 2 + 1 }}
                  className="border-t border-line"
                />
              ),
          )}

          {eventos.map((evento) => {
            const columna = columnaEvento(evento.inicio, weekStart);
            const posicion = posicionEvento(evento.inicio, evento.fin);
            if (columna === null || !posicion) return null;
            return (
              <button
                key={evento.id}
                type="button"
                onClick={() => onSelectEvento?.(evento)}
                style={{
                  gridColumn: columna + 2,
                  gridRow: `${posicion.gridRowStart} / span ${posicion.gridRowSpan}`,
                }}
                className={`m-[1px] mx-1 cursor-pointer overflow-hidden rounded-md px-[7px] py-[3px] text-left ${
                  evento.agendadoPorAgente
                    ? "bg-primary text-primary-on"
                    : "border-l-[3px] border-muted bg-sunken text-ink"
                }`}
              >
                <div className="truncate text-[11.5px] font-semibold">{evento.resumen || "(Sin título)"}</div>
                <div
                  className={`font-mono text-[10px] ${evento.agendadoPorAgente ? "text-primary-on/85" : "text-muted"}`}
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
