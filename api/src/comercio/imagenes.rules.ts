/**
 * Reglas de las fotos de productos, igual que catalogo.rules.ts: los límites
 * viven acá como constantes y el procesado es una función sin base ni red.
 *
 * Las fotos se guardan en Postgres, así que todo apunta a que ocupen poco:
 * una por producto, un techo por cuenta, y lo que se guarda nunca es el
 * archivo que subió el dueño sino un JPEG recomprimido, chico y sin metadatos
 * (una foto de celular trae el GPS de donde se sacó).
 */
import sharp, { type Metadata, type OutputInfo } from 'sharp';

/** Peso máximo del archivo que se sube. El navegador ya lo achica antes de mandarlo. */
export const MAX_BYTES_SUBIDA = 2 * 1024 * 1024;

/** Píxeles máximos del archivo de entrada: corta las bombas de descompresión. */
export const MAX_PIXELES_ENTRADA = 25_000_000;

/** Lado mayor de lo que se guarda. Alcanza para verla bien en el chat. */
export const LADO_MAXIMO = 800;

/** Calidades JPEG que se prueban en orden hasta entrar en `MAX_BYTES_GUARDADA`. */
export const CALIDADES_JPEG = [75, 60, 45] as const;

/** Peso máximo de lo que queda guardado. */
export const MAX_BYTES_GUARDADA = 150 * 1024;

/** Productos con foto por cuenta. Reemplazar la de un producto no suma. */
export const MAX_IMAGENES_POR_CUENTA = 100;

/** Fotos que el asistente puede mandar en una misma respuesta. */
export const MAX_IMAGENES_POR_MENSAJE = 2;

/** Formatos que se aceptan, reconocidos por su contenido y nunca por el nombre del archivo. */
export const FORMATOS_ACEPTADOS = ['jpeg', 'png', 'webp'] as const;

export type FormatoAceptado = (typeof FORMATOS_ACEPTADOS)[number];

export type ImagenProcesada = { datos: Buffer; bytes: number; ancho: number; alto: number };

/** El archivo no sirve como foto de producto. El mensaje se le muestra al dueño tal cual. */
export class ImagenInvalidaError extends Error {}

const FORMATO_INVALIDO = 'La foto tiene que ser JPG, PNG o WebP.';

/**
 * Formato por la firma de los primeros bytes. Va antes de entregarle el
 * archivo a sharp, que sabe leer muchos más formatos (SVG, TIFF, PDF…) de
 * los que queremos aceptar.
 */
export function formatoPorFirma(buffer: Buffer): FormatoAceptado | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Valida y recomprime la foto que subió el dueño: la endereza según su EXIF,
 * la achica a `LADO_MAXIMO` sin agrandarla, la pasa a JPEG y la deja sin
 * metadatos (sharp no copia ninguno salvo que se le pida). Si ni con la
 * calidad más baja entra en `MAX_BYTES_GUARDADA`, la rechaza.
 */
export async function procesarImagen(buffer: Buffer): Promise<ImagenProcesada> {
  if (buffer.length === 0) throw new ImagenInvalidaError('El archivo está vacío.');
  if (buffer.length > MAX_BYTES_SUBIDA) {
    throw new ImagenInvalidaError(`La foto pesa demasiado: el máximo es ${MAX_BYTES_SUBIDA / 1024 / 1024} MB.`);
  }
  const formato = formatoPorFirma(buffer);
  if (!formato) throw new ImagenInvalidaError(FORMATO_INVALIDO);

  const opciones = { limitInputPixels: MAX_PIXELES_ENTRADA, failOn: 'error' as const };
  let metadatos: Metadata;
  try {
    metadatos = await sharp(buffer, opciones).metadata();
  } catch {
    throw new ImagenInvalidaError('No se pudo leer la foto: puede estar dañada.');
  }
  if (metadatos.format !== formato) throw new ImagenInvalidaError(FORMATO_INVALIDO);
  if ((metadatos.width ?? 0) * (metadatos.height ?? 0) > MAX_PIXELES_ENTRADA) {
    throw new ImagenInvalidaError('La foto tiene demasiada resolución.');
  }

  for (const calidad of CALIDADES_JPEG) {
    let salida: { data: Buffer; info: OutputInfo };
    try {
      salida = await sharp(buffer, opciones)
        .autoOrient()
        .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
        // Lo transparente de un PNG o WebP queda blanco en vez de negro.
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: calidad, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new ImagenInvalidaError('No se pudo procesar la foto: puede estar dañada.');
    }
    if (salida.data.length <= MAX_BYTES_GUARDADA) {
      return { datos: salida.data, bytes: salida.data.length, ancho: salida.info.width, alto: salida.info.height };
    }
  }
  throw new ImagenInvalidaError('No se pudo achicar la foto lo suficiente: probá con otra.');
}
