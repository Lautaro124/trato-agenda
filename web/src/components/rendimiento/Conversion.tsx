"use client";

import { cn } from "@/lib/cn";
import {
  diaLegible,
  diferenciaEnPuntos,
  porcentaje,
  rangoCorto,
  rangoLegible,
  variacionPorcentual,
  type ConteosConversion,
  type Performance,
  type Tasa,
} from "@/lib/performance";
import { formatearMonto } from "@/lib/productos";
import { pesosCompactos } from "@/lib/ventas";
import {
  COLOR_ACTUAL,
  COLOR_ANTERIOR,
  COLOR_ANTERIOR_A_MEDIAS,
  EtiquetaVariacion,
  Muestra,
} from "./comparacion";
import { GraficoComparado } from "./GraficoComparado";

const chats = (n: number) => (n === 1 ? "1 chat" : `${n.toLocaleString("es-AR")} chats`);
const pedidos = (n: number) => (n === 1 ? "1 pedido" : `${n.toLocaleString("es-AR")} pedidos`);

/** Qué tan comparable es el período anterior, para cada gráfico. */
type Comparable = { aMedias: boolean; etiqueta: string; etiquetaAnterior: string };

/**
 * Una barra de un período sobre su pista. `proporcion` null es "sin datos":
 * la pista queda punteada y vacía, que no es lo mismo que una barra en 0.
 */
function Barra({
  etiqueta,
  proporcion,
  valor,
  anterior = false,
  aMedias = false,
  alto = "h-3",
  pista = true,
}: {
  etiqueta?: string;
  proporcion: number | null;
  valor: string;
  anterior?: boolean;
  aMedias?: boolean;
  alto?: string;
  pista?: boolean;
}) {
  return (
    <div className={cn("grid items-center gap-2 text-[12px]", etiqueta ? "grid-cols-[76px_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]")}>
      {etiqueta && <span className="text-ink-secondary tabular-nums">{etiqueta}</span>}
      {proporcion === null ? (
        <div className={cn(alto, "rounded-[4px] border border-dashed border-line-strong")} />
      ) : (
        <div className={cn(alto, pista && "rounded-[4px] bg-sunken")}>
          <div
            className={cn(alto, "rounded-[4px]", anterior ? (aMedias ? COLOR_ANTERIOR_A_MEDIAS : COLOR_ANTERIOR) : COLOR_ACTUAL)}
            style={{ width: `${Math.min(proporcion, 1) * 100}%` }}
          />
        </div>
      )}
      <span className={cn("min-w-[38px] text-right tabular-nums", anterior ? "text-ink-secondary" : "font-bold text-ink")}>{valor}</span>
    </div>
  );
}

/** Una tasa de este período contra la del anterior, en la misma escala de 0 a 100 % que las otras dos. */
function TarjetaTasa({
  titulo,
  tasa,
  anterior,
  detalle,
  definicion,
  comparable,
}: {
  titulo: string;
  tasa: Tasa;
  /** null si el período anterior no tiene datos. */
  anterior: Tasa | null;
  detalle: string;
  definicion: string;
  comparable: Comparable;
}) {
  const variacion = anterior ? diferenciaEnPuntos(tasa, anterior) : null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[12.5px] text-ink-secondary">{titulo}</div>
          <div className="mt-0.5 font-display text-[24px] font-bold text-ink tabular-nums">{porcentaje(tasa)}</div>
        </div>
        <EtiquetaVariacion variacion={variacion} aMedias={comparable.aMedias} />
      </div>
      <div
        role="img"
        aria-label={`${comparable.etiqueta}: ${porcentaje(tasa)}. ${comparable.etiquetaAnterior}: ${anterior ? porcentaje(anterior) : "sin datos"}.`}
        className="flex flex-col gap-1.5"
      >
        <Barra etiqueta={comparable.etiqueta} proporcion={tasa.valor} valor={porcentaje(tasa)} />
        <Barra
          etiqueta={comparable.etiquetaAnterior}
          proporcion={anterior ? anterior.valor : null}
          valor={anterior ? porcentaje(anterior) : "Sin datos"}
          anterior
          aMedias={comparable.aMedias}
        />
      </div>
      <div className="text-[12.5px] text-ink-secondary">{detalle}</div>
      <p className="mt-auto border-t border-line pt-2 text-[12px] leading-[1.45] text-ink-secondary">{definicion}</p>
    </div>
  );
}

