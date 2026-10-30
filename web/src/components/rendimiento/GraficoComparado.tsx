"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { rangoLegible, variacionPorcentual, type DiaPerformance, type Performance } from "@/lib/performance";
import { formatearMonto } from "@/lib/productos";
import { diaConSemana, diaCorto, pesosCompactos } from "@/lib/ventas";
import { EtiquetaVariacion, Muestra, RELLENO_ACTUAL, RELLENO_ANTERIOR } from "./comparacion";

/** Alto del área de dibujo, sin contar los ejes. */
const ALTO = 200;
const MARGEN = { arriba: 12, derecha: 8, abajo: 40, izquierda: 64 };
/** Ancho máximo de cada columna: el resto de la franja queda de aire. */
const ANCHO_MAX = 12;
const RADIO = 3;
const TICKS = 4;
/** Más días que esto no entran de a uno: el gráfico pasa a semanas. */
const MAX_FRANJAS_DIARIAS = 62;

type Metrica = "chats" | "pedidos" | "pagados" | "cobradoCentavos";

const METRICAS: Array<{ clave: Metrica; nombre: string }> = [
  { clave: "chats", nombre: "Chats nuevos" },
  { clave: "pedidos", nombre: "Pedidos" },
  { clave: "pagados", nombre: "Pagos" },
  { clave: "cobradoCentavos", nombre: "Cobrado" },
];

/** Un día (o una semana) del período y el mismo tramo del anterior. null es "sin datos": antes del registro. */
type Franja = {
  etiqueta: string;
  etiquetaAnterior: string | null;
  detalle: string;
  detalleAnterior: string | null;
  actual: number | null;
  anterior: number | null;
};

/** Máximo "redondo" del eje: 1, 2, 2,5 o 5 por una potencia de 10. */
function maximoRedondo(valor: number): number {
  if (valor <= 0) return 1;
  const potencia = 10 ** Math.floor(Math.log10(valor));
  const paso = [1, 2, 2.5, 5, 10].find((multiplo) => multiplo * potencia >= valor) ?? 10;
  return paso * potencia;
}

