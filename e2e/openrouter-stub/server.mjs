// OpenRouter falso para los E2E de Playwright. Contesta el mismo contrato
// OpenAI-compatible que usa la API (`POST /api/v1/chat/completions`), pero de
// forma determinista: los tests no dependen de un modelo real ni gastan plata.
//
// La generación del agente (POST /agents/generate) ya no llama al modelo —
// usa una plantilla determinista (api/src/agents/agent-template.ts) — así que
// este stub sólo distingue tres tipos de pedido:
//   - conversación (trae `tools`): un guion por palabras clave del último
//     mensaje humano, que agenda/mueve/cancela con tool calls reales;
//   - resumen del cliente (sin tools): texto fijo;
//   - embeddings del catálogo de ventas: bolsa de palabras determinista;
//   - la Decisions API (Jev) de las sugerencias de ventas: palabras en común.
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

// --- Ventas ------------------------------------------------------------------
//
// El asistente de ventas se reconoce por el bloque "Reglas de venta de <titular>"
// que agrega el runtime en código (reglas-ventas.ts). Guion por palabras clave
// del último mensaje del cliente:
//   - "quiero …" / "lo compro" (con "soy <Nombre>") → crear_pedido con la
//     primera variante de la última búsqueda del historial ("quiero 2 …" pide 2);
//     si las reglas dicen que el negocio hace envíos, "con envío" / "lo retiro"
//     van en `entrega`, y los pares "Etiqueta: valor" separados por ";" van en
//     `datosCliente`;
//   - "cancel…" → cancelar_pedido; "mi pedido" / "pagué" → consultar_pedido;
//   - "envío" / "envían" fuera de una compra → derivar_consulta;
//   - "dónde queda" / "dirección" / "retirar" / "el local" → contesta con lo
//     que dice el bloque del local del system prompt (bloqueLocal): la
//     dirección y si se retira, que no hay local, o derivar_consulta si el
//     local nunca se cargó;
//   - "foto" → enviar_imagen_producto con el producto de la última búsqueda
//     ("[producto <id>]"), o "no tengo foto" si no buscó nada;
//   - "qué tenés" / "qué productos" / "qué ofrecés" → ver_catalogo; "mostrame
//     <categoría>" → ver_catalogo con esa categoría;
//   - sólo con las herramientas del dueño (banco de pruebas del Home):
//     "cuánto vendí" → resumen_ventas de los últimos 7 días, "ventas de hoy" →
//     listar_ventas de hoy;
//   - un saludo → saludo; cualquier otra cosa → buscar_productos con el texto.
// Con el resultado de la herramienta contesta: el primer producto encontrado,
// la lista de ver_catalogo sin comillas, o el texto de la herramienta tal cual
// (así el link de pago llega al cliente).

/** "YYYY-MM-DD" en Buenos Aires, corrido `dias` días. */
function diaDeBuenosAires(dias = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(
    new Date(Date.now() + dias * 24 * 60 * 60 * 1000),
  );
}

function productoDeLaUltimaBusqueda(mensajes) {
  for (const mensaje of [...mensajes].reverse()) {
    if (mensaje.role !== 'tool') continue;
    const id = textoDe(mensaje).match(/\[producto ([\w-]+)\]/)?.[1];
    if (id) return id;
  }
  return null;
}

function varianteDeLaUltimaBusqueda(mensajes) {
  for (const mensaje of [...mensajes].reverse()) {
    if (mensaje.role !== 'tool') continue;
    const id = textoDe(mensaje).match(/\[variante ([\w-]+)\]/)?.[1];
    if (id) return id;
  }
  return null;
}

/** Lo que contesta el asistente sobre el local, leído del bloque que arma bloqueLocal. */
function respuestaDelLocal(body, sistema, pregunta) {
  if (sistema.includes('no tiene local a la calle')) {
    return completion(body.model, { content: 'No tenemos local a la calle: vendemos sólo por acá.' });
  }
  const direccion = sistema.match(/- Dirección: "((?:[^"\\]|\\.)*)"\./)?.[1];
  if (!sistema.includes('Local de ') || !direccion) {
    return llamadaATool(body.model, 'derivar_consulta', { resumen: pregunta });
  }
  const retiro = sistema.includes('Se pueden retirar las compras en el local')
    ? 'Podés retirar tu compra ahí.'
    : 'No hacemos retiro en el local.';
  return completion(body.model, { content: `Estamos en ${direccion}. ${retiro}` });
}

