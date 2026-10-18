"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
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

/**
 * La foto que el asistente le manda al cliente (con stock, cuando la pide; a
 * pedido, sola al mostrar el producto). Con el
 * producto ya creado se sube y se quita al toque, sin esperar al "Guardar"
 * del formulario. En uno nuevo (todavía sin id) se elige igual y queda
 * pendiente: el editor la sube apenas guarda (`guardarConFoto`).
 */
export function FotoProducto({
  productoId,
  imagenActualizada,
  onCambio,
  pendiente,
  onPendiente,
  ayuda = AYUDA_FOTO,
}: Readonly<{
  productoId: string | null;
  imagenActualizada: string | null;
  onCambio: (imagenActualizada: string | null) => void;
  /** La foto elegida en un producto que todavía no se guardó. */
  pendiente: File | null;
  onPendiente: (archivo: File | null) => void;
  /** Cuándo la manda el asistente: con stock, si el cliente la pide; a pedido, sola. */
  ayuda?: string;
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

  if (!productoId) return <FotoPendiente archivo={pendiente} onCambio={onPendiente} ayuda={ayuda} />;

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

  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (archivo) cambiar(subirImagenProducto(productoId, archivo), new Date().toISOString());
  };

  const sinLugar = !version && uso !== null && uso.usadas >= uso.maximo;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <p className="text-[13.5px] font-bold text-ink">
        Foto <span className="font-normal text-muted">({ayuda})</span>
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
        JPG, PNG o WebP · una por producto
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
    </div>
  );
}

/** La foto de un producto que todavía no existe: se ve acá y se sube al guardar. */
function FotoPendiente({
  archivo,
  onCambio,
  ayuda,
}: Readonly<{ archivo: File | null; onCambio: (archivo: File | null) => void; ayuda: string }>) {
  const entrada = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const vista = useMemo(() => (archivo ? URL.createObjectURL(archivo) : null), [archivo]);

  useEffect(() => {
    if (!vista) return;
    return () => URL.revokeObjectURL(vista);
  }, [vista]);

  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const elegido = e.target.files?.[0];
    e.target.value = "";
    if (!elegido) return;
    if (!FORMATOS_FOTO.split(",").includes(elegido.type)) {
      setError("La foto tiene que ser JPG, PNG o WebP.");
      return;
    }
    setError(null);
    onCambio(elegido);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <p className="text-[13.5px] font-bold text-ink">
        Foto <span className="font-normal text-muted">({ayuda})</span>
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
      <p className="text-[12px] text-muted">JPG, PNG o WebP · una por producto · se sube al guardar</p>
      {error && (
        <p role="alert" className="text-[12.5px] text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
