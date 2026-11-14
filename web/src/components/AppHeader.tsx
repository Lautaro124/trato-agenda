"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { CampanaNotificaciones } from "@/components/CampanaNotificaciones";
import { BadgeEstadoAsistente, useEstadoAsistente } from "@/components/EstadoAsistente";
import { Navegacion, seccionesDe, ubicacionDe, type Pantalla } from "@/components/Navegacion";
import { BotonSugerirMejora, Lamparita, PanelSugerencia } from "@/components/SugerirMejora";
import { Badge } from "@/components/ui/Badge";
import { Wordmark } from "@/components/Wordmark";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePreferenciasNavegacion } from "@/lib/navegacion";
import { identificador, iniciales, useSession, type Usuario } from "@/lib/session";
import { useAbrirTutorial } from "@/lib/tutorial";

type WhatsappStatus = { linked: boolean; phoneNumber: string | null };

const FOCUSABLES = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** La flecha avisa que el bloque del usuario abre un menú; gira mientras está abierto. */
function FlechaMenu({ abierto }: Readonly<{ abierto: boolean }>) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("flex-none text-muted transition-transform", abierto && "rotate-180")}
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

type PropsMenuCuenta = Readonly<{
  user: Usuario;
  active: Pantalla;
  contraida: boolean;
  onSugerir: () => void;
  abrirTutorial: (() => void) | null;
  onNavegar?: () => void;
}>;

/** El pie de la barra: la cuenta y lo que cuelga de ella, en un menú que abre hacia arriba. */
function MenuCuenta({ user, active, contraida, onSugerir, abrirTutorial, onNavegar }: PropsMenuCuenta) {
  const { signOut } = useSession();
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const onPointerDown = (e: PointerEvent) => {
      if (contenedor.current && !contenedor.current.contains(e.target as Node)) setAbierto(false);
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [abierto]);

  const enlace = (href: string, pantalla: Pantalla, label: string) => (
    <Link
      href={href}
      role="menuitem"
      onClick={() => {
        setAbierto(false);
        onNavegar?.();
      }}
      className={cn(
        "block px-4 py-2.5 text-[13.5px] hover:bg-sunken",
        active === pantalla ? "font-semibold text-ink" : "text-ink-secondary",
      )}
    >
      {label}
    </Link>
  );

  return (
    <div ref={contenedor} data-tutorial="menu-usuario" className="relative border-t border-line pt-2">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        title={contraida ? identificador(user) : undefined}
        className={cn(
          "flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-sm px-2 text-left hover:bg-sunken",
          contraida && "justify-center px-0",
        )}
      >
        {user.avatarUrl ? (
          <Image src={user.avatarUrl} alt="" width={32} height={32} className="size-8 flex-none rounded-full object-cover" />
        ) : (
          <span className="grid size-8 flex-none place-items-center rounded-full bg-primary-subtle text-[13px] font-bold text-primary-hover">
            {iniciales(user)}
          </span>
        )}
        <span className={cn("flex min-w-0 flex-1 flex-col leading-tight", contraida && "sr-only")}>
          <span className="truncate text-[13.5px] font-semibold text-ink">{identificador(user)}</span>
          <span className="text-xs text-ink-secondary">Cuenta y vinculación</span>
        </span>
        {!contraida && <FlechaMenu abierto={abierto} />}
      </button>

      {abierto && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-10 mb-2 w-52 overflow-hidden rounded-md border border-line bg-card shadow-md"
        >
          {enlace("/vincular", "vinculacion", "Vinculación")}
          {enlace("/cuenta", "cuenta", "Cuenta")}
          {/* En el celular el botón del encabezado no entra: se llega desde acá. */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAbierto(false);
              onSugerir();
            }}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13.5px] font-semibold text-primary-active hover:bg-sunken md:hidden"
          >
            <Lamparita size={15} />
            Sugerir mejora
          </button>
          {/* Sólo en las pantallas que tienen recorrido guiado. */}
          {abrirTutorial && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAbierto(false);
                abrirTutorial();
              }}
              className="block w-full px-4 py-2.5 text-left text-[13.5px] text-ink-secondary hover:bg-sunken"
            >
              Ver tutorial
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAbierto(false);
              void signOut();
            }}
            className="block w-full border-t border-line px-4 py-2.5 text-left text-[13.5px] text-danger hover:bg-sunken"
          >
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Barra lateral (desplegable en escritorio, cajón en el celular) y encabezado
 * con el estado del asistente. Lo montan todas las pantallas de la cuenta.
 */
