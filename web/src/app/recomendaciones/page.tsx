"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import type { ProductoElegible } from "@/components/preguntas/EditorPregunta";
import { INPUT, LABEL } from "@/components/productos/EditorProducto";
import { EditorRecomendacion } from "@/components/recomendaciones/EditorRecomendacion";
import { ProbadorRecomendaciones } from "@/components/recomendaciones/ProbadorRecomendaciones";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAvisos } from "@/components/ui/Avisos";
import { cn } from "@/lib/cn";
import { useMediaQuery } from "@/lib/pantalla";
import { obtenerPreguntas, type PreguntaPedido } from "@/lib/preguntas";
import { ErrorDeApi, listarProductos } from "@/lib/productos";
import {
  ETIQUETA_ACCION,
  MAX_RECOMENDACIONES,
  conPropiedades,
  guardarRecomendaciones,
  obtenerRecomendaciones,
  problemaDe,
  recomendacionNueva,
  type ConfiguracionRecomendaciones,
  type Recomendacion,
} from "@/lib/recomendaciones";
import { useRequireSession } from "@/lib/session";

function Cargando() {
  return (
    <main className="grid min-h-dvh place-items-center bg-page p-6">
      <p className="text-sm text-muted">Cargando las recomendaciones…</p>
    </main>
  );
}

export default function RecomendacionesPage() {
  const { user, status } = useRequireSession();
  const router = useRouter();
  const esVentas = user?.tipoAsistente === "ventas";

  // Una cuenta de agenda no tiene catálogo.
  useEffect(() => {
    if (status === "authenticated" && user && !esVentas) router.replace("/inicio");
  }, [status, user, esVentas, router]);

  if (status !== "authenticated" || !user || !esVentas) return <Cargando />;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="recomendaciones" user={user} />
      <Recomendaciones />
    </div>
  );
}

/** Todo el catálogo activo, para vincular productos. */
async function todosLosProductos(): Promise<ProductoElegible[]> {
  const productos: ProductoElegible[] = [];
  for (let pagina = 1; pagina <= 50; pagina++) {
    const listado = await listarProductos({ pagina });
    productos.push(...listado.productos.map((producto) => ({ id: producto.id, nombre: producto.nombre })));
    if (pagina * listado.porPagina >= listado.total || listado.productos.length === 0) break;
  }
  return productos;
}

/** Las filas de propiedades vacías no se guardan. */
function sinFilasVacias(configuracion: ConfiguracionRecomendaciones): ConfiguracionRecomendaciones {
  return {
    ...configuracion,
    propiedades: configuracion.propiedades
      .map((entrada) => ({ ...entrada, propiedades: entrada.propiedades.filter((p) => p.nombre.trim() || p.valor.trim()) }))
      .filter((entrada) => entrada.propiedades.length > 0),
  };
}

function cuandoDe(regla: Recomendacion, preguntas: PreguntaPedido[]): { etiqueta: string; detalle: string } {
  if (regla.disparador.tipo === "consulta") {
    return { etiqueta: "Consulta", detalle: regla.disparador.necesidad.trim() || "Sin describir" };
  }
  if (regla.disparador.tipo === "pregunta") {
    const { preguntaId, necesidad } = regla.disparador;
    const pregunta = preguntas.find((p) => p.id === preguntaId);
    if (!pregunta) return { etiqueta: "En una pregunta", detalle: "La pregunta ya no existe" };
    return { etiqueta: "En una pregunta", detalle: `«${pregunta.texto}» · ${necesidad.trim() || "Sin describir"}` };
  }
  const { preguntaId, opciones } = regla.disparador;
  const pregunta = preguntas.find((p) => p.id === preguntaId);
  if (!pregunta) return { etiqueta: "Paso del pedido", detalle: "La pregunta ya no existe" };
  const respuestas = pregunta.opciones.filter((o) => opciones.includes(o.id)).map((o) => o.texto);
  return { etiqueta: "Paso del pedido", detalle: `«${pregunta.texto}»${respuestas.length > 0 ? ` → ${respuestas.join(", ")}` : ""}` };
}

