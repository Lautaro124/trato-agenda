import { addDays, firstDayOfMonth, isoDate, mondayOf } from "@/lib/calendarWeek";
import type { EventoSemana } from "./WeekGrid";

const DIAS_HEADER = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;
const CELDAS = 42;
const MAX_CHIPS_POR_CELDA = 3;

export function MonthGrid({
  fecha,
  eventos,
  onSelectEvento,
}: {
  fecha: Date;
  eventos: EventoSemana[];
  onSelectEvento?: (evento: EventoSemana) => void;
}) {
  const hoyIso = isoDate(new Date());
  const mesActual = isoDate(firstDayOfMonth(fecha)).slice(0, 7);
  const gridStart = mondayOf(firstDayOfMonth(fecha));
  const dias = Array.from({ length: CELDAS }, (_, i) => addDays(gridStart, i));

  const eventosPorDia = new Map<string, EventoSemana[]>();
  for (const evento of eventos) {
    if (!evento.inicio) continue;
    const clave = isoDate(new Date(evento.inicio));
    const lista = eventosPorDia.get(clave) ?? [];
    lista.push(evento);
    eventosPorDia.set(clave, lista);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-card">
      <div className="grid flex-none grid-cols-7 border-b border-line">
        {DIAS_HEADER.map((dia) => (
          <div key={dia} className="py-2.5 text-center text-[11px] uppercase tracking-[.06em] text-muted">
            {dia}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7">
        {dias.map((dia, i) => {
          const diaIso = isoDate(dia);
          const esHoy = diaIso === hoyIso;
          const enMes = diaIso.slice(0, 7) === mesActual;
          const eventosDelDia = eventosPorDia.get(diaIso) ?? [];
          const visibles = eventosDelDia.slice(0, MAX_CHIPS_POR_CELDA);
          const restantes = eventosDelDia.length - visibles.length;

          return (
            <div
              key={i}
              className={`flex min-h-0 flex-col gap-[3px] overflow-hidden p-1.5 ${i > 6 ? "border-t border-line" : ""} ${
                i % 7 ? "border-l border-line" : ""
              } ${esHoy ? "bg-primary-subtle" : ""} ${enMes ? "" : "opacity-45"}`}
            >
              <div
                className={`font-display text-[12.5px] font-bold ${esHoy ? "text-primary" : "text-ink"}`}
              >
                {diaIso.slice(8, 10)}
              </div>
              {visibles.map((evento) => (
                <button
                  key={evento.id}
                  type="button"
                  onClick={() => onSelectEvento?.(evento)}
                  className={`cursor-pointer truncate rounded-[5px] px-1.5 py-[2px] text-left text-[10.5px] font-semibold ${
                    evento.agendadoPorAgente
                      ? "bg-primary text-primary-on"
                      : "border-l-[3px] border-muted bg-sunken text-ink"
                  }`}
                >
                  {evento.resumen || "(Sin título)"}
                </button>
              ))}
              {restantes > 0 && <span className="px-1.5 text-[10px] text-muted">+{restantes} más</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
