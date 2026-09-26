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
        { codigo: 'REM-01', nombre: 'Remera básica', categoria: 'Remeras', descripcion: 'Algodón peinado', variante: 'Talle M', precio: '15.000', stock: '4' },
        { codigo: 'REM-01', nombre: 'Remera básica', variante: 'Talle L', precio: '15.000', stock: '0' },
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
      expect(todos.total).toBe(4);
      expect(todos.productos.map((producto) => producto.codigo)).toEqual(['BOMB-01', 'BUZO-01', 'MATE-01', 'REM-01']);

      const mates = await productos.listar(dueno.id, { categoria: 'mates' });
      expect(mates.productos.map((producto) => producto.codigo)).toEqual(['BOMB-01', 'MATE-01']);

      const algodon = await productos.listar(dueno.id, { q: 'ALGODON' });
      expect(algodon.productos.map((producto) => producto.codigo)).toEqual(['REM-01']);
    });

    it('agrupa categorías con su cantidad', async () => {
      expect(await productos.categorias(dueno.id)).toEqual([
        { nombre: 'Abrigo', cantidad: 1 },
        { nombre: 'Mates', cantidad: 2 },
        { nombre: 'Remeras', cantidad: 1 },
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
      expect(resumen).toMatchObject({ nuevos: 1, actualizados: 1, variantes: 2, totalErrores: 1, confirmado: false });
      expect((await productos.listar(dueno.id, { q: 'termo' })).total).toBe(0);
    });

    it('re-importar actualiza por código y desactiva las variantes que ya no vienen', async () => {
      await productos.importar(
        dueno.id,
        [{ codigo: 'REM-01', nombre: 'Remera básica', categoria: 'Remeras', variante: 'Talle M', precio: '16.000', stock: '4' }],
        true,
      );
      const [remera] = (await productos.listar(dueno.id, { q: 'remera' })).productos;
      expect(remera.variantes).toHaveLength(1);
      expect(remera.variantes[0]).toMatchObject({ nombre: 'Talle M', precioCentavos: 1_600_000, stock: 4 });

      // Se vuelve a dejar como estaba para el resto de los specs.
      await productos.importar(
        dueno.id,
        [
          { codigo: 'REM-01', nombre: 'Remera básica', categoria: 'Remeras', descripcion: 'Algodón peinado', variante: 'Talle M', precio: '15.000', stock: '4' },
          { codigo: 'REM-01', nombre: 'Remera básica', variante: 'Talle L', precio: '15.000', stock: '0' },
        ],
        true,
      );
      await indexador.esperar();
      await indexador.pasada();
    });

    it('no deja dar de alta dos productos con el mismo código, pero reactiva uno borrado', async () => {
      const dto = { codigo: 'TAZA-01', nombre: 'Taza', variantes: [{ precioCentavos: 500_000, stock: 3 }] };
      const creado = await productos.crear(dueno.id, dto);
      expect(creado.variantes[0].sku).toBe('TAZA-01');
      await expect(productos.crear(dueno.id, dto)).rejects.toBeInstanceOf(ConflictException);

      await productos.eliminar(dueno.id, creado.id);
      expect((await productos.listar(dueno.id, { q: 'taza' })).total).toBe(0);
      const reactivado = await productos.crear(dueno.id, { ...dto, nombre: 'Taza grande' });
      expect(reactivado.id).toBe(creado.id);
      expect(reactivado.nombre).toBe('Taza grande');
      await productos.eliminar(dueno.id, creado.id);
    });

    it('edita una variante sólo si es del dueño', async () => {
      const [remera] = (await productos.listar(dueno.id, { q: 'remera' })).productos;
      const talleM = remera.variantes.find((variante) => variante.nombre === 'Talle M')!;
      await expect(productos.actualizarVariante(otroDueno.id, talleM.id, { stock: 99 })).rejects.toThrow();
      const editado = await productos.actualizarVariante(dueno.id, talleM.id, { stock: 5 });
      expect(editado.variantes.find((variante) => variante.id === talleM.id)?.stock).toBe(5);
      await productos.actualizarVariante(dueno.id, talleM.id, { stock: 4 });
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
        variantes: [{ precioCentavos: 3_200_000, stock: 2 }],
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
      expect(await nombres('remeras')).toContain('Remera básica');
    });

    it('tolera errores de tipeo', async () => {
      expect(await nombres('tenes bombiya de acro')).toContain('Bombilla de acero');
    });

    it('encuentra por significado lo que no aparece en ningún texto', async () => {
      expect((await nombres('infusion'))[0]).toBe('Mate de calabaza');
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

    it('describe el stock de cada variante, descontando reservas', async () => {
      const [remera] = await busqueda.buscar(dueno.id, 'REM-01');
      const talleM = remera.variantes.find((variante) => variante.nombre === 'Talle M')!;
      expect(talleM).toMatchObject({ precioCentavos: 1_500_000, hayStock: true, stock: 'disponible' });
      expect(remera.variantes.find((variante) => variante.nombre === 'Talle L')).toMatchObject({
        hayStock: false,
        stock: 'sin stock',
      });

      const [conReservas] = await busqueda.buscar(dueno.id, 'REM-01', {
        reservadas: new Map([[talleM.varianteId, 2]]),
      });
      expect(conReservas.variantes.find((variante) => variante.nombre === 'Talle M')?.stock).toBe('quedan 2 unidades');
    });

    it('una consulta vacía no busca nada', async () => {
      expect(await busqueda.buscar(dueno.id, '  ¿? ')).toEqual([]);
    });
  });
});
