"use client";

import type { Dispatch, ReactNode, Ref, SetStateAction } from "react";

/**
 * Piezas comunes de los gráficos de columnas en SVG (ventas y rendimiento):
 * escala del eje, forma de la columna, líneas de referencia y la zona que se
 * recorre con el puntero o el teclado.
 */

/** Máximo "redondo" del eje: 1, 2, 2,5 o 5 por una potencia de 10. */
export function maximoRedondo(valor: number): number {
  if (valor <= 0) return 1;
  const potencia = 10 ** Math.floor(Math.log10(valor));
  const paso = [1, 2, 2.5, 5, 10].find((multiplo) => multiplo * potencia >= valor) ?? 10;
  return paso * potencia;
}

/** Columna con la punta redondeada y la base recta, apoyada en el eje. */
export function columna(x: number, y: number, ancho: number, alto: number, radio: number): string {
  const r = Math.min(radio, ancho / 2, alto);
  const base = y + alto;
  return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + ancho - r} Q${x + ancho},${y} ${x + ancho},${y + r} V${base} Z`;
}

/** Líneas horizontales del eje Y con su valor a la izquierda; la del 0 un poco más marcada. */
export function LineasEje({
  desde,
  hasta,
  maximo,
  marcas,
  y,
  formato,
  claseTexto = "fill-ink-secondary",
}: {
  desde: number;
  hasta: number;
  maximo: number;
  marcas: number;
  y: (valor: number) => number;
  formato: (valor: number) => string;
  claseTexto?: string;
}) {
  return Array.from({ length: marcas + 1 }, (_, i) => {
    const valor = (maximo / marcas) * i;
    return (
      <g key={i}>
        <line
          x1={desde}
          x2={hasta}
          y1={y(valor)}
          y2={y(valor)}
          stroke={i === 0 ? "var(--color-primitive-neutral-300)" : "var(--color-primitive-neutral-200)"}
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
        <text x={desde - 8} y={y(valor)} textAnchor="end" dominantBaseline="middle" className={`${claseTexto} text-[11px] tabular-nums`}>
          {formato(valor)}
        </text>
      </g>
    );
  });
}

/**
 * Contenedor enfocable del gráfico: las flechas recorren las franjas y salir
 * con el puntero o el foco limpia la selección.
 */
export function ZonaGrafico({
  ref,
  etiqueta,
  cantidad,
  setActivo,
  children,
}: {
  ref: Ref<HTMLDivElement>;
  etiqueta: string;
  cantidad: number;
  setActivo: Dispatch<SetStateAction<number | null>>;
  children: ReactNode;
}) {
  const alTeclado = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setActivo((actual) => {
      const desde = actual ?? cantidad - 1;
      return Math.min(cantidad - 1, Math.max(0, desde + (e.key === "ArrowRight" ? 1 : -1)));
    });
  };

  return (
    <div
      ref={ref}
      role="group"
      aria-label={etiqueta}
      tabIndex={0}
      onKeyDown={alTeclado}
      onBlur={() => setActivo(null)}
      onPointerLeave={() => setActivo(null)}
      className="relative outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-[var(--color-semantic-border-focus)]"
    >
      {children}
    </div>
  );
}
