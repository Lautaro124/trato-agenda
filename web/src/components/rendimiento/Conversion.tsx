"use client";

import { diferenciaEnPuntos, porcentaje, type Performance, type Tasa } from "@/lib/performance";

function TarjetaTasa({
  titulo,
  tasa,
  anterior,
  detalle,
  definicion,
}: {
  titulo: string;
  tasa: Tasa;
  anterior: Tasa | undefined;
  detalle: string;
  definicion: string;
}) {
  const diferencia = diferenciaEnPuntos(tasa, anterior);
  return (
    <div className="flex flex-col rounded-lg border border-line bg-card p-4">
      <div className="text-[12.5px] text-ink-secondary">{titulo}</div>
      <div className="mt-1 font-display text-[24px] font-bold text-ink tabular-nums">{porcentaje(tasa)}</div>
      <div className="text-[12.5px] text-ink-secondary">{detalle}</div>
      {diferencia && <div className="mt-0.5 text-[12px] text-muted">{diferencia}</div>}
      <p className="mt-2 border-t border-line pt-2 text-[12px] leading-[1.45] text-muted">{definicion}</p>
    </div>
  );
}

/** Una barra por paso del embudo: una sola serie (coral), con el número en tinta al lado. */
function Embudo({ pasos }: { pasos: Array<{ etiqueta: string; valor: number }> }) {
  const maximo = Math.max(...pasos.map((paso) => paso.valor), 1);
  return (
    <ol aria-label="Embudo de los chats nuevos" className="flex flex-col gap-2.5">
      {pasos.map((paso) => (
        <li key={paso.etiqueta}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-ink">{paso.etiqueta}</span>
            <span className="font-semibold text-ink tabular-nums">{paso.valor.toLocaleString("es-AR")}</span>
          </div>
          <div
            aria-hidden="true"
            className="h-3 rounded-r-[4px] bg-primary"
            style={{ width: `${paso.valor === 0 ? 0 : Math.max((paso.valor / maximo) * 100, 1.5)}%` }}
          />
        </li>
      ))}
    </ol>
  );
}

/** De los chats nuevos al pago: las tres tasas con su definición y el embudo en cantidades. */
export function Conversion({ performance }: { performance: Performance }) {
  const { conversion, definiciones } = performance;
  const anterior = conversion.anterior;
  const chats = (n: number) => (n === 1 ? "1 chat" : `${n.toLocaleString("es-AR")} chats`);
  const pedidos = (n: number) => (n === 1 ? "1 pedido" : `${n.toLocaleString("es-AR")} pedidos`);

  return (
    <section aria-labelledby="titulo-conversion" className="flex flex-col gap-3">
      <div>
        <h2 id="titulo-conversion" className="font-display text-[17px] font-bold text-ink">
          Conversión
        </h2>
        <p className="text-[13px] text-ink-secondary">{definiciones.base}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TarjetaTasa
          titulo="Chat → pedido"
          tasa={conversion.chatAPedido}
          anterior={anterior?.chatAPedido}
          detalle={`${chats(conversion.conPedido)} de ${chats(conversion.chats)}`}
          definicion={definiciones.chatAPedido}
        />
        <TarjetaTasa
          titulo="Pedido → pago"
          tasa={conversion.pedidoAPago}
          anterior={anterior?.pedidoAPago}
          detalle={`${pedidos(conversion.pagados)} de ${pedidos(conversion.pedidos)}`}
          definicion={definiciones.pedidoAPago}
        />
        <TarjetaTasa
          titulo="Chat → pago"
          tasa={conversion.chatAPago}
          anterior={anterior?.chatAPago}
          detalle={`${chats(conversion.conPago)} de ${chats(conversion.chats)}`}
          definicion={definiciones.chatAPago}
        />
      </div>
      <div className="rounded-lg border border-line bg-card p-5">
        <Embudo
          pasos={[
            { etiqueta: "Chats nuevos", valor: conversion.chats },
            { etiqueta: "Hicieron un pedido", valor: conversion.conPedido },
            { etiqueta: "Pagaron", valor: conversion.conPago },
          ]}
        />
      </div>
      <p className="text-[12px] text-muted">{definiciones.sinDatos}</p>
    </section>
  );
}
