/**
 * Lee matriz-cobertura.csv y emite cobertura-resumen.json: recuentos de
 * planeado/ejecutado/aprobado/fallido/bloqueado/no_aplicable, deduplicados por
 * id. No inventa cobertura: sólo agrega lo que ya está en el CSV.
 *
 *   npx tsx evals/adversarial/matriz/calcular-resumen.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIRECTORIO = dirname(fileURLToPath(import.meta.url));
const CSV = join(DIRECTORIO, 'matriz-cobertura.csv');
const SALIDA = join(DIRECTORIO, 'cobertura-resumen.json');

/** Parser CSV mínimo: alcanza porque todos los campos van entre comillas dobles. */
function parsearCsv(texto: string): Record<string, string>[] {
  const lineas = texto.trim().split('\n');
  const encabezado = parsearFila(lineas[0]);
  return lineas.slice(1).map((linea) => {
    const valores = parsearFila(linea);
    return Object.fromEntries(encabezado.map((columna, indice) => [columna, valores[indice] ?? '']));
  });
}

function parsearFila(linea: string): string[] {
  const campos: string[] = [];
  let actual = '';
  let dentroDeComillas = false;
  for (let i = 0; i < linea.length; i += 1) {
    const char = linea[i];
    if (dentroDeComillas) {
      if (char === '"' && linea[i + 1] === '"') {
        actual += '"';
        i += 1;
      } else if (char === '"') {
        dentroDeComillas = false;
      } else {
        actual += char;
      }
    } else if (char === '"') {
      dentroDeComillas = true;
    } else if (char === ',') {
      campos.push(actual);
      actual = '';
    } else {
      actual += char;
    }
  }
  campos.push(actual);
  return campos;
}

const ESTADOS = ['planeado', 'implementado', 'ejecutado_pass', 'ejecutado_fail', 'bloqueado', 'no_aplicable'] as const;

function main(): void {
  const filas = parsearCsv(readFileSync(CSV, 'utf8'));

  const porId = new Map<string, Record<string, string>>();
  const duplicados: string[] = [];
  for (const fila of filas) {
    if (porId.has(fila.id)) duplicados.push(fila.id);
    porId.set(fila.id, fila);
  }

  const unicas = [...porId.values()];
  const porEstado = Object.fromEntries(ESTADOS.map((estado) => [estado, unicas.filter((f) => f.estado === estado).length]));
  const porSeccion = new Map<string, number>();
  for (const fila of unicas) {
    porSeccion.set(fila.seccion, (porSeccion.get(fila.seccion) ?? 0) + 1);
  }
  const requierenPresupuesto = unicas.filter((f) => f.requiere_presupuesto === 'true').length;
  const repeticionesPlaneadas = unicas.reduce((total, f) => total + (Number(f.repeticiones_planeadas) || 0), 0);

  const resumen = {
    generadoEl: new Date().toISOString(),
    escenariosUnicos: unicas.length,
    filasEnCsv: filas.length,
    idsDuplicados: duplicados,
    porEstado,
    porSeccion: Object.fromEntries(porSeccion),
    requierenPresupuesto,
    repeticionesPlaneadasTotales: repeticionesPlaneadas,
    porcentajeEjecutado: unicas.length > 0
      ? Math.round(((porEstado.ejecutado_pass + porEstado.ejecutado_fail) / unicas.length) * 100)
      : 0,
    /** "implementado" = spec escrito y corrido en verde una vez (camino feliz esperado); ejecutado_pass/fail = el propio caso ES la assertion adversarial. */
    nota: 'implementado cuenta como evidencia de spec verde, no como "ejecutado" en el sentido de la sección 6 (que reserva ejecutado_pass/ejecutado_fail para el resultado del caso adversarial en sí).',
  };

  writeFileSync(SALIDA, JSON.stringify(resumen, null, 2) + '\n');
  console.log(`Escenarios únicos: ${resumen.escenariosUnicos} (${resumen.filasEnCsv} filas en el CSV)`);
  if (duplicados.length > 0) console.warn(`IDs duplicados: ${duplicados.join(', ')}`);
  console.table(porEstado);
  console.log(`Guardado en ${SALIDA}`);
}

main();