function Recomendaciones() {
  const { avisar, confirmar } = useAvisos();
  const [configuracion, setConfiguracion] = useState<ConfiguracionRecomendaciones | null>(null);
  const [guardada, setGuardada] = useState("");
  const [preguntas, setPreguntas] = useState<PreguntaPedido[]>([]);
  const [productos, setProductos] = useState<ProductoElegible[]>([]);
  const [elegida, setElegida] = useState<string | null>(null);
  // En el celular se ve la lista o el editor de a uno.
  const [editandoEnCelular, setEditandoEnCelular] = useState(false);
  const conColumnaProbador = useMediaQuery("(min-width: 1440px)");
  const guardarArriba = useMediaQuery("(min-width: 768px)");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    Promise.all([obtenerRecomendaciones(), obtenerPreguntas(), todosLosProductos()])
      .then(([config, lista, catalogo]) => {
        if (!vigente) return;
        setConfiguracion(config);
        setGuardada(JSON.stringify(config));
        setPreguntas(lista);
        setProductos(catalogo);
        setElegida(config.recomendaciones[0]?.id ?? null);
      })
      .catch(() => vigente && setError("No pudimos cargar las recomendaciones. Probá de nuevo en un rato."));
    return () => {
      vigente = false;
    };
  }, []);

  const hayCambios = configuracion !== null && JSON.stringify(configuracion) !== guardada;

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
  if (configuracion === null) return <Cargando />;

  const reglas = configuracion.recomendaciones;
  const indice = reglas.findIndex((regla) => regla.id === elegida);
  const actual = indice >= 0 ? reglas[indice] : null;
  const cambiarReglas = (nuevas: Recomendacion[]) => setConfiguracion({ ...configuracion, recomendaciones: nuevas });

  const agregar = () => {
    if (reglas.length >= MAX_RECOMENDACIONES) {
      avisar(`Podés tener hasta ${MAX_RECOMENDACIONES} recomendaciones.`, "error");
      return;
    }
    const nueva = recomendacionNueva();
    cambiarReglas([...reglas, nueva]);
    setElegida(nueva.id);
    setEditandoEnCelular(true);
  };

  const mover = (desde: number, delta: -1 | 1) => {
    const hasta = desde + delta;
    if (hasta < 0 || hasta >= reglas.length) return;
    const copia = [...reglas];
    [copia[desde], copia[hasta]] = [copia[hasta], copia[desde]];
    cambiarReglas(copia);
  };

  const eliminar = async (regla: Recomendacion) => {
    const ok = await confirmar({
      titulo: "¿Eliminar la recomendación?",
      texto: "Se borra al guardar los cambios, en todos los productos donde se usa. Las propiedades cargadas se conservan.",
      confirmar: "Sí, eliminar",
      tono: "peligro",
    });
    if (!ok) return;
    const restantes = reglas.filter((otra) => otra.id !== regla.id);
    cambiarReglas(restantes);
    setElegida(restantes[Math.max(0, indice - 1)]?.id ?? null);
    setEditandoEnCelular(false);
  };

  const guardar = async () => {
    const limpia = sinFilasVacias(configuracion);
    const problema = problemaDe(limpia, preguntas);
    if (problema) {
      avisar(problema, "error");
      return;
    }
    setGuardando(true);
    try {
      const guardadaAhora = await guardarRecomendaciones(limpia);
      setConfiguracion(guardadaAhora);
      setGuardada(JSON.stringify(guardadaAhora));
      avisar("Recomendaciones guardadas. Las activas ya las usa el asistente.", "exito");
    } catch (err) {
      avisar(err instanceof ErrorDeApi ? err.message : "No pudimos guardar las recomendaciones. Probá de nuevo.", "error");
    } finally {
      setGuardando(false);
    }
  };

  const probador = <ProbadorRecomendaciones hayCambios={hayCambios} />;

  return (
    <main className="flex w-full flex-1 flex-col gap-6 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16 xl:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className={cn("flex max-w-[680px] flex-col gap-1", editandoEnCelular && "max-md:hidden")}>
          <h1 className="font-display text-[30px] leading-tight font-extrabold text-ink">Recomendaciones</h1>
          <p className="text-ink-secondary">
            Lo que el asistente sugiere o responde cuando un cliente cuenta lo que necesita, o después de un paso del
            pedido. Armás una regla una vez y la vinculás con los productos, preguntas u opciones donde aplica.
          </p>
        </div>
        <div className={cn("flex flex-wrap items-center gap-3 max-md:w-full", editandoEnCelular && "max-md:hidden")}>
          {reglas.length > 0 && guardarArriba && (
            <span className="text-[13.5px] text-ink-secondary" aria-live="polite">
              {hayCambios ? "Tenés cambios sin guardar." : "Todo guardado."}
            </span>
          )}
          <Button type="button" variant={reglas.length > 0 ? "secondary" : "primary"} onClick={agregar} className="max-md:w-full">
            Nueva recomendación
          </Button>
          {guardarArriba && (reglas.length > 0 || hayCambios) && (
            <Button type="button" onClick={() => void guardar()} disabled={!hayCambios || guardando}>
              {guardando ? "Guardando…" : "Guardar cambios"}
            </Button>
          )}
        </div>
      </div>

      {reglas.length === 0 ? (
        <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line-strong bg-card p-6">
          <h2 className="font-display text-[17px] font-bold text-ink">Todavía no hay recomendaciones</h2>
          <p className="max-w-[560px] text-[14px] text-ink-secondary">
            Por ejemplo: cuando alguien dice «me cuesta despegar los soportes», recomendar tu filamento soluble y explicar
            por qué; o, en tus sillones, sugerir la tela antimanchas a quien tiene mascotas.
          </p>
          <Button type="button" variant="secondary" onClick={agregar}>
            Crear la primera
          </Button>
        </section>
      ) : (
        <div className="grid items-start gap-5 md:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] min-[1440px]:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(320px,420px)] min-[1440px]:gap-6">
          <div className={cn("flex min-w-0 flex-col gap-4 md:sticky md:top-4", editandoEnCelular && "max-md:hidden")}>
            <section aria-labelledby="orden" className="flex flex-col gap-2.5">
              <div>
                <h2 id="orden" className="font-display text-[15px] font-bold text-ink">
                  Orden de prioridad
                </h2>
                <p className="text-[13px] text-ink-secondary">
                  Si coinciden varias, gana la vinculada al producto que mira el cliente; entre iguales, la que está más
                  arriba.
                </p>
              </div>
              <ol className="flex flex-col gap-2">
                {reglas.map((regla, posicion) => {
                  const seleccionada = regla.id === elegida;
                  const cuando = cuandoDe(regla, preguntas);
                  const alcance =
                    regla.alcance === "global"
                      ? "Todo el catálogo"
                      : `${regla.productos.length} ${regla.productos.length === 1 ? "producto" : "productos"}`;
                  return (
                    <li
                      key={regla.id}
                      className={cn(
                        "flex items-stretch rounded-md border shadow-sm",
                        seleccionada ? "border-primary bg-primary-subtle" : "border-line bg-card",
                      )}
                    >
                      <button
                        type="button"
                        aria-pressed={seleccionada}
                        onClick={() => {
                          setElegida(regla.id);
                          setEditandoEnCelular(true);
                        }}
                        className="flex min-w-0 flex-1 gap-3 py-3 pr-2 pl-3.5 text-left"
                      >
                        <span className="grid size-6 flex-none place-items-center rounded-full bg-sunken text-[12px] font-bold text-ink-secondary">
                          {posicion + 1}
                        </span>
                        <span className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-[14.5px] font-semibold break-words text-ink">
                            {regla.nombre.trim() || "Recomendación sin nombre"}
                          </span>
                          <span className="flex flex-wrap gap-1.5">
                            <Badge tone={regla.activa ? "success" : "neutral"}>{regla.activa ? "Activa" : "Pausada"}</Badge>
                            <Badge tone={regla.disparador.tipo === "consulta" ? "info" : "primary"}>{cuando.etiqueta}</Badge>
                            <Badge>{alcance}</Badge>
                          </span>
                          <span className="line-clamp-2 text-[12.5px] text-ink-secondary">
                            {cuando.detalle} · {ETIQUETA_ACCION[regla.accion.tipo]}
                          </span>
                        </span>
                      </button>
                      <span className="flex flex-col justify-center pr-1">
                        <button
                          type="button"
                          aria-label={`Subir la recomendación ${posicion + 1}`}
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
                          aria-label={`Bajar la recomendación ${posicion + 1}`}
                          disabled={posicion === reglas.length - 1}
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

            <section aria-labelledby="ninguna" className="flex flex-col gap-2 rounded-lg border border-line bg-card p-4">
              <h2 id="ninguna" className="font-display text-[15px] font-bold text-ink">
                Si ninguna aplica
              </h2>
              <div>
                <label htmlFor="sin-coincidencia" className={LABEL}>
                  Qué hace el asistente
                </label>
                <select
                  id="sin-coincidencia"
                  value={configuracion.sinCoincidencia}
                  onChange={(e) =>
                    setConfiguracion({ ...configuracion, sinCoincidencia: e.target.value === "derivar" ? "derivar" : "catalogo" })
                  }
                  className={INPUT}
                >
                  <option value="catalogo">Responde con el catálogo, como siempre</option>
                  <option value="derivar">Si no puede responder, te pasa la conversación</option>
                </select>
              </div>
            </section>
          </div>

          {actual && (
            <div className={cn("flex min-w-0 flex-col gap-3", !editandoEnCelular && "max-md:hidden")}>
              <button
                type="button"
                onClick={() => setEditandoEnCelular(false)}
                className="inline-flex min-h-11 items-center gap-1 self-start text-[14px] font-bold text-link md:hidden"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m15 18-6-6 6-6" />
                </svg>
                Recomendaciones ({reglas.length})
              </button>
              <EditorRecomendacion
                key={actual.id}
                regla={actual}
                configuracion={configuracion}
                preguntas={preguntas}
                productos={productos}
                onCambio={(cambiada) => cambiarReglas(reglas.map((otra) => (otra.id === cambiada.id ? cambiada : otra)))}
                onPropiedades={(elemento, propiedades) => setConfiguracion(conPropiedades(configuracion, elemento, propiedades))}
                onEliminar={() => void eliminar(actual)}
              />
              {!conColumnaProbador && probador}
            </div>
          )}

          {conColumnaProbador && <div className="sticky top-4 min-w-0">{probador}</div>}
        </div>
      )}

      {porId.size === 0 && reglas.length > 0 && (
        <p className="text-[13.5px] text-ink-secondary">Todavía no tenés productos en el catálogo para vincular.</p>
      )}

      {(hayCambios || reglas.length > 0) && !guardarArriba && (
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
