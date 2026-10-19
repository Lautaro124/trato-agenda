"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { formatearChats, formatearMonto, usePrecioPlan } from "@/lib/suscripcion";

/**
 * Las tarjetas de planes del bloque de precio de la landing. La landing es un
 * server component, pero los precios se piden desde el browser: dentro de
 * compose el server de Next no llega a NEXT_PUBLIC_API_URL. Mientras cargan
 * ocupan el mismo alto sin mostrar un número, así nunca aparece un precio que
 * no es el de env.
 */
export function PlanesPrecio({ incluye }: { incluye: readonly string[] }) {
  const precio = usePrecioPlan();
  const planes = precio?.planes ?? [];

  return (
    <div className="grid gap-5 text-left md:grid-cols-2">
      {(planes.length > 0 ? planes : [null, null]).map((plan, i) => (
        <div
          key={plan?.id ?? i}
          className="flex flex-col rounded-[36px] border border-line-strong bg-page p-7 shadow-md md:p-9"
        >
          {plan && precio ? (
            <>
              <h3 className="font-display text-[19px] font-semibold text-ink">{plan.nombre}</h3>
              <div className="mt-3 font-display text-[38px] leading-none font-bold tracking-[-0.03em] text-ink md:text-[44px]">
                {formatearMonto(plan.monto, precio.moneda)}
              </div>
              <div className="mt-1.5 text-sm text-muted">por mes · después del mes gratis</div>
              <p className="mt-4 text-[15px] font-semibold text-ink">
                Hasta {formatearChats(plan.chats)} chats por mes
              </p>
              <p className="mt-1 text-[13px] leading-[1.5] text-muted">
                Cada cliente distinto que te escribe en el mes cuenta como un chat.
              </p>
            </>
          ) : (
            <div aria-busy="true" aria-label="Cargando el precio" className="h-[132px]">
              <span className="inline-block h-[0.9em] w-[4.5ch] rounded-md bg-sunken align-middle" />
            </div>
          )}
          <div className="mt-6 flex flex-1 flex-col gap-2.5 border-t border-line pt-6">
            {incluye.map((texto) => (
              <div key={texto} className="flex items-start gap-2.5 text-[15px] leading-[1.5] text-ink-secondary">
                <span className="mt-px grid size-5 flex-none place-items-center rounded-full bg-accent-subtle text-xs text-accent">
                  ✓
                </span>
                {texto}
              </div>
            ))}
          </div>
          <Link href="/entrar" className="mt-6">
            <Button size="lg" fullWidth>
              Empezar gratis
            </Button>
          </Link>
        </div>
      ))}
    </div>
  );
}
