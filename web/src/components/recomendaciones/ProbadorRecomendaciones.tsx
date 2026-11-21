"use client";

import { useId, useState } from "react";
import { INPUT } from "@/components/productos/EditorProducto";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { probarRecomendacion, type ResultadoRecomendacion } from "@/lib/recomendaciones";
import { ErrorDeApi } from "@/lib/productos";

const ESTADO: Record<ResultadoRecomendacion["estado"], { texto: string; tono: "success" | "warning" | "neutral" | "info" }> = {
  aplicada: { texto: "Se aplicó", tono: "success" },
  falta_dato: { texto: "Pide un dato antes", tono: "warning" },
  no_cumple: { texto: "No cumple el requisito", tono: "neutral" },
  ninguna: { texto: "No aplicó ninguna", tono: "neutral" },
};

function Resultado({ r }: Readonly<{ r: ResultadoRecomendacion }>) {
  const disponibles = r.candidatos.filter((c) => c.disponible);
  const sinStock = r.candidatos.filter((c) => !c.disponible);
  const usadas = disponibles.flatMap((c) => c.propiedades.map((p) => ({ donde: c.nombre, ...p })));
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ESTADO[r.estado].tono}>{ESTADO[r.estado].texto}</Badge>
        {r.regla && <span className="text-[14px] font-bold text-ink">{r.regla.nombre}</span>}
        {r.regla && !r.regla.activa && <Badge tone="info">Pausada: en WhatsApp todavía no se usa</Badge>}
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-[14px] md:grid-cols-2">
        {r.requisito && (
          <div>
            <dt className="font-semibold text-ink-secondary">Dato «{r.requisito.dato}»</dt>
            <dd className="text-ink">
              {r.requisito.estado === "cumple" ? "Lo cumple" : r.requisito.estado === "no_cumple" ? "No lo cumple" : "Falta: el asistente lo pregunta"}
            </dd>
          </div>
        )}
        {disponibles.length > 0 && (
          <div>
            <dt className="font-semibold text-ink-secondary">Puede recomendar</dt>
            <dd className="text-ink">{disponibles.map((c) => c.nombre).join(" · ")}</dd>
          </div>
        )}
        {sinStock.length > 0 && (
          <div>
            <dt className="font-semibold text-ink-secondary">No recomienda (sin stock)</dt>
            <dd className="text-ink">{sinStock.map((c) => c.nombre).join(" · ")}</dd>
          </div>
        )}
        {r.nota && (
          <div>
            <dt className="font-semibold text-ink-secondary">Excepción del producto</dt>
            <dd className="text-ink">{r.nota}</dd>
          </div>
        )}
      </dl>
      {usadas.length > 0 && (
        <div className="flex flex-col gap-1 text-[14px]">
          <span className="font-semibold text-ink-secondary">Propiedades que puede usar</span>
          <ul className="flex flex-col gap-1">
            {usadas.map((p) => (
              <li key={`${p.donde}-${p.nombre}`} className="text-ink">
                <span className="text-ink-secondary">{p.donde} ›</span> <strong>{p.nombre}:</strong> {p.valor}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.evaluadas.filter((e) => !e.aplica).length > 0 && (
        <p className="text-[13.5px] text-ink-secondary">
          Otras evaluadas: {r.evaluadas.filter((e) => !e.aplica).map((e) => `${e.nombre} (${e.motivo})`).join(" · ")}
        </p>
      )}
    </div>
  );
}

type Prueba = { mensaje: string; reply: string; recomendaciones: ResultadoRecomendacion[] };

/**
 * El dueño escribe como un cliente y ve la respuesta del mismo asistente de
 * WhatsApp con lo que resolvió consultar_recomendacion. Usa lo guardado; las
 * reglas pausadas también cuentan acá.
 */
export function ProbadorRecomendaciones({ hayCambios }: Readonly<{ hayCambios: boolean }>) {
  const id = useId();
  const [mensaje, setMensaje] = useState("");
  const [prueba, setPrueba] = useState<Prueba | null>(null);
  const [probando, setProbando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const probar = async () => {
    const texto = mensaje.trim();
    if (!texto) return;
    setProbando(true);
    setError(null);
    try {
      const respuesta = await probarRecomendacion(texto);
      setPrueba({ mensaje: texto, ...respuesta });
    } catch (err) {
      setError(err instanceof ErrorDeApi ? err.message : "No pudimos probar el mensaje. Probá de nuevo.");
    } finally {
      setProbando(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-titulo`} className="flex flex-col gap-4 rounded-lg border border-line bg-card p-5 md:p-6">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-titulo`} className="font-display text-[19px] font-bold text-ink">
          Probar antes de activar
        </h2>
        <p className="text-[14px] leading-[1.5] text-ink-secondary">
          Escribí un mensaje como lo mandaría un cliente. Ves qué regla se activa y qué respondería el asistente. No se
          envía nada por WhatsApp.
        </p>
        {hayCambios && (
          <p role="status" className="rounded-md bg-warning-subtle px-3.5 py-2.5 text-[14px] text-warning-text">
            Tenés cambios sin guardar: la prueba usa lo último que guardaste.
          </p>
        )}
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void probar();
        }}
      >
        <label htmlFor={`${id}-mensaje`} className="sr-only">
          Mensaje del cliente
        </label>
        <input
          id={`${id}-mensaje`}
          value={mensaje}
          maxLength={500}
          onChange={(e) => setMensaje(e.target.value)}
          placeholder="Necesito soportes que se disuelvan en agua"
          className={`${INPUT} min-w-0 flex-1`}
        />
        <Button type="submit" disabled={probando || !mensaje.trim()}>
          {probando ? "Probando…" : "Probar"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="rounded-md bg-danger-subtle px-3.5 py-2.5 text-[14px] text-danger-text">
          {error}
        </p>
      )}
      {prueba && (
        <div className="flex flex-col gap-3" aria-live="polite">
          <div className="flex flex-col gap-2.5 rounded-md bg-sunken p-4">
            <p className="max-w-[85%] self-end rounded-[16px_16px_4px_16px] bg-primary-subtle px-3.5 py-2.5 text-[14px] text-ink">
              {prueba.mensaje}
            </p>
            <p className="max-w-[85%] self-start rounded-[16px_16px_16px_4px] bg-card px-3.5 py-2.5 text-[14px] whitespace-pre-line text-ink shadow-sm">
              {prueba.reply}
            </p>
          </div>
          {prueba.recomendaciones.length === 0 ? (
            <p className="text-[14px] text-ink-secondary">El asistente no consultó ninguna recomendación para este mensaje.</p>
          ) : (
            prueba.recomendaciones.map((r, indice) => <Resultado key={indice} r={r} />)
          )}
        </div>
      )}
    </section>
  );
}
