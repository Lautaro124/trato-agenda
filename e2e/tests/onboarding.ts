import { expect, type Locator, type Page } from '@playwright/test';
import { visible, type PayloadAgente, type TipoEvento } from './fixtures';

/** Etiquetas de la grilla de tipo de uso (web/src/app/contanos/useOnboarding.ts). */
const ETIQUETA_USO: Record<PayloadAgente['tipoUso'], string> = {
  comercio: 'Comercio',
  consultorio: 'Consultorio',
  reuniones: 'Reuniones',
  visitas: 'Visitas',
  personal: 'Agenda personal',
  otro: 'Otro',
};

/** Orden en que cicla el pill de duración. */
const DURACIONES = [15, 20, 30, 45, 60, 90];

export type PerfilWizard = {
  tipoTitular: 'persona' | 'negocio';
  nombreTitular: string;
  tipoUso: PayloadAgente['tipoUso'];
  /** Tipos sugeridos del catálogo a activar, con la duración por defecto. */
  sugeridos?: TipoEvento[];
  /** Tipos propios a agregar (arrancan en 30 min) con la duración final deseada. */
  propios?: TipoEvento[];
  /** Label del preset de franja ("Mañana", "Tarde", …). */
  preset: { label: string; desde: string; hasta: string };
  nombreBot: string;
};

/** Lo que tiene que quedar persistido después de completar el wizard con este perfil. */
export function payloadEsperado(perfil: PerfilWizard): PayloadAgente {
  return {
    tipoTitular: perfil.tipoTitular,
    nombreTitular: perfil.nombreTitular,
    tipoUso: perfil.tipoUso,
    tiposEvento: [...(perfil.sugeridos ?? []), ...(perfil.propios ?? [])],
    horaDesde: perfil.preset.desde,
    horaHasta: perfil.preset.hasta,
    nombreBot: perfil.nombreBot,
  };
}

export const MANANA = { label: 'Mañana', desde: '09:00', hasta: '13:00' };

/** El perfil que devolvió 502 en producción: "Otro" con cinco tipos propios, con caracteres raros. */
export function perfilProduccion(sufijo: string): PerfilWizard {
  return {
    tipoTitular: 'negocio',
    nombreTitular: `Estudio "La Ñata" & Cía ${sufijo}`,
    tipoUso: 'otro',
    propios: [
      { nombre: 'Sesión de fotos en exterior', duracionMin: 60 },
      { nombre: 'Retoque 💇‍♀️ express', duracionMin: 15 },
      { nombre: 'Entrega de álbum / revisión', duracionMin: 30 },
      { nombre: 'Consulta "previa" por videollamada', duracionMin: 45 },
      // Exactamente 60 caracteres: el máximo del DTO.
      { nombre: 'Taller grupal de iluminación para principiantes y curiosos!!', duracionMin: 90 },
    ],
    preset: MANANA,
    nombreBot: 'Nina',
  };
}

export function botonContinuar(page: Page): Locator {
  return page.getByRole('button', { name: 'Continuar', exact: true });
}

/** El campo para agregar un tipo de evento propio, del layout que esté a la vista. */
export function campoNuevoTipo(page: Page): Locator {
  return visible(page.getByLabel('Nuevo tipo de evento'));
}

/** Una tarjeta de tipo de evento (div role=button) por su nombre visible. */
export function tarjetaEvento(page: Page, nombre: string): Locator {
  return visible(page.locator('div[role="button"]').filter({ has: page.getByText(nombre, { exact: true }) }));
}

/** Clickea el pill de duración hasta llegar a la deseada. */
async function ajustarDuracion(page: Page, nombre: string, desde: number, hasta: number): Promise<void> {
  const clics = (DURACIONES.indexOf(hasta) - DURACIONES.indexOf(desde) + DURACIONES.length) % DURACIONES.length;
  const pill = tarjetaEvento(page, nombre).locator('span[role="button"]');
  for (let i = 0; i < clics; i++) await pill.click();
  await expect(pill).toHaveAttribute('aria-label', `Duración de ${nombre}: ${hasta} min`);
}

/** Paso "Tipos de evento": activa sugeridos y agrega propios. Lo comparten escritorio y móvil. */
export async function cargarTiposDeEvento(page: Page, perfil: PerfilWizard): Promise<void> {
  for (const tipo of perfil.sugeridos ?? []) {
    await tarjetaEvento(page, tipo.nombre).click();
    await expect(tarjetaEvento(page, tipo.nombre)).toHaveAttribute('aria-pressed', 'true');
  }
  for (const tipo of perfil.propios ?? []) {
    await campoNuevoTipo(page).fill(tipo.nombre);
    await visible(page.getByRole('button', { name: 'Agregar', exact: true })).click();
    await expect(tarjetaEvento(page, tipo.nombre)).toHaveAttribute('aria-pressed', 'true');
    await ajustarDuracion(page, tipo.nombre, 30, tipo.duracionMin);
  }
}

function saludoEsperado(perfil: PerfilWizard): string {
  return `Hola, soy ${perfil.nombreBot}, el asistente de ${perfil.nombreTitular}. ¿En qué te ayudo?`;
}

async function elegirFranja(page: Page, perfil: PerfilWizard): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${perfil.preset.label} ·`) }).click();
  await expect(
    visible(page.getByText(`Agendo entre las ${perfil.preset.desde} y las ${perfil.preset.hasta}.`)),
  ).toBeVisible();
}

async function nombrarAsistente(page: Page, perfil: PerfilWizard): Promise<void> {
  await visible(page.getByLabel('Nombre del asistente')).fill(perfil.nombreBot);
  await expect(visible(page.getByText(saludoEsperado(perfil)))).toBeVisible();
}

/** Recorre el wizard de escritorio hasta el último paso, sin apretar el botón final. */
export async function completarWizardEscritorio(page: Page, perfil: PerfilWizard): Promise<void> {
  await page.getByRole('button', { name: perfil.tipoTitular === 'persona' ? 'Soy una persona' : 'Tengo un negocio' }).click();
  await visible(
    page.getByLabel(perfil.tipoTitular === 'persona' ? '¿Cómo te llamás?' : '¿Cómo se llama tu negocio?'),
  ).fill(perfil.nombreTitular);
  await botonContinuar(page).click();

  await page.getByRole('button', { name: new RegExp(`^${ETIQUETA_USO[perfil.tipoUso]}`) }).click();
  await botonContinuar(page).click();

  await cargarTiposDeEvento(page, perfil);
  const total = (perfil.sugeridos?.length ?? 0) + (perfil.propios?.length ?? 0);
  await expect(visible(page.getByText(`${total} ${total === 1 ? 'tipo elegido' : 'tipos elegidos'}`))).toBeVisible();
  await botonContinuar(page).click();

  await elegirFranja(page, perfil);
  await botonContinuar(page).click();

  await nombrarAsistente(page, perfil);
}

/** El formulario móvil: las mismas cinco preguntas en un solo scroll. */
export async function completarFormularioMovil(page: Page, perfil: PerfilWizard): Promise<void> {
  await page.getByRole('button', { name: perfil.tipoTitular === 'persona' ? 'Soy una persona' : 'Tengo un negocio' }).click();
  await visible(page.getByLabel('Nombre de la persona o del negocio')).fill(perfil.nombreTitular);
  await page.getByRole('button', { name: ETIQUETA_USO[perfil.tipoUso], exact: true }).click();
  await cargarTiposDeEvento(page, perfil);
  await elegirFranja(page, perfil);
  await nombrarAsistente(page, perfil);
}
