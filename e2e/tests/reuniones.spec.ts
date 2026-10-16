import type { Page } from '@playwright/test';
import { agenteActual, crearAgentePorApi, eventosProximos, expect, horaBA, test, visible } from './fixtures';
import { elegirDuracion, selectorDuracion, tarjetaEvento } from './onboarding';

/** La fila de un horario grupal ("Horario 1 de Taller: Lun 18:00"). */
function horario(page: Page, nombre: string, numero: number) {
  return visible(page.getByRole('button', { name: new RegExp(`^Horario ${numero} de ${nombre}: `) }));
}

/** Agrega un horario grupal con un día y una hora, y lo cierra con "Listo". */
async function cargarHorario(page: Page, nombre: string, numero: number, dia: string, hora: string): Promise<void> {
  await visible(page.getByRole('button', { name: `Agregar horario a ${nombre}`, exact: true })).click();
  await visible(page.getByRole('group', { name: `Días del horario ${numero} de ${nombre}`, exact: true }))
    .getByRole('button', { name: dia, exact: true })
    .click();
  await visible(page.getByLabel(`Hora del horario ${numero} de ${nombre}`, { exact: true })).fill(hora);
  await visible(page.getByRole('button', { name: 'Listo', exact: true })).click();
}

test.describe('editar reuniones después del onboarding', () => {
  test('cambia duración y precio, persiste y el asistente lo usa en el próximo turno', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request, {
      tiposEvento: [{ nombre: 'Control', duracionMin: 30 }],
    });

    await page.goto('/reuniones');
    await expect(page.getByRole('heading', { name: 'Tus reuniones' })).toBeVisible();

    const guardar = page.getByRole('button', { name: 'Guardar cambios' });
    await expect(guardar).toBeDisabled();

    await elegirDuracion(page, 'Control', 45);
    await page.getByLabel('Precio de Control', { exact: true }).fill('15000');
    await expect(guardar).toBeEnabled();
    await guardar.click();
    await expect(page.getByText('Listo: tu asistente ya usa estas reuniones.')).toBeVisible();
    await expect(guardar).toBeDisabled();

    expect((await agenteActual(context.request))?.tiposEvento).toEqual([
      { nombre: 'Control', duracionMin: 45, precio: 15000 },
    ]);

    // Recargar muestra lo guardado.
    await page.reload();
    await expect(selectorDuracion(page, 'Control').locator('output')).toHaveText('45 min');
    await expect(page.getByLabel('Precio de Control', { exact: true })).toHaveValue('15.000');

    // El asistente agenda con la duración nueva.
    await page.goto('/inicio');
    await page.getByPlaceholder('Escribile al agente…').fill('Hola, quiero un turno, soy Caro');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByText(/^Listo: Turno agendado para Caro/)).toBeVisible();

    const [evento] = await eventosProximos(context.request);
    expect(horaBA(evento.fin)).toBe('10:45');
  });

  test('no deja guardar sin ninguna reunión activa', async ({ page, context, usuarioDev }) => {
    await crearAgentePorApi(context.request);

    await page.goto('/reuniones');
    await tarjetaEvento(page, 'Control').click();

    await expect(page.getByText('Dejá al menos una reunión activa.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  test('"Sin precio" borra el precio de una reunión y el de todas', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request, {
      tiposEvento: [
        { nombre: 'Control', duracionMin: 30, precio: 15000 },
        { nombre: 'Estudio', duracionMin: 60, precio: 30000 },
      ],
    });

    await page.goto('/reuniones');
    const guardar = page.getByRole('button', { name: 'Guardar cambios' });
    const precioControl = page.getByLabel('Precio de Control', { exact: true });
    await expect(precioControl).toHaveValue('15.000');

    // Una sola: el campo se vacía y se traba hasta apagar el botón.
    const sinPrecioControl = page.getByRole('button', { name: 'Sin precio para Control' });
    await sinPrecioControl.click();
    await expect(sinPrecioControl).toHaveAttribute('aria-pressed', 'true');
    await expect(precioControl).toHaveValue('');
    await expect(precioControl).toBeDisabled();
    await guardar.click();
    await expect(page.getByText('Listo: tu asistente ya usa estas reuniones.')).toBeVisible();
    expect((await agenteActual(context.request))?.tiposEvento).toEqual([
      { nombre: 'Control', duracionMin: 30 },
      { nombre: 'Estudio', duracionMin: 60, precio: 30000 },
    ]);

    // Todas de una.
    await page.getByRole('button', { name: 'Sin precio para todos' }).click();
    await expect(page.getByLabel('Precio de Estudio', { exact: true })).toBeDisabled();
    await guardar.click();
    await expect(guardar).toBeDisabled();
    expect((await agenteActual(context.request))?.tiposEvento).toEqual([
      { nombre: 'Control', duracionMin: 30 },
      { nombre: 'Estudio', duracionMin: 60 },
    ]);
  });

  test('marca una reunión como grupal con capacidad y horarios, persiste y valida la capacidad', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request, {
      tiposEvento: [
        { nombre: 'Control', duracionMin: 30 },
        { nombre: 'Taller', duracionMin: 60 },
      ],
    });

    await page.goto('/reuniones');
    const guardar = page.getByRole('button', { name: 'Guardar cambios' });
    const modalidad = (nombre: string) => page.getByRole('radiogroup', { name: `Modalidad de ${nombre}` });

    // El selector está a la vista en cada fila: Taller arranca como individual.
    await expect(modalidad('Taller').getByRole('radio', { name: 'Individual' })).toHaveAttribute('aria-checked', 'true');
    const grupal = modalidad('Taller').getByRole('radio', { name: 'Grupal' });
    await grupal.click();
    await expect(grupal).toHaveAttribute('aria-checked', 'true');

    // Sin capacidad no se puede guardar.
    const capacidad = page.getByLabel('Capacidad de Taller', { exact: true });
    await expect(page.getByText('Poné cuántas personas entran: un número entero de 1 a 100.')).toBeVisible();
    await expect(guardar).toBeDisabled();

    // Cero no es un entero positivo; 101 se pasa del tope.
    await capacidad.fill('0');
    await expect(capacidad).toHaveAttribute('aria-invalid', 'true');
    await expect(guardar).toBeDisabled();
    await capacidad.fill('101');
    await expect(guardar).toBeDisabled();
    // Lo que no es un dígito ni se escribe.
    await capacidad.fill('3,5');
    await expect(capacidad).toHaveValue('35');
    await capacidad.fill('3');
    await expect(capacidad).toHaveAttribute('aria-invalid', 'false');

    // Sin horarios tampoco: se cargan los lunes a las 18:00 y los jueves a las 19:30.
    await expect(page.getByText('Agregá al menos un horario.')).toBeVisible();
    await expect(guardar).toBeDisabled();
    await cargarHorario(page, 'Taller', 1, 'Lunes', '18:00');
    await cargarHorario(page, 'Taller', 2, 'Jueves', '19:30');
    await expect(guardar).toBeEnabled();
    await guardar.click();
    await expect(page.getByText('Listo: tu asistente ya usa estas reuniones.')).toBeVisible();

    expect((await agenteActual(context.request))?.tiposEvento).toEqual([
      { nombre: 'Control', duracionMin: 30 },
      {
        nombre: 'Taller',
        duracionMin: 60,
        capacidad: 3,
        horarios: [
          { dia: 'lun', hora: '18:00' },
          { dia: 'jue', hora: '19:30' },
        ],
      },
    ]);

    // Recargar muestra lo guardado.
    await page.reload();
    await expect(modalidad('Taller').getByRole('radio', { name: 'Grupal' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByLabel('Capacidad de Taller', { exact: true })).toHaveValue('3');
    await expect(horario(page, 'Taller', 1)).toContainText('Lun');
    await expect(horario(page, 'Taller', 1)).toContainText('18:00');
    await expect(horario(page, 'Taller', 2)).toContainText('Jue');
    await expect(horario(page, 'Taller', 2)).toContainText('19:30');
    await expect(modalidad('Control').getByRole('radio', { name: 'Individual' })).toHaveAttribute('aria-checked', 'true');

    // Volver a "Individual" borra capacidad y horarios.
    const individual = modalidad('Taller').getByRole('radio', { name: 'Individual' });
    await individual.click();
    await expect(individual).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByLabel('Capacidad de Taller', { exact: true })).toHaveCount(0);
    await guardar.click();
    await expect(guardar).toBeDisabled();
    expect((await agenteActual(context.request))?.tiposEvento).toEqual([
      { nombre: 'Control', duracionMin: 30 },
      { nombre: 'Taller', duracionMin: 60 },
    ]);
  });

  test('elegir "Grupal" en un tipo sin tildar lo activa y abre la capacidad y los horarios', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request, { tipoUso: 'consultorio', tiposEvento: [{ nombre: 'Control', duracionMin: 30 }] });

    await page.goto('/reuniones');
    // "Estudio" es una sugerencia del consultorio que no está elegida: sin modalidad marcada.
    const estudio = page.getByRole('radiogroup', { name: 'Modalidad de Estudio' });
    await expect(estudio.getByRole('radio', { name: 'Individual' })).toHaveAttribute('aria-checked', 'false');
    await expect(estudio.getByRole('radio', { name: 'Grupal' })).toHaveAttribute('aria-checked', 'false');

    await estudio.getByRole('radio', { name: 'Grupal' }).click();
    await expect(tarjetaEvento(page, 'Estudio')).toHaveAttribute('aria-pressed', 'true');
    await expect(estudio.getByRole('radio', { name: 'Grupal' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByLabel('Capacidad de Estudio', { exact: true })).toBeVisible();
    // Arranca sin horarios: se agregan con el mismo editor que el paso de clases.
    await expect(page.getByRole('button', { name: 'Agregar horario a Estudio', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Horario 1 de Estudio/ })).toHaveCount(0);
  });

  test('sin agente manda al onboarding',async ({ page, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await page.goto('/reuniones');
    await expect(page).toHaveURL(/\/contanos/);
  });
});

test.describe('editar reuniones en el celular @movil', () => {
  test('se llega desde la barra inferior', async ({ page, context, usuarioDev }) => {
    await crearAgentePorApi(context.request);

    await page.goto('/inicio');
    await page.getByRole('link', { name: 'Reuniones' }).click();

    await expect(page.getByRole('heading', { name: 'Tus reuniones' })).toBeVisible();
  });
});
