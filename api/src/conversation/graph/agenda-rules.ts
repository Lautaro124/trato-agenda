/**
 * Reglas duras de la agenda, en funciones puras. Antes vivían mezcladas con la
 * ejecución de los tools (conversation-tools.ts); ahora las usa el nodo
 * `validacion` del grafo, que decide contra el snapshot de agenda cargado una
 * sola vez por mensaje, sin volver a pegarle a Google.
 */
import type { PeriodoOcupado } from '../../calendar/calendar.service.js';
import type { Agent } from '../../generated/prisma/client.js';

export const TIMEZONE = 'America/Argentina/Buenos_Aires';

/**
 * Argentina no tiene horario de verano desde 2009, así que el offset es fijo.
 * Se usa sólo para construir los límites de la franja de atención de un día
 * ("2026-09-08" + "09:00" → Date); todo lo que se muestra al modelo se
 * formatea con Intl sobre TIMEZONE.
 */
const OFFSET = '-03:00';

/**
 * Colchón mínimo entre un turno y el siguiente. Se aplica ensanchando el rango
 * que se compara contra los períodos ocupados, así el chequeo de superposición
 * y el de margen son la misma operación.
 */
export const MARGEN_MINIMO_MIN = 5;

/**
 * Días en los que se atiende, en el formato de `Date#getUTCDay` (0 = domingo).
 * Sábados y domingos no cuentan para la agenda: no se ofrecen, no se listan y
 * no se agenda nada en ellos. Vive acá, en código, y no en la fila `Agent`, por
 * la misma razón que el resto de las reglas duras: aplica también a los agentes
 * ya generados, sin migración ni regeneración.
 */
const DIAS_HABILES = new Set([1, 2, 3, 4, 5]);

const formateador = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** Hora local "HH:MM" en TIMEZONE, comparable contra Agent.horaDesde/horaHasta. */
const formateadorHora = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "2026-09-08" en TIMEZONE — clave de día, no de UTC. */
const formateadorDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "lunes 8/9" — encabezado de cada día en el resumen de agenda. */
const formateadorEtiquetaDia = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'numeric',
});

export function formatearFecha(fecha: Date): string {
  return formateador.format(fecha);
}

export function horaLocal(fecha: Date): string {
  // es-AR devuelve "24:00" a la medianoche; normalizarlo a "00:00".
  return formateadorHora.format(fecha).replace(/^24:/, '00:');
}

export function claveDia(fecha: Date): string {
  return formateadorDia.format(fecha);
}

/** Un "HH:MM" de la franja del Agent, sobre un día concreto, como Date. */
export function fechaEnDia(dia: string, hhmm: string): Date {
  return new Date(`${dia}T${hhmm}:00${OFFSET}`);
}

/**
 * true si en ese día se atiende. El mediodía local cae siempre en el mismo día
 * en UTC (el offset es -03:00), así que `getUTCDay` alcanza y no hace falta otro
 * formateador de Intl.
 */
export function esDiaHabil(dia: string): boolean {
  return DIAS_HABILES.has(fechaEnDia(dia, '12:00').getUTCDay());
}

export function mensajeDiaNoHabil(): string {
  return 'Ese día no se atiende: sólo de lunes a viernes, sábados y domingos no.';
}

/** El rango del turno más el margen mínimo de cada lado. */
export function conMargen(inicio: Date, fin: Date): [Date, Date] {
  const margenMs = MARGEN_MINIMO_MIN * 60_000;
  return [new Date(inicio.getTime() - margenMs), new Date(fin.getTime() + margenMs)];
}

/**
 * Períodos ocupados que se solapan con el rango pedido. Reemplaza la consulta
 * acotada a freeBusy que antes hacía cada tool: el snapshot ya trae todos los
 * ocupados de la ventana, así que filtrar en memoria alcanza.
 */
export function ocupadosEnRango(
  ocupados: PeriodoOcupado[],
  desde: Date,
  hasta: Date,
): PeriodoOcupado[] {
  return ocupados.filter(
    (periodo) => periodo.inicio.getTime() < hasta.getTime() && periodo.fin.getTime() > desde.getTime(),
  );
}

/**
 * Períodos ocupados que realmente bloquean el horario, descartando el evento
 * del propio turno cuando se está reprogramando: sin esto, mover un turno unos
 * minutos choca contra sí mismo por culpa del margen.
 */
