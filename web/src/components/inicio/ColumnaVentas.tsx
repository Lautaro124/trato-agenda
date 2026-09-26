"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { listarProductos } from "@/lib/productos";

type WhatsappStatus = { linked: boolean };

type Paso = { hecho: boolean; titulo: string; detalle: string; href: string; accion: string };

/**
 * La columna izquierda del Home de una cuenta de ventas: lo que falta para que
 * el asistente venda de verdad. Reemplaza a "Tu día" (la agenda), que en una
 * cuenta de ventas no existe.
 */
export function ColumnaVentas() {
  const [productos, setProductos] = useState<number | null>(null);
  const [whatsapp, setWhatsapp] = useState<boolean | null>(null);

  useEffect(() => {
    listarProductos({})
      .then((listado) => setProductos(listado.total))
      .catch(() => setProductos(null));
    apiFetch("/whatsapp/status")
      .then((res) => (res.ok ? (res.json() as Promise<WhatsappStatus>) : null))
      .then((estado) => setWhatsapp(estado?.linked ?? false))
      .catch(() => setWhatsapp(null));
  }, []);

  const pasos: Paso[] = [
    {
      hecho: (productos ?? 0) > 0,
      titulo: "Cargá tu catálogo",
      detalle:
        productos && productos > 0
          ? `${productos.toLocaleString("es-AR")} productos cargados.`
          : "Subí tu lista de productos en una planilla o cargalos de a uno.",
      href: "/productos",
      accion: productos && productos > 0 ? "Ver productos" : "Cargar productos",
    },
    {
      hecho: whatsapp === true,
      titulo: "Vinculá tu WhatsApp",
      detalle: whatsapp ? "Tu asistente ya responde en tu número." : "Escaneá el QR para que el asistente atienda.",
      href: "/vincular",
      accion: whatsapp ? "Ver vinculación" : "Vincular",
    },
  ];

  return (
    <section aria-label="Tu tienda" className="rounded-lg border border-line bg-card">
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-display text-[15px] font-bold text-ink">Tu tienda</h2>
      </div>
      <ol className="flex flex-col gap-3 px-5 py-4">
        {pasos.map((paso) => (
          <li key={paso.titulo} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={`mt-0.5 grid size-6 flex-none place-items-center rounded-full text-[12px] font-bold ${
                paso.hecho ? "bg-success text-white" : "border border-line bg-sunken text-muted"
              }`}
            >
              {paso.hecho ? "✓" : ""}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                {paso.titulo}
                <span className="sr-only">{paso.hecho ? " (hecho)" : " (pendiente)"}</span>
              </p>
              <p className="text-[13px] text-ink-secondary">{paso.detalle}</p>
            </div>
            <Link href={paso.href} className="flex-none text-[13px] font-semibold text-link">
              {paso.accion}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
