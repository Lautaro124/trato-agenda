/**
 * Catálogo geográfico del módulo de envíos: provincias y localidades de
 * Georef (georef-ar.data.ts), en memoria. Sólo identifica lugares por su id
 * estable; nunca decide una coincidencia dudosa: las devuelve como
 * sugerencias para que el cliente (o el dueño) elija.
 */
import { LOCALIDADES, PROVINCIAS } from './georef-ar.data.js';
import {
  ALIAS_PROVINCIAS,
  distancia,
  normalizar,
  parsearCodigoPostal,
  sinPrefijoProvincia,
  toleranciaDeTipeo,
} from './normalizacion.js';

export type Provincia = { id: string; nombre: string };
export type Localidad = { id: string; nombre: string; provinciaId: string; departamento: string };

const provincias: Provincia[] = PROVINCIAS.map(([id, nombre]) => ({ id, nombre }));
const provinciaPorId = new Map(provincias.map((p) => [p.id, p]));
const localidades: Localidad[] = LOCALIDADES.map(([id, nombre, provinciaId, departamento]) => ({
  id,
  nombre,
  provinciaId,
  departamento,
}));
const localidadPorId = new Map(localidades.map((l) => [l.id, l]));
const normalizadas = localidades.map((l) => normalizar(l.nombre));
const localidadesPorNombre = new Map<string, Localidad[]>();
localidades.forEach((l, i) => {
  const lista = localidadesPorNombre.get(normalizadas[i]) ?? [];
  lista.push(l);
  localidadesPorNombre.set(normalizadas[i], lista);
});

/** Nombre normalizado → provincias que lo llevan (oficial o alias). */
const provinciasPorNombre = new Map<string, string[]>();
function agregarNombreProvincia(nombre: string, id: string): void {
  const lista = provinciasPorNombre.get(nombre) ?? [];
  if (!lista.includes(id)) lista.push(id);
  provinciasPorNombre.set(nombre, lista);
}
for (const p of provincias) agregarNombreProvincia(normalizar(p.nombre), p.id);
for (const [id, alias] of Object.entries(ALIAS_PROVINCIAS)) for (const a of alias) agregarNombreProvincia(a, id);
// "Buenos Aires" a secas puede ser la provincia o la Ciudad.
agregarNombreProvincia('buenos aires', '02');

export function provinciaPorIdOrNull(id: string | null | undefined): Provincia | null {
  return id ? (provinciaPorId.get(id) ?? null) : null;
}

export function localidadPorIdOrNull(id: string | null | undefined): Localidad | null {
  return id ? (localidadPorId.get(id) ?? null) : null;
}

export function todasLasProvincias(): readonly Provincia[] {
  return provincias;
}

/** "Córdoba", "Villa María (Córdoba)", "San Martín (General San Martín, Mendoza)". */
export function etiquetaLocalidad(localidad: Localidad, conDepartamento = false): string {
  const provincia = provinciaPorId.get(localidad.provinciaId)?.nombre ?? '';
  const departamento =
    conDepartamento && localidad.departamento && normalizar(localidad.departamento) !== normalizar(localidad.nombre)
      ? `${localidad.departamento}, `
      : '';
  return `${localidad.nombre} (${departamento}${provincia})`;
}

export type InterpretacionProvincia = {
  /** Coincidencias exactas (más de una = ambiguo, como "Buenos Aires"). */
  exactas: Provincia[];
  /** Sólo si no hubo exactas: parecidas, para que el cliente elija. */
  sugerencias: Provincia[];
};

export function interpretarProvincia(texto: string): InterpretacionProvincia {
  const normalizado = sinPrefijoProvincia(normalizar(texto));
  const ids = provinciasPorNombre.get(normalizado);
  if (ids) return { exactas: ids.map((id) => provinciaPorId.get(id)!), sugerencias: [] };
  return { exactas: [], sugerencias: parecidas([...provinciasPorNombre.keys()], normalizado, (n) => provinciasPorNombre.get(n)!.map((id) => provinciaPorId.get(id)!)) };
}

export type InterpretacionLocalidad = {
  /** Las de ese nombre exacto dentro de las provincias pedidas (o en todo el país). */
  exactas: Localidad[];
  /** Las de ese nombre exacto en otras provincias, cuando las pedidas no tienen ninguna. */
  enOtraProvincia: Localidad[];
  /** Sólo si no hubo exactas en ningún lado: parecidas, para que el cliente elija. */
  sugerencias: Localidad[];
};

/** Variantes que los clientes suelen agregar: "Córdoba capital", "ciudad de Mendoza". */
function variantes(normalizado: string): string[] {
  const sinCapital = normalizado.replace(/ (capital|ciudad|centro)$/, '').replace(/^(ciudad|cdad) de /, '');
  return sinCapital !== normalizado ? [normalizado, sinCapital] : [normalizado];
}

/**
 * La capital de cada provincia, con su nombre en Georef: "Capital" a secas (o
 * "la capital") con la provincia conocida es su capital. En el catálogo la de
 * La Rioja se llama "La Rioja" (departamento Capital), así que "Capital, La
 * Rioja" no coincidía con ninguna localidad y el envío quedaba sin cotizar.
 */
