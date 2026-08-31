"use client";

import type { LinkState } from "@/app/vincular/page";

const STATES: Array<{ id: LinkState; label: string }> = [
  { id: "active", label: "Activo" },
  { id: "connecting", label: "Conectando" },
  { id: "connected", label: "Conectado" },
  { id: "expired", label: "Vencido" },
  { id: "error", label: "Error" },
];

/**
 * Control sólo de demo: sin backend no hay forma de llegar a los estados de 1g.
 * Borrar este componente cuando exista la vinculación real.
 */
export function DemoStateSwitcher({
  state,
  onChange,
  onRegenerate,
}: {
  state: LinkState;
  onChange: (next: LinkState) => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-wrap items-center gap-1 rounded-full border border-line bg-card/95 px-2 py-1.5 shadow-md backdrop-blur">
      <span className="px-1 font-mono text-[10px] tracking-wide text-muted uppercase">
        demo
      </span>
      {STATES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => (id === "active" ? onRegenerate() : onChange(id))}
          className={`cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            state === id
              ? "bg-primary text-primary-on"
              : "text-ink-secondary hover:bg-sunken"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
