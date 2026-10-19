import { describe, expect, it } from 'vitest';
import {
  cierreDelPresupuesto,
  leerRenglones,
  lineaDeRenglon,
  MAX_RENGLONES_PRESUPUESTO,
  normalizarRenglones,
  textoDelPresupuesto,
  TOTAL_MAX_CENTAVOS,
} from './presupuesto.rules.js';

const MELAMINA = { concepto: 'Melamina 18 mm', tipo: 'material', cantidad: 2.4, unidad: 'm²', precioUnitarioCentavos: 1_000_000 };
const ARMADO = { concepto: 'Armado e instalación', tipo: 'mano_obra', cantidad: 1, precioUnitarioCentavos: 3_500_000 };

describe('normalizarRenglones', () => {
  it('calcula cada subtotal y el total en centavos enteros', () => {
    const armado = normalizarRenglones([MELAMINA, ARMADO]);
    expect(armado).toEqual({
      renglones: [
        { ...MELAMINA, subtotalCentavos: 2_400_000 },
        { ...ARMADO, unidad: '', subtotalCentavos: 3_500_000 },
      ],
      totalCentavos: 5_900_000,
    });
  });

  it('redondea la cantidad a 3 decimales y el subtotal al centavo', () => {
    const armado = normalizarRenglones([{ concepto: 'Tela', cantidad: 1.23456, precioUnitarioCentavos: 333 }]);
    expect('renglones' in armado && armado.renglones[0]).toMatchObject({ cantidad: 1.235, subtotalCentavos: 411, tipo: 'otro' });
  });

  it('rechaza con el número de renglón lo que no cierra', () => {
    expect(normalizarRenglones([])).toEqual({ error: 'El presupuesto necesita al menos un renglón.' });
    expect(normalizarRenglones([{ ...MELAMINA, concepto: '  ' }])).toEqual({ error: 'Al renglón 1 le falta qué es.' });
    expect(normalizarRenglones([ARMADO, { ...MELAMINA, cantidad: 0 }])).toEqual({
      error: 'La cantidad del renglón 2 tiene que ser un número mayor que cero.',
    });
    expect(normalizarRenglones([{ ...MELAMINA, precioUnitarioCentavos: 1.5 }])).toEqual({
      error: 'El precio del renglón 1 no es válido.',
    });
    expect(normalizarRenglones(Array.from({ length: MAX_RENGLONES_PRESUPUESTO + 1 }, () => ARMADO))).toHaveProperty('error');
  });

  it('un total en cero o demasiado alto no es un presupuesto', () => {
    expect(normalizarRenglones([{ ...ARMADO, precioUnitarioCentavos: 0 }])).toEqual({
      error: 'El total del presupuesto tiene que ser mayor que cero.',
    });
    expect(normalizarRenglones([{ ...ARMADO, cantidad: 2, precioUnitarioCentavos: TOTAL_MAX_CENTAVOS }])).toEqual({
      error: 'El total del presupuesto es demasiado alto.',
    });
  });

  it('leerRenglones descarta lo que no tiene la forma', () => {
    expect(leerRenglones([{ concepto: 'x' }, null, 'y'])).toEqual([]);
    expect(leerRenglones('nada')).toEqual([]);
  });
});

describe('el texto que lee el cliente', () => {
  const armado = normalizarRenglones([MELAMINA, ARMADO]);
  const renglones = 'renglones' in armado ? armado.renglones : [];
  const solicitud = {
    productoId: 'p1',
    nombreProducto: 'Placard',
    respuestas: [{ pregunta: 'Ancho', respuesta: '120' }],
    resumen: '',
    variante: null,
    cambios: null,
  };

  it('sólo el total por defecto, con lo que pidió y la pregunta para avanzar', () => {
    const texto = textoDelPresupuesto(
      { renglones, totalCentavos: 5_900_000, estimativo: false, detalleAlCliente: false, nota: null },
      solicitud,
      cierreDelPresupuesto(true),
    );
    expect(texto).toBe(
      '*Presupuesto de Placard*\nLo que nos pediste: Ancho: 120.\n*Total: $ 59.000*\n\n' +
        '¿Querés que avancemos? Si me decís que sí, te paso el link de pago.',
    );
  });

  it('sobre una versión con cambios, le recuerda al cliente de cuál partió y qué cambia', () => {
    const texto = textoDelPresupuesto(
      { renglones, totalCentavos: 5_900_000, estimativo: false, detalleAlCliente: false, nota: null },
      { ...solicitud, variante: { id: 'v-1', nombre: 'Blanco 2 puertas', precioCentavos: 4_000_000, cantidad: 1 }, cambios: 'con 3 puertas' },
      cierreDelPresupuesto(true),
    );
    expect(texto).toContain('Sobre Blanco 2 puertas, con estos cambios: con 3 puertas.');
  });

  it('con detalle muestra cada renglón; estimativo, vigencia y nota sólo si están', () => {
    const texto = textoDelPresupuesto(
      { renglones, totalCentavos: 5_900_000, estimativo: true, detalleAlCliente: true, nota: 'Entrega en 10 días hábiles.', vigenciaDias: 7 },
      solicitud,
      cierreDelPresupuesto(false),
    );
    expect(texto).toContain('* Melamina 18 mm: 2,4 m² × $ 10.000 = $ 24.000');
    expect(texto).toContain('* Armado e instalación: $ 35.000');
    expect(texto).toContain('*Total: $ 59.000* (es estimativo');
    expect(texto).toContain('Vale por 7 días.');
    expect(texto).toContain('Entrega en 10 días hábiles.');
    expect(texto).toContain('coordinamos el pago por acá');
    const sinNada = textoDelPresupuesto(
      { renglones, totalCentavos: 5_900_000, estimativo: false, detalleAlCliente: false, nota: null },
      null,
      '',
    );
    expect(sinNada).not.toMatch(/Vale por|estimativo|días/);
  });

  it('lineaDeRenglon', () => {
    expect(lineaDeRenglon(renglones[0])).toBe('Melamina 18 mm: 2,4 m² × $ 10.000 = $ 24.000');
  });
});
