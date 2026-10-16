/**
 * La cotización del asistente (LAU-26) como función pura: receta del
 * producto + insumos y configuración del dueño + respuestas del cliente →
 * renglones y total en centavos enteros. **Nunca adivina**: un dato que
 * falta, un insumo que ya no existe o una cuenta imposible devuelven
 * `ok: false` con el motivo, y el pedido queda para que lo cotice el dueño.
 *
 * El orden de la cuenta:
 * 1. Cada renglón de la receta que aplica (sin condición, o con la opción
 *    elegida): cantidad (fórmula) × costo por unidad del insumo.
 * 2. Los extras fijos y de cuenta del producto, si aplican.
 * 3. Los porcentajes, en orden (los del producto y después los generales),
 *    cada uno sobre lo que va sumando: "Ganancia 40 %" y después "IVA 21 %"
 *    es el IVA sobre el precio con ganancia.
 * 4. Los extras fijos generales y el redondeo para arriba, como renglón aparte
 *    para que los renglones siempre sumen el total.
 */
import { claveDeCampo } from './datos-cliente.rules.js';
import { evaluarFormula, parsearFormula } from './formula.rules.js';
import {
  ETIQUETA_UNIDAD,
  recetaConContenido,
  type Condicion,
  type ConfigCotizacion,
  type Extra,
  type Insumo,
  type Receta,
} from './costos.rules.js';
import { redondearCantidad, subtotalDe, TOTAL_MAX_CENTAVOS, type RenglonPresupuesto } from './presupuesto.rules.js';
import { leerNumero, type RespuestaSolicitud, type SolicitudADemanda } from './solicitud.rules.js';

export type Cotizacion = {
  ok: true;
  renglones: RenglonPresupuesto[];
  totalCentavos: number;
  /** Los datos con que se calculó, para guardarlos con el presupuesto. */
  valores: Record<string, number>;
};

export type CotizacionFallida = {
  ok: false;
  motivo: string;
  /** Preguntas que hacen falta y no se contestaron (o no son un número). */
  faltan: string[];
};

export type EntradaCotizacion = {
  receta: Receta | null;
  solicitud: SolicitudADemanda | null;
  insumos: ReadonlyMap<string, Insumo>;
  config: ConfigCotizacion;
  respuestas: RespuestaSolicitud[];
};

function falla(motivo: string, faltan: string[] = []): CotizacionFallida {
  return { ok: false, motivo, faltan };
}

/** Los números que contestó el cliente, por dato; y las preguntas de número que faltan. */
function valoresDe(solicitud: SolicitudADemanda | null, respuestas: RespuestaSolicitud[]) {
  const porPregunta = new Map(respuestas.map((dato) => [claveDeCampo(dato.pregunta), dato.respuesta]));
  const valores: Record<string, number> = {};
  const sinNumero = new Map<string, string>();
  for (const pregunta of solicitud?.preguntas ?? []) {
    if (!pregunta.numero) continue;
    const respuesta = porPregunta.get(claveDeCampo(pregunta.texto));
    const numero = respuesta === undefined ? null : leerNumero(respuesta);
    if (numero === null) sinNumero.set(pregunta.numero.variable, pregunta.texto);
    else valores[pregunta.numero.variable] = numero;
  }
  return { valores, sinNumero, porPregunta };
}

function aplica(cuando: Condicion | undefined, porPregunta: Map<string, string>): boolean {
  if (!cuando) return true;
  const respuesta = porPregunta.get(claveDeCampo(cuando.pregunta));
  return respuesta !== undefined && claveDeCampo(respuesta) === claveDeCampo(cuando.opcion);
}

type Calculo = { ok: true; valor: number } | CotizacionFallida;

/** Evalúa una fórmula ya validada; un dato sin contestar es "falta", no un cero. */
function calcular(texto: string, valores: Record<string, number>, sinNumero: Map<string, string>, donde: string): Calculo {
  const parseo = parsearFormula(texto, new Set([...Object.keys(valores), ...sinNumero.keys()]));
  if (!parseo.ok) return falla(`La cuenta de ${donde} no es válida: ${parseo.error}`);
  const faltan = parseo.variables.filter((variable) => sinNumero.has(variable)).map((variable) => sinNumero.get(variable) as string);
  if (faltan.length > 0) {
    return falla(`Falta que el cliente conteste ${faltan.map((texto) => JSON.stringify(texto)).join(', ')} con un número.`, faltan);
  }
  const resultado = evaluarFormula(parseo.ast, valores);
  if (!resultado.ok) return falla(`La cuenta de ${donde} no da: ${resultado.error}`);
  return resultado;
}