/** Columna con la punta redondeada y la base recta, apoyada en el eje. */
function columna(x: number, y: number, ancho: number, alto: number): string {
  const r = Math.min(RADIO, ancho / 2, alto);
  const base = y + alto;
  return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + ancho - r} Q${x + ancho},${y} ${x + ancho},${y + r} V${base} Z`;
}

/**
 * Junta los días de a uno o de a 7 (períodos largos). El día i del período
 * se compara con el día i del anterior; un tramo entero anterior al registro
 * no tiene datos.
 */
function franjas(
  dias: DiaPerformance[],
  anteriores: DiaPerformance[] | null,
  metrica: Metrica,
  registroDesde: string | null,
): { franjas: Franja[]; semanal: boolean } {
  const semanal = dias.length > MAX_FRANJAS_DIARIAS;
  const largo = semanal ? 7 : 1;
  const sumar = (tramo: DiaPerformance[]) => {
    const medidos = tramo.filter((dia) => registroDesde !== null && dia.dia >= registroDesde);
    return medidos.length === 0 ? null : medidos.reduce((suma, dia) => suma + dia[metrica], 0);
  };
  const nombre = (tramo: DiaPerformance[]) =>
    tramo.length === 1 ? diaConSemana(tramo[0].dia) : rangoLegible({ primerDia: tramo[0].dia, ultimoDia: tramo[tramo.length - 1].dia });
  const resultado: Franja[] = [];
  for (let i = 0; i < dias.length; i += largo) {
    const tramo = dias.slice(i, i + largo);
    const tramoAnterior = anteriores ? anteriores.slice(i, i + largo) : [];
    resultado.push({
      etiqueta: diaCorto(tramo[0].dia),
      etiquetaAnterior: tramoAnterior.length > 0 ? diaCorto(tramoAnterior[0].dia) : null,
      detalle: nombre(tramo),
      detalleAnterior: tramoAnterior.length > 0 ? nombre(tramoAnterior) : null,
      actual: sumar(tramo),
      anterior: tramoAnterior.length > 0 ? sumar(tramoAnterior) : null,
    });
  }
  return { franjas: resultado, semanal };
}

/**
 * El período día por día contra el anterior: dos columnas por día, la de
 * este período en coral y la del anterior en gris, en la misma escala. Cada
 * día es su propia zona de hover; con el teclado, las flechas recorren los días.
 */
export function GraficoComparado({ performance }: { performance: Performance }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  const [metrica, setMetrica] = useState<Metrica>("chats");
  const [activo, setActivo] = useState<number | null>(null);
  const [comoTabla, setComoTabla] = useState(false);
  // Un solo día no tiene "día a día": las tarjetas ya lo comparan.
  const visible = performance.porDia.length >= 2;

  useEffect(() => {
    const nodo = contenedor.current;
    if (!nodo) return;
    const observador = new ResizeObserver(([entrada]) => setAncho(entrada.contentRect.width));
    observador.observe(nodo);
    return () => observador.disconnect();
  }, [comoTabla, visible]);

  if (!visible) return null;
  const { moneda, anterior, registroDesde } = performance;

  const dinero = metrica === "cobradoCentavos";
  const nombreMetrica = METRICAS.find((opcion) => opcion.clave === metrica)?.nombre ?? "";
  const formato = (valor: number) => (dinero ? formatearMonto(valor, moneda) : valor.toLocaleString("es-AR"));
  const formatoEje = (valor: number) => (dinero ? pesosCompactos(valor, moneda) : valor.toLocaleString("es-AR"));
  const { franjas: lista, semanal } = franjas(performance.porDia, anterior.porDia, metrica, registroDesde);
  const total = performance.conversion[metrica];
  const totalAnterior = anterior.conversion ? anterior.conversion[metrica] : null;

  const valores = lista.flatMap((franja) => [franja.actual ?? 0, franja.anterior ?? 0]);
  const mayor = Math.max(...valores, 0);
  // Las cantidades van en enteros: cada marca del eje es un número de chats, no 1,25.
  const maximo = dinero ? maximoRedondo(mayor) : Math.max(Math.ceil(maximoRedondo(mayor / TICKS)), 1) * TICKS;
  const anchoPlot = Math.max(ancho - MARGEN.izquierda - MARGEN.derecha, 0);
  const franja = lista.length > 0 ? anchoPlot / lista.length : 0;
  const anchoColumna = Math.max(Math.min(ANCHO_MAX, (franja - 3) / 2), 1);
  const y = (valor: number) => MARGEN.arriba + ALTO - (valor / maximo) * ALTO;
  // Etiquetas del eje X sin chocarse: como mucho una cada ~56px.
  const cadaCuantos = Math.max(1, Math.ceil(lista.length / Math.max(1, Math.floor(anchoPlot / 56))));
  const elegido = activo !== null ? lista[activo] : null;

  const alTeclado = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setActivo((actual) => {
      const desde = actual ?? lista.length - 1;
      return Math.min(lista.length - 1, Math.max(0, desde + (e.key === "ArrowRight" ? 1 : -1)));
    });
  };

  return (
    <section aria-labelledby="titulo-dia-a-dia" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2.5">
        <div>
          <h2 id="titulo-dia-a-dia" className="font-display text-[17px] font-bold text-ink">
            {semanal ? "Semana a semana" : "Día a día"}
          </h2>
          <p className="text-[13px] text-ink-secondary">
            {semanal ? "Cada semana" : "Cada día"} al lado del mismo tramo del período anterior. {performance.definiciones.porDia}
          </p>
        </div>
        <div role="radiogroup" aria-label="Qué muestra el gráfico" className="flex w-fit flex-wrap gap-1 rounded-md border border-line bg-sunken p-1">
          {METRICAS.map((opcion) => (
            <label
              key={opcion.clave}
              className={cn(
                "flex min-h-9 cursor-pointer items-center rounded-sm px-3 text-[13px] font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-semantic-border-focus)]",
                metrica === opcion.clave ? "bg-card text-ink shadow-sm" : "text-ink-secondary",
              )}
            >
              <input
                type="radio"
                name="metrica-dia-a-dia"
                value={opcion.clave}
                checked={metrica === opcion.clave}
                onChange={() => setMetrica(opcion.clave)}
                className="sr-only"
              />
              {opcion.nombre}
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-card p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-[20px] font-bold text-ink tabular-nums">{formato(total)}</span>
            <span className="text-[13px] text-ink-secondary">
              {totalAnterior === null ? "sin datos del período anterior" : `contra ${formato(totalAnterior)} en el período anterior`}
            </span>
            <EtiquetaVariacion
              variacion={totalAnterior === null ? null : variacionPorcentual(total, totalAnterior)}
              aMedias={anterior.datos === "parciales"}
            />
          </div>
          <button type="button" onClick={() => setComoTabla((v) => !v)} className="cursor-pointer text-[12.5px] font-semibold text-link">
            {comoTabla ? "Ver gráfico" : "Ver como tabla"}
          </button>
        </div>

        {comoTabla ? (
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-[13px]">
              <caption className="sr-only">
                {nombreMetrica} {semanal ? "por semana" : "por día"}, este período contra el anterior
              </caption>
              <thead>
                <tr className="text-left text-ink-secondary">
                  <th className="py-1 font-semibold">{semanal ? "Semana" : "Día"}</th>
                  <th className="py-1 text-right font-semibold">Este período</th>
                  <th className="py-1 pl-4 font-semibold">{semanal ? "Semana anterior" : "Día anterior"}</th>
                  <th className="py-1 text-right font-semibold">Anterior</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {lista.map((fila) => (
                  <tr key={fila.detalle} className="border-t border-line">
                    <td className="py-1 text-ink-secondary">{fila.detalle}</td>
                    <td className="py-1 text-right text-ink">{fila.actual === null ? "Sin datos" : formato(fila.actual)}</td>
                    <td className="py-1 pl-4 text-ink-secondary">{fila.detalleAnterior ?? "—"}</td>
                    <td className="py-1 text-right text-ink-secondary">{fila.anterior === null ? "Sin datos" : formato(fila.anterior)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            ref={contenedor}
            role="group"
            aria-label={`${nombreMetrica} ${semanal ? "por semana" : "por día"}: ${formato(total)} este período, ${totalAnterior === null ? "sin datos" : formato(totalAnterior)} el anterior. Usá las flechas para recorrer ${semanal ? "las semanas" : "los días"}.`}
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
                        stroke={i === 0 ? "var(--color-primitive-neutral-300)" : "var(--color-primitive-neutral-200)"}
                        strokeWidth={1}
                        shapeRendering="crispEdges"
                      />
                      <text
                        x={MARGEN.izquierda - 8}
                        y={y(valor)}
                        textAnchor="end"
                        dominantBaseline="middle"
                        className="fill-ink-secondary text-[11px] tabular-nums"
                      >
                        {formatoEje(valor)}
                      </text>
                    </g>
                  );
                })}

                {lista.map((fila, i) => {
                  const x0 = MARGEN.izquierda + i * franja;
                  const centro = x0 + franja / 2;
                  const tenue = activo !== null && activo !== i;
                  const barra = (valor: number | null, x: number, relleno: string) =>
                    valor === null ? (
                      // Sin datos: una raya punteada sobre el eje, que no se confunda con un 0.
                      <line
                        x1={x}
                        x2={x + anchoColumna}
                        y1={y(0) - 1.5}
                        y2={y(0) - 1.5}
                        stroke="var(--color-primitive-neutral-400)"
                        strokeDasharray="2 2"
                      />
                    ) : (
                      valor > 0 && <path d={columna(x, y(valor), anchoColumna, (valor / maximo) * ALTO)} fill={relleno} opacity={tenue ? 0.45 : 1} />
                    );
                  return (
                    <g key={fila.detalle}>
                      {/* La zona de hover es la franja entera, no sólo las columnas pintadas. */}
                      <rect x={x0} y={MARGEN.arriba} width={franja} height={ALTO} fill="transparent" onPointerEnter={() => setActivo(i)} />
                      <g pointerEvents="none">
                        {barra(fila.actual, centro - anchoColumna - 0.5, RELLENO_ACTUAL)}
                        {barra(fila.anterior, centro + 0.5, RELLENO_ANTERIOR)}
                      </g>
                      {i % cadaCuantos === 0 && (
                        <text x={centro} y={MARGEN.arriba + ALTO + 16} textAnchor="middle" className="text-[11px]">
                          <tspan className="fill-ink font-semibold">{fila.etiqueta}</tspan>
                          {fila.etiquetaAnterior && (
                            <tspan x={centro} dy={14} className="fill-ink-secondary">
                              {fila.etiquetaAnterior}
                            </tspan>
                          )}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            )}

            {elegido && activo !== null && (
              <div
                role="status"
                className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-line bg-card px-3 py-2 text-[12.5px] whitespace-nowrap shadow-md"
                style={{
                  left: Math.min(Math.max(MARGEN.izquierda + (activo + 0.5) * franja, 100), ancho - 100),
                  top: Math.max(y(Math.max(elegido.actual ?? 0, elegido.anterior ?? 0)) - 64, 0),
                }}
              >
                <span className="flex items-center gap-1.5 text-ink">
                  <Muestra />
                  {elegido.detalle}:{" "}
                  <strong className="font-semibold">{elegido.actual === null ? "sin datos" : formato(elegido.actual)}</strong>
                </span>
                {elegido.detalleAnterior && (
                  <span className="mt-0.5 flex items-center gap-1.5 text-ink-secondary">
                    <Muestra anterior />
                    {elegido.detalleAnterior}: {elegido.anterior === null ? "sin datos" : formato(elegido.anterior)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
