"use client";

import { useCallback, useMemo, useState } from "react";
import { useDatosCliente, type PayloadDatosCliente } from "@/lib/datos-cliente";
import { DIAS_SEMANA, NOMBRE_DIA, type DiaSemana, type LocalPresencial } from "@/lib/local";
import { formatearPrecio } from "@/lib/precio";
import {
  MAX_HORARIOS_GRUPALES,
  bloquesDeHorarios,
  horariosDeBloques,
  problemaDeBloques,
  textoBloques,
  type BloqueClase,
  type HorarioGrupal,
} from "@/lib/turnos-grupales";
import { useClases } from "./useClases";
import { useLocal, type LocalState } from "./useLocal";

export type TipoUsoId = "consultorio" | "otro";

export type TipoTitular = "persona" | "negocio";

/** Con `capacidad` (y sus `horarios` fijos) es un turno grupal: lib/turnos-grupales.ts. */
export type TipoEvento = {
  nombre: string;
  duracionMin: number;
  precio?: number;
  capacidad?: number;
  horarios?: HorarioGrupal[];
};

/**
 * Lo que el usuario fue cargando de un tipo de evento activado. `sinPrecio` es
 * sólo de pantalla (el botón "Sin precio" traba el campo): nunca viaja a la API.
 * Tampoco `grupal` ni `bloques`: lo que viaja es la capacidad y los horarios
 * (cada día de cada bloque, `horariosDeBloques`), sólo si está prendido.
 */
export type DatosEvento = {
  duracionMin: number;
  precio?: number;
  sinPrecio?: boolean;
  grupal?: boolean;
  capacidad?: number;
  bloques?: BloqueClase[];
};

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

export type PasoId =
  | "tipo"
  | "negocio"
  | "atencion"
  | "lugar"
  | "turnos"
  | "clases"
  | "horarios"
  | "local"
  | "datos"
  | "asistente";

/**
 * Cómo atiende un asistente de turnos: uno a uno (turnos individuales en los
 * huecos libres de la agenda), en grupo (clases con horario fijo y cupo) o
 * las dos cosas. Decide qué pasos siguen; lo que viaja a la API son los tipos
 * de turno de cada uno.
 */
export type Atencion = "individual" | "grupal" | "ambas";

/**
 * Los pasos de cada asistente, en orden. Ventas no pide turnos ni franja: vende
 * las 24 horas y lo que ofrece sale del catálogo, que se carga en /productos.
 * Sí pregunta por el local a la calle, para contestar dónde queda y si se retira.
 * Su paso "datos" (qué le pide al cliente, envíos) es opcional.
 */
export const PASOS: Record<TipoAsistente, Array<{ id: PasoId; label: string }>> = {
  agenda: [
    { id: "tipo", label: "Qué va a hacer" },
    { id: "negocio", label: "Tu negocio" },
    { id: "atencion", label: "Cómo atendés" },
    { id: "lugar", label: "Dónde atendés" },
    { id: "turnos", label: "Qué turnos das" },
    { id: "clases", label: "Tus clases" },
    { id: "horarios", label: "Horarios" },
    { id: "asistente", label: "Tu asistente" },
  ],
  ventas: [
    { id: "tipo", label: "Qué va a hacer" },
    { id: "negocio", label: "Tu negocio" },
    { id: "local", label: "Tu local" },
    { id: "datos", label: "Datos del cliente" },
    { id: "asistente", label: "Tu asistente" },
  ],
};

/**
 * Los pasos de turnos según cómo atiende: las clases no usan la franja
 * horaria (tienen sus propios horarios fijos) y los turnos individuales no
 * tienen clases.
 */
export function pasosDe(tipo: TipoAsistente, atencion: Atencion): Array<{ id: PasoId; label: string }> {
  if (tipo === "ventas") return PASOS.ventas;
  return PASOS.agenda.filter((paso) => {
    if (paso.id === "turnos" || paso.id === "horarios") return atencion !== "grupal";
    if (paso.id === "clases") return atencion !== "individual";
    return true;
  });
}

export const AYUDA_POR_PASO: Record<PasoId, string> = {
  tipo: "Los pasos se acomodan a lo que elijas. Todo se puede cambiar después, menos el tipo de asistente.",
  negocio: "Con este nombre se presenta el asistente y firma los avisos.",
  atencion: "Si das clases, en el paso siguiente cargás los días, la hora y cuántas personas entran.",
  lugar: "El asistente se lo cuenta a tus clientes y lo repite cuando les agenda el turno. Lo cambiás cuando quieras desde Cuenta.",
  clases: "Contanos cuántos entran y cuándo es cada clase. El asistente no anota a nadie cuando se llena el cupo.",
  turnos:
    "Elegí si cada uno es individual o grupal (clases, talleres). Sin precio, el asistente le dice al cliente que lo consulte con vos.",
  horarios: "Fuera de esta franja el asistente no ofrece horarios.",
  local: "Lo que no cargues, el asistente no lo inventa: te pasa la consulta a vos.",
  datos: "Es opcional: lo podés cambiar cuando quieras desde Cuenta.",
  asistente: "Así arranca cada conversación en WhatsApp.",
};

