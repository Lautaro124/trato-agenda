"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { soloDigitos } from "@/lib/telefono";

const INPUT =
  "w-full rounded-sm border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-primary";

async function mensajeDeError(res: Response, porDefecto: string): Promise<string> {
  if (res.status === 429) return "Esperá un momento antes de volver a intentar.";
  if (res.status === 403) return "La contraseña actual no es correcta.";
  if (res.status === 401) return "El código no es válido o venció. Pedí uno nuevo.";
  try {
    const cuerpo = (await res.json()) as { message?: string | string[] };
    const mensaje = Array.isArray(cuerpo.message) ? cuerpo.message[0] : cuerpo.message;
    // Los 4xx y el 503 (sin proveedor de email) traen un mensaje pensado para mostrar.
    if (mensaje && (res.status < 500 || res.status === 503)) return mensaje;
  } catch {
    // Sin cuerpo legible: el mensaje genérico.
  }
  return porDefecto;
}

/**
 * Email de recuperación (LAU-109): la forma de recuperar el acceso que no
 * depende de que WhatsApp esté conectado. Pide la contraseña actual y recién
 * queda guardado cuando se escribe el código que llegó a ese email.
 */
export function SeccionEmailRecuperacion({
  emailActual,
  tienePassword,
  onConfirmado,
}: {
  emailActual: string | null;
  tienePassword: boolean;
  onConfirmado: (email: string) => void;
}) {
  const [paso, setPaso] = useState<"email" | "codigo">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null);

  async function pedirCodigo(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setAviso(null);
    try {
      const res = await apiFetch("/auth/email-recuperacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        setAviso({ texto: await mensajeDeError(res, "No pudimos mandar el código. Probá de nuevo."), ok: false });
        return;
      }
      setPassword("");
      setPaso("codigo");
    } catch {
      setAviso({ texto: "No se pudo conectar con Trato.", ok: false });
    } finally {
      setEnviando(false);
    }
  }

  async function confirmar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setAviso(null);
    try {
      const res = await apiFetch("/auth/email-recuperacion/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      if (!res.ok) {
        setAviso({ texto: await mensajeDeError(res, "No pudimos confirmar el email. Probá de nuevo."), ok: false });
        return;
      }
      const { emailRecuperacion } = (await res.json()) as { emailRecuperacion: string };
      onConfirmado(emailRecuperacion);
      setPaso("email");
      setEmail("");
      setCodigo("");
      setAviso({ texto: "Listo: ese email quedó confirmado para recuperar tu acceso.", ok: true });
    } catch {
      setAviso({ texto: "No se pudo conectar con Trato.", ok: false });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section id="email-recuperacion" className="scroll-mt-20 rounded-lg border border-line bg-card p-5">
      <h2 className="mb-2 font-display text-[15px] font-bold text-ink">Email de recuperación</h2>
      <p className="text-[13.5px] leading-[1.6] text-ink-secondary">
        {emailActual ? (
          <>
            Si olvidás la contraseña, el código para entrar también llega a{" "}
            <strong className="font-semibold text-ink">{emailActual}</strong>, aunque WhatsApp esté desconectado.
          </>
        ) : (
          "Si olvidás la contraseña y WhatsApp está desconectado, hoy no tenés por dónde recibir el código. Sumá un email y lo confirmamos con un código."
        )}
      </p>

      {!tienePassword ? (
        <p className="mt-3 text-[13px] text-ink-secondary">Primero elegí una contraseña en la sección Contraseña.</p>
      ) : paso === "email" ? (
        <form
          onSubmit={(e) => void pedirCodigo(e)}
          aria-label="Sumar email de recuperación"
          className="mt-4 flex flex-col gap-2.5"
        >
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={emailActual ? "Email nuevo" : "tu@email.com"}
            aria-label="Email de recuperación"
            maxLength={254}
            required
            className={INPUT}
          />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Tu contraseña actual"
            aria-label="Contraseña actual para el email"
            required
            className={INPUT}
          />
          {aviso && (
            <p role="status" className={aviso.ok ? "text-[13px] text-success-text" : "text-[13px] text-danger-text"}>
              {aviso.texto}
            </p>
          )}
          <div>
            <Button type="submit" variant="secondary" size="md" disabled={enviando || !email.trim() || !password}>
              {enviando ? "Enviando…" : "Mandarme el código"}
            </Button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => void confirmar(e)}
          aria-label="Confirmar email de recuperación"
          className="mt-4 flex flex-col gap-2.5"
        >
          <p className="text-[13px] text-ink-secondary">
            Te mandamos un código de 6 dígitos a <strong className="font-semibold text-ink">{email.trim()}</strong>.
            Vence en 10 minutos.
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
            aria-label="Código del email"
            required
            className={`${INPUT} font-mono tracking-[0.3em]`}
          />
          {aviso && (
            <p role="status" className={aviso.ok ? "text-[13px] text-success-text" : "text-[13px] text-danger-text"}>
              {aviso.texto}
            </p>
          )}
          <div className="flex items-center gap-4">
            <Button type="submit" variant="secondary" size="md" disabled={enviando || codigo.length !== 6}>
              {enviando ? "Confirmando…" : "Confirmar email"}
            </Button>
            <button
              type="button"
              className="text-[13px] text-link"
              onClick={() => {
                setPaso("email");
                setCodigo("");
                setAviso(null);
              }}
            >
              Cambiar email
            </button>
          </div>
        </form>
      )}

    </section>
  );
}
