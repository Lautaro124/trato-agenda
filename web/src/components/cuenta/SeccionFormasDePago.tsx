"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import {
  guardarCondicionesPago,
  LARGO_MAX_MENSAJE_COBRO,
  MAX_CUOTAS,
  MAX_PLANES_CUOTAS,
  MIN_CUOTAS,
  obtenerCondicionesPago,
  problemaDeCondiciones,
  type CobroManual,
  type CondicionesPago,
} from "@/lib/condiciones-pago";
import { PORCENTAJE_MAX } from "@/lib/descuentos";
import { ErrorDeApi } from "@/lib/productos";
import { cn } from "@/lib/cn";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-[14px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";
const LABEL = "mb-1 block text-[12.5px] font-semibold text-ink-secondary";

type ModoBorrador = "chat" | CobroManual["modo"];

/**
 * Lo que se edita: los números como texto, para poder borrar un campo. Los
 * campos de los dos modos de cobro se guardan aunque no estén elegidos, así
 * cambiar de opción no borra lo escrito.
 */
type Borrador = {
  planes: Array<{ cuotas: string; recargo: string }>;
  efectivo: string;
  cobro: { modo: ModoBorrador; alias: string; titular: string; mensaje: string };
};

function aBorrador(condiciones: CondicionesPago): Borrador {
  const cobro = condiciones.cobroManual;
  return {
    planes: condiciones.planesCuotas.map((plan) => ({ cuotas: String(plan.cuotas), recargo: String(plan.recargoPorcentaje) })),
    efectivo: condiciones.descuentoEfectivoPorcentaje === null ? "" : String(condiciones.descuentoEfectivoPorcentaje),
    cobro: {
      modo: cobro?.modo ?? "chat",
      alias: cobro?.modo === "transferencia" ? cobro.alias : "",
      titular: cobro?.modo === "transferencia" ? cobro.titular : "",
      mensaje: cobro?.modo === "otro_canal" ? cobro.mensaje : "",
    },
  };
}

function aCobroManual(cobro: Borrador["cobro"]): CobroManual | null {
  if (cobro.modo === "transferencia") return { modo: "transferencia", alias: cobro.alias, titular: cobro.titular };
  if (cobro.modo === "otro_canal") return { modo: "otro_canal", mensaje: cobro.mensaje };
  return null;
}

/** Para comparar con lo guardado: sólo cuenta lo del modo elegido. */
function huella(borrador: Borrador): string {
  return JSON.stringify({ ...borrador, cobro: aCobroManual(borrador.cobro) });
}

const MODOS_COBRO: Array<{ valor: ModoBorrador; texto: string; detalle: string }> = [
  { valor: "chat", texto: "Coordinar por el chat", detalle: "Tu asistente anota el pedido y sigue atendiendo." },
  { valor: "transferencia", texto: "Transferencia", detalle: "Le pasa tu alias para transferir." },
  { valor: "otro_canal", texto: "Otro canal", detalle: "Le manda tu mensaje para cobrarle por otro lado." },
];

function aCondiciones(borrador: Borrador): CondicionesPago {
  const numero = (texto: string) => (texto.trim() === "" ? Number.NaN : Number(texto));
  return {
    planesCuotas: borrador.planes.map((plan) => ({
      cuotas: numero(plan.cuotas),
      // Un recargo vacío es "sin interés".
      recargoPorcentaje: plan.recargo.trim() === "" ? 0 : numero(plan.recargo),
    })),
    descuentoEfectivoPorcentaje: borrador.efectivo.trim() === "" ? null : numero(borrador.efectivo),
    cobroManual: aCobroManual(borrador.cobro),
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
        Las cuotas y el descuento en efectivo que ofrece tu asistente, y cómo cobra los pedidos sin link. Los totales los calcula Trato; si no cargás
        cuotas ni descuento, no ofrece ninguno.
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
  const hayCambios = huella(borrador) !== huella(aBorrador(guardado));
  const haySinInteres = condiciones.planesCuotas.some((plan) => plan.recargoPorcentaje === 0);

  const cambiarCobro = (cambio: Partial<Borrador["cobro"]>) =>
    setBorrador((previo) => ({ ...previo, cobro: { ...previo.cobro, ...cambio } }));

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

      <h3 className="mt-5 mb-1 text-[13.5px] font-semibold text-ink">Cobro sin link de pago</h3>
      <p className="mb-3 text-[12.5px] leading-[1.5] text-muted">
        {mpConectado
          ? "Para los pedidos que no van con el link de Mercado Pago: en dólares, en efectivo o si el cliente prefiere transferir."
          : "Sin Mercado Pago conectado, todos los pedidos se cobran así."}
      </p>
      <fieldset>
        <legend className="sr-only">Cómo se cobra un pedido sin link</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODOS_COBRO.map((opcion) => (
            <label
              key={opcion.valor}
              className={cn(
                "cursor-pointer rounded-md border px-3 py-2 text-[13.5px] font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--color-semantic-border-focus)]",
                borrador.cobro.modo === opcion.valor ? "border-primary bg-primary-subtle text-ink" : "border-line text-ink-secondary",
              )}
            >
              <input
                type="radio"
                name="cobro-manual"
                value={opcion.valor}
                checked={borrador.cobro.modo === opcion.valor}
                onChange={() => cambiarCobro({ modo: opcion.valor })}
                className="sr-only"
              />
              {opcion.texto}
              <span className="block text-[12px] font-normal text-muted">{opcion.detalle}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {borrador.cobro.modo === "transferencia" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cobro-alias" className={LABEL}>
              Alias o CBU/CVU
            </label>
            <input
              id="cobro-alias"
              value={borrador.cobro.alias}
              placeholder="mi.negocio.mp"
              autoComplete="off"
              onChange={(e) => cambiarCobro({ alias: e.target.value })}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="cobro-titular" className={LABEL}>
              A nombre de
            </label>
            <input
              id="cobro-titular"
              value={borrador.cobro.titular}
              placeholder="Nombre del titular de la cuenta"
              onChange={(e) => cambiarCobro({ titular: e.target.value })}
              className={INPUT}
            />
          </div>
        </div>
      )}
      {borrador.cobro.modo === "otro_canal" && (
        <div className="mt-3">
          <label htmlFor="cobro-mensaje" className={LABEL}>
            Mensaje para el cliente
          </label>
          <textarea
            id="cobro-mensaje"
            rows={3}
            maxLength={LARGO_MAX_MENSAJE_COBRO}
            value={borrador.cobro.mensaje}
            placeholder="¡Gracias {nombre}! Te escribimos desde el 11-5555-0000 para cobrarte {total}."
            onChange={(e) => cambiarCobro({ mensaje: e.target.value })}
            className={INPUT}
          />
          <p className="mt-1 text-[12px] text-muted">
            Podés usar {"{nombre}"}, {"{total}"} y {"{detalle}"}: se completan solos.
          </p>
        </div>
      )}
      {borrador.cobro.modo !== "chat" && (
        <p className="mt-3 rounded-md bg-warning-subtle px-3 py-2 text-[12.5px] leading-[1.5] text-warning-text">
          Después de mandarle esto al cliente, tu asistente deja de contestar en ese chat hasta que marques el pedido
          pagado o lo canceles en Ventas. Mientras tanto, lo seguís vos por WhatsApp.
          {borrador.cobro.modo === "transferencia" && " Los pedidos en dólares o en efectivo no van al alias: les avisa que les escribís."}
        </p>
      )}

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
