import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { conectarMercadoPago, crearAgenteVentasPorApi, crearProductoPorApi, escribirEnChat } from './ventas';

test.describe('mensajes personalizados del asistente', () => {
  test('el dueño escribe su link de pago con los botones de datos y el bot lo usa', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    await crearProductoPorApi(context.request, { codigo: 'MATE-MSJ', nombre: 'Mate de calabaza', precioCentavos: 800_000, stock: 5 });
    await conectarMercadoPago(page);

    await page.goto('/asistente');
    await expect(page.getByRole('heading', { name: 'Mensajes de Sol' })).toBeVisible();
    const lista = page.getByRole('navigation', { name: 'Mensajes' });
    await lista.getByRole('button', { name: /Link de pago/ }).click();
    await page.getByRole('button', { name: 'Mi mensaje' }).click();

    // Sin el link el mensaje no sirve: no deja guardar.
    const texto = page.getByLabel('Texto del mensaje');
    await texto.fill('Gracias . Pagalo acá:');
    await expect(page.getByRole('alert').filter({ hasText: 'Falta el dato' })).toContainText('Link de pago');
    await expect(lista.getByRole('button', { name: /Link de pago/ })).toContainText('Revisar');
    await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();

    // Los datos se insertan donde está el cursor, no al final.
    const barra = page.getByRole('toolbar', { name: 'Insertar datos en el mensaje' });
    await texto.focus();
    await texto.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(8, 8));
    await barra.getByRole('button', { name: /Nombre del cliente/ }).click();
    await texto.press('End');
    await barra.getByRole('button', { name: /Link de pago/ }).click();
    await expect(texto).toHaveValue('Gracias {nombre}. Pagalo acá: {link}');

    // La vista previa lo muestra completado con datos de ejemplo.
    await expect(page.getByRole('complementary', { name: 'Vista previa' })).toContainText('Gracias Sofía. Pagalo acá: mpago.la/2Xk9');

    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Guardado' })).toBeVisible();

    const agente = (await (await context.request.get(`${API_URL}/agents/me`)).json()) as {
      mensajes: Record<string, { modo: string; texto: string }>;
    };
    expect(agente.mensajes.linkPago).toEqual({ modo: 'propio', texto: 'Gracias {nombre}. Pagalo acá: {link}' });

    // Al recargar sigue ahí.
    await page.reload();
    await expect(lista.getByRole('button', { name: /Link de pago/ })).toContainText('Tu texto');

    // El pedido del chat de prueba trae el texto del dueño, con el nombre y el link reales.
    await page.goto('/inicio');
    await escribirEnChat(page, '¿tenés mate de calabaza?');
    await expect(page.getByText('Tengo Mate de calabaza a $ 8.000.')).toBeVisible();
    await escribirEnChat(page, 'quiero 2, soy Ana');
    await expect(page.getByText(/exactamente este mensaje.*"Gracias Ana\. Pagalo acá: https?:\/\/\S+"/)).toBeVisible();
  });

  test('en el celular se elige un mensaje, se edita y se guarda desde abajo @movil', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);

    await page.goto('/asistente');
    await page.getByRole('navigation', { name: 'Mensajes' }).getByRole('button', { name: /Pago recibido/ }).click();
    // Una pantalla por mensaje: la lista se va y aparece la flecha para volver.
    await expect(page.getByRole('navigation', { name: 'Mensajes' })).toBeHidden();
    await page.getByRole('button', { name: 'Mi mensaje' }).click();
    await page.getByLabel('Texto del mensaje').fill('¡Gracias! Ya nos llegó tu pago.');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Guardado' })).toBeVisible();

    await page.getByRole('button', { name: 'Mensajes de Sol' }).click();
    await expect(page.getByRole('navigation', { name: 'Mensajes' }).getByRole('button', { name: /Pago recibido/ })).toContainText(
      'Tu texto',
    );
  });
});
