import { API_URL } from '../entorno';
import { expect, test } from './fixtures';
import { crearAgenteVentasPorApi } from './ventas';

type Rango = { primerDia: string; ultimoDia: string };

/** "30/9 al 29/10", como lo escribe la pantalla. */
const legible = ({ primerDia, ultimoDia }: Rango) => {
  const corto = (dia: string) => `${Number(dia.slice(8, 10))}/${Number(dia.slice(5, 7))}`;
  return `${corto(primerDia)} al ${corto(ultimoDia)}`;
};

test.describe('rendimiento comparado con el período anterior', () => {
  test('muestra las fechas de los dos períodos, sin comparación inventada y el día a día', async ({ page, context, usuarioDev }) => {
    expect(usuarioDev.email).toBeTruthy();
    await crearAgenteVentasPorApi(context.request);

    // Una cuenta recién creada no tiene chats: el período anterior no tiene datos.
    const res = await context.request.get(`${API_URL}/performance`);
    expect(res.ok(), await res.text()).toBe(true);
    const performance = (await res.json()) as {
      rango: Rango;
      porDia: Array<{ dia: string; chats: number }>;
      anterior: { rango: Rango; datos: string; conversion: unknown; porDia: unknown };
    };
    expect(performance.porDia).toHaveLength(30);
    expect(performance.anterior).toMatchObject({ datos: 'sin_datos', conversion: null, porDia: null });

    await page.goto('/rendimiento');
    await expect(page.getByText('Comparando dos períodos de 30 días')).toBeVisible();
    await expect(page.getByText(legible(performance.rango))).toBeVisible();
    await expect(page.getByText(legible(performance.anterior.rango))).toBeVisible();
    // Sin datos del anterior no hay variación: ni 0 % ni "Nuevo".
    await expect(page.getByText('Sin comparación').first()).toBeVisible();
    await expect(page.getByText('Nuevo · antes 0')).toHaveCount(0);

    const diaADia = page.getByRole('region', { name: 'Día a día' });
    await expect(diaADia).toBeVisible();
    await diaADia.getByRole('radiogroup', { name: 'Qué muestra el gráfico' }).getByText('Cobrado').click();
    await expect(diaADia.getByRole('radio', { name: 'Cobrado' })).toBeChecked();
    await diaADia.getByRole('button', { name: 'Ver como tabla' }).click();
    // Un renglón por día, más el encabezado.
    await expect(diaADia.getByRole('row')).toHaveCount(31);
  });
});