/** Una cantidad de los dos períodos; cada barra se mide contra la mayor de las dos. */
function TarjetaCantidad({
  titulo,
  actual,
  anterior,
  formato,
  comparable,
}: {
  titulo: string;
  actual: number;
  anterior: number | null;
  formato: (n: number) => string;
  comparable: Comparable;
}) {
  const maximo = Math.max(actual, anterior ?? 0, 1);
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-card px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] text-ink-secondary">{titulo}</span>
        <EtiquetaVariacion variacion={anterior === null ? null : variacionPorcentual(actual, anterior)} aMedias={comparable.aMedias} />
      </div>
      <div
        role="img"
        aria-label={`${comparable.etiqueta}: ${formato(actual)}. ${comparable.etiquetaAnterior}: ${anterior === null ? "sin datos" : formato(anterior)}.`}
        className="flex flex-col gap-1"
      >
        <Barra proporcion={actual / maximo} valor={formato(actual)} alto="h-2.5" pista={false} />
        <Barra
          proporcion={anterior === null ? null : anterior / maximo}
          valor={anterior === null ? "Sin datos" : formato(anterior)}
          anterior
          aMedias={comparable.aMedias}
          alto="h-2.5"
          pista={false}
        />
      </div>
    </div>
  );
}

/** Las fechas de los dos períodos y si el anterior se puede comparar entero, a medias o nada. */
function Periodos({ performance }: { performance: Performance }) {
  const { rango, anterior, registroDesde } = performance;
  const dias = performance.porDia.length;
  const faltan = registroDesde ? (anterior.porDia ?? []).filter((dia) => dia.dia < registroDesde).length : 0;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-ink">
        <span className="font-bold">{dias === 1 ? "Comparando dos días" : `Comparando dos períodos de ${dias} días`}</span>
        <span className="flex items-center gap-2">
          <Muestra />
          Este período · <strong className="font-semibold">{rangoLegible(rango)}</strong>
        </span>
        <span className="flex items-center gap-2">
          <Muestra anterior />
          Anterior · <strong className="font-semibold">{rangoLegible(anterior.rango)}</strong>
        </span>
      </div>
      {anterior.datos === "sin_datos" && performance.datos !== "sin_datos" && (
        <p className="text-[13px] text-ink-secondary">
          No hay con qué comparar: el período anterior es previo al {registroDesde ? diaLegible(registroDesde) : "registro"}, cuando empezamos a medir.
        </p>
      )}
      {anterior.datos === "parciales" && registroDesde && (
        <p className="rounded-md bg-warning-subtle px-3 py-2 text-[13px] text-warning-text">
          Comparación a medias: medimos desde el {diaLegible(registroDesde)}, así que del período anterior faltan {faltan} de sus {dias} días.
          Sus barras van rayadas.
        </p>
      )}
    </div>
  );
}

