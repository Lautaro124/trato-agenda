"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Wordmark } from "@/components/Wordmark";
import { apiFetch } from "@/lib/api";
import { identificador, iniciales, useSession, type Usuario } from "@/lib/session";

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
  const [menuAbierto, setMenuAbierto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuAbierto) return;

    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAbierto(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuAbierto(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuAbierto]);

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
      <Link href="/inicio">
        <Wordmark size={23} />
      </Link>

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
          href="/plan"
          className={`rounded-sm px-3 py-1.5 text-[13.5px] ${active === "plan" ? TAB_CLASSES.active : TAB_CLASSES.inactive}`}
        >
          Plan
        </Link>
      </nav>

      <div className="ml-auto flex items-center gap-4">
        {whatsapp && (
          <Badge tone={whatsapp.linked ? "success" : "warning"}>
            {whatsapp.linked ? "WhatsApp conectado" : "WhatsApp sin vincular"}
          </Badge>
        )}

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuAbierto((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuAbierto}
            className="flex cursor-pointer items-center gap-2"
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
            <span className="hidden text-sm text-ink-secondary sm:inline-block">{identificador(user)}</span>
          </button>

          {menuAbierto && (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-2 w-44 overflow-hidden rounded-md border border-line bg-card shadow-md"
            >
              <Link
                href="/vincular"
                role="menuitem"
                onClick={() => setMenuAbierto(false)}
                className={`block px-4 py-2 text-[13.5px] ${active === "vinculacion" ? "font-semibold text-ink" : "text-ink-secondary"} hover:bg-sunken`}
              >
                Vinculación
              </Link>
              <Link
                href="/cuenta"
                role="menuitem"
                onClick={() => setMenuAbierto(false)}
                className={`block px-4 py-2 text-[13.5px] ${active === "cuenta" ? "font-semibold text-ink" : "text-ink-secondary"} hover:bg-sunken`}
              >
                Cuenta
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuAbierto(false);
                  void signOut();
                }}
                className="block w-full border-t border-line px-4 py-2 text-left text-[13.5px] text-danger hover:bg-sunken"
              >
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
