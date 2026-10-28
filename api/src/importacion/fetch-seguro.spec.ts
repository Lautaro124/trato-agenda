import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { descargar, textoDe, type OpcionesDescarga, type Resolver } from './fetch-seguro.js';

/**
 * Un servidor local hace de sitio. "sitio-de-prueba" es un host de prueba
 * (como el stub de los e2e) y resuelve a 127.0.0.1; cualquier otro nombre
 * pasa por las reglas de verdad.
 */
describe('descargar', () => {
  let servidor: Server;
  let puerto: number;

  beforeAll(async () => {
    servidor = createServer((pedido, respuesta) => {
      const ruta = pedido.url ?? '/';
      if (ruta === '/pagina') {
        respuesta.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        respuesta.end('<h1>Mate</h1>');
      } else if (ruta === '/gzip') {
        respuesta.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        respuesta.end(gzipSync('<p>comprimido</p>'));
      } else if (ruta === '/bomba') {
        // 10 MB de ceros que comprimidos son unos KB: el tope es sobre lo descomprimido.
        respuesta.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        respuesta.end(gzipSync(Buffer.alloc(10 * 1024 * 1024)));
      } else if (ruta === '/grande') {
        respuesta.writeHead(200, { 'content-type': 'text/html' });
        respuesta.end('x'.repeat(5000));
      } else if (ruta === '/pdf') {
        respuesta.writeHead(200, { 'content-type': 'application/pdf' });
        respuesta.end('%PDF');
      } else if (ruta === '/prohibido') {
        respuesta.writeHead(403, { 'content-type': 'text/html' });
        respuesta.end('no');
      } else if (ruta === '/a-metadata') {
        respuesta.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        respuesta.end();
      } else if (ruta === '/a-interno') {
        respuesta.writeHead(302, { location: 'https://interno.ejemplo.com/' });
        respuesta.end();
      } else if (ruta === '/relativa') {
        respuesta.writeHead(301, { location: '/pagina' });
        respuesta.end();
      } else if (ruta === '/bucle') {
        respuesta.writeHead(302, { location: '/bucle' });
        respuesta.end();
      } else if (ruta === '/goteo') {
        respuesta.writeHead(200, { 'content-type': 'text/html' });
        const intervalo = setInterval(() => respuesta.write('.'), 20);
        respuesta.on('close', () => clearInterval(intervalo));
      } else {
        respuesta.writeHead(404);
        respuesta.end();
      }
    });
    await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
    puerto = (servidor.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((listo) => servidor.close(() => listo())));

  const resolver: Resolver = async (host) => {
    if (host === 'sitio-de-prueba') return [{ address: '127.0.0.1', family: 4 }];
    if (host === 'interno.ejemplo.com') return [{ address: '10.0.0.5', family: 4 }];
    if (host === 'mezclado.ejemplo.com') return [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }];
    if (host === 'mapeado.ejemplo.com') return [{ address: '::ffff:127.0.0.1', family: 6 }];
    throw new Error('NXDOMAIN');
  };
  const opciones: OpcionesDescarga = {
    maxBytes: 1024 * 1024,
    tipos: ['text/html'],
    timeoutMs: 2000,
    hostsDePrueba: new Set(['sitio-de-prueba']),
    resolver,
  };
  const url = (ruta: string) => `http://sitio-de-prueba:${puerto}${ruta}`;

  it('baja una página de un host permitido', async () => {
    const descarga = await descargar(url('/pagina'), opciones);
    expect(textoDe(descarga)).toBe('<h1>Mate</h1>');
    expect(descarga.tipo).toBe('text/html');
  });

  it('descomprime gzip y sigue una redirección relativa', async () => {
    expect(textoDe(await descargar(url('/gzip'), opciones))).toBe('<p>comprimido</p>');
    const redirigida = await descargar(url('/relativa'), opciones);
    expect(redirigida.url.pathname).toBe('/pagina');
  });

  it('no se conecta a un nombre que resuelve a la red interna, ni aunque sea una de varias respuestas', async () => {
    await expect(descargar('https://interno.ejemplo.com/', opciones)).rejects.toMatchObject({ codigo: 'host_no_permitido' });
    await expect(descargar('https://mezclado.ejemplo.com/', opciones)).rejects.toMatchObject({ codigo: 'host_no_permitido' });
    await expect(descargar('https://mapeado.ejemplo.com/', opciones)).rejects.toMatchObject({ codigo: 'host_no_permitido' });
  });

  it('revisa cada redirección: ni a la metadata de la nube ni a un nombre interno', async () => {
    await expect(descargar(url('/a-metadata'), opciones)).rejects.toMatchObject({ codigo: 'host_no_permitido' });
    await expect(descargar(url('/a-interno'), opciones)).rejects.toMatchObject({ codigo: 'host_no_permitido' });
  });

  it('corta un bucle de redirecciones', async () => {
    await expect(descargar(url('/bucle'), opciones)).rejects.toMatchObject({ codigo: 'error_del_sitio' });
  });

  it('corta por tamaño, también lo que llega comprimido', async () => {
    await expect(descargar(url('/grande'), { ...opciones, maxBytes: 1000 })).rejects.toMatchObject({ codigo: 'demasiado_grande' });
    await expect(descargar(url('/bomba'), opciones)).rejects.toMatchObject({ codigo: 'demasiado_grande' });
  });

  it('rechaza otro tipo de contenido, un 403 y lo que no existe', async () => {
    await expect(descargar(url('/pdf'), opciones)).rejects.toMatchObject({ codigo: 'tipo_no_soportado' });
    await expect(descargar(url('/prohibido'), opciones)).rejects.toMatchObject({ codigo: 'acceso_denegado' });
    await expect(descargar(url('/nada'), opciones)).rejects.toMatchObject({ codigo: 'no_encontrada' });
    await expect(descargar('https://no-existe.ejemplo.com/', opciones)).rejects.toMatchObject({ codigo: 'sin_conexion' });
  });

  it('corta por tiempo aunque el sitio mande de a gotas', async () => {
    await expect(descargar(url('/goteo'), { ...opciones, timeoutMs: 300 })).rejects.toMatchObject({ codigo: 'tiempo_agotado' });
  });
});
