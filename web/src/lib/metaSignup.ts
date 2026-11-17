"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";

/** Ids públicos de la app de Meta, que da la API. Sin ellos no se ofrece WhatsApp Business. */
type ConfigMeta = { appId: string; configId: string };

/** Lo que vuelve de Embedded Signup y la API verifica contra Meta. */
export type DatosSignup = { code: string; wabaId: string; phoneNumberId: string; coexistencia: boolean };

export type ResultadoSignup = { ok: true; datos: DatosSignup } | { ok: false; error: string | null };

type RespuestaLogin = { authResponse?: { code?: string } | null };
type FB = {
  init(opciones: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(callback: (respuesta: RespuestaLogin) => void, opciones: Record<string, unknown>): void;
};

declare global {
  interface Window {
    FB?: FB;
    fbAsyncInit?: () => void;
  }
}

/** La misma versión de la Graph API que usa la API (meta-graph.client.ts). */
const VERSION_GRAPH = "v26.0";

/** Sólo Facebook puede contar qué WABA y qué número se eligieron en el popup. */
const ORIGENES_DE_META = new Set(["https://www.facebook.com", "https://web.facebook.com"]);

/** Lo que se espera el evento de sesión después de que el popup devuelve el código. */
const ESPERA_SESION_MS = 3_000;

let sdk: Promise<FB> | null = null;

/** Carga el SDK de Facebook una sola vez, recién cuando alguien va a conectar. */
function cargarSdk(appId: string): Promise<FB> {
  sdk ??= new Promise<FB>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: VERSION_GRAPH });
      resolve(window.FB!);
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/es_LA/sdk.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdk = null;
      reject(new Error("No se pudo cargar Facebook."));
    };
    document.body.appendChild(script);
  });
  return sdk;
}

type Sesion = { wabaId: string; phoneNumberId: string; coexistencia: boolean } | { cancelado: true };

/** Lee el evento `WA_EMBEDDED_SIGNUP` que manda el popup. null si no es eso. */
function sesionDe(event: MessageEvent): Sesion | null {
  if (!ORIGENES_DE_META.has(event.origin)) return null;
  let datos: unknown;
  try {
    datos = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch {
    return null;
  }
  const mensaje = datos as { type?: unknown; event?: unknown; data?: { waba_id?: unknown; phone_number_id?: unknown } };
  if (mensaje?.type !== "WA_EMBEDDED_SIGNUP") return null;
  if (mensaje.event === "CANCEL") return { cancelado: true };
  const coexistencia = mensaje.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
  if (mensaje.event !== "FINISH" && !coexistencia) return null;
  const { waba_id: wabaId, phone_number_id: phoneNumberId } = mensaje.data ?? {};
  if (typeof wabaId !== "string" || typeof phoneNumberId !== "string") return null;
  return { wabaId, phoneNumberId, coexistencia };
}

/**
 * Embedded Signup de Meta: abre el popup donde el negocio elige (o crea) su
 * cuenta de WhatsApp Business y su número. Si el número ya está en la app
 * WhatsApp Business, Meta lo conecta en coexistencia y el dueño la sigue
 * usando en el celular. Devuelve lo que hay que mandarle a la API, que es
 * quien lo verifica: acá no se confía en nada.
 */
export function useMetaSignup() {
  // undefined: todavía no se sabe; null: la API no tiene Meta configurado.
  const [config, setConfig] = useState<ConfigMeta | null | undefined>(undefined);

  useEffect(() => {
    let cancelado = false;
    apiFetch("/auth/whatsapp/meta/config")
      .then((res) => (res.ok ? (res.json() as Promise<{ appId: string | null; configId: string | null }>) : null))
      .then((cuerpo) => {
        if (cancelado) return;
        setConfig(cuerpo?.appId && cuerpo.configId ? { appId: cuerpo.appId, configId: cuerpo.configId } : null);
      })
      .catch(() => {
        if (!cancelado) setConfig(null);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  // Se precarga apenas se sabe que está disponible: el popup tiene que abrirse
  // pegado al clic o el navegador lo bloquea.
  useEffect(() => {
    if (config) cargarSdk(config.appId).catch(() => undefined);
  }, [config]);

  const conectar = useCallback(async (): Promise<ResultadoSignup> => {
    if (!config) return { ok: false, error: "La conexión con WhatsApp Business no está disponible." };
    let fb: FB;
    try {
      fb = await cargarSdk(config.appId);
    } catch {
      return { ok: false, error: "No se pudo abrir Facebook. Revisá que no lo bloquee una extensión del navegador." };
    }

    return new Promise<ResultadoSignup>((resolve) => {
      let sesion: Sesion | null = null;
      const escuchar = (event: MessageEvent) => {
        sesion = sesionDe(event) ?? sesion;
      };
      window.addEventListener("message", escuchar);
      const terminar = (resultado: ResultadoSignup) => {
        window.removeEventListener("message", escuchar);
        resolve(resultado);
      };

      fb.login(
        (respuesta) => {
          const code = respuesta.authResponse?.code;
          // Cerró el popup sin terminar: no es un error que haya que mostrar.
          if (!code) return terminar({ ok: false, error: null });
          // El evento con la WABA y el número suele llegar antes que el código, pero no siempre.
          const desde = Date.now();
          const esperar = () => {
            const actual = sesion;
            if (actual && !("cancelado" in actual)) {
              return terminar({ ok: true, datos: { code, ...actual } });
            }
            if (actual || Date.now() - desde > ESPERA_SESION_MS) {
              return terminar({ ok: false, error: actual ? null : "Meta no nos dijo qué número elegiste. Probá de nuevo." });
            }
            setTimeout(esperar, 100);
          };
          esperar();
        },
        {
          config_id: config.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, sessionInfoVersion: "3" },
        },
      );
    });
  }, [config]);

  return { disponible: config ? true : config === null ? false : undefined, conectar };
}

/** Qué decirle a la persona según cómo contestó la API al conectar. */
export function errorDeConexionMeta(status: number, motivo?: string): string {
  if (status === 409 && motivo === "cuenta_existente") {
    return "Ese número ya tiene una cuenta en Trato. Entrá con tu contraseña o con Google y conectá WhatsApp Business desde Vinculación.";
  }
  if (status === 409) return "Ese WhatsApp ya es de otra cuenta de Trato.";
  if (status === 400) return "Ese número no es de la cuenta de WhatsApp Business que elegiste.";
  if (status === 429) return "Hubo demasiados intentos. Probá de nuevo en un rato.";
  return "Meta no confirmó la conexión. Probá de nuevo en un momento.";
}
