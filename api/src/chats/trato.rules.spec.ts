import { describe, expect, it } from 'vitest';
import { estadoDelTrato, pasoParaTrato } from './trato.rules.js';

const antes = new Date('2026-11-10T12:00:00Z');
const despues = new Date('2026-11-12T12:00:00Z');

describe('estadoDelTrato', () => {
  it('sin pedido ni marca no hay trato', () => {
    expect(estadoDelTrato(null, null)).toBeNull();
  });

  it('sale del último pedido', () => {
    expect(estadoDelTrato({ estado: 'pendiente_pago', createdAt: antes }, null)).toBe('hecho');
    expect(estadoDelTrato({ estado: 'pagada', createdAt: antes }, null)).toBe('pagado');
    expect(estadoDelTrato({ estado: 'cancelada', createdAt: antes }, null)).toBe('cancelado');
    expect(estadoDelTrato({ estado: 'vencida', createdAt: antes }, null)).toBeNull();
  });

  it('la marca de cancelado vale sólo si es posterior al último pedido', () => {
    expect(estadoDelTrato(null, antes)).toBe('cancelado');
    expect(estadoDelTrato({ estado: 'vencida', createdAt: antes }, despues)).toBe('cancelado');
    expect(estadoDelTrato({ estado: 'pendiente_pago', createdAt: despues }, antes)).toBe('hecho');
  });
});

describe('pasoParaTrato', () => {
  it('trato hecho reutiliza el pedido abierto y si no, lo crea', () => {
    expect(pasoParaTrato('hecho', null)).toEqual({ tipo: 'crear', pagado: false });
    expect(pasoParaTrato('hecho', { estado: 'pendiente_pago', createdAt: antes })).toEqual({ tipo: 'nada' });
    expect(pasoParaTrato('hecho', { estado: 'cancelada', createdAt: antes })).toEqual({ tipo: 'crear', pagado: false });
    expect(pasoParaTrato('hecho', { estado: 'pagada', createdAt: antes }).tipo).toBe('rechazar');
  });

  it('pagado cobra el pedido abierto o crea uno ya pagado', () => {
    expect(pasoParaTrato('pagado', { estado: 'vencida', createdAt: antes })).toEqual({ tipo: 'pagar' });
    expect(pasoParaTrato('pagado', null)).toEqual({ tipo: 'crear', pagado: true });
    expect(pasoParaTrato('pagado', { estado: 'pagada', createdAt: antes })).toEqual({ tipo: 'nada' });
  });

  it('cancelado cancela el pedido abierto y nunca uno pagado', () => {
    expect(pasoParaTrato('cancelado', { estado: 'pendiente_pago', createdAt: antes })).toEqual({ tipo: 'cancelar_pedido' });
    expect(pasoParaTrato('cancelado', null)).toEqual({ tipo: 'marcar_cancelado' });
    expect(pasoParaTrato('cancelado', { estado: 'pagada', createdAt: antes }).tipo).toBe('rechazar');
  });
});