export const ETIQUETA_ATENCION: Record<Atencion, string> = {
  individual: "Uno a uno",
  grupal: "En grupo",
  ambas: "Las dos cosas",
};

/** Body de POST /agents/generate-ventas. */
export type DatosVentas = { nombreTitular: string; nombreBot: string; local: LocalPresencial } & PayloadDatosCliente;

export type Onboarding = ReturnType<typeof useOnboarding>;

/**
 * Tipos de evento con su duración y precio. Lo usan el wizard de /contanos y
 * la pantalla /reuniones, que muestran los mismos controles sobre el mismo estado.
 */
export function useTiposEvento(tipoUso: TipoUsoId, inicial: TipoEvento[] = []) {
  /** nombre del tipo de evento → duración y precio elegidos. Sólo los seleccionados. */
  const [elegidos, setElegidos] = useState<Record<string, DatosEvento>>(() =>
    Object.fromEntries(
      inicial.map(({ nombre, duracionMin, precio, capacidad, horarios }) => [
        nombre,
        {
          duracionMin,
          ...(precio === undefined ? {} : { precio }),
          ...(capacidad === undefined ? {} : { grupal: true, capacidad, bloques: bloquesDeHorarios(horarios ?? []) }),
        },
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

  /** Cambia sólo lo que se pasa de un tipo de evento activado. */
  const actualizar = useCallback((nombre: string, cambio: (datos: DatosEvento) => DatosEvento) => {
    setElegidos((previos) => (previos[nombre] ? { ...previos, [nombre]: cambio(previos[nombre]) } : previos));
  }, []);

  /** Prenderlo arranca sin horarios y con la capacidad vacía; apagarlo borra los dos. */
  const fijarGrupal = useCallback(
    (nombre: string, grupal: boolean) =>
      actualizar(nombre, (datos) =>
        grupal
          ? { ...datos, grupal: true, bloques: datos.bloques ?? [] }
          : { ...datos, grupal: false, capacidad: undefined, bloques: undefined },
      ),
    [actualizar],
  );

  /**
   * El selector "Individual | Grupal" de cada fila. En un tipo que todavía no
   * estaba elegido, elegir una modalidad también lo activa.
   */
  const elegirModalidad = useCallback(
    (nombre: string, duracionMin: number, grupal: boolean) => {
      setElegidos((previos) => {
        if (previos[nombre] || Object.keys(previos).length >= MAX_TIPOS_EVENTO) return previos;
        return { ...previos, [nombre]: { duracionMin } };
      });
      fijarGrupal(nombre, grupal);
    },
    [fijarGrupal],
  );

  const fijarCapacidad = useCallback(
    (nombre: string, capacidad: number | undefined) => actualizar(nombre, (datos) => ({ ...datos, capacidad })),
    [actualizar],
  );

  /** Los horarios de un tipo grupal, como bloques de días con una hora (`HorariosGrupales`). */
  const cambiarBloques = useCallback(
    (nombre: string, cambio: (bloques: BloqueClase[]) => BloqueClase[]) =>
      actualizar(nombre, (datos) => ({ ...datos, bloques: cambio(datos.bloques ?? []) })),
    [actualizar],
  );

  const alternarDiaGrupal = useCallback(
    (nombre: string, indice: number, dia: DiaSemana) =>
      cambiarBloques(nombre, (bloques) =>
        bloques.map((bloque, i) =>
          i !== indice
            ? bloque
            : { ...bloque, dias: bloque.dias.includes(dia) ? bloque.dias.filter((d) => d !== dia) : [...bloque.dias, dia] },
        ),
      ),
    [cambiarBloques],
  );

  const fijarHoraGrupal = useCallback(
    (nombre: string, indice: number, hora: string) =>
      cambiarBloques(nombre, (bloques) => bloques.map((bloque, i) => (i === indice ? { ...bloque, hora } : bloque))),
    [cambiarBloques],
  );

  /** Un horario nuevo, sin días, a la hora del último (o 18:00 si es el primero). */
  const agregarBloqueGrupal = useCallback(
    (nombre: string) =>
      cambiarBloques(nombre, (bloques) =>
        horariosDeBloques(bloques).length >= MAX_HORARIOS_GRUPALES
          ? bloques
          : [...bloques, { dias: [], hora: bloques.at(-1)?.hora ?? "18:00" }],
      ),
    [cambiarBloques],
  );

  const quitarBloqueGrupal = useCallback(
    (nombre: string, indice: number) => cambiarBloques(nombre, (bloques) => bloques.filter((_, i) => i !== indice)),
    [cambiarBloques],
  );

  const limpiarBloquesGrupales = useCallback(
    (nombre: string) =>
      cambiarBloques(nombre, (bloques) =>
        bloques.some((bloque) => bloque.dias.length === 0) ? bloques.filter((bloque) => bloque.dias.length > 0) : bloques,
      ),
    [cambiarBloques],
  );

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
      Object.entries(elegidos).map(([nombre, { duracionMin, precio, grupal, capacidad, bloques }]) => ({
        nombre,
        duracionMin,
        // Sin precio la clave no viaja: el DTO lo trata como ausente. Lo mismo con lo grupal apagado.
        ...(precio === undefined ? {} : { precio }),
        ...(grupal ? { capacidad, horarios: horariosDeBloques(bloques ?? []) } : {}),
      })),
    [elegidos],
  );

  /** nombre → por qué su parte grupal no se puede guardar todavía. Vacío = todo bien. */
  const problemasGrupales = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(elegidos).flatMap(([nombre, datos]) => {
          if (!datos.grupal) return [];
          const problema = problemaDeBloques(datos.duracionMin, datos.capacidad, datos.bloques ?? []);
          return problema ? [[nombre, problema]] : [];
        }),
      ) as Record<string, string>,
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
    fijarGrupal,
    elegirModalidad,
    fijarCapacidad,
    alternarDiaGrupal,
    fijarHoraGrupal,
    agregarBloqueGrupal,
    quitarBloqueGrupal,
    limpiarBloquesGrupales,
    problemasGrupales,
    gruposValidos: Object.keys(problemasGrupales).length === 0,
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
  const [atencion, setAtencion] = useState<Atencion>("individual");
  const tipos = useTiposEvento(tipoUso);
  const { setElegidos } = tipos;
  const clases = useClases();
  const local = useLocal();
  // Dónde da los turnos (LAU-17): su propio estado, para no mezclarlo con el local de ventas.
  const lugar = useLocal(null, { paraAgenda: true });
  // Con nombre propio y no esparcido: comparte nombres (`agregarPersonalizado`) con los tipos de evento.
  const datosCliente = useDatosCliente();

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
  const pasos = pasosDe(tipoAsistente, atencion);
  // En el wizard los turnos individuales y las clases se cargan en pasos
  // separados: cada uno cuenta sólo si su paso está en el recorrido.
  const conTurnos = atencion !== "grupal";
  const conClases = atencion !== "individual";
  const seleccionados = useMemo(() => (conTurnos ? tipos.seleccionados : []), [conTurnos, tipos.seleccionados]);
  const clasesElegidas = useMemo(() => (conClases ? clases.seleccionadas : []), [conClases, clases.seleccionadas]);
  const repetida = clasesElegidas.find((clase) =>
    seleccionados.some((tipo) => tipo.nombre.trim().toLowerCase() === clase.nombre.trim().toLowerCase()),
  );
  /** Por qué el paso de clases no deja seguir, o null. */
  const problemaClases =
    clases.activas.length === 0
      ? "Elegí al menos una clase."
      : (Object.entries(clases.problemas).map(([nombre]) => `Falta completar ${nombre}.`)[0] ??
        (repetida
          ? `Ya tenés un turno llamado "${repetida.nombre}": cambiale el nombre a la clase.`
          : seleccionados.length + clasesElegidas.length > MAX_TIPOS_EVENTO
            ? `Entre turnos y clases pueden ser hasta ${MAX_TIPOS_EVENTO}.`
            : null));
  const ultimoPaso = pasos.length - 1;
  const pasoId = pasos[paso]?.id ?? "tipo";
  // Un comercio no elige "persona": el que vende es el negocio.
  const tipoTitularEfectivo: TipoTitular = esVentas ? "negocio" : tipoTitular;

  const rangoValido = horaDesde < horaHasta;

  const puedeAvanzar: Record<PasoId, boolean> = {
    tipo: true,
    negocio: nombreTitular.trim().length >= LARGO_MIN_NOMBRE,
    atencion: true,
    lugar: lugar.valido,
    turnos: seleccionados.length > 0 && tipos.gruposValidos,
    clases: problemaClases === null,
    horarios: rangoValido,
    local: local.valido,
    // Opcional: sin tildar nada el asistente sólo pide el nombre.
    datos: true,
    asistente: nombreBot.trim().length >= LARGO_MIN_NOMBRE,
  };

  /** Lo que ya se respondió en cada paso, para el riel. */
  const resumenes: Record<PasoId, string> = {
    tipo: esVentas ? "Vender productos" : "Agendar turnos",
    negocio: nombreTitular.trim(),
    atencion: ETIQUETA_ATENCION[atencion],
    lugar: lugar.resumen,
    turnos: `${seleccionados.length} ${seleccionados.length === 1 ? "tipo" : "tipos"}`,
    clases: `${clasesElegidas.length} ${clasesElegidas.length === 1 ? "clase" : "clases"}`,
    horarios: `${horaDesde}–${horaHasta}`,
    local: local.resumen,
    datos: datosCliente.resumen,
    asistente: nombreBot.trim(),
  };

  /** Sólo se elige en "¿Cómo atendés?", que está en los tres recorridos y en el mismo lugar: el índice no cambia. */
  const elegirAtencion = useCallback((valor: Atencion) => setAtencion(valor), []);

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
  const listas = clases.activas.filter((clase) => !clases.problemas[clase.nombre]);
  const saludoClases =
    listas.length > 0
      ? `Doy ${listas
          .slice(0, 3)
          .map((clase) => `${clase.nombre.toLowerCase()} (${textoBloques(clase.bloques)})`)
          .join(", ")}${listas.length > 3 ? " y más" : ""}. ¿A cuál te querés anotar?`
      : "Cuando elijas tus clases, acá vas a ver cómo las ofrezco.";
  /** Una reserva de ejemplo en la primera clase completa: el cliente elige su primer horario. */
  const ejemploReservaClase = (() => {
    const clase = listas[0];
    const bloque = clase?.bloques.find((b) => b.dias.length > 0);
    const dia = bloque && DIAS_SEMANA.find((d) => bloque.dias.includes(d));
    if (!clase || !bloque || !dia || clase.cupo === undefined) return null;
    const cuando = `el ${NOMBRE_DIA[dia].toLowerCase()} a las ${bloque.hora}`;
    const quedan = clase.cupo - 1;
    const lugares = quedan === 0 ? "Con vos se llenó la clase." : `Quedan ${quedan} ${quedan === 1 ? "lugar" : "lugares"}.`;
    return {
      cliente: `${conMayusculaInicial(cuando)} me viene bien. Soy Caro`,
      asistente: `Listo, Caro: te anoté en ${clase.nombre.toLowerCase()} ${cuando}. ${lugares}`,
    };
  })();

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
    atencion,
    elegirAtencion,
    clases,
    problemaClases,
    saludoClases,
    ejemploReservaClase,
    tipoTitular: tipoTitularEfectivo,
    setTipoTitular,
    nombreTitular,
    setNombreTitular,
    tipoUso,
    elegirTipoUso,
    ...tipos,
    // Las de arriba son todos los tipos del paso de turnos; éstos, los que cuentan para el recorrido elegido.
    seleccionados,
    horaDesde,
    setHoraDesde,
    horaHasta,
    setHoraHasta,
    elegirPreset,
    rangoValido,
    nombreBot,
    setNombreBot,
    local,
    lugar,
    saludoLugar: respuestaDelLugar(lugar, titular),
    datosCliente,
    puedeAvanzar,
    presentacion,
    saludo,
    saludoEventos,
    saludoHorarios,
    /** Body de POST /agents/generate-ventas. */
    payloadVentas: (): DatosVentas => ({
      nombreTitular: nombreTitular.trim(),
      nombreBot: nombreBot.trim(),
      local: local.payload(),
      ...datosCliente.payload(),
    }),
    /** Body de POST /agents/generate. */
    payload: () => ({
      tipoTitular,
      nombreTitular: nombreTitular.trim(),
      tipoUso,
      tiposEvento: [...seleccionados, ...clasesElegidas],
      horaDesde,
      horaHasta,
      nombreBot: nombreBot.trim(),
      local: lugar.payload(),
    }),
  };
}

/** Lo que contesta el asistente en la vista previa cuando le preguntan dónde atiende. */
function respuestaDelLugar(lugar: LocalState, titular: string): string {
  const direccion = lugar.direccion.trim() || "tu dirección";
  switch (lugar.opcionLugar) {
    case "local":
      return `Estamos en ${direccion}.`;
    case "casa":
      return `Es en la casa de ${titular}. La dirección te la paso apenas quede agendado tu turno.`;
    case "ninguno":
      return `No tenemos un lugar fijo: ${titular} atiende online o a domicilio y lo coordina con vos.`;
  }
}

function conMayusculaInicial(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
