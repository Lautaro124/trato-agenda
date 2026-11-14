import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import type { Ubicacion } from './geo/catalogo.js';
import {
  ACCIONES_SIN_TARIFA,
  DIAS_DESPACHO,
  ESTADOS_ZONA,
  LARGO_MAX_INSTRUCCIONES,
  LARGO_MAX_NOMBRE_ZONA,
  MAX_COBERTURAS,
  MAX_DIAS_PLAZO,
  MAX_IMPORTE_CENTAVOS,
  MONEDAS_ENVIO,
  NIVELES,
  PAISES_ENVIO,
  type Conflicto,
  type DatosZona,
  type EstadoZona,
  type Nivel,
} from './envios.rules.js';
import {
  EnviosService,
  ZonaInvalidaError,
  type ConfiguracionEnviosVista,
  type ConsultaSinResolverVista,
  type ZonaVista,
} from './envios.service.js';

export class ConfiguracionEnviosDto {
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsIn(PAISES_ENVIO)
  pais?: string;

  @IsOptional()
  @IsIn(MONEDAS_ENVIO)
  moneda?: string;

  @IsOptional()
  @IsIn(ACCIONES_SIN_TARIFA)
  sinTarifa?: string;
}

const ID_GEOREF = /^\d{2,12}$/;

export class CoberturaDto {
  @IsIn(NIVELES)
  nivel!: Nivel;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(ID_GEOREF)
  provinciaId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(ID_GEOREF)
  localidadId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{4}$/)
  cp?: string | null;
}

const IMPORTE = [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null), IsInt(), Min(0), Max(MAX_IMPORTE_CENTAVOS)];
const DIAS = [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null), IsInt(), Min(0), Max(MAX_DIAS_PLAZO)];
function aplicar(decoradores: PropertyDecorator[]): PropertyDecorator {
  return (objetivo, propiedad) => decoradores.forEach((d) => d(objetivo, propiedad));
}

/** Los topes y tipos; la forma completa la valida validarZona (envios.rules.ts). */
export class ZonaDto {
  @IsString()
  @MaxLength(LARGO_MAX_NOMBRE_ZONA * 2)
  nombre!: string;

  @IsBoolean()
  activa!: boolean;

  @IsIn(ESTADOS_ZONA)
  estado!: EstadoZona;

  @IsBoolean()
  domicilio!: boolean;

  @IsBoolean()
  sucursal!: boolean;

  @aplicar(IMPORTE) tarifaDomicilioCentavos?: number | null;
  @aplicar(IMPORTE) tarifaSucursalCentavos?: number | null;
  @aplicar(IMPORTE) gratisDesdeCentavos?: number | null;
  @aplicar(DIAS) preparacionDias?: number | null;
  @aplicar(DIAS) transporteDesdeDias?: number | null;
  @aplicar(DIAS) transporteHastaDias?: number | null;

  @IsArray()
  @ArrayMaxSize(DIAS_DESPACHO.length)
  @IsIn(DIAS_DESPACHO, { each: true })
  diasDespacho!: string[];

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(LARGO_MAX_INSTRUCCIONES)
  instrucciones?: string | null;

  @IsArray()
  @ArrayMaxSize(MAX_COBERTURAS)
  @ValidateNested({ each: true })
  @Type(() => CoberturaDto)
  coberturas!: CoberturaDto[];
}

export class ActivaDto {
  @IsBoolean()
  activa!: boolean;
}

function datosDe(dto: ZonaDto): DatosZona {
  return {
    nombre: dto.nombre,
    activa: dto.activa,
    estado: dto.estado,
    domicilio: dto.domicilio,
    sucursal: dto.sucursal,
    tarifaDomicilioCentavos: dto.tarifaDomicilioCentavos ?? null,
    tarifaSucursalCentavos: dto.tarifaSucursalCentavos ?? null,
    gratisDesdeCentavos: dto.gratisDesdeCentavos ?? null,
    preparacionDias: dto.preparacionDias ?? null,
    transporteDesdeDias: dto.transporteDesdeDias ?? null,
    transporteHastaDias: dto.transporteHastaDias ?? null,
    diasDespacho: dto.diasDespacho,
    instrucciones: dto.instrucciones ?? null,
    coberturas: dto.coberturas.map((c) => ({
      nivel: c.nivel,
      provinciaId: c.provinciaId ?? null,
      localidadId: c.localidadId ?? null,
      cp: c.cp ?? null,
    })),
  };
}

async function conErrores<T>(accion: () => Promise<T>): Promise<T> {
  try {
    return await accion();
  } catch (error) {
    if (error instanceof ZonaInvalidaError) throw new BadRequestException(error.message);
    throw error;
  }
}

/** Configuración y zonas del módulo de envíos (LAU-102). El probador está en probador-envios.controller.ts. */
@Controller('envios')
@UseGuards(JwtAuthGuard)
export class EnviosController {
  constructor(private readonly envios: EnviosService) {}

  @Get('configuracion')
  configuracion(@CurrentUser() user: User): Promise<ConfiguracionEnviosVista> {
    return this.envios.configuracion(user.id);
  }

  @Put('configuracion')
  guardarConfiguracion(@CurrentUser() user: User, @Body() dto: ConfiguracionEnviosDto): Promise<ConfiguracionEnviosVista> {
    return conErrores(() => this.envios.guardarConfiguracion(user.id, dto));
  }

  @Get('zonas')
  zonas(@CurrentUser() user: User): Promise<ZonaVista[]> {
    return this.envios.listarZonas(user.id);
  }

  @Post('zonas')
  crearZona(@CurrentUser() user: User, @Body() dto: ZonaDto): Promise<{ zona: ZonaVista; conflictos: Conflicto[] }> {
    return conErrores(() => this.envios.guardarZona(user.id, null, datosDe(dto)));
  }

  @Put('zonas/:id')
  editarZona(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: ZonaDto,
  ): Promise<{ zona: ZonaVista; conflictos: Conflicto[] }> {
    return conErrores(() => this.envios.guardarZona(user.id, id, datosDe(dto)));
  }

  @Patch('zonas/:id/activa')
  cambiarActiva(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: ActivaDto,
  ): Promise<{ zona: ZonaVista; conflictos: Conflicto[] }> {
    return this.envios.cambiarActiva(user.id, id, dto.activa);
  }

  @Delete('zonas/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  eliminarZona(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    return this.envios.eliminarZona(user.id, id);
  }

  @Get('conflictos')
  conflictos(@CurrentUser() user: User): Promise<Conflicto[]> {
    return this.envios.conflictos(user.id);
  }

  @Get('ubicaciones')
  ubicaciones(@Query('q') q: unknown): Ubicacion[] {
    return this.envios.ubicaciones(typeof q === 'string' ? q : '');
  }

  @Get('sin-resolver')
  sinResolver(@CurrentUser() user: User): Promise<ConsultaSinResolverVista[]> {
    return this.envios.sinResolver(user.id);
  }
}
