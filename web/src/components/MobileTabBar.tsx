"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";

// "plan" y "cuenta" no tienen ítem propio: se incluyen para que esas pantallas
// puedan montar la barra sin marcar ninguna pestaña como activa.
type Tab = "inicio" | "calendario" | "reuniones" | "productos" | "ventas" | "chat" | "plan" | "cuenta";

type Item = { tab: Tab; href: string; label: string; icon: React.ReactNode };

/** Inicio y Chat: los tiene cualquier cuenta. */
const ITEMS_COMUNES: Item[] = [
  {
    tab: "inicio",
    href: "/inicio",
    label: "Inicio",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M9 22V12h6v10" />
      </svg>
    ),
  },
  {
    tab: "chat",
    href: "/chat",
    label: "Chat",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

/** Lo propio de una cuenta de agenda. */
const ITEMS_AGENDA: Item[] = [
  {
    tab: "calendario",
    href: "/calendario",
    label: "Calendario",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M3 10h18" />
        <path d="M8 2v4" />
        <path d="M16 2v4" />
      </svg>
    ),
  },
  {
    tab: "reuniones",
    href: "/reuniones",
    label: "Reuniones",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
];

/** Lo propio de una cuenta de ventas. */
const ITEMS_VENTAS: Item[] = [
  {
    tab: "productos",
    href: "/productos",
    label: "Productos",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V4a1 1 0 0 1 1-1h8a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8z" />
        <circle cx="7.5" cy="7.5" r="1.5" />
      </svg>
    ),
  },
];

/** Barra inferior de navegación móvil (variante 5a-5c del canvas): reemplaza al <nav> de AppHeader debajo de md. */
export function MobileTabBar({ active }: { active: Tab }) {
  const { user } = useSession();
  const [inicio, chat] = ITEMS_COMUNES;
  const items = [inicio, ...(user?.tipoAsistente === "ventas" ? ITEMS_VENTAS : ITEMS_AGENDA), chat];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 grid border-t border-line bg-card md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)", gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const isActive = item.tab === active;
        return (
          <Link
            key={item.tab}
            href={item.href}
            className={`flex min-h-12 flex-col items-center justify-center gap-1 py-1.5 ${
              isActive ? "text-primary" : "text-muted"
            }`}
          >
            {item.icon}
            <span className={`text-[11px] ${isActive ? "font-semibold" : ""}`}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
