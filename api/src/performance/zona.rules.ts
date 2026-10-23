/**
 * Zona del cliente para el módulo de performance (LAU-30), como reglas
 * puras. Se guarda sólo la provincia (una clave de ZONAS) y de dónde salió,
 * nunca el número ni la dirección. Definiciones en docs/performance.md.
 *
 * - "dato": la dio el cliente en el pedido (campo provincia, o un código
 *   postal argentino con letra: la letra es la provincia).
 * - "inferida": sale de la característica de un celular argentino. Es la
 *   zona de la línea, no necesariamente la del cliente; las características
 *   que no están en la tabla quedan sin zona (mejor nada que inventar).
 *
 * Todo es local: el número nunca va a ningún servicio.
 */
import { telefonoDeJid } from '../comercio/ventas.rules.js';

export const ZONAS = {
  caba: 'Ciudad de Buenos Aires',
  amba: 'CABA o Gran Buenos Aires',
  buenos_aires: 'Buenos Aires',
  catamarca: 'Catamarca',
  chaco: 'Chaco',
  chubut: 'Chubut',
  cordoba: 'Córdoba',
  corrientes: 'Corrientes',
  entre_rios: 'Entre Ríos',
  formosa: 'Formosa',
  jujuy: 'Jujuy',
  la_pampa: 'La Pampa',
  la_rioja: 'La Rioja',
  mendoza: 'Mendoza',
  misiones: 'Misiones',
  neuquen: 'Neuquén',
  rio_negro: 'Río Negro',
  salta: 'Salta',
  san_juan: 'San Juan',
  san_luis: 'San Luis',
  santa_cruz: 'Santa Cruz',
  santa_fe: 'Santa Fe',
  santiago_del_estero: 'Santiago del Estero',
  tierra_del_fuego: 'Tierra del Fuego',
  tucuman: 'Tucumán',
} as const;
export type Zona = keyof typeof ZONAS;

export const ORIGENES_ZONA = ['dato', 'inferida'] as const;
export type OrigenZona = (typeof ORIGENES_ZONA)[number];

/** La clave que usa la lectura para los chats sin zona (no es una provincia). */
export const SIN_ZONA = 'sin_zona';

export function esZona(valor: unknown): valor is Zona {
  return typeof valor === 'string' && Object.prototype.hasOwnProperty.call(ZONAS, valor);
}

/** Minúsculas, sin tildes y con sólo letras y espacios simples. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Formas de escribir cada provincia. "capital" sola no: cada provincia tiene una. */
const ALIAS: Array<[string, Zona]> = [
  ['ciudad autonoma de buenos aires', 'caba'],
  ['ciudad de buenos aires', 'caba'],
  ['capital federal', 'caba'],
  ['caba', 'caba'],
  ['provincia de buenos aires', 'buenos_aires'],
  ['buenos aires', 'buenos_aires'],
  ['bs as', 'buenos_aires'],
  ['bsas', 'buenos_aires'],
  ['pba', 'buenos_aires'],
  ['gba', 'buenos_aires'],
  ['catamarca', 'catamarca'],
  ['chaco', 'chaco'],
  ['chubut', 'chubut'],
  ['cordoba', 'cordoba'],
  ['corrientes', 'corrientes'],
  ['entre rios', 'entre_rios'],
  ['formosa', 'formosa'],
  ['jujuy', 'jujuy'],
  ['la pampa', 'la_pampa'],
  ['la rioja', 'la_rioja'],
  ['mendoza', 'mendoza'],
  ['misiones', 'misiones'],
  ['neuquen', 'neuquen'],
  ['rio negro', 'rio_negro'],
  ['salta', 'salta'],
  ['san juan', 'san_juan'],
  ['san luis', 'san_luis'],
  ['santa cruz', 'santa_cruz'],
  ['santa fe', 'santa_fe'],
  ['santiago del estero', 'santiago_del_estero'],
  ['sgo del estero', 'santiago_del_estero'],
  ['tierra del fuego', 'tierra_del_fuego'],
  ['tdf', 'tierra_del_fuego'],
  ['tucuman', 'tucuman'],
];
// La más larga primero: "ciudad de buenos aires" antes que "buenos aires".
ALIAS.sort((a, b) => b[0].length - a[0].length);

/** "Córdoba", "cba capital"… → la provincia que nombra, o null. */
export function zonaDeTexto(texto: string): Zona | null {
  const limpio = ` ${normalizar(texto.slice(0, 200))} `;
  if (limpio.trim() === '') return null;
  for (const [alias, zona] of ALIAS) {
    if (limpio.includes(` ${alias} `)) return zona;
  }
  return null;
}

