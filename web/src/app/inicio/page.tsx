"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AvisoSuscripcion } from "@/components/AvisoSuscripcion";
import { BandejaChats } from "@/components/chats/BandejaChats";
import { ColumnaVentas } from "@/components/inicio/ColumnaVentas";
import { apiFetch } from "@/lib/api";
import { useRequireSession } from "@/lib/session";
import { useTutorial } from "@/lib/tutorial";

/**
 * Inicio: los chats de WhatsApp que atiende el asistente, con indicadores
 * rápidos y, en ventas, el estado del trato de cada uno.
 */
export default function InicioPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const [tieneAgente, setTieneAgente] = useState<boolean | null>(null);

  // Si todavía no generó un agente (llegó acá a mano), lo mandamos a completar el onboarding.
  useEffect(() => {
    if (status !== "authenticated") return;
    apiFetch("/agents/me")
      // Sin agente la API contesta 200 con el cuerpo vacío (un `null` de Nest):
      // `res.json()` explotaba, caía en el catch y dejaba entrar al Home igual.
      .then(async (res) => {
        if (!res.ok) return null;
        const texto = await res.text();
        return texto ? JSON.parse(texto) : null;
      })
      .then((agent) => {
        if (!agent) {
          router.replace("/contanos");
          return;
        }
        setTieneAgente(true);
      })
      .catch(() => setTieneAgente(true));
  }, [status, router]);

  useTutorial("inicio", tieneAgente === true);

  if (status !== "authenticated" || !user || !tieneAgente) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando tus chats…</p>
      </main>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader active="inicio" user={user} />
      <AvisoSuscripcion />

      <main className="flex min-h-0 w-full flex-1 flex-col gap-3 bg-page p-3 md:p-4">
        {/* El título visible está en el encabezado; éste es para lectores de pantalla. */}
        <h1 className="sr-only">Inicio</h1>
        {user.debePonerPassword && (
          <div role="status" className="rounded-md border border-line bg-card p-4 text-[13.5px] text-ink">
            Todavía no elegiste una contraseña: sin ella no vas a poder volver a entrar con tu número.{" "}
            <Link href="/contrasena" className="font-semibold text-link">
              Elegir contraseña
            </Link>
          </div>
        )}
        <BandejaChats
          ventas={user.tipoAsistente === "ventas"}
          // Una tienda sin chats todavía: lo que le falta para que el asistente venda.
          sinChats={user.tipoAsistente === "ventas" ? <ColumnaVentas /> : undefined}
        />
      </main>
    </div>
  );
}
