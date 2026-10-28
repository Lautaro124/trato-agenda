import { describe, expect, it } from 'vitest';
import type { FranjaLocal } from '../agents/local.js';
import {
  dentroDelHorario,
  estadoDelAsistente,
  leerHorarioAtencion,
  normalizarHorarioAtencion,
  resumenHorarioAtencion,
  ZONA_POR_DEFECTO,
  type HorarioAtencion,
} from './horario-atencion.rules.js';

const SEMANA: FranjaLocal[] = (['lun', 'mar', 'mie', 'jue', 'vie'] as const).map((dia) => ({
  dia,
  desde: '09:00',
  hasta: '18:00',
}));

const horario = (parcial: Partial<HorarioAtencion> = {}): HorarioAtencion => ({
  activo: true,
  franjas: SEMANA,
  zona: ZONA_POR_DEFECTO,
  ...parcial,
});

// Jueves 8 de octubre de 2026, en hora argentina (UTC-3, sin horario de verano).
const jueves = (hora: string) => new Date(`2026-10-08T${hora}:00-03:00`);

describe('normalizarHorarioAtencion', () => {
  it('ordena las franjas y guarda la zona', () => {
    const resultado = normalizarHorarioAtencion({
      activo: true,
      franjas: [
        { dia: 'mar', desde: '09:00', hasta: '12:00' },
        { dia: 'lun', desde: '15:00', hasta: '19:00' },
        { dia: 'lun', desde: '09:00', hasta: '12:00' },
      ],
      zona: 'America/Montevideo',
    });
    expect(resultado).toEqual({
      horario: {
        activo: true,
        franjas: [
          { dia: 'lun', desde: '09:00', hasta: '12:00' },
          { dia: 'lun', desde: '15:00', hasta: '19:00' },
          { dia: 'mar', desde: '09:00', hasta: '12:00' },
        ],
        zona: 'America/Montevideo',
      },
    });
  });

  it('rechaza una zona que no está en la lista, aunque sea IANA', () => {
    expect(normalizarHorarioAtencion({ activo: true, franjas: SEMANA, zona: 'Asia/Tokyo' })).toEqual({
      error: 'Elegí una zona horaria de la lista.',
    });
  });

  it('activo sin franjas no se guarda: dejaría al asistente apagado para siempre', () => {
    expect(normalizarHorarioAtencion({ activo: true, franjas: [], zona: ZONA_POR_DEFECTO })).toHaveProperty('error');
  });

  it('sin restricción se puede guardar sin franjas', () => {
    expect(normalizarHorarioAtencion({ activo: false, franjas: [], zona: ZONA_POR_DEFECTO })).toEqual({
      horario: { activo: false, franjas: [], zona: ZONA_POR_DEFECTO },
    });
  });

  it('rechaza franjas invertidas o que se pisan', () => {
    expect(
      normalizarHorarioAtencion({
        activo: true,
        franjas: [{ dia: 'lun', desde: '18:00', hasta: '09:00' }],
        zona: ZONA_POR_DEFECTO,
      }),
    ).toEqual({ error: 'El lunes cierra antes de abrir.' });
    expect(
      normalizarHorarioAtencion({
        activo: true,
        franjas: [
          { dia: 'lun', desde: '09:00', hasta: '13:00' },
          { dia: 'lun', desde: '12:00', hasta: '18:00' },
        ],
        zona: ZONA_POR_DEFECTO,
      }),
    ).toEqual({ error: 'Los horarios del lunes se pisan.' });
  });
});

describe('leerHorarioAtencion', () => {
  it('lee lo guardado', () => {
    expect(
      leerHorarioAtencion({ horarioAtencionActivo: true, horarioAtencion: SEMANA, zonaHoraria: 'Europe/Madrid' }),
    ).toEqual(horario({ zona: 'Europe/Madrid' }));
  });

  it('una cuenta de antes de LAU-29 atiende siempre', () => {
    expect(
      leerHorarioAtencion({ horarioAtencionActivo: false, horarioAtencion: [], zonaHoraria: ZONA_POR_DEFECTO }),
    ).toEqual({ activo: false, franjas: [], zona: ZONA_POR_DEFECTO });
  });

  it('un dato roto atiende siempre en vez de apagar al asistente', () => {
    expect(
      leerHorarioAtencion({ horarioAtencionActivo: true, horarioAtencion: [], zonaHoraria: 'Marte/Olympus' }),
    ).toEqual({ activo: false, franjas: [], zona: ZONA_POR_DEFECTO });
    expect(
      leerHorarioAtencion({ horarioAtencionActivo: true, horarioAtencion: 'basura', zonaHoraria: ZONA_POR_DEFECTO })
        .activo,
    ).toBe(false);
  });
});

