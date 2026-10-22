"use client";

import {
  dondeSeQuedan,
  ETIQUETA_ETAPA,
  TEMAS,
  type Performance,
} from "@/lib/performance";

/** "envío y precio" con los temas más preguntados en la etapa donde más se quedan. */
function temasDeLaEtapa(
  performance: Performance,
): { etapa: string; temas: string } | null {
  const etapa = dondeSeQuedan(performance.etapas);
  if (!etapa) return null;
  const temas = performance.preguntas.dondeSeQuedan
    .filter((fila) => fila.etapa === etapa.etapa)
    .slice(0, 2)
    .map((fila) => TEMAS[fila.tema].toLowerCase());
  if (temas.length === 0) return null;
  return { etapa: ETIQUETA_ETAPA[etapa.etapa], temas: temas.join(" y ") };
}

/**
 * Qué preguntan los clientes, según la clasificación del modelo: por tema
 * (una barra por tema, una sola serie, con lo que quedó sin resolver en
 * texto), qué preguntan donde se quedan los chats, y por producto. Todo es
 * una inferencia y lo dice.
 */
export function Preguntas({ performance }: { performance: Performance }) {
  const { preguntas, definiciones } = performance;
  const maximo = Math.max(...preguntas.porTema.map((fila) => fila.total), 1);
  const enLaEtapa = temasDeLaEtapa(performance);

  return (
    <section aria-labelledby="titulo-preguntas" className="flex flex-col gap-3">
      <div>
        <h2
          id="titulo-preguntas"
          className="font-display text-[17px] font-bold text-ink"
        >
          Qué preguntan
        </h2>
        <p className="text-[13px] text-ink-secondary">
          {definiciones.preguntas}
        </p>
        <p className="mt-1 text-[12.5px] text-muted">
          {preguntas.analizados.toLocaleString("es-AR")} de{" "}
          {preguntas.chats.toLocaleString("es-AR")}{" "}
          {preguntas.chats === 1
            ? "chat nuevo analizado"
            : "chats nuevos analizados"}
          .
        </p>
      </div>

      {preguntas.porTema.length === 0 ? (
        <p className="rounded-lg border border-line bg-card py-8 text-center text-sm text-muted">
          Todavía no hay preguntas analizadas en este período.
        </p>
      ) : (
        <>
          {enLaEtapa && (
            <p className="rounded-md border border-line bg-sunken px-3 py-2 text-[13.5px] text-ink">
              Donde más se quedan los chats (<strong>{enLaEtapa.etapa}</strong>
              ), preguntan sobre <strong>{enLaEtapa.temas}</strong>.
            </p>
          )}
          <div className="rounded-lg border border-line bg-card p-5">
            <ol className="flex flex-col gap-3">
              {preguntas.porTema.map((fila) => (
                <li key={fila.tema}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="text-ink">{fila.nombre}</span>
                    <span className="text-ink-secondary">
                      {fila.sinResolver > 0 && (
                        <span className="mr-2">
                          {fila.sinResolver} sin resolver
                        </span>
                      )}
                      <span className="font-semibold text-ink tabular-nums">
                        {fila.total.toLocaleString("es-AR")}
                      </span>
                    </span>
                  </div>
                  <div
                    aria-hidden="true"
                    className="h-3 rounded-r-[4px] bg-primary"
                    style={{
                      width: `${Math.max((fila.total / maximo) * 100, 1.5)}%`,
                    }}
                  />
                  {fila.ejemplos.length > 0 && (
                    <details className="mt-1 text-[12.5px] text-ink-secondary">
                      <summary className="cursor-pointer select-none">
                        Ejemplos
                      </summary>
                      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
                        {fila.ejemplos.map((ejemplo, i) => (
                          <li key={i}>{ejemplo}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {preguntas.porProducto.length > 0 && (
            <div className="relative overflow-x-auto rounded-lg border border-line bg-card">
              <table className="w-full min-w-[480px] text-[13.5px] text-ink">
                <caption className="sr-only">Preguntas por producto</caption>
                <thead className="border-b border-line text-[12px] text-ink-secondary">
                  <tr>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-left font-semibold"
                    >
                      Producto
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-right font-semibold"
                    >
                      Preguntas
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-right font-semibold"
                    >
                      Sin resolver
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-left font-semibold"
                    >
                      Lo que más preguntan
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preguntas.porProducto.map((fila) => (
                    <tr
                      key={fila.productoId}
                      className="border-b border-line last:border-b-0"
                    >
                      <th
                        scope="row"
                        className="max-w-[240px] truncate px-3 py-2.5 text-left font-semibold"
                      >
                        {fila.nombre}
                      </th>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {fila.total.toLocaleString("es-AR")}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {fila.sinResolver.toLocaleString("es-AR")}
                      </td>
                      <td className="px-3 py-2.5 text-ink-secondary">
                        {TEMAS[fila.temaPrincipal]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
