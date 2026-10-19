"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { INPUT, LABEL, MAX_VARIANTES } from "@/components/productos/EditorProducto";
import { EncabezadoDeSeccion } from "@/components/productos/SeccionSolicitud";
import { Button } from "@/components/ui/Button";
import { FORMATOS_FOTO, quitarImagenProducto, subirImagenProducto, urlImagenProducto } from "@/lib/imagenes";
import {
  centavosParaInput,
  ErrorDeApi,
  leerCentavos,
  type Producto,
  type ProductoAMedidaAGuardar,
} from "@/lib/productos";
import { claveDeTexto, enUnaLinea } from "@/lib/solicitud";

/** Una versión de precio fijo mientras se edita. La foto se sube (o se quita) al guardar el producto. */
type VersionEnEdicion = {
  clave: string;
  /** null en una versión que todavía no se guardó. */
  id: string | null;
  /** El de la ya guardada: reenviarlo hace que siga siendo la misma variante (y conserve su foto). */
  sku: string | null;
  nombre: string;
  precio: string;
  imagenActualizada: string | null;
  fotoNueva: File | null;
  quitarFoto: boolean;
};

function nuevaVersion(): VersionEnEdicion {
  return {
    clave: crypto.randomUUID(),
    id: null,
    sku: null,
    nombre: "",
    precio: "",
    imagenActualizada: null,
    fotoNueva: null,
    quitarFoto: false,
  };
}

function desdeProducto(producto: Producto | null): VersionEnEdicion[] {
  // Un producto cargado antes con variantes de stock: sus variantes pasan a ser versiones de precio fijo.
  return (producto?.variantes ?? []).map((variante) => ({
    clave: variante.id,
    id: variante.id,
    sku: variante.sku,
    nombre: variante.nombre,
    precio: centavosParaInput(variante.precioCentavos),
    imagenActualizada: variante.imagenActualizada,
    fotoNueva: null,
    quitarFoto: false,
  }));
}

/**
 * Las versiones de precio fijo de un producto a medida: lo que el cliente
 * puede pedir tal cual, con su precio y su foto. Son opcionales; sin ninguna,
 * el producto se cotiza siempre.
 */
