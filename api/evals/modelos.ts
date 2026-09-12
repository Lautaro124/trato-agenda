/**
 * Lista corta de modelos a comparar. Todos soportan tools + reasoning +
 * structured outputs en OpenRouter (precios de 2026-09-11, USD por millón de
 * tokens de entrada / salida):
 *
 * - google/gemma-4-31b-it         0.09 / 0.34  el actual, base de comparación
 * - google/gemma-4-26b-a4b-it     0.04 / 0.22  MoE con 4B activos: misma familia, más rápido
 * - deepseek/deepseek-v4-flash    0.09 / 0.17  razonamiento híbrido, muchos proveedores
 * - openai/gpt-oss-120b           0.04 / 0.17  MoE, reasoning.effort nativo
 * - qwen/qwen3.8-flash            0.15 / 0.47  buen tool calling
 * - google/gemini-3.1-flash-lite  0.25 / 1.50  latencia baja, buen español; el más caro
 * - inception/mercury-2.5         0.04 / 0.15  difusión, muy rápido; recién salido
 *
 * El sufijo `:nitro` le pide a OpenRouter el proveedor con más throughput.
 */
export const MODELOS_POR_DEFECTO = [
  'google/gemma-4-31b-it',
  'google/gemma-4-26b-a4b-it',
  'deepseek/deepseek-v4-flash',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-flash',
  'google/gemini-3.1-flash-lite',
  'inception/mercury-2.5',
];

/**
 * `EVAL_MODELOS=a,b,c` pisa la lista. `EVAL_NITRO=1` suma la variante `:nitro`
 * de cada uno (duplica el costo de la corrida).
 */
export function modelosDelEval(): string[] {
  const elegidos = (process.env.EVAL_MODELOS ?? '')
    .split(',')
    .map((modelo) => modelo.trim())
    .filter(Boolean);
  const base = elegidos.length > 0 ? elegidos : MODELOS_POR_DEFECTO;
  if (process.env.EVAL_NITRO !== '1') return base;
  return base.flatMap((modelo) => (modelo.endsWith(':nitro') ? [modelo] : [modelo, `${modelo}:nitro`]));
}

export const HAY_CLAVE = Boolean(process.env.OPENROUTER_API_KEY);
