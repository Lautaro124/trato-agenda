"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/productos/EditorProducto";
import { centavosParaInput, formatearCentavos, leerCentavos } from "@/lib/productos";
import type { PresupuestoAGuardar, RenglonPresupuesto, TipoRenglon } from "@/lib/ventas";

/** Topes de la API (presupuesto.rules.ts). */
const MAX_RENGLONES = 30;
const LARGO_MAX_CONCEPTO = 120;
const LARGO_MAX_NOTA = 500;

type RenglonEnEdicion = { concepto: string; tipo: TipoRenglon; cantidad: string; unidad: string; precio: string };

function vacio(): RenglonEnEdicion {
  return { concepto: "", tipo: "otro", cantidad: "1", unidad: "", precio: "" };
}

function desde(renglon: RenglonPresupuesto): RenglonEnEdicion {
  return {
    concepto: renglon.concepto,
    tipo: renglon.tipo,
    cantidad: String(renglon.cantidad).replace(".", ","),
    unidad: renglon.unidad,
    precio: centavosParaInput(renglon.precioUnitarioCentavos),
  };
}

/** "2,4" o "2.4" → 2.4; null si no es un número mayor que cero. */
function leerCantidad(texto: string): number | null {
  const numero = Number(texto.trim().replace(",", "."));
  return Number.isFinite(numero) && numero > 0 ? Math.round(numero * 1000) / 1000 : null;
}

/** Subtotal como lo calcula la API: cantidad redondeada a 3 decimales por el precio, al centavo. */
function subtotal(renglon: RenglonEnEdicion): number | null {
  const cantidad = leerCantidad(renglon.cantidad);
  const precio = leerCentavos(renglon.precio);
  return cantidad === null || precio === null ? null : Math.round(cantidad * precio);
}

export type InicialPresupuesto = {
  renglones: RenglonPresupuesto[];
  estimativo: boolean;
  detalleAlCliente: boolean;
  nota: string | null;
};

/**
 * Arma un presupuesto a mano, renglón por renglón. El total lo vuelve a
 * calcular la API: lo de acá es para ver cómo queda mientras se escribe.
 */
