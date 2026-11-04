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
import { ImagenesService, type FotoDeProducto, type ImagenGuardada, type UsoDeImagenes } from './imagenes.service.js';
import { ProductosService, type ListadoProductos } from './productos.service.js';
import {
  ActualizarStockDto,
  GuardarProductoDto,
  ImportarProductosDto,
  ListarProductosQuery,
  type ProductoPublico,
  type ResumenImportacion,
} from './productos.types.js';

/** Una sola foto por pedido, en memoria y con el tope de peso de la API. */
const SUBIDA_DE_FOTO = FileInterceptor('imagen', { limits: { fileSize: MAX_BYTES_SUBIDA, files: 1, fields: 0, parts: 1 } });

function bufferDe(archivo: { buffer: Buffer } | undefined): Buffer {
  if (!archivo) throw new UnprocessableEntityException('Falta la foto.');
  return archivo.buffer;
}

/** Siempre es un JPEG que generó la API: nunca se sirve lo que subió el dueño. */
function jpeg(datos: Buffer): StreamableFile {
  return new StreamableFile(datos, { type: 'image/jpeg', length: datos.length });
}

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

  /** La edición rápida de precio y stock desde la tarjeta del catálogo. */
  @Patch(':id/stock')
  actualizarStock(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: ActualizarStockDto,
  ): Promise<ProductoPublico> {
    return this.productos.actualizarStock(user.id, id, dto);
  }

  /**
   * Sube (o reemplaza) la foto principal del producto. Multer la lee en
   * memoria con su propio tope de peso; el formato se valida por contenido y
   * se recomprime en ImagenesService, nunca se guarda el archivo tal como llegó.
   */
  @Put(':id/imagen')
  @UseInterceptors(SUBIDA_DE_FOTO)
  subirImagen(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @UploadedFile() archivo: { buffer: Buffer } | undefined,
  ): Promise<ImagenGuardada> {
    return this.imagenes.guardarPrincipal(user.id, id, bufferDe(archivo));
  }

  /** La principal. La web le agrega `?v=<imagenActualizada>`, así que cachearla un rato no muestra una vieja. */
  @Get(':id/imagen')
  @Header('Cache-Control', 'private, max-age=300')
  async imagen(@CurrentUser() user: User, @Param('id') id: string): Promise<StreamableFile> {
    return jpeg(await this.imagenes.obtener(user.id, id));
  }

  /** Quita la principal: la siguiente pasa a serlo. */
  @Delete(':id/imagen')
  @HttpCode(HttpStatus.NO_CONTENT)
  quitarImagen(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    return this.imagenes.quitarPrincipal(user.id, id);
  }

  /** Suma una foto al final (la primera queda como principal). Devuelve todas, en orden. */
  @Post(':id/imagenes')
  @UseInterceptors(SUBIDA_DE_FOTO)
  agregarImagen(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @UploadedFile() archivo: { buffer: Buffer } | undefined,
  ): Promise<FotoDeProducto[]> {
    return this.imagenes.agregar(user.id, id, bufferDe(archivo));
  }

  @Put(':id/imagenes/:imagenId')
  @UseInterceptors(SUBIDA_DE_FOTO)
  reemplazarImagen(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('imagenId') imagenId: string,
    @UploadedFile() archivo: { buffer: Buffer } | undefined,
  ): Promise<FotoDeProducto[]> {
    return this.imagenes.reemplazar(user.id, id, imagenId, bufferDe(archivo));
  }

  @Post(':id/imagenes/:imagenId/principal')
  @HttpCode(HttpStatus.OK)
  hacerPrincipal(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('imagenId') imagenId: string,
  ): Promise<FotoDeProducto[]> {
    return this.imagenes.hacerPrincipal(user.id, id, imagenId);
  }

  @Get(':id/imagenes/:imagenId')
  @Header('Cache-Control', 'private, max-age=300')
  async imagenPorId(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('imagenId') imagenId: string,
  ): Promise<StreamableFile> {
    return jpeg(await this.imagenes.obtener(user.id, id, imagenId));
  }

  @Delete(':id/imagenes/:imagenId')
  quitarImagenPorId(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('imagenId') imagenId: string,
  ): Promise<FotoDeProducto[]> {
    return this.imagenes.quitar(user.id, id, imagenId);
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
