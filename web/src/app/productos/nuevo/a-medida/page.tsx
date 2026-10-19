"use client";

import { useRouter } from "next/navigation";
import { EditorAMedida } from "@/components/productos/EditorAMedida";
import { MarcoDeProducto } from "@/components/productos/MarcoDeProducto";
import { useCodigosUsados } from "@/components/productos/useCodigosUsados";

/** Alta de un producto a medida: qué se hace, sus materiales, versiones, preguntas y cómo se cotiza. */
export default function NuevoProductoAMedidaPage() {
  const router = useRouter();
  const codigosUsados = useCodigosUsados();
  return (
    <MarcoDeProducto>
      <EditorAMedida
        producto={null}
        codigosUsados={codigosUsados}
        onCerrar={() => router.push("/productos")}
        onGuardado={() => router.push("/productos")}
      />
    </MarcoDeProducto>
  );
}
