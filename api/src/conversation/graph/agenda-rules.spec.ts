import { describe, expect, it } from 'vitest';
import type { Agent } from '../../generated/prisma/client.js';
import {
  MARGEN_MINIMO_MIN,
  MAX_OPCIONES_DIA,
  conMargen,
  conflictos,
  dentroDeFranja,
  detalleSugerencias,
  esDiaHabil,
  horariosCercanos,
  huecosDelDia,
  ocupadosEnRango,
  opcionesDelDia,
  parsearFecha,
  resumenDelDia,
  resumirDisponibilidad,
  horaLocal,
} from './agenda-rules.js';

const AGENT = { horaDesde: '09:00', horaHasta: '18:00' } as unknown as Agent;

/** Los tests trabajan en -03:00, la zona fija del proyecto. */
function hora(iso: string, dia = '2026-09-01'): Date {
  return new Date(`${dia}T${iso}:00-03:00`);
}

describe('dentroDeFranja', () => {
  it('acepta un turno dentro de la franja', () => {
    expect(dentroDeFranja(AGENT, hora('10:00'), hora('10:30'))).toBe(true);
  });

  it('rechaza un turno que empieza antes de abrir', () => {
    expect(dentroDeFranja(AGENT, hora('08:30'), hora('09:30'))).toBe(false);
  });

  it('rechaza un turno que termina después de cerrar', () => {
    expect(dentroDeFranja(AGENT, hora('17:45'), hora('18:15'))).toBe(false);
  });

  it('rechaza un turno que cruza la medianoche', () => {
    expect(dentroDeFranja(AGENT, hora('23:30'), hora('00:30', '2026-09-02'))).toBe(false);
  });
});

describe('conMargen', () => {
  it('ensancha el rango con el margen mínimo de cada lado', () => {
    const [desde, hasta] = conMargen(hora('10:00'), hora('10:30'));
    expect(desde.toISOString()).toBe(hora('09:55').toISOString());
    expect(hasta.toISOString()).toBe(hora('10:35').toISOString());
    expect(MARGEN_MINIMO_MIN).toBe(5);
  });
});

describe('ocupadosEnRango', () => {
  const ocupados = [
    { inicio: hora('09:30'), fin: hora('10:00') },
    { inicio: hora('15:00'), fin: hora('16:00') },
  ];

  it('devuelve sólo los períodos que se solapan', () => {
    const [desde, hasta] = conMargen(hora('10:03'), hora('10:33'));
    expect(ocupadosEnRango(ocupados, desde, hasta)).toHaveLength(1);
  });

  it('no cuenta un período que termina justo cuando empieza el rango', () => {
    expect(ocupadosEnRango(ocupados, hora('10:00'), hora('10:30'))).toHaveLength(0);
  });
});

describe('conflictos', () => {
  it('descarta el propio evento del turno que se está reprogramando', () => {
    const propio = { inicio: hora('10:00'), fin: hora('10:30') };
    const ajeno = { inicio: hora('10:42'), fin: hora('11:00') };

    expect(conflictos([propio], propio)).toHaveLength(0);
    expect(conflictos([propio, ajeno], propio)).toEqual([ajeno]);
  });
});

describe('huecosDelDia', () => {
  it('parte el día alrededor de lo ocupado, dejando el margen', () => {
    const huecos = huecosDelDia(
      AGENT,
      [{ inicio: hora('12:00'), fin: hora('13:00') }],
      '2026-09-01',
      hora('00:00'),
      30,
    );

    expect(huecos.map((hueco) => `${horaLocal(hueco.inicio)}-${horaLocal(hueco.fin)}`)).toEqual([
      '09:00-11:55',
      '13:05-18:00',
    ]);
  });

  it('no ofrece horarios que ya pasaron', () => {
    const huecos = huecosDelDia(AGENT, [], '2026-09-01', hora('15:00'), 30);
    expect(huecos).toEqual([{ inicio: hora('15:00'), fin: hora('18:00') }]);
  });

  it('descarta huecos más cortos que la duración mínima', () => {
    const huecos = huecosDelDia(
      AGENT,
      [
        { inicio: hora('09:00'), fin: hora('12:00') },
        { inicio: hora('12:20'), fin: hora('18:00') },
      ],
      '2026-09-01',
      hora('00:00'),
      30,
    );
    expect(huecos).toEqual([]);
  });
});

