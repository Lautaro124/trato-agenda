import { API_URL } from '../entorno';
import { crearAgentePorApi, expect, test } from './fixtures';

/**
 * Contra OpenRouter de verdad (`npm run e2e:real`, stack SIN el override de
 * e2e). Cuesta centavos por corrida. La generación del agente ya no depende
 * de OpenRouter (plantilla determinista, cubierto sin costo en
 * `generacion-escritorio.spec.ts`): lo único que sigue necesitando un modelo
 * real acá es la charla por WhatsApp/Home.
 */
test.describe('conversación contra OpenRouter real', { tag: '@real' }, () => {
  test('el agente creado por la plantilla contesta con un modelo real', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgentePorApi(context.request);

    const res = await context.request.post(`${API_URL}/conversation/test`, {
      data: { message: 'Hola! ¿Qué tipos de turno tomás?' },
      timeout: 120_000,
    });
    expect(res.ok(), await res.text()).toBe(true);

    // El texto del modelo no es determinista: se chequea que conteste algo.
    const { reply } = (await res.json()) as { reply: string };
    console.log(`Respuesta real del agente: ${reply}`);
    expect(reply.trim().length).toBeGreaterThan(0);
    expect(reply).not.toContain('Perdón, tuve un problema para responderte');
  });
});
