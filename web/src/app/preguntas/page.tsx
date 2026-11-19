"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { EditorPregunta, type ProductoElegible } from "@/components/preguntas/EditorPregunta";
import { VistaPrevia } from "@/components/preguntas/VistaPrevia";
import { Button } from "@/components/ui/Button";
import { useAvisos } from "@/components/ui/Avisos";
import { cn } from "@/lib/cn";
import {
  coherentes,
  guardarPreguntas,
  MAX_PREGUNTAS,
  obtenerPreguntas,
  preguntaNueva,
  problemaDe,
  type PreguntaPedido,
} from "@/lib/preguntas";
import { ErrorDeApi, listarProductos } from "@/lib/productos";
import { useMediaQuery } from "@/lib/pantalla";
import { useRequireSession } from "@/lib/session";

function Cargando() {
  return (
    <main className="grid min-h-dvh place-items-center bg-page p-6">
      <p className="text-sm text-muted">Cargando las preguntas…</p>
    </main>
  );
}

export default function PreguntasPage() {
  const { user, status } = useRequireSession();
  const router = useRouter();
  const esVentas = user?.tipoAsistente === "ventas";

  // Una cuenta de agenda no arma pedidos.
  useEffect(() => {
    if (status === "authenticated" && user && !esVentas) router.replace("/inicio");
  }, [status, user, esVentas, router]);

  if (status !== "authenticated" || !user || !esVentas) return <Cargando />;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="preguntas" user={user} />
      <Preguntas />
    </div>
  );
}

/** Todo el catálogo activo, para elegir a qué productos aplica una pregunta. */
async function todosLosProductos(): Promise<ProductoElegible[]> {
  const productos: ProductoElegible[] = [];
  for (let pagina = 1; pagina <= 50; pagina++) {
    const listado = await listarProductos({ pagina });
    productos.push(...listado.productos.map((producto) => ({ id: producto.id, nombre: producto.nombre })));
    if (pagina * listado.porPagina >= listado.total || listado.productos.length === 0) break;
  }
  return productos;
}

function etiquetaDeAlcance(pregunta: PreguntaPedido, porId: Map<string, ProductoElegible>): string {
  if (pregunta.alcance === "global") return "Todos los pedidos";
  const nombres = pregunta.productos.map((id) => porId.get(id)?.nombre ?? "Producto que ya no está");
  return nombres.length <= 2 ? nombres.join(", ") : `${nombres.slice(0, 2).join(", ")} y ${nombres.length - 2} más`;
}