/** El embudo de los dos períodos, cada paso con sus dos barras en la misma escala. */
function Embudo({
  pasos,
  comparable,
}: {
  pasos: Array<{ etiqueta: string; actual: number; anterior: number | null }>;
  comparable: Comparable;
}) {
  const maximo = Math.max(...pasos.map((paso) => Math.max(paso.actual, paso.anterior ?? 0)), 1);
  return (
    <ol aria-label="Embudo de los chats nuevos, período contra período" className="flex flex-col gap-4">
      {pasos.map((paso) => (
        <li key={paso.etiqueta} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center sm:gap-3.5">
          <span className="text-[13.5px] text-ink">{paso.etiqueta}</span>
          <div
            role="img"
            aria-label={`${comparable.etiqueta}: ${paso.actual}. ${comparable.etiquetaAnterior}: ${paso.anterior ?? "sin datos"}.`}
            className="flex flex-col gap-1"
          >
            <Barra proporcion={paso.actual / maximo} valor={paso.actual.toLocaleString("es-AR")} alto="h-3.5" pista={false} />
            <Barra
              proporcion={paso.anterior === null ? null : paso.anterior / maximo}
              valor={paso.anterior === null ? "Sin datos" : paso.anterior.toLocaleString("es-AR")}
              anterior
              aMedias={comparable.aMedias}
              alto="h-3.5"
              pista={false}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * De los chats nuevos al pago, contra el período anterior de igual largo:
 * las tres tasas, las cantidades, el día a día y el embudo, todos con los
 * mismos filtros en los dos períodos.
 */
export function Conversion({ performance }: { performance: Performance }) {
  const { conversion, definiciones, moneda } = performance;
  const anterior = performance.anterior.conversion;
  const comparable: Comparable = {
    aMedias: performance.anterior.datos === "parciales",
    etiqueta: rangoCorto(performance.rango),
    etiquetaAnterior: rangoCorto(performance.anterior.rango),
  };
  const cantidad = (clave: keyof ConteosConversion) => ({ actual: conversion[clave], anterior: anterior ? anterior[clave] : null });
  const numero = (n: number) => n.toLocaleString("es-AR");

  return (
    <section aria-labelledby="titulo-conversion" className="flex flex-col gap-5">
      <Periodos performance={performance} />

      <div className="flex flex-col gap-3">
        <div>
          <h2 id="titulo-conversion" className="font-display text-[17px] font-bold text-ink">
            Conversión
          </h2>
          <p className="text-[13px] text-ink-secondary">
            {definiciones.base} Las tres tasas usan la misma escala, de 0 a 100 %.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TarjetaTasa
            titulo="Chat → pedido"
            tasa={conversion.chatAPedido}
            anterior={anterior?.chatAPedido ?? null}
            detalle={`${chats(conversion.conPedido)} de ${chats(conversion.chats)}${anterior ? ` · antes ${anterior.conPedido} de ${anterior.chats}` : ""}`}
            definicion={definiciones.chatAPedido}
            comparable={comparable}
          />
          <TarjetaTasa
            titulo="Pedido → pago"
            tasa={conversion.pedidoAPago}
            anterior={anterior?.pedidoAPago ?? null}
            detalle={`${pedidos(conversion.pagados)} de ${pedidos(conversion.pedidos)}${anterior ? ` · antes ${anterior.pagados} de ${anterior.pedidos}` : ""}`}
            definicion={definiciones.pedidoAPago}
            comparable={comparable}
          />
          <TarjetaTasa
            titulo="Chat → pago"
            tasa={conversion.chatAPago}
            anterior={anterior?.chatAPago ?? null}
            detalle={`${chats(conversion.conPago)} de ${chats(conversion.chats)}${anterior ? ` · antes ${anterior.conPago} de ${anterior.chats}` : ""}`}
            definicion={definiciones.chatAPago}
            comparable={comparable}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-[17px] font-bold text-ink">Cantidades</h2>
          <p className="text-[13px] text-ink-secondary">Cada barra se mide contra el mayor de los dos períodos. La variación es en porcentaje.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TarjetaCantidad titulo="Chats nuevos" {...cantidad("chats")} formato={numero} comparable={comparable} />
          <TarjetaCantidad titulo="Pedidos" {...cantidad("pedidos")} formato={numero} comparable={comparable} />
          <TarjetaCantidad titulo="Pagos" {...cantidad("pagados")} formato={numero} comparable={comparable} />
          <TarjetaCantidad
            titulo="Cobrado"
            {...cantidad("cobradoCentavos")}
            formato={(centavos) => (centavos >= 100_000_000 ? pesosCompactos(centavos, moneda) : formatearMonto(centavos, moneda))}
            comparable={comparable}
          />
        </div>
        <p className="text-[12px] text-ink-secondary">{definiciones.cobrado}</p>
      </div>

      <GraficoComparado performance={performance} />

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-[17px] font-bold text-ink">Embudo, período contra período</h2>
        <div className="rounded-lg border border-line bg-card p-5">
          <Embudo
            comparable={comparable}
            pasos={[
              { etiqueta: "Chats nuevos", ...cantidad("chats") },
              { etiqueta: "Hicieron un pedido", ...cantidad("conPedido") },
              { etiqueta: "Pagaron", ...cantidad("conPago") },
            ]}
          />
        </div>
        <p className="text-[12px] text-ink-secondary">
          {definiciones.comparacion} {definiciones.sinDatos}
        </p>
      </div>
    </section>
  );
}
