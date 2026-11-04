"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EditorProducto } from "@/components/productos/EditorProducto";
import { MarcoDeProducto } from "@/components/productos/MarcoDeProducto";
import { ErrorDeApi, obtenerProducto, type Producto } from "@/lib/productos";

type Carga = { estado: "cargando" } | { estado: "listo"; producto: Producto } | { estado: "error"; mensaje: string };

/** Edición de un producto. */
export default function EditarProductoPage() {
  return (
    <MarcoDeProducto>
      <Edicion />
    </MarcoDeProducto>
  );
}

function Edicion() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [carga, setCarga] = useState<Carga>({ estado: "cargando" });

  useEffect(() => {
    const ctrl = { cancelado: false };
    obtenerProducto(id)
      .then((producto) => !ctrl.cancelado && setCarga({ estado: "listo", producto }))
      .catch(
        (err: unknown) =>
          !ctrl.cancelado &&
          setCarga({ estado: "error", mensaje: err instanceof ErrorDeApi ? err.message : "No pudimos cargar el producto." }),
      );
    return () => {
      ctrl.cancelado = true;
    };
  }, [id]);

  if (carga.estado === "cargando") {
    return (
      <main className="grid flex-1 place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando el producto…</p>
      </main>
    );
  }
  if (carga.estado === "error") {
    return (
      <main className="grid flex-1 place-items-center bg-page p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <p role="alert" className="text-sm text-danger-text">
            {carga.mensaje}
          </p>
          <Link href="/productos" className="text-sm font-semibold text-[var(--color-semantic-text-link)] hover:underline">
            Volver a tus productos
          </Link>
        </div>
      </main>
    );
  }

  const volver = () => router.push("/productos");
  return <EditorProducto producto={carga.producto} onCerrar={volver} onGuardado={volver} />;
}
