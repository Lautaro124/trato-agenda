"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ProbadorEnvios } from "@/components/envios/ProbadorEnvios";
import { useRequireSession } from "@/lib/session";

export default function ProbarEnviosPage() {
  const { user, status } = useRequireSession();
  const router = useRouter();
  const esVentas = user?.tipoAsistente === "ventas";

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
      <AppHeader active="envios" user={user} />
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-5 px-4 pt-6 pb-28 md:px-6 md:pb-16">
        <nav aria-label="Ruta" className="text-[14px] text-ink-secondary">
          <Link href="/envios" className="text-link underline">
            Envíos
          </Link>{" "}
          <span aria-hidden>›</span> Probador
        </nav>
        <div className="flex max-w-[680px] flex-col gap-1">
          <h1 className="font-display text-[28px] leading-tight font-extrabold text-ink">Probá cómo responde</h1>
          <p className="text-ink-secondary">
            Escribí como un cliente. Usa las mismas reglas que tus chats reales y te muestra qué zona aplicó y por qué.
          </p>
        </div>
        <ProbadorEnvios />
      </main>
    </div>
  );
}
