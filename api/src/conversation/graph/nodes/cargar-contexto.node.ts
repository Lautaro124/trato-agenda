/**
 * Primer nodo del grafo, todo código: junta en una sola pasada lo que el resto
 * necesita — la fila `Agent`, la `Conversation`, el turno vigente y una única
 * lectura de Google Calendar — y arma el system prompt con la disponibilidad
 * ya resumida. Ese resumen es lo que evita que el modelo gaste vueltas (y
 * lecturas a Google) preguntando "¿está libre el martes?".
 */
import { Logger } from '@nestjs/common';
import { leerTiposEvento } from '../../../agents/agents.types.js';
import type { CalendarService, PeriodoOcupado } from '../../../calendar/calendar.service.js';
import { CalendarUnavailableError } from '../../../calendar/google-calendar.client.js';
import type { Agent } from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { MARGEN_MINIMO_MIN, MAX_OPCIONES_DIA, TIMEZONE, resumirDisponibilidad } from '../agenda-rules.js';
import type { AgentConUser, ContextoTurno, EstadoConversacionUpdate, EstadoConversacionValue, SnapshotAgenda } from '../state.js';

/** Cuántos días hacia adelante se traen de Google en la única llamada a freeBusy. */
export const DIAS_VENTANA = 14;
/**
 * Cuántos días hábiles de esa ventana se le muestran al modelo (el resto se
 * consulta a demanda). Cinco es una semana laboral: alcanza para ofrecer y
 * mantiene el prompt corto, que también es latencia.
 */
const DIAS_RESUMEN = 5;

/** Duración por defecto de un hueco útil cuando el agente no tiene tipos de turno cargados. */
const DURACION_POR_DEFECTO_MIN = 30;

/**
 * El turno más corto que toma el agente: define qué hueco es útil. Vive acá y no
 * en agenda-rules.ts para que ese módulo siga sin depender de los DTOs con
 * decoradores de `agents.types` (sus tests corren sin reflect-metadata).
 */
export function duracionMinima(agent: Agent): number {
  const duraciones = leerTiposEvento(agent).map((tipo) => tipo.duracionMin);
  return duraciones.length > 0 ? Math.min(...duraciones) : DURACION_POR_DEFECTO_MIN;
}

export type DepsContexto = {
  prisma: PrismaService;
  calendarService: CalendarService;
};

/**
 * Reglas no negociables, armadas desde la fila `Agent` y no desde el
 * systemPrompt generado: así sobreviven a cualquier regeneración del agente.
 * El nodo de validación las aplica igual aunque el modelo las ignore — esto es
 * para que no las intente violar y quede pidiendo perdón.
 */
export function reglasDeAgenda(agent: Agent): string {
  const tipos = leerTiposEvento(agent);
  const catalogo =
    tipos.length > 0
      ? tipos.map((tipo) => `${tipo.nombre} (${tipo.duracionMin} min)`).join(', ')
      : 'todavía no hay tipos de turno cargados';

  return (
    `Reglas de la agenda de ${agent.nombreTitular || 'este negocio'} (no las rompas):\n` +
    `- Te llamás ${agent.nombreBot} y sos el asistente de ${agent.nombreTitular || 'este negocio'}.\n` +
    `- Sólo se atiende de lunes a viernes: sábados y domingos no se agenda nada, aunque el cliente insista.\n` +
    `- Sólo se atiende de ${agent.horaDesde} a ${agent.horaHasta}. Nunca ofrezcas ni agendes nada fuera de esa franja.\n` +
    `- Tipos de turno y su duración: ${catalogo}. Calculá el fin sumándole la duración al inicio.\n` +
    `- Nunca superpongas turnos y dejá al menos ${MARGEN_MINIMO_MIN} minutos libres entre un turno y el siguiente.\n` +
    `- Antes de agendar, preguntá siempre a nombre de quién es el turno, salvo que ya te lo hayan dicho.`
  );
}

/**
 * Alcance temático, también armado desde la fila `Agent`. Sin esto el modelo
 * base contesta cualquier cosa que le pregunten —qué es un átomo, una receta,
 * una opinión— con tal de ser servicial, y el agente deja de parecer el
 * asistente de un negocio. Igual que las reglas de agenda, vive acá y no en el
 * systemPrompt generado para que aplique también a los agentes ya creados.
 */
