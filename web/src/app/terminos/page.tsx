import Link from "next/link";
import { FooterLegal } from "@/components/FooterLegal";
import { CUIT, EMAIL_SOPORTE, RESPONSABLE } from "@/lib/contacto";

export const metadata = {
  title: "Términos de servicio — Trato Agenda",
  description:
    "Condiciones de uso de Trato Agenda: el servicio, la prueba gratuita, la suscripción, el alcance del permiso sobre tu Google Calendar y cómo darte de baja.",
};

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 font-display text-[16px] font-semibold text-ink">{titulo}</h2>
      <div className="space-y-2.5 text-[13.5px] leading-[1.65] text-ink-secondary">{children}</div>
    </section>
  );
}

export default function TerminosPage() {
  return (
    <main className="min-h-dvh bg-page p-5 md:p-10">
      <div className="mx-auto w-full max-w-[680px] rounded-md border border-line bg-card p-6 shadow-md md:p-8">
        <Link href="/" className="text-[13px] text-link">
          ← Trato Agenda
        </Link>

        <h1 className="mt-4 mb-1 font-display text-[24px] font-bold tracking-[-0.02em] text-ink">
          Términos de servicio
        </h1>
        <p className="text-[12.5px] text-muted">Última actualización: 12 de septiembre de 2026</p>

        <Seccion titulo="El servicio">
          <p>
            Trato Agenda te da un asistente de WhatsApp que coordina turnos con tus clientes usando tu
            Google Calendar: consulta tu disponibilidad y crea, mueve o cancela eventos según lo que
            acuerde con la persona que te escribe.
          </p>
        </Seccion>

        <Seccion titulo="Prueba gratuita y suscripción">
          <p>
            Al iniciar sesión con Google arranca automáticamente un período de prueba de 30 días con
            acceso completo, sin pedirte tarjeta. Pasado ese plazo, para que el asistente siga respondiendo
            en WhatsApp necesitás activar la suscripción paga; el resto de la aplicación (tu agenda, el
            calendario, el historial) sigue disponible igual.
          </p>
          <p>
            Los cobros los procesa Mercado Pago. Podés cancelar la suscripción cuando quieras; el acceso
            pago se mantiene hasta el final del período ya abonado.
          </p>
        </Seccion>

        <Seccion titulo="Responsabilidad sobre los turnos">
          <p>
            El asistente responde de forma automática usando un modelo de lenguaje. Puede cometer errores
            de interpretación en casos ambiguos. Sos responsable de revisar tu agenda y confirmar con tus
            clientes los turnos que te resulten críticos. No garantizamos que cada intercambio se
            interprete exactamente como lo esperás.
          </p>
        </Seccion>

        <Seccion titulo="Uso aceptable">
          <p>
            No uses el servicio para enviar contenido ilegal, spam masivo, ni para fines distintos a
            coordinar turnos con tus propios clientes. Nos reservamos el derecho de suspender cuentas que
            hagan un uso indebido de WhatsApp o de la API de Google.
          </p>
        </Seccion>

        <Seccion titulo="Tu cuenta de Google">
          <p>
            Al conectar tu cuenta nos das dos permisos sobre tu calendario, y sólo esos:{" "}
            <code className="rounded-[4px] bg-sunken px-1 py-0.5 text-[12px] break-all text-ink">
              calendar.events
            </code>{" "}
            para crear, mover, cancelar y listar eventos, y{" "}
            <code className="rounded-[4px] bg-sunken px-1 py-0.5 text-[12px] break-all text-ink">
              calendar.freebusy
            </code>{" "}
            para ver qué horarios tenés ocupados. Se usan únicamente para el funcionamiento del
            asistente.
          </p>
          <p>
            Podés revocar ese permiso en cualquier momento desde{" "}
            <a
              href="https://myaccount.google.com/permissions"
              className="text-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              la configuración de tu cuenta de Google
            </a>
            ; al hacerlo, el asistente deja de poder operar tu agenda. El detalle de qué leemos y qué
            no está en la{" "}
            <Link href="/privacidad" className="text-link">
              política de privacidad
            </Link>
            .
          </p>
        </Seccion>

        <Seccion titulo="Cambios y baja del servicio">
          <p>
            Podemos actualizar estos términos o el servicio con el tiempo; los cambios importantes se
            publican en esta página.
          </p>
          <p>
            Podés borrar tu cuenta y todos tus datos vos mismo, desde <strong className="font-semibold text-ink">Cuenta → Eliminar mi cuenta</strong>{" "}
            en la aplicación: eso revoca el acceso a tu Google Calendar y borra todo, sin pasar por
            nosotros. Si preferís que lo hagamos, escribinos a{" "}
            <a href={`mailto:${EMAIL_SOPORTE}`} className="text-link">
              {EMAIL_SOPORTE}
            </a>
            .
          </p>
        </Seccion>

        <Seccion titulo="Quién presta el servicio y ley aplicable">
          <p>
            Trato Agenda lo presta{" "}
            <strong className="font-semibold text-ink">
              {RESPONSABLE}, CUIT {CUIT}
            </strong>
            , desde la República Argentina. Estos términos se rigen por las leyes argentinas.
          </p>
        </Seccion>

        <FooterLegal className="mt-9" />
      </div>
    </main>
  );
}
