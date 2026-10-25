"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { FilaProducto } from "@/components/productos/FilaProducto";
import { ImportarProductos } from "@/components/productos/ImportarProductos";
import { ProbarBusqueda } from "@/components/productos/ProbarBusqueda";
import { Promociones } from "@/components/productos/Promociones";
import { useAvisos } from "@/components/ui/Avisos";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  eliminarProducto,
  listarCategorias,
  listarProductos,
  type Categoria,
  type ListadoProductos,
  type Producto,
} from "@/lib/productos";
import { useRequireSession } from "@/lib/session";

/** Cuánto espera la búsqueda del panel a que se deje de tipear. */
const ESPERA_BUSQUEDA_MS = 300;

export default function ProductosPage() {
  const { user, status } = useRequireSession();

  if (status !== "authenticated" || !user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando tus productos…</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="productos" user={user} />
      {/* useSearchParams necesita un límite de Suspense para prerenderizar la ruta. */}
      <Suspense>
        <Catalogo />
      </Suspense>
      <MobileTabBar active="productos" />
    </div>
  );
}

/**
 * El catálogo: productos de stock y a medida juntos. Cada uno se carga y se
 * edita en su propia pantalla (/productos/nuevo, /productos/[id]); la
 * planilla y las promociones son sólo de stock. `?importar=1` abre la planilla.
 */
