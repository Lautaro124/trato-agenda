/**
 * Catálogo contra Postgres real (con pgvector y pg_trgm): el full-text, los
 * trigramas, la búsqueda vectorial y el upsert de la importación son SQL que
 * un Prisma de mentira no prueba. Ver test/base-de-prueba.ts.
 */
import { ConflictException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { BusquedaService } from './busqueda.service.js';
import { normalizarTexto } from './catalogo.rules.js';
import { DIMENSIONES_EMBEDDING, type EmbeddingsClient } from './embeddings.client.js';
import { IndexadorService } from './indexador.service.js';
import { ProductosService } from './productos.service.js';

/**
 * Embeddings de mentira pero con geometría: bolsa de palabras en 1536
 * dimensiones, con un sinónimo para probar lo que sólo encuentra el vector
 * ("infusión" no aparece en ningún texto, pero "cae" cerca de "mate").
 */
const SINONIMOS: Record<string, string> = { infusion: 'mate' };

function vectorDe(texto: string): number[] {
  const vector = Array.from({ length: DIMENSIONES_EMBEDDING }, () => 0);
  for (const cruda of normalizarTexto(texto).split(/[^a-z0-9ñ]+/)) {
    if (cruda.length < 3) continue;
    const palabra = SINONIMOS[cruda] ?? cruda;
    let hash = 0;
    for (const letra of palabra) hash = (hash * 31 + letra.charCodeAt(0)) % DIMENSIONES_EMBEDDING;
    vector[hash] += 1;
  }
  return vector;
}

const embeddingsFalsos = {
  configurado: true,
  pedidos: 0,
  async embeber(textos: string[]) {
    this.pedidos++;
    return textos.map(vectorDe);
  },
};

describe.skipIf(!hayBaseDePrueba)('catálogo (Postgres real)', () => {
  let prisma: PrismaService;
  let productos: ProductosService;
  let busqueda: BusquedaService;
  let indexador: IndexadorService;
  let dueno: User;
  let otroDueno: User;

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    const embeddings = embeddingsFalsos as unknown as EmbeddingsClient;
    indexador = new IndexadorService(prisma, embeddings);
    productos = new ProductosService(prisma, indexador);
    busqueda = new BusquedaService(prisma, embeddings);
    dueno = await crearUsuarioDePrueba(prisma);
    otroDueno = await crearUsuarioDePrueba(prisma);

    await productos.importar(
      dueno.id,
      [
        { codigo: 'REM-01-M', nombre: 'Remera básica – Talle M', categoria: 'Remeras', descripcion: 'Algodón peinado', precio: '15.000', stock: '4' },
        { codigo: 'REM-01-L', nombre: 'Remera básica – Talle L', categoria: 'Remeras', descripcion: 'Algodón peinado', precio: '15.000', stock: '0' },
        { codigo: 'MATE-01', nombre: 'Mate de calabaza', categoria: 'Mates', descripcion: 'Curado, con virola de alpaca', precio: '8.000' },
        { codigo: 'BOMB-01', nombre: 'Bombilla de acero', categoria: 'Mates', precio: '3.500', disponible: 'no' },
        { codigo: 'BUZO-01', nombre: 'Buzo canguro', categoria: 'Abrigo', descripcion: 'Frisa', precio: '32.000', stock: '2' },
      ],
      true,
    );
    // Un producto igual de otro comercio: nunca puede aparecer en las búsquedas del primero.
    await productos.importar(otroDueno.id, [{ codigo: 'REM-01', nombre: 'Remera de otro comercio', precio: '1' }], true);
    await indexador.esperar();
    await indexador.pasada();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [dueno.id, otroDueno.id] } } });
    await prisma.$disconnect();
  });

  describe('ABM e importación', () => {
    it('lista con paginado, filtro de categoría y búsqueda sin tildes', async () => {
      const todos = await productos.listar(dueno.id, {});
      expect(todos.total).toBe(5);
      expect(todos.productos.map((producto) => producto.codigo)).toEqual(['BOMB-01', 'BUZO-01', 'MATE-01', 'REM-01-L', 'REM-01-M']);

      const mates = await productos.listar(dueno.id, { categoria: 'mates' });
      expect(mates.productos.map((producto) => producto.codigo)).toEqual(['BOMB-01', 'MATE-01']);

      const algodon = await productos.listar(dueno.id, { q: 'ALGODON' });
      expect(algodon.productos.map((producto) => producto.codigo)).toEqual(['REM-01-L', 'REM-01-M']);
    });

    it('agrupa categorías con su cantidad', async () => {
      expect(await productos.categorias(dueno.id)).toEqual([
        { nombre: 'Abrigo', cantidad: 1 },
        { nombre: 'Mates', cantidad: 2 },
        { nombre: 'Remeras', cantidad: 2 },
      ]);
    });

    it('la vista previa no escribe y cuenta nuevos y actualizados', async () => {
      const resumen = await productos.importar(
        dueno.id,
        [
          { codigo: 'MATE-01', nombre: 'Mate de calabaza', precio: '9.000' },
          { codigo: 'TERMO-01', nombre: 'Termo', precio: '40.000' },
          { codigo: 'MAL', nombre: 'x', precio: '1' },
        ],
        false,
      );
      expect(resumen).toMatchObject({ nuevos: 1, actualizados: 1, totalErrores: 1, confirmado: false });
      expect((await productos.listar(dueno.id, { q: 'termo' })).total).toBe(0);
    });

    it('re-importar actualiza por código el precio y el stock', async () => {
      await productos.importar(
        dueno.id,
        [{ codigo: 'REM-01-M', nombre: 'Remera básica – Talle M', categoria: 'Remeras', precio: '16.000', stock: '4' }],
        true,
      );
      const [remera] = (await productos.listar(dueno.id, { q: 'talle m' })).productos;
      expect(remera).toMatchObject({ codigo: 'REM-01-M', precioCentavos: 1_600_000, stock: 4 });

      // Se vuelve a dejar como estaba para el resto de los specs.
      await productos.importar(
        dueno.id,
        [{ codigo: 'REM-01-M', nombre: 'Remera básica – Talle M', categoria: 'Remeras', descripcion: 'Algodón peinado', precio: '15.000', stock: '4' }],
        true,
      );
      await indexador.esperar();
      await indexador.pasada();
    });

    it('no deja dar de alta dos productos con el mismo código, pero reactiva uno borrado', async () => {
      const dto = { codigo: 'TAZA-01', nombre: 'Taza', precioCentavos: 500_000, stock: 3 };
      const creado = await productos.crear(dueno.id, dto);
      expect(creado).toMatchObject({ codigo: 'TAZA-01', precioCentavos: 500_000, stock: 3 });
      await expect(productos.crear(dueno.id, dto)).rejects.toBeInstanceOf(ConflictException);

      await productos.eliminar(dueno.id, creado.id);
      expect((await productos.listar(dueno.id, { q: 'taza' })).total).toBe(0);
      const reactivado = await productos.crear(dueno.id, { ...dto, nombre: 'Taza grande' });
      expect(reactivado.id).toBe(creado.id);
      expect(reactivado.nombre).toBe('Taza grande');
      await productos.eliminar(dueno.id, creado.id);
    });

    it('guarda la moneda, y al cambiarla borra un descuento de monto fijo en vez de reinterpretarlo', async () => {
      const dto = { codigo: 'CAM-USD', nombre: 'Cámara', precioCentavos: 100_000, stock: 2 };
      const creado = await productos.crear(dueno.id, { ...dto, descuento: { tipo: 'monto', valor: 10_000 } });
      expect(creado).toMatchObject({ moneda: 'ARS', descuento: { tipo: 'monto', etiqueta: '$ 100 off' } });

      // Sin mandar el descuento: el form viejo no lo pisa, pero el monto en pesos no vale en dólares.
      const enDolares = await productos.actualizar(dueno.id, creado.id, { ...dto, moneda: 'USD' });
      expect(enDolares).toMatchObject({ moneda: 'USD', descuento: null });

      const conPorcentaje = await productos.actualizar(dueno.id, creado.id, {
        ...dto,
        moneda: 'USD',
        descuento: { tipo: 'porcentaje', valor: 10 },
      });
      const otraVez = await productos.actualizar(dueno.id, creado.id, { ...dto, moneda: 'ARS' });
      expect(conPorcentaje.descuento).toMatchObject({ tipo: 'porcentaje' });
      expect(otraVez).toMatchObject({ moneda: 'ARS', descuento: { tipo: 'porcentaje' } });

      await productos.eliminar(dueno.id, creado.id);
    });

    it('guarda las cuotas validadas contra el precio, la importación no las pisa y null las borra', async () => {
      const dto = { codigo: 'SIL-CUO', nombre: 'Silla', precioCentavos: 100_000, stock: 2 };
      const cuotas = { modo: 'precios', planes: [{ cuotas: 6, totalCentavos: 120_000 }] };
      const creado = await productos.crear(dueno.id, { ...dto, cuotas });
      expect(creado.cuotas).toEqual(cuotas);

      await expect(
        productos.actualizar(dueno.id, creado.id, { ...dto, cuotas: { modo: 'precios', planes: [{ cuotas: 6, totalCentavos: 90_000 }] } }),
      ).rejects.toThrow('no puede ser menor que el precio');
      await expect(productos.actualizar(dueno.id, creado.id, { ...dto, moneda: 'USD', cuotas })).rejects.toThrow('dólares');

      // Sin el campo (la importación) quedan como estaban.
      expect((await productos.actualizar(dueno.id, creado.id, dto)).cuotas).toEqual(cuotas);
      // Si el precio sube por encima del plan, el plan deja de ofrecerse.
      expect((await productos.actualizar(dueno.id, creado.id, { ...dto, precioCentavos: 130_000 })).cuotas).toBeNull();
      expect((await productos.actualizar(dueno.id, creado.id, { ...dto, cuotas: null })).cuotas).toBeNull();

      await productos.eliminar(dueno.id, creado.id);
    });

    it('edita precio y stock sólo si es del dueño', async () => {
      const [remera] = (await productos.listar(dueno.id, { q: 'talle m' })).productos;
      await expect(productos.actualizarStock(otroDueno.id, remera.id, { stock: 99 })).rejects.toThrow();
      const editado = await productos.actualizarStock(dueno.id, remera.id, { stock: 5 });
      expect(editado.stock).toBe(5);
      await productos.actualizarStock(dueno.id, remera.id, { stock: 4 });
    });

    it('el export de Mercado Libre reconoce lo que ya está por número de publicación u origen, sin duplicar', async () => {
      const vendedor = await crearUsuarioDePrueba(prisma);
      const deMl = (codigo: string, extra: Record<string, string> = {}) => ({
        codigo,
        nombre: `Sillón ${codigo}`,
        precio: '651794.04',
        stock: '30',
        moneda: '$',
        ...extra,
      });
      await productos.crear(vendedor.id, {
        codigo: 'MLA1000000001',
        nombre: 'Sillón por código',
        descripcion: 'Chenille antidesgarro',
        categoria: 'Sillones',
        precioCentavos: 100,
      });
      // Importado por enlace con el código ya usado: quedó "-2" y lo identifica su origen.
      const porEnlace = await productos.crear(vendedor.id, { codigo: 'MLA1000000002-2', nombre: 'Sillón por enlace', precioCentavos: 100 });
      await prisma.producto.update({ where: { id: porEnlace.id }, data: { origenId: 'ml:MLA1000000002' } });

      const filas = [{}, deMl('MLA1000000001'), deMl('MLA1000000002'), deMl('MLA1000000004')];
      const vista = await productos.importar(vendedor.id, filas, false);
      expect(vista).toMatchObject({ nuevos: 1, actualizados: 2, totalErrores: 0 });

      await productos.importar(vendedor.id, filas, true);
      // Volver a subir el mismo archivo no crea nada.
      expect(await productos.importar(vendedor.id, filas, false)).toMatchObject({ nuevos: 0, actualizados: 3 });

      const guardados = await prisma.producto.findMany({ where: { userId: vendedor.id, activo: true }, orderBy: { codigo: 'asc' } });
      expect(guardados.map((producto) => producto.codigo)).toEqual(['MLA1000000001', 'MLA1000000002-2', 'MLA1000000004']);
      // Lo que el export no trae queda como estaba.
      expect(guardados[0]).toMatchObject({ nombre: 'Sillón MLA1000000001', descripcion: 'Chenille antidesgarro', categoria: 'Sillones' });
    });
  });

  describe('indexador', () => {
    it('deja todos los productos activos con su embedding al día', async () => {
      const { productos: lista } = await productos.listar(dueno.id, {});
      expect(lista.every((producto) => producto.indexado)).toBe(true);
    });

    it('un producto editado vuelve a quedar pendiente hasta la próxima pasada', async () => {
      const [buzo] = (await productos.listar(dueno.id, { q: 'buzo' })).productos;
      await productos.actualizar(dueno.id, buzo.id, {
        codigo: 'BUZO-01',
        nombre: 'Buzo canguro con capucha',
        categoria: 'Abrigo',
        descripcion: 'Frisa',
        precioCentavos: 3_200_000,
        stock: 2,
      });
      await indexador.esperar();
      await indexador.pasada();
      expect((await productos.obtener(dueno.id, buzo.id)).indexado).toBe(true);
    });
  });

  describe('búsqueda híbrida', () => {
    const nombres = async (consulta: string, categoria?: string) =>
      (await busqueda.buscar(dueno.id, consulta, { categoria })).map((producto) => producto.nombre);

    it('encuentra por código exacto primero', async () => {
      expect((await nombres('tenés el MATE-01?'))[0]).toBe('Mate de calabaza');
    });

    it('encuentra plurales por stemming', async () => {
      expect(await nombres('remeras')).toContain('Remera básica – Talle M');
    });

    it('tolera errores de tipeo', async () => {
      expect(await nombres('tenes bombiya de acro')).toContain('Bombilla de acero');
    });

    it('encuentra por significado lo que no aparece en ningún texto, marcado como parecido', async () => {
      const [primero] = await busqueda.buscar(dueno.id, 'infusion');
      expect(primero.nombre).toBe('Mate de calabaza');
      expect(primero.soloParecido).toBe(true);
      // Lo que coincide por texto no lleva la marca.
      const [porCodigo] = await busqueda.buscar(dueno.id, 'MATE-01');
      expect(porCodigo.soloParecido).toBeUndefined();
    });

    it('filtra por categoría', async () => {
      const mates = await nombres('calabaza bombilla remera buzo', 'Mates');
      expect([...mates].sort()).toEqual(['Bombilla de acero', 'Mate de calabaza']);
      expect(await nombres('bombilla', 'remeras')).toEqual([]);
    });

    it('nunca devuelve productos de otro comercio ni dados de baja', async () => {
      const resultados = await busqueda.buscar(dueno.id, 'remera de otro comercio');
      expect(resultados.map((producto) => producto.nombre)).not.toContain('Remera de otro comercio');
      expect(await nombres('taza')).not.toContain('Taza grande');
    });

    it('describe el stock de cada producto, descontando reservas', async () => {
      const [talleM] = await busqueda.buscar(dueno.id, 'REM-01-M');
      expect(talleM).toMatchObject({ codigo: 'REM-01-M', precioCentavos: 1_500_000, hayStock: true, stock: 'disponible' });
      const [talleL] = await busqueda.buscar(dueno.id, 'REM-01-L');
      expect(talleL).toMatchObject({ hayStock: false, stock: 'sin stock' });

      const [conReservas] = await busqueda.buscar(dueno.id, 'REM-01-M', {
        reservadas: new Map([[talleM.productoId, 2]]),
      });
      expect(conReservas.stock).toBe('quedan 2 unidades');
    });

    it('una consulta vacía no busca nada', async () => {
      expect(await busqueda.buscar(dueno.id, '  ¿? ')).toEqual([]);
    });
  });

  describe('descuentos', () => {
    it('el del formulario se guarda con el producto, la importación no lo pisa y null lo borra', async () => {
      const dto = {
        codigo: 'TAZA-DTO',
        nombre: 'Taza con descuento',
        precioCentavos: 1_000_000,
        descuento: { tipo: 'porcentaje' as const, valor: 20, desde: null, hasta: '2099-12-31' },
      };
      const creado = await productos.crear(dueno.id, dto);
      expect(creado.descuento).toMatchObject({ alcance: 'producto', tipo: 'porcentaje', valor: 20, activo: true, hasta: '2099-12-31' });
      expect(creado).toMatchObject({ precioCentavos: 1_000_000, precioFinalCentavos: 800_000 });

      await productos.importar(dueno.id, [{ codigo: 'TAZA-DTO', nombre: 'Taza con descuento', precio: '12.000' }], true);
      const reimportado = await productos.obtener(dueno.id, creado.id);
      expect(reimportado).toMatchObject({ precioCentavos: 1_200_000, precioFinalCentavos: 960_000 });

      const sinDescuento = await productos.actualizar(dueno.id, creado.id, { ...dto, descuento: null });
      expect(sinDescuento.descuento).toBeNull();
      expect(await prisma.descuento.count({ where: { productoId: creado.id } })).toBe(0);
      await productos.eliminar(dueno.id, creado.id);
    });

    it('la búsqueda aplica la promo de la categoría y no la de otro comercio', async () => {
      const promos = await prisma.descuento.createManyAndReturn({
        data: [
          { userId: dueno.id, categoria: 'mates', nombre: 'Semana del mate', tipo: 'porcentaje', valor: 10 },
          { userId: otroDueno.id, nombre: 'De otro', tipo: 'porcentaje', valor: 50 },
        ],
      });
      try {
        const [mate] = await busqueda.buscar(dueno.id, 'MATE-01');
        expect(mate).toMatchObject({ precioCentavos: 800_000, precioFinalCentavos: 720_000 });
        expect(mate.descuento).toMatchObject({ etiqueta: '10% off', nombre: 'Semana del mate', alcance: 'categoria' });

        const [buzo] = await busqueda.buscar(dueno.id, 'BUZO-01');
        expect(buzo).toMatchObject({ precioFinalCentavos: buzo.precioCentavos, descuento: null });
      } finally {
        await prisma.descuento.deleteMany({ where: { id: { in: promos.map((promo) => promo.id) } } });
      }
    });
  });
});
