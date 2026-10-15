import { API_URL } from '../entorno';
import { agenteActual, esperarRuta, expect, sufijo, test, visible } from './fixtures';
import { botonContinuar, elegirAsistente } from './onboarding';
import { crearAgenteVentasPorApi } from './ventas';

const QUE_HACE = 'Hacemos muebles de madera a medida: mesas, bibliotecas y racks. Entregamos en CABA.';

test.describe('comercio que vende a pedido (LAU-21)', () => {
  test('lo elige en el onboarding, cuenta qué hace y lo ve guardado en Cuenta', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await page.goto('/contanos');
    await elegirAsistente(page, 'ventas');
    await visible(page.getByLabel('¿Cómo se llama tu negocio?')).fill(`Muebles E2E ${sufijo()}`);
    await botonContinuar(page).click();

    // A pedido suma el paso "Qué hacés": siete en total.
    await visible(page.getByRole('radio', { name: /^A pedido/ })).click();
    await expect(visible(page.getByText('Cómo sigue cada pedido'))).toBeVisible();
    await expect(visible(page.getByText('Paso 3 de 7'))).toBeVisible();
    await botonContinuar(page).click();

    // Con menos de 30 caracteres no deja seguir.
    await visible(page.getByLabel('¿Qué hacés?')).fill('Muebles');
    await expect(botonContinuar(page)).toBeDisabled();
    await visible(page.getByLabel('¿Qué hacés?')).fill(QUE_HACE);
    await expect(botonContinuar(page)).toBeEnabled();
    // La vista previa lo cuenta con lo que se escribió (en el celular está plegada: alcanza con que esté).
    await expect(page.getByText('Hola, soy el asistente de').filter({ hasText: QUE_HACE }).first()).toBeAttached();
    await botonContinuar(page).click();

    // "Tu local" y "Datos del cliente" quedan como están.
    await botonContinuar(page).click();
    await botonContinuar(page).click();
    await visible(page.getByLabel('Nombre del asistente')).fill('Lu');
    await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();
    await esperarRuta(page, '/listo');

    const agente = (await agenteActual(context.request)) as unknown as {
      modalidadVenta: string;
      queHace: string;
    };
    expect(agente.modalidadVenta).toBe('pedido');
    expect(agente.queHace).toBe(QUE_HACE);

    // En Cuenta la modalidad se ve fija; lo único que se edita es "Qué hacés".
    await page.goto('/cuenta');
    const seccion = page.getByRole('region', { name: 'Cómo vendés' });
    await expect(seccion.getByText('Vendés a pedido')).toBeVisible();
    await expect(seccion.getByText('Se eligió al crear tu asistente y no se puede cambiar.')).toBeVisible();
    await expect(seccion.getByRole('radio')).toHaveCount(0);
    await expect(seccion.getByLabel('¿Qué hacés?')).toHaveValue(QUE_HACE);
    await seccion.getByLabel('¿Qué hacés?').fill(`${QUE_HACE} También placares.`);
    await seccion.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(seccion.getByText('Listo: tu asistente lo usa desde el próximo mensaje.')).toBeVisible();
    const actualizado = (await agenteActual(context.request)) as unknown as { modalidadVenta: string; queHace: string };
    expect(actualizado).toMatchObject({ modalidadVenta: 'pedido', queHace: `${QUE_HACE} También placares.` });

    // Y la API tampoco deja cambiarla.
    const cambio = await context.request.put(`${API_URL}/agents/me/modalidad`, { data: { modalidadVenta: 'stock' } });
    expect(cambio.status()).toBe(409);
  });

  test('a pedido no cierra la compra: le pasa la solicitud al dueño', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const { nombreTitular } = await crearAgenteVentasPorApi(context.request, {
      modalidadVenta: 'pedido',
      queHace: QUE_HACE,
    });

    const res = await context.request.post(`${API_URL}/conversation/test`, {
      data: { message: 'quiero una mesa de 1,80 x 0,90 para fin de mes, soy Ana' },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const { reply } = (await res.json()) as { reply: string };
    expect(reply).toContain(`le avisé a ${nombreTitular}`);
    expect(reply).not.toContain('Pedido creado');

    const avisos = await context.request.get(`${API_URL}/notificaciones`);
    const { notificaciones } = (await avisos.json()) as { notificaciones: Array<{ titulo: string; cuerpo: string }> };
    const solicitud = notificaciones.find((aviso) => aviso.titulo === '[Prueba] Solicitud para cotizar');
    expect(solicitud?.cuerpo).toContain('pidió una cotización: "quiero una mesa de 1,80 x 0,90 para fin de mes, soy Ana"');
  });

  test('a pedido sin contar qué hace la API lo rechaza', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    const res = await context.request.post(`${API_URL}/agents/generate-ventas`, {
      data: { nombreTitular: `Muebles E2E ${sufijo()}`, nombreBot: 'Lu', modalidadVenta: 'pedido' },
    });
    expect(res.status()).toBe(400);
  });
});
