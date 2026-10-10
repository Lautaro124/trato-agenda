import type { APIRequestContext, Page } from '@playwright/test';
import { API_URL, MP_STUB_URL } from '../entorno';
import { expect, sufijo } from './fixtures';

/** Atajo para los tests que necesitan un asistente de ventas y no prueban el onboarding. */
export async function crearAgenteVentasPorApi(
  request: APIRequestContext,
  extra: { haceEnvios?: boolean; datosCliente?: Array<{ tipo: string; etiqueta?: string; obligatorio: boolean }> } = {},
): Promise<{ nombreTitular: string }> {
  const nombreTitular = `Mates E2E ${sufijo()}`;
  const res = await request.post(`${API_URL}/agents/generate-ventas`, { data: { nombreTitular, nombreBot: 'Sol', ...extra } });
  expect(res.status(), await res.text()).toBe(201);
  return { nombreTitular };
}

export type VarianteE2E = { id: string; precioCentavos: number; stock: number | null; disponible: boolean };
export type ProductoE2E = { id: string; codigo: string; nombre: string; variantes: VarianteE2E[] };

/** Un producto de variante única, cargado por API. */
export async function crearProductoPorApi(
  request: APIRequestContext,
  datos: {
    codigo: string;
    nombre: string;
    descripcion?: string;
    categoria?: string;
    precioCentavos: number;
    stock?: number | null;
  },
): Promise<ProductoE2E> {
  const res = await request.post(`${API_URL}/productos`, {
    data: {
      codigo: datos.codigo,
      nombre: datos.nombre,
      descripcion: datos.descripcion ?? '',
      ...(datos.categoria ? { categoria: datos.categoria } : {}),
      variantes: [{ precioCentavos: datos.precioCentavos, stock: datos.stock ?? null }],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return res.json() as Promise<ProductoE2E>;
}

export async function productoPorApi(request: APIRequestContext, id: string): Promise<ProductoE2E> {
  const res = await request.get(`${API_URL}/productos/${id}`);
  expect(res.ok(), await res.text()).toBe(true);
  return res.json() as Promise<ProductoE2E>;
}

/** Manda un mensaje desde el chat de prueba de /inicio. */
export async function escribirEnChat(page: Page, texto: string): Promise<void> {
  await page.getByPlaceholder('Escribile al agente…').fill(texto);
  await page.getByRole('button', { name: 'Enviar' }).click();
}

/**
 * "Conectar Mercado Pago" desde /cuenta, contra el Mercado Pago falso: su
 * pantalla de autorización devuelve el code al callback de la API sin
 * preguntar nada, y la API vuelve a /cuenta?mp=conectado.
 */
export async function conectarMercadoPago(page: Page): Promise<void> {
  await page.goto('/cuenta');
  const seccion = page.getByRole('region', { name: 'Mercado Pago' });
  await seccion.getByRole('button', { name: 'Conectar Mercado Pago' }).click();
  await page.waitForURL((url) => url.pathname === '/cuenta' && url.searchParams.get('mp') === 'conectado');
  await expect(seccion.getByText('Conectado', { exact: true })).toBeVisible();
}

export type LlamadaMp = { tipo: string; url?: string; status?: number; error?: string };

/** Lo que registró el Mercado Pago falso (preferencias creadas, webhooks enviados…). */
export async function llamadasDeMercadoPago(request: APIRequestContext): Promise<LlamadaMp[]> {
  const res = await request.get(`${MP_STUB_URL}/__llamadas`);
  expect(res.ok()).toBe(true);
  return res.json() as Promise<LlamadaMp[]>;
}
