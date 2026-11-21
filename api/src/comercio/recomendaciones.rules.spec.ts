import { describe, expect, it } from 'vitest';
import { leerPreguntas, type PreguntaPedido } from './preguntas-pedido.rules.js';
import {
  bloqueRecomendaciones,
  leerConfiguracion,
  normalizarConfiguracion,
  productosUsados,
  resolverRecomendacion,
  textoParaElModelo,
  type ConfiguracionRecomendaciones,
  type ProductoParaRecomendar,
} from './recomendaciones.rules.js';

const preguntas: PreguntaPedido[] = leerPreguntas([
  {
    id: 'tela',
    texto: '¿Qué tela preferís?',
    tipo: 'opciones',
    obligatoria: true,
    alcance: 'producto',
    productos: ['bruno', 'nordico'],
    opciones: [
      { id: 'pana', texto: 'Pana antimanchas' },
      { id: 'lino', texto: 'Lino natural' },
      { id: 'micro', texto: 'Microfibra repelente' },
    ],
  },
]);

/** Lo que manda la web: los dos ejemplos del issue (filamentos y sillones). */
function formulario(): Record<string, unknown> {
  return {
    sinCoincidencia: 'catalogo',
    recomendaciones: [
      {
        id: 'soportes',
        nombre: 'Soportes solubles',
        activa: true,
        disparador: {
          tipo: 'consulta',
          necesidad: ' Quiere retirar   soportes difíciles de despegar ',
          ejemplos: ['no puedo despegar los soportes', 'No puedo despegar los soportes', ''],
        },
        alcance: 'global',
        accion: { tipo: 'recomendar', productos: ['pva', 'bvoh'], opciones: null, criterio: null },
        requisito: { dato: 'La impresora imprime con dos materiales', pregunta: '¿Tu impresora tiene doble extrusor o AMS?' },
        excepciones: [],
      },
      {
        id: 'mascotas',
        nombre: 'Telas para mascotas',
        activa: true,
        disparador: { tipo: 'consulta', necesidad: 'tiene mascotas y quiere una tela resistente', ejemplos: [] },
        alcance: 'producto',
        productos: ['bruno', 'nordico'],
        accion: { tipo: 'recomendar', productos: [], opciones: { preguntaId: 'tela', opcionIds: ['pana', 'micro'] }, criterio: null },
        excepciones: [{ productoId: 'nordico', excluirOpciones: ['pana'], nota: 'Este modelo no se hace en Pana.' }],
      },
      {
        id: 'colores-pana',
        nombre: 'Colores para Pana',
        activa: true,
        disparador: { tipo: 'paso', preguntaId: 'tela', opciones: ['pana'] },
        alcance: 'producto',
        productos: ['bruno'],
        accion: { tipo: 'responder', texto: 'En Pana tenemos Gris topo, Verde oliva y Arena.' },
        retomarPedido: true,
      },
      {
        id: 'mascotas-general',
        nombre: 'Mascotas en general',
        activa: true,
        disparador: { tipo: 'consulta', necesidad: 'tiene mascotas', ejemplos: [] },
        alcance: 'global',
        accion: { tipo: 'preguntar', pregunta: '¿Qué mascotas tenés?' },
      },
    ],
    propiedades: [
      { elemento: { tipo: 'producto', productoId: 'pva' }, propiedades: [{ nombre: 'Solubilidad', valor: 'En agua tibia' }] },
      { elemento: { tipo: 'opcion', preguntaId: 'tela', opcionId: 'pana' }, propiedades: [{ nombre: 'Limpieza', valor: 'Con paño húmedo' }] },
      { elemento: { tipo: 'opcion', preguntaId: 'tela', opcionId: 'micro' }, propiedades: [{ nombre: '', valor: '' }] },
    ],
  };
}

function configuracion(): ConfiguracionRecomendaciones {
  const resultado = normalizarConfiguracion(formulario(), preguntas);
  if ('error' in resultado) throw new Error(resultado.error);
  return resultado.configuracion;
}

const catalogo = new Map<string, ProductoParaRecomendar>([
  ['pva', { id: 'pva', nombre: 'Filamento PVA', disponible: true }],
  ['bvoh', { id: 'bvoh', nombre: 'Filamento BVOH', disponible: false }],
]);