function extraFijo(nombre: string, centavos: number): RenglonPresupuesto {
  return { concepto: nombre, tipo: 'extra', cantidad: 1, unidad: '', precioUnitarioCentavos: centavos, subtotalCentavos: centavos };
}

export function cotizar(entrada: EntradaCotizacion): Cotizacion | CotizacionFallida {
  const { receta, insumos, config } = entrada;
  if (!recetaConContenido(receta)) return falla('Este producto no tiene receta de cotización.');
  const { valores, sinNumero, porPregunta } = valoresDe(entrada.solicitud, entrada.respuestas);
  const renglones: RenglonPresupuesto[] = [];

  for (const renglon of receta.renglones) {
    if (!aplica(renglon.cuando, porPregunta)) continue;
    const insumo = insumos.get(renglon.insumoId);
    if (!insumo || !insumo.activo) return falla('La receta usa un material o costo que ya no está cargado.');
    const cantidad = calcular(renglon.cantidad, valores, sinNumero, JSON.stringify(insumo.nombre));
    if (!cantidad.ok) return cantidad;
    if (cantidad.valor < 0) return falla(`La cantidad de ${JSON.stringify(insumo.nombre)} da negativa.`);
    const exacta = redondearCantidad(cantidad.valor);
    if (exacta === 0) continue;
    renglones.push({
      concepto: insumo.nombre,
      tipo: insumo.tipo,
      cantidad: exacta,
      unidad: ETIQUETA_UNIDAD[insumo.unidad],
      precioUnitarioCentavos: insumo.costoCentavos,
      subtotalCentavos: subtotalDe(exacta, insumo.costoCentavos),
    });
  }

  const delProducto = receta.extras.filter((extra) => aplica(extra.cuando, porPregunta));
  for (const extra of delProducto) {
    if (extra.modo === 'fijo') renglones.push(extraFijo(extra.nombre, extra.valor));
    if (extra.modo === 'formula') {
      const pesos = calcular(extra.formula ?? '', valores, sinNumero, JSON.stringify(extra.nombre));
      if (!pesos.ok) return pesos;
      if (pesos.valor < 0) return falla(`${JSON.stringify(extra.nombre)} da negativo.`);
      const centavos = Math.round(pesos.valor * 100);
      if (centavos > 0) renglones.push(extraFijo(extra.nombre, centavos));
    }
  }

  const porcentajes: Extra[] = [
    ...delProducto.filter((extra) => extra.modo === 'porcentaje'),
    ...config.extras.filter((extra) => extra.modo === 'porcentaje'),
  ];
  let acumulado = renglones.reduce((suma, renglon) => suma + renglon.subtotalCentavos, 0);
  for (const extra of porcentajes) {
    const centavos = Math.round((acumulado * extra.valor) / 100);
    if (centavos <= 0) continue;
    renglones.push({ ...extraFijo(`${extra.nombre} (${String(extra.valor).replace('.', ',')} %)`, centavos) });
    acumulado += centavos;
  }
  for (const extra of config.extras) {
    if (extra.modo === 'fijo') {
      renglones.push(extraFijo(extra.nombre, extra.valor));
      acumulado += extra.valor;
    }
  }

  if (config.redondeoCentavos > 1 && acumulado > 0) {
    const redondeado = Math.ceil(acumulado / config.redondeoCentavos) * config.redondeoCentavos;
    if (redondeado > acumulado) {
      renglones.push(extraFijo('Redondeo', redondeado - acumulado));
      acumulado = redondeado;
    }
  }

  if (acumulado <= 0) return falla('La cotización da cero: revisá la receta y los costos.');
  if (acumulado > TOTAL_MAX_CENTAVOS) return falla('La cotización da un total demasiado alto.');
  return { ok: true, renglones, totalCentavos: acumulado, valores };
}
