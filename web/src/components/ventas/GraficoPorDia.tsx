"use client";

import { useEffect, useRef, useState } from "react";
import { columna, LineasEje, maximoRedondo, ZonaGrafico } from "@/components/ui/GraficoColumnas";
import { formatearMonto } from "@/lib/productos";
import { diaConSemana, diaCorto, pesosCompactos, type ResumenVentas } from "@/lib/ventas";

/** Alto del área de dibujo, sin contar los ejes. */
const ALTO = 180;
const MARGEN = { arriba: 22, derecha: 8, abajo: 26, izquierda: 64 };
/** Ancho máximo de una columna: el resto de la franja queda de aire. */
const ANCHO_MAX = 24;
const RADIO = 4;
const TICKS = 4;

/**
 * Cobrado por día: una sola serie (no lleva leyenda, el título la nombra), en el
 * coral de la marca, validado contra la superficie de la tarjeta. Cada día es
 * su propia zona de hover; con el teclado, las flechas recorren los días.
 */
export function GraficoPorDia({ porDia, moneda = "ARS" }: { porDia: ResumenVentas["porDia"]; moneda?: string }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  const [activo, setActivo] = useState<number | null>(null);
  const [comoTabla, setComoTabla] = useState(false);

  useEffect(() => {
    const nodo = contenedor.current;
    if (!nodo) return;
    const observador = new ResizeObserver(([entrada]) => setAncho(entrada.contentRect.width));
    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);

  const maximo = maximoRedondo(Math.max(...porDia.map((dia) => dia.cobradoCentavos)));
  const hayVentas = porDia.some((dia) => dia.ventas > 0);
  const anchoPlot = Math.max(ancho - MARGEN.izquierda - MARGEN.derecha, 0);
  const franja = porDia.length > 0 ? anchoPlot / porDia.length : 0;
  const anchoColumna = Math.max(Math.min(ANCHO_MAX, franja - 2), 1);
  const y = (valor: number) => MARGEN.arriba + ALTO - (valor / maximo) * ALTO;
  // Etiquetas del eje X sin chocarse: como mucho una cada ~56px.
  const cadaCuantos = Math.max(1, Math.ceil(porDia.length / Math.max(1, Math.floor(anchoPlot / 56))));
  const indiceMaximo = porDia.reduce((mejor, dia, i) => (dia.cobradoCentavos > porDia[mejor].cobradoCentavos ? i : mejor), 0);
  const dia = activo !== null ? porDia[activo] : null;

  return (
    <section aria-labelledby="titulo-por-dia" className="rounded-lg border border-line bg-card p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="titulo-por-dia" className="font-display text-[15px] font-bold text-ink">
          Cobrado por día
        </h2>
        {hayVentas && (
          <button type="button" onClick={() => setComoTabla((v) => !v)} className="cursor-pointer text-[12.5px] font-semibold text-link">
            {comoTabla ? "Ver gráfico" : "Ver como tabla"}
          </button>
        )}
      </div>

      {!hayVentas ? (
        <p className="py-8 text-center text-sm text-muted">Todavía no hay ventas cobradas en este período.</p>
      ) : comoTabla ? (
        <div className="max-h-[260px] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 font-semibold">Día</th>
                <th className="py-1 text-right font-semibold">Ventas</th>
                <th className="py-1 text-right font-semibold">Cobrado</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {porDia.map((fila) => (
                <tr key={fila.dia} className="border-t border-line">
                  <td className="py-1 text-ink-secondary">{diaConSemana(fila.dia)}</td>
                  <td className="py-1 text-right text-ink-secondary">{fila.ventas}</td>
                  <td className="py-1 text-right text-ink">{formatearMonto(fila.cobradoCentavos, moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ZonaGrafico
          ref={contenedor}
          etiqueta="Cobrado por día. Usá las flechas para recorrer los días."
          cantidad={porDia.length}
          setActivo={setActivo}
        >
          {ancho > 0 && (
            <svg width={ancho} height={MARGEN.arriba + ALTO + MARGEN.abajo} aria-hidden="true" className="block">
              <LineasEje
                desde={MARGEN.izquierda}
                hasta={ancho - MARGEN.derecha}
                maximo={maximo}
                marcas={TICKS}
                y={y}
                formato={(valor) => pesosCompactos(valor, moneda)}
                claseTexto="fill-muted"
              />

              {porDia.map((fila, i) => {
                const x0 = MARGEN.izquierda + i * franja;
                const alto = (fila.cobradoCentavos / maximo) * ALTO;
                return (
                  <g key={fila.dia}>
                    {/* La zona de hover es la franja entera, no sólo la columna pintada. */}
                    <rect
                      x={x0}
                      y={MARGEN.arriba}
                      width={franja}
                      height={ALTO}
                      fill="transparent"
                      onPointerEnter={() => setActivo(i)}
                    />
                    {alto > 0 && (
                      <path
                        d={columna(x0 + (franja - anchoColumna) / 2, y(fila.cobradoCentavos), anchoColumna, alto, RADIO)}
                        fill="var(--color-semantic-primary-default)"
                        opacity={activo === null || activo === i ? 1 : 0.55}
                        pointerEvents="none"
                      />
                    )}
                    {i % cadaCuantos === 0 && (
                      <text x={x0 + franja / 2} y={MARGEN.arriba + ALTO + 16} textAnchor="middle" className="fill-muted text-[11px]">
                        {diaCorto(fila.dia)}
                      </text>
                    )}
                    {/* Una sola etiqueta directa: el día que más se cobró. */}
                    {i === indiceMaximo && activo === null && fila.cobradoCentavos > 0 && (
                      <text
                        x={x0 + franja / 2}
                        y={y(fila.cobradoCentavos) - 6}
                        textAnchor="middle"
                        className="fill-ink-secondary text-[11px] font-semibold"
                      >
                        {pesosCompactos(fila.cobradoCentavos, moneda)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}

          {dia && activo !== null && (
            <div
              role="status"
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-line bg-card px-3 py-2 text-[12.5px] whitespace-nowrap shadow-md"
              style={{
                left: Math.min(Math.max(MARGEN.izquierda + (activo + 0.5) * franja, 70), ancho - 70),
                top: Math.max(y(dia.cobradoCentavos) - 58, 0),
              }}
            >
              <span className="block font-semibold text-ink">{formatearMonto(dia.cobradoCentavos, moneda)}</span>
              <span className="flex items-center gap-1.5 text-ink-secondary">
                <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded bg-primary" />
                {diaConSemana(dia.dia)} · {dia.ventas === 1 ? "1 venta" : `${dia.ventas} ventas`}
              </span>
            </div>
          )}
        </ZonaGrafico>
      )}
    </section>
  );
}
