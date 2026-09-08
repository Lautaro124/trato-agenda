"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { useRequireSession } from "@/lib/session";
import {
  formatearFechaCorta,
  formatearMonto,
  useSuscripcion,
  type Suscripcion,
} from "@/lib/suscripcion";

/** El webhook de Mercado Pago tarda unos segundos: no damos por perdido el pago enseguida. */
const INTENTOS_CONFIRMACION = 5;
const ESPERA_MS = 2000;

type Vista = "plan" | "confirmando" | "listo";

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between text-[13px]">
      <span className="text-ink-secondary">{etiqueta}</span>
      <span className="font-semibold text-ink">{valor}</span>
    </div>
  );
}

/**
 * Suscripción mensual (artboard 7c del canvas). El único medio de pago es
 * Mercado Pago: el cobro se autoriza en su pantalla, así que acá no se toca
 * ningún dato de tarjeta.
 */
export default function PlanPage() {
  // useSearchParams necesita un límite de Suspense para que la ruta pueda
  // prerenderizarse; sin él, todo el árbol se cae al render en cliente.
  return (
    <Suspense fallback={<Cargando />}>
      <PlanContenido />
    </Suspense>
  );
}

function Cargando() {
  return (
    <main className="grid min-h-dvh place-items-center bg-page p-6">
      <p className="text-sm text-muted">Cargando tu plan…</p>
    </main>
  );
}

function PlanContenido() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const { suscripcion, refrescar } = useSuscripcion();
  // Mercado Pago nos devuelve a /plan?volviendo=1 con el pago recién hecho.
  const volviendo = useSearchParams().has("volviendo");
  const [vista, setVista] = useState<Vista>(volviendo ? "confirmando" : "plan");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El webhook puede llegar después que el browser: reintentamos unas veces
  // antes de decir que no lo pudimos confirmar. El estado se toca sólo dentro
  // del callback de la promesa, nunca en el cuerpo del efecto.
  useEffect(() => {
    if (status !== "authenticated" || !volviendo) return;

    let vivo = true;
    let intentos = 0;

    const chequear = () => {
      refrescar()
        .then((datos) => {
          if (!vivo) return;
          if (datos?.estado === "activa") {
            setVista("listo");
            return;
          }
          intentos += 1;
          if (intentos < INTENTOS_CONFIRMACION) setTimeout(chequear, ESPERA_MS);
        })
        .catch(() => {});
    };
    chequear();

    return () => {
      vivo = false;
    };
  }, [status, volviendo, refrescar]);

  function reintentarConfirmacion() {
    refrescar()
      .then((datos) => datos?.estado === "activa" && setVista("listo"))
      .catch(() => {});
  }

  async function suscribirme() {
    setEnviando(true);
    setError(null);

    try {
      const res = await apiFetch("/suscripcion/checkout", { method: "POST" });
      if (!res.ok) throw new Error("checkout falló");
      const { initPoint } = (await res.json()) as { initPoint: string };
      // Mercado Pago es otro origen: router.push no puede salir del origen del front.
      window.location.href = initPoint;
    } catch {
      setError("No pudimos abrir el pago de Mercado Pago. Probá de nuevo en un rato.");
      setEnviando(false);
    }
  }

  async function cancelar() {
    setEnviando(true);
    setError(null);

    const res = await apiFetch("/suscripcion/cancelar", { method: "POST" });
    if (!res.ok) setError("No pudimos cancelar la suscripción. Probá de nuevo.");
    await refrescar();
    setVista("plan");
    setEnviando(false);
  }

  if (status !== "authenticated" || !user) return <Cargando />;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="plan" user={user} />

      <main className="grid flex-1 place-items-center bg-page p-5 pb-24 md:pb-5">
        {vista === "listo" ? (
          <Exito suscripcion={suscripcion} onVolver={() => router.push("/inicio")} />
        ) : vista === "confirmando" ? (
          <Confirmando onReintentar={reintentarConfirmacion} />
        ) : suscripcion?.estado === "activa" ? (
          <PlanVigente suscripcion={suscripcion} enviando={enviando} onCancelar={() => void cancelar()} />
        ) : (
          <Checkout
            suscripcion={suscripcion}
            enviando={enviando}
            onSuscribirme={() => void suscribirme()}
          />
        )}

        {error && <p className="mt-4 text-[12.5px] text-danger-text">{error}</p>}
      </main>

      <MobileTabBar active="plan" />
    </div>
  );
}

