import { describe, expect, it } from 'vitest';
import type { Agent } from '../../../generated/prisma/client.js';
import { contextoFijoVentas } from './cargar-contexto-ventas.node.js';

describe('contextoFijoVentas', () => {
  const agent = { nombreTitular: 'Mates del Sur', nombreBot: 'Nina', local: null, mensajes: null } as unknown as Agent;
  const conversation = { remoteJid: '5491111@s.whatsapp.net', resumen: null, nombreCliente: null };

  it('suma las reglas para sonar humano y, si preguntan, ofrece al dueño por derivar_consulta', () => {
    const contexto = contextoFijoVentas(agent, conversation, false, { mpConectado: true, yaSePresento: false });

    expect(contexto).toContain('la persona que atiende el WhatsApp de Mates del Sur');
    expect(contexto).toContain('sos un asistente automático');
    expect(contexto).toContain('le avisás a Mates del Sur con derivar_consulta');
  });
});
