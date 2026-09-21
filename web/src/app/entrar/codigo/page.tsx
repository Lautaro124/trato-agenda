"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FooterLegal } from "@/components/FooterLegal";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/ui/Button";
import { CampoTelefono } from "@/components/ui/CampoTelefono";
import { apiFetch } from "@/lib/api";
import { INPUT_FORM as INPUT, PASSWORD_MIN, problemaDePassword } from "@/lib/password";
import { useSession } from "@/lib/session";
import { PAIS_POR_DEFECTO, soloDigitos, telefonoCompleto, type Pais } from "@/lib/telefono";

/**
 * Recuperar la contraseña de una cuenta de WhatsApp: el código llega al chat
 * propio ("Vos") del número vinculado y, junto con él, se elige una contraseña
 * nueva. La API contesta igual exista o no la cuenta, así que la pantalla nunca
 * dice "ese número no existe".
 */
export default function RecuperarContrasenaPage() {
  const router = useRouter();
  const { status } = useSession();
  const [paso, setPaso] = useState<"telefono" | "codigo">("telefono");
  const [pais, setPais] = useState<Pais>(PAIS_POR_DEFECTO);
  const [nacional, setNacional] = useState("");
  const [codigo, setCodigo] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const telefono = telefonoCompleto(pais, nacional);

  useEffect(() => {
    if (status === "authenticated") router.replace("/entrar");
  }, [status, router]);

  async function pedirCodigo(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/auth/whatsapp/codigo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono }),
      });
      if (res.status === 429) setError("Esperá un minuto antes de pedir otro código.");
      else if (!res.ok) setError("Revisá el número: con código de país, sin espacios ni guiones.");
      else setPaso("codigo");
    } catch {
      setError("No se pudo conectar con Trato Agenda.");
    } finally {
      setEnviando(false);
    }
  }

  async function verificar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const problema = problemaDePassword(nueva, confirmacion);
    if (problema) {
      setError(problema);
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/auth/whatsapp/codigo/verificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono, codigo, nuevaPassword: nueva }),
      });
      if (!res.ok) {
        setError(
          res.status === 429 ? "Demasiados intentos. Probá más tarde." : "El código no es válido o venció.",
        );
        setEnviando(false);
        return;
      }
      const { destino } = (await res.json()) as { destino: string };
      // Navegación completa: SessionProvider sólo pregunta /auth/me al montar.
      window.location.href = destino;
    } catch {
      setError("No se pudo conectar con Trato Agenda.");
      setEnviando(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-page p-5">
      <div className="w-full max-w-[380px] rounded-lg border border-line bg-card p-6 shadow-md">
        <Link href="/entrar" aria-label="Volver a entrar" className="mb-6 inline-block">
          <Wordmark size={24} />
        </Link>

        {paso === "telefono" ? (
          <form onSubmit={(e) => void pedirCodigo(e)} aria-label="Pedir código" className="flex flex-col gap-3">
            <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink">Recuperá tu contraseña</h1>
            <p className="text-sm leading-[1.6] text-ink-secondary">
              Te mandamos un código a tu propio chat de WhatsApp (el que dice “Vos”), desde el número que
              vinculaste, y con él elegís una contraseña nueva.
            </p>
            <CampoTelefono pais={pais} onPais={setPais} nacional={nacional} onNacional={setNacional} />
            {error && (
              <p role="alert" className="text-[13px] text-danger-text">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" fullWidth disabled={enviando || telefono.length < 8}>
              {enviando ? "Enviando…" : "Mandarme el código"}
            </Button>
          </form>
        ) : (
          <form
            onSubmit={(e) => void verificar(e)}
            aria-label="Recuperar contraseña"
            className="flex flex-col gap-3"
          >
            <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink">Revisá tu WhatsApp</h1>
            <p className="text-sm leading-[1.6] text-ink-secondary">
              Si <strong className="font-semibold">+{telefono}</strong> tiene cuenta, le llegó un
              código de 6 dígitos a su propio chat. Vence en 10 minutos.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={codigo}
              onChange={(e) => setCodigo(soloDigitos(e.target.value))}
              placeholder="123456"
              aria-label="Código de 6 dígitos"
              required
              className={`${INPUT} text-center font-mono text-[22px] tracking-[0.3em]`}
            />
            <input
              type="password"
              autoComplete="new-password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              placeholder={`Contraseña nueva (al menos ${PASSWORD_MIN} caracteres)`}
              aria-label="Contraseña nueva"
              required
              className={INPUT}
            />
            <input
              type="password"
              autoComplete="new-password"
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              placeholder="Repetila"
              aria-label="Repetir contraseña"
              required
              className={INPUT}
            />
            {error && (
              <p role="alert" className="text-[13px] text-danger-text">
                {error}
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              fullWidth
              disabled={enviando || codigo.length !== 6 || !nueva || !confirmacion}
            >
              {enviando ? "Guardando…" : "Guardar y entrar"}
            </Button>
            <button
              type="button"
              className="text-[13px] text-link"
              onClick={() => {
                setPaso("telefono");
                setCodigo("");
                setNueva("");
                setConfirmacion("");
                setError(null);
              }}
            >
              Cambiar número o pedir otro código
            </button>
          </form>
        )}

        <div className="mt-6 rounded-md bg-sunken p-4 text-[12.5px] leading-[1.6] text-ink-secondary">
          ¿No te llega? Si desvinculaste Trato Agenda de tu teléfono, el código no tiene por dónde salir.{" "}
          <Link href="/entrar/whatsapp" className="text-link">
            Escaneá el QR de nuevo
          </Link>{" "}
          y volvés a tu misma cuenta; ahí elegís la contraseña. ¿Te acordaste?{" "}
          <Link href="/entrar" className="text-link">
            Volver a entrar
          </Link>
          .
        </div>

        <FooterLegal className="mt-6" />
      </div>
    </main>
  );
}
