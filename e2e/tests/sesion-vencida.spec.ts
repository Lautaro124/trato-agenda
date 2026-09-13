import { API_URL } from '../entorno';
import { esperarRuta, expect, test } from './fixtures';

/**
 * G-001: una sesión vencida (cookie inválida) no puede usar el banco de
 * pruebas del Home ni ninguna pantalla con guard. G-003 (suscripción vencida
 * en la entrada del Home) queda como hueco documentado: no hay hoy un gancho
 * de test para forzar `estadoDeSuscripcion` a "vencida" sin acceso directo a
 * la base o al reloj del servidor — ver matriz-cobertura.csv.
 */
test.describe('sesión vencida', () => {
  test('un JWT inválido en la cookie da 401 en el banco de pruebas del Home', async ({ context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();

    // Reemplaza la cookie de sesión válida por un JWT con firma inventada.
    const cookies = await context.cookies();
    const sesion = cookies.find((c) => c.name === 'trato_session');
    expect(sesion, 'no se encontró la cookie trato_session tras loginDev').toBeDefined();

    await context.addCookies([{ ...sesion!, value: `${sesion!.value}manipulado` }]);

    const respuesta = await context.request.post(`${API_URL}/conversation/test`, { data: { message: 'hola' } });
    expect(respuesta.status()).toBe(401);
  });

  test('sin cookie de sesión, una pantalla con guard redirige a /entrar', async ({ page }) => {
    await page.goto('/inicio');
    await esperarRuta(page, '/entrar');
  });
});
