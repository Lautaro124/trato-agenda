"use client";

import { useCallback, useMemo, useState } from "react";

export type TipoUsoId =
  | "comercio"
  | "consultorio"
  | "reuniones"
  | "visitas"
  | "personal"
  | "otro";

export type TipoTitular = "persona" | "negocio";

export type TipoEvento = { nombre: string; duracionMin: number };

export const TIPOS_USO: Array<{ id: TipoUsoId; label: string; hint: string }> = [
  { id: "comercio", label: "Comercio", hint: "Retiros, entregas, atención" },
  { id: "consultorio", label: "Consultorio", hint: "Consultas, controles, estudios" },
  { id: "reuniones", label: "Reuniones", hint: "Demos, 1 a 1, entrevistas" },
  { id: "visitas", label: "Visitas", hint: "Visitas técnicas y relevamientos" },
  { id: "personal", label: "Agenda personal", hint: "Clases, trámites, entrenos" },
  { id: "otro", label: "Otro", hint: "Lo definís vos" },
];

/** Tipos de turno sugeridos por tipo de uso, con su duración por defecto. */
export const CATALOGO_EVENTOS: Record<TipoUsoId, TipoEvento[]> = {
  comercio: [
    { nombre: "Retiro de pedido", duracionMin: 15 },
    { nombre: "Entrega a domicilio", duracionMin: 30 },
    { nombre: "Atención en el local", duracionMin: 30 },
    { nombre: "Presupuesto", duracionMin: 20 },
  ],
  consultorio: [
    { nombre: "Primera consulta", duracionMin: 45 },
    { nombre: "Consulta de control", duracionMin: 30 },
    { nombre: "Visita común", duracionMin: 20 },
    { nombre: "Estudio", duracionMin: 60 },
    { nombre: "Urgencia", duracionMin: 15 },
  ],
  reuniones: [
    { nombre: "Demo de producto", duracionMin: 30 },
    { nombre: "1 a 1 con el equipo", duracionMin: 30 },
    { nombre: "Entrevista", duracionMin: 45 },
    { nombre: "Seguimiento", duracionMin: 15 },
  ],
  visitas: [
    { nombre: "Visita técnica", duracionMin: 60 },
    { nombre: "Relevamiento", duracionMin: 45 },
    { nombre: "Instalación", duracionMin: 90 },
    { nombre: "Mantenimiento", duracionMin: 30 },
  ],
  personal: [
    { nombre: "Clase", duracionMin: 60 },
    { nombre: "Entrenamiento", duracionMin: 45 },
    { nombre: "Trámite", duracionMin: 30 },
  ],
  otro: [],
};

/** Duraciones por las que cicla el pill de cada tipo de evento. */
export const DURACIONES = [15, 20, 30, 45, 60, 90];

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

export const PASOS = [
  "Nombre",
  "Tipo de uso",
  "Tipos de evento",
  "Franja horaria",
  "Tu asistente",
];

export const AYUDA_POR_PASO = [
  "Con este nombre se presenta el asistente y firma los avisos.",
  "Define los tipos de evento que te sugerimos después.",
  "Tocá la duración para cambiarla.",
  "Fuera de esta franja el asistente no ofrece horarios.",
  "Así arranca cada conversación en WhatsApp.",
];

export const ULTIMO_PASO = PASOS.length - 1;

export type Onboarding = ReturnType<typeof useOnboarding>;

/**
 * Estado del wizard de /contanos. Lo comparten el layout de escritorio y el
 * de móvil, que muestran los mismos cinco datos con distinto envoltorio.
 */
