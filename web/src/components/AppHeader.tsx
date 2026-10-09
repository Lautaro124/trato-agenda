"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CampanaNotificaciones } from "@/components/CampanaNotificaciones";
import { Badge } from "@/components/ui/Badge";
import { Wordmark } from "@/components/Wordmark";
import { apiFetch } from "@/lib/api";
import { identificador, iniciales, useSession, type Usuario } from "@/lib/session";

type Tab =
  | "inicio"
  | "vinculacion"
  | "calendario"
  | "reuniones"
  | "productos"
  | "ventas"
  | "chat"
  | "plan"
  | "cuenta"
  | "asistente";

type WhatsappStatus = { linked: boolean; phoneNumber: string | null };

const TAB_CLASSES = {
  active: "bg-sunken font-semibold text-ink",
  inactive: "text-ink-secondary hover:bg-sunken",
  disabled: "cursor-default text-muted",
};

type Pestana = { tab: Tab; href: string; label: string };

/**
 * Las pestañas dependen de qué hace el asistente: una cuenta de ventas no
 * tiene calendario ni reuniones, tiene catálogo.
 */
function pestanasDe(user: Usuario): Pestana[] {
  const inicio: Pestana = { tab: "inicio", href: "/inicio", label: "Inicio" };
  const plan: Pestana = { tab: "plan", href: "/plan", label: "Plan" };
  const asistente: Pestana = { tab: "asistente", href: "/asistente", label: "Asistente" };
  if (user.tipoAsistente === "ventas") {
    return [
      inicio,
      { tab: "productos", href: "/productos", label: "Productos" },
      { tab: "ventas", href: "/ventas", label: "Ventas" },
      asistente,
      plan,
    ];
  }
  return [
    inicio,
    { tab: "calendario", href: "/calendario", label: "Calendario" },
    { tab: "reuniones", href: "/reuniones", label: "Reuniones" },
    asistente,
    plan,
  ];
}

/** La flecha avisa que el bloque del usuario abre un menú; gira mientras está abierto. */
function FlechaMenu({ abierto, size }: { abierto: boolean; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`text-muted transition-transform ${abierto ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

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
        {pestanasDe(user).map((pestana) => (
          <Link
            key={pestana.tab}
            href={pestana.href}
            className={`rounded-sm px-3 py-1.5 text-[13.5px] ${active === pestana.tab ? TAB_CLASSES.active : TAB_CLASSES.inactive}`}
          >
            {pestana.label}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3 sm:gap-4">
        <CampanaNotificaciones />
        {whatsapp && (
          <span className="whitespace-nowrap">
            <Badge tone={whatsapp.linked ? "success" : "warning"}>
              {whatsapp.linked ? "WhatsApp conectado" : "WhatsApp sin vincular"}
            </Badge>
          </span>
        )}

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuAbierto((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuAbierto}
            className="flex cursor-pointer items-center gap-2"
          >
            <span className="relative flex-none">
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
              {/* En el celular no entra al lado: va sobre la esquina del avatar. */}
              <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full border border-line bg-card sm:hidden">
                <FlechaMenu abierto={menuAbierto} size={10} />
              </span>
            </span>
            <span className="hidden text-sm text-ink-secondary sm:inline-block">{identificador(user)}</span>
            <span className="hidden sm:inline-flex">
              <FlechaMenu abierto={menuAbierto} size={14} />
            </span>
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
              {/* En el celular la barra de abajo no tiene lugar para "Asistente": se llega desde acá. */}
              <Link
                href="/asistente"
                role="menuitem"
                onClick={() => setMenuAbierto(false)}
                className={`block px-4 py-2 text-[13.5px] md:hidden ${active === "asistente" ? "font-semibold text-ink" : "text-ink-secondary"} hover:bg-sunken`}
              >
                Mensajes del asistente
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
