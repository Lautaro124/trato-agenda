"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/productos/EditorProducto";
import { ETIQUETA_MOTIVO, fechaCorta, type DetalleVenta } from "@/lib/ventas";

/**
 * Un pedido que atendés vos (por ejemplo, por el cobro manual): el asistente
 * no contesta en ese chat hasta que se lo devuelvas.
 */
export function AtencionPedido({
  venta,
  trabajando,
  onDevolver,
}: {
  venta: DetalleVenta;
  trabajando: boolean;
  onDevolver: (nota: string) => void;
}) {
  const [nota, setNota] = useState("");
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md bg-danger-subtle p-3 text-[13px] text-danger-text">
      <p>
        <strong>Lo atendés vos</strong>
        {venta.derivadaAt && ` desde el ${fechaCorta(venta.derivadaAt)}`}. El asistente no contesta en este chat hasta
        que se lo devuelvas; escribile al cliente desde tu WhatsApp o desde Chats.
      </p>
      {venta.motivoDerivacion && (
        <p>
          Motivo: {ETIQUETA_MOTIVO[venta.motivoDerivacion] ?? venta.motivoDerivacion}
          {venta.detalleDerivacion && ` · “${venta.detalleDerivacion}”`}
        </p>
      )}
      <label className="text-ink">
        <span className={LABEL}>Qué le dejás dicho al asistente (opcional)</span>
        <input
          className={INPUT}
          value={nota}
          maxLength={500}
          placeholder="Le pasé el precio por teléfono y quedó en confirmar"
          onChange={(e) => setNota(e.target.value)}
        />
      </label>
      <Button variant="secondary" disabled={trabajando} onClick={() => onDevolver(nota)}>
        Devolver al asistente
      </Button>
    </div>
  );
}
