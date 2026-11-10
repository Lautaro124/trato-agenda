/**
 * Reglas del módulo de envíos (LAU-102): validación de zonas, conflictos y el
 * resolvedor determinístico. El asistente sólo interpreta la consulta y
 * redacta; cobertura, precio y plazo salen de acá. Todo puro: el servicio lee
 * las reglas vigentes de la base y se las pasa en cada consulta.
 *
 * Prioridad: código postal > localidad > provincia > regla general del país,
 * también para las excepciones "sin cobertura". La ausencia de regla es "sin
 * configurar", nunca "sin cobertura". Las validaciones de entrada están
 * copiadas en web/src/lib/envios.ts: mantenerlas iguales.
 */
import {
  etiquetaLocalidad,
  interpretarLocalidad,
  interpretarProvincia,
  localidadPorIdOrNull,
  provinciaPorIdOrNull,
  type Localidad,
} from './geo/catalogo.js';
import { parsearCodigoPostal } from './geo/normalizacion.js';

export const ESTADOS_ZONA = ['tarifa', 'cotizacion', 'sin_cobertura'] as const;
export type EstadoZona = (typeof ESTADOS_ZONA)[number];
export const MODALIDADES = ['domicilio', 'sucursal'] as const;
export type Modalidad = (typeof MODALIDADES)[number];
export const NIVELES = ['cp', 'localidad', 'provincia', 'pais'] as const;
export type Nivel = (typeof NIVELES)[number];
export const DIAS_DESPACHO = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const;
export const ACCIONES_SIN_TARIFA = ['cotizar_aparte', 'derivar'] as const;
export type AccionSinTarifa = (typeof ACCIONES_SIN_TARIFA)[number];
export const MONEDAS_ENVIO = ['ARS', 'USD'] as const;
export const PAISES_ENVIO = ['AR'] as const;

export const LARGO_MAX_NOMBRE_ZONA = 60;
export const LARGO_MAX_INSTRUCCIONES = 300;
export const MAX_ZONAS = 200;
export const MAX_COBERTURAS = 500;
/**
 * Tope de lugares entre todas las zonas de una cuenta: el resolvedor compara
 * cada lugar con los demás (cuadrático), y una sola cuenta no puede trabar la
 * API que atiende a todas.
 */
export const MAX_COBERTURAS_POR_CUENTA = 2_000;
export const MAX_DIAS_PLAZO = 365;
/** $100.000.000 en centavos: más que eso es un error de tipeo. */
export const MAX_IMPORTE_CENTAVOS = 10_000_000_000;

const PRIORIDAD: Record<Nivel, number> = { cp: 0, localidad: 1, provincia: 2, pais: 3 };

export type CoberturaRegla = {
  nivel: Nivel;
  provinciaId: string | null;
  localidadId: string | null;
  cp: string | null;
};

export type DatosZona = {
  nombre: string;
  activa: boolean;
  estado: EstadoZona;
  domicilio: boolean;
  sucursal: boolean;
  tarifaDomicilioCentavos: number | null;
  tarifaSucursalCentavos: number | null;
  gratisDesdeCentavos: number | null;
  preparacionDias: number | null;
  transporteDesdeDias: number | null;
  transporteHastaDias: number | null;
  diasDespacho: string[];
  instrucciones: string | null;
  coberturas: CoberturaRegla[];
};

export type ZonaRegla = DatosZona & { id: string };

export type ConfigRegla = {
  activo: boolean;
  pais: string;
  moneda: string;
  sinTarifa: AccionSinTarifa;
};

// ---------------------------------------------------------------- validación

function esImporte(valor: number | null): boolean {
  return valor === null || (Number.isInteger(valor) && valor >= 0 && valor <= MAX_IMPORTE_CENTAVOS);
}

function esDias(valor: number | null): boolean {
  return valor === null || (Number.isInteger(valor) && valor >= 0 && valor <= MAX_DIAS_PLAZO);
}

