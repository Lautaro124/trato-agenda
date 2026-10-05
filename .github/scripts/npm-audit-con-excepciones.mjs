// Evalúa la salida de `npm audit --json` con un umbral de severidad y una
// lista corta de excepciones (.github/npm-audit-excepciones.json). npm audit
// no tiene forma de ignorar un advisory, y un aviso sin parche publicado
// dejaba el job en rojo sin nada accionable.
//
// Una excepción sólo cubre un advisory (GHSA) de un paquete puntual, en las
// carpetas que lista (`en`, comparada con el directorio desde el que corre), y vence
// sola en dos casos, para que no quede olvidada:
// - cuando npm ya puede arreglarlo sin romper nada (`fixAvailable` es `true` o
//   una actualización no mayor de una dependencia directa);
// - cuando pasa su fecha `revisar`.
//
// Uso: npm audit --json | node npm-audit-con-excepciones.mjs <nivel>
// El reporte llega por stdin y no como ruta, para no leer un archivo elegido
// desde afuera.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NIVELES = ['info', 'low', 'moderate', 'high', 'critical'];

const nivel = process.argv[2] ?? 'high';
if (!NIVELES.includes(nivel)) {
  console.error('Uso: npm audit --json | node npm-audit-con-excepciones.mjs <info|low|moderate|high|critical>');
  process.exit(2);
}

let audit;
try {
  audit = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  audit = null;
}
if (!audit || audit.error || typeof audit.vulnerabilities !== 'object' || audit.vulnerabilities === null) {
  // Un audit que no pudo correr (red, lockfile roto) no es un audit limpio. El
  // detalle ya lo escribió npm en stderr: acá no se repite su contenido.
  console.error('npm audit no devolvió un reporte válido.');
  process.exit(1);
}

const rutaExcepciones = join(dirname(fileURLToPath(import.meta.url)), '..', 'npm-audit-excepciones.json');
const excepciones = JSON.parse(readFileSync(rutaExcepciones, 'utf8'));
for (const excepcion of excepciones) {
  for (const campo of ['ghsa', 'paquete', 'motivo', 'revisar']) {
    if (typeof excepcion[campo] !== 'string' || excepcion[campo].trim() === '') {
      console.error(`Excepción inválida, le falta "${campo}":`, JSON.stringify(excepcion));
      process.exit(1);
    }
  }
  // Se compara como texto contra la fecha de hoy: sólo AAAA-MM-DD real ordena bien.
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(excepcion.revisar) ? new Date(`${excepcion.revisar}T00:00:00Z`) : null;
  if (!fecha || Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== excepcion.revisar) {
    console.error('Excepción inválida, "revisar" tiene que ser una fecha AAAA-MM-DD:', JSON.stringify(excepcion));
    process.exit(1);
  }
  if (!Array.isArray(excepcion.en) || excepcion.en.length === 0 || !excepcion.en.every((c) => typeof c === 'string')) {
    console.error('Excepción inválida, "en" tiene que listar las carpetas donde aplica:', JSON.stringify(excepcion));
    process.exit(1);
  }
}

const carpeta = basename(process.cwd());

const hoy = new Date().toISOString().slice(0, 10);
const umbral = NIVELES.indexOf(nivel);

/** `true` si npm ya lo puede arreglar sin un cambio mayor: la excepción deja de valer. */
function tieneArreglo(paquete) {
  const fix = audit.vulnerabilities[paquete]?.fixAvailable;
  return fix === true || (typeof fix === 'object' && fix !== null && !fix.isSemVerMajor);
}

const bloqueantes = new Map();
const exceptuados = new Map();

for (const vulnerabilidad of Object.values(audit.vulnerabilities)) {
  for (const via of vulnerabilidad.via) {
    // Las entradas string son la cadena de dependencias; los advisories son objetos.
    if (typeof via !== 'object' || via === null) continue;
    // Una severidad que no conocemos bloquea: mejor fallar que dejarla pasar.
    if (NIVELES.includes(via.severity) && NIVELES.indexOf(via.severity) < umbral) continue;
    const ghsa = String(via.url ?? '').split('/').pop();
    const clave = `${via.name} ${ghsa}`;
    const excepcion = excepciones.find((e) => e.ghsa === ghsa && e.paquete === via.name && e.en.includes(carpeta));

    if (!excepcion) {
      bloqueantes.set(clave, `${via.severity}: ${via.title} (${via.url})`);
    } else if (tieneArreglo(via.name)) {
      bloqueantes.set(
        clave,
        `${via.severity}: ${via.title} (${via.url}). Ya hay arreglo: corré \`npm audit fix --package-lock-only\` y sacá la excepción.`,
      );
    } else if (hoy > excepcion.revisar) {
      bloqueantes.set(
        clave,
        `${via.severity}: ${via.title} (${via.url}). La excepción venció el ${excepcion.revisar}: revisala o renovala.`,
      );
    } else {
      exceptuados.set(clave, `hasta el ${excepcion.revisar}: ${excepcion.motivo}`);
    }
  }
}

for (const [clave, detalle] of exceptuados) console.log(`Exceptuado ${clave} ${detalle}`);
for (const [clave, detalle] of bloqueantes) console.error(`Bloqueante ${clave} ${detalle}`);

if (bloqueantes.size > 0) {
  console.error(`${bloqueantes.size} advisory(s) desde ${nivel} sin excepción vigente.`);
  process.exit(1);
}
console.log(`Sin advisories desde ${nivel} fuera de las excepciones vigentes.`);
