"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { CampoTelefono } from "@/components/ui/CampoTelefono";
import { apiFetch } from "@/lib/api";
import { INPUT_FORM } from "@/lib/password";
import { PAIS_POR_DEFECTO, telefonoCompleto, type Pais } from "@/lib/telefono";

function mensajeDeError(status: number): string {
  if (status === 401) return "El número o la contraseña no son correctos.";
  if (status === 429) return "Demasiados intentos. Probá en unos minutos.";
  if (status === 400) return "Revisá el número: con código de país, sin espacios ni guiones.";
  return "No se pudo entrar.";
}

/** Entrar con el número de WhatsApp y la contraseña que se eligió después del QR. */
export function LoginWhatsapp() {
  const [pais, setPais] = useState<Pais>(PAIS_POR_DEFECTO);
  const [nacional, setNacional] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const telefono = telefonoCompleto(pais, nacional);

  async function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/auth/whatsapp/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono, password }),
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
      <CampoTelefono pais={pais} onPais={setPais} nacional={nacional} onNacional={setNacional} />
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
      <Button type="submit" size="lg" fullWidth disabled={enviando || telefono.length < 8 || !password}>
        {enviando ? "Entrando…" : "Entrar"}
      </Button>
      <Link href="/entrar/codigo" className="self-end text-[13px] text-link">
        ¿Olvidaste tu contraseña?
      </Link>
    </form>
  );
}
