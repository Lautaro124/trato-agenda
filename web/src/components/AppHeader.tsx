"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Wordmark } from "@/components/Wordmark";
import { apiFetch } from "@/lib/api";
import { iniciales, useSession, type Usuario } from "@/lib/session";

type Tab = "inicio" | "vinculacion" | "calendario" | "chat" | "plan" | "cuenta";

type WhatsappStatus = { linked: boolean; phoneNumber: string | null };

const TAB_CLASSES = {
  active: "bg-sunken font-semibold text-ink",
  inactive: "text-ink-secondary hover:bg-sunken",
  disabled: "cursor-default text-muted",
};

/** Nav superior compartida por /inicio y /vincular (variantes 1e/3a del canvas). */
export function AppHeader({ active, user }: { active: Tab; user: Usuario }) {
  const { signOut } = useSession();
  const [whatsapp, setWhatsapp] = useState<WhatsappStatus | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();

    const fetchStatus = () => {
      apiFetch("/whatsapp/status", { signal: ctrl.signal })
        .then((res) => (res.ok ? (res.json() as Promise<WhatsappStatus>) : null))
        .then((data) => data && setWhatsapp(data))
        .catch(() => {});
    };

    fetchStatus();

    const onVisible = () => {
      if (document.visibilityState === "visible") fetchStatus();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <header className="flex h-[60px] flex-none items-center gap-4 border-b border-line bg-card px-5">
      <Wordmark size={23} />

      <nav className="ml-4 hidden gap-0.5 md:flex">
        <Link
          href="/inicio"
          className={`rounded-sm px-3 py-1.5 text-[13.5px] ${active === "inicio" ? TAB_CLASSES.active : TAB_CLASSES.inactive}`}
        >
          Inicio
        </Link>
        <Link
          href="/calendario"
          className={`rounded-sm px-3 py-1.5 text-[13.5px] ${active === "calendario" ? TAB_CLASSES.active : TAB_CLASSES.inactive}`}
        >
          Calendario
        </Link>
        <Link
          href="/vincular"
          className={`rounded-sm px-3 py-1.5 text-[13.5px] ${active === "vinculacion" ? TAB_CLASSES.active : TAB_CLASSES.inactive}`}
        >
          Vinculación
        </Link>
        <Link
          href="/plan"
          className={`rounded-sm px-3 py-1.5 text-[13.5px] ${active === "plan" ? TAB_CLASSES.active : TAB_CLASSES.inactive}`}
        >
          Plan
        </Link>
        <Link
          href="/cuenta"
          className={`rounded-sm px-3 py-1.5 text-[13.5px] ${active === "cuenta" ? TAB_CLASSES.active : TAB_CLASSES.inactive}`}
        >
          Cuenta
        </Link>
      </nav>

      <div className="ml-auto flex items-center gap-4">
        {whatsapp && (
          <Badge tone={whatsapp.linked ? "success" : "warning"}>
            {whatsapp.linked ? "WhatsApp conectado" : "WhatsApp sin vincular"}
          </Badge>
        )}

        <button
          type="button"
          onClick={() => void signOut()}
          title="Salir"
          className="cursor-pointer"
        >
          {user.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt=""
              width={32}
              height={32}
              className="size-8 rounded-full object-cover"
            />
          ) : (
            <span className="grid size-8 place-items-center rounded-full bg-primary-subtle text-[13px] font-bold text-primary-hover">
              {iniciales(user)}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
