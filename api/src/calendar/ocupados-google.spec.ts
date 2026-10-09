import { describe, expect, it } from 'vitest';
import type { calendar_v3 } from 'googleapis';
import { bloqueaAgenda, esZonaValida, medianocheEnZona, ocupadosDeEventos } from './ocupados-google.js';

const AR = 'America/Argentina/Buenos_Aires';

function conHora(inicio: string, fin: string, extra: calendar_v3.Schema$Event = {}): calendar_v3.Schema$Event {
  return { status: 'confirmed', start: { dateTime: inicio }, end: { dateTime: fin }, ...extra };
}

function diaCompleto(inicio: string, fin: string, extra: calendar_v3.Schema$Event = {}): calendar_v3.Schema$Event {
  return { status: 'confirmed', start: { date: inicio }, end: { date: fin }, ...extra };
}

describe('ocupadosDeEventos', () => {
  it('un evento normal con horario se devuelve como { inicio, fin }', () => {
    const ocupados = ocupadosDeEventos(
      [conHora('2026-09-14T10:00:00-03:00', '2026-09-14T10:30:00-03:00')],
      AR,
      AR,
    );

    expect(ocupados).toEqual([
      { inicio: new Date('2026-09-14T13:00:00Z'), fin: new Date('2026-09-14T13:30:00Z') },
    ]);
  });

  it('las instancias de un recurrente (singleEvents) cuentan cada una por separado', () => {
    const instancias = [
      conHora('2026-09-14T09:00:00-03:00', '2026-09-14T10:00:00-03:00', { recurringEventId: 'serie-1' }),
      conHora('2026-09-21T09:00:00-03:00', '2026-09-21T10:00:00-03:00', { recurringEventId: 'serie-1' }),
    ];

    expect(ocupadosDeEventos(instancias, AR, AR)).toEqual([
      { inicio: new Date('2026-09-14T12:00:00Z'), fin: new Date('2026-09-14T13:00:00Z') },
      { inicio: new Date('2026-09-21T12:00:00Z'), fin: new Date('2026-09-21T13:00:00Z') },
    ]);
  });

  it('un evento de día completo ocupa de medianoche a medianoche en la zona del calendario', () => {
    // end.date es exclusivo: el 14 entero es del 14 a las 00:00 al 15 a las 00:00.
    expect(ocupadosDeEventos([diaCompleto('2026-09-14', '2026-09-15')], AR, AR)).toEqual([
      { inicio: new Date('2026-09-14T03:00:00Z'), fin: new Date('2026-09-15T03:00:00Z') },
    ]);
  });

  it('un día completo de varios días en una zona con cambio de horario', () => {
    // Madrid pasa de +02:00 a +01:00 la madrugada del 25/10/2026.
    expect(ocupadosDeEventos([diaCompleto('2026-10-24', '2026-10-27')], 'Europe/Madrid', AR)).toEqual([
      { inicio: new Date('2026-10-23T22:00:00Z'), fin: new Date('2026-10-26T23:00:00Z') },
    ]);
  });

  it('sin zona del calendario (o inválida) usa la zona por defecto', () => {
    const esperado = [{ inicio: new Date('2026-09-14T03:00:00Z'), fin: new Date('2026-09-15T03:00:00Z') }];

    expect(ocupadosDeEventos([diaCompleto('2026-09-14', '2026-09-15')], undefined, AR)).toEqual(esperado);
    expect(ocupadosDeEventos([diaCompleto('2026-09-14', '2026-09-15')], 'Marte/Olympus', AR)).toEqual(esperado);
  });

  it('descarta los eventos cancelados', () => {
    const cancelado = conHora('2026-09-14T10:00:00-03:00', '2026-09-14T11:00:00-03:00', { status: 'cancelled' });

    expect(ocupadosDeEventos([cancelado], AR, AR)).toEqual([]);
  });

  it('descarta los marcados "Disponible" (transparent), pero no los "Ocupado" (opaque)', () => {
    const disponible = conHora('2026-09-14T10:00:00-03:00', '2026-09-14T11:00:00-03:00', {
      transparency: 'transparent',
    });
    const ocupado = conHora('2026-09-14T12:00:00-03:00', '2026-09-14T13:00:00-03:00', { transparency: 'opaque' });

    expect(ocupadosDeEventos([disponible, ocupado], AR, AR)).toEqual([
      { inicio: new Date('2026-09-14T15:00:00Z'), fin: new Date('2026-09-14T16:00:00Z') },
    ]);
  });

  it('descarta las invitaciones que el titular rechazó; las aceptadas o pendientes sí ocupan', () => {
    const rechazada = conHora('2026-09-14T10:00:00-03:00', '2026-09-14T11:00:00-03:00', {
      attendees: [
        { self: true, responseStatus: 'declined' },
        { responseStatus: 'accepted' },
      ],
    });
    const aceptada = conHora('2026-09-14T12:00:00-03:00', '2026-09-14T13:00:00-03:00', {
      attendees: [{ self: true, responseStatus: 'accepted' }],
    });
    const pendiente = conHora('2026-09-14T14:00:00-03:00', '2026-09-14T15:00:00-03:00', {
      attendees: [{ self: true, responseStatus: 'needsAction' }],
    });
    // Rechazó otro invitado, no el titular: sigue ocupando.
    const rechazoAjeno = conHora('2026-09-14T16:00:00-03:00', '2026-09-14T17:00:00-03:00', {
      attendees: [{ responseStatus: 'declined' }, { self: true, responseStatus: 'accepted' }],
    });

    expect(ocupadosDeEventos([rechazada, aceptada, pendiente, rechazoAjeno], AR, AR).map((p) => p.inicio)).toEqual([
      new Date('2026-09-14T15:00:00Z'),
      new Date('2026-09-14T17:00:00Z'),
      new Date('2026-09-14T19:00:00Z'),
    ]);
  });

  it('devuelve los superpuestos tal cual, ordenados por inicio', () => {
    const largo = conHora('2026-09-14T10:00:00-03:00', '2026-09-14T12:00:00-03:00');
    const adentro = conHora('2026-09-14T09:30:00-03:00', '2026-09-14T10:30:00-03:00');

    expect(ocupadosDeEventos([largo, adentro], AR, AR)).toEqual([
      { inicio: new Date('2026-09-14T12:30:00Z'), fin: new Date('2026-09-14T13:30:00Z') },
      { inicio: new Date('2026-09-14T13:00:00Z'), fin: new Date('2026-09-14T15:00:00Z') },
    ]);
  });

  it('ignora los eventos de ubicación de trabajo y los que no tienen horario válido', () => {
    const ubicacion = diaCompleto('2026-09-14', '2026-09-15', { eventType: 'workingLocation' });
    const sinFin: calendar_v3.Schema$Event = { status: 'confirmed', start: { dateTime: '2026-09-14T10:00:00-03:00' } };
    const roto = conHora('no-es-fecha', '2026-09-14T11:00:00-03:00');

    expect(ocupadosDeEventos([ubicacion, sinFin, roto], AR, AR)).toEqual([]);
  });

  it('fuera de oficina y tiempo de concentración sí ocupan', () => {
    expect(bloqueaAgenda({ eventType: 'outOfOffice' })).toBe(true);
    expect(bloqueaAgenda({ eventType: 'focusTime' })).toBe(true);
  });
});

describe('medianocheEnZona', () => {
  it('calcula la medianoche local como instante UTC', () => {
    expect(medianocheEnZona('2026-09-14', AR)).toEqual(new Date('2026-09-14T03:00:00Z'));
    expect(medianocheEnZona('2026-01-15', 'Europe/Madrid')).toEqual(new Date('2026-01-14T23:00:00Z'));
    expect(medianocheEnZona('2026-07-15', 'Europe/Madrid')).toEqual(new Date('2026-07-14T22:00:00Z'));
    expect(medianocheEnZona('2026-09-14', 'UTC')).toEqual(new Date('2026-09-14T00:00:00Z'));
  });

  it('devuelve null si la fecha no es YYYY-MM-DD', () => {
    expect(medianocheEnZona('14/09/2026', AR)).toBeNull();
  });

  it('esZonaValida reconoce zonas IANA y rechaza el resto', () => {
    expect(esZonaValida(AR)).toBe(true);
    expect(esZonaValida('Marte/Olympus')).toBe(false);
    expect(esZonaValida(null)).toBe(false);
  });
});