describe('normalizarConfiguracion', () => {
  it('limpia textos, saca ejemplos repetidos y propiedades vacías', () => {
    const config = configuracion();
    const soportes = config.recomendaciones[0];
    expect(soportes.disparador).toEqual({
      tipo: 'consulta',
      necesidad: 'Quiere retirar soportes difíciles de despegar',
      ejemplos: ['no puedo despegar los soportes'],
    });
    expect(soportes.requisito?.siNoCumple).toBe('explicar');
    expect(soportes.retomarPedido).toBe(true);
    expect(config.propiedades).toHaveLength(2);
  });

  it('rechaza un paso de una pregunta que no existe y una opción de otra pregunta', () => {
    const entrada = formulario();
    (entrada.recomendaciones as Array<Record<string, unknown>>)[2].disparador = { tipo: 'paso', preguntaId: 'color', opciones: [] };
    expect(normalizarConfiguracion(entrada, preguntas)).toEqual({ error: expect.stringContaining('pregunta que ya no existe') });

    const otra = formulario();
    (otra.recomendaciones as Array<Record<string, unknown>>)[2].disparador = { tipo: 'paso', preguntaId: 'tela', opciones: ['rojo'] };
    expect(normalizarConfiguracion(otra, preguntas)).toEqual({ error: expect.stringContaining('opción que ya no existe') });
  });

  it('rechaza nombres repetidos y una regla por producto sin productos', () => {
    const repetida = formulario();
    (repetida.recomendaciones as Array<Record<string, unknown>>)[1].nombre = 'soportes SOLUBLES';
    expect(normalizarConfiguracion(repetida, preguntas)).toEqual({ error: expect.stringContaining('Ya hay una recomendación') });

    const sinProductos = formulario();
    (sinProductos.recomendaciones as Array<Record<string, unknown>>)[1].productos = [];
    expect(normalizarConfiguracion(sinProductos, preguntas)).toEqual({ error: expect.stringContaining('algún producto') });
  });

  it('al leer de la base, pausa la regla cuya pregunta se borró en vez de perderla', () => {
    const guardada = configuracion();
    const sinTela = leerConfiguracion(guardada as unknown as Parameters<typeof leerConfiguracion>[0], []);
    const colores = sinTela.recomendaciones.find((regla) => regla.id === 'colores-pana');
    expect(colores).toMatchObject({ activa: false, disparador: { tipo: 'paso', preguntaId: 'tela' } });
    // La de mascotas pierde sus opciones (no hay pregunta) y queda pausada; la de soportes sigue igual.
    expect(sinTela.recomendaciones.find((regla) => regla.id === 'mascotas')?.activa).toBe(false);
    expect(sinTela.recomendaciones.find((regla) => regla.id === 'soportes')?.activa).toBe(true);
    // Las propiedades de opciones borradas se van.
    expect(sinTela.propiedades.map((p) => p.elemento.tipo)).toEqual(['producto']);
  });

  it('junta todos los productos que nombra para verificarlos', () => {
    expect(productosUsados(configuracion()).sort()).toEqual(['bruno', 'bvoh', 'nordico', 'pva']);
  });
});

