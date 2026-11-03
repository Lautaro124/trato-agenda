"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LARGO_MAX_NOTA } from "@/lib/chats";
import { cn } from "@/lib/cn";

type Opcion = "contestar" | "resuelto";

/**
 * Devolver un chat al bot cuando el cliente quedó sin respuesta: que conteste
 * el bot (con una nota opcional que le da contexto) o "Ya lo resolví" (espera
 * el próximo mensaje). Escape o Cancelar lo cierran sin cambiar nada.
 */
export function DevolverDialog({
  nombre,
  ultimoDelCliente,
  trabajando,
  onConfirmar,
  onCancelar,
}: Readonly<{
  nombre: string;
  ultimoDelCliente: string;
  trabajando: boolean;
  onConfirmar: (opciones: { contestar: boolean; nota: string }) => void;
  onCancelar: () => void;
}>) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [opcion, setOpcion] = useState<Opcion>("contestar");
  const [nota, setNota] = useState("");
  const titulo = useId();

  // showModal deja el resto inerte y atrapa el foco; al cerrarse vuelve a quien lo abrió.
  useEffect(() => {
    const el = dialogo.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);

  const tarjeta = (activa: boolean) =>
    cn(
      "flex cursor-pointer gap-3 rounded-md border p-3.5",
      activa ? "border-primary bg-primary-subtle" : "border-line bg-card hover:bg-sunken",
    );

  return (
    <dialog
      ref={dialogo}
      aria-labelledby={titulo}
      onCancel={(e) => {
        e.preventDefault();
        onCancelar();
      }}
      className={cn(
        "mt-auto mb-0 w-full max-w-none rounded-t-[20px] border-0 bg-card p-0 text-ink shadow-lg",
        "sm:m-auto sm:max-w-[480px] sm:rounded-lg",
        "backdrop:bg-[rgba(26,25,23,0.45)]",
        "open:animate-[trato-entrar_200ms_var(--motion-easing-out)] motion-reduce:animate-none",
      )}
    >
      <form
        className="flex flex-col gap-4 px-5 pt-5 pb-7 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirmar({ contestar: opcion === "contestar", nota });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h2 id={titulo} className="font-display text-[20px] leading-[1.25] font-bold">
            Devolver el chat al bot
          </h2>
          <p className="text-[15px] text-ink-secondary">{nombre} escribió y todavía nadie le contestó:</p>
          <p className="rounded-md border border-line bg-page px-3.5 py-2.5 text-[15px] break-words whitespace-pre-line">
            “{ultimoDelCliente}”
          </p>
        </div>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-sm font-bold">¿Qué hace el bot con ese mensaje?</legend>
          <label className={tarjeta(opcion === "contestar")}>
            <input
              type="radio"
              name="opcion"
              value="contestar"
              checked={opcion === "contestar"}
              onChange={() => setOpcion("contestar")}
              className="mt-0.5 size-5 flex-none accent-[var(--color-semantic-primary-default)]"
            />
            <span className="flex flex-col gap-0.5">
              <strong className="text-[15px]">Que conteste el bot</strong>
              <span className="text-sm text-ink-secondary">Responde ahora a ese mensaje.</span>
            </span>
          </label>
          {opcion === "contestar" && (
            <label className="flex flex-col gap-1.5 pl-[46px]">
              <span className="text-sm font-semibold">
                Nota para el bot <span className="font-medium text-ink-secondary">(opcional)</span>
              </span>
              <textarea
                rows={2}
                maxLength={LARGO_MAX_NOTA}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Ej.: ya le pasé el precio, ofrecele el jueves a la tarde"
                className="resize-none rounded-md border border-line-strong bg-card px-3 py-2.5 text-sm text-ink"
              />
              <span className="text-xs text-ink-secondary">El cliente no ve esta nota. Le da contexto al bot.</span>
            </label>
          )}
          <label className={tarjeta(opcion === "resuelto")}>
            <input
              type="radio"
              name="opcion"
              value="resuelto"
              checked={opcion === "resuelto"}
              onChange={() => setOpcion("resuelto")}
              className="mt-0.5 size-5 flex-none accent-[var(--color-semantic-primary-default)]"
            />
            <span className="flex flex-col gap-0.5">
              <strong className="text-[15px]">Ya lo resolví</strong>
              <span className="text-sm text-ink-secondary">El bot no contesta y espera el próximo mensaje.</span>
            </span>
          </label>
        </fieldset>

        <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <Button variant="secondary" size="lg" className="sm:px-4 sm:py-2.5 sm:text-[15px]" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button type="submit" size="lg" disabled={trabajando} className="sm:px-[18px] sm:py-2.5 sm:text-[15px]">
            Devolver al bot
          </Button>
        </div>
      </form>
    </dialog>
  );
}
