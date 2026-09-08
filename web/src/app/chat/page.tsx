"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AvisoSuscripcion } from "@/components/AvisoSuscripcion";
import { MobileTabBar } from "@/components/MobileTabBar";
import { TestChat } from "@/components/TestChat";
import { apiFetch } from "@/lib/api";
import { useRequireSession } from "@/lib/session";

/** Chat de prueba a pantalla completa (variante 5b del canvas): destino móvil, TestChat vive también inline en /inicio en escritorio. */
export default function ChatPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const [tieneAgente, setTieneAgente] = useState<boolean | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    apiFetch("/agents/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((agent) => {
        if (!agent) {
          router.replace("/contanos");
          return;
        }
        setTieneAgente(true);
      })
      .catch(() => setTieneAgente(true));
  }, [status, router]);

  if (status !== "authenticated" || !user || !tieneAgente) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando el chat…</p>
      </main>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader active="chat" user={user} />
      <AvisoSuscripcion />

      <main className="flex min-h-0 flex-1 flex-col bg-page p-4 pb-24 md:pb-5">
        <TestChat />
      </main>

      <MobileTabBar active="chat" />
    </div>
  );
}
