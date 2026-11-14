"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  ETIQUETA_ESTADO,
  ETIQUETA_MODALIDAD,
  ETIQUETA_RESOLUCION,
  probarEnvio,
  type ResolucionEnvio,
} from "@/lib/envios";
import { ErrorDeApi, formatearMonto } from "@/lib/productos";

const EJEMPLOS = ["¿Cuánto sale el envío a Córdoba?", "¿Envían al CP 5000?", "¿Llegan a San Martín?", "¿Y a Ushuaia?"];

const FALTANTE = { provincia: "la provincia", localidad: "la localidad", codigo_postal: "el código postal" } as const;

type Prueba = { mensaje: string; reply: string; resoluciones: ResolucionEnvio[] };

function tonoDe(estado: ResolucionEnvio["estado"]): "success" | "info" | "warning" | "danger" | "neutral" {
  if (estado === "resuelto") return "success";
  if (estado === "conflicto" || estado === "error") return "warning";
  if (estado === "sin_configurar" || estado === "inactivo") return "neutral";
  return "info";
}

function Detalle({ r }: Readonly<{ r: ResolucionEnvio }>) {
  const destino = [r.destino.localidad, r.destino.provincia, r.destino.cp ? `CP ${r.destino.cp}` : null].filter(Boolean).join(", ");
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tonoDe(r.estado)}>{ETIQUETA_RESOLUCION[r.estado]}</Badge>
        {r.faltante && <span className="text-[14px] text-ink">Pide sólo {FALTANTE[r.faltante]}</span>}
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-[14px] md:grid-cols-2">
        <div>
          <dt className="font-semibold text-ink-secondary">Destino entendido</dt>
          <dd className="text-ink">{destino || "—"}</dd>
        </div>
        {r.candidatos.length > 0 && (
          <div>
            <dt className="font-semibold text-ink-secondary">{r.estado === "conflicto" ? "Zonas que chocan" : "Opciones"}</dt>
            <dd className="text-ink">{r.candidatos.join(" · ")}</dd>
          </div>
        )}
        {r.detalle && (
          <div>
            <dt className="font-semibold text-ink-secondary">Qué no cierra</dt>
            <dd className="text-ink">{r.detalle}</dd>
          </div>
        )}
      </dl>
      {r.modalidades.length > 0 && (
        <ul className="flex flex-col gap-2">
          {r.modalidades.map((m) => (
            <li key={m.modalidad} className="rounded-md bg-sunken px-3 py-2 text-[14px] text-ink">
              <strong>{ETIQUETA_MODALIDAD[m.modalidad]}</strong>
              {m.zona && <> · zona “{m.zona.nombre}”</>}
              {" · "}
              {m.estado in ETIQUETA_ESTADO ? ETIQUETA_ESTADO[m.estado as keyof typeof ETIQUETA_ESTADO] : m.estado}
              {m.tarifaCentavos !== null && <> · {m.tarifaCentavos === 0 ? "sin cargo" : formatearMonto(m.tarifaCentavos, m.moneda)}</>}
              {m.gratis && <> · gratis desde {formatearMonto(m.gratis.desdeCentavos, m.moneda)}</>}
              {m.plazo && (
                <>
                  {" "}
                  · {m.plazo.desdeDias === m.plazo.hastaDias ? m.plazo.desdeDias : `${m.plazo.desdeDias} a ${m.plazo.hastaDias}`} días
                  hábiles (estimado)
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * El dueño escribe como un cliente y ve la respuesta del mismo asistente de
 * WhatsApp, con la zona y la regla que aplicó o el dato que falta.
 */
export function ProbadorEnvios() {
  const [mensaje, setMensaje] = useState("");
  const [probando, setProbando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pruebas, setPruebas] = useState<Prueba[]>([]);

  const probar = (texto: string) => {
    const limpio = texto.trim();
    if (!limpio || probando) return;
    setProbando(true);
    setError(null);
    probarEnvio(limpio)
      .then(({ reply, resoluciones }) => {
        setPruebas((actuales) => [{ mensaje: limpio, reply, resoluciones }, ...actuales].slice(0, 10));
        setMensaje("");
      })
      .catch((err) => setError(err instanceof ErrorDeApi ? err.message : "No pudimos probar. Intentá de nuevo."))
      .finally(() => setProbando(false));
  };

  const [actual, ...anteriores] = pruebas;

  return (
    <div className="flex flex-wrap items-start gap-6">
      <section aria-labelledby="t-consulta" className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5 rounded-lg border border-line bg-card p-5">
        <h2 id="t-consulta" className="font-display text-[17px] font-bold text-ink">
          Consulta
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            probar(mensaje);
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-ink">
            <span>Mensaje del cliente</span>
            <textarea
              rows={3}
              maxLength={500}
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              placeholder="¿Cuánto sale el envío a Córdoba?"
              className="rounded-md border border-line-strong bg-card px-3 py-2.5 font-medium text-ink outline-none focus:border-[var(--color-semantic-border-focus)]"
            />
          </label>
          <Button type="submit" disabled={probando || !mensaje.trim()}>
            {probando ? "Probando…" : "Probar"}
          </Button>
        </form>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-bold text-ink-secondary">Ejemplos</span>
          <div className="flex flex-wrap gap-2">
            {EJEMPLOS.map((ejemplo) => (
              <button
                key={ejemplo}
                type="button"
                disabled={probando}
                onClick={() => probar(ejemplo)}
                className="min-h-11 cursor-pointer rounded-full border border-line-strong bg-card px-3 text-[14px] text-ink hover:bg-sunken disabled:cursor-default"
              >
                {ejemplo}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[13px] text-ink-secondary">
          Cada prueba es una charla nueva. Usa el asistente de verdad, así que cuenta como uso del modelo.
        </p>
      </section>

      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-md bg-danger-subtle px-4 py-3 text-danger-text">
            {error}
          </p>
        )}
        <section aria-labelledby="t-resultado" aria-live="polite" className="flex flex-col gap-4 rounded-lg border border-line bg-card p-5">
          <h2 id="t-resultado" className="font-display text-[17px] font-bold text-ink">
            Resultado
          </h2>
          {!actual ? (
            <p className="text-[14.5px] text-ink-secondary">Escribí una consulta o tocá un ejemplo.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2 rounded-md bg-sunken p-4">
                <p className="max-w-[80%] self-end rounded-[14px_14px_4px_14px] bg-card px-3.5 py-2.5 text-[14px] text-ink">
                  {actual.mensaje}
                </p>
                <p className="max-w-[85%] self-start rounded-[14px_14px_14px_4px] bg-success-subtle px-3.5 py-2.5 text-[14px] whitespace-pre-line text-ink">
                  {actual.reply}
                </p>
              </div>
              {actual.resoluciones.length === 0 ? (
                <p className="text-[14px] text-ink-secondary">
                  El asistente no consultó las tarifas en esta respuesta (¿el módulo está activo y la cuenta hace envíos?).
                </p>
              ) : (
                actual.resoluciones.map((r, i) => <Detalle key={i} r={r} />)
              )}
            </>
          )}
        </section>
        {anteriores.length > 0 && (
          <section aria-labelledby="t-anteriores" className="flex flex-col rounded-lg border border-line bg-card">
            <h2 id="t-anteriores" className="border-b border-line px-5 py-4 font-display text-[17px] font-bold text-ink">
              Pruebas anteriores
            </h2>
            <ul>
              {anteriores.map((prueba, i) => (
                <li key={i} className="flex flex-wrap items-start gap-x-4 gap-y-1 border-b border-line px-5 py-3 last:border-b-0">
                  <div className="flex flex-[1_1_280px] flex-col gap-0.5">
                    <span className="font-semibold text-ink">“{prueba.mensaje}”</span>
                    <span className="text-[14px] text-ink-secondary">{prueba.reply}</span>
                  </div>
                  {prueba.resoluciones[0] && (
                    <Badge tone={tonoDe(prueba.resoluciones[0].estado)}>{ETIQUETA_RESOLUCION[prueba.resoluciones[0].estado]}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