export function AppHeader({ active, user }: Readonly<{ active: Pantalla; user: Usuario }>) {
  const abrirTutorial = useAbrirTutorial(active);
  const [whatsapp, setWhatsapp] = useState<WhatsappStatus | null>(null);
  const estadoAsistente = useEstadoAsistente();
  // Con el estado del asistente a la vista, "WhatsApp conectado" sobra en el celular, donde no entran los dos.
  const conEstado = estadoAsistente !== null && estadoAsistente.motivo !== "sin_whatsapp";
  const [prefs, guardarPrefs] = usePreferenciasNavegacion();
  const [cajonAbierto, setCajonAbierto] = useState(false);
  const botonCajon = useRef<HTMLButtonElement>(null);
  const cajon = useRef<HTMLDivElement>(null);
  const [sugerenciaAbierta, setSugerenciaAbierta] = useState(false);
  const focoPrevio = useRef<HTMLElement | null>(null);
  const idNav = useId();
  const idCajon = useId();

  const secciones = seccionesDe(user);
  const ubicacion = ubicacionDe(secciones, active);
  const { contraida, gruposCerrados } = prefs;

  // El contenido de cada pantalla se corre a la derecha de la barra fija (globals.css).
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.dataset.navegacion = contraida ? "contraida" : "desplegada";
    return () => {
      delete html.dataset.navegacion;
    };
  }, [contraida]);

  const alternarGrupo = (id: string) =>
    guardarPrefs({
      gruposCerrados: gruposCerrados.includes(id) ? gruposCerrados.filter((g) => g !== id) : [...gruposCerrados, id],
    });
  const desplegarEn = (id: string) => guardarPrefs({ contraida: false, gruposCerrados: gruposCerrados.filter((g) => g !== id) });

  const cerrarCajon = () => {
    setCajonAbierto(false);
    botonCajon.current?.focus();
  };

  const abrirSugerencia = () => {
    focoPrevio.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCajonAbierto(false);
    setSugerenciaAbierta(true);
  };
  const cerrarSugerencia = () => {
    setSugerenciaAbierta(false);
    // Desde el cajón del celular el ítem ya no existe: el foco vuelve al botón del menú.
    (focoPrevio.current?.isConnected ? focoPrevio.current : botonCajon.current)?.focus();
  };

  // Abierto el cajón: el foco entra, la página de atrás no se desplaza.
  useEffect(() => {
    if (!cajonAbierto) return;
    cajon.current?.querySelector<HTMLElement>(FOCUSABLES)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [cajonAbierto]);

  const tecladoCajon = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cerrarCajon();
      return;
    }
    if (e.key !== "Tab" || !cajon.current) return;
    const focos = [...cajon.current.querySelectorAll<HTMLElement>(FOCUSABLES)];
    const primero = focos[0];
    const ultimo = focos.at(-1);
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo?.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero?.focus();
    }
  };

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

  const propsNavegacion = { secciones, active, gruposCerrados, onAlternarGrupo: alternarGrupo, onDesplegarEn: desplegarEn };

  return (
    <>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-20 hidden flex-col gap-4 border-r border-line bg-card px-3 py-3.5 md:flex",
          contraida ? "w-18" : "w-62",
        )}
      >
        <div className={cn("flex min-h-10 items-center gap-2", contraida ? "justify-center" : "justify-between pl-2")}>
          {!contraida && (
            <Link href="/inicio">
              <Wordmark size={23} />
            </Link>
          )}
          <button
            type="button"
            onClick={() => guardarPrefs({ contraida: !contraida })}
            aria-label={contraida ? "Desplegar menú" : "Contraer menú"}
            aria-expanded={!contraida}
            aria-controls={idNav}
            title={contraida ? "Desplegar menú" : "Contraer menú"}
            className="grid size-10 cursor-pointer place-items-center rounded-sm text-ink-secondary hover:bg-sunken"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
        </div>
        <Navegacion id={idNav} contraida={contraida} tutorial="navegacion" {...propsNavegacion} />
        <MenuCuenta user={user} active={active} contraida={contraida} onSugerir={abrirSugerencia} abrirTutorial={abrirTutorial} />
      </aside>

      <header className="flex h-[60px] flex-none items-center gap-3 border-b border-line bg-card px-2 sm:gap-4 md:px-6">
        <button
          ref={botonCajon}
          type="button"
          data-tutorial="navegacion"
          onClick={() => setCajonAbierto(true)}
          aria-label="Abrir menú"
          aria-haspopup="dialog"
          aria-expanded={cajonAbierto}
          className="grid size-11 flex-none cursor-pointer place-items-center rounded-sm text-ink-secondary hover:bg-sunken md:hidden"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16" />
            <path d="M4 12h16" />
            <path d="M4 18h16" />
          </svg>
        </button>
        <Link href="/inicio" className="md:hidden">
          <Wordmark size={21} />
        </Link>

        {ubicacion && (
          <p className="hidden min-w-0 items-center gap-2 text-[13.5px] md:flex">
            {ubicacion.grupo && (
              <>
                <span className="text-ink-secondary">{ubicacion.grupo}</span>
                <span className="text-muted" aria-hidden>
                  /
                </span>
              </>
            )}
            <span className="truncate font-semibold text-ink">{ubicacion.label}</span>
          </p>
        )}

        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          <BotonSugerirMejora abierto={sugerenciaAbierta} onAbrir={abrirSugerencia} />
          <span data-tutorial="notificaciones" className="inline-flex">
            <CampanaNotificaciones />
          </span>
          {estadoAsistente && (
            <span data-tutorial="estado-asistente" className="inline-flex">
              <BadgeEstadoAsistente estado={estadoAsistente} />
            </span>
          )}
          {whatsapp && (
            <span className={cn("whitespace-nowrap", conEstado && whatsapp.linked && "hidden md:inline")}>
              <Badge tone={whatsapp.linked ? "success" : "warning"}>
                {whatsapp.linked ? "WhatsApp conectado" : "WhatsApp sin vincular"}
              </Badge>
            </span>
          )}
        </div>
      </header>

      {cajonAbierto && (
        <div className="fixed inset-0 z-30 md:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Cerrar menú"
            onClick={cerrarCajon}
            className="absolute inset-0 cursor-default bg-[rgba(26,25,23,0.38)]"
          />
          <div
            ref={cajon}
            id={idCajon}
            role="dialog"
            aria-modal="true"
            aria-label="Menú"
            onKeyDown={tecladoCajon}
            className="absolute inset-y-0 left-0 flex w-[min(300px,85vw)] flex-col gap-3 bg-card px-3 pt-2.5 pb-[max(16px,env(safe-area-inset-bottom))] shadow-lg"
          >
            <div className="flex min-h-11 items-center justify-between pl-2">
              <Wordmark size={22} />
              <button
                type="button"
                onClick={cerrarCajon}
                aria-label="Cerrar menú"
                className="grid size-11 cursor-pointer place-items-center rounded-sm text-ink-secondary hover:bg-sunken"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <Navegacion id={`${idNav}-cajon`} contraida={false} onNavegar={() => setCajonAbierto(false)} {...propsNavegacion} />
            <MenuCuenta
              user={user}
              active={active}
              contraida={false}
              onSugerir={abrirSugerencia}
              abrirTutorial={
                abrirTutorial &&
                (() => {
                  // El recorrido busca lo que está a la vista: primero se cierra el cajón.
                  setCajonAbierto(false);
                  requestAnimationFrame(abrirTutorial);
                })
              }
              onNavegar={() => setCajonAbierto(false)}
            />
          </div>
        </div>
      )}
      {sugerenciaAbierta && <PanelSugerencia onCerrar={cerrarSugerencia} />}
    </>
  );
}
