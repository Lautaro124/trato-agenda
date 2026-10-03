import type { APIRequestContext } from '@playwright/test';
import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, crearProductoPorApi } from './ventas';

/** El chat de prueba por API: lo que se prueba es la respuesta, no la pantalla. */
async function decirle(request: APIRequestContext, message: string): Promise<string> {
  const res = await request.post(`${API_URL}/conversation/test`, { data: { message } });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { reply: string }).reply;
}

test.describe('"¿qué tenés?" en el asistente de ventas', () => {
  test('con pocos productos lista todos los que tienen stock, con precio', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearProductoPorApi(context.request, { codigo: 'MATE-S', nombre: 'Mate de calabaza', precioCentavos: 800_000, stock: 3 });
    await crearProductoPorApi(context.request, { codigo: 'TERMO-S', nombre: 'Termo de acero', precioCentavos: 4_500_000, stock: 1 });
    await crearProductoPorApi(context.request, { codigo: 'AGOT-S', nombre: 'Mate imperial', precioCentavos: 6_200_000, stock: 0 });

    const respuesta = await decirle(context.request, '¿Qué productos tenés?');

    expect(respuesta).toContain('- Mate de calabaza: $ 8.000');
    expect(respuesta).toContain('- Termo de acero: $ 45.000');
    // Sin stock no se ofrece.
    expect(respuesta).not.toContain('Mate imperial');
  });

  test('con muchos sugiere categorías según la charla, y después lista la elegida', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    // 12 productos en 6 categorías de 2: en el orden determinista (alfabético) Mates sería la tercera.
    const categorias = ['Bombillas', 'Libros', 'Mates', 'Regalos', 'Termos', 'Yerbas'];
    for (const [indice, categoria] of categorias.entries()) {
      for (const numero of [1, 2]) {
        await crearProductoPorApi(context.request, {
          codigo: `SUG-${indice}-${numero}`,
          nombre: `${categoria.slice(0, -1)} ${numero}`,
          categoria,
          precioCentavos: (indice + 1) * 100_000 * numero,
          stock: 5,
        });
      }
    }

    const sugerencia = await decirle(context.request, '¿Qué productos tenés? Busco algo para el mate');

    // Jev (el stub) sube la categoría que tiene que ver con lo que escribió el cliente.
    const lineas = sugerencia.split('\n').filter((linea) => linea.startsWith('- '));
    expect(lineas[0]).toBe('- Mates (2 productos)');
    expect(lineas).toHaveLength(5);
    expect(sugerencia).toContain('Y tengo otras más.');

    const listado = await decirle(context.request, 'Mostrame Termos');
    expect(listado).toContain('- Termo 1: $ 5.000');
    expect(listado).toContain('- Termo 2: $ 10.000');
    expect(listado).not.toContain('Mate');
  });
});
