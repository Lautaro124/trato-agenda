// OpenRouter falso para los E2E de Playwright. Contesta el mismo contrato
// OpenAI-compatible que usa la API (`POST /api/v1/chat/completions`), pero de
// forma determinista: los tests no dependen de un modelo real ni gastan plata.
//
// La generación del agente (POST /agents/generate) ya no llama al modelo —
// usa una plantilla determinista (api/src/agents/agent-template.ts) — así que
// este stub sólo distingue dos tipos de pedido:
//   - conversación (trae `tools`): un guion por palabras clave del último
//     mensaje humano, que agenda/mueve/cancela con tool calls reales;
//   - resumen del cliente (sin tools): texto fijo.
//
// Sin dependencias: corre con `node server.mjs` o dentro de node:24-alpine.
import http from 'node:http';

const PUERTO = Number(process.env.PORT ?? 4010);
const ZONA = 'America/Argentina/Buenos_Aires';

/** Registro de pedidos para que los tests afirmen qué mandó la API. */
let llamadas = [];

function responder(res, status, cuerpo) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}

function completion(model, message) {
  return {
    id: `stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: null, ...message },
        finish_reason: message.tool_calls ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0 },
  };
}

function textoDe(mensaje) {
  if (typeof mensaje?.content === 'string') return mensaje.content;
  if (Array.isArray(mensaje?.content)) return mensaje.content.map((parte) => parte.text ?? '').join('');
  return '';
}

// --- Conversación ----------------------------------------------------------
//
// El system prompt que arma el runtime siempre incluye, en código (no en el
// texto generado por IA o por la plantilla), el bloque "Reglas de la agenda
// de <titular> ... Tipos de turno con su duración y, si lo tienen, su precio: ..." — ver
// `reglasDeAgenda` en api/src/conversation/graph/nodes/cargar-contexto.node.ts.
// Este stub lee el titular y el primer tipo de turno de ahí en vez de una
// convención propia, así no depende de cómo se generó el agente.

/** "YYYY-MM-DD" del día hábil siguiente a hoy, en la zona del negocio. */
function proximoDiaHabil() {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
  const fecha = new Date(`${hoy}T12:00:00-03:00`);
  do {
    fecha.setUTCDate(fecha.getUTCDate() + 1);
  } while ([0, 6].includes(fecha.getUTCDay()));
  return fecha.toISOString().slice(0, 10);
}

function iso(dia, hora) {
  return `${dia}T${hora}:00-03:00`;
}

function sumarMinutos(hhmm, minutos) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutos;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function normalizar(texto) {
  // NFD separa las tildes en marcas combinables (U+0300..U+036F), que se descartan.
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function llamadaATool(model, name, args) {
  return completion(model, {
    content: null,
    tool_calls: [{ id: `call_${Math.random().toString(36).slice(2, 10)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  });
}

function conversar(body, res) {
  const mensajes = body.messages ?? [];
  const sistema = textoDe(mensajes.find((mensaje) => mensaje.role === 'system'));
  const indiceUsuario = mensajes.findLastIndex((mensaje) => mensaje.role === 'user');
  const ultimoUsuario = normalizar(textoDe(mensajes[indiceUsuario]));
  const resultadoTool = mensajes.slice(indiceUsuario + 1).findLast((mensaje) => mensaje.role === 'tool');
  const titular = sistema.match(/Reglas de la agenda de (.*?) \(no las rompas\)/)?.[1]?.trim();
  llamadas.push({
    tipo: 'conversacion',
    titular,
    mensaje: ultimoUsuario,
    conResultado: Boolean(resultadoTool),
    ...resumenDelPedido(body),
  });

  // Ya se ejecutó la herramienta de este mensaje: se cierra con lo que devolvió.
  if (resultadoTool) {
    return responder(res, 200, completion(body.model, { content: `Listo: ${textoDe(resultadoTool)}` }));
  }

  // El primer tipo de turno del bloque de reglas que agrega el código.
  const tipo = sistema.match(/Tipos de turno con su duración[^:]*: ([^,(]+?) \((\d+) min[,)]/);
  const resumen = tipo?.[1]?.trim() ?? 'Turno';
  const duracion = Number(tipo?.[2] ?? 30);
  const dia = proximoDiaHabil();

  if (ultimoUsuario.includes('cancel')) {
    return responder(res, 200, llamadaATool(body.model, 'cancelar_turno', {}));
  }

  if (ultimoUsuario.includes('movelo') || ultimoUsuario.includes('reprogram')) {
    return responder(
      res,
      200,
      llamadaATool(body.model, 'reprogramar_turno', { inicio: iso(dia, '11:00'), fin: iso(dia, sumarMinutos('11:00', duracion)) }),
    );
  }

  if (ultimoUsuario.includes('turno')) {
    const nombre = textoDe(mensajes[indiceUsuario]).match(/soy ([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)/i)?.[1];
    if (!nombre) {
      return responder(res, 200, completion(body.model, { content: '¿A nombre de quién agendo el turno?' }));
    }
    return responder(
      res,
      200,
      llamadaATool(body.model, 'crear_turno', {
        nombreCliente: nombre,
        resumen,
        inicio: iso(dia, '10:00'),
        fin: iso(dia, sumarMinutos('10:00', duracion)),
      }),
    );
  }

  return responder(res, 200, completion(body.model, { content: 'Hola, ¿querés sacar un turno?' }));
}

// --- Servidor --------------------------------------------------------------

function resumenDelPedido(body) {
  return {
    model: body.model,
    max_tokens: body.max_tokens ?? null,
    response_format: body.response_format ?? null,
    provider: body.provider ?? null,
    reasoning: body.reasoning ?? null,
    tools: (body.tools ?? []).map((tool) => tool.function?.name),
  };
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', (parte) => (datos += parte));
    req.on('end', () => {
      try {
        resolve(datos ? JSON.parse(datos) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PUERTO}`);

  if (req.method === 'GET' && url.pathname === '/health') return responder(res, 200, { status: 'ok' });

  if (url.pathname === '/__llamadas') {
    if (req.method === 'DELETE') {
      llamadas = [];
      intentos.clear();
      return responder(res, 204, {});
    }
    const titular = url.searchParams.get('titular');
    return responder(res, 200, titular ? llamadas.filter((llamada) => llamada.titular === titular) : llamadas);
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/chat/completions') {
    let body;
    try {
      body = await leerCuerpo(req);
    } catch {
      return responder(res, 400, { error: { message: 'JSON inválido' } });
    }
    if (Array.isArray(body.tools) && body.tools.length > 0) return conversar(body, res);

    llamadas.push({ tipo: 'resumen', ...resumenDelPedido(body) });
    return responder(res, 200, completion(body.model, { content: 'Cliente de prueba E2E.' }));
  }

  return responder(res, 404, { error: { message: `Ruta desconocida: ${req.method} ${url.pathname}` } });
});

servidor.listen(PUERTO, '0.0.0.0', () => {
  console.log(`OpenRouter falso escuchando en :${PUERTO}`);
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => servidor.close(() => process.exit(0)));
}