/** La cobertura con los ids completados desde el catálogo, o el problema. */
export function normalizarCobertura(c: CoberturaRegla): CoberturaRegla | string {
  switch (c.nivel) {
    case 'pais':
      return { nivel: 'pais', provinciaId: null, localidadId: null, cp: null };
    case 'provincia':
      return provinciaPorIdOrNull(c.provinciaId)
        ? { nivel: 'provincia', provinciaId: c.provinciaId, localidadId: null, cp: null }
        : 'Hay una provincia que no existe en el catálogo.';
    case 'localidad': {
      const localidad = localidadPorIdOrNull(c.localidadId);
      return localidad
        ? { nivel: 'localidad', provinciaId: localidad.provinciaId, localidadId: localidad.id, cp: null }
        : 'Hay una localidad que no existe en el catálogo.';
    }
    case 'cp': {
      if (!c.cp || !/^\d{4}$/.test(c.cp)) return 'Los códigos postales van con sus cuatro números (por ejemplo 5000).';
      if (!provinciaPorIdOrNull(c.provinciaId)) return `Elegí la provincia del CP ${c.cp}.`;
      if (c.localidadId) {
        const localidad = localidadPorIdOrNull(c.localidadId);
        if (!localidad || localidad.provinciaId !== c.provinciaId) {
          return `La localidad del CP ${c.cp} no es de la provincia elegida.`;
        }
      }
      return { nivel: 'cp', provinciaId: c.provinciaId, localidadId: c.localidadId ?? null, cp: c.cp };
    }
    default:
      return 'Hay una cobertura con un tipo desconocido.';
  }
}

export function claveDeCobertura(c: CoberturaRegla): string {
  switch (c.nivel) {
    case 'pais':
      return 'pais';
    case 'provincia':
      return `provincia:${c.provinciaId}`;
    case 'localidad':
      return `localidad:${c.localidadId}`;
    case 'cp':
      return `cp:${c.cp}`;
  }
}

/** "CP 5000 (Córdoba)", "Villa María (Córdoba)", "Córdoba (provincia)", "Todo el país". */
export function etiquetaDeCobertura(c: CoberturaRegla): string {
  switch (c.nivel) {
    case 'pais':
      return 'Todo el país';
    case 'provincia':
      return `${provinciaPorIdOrNull(c.provinciaId)?.nombre ?? 'Provincia'} (provincia)`;
    case 'localidad': {
      const localidad = localidadPorIdOrNull(c.localidadId);
      return localidad ? etiquetaLocalidad(localidad) : 'Localidad';
    }
    case 'cp': {
      const lugar = localidadPorIdOrNull(c.localidadId)?.nombre ?? provinciaPorIdOrNull(c.provinciaId)?.nombre;
      return `CP ${c.cp}${lugar ? ` (${lugar})` : ''}`;
    }
  }
}

/**
 * Lo que está mal en una zona, en palabras para el dueño, o null. Devuelve
 * las coberturas normalizadas para guardar.
 */
