"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  contarNoLeidas,
  haceCuanto,
  listarNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
  type Notificacion,
} from "@/lib/notificaciones";

/** Cada cuánto se pregunta si hay avisos nuevos, sólo con la pestaña a la vista. */
const CADA_MS = 30_000;

/**
 * La campanita del panel: cuántos avisos sin leer hay y la lista al abrirla.
 * Los mismos avisos le llegan al dueño por su propio chat de WhatsApp; esto
 * es para cuando está en el panel.
 */
export function CampanaNotificaciones() {
  const router = useRouter();
  const [noLeidas, setNoLeidas] = useState(0);
  const [abierta, setAbierta] = useState(false);
  const [lista, setLista] = useState<Notificacion[] | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);

  const actualizarContador = useCallback(() => {
    contarNoLeidas()
      .then(setNoLeidas)
      .catch(() => {});
  }, []);

  useEffect(() => {
    actualizarContador();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") actualizarContador();
    }, CADA_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") actualizarContador();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [actualizarContador]);

  useEffect(() => {
    if (!abierta) return;
    const alTocarAfuera = (e: PointerEvent) => {
      if (contenedor.current && !contenedor.current.contains(e.target as Node)) setAbierta(false);
    };
    const alEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierta(false);
    };
    document.addEventListener("pointerdown", alTocarAfuera);
    document.addEventListener("keydown", alEscape);
    return () => {
      document.removeEventListener("pointerdown", alTocarAfuera);
      document.removeEventListener("keydown", alEscape);
    };
  }, [abierta]);

  const abrir = () => {
    const abriendo = !abierta;
    setAbierta(abriendo);
    if (!abriendo) return;
    listarNotificaciones()
      .then((datos) => {
        setLista(datos?.notificaciones ?? []);
        if (datos) setNoLeidas(datos.noLeidas);
      })
      .catch(() => setLista([]));
  };

  const elegir = (notificacion: Notificacion) => {
    if (!notificacion.leidaAt) {
      setNoLeidas((n) => Math.max(0, n - 1));
      setLista((actual) =>
        actual?.map((n) => (n.id === notificacion.id ? { ...n, leidaAt: new Date().toISOString() } : n)) ?? actual,
      );
      void marcarLeida(notificacion.id).catch(() => {});
    }
    if (notificacion.enlace?.startsWith("/")) {
      setAbierta(false);
      router.push(notificacion.enlace);
    }
  };

  const leerTodas = () => {
    setNoLeidas(0);
    setLista((actual) => actual?.map((n) => ({ ...n, leidaAt: n.leidaAt ?? new Date().toISOString() })) ?? actual);
    void marcarTodasLeidas().catch(() => {});
  };

  return (
    <div ref={contenedor} className="relative">
      <button
        type="button"
        onClick={abrir}
        aria-haspopup="dialog"
        aria-expanded={abierta}
        aria-label={noLeidas > 0 ? `Notificaciones (${noLeidas} sin leer)` : "Notificaciones"}
        className="relative grid size-9 cursor-pointer place-items-center rounded-full text-ink-secondary hover:bg-sunken"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {noLeidas > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10.5px] leading-[18px] font-bold text-primary-on">
            {noLeidas > 99 ? "99+" : noLeidas}
          </span>
        )}
      </button>

      {abierta && (
        <div
          role="dialog"
          aria-label="Notificaciones"
          // En el celular la campanita no está pegada al borde: el panel se fija a la pantalla.
          className="fixed inset-x-3 top-[64px] z-30 overflow-hidden rounded-md border border-line bg-card shadow-md sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[360px]"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-semibold text-ink">Avisos</span>
            {noLeidas > 0 && (
              <button type="button" onClick={leerTodas} className="cursor-pointer text-[12.5px] font-semibold text-link">
                Marcar todas como leídas
              </button>
            )}
          </div>
          <ul className="max-h-[60dvh] overflow-y-auto">
            {lista === null && <li className="px-4 py-6 text-center text-[13px] text-muted">Cargando…</li>}
            {lista?.length === 0 && (
              <li className="px-4 py-6 text-center text-[13px] text-muted">
                Todavía no hay avisos. Acá te contamos las ventas y lo que necesite tu atención.
              </li>
            )}
            {lista?.map((notificacion) => (
              <li key={notificacion.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => elegir(notificacion)}
                  className={cn(
                    "flex w-full cursor-pointer gap-3 px-4 py-3 text-left hover:bg-sunken",
                    !notificacion.leidaAt && "bg-primary-subtle/40",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("mt-1.5 size-2 flex-none rounded-full", notificacion.leidaAt ? "bg-transparent" : "bg-primary")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[13.5px] text-ink", !notificacion.leidaAt && "font-semibold")}>
                      {notificacion.titulo}
                    </span>
                    <span className="mt-0.5 line-clamp-3 block text-[12.5px] leading-[1.45] text-ink-secondary">
                      {notificacion.cuerpo}
                    </span>
                    <span className="mt-1 block text-[11.5px] text-muted">{haceCuanto(notificacion.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
