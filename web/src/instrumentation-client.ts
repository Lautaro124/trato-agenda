import * as Sentry from "@sentry/nextjs";
import { opcionesDeSentry } from "@/lib/sentry";

// Sin Session Replay a propósito: grabaría pantallas con datos de clientes.
Sentry.init(opcionesDeSentry);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
