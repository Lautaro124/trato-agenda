"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { AYUDA_POR_PASO, type Onboarding } from "@/app/contanos/useOnboarding";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  AgregarEvento,
  CampoBot,
  CampoNombreTitular,
  ChipsTitular,
  EmpezarCon,
  ListaEventos,
  PrecioParaTodos,
  PresetsFranja,
  SelectoresFranja,
  TextoRango,
  textoFinal,
} from "./controles";
import { ElegirAsistente, ICONO_BOLSA } from "./ElegirAsistente";
import { VistaPreviaChat } from "./VistaPreviaChat";

const TILDE = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/** Riel de escritorio: los pasos del asistente elegido. Los hechos se tocan para volver. */
function RielPasos({ ob }: { ob: Onboarding }) {
  return (
    <aside className="hidden w-[248px] flex-none flex-col gap-5 border-r border-line bg-sunken px-[18px] py-7 md:flex">
      <div className="px-2">
        <p className="text-[11px] font-bold tracking-[0.08em] text-muted uppercase">Creá tu asistente</p>
        <p className="mt-1.5 font-display text-[20px] font-bold tracking-[-0.02em] text-ink">Contanos de vos</p>
      </div>

      <ol className="flex flex-col gap-1">
        {ob.pasos.map((paso, i) => {
          if (i < ob.paso) {
            const resumen = ob.resumenes[paso.id];
            return (
              <li key={paso.id}>
                <button
                  type="button"
                  onClick={() => ob.setPaso(i)}
                  aria-label={`Volver a ${paso.label}`}
                  className="flex w-full cursor-pointer items-start gap-2.5 rounded-sm px-2.5 py-2.5 text-left text-ink hover:bg-card/60"
                >
                  <span className="grid size-[22px] flex-none place-items-center rounded-full bg-accent text-white">
                    {TILDE}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[14px]">{paso.label}</span>
                    {resumen && <span className="truncate text-[12px] text-ink-secondary">{resumen}</span>}
                  </span>
                </button>
              </li>
            );
          }
          const actual = i === ob.paso;
          return (
            <li
              key={paso.id}
              aria-current={actual ? "step" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-sm px-2.5 py-2.5 text-[14px]",
                actual ? "bg-card font-bold text-ink shadow-sm" : "text-ink-secondary",
              )}
            >
              <span
                className={cn(
                  "grid size-[22px] flex-none place-items-center rounded-full text-[12px] font-bold",
                  actual ? "bg-primary text-primary-on" : "border border-line-strong bg-card",
                )}
              >
                {i + 1}
              </span>
              {paso.label}
            </li>
          );
        })}
      </ol>

      {ob.esVentas && (
        <div className="mx-2 flex flex-col gap-2.5 border-t border-dashed border-line-strong pt-4">
          <p className="text-[11px] font-bold tracking-[0.08em] text-muted uppercase">Después, desde tu panel</p>
          <p className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <span className="[&>svg]:size-[15px]">{ICONO_BOLSA}</span>
            Cargar tus productos
          </p>
          <p className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="6" width="18" height="13" rx="2" />
              <path d="M3 10h18" />
            </svg>
            Conectar Mercado Pago
          </p>
        </div>
      )}

      <p className="mx-2 mt-auto text-[12.5px] leading-[1.6] text-ink-secondary">{AYUDA_POR_PASO[ob.pasoId]}</p>
    </aside>
  );
}

