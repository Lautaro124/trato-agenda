"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  asociarAnuncio,
  crearAnuncio,
  eliminarAnuncio,
  listarAnuncios,
  urlMiniaturaAnuncio,
  type Anuncio,
  type Asociacion,
} from "@/lib/anuncios";
import { buscarComoElAsistente, ErrorDeApi, type ProductoEncontrado } from "@/lib/productos";
import { useRequireSession } from "@/lib/session";

const ESTADOS: Record<Asociacion, { texto: string; tono: "success" | "warning" | "neutral" | "info" }> = {
  manual: { texto: "Confirmado", tono: "success" },
  automatica: { texto: "Asociado automáticamente", tono: "info" },
  pendiente: { texto: "Falta elegir el producto", tono: "warning" },
  sin_producto: { texto: "Sin producto", tono: "neutral" },
};

const CAMPO =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-[14px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";

function Cargando() {
  return (
    <main className="grid min-h-dvh place-items-center bg-page p-6">
      <p className="text-sm text-muted">Cargando los anuncios…</p>
    </main>
  );
}

export default function AnunciosPage() {
  const { user, status } = useRequireSession();
  const router = useRouter();
  const vende = user?.tipoAsistente === "ventas";

  // Los anuncios se asocian a productos: una cuenta de agenda vuelve a su pantalla.
  useEffect(() => {
    if (status === "authenticated" && user && !vende) router.replace("/inicio");
  }, [status, user, vende, router]);

  if (status !== "authenticated" || !user || !vende) return <Cargando />;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="anuncios" user={user} />
      <Anuncios />
      <MobileTabBar active="anuncios" />
    </div>
  );
}

