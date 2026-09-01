"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GoogleMark } from "@/components/GoogleMark";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session";

const PITCH = [
  "“Buscá un hueco con Ana el jueves” y listo.",
  "Mueve, cancela y recuerda por vos.",
  "Se conecta a tu Google Calendar de siempre.",
];

export default function EntrarPage() {
  const router = useRouter();
  const { status, signIn } = useSession();
  const [pending, setPending] = useState(false);

  // Con cookie viva no tiene sentido mostrar el botón: seguimos el onboarding
  // donde haya quedado (paso 2) o, si ya tiene agente, vamos directo a la Home.
  useEffect(() => {
    if (status !== "authenticated") return;
    const ctrl = new AbortController();
    apiFetch("/agents/me", { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((agent) => router.replace(agent ? "/inicio" : "/contanos"))
      .catch(() => {
        if (!ctrl.signal.aborted) router.replace("/contanos");
      });
    return () => ctrl.abort();
  }, [status, router]);

  /**
   * OAuth real: la API redirige al consentimiento de Google y su callback
   * vuelve a /contanos con la cookie de sesión puesta.
   */
  function handleGoogle() {
    setPending(true);
    signIn();
  }

  return (
    <main className="flex min-h-dvh flex-col lg:flex-row">
      {/* Panel de marca */}
      <section className="flex flex-col justify-between gap-10 bg-primary p-6 text-white sm:p-8 lg:w-[48%] lg:gap-0 lg:p-12">
        <Wordmark onColor />

        <div>
          <h1 className="mb-6 font-display text-[28px] leading-[1.08] font-bold tracking-[-0.03em] text-pretty sm:text-[34px] lg:text-[44px]">
            Coordiná reuniones sin salir del chat.
          </h1>
          <ul className="flex max-w-[400px] flex-col gap-3">
            {PITCH.map((line) => (
              <li key={line} className="flex items-start gap-3">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-white/90" />
                <span className="text-[15px] leading-[1.55] text-white/95">{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <span className="text-xs text-white/75">Trato Agenda · 2026</span>
      </section>

      {/* Panel de ingreso */}
      <section className="grid flex-1 place-items-center bg-card p-6 sm:p-8">
        <div className="w-full max-w-[340px]">
          <h2 className="mb-2 font-display text-2xl font-bold tracking-[-0.02em] text-ink">
            Entrar
          </h2>
          <p className="mb-8 text-sm leading-[1.6] text-ink-secondary">
            Usá la misma cuenta de Google donde vive tu calendario.
          </p>

          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={pending || status === "loading"}
            onClick={handleGoogle}
            icon={<GoogleMark onColor />}
          >
            {pending ? "Entrando…" : "Continuar con Google"}
          </Button>

          <div className="mt-6 rounded-md bg-sunken p-4">
            <p className="text-[12.5px] leading-[1.6] text-ink-secondary">
              Después vas a vincular WhatsApp con un código QR. Podés desconectarlo
              cuando quieras.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
