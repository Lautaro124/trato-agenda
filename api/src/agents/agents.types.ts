import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { Agent } from '../generated/prisma/client.js';
import {
  TIPOS_TITULAR,
  TIPOS_USO,
  tipoAsistenteDe,
  type TipoAsistente,
  type TipoTitular,
  type TipoUso,
} from './agent-catalog.js';
import { PRECIO_MAX } from './precio.js';
import {
  LARGO_MAX_ETIQUETA,
  LARGO_MIN_ETIQUETA,
  leerConfigDatosCliente,
  MAX_CAMPOS,
  TIPOS_CAMPO,
  type CampoCliente,
  type TipoCampo,
} from '../comercio/datos-cliente.rules.js';
import { leerMensajes, MODOS_MENSAJE, type MensajesAgente, type ModoMensaje } from './mensajes.rules.js';
import {
  DIAS_SEMANA,
  LARGO_MAX_DIRECCION,
  LARGO_MAX_ENLACE,
  LARGO_MIN_DIRECCION,
  leerLocal,
  MAX_FRANJAS,
  type DiaSemana,
  type LocalPresencial,
} from './local.js';

/** "HH:MM" en formato 24hs. */
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Un tipo de turno del paso 3 de /contanos, con su duración por defecto. */
export class TipoEventoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nombre!: string;

  @IsInt()
  @Min(5)
  @Max(480)
  duracionMin!: number;

  /** Pesos enteros. Sin precio el asistente deriva la consulta al titular. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRECIO_MAX)
  precio?: number;
}

export class GenerateAgentDto {
  @IsIn(TIPOS_TITULAR)
  tipoTitular!: TipoTitular;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  nombreTitular!: string;

  @IsIn(TIPOS_USO)
  tipoUso!: TipoUso;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TipoEventoDto)
  tiposEvento!: TipoEventoDto[];

  @Matches(HORA_HHMM, { message: 'horaDesde tiene que ser "HH:MM" en formato 24hs.' })
  horaDesde!: string;

  @Matches(HORA_HHMM, { message: 'horaHasta tiene que ser "HH:MM" en formato 24hs.' })
  horaHasta!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  nombreBot!: string;
}

/** Un dato que el asistente de ventas le pide al cliente (datos-cliente.rules.ts). */
export class CampoClienteDto {
  @IsIn(TIPOS_CAMPO)
  tipo!: TipoCampo;

  /** Sólo para los personalizados: la de los estándar es fija. */
  @ValidateIf((campo: CampoClienteDto) => campo.tipo === 'personalizado')
  @IsString()
  @MinLength(LARGO_MIN_ETIQUETA)
  @MaxLength(LARGO_MAX_ETIQUETA)
  etiqueta?: string;

  @IsBoolean()
  obligatorio!: boolean;
}

/** Una franja de atención del local: un día y su horario. */
export class FranjaLocalDto {
  @IsIn(DIAS_SEMANA)
  dia!: DiaSemana;

  @Matches(HORA_HHMM)
  desde!: string;

  @Matches(HORA_HHMM)
  hasta!: string;
}

/**
 * El local a la calle de un comercio. Que cierre después de abrir y que las
 * franjas de un día no se pisen lo mira normalizarLocal (local.ts).
 */
export class LocalPresencialDto {
  @IsBoolean()
  tieneLocal!: boolean;

  @IsOptional()
  @IsString()
  @MinLength(LARGO_MIN_DIRECCION)
  @MaxLength(LARGO_MAX_DIRECCION)
  direccion?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(LARGO_MAX_ENLACE)
  enlaceUbicacion?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FRANJAS)
  @ValidateNested({ each: true })
  @Type(() => FranjaLocalDto)
  horarios?: FranjaLocalDto[];

  @IsOptional()
  @IsBoolean()
  retiroEnLocal?: boolean;
}

/** Body de `POST /agents/generate-ventas`: el onboarding del asistente de ventas. */
export class GenerarAgenteVentasDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  nombreTitular!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  nombreBot!: string;

  /** Paso opcional del onboarding: sin esto el asistente sólo pide el nombre. */
  @IsOptional()
  @IsBoolean()
  haceEnvios?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CAMPOS)
  @ValidateNested({ each: true })
  @Type(() => CampoClienteDto)
  datosCliente?: CampoClienteDto[];

  /** El paso "Tu local". Sin él (un cliente viejo de la API) el local queda sin cargar. */
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalPresencialDto)
  local?: LocalPresencialDto;
}