export function useOnboarding() {
  const [paso, setPaso] = useState(0);
  const [tipoTitular, setTipoTitular] = useState<TipoTitular>("negocio");
  const [nombreTitular, setNombreTitular] = useState("");
  const [tipoUso, setTipoUso] = useState<TipoUsoId>("consultorio");
  /** nombre del tipo de evento → duración elegida. Sólo los seleccionados. */
  const [elegidos, setElegidos] = useState<Record<string, number>>({});
  const [personalizado, setPersonalizado] = useState("");
  const [horaDesde, setHoraDesde] = useState("09:00");
  const [horaHasta, setHoraHasta] = useState("18:00");
  const [nombreBot, setNombreBot] = useState("");

  const elegirTipoUso = useCallback((id: TipoUsoId) => {
    setTipoUso(id);
    // Los tipos de evento son sugerencias del tipo de uso: cambiarlo los reinicia.
    setElegidos({});
  }, []);

  const alternarEvento = useCallback((nombre: string, duracionMin: number) => {
    setElegidos((previos) => {
      if (!previos[nombre]) return { ...previos, [nombre]: duracionMin };
      const resto = { ...previos };
      delete resto[nombre];
      return resto;
    });
  }, []);

  const ciclarDuracion = useCallback((nombre: string) => {
    setElegidos((previos) => {
      const actual = previos[nombre];
      if (!actual) return previos;
      const siguiente = DURACIONES[(DURACIONES.indexOf(actual) + 1) % DURACIONES.length];
      return { ...previos, [nombre]: siguiente };
    });
  }, []);

  const agregarPersonalizado = useCallback(() => {
    const nombre = personalizado.trim();
    if (!nombre) return;
    setElegidos((previos) => ({ ...previos, [nombre]: 30 }));
    setPersonalizado("");
  }, [personalizado]);

  const elegirPreset = useCallback((desde: string, hasta: string) => {
    setHoraDesde(desde);
    setHoraHasta(hasta);
  }, []);

  /** Sugerencias del tipo de uso más los tipos propios que agregó el usuario. */
  const eventos = useMemo(() => {
    const sugeridos = CATALOGO_EVENTOS[tipoUso];
    const propios = Object.keys(elegidos)
      .filter((nombre) => !sugeridos.some((evento) => evento.nombre === nombre))
      .map((nombre) => ({ nombre, duracionMin: elegidos[nombre] }));
    return [...sugeridos, ...propios];
  }, [tipoUso, elegidos]);

  const seleccionados: TipoEvento[] = useMemo(
    () => Object.entries(elegidos).map(([nombre, duracionMin]) => ({ nombre, duracionMin })),
    [elegidos],
  );

  const rangoValido = horaDesde < horaHasta;

  const puedeAvanzar = [
    nombreTitular.trim().length > 0,
    true,
    seleccionados.length > 0,
    rangoValido,
    nombreBot.trim().length > 0,
  ];

  const completo = puedeAvanzar.every(Boolean);

  const titular = nombreTitular.trim() || (tipoTitular === "persona" ? "tu nombre" : "tu negocio");
  const bot = nombreBot.trim() || "tu asistente";
  const saludo = `Hola, soy ${bot}, el asistente de ${titular}. ¿En qué te ayudo?`;
  const saludoHorarios = `Atiendo de ${horaDesde} a ${horaHasta}. Decime qué día te queda cómodo.`;
  const saludoEventos =
    seleccionados.length > 0
      ? `Puedo agendarte ${seleccionados
          .slice(0, 3)
          .map((evento) => `${evento.nombre.toLowerCase()} (${evento.duracionMin} min)`)
          .join(", ")}${seleccionados.length > 3 ? " y más." : "."}`
      : "Todavía no cargaste tipos de evento: elegí al menos uno.";

  return {
    paso,
    setPaso,
    irAtras: () => setPaso((p) => Math.max(0, p - 1)),
    irAdelante: () => setPaso((p) => Math.min(ULTIMO_PASO, p + 1)),
    tipoTitular,
    setTipoTitular,
    nombreTitular,
    setNombreTitular,
    tipoUso,
    elegirTipoUso,
    eventos,
    elegidos,
    seleccionados,
    alternarEvento,
    ciclarDuracion,
    personalizado,
    setPersonalizado,
    agregarPersonalizado,
    horaDesde,
    setHoraDesde,
    horaHasta,
    setHoraHasta,
    elegirPreset,
    rangoValido,
    nombreBot,
    setNombreBot,
    puedeAvanzar,
    completo,
    saludo,
    saludoEventos,
    saludoHorarios,
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