function conversarVentas(body, res, { mensajes, sistema, indiceUsuario, ultimoUsuario, resultadoTool }) {
  const titular = sistema.match(/Reglas de venta de (.*?) \(no las rompas\)/)?.[1]?.trim();
  llamadas.push({ tipo: 'ventas', titular, mensaje: ultimoUsuario, conResultado: Boolean(resultadoTool), ...resumenDelPedido(body) });

  if (resultadoTool) {
    const resultado = textoDe(resultadoTool);
    // "Ningún producto se llama como …": sólo hubo parecidos por significado; el stub ofrece el primero igual.
    if (resultado.startsWith('Resultados de') || resultado.startsWith('Ningún producto se llama como')) {
      const primero = resultado.match(/1\. "(.+?)" (?:\[producto [^\]]+\] )?\(código/)?.[1];
      const precio = resultado.match(/\]: (\$ [\d.,]+), /)?.[1];
      return responder(res, 200, completion(body.model, { content: `Tengo ${primero} a ${precio}.` }));
    }
    if (resultado.startsWith('Listo: la foto')) {
      return responder(res, 200, completion(body.model, { content: 'Ahí te mandé la foto. ¿Es lo que buscabas?' }));
    }
    if (resultado.includes('no tiene foto')) {
      return responder(res, 200, completion(body.model, { content: 'De ese no tengo foto, pero te cuento cómo es.' }));
    }
    if (resultado.startsWith('No hay productos')) {
      return responder(res, 200, completion(body.model, { content: 'No tengo eso, ¿buscás otra cosa?' }));
    }
    // ver_catalogo: las líneas "- ..." tal cual, sin las comillas de JSON.stringify.
    const lineas = resultado.split('\n').filter((linea) => linea.startsWith('- ')).map((linea) => linea.replaceAll('"', ''));
    if (resultado.startsWith('Productos con stock')) {
      const mas = resultado.includes('Decile que tenés más') ? '\nTengo más, si ninguno te interesa contame qué buscás.' : '';
      return responder(res, 200, completion(body.model, { content: `Esto es lo que tengo:\n${lineas.join('\n')}${mas}` }));
    }
    if (resultado.startsWith('El catálogo tiene')) {
      const otras = resultado.includes('categorías más') || resultado.includes('categoría más') ? '\nY tengo otras más.' : '';
      return responder(res, 200, completion(body.model, { content: `Tengo estas categorías:\n${lineas.join('\n')}${otras}\n¿Cuál querés ver?` }));
    }
    return responder(res, 200, completion(body.model, { content: `Listo: ${resultado}` }));
  }

  if (/^(hola|buenas|gracias)\b/.test(ultimoUsuario)) {
    return responder(res, 200, completion(body.model, { content: '¡Hola! ¿Qué estás buscando?' }));
  }
  if (ultimoUsuario.includes('cancel')) {
    return responder(res, 200, llamadaATool(body.model, 'cancelar_pedido', {}));
  }
  // Un pedido puede traer "Dirección: …" o "con envío": eso no es una consulta del local ni de envíos.
  const esCompra = ultimoUsuario.includes('quiero') || ultimoUsuario.includes('lo compro');
  if (ultimoUsuario.includes('foto')) {
    const productoId = productoDeLaUltimaBusqueda(mensajes);
    if (!productoId) return responder(res, 200, completion(body.model, { content: '¿De qué producto querés la foto?' }));
    return responder(res, 200, llamadaATool(body.model, 'enviar_imagen_producto', { productoId }));
  }
  if (!esCompra && /\b(donde queda|direccion|retir|el local)/.test(ultimoUsuario)) {
    return responder(res, 200, respuestaDelLocal(body, sistema, textoDe(mensajes[indiceUsuario])));
  }
  if (!esCompra && (ultimoUsuario.includes('envio') || ultimoUsuario.includes('envian'))) {
    return responder(res, 200, llamadaATool(body.model, 'derivar_consulta', { resumen: textoDe(mensajes[indiceUsuario]) }));
  }
  const delDueno = (body.tools ?? []).some((tool) => tool.function?.name === 'resumen_ventas');
  if (delDueno && ultimoUsuario.includes('cuanto vendi')) {
    return responder(res, 200, llamadaATool(body.model, 'resumen_ventas', { desde: diaDeBuenosAires(-6), hasta: diaDeBuenosAires() }));
  }
  if (delDueno && ultimoUsuario.includes('ventas de hoy')) {
    return responder(res, 200, llamadaATool(body.model, 'listar_ventas', { desde: diaDeBuenosAires(), hasta: diaDeBuenosAires() }));
  }
  if (/\bque (productos )?(tenes|ofreces|vendes)\b/.test(ultimoUsuario) || ultimoUsuario.includes('lista de productos')) {
    return responder(res, 200, llamadaATool(body.model, 'ver_catalogo', {}));
  }
  const categoria = textoDe(mensajes[indiceUsuario]).match(/mostrame (?:los |las )?([^?.!]+)/i)?.[1]?.trim();
  if (categoria) {
    return responder(res, 200, llamadaATool(body.model, 'ver_catalogo', { categoria }));
  }
  if (ultimoUsuario.includes('mi pedido') || ultimoUsuario.includes('pague')) {
    return responder(res, 200, llamadaATool(body.model, 'consultar_pedido', {}));
  }
  if (esCompra) {
    const texto = textoDe(mensajes[indiceUsuario]);
    const nombre = texto.match(/soy ([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)/i)?.[1];
    if (!nombre) return responder(res, 200, completion(body.model, { content: '¿A nombre de quién hago el pedido?' }));
    const varianteId = varianteDeLaUltimaBusqueda(mensajes);
    if (!varianteId) return responder(res, 200, completion(body.model, { content: '¿Qué producto querés?' }));
    const cantidad = Number(ultimoUsuario.match(/quiero (\d+)/)?.[1] ?? 1);
    const pedido = { nombreCliente: nombre, items: [{ varianteId, cantidad }] };
    if (sistema.includes(' hace envíos.')) {
      if (ultimoUsuario.includes('con envio')) pedido.entrega = 'envio';
      else if (ultimoUsuario.includes('retiro')) pedido.entrega = 'retiro';
    }
    // Sin regex: "Etiqueta: valor" separados por ";" (lo que no tiene ":" no es un dato).
    const datosCliente = texto
      .split(';')
      .filter((pieza) => pieza.includes(':'))
      .map((pieza) => ({
        campo: pieza.slice(0, pieza.indexOf(':')).trim(),
        valor: pieza.slice(pieza.indexOf(':') + 1).trim(),
      }))
      .filter((dato) => dato.campo && dato.valor);
    if (datosCliente.length > 0) pedido.datosCliente = datosCliente;
    return responder(res, 200, llamadaATool(body.model, 'crear_pedido', pedido));
  }
  return responder(res, 200, llamadaATool(body.model, 'buscar_productos', { consulta: textoDe(mensajes[indiceUsuario]) }));
}

