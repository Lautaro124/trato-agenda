"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { EtiquetaVenta } from "@/components/chats/EtiquetaVenta";
import { Button } from "@/components/ui/Button";
import {
  contextoDe,
  etiquetaDeVenta,
  horaDeMensaje,
  inicialDe,
  LARGO_MAX_MENSAJE,
  nombreDe,
  type DetalleChat,
  type MensajeChat,
} from "@/lib/chats";
import { cn } from "@/lib/cn";
import { urlImagenEnviada, type ImagenEnviada } from "@/lib/imagenes";

/** Una foto que el bot le mandó al cliente, con su pie. Si ya no existe (producto borrado), queda sólo el pie. */
function FotoEnviada({ imagen }: { imagen: ImagenEnviada }) {
  const [rota, setRota] = useState(false);
  return (
    <span className="flex min-w-0 flex-col gap-1">
      {rota ? (
        <span className="flex aspect-square items-center justify-center rounded-md bg-sunken text-xs text-ink-secondary">
          Foto no disponible
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- viene de la API con la cookie de sesión; el optimizador de Next no la tiene
        <img
          src={urlImagenEnviada(imagen)}
          alt={imagen.leyenda ? `Foto enviada: ${imagen.leyenda}` : "Foto enviada"}
          loading="lazy"
          onError={() => setRota(true)}
          className="aspect-square w-full rounded-md bg-sunken object-cover"
        />
      )}
      {imagen.leyenda && <span className="text-xs break-words whitespace-pre-line text-ink-secondary">{imagen.leyenda}</span>}
    </span>
  );
}

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
 * Un chat: arriba quién contesta (y, si sos vos, el botón para devolverlo al
 * bot); abajo, tomar el control o escribir. El encabezado va en una línea para
 * dejarle la altura a los mensajes.
 */
export function Conversacion({
  detalle,
  trabajando,
  enviando,
  onVolver,
  onTomar,
  onDevolver,
  onEnviar,
  panel,
}: Readonly<{
  detalle: DetalleChat;
  trabajando: boolean;
  enviando: boolean;
  /** Debajo de 1024px, donde lista y chat se ven de a uno: vuelve a la lista. */
  onVolver: () => void;
  onTomar: () => void;
  onDevolver: () => void;
  /** Devuelve true si salió, para limpiar lo escrito. */
  onEnviar: (texto: string) => Promise<boolean>;
  /** Los datos de la venta: en pantallas angostas se pliegan arriba de los mensajes. */
  panel?: ReactNode;
}>) {
  const { chat, mensajes } = detalle;
  const nombre = nombreDe(chat);
  const contexto = contextoDe(chat);
  const etiqueta = etiquetaDeVenta(chat);
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
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-3 py-2 md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onVolver}
            aria-label="Volver a los chats"
            className={cn(
              "grid size-11 flex-none place-items-center rounded-md text-ink hover:bg-sunken",
              // Mismo corte (`md`) que la grilla de BandejaChats.
              "md:hidden",
            )}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span aria-hidden className={cn("hidden size-9 flex-none place-items-center rounded-full bg-sunken text-sm font-bold text-ink-secondary", "md:grid")}>
            {inicialDe(chat)}
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className="truncate font-display text-[16px] font-bold">{nombre}</h2>
            <p className="flex min-w-0 items-center gap-2 truncate text-[12.5px] text-ink-secondary">
              {etiqueta && <EtiquetaVenta etiqueta={etiqueta} />}
              {[chat.nombre && chat.telefono ? `+${chat.telefono}` : null, contexto].filter(Boolean).join(" · ") ||
                "Sin turno ni pedido abierto"}
            </p>
          </div>
        </div>

        <div data-tutorial="control-chat" className="flex flex-wrap items-center gap-2.5">
          {/* Con el dueño al mando, "Devolver al bot" ocupa el lugar de la etiqueta "Contesta el bot". */}
          {esVos ? (
            <Button variant="secondary" size="sm" disabled={trabajando} onClick={onDevolver}>
              Devolver al bot
            </Button>
          ) : (
            <EstadoAtencion />
          )}
        </div>
      </header>

      {esVos && (
        <p className="bg-primary-subtle px-3 py-2 text-[13px] font-semibold text-primary-active md:px-4">
          El bot está en pausa en este chat hasta que lo devuelvas.
        </p>
      )}

      {panel && (
        <details className="group border-b border-line md:hidden">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-bold text-ink md:px-5">
            Datos de la venta
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-ink-secondary transition-transform group-open:rotate-180">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <div className="max-h-[55dvh] overflow-y-auto px-4 pb-4 md:px-5">{panel}</div>
        </details>
      )}

      <div ref={historial} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-page p-3 md:px-5 md:py-4">
        {mensajes.length === 0 && <p className="m-auto text-sm text-ink-secondary">Todavía no hay mensajes de texto.</p>}
        {mensajes.map((mensaje) => (
          <div key={mensaje.id} className={cn("max-w-[80%] rounded-lg px-3.5 py-2.5 text-[15px] leading-[1.45] md:max-w-[72%]", BURBUJA[mensaje.de])}>
            <span className={cn("block text-xs font-bold", mensaje.de === "cliente" ? "text-ink-secondary" : AUTOR[mensaje.de].color)}>
              {mensaje.de === "cliente" ? nombre : AUTOR[mensaje.de].texto}
            </span>
            {mensaje.imagenes && mensaje.imagenes.length > 0 && (
              <span className="mt-1 mb-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {mensaje.imagenes.map((imagen, indice) => (
                  <FotoEnviada key={indice} imagen={imagen} />
                ))}
              </span>
            )}
            {mensaje.texto && <span className="break-words whitespace-pre-line">{mensaje.texto}</span>}
            <span className="mt-1 block text-right text-[11px] text-ink-secondary">{horaDeMensaje(mensaje.createdAt)}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-line px-3 py-2.5 md:px-4">
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
            <p className="text-[13px] text-ink-secondary">El bot está contestando este chat.</p>
            <Button size="sm" disabled={trabajando} onClick={onTomar}>
              Tomar el control y escribir
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function EstadoAtencion() {
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-subtle px-3 text-[13px] font-bold text-success-text">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="4" y="8" width="16" height="12" rx="3" />
        <path d="M12 4v4M9 14h.01M15 14h.01" />
      </svg>
      Contesta el bot
    </span>
  );
}
