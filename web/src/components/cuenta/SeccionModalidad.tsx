"use client";

import { useEffect, useState } from "react";
import { CampoQueHace } from "@/components/onboarding/CampoQueHace";
import { ElegirModalidadVenta } from "@/components/onboarding/ElegirModalidadVenta";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { useModalidadVenta, type ModalidadVenta } from "@/lib/modalidad-venta";

type ModalidadGuardada = { modalidadVenta: ModalidadVenta; queHace: string | null };

const comparable = (texto: string | null) => (texto ?? "").replace(/\s+/g, " ").trim();

function Editor({ inicial }: Readonly<{ inicial: ModalidadGuardada }>) {
  const modalidad = useModalidadVenta(inicial);
  const [guardado, setGuardado] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "error" } | null>(null);

  const cambiaModalidad = modalidad.modalidad !== guardado.modalidadVenta;
  const hayCambios = cambiaModalidad || (modalidad.aPedido && comparable(modalidad.queHace) !== comparable(guardado.queHace));

  const deshacer = () => {
    modalidad.setModalidad(guardado.modalidadVenta);
    modalidad.setQueHace(guardado.queHace ?? "");
    setAviso(null);
  };

  const guardar = () => {
    setGuardando(true);
    setAviso(null);
    apiFetch("/agents/me/modalidad", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(modalidad.payload()),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("no se pudo guardar");
        const agent = (await res.json()) as ModalidadGuardada;
        setGuardado({ modalidadVenta: agent.modalidadVenta, queHace: agent.queHace });
        setAviso({ texto: "Listo: tu asistente ya vende así desde el próximo mensaje.", tono: "ok" });
      })
      .catch(() => setAviso({ texto: "No pudimos guardar cómo vendés. Probá de nuevo.", tono: "error" }))
      .finally(() => setGuardando(false));
  };

  return (
    <>
      <ElegirModalidadVenta valor={modalidad.modalidad} onCambio={modalidad.setModalidad} />
      {modalidad.aPedido && (
        <div className="mt-5">
          <CampoQueHace modalidad={modalidad} conAyudas={false} />
        </div>
      )}
      {cambiaModalidad && (
        <p role="status" className="mt-4 rounded-md bg-warning-subtle p-3 text-[13.5px] leading-[1.5] text-warning-text">
          Los pedidos que ya están en curso terminan como empezaron. El cambio vale para lo que te escriban desde ahora.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={guardar} disabled={!hayCambios || !modalidad.valido || guardando}>
          {guardando ? "Guardando…" : "Guardar cambios"}
        </Button>
        {hayCambios && (
          <Button variant="ghost" onClick={deshacer} disabled={guardando}>
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
 * Cómo vende el comercio (LAU-21): con stock o a pedido, y qué hace cuando
 * vende a pedido. El asistente lo lee en cada mensaje, así que el cambio vale
 * desde la charla siguiente.
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
      <p className="mb-4 text-[13.5px] leading-[1.6] text-ink-secondary">
        Define si el asistente cierra la venta en el momento o si te pasa el pedido para que lo cotices.
      </p>
      {agent === undefined && <p className="text-[13px] text-muted">Cargando…</p>}
      {agent === null && (
        <p className="text-[13px] text-danger-text">No pudimos cargar los datos de tu asistente. Recargá la página.</p>
      )}
      {agent && <Editor inicial={{ modalidadVenta: agent.modalidadVenta, queHace: agent.queHace }} />}
    </section>
  );
}
