import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  formatoPorFirma,
  ImagenInvalidaError,
  LADO_MAXIMO,
  MAX_BYTES_GUARDADA,
  MAX_BYTES_SUBIDA,
  procesarImagen,
} from './imagenes.rules.js';

/** Imagen de prueba con ruido, para que no se comprima a casi nada como un color liso. */
async function imagen(formato: 'jpeg' | 'png' | 'webp' | 'gif' | 'tiff', ancho = 1200, alto = 900): Promise<Buffer> {
  const ruido = Buffer.alloc(ancho * alto * 3);
  for (let i = 0; i < ruido.length; i++) ruido[i] = (i * 7919 + (i >> 5) * 104729) % 256;
  return sharp(ruido, { raw: { width: ancho, height: alto, channels: 3 } }).toFormat(formato).toBuffer();
}

async function esperarRechazo(promesa: Promise<unknown>, mensaje: RegExp): Promise<void> {
  await expect(promesa).rejects.toBeInstanceOf(ImagenInvalidaError);
  await expect(promesa).rejects.toThrow(mensaje);
}

describe('formatoPorFirma', () => {
  it('reconoce JPEG, PNG y WebP por sus primeros bytes', async () => {
    expect(formatoPorFirma(await imagen('jpeg', 10, 10))).toBe('jpeg');
    expect(formatoPorFirma(await imagen('png', 10, 10))).toBe('png');
    expect(formatoPorFirma(await imagen('webp', 10, 10))).toBe('webp');
  });

  it('no reconoce otros formatos ni texto, aunque digan ser una foto', async () => {
    expect(formatoPorFirma(await imagen('gif', 10, 10))).toBeNull();
    expect(formatoPorFirma(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(formatoPorFirma(Buffer.from('foto.jpg'))).toBeNull();
    expect(formatoPorFirma(Buffer.alloc(0))).toBeNull();
  });
});

describe('procesarImagen', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('acepta %s y lo guarda como JPEG chico', async (formato) => {
    const resultado = await procesarImagen(await imagen(formato, 2000, 1000));

    const metadatos = await sharp(resultado.datos).metadata();
    expect(metadatos.format).toBe('jpeg');
    expect(Math.max(resultado.ancho, resultado.alto)).toBe(LADO_MAXIMO);
    expect(resultado.ancho).toBe(LADO_MAXIMO);
    expect(resultado.alto).toBe(LADO_MAXIMO / 2);
    expect(resultado.bytes).toBe(resultado.datos.length);
    expect(resultado.bytes).toBeLessThanOrEqual(MAX_BYTES_GUARDADA);
  });

  it('no agranda una foto chica', async () => {
    const resultado = await procesarImagen(await imagen('png', 300, 200));
    expect([resultado.ancho, resultado.alto]).toEqual([300, 200]);
  });

  it('borra los metadatos (EXIF con GPS incluido) y endereza según la orientación', async () => {
    const conExif = await sharp(await imagen('jpeg', 400, 200))
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'secreto' }, IFD3: { GPSLatitudeRef: 'S' } } })
      .jpeg()
      .toBuffer();
    expect((await sharp(conExif).metadata()).exif).toBeDefined();

    const resultado = await procesarImagen(conExif);
    const metadatos = await sharp(resultado.datos).metadata();
    expect(metadatos.exif).toBeUndefined();
    expect(metadatos.icc).toBeUndefined();
    expect(metadatos.orientation).toBeUndefined();
    // Orientación 6 = rotada 90°: queda parada.
    expect([resultado.ancho, resultado.alto]).toEqual([200, 400]);
  });

  it('rechaza GIF, TIFF, SVG y texto con nombre de foto', async () => {
    await esperarRechazo(procesarImagen(await imagen('gif', 50, 50)), /JPG, PNG o WebP/);
    await esperarRechazo(procesarImagen(await imagen('tiff', 50, 50)), /JPG, PNG o WebP/);
    await esperarRechazo(procesarImagen(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), /JPG, PNG o WebP/);
    await esperarRechazo(procesarImagen(Buffer.from('no soy una foto')), /JPG, PNG o WebP/);
  });

  it('rechaza un archivo vacío, uno demasiado pesado y uno roto', async () => {
    await esperarRechazo(procesarImagen(Buffer.alloc(0)), /vacío/);
    const pesado = Buffer.concat([await imagen('jpeg', 10, 10), Buffer.alloc(MAX_BYTES_SUBIDA)]);
    await esperarRechazo(procesarImagen(pesado), /pesa demasiado/);
    const roto = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    await esperarRechazo(procesarImagen(roto), /dañada/);
  });

  it('rechaza una bomba de píxeles sin decodificarla entera', async () => {
    // 6000 × 6000 = 36 MP, liso: pesa poco pero descomprimido son ~100 MB.
    const bomba = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer();
    expect(bomba.length).toBeLessThan(MAX_BYTES_SUBIDA);
    await expect(procesarImagen(bomba)).rejects.toBeInstanceOf(ImagenInvalidaError);
  });
});
