import { describe, expect, it } from 'vitest';
import { bytesIpv6, ipPermitida, revisarUrl } from './ssrf.rules.js';

describe('ipPermitida', () => {
  it.each(['8.8.8.8', '151.101.1.69', '2606:4700::6810:84e5', '2a00:1450:4001:80b::200e'])('deja pasar la pública %s', (ip) => {
    expect(ipPermitida(ip)).toBe(true);
  });

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '198.18.0.1',
    '::',
    '::1',
    'fe80::1',
    'fd00::1',
    'fc00::abcd',
    'ff02::1',
    '2001:db8::1',
    '2001::1',
    // Una IPv4 privada escondida en una IPv6.
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '64:ff9b::a9fe:a9fe',
    '2002:c0a8:0101::1',
    '::127.0.0.1',
  ])('bloquea %s', (ip) => {
    expect(ipPermitida(ip)).toBe(false);
  });

  it('una IPv4 pública mapeada en IPv6 sí pasa', () => {
    expect(ipPermitida('::ffff:8.8.8.8')).toBe(true);
  });

  it('lo que no es una IP no pasa', () => {
    expect(ipPermitida('ejemplo.com')).toBe(false);
    expect(ipPermitida('')).toBe(false);
  });

  it('expande las formas cortas de IPv6', () => {
    expect(bytesIpv6('::1')).toEqual([...Array(15).fill(0), 1]);
    expect(bytesIpv6('::ffff:1.2.3.4')?.slice(10)).toEqual([0xff, 0xff, 1, 2, 3, 4]);
    expect(bytesIpv6('1::2::3')).toBeNull();
  });
});

describe('revisarUrl', () => {
  it('acepta https a un nombre público y le saca el fragmento', () => {
    const revisada = revisarUrl('https://articulo.mercadolibre.com.ar/MLA-123-mate#reviews');
    expect('url' in revisada && revisada.url.href).toBe('https://articulo.mercadolibre.com.ar/MLA-123-mate');
  });

  it.each([
    ['http://tienda.com/producto', 'host_no_permitido'],
    ['https://tienda.com:8443/producto', 'host_no_permitido'],
    ['https://user:pass@tienda.com/', 'host_no_permitido'],
    ['https://127.0.0.1/', 'host_no_permitido'],
    ['https://2130706433/', 'host_no_permitido'],
    ['https://0x7f.0.0.1/', 'host_no_permitido'],
    ['https://[::1]/', 'host_no_permitido'],
    ['https://localhost/', 'host_no_permitido'],
    ['https://db/', 'host_no_permitido'],
    ['https://api.railway.internal/', 'host_no_permitido'],
    ['https://impresora.local/', 'host_no_permitido'],
    ['file:///etc/passwd', 'url_invalida'],
    ['javascript:alert(1)', 'url_invalida'],
    ['no es una url', 'url_invalida'],
    [`https://tienda.com/${'a'.repeat(2100)}`, 'url_invalida'],
  ])('rechaza %s', (texto, motivo) => {
    expect(revisarUrl(texto)).toEqual({ motivo });
  });

  it('los hosts de prueba pueden ir por http y a otro puerto', () => {
    const revisada = revisarUrl('http://importacion-stub:4030/producto', new Set(['importacion-stub']));
    expect('url' in revisada).toBe(true);
    expect(revisarUrl('http://otro-stub:4030/producto', new Set(['importacion-stub']))).toEqual({ motivo: 'host_no_permitido' });
  });
});
