/**
 * Los datos que el asistente de ventas le pide al cliente (para el envío o lo
 * que el comercio necesite), como funciones puras igual que ventas.rules.ts.
 *
 * La configuración vive en dos columnas del `Agent` (`haceEnvios` y
 * `datosCliente`, un Json) y lo que el cliente contestó queda como foto en
 * `Venta.datosCliente` (`[{ etiqueta, valor }]`), igual que `ItemVenta`: si el
 * dueño cambia o borra un campo después, el pedido viejo no se rompe.
 *
 * El nombre no está acá: se pide siempre y va en `Venta.nombreCliente`.
 */

export const TIPOS_CAMPO_ESTANDAR = ['codigoPostal', 'direccion', 'provincia', 'pais', 'email', 'dni'] as const;
export type TipoCampoEstandar = (typeof TIPOS_CAMPO_ESTANDAR)[number];

export const TIPOS_CAMPO = [...TIPOS_CAMPO_ESTANDAR, 'personalizado'] as const;
export type TipoCampo = (typeof TIPOS_CAMPO)[number];

export const ETIQUETAS_CAMPO: Record<TipoCampoEstandar, string> = {
  codigoPostal: 'Código postal',
  direccion: 'Dirección',
  provincia: 'Provincia',
  pais: 'País',
  email: 'Email',
  dni: 'DNI',
};

/** Datos propios del comercio ("Entre calles", "Horario de entrega"). */
export const MAX_CAMPOS_PERSONALIZADOS = 5;
export const MAX_CAMPOS = TIPOS_CAMPO_ESTANDAR.length + MAX_CAMPOS_PERSONALIZADOS;
export const LARGO_MIN_ETIQUETA = 2;
export const LARGO_MAX_ETIQUETA = 40;
/** Lo que se guarda de cada respuesta del cliente: una dirección entra de sobra. */
export const LARGO_MAX_VALOR = 200;

export const ENTREGAS = ['envio', 'retiro'] as const;
export type Entrega = (typeof ENTREGAS)[number];

/** Un campo configurado, siempre con su etiqueta (la de los estándar es fija). */
export type CampoCliente = { tipo: TipoCampo; etiqueta: string; obligatorio: boolean };

/** Lo que se guarda en `Agent.datosCliente`: los estándar sin etiqueta. */
export type CampoGuardado =
  | { tipo: TipoCampoEstandar; obligatorio: boolean }
  | { tipo: 'personalizado'; etiqueta: string; obligatorio: boolean };

export type ConfigDatosCliente = { haceEnvios: boolean; campos: CampoCliente[] };

/** Una respuesta del cliente tal como queda en la venta. */
export type DatoCliente = { etiqueta: string; valor: string };

function esTipoEstandar(tipo: unknown): tipo is TipoCampoEstandar {
  return typeof tipo === 'string' && (TIPOS_CAMPO_ESTANDAR as readonly string[]).includes(tipo);
}

/** "Código Postal", "codigo_postal" y "codigoPostal" son el mismo campo. */
export function claveDeCampo(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function limpiarEtiqueta(etiqueta: string): string {
  return etiqueta.replace(/\s+/g, ' ').trim().slice(0, LARGO_MAX_ETIQUETA);
}

/**
 * Lo que manda el dueño (DTO ya validado) a lo que se guarda: sin repetidos
 * (un estándar dos veces, o un personalizado que se llama como otro campo),
 * sin etiqueta en los estándar y con el tope de personalizados.
 */
export function normalizarCampos(
  entrada: ReadonlyArray<{ tipo: string; etiqueta?: string; obligatorio: boolean }>,
): CampoGuardado[] {
  const vistas = new Set<string>();
  const campos: CampoGuardado[] = [];
  let personalizados = 0;
  for (const campo of entrada) {
    const obligatorio = campo.obligatorio === true;
    if (esTipoEstandar(campo.tipo)) {
      const clave = claveDeCampo(ETIQUETAS_CAMPO[campo.tipo]);
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      campos.push({ tipo: campo.tipo, obligatorio });
    } else if (campo.tipo === 'personalizado' && typeof campo.etiqueta === 'string') {
      const etiqueta = limpiarEtiqueta(campo.etiqueta);
      const clave = claveDeCampo(etiqueta);
      if (etiqueta.length < LARGO_MIN_ETIQUETA || !clave || vistas.has(clave)) continue;
      if (personalizados >= MAX_CAMPOS_PERSONALIZADOS) continue;
      vistas.add(clave);
      personalizados++;
      campos.push({ tipo: 'personalizado', etiqueta, obligatorio });
    }
  }
  return campos;
}

/**
 * `Agent.datosCliente` es Json: se valida la forma al leer en vez de castear,
 * igual que `leerTiposEvento`. Lo que no cierra se descarta sin romper.
 */
export function leerCamposCliente(json: unknown): CampoCliente[] {
  if (!Array.isArray(json)) return [];
  const crudos = json.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const { tipo, etiqueta, obligatorio } = item as Record<string, unknown>;
    if (typeof tipo !== 'string' || typeof obligatorio !== 'boolean') return [];
    return [{ tipo, etiqueta: typeof etiqueta === 'string' ? etiqueta : undefined, obligatorio }];
  });
  return normalizarCampos(crudos).map((campo) =>
    campo.tipo === 'personalizado' ? campo : { ...campo, etiqueta: ETIQUETAS_CAMPO[campo.tipo] },
  );
}

