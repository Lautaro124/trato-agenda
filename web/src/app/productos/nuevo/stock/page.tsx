"use client";

import { useRouter } from "next/navigation";
import { EditorProducto } from "@/components/productos/EditorProducto";
import { MarcoDeProducto } from "@/components/productos/MarcoDeProducto";

/** Alta de un producto de stock: variantes con precio, stock y descuento. */
export default function NuevoProductoDeStockPage() {
  const router = useRouter();
  return (
    <MarcoDeProducto>
      <EditorProducto
        producto={null}
        onCerrar={() => router.push("/productos")}
        onGuardado={() => router.push("/productos")}
      />
    </MarcoDeProducto>
  );
}
