/**
 * Qué direcciones puede pedir la importación rápida. Las URLs las escribe el
 * dueño (o salen de una página que importa), así que sin esto la API sería un
 * proxy hacia su propia red: la base, la metadata de la nube, otros servicios
 * de Railway. Todo acá es puro; la descarga (fetch-seguro.ts) lo aplica a
 * cada salto, después de resolver el DNS y antes de conectar.
 *
 * Es una lista de permitidos, no de prohibidos: en IPv4 sólo pasa lo que no
 * está en ningún rango especial, y en IPv6 sólo lo global unicast (2000::/3)
 * fuera de sus rangos reservados. Las formas de esconder una IPv4 adentro de
 * una IPv6 (mapeada, NAT64, 6to4) se desenvuelven y se revisa la IPv4.
 */
import { isIP } from 'node:net';

/** Una URL no entra si es más larga que esto. */
export const LARGO_MAX_URL = 2048;

/** Rangos IPv4 que nunca se piden: privados, loopback, link-local, CGNAT, documentación, multicast, reservados. */
const RANGOS_IPV4_BLOQUEADOS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/** Dentro de 2000::/3 (lo único global), los rangos que igual no son de nadie a quien pedirle una página. */
const RANGOS_IPV6_BLOQUEADOS: ReadonlyArray<readonly [string, number]> = [
  ['2001::', 23], // asignaciones de protocolo de la IETF, Teredo incluido
  ['2001:db8::', 32], // documentación
  ['3fff::', 20], // documentación
];

function bytesIpv4(ip: string): number[] | null {
  const partes = ip.split('.');
  if (partes.length !== 4) return null;
  const bytes = partes.map((parte) => (/^\d{1,3}$/.test(parte) ? Number(parte) : NaN));
  return bytes.every((byte) => Number.isInteger(byte) && byte <= 255) ? bytes : null;
}

/** Una IPv6 en texto (con "::" y con una IPv4 al final, si la trae) → sus 16 bytes. */
export function bytesIpv6(ip: string): number[] | null {
  let texto = ip.toLowerCase();
  const zona = texto.indexOf('%');
  if (zona !== -1) texto = texto.slice(0, zona);
  let colaIpv4: number[] = [];
  const ultimoDosPuntos = texto.lastIndexOf(':');
  if (texto.slice(ultimoDosPuntos + 1).includes('.')) {
    const ipv4 = bytesIpv4(texto.slice(ultimoDosPuntos + 1));
    if (!ipv4) return null;
    colaIpv4 = ipv4;
    texto = `${texto.slice(0, ultimoDosPuntos + 1)}0:0`;
  }
  const mitades = texto.split('::');
  if (mitades.length > 2) return null;
  const grupos = (parte: string) => (parte === '' ? [] : parte.split(':'));
  const izquierda = grupos(mitades[0]);
  const derecha = mitades.length === 2 ? grupos(mitades[1]) : [];
  const faltan = 8 - izquierda.length - derecha.length;
  if (mitades.length === 2 ? faltan < 1 : faltan !== 0) return null;
  const todos = [...izquierda, ...Array<string>(mitades.length === 2 ? faltan : 0).fill('0'), ...derecha];
  const bytes: number[] = [];
  for (const grupo of todos) {
    if (!/^[0-9a-f]{1,4}$/.test(grupo)) return null;
    const valor = parseInt(grupo, 16);
    bytes.push(valor >> 8, valor & 0xff);
  }
  if (colaIpv4.length === 4) bytes.splice(12, 4, ...colaIpv4);
  return bytes;
}

function enRango(bytes: number[], base: number[], prefijo: number): boolean {
  for (let bit = 0; bit < prefijo; bit++) {
    const byte = bit >> 3;
    const mascara = 0x80 >> (bit & 7);
    if ((bytes[byte] & mascara) !== (base[byte] & mascara)) return false;
  }
  return true;
}

function ipv4Permitida(bytes: number[]): boolean {
  return !RANGOS_IPV4_BLOQUEADOS.some(([base, prefijo]) => enRango(bytes, bytesIpv4(base) as number[], prefijo));
}

/**
 * La IPv4 escondida en una IPv6, si la hay: mapeada (::ffff:a.b.c.d), NAT64
 * (64:ff9b::/96) o 6to4 (2002::/16). Null si no esconde ninguna.
 */
function ipv4Envuelta(bytes: number[]): number[] | null {
  const ceros = (desde: number, hasta: number) => bytes.slice(desde, hasta).every((byte) => byte === 0);
  if (ceros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12, 16);
  if (enRango(bytes, bytesIpv6('64:ff9b::') as number[], 96)) return bytes.slice(12, 16);
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6);
  return null;
}

/** Si se le puede pedir una página a esta IP (la que devolvió el DNS). */
export function ipPermitida(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const bytes = bytesIpv4(ip);
    return bytes !== null && ipv4Permitida(bytes);
  }
  if (version !== 6) return false;
  const bytes = bytesIpv6(ip);
  if (!bytes) return false;
  const ipv4 = ipv4Envuelta(bytes);
  if (ipv4) return ipv4Permitida(ipv4);
  // Fuera de 2000::/3 no hay nada público: loopback, link-local, ULA, multicast, NAT64 local, etc.
  if ((bytes[0] & 0xe0) !== 0x20) return false;
  return !RANGOS_IPV6_BLOQUEADOS.some(([base, prefijo]) => enRango(bytes, bytesIpv6(base) as number[], prefijo));
}

/** Nombres que nunca son de internet aunque el DNS los resuelva a algo público. */
function nombreInterno(host: string): boolean {
  return (
    host === 'localhost' ||
    !host.includes('.') ||
    ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.railway.internal'].some((sufijo) => host.endsWith(sufijo))
  );
}

export type MotivoUrlRechazada = 'url_invalida' | 'host_no_permitido';

/**
 * Lo que se le puede pedir a una URL antes de tocar la red: https al puerto
 * de siempre, sin usuario ni contraseña, con un nombre (nunca una IP escrita)
 * que no sea interno. Los `hostsDePrueba` (sólo fuera de producción, ver
 * env.ts) pueden ir por http y a cualquier puerto: son los stubs de los e2e.
 */
export function revisarUrl(
  texto: string,
  hostsDePrueba: ReadonlySet<string> = new Set(),
): { url: URL } | { motivo: MotivoUrlRechazada } {
  if (typeof texto !== 'string' || texto.length === 0 || texto.length > LARGO_MAX_URL) return { motivo: 'url_invalida' };
  let url: URL;
  try {
    url = new URL(texto.trim());
  } catch {
    return { motivo: 'url_invalida' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { motivo: 'url_invalida' };
  if (url.username || url.password) return { motivo: 'host_no_permitido' };
  const host = url.hostname.toLowerCase();
  const dePrueba = hostsDePrueba.has(host);
  if (!dePrueba) {
    if (url.protocol !== 'https:' || url.port !== '') return { motivo: 'host_no_permitido' };
    // Una IP escrita (en cualquiera de sus formas) no tiene nombre que revisar: no se acepta.
    if (host.startsWith('[') || isIP(host) !== 0 || /^[\d.]+$/.test(host) || /^0x/i.test(host)) {
      return { motivo: 'host_no_permitido' };
    }
    if (nombreInterno(host)) return { motivo: 'host_no_permitido' };
  }
  url.hash = '';
  return { url };
}
