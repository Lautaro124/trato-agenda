"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import {
  guardarCondicionesPago,
  MAX_CUOTAS,
  MAX_PLANES_CUOTAS,
  MIN_CUOTAS,
  obtenerCondicionesPago,
  problemaDeCondiciones,
  type CondicionesPago,
} from "@/lib/condiciones-pago";
import { PORCENTAJE_MAX } from "@/lib/descuentos";
import { ErrorDeApi } from "@/lib/productos";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-[14px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";
const LABEL = "mb-1 block text-[12.5px] font-semibold text-ink-secondary";

/** Lo que se edita: los números como texto, para poder borrar un campo. */
type Borrador = { planes: Array<{ cuotas: string; recargo: string }>; efectivo: string };

function aBorrador(condiciones: CondicionesPago): Borrador {
  return {
    planes: condiciones.planesCuotas.map((plan) => ({ cuotas: String(plan.cuotas), recargo: String(plan.recargoPorcentaje) })),
    efectivo: condiciones.descuentoEfectivoPorcentaje === null ? "" : String(condiciones.descuentoEfectivoPorcentaje),
  };
}

function aCondiciones(borrador: Borrador): CondicionesPago {
  const numero = (texto: string) => (texto.trim() === "" ? Number.NaN : Number(texto));
  return {
    planesCuotas: borrador.planes.map((plan) => ({
      cuotas: numero(plan.cuotas),
      // Un recargo vacío es "sin interés".
      recargoPorcentaje: plan.recargo.trim() === "" ? 0 : numero(plan.recargo),
    })),
    descuentoEfectivoPorcentaje: borrador.efectivo.trim() === "" ? null : numero(borrador.efectivo),
  };
}

/**
 * Cómo puede pagar el cliente (LAU-34): planes de cuotas con su recargo, como
 * en Mercado Libre, y el descuento por pagar en efectivo. El asistente sólo
 * ofrece lo que esté acá.
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
        Las cuotas y el descuento en efectivo que ofrece tu asistente. Los totales los calcula Trato; si no cargás
        nada, no ofrece ninguno.
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

  const condiciones = aCondiciones(borrador);
  const problema = problemaDeCondiciones(condiciones);
  const hayCambios = JSON.stringify(borrador) !== JSON.stringify(aBorrador(guardado));
  const haySinInteres = condiciones.planesCuotas.some((plan) => plan.recargoPorcentaje === 0);

  const cambiarPlan = (indice: number, cambio: Partial<Borrador["planes"][number]>) =>
    setBorrador((previo) => ({
      ...previo,
      planes: previo.planes.map((plan, i) => (i === indice ? { ...plan, ...cambio } : plan)),
    }));

  const guardar = () => {
    if (problema) return;
    setGuardando(true);
    setAviso(null);
    guardarCondicionesPago(condiciones)
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
      {borrador.planes.length === 0 && <p className="mb-3 text-[13px] text-muted">No ofrecés pago en cuotas.</p>}
      <ul className="mb-3 space-y-3">
        {borrador.planes.map((plan, indice) => (
          <li key={indice} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
            <div>
              <label htmlFor={`plan-${indice}-cuotas`} className={LABEL}>
                Cantidad de cuotas
              </label>
              <input
                id={`plan-${indice}-cuotas`}
                inputMode="numeric"
                value={plan.cuotas}
                placeholder="3"
                onChange={(e) => cambiarPlan(indice, { cuotas: e.target.value })}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor={`plan-${indice}-recargo`} className={LABEL}>
                Recargo (%)
              </label>
              <input
                id={`plan-${indice}-recargo`}
                inputMode="numeric"
                value={plan.recargo}
                placeholder="0 = sin interés"
                onChange={(e) => cambiarPlan(indice, { recargo: e.target.value })}
                className={INPUT}
              />
            </div>
            <Button
              variant="ghost"
              size="md"
              aria-label={`Quitar el plan ${indice + 1}`}
              onClick={() => setBorrador((previo) => ({ ...previo, planes: previo.planes.filter((_, i) => i !== indice) }))}
            >
              Quitar
            </Button>
          </li>
        ))}
      </ul>
      {borrador.planes.length < MAX_PLANES_CUOTAS && (
        <Button
          variant="secondary"
          size="md"
          onClick={() => setBorrador((previo) => ({ ...previo, planes: [...previo.planes, { cuotas: "", recargo: "0" }] }))}
        >
          Agregar plan de cuotas
        </Button>
      )}
      <p className="mt-2 text-[12.5px] leading-[1.5] text-muted">
        De {MIN_CUOTAS} a {MAX_CUOTAS} cuotas. El recargo se suma al total del pedido; con 0% es sin interés. Las
        cuotas son sólo para pedidos en pesos.
      </p>
      {haySinInteres && (
        <p className="mt-2 rounded-md bg-warning-subtle px-3 py-2 text-[12.5px] leading-[1.5] text-warning-text">
          {mpConectado
            ? "Para que las cuotas sin interés no le cobren interés al cliente, activalas también en tu cuenta de Mercado Pago (el costo lo absorbés vos, como en Mercado Libre)."
            : "Sin Mercado Pago conectado, las cuotas se coordinan por WhatsApp: tu asistente informa el total y vos cobrás."}
        </p>
      )}

      <h3 className="mt-5 mb-2 text-[13.5px] font-semibold text-ink">Efectivo</h3>
      <div className="max-w-[220px]">
        <label htmlFor="descuento-efectivo" className={LABEL}>
          Descuento en efectivo (%)
        </label>
        <input
          id="descuento-efectivo"
          inputMode="numeric"
          value={borrador.efectivo}
          placeholder="Sin descuento"
          onChange={(e) => setBorrador((previo) => ({ ...previo, efectivo: e.target.value }))}
          className={INPUT}
        />
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.5] text-muted">
        De 1% a {PORCENTAJE_MAX}%. Vale sólo pagando en efectivo y no se suma a tus promociones: se aplica el que más le
        conviene al cliente.
      </p>

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