export function conflictos(
  ocupados: PeriodoOcupado[],
  ignorar?: { inicio: Date; fin: Date },
): PeriodoOcupado[] {
  if (!ignorar) return ocupados;
  return ocupados.filter(
    (periodo) =>
      periodo.inicio.getTime() !== ignorar.inicio.getTime() ||
      periodo.fin.getTime() !== ignorar.fin.getTime(),
  );
}

export function detalleOcupados(ocupados: PeriodoOcupado[]): string {
  return ocupados
    .map((periodo) => `${formatearFecha(periodo.inicio)} a ${formatearFecha(periodo.fin)}`)
    .join('; ');
}

export type AgentFranja = Pick<Agent, 'horaDesde' | 'horaHasta'>;

/** true si el turno entero entra en la franja de atención del dueño. */
export function dentroDeFranja(agent: AgentFranja, inicio: Date, fin: Date): boolean {
  const desde = horaLocal(inicio);
  const hasta = horaLocal(fin);
  // Un turno que cruza la medianoche siempre cae fuera de la franja.
  if (hasta <= desde) return false;
  return desde >= agent.horaDesde && hasta <= agent.horaHasta;
}

export function mensajeFueraDeFranja(agent: AgentFranja): string {
  return (
    `Ese horario queda fuera de la franja de atención (de ${agent.horaDesde} a ${agent.horaHasta}). ` +
    'Ofrecé un horario dentro de esa franja.'
  );
}

/** "2026-09-08T14:00" o "2026-09-08T14:00:00(.000)": ISO sin zona horaria. */
const SIN_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
/** "2026-09-08": sólo fecha, sin horario. */
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Un ISO sin offset lo interpreta `new Date` en la zona del proceso, y la API
 * corre en UTC dentro de Docker: "14:00" terminaba siendo las 11:00 de acá, y
 * la comparación contra los períodos ocupados se hacía sobre otro instante.
 * Todo lo que llega sin zona se ancla a TIMEZONE, que es la zona del negocio.
 */
function anclarZona(valor: string): string {
  if (SIN_ZONA.test(valor)) return `${valor}${OFFSET}`;
  if (SOLO_FECHA.test(valor)) return `${valor}T00:00:00${OFFSET}`;
  return valor;
}

/** `new Date(valor)` sin fallar silenciosamente en algo tipo "Invalid Date". */
export function parsearFecha(valor: unknown, campo: string): Date {
  if (typeof valor !== 'string') {
    throw new Error(`Falta o es inválido el campo "${campo}" (tiene que ser string ISO 8601).`);
  }
  const fecha = new Date(anclarZona(valor.trim()));
  if (Number.isNaN(fecha.getTime())) {
    throw new Error(`El campo "${campo}" no es una fecha ISO 8601 válida: "${valor}".`);
  }
  return fecha;
}

export function parsearFechaOpcional(valor: unknown, campo: string): Date | undefined {
  if (valor === undefined || valor === null) return undefined;
  return parsearFecha(valor, campo);
}

export type Hueco = { inicio: Date; fin: Date };

/**
 * Huecos libres de un día dentro de la franja de atención, ya descontado el
 * margen mínimo alrededor de cada período ocupado. `desde` recorta el día en
 * curso para no ofrecer horarios que ya pasaron.
 */
export function huecosDelDia(
  agent: AgentFranja,
  ocupados: PeriodoOcupado[],
  dia: string,
  desde: Date,
  duracionMinimaMin: number,
): Hueco[] {
  if (!esDiaHabil(dia)) return [];

  const aperturaDia = fechaEnDia(dia, agent.horaDesde);
  const cierre = fechaEnDia(dia, agent.horaHasta);
  const apertura = aperturaDia.getTime() > desde.getTime() ? aperturaDia : desde;
  if (apertura >= cierre) return [];

  const margenMs = MARGEN_MINIMO_MIN * 60_000;
  const bloqueados = ocupadosEnRango(ocupados, apertura, cierre)
    .map((periodo) => ({
      inicio: new Date(periodo.inicio.getTime() - margenMs),
      fin: new Date(periodo.fin.getTime() + margenMs),
    }))
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

  const huecos: Hueco[] = [];
  let cursor = apertura;
  for (const bloque of bloqueados) {
    if (bloque.inicio > cursor) {
      huecos.push({ inicio: cursor, fin: bloque.inicio < cierre ? bloque.inicio : cierre });
    }
    if (bloque.fin > cursor) cursor = bloque.fin;
    if (cursor >= cierre) break;
  }
  if (cursor < cierre) huecos.push({ inicio: cursor, fin: cierre });

  const minimoMs = duracionMinimaMin * 60_000;
  return huecos.filter((hueco) => hueco.fin.getTime() - hueco.inicio.getTime() >= minimoMs);
}

