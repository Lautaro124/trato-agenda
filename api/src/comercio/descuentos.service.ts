import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MAX_PROMOCIONES } from './descuentos.rules.js';
import { aDescuentoPublico, type DescuentoPublico, type PromocionDto } from './descuentos.types.js';
import { descuentoDesdeDto } from './productos.service.js';

/**
 * Las promos de la cuenta: de todo el catálogo o de una categoría. Los
 * descuentos propios de cada producto se guardan con el producto
 * (ProductosService) y no pasan por acá.
 */
@Injectable()
export class DescuentosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(userId: string): Promise<DescuentoPublico[]> {
    const promociones = await this.prisma.descuento.findMany({
      where: { userId, productoId: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return promociones.map(aDescuentoPublico);
  }

  async crear(userId: string, dto: PromocionDto): Promise<DescuentoPublico> {
    const datos = desdePromocionDto(dto);
    const cantidad = await this.prisma.descuento.count({ where: { userId, productoId: null } });
    if (cantidad >= MAX_PROMOCIONES) {
      throw new ConflictException(`Llegaste al máximo de ${MAX_PROMOCIONES} promociones: borrá alguna que ya no uses.`);
    }
    return aDescuentoPublico(await this.prisma.descuento.create({ data: { userId, ...datos } }));
  }

  async actualizar(userId: string, id: string, dto: PromocionDto): Promise<DescuentoPublico> {
    return this.escribirPropia(userId, id, desdePromocionDto(dto));
  }

  async activar(userId: string, id: string, activo: boolean): Promise<DescuentoPublico> {
    return this.escribirPropia(userId, id, { activo });
  }

  async eliminar(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.descuento.deleteMany({ where: { id, userId, productoId: null } });
    if (count === 0) throw new NotFoundException('No existe esa promoción.');
  }

  /**
   * Sólo promos de esta cuenta: el filtro va en la misma escritura, así el
   * descuento de un producto o la promo de otro nunca se tocan desde acá.
   */
  private async escribirPropia(userId: string, id: string, data: Prisma.DescuentoUpdateManyMutationInput): Promise<DescuentoPublico> {
    const { count } = await this.prisma.descuento.updateMany({ where: { id, userId, productoId: null }, data });
    if (count === 0) throw new NotFoundException('No existe esa promoción.');
    return aDescuentoPublico(await this.prisma.descuento.findUniqueOrThrow({ where: { id } }));
  }
}

function desdePromocionDto(dto: PromocionDto) {
  return {
    ...descuentoDesdeDto(dto),
    nombre: dto.nombre.trim(),
    categoria: dto.categoria?.trim() || null,
  };
}
