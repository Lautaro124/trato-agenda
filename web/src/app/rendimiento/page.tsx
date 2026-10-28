"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { chip } from "@/components/onboarding/controles";
import { Conversion } from "@/components/rendimiento/Conversion";
import { Etapas } from "@/components/rendimiento/Etapas";
import { ErrorDeCarga } from "@/components/rendimiento/ErrorDeCarga";
import { Preguntas } from "@/components/rendimiento/Preguntas";
import { TablaProductos } from "@/components/rendimiento/TablaProductos";
import { Zonas } from "@/components/rendimiento/Zonas";
import { cn } from "@/lib/cn";
import {
  diaLegible,
  ERROR_DE_CARGA,
  horaLegible,
  obtenerPerformance,
  ZONAS,
  type FiltroZona,
  type FiltrosPerformance,
  type Performance,
} from "@/lib/performance";
import { ErrorDeApi, MONEDAS, type Moneda } from "@/lib/productos";
import { useRequireSession } from "@/lib/session";
import { claveDia, rangoDePeriodo, type Periodo } from "@/lib/ventas";

const PERIODOS: Array<{ valor: Periodo; etiqueta: string }> = [
  { valor: "hoy", etiqueta: "Hoy" },
  { valor: "7", etiqueta: "7 días" },
  { valor: "30", etiqueta: "30 días" },
  { valor: "mes", etiqueta: "Este mes" },
  { valor: "personalizado", etiqueta: "Elegir fechas" },
];

/** Cada cuánto se vuelve a pedir un período que incluye hoy, sólo con la pestaña a la vista. */
const EN_VIVO_CADA_MS = 30_000;

const FECHA =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-[13.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";

function Cargando() {
  return (
    <main className="grid min-h-dvh place-items-center bg-page p-6">
      <p className="text-sm text-muted">Cargando el rendimiento…</p>
    </main>
  );
}

export default function RendimientoPage() {
  const { user, status } = useRequireSession();
  const router = useRouter();
  const vende = user?.tipoAsistente === "ventas";

  // El rendimiento es de los productos: una cuenta de agenda vuelve a su pantalla.
  useEffect(() => {
    if (status === "authenticated" && user && !vende) router.replace("/inicio");
  }, [status, user, vende, router]);

  if (status !== "authenticated" || !user || !vende) return <Cargando />;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="rendimiento" user={user} />
      <Rendimiento />
      <MobileTabBar active="rendimiento" />
    </div>
  );
}

/** Lo que dice si el período tiene datos a medias o ninguno: el registro arranca con el primer chat. */
function AvisoDeDatos({ performance }: { performance: Performance }) {
  if (performance.datos === "completos") return null;
  const desde = performance.registroDesde
    ? diaLegible(performance.registroDesde)
    : null;
  const texto =
    performance.datos === "sin_datos"
      ? desde
        ? `Este período es anterior al ${desde}, cuando empezamos a medir: no hay datos.`
        : "Todavía no hay datos: empezamos a medir con el próximo chat de un cliente."
      : `Empezamos a medir el ${desde}: lo de antes de ese día no está contado.`;
  return (
    <p className="rounded-md border border-line bg-sunken px-3 py-2 text-[13.5px] text-ink-secondary">
      {texto}
    </p>
  );
}

