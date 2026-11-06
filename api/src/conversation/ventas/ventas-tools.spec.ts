import { describe, expect, it } from 'vitest';
import { ACCIONES_VENTAS_IDS } from '../../agents/agent-catalog.js';
import { accionesDeVentas, herramientasDeVentas } from './ventas-tools.js';

/** Las herramientas de los productos a medida, que ya no existen. */
const A_MEDIDA = ['registrar_solicitud', 'pedir_variante', 'aceptar_presupuesto', 'derivar_a_persona'];

describe('accionesDeVentas', () => {
  it('con stock tiene todo, también lo que llegó después de la búsqueda', () => {
    const acciones = accionesDeVentas(['buscar_productos', 'crear_pedido', 'cancelar_pedido', 'derivar_consulta']);
    expect(acciones).toEqual(
      expect.arrayContaining(['crear_pedido', 'cancelar_pedido', 'ver_catalogo', 'ver_descuentos', 'enviar_imagen_producto']),
    );
  });

  it('ignora las de los productos a medida aunque un agente viejo las tenga guardadas', () => {
    const acciones = accionesDeVentas(['buscar_productos', 'crear_pedido', ...A_MEDIDA]);
    for (const accion of A_MEDIDA) expect(acciones).not.toContain(accion);
    expect(acciones).toContain('crear_pedido');
  });
});

describe('herramientasDeVentas', () => {
  it('le muestra crear_pedido al modelo y nunca las de a medida', () => {
    const nombres = herramientasDeVentas([...ACCIONES_VENTAS_IDS], false).map((herramienta) => herramienta.name);
    expect(nombres).toContain('crear_pedido');
    for (const accion of A_MEDIDA) expect(nombres).not.toContain(accion);
  });
});
