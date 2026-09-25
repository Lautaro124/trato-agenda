"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { AgregarEvento, ListaEventos, PrecioParaTodos } from "@/components/onboarding/controles";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { useRequireSession } from "@/lib/session";
import {
  CATALOGO_EVENTOS,
  useTiposEvento,
  type TipoEvento,
  type TipoUsoId,
} from "@/app/contanos/useOnboarding";

type AgentGuardado = { tipoUso: string; tiposEvento: TipoEvento[] };

/** Orden y forma estables, para saber si lo que hay en pantalla difiere de lo guardado. */
function firma(tipos: TipoEvento[]): string {
  return JSON.stringify(
    tipos
      .map(({ nombre, duracionMin, precio }) => [nombre, duracionMin, precio ?? null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

export default function ReunionesPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const [agent, setAgent] = useState<AgentGuardado | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    apiFetch("/agents/me")
      .then(async (res) => {
        if (!res.ok) return null;
        // Sin agente la API contesta 200 con el cuerpo vacío.
        const texto = await res.text();
        return texto ? (JSON.parse(texto) as AgentGuardado) : null;
      })
      .then((guardado) => {
        if (!guardado) {
          router.replace("/contanos");
          return;
        }
        setAgent(guardado);
      })
      .catch(() => router.replace("/inicio"));
  }, [status, router]);

  if (status !== "authenticated" || !user || !agent) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando tus reuniones…</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="reuniones" user={user} />
      <Editor agent={agent} onGuardado={setAgent} />
      <MobileTabBar active="reuniones" />
    </div>
  );
}

function Editor({
  agent,
  onGuardado,
}: {
  agent: AgentGuardado;
  onGuardado: (agent: AgentGuardado) => void;
}) {
  // Un `tipoUso` retirado (p. ej. "comercio") ya no tiene sugerencias propias.
  const tipoUso = (agent.tipoUso in CATALOGO_EVENTOS ? agent.tipoUso : "otro") as TipoUsoId;
  const tipos = useTiposEvento(tipoUso, agent.tiposEvento);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "error" } | null>(null);

  const hayCambios = firma(tipos.seleccionados) !== firma(agent.tiposEvento);
  const puedeGuardar = hayCambios && tipos.seleccionados.length > 0 && !guardando;

  const guardar = () => {
    setGuardando(true);
    setAviso(null);
    apiFetch("/agents/me/tipos-evento", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiposEvento: tipos.seleccionados }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("no se pudo guardar");
        return res.json() as Promise<AgentGuardado>;
      })
      .then((guardado) => {
        onGuardado(guardado);
        setAviso({ texto: "Listo: tu asistente ya usa estas reuniones.", tono: "ok" });
      })
      .catch(() => setAviso({ texto: "No pudimos guardar los cambios. Probá de nuevo.", tono: "error" }))
      .finally(() => setGuardando(false));
  };

  return (
    <main className="flex-1 bg-page p-5 pb-24 md:pb-8">
      <div className="mx-auto flex max-w-[720px] flex-col gap-4">
        <div>
          <h1 className="mb-1 font-display text-[27px] leading-[1.15] font-bold tracking-[-0.025em] text-ink">
            Tus reuniones
          </h1>
          <p className="text-sm leading-[1.6] text-ink-secondary">
            Cambiá cuánto dura cada una y, si querés, cuánto cuesta. Tu asistente lo usa desde el próximo
            mensaje; los turnos ya agendados no cambian.
          </p>
        </div>

        <div className="rounded-lg border border-line bg-card p-5">
          <PrecioParaTodos ob={tipos} />
          <ListaEventos ob={tipos} />
          <div className="mt-4">
            <AgregarEvento ob={tipos} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={guardar} disabled={!puedeGuardar}>
            {guardando ? "Guardando…" : "Guardar cambios"}
          </Button>
          {tipos.seleccionados.length === 0 && (
            <span className="text-[12.5px] text-muted">Dejá al menos una reunión activa.</span>
          )}
          {aviso && (
            <p
              role="status"
              className={aviso.tono === "ok" ? "text-sm text-success-text" : "text-sm text-danger-text"}
            >
              {aviso.texto}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