function cuando(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

function Anuncios() {
  const [anuncios, setAnuncios] = useState<Anuncio[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    listarAnuncios()
      .then((lista) => vigente && setAnuncios(lista))
      .catch(() => vigente && setError("No pudimos cargar los anuncios. Probá de nuevo en un rato."));
    return () => {
      vigente = false;
    };
  }, []);

  const [agregando, setAgregando] = useState(false);

  const reemplazar = (actualizado: Anuncio) =>
    setAnuncios((lista) => lista?.map((anuncio) => (anuncio.id === actualizado.id ? actualizado : anuncio)) ?? null);
  const agregar = (nuevo: Anuncio) => {
    setAnuncios((lista) => [nuevo, ...(lista ?? [])]);
    setAgregando(false);
  };
  const quitar = (id: string) => setAnuncios((lista) => lista?.filter((anuncio) => anuncio.id !== id) ?? null);

  return (
    <main className="flex-1 bg-page p-5 pb-24 md:pb-8">
      <div className="mx-auto flex max-w-[960px] flex-col gap-5">
        <header>
          <h1 className="mb-1 font-display text-[27px] leading-[1.15] font-bold tracking-[-0.025em] text-ink">
            Anuncios
          </h1>
          <p className="text-sm leading-[1.6] text-ink-secondary">
            Los anuncios de Facebook o Instagram desde los que te escriben. Cuando un cliente llega desde uno, el
            asistente ya sabe de qué producto te habla y no le pregunta qué busca. Revisá que cada anuncio tenga el
            producto correcto.
          </p>
        </header>

        {agregando ? (
          <AgregarAnuncio alGuardar={agregar} alCancelar={() => setAgregando(false)} />
        ) : (
          <div>
            <Button size="sm" onClick={() => setAgregando(true)}>
              Agregar anuncio
            </Button>
          </div>
        )}

        {error ? (
          <p role="alert" className="rounded-md border border-line bg-sunken px-3 py-2 text-[13.5px] text-danger-text">
            {error}
          </p>
        ) : anuncios === null ? (
          <p className="text-sm text-muted">Cargando…</p>
        ) : anuncios.length === 0 ? (
          <p className="rounded-lg border border-line bg-card px-4 py-6 text-center text-[14px] text-ink-secondary">
            Cuando un cliente te escriba desde un anuncio de Facebook o Instagram, va a aparecer acá. También podés
            agregar tus anuncios antes, con su link o su ID, y elegirles el producto.
          </p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Anuncios">
            {anuncios.map((anuncio) => (
              <TarjetaAnuncio key={anuncio.id} anuncio={anuncio} alGuardar={reemplazar} alQuitar={quitar} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function TarjetaAnuncio({
  anuncio,
  alGuardar,
  alQuitar,
}: {
  anuncio: Anuncio;
  alGuardar: (anuncio: Anuncio) => void;
  alQuitar: (id: string) => void;
}) {
  const [eligiendo, setEligiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const estado = ESTADOS[anuncio.asociacion];
  const nombre =
    anuncio.titulo ??
    anuncio.sourceUrl ??
    (anuncio.sourceType === "estado" ? "Estado de WhatsApp" : anuncio.sourceId ? `ID ${anuncio.sourceId}` : "Anuncio sin título");
  const productoVigente = anuncio.producto?.activo ? anuncio.producto : null;

  const guardar = async (productoId: string | null) => {
    setGuardando(true);
    setError(null);
    try {
      alGuardar(await asociarAnuncio(anuncio.id, productoId));
      setEligiendo(false);
    } catch (e) {
      setError(e instanceof ErrorDeApi ? e.message : "No pudimos guardar el cambio.");
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async () => {
    setGuardando(true);
    setError(null);
    try {
      await eliminarAnuncio(anuncio.id);
      alQuitar(anuncio.id);
    } catch (e) {
      setError(e instanceof ErrorDeApi ? e.message : "No pudimos quitar el anuncio.");
      setGuardando(false);
    }
  };

  return (
    <li>
      <article
        aria-label={`Anuncio ${nombre}`}
        className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4 shadow-sm sm:flex-row"
      >
        <div className="size-20 shrink-0 overflow-hidden rounded-md bg-sunken">
          {anuncio.tieneMiniatura ? (
            // eslint-disable-next-line @next/next/no-img-element -- viene de la API con la cookie de sesión; el optimizador de Next no la tiene
            <img src={urlMiniaturaAnuncio(anuncio.id)} alt={`Imagen del anuncio ${nombre}`} className="size-full object-cover" />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-[16px] font-semibold text-ink">{nombre}</h2>
            <Badge tone={estado.tono}>{estado.texto}</Badge>
          </div>
          {anuncio.cuerpo ? <p className="text-[13.5px] leading-[1.5] text-ink-secondary">{anuncio.cuerpo}</p> : null}
          <p className="text-[12.5px] text-muted">
            {anuncio.ultimoChatAt === null
              ? "Todavía sin consultas: cuando un cliente escriba desde este anuncio, el asistente ya va a saber el producto."
              : `${anuncio.chats === 1 ? "1 consulta" : `${anuncio.chats} consultas`} · la última el ${cuando(anuncio.ultimoChatAt)}`}
          </p>

          <p className="text-[14px] text-ink">
            Producto:{" "}
            {productoVigente ? (
              <strong>{productoVigente.nombre}</strong>
            ) : anuncio.producto ? (
              <span className="text-danger-text">{anuncio.producto.nombre} (ya no está en tu catálogo)</span>
            ) : (
              <span className="text-ink-secondary">ninguno</span>
            )}
          </p>

          {eligiendo ? (
            <ElegirProducto
              deshabilitado={guardando}
              alElegir={(producto) => void guardar(producto.productoId)}
              alCancelar={() => setEligiendo(false)}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {anuncio.asociacion === "automatica" && productoVigente ? (
                <Button size="sm" disabled={guardando} onClick={() => void guardar(productoVigente.id)}>
                  Confirmar
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" disabled={guardando} onClick={() => setEligiendo(true)}>
                {anuncio.producto ? "Cambiar producto" : "Elegir producto"}
              </Button>
              {anuncio.asociacion !== "sin_producto" ? (
                <Button size="sm" variant="ghost" disabled={guardando} onClick={() => void guardar(null)}>
                  No es de un producto
                </Button>
              ) : null}
              {anuncio.chats === 0 ? (
                <Button size="sm" variant="ghost" disabled={guardando} onClick={() => void quitar()}>
                  Quitar
                </Button>
              ) : null}
            </div>
          )}
          {error ? (
            <p role="alert" className="text-[13px] text-danger-text">
              {error}
            </p>
          ) : null}
        </div>
      </article>
    </li>
  );
}

/** Busca en el catálogo igual que el asistente y deja elegir uno de los resultados. */
function ElegirProducto({
  deshabilitado,
  alElegir,
  alCancelar,
  enfocar = true,
}: {
  deshabilitado: boolean;
  alElegir: (producto: ProductoEncontrado) => void;
  alCancelar?: () => void;
  enfocar?: boolean;
}) {
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<ProductoEncontrado[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const idCampo = useId();

  const buscar = async () => {
    if (!consulta.trim()) return;
    setBuscando(true);
    try {
      setResultados(await buscarComoElAsistente(consulta.trim()));
    } catch {
      setResultados([]);
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-sunken p-3">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(evento) => {
          evento.preventDefault();
          void buscar();
        }}
      >
        <label className="sr-only" htmlFor={idCampo}>
          Buscar producto
        </label>
        <input
          id={idCampo}
          className={CAMPO}
          placeholder="Nombre o código del producto"
          value={consulta}
          onChange={(evento) => setConsulta(evento.target.value)}
          autoFocus={enfocar}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={buscando || !consulta.trim()}>
            Buscar
          </Button>
          {alCancelar ? (
            <Button size="sm" variant="ghost" onClick={alCancelar}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </form>
      {resultados === null ? null : resultados.length === 0 ? (
        <p className="text-[13px] text-ink-secondary">No encontramos productos con eso.</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Productos encontrados">
          {resultados.map((producto) => (
            <li key={producto.productoId}>
              <button
                type="button"
                disabled={deshabilitado}
                onClick={() => alElegir(producto)}
                className="w-full cursor-pointer rounded-md border border-line bg-card px-3 py-2 text-left text-[14px] text-ink hover:border-line-strong disabled:cursor-not-allowed"
              >
                {producto.nombre}
                <span className="ml-2 text-[12.5px] text-muted">{producto.codigo}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Carga un anuncio antes de que llegue un chat: el link (el de la publicación
 * o el que comparte el Administrador de anuncios) o el "ID del anuncio" de Meta,
 * y el producto que promociona.
 */
function AgregarAnuncio({ alGuardar, alCancelar }: { alGuardar: (anuncio: Anuncio) => void; alCancelar: () => void }) {
  const [anuncio, setAnuncio] = useState("");
  const [nombre, setNombre] = useState("");
  const [producto, setProducto] = useState<ProductoEncontrado | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idAnuncio = useId();
  const idNombre = useId();
  const idAyuda = useId();

  const guardar = async () => {
    if (!anuncio.trim() || !producto) return;
    setGuardando(true);
    setError(null);
    try {
      alGuardar(
        await crearAnuncio({ anuncio: anuncio.trim(), productoId: producto.productoId, nombre: nombre.trim() || undefined }),
      );
    } catch (e) {
      setError(e instanceof ErrorDeApi ? e.message : "No pudimos agregar el anuncio.");
      setGuardando(false);
    }
  };

  return (
    <section aria-label="Agregar anuncio" className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4 shadow-sm">
      <h2 className="font-display text-[16px] font-semibold text-ink">Agregar anuncio</h2>
      <div className="flex flex-col gap-1">
        <label htmlFor={idAnuncio} className="text-[13.5px] font-medium text-ink">
          Link o ID del anuncio
        </label>
        <input
          id={idAnuncio}
          className={CAMPO}
          placeholder="https://fb.me/… o 120210000000000000"
          value={anuncio}
          onChange={(evento) => setAnuncio(evento.target.value)}
          aria-describedby={idAyuda}
          autoFocus
        />
        <p id={idAyuda} className="text-[12.5px] leading-[1.5] text-muted">
          Copiá el link de la publicación del anuncio, o el &quot;Identificador del anuncio&quot; del Administrador de
          anuncios de Meta. Con el ID se reconoce siempre; con el link, cuando WhatsApp lo manda igual.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={idNombre} className="text-[13.5px] font-medium text-ink">
          Nombre para reconocerlo (opcional)
        </label>
        <input
          id={idNombre}
          className={CAMPO}
          maxLength={120}
          placeholder="Promo rinconero noviembre"
          value={nombre}
          onChange={(evento) => setNombre(evento.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[13.5px] font-medium text-ink">Producto del anuncio</p>
        {producto ? (
          <p className="flex flex-wrap items-center gap-2 text-[14px] text-ink">
            <strong>{producto.nombre}</strong>
            <Button size="sm" variant="ghost" disabled={guardando} onClick={() => setProducto(null)}>
              Cambiar
            </Button>
          </p>
        ) : (
          <ElegirProducto deshabilitado={guardando} alElegir={setProducto} enfocar={false} />
        )}
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger-text">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={guardando || !anuncio.trim() || !producto} onClick={() => void guardar()}>
          Guardar anuncio
        </Button>
        <Button size="sm" variant="ghost" disabled={guardando} onClick={alCancelar}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}