describe('resolverRecomendacion', () => {
  it('«Necesito soportes que se disuelvan…» recomienda el disponible con su propiedad', () => {
    const config = configuracion();
    const resultado = resolverRecomendacion(config, { reglaIds: ['soportes'], requisito: 'cumple' }, preguntas, catalogo);
    expect(resultado.estado).toBe('aplicada');
    expect(resultado.candidatos).toEqual([
      expect.objectContaining({ id: 'pva', disponible: true, propiedades: [{ nombre: 'Solubilidad', valor: 'En agua tibia' }] }),
      expect.objectContaining({ id: 'bvoh', disponible: false }),
    ]);
    const texto = textoParaElModelo(resultado, config, preguntas);
    expect(texto).toContain('[producto pva] "Filamento PVA"');
    expect(texto).toContain('"Solubilidad": "En agua tibia"');
    expect(texto).toContain('No recomiendes "Filamento BVOH": no hay stock.');
  });

  it('si falta el dato de compatibilidad, pide la pregunta configurada y no recomienda', () => {
    const config = configuracion();
    const resultado = resolverRecomendacion(config, { reglaIds: ['soportes'] }, preguntas, catalogo);
    expect(resultado).toMatchObject({ estado: 'falta_dato', candidatos: [], requisito: { estado: 'no_se' } });
    expect(textoParaElModelo(resultado, config, preguntas)).toContain('¿Tu impresora tiene doble extrusor o AMS?');
  });

  it('si no cumple el requisito, no recomienda', () => {
    const config = configuracion();
    const resultado = resolverRecomendacion(config, { reglaIds: ['soportes'], requisito: 'no_cumple' }, preguntas, catalogo);
    expect(resultado.estado).toBe('no_cumple');
    expect(textoParaElModelo(resultado, config, preguntas)).toContain('no se lo recomiendes');
  });

  it('la regla vinculada al producto gana sobre la global, sin importar el orden', () => {
    const resultado = resolverRecomendacion(
      configuracion(),
      { reglaIds: ['mascotas-general', 'mascotas'], productoId: 'bruno' },
      preguntas,
      catalogo,
    );
    expect(resultado.regla?.id).toBe('mascotas');
    expect(resultado.evaluadas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mascotas', aplica: true }),
        expect.objectContaining({ id: 'mascotas-general', aplica: false, motivo: 'otra regla tiene prioridad' }),
      ]),
    );
  });

  it('comparte la regla de mascotas entre sillones y aplica la excepción del Nórdico', () => {
    const config = configuracion();
    const bruno = resolverRecomendacion(config, { reglaIds: ['mascotas'], productoId: 'bruno' }, preguntas, catalogo);
    expect(bruno.candidatos.map((c) => c.nombre)).toEqual(['Pana antimanchas', 'Microfibra repelente']);
    // La propiedad es de la opción, no del sillón.
    expect(bruno.candidatos[0]).toMatchObject({ tipo: 'opcion', pregunta: '¿Qué tela preferís?', propiedades: [{ nombre: 'Limpieza' }] });
    expect(bruno.propiedadesDelProducto).toEqual([]);

    const nordico = resolverRecomendacion(config, { reglaIds: ['mascotas'], productoId: 'nordico' }, preguntas, catalogo);
    expect(nordico.candidatos.map((c) => c.nombre)).toEqual(['Microfibra repelente']);
    expect(nordico.nota).toBe('Este modelo no se hace en Pana.');
  });

  it('un paso se activa sólo con su respuesta y se reevalúa si cambia', () => {
    const config = configuracion();
    const conPana = resolverRecomendacion(config, { reglaIds: ['colores-pana'], productoId: 'bruno', respuesta: 'pana antimanchas' }, preguntas, catalogo);
    expect(conPana.estado).toBe('aplicada');
    const texto = textoParaElModelo(conPana, config, preguntas);
    expect(texto).toContain('Gris topo');
    expect(texto).toContain('retomá el paso pendiente');

    const conLino = resolverRecomendacion(config, { reglaIds: ['colores-pana'], productoId: 'bruno', respuesta: 'Lino natural' }, preguntas, catalogo);
    expect(conLino.estado).toBe('ninguna');
    expect(conLino.evaluadas[0].motivo).toContain('no se activa con');
  });

  it('una regla de otro producto o pausada no aplica, salvo las pausadas en el probador', () => {
    const config = configuracion();
    expect(resolverRecomendacion(config, { reglaIds: ['mascotas'], productoId: 'otro' }, preguntas, catalogo).estado).toBe('ninguna');
    const pausada = { ...config, recomendaciones: config.recomendaciones.map((r) => ({ ...r, activa: false })) };
    expect(resolverRecomendacion(pausada, { reglaIds: ['soportes'], requisito: 'cumple' }, preguntas, catalogo).estado).toBe('ninguna');
    const probador = resolverRecomendacion(pausada, { reglaIds: ['soportes'], requisito: 'cumple', incluirPausadas: true }, preguntas, catalogo);
    expect(probador.regla).toMatchObject({ id: 'soportes', activa: false });
  });

  it('sin regla que aplique, sigue según la salida configurada', () => {
    const config = { ...configuracion(), sinCoincidencia: 'derivar' as const };
    const resultado = resolverRecomendacion(config, { reglaIds: ['no-existe'] }, preguntas, catalogo);
    expect(textoParaElModelo(resultado, config, preguntas)).toContain('derivar_consulta');
  });
});