/**
 * Resumen compacto de la disponibilidad para meter en el system prompt. Es lo
 * que evita que el modelo tenga que gastar una vuelta entera (y una lectura a
 * Google) preguntando "¿está libre el martes?".
 */
export function resumirDisponibilidad(
  agent: AgentFranja,
  ocupados: PeriodoOcupado[],
  desde: Date,
  hasta: Date,
  duracionMinimaMin: number,
  maxDias: number,
): string {
  const lineas: string[] = [];
  const cursor = new Date(desde);

  while (cursor < hasta && lineas.length < maxDias) {
    const dia = claveDia(cursor);
    // Los fines de semana no se listan: imprimirlos como "sin huecos" gastaría
    // tokens y le daría al modelo la idea de que son días que existen.
    if (esDiaHabil(dia)) {
      const huecos = huecosDelDia(agent, ocupados, dia, desde, duracionMinimaMin);
      const etiqueta = formateadorEtiquetaDia.format(cursor);
      lineas.push(
        huecos.length > 0
          ? `${etiqueta}: ${huecos.map((h) => `${horaLocal(h.inicio)}-${horaLocal(h.fin)}`).join(', ')}`
          : `${etiqueta}: sin huecos`,
      );
    }
    // Avanzar al día siguiente parándose al mediodía, para no depender de la hora.
    cursor.setTime(fechaEnDia(dia, '12:00').getTime() + 24 * 60 * 60_000);
  }

  return lineas.join('\n');
}

export type Sugerencia = Hueco;

/** Tope de días que se recorren buscando alternativas (la ventana cargada son 14). */
const MAX_DIAS_SUGERENCIA = 14;

/**
 * Los horarios libres más cercanos al que pidió el cliente, ordenados por
 * cercanía al inicio pedido. Se apoya en `huecosDelDia`, así que ya respeta la
 * franja de atención y el margen mínimo: dentro de cada hueco se elige el punto
 * más cercano a lo pedido, no el arranque del hueco (si pidió 10:03 y el turno
 * anterior termina 10:00, la sugerencia es 10:05, no las 09:00).
 */
export function horariosCercanos(
  agent: AgentFranja,
  ocupados: PeriodoOcupado[],
  inicio: Date,
  fin: Date,
  desde: Date,
  hasta: Date,
  cantidad = 2,
): Sugerencia[] {
  const duracionMs = fin.getTime() - inicio.getTime();
  if (duracionMs <= 0) return [];

  const candidatos: Sugerencia[] = [];
  const cursor = new Date(desde);
  for (let dias = 0; cursor < hasta && dias < MAX_DIAS_SUGERENCIA; dias += 1) {
    const dia = claveDia(cursor);
    for (const hueco of huecosDelDia(agent, ocupados, dia, desde, duracionMs / 60_000)) {
      const ultimoInicio = hueco.fin.getTime() - duracionMs;
      const arranque = Math.min(Math.max(inicio.getTime(), hueco.inicio.getTime()), ultimoInicio);
      if (arranque + duracionMs <= hasta.getTime()) {
        candidatos.push({ inicio: new Date(arranque), fin: new Date(arranque + duracionMs) });
      }
    }
    // Avanzar al día siguiente parándose al mediodía, para no depender de la hora.
    cursor.setTime(fechaEnDia(dia, '12:00').getTime() + 24 * 60 * 60_000);
  }

  const distancia = (fecha: Date) => Math.abs(fecha.getTime() - inicio.getTime());
  return candidatos.sort((a, b) => distancia(a.inicio) - distancia(b.inicio)).slice(0, cantidad);
}

export function detalleSugerencias(sugerencias: Sugerencia[]): string {
  return sugerencias
    .map((sugerencia) => `${formatearFecha(sugerencia.inicio)} a ${horaLocal(sugerencia.fin)}`)
    .join(' o ');
}

/**
 * El rechazo por superposición, con la alternativa libre más cercana adentro.
 * Lo comparten el nodo de validación y el de calendario (que vuelve a leer
 * Google justo antes de escribir), para que el modelo reciba siempre el mismo
 * texto y no tenga que inventar el horario alternativo por su cuenta.
 */
