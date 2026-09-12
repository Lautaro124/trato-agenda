import type { Page } from '@playwright/test';
import { expect, test, visible } from './fixtures';
import { botonContinuar, campoNuevoTipo, tarjetaEvento } from './onboarding';

function campoTitular(page: Page) {
  return visible(page.getByLabel('¿Cómo se llama tu negocio?'));
}

function contador(page: Page, texto: string) {
  return visible(page.getByText(texto, { exact: true }));
}

test.describe('wizard de /contanos: validaciones antes de generar', () => {
  test.beforeEach(async ({ page, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await page.goto('/contanos');
    await expect(visible(page.getByText('Paso 2 de 3'))).toBeVisible();
  });

  test('no avanza sin nombre del titular', async ({ page }) => {
    await expect(botonContinuar(page)).toBeDisabled();

    await campoTitular(page).fill('   ');
    await expect(botonContinuar(page)).toBeDisabled();

    await campoTitular(page).fill('Kiosco Rápido');
    await expect(botonContinuar(page)).toBeEnabled();
  });

  test('tipos de evento: exige uno, ignora nombres de 1 letra y corta en 60 caracteres', async ({ page }) => {
    await campoTitular(page).fill('Kiosco Rápido');
    await botonContinuar(page).click();
    await page.getByRole('button', { name: /^Otro/ }).click();
    await botonContinuar(page).click();

    await expect(contador(page, '0 tipos elegidos')).toBeVisible();
    await expect(botonContinuar(page)).toBeDisabled();

    const nuevo = campoNuevoTipo(page);
    await nuevo.fill('A');
    await visible(page.getByRole('button', { name: 'Agregar', exact: true })).click();
    await expect(contador(page, '0 tipos elegidos')).toBeVisible();

    await nuevo.fill('');
    await nuevo.pressSequentially('x'.repeat(65));
    await expect(nuevo).toHaveValue('x'.repeat(60));
    await nuevo.press('Enter');

    await expect(contador(page, '1 tipo elegido')).toBeVisible();
    await expect(botonContinuar(page)).toBeEnabled();
  });

  test('no deja pasar de 20 tipos de evento', async ({ page }) => {
    await campoTitular(page).fill('Kiosco Rápido');
    await botonContinuar(page).click();
    await page.getByRole('button', { name: /^Otro/ }).click();
    await botonContinuar(page).click();

    const nuevo = campoNuevoTipo(page);
    for (let i = 1; i <= 20; i++) {
      await nuevo.fill(`Tipo ${i}`);
      await nuevo.press('Enter');
    }

    await expect(contador(page, '20 tipos elegidos')).toBeVisible();
    await expect(nuevo).toBeDisabled();
    await expect(visible(page.getByText('Llegaste al máximo de 20 tipos de evento.'))).toBeVisible();

    // Liberar uno vuelve a habilitar el campo.
    await tarjetaEvento(page, 'Tipo 20').click();
    await expect(contador(page, '19 tipos elegidos')).toBeVisible();
    await expect(nuevo).toBeEnabled();
  });

  test('cambiar el tipo de uso reinicia los tipos elegidos', async ({ page }) => {
    await campoTitular(page).fill('Consultorio Belgrano');
    await botonContinuar(page).click();
    await page.getByRole('button', { name: /^Consultorio/ }).click();
    await botonContinuar(page).click();

    await tarjetaEvento(page, 'Urgencia').click();
    await expect(contador(page, '1 tipo elegido')).toBeVisible();

    await page.getByRole('button', { name: 'Atrás' }).click();
    await page.getByRole('button', { name: /^Reuniones/ }).click();
    await botonContinuar(page).click();

    await expect(contador(page, '0 tipos elegidos')).toBeVisible();
    await expect(tarjetaEvento(page, 'Demo de producto')).toHaveAttribute('aria-pressed', 'false');
  });

  test('una franja invertida bloquea el avance', async ({ page }) => {
    await campoTitular(page).fill('Kiosco Rápido');
    await botonContinuar(page).click();
    await botonContinuar(page).click();
    await tarjetaEvento(page, 'Urgencia').click();
    await botonContinuar(page).click();

    await visible(page.getByLabel('Desde')).selectOption('15:00');
    await visible(page.getByLabel('Hasta')).selectOption('10:00');

    await expect(visible(page.getByText('La hora de fin tiene que ser posterior a la de inicio.'))).toBeVisible();
    await expect(botonContinuar(page)).toBeDisabled();

    await visible(page.getByLabel('Hasta')).selectOption('19:00');
    await expect(botonContinuar(page)).toBeEnabled();
  });
});
