import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ACCIONES_IDS, ACCIONES_VENTAS_IDS } from './agent-catalog.js';
import { PLANTILLA_VERSION, construirConfiguracion } from './agent-template.js';
import { PLANTILLA_VENTAS_VERSION } from './agent-template-ventas.js';
import { AgentsService, construirDescripcion } from './agents.service.js';
import type { GenerateAgentDto } from './agents.types.js';

function crearServicio() {
  const upsert = vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) =>
    Promise.resolve({ id: 'agent-1', createdAt: new Date(), updatedAt: new Date(), ...create }),
  );
  const findUnique = vi.fn();
  const update = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'agent-1', createdAt: new Date(), updatedAt: new Date(), ...data }),
  );
  const prisma = { agent: { upsert, findUnique, update } } as unknown as PrismaService;

  return { service: new AgentsService(prisma), prisma, upsert, findUnique, update };
}

const dto: GenerateAgentDto = {
  tipoTitular: 'negocio',
  nombreTitular: 'Tienda Centro',
  tipoUso: 'comercio',
  tiposEvento: [
    { nombre: 'Probador', duracionMin: 20 },
    { nombre: 'Presupuesto', duracionMin: 30 },
  ],
  horaDesde: '09:00',
  horaHasta: '18:00',
  nombreBot: 'Tati',
};

/** El perfil que rompía con 502 contra OpenRouter: ya no depende de eso. */
const dtoCincoPropios: GenerateAgentDto = {
  tipoTitular: 'negocio',
  nombreTitular: 'Estudio "La Ñata" & Cía',
  tipoUso: 'otro',
  tiposEvento: [
    { nombre: 'Sesión de fotos en exterior', duracionMin: 90 },
    { nombre: 'Retoque 💇‍♀️ express', duracionMin: 15 },
    { nombre: 'Entrega de álbum / revisión', duracionMin: 30 },
    { nombre: 'Consulta "previa" por videollamada', duracionMin: 20 },
    { nombre: 'Taller grupal de iluminación para principiantes y curiosos', duracionMin: 120 },
  ],
  horaDesde: '10:00',
  horaHasta: '19:00',
  nombreBot: 'Nina',
};

describe('AgentsService.generate', () => {
  it('no depende de ningún cliente HTTP/LLM: el constructor no recibe uno', () => {
    // AgentsService sólo toma PrismaService — si necesitara OpenRouter para
    // generar, este test de tipos/constructor ya no compilaría.
    const { service } = crearServicio();
    expect(service).toBeInstanceOf(AgentsService);
  });

  it('persiste exactamente la config que produce el constructor determinista', async () => {
    const { service, upsert } = crearServicio();
    const esperado = construirConfiguracion(dto);

    await service.generate('user-1', dto);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        create: expect.objectContaining({
          userId: 'user-1',
          systemPrompt: esperado.systemPrompt,
          allowedActions: esperado.allowedActions,
          model: null,
          templateVersion: PLANTILLA_VERSION,
        }),
      }),
    );
  });

  it('genera el perfil de producción ("otro", cinco tipos propios con caracteres raros) sin fallar', async () => {
    const { service, upsert } = crearServicio();

    await service.generate('user-1', dtoCincoPropios);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          tipoUso: 'otro',
          tiposEvento: dtoCincoPropios.tiposEvento,
          descripcion: expect.stringContaining('Taller grupal de iluminación para principiantes y curiosos (120 min)'),
        }),
      }),
    );
  });

  it('funciona sin OPENROUTER_API_KEY ni red: cero llamadas externas en todo el alta', async () => {
    // No hay ConfigService ni OpenRouterClient inyectados: no hay forma de
    // que generate() intente una llamada de red, simulada o real.
    const { service, upsert } = crearServicio();

    await expect(service.generate('user-1', dto)).resolves.toBeDefined();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('propaga un error de persistencia sin devolver éxito falso', async () => {
    const { service, upsert } = crearServicio();
    upsert.mockRejectedValueOnce(new Error('la base está caída'));

    await expect(service.generate('user-1', dto)).rejects.toThrow('la base está caída');
  });

  it('repetir el alta para el mismo userId actualiza el mismo row (upsert), no duplica', async () => {
    const { service, upsert } = crearServicio();

    await service.generate('user-1', dto);
    await service.generate('user-1', { ...dto, nombreBot: 'Otro nombre' });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0]).toMatchObject({ where: { userId: 'user-1' } });
    expect(upsert.mock.calls[1][0]).toMatchObject({ where: { userId: 'user-1' } });
  });

  it('rechaza una franja horaria invertida sin tocar Prisma', async () => {
    const { service, upsert } = crearServicio();

    await expect(
      service.generate('user-1', { ...dto, horaDesde: '18:00', horaHasta: '09:00' }),
    ).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('persiste los campos del wizard y una descripción derivada de ellos', async () => {
    const { service, upsert } = crearServicio();

    await service.generate('user-1', dto);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          tipoTitular: 'negocio',
          nombreTitular: 'Tienda Centro',
          nombreBot: 'Tati',
          horaDesde: '09:00',
          horaHasta: '18:00',
          tiposEvento: dto.tiposEvento,
        }),
      }),
    );
  });

  it('allowedActions son exactamente las 5 del catálogo', async () => {
    const { service, upsert } = crearServicio();

    await service.generate('user-1', dto);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ allowedActions: ACCIONES_IDS }) }),
    );
  });

  it('un agente ya existente generado por IA (model no nulo, templateVersion nulo) se puede leer sin romper', async () => {
    const { service, findUnique } = crearServicio();
    findUnique.mockResolvedValue({
      id: 'agent-viejo',
      userId: 'user-1',
      model: 'openai/gpt-4o-mini',
      templateVersion: null,
      systemPrompt: 'generado por IA hace tiempo',
      allowedActions: ['crear_turno'],
    });

    const agente = await service.findByUserId('user-1');

    expect(agente).toMatchObject({ model: 'openai/gpt-4o-mini', templateVersion: null });
  });
});