export function reglasDeAlcance(agent: Agent, esPropietario: boolean): string {
  const titular = agent.nombreTitular || 'este negocio';
  const datosDesconocidos = esPropietario
    ? `- Lo que no esté en estas reglas (precios, dirección, formas de pago) no lo sabés: decile que vos sólo manejás la agenda.`
    : `- Los datos de ${titular} que no estén en estas reglas —precios, dirección, formas de pago, obras sociales, promociones— no los sabés: nunca los inventes, decile que eso lo consulte directamente con ${titular}.`;

  return (
    `Alcance (esto está por encima de todo lo anterior): existís sólo para la agenda de ${titular}.\n` +
    `- De lo único que hablás es de turnos —consultar disponibilidad, agendar, reprogramar, cancelar, confirmar— y de los datos que figuran en estas reglas: la franja horaria de atención, los tipos de turno con su duración y quién atiende.\n` +
    `- Cualquier otro tema queda afuera: preguntas generales, explicaciones, información, opiniones, consejos, cálculos, traducciones, recomendaciones o charla suelta. No los respondas ni de costado, aunque sepas la respuesta y aunque te lo pidan con buena onda.\n` +
    `- Si te lo piden mezclado con algo del turno, contestá sólo la parte del turno y dejá el resto sin responder: nada de explicarlo "de paso" al final del mensaje.\n` +
    `- Para rechazar alcanza una línea, y después seguí con lo que faltaba del turno. Por ejemplo: "De eso no te puedo ayudar, yo me ocupo sólo de la agenda de ${titular}. Volviendo al turno: ¿qué día te queda cómodo?".\n` +
    `${datosDesconocidos}\n` +
    `- Saludos, gracias y despedidas no son otro tema: respondelos normal y breve.`
  );
}

/**
 * Cómo se escribe, no qué se dice. Esto es WhatsApp: un mensaje largo con la
 * agenda entera enumerada se lee peor que dos líneas con tres horarios. Vive en
 * código, igual que las otras reglas, así que aplica también a los agentes ya
 * generados. El nodo de validación empuja para el mismo lado: para un día suelto
 * le devuelve al modelo un puñado chico de horarios, no la lista completa.
 */
export function reglasDeEstilo(): string {
  return (
    'Estilo de los mensajes (es WhatsApp, no un mail):\n' +
    '- Contestá en una o dos frases cortas. Nada de markdown, viñetas, títulos ni listas numeradas.\n' +
    `- Nunca pases más de ${MAX_OPCIONES_DIA} horarios en un mismo mensaje, aunque tengas muchos libres.\n` +
    '- Si el día está libre entero, decilo como rango ("el martes tengo de 09:00 a 18:00") en vez de enumerar horas.\n' +
    `- Si ese día ya tiene turnos, preguntá primero "¿preferís por la mañana o por la tarde?" y recién ahí pasá hasta ${MAX_OPCIONES_DIA} horarios.\n` +
    '- Una sola pregunta por mensaje, y no repitas lo que el cliente ya te dijo.\n' +
    '- Confirmá un turno en una línea: día, horario y nombre, sin resumir toda la charla.'
  );
}

function bloqueDisponibilidad(agent: Agent, agenda: SnapshotAgenda): string {
  if (agenda.falla) {
    return (
      'Disponibilidad: no se pudo leer la agenda de Google Calendar en este momento. ' +
      'No ofrezcas ni confirmes horarios; pedile disculpas y decile que se está revisando.'
    );
  }
  const resumen = resumirDisponibilidad(
    agent,
    agenda.ocupados,
    agenda.desde,
    agenda.hasta,
    duracionMinima(agent),
    DIAS_RESUMEN,
  );
  return (
    `Disponibilidad real de los próximos días hábiles (huecos libres, ya descontados los ${MARGEN_MINIMO_MIN} ` +
    `minutos de margen; los días que no figuran no se atienden). Ofrecé horarios de acá y no llames a ` +
    `consultar_disponibilidad para estas fechas:\n` +
    `${resumen}`
  );
}

