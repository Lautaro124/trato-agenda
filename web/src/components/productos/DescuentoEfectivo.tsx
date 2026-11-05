"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  guardarCondicionesPago,
  obtenerCondicionesPago,
  problemaDeEfectivo,
} from "@/lib/condiciones-pago";
import { PORCENTAJE_MAX } from "@/lib/descuentos";
import { ErrorDeApi } from "@/lib/productos";

/** Texto del campo → porcentaje; vacío = sin descuento; lo que no es número, NaN (inválido). */
function leerPorcentaje(texto: string): number | null {
  return texto.trim() === "" ? null : Number(texto);
}

/**
 * El descuento por pagar en efectivo (LAU-34), arriba de las promociones: es
 * del catálogo y no se suma a ellas. Guarda sólo este dato; el cobro sin link
 * se configura en Cuenta.
 */
export function DescuentoEfectivo() {
  const [guardado, setGuardado] = useState<number | null | undefined>(undefined);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "error" } | null>(null);

  // Una respuesta de un efecto ya descartado (React corre el efecto dos veces en dev) no
  // pisa lo que el dueño empezó a escribir.
  useEffect(() => {
    const ctrl = { cancelado: false };
    obtenerCondicionesPago()
      .then((condiciones) => {
        if (ctrl.cancelado) return;
        setGuardado(condiciones.descuentoEfectivoPorcentaje);
        setTexto(condiciones.descuentoEfectivoPorcentaje === null ? "" : String(condiciones.descuentoEfectivoPorcentaje));
      })
      .catch(() => !ctrl.cancelado && setAviso({ texto: "No pudimos cargar el descuento en efectivo.", tono: "error" }));
    return () => {
      ctrl.cancelado = true;
    };
  }, []);

  const porcentaje = leerPorcentaje(texto);
  const problema = problemaDeEfectivo(porcentaje);
  const hayCambios = guardado !== undefined && porcentaje !== guardado;

  const guardar = () => {
    if (problema) return;
    setGuardando(true);
    setAviso(null);
    guardarCondicionesPago({ descuentoEfectivoPorcentaje: porcentaje })
      .then((nuevas) => {
        setGuardado(nuevas.descuentoEfectivoPorcentaje);
        setAviso({ texto: "Listo: tu asistente ya ofrece este descuento.", tono: "ok" });
      })
      .catch((e: unknown) =>
        setAviso({
          texto: e instanceof ErrorDeApi ? e.message : "No pudimos guardar el descuento. Probá de nuevo.",
          tono: "error",
        }),
      )
      .finally(() => setGuardando(false));
  };

  return (
    <div role="group" aria-label="Descuento en efectivo" className="flex flex-col gap-2 border-b border-line pb-4">
      <h3 className="text-[13.5px] font-semibold text-ink">Pago en efectivo</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-[160px]">
          <label htmlFor="descuento-efectivo" className="mb-1 block text-[12.5px] font-semibold text-ink-secondary">
            Descuento en efectivo (%)
          </label>
          <input
            id="descuento-efectivo"
            inputMode="numeric"
            value={texto}
            placeholder="Sin descuento"
            disabled={guardado === undefined}
            onChange={(e) => setTexto(e.target.value)}
            className="w-full rounded-md border border-line bg-card px-3 py-2 text-[14px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]"
          />
        </div>
        <Button variant="secondary" size="sm" onClick={guardar} disabled={!hayCambios || guardando || problema !== null}>
          {guardando ? "Guardando…" : "Guardar descuento"}
        </Button>
      </div>
      <p className="text-[12.5px] leading-[1.5] text-muted">
        De 1% a {PORCENTAJE_MAX}%. Vale sólo pagando en efectivo y no se suma a tus promociones: se aplica el que más le
        conviene al cliente.
      </p>
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
  );
}
