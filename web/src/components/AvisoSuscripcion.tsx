"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { formatearFechaCorta, formatearMonto, useSuscripcion } from "@/lib/suscripcion";

function Pastilla({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={cn("flex-none rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold", className)}>
      {children}
    </span>
  );
}

/**
 * Aviso del estado de la prueba arriba de la agenda (artboard 7b del canvas).
 * Con la prueba vencida, en el teléfono se muestra como hoja inferior (7d) en
 * lugar de banner — pero nunca bloquea la pantalla: la agenda sigue usable.
 */
export function AvisoSuscripcion() {
  const router = useRouter();
  const { suscripcion } = useSuscripcion();

  if (!suscripcion || suscripcion.estado === "activa") return null;

  const precio = formatearMonto(suscripcion.monto, suscripcion.moneda);
  const hasta = formatearFechaCorta(suscripcion.pruebaHasta);
  const dias = suscripcion.diasRestantes;

  if (suscripcion.estado === "prueba") {
    return (
      <div className="mx-5 mt-5 flex items-center gap-3 rounded-md border border-line bg-card px-4 py-3.5">
        <Pastilla className="bg-accent-subtle text-accent">Prueba</Pastilla>
        <span className="flex-1 text-[13.5px] leading-[1.5] text-ink">
          Te quedan <strong className="font-semibold">{dias === 1 ? "1 día" : `${dias} días`}</strong> de prueba
          gratis.
        </span>
        <Link href="/plan" className="text-[13px] font-semibold text-link">
          Ver plan
        </Link>
      </div>
    );
  }

  if (suscripcion.estado === "por_vencer") {
    return (
      <div className="mx-5 mt-5 flex items-center gap-3 rounded-md border border-line bg-warning-subtle px-4 py-3.5">
        <Pastilla className="bg-warning text-warning-text">{dias === 1 ? "1 día" : `${dias} días`}</Pastilla>
        <span className="flex-1 text-[13.5px] leading-[1.5] text-ink">
          Tu prueba termina el {hasta}. Activá el plan para no perder el asistente.
        </span>
        <Button size="sm" onClick={() => router.push("/plan")}>
          Suscribirme
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Escritorio: una franja más arriba de la agenda. */}
      <div className="mx-5 mt-5 hidden items-center gap-3 rounded-md border border-line bg-danger-subtle p-4 md:flex">
        <Pastilla className="bg-danger text-white">Vencida</Pastilla>
        <span className="flex-1 text-[13.5px] leading-[1.5] text-ink">
          El asistente dejó de responder por WhatsApp. Tu agenda y tus datos siguen acá.
        </span>
        <Button size="sm" onClick={() => router.push("/plan")}>
          Activar por {precio}
        </Button>
      </div>

      {/* Móvil: hoja inferior, por encima de la barra de pestañas. */}
      <div className="fixed inset-x-0 bottom-0 z-20 rounded-t-[24px] border-t border-line bg-card px-5 pt-5 pb-24 shadow-lg md:hidden">
        <div className="mx-auto mb-4 h-1 w-[38px] rounded-full bg-line-strong" />
        <h2 className="mb-2 font-display text-[21px] leading-[1.2] font-bold tracking-[-0.02em] text-ink">
          Terminó tu mes de prueba
        </h2>
        <p className="mb-4 text-sm leading-[1.6] text-ink-secondary text-pretty">
          El asistente dejó de responder por WhatsApp. Tu agenda queda guardada tal cual.
        </p>
        <div className="mb-4 flex items-baseline gap-2 rounded-md border border-line bg-sunken p-3.5">
          <span className="font-display text-2xl font-bold text-ink">{precio}</span>
          <span className="text-[13px] text-ink-secondary">por mes · cancelás cuando quieras</span>
        </div>
        <Button size="lg" fullWidth onClick={() => router.push("/plan")}>
          Suscribirme
        </Button>
      </div>
    </>
  );
}
