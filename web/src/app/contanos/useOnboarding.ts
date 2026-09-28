"use client";

import { useCallback, useMemo, useState } from "react";
import { formatearPrecio } from "@/lib/precio";

export type TipoUsoId = "consultorio" | "otro";

export type TipoTitular = "persona" | "negocio";

export type TipoEvento = { nombre: string; duracionMin: number; precio?: number };

/**
 * Lo que el usuario fue cargando de un tipo de evento activado. `sinPrecio` es
 * sólo de pantalla (el botón "Sin precio" traba el campo): nunca viaja a la API.
 */
export type DatosEvento = { duracionMin: number; precio?: number; sinPrecio?: boolean };

/**
 * El "Empezar con" del paso de turnos: con qué lista arranca. Es lo que viaja
 * como `tipoUso`; ya no es un paso propio del wizard.
 */
export const TIPOS_USO: Array<{ id: TipoUsoId; label: string }> = [
  { id: "consultorio", label: "Ideas para consultorio" },
  { id: "otro", label: "Mi propia lista" },
];

/** Tipos de turno sugeridos por tipo de uso, con su duración por defecto. */
export const CATALOGO_EVENTOS: Record<TipoUsoId, TipoEvento[]> = {
  consultorio: [
    { nombre: "Primera consulta", duracionMin: 45 },
    { nombre: "Consulta de control", duracionMin: 30 },
    { nombre: "Visita común", duracionMin: 20 },
    { nombre: "Estudio", duracionMin: 60 },
    { nombre: "Urgencia", duracionMin: 15 },
  ],
  otro: [],
};

/** Duraciones que recorre el selector − / + de cada tipo de evento activado. */
export const DURACIONES = [15, 20, 30, 45, 60, 90];

/**
 * La duración de `DURACIONES` que sigue (`1`) o precede (`-1`) a `actual`;
 * `undefined` en los extremos. Una duración fuera de la lista (un agente viejo
 * con 50 min) salta al vecino más cercano en ese sentido.
 */
export function duracionVecina(actual: number, sentido: 1 | -1): number | undefined {
  return sentido === 1
    ? DURACIONES.find((min) => min > actual)
    : DURACIONES.findLast((min) => min < actual);
}

/** Límites de GenerateAgentDto (api/src/agents/agents.types.ts): superarlos es un 400. */
export const MAX_TIPOS_EVENTO = 20;
export const LARGO_MIN_NOMBRE_EVENTO = 2;
export const LARGO_MAX_NOMBRE_EVENTO = 60;
export const LARGO_MAX_TITULAR = 80;
export const LARGO_MAX_BOT = 40;

export const PRESETS_FRANJA = [
  { label: "Mañana", desde: "09:00", hasta: "13:00" },
  { label: "Tarde", desde: "14:00", hasta: "19:00" },
  { label: "Jornada completa", desde: "09:00", hasta: "18:00" },
  { label: "Extendida", desde: "08:00", hasta: "21:00" },
];

export const SUGERENCIAS_BOT = ["Tati", "Nina", "Beto", "Sofi"];

export const HORAS = Array.from({ length: 18 }, (_, i) =>
  `${String(i + 6).padStart(2, "0")}:00`,
);

/** Mínimo de GenerateAgentDto y GenerarAgenteVentasDto para el titular y el asistente. */
export const LARGO_MIN_NOMBRE = 2;

/**
 * Qué asistente se arma. Es el primer paso del wizard y decide los que siguen;
 * una cuenta no cambia de tipo después (la API responde 409).
 */
export type TipoAsistente = "agenda" | "ventas";

export type PasoId = "tipo" | "negocio" | "turnos" | "horarios" | "asistente";

/**
 * Los pasos de cada asistente, en orden. Ventas no pide turnos ni franja: vende
 * las 24 horas y lo que ofrece sale del catálogo, que se carga en /productos.
 */
export const PASOS: Record<TipoAsistente, Array<{ id: PasoId; label: string }>> = {
  agenda: [
    { id: "tipo", label: "Qué va a hacer" },
    { id: "negocio", label: "Tu negocio" },
    { id: "turnos", label: "Qué turnos das" },
    { id: "horarios", label: "Horarios" },
    { id: "asistente", label: "Tu asistente" },
  ],
  ventas: [
    { id: "tipo", label: "Qué va a hacer" },
    { id: "negocio", label: "Tu negocio" },
    { id: "asistente", label: "Tu asistente" },
  ],
};

export const AYUDA_POR_PASO: Record<PasoId, string> = {
  tipo: "Los pasos se acomodan a lo que elijas. Todo se puede cambiar después, menos el tipo de asistente.",
  negocio: "Con este nombre se presenta el asistente y firma los avisos.",
  turnos: "Sin precio, el asistente le dice al cliente que lo consulte con vos.",
  horarios: "Fuera de esta franja el asistente no ofrece horarios.",
  asistente: "Así arranca cada conversación en WhatsApp.",
};

