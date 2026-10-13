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

function horarioDe(page: Page, clase: string, horario = 1) {
  return visible(page.getByRole('button', { name: new RegExp(`^Horario ${horario} de ${clase}: `) }));
}

function cupoDe(page: Page, clase: string) {
  return visible(page.getByLabel(`Personas por clase de ${clase}`, { exact: true }));
}

/** Abre un horario nuevo de la clase y le carga días y hora; lo deja abierto. */
async function nuevoHorario(page: Page, clase: string, numero: number, dias: string[], hora: string): Promise<void> {
  await visible(page.getByRole('button', { name: `Agregar horario a ${clase}`, exact: true })).click();
  for (const dia of dias) await diasDe(page, clase, numero).getByRole('button', { name: dia, exact: true }).click();
  await visible(page.getByLabel(`Hora del horario ${numero} de ${clase}`, { exact: true })).fill(hora);
}

/** Tilda una clase y le carga cupo, días y hora del primer horario; deja el horario abierto. */
async function cargarClase(page: Page, clase: string, cupo: number, dias: string[], hora: string): Promise<void> {
  await tarjetaEvento(page, clase).click();
  await expect(tarjetaEvento(page, clase)).toHaveAttribute('aria-pressed', 'true');
  await cupoDe(page, clase).fill(String(cupo));
  await nuevoHorario(page, clase, 1, dias, hora);
}

function botonListo(page: Page) {
  return visible(page.getByRole('button', { name: 'Listo', exact: true }));
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

    // Recién tildada, la clase dice qué le falta.
    await tarjetaEvento(page, 'Yoga').click();
    await expect(visible(page.getByText('Escribí cuántas personas entran.'))).toBeVisible();
    await expect(visible(page.getByText('Falta completar Yoga.'))).toBeVisible();
    await expect(botonContinuar(page)).toBeDisabled();

    await cupoDe(page, 'Yoga').fill('8');
    await expect(visible(page.getByText('Agregá al menos un horario.'))).toBeVisible();

    // Los días aparecen sólo al abrir un horario; sin días, "Listo" no deja cerrarlo.
    await visible(page.getByRole('button', { name: 'Agregar horario a Yoga', exact: true })).click();
    await expect(botonListo(page)).toBeDisabled();
    await diasDe(page, 'Yoga').getByRole('button', { name: 'Lunes', exact: true }).click();
    await diasDe(page, 'Yoga').getByRole('button', { name: 'Miércoles', exact: true }).click();
    await expect(diasDe(page, 'Yoga').getByRole('button', { name: 'Lunes', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await botonListo(page).click();
    await expect(horarioDe(page, 'Yoga')).toContainText('Lun y mié');
    await expect(horarioDe(page, 'Yoga')).toContainText('18:00');

    // Un segundo horario: los sábados a otra hora.
    await nuevoHorario(page, 'Yoga', 2, ['Sábado'], '10:00');
    await botonListo(page).click();
    await expect(horarioDe(page, 'Yoga', 2)).toContainText('Sáb');
    await expect(horarioDe(page, 'Yoga', 2)).toContainText('10:00');

    // Un horario que se abre y se cierra sin días no queda.
    await visible(page.getByRole('button', { name: 'Agregar horario a Yoga', exact: true })).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Horario 3 de Yoga/ })).toHaveCount(0);
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

test.describe('wizard de /contanos: clases propias', () => {
  test('"Mi propia lista" arranca sin ninguna clase y guarda sólo las que se agregan', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await hastaAtencion(page, 'En grupo');

    // Con las ideas se tilda Yoga; cambiar a la lista propia lo borra todo.
    await tarjetaEvento(page, 'Yoga').click();
    await visible(page.getByRole('radio', { name: 'Mi propia lista' })).click();
    await expect(visible(page.getByText('Todavía no agregaste clases'))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yoga', exact: true })).toHaveCount(0);
    await expect(visible(page.getByText('Elegí al menos una clase.'))).toBeVisible();

    for (const nombre of ['Stretching', 'Cerámica']) {
      await visible(page.getByRole('textbox', { name: /^(Nombre de la clase|Nueva clase)$/ })).fill(nombre);
      await visible(page.getByRole('button', { name: 'Agregar', exact: true })).click();
    }
    await visible(page.getByRole('button', { name: 'Quitar Cerámica', exact: true })).click();

    await cupoDe(page, 'Stretching').fill('10');
    await nuevoHorario(page, 'Stretching', 1, ['Martes', 'Jueves'], '09:00');
    await botonListo(page).click();
    await expect(visible(page.getByText('1 clase elegida'))).toBeVisible();

    await botonContinuar(page).click();
    await terminar(page);

    const agente = await agenteActual(context.request);
    expect(agente?.tiposEvento).toEqual([
      {
        nombre: 'Stretching',
        duracionMin: 60,
        capacidad: 10,
        horarios: [
          { dia: 'mar', hora: '09:00' },
          { dia: 'jue', hora: '09:00' },
        ],
      },
    ]);
  });
});

test.describe('wizard de /contanos: clases grupales en el celular', { tag: '@movil' }, () => {
  test('arma una clase con el horario en una hoja que sube desde abajo', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await hastaAtencion(page, 'En grupo');

    await cargarClase(page, 'Funcional', 10, ['Lunes', 'Viernes'], '19:00');
    await expect(visible(page.getByRole('dialog', { name: 'Horario 1 de Funcional' }))).toBeVisible();
    await botonListo(page).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(horarioDe(page, 'Funcional')).toContainText('Lun y vie');
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
