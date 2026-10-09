"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  FORMATOS_FOTO,
  quitarImagenProducto,
  subirImagenProducto,
  urlImagenProducto,
  usoDeImagenes,
  type UsoDeImagenes,
} from "@/lib/imagenes";
import { ErrorDeApi } from "@/lib/productos";

/**
 * La foto que el asistente le manda al cliente cuando la pide. Se sube y se
 * quita al toque, sin esperar al "Guardar" del formulario, y sólo con el
 * producto ya creado (hace falta su id).
 */
export function FotoProducto({
  productoId,
  imagenActualizada,
  onCambio,
}: Readonly<{
  productoId: string | null;
  imagenActualizada: string | null;
  onCambio: (imagenActualizada: string | null) => void;
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

  if (!productoId) {
    return (
      <div className="rounded-lg border border-line p-4">
        <p className="text-[13.5px] font-bold text-ink">Foto</p>
        <p className="mt-1 text-[13px] text-muted">Guardá el producto para poder agregarle una foto.</p>
      </div>
    );
  }

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
        Foto <span className="font-normal text-muted">(el asistente la manda si el cliente la pide)</span>
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
        {uso && ` · ${uso.usadas} de ${uso.maximo} productos con foto`}
      </p>
      {sinLugar && (
        <p className="text-[12.5px] text-warning-text">
          Llegaste al máximo de productos con foto. Quitale la foto a otro para subir esta.
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