export function EditorPresupuesto({
  inicial,
  trabajando,
  onGuardar,
  onCancelar,
}: {
  inicial: InicialPresupuesto | null;
  trabajando: boolean;
  onGuardar: (presupuesto: PresupuestoAGuardar) => void;
  onCancelar: () => void;
}) {
  const [renglones, setRenglones] = useState<RenglonEnEdicion[]>(() =>
    inicial && inicial.renglones.length > 0 ? inicial.renglones.map(desde) : [vacio()],
  );
  const [estimativo, setEstimativo] = useState(inicial?.estimativo ?? false);
  const [detalleAlCliente, setDetalleAlCliente] = useState(inicial?.detalleAlCliente ?? false);
  const [nota, setNota] = useState(inicial?.nota ?? "");
  const [revisar, setRevisar] = useState(false);

  const cambiar = (indice: number, cambio: Partial<RenglonEnEdicion>) =>
    setRenglones((actuales) => actuales.map((renglon, i) => (i === indice ? { ...renglon, ...cambio } : renglon)));

  const subtotales = renglones.map(subtotal);
  const total = subtotales.reduce<number>((suma, valor) => suma + (valor ?? 0), 0);
  const problema = renglones.some((renglon) => !renglon.concepto.trim())
    ? "A cada renglón le falta decir qué es."
    : subtotales.some((valor) => valor === null)
      ? "Revisá las cantidades y los precios: tienen que ser números mayores que cero."
      : total <= 0
        ? "El total tiene que ser mayor que cero."
        : null;

  const guardar = (enviar: boolean) => {
    setRevisar(true);
    if (problema) return;
    onGuardar({
      renglones: renglones.map((renglon) => ({
        concepto: renglon.concepto.trim(),
        tipo: renglon.tipo,
        cantidad: leerCantidad(renglon.cantidad) as number,
        unidad: renglon.unidad.trim(),
        precioUnitarioCentavos: leerCentavos(renglon.precio) as number,
      })),
      estimativo,
      detalleAlCliente,
      ...(nota.trim() ? { nota: nota.trim() } : {}),
      enviar,
    });
  };

  return (
    <div role="group" aria-label="Armar presupuesto" className="flex flex-col gap-3 rounded-lg border border-line bg-sunken p-3">
      {renglones.map((renglon, i) => (
        <div
          key={i}
          role="group"
          aria-label={`Renglón ${i + 1}`}
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md bg-card p-3 sm:grid-cols-[minmax(0,2fr)_80px_70px_minmax(0,1fr)_auto]"
        >
          <label className="col-span-2 sm:col-span-1">
            <span className={LABEL}>Qué es</span>
            <input
              className={INPUT}
              value={renglon.concepto}
              maxLength={LARGO_MAX_CONCEPTO}
              placeholder="Placard de melamina 120 × 240"
              onChange={(e) => cambiar(i, { concepto: e.target.value })}
            />
          </label>
          <label>
            <span className={LABEL}>Cantidad</span>
            <input
              className={INPUT}
              inputMode="decimal"
              value={renglon.cantidad}
              onChange={(e) => cambiar(i, { cantidad: e.target.value })}
            />
          </label>
          <label>
            <span className={LABEL}>Unidad</span>
            <input
              className={INPUT}
              value={renglon.unidad}
              maxLength={20}
              placeholder="m²"
              onChange={(e) => cambiar(i, { unidad: e.target.value })}
            />
          </label>
          <label>
            <span className={LABEL}>Precio por unidad</span>
            <input
              className={INPUT}
              inputMode="decimal"
              value={renglon.precio}
              placeholder="10.000"
              onChange={(e) => cambiar(i, { precio: e.target.value })}
            />
          </label>
          <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end">
            <span className="pb-2.5 text-[13.5px] font-semibold text-ink tabular-nums">
              {subtotales[i] === null ? "–" : formatearCentavos(subtotales[i] as number)}
            </span>
            {renglones.length > 1 && (
              <button
                type="button"
                aria-label={`Quitar renglón ${i + 1}`}
                className="pb-2.5 text-[12.5px] text-muted hover:text-danger-text"
                onClick={() => setRenglones((actuales) => actuales.filter((_, j) => j !== i))}
              >
                Quitar
              </button>
            )}
          </div>
        </div>
      ))}

      {renglones.length < MAX_RENGLONES && (
        <button
          type="button"
          className="self-start text-[13px] font-semibold text-link"
          onClick={() => setRenglones((actuales) => [...actuales, vacio()])}
        >
          + Agregar renglón
        </button>
      )}

      <div className="flex items-baseline justify-between border-t border-line pt-2">
        <span className="font-semibold text-ink">Total</span>
        <span className="font-display text-[18px] font-bold text-ink tabular-nums">{formatearCentavos(total)}</span>
      </div>

      <label className="flex items-start gap-2 text-[13.5px] text-ink">
        <input type="checkbox" className="mt-1" checked={detalleAlCliente} onChange={(e) => setDetalleAlCliente(e.target.checked)} />
        <span>
          El cliente ve cada renglón
          <span className="block text-[12px] text-muted">Si no, le llega sólo el total.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-[13.5px] text-ink">
        <input type="checkbox" className="mt-1" checked={estimativo} onChange={(e) => setEstimativo(e.target.checked)} />
        <span>
          Es estimativo
          <span className="block text-[12px] text-muted">Le avisamos que el precio final puede variar.</span>
        </span>
      </label>
      <label>
        <span className={LABEL}>Algo más para el cliente (opcional)</span>
        <textarea
          className={INPUT}
          rows={2}
          maxLength={LARGO_MAX_NOTA}
          value={nota}
          placeholder="Plazo de entrega, seña, condiciones…"
          onChange={(e) => setNota(e.target.value)}
        />
      </label>

      {revisar && problema && (
        <p role="alert" className="text-sm text-danger-text">
          {problema}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={trabajando} onClick={onCancelar}>
          Cancelar
        </Button>
        <Button variant="secondary" disabled={trabajando} onClick={() => guardar(false)}>
          Guardar sin mandar
        </Button>
        <Button disabled={trabajando} onClick={() => guardar(true)}>
          Mandar al cliente
        </Button>
      </div>
    </div>
  );
}
