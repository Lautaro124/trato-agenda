"use client";

import { useId, useState } from "react";
import { Recorrido } from "@/components/Recorrido";
import { Button } from "@/components/ui/Button";
import { chip } from "@/components/ui/chip";
import { FilaInterruptor } from "@/components/ui/FilaInterruptor";
import { MAX_CUOTAS, MIN_CUOTAS, problemaDeCuotas, RECARGO_MAX_PORCENTAJE, type CuotasProducto } from "@/lib/condiciones-pago";
import { centavosParaInput, formatearMonto, leerCentavos } from "@/lib/productos";
import { PASOS_CUOTAS } from "@/lib/tutoriales";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2.5 text-[14.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";
const LABEL = "mb-1.5 block text-[12.5px] font-semibold text-ink-secondary";

/** Lo que se está tipeando en la sección Cuotas. `maximo` null = en un pago. */
export type CuotasEnEdicion = {
  maximo: number | null;
  modo: CuotasProducto["modo"];
  recargo: string;
  elegidas: number[];
  /** El total tipeado para cada cantidad, en el modo de precio por plan. */
  totales: Record<number, string>;
};

/** Las cantidades de siempre; cualquier otra de 2 a 24 se agrega a mano y aparece al elegirla. */
const CANTIDADES_COMUNES = [2, 3, 6, 9, 12, 18, 24];
/** Cantidad con la que arranca al prender las cuotas por primera vez. */
const CANTIDAD_INICIAL = 3;

export function cuotasDesdeProducto(cuotas: CuotasProducto | null | undefined): CuotasEnEdicion {
  if (!cuotas) return { maximo: null, modo: "recargo", recargo: "0", elegidas: [], totales: {} };
  if (cuotas.modo === "recargo") {
    return {
      maximo: Math.max(...cuotas.planes),
      modo: "recargo",
      recargo: String(cuotas.recargoPorcentaje),
      elegidas: cuotas.planes,
      totales: {},
    };
  }
  return {
    maximo: Math.max(...cuotas.planes.map((plan) => plan.cuotas)),
    modo: "precios",
    recargo: "0",
    elegidas: cuotas.planes.map((plan) => plan.cuotas),
    totales: Object.fromEntries(cuotas.planes.map((plan) => [plan.cuotas, centavosParaInput(plan.totalCentavos)])),
  };
}

/** Lo que se guarda, o el motivo por el que no se puede (el mismo que daría la API). */
export function armarCuotas(
  edicion: CuotasEnEdicion,
  precioCentavos: number,
  moneda: string,
): CuotasProducto | null | string {
  if (edicion.maximo === null || moneda !== "ARS") return null;
  const maximo = edicion.maximo;
  const elegidas = edicion.elegidas.filter((cuotas) => cuotas <= maximo).sort((a, b) => a - b);
  let cuotas: CuotasProducto;
  if (edicion.modo === "recargo") {
    const recargo = edicion.recargo.trim() === "" ? Number.NaN : Number(edicion.recargo);
    cuotas = { modo: "recargo", recargoPorcentaje: recargo, planes: elegidas };
  } else {
    const planes: Array<{ cuotas: number; totalCentavos: number }> = [];
    for (const n of elegidas) {
      const total = leerCentavos(edicion.totales[n] ?? "");
      if (total === null) return `Falta el total en ${n} cuotas.`;
      planes.push({ cuotas: n, totalCentavos: total });
    }
    cuotas = { modo: "precios", planes };
  }
  return problemaDeCuotas(cuotas, precioCentavos, moneda) ?? cuotas;
}

/** Cuánto paga el cliente en un plan, para la vista previa, o por qué todavía no se puede calcular. */
function planParaVista(
  n: number,
  cuotas: CuotasEnEdicion,
  baseCentavos: number,
): { total: number; porCuota: number; nota: string } | { problema: string } {
  if (cuotas.modo === "recargo") {
    const recargo = cuotas.recargo.trim() === "" ? Number.NaN : Number(cuotas.recargo);
    if (!Number.isFinite(recargo) || recargo < 0 || recargo > RECARGO_MAX_PORCENTAJE) {
      return { problema: `Poné un recargo de 0 a ${RECARGO_MAX_PORCENTAJE}%.` };
    }
    const total = Math.round(baseCentavos * (1 + recargo / 100));
    return { total, porCuota: Math.round(total / n), nota: recargo === 0 ? "Sin interés" : `Con ${recargo}% de recargo` };
  }
  const total = leerCentavos(cuotas.totales[n] ?? "");
  if (total === null) return { problema: "Escribí el total para ver el valor de la cuota." };
  if (total < baseCentavos) return { problema: `No puede ser menor que el precio (${formatearMonto(baseCentavos)}).` };
  return {
    total,
    porCuota: Math.round(total / n),
    nota: total === baseCentavos ? "Sin interés" : `${formatearMonto(total - baseCentavos)} más que el precio`,
  };
}

/**
 * Si se ofrecen cuotas, en cuáles y cómo se cobran (LAU-34), con la vista
 * previa de lo que ve el cliente. Las cuotas máximas salen de la mayor cantidad
 * elegida. `baseCentavos` es el precio ya con el descuento del producto.
 */
export function SeccionCuotas({
  cuotas,
  baseCentavos,
  onCambio,
}: Readonly<{
  cuotas: CuotasEnEdicion;
  baseCentavos: number | null;
  onCambio: (cambios: Partial<CuotasEnEdicion>) => void;
}>) {
  const id = useId();
  const [tutorial, setTutorial] = useState(false);
  const [otra, setOtra] = useState("");
  const [errorOtra, setErrorOtra] = useState<string | null>(null);

  const activo = cuotas.maximo !== null;
  const elegidas = [...cuotas.elegidas].sort((a, b) => a - b);
  const cantidades = [...new Set([...CANTIDADES_COMUNES, ...elegidas])].sort((a, b) => a - b);

  const fijarElegidas = (nuevas: number[]) =>
    // El máximo siempre es la mayor elegida; sin ninguna, se conserva para no apagar las cuotas.
    onCambio({ elegidas: nuevas, maximo: nuevas.length > 0 ? Math.max(...nuevas) : cuotas.maximo });

  const activar = (prendido: boolean) => {
    if (!prendido) return onCambio({ maximo: null });
    const previas = cuotas.elegidas.length > 0 ? cuotas.elegidas : [CANTIDAD_INICIAL];
    onCambio({ elegidas: previas, maximo: Math.max(...previas) });
  };

  const alternar = (n: number) =>
    fijarElegidas(cuotas.elegidas.includes(n) ? cuotas.elegidas.filter((otraN) => otraN !== n) : [...cuotas.elegidas, n]);

  const agregarOtra = () => {
    const n = Number(otra.trim());
    if (!Number.isInteger(n) || n < MIN_CUOTAS || n > MAX_CUOTAS) {
      setErrorOtra(`Escribí un número entero de ${MIN_CUOTAS} a ${MAX_CUOTAS}.`);
      return;
    }
    setErrorOtra(null);
    setOtra("");
    if (!cuotas.elegidas.includes(n)) fijarElegidas([...cuotas.elegidas, n]);
  };

  return (
    <section aria-labelledby={`${id}-titulo`} className="flex flex-col gap-4 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={`${id}-titulo`} className="text-[13.5px] font-bold text-ink">
            Cuotas
          </h2>
          <p className="text-[12.5px] text-ink-secondary">Elegí en cuántas cuotas puede pagar tu cliente y cómo se cobran.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setTutorial(true)}>
          Ver tutorial
        </Button>
      </div>

      <FilaInterruptor
        titulo="Ofrecer cuotas"
        ayuda={
          !activo
            ? "Apagado: el cliente paga en un solo pago."
            : elegidas.length > 0
              ? `Se ofrecen ${elegidas.join(", ")} cuotas (hasta ${Math.max(...elegidas)}).`
              : "Todavía no elegiste ninguna cantidad."
        }
        checked={activo}
        onChange={activar}
        tutorial="cuotas-activar"
      />

      {activo && (
        <div className="grid gap-5 lg:grid-cols-2 lg:items-start lg:gap-6">
          <div className="flex min-w-0 flex-col gap-4">
            <div data-tutorial="cuotas-modo" role="radiogroup" aria-label="Cómo se cobran las cuotas">
              <span className={LABEL} aria-hidden="true">
                Cómo se cobran
              </span>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {(
                  [
                    ["recargo", "Un % de recargo", "Un mismo porcentaje para todas las cuotas. Lo más rápido."],
                    ["precios", "Un precio por cuota", "Vos ponés el total de cada plan."],
                  ] as const
                ).map(([modo, titulo, ayuda]) => (
                  <label
                    key={modo}
                    className="flex cursor-pointer flex-col gap-1 rounded-md border-2 border-line bg-card p-3.5 has-checked:border-primary has-checked:bg-primary-subtle has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[var(--color-semantic-border-focus)]"
                  >
                    <input
                      type="radio"
                      name={`${id}-modo`}
                      value={modo}
                      checked={cuotas.modo === modo}
                      onChange={() => onCambio({ modo })}
                      className="sr-only"
                    />
                    <span className="text-[14.5px] font-bold text-ink">{titulo}</span>
                    <span className="text-[13px] leading-[1.4] text-ink-secondary">{ayuda}</span>
                  </label>
                ))}
              </div>
            </div>

            {cuotas.modo === "recargo" && (
              <div className="max-w-[240px]">
                <label htmlFor={`${id}-recargo`} className={LABEL}>
                  Recargo (%)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id={`${id}-recargo`}
                    inputMode="numeric"
                    value={cuotas.recargo}
                    onChange={(e) => onCambio({ recargo: e.target.value })}
                    className={INPUT}
                  />
                  <span className="text-[13px] text-muted">%</span>
                </div>
                <p className="mt-1.5 text-[12.5px] text-muted">
                  El mismo para todas las cuotas que elijas, sobre el precio con descuento. Con 0% es sin interés.
                </p>
              </div>
            )}

            <fieldset data-tutorial="cuotas-planes" className="min-w-0">
              <legend className={LABEL}>En cuántas cuotas se vende</legend>
              <div className="flex flex-wrap gap-2">
                {cantidades.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={cuotas.elegidas.includes(n)}
                    onClick={() => alternar(n)}
                    className={`${chip(cuotas.elegidas.includes(n))} min-h-11`}
                  >
                    {n} cuotas
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="w-[150px]">
                  <label htmlFor={`${id}-otra`} className={LABEL}>
                    Otra cantidad
                  </label>
                  <input
                    id={`${id}-otra`}
                    inputMode="numeric"
                    value={otra}
                    placeholder={`${MIN_CUOTAS} a ${MAX_CUOTAS}`}
                    onChange={(e) => setOtra(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter acá agrega la cantidad; no tiene que guardar el producto.
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      agregarOtra();
                    }}
                    className={INPUT}
                  />
                </div>
                <Button variant="secondary" onClick={agregarOtra}>
                  Agregar
                </Button>
              </div>
              {errorOtra && (
                <p role="alert" className="mt-1.5 text-[12.5px] text-danger-text">
                  {errorOtra}
                </p>
              )}
              {elegidas.length === 0 && (
                <p role="alert" className="mt-1.5 text-[12.5px] text-warning-text">
                  Elegí al menos una cantidad de cuotas.
                </p>
              )}
            </fieldset>

            {cuotas.modo === "precios" && elegidas.length > 0 && (
              <fieldset className="min-w-0">
                <legend className={LABEL}>Total de una unidad en cada plan</legend>
                <ul className="flex flex-col gap-2">
                  {elegidas.map((n) => (
                    <li key={n} className="flex items-center gap-2">
                      <span className="min-w-[88px] flex-none text-[14px] text-ink">{n} cuotas</span>
                      <span className="flex-none text-[13px] text-muted">$</span>
                      <input
                        aria-label={`Total en ${n} cuotas`}
                        inputMode="decimal"
                        value={cuotas.totales[n] ?? ""}
                        onChange={(e) => onCambio({ totales: { ...cuotas.totales, [n]: e.target.value } })}
                        className={INPUT}
                      />
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[12.5px] text-muted">No puede ser menor que el precio.</p>
              </fieldset>
            )}
          </div>

          <div data-tutorial="cuotas-vista" className="flex min-w-0 flex-col gap-3 rounded-lg bg-sunken p-4">
            <p className="text-[11.5px] font-bold tracking-[0.04em] text-muted uppercase">Así lo ve tu cliente</p>
            {baseCentavos === null || baseCentavos <= 0 ? (
              <p className="text-[13.5px] text-ink-secondary">Cargá el precio para ver cuánto paga en cada plan.</p>
            ) : elegidas.length === 0 ? (
              <p className="text-[13.5px] text-ink-secondary">Elegí al menos una cantidad para ver el resultado.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {elegidas.map((n) => {
                  const plan = planParaVista(n, cuotas, baseCentavos);
                  return (
                    <li key={n} className="rounded-md bg-card px-3.5 py-3">
                      {"problema" in plan ? (
                        <>
                          <p className="text-[14.5px] font-bold text-ink">{n} cuotas</p>
                          <p className="text-[13px] text-ink-secondary">{plan.problema}</p>
                        </>
                      ) : (
                        <>
                          <p className="text-[14.5px] font-bold text-ink">
                            {n} cuotas de {formatearMonto(plan.porCuota)}
                          </p>
                          <p className="text-[13px] text-ink-secondary">
                            Total {formatearMonto(plan.total)} · {plan.nota}
                          </p>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-[12.5px] leading-[1.5] text-ink-secondary">
              En un pedido con varios productos sólo valen las cuotas que tienen todos.
            </p>
          </div>
        </div>
      )}

      {tutorial && <Recorrido pasos={PASOS_CUOTAS} onCerrar={() => setTutorial(false)} />}
    </section>
  );
}
