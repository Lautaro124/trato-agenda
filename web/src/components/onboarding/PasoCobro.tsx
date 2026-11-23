"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Onboarding, QuienCobra } from "@/app/contanos/useOnboarding";
import { ControlesCobroManual } from "@/components/cuenta/ControlesCobroManual";
import { Button } from "@/components/ui/Button";
import { API_URL, apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

type EstadoMp = { disponible: boolean; conectada: boolean };

const ICONO_TARJETA = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18M7 15h3" />
  </svg>
);

const ICONO_MANO = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M7 11V7a5 5 0 0 1 10 0" />
    <path d="M4 11h16v9H4z" />
    <path d="M12 14.5v2" />
  </svg>
);

const ICONO_LINK = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);

const TILDE_VERDE = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-px flex-none text-accent">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const BENEFICIOS_ASISTENTE = [
  "Vendés y cobrás aunque no estés mirando el celular",
  "El pedido se marca pagado solo y el stock queda al día",
  "Tu cliente paga con tarjeta, en cuotas o con dinero en cuenta",
];

const OPCIONES: Array<{ id: QuienCobra; label: string; descripcion: string; icono: ReactNode }> = [
  {
    id: "asistente",
    label: "Que cobre tu asistente",
    descripcion: "Le manda al cliente un link de Mercado Pago con el total del pedido. La plata entra directo a tu cuenta.",
    icono: ICONO_TARJETA,
  },
  {
    id: "vos",
    label: "Lo cobrás vos",
    descripcion:
      "Tu asistente toma el pedido y le dice al cliente cómo pagarte. Cuando te llega la plata, lo marcás pagado en Ventas.",
    icono: ICONO_MANO,
  },
];

/**
 * Si Mercado Pago ya está conectado. Se vuelve a consultar al volver a la
 * pestaña: la conexión se hace en otra, para no perder lo cargado en el wizard.
 */
