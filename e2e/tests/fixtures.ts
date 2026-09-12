import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { API_URL, DEV_PASSWORD, STUB_URL } from '../entorno';

export { expect };

/**
 * Varias pantallas (/contanos, /calendario) montan a la vez el layout de
 * escritorio y el de móvil y esconden uno por CSS. getByRole ya ignora lo
 * oculto; getByText/getByLabel no, así que se filtran con esto.
 */
export function visible(locator: Locator): Locator {
  return locator.filter({ visible: true });
}

/** Sufijo corto y único: cada test trabaja con su propio usuario, titular y agente. */
export function sufijo(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function emailUnico(prefijo = 'e2e'): string {
  return `${prefijo}-${sufijo()}@trato.local`;
}

/**
 * Login dev por API. `context.request` comparte las cookies con el browser
 * context, así que la página queda logueada sin pasar por /entrar.
 */
export async function loginDev(request: APIRequestContext, email: string): Promise<{ destino: string }> {
  const res = await request.post(`${API_URL}/auth/dev/login`, { data: { password: DEV_PASSWORD, email } });
  expect(res.status(), await res.text()).toBe(200);
  return res.json() as Promise<{ destino: string }>;
}

export type TipoEvento = { nombre: string; duracionMin: number };

export type PayloadAgente = {
  tipoTitular: 'persona' | 'negocio';
  nombreTitular: string;
  tipoUso: 'comercio' | 'consultorio' | 'reuniones' | 'visitas' | 'personal' | 'otro';
  tiposEvento: TipoEvento[];
  horaDesde: string;
  horaHasta: string;
  nombreBot: string;
};

export type AgentePublico = PayloadAgente & { id: string; allowedActions: string[]; descripcion: string };

/** Atajo para los tests que necesitan un agente ya generado y no prueban el wizard. */
export async function crearAgentePorApi(
  request: APIRequestContext,
  datos: Partial<PayloadAgente> = {},
): Promise<AgentePublico> {
  const payload: PayloadAgente = {
    tipoTitular: 'negocio',
    nombreTitular: `Consultorio E2E ${sufijo()}`,
    tipoUso: 'consultorio',
    tiposEvento: [{ nombre: 'Control', duracionMin: 30 }],
    horaDesde: '09:00',
    horaHasta: '18:00',
    nombreBot: 'Tati',
    ...datos,
  };
  const res = await request.post(`${API_URL}/agents/generate`, { data: payload, timeout: 90_000 });
  expect(res.status(), await res.text()).toBe(201);
  return res.json() as Promise<AgentePublico>;
}

/** `GET /agents/me`: el agente del usuario logueado, o null. */
export async function agenteActual(request: APIRequestContext): Promise<AgentePublico | null> {
  const res = await request.get(`${API_URL}/agents/me`);
  expect(res.ok()).toBe(true);
  const texto = await res.text();
  return texto && texto !== 'null' ? (JSON.parse(texto) as AgentePublico) : null;
}

export type LlamadaStub = {
  tipo: 'generacion' | 'conversacion' | 'resumen';
  titular?: string;
  intento?: number;
  model: string;
  max_tokens: number | null;
  response_format: { type: string; json_schema?: { name: string; strict: boolean } } | null;
  provider: { require_parameters?: boolean; data_collection?: string; zdr?: boolean } | null;
  reasoning: Record<string, unknown> | null;
};

/** Qué le pidió la API al OpenRouter falso para un titular dado. */
export async function llamadasDelStub(request: APIRequestContext, titular: string): Promise<LlamadaStub[]> {
  const res = await request.get(`${STUB_URL}/__llamadas?titular=${encodeURIComponent(titular)}`);
  expect(res.ok()).toBe(true);
  return res.json() as Promise<LlamadaStub[]>;
}

const ZONA = 'America/Argentina/Buenos_Aires';

/** "YYYY-MM-DD" en la zona del negocio. */
export function fechaBA(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(fecha);
}

/** "HH:MM" en la zona del negocio. */
export function horaBA(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(iso),
  );
}

export type EventoAgenda = { id: string; resumen: string; inicio: string; fin: string; agendadoPorAgente: boolean };

/** Eventos del calendario (el falso, para usuarios dev) en las próximas dos semanas. */
export async function eventosProximos(request: APIRequestContext): Promise<EventoAgenda[]> {
  const desde = fechaBA(new Date());
  const hasta = fechaBA(new Date(Date.now() + 15 * 24 * 60 * 60 * 1000));
  const res = await request.get(`${API_URL}/calendar/eventos?desde=${desde}&hasta=${hasta}`);
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { eventos: EventoAgenda[] }).eventos;
}

type Fixtures = {
  /** Usuario dev nuevo para este test, ya logueado en el browser context. */
  usuarioDev: { email: string };
};

export const test = base.extend<Fixtures>({
  usuarioDev: async ({ context }: { context: BrowserContext }, use: (valor: { email: string }) => Promise<void>) => {
    const email = emailUnico();
    await loginDev(context.request, email);
    await use({ email });
  },
});

/** Espera a que la app navegue a una ruta (ignora query y hash). */
export async function esperarRuta(page: Page, ruta: string): Promise<void> {
  await page.waitForURL((url) => url.pathname === ruta, { timeout: 90_000 });
}
