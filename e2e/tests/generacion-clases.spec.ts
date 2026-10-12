import type { Page } from '@playwright/test';
import { agenteActual, esperarRuta, expect, sufijo, test, visible } from './fixtures';
import { botonContinuar, elegirAsistente, elegirAtencion, preguntaInicial, tarjetaEvento } from './onboarding';

/** Hasta "¿Cómo atendés?" inclusive: asistente de turnos, nombre del negocio y la forma de atender. */
async function hastaAtencion(page: Page, atencion: 'En grupo' | 'Las dos cosas'): Promise<void> {
  await page.goto('/contanos');
  await expect(preguntaInicial(page)).toBeVisible();
  await elegirAsistente(page, 'agenda');
  await visible(page.getByLabel('¿Cómo se llama tu negocio?')).fill(`Estudio Sol ${sufijo()}`);
  await botonContinuar(page).click();
  await elegirAtencion(page, atencion);
}

function diasDe(page: Page, clase: string, horario = 1) {
  return visible(page.getByRole('group', { name: `Días del horario ${horario} de ${clase}`, exact: true }));
}

function resumenDe(page: Page, clase: string) {
  return visible(page.getByRole('button', { name: `Cupo y días de ${clase}`, exact: true }));
}

/** Tilda una clase y le carga cupo, días y hora del primer horario. */
async function cargarClase(page: Page, clase: string, cupo: number, dias: string[], hora: string): Promise<void> {
  await tarjetaEvento(page, clase).click();
  await expect(tarjetaEvento(page, clase)).toHaveAttribute('aria-pressed', 'true');
  await visible(page.getByRole('button', { name: `${cupo} personas en ${clase}`, exact: true })).click();
  for (const dia of dias) await diasDe(page, clase).getByRole('button', { name: dia, exact: true }).click();
  await visible(page.getByLabel(`Hora del horario 1 de ${clase}`, { exact: true })).selectOption(hora);
}

async function terminar(page: Page): Promise<void> {
  await visible(page.getByLabel('Nombre del asistente')).fill('Tati');
  await page.getByRole('button', { name: 'Vincular WhatsApp' }).click();
  await esperarRuta(page, '/listo');
}

test.describe('wizard de /contanos: clases grupales', () => {
  test('"En grupo": arma una clase con cupo, días y dos horarios, y la guarda como turno grupal', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await hastaAtencion(page, 'En grupo');

    await expect(page.getByRole('heading', { name: '¿Qué clases das?' })).toBeVisible();
    await expect(visible(page.getByText('Paso 4 de 5'))).toBeVisible();
    await expect(visible(page.getByText('Elegí al menos una clase.'))).toBeVisible();
    await expect(botonContinuar(page)).toBeDisabled();

    // Recién tildada, la clase se despliega y dice qué le falta.
    await tarjetaEvento(page, 'Yoga').click();
    await expect(resumenDe(page, 'Yoga')).toHaveAttribute('aria-expanded', 'true');
    await expect(resumenDe(page, 'Yoga')).toContainText('Elegí cuántas personas entran.');
    await expect(visible(page.getByText('Falta completar Yoga.'))).toBeVisible();
    await expect(botonContinuar(page)).toBeDisabled();

    await visible(page.getByRole('button', { name: '8 personas en Yoga', exact: true })).click();
    await expect(resumenDe(page, 'Yoga')).toContainText('Elegí al menos un día.');
    await diasDe(page, 'Yoga').getByRole('button', { name: 'Lunes', exact: true }).click();
    await diasDe(page, 'Yoga').getByRole('button', { name: 'Miércoles', exact: true }).click();
    await expect(diasDe(page, 'Yoga').getByRole('button', { name: 'Lunes', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Un segundo horario: los sábados a otra hora.
    await visible(page.getByRole('button', { name: '+ Otro día con otro horario' })).click();
    await diasDe(page, 'Yoga', 2).getByRole('button', { name: 'Sábado', exact: true }).click();
    await visible(page.getByLabel('Hora del horario 2 de Yoga', { exact: true })).selectOption('10:00');

    // Completa, se pliega en una línea.
    await visible(page.getByRole('button', { name: 'Listo', exact: true })).click();
    await expect(resumenDe(page, 'Yoga')).toHaveAttribute('aria-expanded', 'false');
    await expect(resumenDe(page, 'Yoga')).toContainText('8 lugares · lun y mié 18:00 · sáb 10:00');
    await expect(visible(page.getByText('1 clase elegida'))).toBeVisible();

    await botonContinuar(page).click();
    await expect(visible(page.getByText('Paso 5 de 5'))).toBeVisible();
    await terminar(page);

    const agente = await agenteActual(context.request);
    expect(agente?.tiposEvento).toEqual([
      {
        nombre: 'Yoga',
        duracionMin: 60,
        capacidad: 8,
        horarios: [
          { dia: 'lun', hora: '18:00' },
          { dia: 'mie', hora: '18:00' },
          { dia: 'sab', hora: '10:00' },
        ],
      },
    ]);
  });

  test('"Las dos cosas": guarda los turnos individuales y las clases, con la franja', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await hastaAtencion(page, 'Las dos cosas');

    await expect(page.getByRole('heading', { name: '¿Qué turnos das?' })).toBeVisible();
    // Acá sólo turnos individuales: el selector "Individual | Grupal" no aparece.
    await expect(page.getByRole('radiogroup', { name: /^Modalidad de/ })).toHaveCount(0);
    await tarjetaEvento(page, 'Urgencia').click();
    await botonContinuar(page).click();

    await expect(page.getByRole('heading', { name: '¿Qué clases das?' })).toBeVisible();
    await cargarClase(page, 'Pilates', 6, ['Martes', 'Jueves'], '09:00');
    await expect(visible(page.getByText('1 clase elegida'))).toBeVisible();
    await botonContinuar(page).click();

    await expect(page.getByRole('heading', { name: '¿En qué horario atendés?' })).toBeVisible();
    await botonContinuar(page).click();
    await terminar(page);

    const agente = await agenteActual(context.request);
    expect(agente?.tiposEvento).toEqual([
      { nombre: 'Urgencia', duracionMin: 15 },
      {
        nombre: 'Pilates',
        duracionMin: 45,
        capacidad: 6,
        horarios: [
          { dia: 'mar', hora: '09:00' },
          { dia: 'jue', hora: '09:00' },
        ],
      },
    ]);
  });
});

test.describe('wizard de /contanos: clases grupales en el celular', { tag: '@movil' }, () => {
  test('arma una clase con los atajos y los días, un paso por pantalla', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await hastaAtencion(page, 'En grupo');

    await cargarClase(page, 'Funcional', 10, ['Lunes', 'Viernes'], '19:00');
    await visible(page.getByRole('button', { name: 'Listo', exact: true })).click();
    await expect(resumenDe(page, 'Funcional')).toContainText('10 lugares · lun y vie 19:00');
    await botonContinuar(page).click();
    await terminar(page);

    const agente = await agenteActual(context.request);
    expect(agente?.tiposEvento).toEqual([
      {
        nombre: 'Funcional',
        duracionMin: 60,
        capacidad: 10,
        horarios: [
          { dia: 'lun', hora: '19:00' },
          { dia: 'vie', hora: '19:00' },
        ],
      },
    ]);
  });
});
