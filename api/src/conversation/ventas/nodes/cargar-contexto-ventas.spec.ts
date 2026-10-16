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
    expect(contexto).toContain('se lo pasás con derivar_consulta y le escribimos por este chat');
  });

  it('suma la pista de emoji al bloque de estilo', () => {
    const contexto = contextoFijoVentas(agent, conversation, false, {
      mpConectado: true,
      yaSePresento: true,
      pistaEmoji: '\nEmojis en este mensaje: ninguno.',
    });
    expect(contexto).toContain('no repitas lo que el cliente ya te dijo.\nEmojis en este mensaje: ninguno.');
  });
});
