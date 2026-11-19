"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { formatearMonto, useSuscripcion } from "@/lib/suscripcion";

/**
 * Con la prueba vencida, en el teléfono, una hoja inferior (7d del canvas)
 * — nunca bloquea la pantalla: la agenda sigue usable. Los días que quedan y
 * el aviso de vencida en escritorio viven en la barra lateral (IndicadorPrueba).
 */
export function AvisoSuscripcion() {
  const router = useRouter();
  const { suscripcion } = useSuscripcion();

  if (suscripcion?.estado !== "vencida") return null;

  const precio = formatearMonto(suscripcion.monto, suscripcion.moneda);

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 rounded-t-[24px] border-t border-line bg-card px-5 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-lg md:hidden">
      <div className="mx-auto mb-4 h-1 w-[38px] rounded-full bg-line-strong" />
      <h2 className="mb-2 font-display text-[21px] leading-[1.2] font-bold tracking-[-0.02em] text-ink">
        Terminó tu mes de prueba
      </h2>
      <p className="mb-4 text-sm leading-[1.6] text-ink-secondary text-pretty">
        El asistente dejó de responder por WhatsApp. Tu agenda queda guardada tal cual.
      </p>
      <div className="mb-4 flex items-baseline gap-2 rounded-md border border-line bg-sunken p-3.5">
        <span className="text-[13px] text-ink-secondary">Desde</span>
        <span className="font-display text-2xl font-bold text-ink">{precio}</span>
        <span className="text-[13px] text-ink-secondary">por mes · cancelás cuando quieras</span>
      </div>
      <Button size="lg" fullWidth onClick={() => router.push("/plan")}>
        Suscribirme
      </Button>
    </div>
  );
}