export function useVersionesFijas(producto: Producto | null) {
  const [versiones, setVersiones] = useState<VersionEnEdicion[]>(() => desdeProducto(producto));

  const firma = JSON.stringify(versiones.map((v) => [v.nombre, v.precio, v.fotoNueva?.name ?? null, v.quitarFoto]));
  const cual = (indice: number) => (versiones.length > 1 ? ` de la versión ${indice + 1}` : " de la versión");

  const faltan = versiones.flatMap((version, indice) => [
    ...(enUnaLinea(version.nombre).length < 2 ? [`el nombre${cual(indice)}`] : []),
    ...(leerCentavos(version.precio) === null ? [`el precio${cual(indice)}`] : []),
  ]);

  /** Lo que va en el body, o el motivo en castellano (lo mismo que rechazaría la API). */
  const armar = (): ProductoAMedidaAGuardar["variantes"] | string => {
    const vistas = new Set<string>();
    const armadas: ProductoAMedidaAGuardar["variantes"] = [];
    for (const [indice, version] of versiones.entries()) {
      const nombre = enUnaLinea(version.nombre);
      const precioCentavos = leerCentavos(version.precio);
      if (nombre.length < 2) return `Poné el nombre${cual(indice)} (por ejemplo "Roble 1,20 m").`;
      if (precioCentavos === null) return `Revisá el precio${cual(indice)}.`;
      if (vistas.has(claveDeTexto(nombre))) return `Hay dos versiones que se llaman "${nombre}".`;
      vistas.add(claveDeTexto(nombre));
      armadas.push({ ...(version.sku ? { sku: version.sku } : {}), nombre, precioCentavos });
    }
    return armadas;
  };

  const cambiar = (clave: string, cambios: Partial<VersionEnEdicion>) =>
    setVersiones((actuales) => actuales.map((v) => (v.clave === clave ? { ...v, ...cambios } : v)));

  /**
   * Con el producto ya guardado, sube las fotos elegidas y quita las que se
   * sacaron. Una versión nueva se encuentra por su nombre (la API arma su sku
   * con él). Devuelve el motivo si alguna falló: el producto quedó guardado igual.
   */
  const guardarFotos = async (guardado: Producto): Promise<string | null> => {
    const errores: string[] = [];
    for (const version of versiones) {
      if (!version.fotoNueva && !version.quitarFoto) continue;
      const variante =
        guardado.variantes.find((v) => v.id === version.id) ??
        guardado.variantes.find((v) => claveDeTexto(v.nombre) === claveDeTexto(enUnaLinea(version.nombre)));
      if (!variante) continue;
      try {
        if (version.fotoNueva) await subirImagenProducto(guardado.id, version.fotoNueva, variante.id);
        else if (variante.imagenActualizada) await quitarImagenProducto(guardado.id, variante.id);
      } catch (err) {
        errores.push(`${variante.nombre}: ${err instanceof ErrorDeApi ? err.message : "no se pudo subir"}`);
      }
    }
    return errores.length > 0 ? `Se guardó el producto, pero hubo fotos de versiones que no: ${errores.join("; ")}` : null;
  };

  /** Después de guardar: lo que quedó en la base es el nuevo punto de partida. */
  const reiniciar = (guardado: Producto) => setVersiones(desdeProducto(guardado));

  return {
    versiones,
    firma,
    faltan,
    armar,
    cambiar,
    guardarFotos,
    reiniciar,
    agregar: () => setVersiones((actuales) => [...actuales, nuevaVersion()]),
    quitar: (clave: string) => setVersiones((actuales) => actuales.filter((v) => v.clave !== clave)),
  };
}

export type EstadoVersionesFijas = ReturnType<typeof useVersionesFijas>;

/**
 * "¿Tenés versiones con precio fijo?" de un producto a medida: cada una con su
 * nombre, su precio y, si querés, su foto. El asistente las ofrece; si el
 * cliente quiere una tal cual le manda el link de pago, y si le quiere cambiar
 * algo te llega para cotizar.
 */
export function SeccionVariantesFijas({
  numero,
  productoId,
  estado,
}: Readonly<{ numero: number; productoId: string | null; estado: EstadoVersionesFijas }>) {
  const { versiones } = estado;
  return (
    <section aria-label="Versiones con precio fijo" className="flex flex-col gap-3">
      <EncabezadoDeSeccion
        numero={numero}
        titulo="¿Tenés versiones con precio fijo?"
        opcional
        ayuda="Tu asistente las ofrece con su foto. Si el cliente quiere una tal cual, le manda el link de pago; si le quiere cambiar algo, te llega para cotizar."
      />
      <div className="flex flex-col gap-2.5 sm:pl-10">
        {versiones.length > 0 && (
          <ul className="flex flex-col gap-2">
            {versiones.map((version, indice) => (
              <FilaVersion
                key={version.clave}
                indice={indice}
                productoId={productoId}
                version={version}
                onCambio={(cambios) => estado.cambiar(version.clave, cambios)}
                onQuitar={() => estado.quitar(version.clave)}
              />
            ))}
          </ul>
        )}
        {versiones.length < MAX_VARIANTES && (
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={estado.agregar}>
              + Agregar una versión
            </Button>
          </div>
        )}
        {versiones.length === 0 && (
          <p className="text-[12.5px] text-ink-secondary">Sin versiones, tu asistente siempre te lo pasa para cotizar.</p>
        )}
      </div>
    </section>
  );
}

