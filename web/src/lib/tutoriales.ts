import type { Usuario } from "./session";

/** Copia de TUTORIALES en api/src/auth/tutoriales.ts: mantenerlas sincronizadas. */
export const CLAVES_TUTORIAL = [
  "inicio",
  "calendario",
  "reuniones",
  "chat",
  "productos",
  "costos",
  "ventas",
  "rendimiento",
  "asistente",
  "plan",
] as const;

export type ClaveTutorial = (typeof CLAVES_TUTORIAL)[number];

/**
 * Un paso del recorrido. `objetivo` es el valor de `data-tutorial` del
 * elemento a resaltar (puede estar en más de uno, como la navegación de
 * escritorio y la de celular: se usa el que está a la vista). Sin objetivo, el
 * paso es una tarjeta centrada.
 */
export type Paso = { objetivo?: string; titulo: string; texto: string };

const NAVEGACION: Paso = {
  objetivo: "navegacion",
  titulo: "Tus pantallas",
  texto: "Desde acá pasás de una pantalla a otra. La primera vez que abras cada una te mostramos qué podés hacer ahí.",
};

const CHAT_DE_PRUEBA: Paso = {
  objetivo: "chat-prueba",
  titulo: "Probá a tu asistente",
  texto: "Escribile como si fueras un cliente y fijate cómo responde antes de que le escriba alguien de verdad.",
};

function pasosInicio(user: Usuario): Paso[] {
  const ventas = user.tipoAsistente === "ventas";
  return [
    {
      titulo: "Te damos la bienvenida a Trato",
      texto:
        "En un minuto te mostramos dónde está cada cosa. Si lo salteás, lo podés volver a ver cuando quieras desde tu menú, en «Ver tutorial».",
    },
    NAVEGACION,
    {
      objetivo: "resumen",
      titulo: ventas ? "Tu tienda" : "Tu día",
      texto: ventas
        ? "Los pasos que faltan para que tu asistente quede listo para vender."
        : "Los turnos de hoy y cuántos tenés en la semana, con los que agenda tu asistente incluidos.",
    },
    CHAT_DE_PRUEBA,
    {
      objetivo: "estado-asistente",
      titulo: "Si está atendiendo",
      texto: "Te muestra si tu asistente responde ahora y, si no, por qué: fuera de horario, plan vencido o WhatsApp sin vincular.",
    },
    {
      objetivo: "notificaciones",
      titulo: "Avisos",
      texto: "Te avisamos acá cuando pasa algo que necesita tu atención.",
    },
    {
      objetivo: "menu-usuario",
      titulo: "Tu cuenta",
      texto: "La vinculación de WhatsApp, los datos de tu cuenta y este tutorial, para volver a verlo en cualquier pantalla.",
    },
  ];
}

const PASOS: Record<Exclude<ClaveTutorial, "inicio">, Paso[]> = {
  calendario: [
    {
      objetivo: "agenda",
      titulo: "Tu agenda",
      texto: "En coral, lo que agendó tu asistente; en gris, lo que cargaste vos. Tocá un evento para ver el detalle.",
    },
    {
      objetivo: "controles-agenda",
      titulo: "Moverte por la agenda",
      texto: "Cambiá de semana con las flechas, volvé a hoy y sumá un evento a mano.",
    },
  ],
  reuniones: [
    {
      objetivo: "tipos-reunion",
      titulo: "Lo que ofrece tu asistente",
      texto: "Cada tipo de reunión con su duración y, si querés, su precio. Las grupales tienen cupo y horarios fijos.",
    },
    {
      objetivo: "guardar-reuniones",
      titulo: "Guardá los cambios",
      texto: "Tu asistente los usa desde el próximo mensaje. Los turnos que ya están agendados no cambian.",
    },
  ],
  chat: [CHAT_DE_PRUEBA],
  productos: [
    {
      objetivo: "cargar-productos",
      titulo: "Cargá tu catálogo",
      texto: "De a uno, o todos juntos desde una planilla o un enlace a tu tienda. Tu asistente vende sólo lo que está acá.",
    },
    {
      objetivo: "buscar-productos",
      titulo: "Buscá y filtrá",
      texto: "Encontrá un producto por nombre, código o categoría para editar su precio, stock o fotos.",
    },
    {
      objetivo: "herramientas-catalogo",
      titulo: "Probá y promocioná",
      texto: "Fijate qué encuentra tu asistente cuando un cliente pregunta algo, y armá promociones por producto o categoría.",
    },
  ],
  costos: [
    {
      objetivo: "insumos",
      titulo: "Tus materiales",
      texto: "Lo que te cuesta cada material. Con esto y la receta de cada producto a medida se calcula el presupuesto.",
    },
    {
      objetivo: "config-cotizacion",
      titulo: "Cómo cotiza",
      texto: "Lo que se suma a cada presupuesto. La cuenta la hace el sistema: tu asistente nunca inventa un precio.",
    },
  ],
  ventas: [
    {
      objetivo: "te-esperan",
      titulo: "Clientes que te esperan",
      texto: "Chats que atendés vos: tu asistente no contesta ahí hasta que se los devuelvas.",
    },
    {
      objetivo: "filtros-ventas",
      titulo: "Elegí el período",
      texto: "Los totales, el gráfico y los pedidos de abajo se calculan con las fechas que elijas.",
    },
    {
      objetivo: "exportar-ventas",
      titulo: "Llevátelo",
      texto: "Descargá los pedidos del período en una planilla CSV.",
    },
  ],
  rendimiento: [
    {
      titulo: "Cómo les va a tus productos",
      texto: "Cuántos chats llegan a pedir y a pagar, y en qué etapa se quedan los que no compran.",
    },
    {
      objetivo: "filtros-rendimiento",
      titulo: "Elegí qué mirar",
      texto: "Cambiá el período, la zona y la moneda. Se compara solo con el período anterior.",
    },
  ],
  asistente: [
    {
      objetivo: "lista-mensajes",
      titulo: "Los mensajes de tu asistente",
      texto: "Elegí uno para ver cómo lo dice. Los que dejes en automático los redacta él según cada charla.",
    },
    {
      objetivo: "editor-mensaje",
      titulo: "Escribilo vos",
      texto: "Si querés un texto fijo, escribilo acá. Las reglas de tu negocio (horarios, stock, precios) se respetan igual.",
    },
    {
      objetivo: "vista-previa-mensaje",
      titulo: "Cómo le llega al cliente",
      texto: "La vista previa se actualiza mientras escribís. Acordate de guardar los cambios.",
    },
  ],
  plan: [
    {
      titulo: "Tu plan",
      texto:
        "Acá ves cuánto te queda de prueba o cuándo se renueva tu plan, y lo cambiás o cancelás. Los pagos van por Mercado Pago.",
    },
  ],
};

export function pasosDe(clave: ClaveTutorial, user: Usuario): Paso[] {
  return clave === "inicio" ? pasosInicio(user) : PASOS[clave];
}
