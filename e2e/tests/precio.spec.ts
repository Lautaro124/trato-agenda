import { API_URL } from '../entorno';
import { expect, test } from './fixtures';

/** Igual que `formatearMonto` en la web: "$ 20.000". */
function formatear(monto: number, moneda: string): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: moneda, maximumFractionDigits: 0 }).format(monto);
}

test.describe('precio del plan', () => {
  test('la landing y /plan muestran los dos planes con los precios de la API', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const res = await context.request.get(`${API_URL}/suscripcion/precio`);
    expect(res.ok(), await res.text()).toBe(true);
    const { moneda, planes } = (await res.json()) as {
      moneda: string;
      planes: Array<{ id: string; nombre: string; chats: number; monto: number }>;
    };
    expect(planes.map((p) => p.id)).toEqual(['basico', 'pro']);

    await page.goto('/');
    for (const plan of planes) {
      await expect(page.locator('#precio').getByText(formatear(plan.monto, moneda), { exact: true })).toBeVisible();
    }

    await page.goto('/plan');
    for (const plan of planes) {
      await expect(page.getByRole('radio', { name: `Plan ${plan.nombre}` })).toContainText(formatear(plan.monto, moneda));
    }
  });
});
