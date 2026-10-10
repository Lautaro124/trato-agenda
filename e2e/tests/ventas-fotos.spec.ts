import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi, crearProductoPorApi, escribirEnChat } from './ventas';

/** PNG de 1 × 1: la API lo valida por contenido y lo guarda recomprimido como JPEG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('fotos de productos', () => {
  test('el dueño sube la foto en /productos y el asistente la manda cuando el cliente la pide', async ({
    page,
    context,
    usuarioDev,
  }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);
    const mate = await crearProductoPorApi(context.request, {
      codigo: 'FOTO-1',
      nombre: 'Mate de calabaza',
      precioCentavos: 800_000,
      stock: 3,
    });

    await page.goto('/productos');
    await page.getByRole('button', { name: 'Editar Mate de calabaza' }).click();
    const editor = page.getByRole('dialog', { name: 'Editar producto' });
    await expect(editor).toContainText('0 de 100 productos con foto');
    await editor.getByLabel('Elegir foto del producto').setInputFiles({ name: 'mate.png', mimeType: 'image/png', buffer: PNG });
    await expect(editor.getByRole('img', { name: 'Foto del producto' })).toBeVisible();
    await expect(editor).toContainText('1 de 100 productos con foto');

    // Lo que se guardó es el JPEG que generó la API, no el PNG que se subió.
    const foto = await context.request.get(`${API_URL}/productos/${mate.id}/imagen`);
    expect(foto.headers()['content-type']).toBe('image/jpeg');

    await editor.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('img', { name: 'Foto de Mate de calabaza' })).toBeVisible();

    // Un GIF no pasa, y el error se ve en el editor.
    await page.getByRole('button', { name: 'Editar Mate de calabaza' }).click();
    await editor
      .getByLabel('Elegir foto del producto')
      .setInputFiles({ name: 'mate.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
    await expect(editor.getByRole('alert')).toContainText('JPG, PNG o WebP');
    await editor.getByRole('button', { name: 'Cancelar' }).click();

    // En el banco de pruebas: primero busca, después manda la foto con el nombre al pie.
    await page.goto('/inicio');
    await escribirEnChat(page, '¿Tenés mate de calabaza?');
    await expect(page.getByText('Tengo Mate de calabaza a $ 8.000.')).toBeVisible();
    await escribirEnChat(page, 'Mandame una foto');
    await expect(page.getByRole('img', { name: 'Foto de Mate de calabaza' })).toBeVisible();
    await expect(page.getByText('Ahí te mandé la foto. ¿Es lo que buscabas?')).toBeVisible();

    // Quitarla libera el lugar; el asistente ya no tiene qué mandar.
    const quitar = await context.request.delete(`${API_URL}/productos/${mate.id}/imagen`);
    expect(quitar.status()).toBe(204);
    const uso = (await (await context.request.get(`${API_URL}/productos/imagenes/uso`)).json()) as { usadas: number };
    expect(uso.usadas).toBe(0);
  });
});