export function validarZona(zona: DatosZona): { ok: true; coberturas: CoberturaRegla[] } | { ok: false; problema: string } {
  const falla = (problema: string) => ({ ok: false as const, problema });
  const nombre = zona.nombre.trim();
  if (!nombre) return falla('Ponele un nombre a la zona.');
  if (nombre.length > LARGO_MAX_NOMBRE_ZONA) return falla(`El nombre puede tener hasta ${LARGO_MAX_NOMBRE_ZONA} caracteres.`);
  if (!ESTADOS_ZONA.includes(zona.estado)) return falla('Elegí qué pasa con los envíos a esta zona.');

  if (zona.coberturas.length === 0) return falla('Sumá al menos un lugar a la cobertura.');
  if (zona.coberturas.length > MAX_COBERTURAS) return falla(`Una zona puede tener hasta ${MAX_COBERTURAS} lugares.`);
  const coberturas: CoberturaRegla[] = [];
  const claves = new Set<string>();
  for (const c of zona.coberturas) {
    const normalizada = normalizarCobertura(c);
    if (typeof normalizada === 'string') return falla(normalizada);
    const clave = claveDeCobertura(normalizada);
    if (claves.has(clave)) return falla(`${etiquetaDeCobertura(normalizada)} está dos veces en la cobertura.`);
    claves.add(clave);
    coberturas.push(normalizada);
  }

  for (const importe of [zona.tarifaDomicilioCentavos, zona.tarifaSucursalCentavos, zona.gratisDesdeCentavos]) {
    if (!esImporte(importe)) return falla('Los importes tienen que ser números positivos (o cero).');
  }
  for (const dias of [zona.preparacionDias, zona.transporteDesdeDias, zona.transporteHastaDias]) {
    if (!esDias(dias)) return falla(`Los plazos van en días hábiles, de 0 a ${MAX_DIAS_PLAZO}.`);
  }
  if ((zona.transporteDesdeDias === null) !== (zona.transporteHastaDias === null)) {
    return falla('Completá el transporte "desde" y "hasta", o dejá los dos vacíos.');
  }
  if (zona.transporteDesdeDias !== null && zona.transporteHastaDias !== null && zona.transporteDesdeDias > zona.transporteHastaDias) {
    return falla('El transporte "desde" no puede ser mayor que el "hasta".');
  }
  if (new Set(zona.diasDespacho).size !== zona.diasDespacho.length || zona.diasDespacho.some((d) => !(DIAS_DESPACHO as readonly string[]).includes(d))) {
    return falla('Los días de despacho no son válidos.');
  }
  if (zona.instrucciones !== null && zona.instrucciones.length > LARGO_MAX_INSTRUCCIONES) {
    return falla(`Las aclaraciones pueden tener hasta ${LARGO_MAX_INSTRUCCIONES} caracteres.`);
  }

  if (zona.estado === 'sin_cobertura') {
    if (zona.domicilio || zona.sucursal) return falla('Una zona sin cobertura no ofrece modalidades de entrega.');
    if (zona.tarifaDomicilioCentavos !== null || zona.tarifaSucursalCentavos !== null || zona.gratisDesdeCentavos !== null) {
      return falla('Una zona sin cobertura no lleva tarifas.');
    }
    return { ok: true, coberturas };
  }
  if (!zona.domicilio && !zona.sucursal) return falla('Elegí al menos una forma de entrega: domicilio o sucursal.');
  for (const [modalidad, ofrece, tarifa] of [
    ['domicilio', zona.domicilio, zona.tarifaDomicilioCentavos],
    ['sucursal', zona.sucursal, zona.tarifaSucursalCentavos],
  ] as const) {
    if (!ofrece && tarifa !== null) return falla(`Hay una tarifa de ${modalidad} pero esa forma de entrega no está marcada.`);
    if (zona.estado === 'tarifa' && ofrece && tarifa === null) {
      return falla(`Falta la tarifa de ${modalidad === 'domicilio' ? 'envío a domicilio' : 'retiro en sucursal'}. Si no cobrás, marcá "Sin cargo".`);
    }
    if (zona.estado === 'cotizacion' && tarifa !== null) return falla('Una zona que requiere cotización no lleva tarifa fija.');
  }
  if (zona.estado === 'cotizacion' && zona.gratisDesdeCentavos !== null) {
    return falla('El envío gratis sólo se puede usar con tarifa definida.');
  }
  return { ok: true, coberturas };
}

// ---------------------------------------------------------------- conflictos

export function modalidadesDeZona(zona: Pick<DatosZona, 'estado' | 'domicilio' | 'sucursal'>): Modalidad[] {
  if (zona.estado === 'sin_cobertura') return [...MODALIDADES];
  return MODALIDADES.filter((m) => (m === 'domicilio' ? zona.domicilio : zona.sucursal));
}

export type Conflicto = {
  clave: string;
  lugar: string;
  modalidad: Modalidad;
  zonas: Array<{ id: string; nombre: string }>;
};

/**
 * Dos zonas activas que cubren el mismo lugar, al mismo nivel, con la misma
 * modalidad: no hay forma de elegir una sin ser arbitrario.
 */
export function detectarConflictos(zonas: readonly ZonaRegla[]): Conflicto[] {
  const porClave = new Map<string, { cobertura: CoberturaRegla; modalidad: Modalidad; zonas: ZonaRegla[] }>();
  for (const zona of zonas) {
    if (!zona.activa) continue;
    for (const cobertura of zona.coberturas) {
      for (const modalidad of modalidadesDeZona(zona)) {
        const clave = `${claveDeCobertura(cobertura)}|${modalidad}`;
        const grupo = porClave.get(clave) ?? { cobertura, modalidad, zonas: [] };
        if (!grupo.zonas.some((z) => z.id === zona.id)) grupo.zonas.push(zona);
        porClave.set(clave, grupo);
      }
    }
  }
  return [...porClave.entries()]
    .filter(([, grupo]) => grupo.zonas.length > 1)
    .map(([clave, grupo]) => ({
      clave,
      lugar: etiquetaDeCobertura(grupo.cobertura),
      modalidad: grupo.modalidad,
      zonas: grupo.zonas.map((z) => ({ id: z.id, nombre: z.nombre })),
    }));
}

