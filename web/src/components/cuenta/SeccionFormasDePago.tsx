"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  aBorradorCobro,
  aCobroManual,
  ControlesCobroManual,
  type BorradorCobro,
} from "./ControlesCobroManual";
import { apiFetch } from "@/lib/api";
import {
  guardarCondicionesPago,
  obtenerCondicionesPago,
  problemaDeCobroManual,
  type CondicionesPago,
} from "@/lib/condiciones-pago";
import { ErrorDeApi } from "@/lib/productos";

type Borrador = { cobro: BorradorCobro };

function aBorrador(condiciones: CondicionesPago): Borrador {
  return { cobro: aBorradorCobro(condiciones.cobroManual) };
}

/** Para comparar con lo guardado: sólo cuenta lo del modo elegido. */
function huella(borrador: Borrador): string {
  return JSON.stringify(aCobroManual(borrador.cobro));
}

/**
 * Cómo puede pagar el cliente (LAU-34): el cobro sin link. El descuento en
 * efectivo (Promociones) y las cuotas (EditorProducto) son del catálogo.
 */
export function SeccionFormasDePago() {
  const [guardado, setGuardado] = useState<CondicionesPago | null>(null);
  const [mpConectado, setMpConectado] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Desde el paso del Home (/cuenta#formas-de-pago): la sección se monta después
    // de la sesión, así que el navegador puede no haber encontrado el ancla.
    if (window.location.hash === "#formas-de-pago") {
      document.getElementById("formas-de-pago")?.scrollIntoView({ block: "start" });
    }
    obtenerCondicionesPago()
      .then(setGuardado)
      .catch(() => setError(true));
    apiFetch("/mercadopago/estado")
      .then((res) => (res.ok ? (res.json() as Promise<{ conectada: boolean }>) : null))
      .then((estado) => setMpConectado(estado?.conectada ?? false))
      .catch(() => setMpConectado(false));
  }, []);

  return (
    <section id="formas-de-pago" aria-label="Formas de pago" className="scroll-mt-20 rounded-lg border border-line bg-card p-5">
      <h2 className="mb-2 font-display text-[15px] font-bold text-ink">Formas de pago</h2>
      <p className="mb-4 text-[13.5px] leading-[1.6] text-ink-secondary">
        Cómo cobra tu asistente los pedidos sin link. Los totales los calcula Trato.
      </p>
      {guardado ? (
        // Se monta con lo guardado: el editor toma su estado inicial una sola vez.
        <Editor guardado={guardado} mpConectado={mpConectado} onGuardado={setGuardado} />
      ) : (
        <p className="text-[13px] text-muted">{error ? "No pudimos cargar esta sección." : "Cargando…"}</p>
      )}
    </section>
  );
}

function Editor({
  guardado,
  mpConectado,
  onGuardado,
}: {
  guardado: CondicionesPago;
  mpConectado: boolean;
  onGuardado: (condiciones: CondicionesPago) => void;
}) {
  const [borrador, setBorrador] = useState<Borrador>(() => aBorrador(guardado));
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "error" } | null>(null);

  const cobroManual = aCobroManual(borrador.cobro);
  const problema = problemaDeCobroManual(cobroManual);
  const hayCambios = huella(borrador) !== huella(aBorrador(guardado));

  const cambiarCobro = (cambio: Partial<BorradorCobro>) =>
    setBorrador((previo) => ({ ...previo, cobro: { ...previo.cobro, ...cambio } }));

  const guardar = () => {
    if (problema) return;
    setGuardando(true);
    setAviso(null);
    guardarCondicionesPago({ cobroManual })
      .then((nuevas) => {
        onGuardado(nuevas);
        setBorrador(aBorrador(nuevas));
        setAviso({ texto: "Listo: tu asistente ya ofrece estas formas de pago.", tono: "ok" });
      })
      .catch((e: unknown) =>
        setAviso({
          texto: e instanceof ErrorDeApi ? e.message : "No pudimos guardar los cambios. Probá de nuevo.",
          tono: "error",
        }),
      )
      .finally(() => setGuardando(false));
  };

  return (
    <>
      <h3 className="mb-2 text-[13.5px] font-semibold text-ink">Cuotas</h3>
      <p className="text-[12.5px] leading-[1.5] text-muted">
        Las cuotas se configuran en cada producto, en{" "}
        <Link href="/productos" className="font-semibold text-primary-hover underline">
          Productos
        </Link>
        : hasta cuántas, con un % de recargo o con un precio para cada una. Son sólo para productos en pesos.
        {mpConectado
          ? " Para que las cuotas sin interés no le cobren interés al cliente, activalas también en tu cuenta de Mercado Pago (el costo lo absorbés vos, como en Mercado Libre)."
          : " Sin Mercado Pago conectado, las cuotas se coordinan por WhatsApp: tu asistente informa el total y vos cobrás."}
      </p>

      <h3 className="mt-5 mb-1 text-[13.5px] font-semibold text-ink">Cobro sin link de pago</h3>
      <p className="mb-3 text-[12.5px] leading-[1.5] text-muted">
        {mpConectado
          ? "Para los pedidos que no van con el link de Mercado Pago: en dólares, en efectivo o si el cliente prefiere transferir."
          : "Sin Mercado Pago conectado, todos los pedidos se cobran así."}
      </p>
      <ControlesCobroManual cobro={borrador.cobro} onCambio={cambiarCobro} conMensaje />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="md" onClick={guardar} disabled={!hayCambios || guardando || problema !== null}>
          {guardando ? "Guardando…" : "Guardar formas de pago"}
        </Button>
        {hayCambios && problema && (
          <p role="alert" className="text-[13px] text-danger-text">
            {problema}
          </p>
        )}
        {aviso && (
          <p role="status" className={aviso.tono === "ok" ? "text-[13px] text-success-text" : "text-[13px] text-danger-text"}>
            {aviso.texto}
          </p>
        )}
      </div>
    </>
  );
}
