"use client";

import type { ReactNode } from "react";
import type { Onboarding } from "@/app/contanos/useOnboarding";
import { cn } from "@/lib/cn";
import { horariosDe } from "@/lib/local";

function DelAsistente({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[88%] self-start rounded-[16px_16px_16px_4px] border border-line bg-card px-[13px] py-[10px] text-[13.5px] leading-[1.5] text-ink shadow-sm">
      {children}
    </div>
  );
}

function DelCliente({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[82%] self-end rounded-[16px_16px_4px_16px] border border-[#c9e9d6] bg-accent-subtle px-[13px] py-[10px] text-[13.5px] leading-[1.5] text-ink">
      {children}
    </div>
  );
}

function LinkDePago() {
  return (
    <div className="flex w-[88%] items-center justify-between self-start rounded-md border border-line bg-card px-[13px] py-[10px] text-[13px]">
      <span className="font-semibold text-ink">Pagar pedido</span>
      <span className="font-mono text-ink-secondary">$ 8.000</span>
    </div>
  );
}

/** En el primer paso todavía no hay datos: un ejemplo de lo que hace cada asistente. */
function EjemploDelTipo({ ventas }: { ventas: boolean }) {
  return ventas ? (
    <>
      <DelCliente>Hola, ¿tenés mates de calabaza?</DelCliente>
      <DelAsistente>¡Hola! Sí, tengo el mate de calabaza curado a $ 8.000. ¿Te lo reservo?</DelAsistente>
      <DelCliente>Dale, uno. Soy Martina</DelCliente>
      <DelAsistente>Te lo guardo 30 minutos, Martina. Pagalo desde este link:</DelAsistente>
      <LinkDePago />
    </>
  ) : (
    <>
      <DelCliente>Hola, ¿tenés turno el jueves a la tarde?</DelCliente>
      <DelAsistente>¡Hola! El jueves tengo 15:00, 16:30 o 18:00. ¿Cuál te queda mejor?</DelAsistente>
      <DelCliente>16:30. Soy Martina</DelCliente>
      <DelAsistente>Listo, Martina: te agendé el jueves a las 16:30.</DelAsistente>
    </>
  );
}

/** Lo que contestaría el asistente si le preguntan por el local, con lo cargado hasta ahora. */
function respuestaDelLocal(ob: Onboarding): string {
  const { local } = ob;
  if (!local.tieneLocal) return "No tenemos local a la calle: vendemos sólo por acá.";
  const donde = local.direccion.trim() ? `Estamos en ${local.direccion.trim()}.` : "";
  const dias = horariosDe(local.semana);
  const horario = dias.length > 0 ? ` Abrimos desde las ${dias[0].desde}.` : "";
  const retiro = local.retiroEnLocal
    ? " Sí, podés retirarlo en el local."
    : " El retiro no está disponible, pero coordinamos la entrega con vos.";
  return `${donde}${horario}${retiro}`.trim();
}

/**
 * El chat de ejemplo del wizard: cómo respondería el asistente con lo que se
 * viene cargando. Lo que muestra depende del tipo y del paso, así cada dato
 * nuevo aparece en la conversación apenas se escribe.
 */
export function VistaPreviaChat({ ob, className }: { ob: Onboarding; className?: string }) {
  const paso = ob.pasoId;
  const conTurnos = paso === "turnos" || paso === "horarios" || paso === "asistente";
  const conHorarios = paso === "horarios" || paso === "asistente";
  const inicial = (ob.nombreBot.trim()[0] ?? "A").toUpperCase();

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-lg border border-line bg-card", className)}>
      <div className="flex items-center gap-2.5 border-b border-sunken px-3.5 py-3">
        <span
          aria-hidden
          className="grid size-8 flex-none place-items-center rounded-full bg-accent-subtle text-[13px] font-bold text-success-text"
        >
          {inicial}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[14px] font-bold text-ink">{ob.nombreTitular.trim() || "Tu asistente"}</span>
          <span className="text-[11.5px] text-success-text">en línea</span>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 bg-page px-3.5 py-4">
        {paso === "tipo" ? (
          <EjemploDelTipo ventas={ob.esVentas} />
        ) : ob.esVentas ? (
          <>
            <DelCliente>Hola, ¿tenés mates de calabaza?</DelCliente>
            <DelAsistente>
              {ob.presentacion} Sí, tengo el mate de calabaza curado a $ 8.000. ¿Te lo reservo?
            </DelAsistente>
            {(paso === "local" || paso === "asistente") && (
              <>
                <DelCliente>¿Puedo pasar a buscarlo?</DelCliente>
                <DelAsistente>{respuestaDelLocal(ob)}</DelAsistente>
              </>
            )}
          </>
        ) : (
          <>
            <DelAsistente>{ob.saludo}</DelAsistente>
            {conTurnos && (
              <DelAsistente>
                {ob.saludoEventos}
                {conHorarios && ` ${ob.saludoHorarios}`}
              </DelAsistente>
            )}
            {paso === "asistente" && <DelCliente>Quiero un turno para el jueves a la tarde</DelCliente>}
          </>
        )}
      </div>
    </div>
  );
}