// ---------------------------------------------------------------- resolución

/** Un lugar concreto o parcial: null = no se sabe. */
type Punto = { provinciaId: string | null; localidadId: string | null; cp: string | null };

type Regla =
  | { tipo: 'zona'; zona: ZonaRegla; nivel: Nivel }
  | { tipo: 'sin_configurar' }
  | { tipo: 'conflicto'; zonas: ZonaRegla[] };

function cubre(c: CoberturaRegla, punto: Punto): boolean {
  switch (c.nivel) {
    case 'pais':
      return true;
    case 'provincia':
      return punto.provinciaId !== null && punto.provinciaId === c.provinciaId;
    case 'localidad':
      return punto.localidadId !== null && punto.localidadId === c.localidadId;
    case 'cp':
      return (
        punto.cp !== null &&
        punto.cp === c.cp &&
        (punto.provinciaId === null || punto.provinciaId === c.provinciaId) &&
        (punto.localidadId === null || c.localidadId === null || punto.localidadId === c.localidadId)
      );
  }
}

function reglaPara(zonas: readonly ZonaRegla[], punto: Punto, modalidad: Modalidad): Regla {
  let mejor = Number.POSITIVE_INFINITY;
  let candidatas: Array<{ zona: ZonaRegla; nivel: Nivel }> = [];
  for (const zona of zonas) {
    if (!modalidadesDeZona(zona).includes(modalidad)) continue;
    let nivelZona: Nivel | null = null;
    for (const c of zona.coberturas) {
      if (cubre(c, punto) && (nivelZona === null || PRIORIDAD[c.nivel] < PRIORIDAD[nivelZona])) nivelZona = c.nivel;
    }
    if (nivelZona === null) continue;
    const prioridad = PRIORIDAD[nivelZona];
    if (prioridad < mejor) {
      mejor = prioridad;
      candidatas = [{ zona, nivel: nivelZona }];
    } else if (prioridad === mejor) {
      candidatas.push({ zona, nivel: nivelZona });
    }
  }
  if (candidatas.length === 0) return { tipo: 'sin_configurar' };
  if (candidatas.length > 1) return { tipo: 'conflicto', zonas: candidatas.map((c) => c.zona) };
  return { tipo: 'zona', ...candidatas[0] };
}

function tarifaDe(zona: ZonaRegla, modalidad: Modalidad): number | null {
  return modalidad === 'domicilio' ? zona.tarifaDomicilioCentavos : zona.tarifaSucursalCentavos;
}

/** Lo que el cliente terminaría escuchando: dos lugares con la misma firma reciben la misma respuesta. */
function firma(regla: Regla, modalidad: Modalidad): string {
  if (regla.tipo === 'sin_configurar') return 'sin_configurar';
  if (regla.tipo === 'conflicto') return `conflicto:${regla.zonas.map((z) => z.id).sort().join(',')}`;
  const z = regla.zona;
  return JSON.stringify([
    z.estado,
    z.estado === 'sin_cobertura' ? null : tarifaDe(z, modalidad),
    z.gratisDesdeCentavos,
    z.preparacionDias,
    z.transporteDesdeDias,
    z.transporteHastaDias,
  ]);
}

/** Las modalidades que ofrece el comercio en alguna zona activa (domicilio si no ofrece ninguna). */
function modalidadesOfrecidas(zonas: readonly ZonaRegla[]): Modalidad[] {
  const ofrecidas = MODALIDADES.filter((m) => zonas.some((z) => z.estado !== 'sin_cobertura' && modalidadesDeZona(z).includes(m)));
  return ofrecidas.length > 0 ? ofrecidas : ['domicilio'];
}

function firmaPunto(zonas: readonly ZonaRegla[], modalidades: readonly Modalidad[], punto: Punto): string {
  return modalidades.map((m) => firma(reglaPara(zonas, punto, m), m)).join('|');
}

