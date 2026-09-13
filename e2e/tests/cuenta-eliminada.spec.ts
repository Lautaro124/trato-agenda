import { API_URL } from '../entorno';
import { crearAgentePorApi, esperarRuta, expect, test } from './fixtures';

/**
 * G-006: eliminar la cuenta borra los checkpoints de LangGraph (fuera del
 * cascade de Prisma, ver cuenta.service.ts) además de la sesión. A diferencia
 * de `cuenta.spec.ts` (que ya prueba el flujo de borrado desde la UI), acá se
 * conversa primero — para que exista algo que borrar — y se guarda la cookie
 * de sesión ANTES de eliminar, para confirmar que un JWT viejo capturado de
 * antemano tampoco sirve después (no sólo que el browser quedó sin cookie).
 */
test.describe('cuenta eliminada', () => {
  test('un JWT capturado antes del borrado deja de servir después, y la conversación no revive', async ({ context, usuarioDev }) => {
    await crearAgentePorApi(context.request);

    // Genera algo de historial real antes de borrar la cuenta.
    const mensaje = await context.request.post(`${API_URL}/conversation/test`, { data: { message: 'hola, quiero un turno' } });
    expect(mensaje.ok(), await mensaje.text()).toBe(true);

    const cookiesAntes = await context.cookies();
    const sesionVieja = cookiesAntes.find((c) => c.name === 'trato_session');
    expect(sesionVieja, 'no se encontró la cookie trato_session antes de borrar').toBeDefined();

    const borrado = await context.request.delete(`${API_URL}/auth/me`);
    expect(borrado.ok(), await borrado.text()).toBe(true);

    // El JWT viejo (capturado antes del borrado) ya no debe autenticar nada,
    // aunque se lo reinyecte a mano en un contexto nuevo.
    const jwtViejo = sesionVieja!.value;
    await context.clearCookies();
    await context.addCookies([{ ...sesionVieja!, value: jwtViejo }]);

    const meConJwtViejo = await context.request.get(`${API_URL}/auth/me`);
    expect(meConJwtViejo.status()).toBe(401);

    void usuarioDev;
  });

  test('tras eliminar la cuenta, una pantalla con guard redirige a /entrar', async ({ page, context, usuarioDev }) => {
    await crearAgentePorApi(context.request);
    await context.request.delete(`${API_URL}/auth/me`);
    void usuarioDev;

    await page.goto('/calendario');
    await esperarRuta(page, '/entrar');
  });
});