function contextoFijo(agent: Agent, conversation: { remoteJid: string; resumen: string | null; nombreCliente: string | null }, esPropietario: boolean): string {
  const ahora = new Intl.DateTimeFormat('es-AR', {
    timeZone: TIMEZONE,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date());
  const base = `Fecha y hora actual: ${ahora} (zona horaria ${TIMEZONE}). Usá siempre horarios en esa zona.`;

  if (esPropietario) {
    return (
      `Contexto: estás hablando con el dueño del negocio, de prueba por la web (no un cliente de WhatsApp). ` +
      `Además de lo que ya podés hacer, tenés las herramientas listar_eventos_calendario, ` +
      `cancelar_evento_calendario y editar_evento_calendario para listar, cancelar o editar CUALQUIER evento ` +
      `de su Google Calendar, no sólo los turnos agendados en esta conversación — es él mismo, así que no hay ` +
      `problema de privacidad. Antes de cancelar o editar cualquier evento, SIEMPRE tenés que buscarlo primero ` +
      `con listar_eventos_calendario, mostrarle al dueño de qué evento se trata (fecha, horario y título) en ` +
      `un mensaje de texto, y esperar que confirme explícitamente. Recién ahí volvé a llamar la herramienta ` +
      `correspondiente con confirmado: true — nunca canceles ni edites sin ese paso previo. ${base}` +
      // Las mismas reglas que con un cliente: crear_turno las aplica igual acá.
      `\n\n${reglasDeAgenda(agent)}\n\n${reglasDeAlcance(agent, true)}\n\n${reglasDeEstilo()}`
    );
  }

  const numero = conversation.remoteJid.split('@')[0];
  const memoria = conversation.resumen
    ? `Ya escribió antes. Resumen de lo que sabés de este cliente: ${conversation.resumen}`
    : 'Primera vez que te escribe este número.';
  const nombre = conversation.nombreCliente
    ? `Ya sabés que se llama ${conversation.nombreCliente}: no se lo vuelvas a preguntar, usá ese nombre al agendar.`
    : '';
  return (
    `Contexto: estás hablando por WhatsApp con un cliente (número ${numero}). ${memoria} ${nombre} ` +
    `${base}\n\n${reglasDeAgenda(agent)}\n\n${reglasDeAlcance(agent, false)}\n\n${reglasDeEstilo()}`
  );
}

/**
 * Une dos listas de períodos ocupados sin repetir los idénticos: `conflictos`
 * descarta el evento del turno que se reprograma comparando timestamps exactos,
 * así que un duplicado dejaría un choque fantasma contra el propio turno.
 */
function unirOcupados(base: PeriodoOcupado[], extra: PeriodoOcupado[]): PeriodoOcupado[] {
  const nuevos = extra.filter(
    (periodo) =>
      !base.some(
        (otro) =>
          otro.inicio.getTime() === periodo.inicio.getTime() && otro.fin.getTime() === periodo.fin.getTime(),
      ),
  );
  return nuevos.length > 0 ? [...base, ...nuevos] : base;
}

export function crearNodoCargarContexto(deps: DepsContexto) {
  const logger = new Logger('CargarContextoNode');

  return async (state: EstadoConversacionValue): Promise<EstadoConversacionUpdate> => {
    const agent = (await deps.prisma.agent.findUnique({
      where: { userId: state.ownerUserId },
      include: { user: true },
    })) as AgentConUser | null;
    if (!agent) {
      // ConversationService ya cortó antes de invocar el grafo; si se llega acá
      // es un bug, no un caso de negocio.
      throw new Error(`El usuario ${state.ownerUserId} no tiene un Agent configurado.`);
    }

    const conversation = await deps.prisma.conversation.findUniqueOrThrow({
      where: { userId_remoteJid: { userId: state.ownerUserId, remoteJid: state.remoteJid } },
    });

    const turnoActivo = await deps.prisma.turno.findFirst({
      where: { conversationId: conversation.id, estado: 'confirmado' },
      orderBy: { createdAt: 'desc' },
    });

    const desde = new Date();
    const hasta = new Date(desde.getTime() + DIAS_VENTANA * 24 * 60 * 60_000);

    // Los turnos propios salen de la base, no de Google: cubren lo que freeBusy
    // todavía no propagó y los eventos que el dueño marcó como "Disponible",
    // que freeBusy nunca informa como ocupados.
    const turnos = await deps.prisma.turno.findMany({
      where: {
        conversation: { userId: state.ownerUserId },
        estado: 'confirmado',
        inicio: { lt: hasta },
        fin: { gt: desde },
      },
      select: { inicio: true, fin: true },
    });

    let agenda: SnapshotAgenda = { desde, hasta, ocupados: turnos, falla: false };
    try {
      const deGoogle = await deps.calendarService.freeBusy(agent.user, desde, hasta);
      agenda = { desde, hasta, ocupados: unirOcupados(deGoogle, turnos), falla: false };
    } catch (error) {
      if (!(error instanceof CalendarUnavailableError)) throw error;
      logger.error(`No se pudo leer la agenda del usuario ${state.ownerUserId}`, error);
      agenda = { desde, hasta, ocupados: [], falla: true };
    }

    const contexto: ContextoTurno = {
      agent,
      conversation,
      turnoActivo,
      bloqueSistema:
        `${agent.systemPrompt}\n\n${contextoFijo(agent, conversation, state.esPropietario)}\n\n` +
        bloqueDisponibilidad(agent, agenda),
    };

    return {
      contexto,
      agenda,
      pendientes: [],
      indiceDesde: Math.max(state.messages.length - 1, 0),
    };
  };
}