/** Móvil: volver, "Paso N de M" y la barra segmentada, en lugar del riel. */
function ProgresoMovil({ ob }: { ob: Onboarding }) {
  return (
    <div className="flex flex-col gap-2.5 px-5 pt-2 md:hidden">
      <div className="flex min-h-11 items-center justify-between">
        {ob.paso > 0 ? (
          <button
            type="button"
            onClick={ob.irAtras}
            aria-label="Volver al paso anterior"
            className="-ml-3 grid size-11 cursor-pointer place-items-center text-ink"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        ) : (
          <span className="text-[14px] font-bold text-ink">Creá tu asistente</span>
        )}
        <span className="text-[12.5px] font-bold text-primary-hover">
          Paso {ob.paso + 1} de {ob.pasos.length}
        </span>
      </div>
      <div className="flex gap-1" aria-hidden>
        {ob.pasos.map((paso, i) => (
          <span
            key={paso.id}
            className={cn(
              "h-1 flex-1 rounded-full",
              i < ob.paso ? "bg-accent" : i === ob.paso ? "bg-primary" : "bg-line",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function Pregunta({
  titulo,
  bajada,
  tituloRef,
}: {
  titulo: string;
  bajada: ReactNode;
  tituloRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <>
      <h1
        ref={tituloRef}
        tabIndex={-1}
        className="font-display text-[25px] leading-[1.18] font-bold tracking-[-0.02em] text-pretty text-ink outline-none md:text-[30px]"
      >
        {titulo}
      </h1>
      <p className="mt-2 mb-5 max-w-[520px] text-[14px] leading-[1.6] text-pretty text-ink-secondary md:mb-6 md:text-[15px]">
        {bajada}
      </p>
    </>
  );
}

const TILDE_VERDE = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 flex-none text-accent">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const PODERES_VENTAS = [
  "Buscar en tu catálogo y decir precio y stock",
  "Tomar el pedido y reservar la mercadería",
  "Mandar el link de pago a tu nombre",
  "Pasarte lo que no sabe responder",
];

/** La pregunta del paso en curso, con sus controles. */
function ContenidoDelPaso({
  ob,
  tituloRef,
}: {
  ob: Onboarding;
  tituloRef: RefObject<HTMLHeadingElement | null>;
}) {
  switch (ob.pasoId) {
    case "tipo":
      return (
        <>
          <Pregunta
            tituloRef={tituloRef}
            titulo="¿Qué va a hacer tu asistente?"
            bajada="Elegí el que más se parezca a lo que pasa hoy en tu WhatsApp. El resto de las preguntas se arma a partir de esto."
          />
          <ElegirAsistente valor={ob.tipoAsistente} onCambio={ob.elegirTipoAsistente} />
        </>
      );

    case "negocio":
      return ob.esVentas ? (
        <>
          <Pregunta
            tituloRef={tituloRef}
            titulo="Contanos de tu negocio"
            bajada="Es el nombre con el que el asistente te presenta. Usá el que tus clientes ya conocen: el de tu local o tu cuenta de Instagram."
          />
          <div className="max-w-[440px]">
            <CampoNombreTitular ob={ob} />
          </div>
          <div className="mt-8 max-w-[560px]">
            <p className="mb-3 text-[13px] font-semibold text-ink-secondary">Tu asistente va a poder</p>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {PODERES_VENTAS.map((poder) => (
                <li
                  key={poder}
                  className="flex items-start gap-2.5 rounded-md border border-line bg-card px-3.5 py-3 text-[13.5px] leading-[1.45] text-ink"
                >
                  {TILDE_VERDE}
                  {poder}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <>
          <Pregunta
            tituloRef={tituloRef}
            titulo="¿A nombre de quién agendamos?"
            bajada="Puede ser tu nombre o el de tu negocio. Es el nombre con el que se presenta el asistente."
          />
          <div className="mb-5">
            <ChipsTitular ob={ob} />
          </div>
          <div className="max-w-[440px]">
            <CampoNombreTitular ob={ob} />
          </div>
        </>
      );

    case "turnos":
      return (
        <>
          <Pregunta
            tituloRef={tituloRef}
            titulo="¿Qué turnos das?"
            bajada="Tildá los que tomás y ajustá cuánto duran. El precio es opcional: si no lo ponés, el asistente le dice al cliente que lo consulte con vos."
          />
          <div className="mb-4">
            <EmpezarCon ob={ob} />
          </div>
          <PrecioParaTodos ob={ob} />
          <ListaEventos ob={ob} />
          <div className="mt-3">
            <AgregarEvento ob={ob} />
          </div>
        </>
      );

    case "horarios":
      return (
        <>
          <Pregunta
            tituloRef={tituloRef}
            titulo="¿En qué horario atendés?"
            bajada="De qué hora a qué hora se pueden agendar turnos, de lunes a viernes. El asistente no ofrece horarios fuera de esta franja."
          />
          <div className="max-w-[520px]">
            <SelectoresFranja ob={ob} />
            <div className="mt-3 mb-5">
              <TextoRango ob={ob} />
            </div>
            <p className="mb-2 text-[13px] font-semibold text-ink-secondary">O elegí una franja armada</p>
            <PresetsFranja ob={ob} />
          </div>
        </>
      );

    case "asistente":
      return (
        <>
          <Pregunta
            tituloRef={tituloRef}
            titulo="¿Cómo se llama tu asistente?"
            bajada={
              ob.esVentas
                ? "Con este nombre saluda a quien te escribe. Atiende las 24 horas, todos los días."
                : "Con este nombre saluda a quien te escribe por WhatsApp."
            }
          />
          <div className="max-w-[440px]">
            <CampoBot ob={ob} />
          </div>
          {ob.esVentas && (
            <div className="mt-7 flex max-w-[540px] gap-3.5 rounded-md border border-line bg-page px-4 py-3.5">
              <span className="grid size-9 flex-none place-items-center rounded-sm border border-[var(--color-primitive-coral-200)] bg-card text-primary [&>svg]:size-[18px]">
                {ICONO_BOLSA}
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-[14.5px] font-bold text-ink">¿Y tus productos?</span>
                <span className="text-[13.5px] leading-[1.55] text-ink-secondary">
                  Los cargás apenas termines, desde tu panel: uno por uno o subiendo tu planilla de Excel. Hasta
                  entonces el asistente no ofrece nada.
                </span>
              </span>
            </div>
          )}
        </>
      );
  }
}

/** El texto al lado del botón principal: cuánto falta, cuántos tipos, o que se puede cambiar. */
function textoDelPie(ob: Onboarding): string | null {
  if (ob.pasoId === "tipo") return ob.esVentas ? "3 pasos · menos de 1 minuto" : "5 pasos · unos 2 minutos";
  if (ob.pasoId === "turnos") {
    const n = ob.seleccionados.length;
    return `${n} ${n === 1 ? "tipo elegido" : "tipos elegidos"}`;
  }
  if (ob.esUltimo) return "Podés cambiar todo después";
  return null;
}

/**
 * El wizard de /contanos, para los dos asistentes y en todos los tamaños: un
 * solo DOM. En escritorio, riel de pasos a la izquierda y chat de ejemplo a la
 * derecha; en móvil, un paso por pantalla con el botón fijo abajo y el chat
 * plegado (abierto en el último paso, donde se ve el saludo completo).
 */
export function WizardContanos({
  ob,
  enviando,
  yaVinculado,
  error,
  onFinalizar,
}: {
  ob: Onboarding;
  enviando: boolean;
  /** Por qué falló el último intento de crear el asistente, si falló. */
  error: string | null;
  /** La cuenta ya escaneó el QR (alta por WhatsApp): no hay nada que vincular. */
  yaVinculado: boolean;
  onFinalizar: () => void;
}) {
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const pasoAnterior = useRef(ob.paso);

  // Al cambiar de paso, el foco va a la pregunta nueva (y en móvil, arriba de todo).
  useEffect(() => {
    if (pasoAnterior.current === ob.paso) return;
    pasoAnterior.current = ob.paso;
    window.scrollTo({ top: 0 });
    tituloRef.current?.focus({ preventScroll: true });
  }, [ob.paso]);

  const pie = textoDelPie(ob);
  const etiquetaPrincipal = ob.esUltimo ? (enviando ? "Creando tu asistente…" : textoFinal(yaVinculado)) : "Continuar";

  return (
    <div className="flex w-full flex-1 bg-page md:max-w-[1200px] md:flex-none md:overflow-hidden md:rounded-lg md:border md:border-line md:bg-card md:shadow-lg">
      <RielPasos ob={ob} />

      <section className="flex min-w-0 flex-1 flex-col">
        <ProgresoMovil ob={ob} />

        <div className="flex-1 px-5 pt-5 pb-6 md:px-11 md:pt-9">
          <p className="mb-2 hidden text-[12.5px] font-bold text-primary-hover md:block">
            Paso {ob.paso + 1} de {ob.pasos.length}
          </p>
          <ContenidoDelPaso ob={ob} tituloRef={tituloRef} />

          {/* Sin la columna de la derecha, el chat de ejemplo va plegado debajo de la pregunta. */}
          <details key={ob.pasoId} open={ob.esUltimo} className="group mt-7 lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-sm border border-line bg-card px-3.5 text-[13.5px] text-ink [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <span aria-hidden className="size-2 rounded-full bg-accent" />
                Ver cómo responde tu asistente
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform group-open:rotate-180">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <VistaPreviaChat ob={ob} className="mt-2.5" />
          </details>
        </div>

        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-card px-5 pt-3.5 pb-7 md:static md:flex-row md:flex-wrap md:items-center md:gap-3 md:border-sunken md:px-11 md:pt-5 md:pb-7">
          {error && (
            <p role="alert" className="text-[13px] text-danger-text md:w-full">
              {error}
            </p>
          )}
          {ob.paso > 0 && (
            <span className="hidden md:block">
              <Button variant="ghost" size="md" onClick={ob.irAtras}>
                Atrás
              </Button>
            </span>
          )}
          {pie && <span className="text-center text-[12.5px] text-ink-secondary md:ml-auto md:text-[13px]">{pie}</span>}
          <Button
            variant="primary"
            size="lg"
            disabled={!ob.puedeAvanzar[ob.pasoId] || enviando}
            onClick={ob.esUltimo ? onFinalizar : ob.irAdelante}
            className={cn("w-full md:w-auto", !pie && "md:ml-auto")}
          >
            {etiquetaPrincipal}
          </Button>
        </div>
      </section>

      <aside className="hidden w-[340px] flex-none flex-col gap-3.5 border-l border-line bg-sunken px-[22px] py-6 lg:flex">
        <p className="text-[11px] font-bold tracking-[0.08em] text-muted uppercase">Así va a responder</p>
        <VistaPreviaChat ob={ob} className="flex-1" />
        <p className="text-[12px] leading-[1.5] text-ink-secondary">
          Ejemplo. Se actualiza con tus datos mientras completás.
        </p>
      </aside>
    </div>
  );
}
