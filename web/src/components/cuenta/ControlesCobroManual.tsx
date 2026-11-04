"use client";

import { TextoConDatos } from "@/components/ui/TextoConDatos";
import { cn } from "@/lib/cn";
import {
  LARGO_MAX_MENSAJE_COBRO,
  MENSAJE_COBRO_SUGERIDO,
  VARIABLES_MENSAJE_COBRO,
  type CobroManual,
} from "@/lib/condiciones-pago";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-[14px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";
const LABEL = "mb-1 block text-[12.5px] font-semibold text-ink-secondary";

export type ModoBorrador = "chat" | CobroManual["modo"];

/**
 * Lo que se edita del cobro sin link. Los campos de los dos modos se guardan
 * aunque no estén elegidos, así cambiar de opción no borra lo escrito.
 */
export type BorradorCobro = { modo: ModoBorrador; alias: string; titular: string; mensaje: string };

export const COBRO_INICIAL: BorradorCobro = { modo: "chat", alias: "", titular: "", mensaje: "" };

export function aBorradorCobro(cobro: CobroManual | null): BorradorCobro {
  return {
    modo: cobro?.modo ?? "chat",
    alias: cobro?.modo === "transferencia" ? cobro.alias : "",
    titular: cobro?.modo === "transferencia" ? cobro.titular : "",
    mensaje: cobro?.modo === "otro_canal" ? cobro.mensaje : "",
  };
}

export function aCobroManual(cobro: BorradorCobro): CobroManual | null {
  if (cobro.modo === "transferencia") return { modo: "transferencia", alias: cobro.alias, titular: cobro.titular };
  if (cobro.modo === "otro_canal") return { modo: "otro_canal", mensaje: cobro.mensaje };
  return null;
}

const MODOS_COBRO: Array<{ valor: ModoBorrador; texto: string; detalle: string }> = [
  { valor: "chat", texto: "Coordinar por el chat", detalle: "Tu asistente anota el pedido y sigue atendiendo." },
  { valor: "transferencia", texto: "Transferencia", detalle: "Le pasa tu alias para transferir." },
  { valor: "otro_canal", texto: "Otro canal", detalle: "Le manda tu mensaje para cobrarle por otro lado." },
];

/**
 * Cómo se cobra un pedido sin link (LAU-34): las tres opciones y los campos de
 * la elegida. Sin `conMensaje` (onboarding), "Otro canal" arranca con el
 * mensaje sugerido y se edita después en la pestaña Asistente.
 */
export function ControlesCobroManual({
  cobro,
  onCambio,
  conMensaje,
}: {
  cobro: BorradorCobro;
  onCambio: (cambio: Partial<BorradorCobro>) => void;
  conMensaje: boolean;
}) {
  return (
    <>
      <fieldset>
        <legend className="sr-only">Cómo se cobra un pedido sin link</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODOS_COBRO.map((opcion) => (
            <label
              key={opcion.valor}
              className={cn(
                "relative cursor-pointer rounded-md border px-3 py-2 text-[13.5px] font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--color-semantic-border-focus)]",
                cobro.modo === opcion.valor ? "border-primary bg-primary-subtle text-ink" : "border-line text-ink-secondary",
              )}
            >
              <input
                type="radio"
                name="cobro-manual"
                value={opcion.valor}
                checked={cobro.modo === opcion.valor}
                onChange={() =>
                  onCambio({
                    modo: opcion.valor,
                    // Sin el editor a la vista, el mensaje arranca con el sugerido.
                    ...(!conMensaje && opcion.valor === "otro_canal" && !cobro.mensaje.trim()
                      ? { mensaje: MENSAJE_COBRO_SUGERIDO }
                      : {}),
                  })
                }
                className="absolute inset-0 m-0 cursor-pointer appearance-none opacity-0"
              />
              {opcion.texto}
              <span className="block text-[12px] font-normal text-muted">{opcion.detalle}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {cobro.modo === "transferencia" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cobro-alias" className={LABEL}>
              Alias o CBU/CVU
            </label>
            <input
              id="cobro-alias"
              value={cobro.alias}
              placeholder="mi.negocio.mp"
              autoComplete="off"
              onChange={(e) => onCambio({ alias: e.target.value })}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="cobro-titular" className={LABEL}>
              A nombre de
            </label>
            <input
              id="cobro-titular"
              value={cobro.titular}
              placeholder="Nombre del titular de la cuenta"
              onChange={(e) => onCambio({ titular: e.target.value })}
              className={INPUT}
            />
          </div>
        </div>
      )}
      {cobro.modo === "otro_canal" &&
        (conMensaje ? (
          <div className="mt-3">
            <label htmlFor="cobro-mensaje" className={LABEL}>
              Mensaje para el cliente
            </label>
            <TextoConDatos
              id="cobro-mensaje"
              filas={3}
              maxLength={LARGO_MAX_MENSAJE_COBRO}
              valor={cobro.mensaje}
              placeholder="¡Gracias {nombre}! Te escribimos desde el 11-5555-0000 para cobrarte {total}."
              onCambio={(mensaje) => onCambio({ mensaje })}
              variables={VARIABLES_MENSAJE_COBRO}
              describedBy="cobro-mensaje-ayuda"
            />
            <p id="cobro-mensaje-ayuda" className="mt-1 text-[12px] text-muted">
              Tocá un dato y se inserta donde está el cursor; al cliente le llega completado.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] leading-[1.5] text-muted">
            El mensaje que le llega al cliente lo escribís después, en la pestaña Asistente. Hasta entonces se manda uno
            genérico.
          </p>
        ))}
      {cobro.modo !== "chat" && (
        <p className="mt-3 rounded-md bg-warning-subtle px-3 py-2 text-[12.5px] leading-[1.5] text-warning-text">
          Después de mandarle esto al cliente, tu asistente deja de contestar en ese chat hasta que marques el pedido
          pagado o lo canceles en Ventas. Mientras tanto, lo seguís vos por WhatsApp.
          {cobro.modo === "transferencia" && " Los pedidos en dólares o en efectivo no van al alias: les avisa que les escribís."}
        </p>
      )}
    </>
  );
}
