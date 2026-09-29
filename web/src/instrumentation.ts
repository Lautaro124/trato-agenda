import * as Sentry from "@sentry/nextjs";
import { opcionesDeSentry } from "@/lib/sentry";

export function register() {
  // Mismas opciones en Node y en edge: el SDK elige la implementación por runtime.
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(opcionesDeSentry);
  }
}

export const onRequestError = Sentry.captureRequestError;
