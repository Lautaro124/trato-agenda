"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  agregarFotoProducto,
  FORMATOS_FOTO,
  hacerPrincipalFotoProducto,
  MAX_FOTOS_POR_PRODUCTO,
  quitarFotoProducto,
  reemplazarFotoProducto,
  urlFotoProducto,
  usoDeImagenes,
  type UsoDeImagenes,
} from "@/lib/imagenes";
import { ErrorDeApi, guardarProducto, type FotoDeProducto, type Producto, type ProductoAGuardar } from "@/lib/productos";

/**
 * Guarda el producto y, si se eligieron fotos antes de que existiera, las sube
 * en orden con el id nuevo (la primera queda como principal). Si alguna falla
 * el producto queda guardado igual: vuelve el motivo para mostrarlo sin perder
 * lo cargado.
 */
export async function guardarConFotos(
  datos: ProductoAGuardar,
  id: string | undefined,
  fotosPendientes: File[],
): Promise<{ producto: Producto; errorFoto: string | null }> {
  const producto = await guardarProducto(datos, id);
  let imagenes = producto.imagenes;
  for (const [indice, archivo] of fotosPendientes.entries()) {
    try {
      imagenes = await agregarFotoProducto(producto.id, archivo);
    } catch (err) {
      const motivo = err instanceof ErrorDeApi ? err.message : "No pudimos subir la foto.";
      const subidas = indice === 0 ? "ninguna foto" : `sólo ${indice} de ${fotosPendientes.length} fotos`;
      return { producto: conFotos(producto, imagenes), errorFoto: `Se guardó el producto con ${subidas}: ${motivo}` };
    }
  }
  return { producto: conFotos(producto, imagenes), errorFoto: null };
}

function conFotos(producto: Producto, imagenes: FotoDeProducto[]): Producto {
  return { ...producto, imagenes, imagenActualizada: imagenes[0]?.actualizada ?? null };
}

const AYUDA =
  "La principal la manda el asistente cuando muestra el producto. Las demás, sólo si el cliente pide más fotos o detalles.";
const FORMATO_INVALIDO = "Las fotos tienen que ser JPG, PNG o WebP.";

const esFormatoValido = (archivo: File) => FORMATOS_FOTO.split(",").includes(archivo.type);

/** Una foto tal como la dibuja la galería, venga de la API o esté pendiente de subir. */
type FotoEnGaleria = { clave: string; src: string };

/**
 * La sección Fotos del formulario: la principal grande y hasta tres de
 * detalle al lado. No sabe de dónde salen las fotos: eso lo resuelven
 * `FotosProducto` (producto guardado, cambios al toque) y `FotosPendientes`
 * (producto nuevo, se suben al guardar).
 */
