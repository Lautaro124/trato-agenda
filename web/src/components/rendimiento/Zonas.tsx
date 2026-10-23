"use client";

import { cn } from "@/lib/cn";
import {
  porcentaje,
  type FiltroZona,
  type Performance,
} from "@/lib/performance";

/**
 * Los chats nuevos del período por zona: una tabla (varias medidas por fila)
 * con cuántas zonas son inferidas, y un botón por fila para ver todo lo demás
 * sólo de esa zona.
 */
export function Zonas({
  performance,
  onElegir,
}: {
  performance: Performance;
  onElegir: (zona: FiltroZona | "") => void;
}) {
  const { zonas, definiciones, zona: elegida } = performance;
  const total = zonas.reduce((suma, fila) => suma + fila.chats, 0);

  return (
    <section aria-labelledby="titulo-zonas" className="flex flex-col gap-3">
      <div>
        <h2
          id="titulo-zonas"
          className="font-display text-[17px] font-bold text-ink"
        >
          Por zona
        </h2>
        <p className="text-[13px] text-ink-secondary">{definiciones.zona}</p>
      </div>
      {zonas.length === 0 ? (
        <p className="rounded-lg border border-line bg-card py-8 text-center text-sm text-muted">
          No hubo chats nuevos en el período.
        </p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full min-w-[560px] text-[13.5px] text-ink">
            <caption className="sr-only">
              Chats nuevos del período por zona
            </caption>
            <thead className="border-b border-line text-[12px] text-ink-secondary">
              <tr>
                <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                  Zona
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-right font-semibold"
                >
                  Chats nuevos
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-right font-semibold"
                >
                  Chat → pedido
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-right font-semibold"
                >
                  Chat → pago
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-right font-semibold"
                >
                  <span className="sr-only">Ver sólo esta zona</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {zonas.map((fila) => {
                const activa = elegida === fila.zona;
                return (
                  <tr
                    key={fila.zona}
                    className={cn(
                      "border-b border-line last:border-b-0",
                      activa && "bg-sunken",
                    )}
                  >
                    <th
                      scope="row"
                      className="px-3 py-2.5 text-left font-normal"
                    >
                      <span className="block font-semibold">{fila.nombre}</span>
                      {fila.inferidas > 0 && (
                        <span className="text-[12px] text-muted">
                          {fila.inferidas === fila.chats
                            ? "inferida por la característica"
                            : `${fila.inferidas} de ${fila.chats} inferidas por la característica`}
                        </span>
                      )}
                    </th>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fila.chats.toLocaleString("es-AR")}
                      {total > 0 && (
                        <span className="ml-1 text-[12px] text-muted">
                          ({porcentaje({ valor: fila.chats / total })})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {porcentaje(fila.chatAPedido)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {porcentaje(fila.chatAPago)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        aria-pressed={activa}
                        onClick={() => onElegir(activa ? "" : fila.zona)}
                        className="cursor-pointer rounded-sm px-2 py-1 text-[12.5px] font-semibold text-primary hover:bg-sunken"
                      >
                        {activa ? "Ver todas" : "Ver sólo esta"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
