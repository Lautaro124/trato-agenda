"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  FORMATOS_FOTO,
  quitarImagenProducto,
  subirImagenProducto,
  urlImagenProducto,
  usoDeImagenes,
  type UsoDeImagenes,
} from "@/lib/imagenes";
import { ErrorDeApi, guardarProducto, type Producto, type ProductoAGuardar } from "@/lib/productos";

/**
 * Guarda el producto y, si se eligió una foto antes de que existiera, la sube
 * con el id nuevo. Si la foto falla el producto queda guardado igual: vuelve
 * el motivo para mostrarlo sin perder lo cargado.
 */
export async function guardarConFoto(
  datos: ProductoAGuardar,
  id: string | undefined,
  fotoPendiente: File | null,
): Promise<{ producto: Producto; errorFoto: string | null }> {
  const producto = await guardarProducto(datos, id);
  if (!fotoPendiente) return { producto, errorFoto: null };
  try {
    await subirImagenProducto(producto.id, fotoPendiente);
    return { producto: { ...producto, imagenActualizada: new Date().toISOString() }, errorFoto: null };
  } catch (err) {
    const motivo = err instanceof ErrorDeApi ? err.message : "No pudimos subir la foto.";
    return { producto, errorFoto: `Se guardó el producto, pero la foto no se pudo subir: ${motivo}` };
  }
}

const AYUDA_FOTO = "el asistente la manda si el cliente la pide";
const FORMATO_INVALIDO = "La foto tiene que ser JPG, PNG o WebP.";

/**
 * El recuadro de la foto, que además acepta un archivo arrastrado encima. Es
 * un atajo: el botón de elegir sigue siendo la vía principal, con teclado y
 * lector de pantalla.
 */
function ZonaDeSoltar({
  onArchivo,
  deshabilitada = false,
  children,
}: Readonly<{ onArchivo: (archivo: File | undefined) => void; deshabilitada?: boolean; children: React.ReactNode }>) {
  const [encima, setEncima] = useState(false);
  const traeArchivos = (e: React.DragEvent) => !deshabilitada && e.dataTransfer.types.includes("Files");

  return (
    <div
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
        onArchivo(e.dataTransfer.files[0]);
      }}
      className={cn(
        "relative flex flex-col gap-3 rounded-lg border p-4 transition-colors",
        encima ? "border-dashed border-primary bg-primary-subtle" : "border-line",
      )}
    >
      {children}
      {encima && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center rounded-lg bg-primary-subtle/90 text-[15px] font-bold text-[var(--color-primitive-coral-700)]"
        >
          Soltá la foto acá
        </div>
      )}
    </div>
  );
}

/**
 * La foto que el asistente le manda al cliente. Con el producto ya creado se sube y se quita al toque, sin esperar al "Guardar"
 * del formulario. En uno nuevo (todavía sin id) se elige igual y queda
 * pendiente: el editor la sube apenas guarda (`guardarConFoto`).
 */
