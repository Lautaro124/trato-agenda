import { describe, expect, it } from 'vitest';
import {
  agruparPorCategoria,
  CATEGORIA_OTROS,
  estadoParaDecidir,
  LARGO_MAX_ESTADO,
  MENSAJES_PARA_DECIDIR,
  ordenarPorProbabilidad,
  productosDeCategoria,
  type ProductoPanorama,
} from './sugerencias.rules.js';

const producto = (nombre: string, categoria: string | null): ProductoPanorama => ({
  productoId: nombre,
  nombre,
  categoria,
  descripcion: '',
  precioDesdeCentavos: 100,
  variosPrecios: false,
});

describe('agruparPorCategoria', () => {
  it('ordena de la que más productos tiene a la que menos, y por nombre a igual cantidad', () => {
    const productos = [
      producto('a', 'Termos'),
      producto('b', 'Mates'),
      producto('c', 'mates'),
      producto('d', 'Bombillas'),
    ];
    expect(agruparPorCategoria(productos)).toEqual([
      { nombre: 'Mates', cantidad: 2 },
      { nombre: 'Bombillas', cantidad: 1 },
      { nombre: 'Termos', cantidad: 1 },
    ]);
  });

  it('los productos sin categoría van a "Otros" sólo si hay otras categorías', () => {
    expect(agruparPorCategoria([producto('a', 'Mates'), producto('b', null), producto('c', '  ')])).toEqual([
      { nombre: CATEGORIA_OTROS, cantidad: 2 },
      { nombre: 'Mates', cantidad: 1 },
    ]);
    expect(agruparPorCategoria([producto('a', null), producto('b', null)])).toEqual([]);
  });
});

describe('productosDeCategoria', () => {
  const productos = [producto('a', 'Remeras'), producto('b', 'Gorras'), producto('c', null)];

  it('compara sin tildes ni mayúsculas', () => {
    expect(productosDeCategoria(productos, ' REMERAS ').map((p) => p.nombre)).toEqual(['a']);
    expect(productosDeCategoria([producto('x', 'Camperas de algodón')], 'camperas de algodon')).toHaveLength(1);
  });

  it('"Otros" son los que no tienen categoría', () => {
    expect(productosDeCategoria(productos, 'otros').map((p) => p.nombre)).toEqual(['c']);
  });

  it('una categoría que no existe no trae nada', () => {
    expect(productosDeCategoria(productos, 'pizzas')).toEqual([]);
  });
});

describe('ordenarPorProbabilidad', () => {
  it('de mayor a menor, y lo que Jev no puntuó queda al final en su orden', () => {
    expect(ordenarPorProbabilidad(['c0', 'c1', 'c2', 'c3'], { c2: 0.6, c1: 0.3, c3: Number.NaN })).toEqual([
      'c2',
      'c1',
      'c0',
      'c3',
    ]);
  });

  it('a igual probabilidad respeta el orden de entrada', () => {
    expect(ordenarPorProbabilidad(['c0', 'c1', 'c2'], { c0: 0.2, c1: 0.4, c2: 0.4 })).toEqual(['c1', 'c2', 'c0']);
  });
});

describe('estadoParaDecidir', () => {
  it('se queda con los últimos mensajes del cliente, en una línea cada uno', () => {
    const mensajes = Array.from({ length: MENSAJES_PARA_DECIDIR + 2 }, (_, indice) => `mensaje\n ${indice}`);
    const estado = estadoParaDecidir(['', ...mensajes]);
    expect(estado.split('\n')).toHaveLength(MENSAJES_PARA_DECIDIR);
    expect(estado.endsWith(`mensaje ${MENSAJES_PARA_DECIDIR + 1}`)).toBe(true);
    expect(estado).not.toContain('mensaje 0');
  });

  it('si se pasa del largo, recorta por el principio: lo último es lo que importa', () => {
    const estado = estadoParaDecidir(['a'.repeat(LARGO_MAX_ESTADO), 'quiero un termo']);
    expect(estado).toHaveLength(LARGO_MAX_ESTADO);
    expect(estado.endsWith('quiero un termo')).toBe(true);
  });
});
