"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { buscarComoElAsistente, formatearCentavos, type ProductoEncontrado } from "@/lib/productos";

/**
 * "¿Qué encuentra mi asistente si le preguntan esto?": la misma búsqueda que
 * usa el bot con los clientes, para que el dueño vea si su catálogo responde
 * como espera (y qué descripción conviene mejorar si no).
 */
export function ProbarBusqueda() {
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<ProductoEncontrado[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState(false);

  const buscar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!consulta.trim()) return;
    setBuscando(true);
    setError(false);
    buscarComoElAsistente(consulta.trim())
      .then(setResultados)
      .catch(() => setError(true))
      .finally(() => setBuscando(false));
  };

  return (
    <section aria-label="Probar la búsqueda del asistente" className="rounded-lg border border-line bg-card p-5">
      <h2 className="font-display text-[18px] font-bold text-ink">Probá qué encuentra tu asistente</h2>
      <p className="mb-3 text-[13px] text-ink-secondary">
        Escribí como te escribiría un cliente: “¿tenés algo para regalar?”, “remera negra talle M”.
      </p>
      <form onSubmit={buscar} className="flex gap-2">
        <input
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder="¿Qué te preguntaría un cliente?"
          aria-label="Consulta de prueba"
          maxLength={200}
          className="w-full rounded-md border border-line bg-card px-3 py-2 text-[14.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]"
        />
        <Button type="submit" variant="secondary" disabled={buscando || !consulta.trim()}>
          {buscando ? "Buscando…" : "Probar"}
        </Button>
      </form>

      {error && <p className="mt-3 text-sm text-danger-text">No pudimos buscar. Probá de nuevo.</p>}
      {resultados && resultados.length === 0 && (
        <p className="mt-3 text-sm text-muted">No encontró nada: el asistente le diría que no lo tenés.</p>
      )}
      {resultados && resultados.length > 0 && (
        <ol aria-label="Resultados de la prueba" className="mt-3 flex flex-col gap-1.5">
          {resultados.map((producto) => (
            <li key={producto.productoId} className="rounded-md bg-sunken px-3 py-2 text-[13.5px]">
              <span className="font-semibold text-ink">{producto.nombre}</span>
              <span className="text-muted"> · {producto.codigo}</span>
              <span className="block text-[12.5px] text-ink-secondary">
                {producto.variantes
                  .map(
                    (variante) =>
                      `${variante.nombre ? `${variante.nombre}: ` : ""}${formatearCentavos(variante.precioCentavos)} (${variante.stock})`,
                  )
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