/** ¿Esta cobertura puede aplicar a algún lugar dentro del destino parcial? */
function puedeCaerDentro(c: CoberturaRegla, d: Punto): boolean {
  const provincia = d.provinciaId === null || d.provinciaId === c.provinciaId;
  switch (c.nivel) {
    case 'pais':
      return false;
    case 'provincia':
      return d.provinciaId === null;
    case 'localidad':
      return provincia && d.localidadId === null;
    case 'cp':
      // Con el CP conocido, su regla ya aplica directo (cubre()).
      return provincia && d.cp === null && (d.localidadId === null || c.localidadId === null || c.localidadId === d.localidadId);
  }
}

function completar(d: Punto, c: CoberturaRegla): Punto {
  return {
    provinciaId: d.provinciaId ?? c.provinciaId,
    localidadId: d.localidadId ?? (c.nivel === 'localidad' || c.nivel === 'cp' ? c.localidadId : null),
    cp: d.cp ?? (c.nivel === 'cp' ? c.cp : null),
  };
}

type Faltante = 'provincia' | 'localidad' | 'codigo_postal';

/**
 * ¿Alcanza el destino parcial para responder? Sí, si todo lugar posible
 * dentro de él recibe la misma respuesta. Si no, qué dato pedir y qué
 * lugares tienen una respuesta distinta.
 */
function evaluarParcial(
  zonas: readonly ZonaRegla[],
  modalidades: readonly Modalidad[],
  d: Punto,
): { uniforme: true } | { uniforme: false; faltante: Faltante; distintos: string[] } {
  const base = firmaPunto(zonas, modalidades, d);
  const distintas: CoberturaRegla[] = [];
  // Cada lugar posible se evalúa una sola vez aunque lo cubran varias zonas.
  const firmas = new Map<string, string>();
  for (const zona of zonas) {
    for (const c of zona.coberturas) {
      if (!puedeCaerDentro(c, d)) continue;
      const punto = completar(d, c);
      const clave = `${punto.provinciaId}|${punto.localidadId}|${punto.cp}`;
      let firmaDelPunto = firmas.get(clave);
      if (firmaDelPunto === undefined) {
        firmaDelPunto = firmaPunto(zonas, modalidades, punto);
        firmas.set(clave, firmaDelPunto);
      }
      if (firmaDelPunto !== base) distintas.push(c);
    }
  }
  if (distintas.length === 0) return { uniforme: true };
  const faltante: Faltante =
    d.provinciaId === null ? 'localidad' : d.localidadId === null && distintas.some((c) => c.nivel !== 'cp') ? 'localidad' : 'codigo_postal';
  const distintos = [...new Set(distintas.filter((c) => c.nivel !== 'cp' || faltante === 'codigo_postal').map(etiquetaDeCobertura))];
  return { uniforme: false, faltante, distintos: distintos.slice(0, 6) };
}

export type ConsultaEnvio = { provincia?: string; localidad?: string; codigoPostal?: string };

export type EstadoResolucion =
  | 'resuelto'
  | 'falta_dato'
  | 'ubicacion_incierta'
  | 'contradiccion'
  | 'conflicto'
  | 'sin_configurar'
  | 'inactivo'
  | 'error';

export type SiguienteAccion = 'informar' | 'pedir_dato' | 'confirmar_ubicacion' | 'cotizar_aparte' | 'derivar' | 'ninguna';

export type ResolucionModalidad = {
  modalidad: Modalidad;
  estado: EstadoZona | 'sin_configurar' | 'conflicto';
  zona: { id: string; nombre: string } | null;
  zonasEnConflicto: Array<{ id: string; nombre: string }>;
  /** Lo que paga el cliente (0 si ya es gratis); null si no hay precio. */
  tarifaCentavos: number | null;
  /** La tarifa de la zona antes del envío gratis. */
  tarifaListaCentavos: number | null;
  moneda: string;
  gratis: { desdeCentavos: number; aplica: 'si' | 'no' | 'condicion' } | null;
  plazo: { desdeDias: number; hastaDias: number } | null;
  diasDespacho: string[];
  instrucciones: string | null;
};

export type DestinoNormalizado = {
  provinciaId: string | null;
  provincia: string | null;
  localidadId: string | null;
  localidad: string | null;
  cp: string | null;
};

