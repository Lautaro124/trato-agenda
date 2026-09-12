// OpenRouter falso para los E2E de Playwright. Contesta el mismo contrato
// OpenAI-compatible que usa la API (`POST /api/v1/chat/completions`), pero de
// forma determinista: los tests no dependen de un modelo real ni gastan plata.
//
// Distingue los tres tipos de pedido que hace la API:
//   - generación del agente (trae `response_format`): arma la config a partir
//     del mensaje de usuario del meta-agente;
//   - conversación (trae `tools`): un guion por palabras clave del último
//     mensaje humano, que agenda/mueve/cancela con tool calls reales;
//   - resumen del cliente (ni tools ni response_format): texto fijo.
//
// Marcas en el nombre del titular para probar los caminos de error:
//   [json-roto] -> el primer intento devuelve texto que no es JSON;
//   [falla]     -> responde 500 siempre (la API termina en 502).
//
// Sin dependencias: corre con `node server.mjs` o dentro de node:24-alpine.
import http from 'node:http';

const PUERTO = Number(process.env.PORT ?? 4010);
const ZONA = 'America/Argentina/Buenos_Aires';
const ACCIONES = ['consultar_disponibilidad', 'crear_turno', 'cancelar_turno', 'reprogramar_turno', 'consultar_turno'];

/** Registro de pedidos para que los tests afirmen qué mandó la API. */
let llamadas = [];
/** Intentos de generación por titular, para el caso [json-roto]. */
const intentos = new Map();

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

function campo(texto, regex) {
  return texto.match(regex)?.[1]?.trim() ?? '';
}

// --- Generación del agente -------------------------------------------------

function datosDelPerfil(body) {
  const usuario = textoDe(body.messages?.find((mensaje) => mensaje.role === 'user'));
  return {
    titular: campo(usuario, /^Titular \((?:persona|negocio)\): (.*)$/m),
    bot: campo(usuario, /^Nombre del asistente: (.*)$/m),
    franja: campo(usuario, /^Franja horaria de atención: (.*)$/m),
    tipos: campo(usuario, /^Tipos de turno: (.*)$/m),
  };
}

function generar(body, res) {
  const perfil = datosDelPerfil(body);
  const intento = (intentos.get(perfil.titular) ?? 0) + 1;
  intentos.set(perfil.titular, intento);
  llamadas.push({ tipo: 'generacion', titular: perfil.titular, intento, ...resumenDelPedido(body) });

  if (perfil.titular.includes('[falla]')) {
    return responder(res, 500, { error: { message: 'Proveedor caído (stub)' } });
  }
  if (perfil.titular.includes('[json-roto]') && intento === 1) {
    return responder(res, 200, completion(body.model, { content: 'Claro, acá va tu config: {systemPrompt: sin comillas' }));
  }

  const config = {
    systemPrompt:
      `Sos ${perfil.bot}, el asistente de ${perfil.titular}. ` +
      `Tomás turnos de: ${perfil.tipos}. Atendés de lunes a viernes, ${perfil.franja}. ` +
      'Preguntá siempre el nombre antes de agendar y hablá sólo de la agenda.',
    allowedActions: ACCIONES,
  };
  return responder(res, 200, completion(body.model, { content: JSON.stringify(config) }));
}

// --- Conversación ----------------------------------------------------------

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
  llamadas.push({ tipo: 'conversacion', mensaje: ultimoUsuario, conResultado: Boolean(resultadoTool), ...resumenDelPedido(body) });

  // Ya se ejecutó la herramienta de este mensaje: se cierra con lo que devolvió.
  if (resultadoTool) {
    return responder(res, 200, completion(body.model, { content: `Listo: ${textoDe(resultadoTool)}` }));
  }

  // El primer tipo de turno del prompt generado por este mismo stub.
  const tipo = sistema.match(/Tomás turnos de: ([^,(]+?) \((\d+) min\)/);
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
    if (body.response_format) return generar(body, res);
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
