import { describe, expect, it } from 'vitest';
import {
  agruparFilasImportacion,
  consultaTsquery,
  describirStock,
  formatearCentavos,
  fusionarRankings,
  hashTexto,
  hayStock,
  normalizarColumna,
  normalizarTexto,
  parsearPrecio,
  skuPorDefecto,
  stockBajo,
  textoBusquedaDe,
  unidadesDisponibles,
} from './catalogo.rules.js';

describe('normalizarTexto', () => {
  it('saca tildes, pasa a minúsculas y colapsa espacios', () => {
    expect(normalizarTexto('  Café   CON  Leche ')).toBe('cafe con leche');
  });

  it('conserva la ñ (año no es ano)', () => {
    expect(normalizarTexto('AÑO Ñandú')).toBe('año ñandu');
  });
});

describe('textoBusquedaDe', () => {
  it('junta nombre, categoría, descripción, código y variantes normalizados', () => {
    const texto = textoBusquedaDe({
      codigo: 'REM-01',
      nombre: 'Remera Básica',
      descripcion: 'Algodón peinado',
      categoria: 'Remeras',
      variantes: [
        { sku: 'REM-01-M', nombre: 'Talle M' },
        { sku: 'REM-01-L', nombre: '' },
      ],
    });
    expect(texto).toBe('remera basica | remeras | algodon peinado | rem-01 | talle m | rem-01-m | rem-01-l');
  });

  it('omite la categoría y la descripción vacías', () => {
    expect(
      textoBusquedaDe({ codigo: 'A1', nombre: 'Mate', descripcion: '', categoria: null, variantes: [{ sku: 'A1', nombre: '' }] }),
    ).toBe('mate | a1 | a1');
  });
});

