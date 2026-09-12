"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

type Mensaje = { role: "agent" | "user"; text: string };

const SALUDO_INICIAL: Mensaje = {
  role: "agent",
  text: "Hola. Decime qué querés agendar y lo coordino: “reunión con Ana el jueves a la tarde”, “movés mi turno del martes”, “qué tengo mañana”.",
};

const CHIPS = [
  "Reunión con Ana el jueves a la tarde",
  "¿Qué tengo mañana?",
  "Movés mi turno del martes 30 min más tarde",
];

/** Banco de pruebas del agente (variante 3a del canvas): habla de verdad con ConversationService. */
export function TestChat() {
  const [msgs, setMsgs] = useState<Mensaje[]>([SALUDO_INICIAL]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  async function send(raw?: string) {
    const text = (raw ?? draft).trim();
    if (!text || busy) return;

    setMsgs((prev) => [...prev, { role: "user", text }]);
    setDraft("");
    setBusy(true);

    try {
      const res = await apiFetch("/conversation/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const reply = res.ok
        ? ((await res.json()) as { reply: string }).reply
        : "Perdón, tuve un problema para responderte. Probá de nuevo en un rato.";
      setMsgs((prev) => [...prev, { role: "agent", text: reply }]);
    } catch {
      setMsgs((prev) => [
        ...prev,
        { role: "agent", text: "Perdón, tuve un problema para responderte. Probá de nuevo en un rato." },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }

  async function reset() {
    setMsgs([SALUDO_INICIAL]);
    setDraft("");
    setBusy(false);
    await apiFetch("/conversation/test", { method: "DELETE" }).catch(() => {});
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-card shadow-md">
      <div className="flex flex-none items-center gap-3 border-b border-line p-4">
        <span className="grid size-[34px] flex-none place-items-center rounded-full bg-primary font-display text-sm font-bold text-primary-on">
          T
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">Agente de Trato</div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <span className="size-1.5 rounded-full bg-success" />
            En línea · modo prueba
          </div>
        </div>
        <button
          type="button"
          onClick={() => void reset()}
          className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-secondary hover:bg-sunken"
        >
          Reiniciar
        </button>
      </div>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto bg-page p-4">
        {msgs.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "agent"
                ? "max-w-[86%] self-start rounded-tr-2xl rounded-br-2xl rounded-bl-md border border-line bg-card px-3.5 py-2.5 text-[13.5px] leading-[1.55] whitespace-pre-wrap text-ink shadow-sm"
                : "max-w-[86%] self-end rounded-tl-2xl rounded-bl-2xl rounded-br-md border border-[#C9E9D6] bg-accent-subtle px-3.5 py-2.5 text-[13.5px] leading-[1.55] whitespace-pre-wrap text-ink"
            }
          >
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-1.5 self-start rounded-tr-2xl rounded-br-2xl rounded-bl-md border border-line bg-card px-3.5 py-3 shadow-sm">
            <span className="size-1.5 animate-pulse rounded-full bg-muted" />
            <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
          </div>
        )}
      </div>

      <div className="flex flex-none flex-col gap-2.5 border-t border-line p-4">
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={busy}
              onClick={() => void send(chip)}
              className="cursor-pointer rounded-full border border-line bg-sunken px-2.5 py-1 text-[11.5px] text-ink hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
            >
              {chip}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Escribile al agente…"
            className="max-h-24 min-h-[42px] flex-1 resize-none rounded-md border border-line bg-card px-3.5 py-2.5 text-[13.5px] leading-[1.5] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]"
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void send()}
            aria-label="Enviar"
            className="grid size-[42px] flex-none cursor-pointer place-items-center rounded-md bg-primary text-primary-on hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-[var(--color-primitive-neutral-200)] disabled:text-muted"
          >
            →
          </button>
        </div>
        <p className="text-[11px] leading-[1.5] text-muted">
          Esto simula la conversación de WhatsApp. Enter envía; Shift + Enter hace salto de línea.
        </p>
      </div>
    </div>
  );
}
