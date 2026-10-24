"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { apiFetch } from "@/lib/api";
import { nombreDeZona, textoVuelve, type EstadoAsistente } from "@/lib/horario-atencion";

/** Lo dispara /cuenta al guardar el horario, para que el header no espere al próximo minuto. */
export const EVENTO_HORARIO_GUARDADO = "trato:horario-atencion";

/** El horario abre y cierra solo: el estado se vuelve a pedir cada minuto. */
const CADA_MS = 60_000;

/**
 * Si el asistente está contestando ahora por WhatsApp (LAU-29): prendido,
 * fuera de horario o pausado por la suscripción. Sin WhatsApp vinculado no
 * muestra nada: eso ya lo dice el badge de la vinculación.
 */
export function useEstadoAsistente(): EstadoAsistente | null {
  const [estado, setEstado] = useState<EstadoAsistente | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const pedir = () => {
      apiFetch("/asistente/estado", { signal: ctrl.signal })
        .then((res) => (res.ok ? (res.json() as Promise<EstadoAsistente>) : null))
        .then((data) => data && setEstado(data))
        .catch(() => {});
    };

    pedir();
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === "visible") pedir();
    }, CADA_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") pedir();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(EVENTO_HORARIO_GUARDADO, pedir);

    return () => {
      ctrl.abort();
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(EVENTO_HORARIO_GUARDADO, pedir);
    };
  }, []);

  return estado;
}

function textos(estado: EstadoAsistente): { corto: string; detalle: string | null } {
  if (estado.prendido) {
    return { corto: "Asistente prendido", detalle: estado.hasta ? `hasta las ${estado.hasta}` : null };
  }
  if (estado.motivo === "suscripcion_vencida") return { corto: "Asistente pausado", detalle: "plan vencido" };
  return {
    corto: "Fuera de horario",
    detalle: estado.vuelve ? `vuelve ${textoVuelve(estado.vuelve)}` : null,
  };
}

export function BadgeEstadoAsistente({ estado }: Readonly<{ estado: EstadoAsistente }>) {
  if (estado.motivo === "sin_whatsapp") return null;
  const { corto, detalle } = textos(estado);
  const tono = estado.prendido ? "success" : estado.motivo === "suscripcion_vencida" ? "danger" : "neutral";
  const completo = detalle ? `${corto}, ${detalle}` : corto;
  return (
    <span
      className="whitespace-nowrap"
      role="status"
      aria-label={`${completo} (hora de ${nombreDeZona(estado.zona)})`}
      title={`Hora de ${nombreDeZona(estado.zona)}`}
    >
      <Badge tone={tono}>
        <span aria-hidden className="inline-flex items-center gap-1.5">
          <span
            className={`size-1.5 rounded-full ${estado.prendido ? "bg-success" : "bg-current opacity-60"}`}
          />
          {corto}
          {/* En el celular no entra: el detalle queda para el nombre accesible y el title. */}
          {detalle && <span className="hidden font-normal lg:inline"> · {detalle}</span>}
        </span>
      </Badge>
    </span>
  );
}
