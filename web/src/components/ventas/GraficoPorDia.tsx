"use client";

import { useEffect, useRef, useState } from "react";
import { formatearCentavos } from "@/lib/productos";
import { diaConSemana, diaCorto, pesosCompactos, type ResumenVentas } from "@/lib/ventas";

/** Alto del área de dibujo, sin contar los ejes. */
const ALTO = 180;
const MARGEN = { arriba: 22, derecha: 8, abajo: 26, izquierda: 64 };
/** Ancho máximo de una columna: el resto de la franja queda de aire. */
const ANCHO_MAX = 24;
const RADIO = 4;
const TICKS = 4;

/** Máximo "redondo" del eje: 1, 2, 2,5 o 5 por una potencia de 10. */
function maximoRedondo(valor: number): number {
  if (valor <= 0) return 1;
  const potencia = 10 ** Math.floor(Math.log10(valor));
  const paso = [1, 2, 2.5, 5, 10].find((multiplo) => multiplo * potencia >= valor) ?? 10;
  return paso * potencia;
}

/** Columna con la punta redondeada (4px) y la base recta, apoyada en el eje. */
function columna(x: number, y: number, ancho: number, alto: number): string {
  const r = Math.min(RADIO, ancho / 2, alto);
  const base = y + alto;
  return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + ancho - r} Q${x + ancho},${y} ${x + ancho},${y + r} V${base} Z`;
}

/**
 * Cobrado por día: una sola serie (no lleva leyenda, el título la nombra), en el
 * coral de la marca, validado contra la superficie de la tarjeta. Cada día es
 * su propia zona de hover; con el teclado, las flechas recorren los días.
 */
export function GraficoPorDia({ porDia }: { porDia: ResumenVentas["porDia"] }) {
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

  const alTeclado = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setActivo((actual) => {
      const desde = actual ?? porDia.length - 1;
      return Math.min(porDia.length - 1, Math.max(0, desde + (e.key === "ArrowRight" ? 1 : -1)));
    });
  };

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
                  <td className="py-1 text-right text-ink">{formatearCentavos(fila.cobradoCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={contenedor}
          role="group"
          aria-label="Cobrado por día. Usá las flechas para recorrer los días."
          tabIndex={0}
          onKeyDown={alTeclado}
          onBlur={() => setActivo(null)}
          onPointerLeave={() => setActivo(null)}
          className="relative outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-[var(--color-semantic-border-focus)]"
        >
          {ancho > 0 && (
            <svg width={ancho} height={MARGEN.arriba + ALTO + MARGEN.abajo} aria-hidden="true" className="block">
              {Array.from({ length: TICKS + 1 }, (_, i) => {
                const valor = (maximo / TICKS) * i;
                return (
                  <g key={i}>
                    <line
                      x1={MARGEN.izquierda}
                      x2={ancho - MARGEN.derecha}
                      y1={y(valor)}
                      y2={y(valor)}
                      stroke="var(--color-primitive-neutral-200)"
                      strokeWidth={1}
                      shapeRendering="crispEdges"
                    />
                    <text
                      x={MARGEN.izquierda - 8}
                      y={y(valor)}
                      textAnchor="end"
                      dominantBaseline="middle"
                      className="fill-muted text-[11px] tabular-nums"
                    >
                      {pesosCompactos(valor)}
                    </text>
                  </g>
                );
              })}

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
                        d={columna(x0 + (franja - anchoColumna) / 2, y(fila.cobradoCentavos), anchoColumna, alto)}
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
                        {pesosCompactos(fila.cobradoCentavos)}
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
              <span className="block font-semibold text-ink">{formatearCentavos(dia.cobradoCentavos)}</span>
              <span className="flex items-center gap-1.5 text-ink-secondary">
                <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded bg-primary" />
                {diaConSemana(dia.dia)} · {dia.ventas === 1 ? "1 venta" : `${dia.ventas} ventas`}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
