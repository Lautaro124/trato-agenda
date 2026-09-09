"use client";

import Link from "next/link";

// "plan" no tiene ítem propio: se incluye para que esa pantalla pueda montar
// la barra sin marcar ninguna pestaña como activa.
type Tab = "inicio" | "calendario" | "chat" | "plan";

const ITEMS: Array<{ tab: Tab; href: string; label: string; icon: React.ReactNode }> = [
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

/** Barra inferior de navegación móvil (variante 5a-5c del canvas): reemplaza al <nav> de AppHeader debajo de md. */
export function MobileTabBar({ active }: { active: Tab }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-line bg-card md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {ITEMS.map((item) => {
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
