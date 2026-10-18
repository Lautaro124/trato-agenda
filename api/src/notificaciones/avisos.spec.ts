import { describe, expect, it } from 'vitest';
import {
  avisoConsultaDerivada,
  avisoPedidoManual,
  avisoStock,
  avisoVentaPagada,
  LARGO_MAX_CONSULTA,
  textoParaWhatsapp,
} from './avisos.js';

const VENTA = {
  id: 'venta-1',
  nombreCliente: 'Juan',
  telefonoCliente: '5491122334455',
  totalCentavos: 1_600_000,
  medioPago: 'mercadopago',
  reservaVenceAt: new Date('2026-09-26T17:42:00-03:00'),
  sinStockAlPagar: false,
  dePrueba: false,
  items: [{ nombreProducto: 'Mate', nombreVariante: '', cantidad: 2, subtotalCentavos: 1_600_000 }],
};

describe('avisos', () => {
  it('venta pagada: quién, qué y a dónde ir', () => {
    expect(avisoVentaPagada(VENTA)).toEqual({
      tipo: 'venta_pagada',
      titulo: 'Venta pagada: $ 16.000',
      cuerpo: 'Juan (+5491122334455) pagó 2 × Mate ($ 16.000) por Mercado Pago. Coordiná la entrega por WhatsApp.',
      enlace: '/ventas?venta=venta-1',
    });
  });

  it('marca las de prueba y alerta cuando se pagó sin stock', () => {
    const aviso = avisoVentaPagada({ ...VENTA, dePrueba: true, sinStockAlPagar: true });
    expect(aviso.titulo).toBe('[Prueba] Venta pagada: $ 16.000');
    expect(aviso.cuerpo).toContain('Devolvé el pago o reponé');
  });

  it('pedido a cobrar: hasta cuándo queda reservado, en 24 horas', () => {
    expect(avisoPedidoManual({ ...VENTA, telefonoCliente: null }).cuerpo).toBe(
      'Juan pidió 2 × Mate ($ 16.000). Queda reservado hasta el sábado 26/9 a las 17:42. Cobrale por WhatsApp y marcalo pagado en Ventas.',
    );
  });

  it('stock bajo y agotado comparten la clave de la variante', () => {
    const bajo = avisoStock({ varianteId: 'v-1', nombreProducto: 'Remera', nombreVariante: 'Talle M', stock: 2 });
    const agotado = avisoStock({ varianteId: 'v-1', nombreProducto: 'Remera', nombreVariante: 'Talle M', stock: 0 });
    expect(bajo).toMatchObject({ tipo: 'stock_bajo', titulo: 'Stock bajo: Remera (Talle M)', clave: 'stock:v-1' });
    expect(agotado).toMatchObject({ tipo: 'stock_agotado', titulo: 'Sin stock: Remera (Talle M)', clave: 'stock:v-1' });
  });

  it('una consulta derivada recorta lo que escribió el cliente', () => {
    const aviso = avisoConsultaDerivada({
      conversationId: 'c-1',
      nombreCliente: null,
      telefonoCliente: null,
      resumen: 'x'.repeat(1000),
      dePrueba: false,
    });
    expect(aviso.cuerpo).toContain(`"${'x'.repeat(LARGO_MAX_CONSULTA)}"`);
    expect(aviso.cuerpo).not.toContain('x'.repeat(LARGO_MAX_CONSULTA + 1));
  });

  it('por WhatsApp va el título y el cuerpo', () => {
    expect(textoParaWhatsapp({ titulo: 'T', cuerpo: 'C' })).toBe('T\nC');
  });
});
