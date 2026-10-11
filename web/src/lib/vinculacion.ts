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
  /** POST { telefono } que devuelve el código para vincular desde el mismo celular. */
  codigo: string;
};

/** Lo que devuelve pedir el código: el código, o qué decirle a la persona. */
export type ResultadoCodigo = { codigo: string } | { error: string };

function errorDeCodigo(status: number): string {
  if (status === 400) return "Revisá el número: tiene que ser el de WhatsApp, con el código de área.";
  if (status === 409) return "Este WhatsApp ya está vinculado.";
  if (status === 429) return "Pediste demasiados códigos para ese número. Probá de nuevo en un rato.";
  if (status === 401) return "La página venció. Recargala para empezar de nuevo.";
  return "WhatsApp no respondió. Probá de nuevo en un momento.";
}

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
  const { iniciar, reintentar, stream, codigo } = endpoints;

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

  /**
   * Vincular sin QR, desde el mismo celular: la API abre un socket nuevo y
   * devuelve el código. Lo que pase después (conectando, conectado, vencido)
   * llega por el mismo SSE que el QR.
   */
  const pedirCodigo = useCallback(
    async (telefono: string): Promise<ResultadoCodigo> => {
      setMotivo(null);
      setState("active");
      try {
        const res = await apiFetch(codigo, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telefono }),
        });
        if (!res.ok) return { error: errorDeCodigo(res.status) };
        return (await res.json()) as { codigo: string };
      } catch {
        return { error: "No pudimos conectar con Trato." };
      }
    },
    [codigo],
  );

  return { state, qr, phone, motivo, regenerar, pedirCodigo };
}

/** Texto de la tarjeta de error según lo que se sabe del fallo. */
export function textoDeError(motivo: MotivoError | null): string {
  if (motivo === "numero_en_uso") return "Ese WhatsApp ya es de otra cuenta";
  if (motivo === "limite") return "Demasiados intentos: esperá unos minutos";
  if (motivo === "sin_api") return "No pudimos conectar con Trato";
  return "No pudimos vincular tu WhatsApp";
}