export type ResolucionEnvio = {
  estado: EstadoResolucion;
  destino: DestinoNormalizado;
  /** Con falta_dato: qué preguntarle al cliente. */
  faltante: Faltante | null;
  /** Lugares para elegir o que tienen respuestas distintas. */
  candidatos: string[];
  /** Con contradiccion o ubicacion_incierta: qué no cierra, para el modelo. */
  detalle: string | null;
  modalidades: ResolucionModalidad[];
  retiroEnLocal: boolean;
  siguienteAccion: SiguienteAccion;
};

export type OpcionesResolucion = {
  retiroEnLocal: boolean;
  /** Subtotal de productos del pedido, si se conoce. */
  subtotalCentavos?: number | null;
  monedaSubtotal?: string | null;
};

function destinoDe(punto: Punto): DestinoNormalizado {
  const localidad = localidadPorIdOrNull(punto.localidadId);
  return {
    provinciaId: punto.provinciaId,
    provincia: provinciaPorIdOrNull(punto.provinciaId)?.nombre ?? null,
    localidadId: punto.localidadId,
    localidad: localidad?.nombre ?? null,
    cp: punto.cp,
  };
}

const SIN_DESTINO: Punto = { provinciaId: null, localidadId: null, cp: null };

function accionSinTarifa(config: ConfigRegla): SiguienteAccion {
  return config.sinTarifa === 'cotizar_aparte' ? 'cotizar_aparte' : 'derivar';
}

function vacia(
  estado: EstadoResolucion,
  config: ConfigRegla,
  opciones: OpcionesResolucion,
  extra: Partial<Pick<ResolucionEnvio, 'faltante' | 'candidatos' | 'detalle'>> & { punto?: Punto } = {},
): ResolucionEnvio {
  const siguienteAccion: SiguienteAccion =
    estado === 'falta_dato'
      ? 'pedir_dato'
      : estado === 'ubicacion_incierta' || estado === 'contradiccion'
        ? 'confirmar_ubicacion'
        : estado === 'inactivo'
          ? 'ninguna'
          : accionSinTarifa(config);
  return {
    estado,
    destino: destinoDe(extra.punto ?? SIN_DESTINO),
    faltante: extra.faltante ?? null,
    candidatos: extra.candidatos ?? [],
    detalle: extra.detalle ?? null,
    modalidades: [],
    retiroEnLocal: opciones.retiroEnLocal,
    siguienteAccion,
  };
}

function resolucionModalidad(regla: Regla, modalidad: Modalidad, config: ConfigRegla, opciones: OpcionesResolucion): ResolucionModalidad {
  const base: ResolucionModalidad = {
    modalidad,
    estado: regla.tipo === 'zona' ? regla.zona.estado : regla.tipo,
    zona: regla.tipo === 'zona' ? { id: regla.zona.id, nombre: regla.zona.nombre } : null,
    zonasEnConflicto: regla.tipo === 'conflicto' ? regla.zonas.map((z) => ({ id: z.id, nombre: z.nombre })) : [],
    tarifaCentavos: null,
    tarifaListaCentavos: null,
    moneda: config.moneda,
    gratis: null,
    plazo: null,
    diasDespacho: [],
    instrucciones: null,
  };
  if (regla.tipo !== 'zona' || regla.zona.estado === 'sin_cobertura') return base;
  const z = regla.zona;
  const preparacion = z.preparacionDias ?? 0;
  const plazo =
    z.transporteDesdeDias !== null && z.transporteHastaDias !== null
      ? { desdeDias: preparacion + z.transporteDesdeDias, hastaDias: preparacion + z.transporteHastaDias }
      : z.preparacionDias !== null
        ? { desdeDias: preparacion, hastaDias: preparacion }
        : null;
  const resultado = { ...base, plazo, diasDespacho: z.diasDespacho, instrucciones: z.instrucciones };
  if (z.estado === 'cotizacion') return resultado;
  const lista = tarifaDe(z, modalidad);
  let gratis: ResolucionModalidad['gratis'] = null;
  if (z.gratisDesdeCentavos !== null) {
    const subtotal = opciones.subtotalCentavos;
    const conocido = typeof subtotal === 'number' && (opciones.monedaSubtotal ?? config.moneda) === config.moneda;
    gratis = { desdeCentavos: z.gratisDesdeCentavos, aplica: conocido ? (subtotal >= z.gratisDesdeCentavos ? 'si' : 'no') : 'condicion' };
  }
  return { ...resultado, tarifaListaCentavos: lista, tarifaCentavos: gratis?.aplica === 'si' ? 0 : lista, gratis };
}

