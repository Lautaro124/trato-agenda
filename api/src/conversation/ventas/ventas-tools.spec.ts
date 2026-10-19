import { describe, expect, it } from 'vitest';
import { ACCIONES_VENTAS_IDS } from '../../agents/agent-catalog.js';
import type { Agent } from '../../generated/prisma/client.js';
import { accionesDeVentas, herramientasDeVentas } from './ventas-tools.js';

const A_MEDIDA = ['registrar_solicitud', 'pedir_variante', 'aceptar_presupuesto', 'derivar_a_persona'];

describe('accionesDeVentas', () => {
  it('con stock tiene todo, también lo que llegó después de la búsqueda', () => {
    const acciones = accionesDeVentas(['buscar_productos', 'crear_pedido', 'cancelar_pedido', 'derivar_consulta']);
    expect(acciones).toEqual(
      expect.arrayContaining(['crear_pedido', 'cancelar_pedido', 'ver_catalogo', 'ver_descuentos', 'enviar_imagen_producto']),
    );
  });

  it('con productos a medida suma las suyas y sigue cerrando compras de stock', () => {
    const acciones = accionesDeVentas([...ACCIONES_VENTAS_IDS], { aMedida: true });
    expect(acciones).toContain('crear_pedido');
    expect(acciones).toContain('cancelar_pedido');
    expect(acciones).toEqual(expect.arrayContaining(A_MEDIDA));
  });

  it('las de a medida llegan aunque el agente se haya guardado sin ellas (LAU-27), sin repetirse', () => {
    const acciones = accionesDeVentas(['buscar_productos', 'derivar_consulta'], { aMedida: true });
    expect(acciones).toEqual(expect.arrayContaining(A_MEDIDA));
    expect(new Set(acciones).size).toBe(acciones.length);
  });

  it('sin productos a medida no tiene las de los pedidos a medida aunque estén guardadas', () => {
    const acciones = accionesDeVentas([...ACCIONES_VENTAS_IDS]);
    for (const accion of A_MEDIDA) expect(acciones).not.toContain(accion);
  });
});

describe('herramientasDeVentas', () => {
  const nombres = (contexto?: { tieneAMedida: boolean }) =>
    herramientasDeVentas([...ACCIONES_VENTAS_IDS], false, contexto && { agent: {} as Agent, ...contexto }).map(
      (herramienta) => herramienta.name,
    );

  it('siempre le muestra crear_pedido al modelo', () => {
    expect(nombres()).toContain('crear_pedido');
    expect(nombres({ tieneAMedida: true })).toContain('crear_pedido');
  });

  it('las de a medida, sólo si la cuenta tiene alguno', () => {
    expect(nombres({ tieneAMedida: false })).not.toContain('registrar_solicitud');
    expect(nombres({ tieneAMedida: true })).toContain('registrar_solicitud');
  });
});
