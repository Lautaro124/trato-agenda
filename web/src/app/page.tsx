import type { ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/ui/Button";

export const metadata = {
  title: "Trato Agenda — turnos por WhatsApp, agenda en Google Calendar",
  description:
    "Trato Agenda es un asistente de WhatsApp que coordina turnos con tus clientes y los agenda directo en tu Google Calendar.",
};

const PASOS = [
  {
    numero: 1,
    titulo: "Entrás con Google",
    texto: "Tomamos tu calendario tal como está, con los horarios que ya tenés ocupados.",
  },
  {
    numero: 2,
    titulo: "Escaneás el QR",
    texto: "Vinculás tu WhatsApp en una pasada. Seguís usando el mismo número de siempre.",
  },
  {
    numero: 3,
    titulo: "Se agenda solo",
    texto: "El asistente contesta, ofrece horarios libres, confirma y recuerda el turno.",
  },
];

const BENEFICIOS = [
  {
    titulo: "Menos ida y vuelta",
    texto: "Nadie queda esperando respuesta a la noche ni el domingo. El horario se acuerda en el mismo chat, cuando el cliente escribe.",
    fondo: "bg-sunken",
    radio: "rounded-tl-[48px] rounded-tr-[20px] rounded-br-[48px] rounded-bl-[20px]",
  },
  {
    titulo: "Sin turnos perdidos",
    texto: "Recordatorio automático el día anterior y aviso si alguien cancela, así el lugar se vuelve a ofrecer.",
    fondo: "bg-accent-subtle",
    radio: "rounded-tl-[20px] rounded-tr-[48px] rounded-br-[20px] rounded-bl-[48px]",
  },
  {
    titulo: "Un solo lugar",
    texto: "Todo cae en tu Google Calendar. No hay otra agenda que mirar ni datos que pasar a mano.",
    fondo: "bg-sunken",
    radio: "rounded-tl-[48px] rounded-tr-[20px] rounded-br-[48px] rounded-bl-[20px]",
  },
];

const INCLUYE_PLAN = [
  "Turnos ilimitados y sincronización con Google Calendar",
  "Tu número de WhatsApp con el asistente respondiendo",
  "Recordatorios y avisos de cancelación, sin costo extra",
];

function Check({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-px grid size-5 flex-none place-items-center rounded-full bg-accent-subtle text-xs text-accent">
        ✓
      </span>
      <span className="text-[14.5px] leading-[1.55] text-ink">{children}</span>
    </div>
  );
}

function ChatBubble({ propio, children }: { propio?: boolean; children: ReactNode }) {
  return (
    <div
      className={
        propio
          ? "max-w-[86%] self-end rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-md bg-accent-subtle p-3 text-sm leading-[1.5] text-ink"
          : "max-w-[82%] self-start rounded-tl-2xl rounded-tr-2xl rounded-br-2xl rounded-bl-md bg-sunken p-3 text-sm leading-[1.5] text-ink"
      }
    >
      {children}
    </div>
  );
}

export default function Home() {
  return (
    <main className="overflow-hidden bg-page">
      <header className="sticky top-0 z-50 flex items-center justify-between gap-4 border-b border-line bg-page px-5 py-3.5 md:px-10">
        <Wordmark />
        <nav className="flex items-center gap-4 text-sm md:gap-7">
          <a href="#como" className="hidden text-ink-secondary sm:inline">
            Cómo funciona
          </a>
          <a href="#precio" className="hidden text-ink-secondary sm:inline">
            Precio
          </a>
          <Link href="/entrar">
            <Button size="md">Probar un mes gratis</Button>
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative px-5 pt-9 pb-14 md:px-10 md:pt-16 md:pb-20">
        <div
          aria-hidden
          className="absolute -top-36 -right-32 z-0 hidden size-[560px] rounded-[58%_42%_46%_54%/50%_46%_54%_50%] bg-primary-subtle md:block"
        />
        <div className="relative z-10 mx-auto grid max-w-[1180px] items-center gap-10 md:grid-cols-2 md:gap-14">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full bg-accent-subtle px-3.5 py-1.5 text-[13px] font-semibold text-accent">
              Un mes gratis, sin tarjeta
            </span>
            <h1 className="mt-4 mb-4 text-pretty font-display text-[34px] leading-[1.08] font-bold tracking-[-0.03em] text-ink md:text-[54px]">
              Tu agenda contesta sola por <span className="text-primary">WhatsApp</span>
            </h1>
            <p className="mb-7 max-w-[34ch] text-pretty text-[16px] leading-[1.6] text-ink-secondary md:text-[18px]">
              Tus clientes escriben, el asistente propone horarios libres y confirma el turno. Vos lo
              ves en tu Google Calendar, ya cargado.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/entrar">
                <Button size="lg">Empezar con Google</Button>
              </Link>
              <a href="#como">
                <Button size="lg" variant="secondary">
                  Ver cómo funciona
                </Button>
              </a>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-1.5 text-[13.5px] text-muted">
              <span>Listo en 3 minutos</span>
              <span>·</span>
              <span>Sin instalar nada</span>
              <span>·</span>
              <span>Cancelás cuando quieras</span>
            </div>
          </div>

          <div className="flex min-w-0 justify-center">
            <div className="w-full max-w-[380px] rounded-t-[48px] rounded-bl-[48px] rounded-br-3xl border border-line bg-card p-6 shadow-lg">
              <div className="flex items-center gap-2.5 border-b border-line pb-4">
                <span className="grid size-[34px] place-items-center rounded-full bg-accent-subtle text-sm font-bold text-accent">
                  EM
                </span>
                <div className="min-w-0">
                  <div className="font-display text-[14.5px] font-semibold text-ink">Estudio Mardel</div>
                  <div className="text-xs text-muted">respondiendo…</div>
                </div>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                <ChatBubble>Hola, ¿tenés lugar el jueves a la tarde?</ChatBubble>
                <ChatBubble propio>Sí. Jueves 16:00 o 17:30. ¿Cuál te viene mejor?</ChatBubble>
                <ChatBubble>17:30 mejor</ChatBubble>
                <ChatBubble propio>
                  Listo, te esperamos el jueves 17:30. Te mando un recordatorio el día anterior.
                </ChatBubble>
              </div>
              <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-line bg-sunken p-3">
                <span className="size-2 flex-none rounded-full bg-accent" />
                <span className="text-[12.5px] leading-[1.45] text-ink-secondary">
                  Turno cargado en tu calendario · jue 17:30
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section id="como" className="rounded-t-[48px] border-t border-line bg-card px-5 py-14 md:px-10 md:py-20">
        <div className="mx-auto max-w-[1180px]">
          <h2 className="mb-3 font-display text-[28px] leading-[1.12] font-bold tracking-[-0.03em] text-ink md:text-[38px]">
            Tres pasos y ya está andando
          </h2>
          <p className="mb-9 max-w-[46ch] text-[16px] leading-[1.6] text-ink-secondary md:mb-11">
            No hay configuración larga ni plantillas que armar. Entrás con Google, escaneás el QR y el
            asistente arranca.
          </p>
          <div className="grid gap-5 sm:grid-cols-3">
            {PASOS.map((paso) => (
              <div
                key={paso.numero}
                className="min-w-0 rounded-tl-2xl rounded-tr-2xl rounded-br-2xl rounded-bl-[40px] border border-line bg-page p-6"
              >
                <span className="grid size-[38px] place-items-center rounded-full bg-primary font-display text-base font-bold text-primary-on">
                  {paso.numero}
                </span>
                <h3 className="mt-4 mb-2 font-display text-[19px] font-semibold tracking-[-0.01em] text-ink">
                  {paso.titulo}
                </h3>
                <p className="text-pretty text-[14.5px] leading-[1.6] text-ink-secondary">{paso.texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Beneficios */}
      <section className="bg-card px-5 py-14 md:px-10 md:py-20">
        <div className="mx-auto grid max-w-[1180px] gap-5 sm:grid-cols-3">
          {BENEFICIOS.map((b) => (
            <div key={b.titulo} className={`min-w-0 border border-line p-7 md:p-9 ${b.fondo} ${b.radio}`}>
              <h3 className="mb-2.5 font-display text-[22px] leading-[1.16] font-bold tracking-[-0.02em] text-ink md:text-[26px]">
                {b.titulo}
              </h3>
              <p className="text-pretty text-[15px] leading-[1.6] text-ink-secondary">{b.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Precio */}
      <section
        id="precio"
        className="rounded-b-[48px] border-b border-line bg-card px-5 py-14 md:px-10 md:py-20"
      >
        <div className="mx-auto max-w-[640px] text-center">
          <h2 className="mb-3 font-display text-[28px] leading-[1.12] font-bold tracking-[-0.03em] text-ink md:text-[38px]">
            Un precio y nada más
          </h2>
          <p className="mb-7 text-[16px] leading-[1.6] text-ink-secondary">
            Probás un mes completo gratis. Si te sirve, seguís.
          </p>
          <div className="rounded-[36px] border border-line-strong bg-page p-7 text-left shadow-md md:p-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="font-display text-[38px] leading-none font-bold tracking-[-0.03em] text-ink md:text-[46px]">
                  $20.000
                </div>
                <div className="mt-1.5 text-sm text-muted">por mes · después del mes gratis</div>
              </div>
              <Link href="/entrar">
                <Button size="lg">Empezar gratis</Button>
              </Link>
            </div>
            <div className="mt-6 flex flex-col gap-2.5 border-t border-line pt-6">
              {INCLUYE_PLAN.map((texto) => (
                <Check key={texto}>{texto}</Check>
              ))}
            </div>
            <p className="mt-5 text-[13px] leading-[1.6] text-muted">
              No te pedimos tarjeta para la prueba. Te avisamos 7 días antes de que termine.
            </p>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="px-5 py-14 md:px-10 md:py-20">
        <div className="mx-auto grid max-w-[1180px] items-center gap-7 rounded-tl-[48px] rounded-tr-3xl rounded-br-[48px] rounded-bl-3xl bg-[var(--color-primitive-neutral-900)] p-8 md:grid-cols-2 md:p-14">
          <div className="min-w-0">
            <h2 className="mb-3 text-pretty font-display text-[28px] leading-[1.08] font-bold tracking-[-0.03em] text-white md:text-[40px]">
              Que tu agenda trabaje mientras vos atendés
            </h2>
            <p className="max-w-[40ch] text-pretty text-[16px] leading-[1.6] text-white/85">
              Entrás con Google, escaneás el QR y esta misma semana los turnos se cargan solos.
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-3">
            <Link href="/entrar">
              <Button size="lg">Empezar con Google</Button>
            </Link>
            <a
              href="#como"
              className="inline-flex items-center rounded-md border border-white/28 px-5 py-3.5 text-[16px] font-semibold text-white"
            >
              Ver cómo funciona
            </a>
          </div>
        </div>
      </section>

      <footer className="px-5 pb-11 md:px-10">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-[13.5px] text-muted">
          <span className="font-display text-[15px] font-bold text-ink">Trato Agenda</span>
          <div className="flex flex-wrap gap-4">
            <a href="#precio" className="text-muted">
              Precio
            </a>
            <a href="#como" className="text-muted">
              Cómo funciona
            </a>
            <Link href="/privacidad" className="text-muted">
              Privacidad
            </Link>
            <Link href="/terminos" className="text-muted">
              Términos
            </Link>
            <a href="mailto:lautaro.gonzalez4949@gmail.com" className="text-muted">
              Ayuda
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