function GaleriaDeFotos({
  fotos,
  ocupado,
  sinLugarEnCuenta,
  error,
  pie,
  onAgregar,
  onCambiar,
  onPrincipal,
  onQuitar,
}: Readonly<{
  fotos: FotoEnGaleria[];
  ocupado: boolean;
  sinLugarEnCuenta: boolean;
  error: string | null;
  pie: string;
  onAgregar: (archivos: File[]) => void;
  onCambiar: (clave: string, archivo: File) => void;
  onPrincipal: (clave: string) => void;
  onQuitar: (clave: string) => void;
}>) {
  const entradaAgregar = useRef<HTMLInputElement>(null);
  const entradaCambiar = useRef<HTMLInputElement>(null);
  const [aCambiar, setACambiar] = useState<string | null>(null);
  const [encima, setEncima] = useState(false);
  const llena = fotos.length >= MAX_FOTOS_POR_PRODUCTO;
  const puedeAgregar = !ocupado && !llena && !sinLugarEnCuenta;
  const [principal, ...detalles] = fotos;
  const lugares = MAX_FOTOS_POR_PRODUCTO - 1;

  const traeArchivos = (e: React.DragEvent) => puedeAgregar && e.dataTransfer.types.includes("Files");

  const alAgregar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivos = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (archivos.length > 0) onAgregar(archivos);
  };

  const alCambiar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (archivo && aCambiar) onCambiar(aCambiar, archivo);
    setACambiar(null);
  };

  const cambiar = (clave: string) => {
    setACambiar(clave);
    entradaCambiar.current?.click();
  };

  return (
    <section
      aria-labelledby="fotos-producto-titulo"
      onDragOver={(e) => {
        if (!traeArchivos(e)) return;
        e.preventDefault();
        setEncima(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEncima(false);
      }}
      onDrop={(e) => {
        setEncima(false);
        if (!traeArchivos(e)) return;
        e.preventDefault();
        onAgregar(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        "relative flex flex-col gap-3 rounded-lg border p-4 transition-colors",
        encima ? "border-dashed border-primary bg-primary-subtle" : "border-line",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="fotos-producto-titulo" className="text-[13.5px] font-bold text-ink">
            Fotos <span className="font-normal text-muted">(hasta {MAX_FOTOS_POR_PRODUCTO})</span>
          </h2>
          <p className="text-[12.5px] leading-[1.45] text-ink-secondary">{AYUDA}</p>
        </div>
        <span className="flex-none rounded-full bg-sunken px-2.5 py-1 text-[12px] font-bold text-ink-secondary">
          {fotos.length} de {MAX_FOTOS_POR_PRODUCTO}
        </span>
      </div>

      <input
        ref={entradaAgregar}
        type="file"
        multiple
        accept={FORMATOS_FOTO}
        aria-label="Agregar fotos del producto"
        className="sr-only"
        disabled={!puedeAgregar}
        onChange={alAgregar}
      />
      <input
        ref={entradaCambiar}
        type="file"
        accept={FORMATOS_FOTO}
        aria-label="Cambiar foto del producto"
        tabIndex={-1}
        className="sr-only"
        onChange={alCambiar}
      />

      <div className="flex flex-wrap items-start gap-3.5">
        {principal ? (
          <div className="flex w-[168px] flex-none flex-col gap-1.5">
            <div className="relative size-[168px] overflow-hidden rounded-md bg-sunken outline-2 outline-offset-2 outline-primary">
              {/* eslint-disable-next-line @next/next/no-img-element -- viene de la API con la cookie de sesión (o es un blob: local); el optimizador de Next no la tiene */}
              <img src={principal.src} alt="Foto principal del producto" className="size-full object-cover" />
              <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-primary py-[3px] pr-2 pl-1.5 text-[11px] font-bold text-primary-on">
                <IconoEstrella relleno />
                Principal
              </span>
            </div>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-10 flex-1"
                disabled={ocupado}
                onClick={() => cambiar(principal.clave)}
              >
                Cambiar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-10 flex-1 text-danger-text hover:bg-danger-subtle"
                disabled={ocupado}
                onClick={() => onQuitar(principal.clave)}
              >
                Quitar
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={!puedeAgregar}
            onClick={() => entradaAgregar.current?.click()}
            className="flex size-[168px] flex-none cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-[var(--color-primitive-coral-400)] bg-primary-subtle p-3 text-[var(--color-primitive-coral-700)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <IconoMas />
            <span className="text-[13.5px] font-bold">{ocupado ? "Subiendo…" : "Subir foto principal"}</span>
            <span className="text-[12px] text-[var(--color-primitive-coral-800)]">o arrastrala acá</span>
          </button>
        )}

        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-2">
          <p className="text-[12.5px] font-semibold text-ink-secondary">Más detalles</p>
          <ul className="grid grid-cols-3 gap-2.5">
            {Array.from({ length: lugares }, (_, indice) => {
              const foto = detalles[indice];
              if (foto) {
                const numero = indice + 2;
                return (
                  <li key={foto.clave} className="flex min-w-0 flex-col gap-1">
                    <div className="aspect-square overflow-hidden rounded-md bg-sunken">
                      {/* eslint-disable-next-line @next/next/no-img-element -- viene de la API con la cookie de sesión (o es un blob: local) */}
                      <img src={foto.src} alt={`Foto ${numero} del producto`} className="size-full object-cover" />
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => onPrincipal(foto.clave)}
                        aria-label={`Hacer principal la foto ${numero}`}
                        title="Hacer principal"
                        className="grid min-h-10 min-w-0 flex-1 cursor-pointer place-items-center rounded-sm border border-line bg-card text-[var(--color-semantic-text-link)] hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <IconoEstrella />
                      </button>
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => onQuitar(foto.clave)}
                        aria-label={`Quitar la foto ${numero}`}
                        title="Quitar"
                        className="grid min-h-10 min-w-0 flex-1 cursor-pointer place-items-center rounded-sm border border-line bg-card text-danger-text hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <IconoCruz />
                      </button>
                    </div>
                  </li>
                );
              }
              if (principal && indice === detalles.length) {
                return (
                  <li key="agregar">
                    <button
                      type="button"
                      disabled={!puedeAgregar}
                      onClick={() => entradaAgregar.current?.click()}
                      className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-[1.5px] border-dashed border-line-strong bg-page p-1.5 text-ink-secondary hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <IconoMas />
                      <span className="text-[12px] font-bold">{ocupado ? "Subiendo…" : "Agregar"}</span>
                    </button>
                  </li>
                );
              }
              return <li key={`vacio-${indice}`} aria-hidden className="aspect-square rounded-md border-[1.5px] border-dashed border-line bg-page" />;
            })}
          </ul>
          {detalles.length > 0 && <p className="text-[12px] leading-[1.45] text-muted">La estrella pasa esa foto a principal.</p>}
        </div>
      </div>

      <p className="border-t border-sunken pt-2.5 text-[12px] text-muted">{pie}</p>
      {sinLugarEnCuenta && !llena && (
        <p className="text-[12.5px] text-warning-text">Llegaste al máximo de fotos de la cuenta. Quitá alguna para subir otra.</p>
      )}
      {error && (
        <p role="alert" className="text-[12.5px] text-danger-text">
          {error}
        </p>
      )}
      {encima && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center rounded-lg bg-primary-subtle/90 text-[15px] font-bold text-[var(--color-primitive-coral-700)]"
        >
          Soltá las fotos acá
        </div>
      )}
    </section>
  );
}

