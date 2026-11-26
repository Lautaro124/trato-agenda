"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type KeyboardEvent } from "react";
import { FooterLegal } from "@/components/FooterLegal";
import { GoogleMark } from "@/components/GoogleMark";
import { LoginDev } from "@/components/LoginDev";
import { LoginWhatsapp } from "@/components/LoginWhatsapp";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";

const PITCH = [
  "Contesta a cualquier hora, como alguien de tu equipo.",
  "Agenda turnos o vende tus productos con link de pago.",
  "Un mes gratis, sin tarjeta.",
];

type Pestana = "entrar" | "nueva";

const PESTANAS: Array<{ id: Pestana; label: string }> = [
  { id: "entrar", label: "Ya tengo cuenta" },
  { id: "nueva", label: "Soy nuevo" },
];

function Separador({ children }: { children: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted">
      <span className="h-px flex-1 bg-line" />
      {children}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export default function EntrarPage() {
  const router = useRouter();
  const { user, status, signIn } = useSession();
  const [pending, setPending] = useState(false);
  const [pestana, setPestana] = useState<Pestana>("entrar");

  /** Flechas entre pestañas, como pide el patrón de tabs de ARIA. */
  function moverPestana(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const otra = pestana === "entrar" ? "nueva" : "entrar";
    setPestana(otra);
    document.getElementById(`pestana-${otra}`)?.focus();
  }

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
            Tu asistente atiende a tus clientes por WhatsApp.
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

        <span className="text-xs text-white/75">Trato · 2026</span>
      </section>

      {/* Panel de ingreso */}
      <section className="grid flex-1 place-items-center bg-card p-6 sm:p-8">
        <div className="w-full max-w-[340px]">
          {/* Crear cuenta y entrar llegan al mismo lado (Google y el alta por WhatsApp
              entran a la cuenta que ya exista); las pestañas sólo aclaran qué hace cada botón. */}
          <div role="tablist" aria-label="Qué querés hacer" className="mb-7 grid grid-cols-2 gap-1 rounded-md bg-sunken p-1">
            {PESTANAS.map(({ id, label }) => {
              const activa = pestana === id;
              return (
                <button
                  key={id}
                  id={`pestana-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={activa}
                  aria-controls={`panel-${id}`}
                  tabIndex={activa ? 0 : -1}
                  onClick={() => setPestana(id)}
                  onKeyDown={moverPestana}
                  className={cn(
                    "min-h-11 cursor-pointer rounded-sm text-[15px]",
                    activa ? "bg-card font-bold text-ink shadow-sm" : "font-semibold text-ink-secondary hover:text-ink",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {pestana === "entrar" ? (
            <div id="panel-entrar" role="tabpanel" aria-labelledby="pestana-entrar">
              <h2 className="mb-1.5 font-display text-2xl font-bold tracking-[-0.02em] text-ink">Entrá a tu cuenta</h2>
              <p className="mb-5 text-sm leading-[1.6] text-ink-secondary">
                Con el número de WhatsApp y la contraseña que elegiste.
              </p>

              <LoginWhatsapp />

              <Separador>o entrá con</Separador>

              <Button
                variant="secondary"
                size="lg"
                fullWidth
                disabled={pending || status === "loading"}
                onClick={handleGoogle}
                icon={<GoogleMark />}
              >
                {pending ? "Entrando…" : "Entrar con Google"}
              </Button>

              {/* Se inlinea en el build: en producción (salvo Railway develop) este bloque ni llega al bundle. */}
              {(process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENTORNO_RAILWAY === "develop") && (
                <LoginDev />
              )}
            </div>
          ) : (
            <div id="panel-nueva" role="tabpanel" aria-labelledby="pestana-nueva">
              <h2 className="mb-1.5 font-display text-2xl font-bold tracking-[-0.02em] text-ink">Creá tu cuenta gratis</h2>
              <p className="mb-5 text-sm leading-[1.6] text-ink-secondary">La creás con tu cuenta de Google. Tarda un minuto.</p>

              <Button
                variant="secondary"
                size="lg"
                fullWidth
                disabled={pending || status === "loading"}
                onClick={handleGoogle}
                icon={<GoogleMark />}
              >
                {pending ? "Entrando…" : "Crear cuenta con Google"}
              </Button>
              <p className="mt-2 text-[13px] leading-[1.55] text-ink-secondary">
                Después conectás tu WhatsApp Business con la API oficial de Meta, en un par de pasos.
              </p>
            </div>
          )}

          {/* Los enlaces legales tienen que estar en la pantalla que dispara el
              consentimiento de Google: es donde los busca quien revisa la app. */}
          <FooterLegal className="mt-8" conEmail={false} />
        </div>
      </section>
    </main>
  );
}
