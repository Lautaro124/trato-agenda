"use client";

import { useEffect, useState } from "react";
import { listarProductos } from "@/lib/productos";

const NINGUNO: ReadonlySet<string> = new Set();

/**
 * Los códigos de la primera página del catálogo, para que el código
 * automático de un producto a medida arranque libre. Si choca con uno que no
 * vino acá, EditorAMedida prueba con el siguiente al guardar.
 */
export function useCodigosUsados(): ReadonlySet<string> {
  const [codigos, setCodigos] = useState<ReadonlySet<string>>(NINGUNO);
  useEffect(() => {
    const ctrl = { cancelado: false };
    listarProductos({})
      .then((listado) => {
        if (!ctrl.cancelado) setCodigos(new Set(listado.productos.map((producto) => producto.codigo.toUpperCase())));
      })
      .catch(() => undefined);
    return () => {
      ctrl.cancelado = true;
    };
  }, []);
  return codigos;
}
