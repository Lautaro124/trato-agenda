import { describe, expect, it } from 'vitest';
import { ACCIONES_VENTAS_IDS } from '../../agents/agent-catalog.js';
import { accionesDeVentas, herramientasDeVentas } from './ventas-tools.js';

describe('accionesDeVentas', () => {
  it('con stock tiene todo, también lo que llegó después de la búsqueda', () => {
    const acciones = accionesDeVentas(['buscar_productos', 'crear_pedido', 'cancelar_pedido', 'derivar_consulta']);
    expect(acciones).toEqual(
      expect.arrayContaining(['crear_pedido', 'cancelar_pedido', 'ver_catalogo', 'ver_descuentos', 'enviar_imagen_producto']),
    );
  });

  it('a pedido no cierra ni cancela compras: no tiene crear_pedido ni cancelar_pedido', () => {
    const acciones = accionesDeVentas([...ACCIONES_VENTAS_IDS], 'pedido');
    expect(acciones).not.toContain('crear_pedido');
    expect(acciones).not.toContain('cancelar_pedido');
    expect(acciones).toContain('derivar_consulta');
    expect(acciones).toContain('buscar_productos');
  });

  it('a pedido tiene las de los pedidos a medida aunque el agente se haya guardado sin ellas (LAU-27)', () => {
    const acciones = accionesDeVentas(['buscar_productos', 'derivar_consulta'], 'pedido');
    expect(acciones).toEqual(expect.arrayContaining(['registrar_solicitud', 'aceptar_presupuesto', 'derivar_a_persona']));
    expect(new Set(acciones).size).toBe(acciones.length);
  });

  it('con stock no tiene las de los pedidos a medida aunque estén guardadas', () => {
    const acciones = accionesDeVentas([...ACCIONES_VENTAS_IDS], 'stock');
    for (const accion of ['registrar_solicitud', 'aceptar_presupuesto', 'derivar_a_persona']) {
      expect(acciones).not.toContain(accion);
    }
  });
});

describe('herramientasDeVentas', () => {
  const nombres = (agent?: { modalidadVenta: string }) =>
    herramientasDeVentas([...ACCIONES_VENTAS_IDS], false, agent).map((herramienta) => herramienta.name);

  it('sin agente (o con stock) le muestra crear_pedido al modelo', () => {
    expect(nombres()).toContain('crear_pedido');
    expect(nombres({ modalidadVenta: 'stock' })).toContain('crear_pedido');
  });

  it('a pedido no se la muestra', () => {
    expect(nombres({ modalidadVenta: 'pedido' })).not.toContain('crear_pedido');
  });
});
