"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Recorrido } from "@/components/Recorrido";
import { apiFetch } from "./api";
import { useSession } from "./session";
import { CLAVES_TUTORIAL, pasosDe, type ClaveTutorial } from "./tutoriales";

type TutorialValue = {
  /** Abre el recorrido de una pantalla, lo haya visto o no (desde el menú). */
  abrir: (clave: ClaveTutorial) => void;
  /** Lo abre sólo si la cuenta todavía no lo vio. */
  abrirSiFalta: (clave: ClaveTutorial) => void;
  /** Lo cierra sin marcarlo, si es el que está abierto (la pantalla se desmontó). */
  soltar: (clave: ClaveTutorial) => void;
};

const TutorialContext = createContext<TutorialValue | null>(null);

/** Tiempo para que la pantalla termine de acomodarse antes de medir qué resaltar. */
const ESPERA_MS = 400;

/**
 * Recorridos guiados: cada pantalla pide el suyo con `useTutorial` y se abre
 * solo si la cuenta todavía no lo vio. Que lo vio (terminó o salteó) se guarda
 * en la API, así no reaparece en otro dispositivo.
 */
export function TutorialProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, refrescar } = useSession();
  const [abierto, setAbierto] = useState<ClaveTutorial | null>(null);
  // Hasta que vuelve /auth/me, `tutorialesVistos` todavía no lo incluye: sin
  // esto, una navegación rápida lo volvería a abrir.
  const cerrados = useRef(new Set<ClaveTutorial>());
  const vistos = useRef<readonly ClaveTutorial[] | null>(null);

  useEffect(() => {
    vistos.current = user?.tutorialesVistos ?? null;
  }, [user]);

  const abrir = useCallback((clave: ClaveTutorial) => setAbierto(clave), []);

  const abrirSiFalta = useCallback((clave: ClaveTutorial) => {
    if (!vistos.current || vistos.current.includes(clave) || cerrados.current.has(clave)) return;
    setAbierto((previo) => previo ?? clave);
  }, []);

  const soltar = useCallback((clave: ClaveTutorial) => {
    setAbierto((previo) => (previo === clave ? null : previo));
  }, []);

  const cerrar = useCallback(() => {
    if (!abierto) return;
    setAbierto(null);
    if (cerrados.current.has(abierto) || vistos.current?.includes(abierto)) return;
    cerrados.current.add(abierto);
    // Si falla, vuelve a aparecer en la próxima carga: no vale un aviso de error.
    apiFetch("/auth/tutoriales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claves: [abierto] }),
    })
      .then((res) => (res.ok ? refrescar() : undefined))
      .catch(() => {});
  }, [abierto, refrescar]);

  const value = useMemo(() => ({ abrir, abrirSiFalta, soltar }), [abrir, abrirSiFalta, soltar]);

  return (
    <TutorialContext.Provider value={value}>
      {children}
      {abierto && user && <Recorrido key={abierto} pasos={pasosDe(abierto, user)} onCerrar={cerrar} />}
    </TutorialContext.Provider>
  );
}

function useTutorialContext(): TutorialValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error("useTutorial necesita estar dentro de <TutorialProvider>");
  return ctx;
}

/**
 * El recorrido de la pantalla, la primera vez que se entra. `listo` en false
 * mientras carga lo que resalta: un paso cuyo elemento no está a la vista se
 * saltea.
 */
export function useTutorial(clave: ClaveTutorial, listo = true): void {
  const { abrirSiFalta, soltar } = useTutorialContext();
  useEffect(() => {
    if (!listo) return;
    const t = window.setTimeout(() => abrirSiFalta(clave), ESPERA_MS);
    return () => {
      window.clearTimeout(t);
      soltar(clave);
    };
  }, [clave, listo, abrirSiFalta, soltar]);
}

/** Para el menú: abre el recorrido de una pantalla, o null si no tiene. */
export function useAbrirTutorial(pantalla: string): (() => void) | null {
  const { abrir } = useTutorialContext();
  const clave = CLAVES_TUTORIAL.find((c) => c === pantalla);
  return clave ? () => abrir(clave) : null;
}
