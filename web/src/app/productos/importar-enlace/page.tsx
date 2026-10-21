"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TarjetaBorrador } from "@/components/importacion/TarjetaBorrador";
import { MarcoDeProducto } from "@/components/productos/MarcoDeProducto";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  confirmar,
  enlacesDe,
  enRevision,
  EXPLICACION_ERROR,
  extraer,
  MAX_PRODUCTOS_POR_CONFIRMACION,
  MAX_URLS_POR_PEDIDO,
  problemaDelProducto,
  SinPlanProError,
  type ProductoEnRevision,
  type ResultadoConfirmacion,
  type ResultadoExtraccion,
} from "@/lib/importacion";
import { ErrorDeApi } from "@/lib/productos";
import { useSuscripcion } from "@/lib/suscripcion";

type Paso =
  | { tipo: "enlaces" }
  | { tipo: "leyendo"; hecho: number; total: number }
  | { tipo: "revision" }
  | { tipo: "guardando"; hecho: number; total: number }
  | { tipo: "listo"; resultados: ResultadoConfirmacion["resultados"] };

const ESTADO: Record<ResultadoConfirmacion["resultados"][number]["estado"], { texto: string; tono: "success" | "neutral" | "danger" }> = {
  creado: { texto: "Importado", tono: "success" },
  actualizado: { texto: "Actualizado", tono: "success" },
  salteado: { texto: "Salteado", tono: "neutral" },
  error: { texto: "No se importó", tono: "danger" },
};

const FOTO: Record<ResultadoConfirmacion["resultados"][number]["foto"], string | null> = {
  guardada: "con foto",
  sin_foto: null,
  fallo: "la foto no se pudo bajar: subila desde Editar",
  limite: "sin foto: llegaste al tope de fotos de la cuenta",
};

/** Lo que se le cuenta a quien no tiene el Pro: qué hace y dónde se consigue. */
function AvisoPlanPro() {
  return (
    <div className="rounded-lg border border-line bg-card p-5">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone="primary">Pro</Badge>
        <p className="font-semibold text-ink">La importación rápida es del plan Pro</p>
      </div>
      <p className="mb-4 text-sm leading-[1.6] text-ink-secondary">
        Pegás enlaces de Mercado Libre, Tiendamia o de cualquier tienda y traemos nombre, descripción, fotos, precio y
        variantes para que los revises antes de cargarlos. Mientras tanto podés cargar tus productos de a uno o con una
        planilla.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/plan"
          className="inline-flex items-center justify-center rounded-md border border-transparent bg-primary px-4 py-2 font-body text-[15px] leading-none font-semibold text-primary-on shadow-sm hover:bg-primary-hover"
        >
          Ver el plan Pro
        </Link>
        <Link
          href="/productos"
          className="inline-flex items-center justify-center rounded-md border border-line-strong bg-card px-4 py-2 font-body text-[15px] leading-none font-semibold text-ink shadow-sm hover:bg-sunken"
        >
          Volver a mis productos
        </Link>
      </div>
    </div>
  );
}

