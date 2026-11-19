"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { obtenerPreguntas, type PreguntaPedido } from "@/lib/preguntas";

/**
 * Las preguntas del pedido que se le hacen a este producto (LAU-100). Se
 * editan en Productos › Preguntas, junto con las de todos los pedidos.
 */
export function PreguntasDelProducto({ productoId }: Readonly<{ productoId: string | null }>) {
  const [preguntas, setPreguntas] = useState<PreguntaPedido[] | null>(null);

  useEffect(() => {
    let vigente = true;
    obtenerPreguntas()
      .then((todas) => vigente && setPreguntas(todas))
      .catch(() => vigente && setPreguntas([]));
    return () => {
      vigente = false;
    };
  }, []);

  const delProducto = productoId
    ? (preguntas ?? []).filter((pregunta) => pregunta.alcance === "producto" && pregunta.productos.includes(productoId))
    : [];
  const globales = (preguntas ?? []).filter((pregunta) => pregunta.alcance === "global").length;

  return (
    <section aria-labelledby="preguntas-del-producto" className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <div>
        <h2 id="preguntas-del-producto" className="text-[13.5px] font-bold text-ink">
          Preguntas al pedir
        </h2>
        <p className="text-[12.5px] text-ink-secondary">
          Lo que el asistente le pregunta al cliente al armar el pedido se configura en Preguntas, para este y otros
          productos.
        </p>
      </div>
      {preguntas !== null && (
        <>
          {delProducto.length > 0 ? (
            <ul className="flex flex-col gap-1.5 text-[14px] text-ink">
              {delProducto.map((pregunta) => (
                <li key={pregunta.id} className="rounded-md bg-sunken px-3 py-2">
                  {pregunta.texto}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-ink-secondary">
              {productoId ? "Este producto no tiene preguntas propias." : "Guardá el producto para asignarle preguntas."}
            </p>
          )}
          {globales > 0 && (
            <p className="text-[13px] text-ink-secondary">
              Además, {globales === 1 ? "hay 1 pregunta" : `hay ${globales} preguntas`} para todos los pedidos.
            </p>
          )}
        </>
      )}
      <Link href="/preguntas" className="self-start text-[14px] font-semibold text-link underline">
        Ir a Preguntas
      </Link>
    </section>
  );
}