const CAPITAL_DE_PROVINCIA: Record<string, string> = {
  '06': 'La Plata',
  '10': 'San Fernando del Valle de Catamarca',
  '14': 'Córdoba',
  '18': 'Corrientes',
  '22': 'Resistencia',
  '26': 'Rawson',
  '30': 'Paraná',
  '34': 'Formosa',
  '38': 'San Salvador de Jujuy',
  '42': 'Santa Rosa',
  '46': 'La Rioja',
  '50': 'Mendoza',
  '54': 'Posadas',
  '58': 'Neuquén',
  '62': 'Viedma',
  '66': 'Salta',
  '70': 'San Juan',
  '74': 'San Luis',
  '78': 'Río Gallegos',
  '82': 'Santa Fe',
  '86': 'Santiago del Estero',
  '90': 'San Miguel de Tucumán',
  '94': 'Ushuaia',
};

/** "capital", "la capital", "ciudad capital", "capital provincial". */
const SOLO_CAPITAL = /^(?:la |ciudad |cdad )?capital(?: provincial)?$/;

export function interpretarLocalidad(texto: string, provinciaIds?: readonly string[]): InterpretacionLocalidad {
  const normalizado = normalizar(texto);
  const enProvincias = (lista: Localidad[]) =>
    provinciaIds && provinciaIds.length > 0 ? lista.filter((l) => provinciaIds.includes(l.provinciaId)) : lista;
  const capital = provinciaIds?.length === 1 ? CAPITAL_DE_PROVINCIA[provinciaIds[0]] : undefined;
  if (capital && SOLO_CAPITAL.test(normalizado)) {
    const exactas = enProvincias(localidadesPorNombre.get(normalizar(capital)) ?? []);
    if (exactas.length > 0) return { exactas, enOtraProvincia: [], sugerencias: [] };
  }
  for (const variante of variantes(normalizado)) {
    const todas = localidadesPorNombre.get(variante);
    if (!todas) continue;
    const exactas = enProvincias(todas);
    return { exactas, enOtraProvincia: exactas.length > 0 ? [] : todas, sugerencias: [] };
  }
  const sugerencias = enProvincias(
    parecidas(normalizadas, normalizado, (n) => localidadesPorNombre.get(n) ?? [], 8),
  ).slice(0, 5);
  return { exactas: [], enOtraProvincia: [], sugerencias };
}

/** Nombres a distancia de tipeo o que empiezan igual, de más a menos parecido. */
function parecidas<T>(nombres: readonly string[], buscado: string, aValores: (nombre: string) => T[], maximo = 5): T[] {
  const tolerancia = toleranciaDeTipeo(buscado);
  const encontradas: Array<{ nombre: string; d: number }> = [];
  const vistos = new Set<string>();
  for (const nombre of nombres) {
    if (vistos.has(nombre)) continue;
    vistos.add(nombre);
    const d =
      buscado.length >= 3 && nombre.startsWith(buscado)
        ? 0.5
        : tolerancia > 0
          ? distancia(buscado, nombre, tolerancia)
          : Number.POSITIVE_INFINITY;
    if (d <= tolerancia || d === 0.5) encontradas.push({ nombre, d });
  }
  encontradas.sort((a, b) => a.d - b.d || a.nombre.localeCompare(b.nombre));
  return encontradas.slice(0, maximo).flatMap((e) => aValores(e.nombre));
}

/** Un lugar elegible como cobertura en el panel. */
export type Ubicacion = {
  nivel: 'provincia' | 'localidad' | 'cp';
  provinciaId: string;
  localidadId: string | null;
  cp: string | null;
  etiqueta: string;
};

/**
 * Lo que ve el dueño al buscar en el editor de zonas: provincias, localidades
 * (con departamento para distinguir homónimos) y, si escribió un CP, el CP en
 * cada provincia posible (la de su letra, o todas para que elija).
 */
export function buscarUbicaciones(texto: string, limite = 12): Ubicacion[] {
  const consulta = texto.trim();
  if (!consulta) return [];
  const codigo = parsearCodigoPostal(consulta);
  if (codigo) {
    const opciones = codigo.provinciaId ? [provinciaPorId.get(codigo.provinciaId)!] : provincias;
    return opciones.map((p) => ({
      nivel: 'cp' as const,
      provinciaId: p.id,
      localidadId: null,
      cp: codigo.cp,
      etiqueta: `CP ${codigo.cp} (${p.nombre})`,
    }));
  }
  const normalizado = normalizar(consulta);
  if (normalizado.length < 2) return [];
  const resultado: Ubicacion[] = [];
  const provinciaInterpretada = interpretarProvincia(consulta);
  const provinciasEncontradas = [
    ...provinciaInterpretada.exactas,
    ...provincias.filter((p) => normalizar(p.nombre).includes(normalizado)),
    ...provinciaInterpretada.sugerencias,
  ];
  for (const p of provinciasEncontradas) {
    if (resultado.some((u) => u.nivel === 'provincia' && u.provinciaId === p.id)) continue;
    resultado.push({ nivel: 'provincia', provinciaId: p.id, localidadId: null, cp: null, etiqueta: `${p.nombre} (toda la provincia)` });
  }
  const exactasYPrefijo: Localidad[] = [];
  normalizadas.forEach((n, i) => {
    if (n === normalizado || n.startsWith(normalizado)) exactasYPrefijo.push(localidades[i]);
  });
  exactasYPrefijo.sort((a, b) => a.nombre.length - b.nombre.length || a.nombre.localeCompare(b.nombre, 'es'));
  const interpretada = interpretarLocalidad(consulta);
  for (const l of [...exactasYPrefijo, ...interpretada.sugerencias]) {
    if (resultado.length >= limite) break;
    if (resultado.some((u) => u.localidadId === l.id)) continue;
    resultado.push({ nivel: 'localidad', provinciaId: l.provinciaId, localidadId: l.id, cp: null, etiqueta: etiquetaLocalidad(l, true) });
  }
  return resultado.slice(0, limite);
}
