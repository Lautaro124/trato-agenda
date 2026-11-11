import { describe, expect, it } from 'vitest';
import type { CotizacionFormasDePago } from '../../comercio/ventas.service.js';
import { resolverEnvio, type ZonaRegla } from '../../envios/envios.rules.js';
import { formatearCotizacion } from './cotizacion.js';
import { preciosSinRespaldo } from './reglas-ventas.js';

const COTIZACION: CotizacionFormasDePago = {
  moneda: 'ARS',
  renglones: [{ nombreProducto: 'Sofá esquinero', cantidad: 1, subtotalCentavos: 101_829_600 }],
  contadoCentavos: 101_829_600,
  efectivoCentavos: 91_646_640,
  planes: [{ cuotas: 3, recargoCentavos: 0, totalCentavos: 101_829_600, cuotaCentavos: 33_943_200 }],
  sinCuotas: null,
};

const ZONA: ZonaRegla = {
  id: 'z-1',
  nombre: 'Córdoba capital',
  activa: true,
  estado: 'tarifa',
  domicilio: true,
  sucursal: true,
  tarifaDomicilioCentavos: 0,
  tarifaSucursalCentavos: 3_500_000,
  gratisDesdeCentavos: null,
  preparacionDias: 1,
  transporteDesdeDias: 1,
  transporteHastaDias: 3,
  diasDespacho: [],
  instrucciones: null,
  coberturas: [{ nivel: 'localidad', provinciaId: '14', localidadId: '14014010', cp: null }],
};

const resolver = (consulta: { localidad?: string; provincia?: string }) =>
  resolverEnvio({ activo: true, pais: 'AR', moneda: 'ARS', sinTarifa: 'derivar' }, [ZONA], consulta, {
    retiroEnLocal: false,
    subtotalCentavos: COTIZACION.contadoCentavos,
    monedaSubtotal: 'ARS',
  });

describe('formatearCotizacion', () => {
  it('sin envío: productos, subtotal y cada forma de pago, calculados', () => {
    const texto = formatearCotizacion(COTIZACION, null);
    expect(texto).toContain('1 × Sofá esquinero ($ 1.018.296). Subtotal de productos: $ 1.018.296.');
    expect(texto).toContain('- En un pago: $ 1.018.296');
    expect(texto).toContain('- En efectivo: $ 916.466,40');
    expect(texto).toContain('- En 3 cuotas sin interés: 3 cuotas de $ 339.432 (total $ 1.018.296)');
    expect(texto).toContain('no sumes, restes ni multipliques vos');
  });

  it('con destino y sin modalidad: el total con cada envío, y las formas de pago sin envío', () => {
    const texto = formatearCotizacion(COTIZACION, { resolucion: resolver({ localidad: 'Córdoba capital' }), modalidad: null });
    expect(texto).toContain('- Envío a domicilio: sin cargo; total con este envío $ 1.018.296');
    expect(texto).toContain('- Retiro en sucursal del correo: $ 35.000; total con este envío $ 1.053.296');
    expect(texto).toContain('- En un pago: $ 1.018.296');
    expect(texto).toContain('volvé a llamar cotizar_pedido con ella');
  });

  it('con la modalidad elegida, el envío entra en todas las formas de pago, y el modelo las puede repetir', () => {
    const texto = formatearCotizacion(COTIZACION, { resolucion: resolver({ localidad: 'Córdoba capital' }), modalidad: 'sucursal' });
    expect(texto).not.toContain('Envío a domicilio');
    expect(texto).toContain('Formas de pago (con el envío elegido):');
    expect(texto).toContain('- En un pago: $ 1.053.296');
    expect(texto).toContain('- En efectivo: $ 951.466,40');
    expect(texto).toContain('3 cuotas de $ 351.098,67 (total $ 1.053.296)');
    // Lo que trababa el chat: el total con envío ahora sale de una herramienta, con respaldo.
    const respuesta = 'Sofá $ 1.018.296 + retiro en sucursal $ 35.000 = $ 1.053.296, o 3 cuotas de $ 351.098,67.';
    expect(preciosSinRespaldo(respuesta, [texto])).toEqual([]);
  });

  it('sin un destino resuelto no inventa envío: avisa que los totales son sin envío', () => {
    const texto = formatearCotizacion(COTIZACION, { resolucion: resolver({}), modalidad: 'sucursal' });
    expect(texto).toContain('todavía no se puede cotizar');
    expect(texto).toContain('- En un pago: $ 1.018.296');
  });
});
