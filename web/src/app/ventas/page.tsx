"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { Button } from "@/components/ui/Button";
import { DetalleVenta } from "@/components/ventas/DetalleVenta";
import { FiltrosVentas, type Periodos } from "@/components/ventas/FiltrosVentas";
import { GraficoPorDia } from "@/components/ventas/GraficoPorDia";
import { KpiVentas } from "@/components/ventas/KpiVentas";
import { ListaVentas } from "@/components/ventas/ListaVentas";
import { MasVendidos } from "@/components/ventas/MasVendidos";
import { cn } from "@/lib/cn";
import { ErrorDeApi } from "@/lib/productos";
import { useRequireSession } from "@/lib/session";
import {
  claveDia,
  descargarCsv,
  ETIQUETA_ESTADO,
  listarVentas,
  obtenerVenta,
  rangoDePeriodo,
  resumenVentas,
  type EstadoVenta,
  type FiltrosVentas as Filtros,
  type ListadoVentas,
  type ResumenVentas,
  type Venta,
} from "@/lib/ventas";

/** Cuánto espera la búsqueda a que se deje de tipear. */
const ESPERA_BUSQUEDA_MS = 300;

function mensajeDe(err: unknown, porDefecto: string): string {
  return err instanceof ErrorDeApi ? err.message : porDefecto;
}

export default function VentasPage() {
  // useSearchParams (el `?venta=` de los avisos) necesita un límite de Suspense.
  return (
    <Suspense fallback={<Cargando />}>
      <VentasContenido />
    </Suspense>
  );
}

function Cargando() {
  return (
    <main className="grid min-h-dvh place-items-center bg-page p-6">
      <p className="text-sm text-muted">Cargando tus ventas…</p>
    </main>
  );
}

function VentasContenido() {
  const { user, status } = useRequireSession();
  const router = useRouter();
  const esVentas = user?.tipoAsistente === "ventas";

  // Una cuenta de agenda no vende: su pantalla es el calendario.
  useEffect(() => {
    if (status === "authenticated" && user && !esVentas) router.replace("/inicio");
  }, [status, user, esVentas, router]);

  if (status !== "authenticated" || !user || !esVentas) return <Cargando />;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="ventas" user={user} />
      <Historico />
      <MobileTabBar active="ventas" />
    </div>
  );
}

