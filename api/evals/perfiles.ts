import type { GenerateAgentDto } from '../src/agents/agents.types.js';

export type PerfilEval = { id: string; dto: GenerateAgentDto };

function tipos(cantidad: number) {
  return Array.from({ length: cantidad }, (_, i) => ({ nombre: `Servicio número ${i + 1}`, duracionMin: 15 + (i % 6) * 15 }));
}

/** Perfiles de /contanos para medir la generación del agente. */
export const PERFILES: PerfilEval[] = [
  {
    // El que devolvió 502 en producción el 2026-09-10.
    id: 'prod-otro-5-propios',
    dto: {
      tipoTitular: 'negocio',
      nombreTitular: 'Estudio La Ñata',
      tipoUso: 'otro',
      tiposEvento: [
        { nombre: 'Sesión de fotos en exterior', duracionMin: 90 },
        { nombre: 'Retoque express', duracionMin: 15 },
        { nombre: 'Entrega de álbum', duracionMin: 30 },
        { nombre: 'Consulta previa por videollamada', duracionMin: 20 },
        { nombre: 'Taller grupal de iluminación', duracionMin: 120 },
      ],
      horaDesde: '10:00',
      horaHasta: '19:00',
      nombreBot: 'Nina',
    },
  },
  {
    id: 'consultorio-persona-5',
    dto: {
      tipoTitular: 'persona',
      nombreTitular: 'Dra. Lucía Fernández',
      tipoUso: 'consultorio',
      tiposEvento: [
        { nombre: 'Primera consulta', duracionMin: 45 },
        { nombre: 'Consulta de control', duracionMin: 30 },
        { nombre: 'Visita común', duracionMin: 20 },
        { nombre: 'Estudio', duracionMin: 60 },
        { nombre: 'Urgencia', duracionMin: 15 },
      ],
      horaDesde: '09:00',
      horaHasta: '18:00',
      nombreBot: 'Tati',
    },
  },
  {
    id: 'maximo-20-tipos',
    dto: {
      tipoTitular: 'negocio',
      nombreTitular: 'Centro Integral Palermo',
      tipoUso: 'otro',
      tiposEvento: tipos(20),
      horaDesde: '08:00',
      horaHasta: '21:00',
      nombreBot: 'Sofi',
    },
  },
  {
    id: 'nombres-raros',
    dto: {
      tipoTitular: 'negocio',
      nombreTitular: 'Barbería "El Tano" & Hijos',
      tipoUso: 'comercio',
      tiposEvento: [
        { nombre: 'Corte "fade" / barba 💈', duracionMin: 45 },
        { nombre: 'Color + brushing (largo)', duracionMin: 90 },
        { nombre: "Perfilado d'cejas", duracionMin: 15 },
      ],
      horaDesde: '10:00',
      horaHasta: '20:00',
      nombreBot: 'Beto',
    },
  },
  {
    id: 'franja-una-hora',
    dto: {
      tipoTitular: 'persona',
      nombreTitular: 'Martín Gómez',
      tipoUso: 'reuniones',
      tiposEvento: [{ nombre: 'Llamada de 15 minutos', duracionMin: 15 }],
      horaDesde: '08:00',
      horaHasta: '09:00',
      nombreBot: 'Tati',
    },
  },
  {
    id: 'comercio-1-tipo',
    dto: {
      tipoTitular: 'negocio',
      nombreTitular: 'Tienda Centro',
      tipoUso: 'comercio',
      tiposEvento: [{ nombre: 'Retiro de pedido', duracionMin: 15 }],
      horaDesde: '09:00',
      horaHasta: '13:00',
      nombreBot: 'Nina',
    },
  },
];