describe('hashTexto', () => {
  it('es el md5 hex (el mismo que md5() de Postgres)', () => {
    expect(hashTexto('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hashTexto('mate')).toHaveLength(32);
  });
});

describe('stock', () => {
  const conCantidad = { stock: 5, disponible: true, activo: true };
  const sinControl = { stock: null, disponible: true, activo: true };

  it('descuenta las reservas y nunca da negativo', () => {
    expect(unidadesDisponibles(conCantidad, 2)).toBe(3);
    expect(unidadesDisponibles(conCantidad, 9)).toBe(0);
    expect(unidadesDisponibles(sinControl, 9)).toBeNull();
  });

  it('sin control de cantidad manda el switch', () => {
    expect(hayStock(sinControl, 100)).toBe(true);
    expect(hayStock({ ...sinControl, disponible: false })).toBe(false);
  });

  it('una variante inactiva nunca tiene stock', () => {
    expect(hayStock({ ...conCantidad, activo: false })).toBe(false);
    expect(describirStock({ ...sinControl, activo: false })).toBe('sin stock');
  });

  it('exige la cantidad pedida', () => {
    expect(hayStock(conCantidad, 5)).toBe(true);
    expect(hayStock(conCantidad, 6)).toBe(false);
    expect(hayStock(conCantidad, 3, 3)).toBe(false);
  });

  it('describe sin revelar la cantidad salvo cuando quedan pocas', () => {
    expect(describirStock({ ...conCantidad, stock: 50 })).toBe('disponible');
    expect(describirStock(conCantidad, 2)).toBe('quedan 3 unidades');
    expect(describirStock(conCantidad, 4)).toBe('queda 1 unidad');
    expect(describirStock(conCantidad, 5)).toBe('sin stock');
    expect(describirStock(sinControl)).toBe('disponible');
  });

  it('stock bajo sólo con mínimo definido', () => {
    expect(stockBajo({ stock: 2, stockMinimo: 2 })).toBe(true);
    expect(stockBajo({ stock: 3, stockMinimo: 2 })).toBe(false);
    expect(stockBajo({ stock: 0, stockMinimo: null })).toBe(false);
    expect(stockBajo({ stock: null, stockMinimo: 2 })).toBe(false);
  });
});

describe('precios', () => {
  it.each([
    ['1500', 150_000],
    ['1.500', 150_000],
    ['1.500,50', 150_050],
    ['1,500.50', 150_050],
    ['$ 1500.5', 150_050],
    ['1,5', 150],
    ['1,500', 150_000],
    ['12.345.678', 1_234_567_800],
    ['10.123', 1_012_300],
    ['0', 0],
    ['ARS 990', 99_000],
  ])('parsea "%s"', (texto, centavos) => {
    expect(parsearPrecio(texto)).toBe(centavos);
  });

  it.each(['', 'gratis', '-10', '1,234,5', '1.5.5,3', '12,34.5', '1e5', '999999999999'])('rechaza "%s"', (texto) => {
    expect(parsearPrecio(texto)).toBeNull();
  });

  it('formatea con o sin centavos', () => {
    expect(formatearCentavos(150_000)).toBe('$ 1.500');
    expect(formatearCentavos(150_050)).toBe('$ 1.500,50');
  });
});

describe('normalizarColumna', () => {
  it('acepta encabezados escritos a mano', () => {
    expect(normalizarColumna('Stock mínimo')).toBe('stock_minimo');
    expect(normalizarColumna(' Código ')).toBe('codigo');
    expect(normalizarColumna('DESCRIPCIÓN')).toBe('descripcion');
  });
});

describe('skuPorDefecto', () => {
  it('usa el código para la variante única y le suma la variante si hay', () => {
    expect(skuPorDefecto('REM-01', '')).toBe('REM-01');
    expect(skuPorDefecto('REM-01', 'Talle M / Rojo')).toBe('REM-01-talle-m-rojo');
  });
});

describe('agruparFilasImportacion', () => {
  it('agrupa las variantes de un mismo código en un producto', () => {
    const { productos, errores } = agruparFilasImportacion([
      { Código: 'REM-01', Nombre: 'Remera', Categoría: 'Remeras', Variante: 'M', Precio: '15.000', Stock: '4' },
      { Código: 'REM-01', Nombre: 'Otro nombre', Variante: 'L', Precio: '15.000', Stock: '' },
      { codigo: 'MATE', nombre: 'Mate de calabaza', precio: '8000', disponible: 'no' },
    ]);

    expect(errores).toEqual([]);
    expect(productos).toHaveLength(2);
    const [remera, mate] = productos;
    expect(remera).toMatchObject({ codigo: 'REM-01', nombre: 'Remera', categoria: 'Remeras', filas: [1, 2] });
    expect(remera.variantes).toEqual([
      { sku: 'REM-01-m', nombre: 'M', precioCentavos: 1_500_000, stock: 4, stockMinimo: null, disponible: true },
      { sku: 'REM-01-l', nombre: 'L', precioCentavos: 1_500_000, stock: null, stockMinimo: null, disponible: true },
    ]);
    expect(mate.variantes).toEqual([
      { sku: 'MATE', nombre: '', precioCentavos: 800_000, stock: null, stockMinimo: null, disponible: false },
    ]);
  });

  it('ignora las filas vacías', () => {
    const { productos, errores } = agruparFilasImportacion([
      { codigo: 'A', nombre: 'Algo', precio: '10' },
      { codigo: '', nombre: '', precio: '' },
    ]);
    expect(errores).toEqual([]);
    expect(productos).toHaveLength(1);
  });

  it('reporta los errores por fila y descarta el producto entero', () => {
    const { productos, errores } = agruparFilasImportacion([
      { codigo: 'REM', nombre: 'Remera', variante: 'M', precio: '100' },
      { codigo: 'REM', nombre: 'Remera', variante: 'L', precio: 'caro' },
      { codigo: 'OK', nombre: 'Taza', precio: '50', stock: '-1' },
      { nombre: 'Sin código', precio: '10' },
    ]);

    expect(productos).toEqual([]);
    expect(errores).toEqual([
      { fila: 1, mensaje: 'el producto REM no se importa porque otra de sus filas tiene errores' },
      { fila: 2, mensaje: 'precio inválido: "caro"' },
      { fila: 3, mensaje: 'el stock tiene que ser un número entero, o quedar vacío' },
      { fila: 4, mensaje: 'falta el código' },
    ]);
  });

  it('rechaza SKUs repetidos dentro del mismo producto', () => {
    const { productos, errores } = agruparFilasImportacion([
      { codigo: 'A', nombre: 'Algo', variante: 'M', sku: 'X', precio: '10' },
      { codigo: 'A', nombre: 'Algo', variante: 'L', sku: 'X', precio: '10' },
    ]);
    expect(productos).toEqual([]);
    expect(errores[0]).toEqual({ fila: 1, mensaje: 'el producto A no se importa porque otra de sus filas tiene errores' });
    expect(errores[1]).toEqual({ fila: 2, mensaje: 'SKU repetido en el producto A' });
  });
});

describe('fusionarRankings', () => {
  it('premia lo que aparece arriba en varios rankings', () => {
    expect(
      fusionarRankings(
        [
          { ids: ['a', 'b', 'c'] },
          { ids: ['b', 'd'] },
          { ids: ['b', 'a'] },
        ],
        3,
      ),
    ).toEqual(['b', 'a', 'd']);
  });

  it('respeta el peso y el límite', () => {
    expect(fusionarRankings([{ ids: ['x'] }, { ids: ['y'], peso: 5 }], 1)).toEqual(['y']);
    expect(fusionarRankings([], 5)).toEqual([]);
  });
});

describe('consultaTsquery', () => {
  it('arma un OR con prefijo por palabra', () => {
    expect(consultaTsquery('¿Tenés la Remera NEGRA?')).toBe('tenes:* | la:* | remera:* | negra:*');
  });

  it('los números van sin prefijo', () => {
    expect(consultaTsquery('talle 42')).toBe('talle:* | 42');
  });

  it('no deja pasar sintaxis de tsquery', () => {
    expect(consultaTsquery("a & b | !c :* ') (")).toBeNull();
    expect(consultaTsquery('mate&!bombilla')).toBe('matebombilla:*');
  });
});
