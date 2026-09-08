"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useRequireSession } from "@/lib/session";
import { formatearFechaCorta, formatearMonto, useSuscripcion } from "@/lib/suscripcion";

const INCLUYE = [
  "Agenda ilimitada y sincronización con Google Calendar",
  "Un número de WhatsApp con el asistente respondiendo",
  "Recordatorios automáticos a tus clientes",
];

function Item({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-px grid size-[18px] flex-none place-items-center rounded-full bg-accent-subtle text-[11px] text-accent">
        ✓
      </span>
      <span className="text-[13.5px] leading-[1.5] text-ink">{children}</span>
    </div>
  );
}

/**
 * Paso 3 de 3 del alta (artboard 7a del canvas): antes de vincular WhatsApp le
 * avisamos que el mes de prueba ya arrancó y que no le vamos a pedir tarjeta.
 */
export default function ListoPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const { suscripcion } = useSuscripcion();

  if (status !== "authenticated" || !user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando tu sesión…</p>
      </main>
    );
  }

  const hasta = suscripcion ? formatearFechaCorta(suscripcion.pruebaHasta) : null;
  const precio = formatearMonto(suscripcion?.monto ?? 20000, suscripcion?.moneda);

  return (
    <main className="grid min-h-dvh bg-page p-5 md:place-items-center md:p-7">
      {/* Móvil: columna a pantalla completa con el CTA abajo. Escritorio: tarjeta centrada. */}
      <div className="flex min-h-full w-full flex-col md:min-h-0 md:max-w-[560px] md:rounded-lg md:border md:border-line md:bg-card md:p-6 md:shadow-md">
        <div>
          <Badge tone="success">Prueba activa</Badge>
        </div>

        <h1 className="mt-4 mb-2 font-display text-[26px] leading-[1.15] font-bold tracking-[-0.02em] text-ink text-pretty md:text-[27px]">
          Tenés un mes gratis, desde hoy
        </h1>
        <p className="mb-5 text-[14.5px] leading-[1.6] text-ink-secondary text-pretty">
          Usá Trato Agenda completo{hasta ? <> hasta el <strong className="font-semibold">{hasta}</strong></> : null}. No
          te pedimos tarjeta ahora y no se cobra nada solo.
        </p>

        <div className="flex flex-col gap-2.5 rounded-md border border-line bg-card p-4 shadow-sm md:bg-sunken md:shadow-none">
          {INCLUYE.map((texto) => (
            <Item key={texto}>{texto}</Item>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-3 pt-6 md:mt-5 md:pt-0">
          <p className="text-center text-[12.5px] leading-[1.6] text-muted md:order-last md:text-left">
            Te avisamos 7 días antes de que termine. Después son {precio} por mes y lo activás vos.
          </p>
          <div className="flex flex-col items-center gap-2.5 md:flex-row">
            <Button size="lg" fullWidth onClick={() => router.push("/vincular")} className="md:w-auto">
              Vincular WhatsApp y empezar
            </Button>
            <Link href="/plan" className="text-[13.5px] text-link">
              Ver el plan
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