export function leerConfigDatosCliente(agent: { haceEnvios: boolean; datosCliente: unknown }): ConfigDatosCliente {
  return { haceEnvios: agent.haceEnvios === true, campos: leerCamposCliente(agent.datosCliente) };
}

/** `Venta.datosCliente`, leído con la misma tolerancia. */
export function leerDatosDeVenta(json: unknown): DatoCliente[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const { etiqueta, valor } = item as Record<string, unknown>;
    if (typeof etiqueta !== 'string' || typeof valor !== 'string') return [];
    return [{ etiqueta, valor }];
  });
}

export function leerEntrega(valor: unknown): Entrega | null {
  return valor === 'envio' || valor === 'retiro' ? valor : null;
}

/** ¿El asistente tiene algo que preguntar además del nombre? */
export function pideDatos(config: ConfigDatosCliente): boolean {
  return config.haceEnvios || config.campos.length > 0;
}

/**
 * Qué campos corresponden a este pedido: si el comercio hace envíos, sólo
 * cuando es con envío (el que retira no da su dirección); si no hace, siempre.
 */
export function camposAPedir(config: ConfigDatosCliente, entrega: Entrega | null): CampoCliente[] {
  if (config.haceEnvios && entrega !== 'envio') return [];
  return config.campos;
}

// Las etiquetas del dominio no llevan puntos: sin cuantificadores superpuestos, no hay backtracking (ReDoS).
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;
const DNI = /^\d{6,10}$/;

/** Corrige lo que se puede corregir sin adivinar (puntos del DNI) o devuelve el problema. */
function revisarValor(campo: CampoCliente, valor: string): { valor: string } | { problema: string } {
  if (campo.tipo === 'email') {
    return EMAIL.test(valor) ? { valor } : { problema: `el email ${JSON.stringify(valor)} no parece válido` };
  }
  if (campo.tipo === 'dni') {
    const digitos = valor.replace(/[\s.-]/g, '');
    return DNI.test(digitos) ? { valor: digitos } : { problema: `el DNI ${JSON.stringify(valor)} no parece válido` };
  }
  return { valor };
}

export type ResultadoDatosPedido =
  | { ok: true; entrega: Entrega | null; datos: DatoCliente[] }
  | { ok: false; motivo: string };

/**
 * Lo que mandó el modelo en `crear_pedido` contra lo que el comercio pide.
 * Los campos se emparejan por etiqueta (sin tildes ni mayúsculas); lo que no
 * está configurado se ignora, así el asistente no puede guardar datos que el
 * dueño no pidió.
 */
