import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { BusquedaService, type ProductoEncontrado } from './busqueda.service.js';
import { MAX_BYTES_SUBIDA } from './imagenes.rules.js';
import { ImagenesService, type ImagenGuardada, type UsoDeImagenes } from './imagenes.service.js';
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
    private readonly imagenes: ImagenesService,
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

  /** Cuántos productos tienen foto y cuántos pueden tener. */
  @Get('imagenes/uso')
  usoDeImagenes(@CurrentUser() user: User): Promise<UsoDeImagenes> {
    return this.imagenes.uso(user.id);
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

  /**
   * Sube (o reemplaza) la foto del producto. Multer la lee en memoria con su
   * propio tope de peso; el formato se valida por contenido y se recomprime
   * en ImagenesService, nunca se guarda el archivo tal como llegó.
   */
  @Put(':id/imagen')
  @UseInterceptors(
    FileInterceptor('imagen', { limits: { fileSize: MAX_BYTES_SUBIDA, files: 1, fields: 0, parts: 1 } }),
  )
  subirImagen(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @UploadedFile() archivo: { buffer: Buffer } | undefined,
  ): Promise<ImagenGuardada> {
    if (!archivo) throw new UnprocessableEntityException('Falta la foto.');
    return this.imagenes.guardar(user.id, id, archivo.buffer);
  }

  /** La web le agrega `?v=<imagenActualizada>`, así que cachearla un rato no muestra una vieja. */
  @Get(':id/imagen')
  @Header('Cache-Control', 'private, max-age=300')
  async imagen(@CurrentUser() user: User, @Param('id') id: string): Promise<StreamableFile> {
    const datos = await this.imagenes.obtener(user.id, id);
    // Siempre es un JPEG que generó la API: nunca se sirve lo que subió el dueño.
    return new StreamableFile(datos, { type: 'image/jpeg', length: datos.length });
  }

  @Delete(':id/imagen')
  @HttpCode(HttpStatus.NO_CONTENT)
  quitarImagen(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    return this.imagenes.borrar(user.id, id);
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
