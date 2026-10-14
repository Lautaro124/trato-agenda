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

/** Cómo pide el asistente la entrega y los datos que se tildaron en el paso "datos". */
function PedidoDeDatos({ ob }: { ob: Onboarding }) {
  const { haceEnvios, campos } = ob.datosCliente;
  // "¿Envío o retiro?" sólo si además se puede retirar en el local.
  const eligeEntrega = haceEnvios && ob.local.tieneLocal && ob.local.retiroEnLocal;
  if (!haceEnvios && campos.length === 0) return null;
  // "código postal", pero "DNI" sigue en mayúsculas.
  const lista = campos
    .map(({ etiqueta }) => (etiqueta === etiqueta.toUpperCase() ? etiqueta : etiqueta[0].toLowerCase() + etiqueta.slice(1)))
    .join(", ");
  return (
    <>
      <DelCliente>Dale, uno. Soy Martina</DelCliente>
      {eligeEntrega && (
        <>
          <DelAsistente>Perfecto, Martina. ¿Te lo envío o lo retirás?</DelAsistente>
          <DelCliente>Enviámelo</DelCliente>
        </>
      )}
      {campos.length > 0 && <DelAsistente>Para el pedido pasame: {lista}.</DelAsistente>}
    </>
  );
}

/** Ventas a pedido (LAU-21): cuenta qué hace el comercio y toma la solicitud para que la coticen. */
function EjemploAPedido({ ob }: { ob: Onboarding }) {
  const queHace = ob.modalidadVenta.queHace.replace(/\s+/g, " ").trim();
  const titular = ob.nombreTitular.trim() || "el negocio";
  return (
    <>
      <DelCliente>Hola, ¿qué hacen?</DelCliente>
      <DelAsistente>
        {ob.presentacion}{" "}
        {queHace ? (queHace.length > 220 ? `${queHace.slice(0, 217)}…` : queHace) : "Contame qué necesitás y lo vemos."}
      </DelAsistente>
      {ob.pasoId !== "modalidad" && (
        <>
          <DelCliente>Necesito una mesa de 1,80 x 0,90 para fin de mes</DelCliente>
          <DelAsistente>Perfecto, ya le paso tu pedido a {titular} para que te lo cotice. Te escribe por acá con el precio.</DelAsistente>
        </>
      )}
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
/** En "¿Cómo atendés?": cómo suena cada forma de atender, antes de cargar nada. */
function EjemploDeAtencion({ grupal }: { grupal: boolean }) {
  return grupal ? (
    <>
      <DelCliente>Hola, ¿tenés lugar en yoga el miércoles?</DelCliente>
      <DelAsistente>¡Hola! Yoga es el miércoles a las 18:00 y quedan 3 lugares. ¿Te anoto?</DelAsistente>
      <DelCliente>Sí, dale. Soy Martina</DelCliente>
      <DelAsistente>Listo, Martina: te anoté en yoga el miércoles a las 18:00.</DelAsistente>
    </>
  ) : (
    <EjemploDelTipo ventas={false} />
  );
}

export function VistaPreviaChat({ ob, className }: { ob: Onboarding; className?: string }) {
  const paso = ob.pasoId;
  const pasoTurnos = ob.atencion !== "grupal";
  const conTurnos = pasoTurnos && (paso === "turnos" || paso === "horarios" || paso === "asistente");
  const conHorarios = pasoTurnos && (paso === "horarios" || paso === "asistente");
  const conClases = ob.atencion !== "individual" && (paso === "clases" || paso === "horarios" || paso === "asistente");
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
        ) : paso === "atencion" ? (
          <EjemploDeAtencion grupal={ob.atencion !== "individual"} />
        ) : ob.esVentas ? (
          <>
            {ob.modalidadVenta.aPedido ? (
              <EjemploAPedido ob={ob} />
            ) : (
              <>
                <DelCliente>Hola, ¿tenés mates de calabaza?</DelCliente>
                <DelAsistente>
                  {ob.presentacion} Sí, tengo el mate de calabaza curado a $ 8.000. ¿Te lo reservo?
                </DelAsistente>
              </>
            )}
            {(paso === "local" || paso === "datos" || paso === "asistente") && (
              <>
                <DelCliente>¿Puedo pasar a buscarlo?</DelCliente>
                <DelAsistente>{respuestaDelLocal(ob)}</DelAsistente>
              </>
            )}
            {(paso === "datos" || paso === "asistente") && <PedidoDeDatos ob={ob} />}
          </>
        ) : (
          <>
            <DelAsistente>{ob.saludo}</DelAsistente>
            {paso === "lugar" && (
              <>
                <DelCliente>¿Dónde atendés?</DelCliente>
                <DelAsistente>{ob.saludoLugar}</DelAsistente>
              </>
            )}
            {conTurnos && (
              <DelAsistente>
                {ob.saludoEventos}
                {conHorarios && ` ${ob.saludoHorarios}`}
              </DelAsistente>
            )}
            {conClases && <DelAsistente>{ob.saludoClases}</DelAsistente>}
            {paso === "clases" && ob.ejemploReservaClase && (
              <>
                <DelCliente>{ob.ejemploReservaClase.cliente}</DelCliente>
                <DelAsistente>{ob.ejemploReservaClase.asistente}</DelAsistente>
              </>
            )}
            {paso === "asistente" && <DelCliente>Quiero un turno para el jueves a la tarde</DelCliente>}
          </>
        )}
      </div>
    </div>
  );
}
