import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { Descuento, Prisma } from '../generated/prisma/client.js';
import { LARGOS, PRECIO_MAX_PESOS } from './catalogo.rules.js';
import {
  alcanceDe,
  diaDeDesde,
  diaDeHasta,
  etiquetaDescuento,
  TIPOS_DESCUENTO,
  type AlcanceDescuento,
  type DescuentoAplicado,
  type DescuentoParaAplicar,
  type TipoDescuento,
} from './descuentos.rules.js';

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Largo máximo del nombre de una promo. */
export const LARGO_NOMBRE_PROMOCION = 60;

/** El descuento del formulario de un producto (dentro de `GuardarProductoDto`). */
export class DescuentoProductoDto {
  @IsIn(TIPOS_DESCUENTO)
  tipo!: TipoDescuento;

  /** Porcentaje (1 a PORCENTAJE_MAX) o centavos; el tope por tipo lo chequea problemaDeDescuento. */
  @IsInt()
  @Min(1)
  @Max(PRECIO_MAX_PESOS * 100)
  valor!: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  /** Primer día de vigencia, "AAAA-MM-DD" en la zona del negocio. null = desde ya. */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @Matches(DIA, { message: 'desde tiene que ser AAAA-MM-DD.' })
  desde?: string | null;

  /** Último día de vigencia (inclusive). null = no vence. */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @Matches(DIA, { message: 'hasta tiene que ser AAAA-MM-DD.' })
  hasta?: string | null;
}

/** Body de `POST /descuentos` y `PUT /descuentos/:id`: una promo de todo el catálogo o de una categoría. */
export class PromocionDto extends DescuentoProductoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(LARGO_NOMBRE_PROMOCION)
  nombre!: string;

  /** null o ausente = todo el catálogo. */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsString()
  @MaxLength(LARGOS.categoria)
  categoria?: string | null;
}

/** Body de `PATCH /descuentos/:id`: pausar o reactivar sin tocar el resto. */
export class ActivarPromocionDto {
  @IsBoolean()
  activo!: boolean;
}

/** Lo que ve el dueño de un descuento. Las fechas vuelven como días, igual que se cargaron. */
export type DescuentoPublico = {
  id: string;
  alcance: AlcanceDescuento;
  nombre: string;
  categoria: string | null;
  tipo: TipoDescuento;
  valor: number;
  activo: boolean;
  desde: string | null;
  hasta: string | null;
  etiqueta: string;
};

export function aDescuentoPublico(descuento: Descuento): DescuentoPublico {
  return {
    id: descuento.id,
    alcance: alcanceDe(descuento),
    nombre: descuento.nombre,
    categoria: descuento.categoria,
    tipo: descuento.tipo as TipoDescuento,
    valor: descuento.valor,
    activo: descuento.activo,
    desde: diaDeDesde(descuento.desde),
    hasta: diaDeHasta(descuento.hasta),
    etiqueta: etiquetaDescuento(descuento),
  };
}

/** El descuento que le toca a una variante, como lo ven el panel y la prueba de búsqueda. */
export type DescuentoDeVariante = Pick<DescuentoAplicado, 'alcance' | 'etiqueta' | 'nombre' | 'hastaDia' | 'descuentoCentavos'>;

export function aDescuentoDeVariante(aplicado: DescuentoAplicado | null): DescuentoDeVariante | null {
  if (!aplicado) return null;
  return {
    alcance: aplicado.alcance,
    etiqueta: aplicado.etiqueta,
    nombre: aplicado.nombre,
    hastaDia: aplicado.hastaDia,
    descuentoCentavos: aplicado.descuentoCentavos,
  };
}

type LectorDeDescuentos = { descuento: Pick<Prisma.TransactionClient['descuento'], 'findMany'> };

/**
 * Los descuentos activos que pueden tocarle a estos productos: los propios de
 * cada uno y las promos de la cuenta. La vigencia por fecha y la categoría se
 * resuelven en mejorDescuento, en código. Sirve dentro de una transacción.
 */
export function descuentosActivos(
  db: LectorDeDescuentos,
  userId: string,
  productoIds: string[],
): Promise<DescuentoParaAplicar[]> {
  return db.descuento.findMany({
    where: {
      userId,
      activo: true,
      OR: [{ productoId: null }, ...(productoIds.length > 0 ? [{ productoId: { in: productoIds } }] : [])],
    },
    orderBy: { id: 'asc' },
  });
}
