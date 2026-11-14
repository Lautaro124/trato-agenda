/**
 * Módulo de envíos contra Postgres real (LAU-102): que cada comercio sólo vea,
 * toque y cotice con sus zonas, que una zona que choca quede pausada y que
 * las consultas sin resolver se registren sin datos personales. Ver
 * test/base-de-prueba.ts.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { crearPrismaDePrueba, crearUsuarioDePrueba, hayBaseDePrueba } from '../../test/base-de-prueba.js';
import type { DatosZona } from './envios.rules.js';
import { EnviosService } from './envios.service.js';

const AGENTE = { descripcion: '.', tipoUso: 'otro', systemPrompt: '.', allowedActions: [], horaDesde: '00:00', horaHasta: '23:59' };

const MENDOZA: DatosZona = {
  nombre: 'Mendoza',
  activa: true,
  estado: 'tarifa',
  domicilio: true,
  sucursal: false,
  tarifaDomicilioCentavos: 920_000,
  tarifaSucursalCentavos: null,
  gratisDesdeCentavos: null,
  preparacionDias: null,
  transporteDesdeDias: null,
  transporteHastaDias: null,
  diasDespacho: [],
  instrucciones: null,
  coberturas: [{ nivel: 'provincia', provinciaId: '50', localidadId: null, cp: null }],
};

describe.skipIf(!hayBaseDePrueba)('envíos (Postgres real)', () => {
  let prisma: PrismaService;
  let envios: EnviosService;
  let dueno: User;
  let otroDueno: User;
  let deAgenda: User;

  beforeAll(async () => {
    prisma = crearPrismaDePrueba();
    await prisma.$connect();
    envios = new EnviosService(prisma);
    dueno = await crearUsuarioDePrueba(prisma);
    otroDueno = await crearUsuarioDePrueba(prisma);
    deAgenda = await crearUsuarioDePrueba(prisma);
    for (const [usuario, tipo] of [
      [dueno, 'ventas'],
      [otroDueno, 'ventas'],
      [deAgenda, 'agenda'],
    ] as const) {
      await prisma.agent.create({ data: { ...AGENTE, userId: usuario.id, tipoAsistente: tipo, haceEnvios: true } });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [dueno.id, otroDueno.id, deAgenda.id] } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.zonaEnvio.deleteMany({ where: { userId: { in: [dueno.id, otroDueno.id] } } });
    await prisma.consultaEnvioSinResolver.deleteMany({ where: { userId: { in: [dueno.id, otroDueno.id] } } });
    await prisma.configuracionEnvios.deleteMany({ where: { userId: { in: [dueno.id, otroDueno.id] } } });
  });

  it('una cuenta no ve, toca ni cotiza con las zonas de otra', async () => {
    await envios.guardarConfiguracion(dueno.id, { activo: true });
    await envios.guardarConfiguracion(otroDueno.id, { activo: true });
    const { zona } = await envios.guardarZona(dueno.id, null, MENDOZA);

    expect(await envios.listarZonas(otroDueno.id)).toEqual([]);
    await expect(envios.guardarZona(otroDueno.id, zona.id, MENDOZA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(envios.cambiarActiva(otroDueno.id, zona.id, false)).rejects.toBeInstanceOf(NotFoundException);
    await expect(envios.eliminarZona(otroDueno.id, zona.id)).rejects.toBeInstanceOf(NotFoundException);

    const propia = await envios.resolver(dueno.id, { provincia: 'Mendoza' }, { registrar: false });
    const ajena = await envios.resolver(otroDueno.id, { provincia: 'Mendoza' }, { registrar: false });
    expect(propia.modalidades[0].tarifaCentavos).toBe(920_000);
    expect(ajena.estado).toBe('sin_configurar');
  });

  it('una cuenta de agenda no tiene envíos', async () => {
    await expect(envios.listarZonas(deAgenda.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('una zona que choca con otra activa queda guardada pausada, con el conflicto', async () => {
    await envios.guardarZona(dueno.id, null, MENDOZA);
    const { zona, conflictos } = await envios.guardarZona(dueno.id, null, { ...MENDOZA, nombre: 'Cuyo', tarifaDomicilioCentavos: 880_000 });
    expect(zona.activa).toBe(false);
    expect(conflictos[0]).toMatchObject({ lugar: 'Mendoza (provincia)', modalidad: 'domicilio' });
    expect(await envios.conflictos(dueno.id)).toEqual([]);

    const reintento = await envios.cambiarActiva(dueno.id, zona.id, true);
    expect(reintento.zona.activa).toBe(false);
    expect(reintento.conflictos).toHaveLength(1);
  });

  it('una pausa vale desde la consulta siguiente', async () => {
    await envios.guardarConfiguracion(dueno.id, { activo: true });
    const { zona } = await envios.guardarZona(dueno.id, null, MENDOZA);
    expect((await envios.resolver(dueno.id, { provincia: 'Mendoza' }, { registrar: false })).estado).toBe('resuelto');
    await envios.cambiarActiva(dueno.id, zona.id, false);
    expect((await envios.resolver(dueno.id, { provincia: 'Mendoza' }, { registrar: false })).estado).toBe('sin_configurar');
  });

  it('registra lo que no pudo responder, sólo con la ubicación normalizada', async () => {
    await envios.guardarConfiguracion(dueno.id, { activo: true });
    await envios.resolver(dueno.id, { localidad: 'Rosario' }, { registrar: true });
    await envios.resolver(dueno.id, { localidad: 'Rosario' }, { registrar: true });
    await envios.resolver(dueno.id, { localidad: 'Rosario' }, { registrar: false });
    const filas = await prisma.consultaEnvioSinResolver.findMany({ where: { userId: dueno.id } });
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ motivo: 'sin_configurar', localidadId: '82084270', provinciaId: '82', cp: null });
    expect(await envios.sinResolver(dueno.id)).toEqual([expect.objectContaining({ lugar: 'Rosario, Santa Fe', cantidad: 2 })]);
    expect(await envios.sinResolver(otroDueno.id)).toEqual([]);
  });
});
