import {
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
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { BusquedaService, type ProductoEncontrado } from './busqueda.service.js';
import { ProductosService, type ListadoProductos } from './productos.service.js';
import {
  ActualizarVarianteDto,
  GuardarProductoDto,
  ImportarProductosDto,
  ListarProductosQuery,
  type ProductoPublico,
  type ResumenImportacion,
} from './productos.types.js';

/** Catálogo del asistente de ventas. Todo va scopeado al usuario de la sesión. */
@Controller('productos')
@UseGuards(JwtAuthGuard)
export class ProductosController {
  constructor(
    private readonly productos: ProductosService,
    private readonly busqueda: BusquedaService,
  ) {}

  @Get()
  listar(@CurrentUser() user: User, @Query() query: ListarProductosQuery): Promise<ListadoProductos> {
    return this.productos.listar(user.id, query);
  }

  @Get('categorias')
  categorias(@CurrentUser() user: User): Promise<Array<{ nombre: string; cantidad: number }>> {
    return this.productos.categorias(user.id);
  }

  /**
   * Lo mismo que ve el asistente cuando un cliente pregunta: le sirve al dueño
   * para probar si su catálogo se encuentra como espera.
   */
  @Get('buscar')
  buscar(@CurrentUser() user: User, @Query() query: ListarProductosQuery): Promise<ProductoEncontrado[]> {
    return this.busqueda.buscar(user.id, query.q ?? '', { categoria: query.categoria });
  }

  @Post('importar')
  @HttpCode(HttpStatus.OK)
  importar(@CurrentUser() user: User, @Body() dto: ImportarProductosDto): Promise<ResumenImportacion> {
    return this.productos.importar(user.id, dto.filas, dto.confirmar);
  }

  @Patch('variantes/:id')
  actualizarVariante(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: ActualizarVarianteDto,
  ): Promise<ProductoPublico> {
    return this.productos.actualizarVariante(user.id, id, dto);
  }

  @Get(':id')
  obtener(@CurrentUser() user: User, @Param('id') id: string): Promise<ProductoPublico> {
    return this.productos.obtener(user.id, id);
  }

  @Post()
  crear(@CurrentUser() user: User, @Body() dto: GuardarProductoDto): Promise<ProductoPublico> {
    return this.productos.crear(user.id, dto);
  }

  @Put(':id')
  actualizar(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: GuardarProductoDto,
  ): Promise<ProductoPublico> {
    return this.productos.actualizar(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  eliminar(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    return this.productos.eliminar(user.id, id);
  }
}
