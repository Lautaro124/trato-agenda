/**
 * La única salida a la red de la importación rápida. Cada salto (la URL que
 * escribió el dueño y cada redirección) pasa por lo mismo:
 *
 * 1. `revisarUrl`: https al puerto de siempre, un nombre y no una IP.
 * 2. DNS: todas las direcciones que devuelve tienen que ser públicas
 *    (`ipPermitida`); si una sola no lo es, no se conecta.
 * 3. La conexión va a esa dirección ya revisada (`lookup` fijo): entre la
 *    revisión y el connect no hay otro DNS que pueda cambiar la respuesta.
 * 4. Las redirecciones se siguen a mano, como mucho MAX_REDIRECCIONES, y
 *    cada una vuelve al paso 1.
 *
 * Además corta por tiempo, por tamaño (contado después de descomprimir, así
 * un gzip chico no se convierte en gigas) y por tipo de contenido.
 */
import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as requestHttp, type IncomingMessage } from 'node:http';
import { request as requestHttps } from 'node:https';
import type { LookupFunction } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Transform } from 'node:stream';
import { ipPermitida, revisarUrl } from './ssrf.rules.js';

export const MAX_REDIRECCIONES = 3;

/** Lo que puede salir mal al pedir una página, en el idioma de la pantalla de importación. */
export type CodigoDescarga =
  | 'url_invalida'
  | 'host_no_permitido'
  | 'acceso_denegado'
  | 'no_encontrada'
  | 'error_del_sitio'
  | 'tipo_no_soportado'
  | 'demasiado_grande'
  | 'tiempo_agotado'
  | 'sin_conexion';

export class DescargaError extends Error {
  constructor(readonly codigo: CodigoDescarga) {
    super(`No se pudo descargar: ${codigo}`);
    this.name = 'DescargaError';
  }
}

export type Resolver = (host: string) => Promise<LookupAddress[]>;

export type OpcionesDescarga = {
  /** Bytes del cuerpo (ya descomprimido) a partir de los cuales se corta. */
  maxBytes: number;
  /** Content-types aceptados ("text/html", "image/jpeg"…), sin parámetros. */
  tipos: readonly string[];
  timeoutMs: number;
  /** Hosts de los stubs de e2e (env IMPORTACION_HOSTS_DE_PRUEBA): pueden ser http, a cualquier puerto y a red privada. */
  hostsDePrueba?: ReadonlySet<string>;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Para los tests: el DNS. */
  resolver?: Resolver;
};

export type Descarga = {
  /** La URL final, después de las redirecciones. */
  url: URL;
  status: number;
  tipo: string;
  charset: string | null;
  cuerpo: Buffer;
};

const AGENTE = 'Mozilla/5.0 (compatible; TratoImportador/1.0; +https://tratoagenda.com)';

const resolverPorDefecto: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true });

/** Resuelve el host y devuelve una dirección ya revisada, o rechaza. */
async function direccionSegura(url: URL, opciones: OpcionesDescarga): Promise<LookupAddress> {
  const host = url.hostname.toLowerCase();
  let direcciones: LookupAddress[];
  try {
    direcciones = await (opciones.resolver ?? resolverPorDefecto)(host);
  } catch {
    throw new DescargaError('sin_conexion');
  }
  if (direcciones.length === 0) throw new DescargaError('sin_conexion');
  const dePrueba = opciones.hostsDePrueba?.has(host) ?? false;
  // Todas, no sólo la primera: si el DNS mezcla una pública con una privada, no se conecta a ninguna.
  if (!dePrueba && !direcciones.every((direccion) => ipPermitida(direccion.address))) {
    throw new DescargaError('host_no_permitido');
  }
  return direcciones[0];
}

/** El `lookup` de la conexión: siempre la dirección ya revisada, nunca un DNS nuevo. */
function lookupFijo(direccion: LookupAddress): LookupFunction {
  return (_host, opciones, callback) => {
    if ((opciones as { all?: boolean }).all) {
      (callback as unknown as (error: null, direcciones: LookupAddress[]) => void)(null, [direccion]);
    } else {
      callback(null, direccion.address, direccion.family);
    }
  };
}

function descomprimir(respuesta: IncomingMessage): IncomingMessage | Transform {
  const codificacion = String(respuesta.headers['content-encoding'] ?? '').toLowerCase().trim();
  if (codificacion === 'gzip' || codificacion === 'x-gzip') return respuesta.pipe(createGunzip());
  if (codificacion === 'deflate') return respuesta.pipe(createInflate());
  if (codificacion === 'br') return respuesta.pipe(createBrotliDecompress());
  return respuesta;
}

function codigoPorStatus(status: number): CodigoDescarga {
  if (status === 401 || status === 403 || status === 429) return 'acceso_denegado';
  if (status === 404 || status === 410) return 'no_encontrada';
  return 'error_del_sitio';
}

type Salto = { tipo: 'redireccion'; destino: string } | { tipo: 'final'; descarga: Descarga };

