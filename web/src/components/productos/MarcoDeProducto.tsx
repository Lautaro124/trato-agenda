"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { useRequireSession } from "@/lib/session";

/**
 * Lo común de las pantallas de producto (/productos/nuevo…, /productos/[id]):
 * sesión, sólo cuentas de ventas y el encabezado. Sin la barra de abajo del
 * celular: ahí va el pie con Guardar.
 */
export function MarcoDeProducto({ children }: Readonly<{ children: ReactNode }>) {
  const { user, status } = useRequireSession();
  const router = useRouter();
  const esVentas = user?.tipoAsistente === "ventas";

  // Una cuenta de agenda no vende: su pantalla es el calendario.
  useEffect(() => {
    if (status === "authenticated" && user && !esVentas) router.replace("/inicio");
  }, [status, user, esVentas, router]);

  if (status !== "authenticated" || !user || !esVentas) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando…</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="productos" user={user} />
      {children}
    </div>
  );
}
