"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ETIQUETAS_COLUMNA, valorDeFila, type FilaPlanilla } from "@/lib/planilla";
import type { ErrorDeFila } from "@/lib/productos";

const NUMERICAS = new Set(["precio", "stock", "stock_minimo"]);

export type Cambios = Array<{ fila: number; columna: string; valor: string }>;

type Props = {
  filas: FilaPlanilla[];
  errores: ErrorDeFila[];
  /** Guarda los valores, vuelve a revisar la planilla y devuelve el mensaje si algo falló. */
  onGuardar: (cambios: Cambios) => Promise<string | null>;
  onCerrar: () => void;
  /** Los nombres de columna del archivo que subió (la plantilla o el export de Mercado Libre). */
  etiquetas?: Record<string, string>;
};

/**
 * Completar a mano lo que le falta a la planilla: una tarjeta por fila con un
 * campo por cada dato con problema. Los valores se aplican en memoria sobre las
 * filas leídas; el archivo del usuario no se toca.
 */
export function CompletarFilasModal({ filas, errores, onGuardar, onCerrar, etiquetas = ETIQUETAS_COLUMNA }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  // Sólo los errores que se arreglan con un campo; el resto lo explica el resumen.
  const editables = errores.filter((e) => e.columna);
  const porFila = new Map<number, ErrorDeFila[]>();
  for (const e of editables) porFila.set(e.fila, [...(porFila.get(e.fila) ?? []), e]);

  const clave = (fila: number, columna: string) => `${fila}:${columna}`;
  const cambios: Cambios = editables
    .map((e) => ({ fila: e.fila, columna: e.columna as string, valor: (valores[clave(e.fila, e.columna as string)] ?? "").trim() }))
    .filter((c) => c.valor !== "");

  const guardar = () => {
    if (guardando || cambios.length === 0) return;
    setGuardando(true);
    setFallo(null);
    onGuardar(cambios)
      .then((mensaje) => setFallo(mensaje))
      .catch(() => setFallo("No pudimos revisar los cambios. Probá de nuevo."))
      .finally(() => setGuardando(false));
  };

  const alTeclado = (e: KeyboardEvent) => {
    if (e.key === "Escape") onCerrar();
  };

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/35 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
      onKeyDown={alTeclado}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="completar-titulo"
        tabIndex={-1}
        className="flex max-h-[92dvh] w-full flex-col rounded-t-[20px] bg-card shadow-lg outline-none sm:max-w-xl sm:rounded-lg"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <h2 id="completar-titulo" className="font-display text-[20px] font-bold text-ink">
              Completá lo que falta
            </h2>
            <p className="text-[13.5px] text-ink-secondary">
              {porFila.size === 1 ? "1 producto necesita" : `${porFila.size} productos necesitan`} un dato. Escribilo
              acá y seguimos.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onCerrar}>
            Cerrar
          </Button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          {[...porFila.entries()].map(([fila, lista]) => {
            const datos = filas[fila - 1];
            const titulo = valorDeFila(datos, "nombre") || valorDeFila(datos, "codigo") || "Sin nombre";
            const codigo = valorDeFila(datos, "codigo");
            return (
              <section key={fila} aria-label={`Fila ${fila}`} className="rounded-md border border-line bg-page p-3">
                <p className="mb-2 text-[13px] text-ink-secondary">
                  <span className="mr-2 rounded-sm bg-sunken px-1.5 py-0.5 text-[12px] font-semibold text-ink">
                    Fila {fila + 1}
                  </span>
                  <strong className="text-ink">{titulo}</strong>
                  {codigo && codigo !== titulo ? ` · ${codigo}` : ""}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {lista.map((e) => {
                    const columna = e.columna as string;
                    const id = `completar-${fila}-${columna}`;
                    const valor = valores[clave(fila, columna)] ?? "";
                    const cambiar = (nuevo: string) => setValores((v) => ({ ...v, [clave(fila, columna)]: nuevo }));
                    return (
                      <div key={columna} className="flex flex-col gap-1">
                        <label htmlFor={id} className="text-[13px] font-semibold text-ink">
                          {etiquetas[columna] ?? columna}
                        </label>
                        {columna === "disponible" ? (
                          <select
                            id={id}
                            value={valor}
                            onChange={(ev) => cambiar(ev.target.value)}
                            aria-describedby={`${id}-error`}
                            className="rounded-md border border-danger bg-card px-3 py-2 text-[15px] text-ink"
                          >
                            <option value="">Elegí…</option>
                            <option value="si">Sí</option>
                            <option value="no">No</option>
                          </select>
                        ) : (
                          <input
                            id={id}
                            value={valor}
                            onChange={(ev) => cambiar(ev.target.value)}
                            inputMode={NUMERICAS.has(columna) ? "decimal" : "text"}
                            aria-invalid
                            aria-describedby={`${id}-error`}
                            className="rounded-md border border-danger bg-card px-3 py-2 text-[15px] text-ink"
                          />
                        )}
                        <p id={`${id}-error`} className="text-[12.5px] text-danger-text">
                          ⚠ {e.mensaje}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {fallo && (
            <p role="alert" className="text-sm text-danger-text">
              {fallo}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={guardar} disabled={cambios.length === 0 || guardando}>
              {guardando ? "Revisando…" : "Guardar y revisar"}
            </Button>
            <Button variant="secondary" onClick={onCerrar}>
              Ahora no
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