export function mensajeOcupado(
  agent: AgentFranja,
  ocupados: PeriodoOcupado[],
  choques: PeriodoOcupado[],
  inicio: Date,
  fin: Date,
  desde: Date,
  hasta: Date,
): string {
  const alternativas = detalleSugerencias(horariosCercanos(agent, ocupados, inicio, fin, desde, hasta));
  const cierre = alternativas
    ? `Lo más cercano que tengo libre es ${alternativas}. Ofrecéselo al cliente.`
    : 'No me queda ningún hueco de esa duración en los próximos días; pedile otra fecha.';

  return (
    `Ese horario está ocupado o queda a menos de ${MARGEN_MINIMO_MIN} minutos de otro turno ` +
    `(${detalleOcupados(choques)}). ${cierre}`
  );
}

/** Tope de horarios concretos que se le pasan al modelo para un mismo día. */
export const MAX_OPCIONES_DIA = 3;

/**
 * Un puñado chico de horarios concretos de un día, sobre una grilla del largo
 * del turno. Se reparten parejo a lo largo de la jornada en vez de devolver los
 * primeros seguidos: con tres opciones el cliente elige, y el mensaje sigue
 * entrando en una línea de WhatsApp.
 */
export function opcionesDelDia(
  agent: AgentFranja,
  ocupados: PeriodoOcupado[],
  dia: string,
  desde: Date,
  duracionMin: number,
  cantidad = MAX_OPCIONES_DIA,
): Date[] {
  const pasoMs = Math.max(duracionMin, 1) * 60_000;
  const candidatos: Date[] = [];
  for (const hueco of huecosDelDia(agent, ocupados, dia, desde, duracionMin)) {
    for (let t = hueco.inicio.getTime(); t + pasoMs <= hueco.fin.getTime(); t += pasoMs) {
      candidatos.push(new Date(t));
    }
  }

  if (candidatos.length <= cantidad) return candidatos;
  if (cantidad <= 1) return [candidatos[0]];

  const paso = (candidatos.length - 1) / (cantidad - 1);
  return Array.from({ length: cantidad }, (_, i) => candidatos[Math.round(i * paso)]);
}

/** "lunes 8/9", a partir de la clave de día. */
function etiquetaDia(dia: string): string {
  return formateadorEtiquetaDia.format(fechaEnDia(dia, '12:00'));
}

/**
 * Lo que el nodo de validación le contesta al modelo cuando la consulta es de
 * un día solo. El objetivo es que la respuesta al cliente sea corta: si el día
 * está entero libre se dice el rango y listo; si ya hay turnos se le pide al
 * modelo que pregunte mañana o tarde y ofrezca a lo sumo tres horarios, en vez
 * de volcarle la agenda completa.
 */
export function resumenDelDia(
  agent: AgentFranja,
  ocupados: PeriodoOcupado[],
  dia: string,
  desde: Date,
  hasta: Date,
  duracionMin: number,
): string {
  const etiqueta = etiquetaDia(dia);

  if (!esDiaHabil(dia)) {
    return `${mensajeDiaNoHabil()} Ofrecele el día hábil más cercano.`;
  }

  const huecos = huecosDelDia(agent, ocupados, dia, desde, duracionMin);
  if (huecos.length === 0) {
    const apertura = fechaEnDia(dia, agent.horaDesde);
    const alternativas = detalleSugerencias(
      horariosCercanos(
        agent,
        ocupados,
        apertura,
        new Date(apertura.getTime() + duracionMin * 60_000),
        desde,
        hasta,
        1,
      ),
    );
    return alternativas
      ? `El ${etiqueta} no queda nada libre. Lo más cercano que tengo es ${alternativas}: ofrecéselo en una línea.`
      : `El ${etiqueta} no queda nada libre y tampoco tengo huecos cerca; pedile otra fecha.`;
  }

  const apertura = huecos[0].inicio;
  const cierre = fechaEnDia(dia, agent.horaHasta);
  const libreEntero = huecos.length === 1 && huecos[0].fin.getTime() >= cierre.getTime();
  if (libreEntero) {
    return (
      `El ${etiqueta} está libre de ${horaLocal(apertura)} a ${horaLocal(huecos[0].fin)}. ` +
      'Decíselo así, como un rango, sin enumerar horarios.'
    );
  }

  const opciones = opcionesDelDia(agent, ocupados, dia, desde, duracionMin)
    .map((inicio) => horaLocal(inicio))
    .join(', ');
  return (
    `El ${etiqueta} ya tiene turnos. Horarios libres para ofrecer: ${opciones}. ` +
    `Preguntale si prefiere por la mañana o por la tarde y pasale como mucho ${MAX_OPCIONES_DIA} horarios, ` +
    'nunca la lista completa del día.'
  );
}
