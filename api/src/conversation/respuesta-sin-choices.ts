/**
 * Cuando el proveedor del modelo bloquea o falla, OpenRouter a veces contesta
 * HTTP 200 con `{ error: { code, message, metadata } }` y sin `choices`.
 * `@langchain/openai` arma entonces una lista vacía de respuestas y
 * `@langchain/core` revienta con `TypeError: Cannot read properties of
 * undefined (reading 'message')`, que pierde el motivo y se reporta como bug
 * (Sentry TRATO-API-2, durante pruebas de seguridad por el chat).
 *
 * Este fetch envuelve el del cliente OpenAI y convierte ese 200 vacío en un
 * error HTTP con el código que trae el cuerpo, así el SDK lanza un `APIError`
 * de verdad (con `status` y `error`) y el nodo de conversación puede
 * clasificarlo.
 */

/** Marca de que el error vino de un 200 sin `choices`, no de un error HTTP real. */
export const MARCA_SIN_CHOICES = 'x-trato-sin-choices';

export function fetchQueRechazaRespuestasVacias(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const respuesta = await base(input, init);
    if (!respuesta.ok) return respuesta;
    if (!(respuesta.headers.get('content-type') ?? '').includes('application/json')) return respuesta;

    const texto = await respuesta.clone().text();
    let cuerpo: unknown;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      return respuesta;
    }
    if (!esObjeto(cuerpo)) return respuesta;
    if (Array.isArray(cuerpo.choices) && cuerpo.choices.length > 0) return respuesta;

    const codigo = esObjeto(cuerpo.error) ? cuerpo.error.code : undefined;
    const status = typeof codigo === 'number' && codigo >= 400 && codigo < 600 ? codigo : 502;
    // Headers nuevos a propósito: el original puede traer content-encoding o
    // content-length que ya no corresponden al texto decodificado.
    return new Response(texto, {
      status,
      headers: { 'content-type': 'application/json', [MARCA_SIN_CHOICES]: '1' },
    });
  };
}

export type FalloDelModelo = {
  /**
   * `rechazo_contenido`: moderación del proveedor u OpenRouter
   * (`metadata.reasons` / `flagged_input`, o un 403 que vino en un 200).
   * `sin_respuesta`: un 200 sin `choices` con otro código. `otro`: timeouts,
   * credenciales, bugs.
   */
  motivo: 'rechazo_contenido' | 'sin_respuesta' | 'otro';
  codigo?: number;
  proveedor?: string;
};

/**
 * Clasifica el error que lanzó el modelo. Sólo lee códigos y el nombre del
 * proveedor: nunca `message` ni `metadata.raw`, que pueden repetir el prompt
 * (y el prompt trae la conversación del cliente).
 */
export function clasificarFalloDelModelo(error: unknown): FalloDelModelo {
  if (!esObjeto(error)) return { motivo: 'otro' };
  const status = typeof error.status === 'number' ? error.status : undefined;
  const cuerpo = esObjeto(error.error) ? error.error : undefined;
  const metadata = cuerpo && esObjeto(cuerpo.metadata) ? cuerpo.metadata : undefined;
  const marcado = tieneMarca(error.headers);

  // Un 403 HTTP de verdad (key bloqueada, un proxy) es un problema operativo y
  // tiene que seguir siendo error: sólo cuenta como moderación si trae los
  // motivos o si vino de un 200 sin choices. Lo mismo para credenciales y
  // saldo (401/402) aunque vengan marcados.
  const conMotivos = metadata !== undefined && ('reasons' in metadata || 'flagged_input' in metadata);
  if (status === 401 || status === 402) return { motivo: 'otro' };
  const moderado = conMotivos || (status === 403 && marcado);
  if (!moderado && !marcado) return { motivo: 'otro' };

  const proveedor =
    typeof metadata?.provider_name === 'string' && /^[\w .-]{1,40}$/.test(metadata.provider_name)
      ? metadata.provider_name
      : undefined;
  return {
    motivo: moderado ? 'rechazo_contenido' : 'sin_respuesta',
    ...(status !== undefined ? { codigo: status } : {}),
    ...(proveedor ? { proveedor } : {}),
  };
}

function tieneMarca(headers: unknown): boolean {
  if (headers instanceof Headers) return headers.get(MARCA_SIN_CHOICES) === '1';
  if (esObjeto(headers)) return headers[MARCA_SIN_CHOICES] === '1';
  return false;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}