const agenteGuardado = {
  id: 'agent-1',
  userId: 'user-1',
  tipoUso: 'consultorio',
  tipoTitular: 'persona',
  nombreTitular: 'Dra. Pérez',
  nombreBot: 'Nina',
  horaDesde: '10:00',
  horaHasta: '17:00',
  tiposEvento: [{ nombre: 'Consulta', duracionMin: 30 }],
  allowedActions: ['crear_turno'],
  model: 'openai/gpt-4o-mini',
  templateVersion: null,
  systemPrompt: 'viejo',
};

describe('AgentsService.generate con turnos grupales', () => {
  it('valida la parte grupal antes de guardar', async () => {
    const { service, findUnique, upsert } = crearServicio();
    findUnique.mockResolvedValue(null);

    await expect(
      service.generate('user-1', {
        ...dto,
        tiposEvento: [{ nombre: 'Yoga', duracionMin: 60, horarios: [{ dia: 'lun', hora: '18:00' }] }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('AgentsService.actualizarTiposEvento', () => {
  it('reemplaza los tipos y regenera el prompt con duración y precio nuevos, sin tocar el resto', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue(agenteGuardado);
    const tipos = [{ nombre: ' Consulta ', duracionMin: 45, precio: 15000 }];

    await service.actualizarTiposEvento('user-1', tipos);

    const [{ where, data }] = update.mock.calls[0] as [{ where: unknown; data: Record<string, unknown> }];
    expect(where).toEqual({ userId: 'user-1' });
    expect(data.tiposEvento).toEqual([{ nombre: 'Consulta', duracionMin: 45, precio: 15000 }]);
    expect(data.systemPrompt).toContain('"Consulta" (45 min, $ 15.000)');
    expect(data.systemPrompt).toContain('de 10:00 a 17:00');
    expect(data.systemPrompt).toContain('Dra. Pérez');
    expect(data).toMatchObject({ model: null, templateVersion: PLANTILLA_VERSION });
    expect(data).not.toHaveProperty('allowedActions');
    expect(data).not.toHaveProperty('horaDesde');
  });

  it('guarda un turno grupal con su capacidad y horarios ordenados, y lo cuenta en el prompt', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue(agenteGuardado);
    const tipos = [
      {
        nombre: 'Yoga',
        duracionMin: 60,
        capacidad: 10,
        horarios: [
          { dia: 'mie' as const, hora: '18:00' },
          { dia: 'lun' as const, hora: '18:00' },
          { dia: 'lun' as const, hora: '18:00' },
        ],
      },
    ];

    await service.actualizarTiposEvento('user-1', tipos);

    const [{ data }] = update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(data.tiposEvento).toEqual([
      {
        nombre: 'Yoga',
        duracionMin: 60,
        capacidad: 10,
        horarios: [
          { dia: 'lun', hora: '18:00' },
          { dia: 'mie', hora: '18:00' },
        ],
      },
    ]);
    expect(data.systemPrompt).toContain('"Yoga" (60 min, grupal de hasta 10 personas: lunes 18:00; miércoles 18:00)');
    expect(data.descripcion).toContain('Yoga (60 min, grupal de hasta 10 personas');
  });

  it('da 400 con un turno grupal sin horarios o con horarios que se pisan', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue(agenteGuardado);

    await expect(
      service.actualizarTiposEvento('user-1', [{ nombre: 'Yoga', duracionMin: 60, capacidad: 10, horarios: [] }]),
    ).rejects.toMatchObject({ status: 400, message: 'Poné al menos un horario para "Yoga".' });
    await expect(
      service.actualizarTiposEvento('user-1', [
        {
          nombre: 'Yoga',
          duracionMin: 60,
          capacidad: 10,
          horarios: [
            { dia: 'lun', hora: '18:00' },
            { dia: 'lun', hora: '18:30' },
          ],
        },
      ]),
    ).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it('da 404 si todavía no hay agente', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue(null);

    await expect(
      service.actualizarTiposEvento('user-1', [{ nombre: 'Consulta', duracionMin: 30 }]),
    ).rejects.toMatchObject({ status: 404 });
    expect(update).not.toHaveBeenCalled();
  });

  it('da 400 con nombres repetidos, sin importar mayúsculas ni espacios', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue(agenteGuardado);

    await expect(
      service.actualizarTiposEvento('user-1', [
        { nombre: 'Consulta', duracionMin: 30 },
        { nombre: ' consulta ', duracionMin: 45 },
      ]),
    ).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('AgentsService.generarVentas', () => {
  it('persiste un asistente de ventas con su plantilla y el catálogo de ventas entero', async () => {
    const { service, findUnique, upsert } = crearServicio();
    findUnique.mockResolvedValue(null);

    await service.generarVentas('user-1', { nombreTitular: ' Mates "El Gaucho" ', nombreBot: 'Nina' });

    const [{ where, create }] = upsert.mock.calls[0] as [{ where: unknown; create: Record<string, unknown> }];
    expect(where).toEqual({ userId: 'user-1' });
    expect(create).toMatchObject({
      userId: 'user-1',
      tipoAsistente: 'ventas',
      tipoUso: 'comercio',
      tipoTitular: 'negocio',
      nombreTitular: 'Mates "El Gaucho"',
      nombreBot: 'Nina',
      tiposEvento: [],
      allowedActions: ACCIONES_VENTAS_IDS,
      model: null,
      templateVersion: PLANTILLA_VENTAS_VERSION,
    });
    // Sin el paso opcional de datos no se escribe nada: quedan los defaults (sólo pide el nombre).
    expect(create).not.toHaveProperty('haceEnvios');
    expect(create).not.toHaveProperty('datosCliente');
    // Los textos libres van escapados como dato, no como instrucción.
    expect(create.systemPrompt).toContain('"Mates \\"El Gaucho\\""');
    expect(create.systemPrompt).toContain('"Nina"');
    expect(create.systemPrompt).not.toContain('lunes a viernes');
  });

  it('guarda los datos que pide al cliente, normalizados', async () => {
    const { service, findUnique, upsert } = crearServicio();
    findUnique.mockResolvedValue(null);

    await service.generarVentas('user-1', {
      nombreTitular: 'Tienda',
      nombreBot: 'Tati',
      haceEnvios: true,
      datosCliente: [
        { tipo: 'codigoPostal', obligatorio: true },
        { tipo: 'codigoPostal', obligatorio: false },
        { tipo: 'personalizado', etiqueta: ' Entre calles ', obligatorio: false },
      ],
    });

    const [{ create }] = upsert.mock.calls[0] as [{ create: Record<string, unknown> }];
    expect(create).toMatchObject({
      haceEnvios: true,
      datosCliente: [
        { tipo: 'codigoPostal', obligatorio: true },
        { tipo: 'personalizado', etiqueta: 'Entre calles', obligatorio: false },
      ],
    });
  });

  it('se puede regenerar si ya era de ventas', async () => {
    const { service, findUnique, upsert } = crearServicio();
    findUnique.mockResolvedValue({ tipoAsistente: 'ventas' });

    await service.generarVentas('user-1', { nombreTitular: 'Tienda', nombreBot: 'Tati' });
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('no deja pasar una cuenta de agenda a ventas ni al revés (409)', async () => {
    const { service, findUnique, upsert } = crearServicio();

    findUnique.mockResolvedValue({ tipoAsistente: 'agenda' });
    await expect(service.generarVentas('user-1', { nombreTitular: 'Tienda', nombreBot: 'Tati' })).rejects.toMatchObject({
      status: 409,
    });

    findUnique.mockResolvedValue({ tipoAsistente: 'ventas' });
    await expect(service.generate('user-1', dto)).rejects.toMatchObject({ status: 409 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('un asistente de ventas no tiene reuniones para editar (409)', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue({ ...agenteGuardado, tipoAsistente: 'ventas' });

    await expect(
      service.actualizarTiposEvento('user-1', [{ nombre: 'Consulta', duracionMin: 30 }]),
    ).rejects.toMatchObject({ status: 409 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('modalidad de venta (LAU-21)', () => {
  const QUE_HACE = 'Hacemos muebles de madera a medida: mesas, bibliotecas y racks.';

  it('generarVentas guarda la modalidad y "qué hacés" normalizado', async () => {
    const { service, findUnique, upsert } = crearServicio();
    findUnique.mockResolvedValue(null);

    await service.generarVentas('user-1', {
      nombreTitular: 'Casa Ombú',
      nombreBot: 'Lu',
      modalidadVenta: 'pedido',
      queHace: `  ${QUE_HACE}\n`,
    });

    const [{ create }] = upsert.mock.calls[0] as [{ create: Record<string, unknown> }];
    expect(create).toMatchObject({ modalidadVenta: 'pedido', queHace: QUE_HACE });
  });

  it('sin el paso no pisa lo guardado', async () => {
    const { service, findUnique, upsert } = crearServicio();
    findUnique.mockResolvedValue(null);

    await service.generarVentas('user-1', { nombreTitular: 'Tienda', nombreBot: 'Tati' });

    const [{ create }] = upsert.mock.calls[0] as [{ create: Record<string, unknown> }];
    expect(create).not.toHaveProperty('modalidadVenta');
    expect(create).not.toHaveProperty('queHace');
  });

  it('a pedido sin "qué hacés" es un 400, antes de tocar la base', async () => {
    const { service, findUnique, upsert } = crearServicio();
    await expect(
      service.generarVentas('user-1', { nombreTitular: 'Tienda', nombreBot: 'Tati', modalidadVenta: 'pedido' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.generarVentas('user-1', {
        nombreTitular: 'Tienda',
        nombreBot: 'Tati',
        modalidadVenta: 'pedido',
        queHace: 'Mesas',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(findUnique).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('actualizarModalidad usa el "qué hacés" guardado si no viene uno', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue({ tipoAsistente: 'ventas', queHace: QUE_HACE, modalidadVenta: 'pedido' });

    await service.actualizarModalidad('user-1', { modalidadVenta: 'pedido' });

    expect(update).toHaveBeenCalledWith({ where: { userId: 'user-1' }, data: { modalidadVenta: 'pedido' } });
  });

  it('actualizarModalidad edita "qué hacés" normalizado, con la misma modalidad', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue({ tipoAsistente: 'ventas', queHace: null, modalidadVenta: 'pedido' });

    await service.actualizarModalidad('user-1', { modalidadVenta: 'pedido', queHace: ` ${QUE_HACE} ` });
    expect(update).toHaveBeenLastCalledWith({
      where: { userId: 'user-1' },
      data: { modalidadVenta: 'pedido', queHace: QUE_HACE },
    });
  });

  it('la modalidad no se cambia: ni desde /cuenta ni volviendo a pasar por el registro (409)', async () => {
    const { service, findUnique, update, upsert } = crearServicio();
    findUnique.mockResolvedValue({ tipoAsistente: 'ventas', queHace: QUE_HACE, modalidadVenta: 'pedido' });
    await expect(service.actualizarModalidad('user-1', { modalidadVenta: 'stock' })).rejects.toMatchObject({
      status: 409,
    });
    findUnique.mockResolvedValue({ tipoAsistente: 'ventas', queHace: null, modalidadVenta: 'stock' });
    await expect(
      service.generarVentas('user-1', { nombreTitular: 'Tienda', nombreBot: 'Tati', modalidadVenta: 'pedido', queHace: QUE_HACE }),
    ).rejects.toMatchObject({ status: 409 });
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();

    // Regenerar con la misma modalidad (o sin mandarla) sigue andando.
    await service.generarVentas('user-1', { nombreTitular: 'Tienda', nombreBot: 'Tati', modalidadVenta: 'stock' });
    await service.generarVentas('user-1', { nombreTitular: 'Tienda', nombreBot: 'Tati' });
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('actualizarModalidad: 400 a pedido sin texto, 404 sin asistente y 409 si es de agenda', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue({ tipoAsistente: 'ventas', queHace: null, modalidadVenta: 'pedido' });
    await expect(service.actualizarModalidad('user-1', { modalidadVenta: 'pedido' })).rejects.toMatchObject({
      status: 400,
    });
    findUnique.mockResolvedValue(null);
    await expect(service.actualizarModalidad('user-1', { modalidadVenta: 'stock' })).rejects.toMatchObject({
      status: 404,
    });
    findUnique.mockResolvedValue({ tipoAsistente: 'agenda', queHace: null });
    await expect(service.actualizarModalidad('user-1', { modalidadVenta: 'stock' })).rejects.toMatchObject({
      status: 409,
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('construirDescripcion', () => {
  it('incluye titular, tipos de evento con su duración y la franja horaria', () => {
    const descripcion = construirDescripcion(dto);

    expect(descripcion).toContain('Tienda Centro');
    expect(descripcion).toContain('Probador (20 min)');
    expect(descripcion).toContain('Presupuesto (30 min)');
    expect(descripcion).toContain('de 09:00 a 18:00');
  });
});

describe('AgentsService.actualizarDatosCliente', () => {
  const datos = { haceEnvios: false, datosCliente: [{ tipo: 'email' as const, obligatorio: true }] };

  it('sólo cambia las dos columnas de datos, sin tocar el prompt', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue({ tipoAsistente: 'ventas' });

    await service.actualizarDatosCliente('user-1', datos);

    expect(update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { haceEnvios: false, datosCliente: [{ tipo: 'email', obligatorio: true }] },
    });
  });

  it('404 sin asistente y 409 si es de agenda', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue(null);
    await expect(service.actualizarDatosCliente('user-1', datos)).rejects.toMatchObject({ status: 404 });
    findUnique.mockResolvedValue({ tipoAsistente: 'agenda' });
    await expect(service.actualizarDatosCliente('user-1', datos)).rejects.toMatchObject({ status: 409 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('AgentsService.actualizarMensajes', () => {
  const ventas = { ...agenteGuardado, tipoAsistente: 'ventas', mensajes: { saludo: { modo: 'propio', texto: 'Hola' } } };

  it('guarda los que vienen y conserva los demás, sin tocar el prompt', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue(ventas);

    await service.actualizarMensajes('user-1', {
      linkPago: { modo: 'propio', texto: 'Pagá acá: {link}' },
    });

    const [{ data }] = update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(data).toEqual({
      mensajes: {
        saludo: { modo: 'propio', texto: 'Hola' },
        linkPago: { modo: 'propio', texto: 'Pagá acá: {link}' },
      },
    });
  });

  it('da 400 si al link de pago le falta {link}', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue(ventas);

    await expect(
      service.actualizarMensajes('user-1', { linkPago: { modo: 'propio', texto: 'Te paso el link' } }),
    ).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it('da 400 con un mensaje que no es de su tipo de asistente', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue(agenteGuardado);

    await expect(
      service.actualizarMensajes('user-1', { pagoAprobado: { modo: 'auto', texto: '' } }),
    ).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it('da 404 si todavía no hay agente', async () => {
    const { service, findUnique } = crearServicio();
    findUnique.mockResolvedValue(null);

    await expect(service.actualizarMensajes('user-1', {})).rejects.toMatchObject({ status: 404 });
  });
});

describe('local del asistente de ventas', () => {
  const local = {
    tieneLocal: true,
    direccion: '  Av. Corrientes 1234 ',
    horarios: [{ dia: 'lun' as const, desde: '09:00', hasta: '18:00' }],
    retiroEnLocal: true,
  };

  it('el alta de ventas guarda el local normalizado', async () => {
    const { service, findUnique, upsert } = crearServicio();
    findUnique.mockResolvedValue(null);

    await service.generarVentas('user-1', { nombreTitular: 'Tienda', nombreBot: 'Tati', local });

    const [{ create }] = upsert.mock.calls[0] as [{ create: Record<string, unknown> }];
    expect(create.local).toEqual({ ...local, direccion: 'Av. Corrientes 1234' });
  });

  it('el alta sin el paso del local no pisa el que ya estaba', async () => {
    const { service, findUnique, upsert } = crearServicio();
    findUnique.mockResolvedValue({ tipoAsistente: 'ventas' });

    await service.generarVentas('user-1', { nombreTitular: 'Tienda', nombreBot: 'Tati' });

    const [{ update }] = upsert.mock.calls[0] as [{ update: Record<string, unknown> }];
    expect(update).not.toHaveProperty('local');
  });

  it('actualizarLocal reemplaza el local sin tocar el prompt', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue({ tipoAsistente: 'ventas' });

    await service.actualizarLocal('user-1', { tieneLocal: false, direccion: 'Calle 1', retiroEnLocal: true });

    expect(update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { local: { tieneLocal: false, horarios: [], retiroEnLocal: false } },
    });
  });

  it('da 400 con horarios que se pisan, sin escribir', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue({ tipoAsistente: 'ventas' });

    await expect(
      service.actualizarLocal('user-1', {
        tieneLocal: true,
        horarios: [
          { dia: 'lun', desde: '09:00', hasta: '14:00' },
          { dia: 'lun', desde: '13:00', hasta: '18:00' },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it('da 404 sin agente', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue(null);

    await expect(service.actualizarLocal('user-1', { tieneLocal: false })).rejects.toMatchObject({ status: 404 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('lugar de atención del asistente de turnos (LAU-17)', () => {
  const casa = {
    tieneLocal: true,
    lugar: 'casa' as const,
    direccion: ' Güemes 4321, Palermo ',
    // Lo que es sólo de ventas no se guarda en una agenda.
    horarios: [{ dia: 'lun' as const, desde: '09:00', hasta: '18:00' }],
    retiroEnLocal: true,
  };
  const guardado = { tieneLocal: true, lugar: 'casa', direccion: 'Güemes 4321, Palermo', horarios: [], retiroEnLocal: false };

  it('el alta de turnos guarda el lugar normalizado', async () => {
    const { service, findUnique, upsert } = crearServicio();
    findUnique.mockResolvedValue(null);

    await service.generate('user-1', { ...dto, local: casa });

    const [{ create }] = upsert.mock.calls[0] as [{ create: Record<string, unknown> }];
    expect(create.local).toEqual(guardado);
  });

  it('el alta sin el paso del lugar no pisa el que ya estaba', async () => {
    const { service, findUnique, upsert } = crearServicio();
    findUnique.mockResolvedValue({ tipoAsistente: 'agenda' });

    await service.generate('user-1', dto);

    const [{ update }] = upsert.mock.calls[0] as [{ update: Record<string, unknown> }];
    expect(update).not.toHaveProperty('local');
  });

  it('un lugar sin dirección es un 400 y no escribe nada', async () => {
    const { service, findUnique, upsert } = crearServicio();
    findUnique.mockResolvedValue(null);

    await expect(service.generate('user-1', { ...dto, local: { tieneLocal: true, lugar: 'local' } })).rejects.toMatchObject({
      status: 400,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('actualizarLocal edita el lugar de una cuenta de turnos', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue({ tipoAsistente: 'agenda' });

    await service.actualizarLocal('user-1', casa);

    expect(update).toHaveBeenCalledWith({ where: { userId: 'user-1' }, data: { local: guardado } });
  });

  it('en ventas el tipo de lugar se descarta', async () => {
    const { service, findUnique, update } = crearServicio();
    findUnique.mockResolvedValue({ tipoAsistente: 'ventas' });

    await service.actualizarLocal('user-1', casa);

    const [{ data }] = update.mock.calls[0] as [{ data: { local: Record<string, unknown> } }];
    expect(data.local).not.toHaveProperty('lugar');
    expect(data.local.retiroEnLocal).toBe(true);
  });
});