/** La letra del código postal argentino (CPA) es la provincia. */
const LETRA_CPA: Record<string, Zona> = {
  A: 'salta',
  B: 'buenos_aires',
  C: 'caba',
  D: 'san_luis',
  E: 'entre_rios',
  F: 'la_rioja',
  G: 'santiago_del_estero',
  H: 'chaco',
  J: 'san_juan',
  K: 'catamarca',
  L: 'la_pampa',
  M: 'mendoza',
  N: 'misiones',
  P: 'formosa',
  Q: 'neuquen',
  R: 'rio_negro',
  S: 'santa_fe',
  T: 'tucuman',
  U: 'chubut',
  V: 'tierra_del_fuego',
  W: 'corrientes',
  X: 'cordoba',
  Y: 'jujuy',
  Z: 'santa_cruz',
};

/**
 * "C1414BAD" → CABA. Un código de 4 números sólo se lee en la Ciudad
 * (1000–1499); fuera de eso los números se reparten entre provincias y no
 * se adivina.
 */
export function zonaDeCodigoPostal(texto: string): Zona | null {
  const limpio = texto.toUpperCase().replace(/[\s-]/g, '').slice(0, 20);
  const cpa = /^([A-Z])(\d{4})([A-Z]{3})?$/.exec(limpio);
  if (cpa) return LETRA_CPA[cpa[1]] ?? null;
  if (/^\d{4}$/.test(limpio)) {
    const numero = Number(limpio);
    return numero >= 1000 && numero <= 1499 ? 'caba' : null;
  }
  return null;
}

/** Lo que dio el cliente en el pedido: la provincia escrita gana; si no, el código postal. */
export function zonaDeDatosCliente(datos: Array<{ etiqueta: string; valor: string }>): Zona | null {
  const campo = (nombre: string) => datos.find((dato) => normalizar(dato.etiqueta) === nombre)?.valor;
  const pais = campo('pais');
  if (pais && !/^(argentina|ar|arg)$/.test(normalizar(pais))) return null;
  const provincia = campo('provincia');
  const codigoPostal = campo('codigo postal');
  return (provincia ? zonaDeTexto(provincia) : null) ?? (codigoPostal ? zonaDeCodigoPostal(codigoPostal) : null);
}

/**
 * Características de celulares argentinos con su provincia. El plan de
 * numeración no tiene prefijos que se pisen, así que se busca la más larga.
 * La 11 es todo el AMBA: no dice si es la Ciudad o el conurbano.
 */
const CARACTERISTICAS: Record<string, Zona> = {
  '11': 'amba',
  // Buenos Aires
  '220': 'buenos_aires',
  '221': 'buenos_aires',
  '223': 'buenos_aires',
  '230': 'buenos_aires',
  '236': 'buenos_aires',
  '237': 'buenos_aires',
  '249': 'buenos_aires',
  '291': 'buenos_aires',
  '336': 'buenos_aires',
  '348': 'buenos_aires',
  '2262': 'buenos_aires',
  '2281': 'buenos_aires',
  '2284': 'buenos_aires',
  '2323': 'buenos_aires',
  '2324': 'buenos_aires',
  '2346': 'buenos_aires',
  '2477': 'buenos_aires',
  '2983': 'buenos_aires',
  // Resto del país
  '260': 'mendoza',
  '261': 'mendoza',
  '263': 'mendoza',
  '264': 'san_juan',
  '266': 'san_luis',
  '2657': 'san_luis',
  '280': 'chubut',
  '297': 'chubut',
  '2945': 'chubut',
  '294': 'rio_negro',
  '298': 'rio_negro',
  '2920': 'rio_negro',
  '299': 'neuquen',
  '2954': 'la_pampa',
  '2302': 'la_pampa',
  '2966': 'santa_cruz',
  '2901': 'tierra_del_fuego',
  '2964': 'tierra_del_fuego',
  '341': 'santa_fe',
  '342': 'santa_fe',
  '3462': 'santa_fe',
  '3492': 'santa_fe',
  '343': 'entre_rios',
  '345': 'entre_rios',
  '3442': 'entre_rios',
  '3446': 'entre_rios',
  '351': 'cordoba',
  '353': 'cordoba',
  '358': 'cordoba',
  '3541': 'cordoba',
  '3564': 'cordoba',
  '362': 'chaco',
  '364': 'chaco',
  '370': 'formosa',
  '376': 'misiones',
  '3757': 'misiones',
  '379': 'corrientes',
  '380': 'la_rioja',
  '381': 'tucuman',
  '383': 'catamarca',
  '385': 'santiago_del_estero',
  '387': 'salta',
  '388': 'jujuy',
};

/**
 * "5493511234567@s.whatsapp.net" → Córdoba. Sólo celulares argentinos con
 * el 9 y los diez dígitos nacionales; cualquier otra cosa, null.
 */
export function zonaDeJid(remoteJid: string): Zona | null {
  const numero = telefonoDeJid(remoteJid);
  if (!numero || !/^549\d{10}$/.test(numero)) return null;
  const nacional = numero.slice(3);
  for (const largo of [4, 3, 2]) {
    const zona = CARACTERISTICAS[nacional.slice(0, largo)];
    if (zona) return zona;
  }
  return null;
}
