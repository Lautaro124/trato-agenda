"use client";

import Link from "next/link";
import { useState } from "react";
import type { Usuario } from "@/lib/session";

const CLAVE = "trato:aviso-email-recuperacion";
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

function estaPospuesto(): boolean {
  try {
    const hasta = Number(window.localStorage.getItem(CLAVE));
    return Number.isFinite(hasta) && hasta > Date.now();
  } catch {
    return false;
  }
}

/**
 * La migración de las cuentas de WhatsApp (LAU-109): hoy su única forma de
 * recuperar el acceso es un código por la sesión vinculada. No bloquea nada;
 * "Más tarde" lo esconde una semana en este navegador.
 */
export function AvisoEmailRecuperacion({ user }: { user: Usuario }) {
  // Sólo se monta en el cliente, con la sesión ya cargada (Inicio muestra
  // "Cargando…" hasta entonces), así que acá ya hay localStorage.
  const [pospuesto, setPospuesto] = useState(estaPospuesto);

  if (!user.debeSumarEmailRecuperacion || pospuesto) return null;

  const posponer = () => {
    try {
      window.localStorage.setItem(CLAVE, String(Date.now() + SIETE_DIAS_MS));
    } catch {
      // Sin almacenamiento: se esconde hasta recargar.
    }
    setPospuesto(true);
  };

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-line bg-card p-4 text-[13.5px] text-ink sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="leading-[1.6]">
        Sumá un email para recuperar tu acceso aunque WhatsApp se desconecte. Te lleva un minuto y no cambia
        nada de tu cuenta.
      </p>
      <div className="flex shrink-0 items-center gap-4">
        <Link href="/cuenta#email-recuperacion" className="font-semibold text-link">
          Sumar email
        </Link>
        <button type="button" onClick={posponer} className="text-[13px] text-ink-secondary">
          Más tarde
        </button>
      </div>
    </div>
  );
}
