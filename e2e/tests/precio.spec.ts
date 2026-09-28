import { API_URL } from '../entorno';
import { expect, test } from './fixtures';

/** Igual que `formatearMonto` en la web: "$ 20.000". */
function formatear(monto: number, moneda: string): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: moneda, maximumFractionDigits: 0 }).format(monto);
}

test.describe('precio del plan', () => {
  test('la landing y /plan muestran el mismo precio, el de SUSCRIPCION_PRECIO_ARS', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const res = await context.request.get(`${API_URL}/suscripcion/precio`);
    expect(res.ok(), await res.text()).toBe(true);
    const { monto, moneda } = (await res.json()) as { monto: number; moneda: string };
    const precio = formatear(monto, moneda);

    await page.goto('/');
    await expect(page.locator('#precio').getByText(precio, { exact: true })).toBeVisible();

    await page.goto('/plan');
    await expect(page.getByText(precio, { exact: true }).first()).toBeVisible();
  });
});
