/**
 * La importación rápida de punta a punta contra Postgres real y un sitio
 * local que hace de tienda y de API de Mercado Libre: extraer, la vista
 * previa con sus duplicados, confirmar (con la foto) y reintentar sin duplicar.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import { ImagenesService } from '../comercio/imagenes.service.js';
import type { IndexadorService } from '../comercio/indexador.service.js';
import { ProductosService } from '../comercio/productos.service.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ExtraccionIaService } from './extraccion-ia.js';
import { ImportacionService } from './importacion.service.js';
import type { ItemConfirmadoDto } from './importacion.types.js';
import { MercadoLibreClient } from './mercadolibre.client.js';
import type { BorradorProducto } from './modelo.js';

const AGENTE = { descripcion: '.', tipoUso: 'otro', systemPrompt: '.', allowedActions: [], horaDesde: '00:00', horaHasta: '23:59' };

function jsonLd(dato: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(dato)}</script></head><body></body></html>`;
}

describe.skipIf(!hayBaseDePrueba)('importación rápida (Postgres real)', () => {
  let prisma: PrismaService;
  let servidor: Server;
  let base: string;
  let dueno: User;
  let otroDueno: User;
  let foto: Buffer;
  const extraccionIa = vi.fn();
  let importacion: ImportacionService;

  beforeAll(async () => {
    foto = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#c0a080' } }).jpeg().toBuffer();
    servidor = createServer((pedido, respuesta) => {
      const ruta = new URL(pedido.url ?? '/', 'http://sitio').pathname;
      const html = (cuerpo: string) => {
        respuesta.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        respuesta.end(cuerpo);
      };
      const json = (dato: unknown) => {
        respuesta.writeHead(200, { 'content-type': 'application/json' });
        respuesta.end(JSON.stringify(dato));
      };
      if (ruta === '/mate') {
        html(
          jsonLd({
            '@type': 'Product',
            name: 'Mate imperial',
            description: 'Calabaza forrada en cuero.',
            sku: 'MATE-IMP',
            image: `${base}/foto.jpg`,
            offers: { price: '25000', priceCurrency: 'ARS' },
          }),
        );
      } else if (ruta === '/auriculares') {
        html(
          jsonLd({
            '@type': 'ProductGroup',
            name: 'Auriculares',
            hasVariant: [
              { '@type': 'Product', name: 'Auriculares - Negro', offers: { price: 25, priceCurrency: 'USD' } },
              { '@type': 'Product', name: 'Auriculares - Blanco', offers: { price: 27, priceCurrency: 'USD' } },
            ],
          }),
        );
      } else if (ruta === '/sin-precio') {
        html(jsonLd({ '@type': 'Product', name: 'Taza', offers: { priceCurrency: 'ARS' } }));
      } else if (ruta === '/categoria') {
        html(jsonLd({ '@type': 'ItemList', itemListElement: [{ url: '/mate' }, { url: '/auriculares' }, { url: '/nada' }] }));
      } else if (ruta === '/landing') {
        // Una landing sin datos de producto: cada modelo es un título con su foto y sus medidas.
        const modelo = (nombre: string, foto: string, texto: string) =>
          `<section><h2>${nombre}</h2><img src="/fotos/${foto}.jpg" alt=""><p>Un cuerpo:</p><p>100 x 80 cm</p><p>${texto}</p></section>`;
        html(
          `<html><body><header><img src="/logo.png"><h1>Sillones</h1></header>` +
            `<h2>Elegí tu modelo</h2><p>Todos se hacen en fábrica.</p>` +
            modelo('Línea Retro', 'retro', 'Cotizar a medida') +
            modelo('Línea Cubos', 'cubos', 'Medidas a pedido') +
            modelo('Línea Kiev', 'kiev', 'Tela pana') +
            `<h2>Medios de pago</h2><p>Efectivo con 15% de descuento</p></body></html>`,
        );
      } else if (ruta === '/blog') {
        html('<html><head><title>Hola</title></head></html>');
      } else if (ruta === '/a-la-base') {
        respuesta.writeHead(302, { location: 'http://10.0.0.1:5432/' });
        respuesta.end();
      } else if (ruta === '/foto.jpg') {
        respuesta.writeHead(200, { 'content-type': 'image/jpeg' });
        respuesta.end(foto);
      } else if (ruta === '/ml/items/MLA1234567890') {
        json({
          id: 'MLA1234567890',
          title: 'Termo Stanley 1L',
          price: 120000,
          currency_id: 'ARS',
          pictures: [],
          variations: [
            { price: 120000, attribute_combinations: [{ name: 'Color', value_name: 'Verde' }], seller_custom_field: 'TER-V' },
            { price: 125000, attribute_combinations: [{ name: 'Color', value_name: 'Negro' }], seller_custom_field: 'TER-N' },
          ],
        });
      } else if (ruta === '/ml/items/MLA1234567890/description') {
        json({ plain_text: 'Mantiene la temperatura 24 horas. Precio especial $ 1.' });
      } else {
        respuesta.writeHead(404);
        respuesta.end();
      }
    });
    await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    dueno = await crearUsuarioDePrueba(prisma);
    otroDueno = await crearUsuarioDePrueba(prisma);
    await prisma.agent.create({
      data: { ...AGENTE, userId: dueno.id, nombreTitular: 'Mates Lupe', nombreBot: 'Lupe', tipoAsistente: 'ventas' },
    });
    await prisma.agent.create({
      data: { ...AGENTE, userId: otroDueno.id, nombreTitular: 'Consultorio', nombreBot: 'Ana', tipoAsistente: 'agenda' },
    });

    const valores: Partial<Env> = {
      MERCADOLIBRE_API_URL: `${base}/ml`,
      MERCADOLIBRE_CLIENT_ID: '',
      MERCADOLIBRE_CLIENT_SECRET: '',
      IMPORTACION_HOSTS_DE_PRUEBA: '127.0.0.1',
      TOKEN_ENCRYPTION_KEY: 'c'.repeat(64),
    };
    const config = { get: (clave: keyof Env) => valores[clave] } as unknown as ConfigService<Env, true>;
    const indexador = { programar: vi.fn() } as unknown as IndexadorService;
    importacion = new ImportacionService(
      prisma,
      new ProductosService(prisma, indexador),
      new ImagenesService(prisma),
      new MercadoLibreClient(config),
      { productos: extraccionIa } as unknown as ExtraccionIaService,
      config,
    );
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [dueno.id, otroDueno.id] } } });
    await prisma.$disconnect();
    await new Promise<void>((listo) => servidor.close(() => listo()));
  });

  beforeEach(async () => {
    extraccionIa.mockReset().mockResolvedValue([]);
    await prisma.producto.deleteMany({ where: { userId: dueno.id } });
  });

  const confirmable = (borrador: BorradorProducto, extra: Partial<ItemConfirmadoDto> = {}): ItemConfirmadoDto =>
    ({
      claveOrigen: borrador.claveOrigen,
      origenUrl: borrador.origenUrl,
      imagenes: borrador.imagenes,
      emitidaAt: borrador.emitidaAt,
      firma: borrador.firma,
      accion: 'crear',
      imagenElegida: borrador.imagenes.length > 0 ? 0 : null,
      producto: {
        tipo: 'stock',
        codigo: borrador.codigoSugerido,
        nombre: borrador.nombre,
        descripcion: borrador.descripcion,
        categoria: borrador.categoria,
        moneda: borrador.moneda ?? 'ARS',
        variantes: borrador.variantes.map((variante) => ({
          nombre: variante.nombre,
          ...(variante.sku ? { sku: variante.sku } : {}),
          precioCentavos: variante.precioCentavos ?? 100,
          stock: null,
        })),
      },
      ...extra,
    }) as ItemConfirmadoDto;

  it('es sólo para cuentas de ventas', async () => {
    await expect(importacion.extraer(otroDueno.id, [`${base}/mate`])).rejects.toMatchObject({ status: 409 });
  });

  it('lee productos de una tienda, de un listado y de Mercado Libre, y explica lo que no pudo', async () => {
    const resultado = await importacion.extraer(dueno.id, [
      `${base}/mate`,
      `${base}/categoria`,
      'https://articulo.mercadolibre.com.ar/MLA-1234567890-termo-stanley-_JM',
      `${base}/sin-precio`,
      `${base}/blog`,
      `${base}/a-la-base`,
      'https://localhost/',
    ]);

    // El mate aparece dos veces (suelto y en la categoría) pero va una sola.
    expect(resultado.productos.map((producto) => producto.nombre)).toEqual(['Mate imperial', 'Auriculares', 'Termo Stanley 1L', 'Taza']);
    const [mate, auriculares, termo, taza] = resultado.productos;
    expect(mate).toMatchObject({ moneda: 'ARS', codigoSugerido: 'MATE-IMPERIAL', imagenes: [`${base}/foto.jpg`], duplicado: null });
    expect(auriculares).toMatchObject({ moneda: 'USD', variantes: [{ nombre: 'Negro', precioCentavos: 2500 }, { nombre: 'Blanco', precioCentavos: 2700 }] });
    expect(termo).toMatchObject({
      claveOrigen: 'ml:MLA1234567890',
      codigoSugerido: 'MLA1234567890',
      variantes: [
        { nombre: 'Color: Verde', sku: 'TER-V', precioCentavos: 12_000_000 },
        { nombre: 'Color: Negro', sku: 'TER-N', precioCentavos: 12_500_000 },
      ],
    });
    // El "$ 1" de la descripción no llega: respaldaría un precio inventado.
    expect(termo.descripcion).toBe('Mantiene la temperatura 24 horas. Precio especial');
    expect(taza).toMatchObject({ variantes: [{ precioCentavos: null }], avisos: expect.arrayContaining(['sin_precio']) });
    expect(resultado.errores).toEqual(
      expect.arrayContaining([
        { url: `${base}/nada`, codigo: 'no_encontrada' },
        { url: `${base}/blog`, codigo: 'sin_datos_de_producto' },
        { url: `${base}/a-la-base`, codigo: 'host_no_permitido' },
        { url: 'https://localhost/', codigo: 'host_no_permitido' },
      ]),
    );
    expect(await prisma.producto.count({ where: { userId: dueno.id } })).toBe(0);
    // /blog no tiene productos ni secciones: se le preguntó a la IA, que no encontró nada.
    expect(extraccionIa).toHaveBeenCalledTimes(1);
  });

  it('lee una landing sin datos de producto por sus secciones, sin precio y sugeridas a medida', async () => {
    const resultado = await importacion.extraer(dueno.id, [`${base}/landing`]);
    expect(resultado.errores).toEqual([]);
    expect(extraccionIa).not.toHaveBeenCalled();
    expect(resultado.productos.map((producto) => [producto.nombre, producto.tipoSugerido])).toEqual([
      ['Línea Retro', 'a_medida'],
      ['Línea Cubos', 'a_medida'],
      ['Línea Kiev', null],
    ]);
    const [retro, cubos] = resultado.productos;
    expect(retro).toMatchObject({
      descripcion: 'Un cuerpo: 100 x 80 cm\nCotizar a medida',
      imagenes: [`${base}/fotos/retro.jpg`],
      variantes: [{ precioCentavos: null }],
      origenUrl: `${base}/landing#linea-retro`,
    });
    expect(retro.claveOrigen).not.toBe(cubos.claveOrigen);
  });

  it('confirma un producto sin precio como a medida, y una importación no le cambia el tipo', async () => {
    const [retro] = (await importacion.extraer(dueno.id, [`${base}/landing`])).productos;
    const comoAMedida = (borrador: BorradorProducto, extra: Partial<ItemConfirmadoDto> = {}) =>
      confirmable(borrador, {
        imagenElegida: null,
        producto: {
          ...confirmable(borrador).producto,
          tipo: 'a_medida',
          moneda: 'ARS',
          variantes: [],
          precioReferenciaCentavos: 50_000_000,
          materiales: ['Pana', 'Chenille'],
        },
        ...extra,
      });
    const creado = await importacion.confirmar(dueno.id, [comoAMedida(retro)]);
    expect(creado.resultados).toEqual([expect.objectContaining({ estado: 'creado', tipo: 'a_medida' })]);
    const guardado = await prisma.producto.findFirstOrThrow({ where: { userId: dueno.id }, include: { variantes: true } });
    expect(guardado).toMatchObject({
      nombre: 'Línea Retro',
      moneda: 'ARS',
      solicitud: { preguntas: [] },
      precioReferenciaCentavos: 50_000_000,
      materiales: ['Pana', 'Chenille'],
    });
    expect(guardado.variantes).toEqual([]);

    // Las preguntas que el dueño cargó después no se pierden al actualizarlo desde la importación.
    const conPreguntas = { preguntas: [{ texto: '¿Qué medida?', sobre: 'solicita', opciones: [], textoLibre: true, obligatoria: true }] };
    await prisma.producto.update({ where: { id: guardado.id }, data: { solicitud: conPreguntas } });
    const actualizado = await importacion.confirmar(dueno.id, [comoAMedida(retro, { accion: 'actualizar' })]);
    expect(actualizado.resultados).toEqual([expect.objectContaining({ estado: 'actualizado' })]);
    expect(await prisma.producto.findUniqueOrThrow({ where: { id: guardado.id } })).toMatchObject({
      solicitud: conPreguntas,
      precioReferenciaCentavos: 50_000_000,
      materiales: ['Pana', 'Chenille'],
    });
    // Sin precio "desde" ni materiales en la vista previa, se conservan los que ya tenía.
    const sinDatos = comoAMedida(retro, { accion: 'actualizar' });
    sinDatos.producto = { ...sinDatos.producto, precioReferenciaCentavos: null, materiales: [] };
    await importacion.confirmar(dueno.id, [sinDatos]);
    expect(await prisma.producto.findUniqueOrThrow({ where: { id: guardado.id } })).toMatchObject({
      precioReferenciaCentavos: 50_000_000,
      materiales: ['Pana', 'Chenille'],
    });

    // De stock sobre uno a medida: no se cambia de tipo con una importación.
    const comoStock = await importacion.confirmar(dueno.id, [confirmable(retro, { accion: 'actualizar', imagenElegida: null })]);
    expect(comoStock.resultados).toEqual([expect.objectContaining({ estado: 'error', motivo: expect.stringContaining('es a medida') })]);

    // A medida no lleva stock: lo valida el código, no la pantalla.
    const [kiev] = (await importacion.extraer(dueno.id, [`${base}/landing`])).productos.slice(2);
    const conStock = await importacion.confirmar(dueno.id, [
      comoAMedida(kiev, { producto: { ...comoAMedida(kiev).producto, variantes: [{ nombre: 'Tres cuerpos', precioCentavos: 100, stock: 3 }] } }),
    ]);
    expect(conStock.resultados).toEqual([expect.objectContaining({ estado: 'error', motivo: expect.stringContaining('no lleva stock') })]);
  });

  it('confirma con la foto, y reimportar no duplica: se marca, se saltea o se actualiza', async () => {
    const [mate] = (await importacion.extraer(dueno.id, [`${base}/mate`])).productos;
    const primera = await importacion.confirmar(dueno.id, [confirmable(mate)]);
    expect(primera.resultados).toEqual([expect.objectContaining({ estado: 'creado', foto: 'guardada' })]);
    const guardado = await prisma.producto.findFirstOrThrow({ where: { userId: dueno.id }, include: { imagen: true, variantes: true } });
    expect(guardado).toMatchObject({ codigo: 'MATE-IMPERIAL', moneda: 'ARS', origenId: mate.claveOrigen, origenUrl: `${base}/mate` });
    expect(guardado.imagen).not.toBeNull();
    expect(guardado.variantes).toEqual([expect.objectContaining({ sku: 'MATE-IMP', precioCentavos: 2_500_000, stock: null })]);

    const [otraVez] = (await importacion.extraer(dueno.id, [`${base}/mate?utm_source=ig`])).productos;
    expect(otraVez).toMatchObject({ claveOrigen: mate.claveOrigen, codigoSugerido: 'MATE-IMPERIAL', duplicado: { motivo: 'origen', productoId: guardado.id } });

    const repetida = await importacion.confirmar(dueno.id, [confirmable(otraVez)]);
    expect(repetida.resultados).toEqual([expect.objectContaining({ estado: 'salteado', productoId: guardado.id })]);

    const actualizada = await importacion.confirmar(dueno.id, [
      confirmable(otraVez, {
        accion: 'actualizar',
        imagenElegida: null,
        producto: { ...confirmable(otraVez).producto, nombre: 'Mate imperial XL' },
      }),
    ]);
    expect(actualizada.resultados).toEqual([expect.objectContaining({ estado: 'actualizado', productoId: guardado.id })]);
    expect(await prisma.producto.count({ where: { userId: dueno.id } })).toBe(1);
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: guardado.id } })).nombre).toBe('Mate imperial XL');
  });

  it('no acepta una vista previa adulterada ni de otra cuenta', async () => {
    const [mate] = (await importacion.extraer(dueno.id, [`${base}/mate`])).productos;
    const adulterada = await importacion.confirmar(dueno.id, [
      confirmable(mate, { imagenes: ['http://10.0.0.1:5432/'], imagenElegida: 0 }),
      confirmable(mate, { claveOrigen: 'ml:MLA999' }),
    ]);
    expect(adulterada.resultados.map((resultado) => resultado.estado)).toEqual(['error', 'error']);
    expect(await prisma.producto.count({ where: { userId: dueno.id } })).toBe(0);
  });
});