describe('resumirDisponibilidad', () => {
  it('arma una línea por día, con los huecos libres', () => {
    const resumen = resumirDisponibilidad(
      AGENT,
      [{ inicio: hora('09:00'), fin: hora('18:00') }],
      hora('08:00'),
      hora('08:00', '2026-09-03'),
      30,
      7,
    );

    const lineas = resumen.split('\n');
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toContain('sin huecos');
    expect(lineas[1]).toContain('09:00-18:00');
  });
});

describe('horariosCercanos', () => {
  const VENTANA_DESDE = hora('00:00');
  const VENTANA_HASTA = hora('00:00', '2026-09-08');

  it('sugiere el horario más cercano al pedido dentro del mismo hueco', () => {
    const ocupados = [{ inicio: hora('10:00'), fin: hora('10:30') }];
    const sugerencias = horariosCercanos(
      AGENT,
      ocupados,
      hora('10:03'),
      hora('10:33'),
      VENTANA_DESDE,
      VENTANA_HASTA,
      1,
    );

    // 10:30 + 5 de margen: el punto del hueco posterior más pegado a lo pedido.
    expect(sugerencias).toEqual([{ inicio: hora('10:35'), fin: hora('11:05') }]);
  });

  it('pasa al día siguiente cuando el día pedido está lleno', () => {
    const ocupados = [{ inicio: hora('09:00'), fin: hora('18:00') }];
    const sugerencias = horariosCercanos(
      AGENT,
      ocupados,
      hora('14:00'),
      hora('14:30'),
      VENTANA_DESDE,
      VENTANA_HASTA,
      1,
    );

    // Lo más cercano en el tiempo es la apertura del día siguiente, no la misma
    // hora del día siguiente.
    expect(sugerencias).toEqual([
      { inicio: hora('09:00', '2026-09-02'), fin: hora('09:30', '2026-09-02') },
    ]);
  });

  it('devuelve vacío si no hay ningún hueco de esa duración en la ventana', () => {
    const ocupados = [{ inicio: hora('00:00'), fin: hora('00:00', '2026-09-08') }];
    expect(
      horariosCercanos(AGENT, ocupados, hora('14:00'), hora('14:30'), VENTANA_DESDE, VENTANA_HASTA),
    ).toEqual([]);
    expect(detalleSugerencias([])).toBe('');
  });
});

describe('parsearFecha', () => {
  it('falla con un mensaje claro si no es ISO 8601', () => {
    expect(() => parsearFecha('el martes', 'inicio')).toThrow('inicio');
    expect(() => parsearFecha(undefined, 'inicio')).toThrow('inicio');
  });

  it('ancla a la zona del negocio un ISO sin offset, no a la del proceso', () => {
    // El contenedor de la API corre en UTC: sin anclar, "14:00" era otro instante.
    expect(parsearFecha('2026-09-08T14:00:00', 'inicio').toISOString()).toBe(
      new Date('2026-09-08T14:00:00-03:00').toISOString(),
    );
    expect(parsearFecha('2026-09-08T14:00', 'inicio').toISOString()).toBe(
      new Date('2026-09-08T14:00:00-03:00').toISOString(),
    );
    expect(parsearFecha('2026-09-08', 'desde').toISOString()).toBe(
      new Date('2026-09-08T00:00:00-03:00').toISOString(),
    );
  });

  it('respeta el offset cuando el ISO ya lo trae', () => {
    expect(parsearFecha('2026-09-08T14:00:00Z', 'inicio').toISOString()).toBe('2026-09-08T14:00:00.000Z');
  });
});

describe('esDiaHabil', () => {
  it('atiende de lunes a viernes', () => {
    expect(esDiaHabil('2026-09-07')).toBe(true); // lunes
    expect(esDiaHabil('2026-09-04')).toBe(true); // viernes
  });

  it('no atiende sábados ni domingos', () => {
    expect(esDiaHabil('2026-09-05')).toBe(false); // sábado
    expect(esDiaHabil('2026-09-06')).toBe(false); // domingo
  });
});