function useEstadoMercadoPago(): EstadoMp | null {
  const [estado, setEstado] = useState<EstadoMp | null>(null);

  const consultar = useCallback(() => {
    apiFetch("/mercadopago/estado")
      .then((res) => (res.ok ? (res.json() as Promise<EstadoMp>) : null))
      .then((datos) => setEstado(datos ? { disponible: datos.disponible, conectada: datos.conectada } : null))
      .catch(() => setEstado(null));
  }, []);

  useEffect(() => {
    consultar();
    const alVolver = () => {
      if (document.visibilityState === "visible") consultar();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [consultar]);

  return estado;
}

function ElegirQuienCobra({ valor, onCambio }: { valor: QuienCobra; onCambio: (valor: QuienCobra) => void }) {
  return (
    <div role="radiogroup" aria-label="¿Cómo cobrás tus ventas?" className="flex flex-col gap-3">
      {OPCIONES.map((opcion) => {
        const activa = opcion.id === valor;
        return (
          <button
            key={opcion.id}
            type="button"
            role="radio"
            aria-checked={activa}
            onClick={() => onCambio(opcion.id)}
            className={cn(
              "flex cursor-pointer items-start gap-4 rounded-md border-2 p-4 text-left transition-colors sm:p-5",
              activa ? "border-primary bg-primary-subtle" : "border-line bg-card hover:border-line-strong",
            )}
          >
            <span className="grid size-11 flex-none place-items-center rounded-md border border-[var(--color-primitive-coral-200)] bg-card text-primary sm:size-12">
              {opcion.icono}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-display text-[17px] font-bold text-ink sm:text-[18px]">{opcion.label}</span>
                {opcion.id === "asistente" && (
                  <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[11.5px] font-bold text-success-text">
                    Recomendado
                  </span>
                )}
              </span>
              <span className="text-[13.5px] leading-[1.55] text-ink-secondary sm:text-[14px]">{opcion.descripcion}</span>
              {opcion.id === "asistente" ? (
                <span className="mt-1 flex flex-col gap-1.5">
                  {BENEFICIOS_ASISTENTE.map((beneficio) => (
                    <span key={beneficio} className="flex items-start gap-2 text-[13px] leading-[1.45] text-ink">
                      {TILDE_VERDE}
                      {beneficio}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="mt-0.5 text-[12.5px] text-ink-secondary">Transferencia · efectivo · dólares</span>
              )}
            </span>
            <span
              aria-hidden
              className={cn(
                "grid size-[22px] flex-none place-items-center rounded-full border-2 bg-card",
                activa ? "border-primary" : "border-line",
              )}
            >
              {activa && <span className="size-2.5 rounded-full bg-primary" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Conectar la cuenta de Mercado Pago del comercio sin salir del wizard. */
function ConectarMercadoPago() {
  const estado = useEstadoMercadoPago();
  const [pospuesto, setPospuesto] = useState(false);

  if (estado?.conectada) {
    return (
      <div className="mt-5 flex max-w-[640px] items-center gap-3.5 rounded-md border border-[#c9e9d6] bg-accent-subtle px-4 py-3.5">
        <span className="grid size-9 flex-none place-items-center rounded-full bg-accent text-white">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-[14.5px] font-bold text-success-text">Mercado Pago conectado</span>
          <span className="text-[13.5px] text-success-text">Los links de cobro salen a tu nombre.</span>
        </span>
      </div>
    );
  }

  const disponible = estado?.disponible ?? false;
  return (
    <div className="mt-5 flex max-w-[640px] flex-wrap items-center gap-3.5 rounded-md border border-line bg-page px-4 py-3.5">
      <span className="grid size-9 flex-none place-items-center rounded-sm border border-[var(--color-primitive-coral-200)] bg-card text-primary">
        {ICONO_LINK}
      </span>
      <span className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
        <span className="text-[14.5px] font-bold text-ink">Conectá tu Mercado Pago</span>
        <span className="text-[13.5px] leading-[1.55] text-ink-secondary">
          {estado && !disponible
            ? "La conexión con Mercado Pago todavía no está habilitada. Mientras tanto, los pedidos quedan anotados."
            : "Se abre en otra pestaña para autorizar los links de cobro a tu nombre. Tarda menos de un minuto."}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1">
        <Button
          disabled={!disponible}
          onClick={() => {
            // Otra pestaña: el OAuth vuelve a /cuenta y acá se perdería lo cargado.
            // Al volver a ésta, useEstadoMercadoPago consulta de nuevo.
            window.open(`${API_URL}/mercadopago/conectar`, "_blank", "noopener");
          }}
        >
          Conectar
        </Button>
        {!pospuesto && (
          <Button variant="ghost" size="sm" onClick={() => setPospuesto(true)}>
            Más tarde
          </Button>
        )}
      </span>
      {pospuesto && (
        <p className="basis-full rounded-md bg-warning-subtle px-3 py-2 text-[12.5px] leading-[1.5] text-warning-text">
          Hasta que lo conectes, tu asistente toma el pedido y te lo deja para que coordines el pago. Lo conectás
          después desde Cuenta.
        </p>
      )}
    </div>
  );
}

/** Paso "cobro" del asistente de ventas: quién cobra y, si cobra el dueño, cómo. */
export function PasoCobro({ ob }: { ob: Onboarding }) {
  return (
    <>
      <ElegirQuienCobra valor={ob.quienCobra} onCambio={ob.setQuienCobra} />

      {ob.quienCobra === "asistente" ? (
        <>
          <ConectarMercadoPago />
          <p className="mt-3 max-w-[640px] text-[12.5px] leading-[1.55] text-ink-secondary">
            Trato nunca toca tu plata: el pago va de tu cliente a tu Mercado Pago, con las comisiones de tu cuenta.
          </p>
        </>
      ) : (
        <div className="mt-6 max-w-[640px]">
          <p className="mb-3 text-[13px] font-semibold text-ink-secondary">¿Qué le dice tu asistente al cliente?</p>
          <ControlesCobroManual cobro={ob.cobro} onCambio={ob.cambiarCobro} conMensaje={false} />
          {ob.problemaCobro && ob.cobro.modo === "transferencia" && (ob.cobro.alias || ob.cobro.titular) && (
            <p role="alert" className="mt-3 text-[13px] text-danger-text">
              {ob.problemaCobro}
            </p>
          )}
        </div>
      )}
    </>
  );
}
