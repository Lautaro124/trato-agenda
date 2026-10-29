/**
 * Un .xlsx mínimo para los tests: hojas con celdas de texto o número, en un
 * zip sin comprimir. Alcanza para imitar el export de Mercado Libre sin
 * guardar un archivo real (con el catálogo de alguien) en el repo.
 */

type Celda = string | number | null;
export type Hoja = { nombre: string; filas: Celda[][] };

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(datos: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of datos) crc = TABLA_CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Zip "stored" (sin compresión): encabezado local + datos por archivo, y el directorio central al final. */
function zip(archivos: Array<{ nombre: string; contenido: string }>): Buffer {
  const locales: Buffer[] = [];
  const central: Buffer[] = [];
  let desplazamiento = 0;
  for (const archivo of archivos) {
    const nombre = Buffer.from(archivo.nombre);
    const datos = Buffer.from(archivo.contenido);
    const crc = crc32(datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    locales.push(local, nombre, datos);

    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0);
    entrada.writeUInt16LE(20, 4);
    entrada.writeUInt16LE(20, 6);
    entrada.writeUInt32LE(crc, 16);
    entrada.writeUInt32LE(datos.length, 20);
    entrada.writeUInt32LE(datos.length, 24);
    entrada.writeUInt16LE(nombre.length, 28);
    entrada.writeUInt32LE(desplazamiento, 42);
    central.push(entrada, nombre);
    desplazamiento += local.length + nombre.length + datos.length;
  }
  const directorio = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, directorio, fin]);
}

const escapar = (texto: string) => texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function columna(indice: number): string {
  let nombre = '';
  for (let n = indice + 1; n > 0; n = Math.floor((n - 1) / 26)) nombre = String.fromCharCode(65 + ((n - 1) % 26)) + nombre;
  return nombre;
}

function hojaXml(filas: Celda[][]): string {
  const xml = filas
    .map((fila, f) => {
      const celdas = fila
        .map((valor, c) => {
          const ref = `${columna(c)}${f + 1}`;
          if (valor === null) return '';
          if (typeof valor === 'number') return `<c r="${ref}"><v>${valor}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapar(valor)}</t></is></c>`;
        })
        .join('');
      return `<row r="${f + 1}">${celdas}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xml}</sheetData></worksheet>`;
}

export function crearXlsx(hojas: Hoja[]): Buffer {
  const principal = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relaciones = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zip([
    {
      nombre: '[Content_Types].xml',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${hojas
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    },
    {
      nombre: '_rels/.rels',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relaciones}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nombre: 'xl/workbook.xml',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${principal}" xmlns:r="${relaciones}"><sheets>${hojas
        .map((hoja, i) => `<sheet name="${escapar(hoja.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${relaciones}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}</Relationships>`,
    },
    ...hojas.map((hoja, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: hojaXml(hoja.filas) })),
  ]);
}