export function FotoProducto({
  productoId,
  imagenActualizada,
  onCambio,
  pendiente,
  onPendiente,
}: Readonly<{
  productoId: string | null;
  imagenActualizada: string | null;
  onCambio: (imagenActualizada: string | null) => void;
  /** La foto elegida en un producto que todavía no se guardó. */
  pendiente: File | null;
  onPendiente: (archivo: File | null) => void;
}>) {
  const entrada = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(imagenActualizada);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uso, setUso] = useState<UsoDeImagenes | null>(null);
  const [recargasUso, setRecargasUso] = useState(0);

  useEffect(() => {
    if (!productoId) return;
    const ctrl = { cancelado: false };
    usoDeImagenes()
      .then((datos) => !ctrl.cancelado && setUso(datos))
      .catch(() => undefined);
    return () => {
      ctrl.cancelado = true;
    };
  }, [productoId, recargasUso]);

  if (!productoId) return <FotoPendiente archivo={pendiente} onCambio={onPendiente} />;

  const cambiar = (accion: Promise<void>, nuevaVersion: string | null) => {
    setOcupado(true);
    setError(null);
    accion
      .then(() => {
        setVersion(nuevaVersion);
        onCambio(nuevaVersion);
        setRecargasUso((n) => n + 1);
      })
      .catch((err: unknown) => setError(err instanceof ErrorDeApi ? err.message : "No pudimos guardar la foto."))
      .finally(() => setOcupado(false));
  };

  const recibir = (archivo: File | undefined) => {
    if (!archivo) return;
    if (!FORMATOS_FOTO.split(",").includes(archivo.type)) {
      setError(FORMATO_INVALIDO);
      return;
    }
    cambiar(subirImagenProducto(productoId, archivo), new Date().toISOString());
  };

  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    recibir(archivo);
  };

  const sinLugar = !version && uso !== null && uso.usadas >= uso.maximo;

  return (
    <ZonaDeSoltar onArchivo={recibir} deshabilitada={ocupado || sinLugar}>
      <p className="text-[13.5px] font-bold text-ink">
        Foto <span className="font-normal text-muted">({AYUDA_FOTO})</span>
      </p>
      <div className="flex items-center gap-4">
        <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-md bg-sunken">
          {version ? (
            // eslint-disable-next-line @next/next/no-img-element -- viene de la API con la cookie de sesión; el optimizador de Next no la tiene
            <img
              src={urlImagenProducto(productoId, version)}
              alt="Foto del producto"
              className="size-full object-cover"
            />
          ) : (
            <span className="text-[12px] text-muted">Sin foto</span>
          )}
        </div>
        <div className="flex flex-col items-start gap-2">
          <input
            ref={entrada}
            type="file"
            accept={FORMATOS_FOTO}
            aria-label="Elegir foto del producto"
            className="sr-only"
            onChange={alElegir}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={ocupado || sinLugar}
            onClick={() => entrada.current?.click()}
          >
            {ocupado ? "Guardando…" : version ? "Cambiar foto" : "Subir foto"}
          </Button>
          {version && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={ocupado}
              onClick={() => cambiar(quitarImagenProducto(productoId), null)}
            >
              Quitar foto
            </Button>
          )}
        </div>
      </div>
      <p className="text-[12px] text-muted">
        JPG, PNG o WebP · una por producto · podés arrastrarla acá
        {uso && ` · ${uso.usadas} de ${uso.maximo} fotos`}
      </p>
      {sinLugar && (
        <p className="text-[12.5px] text-warning-text">
          Llegaste al máximo de fotos. Quitale la foto a otro producto para subir esta.
        </p>
      )}
      {error && (
        <p role="alert" className="text-[12.5px] text-danger-text">
          {error}
        </p>
      )}
    </ZonaDeSoltar>
  );
}

/** La foto de un producto que todavía no existe: se ve acá y se sube al guardar. */
function FotoPendiente({
  archivo,
  onCambio,
}: Readonly<{ archivo: File | null; onCambio: (archivo: File | null) => void }>) {
  const entrada = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const vista = useMemo(() => (archivo ? URL.createObjectURL(archivo) : null), [archivo]);

  useEffect(() => {
    if (!vista) return;
    return () => URL.revokeObjectURL(vista);
  }, [vista]);

  const recibir = (elegido: File | undefined) => {
    if (!elegido) return;
    if (!FORMATOS_FOTO.split(",").includes(elegido.type)) {
      setError(FORMATO_INVALIDO);
      return;
    }
    setError(null);
    onCambio(elegido);
  };

  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const elegido = e.target.files?.[0];
    e.target.value = "";
    recibir(elegido);
  };

  return (
    <ZonaDeSoltar onArchivo={recibir}>
      <p className="text-[13.5px] font-bold text-ink">
        Foto <span className="font-normal text-muted">({AYUDA_FOTO})</span>
      </p>
      <div className="flex items-center gap-4">
        <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-md bg-sunken">
          {vista ? (
            // eslint-disable-next-line @next/next/no-img-element -- es un blob: local, todavía no está en la API
            <img src={vista} alt="Foto del producto" className="size-full object-cover" />
          ) : (
            <span className="text-[12px] text-muted">Sin foto</span>
          )}
        </div>
        <div className="flex flex-col items-start gap-2">
          <input
            ref={entrada}
            type="file"
            accept={FORMATOS_FOTO}
            aria-label="Elegir foto del producto"
            className="sr-only"
            onChange={alElegir}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => entrada.current?.click()}>
            {archivo ? "Cambiar foto" : "Elegir foto"}
          </Button>
          {archivo && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onCambio(null)}>
              Quitar foto
            </Button>
          )}
        </div>
      </div>
      <p className="text-[12px] text-muted">JPG, PNG o WebP · una por producto · podés arrastrarla acá · se sube al guardar</p>
      {error && (
        <p role="alert" className="text-[12.5px] text-danger-text">
          {error}
        </p>
      )}
    </ZonaDeSoltar>
  );
}
