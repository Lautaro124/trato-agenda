// Regenera src/envios/geo/georef-ar.data.ts con las provincias y localidades
// de la API Georef (datos.gob.ar, licencia CC-BY 4.0). No corre en runtime:
// se ejecuta a mano (`node scripts/actualizar-georef.mjs`) y el resultado se
// versiona, para que el resolvedor de envíos no dependa de un servicio externo.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BASE = 'https://apis.datos.gob.ar/georef/api';
const DESTINO = fileURLToPath(new URL('../src/envios/geo/georef-ar.data.ts', import.meta.url));

async function leer(ruta) {
  const respuesta = await fetch(`${BASE}/${ruta}`);
  if (!respuesta.ok) throw new Error(`Georef respondió ${respuesta.status} en ${ruta}`);
  return respuesta.json();
}

const { provincias } = await leer('provincias?campos=id,nombre&max=30');
const { localidades, cantidad, total } = await leer(
  'localidades?campos=id,nombre,provincia.id,departamento.nombre&max=5000',
);
if (cantidad !== total) throw new Error(`Georef devolvió ${cantidad} de ${total} localidades: subí el máximo.`);

const porNombre = (a, b) => a[1].localeCompare(b[1], 'es') || a[0].localeCompare(b[0]);
const filasProvincias = provincias.map((p) => [p.id, p.nombre]).sort(porNombre);
// Georef repite un lugar como localidad simple (id de 8 dígitos) y como
// componente de una localidad compuesta (10 dígitos), con el mismo nombre y
// departamento: se queda una sola, la de id más corto. Si no, "Córdoba"
// parecería tener dos homónimos y el resolvedor pediría aclarar sin motivo.
const unicas = new Map();
for (const l of localidades) {
  const clave = [l.nombre.toLowerCase(), l.provincia.id, l.departamento?.nombre ?? ''].join('|');
  const previa = unicas.get(clave);
  if (!previa || l.id.length < previa.id.length || (l.id.length === previa.id.length && l.id < previa.id)) unicas.set(clave, l);
}
const filasLocalidades = [...unicas.values()]
  .map((l) => [l.id, l.nombre, l.provincia.id, l.departamento?.nombre ?? ''])
  .sort(porNombre);

const fecha = new Date().toISOString().slice(0, 10);
const contenido =
  `// Generado por scripts/actualizar-georef.mjs el ${fecha}. No editar a mano.\n` +
  `// Fuente: API Georef (https://datosgobar.github.io/georef-ar-api/), CC-BY 4.0.\n` +
  `/* eslint-disable */\n` +
  `export const FECHA_GEOREF = '${fecha}';\n\n` +
  `/** [id, nombre] */\n` +
  `export const PROVINCIAS: ReadonlyArray<readonly [string, string]> = ${JSON.stringify(filasProvincias)};\n\n` +
  `/** [id, nombre, provinciaId, departamento] */\n` +
  `export const LOCALIDADES: ReadonlyArray<readonly [string, string, string, string]> = ${JSON.stringify(filasLocalidades)};\n`;

await writeFile(DESTINO, contenido);
console.log(`${filasProvincias.length} provincias y ${filasLocalidades.length} localidades en ${DESTINO}`);
