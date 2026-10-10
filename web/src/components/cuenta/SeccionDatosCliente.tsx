"use client";

import { useEffect, useState } from "react";
import { EditorDatosCliente } from "@/components/onboarding/DatosCliente";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { firmaDatosCliente, payloadDatosCliente, useDatosCliente, type CampoCliente } from "@/lib/datos-cliente";

type Guardado = { haceEnvios: boolean; datosCliente: CampoCliente[] };

/**
 * Qué datos le pide el asistente de ventas al cliente (envíos, DNI, datos
 * propios): lo mismo que el paso opcional de /contanos, editable después.
 */
export function SeccionDatosCliente() {
  const [guardado, setGuardado] = useState<Guardado | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiFetch("/agents/me")
      .then(async (res) => {
        if (!res.ok) throw new Error("no se pudo leer");
        // Sin agente la API contesta 200 con el cuerpo vacío.
        const texto = await res.text();
        return texto ? (JSON.parse(texto) as Guardado) : null;
      })
      .then((agent) => {
        if (agent) setGuardado({ haceEnvios: agent.haceEnvios ?? false, datosCliente: agent.datosCliente ?? [] });
      })
      .catch(() => setError(true));
  }, []);

  return (
    <section aria-label="Datos que pide tu asistente" className="rounded-lg border border-line bg-card p-5">
      <h2 className="mb-2 font-display text-[15px] font-bold text-ink">Datos que pide tu asistente</h2>
      <p className="mb-4 text-[13.5px] leading-[1.6] text-ink-secondary">
        Lo que tu asistente le pregunta al cliente antes de cerrar un pedido, además del nombre. Lo vas a ver en
        cada venta, en Ventas.
      </p>
      {guardado ? (
        // Se monta con lo guardado: el editor toma su estado inicial una sola vez.
        <Editor guardado={guardado} onGuardado={setGuardado} />
      ) : (
        <p className="text-[13px] text-muted">{error ? "No pudimos cargar esta sección." : "Cargando…"}</p>
      )}
    </section>
  );
}

function Editor({ guardado, onGuardado }: { guardado: Guardado; onGuardado: (guardado: Guardado) => void }) {
  const datos = useDatosCliente(guardado);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "error" } | null>(null);

  const hayCambios = firmaDatosCliente(datos.payload()) !== firmaDatosCliente(payloadDatosCliente(guardado));

  const guardar = () => {
    setGuardando(true);
    setAviso(null);
    apiFetch("/agents/me/datos-cliente", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos.payload()),
    })
      .then((res) => {
        if (!res.ok) throw new Error("no se pudo guardar");
        return res.json() as Promise<Guardado>;
      })
      .then((agent) => {
        onGuardado({ haceEnvios: agent.haceEnvios, datosCliente: agent.datosCliente });
        setAviso({ texto: "Listo: tu asistente ya pide estos datos.", tono: "ok" });
      })
      .catch(() => setAviso({ texto: "No pudimos guardar los cambios. Probá de nuevo.", tono: "error" }))
      .finally(() => setGuardando(false));
  };

  return (
    <>
      <EditorDatosCliente datos={datos} />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="md" onClick={guardar} disabled={!hayCambios || guardando}>
          {guardando ? "Guardando…" : "Guardar datos"}
        </Button>
        {aviso && (
          <p role="status" className={aviso.tono === "ok" ? "text-[13px] text-success-text" : "text-[13px] text-danger-text"}>
            {aviso.texto}
          </p>
        )}
      </div>
    </>
  );
}
