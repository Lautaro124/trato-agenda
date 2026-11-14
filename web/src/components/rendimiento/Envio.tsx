"use client";

import Link from "next/link";
import { porcentaje, type EnvioPerformance } from "@/lib/performance";

function Dato({ titulo, valor, detalle }: { titulo: string; valor: string; detalle: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-line bg-card p-4">
      <dt className="text-[12.5px] text-ink-secondary">{titulo}</dt>
      <dd className="font-display text-[22px] font-bold text-ink tabular-nums">{valor}</dd>
      <dd className="text-[12px] text-muted">{detalle}</dd>
    </div>
  );
}

const cantidad = (n: number) => n.toLocaleString("es-AR");

/**
 * El estado de los chats a los que el asistente les cotizó el envío: cuántos
 * están cotizando ahora y cuántos de los que consultaron pidieron y pagaron.
 * Sólo se muestra si la cuenta hace envíos.
 */
export function Envio({ envio, definicion }: { envio: EnvioPerformance; definicion: string }) {
  return (
    <section aria-labelledby="titulo-envio" className="flex flex-col gap-3">
      <div>
        <h2 id="titulo-envio" className="font-display text-[17px] font-bold text-ink">
          Consultas de envío
        </h2>
        <p className="text-[13px] text-ink-secondary">{definicion}</p>
      </div>
      {!envio.moduloActivo && (
        <p className="rounded-md border border-line bg-sunken px-3 py-2 text-[13.5px] text-ink">
          Tus tarifas de envío están apagadas: el asistente no cotiza envíos y no se registran consultas nuevas.{" "}
          <Link href="/envios" className="font-semibold text-primary underline-offset-2 hover:underline">
            Configurar envíos
          </Link>
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Dato titulo="Cotizando ahora" valor={cantidad(envio.cotizando)} detalle="Activos y sin pedido" />
        <Dato titulo="Consultaron envío" valor={cantidad(envio.consultaron)} detalle="Chats nuevos del período" />
        <Dato
          titulo="Hicieron un pedido"
          valor={porcentaje(envio.consultaAPedido)}
          detalle={`${cantidad(envio.conPedido)} de ${cantidad(envio.consultaron)}`}
        />
        <Dato
          titulo="Pagaron"
          valor={porcentaje(envio.consultaAPago)}
          detalle={`${cantidad(envio.conPago)} de ${cantidad(envio.consultaron)}`}
        />
      </dl>
    </section>
  );
}