function Rendimiento() {
  const [hoy] = useState(() => claveDia(new Date()));
  const [periodo, setPeriodo] = useState<Periodo>("30");
  const [fechas, setFechas] = useState({ desde: "", hasta: "" });
  const [moneda, setMoneda] = useState<Moneda>("ARS");
  // Una zona acota todo lo demás (conversión, etapas y productos): así se cruza producto con zona.
  const [zona, setZona] = useState<FiltroZona | "">("");
  const [respuesta, setRespuesta] = useState<{
    clave: string;
    datos: Performance;
    // Cuándo llegaron: se muestra como "actualizado 17:42" mientras está en vivo.
    recibida: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reintentar vuelve a pedir lo mismo: cambia la dependencia del efecto.
  const [intento, setIntento] = useState(0);

  const rango = periodo === "personalizado" ? fechas : rangoDePeriodo(periodo);
  const problemaDeRango =
    !rango.desde || !rango.hasta
      ? "Elegí las dos fechas."
      : rango.desde > rango.hasta
        ? "La fecha de inicio es posterior a la de fin."
        : null;
  const clave = JSON.stringify({ ...rango, moneda, zona });
  // Un período que llega hasta hoy sigue cambiando: se refresca solo.
  const enVivo = !problemaDeRango && rango.hasta >= claveDia(new Date());

  useEffect(() => {
    if (problemaDeRango) return;
    const filtros = JSON.parse(clave) as FiltrosPerformance;
    let cancelado = false;
    // Sólo se aplica la última respuesta pedida, aunque una anterior llegue después.
    let ultimo = 0;
    const cargar = (deFondo: boolean) => {
      const pedido = ++ultimo;
      obtenerPerformance(filtros)
        .then((datos) => {
          if (cancelado || pedido !== ultimo) return;
          setRespuesta({ clave, datos, recibida: Date.now() });
          setError(null);
        })
        .catch((err: unknown) => {
          // Un refresco de fondo que falla deja a la vista lo último que llegó.
          if (cancelado || deFondo || pedido !== ultimo) return;
          setError(err instanceof ErrorDeApi ? err.message : ERROR_DE_CARGA);
        });
    };
    cargar(false);
    const refrescar = () => {
      if (document.visibilityState === "visible") cargar(true);
    };
    const timer = enVivo ? setInterval(refrescar, EN_VIVO_CADA_MS) : undefined;
    if (enVivo) document.addEventListener("visibilitychange", refrescar);
    return () => {
      cancelado = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refrescar);
    };
  }, [clave, problemaDeRango, intento, enVivo]);

  const elegirPeriodo = (valor: Periodo) => {
    // Al pasar a "Elegir fechas" se arranca del rango que se estaba viendo.
    if (
      valor === "personalizado" &&
      periodo !== "personalizado" &&
      !fechas.desde
    )
      setFechas(rangoDePeriodo(periodo));
    setPeriodo(valor);
  };

  const datos = respuesta?.datos;
  const recargando =
    !problemaDeRango && respuesta !== null && respuesta.clave !== clave;

  return (
    <main className="flex-1 bg-page p-5 pb-24 md:pb-8">
      <div className="mx-auto flex max-w-[960px] flex-col gap-5">
        <div>
          <h1 className="mb-1 font-display text-[27px] leading-[1.15] font-bold tracking-[-0.025em] text-ink">
            Rendimiento
          </h1>
          <p className="text-sm leading-[1.6] text-ink-secondary">
            Cómo les va a tus productos en los chats: cuántos llegan a pedir y a
            pagar, y dónde se quedan.
          </p>
          {enVivo && respuesta?.clave === clave && (
            <p className="mt-2 flex items-center gap-2 text-[13px] text-ink-secondary">
              <span
                aria-hidden="true"
                className="size-2 animate-pulse rounded-full bg-success motion-reduce:animate-none"
              />
              En vivo · actualizado {horaLegible(respuesta.recibida)}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Período"
              className="flex flex-wrap gap-1.5"
            >
              {PERIODOS.map(({ valor, etiqueta }) => (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={periodo === valor}
                  onClick={() => elegirPeriodo(valor)}
                  className={chip(periodo === valor)}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
            {periodo === "personalizado" && (
              <div className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
                <input
                  type="date"
                  aria-label="Desde"
                  value={fechas.desde}
                  max={fechas.hasta || hoy}
                  onChange={(e) =>
                    setFechas((actual) => ({
                      ...actual,
                      desde: e.target.value,
                    }))
                  }
                  className={FECHA}
                />
                <span aria-hidden="true">a</span>
                <input
                  type="date"
                  aria-label="Hasta"
                  value={fechas.hasta}
                  min={fechas.desde || undefined}
                  max={hoy}
                  onChange={(e) =>
                    setFechas((actual) => ({
                      ...actual,
                      hasta: e.target.value,
                    }))
                  }
                  className={FECHA}
                />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={zona}
              onChange={(e) => setZona(e.target.value as FiltroZona | "")}
              aria-label="Zona"
              className="rounded-md border border-line bg-card px-3 py-2 text-[13.5px] text-ink"
            >
              <option value="">Todas las zonas</option>
              {(Object.keys(ZONAS) as Array<keyof typeof ZONAS>).map(
                (clave) => (
                  <option key={clave} value={clave}>
                    {ZONAS[clave]}
                  </option>
                ),
              )}
              <option value="sin_zona">Sin zona</option>
            </select>
            <div
              role="radiogroup"
              aria-label="Moneda de los pedidos"
              className="flex w-fit gap-1 rounded-md border border-line bg-sunken p-1"
            >
              {MONEDAS.map((opcion) => (
                <label
                  key={opcion}
                  className={cn(
                    "cursor-pointer rounded-sm px-3 py-1.5 text-[13px] font-semibold",
                    moneda === opcion
                      ? "bg-card text-ink shadow-sm"
                      : "text-ink-secondary",
                  )}
                >
                  <input
                    type="radio"
                    name="moneda-rendimiento"
                    value={opcion}
                    checked={moneda === opcion}
                    onChange={() => setMoneda(opcion)}
                    className="sr-only"
                  />
                  {opcion === "USD" ? "En dólares" : "En pesos"}
                </label>
              ))}
            </div>
          </div>
        </div>

        {problemaDeRango && (
          <p className="text-sm text-ink-secondary">{problemaDeRango}</p>
        )}
        {error && !problemaDeRango ? (
          <ErrorDeCarga
            detalle={error === ERROR_DE_CARGA ? undefined : error}
            onReintentar={() => {
              setError(null);
              setIntento((n) => n + 1);
            }}
          />
        ) : !datos ? (
          !problemaDeRango && (
            <p className="py-10 text-center text-sm text-muted">
              Cargando el rendimiento…
            </p>
          )
        ) : (
          <div
            aria-busy={recargando}
            className={cn(
              "flex flex-col gap-6 transition-opacity",
              recargando && "opacity-60",
            )}
          >
            <AvisoDeDatos performance={datos} />
            {datos.zona && (
              <p className="rounded-md border border-line bg-sunken px-3 py-2 text-[13.5px] text-ink">
                Estás viendo sólo los chats de{" "}
                <strong>
                  {datos.zona === "sin_zona"
                    ? "zona desconocida"
                    : ZONAS[datos.zona]}
                </strong>
                .{" "}
                <button
                  type="button"
                  onClick={() => setZona("")}
                  className="cursor-pointer font-semibold text-primary underline-offset-2 hover:underline"
                >
                  Ver todas las zonas
                </button>
              </p>
            )}
            <Conversion performance={datos} />
            <Etapas performance={datos} />
            <TablaProductos performance={datos} />
            <Preguntas performance={datos} />
            <Zonas performance={datos} onElegir={setZona} />
          </div>
        )}
      </div>
    </main>
  );
}
