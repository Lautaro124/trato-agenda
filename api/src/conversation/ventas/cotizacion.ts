/**
 * La cotización de un pedido tal como la lee el modelo (cotizar_pedido): todos
 * los montos —renglones, subtotal, envío por modalidad, total con envío,
 * efectivo y cuotas— salen calculados de acá. El modelo sólo los informa:
 * cuando los sumaba o restaba él, verificar-respuesta descartaba la respuesta y
 * el chat se trababa.
 */
import { formatearMonto } from '../../comercio/catalogo.rules.js';
import { valorDeCuota } from '../../comercio/condiciones-pago.rules.js';
import { detalleDeRenglones } from '../../comercio/ventas.rules.js';
import type { CotizacionFormasDePago } from '../../comercio/ventas.service.js';
import { destinoEnTexto } from '../../envios/envios.respuesta.js';
import { envioParaCobrar, type Modalidad, type ResolucionEnvio } from '../../envios/envios.rules.js';

const NOMBRE_MODALIDAD: Record<Modalidad, string> = {
  domicilio: 'Envío a domicilio',
  sucursal: 'Retiro en sucursal del correo',
};

/** El envío consultado junto con la cotización: la resolución y la modalidad que eligió el cliente, si eligió. */
export type EnvioDeLaCotizacion = { resolucion: ResolucionEnvio; modalidad: Modalidad | null };

function lineasDeEnvio(c: CotizacionFormasDePago, envio: EnvioDeLaCotizacion): string[] {
  const monto = (centavos: number) => formatearMonto(centavos, c.moneda);
  const { resolucion, modalidad } = envio;
  if (resolucion.estado !== 'resuelto') {
    return [
      'Envío: todavía no se puede cotizar con lo que dio el cliente (llamá consultar_envio para ver qué falta). ' +
        'Los totales de abajo son sin envío.',
    ];
  }
  const modalidades = resolucion.modalidades.filter((m) => modalidad === null || m.modalidad === modalidad);
  if (modalidades.length === 0) {
    return [`Envío: esa modalidad no se ofrece para ${destinoEnTexto(resolucion)}. Los totales de abajo son sin envío.`];
  }
  return [
    `Envío a ${destinoEnTexto(resolucion)}:`,
    ...modalidades.map((m) => {
      const nombre = NOMBRE_MODALIDAD[m.modalidad];
      if (m.estado === 'sin_cobertura') return `- ${nombre}: no llegamos a ese destino.`;
      const tarifa = envioParaCobrar(resolucion, m.modalidad, c.moneda);
      if (tarifa === null) return `- ${nombre}: el costo se confirma aparte por este chat (no va en el total).`;
      return (
        `- ${nombre}: ${tarifa > 0 ? monto(tarifa) : 'sin cargo'}; ` +
        `total con este envío ${monto(c.contadoCentavos + tarifa)}`
      );
    }),
  ];
}

/** Lo que se suma de envío a las formas de pago: sólo con una modalidad elegida y una tarifa fija. */
function envioElegido(c: CotizacionFormasDePago, envio: EnvioDeLaCotizacion | null): number {
  if (!envio?.modalidad) return 0;
  return envioParaCobrar(envio.resolucion, envio.modalidad, c.moneda) ?? 0;
}

export function formatearCotizacion(c: CotizacionFormasDePago, envio: EnvioDeLaCotizacion | null): string {
  const monto = (centavos: number) => formatearMonto(centavos, c.moneda);
  const extra = envioElegido(c, envio);
  const conEnvio = extra > 0 ? ' (con el envío elegido)' : '';
  const lineas = [
    'Cotización del pedido, calculada por el sistema. Pasásela al cliente con estos montos tal cual: no sumes, ' +
      'restes ni multipliques vos ningún importe.',
    `Productos: ${detalleDeRenglones(c.renglones, c.moneda)}. Subtotal de productos: ${monto(c.contadoCentavos)}.`,
    ...(envio ? lineasDeEnvio(c, envio) : []),
    `Formas de pago${conEnvio}:`,
    `- En un pago: ${monto(c.contadoCentavos + extra)}`,
  ];
  if (c.efectivoCentavos !== null && c.efectivoCentavos < c.contadoCentavos) {
    lineas.push(`- En efectivo: ${monto(c.efectivoCentavos + extra)} (con el descuento en efectivo, se coordina por este chat)`);
  }
  for (const plan of c.planes) {
    const total = plan.totalCentavos + extra;
    lineas.push(
      `- En ${plan.cuotas} cuotas ${plan.recargoCentavos === 0 ? 'sin interés' : 'con recargo'}: ` +
        `${plan.cuotas} cuotas de ${monto(valorDeCuota(total, plan.cuotas))} (total ${monto(total)})`,
    );
  }
  if (envio && !envio.modalidad && envio.resolucion.estado === 'resuelto') {
    lineas.push('Estas formas de pago son sin el envío: cuando elija la modalidad, volvé a llamar cotizar_pedido con ella.');
  }
  lineas.push('Si cambia productos, cantidades, destino o modalidad, volvé a llamar cotizar_pedido.');
  return lineas.join('\n');
}