function Preguntas() {
  const { avisar, confirmar } = useAvisos();
  const [preguntas, setPreguntas] = useState<PreguntaPedido[] | null>(null);
  const [guardadas, setGuardadas] = useState<string>("[]");
  const [productos, setProductos] = useState<ProductoElegible[]>([]);
  const [elegida, setElegida] = useState<string | null>(null);
  const [rama, setRama] = useState<string | null>(null);
  // En el celular se ve la lista o el editor de a uno.
  const [editandoEnCelular, setEditandoEnCelular] = useState(false);
  // Con menos de 1440px la vista previa es una pestaña del editor.
  const [vista, setVista] = useState<"editar" | "previa">("editar");
  const conColumnaPrevia = useMediaQuery("(min-width: 1440px)");
  // Guardar va arriba desde md; en el celular, en una barra fija abajo. Uno solo, para no repetir el aviso.
  const guardarArriba = useMediaQuery("(min-width: 768px)");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    Promise.all([obtenerPreguntas(), todosLosProductos()])
      .then(([lista, catalogo]) => {
        if (!vigente) return;
        setPreguntas(lista);
        setGuardadas(JSON.stringify(lista));
        setProductos(catalogo);
        setElegida(lista[0]?.id ?? null);
      })
      .catch(() => vigente && setError("No pudimos cargar las preguntas. Probá de nuevo en un rato."));
    return () => {
      vigente = false;
    };
  }, []);

  const hayCambios = preguntas !== null && JSON.stringify(preguntas) !== guardadas;

  // Avisa antes de cerrar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!hayCambios) return;
    const avisarAlSalir = (evento: BeforeUnloadEvent) => evento.preventDefault();
    window.addEventListener("beforeunload", avisarAlSalir);
    return () => window.removeEventListener("beforeunload", avisarAlSalir);
  }, [hayCambios]);

  const porId = useMemo(() => new Map(productos.map((producto) => [producto.id, producto])), [productos]);

  if (error) {
    return (
      <main className="w-full flex-1 px-4 py-8 md:px-6 xl:px-8">
        <p role="alert" className="rounded-md bg-danger-subtle px-4 py-3 text-danger-text">
          {error}
        </p>
      </main>
    );
  }
  if (preguntas === null) return <Cargando />;

  const indice = preguntas.findIndex((pregunta) => pregunta.id === elegida);
  const actual = indice >= 0 ? preguntas[indice] : null;

  const cambiarTodas = (nuevas: PreguntaPedido[]) => setPreguntas(coherentes(nuevas));

  const agregar = () => {
    if (preguntas.length >= MAX_PREGUNTAS) {
      avisar(`Podés tener hasta ${MAX_PREGUNTAS} preguntas.`, "error");
      return;
    }
    const nueva = preguntaNueva();
    cambiarTodas([...preguntas, nueva]);
    setElegida(nueva.id);
    setRama(null);
    setVista("editar");
    setEditandoEnCelular(true);
  };

  const mover = (desde: number, delta: -1 | 1) => {
    const hasta = desde + delta;
    if (hasta < 0 || hasta >= preguntas.length) return;
    const copia = [...preguntas];
    [copia[desde], copia[hasta]] = [copia[hasta], copia[desde]];
    // Una pregunta no puede quedar antes de la que depende.
    const rompe = copia.some((pregunta, posicion) => {
      const padre = pregunta.dependeDe ? copia.findIndex((otra) => otra.id === pregunta.dependeDe?.preguntaId) : -1;
      return padre > posicion;
    });
    if (rompe) {
      avisar("Una pregunta que depende de otra tiene que ir después de esa.", "info");
      return;
    }
    cambiarTodas(copia);
  };

  const eliminar = async (pregunta: PreguntaPedido) => {
    const dependientes = preguntas.filter((otra) => otra.dependeDe?.preguntaId === pregunta.id);
    const ok = await confirmar({
      titulo: "¿Eliminar la pregunta?",
      texto:
        dependientes.length > 0
          ? "Las preguntas que dependen de ésta pasan a hacerse siempre. Se borra al guardar los cambios."
          : "Se borra al guardar los cambios. Los pedidos ya hechos conservan sus respuestas.",
      confirmar: "Sí, eliminar",
      tono: "peligro",
    });
    if (!ok) return;
    const restantes = preguntas.filter((otra) => otra.id !== pregunta.id);
    cambiarTodas(restantes);
    setElegida(restantes[Math.max(0, indice - 1)]?.id ?? null);
    setEditandoEnCelular(false);
  };

  const guardar = async () => {
    const problema = problemaDe(preguntas);
    if (problema) {
      avisar(problema, "error");
      return;
    }
    setGuardando(true);
    try {
      const guardadasAhora = await guardarPreguntas(preguntas);
      setPreguntas(guardadasAhora);
      setGuardadas(JSON.stringify(guardadasAhora));
      avisar("Preguntas guardadas. El asistente ya las usa.", "exito");
    } catch (err) {
      avisar(err instanceof ErrorDeApi ? err.message : "No pudimos guardar las preguntas. Probá de nuevo.", "error");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <main className="flex w-full flex-1 flex-col gap-6 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16 xl:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className={cn("flex max-w-[680px] flex-col gap-1", editandoEnCelular && "max-md:hidden")}>
          <h1 className="font-display text-[30px] leading-tight font-extrabold text-ink">Preguntas</h1>
          <p className="text-ink-secondary">
            Lo que el asistente le pregunta al cliente mientras arma el pedido. Las opciones pueden cambiar según una
            respuesta anterior. No cambian el precio.
          </p>
        </div>
        <div className={cn("flex flex-wrap items-center gap-3 max-md:w-full", editandoEnCelular && "max-md:hidden")}>
          {preguntas.length > 0 && guardarArriba && (
            <span className="text-[13.5px] text-ink-secondary" aria-live="polite">
              {hayCambios ? "Tenés cambios sin guardar." : "Todo guardado."}
            </span>
          )}
          <Button type="button" variant={preguntas.length > 0 ? "secondary" : "primary"} onClick={agregar} className="max-md:w-full">
            Nueva pregunta
          </Button>
          {preguntas.length > 0 && guardarArriba && (
            <Button type="button" onClick={() => void guardar()} disabled={!hayCambios || guardando}>
              {guardando ? "Guardando…" : "Guardar cambios"}
            </Button>
          )}
        </div>
      </div>

      {preguntas.length === 0 ? (
        <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line-strong bg-card p-6">
          <h2 className="font-display text-[17px] font-bold text-ink">Todavía no hay preguntas</h2>
          <p className="max-w-[560px] text-[14px] text-ink-secondary">
            Por ejemplo: «¿Qué tela querés?» para tus sillones, con colores distintos según la tela, o «¿Querés agregar
            algo más al pedido?» en todos los pedidos.
          </p>
          <Button type="button" variant="secondary" onClick={agregar}>
            Crear la primera
          </Button>
        </section>
      ) : (
        <div className="grid items-start gap-5 md:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] min-[1440px]:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(300px,400px)] min-[1440px]:gap-6">
          <section
            aria-labelledby="orden"
            className={cn("flex min-w-0 flex-col gap-2.5 md:sticky md:top-4", editandoEnCelular && "max-md:hidden")}
          >
            <div>
              <h2 id="orden" className="font-display text-[15px] font-bold text-ink">
                Orden en el pedido
              </h2>
              <p className="text-[13px] text-ink-secondary">
                Las de todos los pedidos se hacen una vez; las de producto, por cada producto que las tenga.
              </p>
            </div>
            <ol className="flex flex-col gap-2">
              {preguntas.map((pregunta, posicion) => {
                const seleccionada = pregunta.id === elegida;
                const padre = pregunta.dependeDe ? preguntas.find((otra) => otra.id === pregunta.dependeDe?.preguntaId) : undefined;
                return (
                  <li
                    key={pregunta.id}
                    className={cn(
                      "flex items-stretch rounded-md border shadow-sm",
                      seleccionada ? "border-primary bg-primary-subtle" : "border-line bg-card",
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={seleccionada}
                      onClick={() => {
                        setElegida(pregunta.id);
                        setRama(null);
                        setEditandoEnCelular(true);
                      }}
                      className="flex min-w-0 flex-1 gap-3 py-3 pr-2 pl-3.5 text-left"
                    >
                      <span className="grid size-6 flex-none place-items-center rounded-full bg-sunken text-[12px] font-bold text-ink-secondary">
                        {posicion + 1}
                      </span>
                      <span className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-[14.5px] font-semibold break-words text-ink">
                          {pregunta.texto.trim() || "Pregunta sin texto"}
                        </span>
                        <span className="flex flex-wrap gap-1.5">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[12px] font-semibold",
                              pregunta.alcance === "global" ? "bg-accent-subtle text-success-text" : "bg-sunken text-ink-secondary",
                            )}
                          >
                            {etiquetaDeAlcance(pregunta, porId)}
                          </span>
                          {pregunta.tipo === "texto" && (
                            <span className="rounded-full bg-sunken px-2 py-0.5 text-[12px] font-semibold text-ink-secondary">
                              Texto libre
                            </span>
                          )}
                          {pregunta.otra && (
                            <span className="rounded-full bg-primary-subtle px-2 py-0.5 text-[12px] font-semibold text-primary-active">
                              Acepta otro
                            </span>
                          )}
                        </span>
                        {padre && (
                          <span className="text-[12.5px] text-ink-secondary">
                            Según: {padre.texto.trim() || "pregunta sin texto"}
                          </span>
                        )}
                      </span>
                    </button>
                    <span className="flex flex-col justify-center pr-1">
                      <button
                        type="button"
                        aria-label={`Subir la pregunta ${posicion + 1}`}
                        disabled={posicion === 0}
                        onClick={() => mover(posicion, -1)}
                        className="grid h-9 w-11 place-items-center rounded-sm text-ink-secondary hover:bg-sunken disabled:opacity-30"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m18 15-6-6-6 6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        aria-label={`Bajar la pregunta ${posicion + 1}`}
                        disabled={posicion === preguntas.length - 1}
                        onClick={() => mover(posicion, 1)}
                        className="grid h-9 w-11 place-items-center rounded-sm text-ink-secondary hover:bg-sunken disabled:opacity-30"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>

          {actual && (
            <div className={cn("flex min-w-0 flex-col gap-3", !editandoEnCelular && "max-md:hidden")}>
              <div className="flex flex-wrap items-center justify-between gap-2 min-[1440px]:hidden">
                <button
                  type="button"
                  onClick={() => setEditandoEnCelular(false)}
                  className="inline-flex min-h-11 items-center gap-1 text-[14px] font-bold text-link md:hidden"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                  Preguntas ({preguntas.length})
                </button>
                <div role="tablist" aria-label="Vista de la pregunta" className="ml-auto flex gap-1 rounded-md bg-sunken p-1">
                  {(
                    [
                      ["editar", "Editar"],
                      ["previa", "Así lo ve el cliente"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={vista === id}
                      onClick={() => setVista(id)}
                      className={cn(
                        "min-h-9 rounded-sm px-3 text-[13.5px]",
                        vista === id ? "bg-card font-bold text-ink shadow-sm" : "font-semibold text-ink-secondary",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {vista === "previa" && !conColumnaPrevia && <VistaPrevia pregunta={actual} todas={preguntas} rama={rama} />}
              <div className={cn(vista === "previa" && "max-[1439px]:hidden")}>
                <EditorPregunta
                  key={actual.id}
                  pregunta={actual}
                  numero={indice + 1}
                  anteriores={preguntas.slice(0, indice)}
                  productos={productos}
                  rama={rama}
                  onRama={setRama}
                  onCambio={(cambiada) => cambiarTodas(preguntas.map((otra) => (otra.id === cambiada.id ? cambiada : otra)))}
                  onEliminar={() => void eliminar(actual)}
                />
              </div>
            </div>
          )}

          {actual && conColumnaPrevia && (
            <div className="sticky top-4 min-w-0">
              <VistaPrevia pregunta={actual} todas={preguntas} rama={rama} />
            </div>
          )}
        </div>
      )}

      {(hayCambios || preguntas.length > 0) && !guardarArriba && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-lg border border-line bg-card p-3 shadow-lg">
          <span className="text-[13.5px] text-ink-secondary" aria-live="polite">
            {hayCambios ? "Tenés cambios sin guardar." : "Todo guardado."}
          </span>
          <Button type="button" onClick={() => void guardar()} disabled={!hayCambios || guardando} className="max-md:w-full">
            {guardando ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      )}
    </main>
  );
}