/** Body de POST /agents/generate-ventas. */
export type DatosVentas = { nombreTitular: string; nombreBot: string };

export type Onboarding = ReturnType<typeof useOnboarding>;

/**
 * Tipos de evento con su duración y precio. Lo usan el wizard de /contanos y
 * la pantalla /reuniones, que muestran los mismos controles sobre el mismo estado.
 */
export function useTiposEvento(tipoUso: TipoUsoId, inicial: TipoEvento[] = []) {
  /** nombre del tipo de evento → duración y precio elegidos. Sólo los seleccionados. */
  const [elegidos, setElegidos] = useState<Record<string, DatosEvento>>(() =>
    Object.fromEntries(
      inicial.map(({ nombre, duracionMin, precio }) => [
        nombre,
        precio === undefined ? { duracionMin } : { duracionMin, precio },
      ]),
    ),
  );
  const [personalizado, setPersonalizado] = useState("");

  const alternarEvento = useCallback((nombre: string, duracionMin: number) => {
    setElegidos((previos) => {
      if (!previos[nombre]) {
        if (Object.keys(previos).length >= MAX_TIPOS_EVENTO) return previos;
        return { ...previos, [nombre]: { duracionMin } };
      }
      const resto = { ...previos };
      delete resto[nombre];
      return resto;
    });
  }, []);

  const fijarDuracion = useCallback((nombre: string, duracionMin: number) => {
    setElegidos((previos) =>
      previos[nombre] ? { ...previos, [nombre]: { ...previos[nombre], duracionMin } } : previos,
    );
  }, []);

  /** `undefined` borra el precio: el tipo de evento queda "a consultar". */
  const fijarPrecio = useCallback((nombre: string, precio: number | undefined) => {
    setElegidos((previos) =>
      previos[nombre] ? { ...previos, [nombre]: { ...previos[nombre], precio } } : previos,
    );
  }, []);

  /** El botón "Sin precio": lo borra y traba el campo; apagarlo lo deja editable y vacío. */
  const fijarSinPrecio = useCallback((nombre: string, sinPrecio: boolean) => {
    setElegidos((previos) =>
      previos[nombre]
        ? { ...previos, [nombre]: { ...previos[nombre], precio: undefined, sinPrecio } }
        : previos,
    );
  }, []);

  /** `undefined` es "Sin precio" para todos. */
  const fijarPrecioATodos = useCallback((precio: number | undefined) => {
    setElegidos((previos) =>
      Object.fromEntries(
        Object.entries(previos).map(([nombre, datos]) => [
          nombre,
          { ...datos, precio, sinPrecio: precio === undefined },
        ]),
      ),
    );
  }, []);

  const agregarPersonalizado = useCallback(() => {
    const nombre = personalizado.trim().slice(0, LARGO_MAX_NOMBRE_EVENTO);
    if (nombre.length < LARGO_MIN_NOMBRE_EVENTO) return;
    setElegidos((previos) => {
      // Mismos límites que GenerateAgentDto: mejor frenarlo acá que recibir un 400.
      if (previos[nombre] || Object.keys(previos).length >= MAX_TIPOS_EVENTO) return previos;
      return { ...previos, [nombre]: { duracionMin: 30 } };
    });
    setPersonalizado("");
  }, [personalizado]);

  /** Sugerencias del tipo de uso más los tipos propios que agregó el usuario. */
  const eventos = useMemo(() => {
    const sugeridos = CATALOGO_EVENTOS[tipoUso];
    const propios = Object.keys(elegidos)
      .filter((nombre) => !sugeridos.some((evento) => evento.nombre === nombre))
      .map((nombre) => ({ nombre, duracionMin: elegidos[nombre].duracionMin }));
    return [...sugeridos, ...propios];
  }, [tipoUso, elegidos]);

  const seleccionados: TipoEvento[] = useMemo(
    () =>
      Object.entries(elegidos).map(([nombre, { duracionMin, precio }]) =>
        // Sin precio la clave no viaja: el DTO lo trata como ausente.
        precio === undefined ? { nombre, duracionMin } : { nombre, duracionMin, precio },
      ),
    [elegidos],
  );

  return {
    elegidos,
    setElegidos,
    eventos,
    seleccionados,
    alternarEvento,
    fijarDuracion,
    fijarPrecio,
    fijarSinPrecio,
    fijarPrecioATodos,
    personalizado,
    setPersonalizado,
    agregarPersonalizado,
    tiposLlenos: seleccionados.length >= MAX_TIPOS_EVENTO,
  };
}

/** Lo que consumen los controles de tipos de evento, sea del wizard o de /reuniones. */
export type TiposEventoState = ReturnType<typeof useTiposEvento>;

/**
 * Estado del wizard de /contanos, para los dos asistentes. El nombre del
 * titular y el del asistente son compartidos: volver al primer paso y cambiar
 * de tipo no los pierde.
 */