describe('huecosDelDia en fin de semana', () => {
  it('no devuelve ningún hueco aunque el día esté vacío', () => {
    expect(huecosDelDia(AGENT, [], '2026-09-05', hora('00:00'), 30)).toEqual([]);
    expect(huecosDelDia(AGENT, [], '2026-09-06', hora('00:00'), 30)).toEqual([]);
  });
});

describe('resumirDisponibilidad en fin de semana', () => {
  it('ni siquiera lista el sábado y el domingo', () => {
    const resumen = resumirDisponibilidad(
      AGENT,
      [],
      hora('08:00', '2026-09-04'),
      hora('08:00', '2026-09-08'),
      30,
      5,
    );

    const lineas = resumen.split('\n');
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toContain('viernes');
    expect(lineas[1]).toContain('lunes');
    expect(resumen).not.toContain('sábado');
    expect(resumen).not.toContain('domingo');
  });
});

describe('horariosCercanos con el fin de semana en el medio', () => {
  it('saltea el sábado y sugiere el lunes', () => {
    const viernes = '2026-09-04';
    const sugerencias = horariosCercanos(
      AGENT,
      [{ inicio: hora('09:00', viernes), fin: hora('18:00', viernes) }],
      hora('14:00', viernes),
      hora('14:30', viernes),
      hora('00:00', viernes),
      hora('00:00', '2026-09-08'),
      1,
    );

    expect(sugerencias).toEqual([
      { inicio: hora('09:00', '2026-09-07'), fin: hora('09:30', '2026-09-07') },
    ]);
  });
});

describe('opcionesDelDia', () => {
  it('devuelve como mucho tres horarios, repartidos a lo largo del día', () => {
    const opciones = opcionesDelDia(AGENT, [], '2026-09-01', hora('00:00'), 60);

    expect(opciones).toHaveLength(MAX_OPCIONES_DIA);
    expect(opciones.map(horaLocal)).toEqual(['09:00', '13:00', '17:00']);
  });

  it('respeta los huecos ocupados y el margen', () => {
    const opciones = opcionesDelDia(
      AGENT,
      [{ inicio: hora('10:00'), fin: hora('16:00') }],
      '2026-09-01',
      hora('00:00'),
      30,
      2,
    );

    expect(opciones.map(horaLocal)).toEqual(['09:00', '17:05']);
  });

  it('no ofrece nada en fin de semana', () => {
    expect(opcionesDelDia(AGENT, [], '2026-09-05', hora('00:00'), 30)).toEqual([]);
  });
});

describe('resumenDelDia', () => {
  const VENTANA_DESDE = hora('00:00');
  const VENTANA_HASTA = hora('00:00', '2026-09-08');

  it('con el día entero libre devuelve el rango, sin enumerar horarios', () => {
    const resumen = resumenDelDia(AGENT, [], '2026-09-01', VENTANA_DESDE, VENTANA_HASTA, 30);

    expect(resumen).toContain('libre de 09:00 a 18:00');
    expect(resumen).toContain('sin enumerar');
  });

  it('con turnos cargados pasa hasta tres horarios y pide preguntar mañana o tarde', () => {
    const resumen = resumenDelDia(
      AGENT,
      [{ inicio: hora('11:00'), fin: hora('12:00') }],
      '2026-09-01',
      VENTANA_DESDE,
      VENTANA_HASTA,
      60,
    );

    expect(resumen).toContain('mañana o por la tarde');
    expect(resumen.match(/\d{2}:\d{2}/g) ?? []).toHaveLength(MAX_OPCIONES_DIA);
  });

  it('sin huecos ofrece la alternativa más cercana', () => {
    const resumen = resumenDelDia(
      AGENT,
      [{ inicio: hora('09:00'), fin: hora('18:00') }],
      '2026-09-01',
      VENTANA_DESDE,
      VENTANA_HASTA,
      30,
    );

    expect(resumen).toContain('no queda nada libre');
    expect(resumen).toContain('miércoles');
  });

  it('en fin de semana avisa que no se atiende', () => {
    const resumen = resumenDelDia(AGENT, [], '2026-09-05', VENTANA_DESDE, VENTANA_HASTA, 30);

    expect(resumen).toContain('sólo de lunes a viernes');
  });
});
