"use client";

import { formatearMonto, usePrecioPlan } from "@/lib/suscripcion";

/**
 * El número grande del bloque de precio de la landing. La landing es un server
 * component, pero el precio se pide desde el browser: dentro de compose el
 * server de Next no llega a NEXT_PUBLIC_API_URL. Mientras carga ocupa el mismo
 * alto sin mostrar un número, así nunca aparece un precio que no es el de env.
 */
export function PrecioPlan({ className }: { className?: string }) {
  const precio = usePrecioPlan();

  if (!precio) {
    return (
      <div className={className} aria-busy="true" aria-label="Cargando el precio">
        <span className="inline-block h-[0.9em] w-[4.5ch] rounded-md bg-sunken align-middle" />
      </div>
    );
  }

  return <div className={className}>{formatearMonto(precio.monto, precio.moneda)}</div>;
}