function ImportarDesdeEnlaces() {
  const router = useRouter();
  const { suscripcion } = useSuscripcion();
  const [texto, setTexto] = useState("");
  const [paso, setPaso] = useState<Paso>({ tipo: "enlaces" });
  const [productos, setProductos] = useState<ProductoEnRevision[]>([]);
  const [errores, setErrores] = useState<ResultadoExtraccion["errores"]>([]);
  const [recortado, setRecortado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinPro, setSinPro] = useState(false);

  const enlaces = enlacesDe(texto);
  const elegidos = productos.filter((producto) => producto.elegido);
  const problema = elegidos.map(problemaDelProducto).find(Boolean) ?? null;
  const ocupado = paso.tipo === "leyendo" || paso.tipo === "guardando";

  // Con productos leídos sin guardar, irse de la página pregunta antes.
  useEffect(() => {
    if (paso.tipo !== "revision" || elegidos.length === 0) return;
    const alSalir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [paso.tipo, elegidos.length]);

  if (suscripcion === null) return <p className="py-10 text-center text-sm text-muted">Cargando…</p>;
  if (sinPro || !suscripcion.funciones?.importacionRapida) return <AvisoPlanPro />;

  const fallar = (err: unknown, porDefecto: string) => {
    if (err instanceof SinPlanProError) setSinPro(true);
    setError(err instanceof ErrorDeApi ? err.message : porDefecto);
  };

  /** Un enlace por pedido: así se ve el progreso y uno lento no frena a los demás. */
  const leer = async () => {
    if (enlaces.length === 0) {
      setError("Pegá al menos un enlace que empiece con https://.");
      return;
    }
    if (enlaces.length > MAX_URLS_POR_PEDIDO) {
      setError(`Pegá hasta ${MAX_URLS_POR_PEDIDO} enlaces por vez.`);
      return;
    }
    setError(null);
    const encontrados: ProductoEnRevision[] = [];
    const fallidos: ResultadoExtraccion["errores"] = [];
    let alguno = false;
    for (const [indice, enlace] of enlaces.entries()) {
      setPaso({ tipo: "leyendo", hecho: indice, total: enlaces.length });
      try {
        const resultado = await extraer([enlace]);
        const vistos = new Set(encontrados.map((producto) => producto.borrador.claveOrigen));
        encontrados.push(...resultado.productos.filter((p) => !vistos.has(p.claveOrigen)).map(enRevision));
        fallidos.push(...resultado.errores);
        alguno ||= resultado.recortado;
      } catch (err) {
        fallar(err, "No pudimos leer los enlaces. Probá de nuevo.");
        if (err instanceof SinPlanProError || !(err instanceof ErrorDeApi)) {
          setPaso({ tipo: "enlaces" });
          return;
        }
        // Un límite de uso (429) frena los que faltan; lo leído hasta acá queda.
        break;
      }
    }
    setProductos(encontrados);
    setErrores(fallidos);
    setRecortado(alguno);
    setPaso({ tipo: "revision" });
  };

  const guardar = async () => {
    if (problema) {
      setError(problema);
      return;
    }
    setError(null);
    const resultados: ResultadoConfirmacion["resultados"] = [];
    for (let desde = 0; desde < elegidos.length; desde += MAX_PRODUCTOS_POR_CONFIRMACION / 2) {
      setPaso({ tipo: "guardando", hecho: desde, total: elegidos.length });
      try {
        const tanda = await confirmar(elegidos.slice(desde, desde + MAX_PRODUCTOS_POR_CONFIRMACION / 2));
        resultados.push(...tanda.resultados);
      } catch (err) {
        // Lo guardado hasta acá queda guardado; reintentar no lo duplica (la API lo reconoce por su origen).
        fallar(err, "No pudimos guardar todos los productos. Probá de nuevo: lo que ya se guardó no se duplica.");
        if (resultados.length === 0) {
          setPaso({ tipo: "revision" });
          return;
        }
        break;
      }
    }
    setPaso({ tipo: "listo", resultados });
  };

  const cambiar = (clave: string, cambios: Partial<ProductoEnRevision>) =>
    setProductos((actuales) => actuales.map((p) => (p.borrador.claveOrigen === clave ? { ...p, ...cambios } : p)));

  if (paso.tipo === "listo") {
    const porClave = new Map(productos.map((producto) => [producto.borrador.claveOrigen, producto]));
    const importados = paso.resultados.filter((r) => r.estado === "creado" || r.estado === "actualizado").length;
    return (
      <section aria-labelledby="titulo-resultado" className="flex flex-col gap-4">
        <h2 id="titulo-resultado" className="font-display text-[19px] font-bold text-ink">
          {importados === 1 ? "Se importó 1 producto" : `Se importaron ${importados} productos`}
        </h2>
        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {paso.resultados.map((resultado) => {
            const estado = ESTADO[resultado.estado];
            const foto = FOTO[resultado.foto];
            return (
              <li key={resultado.claveOrigen} className="flex flex-wrap items-center gap-2 rounded-md bg-card px-3 py-2.5 text-[14px]">
                <Badge tone={estado.tono}>{estado.texto}</Badge>
                <span className="font-semibold text-ink">{porClave.get(resultado.claveOrigen)?.nombre ?? "Producto"}</span>
                {(resultado.motivo || foto) && (
                  <span className="text-[13px] text-ink-secondary">· {resultado.motivo ?? foto}</span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => router.push("/productos")}>Ver mis productos</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setTexto("");
              setProductos([]);
              setErrores([]);
              setError(null);
              setPaso({ tipo: "enlaces" });
            }}
          >
            Importar más
          </Button>
        </div>
      </section>
    );
  }

  if (paso.tipo === "revision" || paso.tipo === "guardando") {
    return (
      <section aria-labelledby="titulo-revision" className="flex flex-col gap-4">
        <div>
          <h2 id="titulo-revision" className="font-display text-[19px] font-bold text-ink">
            {productos.length === 0
              ? "No encontramos productos"
              : productos.length === 1
                ? "Encontramos 1 producto"
                : `Encontramos ${productos.length} productos`}
          </h2>
          <p className="text-sm text-ink-secondary">
            Revisá cada uno: corregí lo que haga falta, completá lo que la página no decía y destildá lo que no quieras.
          </p>
          {recortado && (
            <p className="mt-1 text-[13px] text-ink-secondary">
              El listado tenía más productos de los que se leen de una vez: pegá los enlaces de los que falten.
            </p>
          )}
        </div>

        {errores.length > 0 && (
          <div role="status" className="rounded-md border border-line bg-card p-3">
            <p className="mb-1.5 text-[13.5px] font-semibold text-ink">
              {errores.length === 1 ? "1 enlace no se pudo leer" : `${errores.length} enlaces no se pudieron leer`}
            </p>
            <ul className="flex flex-col gap-1.5 text-[13px] text-ink-secondary">
              {errores.map((fallo) => (
                <li key={`${fallo.url}-${fallo.codigo}`} className="break-all">
                  <span className="text-muted">{fallo.url}</span>
                  <span className="block break-normal">{EXPLICACION_ERROR[fallo.codigo]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {productos.map((producto) => (
            <TarjetaBorrador
              key={producto.borrador.claveOrigen}
              producto={producto}
              onCambio={(cambios) => cambiar(producto.borrador.claveOrigen, cambios)}
            />
          ))}
        </ul>

        <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-card px-4 py-3 shadow-[0_-4px_12px_rgba(44,44,42,0.06)] sm:-mx-5 sm:px-5">
          {error && (
            <p role="alert" className="mb-2 text-sm text-danger-text">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <p className="mr-auto basis-full text-[13px] text-ink-secondary sm:basis-auto">
              {paso.tipo === "guardando"
                ? `Guardando ${Math.min(paso.hecho + 1, paso.total)} de ${paso.total}…`
                : (problema ?? (elegidos.length === 0 ? "No elegiste ningún producto." : "Listo para importar."))}
            </p>
            <Button variant="secondary" disabled={ocupado} onClick={() => setPaso({ tipo: "enlaces" })}>
              Volver
            </Button>
            <Button disabled={ocupado || elegidos.length === 0 || problema !== null} onClick={guardar}>
              {elegidos.length === 1 ? "Importar 1 producto" : `Importar ${elegidos.length} productos`}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Enlaces para importar" className="flex flex-col gap-3 rounded-lg border border-line bg-card p-5">
      <label htmlFor="enlaces" className="font-semibold text-ink">
        Pegá los enlaces
      </label>
      <p className="text-[13.5px] leading-[1.6] text-ink-secondary">
        Uno por línea, hasta {MAX_URLS_POR_PEDIDO}: una publicación de Mercado Libre, un producto de Tiendamia o de tu
        tienda online. También un listado (tu tienda de Mercado Libre o una categoría de tu web) para traer varios de una
        vez. Nada se carga hasta que lo revises.
      </p>
      <textarea
        id="enlaces"
        value={texto}
        rows={6}
        disabled={ocupado}
        placeholder={"https://articulo.mercadolibre.com.ar/MLA-…\nhttps://tutienda.com/productos/…"}
        onChange={(e) => setTexto(e.target.value)}
        className="w-full rounded-md border border-line bg-card px-3 py-2.5 font-mono text-[13.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]"
      />
      {error && (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p aria-live="polite" className="mr-auto text-[13px] text-ink-secondary">
          {paso.tipo === "leyendo"
            ? `Leyendo ${paso.hecho + 1} de ${paso.total}…`
            : enlaces.length === 1
              ? "1 enlace"
              : `${enlaces.length} enlaces`}
        </p>
        <Button disabled={ocupado || enlaces.length === 0} onClick={leer}>
          {paso.tipo === "leyendo" ? "Leyendo…" : "Leer enlaces"}
        </Button>
      </div>
    </section>
  );
}

/** Importación rápida (LAU-31): de enlaces de otros sitios a productos del catálogo, revisados antes. Plan Pro. */
export default function ImportarDesdeEnlacePage() {
  return (
    <MarcoDeProducto>
      <main className="flex flex-1 flex-col bg-page">
        <div className="mx-auto flex w-full max-w-[920px] flex-1 flex-col gap-5 px-4 pt-5 pb-8 sm:px-5">
          <div className="flex flex-col gap-2">
            <nav aria-label="Ruta">
              <ol className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-muted">
                <li>
                  <Link href="/productos" className="font-semibold text-[var(--color-semantic-text-link)] hover:underline">
                    Productos
                  </Link>
                </li>
                <li aria-hidden>/</li>
                <li aria-current="page">Importar desde un enlace</li>
              </ol>
            </nav>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="font-display text-[27px] leading-[1.15] font-bold tracking-[-0.025em] text-ink">
                Importar desde un enlace
              </h1>
              <Badge tone="primary">Pro</Badge>
            </div>
          </div>
          <ImportarDesdeEnlaces />
        </div>
      </main>
    </MarcoDeProducto>
  );
}
