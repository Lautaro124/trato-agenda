import { API_URL, MODO_REAL, STUB_URL, WEB_URL } from './entorno';

async function esperar(url: string, que: string, segundos = 90): Promise<void> {
  for (let intento = 0; intento < segundos; intento++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Todavía levantando.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `No responde ${que} en ${url}. ¿Levantaste el stack? Desde e2e/: npm run e2e:stack`,
  );
}

/** Falla temprano y con un mensaje útil en vez de 40 tests rojos por timeout. */
export default async function globalSetup(): Promise<void> {
  await esperar(`${API_URL}/health`, 'la API');
  await esperar(`${WEB_URL}/entrar`, 'el front');
  if (!MODO_REAL) await esperar(`${STUB_URL}/health`, 'el OpenRouter falso');

  const estado = (await fetch(`${API_URL}/auth/dev`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)) as { habilitado?: boolean } | null;

  if (!estado?.habilitado) {
    throw new Error(
      'El login de desarrollo está apagado en la API. Con el override de e2e ya viene prendido; ' +
        'para e2e:real definí DEV_LOGIN_PASSWORD en api/.env y E2E_DEV_PASSWORD con el mismo valor.',
    );
  }
}