function pedir(url: URL, direccion: LookupAddress, opciones: OpcionesDescarga, limite: number): Promise<Salto> {
  let reloj: NodeJS.Timeout | undefined;
  return new Promise<Salto>((resolve, reject) => {
    const hacer = url.protocol === 'https:' ? requestHttps : requestHttp;
    const pedido = hacer(
      url,
      {
        method: opciones.method ?? 'GET',
        agent: false,
        lookup: lookupFijo(direccion),
        headers: {
          'user-agent': AGENTE,
          accept: opciones.tipos.join(', '),
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'es-AR,es;q=0.9',
          ...opciones.headers,
          ...(opciones.body === undefined ? {} : { 'content-length': String(Buffer.byteLength(opciones.body)) }),
        },
        timeout: opciones.timeoutMs,
      },
      (respuesta) => {
        const status = respuesta.statusCode ?? 0;
        if (status >= 300 && status < 400 && respuesta.headers.location) {
          respuesta.resume();
          resolve({ tipo: 'redireccion', destino: respuesta.headers.location });
          return;
        }
        if (status < 200 || status >= 300) {
          respuesta.resume();
          reject(new DescargaError(codigoPorStatus(status)));
          return;
        }
        const [mime, ...parametros] = String(respuesta.headers['content-type'] ?? '').split(';');
        const tipo = mime.trim().toLowerCase();
        if (!opciones.tipos.includes(tipo)) {
          respuesta.resume();
          reject(new DescargaError('tipo_no_soportado'));
          return;
        }
        const charset =
          parametros
            .map((parametro) => parametro.trim().toLowerCase())
            .find((parametro) => parametro.startsWith('charset='))
            ?.slice('charset='.length)
            .replaceAll('"', '') ?? null;
        const declarado = Number(respuesta.headers['content-length']);
        if (Number.isFinite(declarado) && declarado > limite) {
          respuesta.destroy();
          reject(new DescargaError('demasiado_grande'));
          return;
        }

        const flujo = descomprimir(respuesta);
        const partes: Buffer[] = [];
        let total = 0;
        flujo.on('data', (parte: Buffer) => {
          total += parte.length;
          if (total > limite) {
            respuesta.destroy();
            flujo.destroy();
            reject(new DescargaError('demasiado_grande'));
            return;
          }
          partes.push(parte);
        });
        flujo.on('error', () => reject(new DescargaError('error_del_sitio')));
        flujo.on('end', () =>
          resolve({ tipo: 'final', descarga: { url, status, tipo, charset, cuerpo: Buffer.concat(partes) } }),
        );
      },
    );
    // `timeout` de arriba es por inactividad del socket; esto corta aunque el sitio mande de a gotas.
    const cortar = () => {
      pedido.destroy();
      reject(new DescargaError('tiempo_agotado'));
    };
    reloj = setTimeout(cortar, opciones.timeoutMs);
    pedido.on('timeout', cortar);
    pedido.on('error', (error) => {
      reject(error instanceof DescargaError ? error : new DescargaError('sin_conexion'));
    });
    if (opciones.body !== undefined) pedido.write(opciones.body);
    pedido.end();
  }).finally(() => clearTimeout(reloj));
}

/**
 * Descarga una URL de afuera respetando todo lo de arriba. Tira DescargaError
 * con un código que la pantalla sabe explicar; nunca el contenido de la página.
 */
export async function descargar(texto: string, opciones: OpcionesDescarga): Promise<Descarga> {
  let actual = texto;
  let hostInicial: string | null = null;
  for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
    const revisada = revisarUrl(actual, opciones.hostsDePrueba);
    if ('motivo' in revisada) throw new DescargaError(revisada.motivo);
    hostInicial ??= revisada.url.hostname;
    // Un token (el de Mercado Libre) es para su host: si una redirección lleva a otro, no viaja.
    const headers =
      revisada.url.hostname === hostInicial
        ? opciones.headers
        : Object.fromEntries(Object.entries(opciones.headers ?? {}).filter(([clave]) => !/^(authorization|cookie)$/i.test(clave)));
    const direccion = await direccionSegura(revisada.url, opciones);
    const resultado = await pedir(revisada.url, direccion, { ...opciones, headers }, opciones.maxBytes);
    if (resultado.tipo === 'final') return resultado.descarga;
    // Una redirección relativa se resuelve contra la URL donde estaba, y vuelve a revisarse entera.
    try {
      actual = new URL(resultado.destino, revisada.url).href;
    } catch {
      throw new DescargaError('url_invalida');
    }
    // Un POST no se repite en otro lado: sólo los GET siguen redirecciones.
    if ((opciones.method ?? 'GET') !== 'GET') throw new DescargaError('error_del_sitio');
  }
  throw new DescargaError('error_del_sitio');
}

/** El cuerpo como texto, con el charset que dijo el servidor si es uno conocido. */
export function textoDe(descarga: Pick<Descarga, 'cuerpo' | 'charset'>): string {
  const charset = descarga.charset ?? 'utf-8';
  const conocido = ['utf-8', 'utf8', 'iso-8859-1', 'latin1', 'windows-1252'].includes(charset) ? charset : 'utf-8';
  return new TextDecoder(conocido === 'utf8' ? 'utf-8' : conocido).decode(descarga.cuerpo);
}