export function validarDatosPedido(
  config: ConfigDatosCliente,
  args: { entrega?: unknown; datosCliente?: unknown },
): ResultadoDatosPedido {
  if (!pideDatos(config)) return { ok: true, entrega: null, datos: [] };

  let entrega: Entrega | null = null;
  if (config.haceEnvios) {
    entrega = leerEntrega(args.entrega);
    if (!entrega) {
      return {
        ok: false,
        motivo:
          'Falta saber si lo quiere con envío o si lo retira: preguntáselo y mandá entrega "envio" o "retiro" ' +
          'en crear_pedido.',
      };
    }
  }

  const campos = camposAPedir(config, entrega);
  const recibidos = new Map<string, string>();
  for (const dato of Array.isArray(args.datosCliente) ? args.datosCliente : []) {
    if (typeof dato !== 'object' || dato === null) continue;
    const { campo, valor } = dato as Record<string, unknown>;
    if (typeof campo !== 'string' || typeof valor !== 'string') continue;
    const limpio = valor.replace(/\s+/g, ' ').trim().slice(0, LARGO_MAX_VALOR);
    if (limpio) recibidos.set(claveDeCampo(campo), limpio);
  }

  const datos: DatoCliente[] = [];
  const faltan: string[] = [];
  const problemas: string[] = [];
  for (const campo of campos) {
    const valor =
      recibidos.get(claveDeCampo(campo.etiqueta)) ?? (campo.tipo !== 'personalizado' ? recibidos.get(claveDeCampo(campo.tipo)) : undefined);
    if (!valor) {
      if (campo.obligatorio) faltan.push(JSON.stringify(campo.etiqueta));
      continue;
    }
    const revisado = revisarValor(campo, valor);
    if ('problema' in revisado) {
      if (campo.obligatorio) problemas.push(revisado.problema);
      // Un opcional mal escrito no traba la venta: se descarta.
      continue;
    }
    datos.push({ etiqueta: campo.etiqueta, valor: revisado.valor });
  }

  if (faltan.length > 0 || problemas.length > 0) {
    const partes = [
      ...(faltan.length > 0 ? [`faltan ${faltan.join(', ')}`] : []),
      ...problemas,
    ];
    return {
      ok: false,
      motivo:
        `No se puede crear el pedido todavía: ${partes.join('; ')}. Pedíselo al cliente en un solo mensaje y ` +
        'volvé a llamar crear_pedido con todos sus datos.',
    };
  }
  return { ok: true, entrega, datos };
}

function listarCampos(campos: CampoCliente[]): string {
  return campos
    .map((campo) => `${JSON.stringify(campo.etiqueta)} (${campo.obligatorio ? 'obligatorio' : 'opcional'})`)
    .join(', ');
}

/**
 * El renglón de las reglas de venta sobre la entrega y los datos, o null si
 * el comercio no pide nada. Las etiquetas van con `JSON.stringify` porque
 * algunas las escribió el dueño: el modelo las lee como dato.
 */
export function reglaDeDatosCliente(config: ConfigDatosCliente, titular: string): string | null {
  if (!pideDatos(config)) return null;
  const comoMandarlos =
    'Mandalos en "datosCliente" de crear_pedido, cada uno con el nombre del dato tal cual figura acá. Sin los ' +
    'obligatorios no se puede crear el pedido; si no quiere dar uno opcional, seguí sin él. Si ya te los dio en ' +
    'esta charla no se los vuelvas a pedir, y no le pidas ningún dato que no esté en esta lista.';
  const lineas: string[] = [];
  if (config.haceEnvios) {
    lineas.push(
      `- ${titular} hace envíos. Cuando el cliente ya eligió todo, antes de crear el pedido preguntale si lo ` +
        'quiere con envío o si lo retira, y mandá la respuesta en "entrega" de crear_pedido ("envio" o "retiro").',
    );
    if (config.campos.length > 0) {
      lineas.push(
        `- Si es con envío, pedile en un solo mensaje (puede ser la única pregunta con varias cosas): ` +
          `${listarCampos(config.campos)}. ${comoMandarlos} Si lo retira, no se los pidas.`,
      );
    }
  } else {
    lineas.push(
      `- Cuando el cliente ya eligió todo, antes de crear el pedido pedile en un solo mensaje (puede ser la única ` +
        `pregunta con varias cosas): ${listarCampos(config.campos)}. ${comoMandarlos}`,
    );
  }
  return lineas.join('\n');
}

/** "Código postal: 1414 · Dirección: Corrientes 1234", para el CSV y el chat del dueño. */
export function resumenDeDatos(datos: DatoCliente[]): string {
  return datos.map((dato) => `${dato.etiqueta}: ${dato.valor}`).join(' · ');
}
