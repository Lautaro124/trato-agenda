"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

/**
 * La conexión por la API oficial de WhatsApp (Embedded Signup de Meta). El
 * navegador sólo abre el popup de Meta y pasa a la API lo que devuelve: el
 * código se canjea en la API, que es la única que ve el token del comercio.
 */

export type ConfigOficial =
  | { disponible: false }
  | { disponible: true; appId: string; configId: string; graphVersion: string };

/** Lo que devuelve Embedded Signup al terminar, sin el código (que viene aparte). */
export type DatosDelAlta = { wabaId: string; phoneNumberId: string };

type RespuestaLogin = { authResponse?: { code?: string } | null };

type SdkDeFacebook = {
  init(opciones: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(callback: (respuesta: RespuestaLogin) => void, opciones: Record<string, unknown>): void;
};

declare global {
  interface Window {
    FB?: SdkDeFacebook;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = "https://connect.facebook.net/es_LA/sdk.js";

/** La configuración que expone la API. Sin variables de Meta, `disponible: false`. */
export function useConfigOficial(habilitado: boolean): ConfigOficial | null {
  const [config, setConfig] = useState<ConfigOficial | null>(null);
  useEffect(() => {
    if (!habilitado) return;
    let vigente = true;
    apiFetch("/whatsapp/cloud/config")
      .then((respuesta) => (respuesta.ok ? (respuesta.json() as Promise<ConfigOficial>) : { disponible: false as const }))
      .catch(() => ({ disponible: false as const }))
      .then((datos) => {
        if (vigente) setConfig(datos);
      });
    return () => {
      vigente = false;
    };
  }, [habilitado]);
  return config;
}

let carga: Promise<SdkDeFacebook> | null = null;

/** Carga el SDK de Meta una sola vez. */
export function cargarSdk(config: Extract<ConfigOficial, { disponible: true }>): Promise<SdkDeFacebook> {
  if (carga) return carga;
  carga = new Promise<SdkDeFacebook>((resolve, reject) => {
    window.fbAsyncInit = () => {
      const sdk = window.FB;
      if (!sdk) {
        reject(new Error("El SDK de Meta no cargó."));
        return;
      }
      sdk.init({ appId: config.appId, autoLogAppEvents: false, xfbml: false, version: config.graphVersion });
      resolve(sdk);
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      carga = null;
      reject(new Error("No se pudo cargar el SDK de Meta."));
    };
    document.body.appendChild(script);
  });
  return carga;
}

/** Si un mensaje de la ventana viene de Meta (Embedded Signup lo manda por `postMessage`). */
function esDeMeta(origen: string): boolean {
  try {
    const { protocol, hostname } = new URL(origen);
    return protocol === "https:" && (hostname === "facebook.com" || hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
}

export type ResultadoDelPopup =
  | { tipo: "listo"; codigo: string; datos: DatosDelAlta }
  | { tipo: "cancelado" }
  | { tipo: "error" };

/**
 * Abre Embedded Signup y espera las dos mitades: el código (callback de
 * `FB.login`) y la WABA con el número (evento `WA_EMBEDDED_SIGNUP`).
 * `coexistencia`: el número ya usa la app WhatsApp Business y la sigue usando.
 */
export function abrirEmbeddedSignup(sdk: SdkDeFacebook, configId: string, coexistencia: boolean): Promise<ResultadoDelPopup> {
  return new Promise((resolve) => {
    let codigo: string | null = null;
    let datos: DatosDelAlta | null = null;
    let terminado = false;

    const terminar = (resultado: ResultadoDelPopup) => {
      if (terminado) return;
      terminado = true;
      window.removeEventListener("message", alRecibir);
      resolve(resultado);
    };
    const siEstaCompleto = () => {
      if (codigo && datos) terminar({ tipo: "listo", codigo, datos });
    };

    function alRecibir(evento: MessageEvent) {
      if (!esDeMeta(evento.origin) || typeof evento.data !== "string") return;
      let mensaje: { type?: unknown; event?: unknown; data?: { waba_id?: unknown; phone_number_id?: unknown } };
      try {
        mensaje = JSON.parse(evento.data);
      } catch {
        return;
      }
      if (mensaje.type !== "WA_EMBEDDED_SIGNUP") return;
      if (mensaje.event === "CANCEL") return terminar({ tipo: "cancelado" });
      if (mensaje.event === "ERROR") return terminar({ tipo: "error" });
      const wabaId = mensaje.data?.waba_id;
      const phoneNumberId = mensaje.data?.phone_number_id;
      if (typeof wabaId === "string" && typeof phoneNumberId === "string") {
        datos = { wabaId, phoneNumberId };
        siEstaCompleto();
      }
    }

    window.addEventListener("message", alRecibir);
    sdk.login(
      (respuesta) => {
        const recibido = respuesta.authResponse?.code;
        if (typeof recibido !== "string" || !recibido) {
          // Sin código el alta no se puede terminar, aunque Meta haya mandado los datos.
          terminar(datos ? { tipo: "error" } : { tipo: "cancelado" });
          return;
        }
        codigo = recibido;
        siEstaCompleto();
        // El evento de Meta suele llegar antes que el callback: si no llega en un rato, no se puede terminar.
        if (!datos) setTimeout(() => terminar({ tipo: "error" }), 10_000);
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: coexistencia
          ? { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" }
          : { setup: {}, sessionInfoVersion: "3" },
      },
    );
  });
}