export function useOnboarding() {
  const [tipoAsistente, setTipoAsistente] = useState<TipoAsistente>("agenda");
  const [paso, setPaso] = useState(0);
  const [tipoTitular, setTipoTitular] = useState<TipoTitular>("negocio");
  const [nombreTitular, setNombreTitular] = useState("");
  const [tipoUso, setTipoUso] = useState<TipoUsoId>("consultorio");
  const [horaDesde, setHoraDesde] = useState("09:00");
  const [horaHasta, setHoraHasta] = useState("18:00");
  const [nombreBot, setNombreBot] = useState("");
  const tipos = useTiposEvento(tipoUso);
  const { seleccionados, setElegidos } = tipos;

  const elegirTipoUso = useCallback(
    (id: TipoUsoId) => {
      setTipoUso(id);
      // Los tipos de evento son sugerencias del tipo de uso: cambiarlo los reinicia.
      setElegidos({});
    },
    [setElegidos],
  );

  const elegirPreset = useCallback((desde: string, hasta: string) => {
    setHoraDesde(desde);
    setHoraHasta(hasta);
  }, []);

  const esVentas = tipoAsistente === "ventas";
  const pasos = PASOS[tipoAsistente];
  const ultimoPaso = pasos.length - 1;
  const pasoId = pasos[paso]?.id ?? "tipo";
  // Un comercio no elige "persona": el que vende es el negocio.
  const tipoTitularEfectivo: TipoTitular = esVentas ? "negocio" : tipoTitular;

  const rangoValido = horaDesde < horaHasta;

  const puedeAvanzar: Record<PasoId, boolean> = {
    tipo: true,
    negocio: nombreTitular.trim().length >= LARGO_MIN_NOMBRE,
    turnos: seleccionados.length > 0,
    horarios: rangoValido,
    asistente: nombreBot.trim().length >= LARGO_MIN_NOMBRE,
  };

  /** Lo que ya se respondió en cada paso, para el riel. */
  const resumenes: Record<PasoId, string> = {
    tipo: esVentas ? "Vender productos" : "Agendar turnos",
    negocio: nombreTitular.trim(),
    turnos: `${seleccionados.length} ${seleccionados.length === 1 ? "tipo" : "tipos"}`,
    horarios: `${horaDesde}–${horaHasta}`,
    asistente: nombreBot.trim(),
  };

  const elegirTipoAsistente = useCallback((tipo: TipoAsistente) => {
    setTipoAsistente(tipo);
    // Sólo se elige en el primer paso, que existe en los dos: no hay índice que corregir.
    setPaso(0);
  }, []);

  const titular = nombreTitular.trim() || (tipoTitularEfectivo === "persona" ? "tu nombre" : "tu negocio");
  // Sin nombre todavía, "soy tu asistente, el asistente de…" suena repetido.
  const presentacion = nombreBot.trim()
    ? `Hola, soy ${nombreBot.trim()}, el asistente de ${titular}.`
    : `Hola, soy el asistente de ${titular}.`;
  const saludo = `${presentacion} ¿En qué te ayudo?`;
  const saludoHorarios = `Atiendo de ${horaDesde} a ${horaHasta}. Decime qué día te queda cómodo.`;
  const saludoEventos =
    seleccionados.length > 0
      ? `Puedo agendarte ${seleccionados
          .slice(0, 3)
          .map((evento) => {
            const precio = evento.precio === undefined ? "" : `, ${formatearPrecio(evento.precio)}`;
            return `${evento.nombre.toLowerCase()} (${evento.duracionMin} min${precio})`;
          })
          .join(", ")}${seleccionados.length > 3 ? " y más." : "."}`
      : "Todavía no cargaste tipos de evento: elegí al menos uno.";

  return {
    tipoAsistente,
    elegirTipoAsistente,
    esVentas,
    pasos,
    paso,
    pasoId,
    esUltimo: paso === ultimoPaso,
    setPaso,
    irAtras: () => setPaso((p) => Math.max(0, p - 1)),
    irAdelante: () => setPaso((p) => Math.min(ultimoPaso, p + 1)),
    resumenes,
    tipoTitular: tipoTitularEfectivo,
    setTipoTitular,
    nombreTitular,
    setNombreTitular,
    tipoUso,
    elegirTipoUso,
    ...tipos,
    horaDesde,
    setHoraDesde,
    horaHasta,
    setHoraHasta,
    elegirPreset,
    rangoValido,
    nombreBot,
    setNombreBot,
    puedeAvanzar,
    presentacion,
    saludo,
    saludoEventos,
    saludoHorarios,
    /** Body de POST /agents/generate-ventas. */
    payloadVentas: (): DatosVentas => ({
      nombreTitular: nombreTitular.trim(),
      nombreBot: nombreBot.trim(),
    }),
    /** Body de POST /agents/generate. */
    payload: () => ({
      tipoTitular,
      nombreTitular: nombreTitular.trim(),
      tipoUso,
      tiposEvento: seleccionados,
      horaDesde,
      horaHasta,
      nombreBot: nombreBot.trim(),
    }),
  };
}
