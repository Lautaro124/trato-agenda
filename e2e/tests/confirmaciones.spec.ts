import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, crearProductoPorApi } from './ventas';

test.describe('confirmaciones y avisos propios', () => {
  test('borrar un producto pide confirmación en un diálogo de Trato y avisa al terminar', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearProductoPorApi(context.request, { codigo: 'MATE-E2E', nombre: 'Mate imperial', precioCentavos: 900_000, stock: 3 });
    // Si quedara un window.confirm, Playwright lo descartaría solo y el test no lo notaría.
    const nativos: string[] = [];
    page.on('dialog', (dialogo) => {
      nativos.push(dialogo.message());
      void dialogo.dismiss();
    });

    await page.goto('/productos');
    const borrar = page.getByRole('button', { name: 'Borrar Mate imperial' });
    const confirmacion = page.getByRole('alertdialog', { name: '¿Borrar «Mate imperial»?' });

    // Escape cancela sin borrar.
    await borrar.click();
    await expect(confirmacion).toContainText('Las ventas pasadas no cambian.');
    await page.keyboard.press('Escape');
    await expect(confirmacion).toBeHidden();
    await expect(borrar).toBeVisible();

    // Cancelar tampoco borra.
    await borrar.click();
    await confirmacion.getByRole('button', { name: 'Cancelar' }).click();
    await expect(confirmacion).toBeHidden();
    await expect(borrar).toBeVisible();

    await borrar.click();
    await confirmacion.getByRole('button', { name: 'Sí, borrar' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Borraste «Mate imperial».' })).toBeVisible();
    await expect(borrar).toHaveCount(0);
    expect(nativos).toEqual([]);
  });
});
