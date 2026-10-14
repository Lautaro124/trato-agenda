"use client";

import { useEffect, useState } from "react";
import { useLocal } from "@/app/contanos/useLocal";
import { ControlesLocal } from "@/components/onboarding/ControlesLocal";
import { ControlesLugar } from "@/components/onboarding/ControlesLugar";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import type { LocalPresencial } from "@/lib/local";

type AgentConLocal = { local: LocalPresencial | null };

function EditorLocal({ inicial, paraAgenda }: Readonly<{ inicial: LocalPresencial | null; paraAgenda: boolean }>) {
  const local = useLocal(inicial, { paraAgenda });
  const textoGuardar = paraAgenda ? "Guardar lugar" : "Guardar local";
  const avisos = paraAgenda
    ? { ok: "Listo: tu asistente ya usa dónde atendés.", error: "No pudimos guardar dónde atendés. Revisalo y probá de nuevo." }
    : {
        ok: "Listo: tu asistente ya usa estos datos del local.",
        error: "No pudimos guardar los datos del local. Revisalos y probá de nuevo.",
      };
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
        setAviso({ texto: avisos.ok, tono: "ok" });
      })
      .catch(() => setAviso({ texto: avisos.error, tono: "error" }))
      .finally(() => setGuardando(false));
  };

  return (
    <>
      {paraAgenda ? <ControlesLugar lugar={local} /> : <ControlesLocal local={local} />}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={guardar} disabled={!local.valido || guardando}>
          {guardando ? "Guardando…" : textoGuardar}
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

const TEXTOS = {
  ventas: {
    titulo: "Tu local",
    bajada:
      "Con esto tu asistente contesta dónde queda, a qué hora abrís y si se puede pasar a retirar. Lo que no cargues no lo inventa: te pasa la consulta.",
  },
  agenda: {
    titulo: "Dónde atendés",
    bajada:
      "Con esto tu asistente contesta dónde es el turno y se lo repite al cliente cuando se lo agenda. Si atendés en tu casa, la dirección se la pasa sólo a quien ya tiene turno.",
  },
} as const;

/**
 * Dónde se atiende. Ventas: el local a la calle del comercio (dirección,
 * horarios y si se puede retirar). Turnos (LAU-17): local, casa o sin lugar
 * fijo, con su dirección. El asistente lo usa desde el mensaje siguiente; lo
 * que falta lo deriva.
 */
export function SeccionLocal({ tipoAsistente }: Readonly<{ tipoAsistente: "agenda" | "ventas" }>) {
  const textos = TEXTOS[tipoAsistente];
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
    <section aria-label={textos.titulo} className="rounded-lg border border-line bg-card p-5">
      <h2 className="mb-2 font-display text-[15px] font-bold text-ink">{textos.titulo}</h2>
      <p className="mb-4 text-[13.5px] leading-[1.6] text-ink-secondary">{textos.bajada}</p>
      {agent === undefined && <p className="text-[13px] text-muted">Cargando…</p>}
      {agent === null && (
        <p className="text-[13px] text-danger-text">No pudimos cargar los datos de tu asistente. Recargá la página.</p>
      )}
      {agent && <EditorLocal inicial={agent.local} paraAgenda={tipoAsistente === "agenda"} />}
    </section>
  );
}