function conversar(body, res) {
  const mensajes = body.messages ?? [];
  const sistema = textoDe(mensajes.find((mensaje) => mensaje.role === 'system'));
  if (sistema.includes('Reglas de venta de ')) {
    const indice = mensajes.findLastIndex((mensaje) => mensaje.role === 'user');
    return conversarVentas(body, res, {
      mensajes,
      sistema,
      indiceUsuario: indice,
      ultimoUsuario: normalizar(textoDe(mensajes[indice])),
      resultadoTool: mensajes.slice(indice + 1).findLast((mensaje) => mensaje.role === 'tool'),
    });
  }
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

// --- Embeddings --------------------------------------------------------------
//
// El catálogo del asistente de ventas pide embeddings (1536 dimensiones, como
// openai/text-embedding-3-small). Acá son una bolsa de palabras: cada palabra
// de 3+ letras suma 1 en una posición fija. Determinista y con geometría real,
// así la búsqueda vectorial encuentra lo que comparte palabras.

const DIMENSIONES_EMBEDDING = 1536;

function embeddingDe(texto) {
  const vector = new Array(DIMENSIONES_EMBEDDING).fill(0);
  for (const palabra of normalizar(texto).split(/[^a-z0-9ñ]+/)) {
    if (palabra.length < 3) continue;
    let hash = 0;
    for (const letra of palabra) hash = (hash * 31 + letra.charCodeAt(0)) % DIMENSIONES_EMBEDDING;
    vector[hash] += 1;
  }
  // Un texto sin palabras largas daría el vector nulo, y el coseno con él no existe.
  if (vector.every((valor) => valor === 0)) vector[0] = 1;
  return vector;
}

function embeddings(body, res) {
  const entradas = Array.isArray(body.input) ? body.input : [body.input ?? ''];
  llamadas.push({ tipo: 'embeddings', cantidad: entradas.length, model: body.model, provider: body.provider ?? null });
  return responder(res, 200, {
    object: 'list',
    model: body.model,
    data: entradas.map((texto, index) => ({ object: 'embedding', index, embedding: embeddingDe(String(texto)) })),
    usage: { prompt_tokens: entradas.length, total_tokens: entradas.length },
  });
}

// --- Decisiones (Jev) ---------------------------------------------------------
//
// La Decisions API de OpenRouter: una pregunta `choice` por pedido. Puntúa
// cada opción por las palabras que comparte con lo que escribió el cliente
// (más un poco por llegar antes, para desempatar en el orden dado), así una
// spec puede afirmar que "algo para el mate" sube la categoría Mates.

function decisiones(body, res) {
  const estado = normalizar(typeof body.state === 'string' ? body.state : JSON.stringify(body.state ?? ''));
  const palabras = new Set(estado.split(/[^a-z0-9ñ]+/).filter((palabra) => palabra.length >= 3));
  // Maps y no objetos: los ids de las preguntas y opciones llegan en el pedido.
  const respuestas = new Map();
  const opciones = new Map();
  for (const [id, pregunta] of Object.entries(body.questions ?? {})) {
    const ids = Object.keys(pregunta.criteria ?? {}).filter((opcion) => opcion !== 'none');
    opciones.set(id, ids);
    const puntajes = ids.map((opcion, indice) => {
      const texto = normalizar(String(pregunta.criteria[opcion]));
      const coincidencias = [...palabras].filter((palabra) => texto.includes(palabra.replace(/s$/, ''))).length;
      return coincidencias * 10 + (ids.length - indice) / ids.length;
    });
    const total = puntajes.reduce((suma, puntaje) => suma + puntaje, 0) || 1;
    const probabilidades = Object.fromEntries(ids.map((opcion, indice) => [opcion, puntajes[indice] / total]));
    const ganadora = ids[puntajes.indexOf(Math.max(...puntajes))] ?? 'none';
    respuestas.set(id, { type: 'choice', choice: ganadora, probabilities: { ...probabilidades, none: 0 }, confidence: 0.9 });
  }
  llamadas.push({ tipo: 'decision', model: body.model, provider: body.provider ?? null, estado, opciones: Object.fromEntries(opciones) });
  return responder(res, 200, {
    id: `gen-dec-stub-${Date.now()}`,
    model: body.model,
    provider: 'TypeSafe',
    answers: Object.fromEntries(respuestas),
    usage: { input_tokens: estado.length, output_tokens: 0, cost: 0 },
  });
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

  if (req.method === 'POST' && url.pathname === '/api/alpha/decisions') {
    let body;
    try {
      body = await leerCuerpo(req);
    } catch {
      return responder(res, 400, { error: { message: 'JSON inválido' } });
    }
    return decisiones(body, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/embeddings') {
    let body;
    try {
      body = await leerCuerpo(req);
    } catch {
      return responder(res, 400, { error: { message: 'JSON inválido' } });
    }
    return embeddings(body, res);
  }

  return responder(res, 404, { error: { message: `Ruta desconocida: ${req.method} ${url.pathname}` } });
});

servidor.listen(PUERTO, '0.0.0.0', () => {
  console.log(`OpenRouter falso escuchando en :${PUERTO}`);
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => servidor.close(() => process.exit(0)));
}