function Catalogo() {
  const router = useRouter();
  const importarPedido = useSearchParams().get("importar") === "1";
  const [consulta, setConsulta] = useState("");
  const [consultaAplicada, setConsultaAplicada] = useState("");
  const [categoria, setCategoria] = useState("");
  const [pagina, setPagina] = useState(1);
  const [listado, setListado] = useState<ListadoProductos | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [error, setError] = useState(false);
  const [recargas, setRecargas] = useState(0);
  const [importando, setImportando] = useState(importarPedido);

  const recargar = useCallback(() => setRecargas((n) => n + 1), []);

  // La búsqueda espera a que se deje de tipear; el setState va en el callback
  // del timer, no en el cuerpo del efecto.
  useEffect(() => {
    const timer = setTimeout(() => {
      setConsultaAplicada(consulta.trim());
      setPagina(1);
    }, ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(timer);
  }, [consulta]);

  useEffect(() => {
    const ctrl = { cancelado: false };
    listarProductos({ q: consultaAplicada, categoria, pagina })
      .then((datos) => {
        if (ctrl.cancelado) return;
        setListado(datos);
        setError(false);
      })
      .catch(() => !ctrl.cancelado && setError(true));
    return () => {
      ctrl.cancelado = true;
    };
  }, [consultaAplicada, categoria, pagina, recargas]);

  useEffect(() => {
    listarCategorias()
      .then(setCategorias)
      .catch(() => {});
  }, [recargas]);

  const reemplazar = (producto: Producto) =>
    setListado((actual) =>
      actual ? { ...actual, productos: actual.productos.map((p) => (p.id === producto.id ? producto : p)) } : actual,
    );

  const { confirmar, avisar } = useAvisos();
  const borrar = async (producto: Producto) => {
    const confirmado = await confirmar({
      titulo: `¿Borrar «${producto.nombre}»?`,
      texto: "El asistente deja de ofrecerlo. Las ventas pasadas no cambian.",
      confirmar: "Sí, borrar",
    });
    if (!confirmado) return;
    eliminarProducto(producto.id)
      .then(() => {
        recargar();
        avisar(`Borraste «${producto.nombre}».`);
      })
      .catch(() => setError(true));
  };

  const totalPaginas = listado ? Math.max(1, Math.ceil(listado.total / listado.porPagina)) : 1;
  const catalogoVacio = listado !== null && listado.total === 0 && !consultaAplicada && !categoria;

  return (
    <main className="flex-1 bg-page p-5 pb-24 md:pb-8">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="mb-1 font-display text-[27px] leading-[1.15] font-bold tracking-[-0.025em] text-ink">
              Tus productos
            </h1>
            <p className="text-sm leading-[1.6] text-ink-secondary">
              Lo que tu asistente puede vender: lo de stock, con precio, stock y descuentos por variante, y lo que hacés a
              medida, con lo que le pregunta al cliente para que lo presupuestes. Los cambios valen desde el próximo mensaje.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/productos/importar-enlace"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-line-strong bg-card px-4 py-2 font-body text-[15px] leading-none font-semibold whitespace-nowrap text-ink shadow-sm hover:bg-sunken"
            >
              Importar desde un enlace <Badge tone="primary">Pro</Badge>
            </Link>
            <Button variant="secondary" onClick={() => setImportando(true)}>
              Importar planilla
            </Button>
            <Link
              href="/productos/nuevo"
              className="inline-flex items-center justify-center rounded-md border border-transparent bg-primary px-4 py-2 font-body text-[15px] leading-none font-semibold whitespace-nowrap text-primary-on shadow-sm hover:bg-primary-hover active:bg-primary-active"
            >
              Nuevo producto
            </Link>
          </div>
        </div>

        {/* Desde lg, la prueba de búsqueda y las promos van en una columna a la derecha. */}
        <div className={cn("grid gap-5", !catalogoVacio && "lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start")}>
          <div className="@container flex min-w-0 flex-col gap-4">
            {importando && <ImportarProductos onCerrar={() => setImportando(false)} onImportado={recargar} />}

            {catalogoVacio && !importando ? (
              <div className="rounded-lg border border-dashed border-line-strong bg-card p-6 text-center">
                <p className="mb-1 font-semibold text-ink">Todavía no cargaste productos</p>
                <p className="mb-4 text-sm text-ink-secondary">
                  Cargalos de a uno, de stock o a medida. Si tenés muchos de stock, lo más rápido es subir tu lista en una
                  planilla (CSV o Excel).
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="secondary" onClick={() => setImportando(true)}>
                    Importar planilla
                  </Button>
                  <Button onClick={() => router.push("/productos/nuevo")}>Cargar mi primer producto</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="search"
                    value={consulta}
                    onChange={(e) => setConsulta(e.target.value)}
                    placeholder="Buscar por nombre, código o descripción"
                    aria-label="Buscar productos"
                    className="w-full rounded-md border border-line bg-card px-3 py-2.5 text-[14.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]"
                  />
                  <select
                    value={categoria}
                    onChange={(e) => {
                      setCategoria(e.target.value);
                      setPagina(1);
                    }}
                    aria-label="Filtrar por categoría"
                    className="rounded-md border border-line bg-card px-3 py-2.5 text-[14.5px] text-ink sm:w-56"
                  >
                    <option value="">Todas las categorías</option>
                    {categorias.map((c) => (
                      <option key={c.nombre} value={c.nombre}>
                        {c.nombre} ({c.cantidad})
                      </option>
                    ))}
                  </select>
                </div>

                {error && (
                  <p role="alert" className="text-sm text-danger-text">
                    No pudimos cargar tus productos. Probá de nuevo en un rato.
                  </p>
                )}

                {listado && (
                  <>
                    <p className="text-[12.5px] text-muted">
                      {listado.total === 1 ? "1 producto" : `${listado.total.toLocaleString("es-AR")} productos`}
                    </p>
                    <ul aria-label="Productos" className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-3">
                      {listado.productos.map((producto) => (
                        <FilaProducto
                          key={producto.id}
                          producto={producto}
                          onCambio={reemplazar}
                          onEditar={() => router.push(`/productos/${encodeURIComponent(producto.id)}`)}
                          onBorrar={() => borrar(producto)}
                        />
                      ))}
                    </ul>
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
                  </>
                )}
              </>
            )}
          </div>

          {!catalogoVacio && (
            <aside aria-label="Herramientas del catálogo" className="flex flex-col gap-4 lg:sticky lg:top-5">
              <ProbarBusqueda />
              <Promociones categorias={categorias} onCambio={recargar} />
            </aside>
          )}
        </div>
      </div>

    </main>
  );
}