function FilaVersion({
  indice,
  productoId,
  version,
  onCambio,
  onQuitar,
}: Readonly<{
  indice: number;
  productoId: string | null;
  version: VersionEnEdicion;
  onCambio: (cambios: Partial<VersionEnEdicion>) => void;
  onQuitar: () => void;
}>) {
  const id = (campo: string) => `version-${version.clave}-${campo}`;
  const numero = indice + 1;
  return (
    <li className="grid gap-3 rounded-md bg-sunken p-3 sm:grid-cols-[auto_minmax(0,1fr)_160px_auto] sm:items-end">
      <FotoDeVersion numero={numero} productoId={productoId} version={version} onCambio={onCambio} />
      <div>
        <label htmlFor={id("nombre")} className={LABEL}>
          Versión {numero}
        </label>
        <input
          id={id("nombre")}
          value={version.nombre}
          maxLength={120}
          placeholder="Ej.: Roble, 1,20 m"
          onChange={(e) => onCambio({ nombre: e.target.value })}
          className={INPUT}
        />
      </div>
      <div>
        <label htmlFor={id("precio")} className={LABEL}>
          Precio de la versión {numero}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-muted">$</span>
          <input
            id={id("precio")}
            inputMode="decimal"
            value={version.precio}
            placeholder="0"
            onChange={(e) => onCambio({ precio: e.target.value })}
            className={INPUT}
          />
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onQuitar} aria-label={`Quitar la versión ${numero}`}>
        Quitar
      </Button>
    </li>
  );
}

/** La foto de una versión: se elige acá y se sube (o se quita) cuando se guarda el producto. */
function FotoDeVersion({
  numero,
  productoId,
  version,
  onCambio,
}: Readonly<{
  numero: number;
  productoId: string | null;
  version: VersionEnEdicion;
  onCambio: (cambios: Partial<VersionEnEdicion>) => void;
}>) {
  const entrada = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const local = useMemo(() => (version.fotoNueva ? URL.createObjectURL(version.fotoNueva) : null), [version.fotoNueva]);

  useEffect(() => {
    if (!local) return;
    return () => URL.revokeObjectURL(local);
  }, [local]);

  const guardada =
    productoId && version.id && version.imagenActualizada && !version.quitarFoto
      ? urlImagenProducto(productoId, version.imagenActualizada, version.id)
      : null;
  const vista = local ?? guardada;

  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const elegido = e.target.files?.[0];
    e.target.value = "";
    if (!elegido) return;
    if (!FORMATOS_FOTO.split(",").includes(elegido.type)) {
      setError("JPG, PNG o WebP.");
      return;
    }
    setError(null);
    onCambio({ fotoNueva: elegido, quitarFoto: false });
  };

  return (
    <div className="flex items-center gap-2">
      <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-card">
        {vista ? (
          // eslint-disable-next-line @next/next/no-img-element -- un blob: local o la foto de la API con la cookie de sesión
          <img src={vista} alt={`Foto de la versión ${numero}`} className="size-full object-cover" />
        ) : (
          <span className="text-[10.5px] text-muted">Sin foto</span>
        )}
      </div>
      <div className="flex flex-col items-start">
        <input
          ref={entrada}
          type="file"
          accept={FORMATOS_FOTO}
          aria-label={`Elegir foto de la versión ${numero}`}
          className="sr-only"
          onChange={alElegir}
        />
        <button
          type="button"
          onClick={() => entrada.current?.click()}
          className="cursor-pointer text-[12.5px] font-semibold text-primary underline-offset-2 hover:underline"
        >
          {vista ? "Cambiar foto" : "Foto"}
        </button>
        {vista && (
          <button
            type="button"
            aria-label={`Quitar la foto de la versión ${numero}`}
            onClick={() => onCambio({ fotoNueva: null, quitarFoto: true })}
            className="cursor-pointer text-[12px] text-muted underline-offset-2 hover:underline"
          >
            Quitar
          </button>
        )}
        {error && (
          <span role="alert" className="text-[11.5px] text-danger-text">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
