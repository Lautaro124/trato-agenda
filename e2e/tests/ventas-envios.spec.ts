import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi } from './ventas';

const CORDOBA_CAPITAL = { nivel: 'localidad', provinciaId: '14', localidadId: '14014010', cp: null };

function zona(nombre: string, cambios: Record<string, unknown> = {}) {
  return {
    nombre,
    activa: true,
    estado: 'tarifa',
    domicilio: true,
    sucursal: false,
    tarifaDomicilioCentavos: 500_000,
    tarifaSucursalCentavos: null,
    gratisDesdeCentavos: null,
    preparacionDias: null,
    transporteDesdeDias: null,
    transporteHastaDias: null,
    diasDespacho: [],
    instrucciones: null,
    coberturas: [CORDOBA_CAPITAL],
    ...cambios,
  };
}

test.describe('módulo de envíos (LAU-102)', () => {
  test('el dueño crea una zona desde el panel y el probador responde con su tarifa', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request, { haceEnvios: true });

    await page.goto('/envios');
    await expect(page.getByRole('heading', { name: 'Envíos', level: 1 })).toBeVisible();
    await page.getByRole('switch', { name: 'Usar mis tarifas de envío' }).check();
    await expect(page.getByText('Guardamos la configuración.')).toBeVisible();

    await page.getByRole('button', { name: 'Nueva zona' }).click();
    await page.getByLabel('Nombre de la zona').fill('Córdoba capital');
    await page.getByLabel('Agregar ubicación').fill('Córdoba');
    await page.getByRole('list', { name: 'Ubicaciones encontradas' }).getByRole('button', { name: /Localidad\s*Córdoba \(Capital, Córdoba\)/ }).click();
    await expect(page.getByRole('list', { name: 'Lugares de la zona' })).toContainText('Córdoba (Capital, Córdoba)');

    // Sin tarifa no se guarda: tiene que ser un monto o "Sin cargo".
    await page.getByRole('button', { name: 'Guardar zona' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Falta la tarifa de envío a domicilio' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Tarifa', exact: true }).fill('5.000');
    await page.getByRole('button', { name: 'Guardar zona' }).click();
    await expect(page.getByText('Guardamos la zona.')).toBeVisible();
    const zonas = page.getByRole('region', { name: 'Zonas' });
    await expect(zonas.getByRole('button', { name: 'Córdoba capital', exact: true })).toBeVisible();
    await expect(zonas.getByText('Domicilio $ 5.000')).toBeVisible();

    await page.getByRole('link', { name: 'Probar respuestas' }).click();
    await page.waitForURL('**/envios/probar');
    await page.getByLabel('Mensaje del cliente').fill('¿Cuánto sale el envío a Córdoba capital?');
    await page.getByRole('button', { name: 'Probar', exact: true }).click();
    const resultado = page.getByRole('region', { name: 'Resultado' });
    await expect(resultado).toContainText('cuesta $ 5.000');
    await expect(resultado).toContainText('zona “Córdoba capital”');
    await expect(resultado.getByText('Resuelto', { exact: true })).toBeVisible();

    // Pausada, la consulta siguiente ya no tiene tarifa.
    await page.goto('/envios');
    await zonas.getByRole('button', { name: 'Pausar Córdoba capital' }).click();
    await expect(zonas.getByText('Pausada')).toBeVisible();
    await page.goto('/envios/probar');
    await page.getByLabel('Mensaje del cliente').fill('¿Cuánto sale el envío a Córdoba capital?');
    await page.getByRole('button', { name: 'Probar', exact: true }).click();
    await expect(resultado.getByText('Sin configurar', { exact: true })).toBeVisible();
  });

  test('una zona que choca con otra queda pausada y la API valida tarifas y cuentas', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request, { haceEnvios: true });

    let res = await context.request.post(`${API_URL}/envios/zonas`, { data: zona('Córdoba capital') });
    expect(res.status(), await res.text()).toBe(201);
    const { zona: primera } = await res.json();

    res = await context.request.post(`${API_URL}/envios/zonas`, { data: zona('Otra capital', { tarifaDomicilioCentavos: 600_000 }) });
    const segunda = await res.json();
    expect(segunda.zona.activa).toBe(false);
    expect(segunda.conflictos[0]).toMatchObject({ modalidad: 'domicilio', lugar: 'Córdoba (Córdoba)' });

    // Tarifa vacía, negativa o plazos al revés: 400.
    for (const cambios of [
      { tarifaDomicilioCentavos: null },
      { tarifaDomicilioCentavos: -1 },
      { transporteDesdeDias: 5, transporteHastaDias: 2 },
    ]) {
      res = await context.request.post(`${API_URL}/envios/zonas`, { data: zona('Mala', cambios) });
      expect(res.status(), JSON.stringify(cambios)).toBe(400);
    }

    // Un id que no es de esta cuenta es 404 (el aislamiento entre cuentas está en envios.db.spec.ts).
    res = await context.request.put(`${API_URL}/envios/zonas/no-existe`, { data: zona('X') });
    expect(res.status()).toBe(404);
    res = await context.request.get(`${API_URL}/envios/zonas`);
    expect((await res.json()).map((z: { id: string }) => z.id)).toEqual([primera.id, segunda.zona.id]);
  });
});
