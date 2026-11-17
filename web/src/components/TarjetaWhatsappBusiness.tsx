"use client";

import { useState } from "react";
import { BotonWhatsappBusiness } from "@/components/BotonWhatsappBusiness";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAvisos } from "@/components/ui/Avisos";
import { apiFetch } from "@/lib/api";
import type { useMetaSignup } from "@/lib/metaSignup";

const VENTAJAS = [
  "Es la conexión oficial de Meta: WhatsApp no bloquea el número por usar el asistente.",
  "Si tu número ya está en la app WhatsApp Business, la seguís usando en el celular y ves todo lo que contesta el asistente.",
  "Te pide entrar con Facebook y elegir tu cuenta de WhatsApp Business (o crearla).",
];

function Tarjeta({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex w-full max-w-[560px] flex-col gap-5 rounded-lg border border-line bg-card p-6 shadow-md md:p-8">
      {children}
    </section>
  );
}

/** Conectar WhatsApp Business por la API oficial (Embedded Signup). */
export function TarjetaWhatsappBusiness({
  signup,
  migrando,
  onConectado,
}: {
  signup: ReturnType<typeof useMetaSignup>;
  /** Ya atiende por QR: el texto invita a pasarse a la API oficial. */
  migrando: boolean;
  onConectado: () => void;
}) {
  return (
    <Tarjeta>
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl leading-[1.2] font-bold tracking-[-0.02em] text-ink">
            {migrando ? "Pasate a la API oficial" : "Conectá tu WhatsApp Business"}
          </h1>
          <Badge tone="success">Recomendado</Badge>
        </div>
        <p className="text-sm leading-[1.6] text-ink-secondary">
          {migrando
            ? "Tu número sigue siendo el mismo: al conectarlo con la API oficial cerramos la vinculación por QR."
            : "Es el número que va a atender a tus clientes."}
        </p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {VENTAJAS.map((ventaja) => (
          <li key={ventaja} className="flex items-start gap-2.5 text-[14px] leading-[1.55] text-ink">
            <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-success" />
            {ventaja}
          </li>
        ))}
      </ul>
      <BotonWhatsappBusiness
        signup={signup}
        endpoint="/whatsapp/meta/conectar"
        texto={migrando ? "Conectar con la API oficial" : "Conectar WhatsApp Business"}
        onListo={onConectado}
      />
    </Tarjeta>
  );
}

/** WhatsApp Business ya conectado por la API oficial. */
export function TarjetaMetaConectada({
  phone,
  onContinuar,
  onDesconectado,
}: {
  phone: string;
  onContinuar: () => void;
  onDesconectado: () => void;
}) {
  const { confirmar, avisar } = useAvisos();
  const [pendiente, setPendiente] = useState(false);

  async function desconectar() {
    const ok = await confirmar({
      titulo: "¿Desconectar WhatsApp Business?",
      texto: "El asistente deja de contestar hasta que lo vuelvas a conectar. Tus chats y tu cuenta no se borran.",
      confirmar: "Desconectar",
      tono: "peligro",
    });
    if (!ok) return;
    setPendiente(true);
    try {
      const res = await apiFetch("/whatsapp/meta/desconectar", { method: "POST" });
      if (!res.ok) throw new Error();
      avisar("WhatsApp Business desconectado.", "exito");
      onDesconectado();
    } catch {
      avisar("No pudimos desconectarlo. Probá de nuevo.", "error");
    } finally {
      setPendiente(false);
    }
  }

  return (
    <Tarjeta>
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-success-subtle">
          <span className="h-3 w-[22px] -translate-y-[3px] rotate-[-45deg] rounded-[2px] border-b-[3px] border-l-[3px] border-success" />
        </span>
        <div>
          <h1 className="mb-1 font-display text-[22px] leading-[1.2] font-bold text-ink">WhatsApp Business conectado</h1>
          <p className="text-sm leading-[1.6] text-ink-secondary">
            Con la API oficial de Meta. El asistente contesta los chats de este número.
          </p>
        </div>
      </div>
      <div className="flex w-fit items-center gap-2 rounded-full bg-sunken px-3 py-[7px] text-[13px] text-ink">
        <span className="size-[7px] rounded-full bg-success" />+{phone}
      </div>
      <p className="text-[13px] leading-[1.55] text-ink-secondary">
        Por la API oficial, WhatsApp sólo deja escribirle a un cliente hasta 24 h después de su último mensaje. Pasado
        ese plazo, contestale desde la app WhatsApp Business.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="primary" size="md" onClick={onContinuar}>
          Ir a mi agenda
        </Button>
        <Button variant="ghost" size="md" disabled={pendiente} onClick={() => void desconectar()}>
          {pendiente ? "Desconectando…" : "Desconectar"}
        </Button>
      </div>
    </Tarjeta>
  );
}