function resolverPunto(
  zonas: readonly ZonaRegla[],
  modalidades: readonly Modalidad[],
  punto: Punto,
  config: ConfigRegla,
  opciones: OpcionesResolucion,
): ResolucionEnvio {
  const porModalidad = modalidades.map((m) => resolucionModalidad(reglaPara(zonas, punto, m), m, config, opciones));
  const estado: EstadoResolucion = porModalidad.some((m) => m.estado === 'conflicto')
    ? 'conflicto'
    : porModalidad.every((m) => m.estado === 'sin_configurar')
      ? 'sin_configurar'
      : 'resuelto';
  return {
    estado,
    destino: destinoDe(punto),
    faltante: null,
    candidatos: estado === 'conflicto' ? [...new Set(porModalidad.flatMap((m) => m.zonasEnConflicto.map((z) => z.nombre)))] : [],
    detalle: null,
    modalidades: estado === 'resuelto' ? porModalidad.filter((m) => m.estado !== 'sin_configurar') : porModalidad,
    retiroEnLocal: opciones.retiroEnLocal,
    siguienteAccion: estado === 'resuelto' ? 'informar' : accionSinTarifa(config),
  };
}

/**
 * Resuelve una consulta de envío con las reglas vigentes. Nunca inventa un
 * lugar ni un precio: si el dato no alcanza, dice cuál falta; si algo no
 * cierra, lo devuelve como contradicción o ubicación incierta.
 */
