"use client";

import { useEffect, useState } from "react";
import { CampoQueHace } from "@/components/onboarding/CampoQueHace";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { useModalidadVenta, type ModalidadVenta } from "@/lib/modalidad-venta";

type ModalidadGuardada = { modalidadVenta: ModalidadVenta; queHace: string | null };

const comparable = (texto: string | null) => (texto ?? "").replace(/\s+/g, " ").trim();

const EXPLICACION: Record<ModalidadVenta, { titulo: string; detalle: string }> = {
  stock: {
    titulo: "Vendés con stock",
    detalle: "El asistente dice precio y stock, reserva la mercadería y manda el link de pago.",
  },
  pedido: {
    titulo: "Vendés a pedido",
    detalle: "El asistente toma la solicitud con el detalle y te la pasa para que la cotices.",
  },
};

/** "Qué hacés" de una cuenta a pedido: lo único de esta sección que se edita. */
function EditorQueHace({ inicial }: Readonly<{ inicial: ModalidadGuardada }>) {
  const modalidad = useModalidadVenta(inicial);
  const [guardado, setGuardado] = useState(inicial.queHace);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "error" } | null>(null);

  const hayCambios = comparable(modalidad.queHace) !== comparable(guardado);

  const guardar = () => {
    setGuardando(true);
    setAviso(null);
    apiFetch("/agents/me/modalidad", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // La modalidad viaja igual (la API exige que sea la misma): sólo cambia el texto.
      body: JSON.stringify(modalidad.payload()),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("no se pudo guardar");
        const agent = (await res.json()) as ModalidadGuardada;
        setGuardado(agent.queHace);
        setAviso({ texto: "Listo: tu asistente lo usa desde el próximo mensaje.", tono: "ok" });
      })
      .catch(() => setAviso({ texto: "No pudimos guardar qué hacés. Probá de nuevo.", tono: "error" }))
      .finally(() => setGuardando(false));
  };

  return (
    <>
      <div className="mt-5">
        <CampoQueHace modalidad={modalidad} conAyudas={false} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={guardar} disabled={!hayCambios || !modalidad.valido || guardando}>
          {guardando ? "Guardando…" : "Guardar cambios"}
        </Button>
        {hayCambios && (
          <Button
            variant="ghost"
            onClick={() => {
              modalidad.setQueHace(guardado ?? "");
              setAviso(null);
            }}
            disabled={guardando}
          >
            Deshacer
          </Button>
        )}
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
 * Cómo vende el comercio (LAU-21): con stock o a pedido. Se elige en el
 * registro y no se cambia (define qué formulario de productos tiene la
 * cuenta), así que acá sólo se muestra. A pedido se puede editar "Qué hacés".
 */
export function SeccionModalidad() {
  // undefined = cargando.
  const [agent, setAgent] = useState<ModalidadGuardada | null | undefined>(undefined);

  useEffect(() => {
    apiFetch("/agents/me")
      .then(async (res) => {
        if (!res.ok) return null;
        // Sin agente la API contesta 200 con el cuerpo vacío.
        const texto = await res.text();
        return texto ? (JSON.parse(texto) as ModalidadGuardada) : null;
      })
      .then(setAgent)
      .catch(() => setAgent(null));
  }, []);

  return (
    <section aria-label="Cómo vendés" className="rounded-lg border border-line bg-card p-5">
      <h2 className="mb-2 font-display text-[15px] font-bold text-ink">Cómo vendés</h2>
      {agent === undefined && <p className="text-[13px] text-muted">Cargando…</p>}
      {agent === null && (
        <p className="text-[13px] text-danger-text">No pudimos cargar los datos de tu asistente. Recargá la página.</p>
      )}
      {agent && (
        <>
          <div className="rounded-md bg-sunken px-4 py-3">
            <p className="text-[15px] font-bold text-ink">{EXPLICACION[agent.modalidadVenta].titulo}</p>
            <p className="mt-0.5 text-[13.5px] leading-[1.55] text-ink-secondary">
              {EXPLICACION[agent.modalidadVenta].detalle}
            </p>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">Se eligió al crear tu asistente y no se puede cambiar.</p>
          {agent.modalidadVenta === "pedido" && (
            <EditorQueHace inicial={{ modalidadVenta: agent.modalidadVenta, queHace: agent.queHace }} />
          )}
        </>
      )}
    </section>
  );
}
