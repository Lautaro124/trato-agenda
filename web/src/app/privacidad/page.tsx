import Link from "next/link";
import { FooterLegal } from "@/components/FooterLegal";
import { CUIT, EMAIL_SOPORTE, RESPONSABLE } from "@/lib/contacto";

export const metadata = {
  title: "Privacidad — Trato Agenda",
  description:
    "Qué datos trata Trato Agenda, cómo los protege, cuánto los conserva y cómo cumple la Google API Services User Data Policy, incluido el requisito de Limited Use.",
};

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 font-display text-[16px] font-semibold text-ink">{titulo}</h2>
      <div className="space-y-2.5 text-[13.5px] leading-[1.65] text-ink-secondary">{children}</div>
    </section>
  );
}

function Punto({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary" />
      <span>{children}</span>
    </li>
  );
}

function Lista({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col gap-2">{children}</ul>;
}

function Fuerte({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}

function Scope({ children }: { children: React.ReactNode }) {
  return (
    <code className="break-all rounded-[4px] bg-sunken px-1 py-0.5 text-[12px] text-ink">
      {children}
    </code>
  );
}

export default function PrivacidadPage() {
  return (
    <main className="min-h-dvh bg-page p-5 md:p-10">
      <div className="mx-auto w-full max-w-[680px] rounded-md border border-line bg-card p-6 shadow-md md:p-8">
        <Link href="/" className="text-[13px] text-link">
          ← Trato Agenda
        </Link>

        <h1 className="mt-4 mb-1 font-display text-[24px] font-bold tracking-[-0.02em] text-ink">
          Política de privacidad
        </h1>
        <p className="text-[12.5px] text-muted">Última actualización: 12 de septiembre de 2026</p>

        <Seccion titulo="Quiénes somos y cómo contactarnos">
          <p>
            Trato Agenda es un servicio que conecta tu cuenta de Google Calendar con un asistente de
            WhatsApp para coordinar turnos con tus clientes. Se opera desde la República Argentina y
            está disponible en{" "}
            <a href="https://tratoagenda.com" className="text-link">
              tratoagenda.com
            </a>
            .
          </p>
          <p>
            El responsable del tratamiento de los datos que se describen acá es{" "}
            <Fuerte>
              {RESPONSABLE}, CUIT {CUIT}
            </Fuerte>
            , con domicilio en la República Argentina. Para cualquier consulta, pedido de acceso o
            baja, escribinos a{" "}
            <a href={`mailto:${EMAIL_SOPORTE}`} className="text-link">
              {EMAIL_SOPORTE}
            </a>
            .
          </p>
        </Seccion>

        <Seccion titulo="Qué datos recopilamos">
          <p>
            <Fuerte>De tu cuenta de Google.</Fuerte> Al entrar con Google te pedimos estos permisos, y
            ninguno más:
          </p>
          <Lista>
            <Punto>
              <Scope>openid</Scope>, <Scope>email</Scope> y <Scope>profile</Scope>: tu identificador de
              Google, tu email, tu nombre y tu foto de perfil. Sirven para crear tu cuenta,
              reconocerte cuando volvés y mostrarte quién está conectado.
            </Punto>
            <Punto>
              <Scope>https://www.googleapis.com/auth/calendar.events</Scope>: crear, mover y cancelar
              los turnos que el asistente acuerda con tus clientes, y listarte tus eventos en tu propio
              panel.
            </Punto>
            <Punto>
              <Scope>https://www.googleapis.com/auth/calendar.freebusy</Scope>: leer los bloques
              ocupado/libre de tu calendario para saber cuándo podés atender.
            </Punto>
          </Lista>
          <p>
            <Fuerte>De WhatsApp.</Fuerte> El número que vinculás, y de cada persona que le escribe a tu
            asistente: su número, el texto de los mensajes que intercambia con el asistente, el nombre
            que da para agendar y un resumen breve de lo que pidió. Es lo que le permite coordinar los
            turnos y lo que ves en el historial de tu panel.
          </p>
          <p>
            <Fuerte>De pagos.</Fuerte> Si activás la suscripción, el cobro lo procesa Mercado Pago.
            Guardamos el identificador de la suscripción y su estado. <Fuerte>Ningún dato de tarjeta
            pasa por nuestros sistemas</Fuerte>: no lo recibimos ni lo almacenamos.
          </p>
        </Seccion>

        <Seccion titulo="Para qué usamos cada dato">
          <p>
            Usamos tus datos únicamente para hacer funcionar el servicio que contrataste: coordinar
            turnos por WhatsApp y reflejarlos en tu calendario. No hacemos publicidad, no hacemos
            perfilado con fines comerciales y no vendemos datos a nadie.
          </p>
          <p>
            <Fuerte>De tu calendario leemos lo mínimo.</Fuerte> Para calcular tu disponibilidad
            consultamos la API de free/busy de Google, que devuelve solamente rangos de horario
            ocupado y libre. <Fuerte>No leemos los títulos, las descripciones, los invitados, los
            correos de los invitados ni las ubicaciones de tus eventos</Fuerte>, con una sola
            excepción: cuando vos, desde tu panel ya autenticado, pedís ver tu agenda, listamos tus
            eventos con su título y horario para mostrártelos.
          </p>
          <p>
            Los eventos que el asistente crea en tu calendario llevan como título el tipo de turno y el
            nombre de la persona, para que puedas reconocerlos de un vistazo.
          </p>
        </Seccion>

        <Seccion titulo="Uso de inteligencia artificial">
          <p>
            El asistente que responde por WhatsApp funciona con un modelo de lenguaje al que accedemos
            a través de <Fuerte>OpenRouter</Fuerte> (endpoint{" "}
            <Scope>https://openrouter.ai/api/v1</Scope>), en su plan de pago por uso. Queremos ser
            precisos sobre qué llega a ese modelo y qué no.
          </p>
          <p>
            <Fuerte>Qué se le manda:</Fuerte> la configuración de tu negocio que cargaste en el alta
            (nombre, tipos de turno, franja horaria, nombre del asistente), los rangos de horario libre
            derivados de tu calendario —sólo horarios, sin contenido de eventos—, y la conversación de
            WhatsApp con tu cliente.
          </p>
          <p>
            <Fuerte>Qué no se le manda:</Fuerte> el contenido de los eventos de tu Google Calendar. En
            el flujo con tus clientes el modelo nunca recibe títulos, descripciones, invitados ni
            ubicaciones. Tampoco recibe tu email, tu nombre de Google, tu foto de perfil ni tus
            credenciales de acceso. Cuando vos mismo pedís ver tu agenda desde tu panel, el título y el
            horario de tus eventos sí pasan por el modelo para poder resumírtelos; eso ocurre sólo en
            tu propia sesión autenticada y sobre tu propio calendario.
          </p>
          <p>
            <Fuerte>No entrenamos modelos con tus datos.</Fuerte> No usamos datos de usuario —ni de
            Google ni de WhatsApp— para crear, entrenar, ajustar ni mejorar ningún modelo de
            inteligencia artificial, y no transferimos datos crudos, agregados, anonimizados ni
            derivados a terceros para que entrenen los suyos.
          </p>
          <p>
            <Fuerte>Configuración de no retención.</Fuerte> Cada llamada al modelo viaja con{" "}
            <Scope>data_collection: &quot;deny&quot;</Scope> y <Scope>zdr: true</Scope>, dos opciones de
            OpenRouter que limitan el ruteo a proveedores que no guardan los prompts y que, por lo
            tanto, no pueden entrenar con ellos (Zero Data Retention). La misma restricción está
            activada a nivel de cuenta. No usamos modelos autohospedados.
          </p>
        </Seccion>

        <Seccion titulo="Cómo protegemos tus datos">
          <Lista>
            <Punto>
              El token que nos da acceso a tu calendario se guarda{" "}
              <Fuerte>cifrado con AES-256-GCM</Fuerte>, con un vector de inicialización distinto por
              registro y etiqueta de autenticación, así que cualquier manipulación se detecta. La clave
              de 256 bits vive en una variable de entorno del servidor y nunca está en el código.
            </Punto>
            <Punto>
              Ese token <Fuerte>nunca sale de nuestro backend</Fuerte>: no se expone al navegador, no
              viaja en ninguna respuesta de la API y no queda guardado en el estado de las
              conversaciones.
            </Punto>
            <Punto>
              Las credenciales de tu sesión de WhatsApp se guardan con el mismo cifrado AES-256-GCM.
            </Punto>
            <Punto>
              Todo el tráfico va cifrado en tránsito con HTTPS/TLS, tanto entre tu navegador y
              nosotros como entre nosotros y cada proveedor.
            </Punto>
            <Punto>
              Tu sesión vive en una cookie <Scope>httpOnly</Scope> + <Scope>secure</Scope> que
              JavaScript no puede leer, con un token firmado que sólo contiene tu identificador y tu
              email. Vence a los 7 días.
            </Punto>
            <Punto>
              La API sólo acepta pedidos del sitio de Trato Agenda (CORS restringido a un único origen)
              y rechaza cualquier operación que cambie datos si no viene de ahí, como defensa contra
              CSRF.
            </Punto>
            <Punto>
              Las notificaciones de pago se verifican con firma HMAC antes de tocar nada, y se
              reconsulta el estado real a Mercado Pago en lugar de confiar en el contenido recibido.
            </Punto>
            <Punto>
              Pedimos a Google el permiso más chico que alcanza para que el asistente funcione. Si un
              permiso deja de ser necesario, lo sacamos.
            </Punto>
            <Punto>
              No registramos en nuestros logs el texto de los mensajes, el contenido de tus eventos ni
              tus credenciales.
            </Punto>
          </Lista>
        </Seccion>

        <Seccion titulo="Con quién compartimos datos">
          <p>
            Sólo con los proveedores necesarios para prestar el servicio, y sólo con lo que cada uno
            necesita. Ninguno puede usar tus datos para fines propios ajenos a procesar nuestra
            solicitud.
          </p>
          <Lista>
            <Punto>
              <Fuerte>Google</Fuerte> (Calendar): la lectura de disponibilidad y la creación, edición y
              borrado de los eventos de tus turnos.
            </Punto>
            <Punto>
              <Fuerte>OpenRouter</Fuerte> y el proveedor del modelo que rutea: lo descrito en la
              sección de inteligencia artificial, con no retención y no entrenamiento exigidos en cada
              llamada.
            </Punto>
            <Punto>
              <Fuerte>WhatsApp (Meta)</Fuerte>: es la red por la que viajan los mensajes entre tus
              clientes y tu asistente.
            </Punto>
            <Punto>
              <Fuerte>Mercado Pago</Fuerte>: el cobro de la suscripción. Es quien maneja los datos de
              pago; nosotros no los vemos.
            </Punto>
            <Punto>
              <Fuerte>Railway</Fuerte>: la infraestructura donde corren la aplicación y la base de
              datos.
            </Punto>
          </Lista>
          <p>
            También podríamos tener que compartir datos si nos lo exige una autoridad competente por
            una vía legal válida.
          </p>
        </Seccion>

        <Seccion titulo="Cuánto tiempo conservamos tus datos">
          <Lista>
            <Punto>
              <Fuerte>Mensajes de WhatsApp:</Fuerte> se borran a los 90 días de que la conversación
              quedó inactiva, junto con el estado interno de esa conversación.
            </Punto>
            <Punto>
              <Fuerte>Nombre y resumen de un cliente:</Fuerte> se borran a los 12 meses de inactividad
              de esa conversación.
            </Punto>
            <Punto>
              <Fuerte>Turnos:</Fuerte> se conservan mientras tu cuenta exista, porque son el registro
              de tu agenda.
            </Punto>
            <Punto>
              <Fuerte>Tu cuenta:</Fuerte> mientras la tengas abierta.
            </Punto>
          </Lista>
        </Seccion>

        <Seccion titulo="Cómo borrar tu cuenta y tus datos">
          <p>
            Podés borrar todo vos mismo, sin escribirnos: en la aplicación, en{" "}
            <Fuerte>Cuenta → Eliminar mi cuenta</Fuerte>. Cuando lo hacés, en el mismo momento:
          </p>
          <Lista>
            <Punto>
              <Fuerte>Revocamos en Google</Fuerte> el acceso que nos habías dado, así que dejamos de
              poder ver o tocar tu calendario.
            </Punto>
            <Punto>
              Cerramos tu sesión de WhatsApp y borramos sus credenciales.
            </Punto>
            <Punto>
              Borramos tu usuario, tu asistente, tus conversaciones, los mensajes, los turnos, el
              estado interno de las conversaciones y tu suscripción. Si había un cobro activo, lo
              cancelamos.
            </Punto>
          </Lista>
          <p>
            Se borra de inmediato de nuestra base de datos. Si algo quedara en una copia de seguridad
            del proveedor de infraestructura, desaparece con la rotación normal de esas copias, dentro
            de 30 días.
          </p>
          <p>
            <Fuerte>Los eventos que ya están en tu Google Calendar no los borramos</Fuerte>: son
            eventos de tu calendario y quedan ahí, bajo tu control. Si querés que se vayan, borralos
            desde Google antes o después de darte de baja.
          </p>
        </Seccion>

        <Seccion titulo="Tus derechos">
          <p>
            Podés pedirnos acceder a tus datos, corregirlos o eliminarlos, y podés revocar el acceso a
            tu Google Calendar en cualquier momento desde{" "}
            <a
              href="https://myaccount.google.com/permissions"
              className="text-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              la configuración de tu cuenta de Google
            </a>
            . Si lo revocás sin darte de baja, el asistente deja de poder operar tu agenda y te vamos a
            pedir que vuelvas a conectarla.
          </p>
          <p>
            Para cualquier pedido, escribinos a{" "}
            <a href={`mailto:${EMAIL_SOPORTE}`} className="text-link">
              {EMAIL_SOPORTE}
            </a>
            . Si sos cliente de alguien que usa Trato Agenda y querés que borremos tus mensajes,
            escribinos igual y lo resolvemos.
          </p>
        </Seccion>

        <Seccion titulo="Cumplimiento de la política de datos de Google">
          <p>
            El uso que hacemos de los datos obtenidos de las APIs de Google se rige por la{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="text-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , incluidos sus requisitos de Limited Use. En los términos exactos de Google:
          </p>
          <blockquote className="border-l-2 border-line pl-3.5 text-[13px] italic">
            Trato Agenda&apos;s use of information received from Google APIs will adhere to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="text-link not-italic"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. The use of raw or derived user data received from
            Workspace APIs will adhere to the Google User Data Policy, including the Limited Use
            requirements.
          </blockquote>
          <p>
            En concreto: usamos los datos de tu Google Calendar sólo para darte las funciones que ves
            en la aplicación, no los transferimos a nadie más allá de los proveedores listados arriba,
            no los usamos para publicidad, no los usamos para entrenar modelos de inteligencia
            artificial y ninguna persona los lee, salvo que vos nos lo pidas para resolver un problema,
            que lo exija la ley, o que sea necesario por seguridad.
          </p>
        </Seccion>

        <Seccion titulo="Menores de edad">
          <p>
            El servicio está pensado para personas que atienden clientes y no está dirigido a menores
            de 18 años. No recopilamos datos de menores a sabiendas; si nos enteramos de que pasó, los
            borramos.
          </p>
        </Seccion>

        <Seccion titulo="Ley aplicable">
          <p>
            Esta política y el tratamiento de los datos se rigen por las leyes de la República
            Argentina, incluida la Ley 25.326 de Protección de los Datos Personales.
          </p>
        </Seccion>

        <Seccion titulo="Cambios a esta política">
          <p>
            Si cambiamos algo relevante, lo vamos a publicar en esta misma página con la fecha
            actualizada. Si el cambio afecta a qué datos tratamos o para qué, te lo vamos a avisar en
            la aplicación.
          </p>
        </Seccion>

        <FooterLegal className="mt-9" />
      </div>
    </main>
  );
}