describe('bloqueRecomendaciones', () => {
  it('lista sólo las activas, con los textos del dueño como datos', () => {
    const config = configuracion();
    config.recomendaciones[3].activa = false;
    const bloque = bloqueRecomendaciones(config, preguntas, new Map([['bruno', 'Sillón Bruno']]));
    expect(bloque).toContain('[recomendacion soportes] cuando el cliente cuenta que "Quiere retirar soportes difíciles de despegar"');
    expect(bloque).toContain('[producto bruno] "Sillón Bruno"');
    expect(bloque).toContain('[pregunta tela] "¿Qué tela preferís?" con "Pana antimanchas"');
    expect(bloque).not.toContain('mascotas-general');
  });

  it('sin reglas activas no agrega nada', () => {
    expect(bloqueRecomendaciones({ recomendaciones: [], propiedades: [], sinCoincidencia: 'catalogo' }, preguntas, new Map())).toBe('');
  });
});

describe('duda mientras responde una pregunta del pedido', () => {
  function conDuda(): ConfiguracionRecomendaciones {
    const entrada = formulario();
    (entrada.recomendaciones as Array<Record<string, unknown>>).push({
      id: 'tela-mascotas',
      nombre: 'Tela si tiene mascotas',
      activa: true,
      disparador: { tipo: 'pregunta', preguntaId: 'tela', necesidad: 'tiene mascotas', ejemplos: ['tengo gatos', ''] },
      alcance: 'producto',
      productos: ['bruno', 'nordico'],
      accion: { tipo: 'recomendar', productos: [], opciones: { preguntaId: 'tela', opcionIds: ['pana', 'micro'] }, criterio: null },
      excepciones: [{ productoId: 'nordico', excluirOpciones: ['pana'] }],
    });
    const resultado = normalizarConfiguracion(entrada, preguntas);
    if ('error' in resultado) throw new Error(resultado.error);
    return resultado.configuracion;
  }

  it('«¿Qué tela?» → «tengo gatos» recomienda opciones de esa pregunta y la deja pendiente', () => {
    const config = conDuda();
    expect(config.recomendaciones[4].disparador).toEqual({
      tipo: 'pregunta',
      preguntaId: 'tela',
      necesidad: 'tiene mascotas',
      ejemplos: ['tengo gatos'],
    });
    const bloque = bloqueRecomendaciones(config, preguntas, new Map());
    expect(bloque).toContain('[recomendacion tela-mascotas] cuando le hacés [pregunta tela] "¿Qué tela preferís?"');
    expect(bloque).toContain('"tiene mascotas" (por ejemplo: "tengo gatos")');

    const resultado = resolverRecomendacion(config, { reglaIds: ['tela-mascotas'], productoId: 'nordico' }, preguntas, catalogo);
    expect(resultado.estado).toBe('aplicada');
    expect(resultado.candidatos.map((c) => c.nombre)).toEqual(['Microfibra repelente']);
    const texto = textoParaElModelo(resultado, config, preguntas);
    expect(texto).toContain('la opción "Microfibra repelente" de "¿Qué tela preferís?"');
    expect(texto).toContain('esa pregunta sigue pendiente');
  });

  it('no necesita respuesta, pero sí saber el producto si la regla es por producto', () => {
    const config = conDuda();
    const sinProducto = resolverRecomendacion(config, { reglaIds: ['tela-mascotas'] }, preguntas, catalogo);
    expect(sinProducto.estado).toBe('ninguna');
    expect(sinProducto.evaluadas[0].motivo).toBe('falta saber de qué producto es el paso');
  });

  it('rechaza una pregunta que no existe o sin necesidad, y al leer la pausa si se borró la pregunta', () => {
    const entrada = formulario();
    const reglas = entrada.recomendaciones as Array<Record<string, unknown>>;
    reglas[1].disparador = { tipo: 'pregunta', preguntaId: 'color', necesidad: 'tiene mascotas' };
    expect(normalizarConfiguracion(entrada, preguntas)).toMatchObject({ error: expect.stringContaining('pregunta que ya no existe') });
    reglas[1].disparador = { tipo: 'pregunta', preguntaId: 'tela', necesidad: '  ' };
    expect(normalizarConfiguracion(entrada, preguntas)).toMatchObject({ error: expect.stringContaining('está vacío') });

    const guardada = formulario();
    (guardada.recomendaciones as Array<Record<string, unknown>>)[1].disparador = { tipo: 'pregunta', preguntaId: 'tela', necesidad: 'tiene mascotas' };
    const leida = leerConfiguracion(guardada as never, []);
    expect(leida.recomendaciones.find((r) => r.id === 'mascotas')).toMatchObject({
      activa: false,
      disparador: { tipo: 'pregunta', preguntaId: 'tela', necesidad: 'tiene mascotas' },
    });
  });
});