export function resolverEnvio(
  config: ConfigRegla | null,
  todasLasZonas: readonly ZonaRegla[],
  consulta: ConsultaEnvio,
  opciones: OpcionesResolucion,
): ResolucionEnvio {
  const cfg: ConfigRegla = config ?? { activo: false, pais: 'AR', moneda: 'ARS', sinTarifa: 'derivar' };
  if (!config?.activo) return vacia('inactivo', cfg, opciones);
  const zonas = todasLasZonas.filter((z) => z.activa);
  const modalidades = modalidadesOfrecidas(zonas);
  const texto = (v: string | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const textoProvincia = texto(consulta.provincia);
  const textoLocalidad = texto(consulta.localidad);
  const textoCp = texto(consulta.codigoPostal);
  if (!textoProvincia && !textoLocalidad && !textoCp) {
    return vacia('falta_dato', cfg, opciones, { faltante: 'localidad' });
  }

  // Código postal.
  let cp: string | null = null;
  let provinciaDelCp: string | null = null;
  if (textoCp) {
    const parseado = parsearCodigoPostal(textoCp);
    if (!parseado) {
      return vacia('ubicacion_incierta', cfg, opciones, { faltante: 'codigo_postal', detalle: `"${textoCp.slice(0, 20)}" no parece un código postal.` });
    }
    cp = parseado.cp;
    provinciaDelCp = parseado.provinciaId;
  }

  // Provincia.
  let provincias: string[] | null = null;
  if (textoProvincia) {
    const interpretada = interpretarProvincia(textoProvincia);
    if (interpretada.exactas.length === 0) {
      return vacia('ubicacion_incierta', cfg, opciones, {
        faltante: 'provincia',
        candidatos: interpretada.sugerencias.map((p) => p.nombre),
        detalle: 'La provincia no coincide con ninguna de forma segura.',
      });
    }
    provincias = interpretada.exactas.map((p) => p.id);
  }
  if (provinciaDelCp) {
    if (provincias && !provincias.includes(provinciaDelCp)) {
      return vacia('contradiccion', cfg, opciones, {
        detalle: `La letra del código postal corresponde a ${provinciaPorIdOrNull(provinciaDelCp)?.nombre}, no a la provincia que dijo el cliente.`,
      });
    }
    provincias = [provinciaDelCp];
  }

  // Localidad.
  let localidades: Localidad[] | null = null;
  if (textoLocalidad) {
    const interpretada = interpretarLocalidad(textoLocalidad, provincias ?? undefined);
    if (interpretada.exactas.length === 0) {
      if (interpretada.enOtraProvincia.length > 0) {
        return vacia('contradiccion', cfg, opciones, {
          candidatos: interpretada.enOtraProvincia.slice(0, 6).map((l) => etiquetaLocalidad(l)),
          detalle: 'Esa localidad no es de la provincia que dijo el cliente.',
        });
      }
      return vacia('ubicacion_incierta', cfg, opciones, {
        faltante: 'localidad',
        candidatos: interpretada.sugerencias.map((l) => etiquetaLocalidad(l, true)),
        detalle: 'La localidad no coincide con ninguna de forma segura.',
      });
    }
    localidades = interpretada.exactas;
  }

  // Lo que el dueño cargó para ese CP (no hay catálogo CP → localidad).
  if (cp !== null) {
    const delCp = zonas.flatMap((z) => z.coberturas).filter((c) => c.nivel === 'cp' && c.cp === cp);
    if (delCp.length > 0) {
      const compatibles = delCp.filter(
        (c) =>
          (provincias === null || provincias.includes(c.provinciaId!)) &&
          (localidades === null || localidades.some((l) => l.provinciaId === c.provinciaId && (c.localidadId === null || c.localidadId === l.id))),
      );
      if (compatibles.length === 0) {
        return vacia('contradiccion', cfg, opciones, {
          candidatos: [...new Set(delCp.map(etiquetaDeCobertura))],
          detalle: `El código postal ${cp} está cargado para otro lugar que el que dijo el cliente.`,
        });
      }
      if (provincias === null && localidades === null) {
        provincias = [...new Set(compatibles.map((c) => c.provinciaId!))];
        const conLocalidad = compatibles.map((c) => c.localidadId);
        const unica = conLocalidad.every((id) => id !== null && id === conLocalidad[0]) ? localidadPorIdOrNull(conLocalidad[0]) : null;
        if (unica && provincias.length === 1) localidades = [unica];
      }
    }
  }

  // Los destinos posibles: varios si el nombre es homónimo o ambiguo.
  const destinos: Punto[] = localidades
    ? localidades.map((l) => ({ provinciaId: l.provinciaId, localidadId: l.id, cp }))
    : provincias
      ? provincias.map((p) => ({ provinciaId: p, localidadId: null, cp }))
      : [{ provinciaId: null, localidadId: null, cp }];

  const evaluaciones = destinos.map((d) => ({ d, evaluacion: evaluarParcial(zonas, modalidades, d) }));
  if (destinos.length > 1) {
    const firmas = new Set(evaluaciones.map(({ d, evaluacion }) => (evaluacion.uniforme ? firmaPunto(zonas, modalidades, d) : 'variable')));
    if (firmas.size > 1 || firmas.has('variable')) {
      return vacia('falta_dato', cfg, opciones, {
        faltante: 'provincia',
        candidatos: destinos.slice(0, 8).map((d) => {
          const localidad = localidadPorIdOrNull(d.localidadId);
          return localidad ? etiquetaLocalidad(localidad, true) : (provinciaPorIdOrNull(d.provinciaId)?.nombre ?? '');
        }),
      });
    }
    // Todos los candidatos reciben la misma respuesta: alcanza con uno, sin afirmar cuál.
    const resolucion = resolverPunto(zonas, modalidades, destinos[0], cfg, opciones);
    return { ...resolucion, destino: { ...resolucion.destino, localidadId: null, localidad: textoLocalidad, provinciaId: null, provincia: null } };
  }

  const [{ d, evaluacion }] = evaluaciones;
  if (!evaluacion.uniforme) {
    return vacia('falta_dato', cfg, opciones, { punto: d, faltante: evaluacion.faltante, candidatos: evaluacion.distintos });
  }
  return resolverPunto(zonas, modalidades, d, cfg, opciones);
}

/** El motivo para registrar una consulta que el asistente no pudo responder (o null si sí pudo). */
export function motivoSinResolver(resolucion: ResolucionEnvio): string | null {
  switch (resolucion.estado) {
    case 'sin_configurar':
      return 'sin_configurar';
    case 'conflicto':
      return 'conflicto';
    case 'ubicacion_incierta':
      return 'ambigua';
    case 'contradiccion':
      return 'contradiccion';
    case 'error':
      return 'error';
    default:
      return null;
  }
}

export function resolucionConError(config: ConfigRegla | null, retiroEnLocal: boolean): ResolucionEnvio {
  const cfg: ConfigRegla = config ?? { activo: true, pais: 'AR', moneda: 'ARS', sinTarifa: 'derivar' };
  return vacia('error', cfg, { retiroEnLocal });
}
