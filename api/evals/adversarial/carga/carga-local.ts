/**
 * Script de carga local (dimensión RL6) contra el stack e2e con el stub — NO
 * contra OpenRouter real. No es un test de Vitest: se corre a mano, con el
 * stack e2e levantado (`cd e2e && npm run e2e:stack`), y aborta solo si el
 * host se acerca a límites de CPU/memoria.
 *
 *   API_URL=http://localhost:4000 node evals/adversarial/carga/carga-local.ts --concurrencia 5 --modo mismo-chat
 *
 * `--modo`: mismo-chat | mismo-titular | titulares-distintos.
 * Requiere login dev (DEV_LOGIN_PASSWORD=e2e-password en el stack de e2e).
 */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const DEV_PASSWORD = process.env.DEV_PASSWORD ?? 'e2e-password';

type Modo = 'mismo-chat' | 'mismo-titular' | 'titulares-distintos';

function args(): { concurrencia: number; modo: Modo; limiteMs: number } {
  const argv = process.argv.slice(2);
  const valor = (flag: string, porDefecto: string) => argv[argv.indexOf(flag) + 1] ?? porDefecto;
  return {
    concurrencia: Number(valor('--concurrencia', '5')),
    modo: valor('--modo', 'titulares-distintos') as Modo,
    limiteMs: Number(valor('--limite-ms', '120000')),
  };
}

async function loginDev(email: string): Promise<string> {
  const res = await fetch(`${API_URL}/auth/dev/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: DEV_PASSWORD, email }),
  });
  if (!res.ok) throw new Error(`login dev falló: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('login dev no devolvió cookie de sesión');
  return cookie.split(';')[0];
}

async function generarAgente(cookie: string, titular: string): Promise<void> {
  const res = await fetch(`${API_URL}/agents/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      tipoTitular: 'negocio',
      nombreTitular: titular,
      tipoUso: 'comercio',
      tiposEvento: [{ nombre: 'Turno', duracionMin: 30 }],
      horaDesde: '09:00',
      horaHasta: '18:00',
      nombreBot: 'Bot',
    }),
  });
  if (!res.ok) throw new Error(`generar agente falló: ${res.status} ${await res.text()}`);
}

async function mandarMensaje(cookie: string, texto: string): Promise<{ ms: number; ok: boolean; status: number }> {
  const inicio = performance.now();
  const res = await fetch(`${API_URL}/conversation/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ message: texto }),
  });
  return { ms: Math.round(performance.now() - inicio), ok: res.ok, status: res.status };
}

/** Semáforo simple: como máximo `limite` promesas en vuelo a la vez. */
async function conConcurrenciaLimitada<T>(items: (() => Promise<T>)[], limite: number): Promise<T[]> {
  const resultados: T[] = Array.from({ length: items.length });
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < items.length) {
      const indice = siguiente++;
      resultados[indice] = await items[indice]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
  return resultados;
}

async function main(): Promise<void> {
  const { concurrencia, modo, limiteMs } = args();
  console.log(`Carga local: concurrencia=${concurrencia} modo=${modo} límite=${limiteMs}ms API=${API_URL}`);

  const inicioTotal = Date.now();
  const cookiesPorHilo: string[] = [];
  for (let i = 0; i < concurrencia; i += 1) {
    const email = `carga-${Date.now()}-${i}@trato.local`;
    const cookie = await loginDev(email);
    const titular = modo === 'titulares-distintos' ? `Carga ${i}` : 'Carga compartida';
    await generarAgente(cookie, titular);
    cookiesPorHilo.push(cookie);
  }

  const tareas = cookiesPorHilo.map((cookie, i) => async () => {
    if (Date.now() - inicioTotal > limiteMs) {
      throw new Error('límite de duración aprobado alcanzado: abortando antes de seguir generando carga');
    }
    return mandarMensaje(cookie, `hola, soy cliente ${i}`);
  });

  const resultados = await conConcurrenciaLimitada(tareas, concurrencia);
  const ok = resultados.filter((r) => r.ok).length;
  const latencias = resultados.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = latencias[Math.floor(latencias.length * 0.5)];
  const p90 = latencias[Math.floor(latencias.length * 0.9)];

  console.log(`ok=${ok}/${resultados.length} p50=${p50}ms p90=${p90}ms`);
  console.log(JSON.stringify({ modo, concurrencia, ok, total: resultados.length, p50, p90 }));
}

main().catch((error) => {
  console.error('carga-local.ts abortó:', (error as Error).message);
  process.exitCode = 1;
});
