import Link from "next/link";

export const metadata = {
  title: "Privacidad — Trato Agenda",
};

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 font-display text-[16px] font-semibold text-ink">{titulo}</h2>
      <div className="space-y-2.5 text-[13.5px] leading-[1.65] text-ink-secondary">{children}</div>
    </section>
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
        <p className="text-[12.5px] text-muted">Última actualización: 9 de septiembre de 2026</p>

        <Seccion titulo="Quiénes somos">
          <p>
            Trato Agenda es un servicio que conecta tu cuenta de Google Calendar con un asistente de
            WhatsApp para gestionar turnos. Esta política explica qué datos tratamos y para qué.
          </p>
        </Seccion>

        <Seccion titulo="Qué datos recopilamos">
          <p>
            <strong className="font-semibold text-ink">De tu cuenta de Google:</strong> nombre, email y
            foto de perfil al iniciar sesión, y acceso a tu Google Calendar (lectura y escritura de
            eventos) mediante el permiso que autorizás en el login. Ese acceso se usa exclusivamente para
            consultar tu disponibilidad y crear, mover o cancelar turnos que vos o tus clientes acuerden.
          </p>
          <p>
            <strong className="font-semibold text-ink">De WhatsApp:</strong> tu número vinculado y los
            mensajes que tu asistente intercambia con tus clientes, para que pueda coordinar los turnos y
            para que puedas revisar ese historial en tu panel.
          </p>
          <p>
            <strong className="font-semibold text-ink">De pagos:</strong> si activás una suscripción, el
            cobro lo procesa Mercado Pago. Nosotros no recibimos ni almacenamos datos de tarjeta.
          </p>
        </Seccion>

        <Seccion titulo="Cómo usamos tus datos">
          <p>
            El contenido de tus mensajes de WhatsApp se envía a un proveedor de modelos de lenguaje
            (a través de OpenRouter) para generar las respuestas del asistente y decidir qué turnos crear
            o modificar. No usamos tus datos para entrenar modelos ni los vendemos a terceros.
          </p>
          <p>
            El token de acceso a tu Google Calendar se guarda cifrado (AES-256-GCM) y nunca se expone al
            navegador ni a otros usuarios.
          </p>
        </Seccion>

        <Seccion titulo="Con quién compartimos datos">
          <p>
            Solo con los proveedores necesarios para prestar el servicio: Google (Calendar), el proveedor
            del modelo de lenguaje vía OpenRouter, y Mercado Pago para los cobros. Ninguno de ellos puede
            usar tus datos para fines propios ajenos a procesar tu solicitud.
          </p>
        </Seccion>

        <Seccion titulo="Cuánto tiempo conservamos tus datos">
          <p>
            Mientras tu cuenta esté activa. Si pedís la baja, eliminamos tu agente, el historial de
            conversaciones y revocamos el acceso a tu Google Calendar en un plazo razonable.
          </p>
        </Seccion>

        <Seccion titulo="Tus derechos">
          <p>
            Podés pedirnos acceder, corregir o eliminar tus datos, y revocar el acceso a tu Google
            Calendar en cualquier momento desde{" "}
            <a
              href="https://myaccount.google.com/permissions"
              className="text-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              la configuración de tu cuenta de Google
            </a>
            . Para cualquier pedido, escribinos a{" "}
            <a href="mailto:lautaro.gonzalez4949@gmail.com" className="text-link">
              lautaro.gonzalez4949@gmail.com
            </a>
            .
          </p>
        </Seccion>

        <Seccion titulo="Cambios a esta política">
          <p>
            Si cambiamos algo relevante, lo vamos a publicar en esta misma página con la fecha
            actualizada.
          </p>
        </Seccion>
      </div>
    </main>
  );
}