/** Tarjeta principal: plan a la izquierda, resumen y CTA a la derecha. */
function Checkout({
  suscripcion,
  enviando,
  onSuscribirme,
}: {
  suscripcion: Suscripcion | null;
  enviando: boolean;
  onSuscribirme: () => void;
}) {
  const precio = formatearMonto(suscripcion?.monto ?? 20000, suscripcion?.moneda);
  const vencida = suscripcion?.estado === "vencida";

  return (
    <div className="flex w-full max-w-[920px] flex-col overflow-hidden rounded-lg border border-line bg-card shadow-md md:flex-row">
      <div className="min-w-0 flex-1 p-6">
        <h1 className="mb-2 font-display text-[25px] leading-[1.18] font-bold tracking-[-0.02em] text-ink">
          Seguí con el asistente
        </h1>
        <p className="mb-5 text-sm leading-[1.6] text-ink-secondary text-pretty">
          {vencida
            ? "Se terminó tu mes de prueba y el asistente dejó de responder."
            : suscripcion
              ? `Tu prueba termina el ${formatearFechaCorta(suscripcion.pruebaHasta)}.`
              : ""}{" "}
          Elegí cómo querés pagar; podés cancelar cuando quieras.
        </p>

        <div className="mb-5 flex items-center justify-between gap-4 rounded-md border border-line bg-sunken p-4">
          <div>
            <div className="font-display text-[15.5px] font-semibold text-ink">Plan mensual</div>
            <div className="mt-0.5 text-[12.5px] leading-[1.5] text-ink-secondary">
              Se renueva todos los meses. Cancelás cuando quieras.
            </div>
          </div>
          <div className="flex-none text-right">
            <div className="font-display text-[19px] font-bold text-ink">{precio}</div>
            <div className="text-[11.5px] text-muted">por mes</div>
          </div>
        </div>

        <p className="mb-2.5 text-[12.5px] font-semibold text-ink-secondary">Medio de pago</p>
        <div className="mb-5 flex flex-wrap gap-2">
          <span className="rounded-full border border-primary bg-primary px-3 py-[7px] text-[13px] font-semibold text-primary-on select-none">
            Mercado Pago
          </span>
        </div>

        <p className="rounded-md border border-line bg-sunken p-3.5 text-[13px] leading-[1.55] text-ink-secondary">
          Te llevamos a Mercado Pago para autorizar el débito automático. Volvés acá cuando termines.
        </p>
      </div>

      <div className="flex flex-col border-t border-line bg-sunken p-6 md:w-[36%] md:flex-none md:border-t-0 md:border-l md:px-5">
        <p className="mb-4 text-[12.5px] font-semibold text-ink-secondary">Resumen</p>
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="text-[13.5px] text-ink-secondary">Plan mensual</span>
          <span className="font-display text-xl font-bold text-ink">{precio}</span>
        </div>
        <p className="mb-4 text-[12.5px] leading-[1.6] text-muted">
          Se renueva solo cada mes hasta que lo canceles.
        </p>
        <div className="mb-4 h-px bg-line" />
        <p className="mb-2 text-[12.5px] leading-[1.6] text-ink-secondary">
          El primer cobro es hoy, al autorizar el débito en Mercado Pago.
        </p>

        <div className="mt-auto flex flex-col gap-2.5 pt-4">
          <Button size="lg" fullWidth disabled={enviando} onClick={onSuscribirme}>
            {enviando ? "Abriendo Mercado Pago…" : "Suscribirme"}
          </Button>
          <p className="text-center text-[11.5px] text-muted">Cancelás desde acá, sin llamar a nadie.</p>
        </div>
      </div>
    </div>
  );
}

/** Estado de éxito del artboard 7c. */
function Exito({ suscripcion, onVolver }: { suscripcion: Suscripcion | null; onVolver: () => void }) {
  return (
    <div className="w-full max-w-[520px] rounded-lg border border-line bg-card p-6 text-center shadow-md">
      <div className="mx-auto mb-4 grid size-[52px] place-items-center rounded-full bg-accent-subtle text-2xl text-accent">
        ✓
      </div>
      <h1 className="mb-2 font-display text-2xl leading-[1.2] font-bold tracking-[-0.02em] text-ink">
        Listo, tu plan queda activo
      </h1>
      <p className="mb-5 text-sm leading-[1.6] text-ink-secondary text-pretty">
        El asistente sigue respondiendo tu WhatsApp. Te avisamos antes de cada renovación.
      </p>
      <div className="mb-5 flex flex-col gap-2 rounded-md border border-line bg-sunken p-4 text-left">
        <Fila etiqueta="Plan" valor="Mensual" />
        <Fila etiqueta="Importe" valor={formatearMonto(suscripcion?.monto ?? 20000, suscripcion?.moneda)} />
        <Fila etiqueta="Medio de pago" valor="Mercado Pago" />
      </div>
      <Button onClick={onVolver}>Volver a la agenda</Button>
    </div>
  );
}

/** Volvimos de Mercado Pago pero el webhook todavía no llegó. */
function Confirmando({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div className="w-full max-w-[520px] rounded-lg border border-line bg-card p-6 text-center shadow-md">
      <h1 className="mb-2 font-display text-[22px] leading-[1.2] font-bold tracking-[-0.02em] text-ink">
        Estamos confirmando el pago
      </h1>
      <p className="mb-5 text-sm leading-[1.6] text-ink-secondary text-pretty">
        Mercado Pago puede tardar un ratito en avisarnos. No hace falta que pagues de nuevo.
      </p>
      <Button variant="secondary" onClick={onReintentar}>
        Volver a chequear
      </Button>
    </div>
  );
}

/** Ya está pagando: sólo queda mostrarle el plan y dejarlo cancelar. */
function PlanVigente({
  suscripcion,
  enviando,
  onCancelar,
}: {
  suscripcion: Suscripcion;
  enviando: boolean;
  onCancelar: () => void;
}) {
  return (
    <div className="w-full max-w-[520px] rounded-lg border border-line bg-card p-6 shadow-md">
      <h1 className="mb-2 font-display text-2xl leading-[1.2] font-bold tracking-[-0.02em] text-ink">
        Tu plan está activo
      </h1>
      <p className="mb-5 text-sm leading-[1.6] text-ink-secondary text-pretty">
        El asistente responde tu WhatsApp con normalidad.
      </p>
      <div className="mb-5 flex flex-col gap-2 rounded-md border border-line bg-sunken p-4">
        <Fila etiqueta="Plan" valor="Mensual" />
        <Fila etiqueta="Importe" valor={formatearMonto(suscripcion.monto, suscripcion.moneda)} />
        <Fila
          etiqueta="Próximo cobro"
          valor={suscripcion.proximoCobroAt ? formatearFechaCorta(suscripcion.proximoCobroAt) : "—"}
        />
      </div>
      <Button variant="ghost" disabled={enviando} onClick={onCancelar}>
        Cancelar la suscripción
      </Button>
    </div>
  );
}