/**
 * Las fotos de un producto ya guardado: se suben, cambian y quitan al toque,
 * sin esperar al "Guardar" del formulario.
 */
export function FotosProducto({
  productoId,
  fotosIniciales,
  onCambio,
}: Readonly<{
  productoId: string;
  fotosIniciales: FotoDeProducto[];
  onCambio: (fotos: FotoDeProducto[]) => void;
}>) {
  const [fotos, setFotos] = useState(fotosIniciales);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uso, setUso] = useState<UsoDeImagenes | null>(null);
  const [recargasUso, setRecargasUso] = useState(0);

  useEffect(() => {
    const ctrl = { cancelado: false };
    usoDeImagenes()
      .then((datos) => !ctrl.cancelado && setUso(datos))
      .catch(() => undefined);
    return () => {
      ctrl.cancelado = true;
    };
  }, [recargasUso]);

  /** Una o varias operaciones seguidas contra la API; la última lista que vuelve es la que vale. */
  const operar = (accion: () => Promise<FotoDeProducto[] | void>) => {
    setOcupado(true);
    setError(null);
    accion()
      .catch((err: unknown) => setError(err instanceof ErrorDeApi ? err.message : "No pudimos guardar los cambios de las fotos."))
      .finally(() => {
        setOcupado(false);
        setRecargasUso((n) => n + 1);
      });
  };

  const aplicar = (nuevas: FotoDeProducto[]) => {
    setFotos(nuevas);
    onCambio(nuevas);
  };

  const agregar = (archivos: File[]) => {
    if (archivos.some((archivo) => !esFormatoValido(archivo))) return setError(FORMATO_INVALIDO);
    const entran = archivos.slice(0, MAX_FOTOS_POR_PRODUCTO - fotos.length);
    operar(async () => {
      // De a una y en orden: la API las pone al final en el orden en que llegan.
      for (const archivo of entran) aplicar(await agregarFotoProducto(productoId, archivo));
      if (entran.length < archivos.length) setError(`Entraron ${entran.length}: un producto tiene hasta ${MAX_FOTOS_POR_PRODUCTO} fotos.`);
    });
  };

  return (
    <GaleriaDeFotos
      fotos={fotos.map((foto) => ({ clave: foto.id, src: urlFotoProducto(productoId, foto.id, foto.actualizada) }))}
      ocupado={ocupado}
      sinLugarEnCuenta={uso !== null && uso.usadas >= uso.maximo}
      error={error}
      pie={`JPG, PNG o WebP · podés arrastrarlas acá${uso ? ` · ${uso.usadas} de ${uso.maximo} fotos de la cuenta` : ""}`}
      onAgregar={agregar}
      onCambiar={(clave, archivo) =>
        esFormatoValido(archivo)
          ? operar(async () => aplicar(await reemplazarFotoProducto(productoId, clave, archivo)))
          : setError(FORMATO_INVALIDO)
      }
      onPrincipal={(clave) => operar(async () => aplicar(await hacerPrincipalFotoProducto(productoId, clave)))}
      onQuitar={(clave) => operar(async () => aplicar(await quitarFotoProducto(productoId, clave)))}
    />
  );
}

