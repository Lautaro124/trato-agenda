import Link from "next/link";

export const metadata = {
  title: "Términos de servicio — Trato Agenda",
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
        <p className="text-[12.5px] text-muted">Última actualización: 9 de septiembre de 2026</p>

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
            Al conectar tu cuenta nos das permiso para leer y escribir eventos en tu Google Calendar,
            únicamente para el funcionamiento del asistente. Podés revocar ese permiso en cualquier
            momento desde la configuración de tu cuenta de Google; al hacerlo, el asistente deja de poder
            operar tu agenda.
          </p>
        </Seccion>

        <Seccion titulo="Cambios y baja del servicio">
          <p>
            Podemos actualizar estos términos o el servicio con el tiempo; los cambios importantes se
            publican en esta página. Podés pedir la baja completa de tu cuenta y tus datos escribiendo a{" "}
            <a href="mailto:lautaro.gonzalez4949@gmail.com" className="text-link">
              lautaro.gonzalez4949@gmail.com
            </a>
            .
          </p>
        </Seccion>

        <Seccion titulo="Ley aplicable">
          <p>Estos términos se rigen por las leyes de la República Argentina.</p>
        </Seccion>
      </div>
    </main>
  );
}
