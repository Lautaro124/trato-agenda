"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FooterLegal } from "@/components/FooterLegal";
import { GoogleMark } from "@/components/GoogleMark";
import { LoginDev } from "@/components/LoginDev";
import { LoginWhatsapp } from "@/components/LoginWhatsapp";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session";

const PITCH = [
  "“Buscá un hueco con Ana el jueves” y listo.",
  "Mueve, cancela y recuerda por vos.",
  "Solo con tu WhatsApp, o con tu Google Calendar si ya lo usás.",
];

/** Mismo aspecto que `Button` secondary lg, pero es un enlace a otra ruta. */
const BOTON_WHATSAPP =
  "inline-flex w-full items-center justify-center gap-2 rounded-md border border-line-strong bg-card px-6 py-3 text-[17px] font-semibold text-ink shadow-sm transition-colors hover:bg-sunken";

export default function EntrarPage() {
  const router = useRouter();
  const { user, status, signIn } = useSession();
  const [pending, setPending] = useState(false);

  // Con cookie viva no tiene sentido mostrar el botón: seguimos el onboarding
  // donde haya quedado (paso 2) o, si ya tiene agente, vamos directo a la Home.
  useEffect(() => {
    if (status !== "authenticated") return;
    if (user?.debePonerPassword) {
      router.replace("/contrasena");
      return;
    }
    const ctrl = new AbortController();
    apiFetch("/agents/me", { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((agent) => router.replace(agent ? "/inicio" : "/contanos"))
      .catch(() => {
        if (!ctrl.signal.aborted) router.replace("/contanos");
      });
    return () => ctrl.abort();
  }, [status, user, router]);

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
          <p className="mb-6 text-sm leading-[1.6] text-ink-secondary">
            Con tu número de WhatsApp y tu contraseña.
          </p>

          <LoginWhatsapp />

          <div className="mt-6 flex flex-col gap-2.5">
            <p className="text-[13.5px] text-ink-secondary">¿No tenés cuenta?</p>
            <Link href="/entrar/whatsapp" className={BOTON_WHATSAPP}>
              Creala con tu WhatsApp
            </Link>
          </div>

          <div className="my-4 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />o<span className="h-px flex-1 bg-line" />
          </div>

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
              Con WhatsApp, tus turnos quedan en Trato Agenda. Con Google, van a tu Google
              Calendar y después vinculás WhatsApp con un código QR.
            </p>
          </div>

          {/* NODE_ENV se inlinea en el build: en producción este bloque ni llega al bundle. */}
          {process.env.NODE_ENV !== "production" && <LoginDev />}

          {/* Los enlaces legales tienen que estar en la pantalla que dispara el
              consentimiento de Google: es donde los busca quien revisa la app. */}
          <FooterLegal className="mt-8" />
        </div>
      </section>
    </main>
  );
}
