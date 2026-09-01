"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { TestChat } from "@/components/TestChat";
import { apiFetch } from "@/lib/api";
import { useRequireSession } from "@/lib/session";

type EventoListado = { id: string; resumen: string; inicio: string | null; fin: string | null };
type ResumenAgenda = { hoy: EventoListado[]; semanaCount: number };

const TIMEZONE = "America/Argentina/Buenos_Aires";

function formatearHora(iso: string | null): string {
  if (!iso) return "--:--";
  return new Intl.DateTimeFormat("es-AR", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

function formatearFecha(): string {
  const texto = new Intl.DateTimeFormat("es-AR", { timeZone: TIMEZONE, dateStyle: "full" }).format(new Date());
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export default function InicioPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const [tieneAgente, setTieneAgente] = useState<boolean | null>(null);
  const [resumen, setResumen] = useState<ResumenAgenda | null>(null);
  const [errorAgenda, setErrorAgenda] = useState(false);

  // Si todavía no generó un agente (llegó acá a mano), lo mandamos a completar el onboarding.
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

  useEffect(() => {
    if (!tieneAgente) return;
    apiFetch("/calendar/resumen")
      .then((res) => {
        if (!res.ok) throw new Error("resumen no disponible");
        return res.json() as Promise<ResumenAgenda>;
      })
      .then(setResumen)
      .catch(() => setErrorAgenda(true));
  }, [tieneAgente]);

  if (status !== "authenticated" || !user || !tieneAgente) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando tu agenda…</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="inicio" user={user} />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-5 bg-page p-5 pb-24 md:pb-5 lg:grid-cols-[1fr_420px]">
        {/* Columna de agenda */}
        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <div>
            <h1 className="mb-1 font-display text-[27px] leading-[1.15] font-bold tracking-[-0.025em] text-ink">
              Hola, {user.name?.split(" ")[0] ?? "de nuevo"}
            </h1>
            <p className="text-sm leading-[1.6] text-ink-secondary">{formatearFecha()}</p>
          </div>

          <div className="flex gap-3">
            <div className="flex-1 rounded-lg border border-line bg-card p-4">
              <div className="font-display text-2xl font-bold text-ink">{resumen?.hoy.length ?? "–"}</div>
              <div className="text-[12.5px] text-ink-secondary">Hoy</div>
            </div>
            <div className="flex-1 rounded-lg border border-line bg-card p-4">
              <div className="font-display text-2xl font-bold text-ink">{resumen?.semanaCount ?? "–"}</div>
              <div className="text-[12.5px] text-ink-secondary">Esta semana</div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-card">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="font-display text-[15px] font-bold text-ink">Tu día</h2>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-5 py-4">
              {errorAgenda && (
                <p className="text-sm text-danger-text">
                  No pudimos cargar tu agenda de Google Calendar ahora mismo.
                </p>
              )}
              {!errorAgenda && resumen && resumen.hoy.length === 0 && (
                <p className="text-sm text-muted">No tenés reuniones hoy.</p>
              )}
              {resumen?.hoy.map((evento) => (
                <div key={evento.id} className="flex items-start gap-4">
                  <span className="w-[52px] flex-none pt-[3px] font-mono text-[12.5px] text-muted">
                    {formatearHora(evento.inicio)}
                  </span>
                  <div className="flex-1 rounded-md bg-sunken px-4 py-3">
                    <div className="text-sm font-semibold text-ink">{evento.resumen || "(Sin título)"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Banco de pruebas del agente: en móvil vive en /chat */}
        <div className="hidden min-h-0 lg:flex lg:flex-col">
          <TestChat />
        </div>
      </main>

      <MobileTabBar active="inicio" />
    </div>
  );
}
