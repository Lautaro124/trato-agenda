"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { INPUT_FORM } from "@/lib/password";

function mensajeDeError(status: number): string {
  if (status === 401) return "El número o la contraseña no son correctos.";
  if (status === 429) return "Demasiados intentos. Probá en unos minutos.";
  if (status === 400) return "Revisá el número: con código de país, sin espacios ni guiones.";
  return "No se pudo entrar.";
}

/** Entrar con el número de WhatsApp y la contraseña que se eligió después del QR. */
export function LoginWhatsapp() {
  const [telefono, setTelefono] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/auth/whatsapp/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: telefono.replace(/\D/g, ""), password }),
      });
      if (!res.ok) {
        setError(mensajeDeError(res.status));
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
    <form onSubmit={(e) => void entrar(e)} aria-label="Entrar con WhatsApp" className="flex flex-col gap-2.5">
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={telefono}
        onChange={(e) => setTelefono(e.target.value)}
        placeholder="Tu WhatsApp, ej. +54 9 11 2233 4455"
        aria-label="Número de WhatsApp"
        required
        className={INPUT_FORM}
      />
      <input
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Contraseña"
        aria-label="Contraseña"
        required
        className={INPUT_FORM}
      />
      {error && (
        <p role="alert" className="text-[13px] text-danger-text">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" fullWidth disabled={enviando || !telefono || !password}>
        {enviando ? "Entrando…" : "Entrar"}
      </Button>
      <Link href="/entrar/codigo" className="self-end text-[13px] text-link">
        ¿Olvidaste tu contraseña?
      </Link>
    </form>
  );
}