/** Las fotos de un producto que todavía no existe: se ven acá y se suben al guardar, en este orden. */
export function FotosPendientes({
  archivos,
  onCambio,
}: Readonly<{ archivos: File[]; onCambio: (archivos: File[]) => void }>) {
  const [error, setError] = useState<string | null>(null);
  const vistas = useMemo(() => archivos.map((archivo) => URL.createObjectURL(archivo)), [archivos]);

  useEffect(() => () => vistas.forEach((vista) => URL.revokeObjectURL(vista)), [vistas]);

  // La clave es la posición: los archivos no tienen id y dos pueden llamarse igual.
  const indice = (clave: string) => Number(clave);

  const agregar = (nuevos: File[]) => {
    if (nuevos.some((archivo) => !esFormatoValido(archivo))) return setError(FORMATO_INVALIDO);
    const entran = nuevos.slice(0, MAX_FOTOS_POR_PRODUCTO - archivos.length);
    setError(entran.length < nuevos.length ? `Entraron ${entran.length}: un producto tiene hasta ${MAX_FOTOS_POR_PRODUCTO} fotos.` : null);
    onCambio([...archivos, ...entran]);
  };

  return (
    <GaleriaDeFotos
      fotos={vistas.map((src, i) => ({ clave: String(i), src }))}
      ocupado={false}
      sinLugarEnCuenta={false}
      error={error}
      pie="JPG, PNG o WebP · podés arrastrarlas acá · se suben al guardar"
      onAgregar={agregar}
      onCambiar={(clave, archivo) => {
        if (!esFormatoValido(archivo)) return setError(FORMATO_INVALIDO);
        setError(null);
        onCambio(archivos.map((actual, i) => (i === indice(clave) ? archivo : actual)));
      }}
      onPrincipal={(clave) => {
        const elegida = archivos[indice(clave)];
        onCambio([elegida, ...archivos.filter((_, i) => i !== indice(clave))]);
      }}
      onQuitar={(clave) => onCambio(archivos.filter((_, i) => i !== indice(clave)))}
    />
  );
}

function IconoEstrella({ relleno = false }: Readonly<{ relleno?: boolean }>) {
  return (
    <svg
      aria-hidden
      width={relleno ? 11 : 15}
      height={relleno ? 11 : 15}
      viewBox="0 0 24 24"
      fill={relleno ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={relleno ? 0 : 2}
      strokeLinejoin="round"
    >
      <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
    </svg>
  );
}

function IconoCruz() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function IconoMas() {
  return (
    <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