/** Body de `PUT /agents/me/datos-cliente`: reemplaza la configuración entera. */
export class ActualizarDatosClienteDto {
  @IsBoolean()
  haceEnvios!: boolean;

  @IsArray()
  @ArrayMaxSize(MAX_CAMPOS)
  @ValidateNested({ each: true })
  @Type(() => CampoClienteDto)
  datosCliente!: CampoClienteDto[];
}

/** Body de `PUT /agents/me/local`: reemplaza los datos del local enteros. */
export class ActualizarLocalDto {
  @ValidateNested()
  @Type(() => LocalPresencialDto)
  local!: LocalPresencialDto;
}

/** Body de `PUT /agents/me/tipos-evento`: reemplaza la lista entera de tipos de turno. */
export class ActualizarTiposEventoDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TipoEventoDto)
  tiposEvento!: TipoEventoDto[];
}

/** Un mensaje de /asistente. El largo fino (400 después de recortar) lo mira normalizarMensajes. */
export class MensajeDto {
  @IsIn(MODOS_MENSAJE)
  modo!: ModoMensaje;

  @IsString()
  @MaxLength(1000)
  texto!: string;
}

/**
 * Body de `PUT /agents/me/mensajes`: los mensajes que el dueño escribió a mano.
 * Una propiedad por clave de CLAVES_MENSAJE; la que no viene no se toca.
 */
export class ActualizarMensajesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => MensajeDto)
  saludo?: MensajeDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MensajeDto)
  linkPago?: MensajeDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MensajeDto)
  sinProductos?: MensajeDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MensajeDto)
  pagoAprobado?: MensajeDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MensajeDto)
  horarioOcupado?: MensajeDto;
}

/** Vista pública del agente: nunca incluye el systemPrompt (config interna del bot). */
export type AgentPublico = Pick<
  Agent,
  | 'id'
  | 'tipoUso'
  | 'descripcion'
  | 'tipoTitular'
  | 'nombreTitular'
  | 'nombreBot'
  | 'horaDesde'
  | 'horaHasta'
  | 'allowedActions'
  | 'createdAt'
  | 'updatedAt'
  | 'haceEnvios'
> & {
  tiposEvento: TipoEvento[];
  tipoAsistente: TipoAsistente;
  mensajes: MensajesAgente;
  local: LocalPresencial | null;
  datosCliente: CampoCliente[];
};

export function aAgentPublico(agent: Agent): AgentPublico {
  return {
    id: agent.id,
    tipoUso: agent.tipoUso,
    tipoAsistente: tipoAsistenteDe(agent),
    descripcion: agent.descripcion,
    tipoTitular: agent.tipoTitular,
    nombreTitular: agent.nombreTitular,
    nombreBot: agent.nombreBot,
    horaDesde: agent.horaDesde,
    horaHasta: agent.horaHasta,
    tiposEvento: leerTiposEvento(agent),
    haceEnvios: agent.haceEnvios,
    datosCliente: leerConfigDatosCliente(agent).campos,
    mensajes: leerMensajes(agent),
    local: leerLocal(agent),
    allowedActions: agent.allowedActions,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

export type TipoEvento = { nombre: string; duracionMin: number; precio?: number };

/**
 * `Agent.tiposEvento` es una columna Json, así que Prisma la tipa como
 * `JsonValue`: hay que validar la forma antes de usarla en vez de castear.
 */
export function leerTiposEvento(agent: Pick<Agent, 'tiposEvento'>): TipoEvento[] {
  if (!Array.isArray(agent.tiposEvento)) return [];
  return agent.tiposEvento.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const { nombre, duracionMin, precio } = item as Record<string, unknown>;
    if (typeof nombre !== 'string' || typeof duracionMin !== 'number') return [];
    // `precio` es opcional y llega de un Json: uno inválido se descarta, no rompe el tipo de turno.
    const precioValido = typeof precio === 'number' && Number.isFinite(precio) && precio >= 0;
    return [precioValido ? { nombre, duracionMin, precio } : { nombre, duracionMin }];
  });
}
