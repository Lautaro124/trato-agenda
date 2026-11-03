"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  contextoDe,
  horaDeMensaje,
  inicialDe,
  LARGO_MAX_MENSAJE,
  nombreDe,
  type DetalleChat,
  type MensajeChat,
} from "@/lib/chats";
import { cn } from "@/lib/cn";

const BURBUJA: Record<MensajeChat["de"], string> = {
  cliente: "self-start rounded-bl-sm border border-line bg-card",
  asistente: "self-end rounded-br-sm bg-accent-subtle",
  dueno: "self-end rounded-br-sm bg-primary-subtle",
};
const AUTOR: Record<Exclude<MensajeChat["de"], "cliente">, { texto: string; color: string }> = {
  asistente: { texto: "Bot", color: "text-success-text" },
  dueno: { texto: "Vos", color: "text-primary-active" },
};

/**
 * Un chat: arriba quién contesta y el único botón que lo cambia; abajo, para
 * escribir, sólo cuando contestás vos.
 */
export function Conversacion({
  detalle,
  trabajando,
  enviando,
  onVolver,
  onTomar,
  onDevolver,
  onEnviar,
}: Readonly<{
  detalle: DetalleChat;
  trabajando: boolean;
  enviando: boolean;
  /** Sólo en el celular: vuelve a la lista. */
  onVolver: () => void;
  onTomar: () => void;
  onDevolver: () => void;
  /** Devuelve true si salió, para limpiar lo escrito. */
  onEnviar: (texto: string) => Promise<boolean>;
}>) {
  const { chat, mensajes } = detalle;
  const nombre = nombreDe(chat);
  const contexto = contextoDe(chat);
  const esVos = chat.atencion === "humana";
  const [borrador, setBorrador] = useState("");
  const historial = useRef<HTMLDivElement>(null);
  const ultimo = mensajes.at(-1)?.id;

  // Al abrir un chat o llegar un mensaje, se ve el último.
  useEffect(() => {
    const el = historial.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.id, ultimo]);

  const enviar = async () => {
    const texto = borrador.trim();
    if (!texto || enviando) return;
    if (await onEnviar(texto)) setBorrador("");
  };

  return (
    <section aria-label={`Chat con ${nombre}`} className="flex min-h-0 flex-1 flex-col rounded-lg border border-line bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onVolver}
            aria-label="Volver a los chats"
            className="grid size-11 flex-none place-items-center rounded-md text-ink hover:bg-sunken md:hidden"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span aria-hidden className="hidden size-11 flex-none place-items-center rounded-full bg-sunken font-bold text-ink-secondary md:grid">
            {inicialDe(chat)}
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className="truncate font-display text-[18px] font-bold">{nombre}</h2>
            <p className="truncate text-[13px] text-ink-secondary">
              {[chat.nombre && chat.telefono ? `+${chat.telefono}` : null, contexto].filter(Boolean).join(" · ") ||
                "Sin turno ni pedido abierto"}
            </p>
          </div>
        </div>

        <div data-tutorial="control-chat" className="flex flex-wrap items-center gap-3">
          {esVos ? (
            <>
              <EstadoAtencion esVos />
              <Button variant="secondary" disabled={trabajando} onClick={onDevolver}>
                Devolver al bot
              </Button>
            </>
          ) : (
            <>
              <EstadoAtencion esVos={false} />
              <Button disabled={trabajando} onClick={onTomar}>
                Tomar el control
              </Button>
            </>
          )}
        </div>
      </header>

      {esVos && (
        <p className="bg-primary-subtle px-4 py-2.5 text-sm font-semibold text-primary-active md:px-5">
          El bot está en pausa en este chat hasta que lo devuelvas.
        </p>
      )}

      <div ref={historial} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-page p-4 md:p-5">
        {mensajes.length === 0 && <p className="m-auto text-sm text-ink-secondary">Todavía no hay mensajes de texto.</p>}
        {mensajes.map((mensaje) => (
          <div key={mensaje.id} className={cn("max-w-[80%] rounded-lg px-3.5 py-2.5 text-[15px] leading-[1.45] md:max-w-[72%]", BURBUJA[mensaje.de])}>
            <span className={cn("block text-xs font-bold", mensaje.de === "cliente" ? "text-ink-secondary" : AUTOR[mensaje.de].color)}>
              {mensaje.de === "cliente" ? nombre : AUTOR[mensaje.de].texto}
            </span>
            <span className="break-words whitespace-pre-line">{mensaje.texto}</span>
            <span className="mt-1 block text-right text-[11px] text-ink-secondary">{horaDeMensaje(mensaje.createdAt)}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-line px-4 py-3 md:px-5">
        {esVos ? (
          <form
            className="flex items-end gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">Tu mensaje para {nombre}</span>
              <textarea
                rows={2}
                maxLength={LARGO_MAX_MENSAJE}
                value={borrador}
                onChange={(e) => setBorrador(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void enviar();
                  }
                }}
                placeholder="Escribí tu respuesta… sale por tu WhatsApp"
                className="w-full resize-none rounded-md border border-line-strong bg-card px-3 py-2.5 text-[15px] text-ink"
              />
            </label>
            <button
              type="submit"
              aria-label="Enviar mensaje"
              disabled={enviando || !borrador.trim()}
              className="grid size-12 flex-none place-items-center rounded-md bg-primary text-primary-on hover:bg-primary-hover disabled:opacity-40"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M22 2 11 13" />
                <path d="M22 2 15 22l-4-9-9-4 20-7z" />
              </svg>
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-secondary">El bot está contestando este chat. Para escribir vos, tomá el control.</p>
            <Button variant="secondary" disabled={trabajando} onClick={onTomar}>
              Tomar el control y escribir
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function EstadoAtencion({ esVos }: Readonly<{ esVos: boolean }>) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold",
        esVos ? "bg-primary-subtle text-primary-active" : "bg-accent-subtle text-success-text",
      )}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {esVos ? (
          <>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </>
        ) : (
          <>
            <rect x="4" y="8" width="16" height="12" rx="3" />
            <path d="M12 4v4M9 14h.01M15 14h.01" />
          </>
        )}
      </svg>
      {esVos ? "Contestás vos" : "Contesta el bot"}
    </span>
  );
}