describe('dentroDelHorario', () => {
  it('dentro y fuera de la franja, con el cierre exacto ya afuera', () => {
    expect(dentroDelHorario(horario(), jueves('09:00'))).toBe(true);
    expect(dentroDelHorario(horario(), jueves('17:59'))).toBe(true);
    expect(dentroDelHorario(horario(), jueves('18:00'))).toBe(false);
    expect(dentroDelHorario(horario(), jueves('08:59'))).toBe(false);
  });

  it('un día sin franjas está cerrado', () => {
    expect(dentroDelHorario(horario(), new Date('2026-10-10T12:00:00-03:00'))).toBe(false);
  });

  it('sin restricción atiende a cualquier hora', () => {
    expect(dentroDelHorario(horario({ activo: false }), new Date('2026-10-10T03:00:00-03:00'))).toBe(true);
  });

  it('respeta el horario de verano de la zona elegida', () => {
    const madrid = horario({ zona: 'Europe/Madrid', franjas: [{ dia: 'lun', desde: '09:00', hasta: '10:00' }] });
    // Lunes 6 de julio (CEST, UTC+2): 07:30 UTC son las 09:30 en Madrid.
    expect(dentroDelHorario(madrid, new Date('2026-07-06T07:30:00Z'))).toBe(true);
    // Lunes 5 de enero (CET, UTC+1): la misma hora UTC son las 08:30, todavía cerrado.
    expect(dentroDelHorario(madrid, new Date('2026-01-05T07:30:00Z'))).toBe(false);
    expect(dentroDelHorario(madrid, new Date('2026-01-05T08:30:00Z'))).toBe(true);
  });

  it('el mismo instante cae distinto según la zona', () => {
    // 11:00 en Buenos Aires son las 09:00 en Bogotá (UTC-5) y las 16:00 en Madrid (CEST).
    const instante = jueves('11:00');
    const temprano = [{ dia: 'jue' as const, desde: '08:00', hasta: '10:00' }];
    expect(dentroDelHorario(horario({ franjas: temprano }), instante)).toBe(false);
    expect(dentroDelHorario(horario({ franjas: temprano, zona: 'America/Bogota' }), instante)).toBe(true);
  });
});

describe('resumenHorarioAtencion', () => {
  it('agrupa días y aclara cuando atiende siempre', () => {
    expect(resumenHorarioAtencion(horario())).toBe('lunes a viernes de 09:00 a 18:00');
    expect(resumenHorarioAtencion(horario({ activo: false }))).toBe('Atiende siempre');
  });
});

describe('estadoDelAsistente', () => {
  const base = { vinculado: true, suscripcionActiva: true, horario: horario(), ahora: jueves('12:00') };

  it('prendido dentro del horario, con la hora de cierre', () => {
    expect(estadoDelAsistente(base)).toEqual({ prendido: true, motivo: null, hasta: '18:00', zona: ZONA_POR_DEFECTO });
  });

  it('sin restricción, prendido sin hora de cierre', () => {
    expect(estadoDelAsistente({ ...base, horario: horario({ activo: false }) })).toEqual({
      prendido: true,
      motivo: null,
      zona: ZONA_POR_DEFECTO,
    });
  });

  it('fuera de horario dice cuándo vuelve', () => {
    expect(estadoDelAsistente({ ...base, ahora: jueves('20:00') })).toEqual({
      prendido: false,
      motivo: 'fuera_de_horario',
      vuelve: { dia: 'vie', desde: '09:00', enDias: 1 },
      zona: ZONA_POR_DEFECTO,
    });
  });

  it('sin WhatsApp o con la suscripción vencida, eso manda sobre el horario', () => {
    expect(estadoDelAsistente({ ...base, vinculado: false, suscripcionActiva: false }).motivo).toBe('sin_whatsapp');
    expect(estadoDelAsistente({ ...base, suscripcionActiva: false, ahora: jueves('20:00') }).motivo).toBe(
      'suscripcion_vencida',
    );
  });
});
