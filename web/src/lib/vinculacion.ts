"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, sseUrl } from "./api";

export type LinkState = "active" | "connecting" | "connected" | "expired" | "error";

/** `numero_en_uso`: ese WhatsApp ya es la cuenta de otra persona. */
export type MotivoError = "numero_en_uso" | "limite" | "sin_api";

type LinkEvent = {
  state: LinkState;
  qr?: string;
  phoneNumber?: string;
  motivo?: MotivoError;
};

type Endpoints = {
  /** POST que arranca la vinculación. Tiene que terminar antes de abrir el stream. */
  iniciar: string;
  /** POST para pedir un QR nuevo sin volver a empezar. */
  reintentar: string;
  /** SSE con los eventos de Baileys. */
  stream: string;
};

/**
 * La máquina de estados del QR de WhatsApp, compartida por /vincular (con
 * sesión) y /entrar/whatsapp (alta sin cuenta). La API empuja los estados
 * por SSE: QR nuevos, "conectando", "conectado", error.
 *
 * El stream se abre recién cuando el POST inicial contestó: en el alta, ese
 * POST es el que deja la cookie que el stream necesita.
 */
export function useVinculacion(endpoints: Endpoints, habilitado: boolean) {
  const [state, setState] = useState<LinkState>("active");
  const [qr, setQr] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<MotivoError | null>(null);
  const { iniciar, reintentar, stream } = endpoints;

  useEffect(() => {
    if (!habilitado) return;
    let source: EventSource | null = null;
    let cancelado = false;

    apiFetch(iniciar, { method: "POST" })
      .then((res) => {
        if (cancelado) return;
        if (!res.ok) {
          setMotivo(res.status === 429 ? "limite" : null);
          setState("error");
          return;
        }
        source = new EventSource(sseUrl(stream), { withCredentials: true });
        source.onmessage = (event) => {
          const payload = JSON.parse(event.data) as LinkEvent;
          setState(payload.state);
          setMotivo(payload.motivo ?? null);
          if (payload.qr) setQr(payload.qr);
          if (payload.phoneNumber) setPhone(payload.phoneNumber);
        };
      })
      .catch(() => {
        if (cancelado) return;
        setMotivo("sin_api");
        setState("error");
      });

    return () => {
      cancelado = true;
      source?.close();
    };
  }, [habilitado, iniciar, stream]);

  /** Para los botones "regenerar"/"reintentar": limpia lo que se ve y pide un QR nuevo. */
  const regenerar = useCallback(() => {
    setQr(null);
    setMotivo(null);
    setState("active");
    void apiFetch(reintentar, { method: "POST" }).then((res) => {
      if (res.ok) return;
      setMotivo(res.status === 429 ? "limite" : null);
      setState("error");
    });
  }, [reintentar]);

  return { state, qr, phone, motivo, regenerar };
}

/** Texto de la tarjeta de error según lo que se sabe del fallo. */
export function textoDeError(motivo: MotivoError | null): string {
  if (motivo === "numero_en_uso") return "Ese WhatsApp ya es de otra cuenta";
  if (motivo === "limite") return "Demasiados intentos: esperá unos minutos";
  if (motivo === "sin_api") return "No pudimos conectar con Trato Agenda";
  return "No pudimos vincular tu WhatsApp";
}
