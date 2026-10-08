"use client";

import { useEffect, useState } from "react";
import { useLocal } from "@/app/contanos/useLocal";
import { ControlesLocal } from "@/components/onboarding/ControlesLocal";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import type { LocalPresencial } from "@/lib/local";

type AgentConLocal = { local: LocalPresencial | null };

function EditorLocal({ inicial }: Readonly<{ inicial: LocalPresencial | null }>) {
  const local = useLocal(inicial);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "error" } | null>(null);

  const guardar = () => {
    setGuardando(true);
    setAviso(null);
    apiFetch("/agents/me/local", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ local: local.payload() }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("no se pudo guardar");
        setAviso({ texto: "Listo: tu asistente ya usa estos datos del local.", tono: "ok" });
      })
      .catch(() => setAviso({ texto: "No pudimos guardar los datos del local. Revisalos y probá de nuevo.", tono: "error" }))
      .finally(() => setGuardando(false));
  };

  return (
    <>
      <ControlesLocal local={local} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={guardar} disabled={!local.valido || guardando}>
          {guardando ? "Guardando…" : "Guardar local"}
        </Button>
        {aviso && (
          <p
            role={aviso.tono === "ok" ? "status" : "alert"}
            className={aviso.tono === "ok" ? "text-[13.5px] text-success-text" : "text-[13.5px] text-danger-text"}
          >
            {aviso.texto}
          </p>
        )}
      </div>
    </>
  );
}

/**
 * El local a la calle del comercio: dirección, horarios y si se puede retirar.
 * El asistente lo usa desde el mensaje siguiente; lo que falta lo deriva.
 */
export function SeccionLocal() {
  // undefined = cargando; null dentro de `local` = nunca lo cargó.
  const [agent, setAgent] = useState<AgentConLocal | null | undefined>(undefined);

  useEffect(() => {
    apiFetch("/agents/me")
      .then(async (res) => {
        if (!res.ok) return null;
        // Sin agente la API contesta 200 con el cuerpo vacío.
        const texto = await res.text();
        return texto ? (JSON.parse(texto) as AgentConLocal) : null;
      })
      .then(setAgent)
      .catch(() => setAgent(null));
  }, []);

  return (
    <section aria-label="Tu local" className="rounded-lg border border-line bg-card p-5">
      <h2 className="mb-2 font-display text-[15px] font-bold text-ink">Tu local</h2>
      <p className="mb-4 text-[13.5px] leading-[1.6] text-ink-secondary">
        Con esto tu asistente contesta dónde queda, a qué hora abrís y si se puede pasar a retirar. Lo que no
        cargues no lo inventa: te pasa la consulta.
      </p>
      {agent === undefined && <p className="text-[13px] text-muted">Cargando…</p>}
      {agent === null && (
        <p className="text-[13px] text-danger-text">No pudimos cargar los datos de tu asistente. Recargá la página.</p>
      )}
      {agent && <EditorLocal inicial={agent.local} />}
    </section>
  );
}