function Historico() {
  const router = useRouter();
  const ventaPedida = useSearchParams().get("venta");
  const [hoy] = useState(() => claveDia(new Date()));
  const [periodos, setPeriodos] = useState<Periodos>({ periodo: "30", desde: "", hasta: "", incluirPrueba: false });
  const [estado, setEstado] = useState<EstadoVenta | "">("");
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const [recargas, setRecargas] = useState(0);
  // Cada respuesta guarda la clave de los filtros con que se pidió: si no
  // coincide con la actual, se está recargando (y se sigue mostrando la vieja).
  const [listado, setListado] = useState<{ clave: string; datos: ListadoVentas } | null>(null);
  const [resumen, setResumen] = useState<{ clave: string; datos: ResumenVentas } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<Venta | null>(null);
  const [exportando, setExportando] = useState(false);

  const recargar = useCallback(() => setRecargas((n) => n + 1), []);

  const rango =
    periodos.periodo === "personalizado"
      ? { desde: periodos.desde, hasta: periodos.hasta }
      : rangoDePeriodo(periodos.periodo);
  const problemaDeRango =
    !rango.desde || !rango.hasta
      ? "Elegí las dos fechas."
      : rango.desde > rango.hasta
        ? "La fecha de inicio es posterior a la de fin."
        : null;

  const filtros: Filtros = {
    desde: rango.desde,
    hasta: rango.hasta,
    estado: estado || undefined,
    q,
    incluirPrueba: periodos.incluirPrueba,
    pagina,
  };
  const claveListado = JSON.stringify(filtros);
  const claveResumen = JSON.stringify({ desde: rango.desde, hasta: rango.hasta, incluirPrueba: periodos.incluirPrueba });

  // La búsqueda espera a que se deje de tipear; el setState va en el callback
  // del timer, no en el cuerpo del efecto.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(busqueda.trim());
      setPagina(1);
    }, ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(timer);
  }, [busqueda]);

  useEffect(() => {
    if (problemaDeRango) return;
    const ctrl = { cancelado: false };
    listarVentas(JSON.parse(claveListado) as Filtros)
      .then((datos) => {
        if (ctrl.cancelado) return;
        setListado({ clave: claveListado, datos });
        setError(null);
      })
      .catch((err: unknown) => !ctrl.cancelado && setError(mensajeDe(err, "No pudimos cargar tus ventas.")));
    return () => {
      ctrl.cancelado = true;
    };
  }, [claveListado, problemaDeRango, recargas]);

  useEffect(() => {
    if (problemaDeRango) return;
    const ctrl = { cancelado: false };
    resumenVentas(JSON.parse(claveResumen) as Filtros)
      .then((datos) => !ctrl.cancelado && setResumen({ clave: claveResumen, datos }))
      .catch((err: unknown) => !ctrl.cancelado && setError(mensajeDe(err, "No pudimos cargar tus ventas.")));
    return () => {
      ctrl.cancelado = true;
    };
  }, [claveResumen, problemaDeRango, recargas]);

  // El link de un aviso (`/ventas?venta=<id>`) abre ese pedido, sea del período que sea.
  useEffect(() => {
    if (!ventaPedida) return;
    const ctrl = { cancelado: false };
    obtenerVenta(ventaPedida)
      .then((venta) => !ctrl.cancelado && setAbierta(venta))
      .catch(() => !ctrl.cancelado && setError("No encontramos ese pedido."));
    return () => {
      ctrl.cancelado = true;
    };
  }, [ventaPedida]);

  const cambiarPeriodos = (cambio: Partial<Periodos>) => {
    setPeriodos((actual) => {
      const siguiente = { ...actual, ...cambio };
      // Al pasar a "Elegir fechas" se arranca del rango que se estaba viendo.
      if (cambio.periodo === "personalizado" && actual.periodo !== "personalizado") {
        const visto = rangoDePeriodo(actual.periodo);
        siguiente.desde = actual.desde || visto.desde;
        siguiente.hasta = actual.hasta || visto.hasta;
      }
      return siguiente;
    });
    setPagina(1);
  };

  const cerrarDetalle = () => {
    setAbierta(null);
    if (ventaPedida) router.replace("/ventas", { scroll: false });
  };

  const exportar = () => {
    setExportando(true);
    descargarCsv(filtros)
      .catch((err: unknown) => setError(mensajeDe(err, "No pudimos exportar las ventas.")))
      .finally(() => setExportando(false));
  };

  const recargando =
    !problemaDeRango && ((listado !== null && listado.clave !== claveListado) || (resumen !== null && resumen.clave !== claveResumen));
  const datos = listado?.datos;
  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1;

  return (
    <main className="flex-1 bg-page p-5 pb-24 md:pb-8">
      <div className="mx-auto flex max-w-[960px] flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="mb-1 font-display text-[27px] leading-[1.15] font-bold tracking-[-0.025em] text-ink">Ventas</h1>
            <p className="text-sm leading-[1.6] text-ink-secondary">
              Lo que vendió tu asistente: lo cobrado, lo que espera pago y lo que más sale.
            </p>
          </div>
          <Button variant="secondary" disabled={exportando || !!problemaDeRango || !datos} onClick={exportar}>
            {exportando ? "Exportando…" : "Exportar CSV"}
          </Button>
        </div>

        <FiltrosVentas filtros={periodos} hoy={hoy} onCambio={cambiarPeriodos} />

        {problemaDeRango && <p className="text-sm text-ink-secondary">{problemaDeRango}</p>}
        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}

        {!datos || !resumen ? (
          !error && !problemaDeRango && <p className="py-10 text-center text-sm text-muted">Cargando tus ventas…</p>
        ) : (
          <div aria-busy={recargando} className={cn("flex flex-col gap-4 transition-opacity", recargando && "opacity-60")}>
            <KpiVentas totales={datos.totales} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <GraficoPorDia porDia={resumen.datos.porDia} />
              <MasVendidos productos={resumen.datos.topProductos} />
            </div>

            <section aria-labelledby="titulo-pedidos" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="titulo-pedidos" className="font-display text-[17px] font-bold text-ink">
                  Pedidos
                </h2>
                <span className="text-[12.5px] text-muted">
                  {datos.total === 1 ? "1 pedido" : `${datos.total.toLocaleString("es-AR")} pedidos`}
                </span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="search"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por cliente, teléfono o producto"
                  aria-label="Buscar pedidos"
                  maxLength={100}
                  className="w-full rounded-md border border-line bg-card px-3 py-2.5 text-[14.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]"
                />
                <select
                  value={estado}
                  onChange={(e) => {
                    setEstado(e.target.value as EstadoVenta | "");
                    setPagina(1);
                  }}
                  aria-label="Filtrar por estado"
                  className="rounded-md border border-line bg-card px-3 py-2.5 text-[14.5px] text-ink sm:w-56"
                >
                  <option value="">Todos los estados</option>
                  {(Object.keys(ETIQUETA_ESTADO) as EstadoVenta[]).map((valor) => (
                    <option key={valor} value={valor}>
                      {ETIQUETA_ESTADO[valor]}
                    </option>
                  ))}
                </select>
              </div>

              <ListaVentas ventas={datos.ventas} onElegir={setAbierta} />

              {totalPaginas > 1 && (
                <nav aria-label="Páginas" className="flex items-center justify-center gap-3">
                  <Button variant="secondary" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                    Anterior
                  </Button>
                  <span className="text-[13px] text-ink-secondary">
                    Página {pagina} de {totalPaginas}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pagina >= totalPaginas}
                    onClick={() => setPagina((p) => p + 1)}
                  >
                    Siguiente
                  </Button>
                </nav>
              )}
            </section>
          </div>
        )}
      </div>

      {abierta && (
        <DetalleVenta
          venta={abierta}
          onCerrar={cerrarDetalle}
          onCambio={(venta) => {
            setAbierta(venta);
            recargar();
          }}
        />
      )}
    </main>
  );
}
