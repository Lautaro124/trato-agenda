"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import "./globals.css";

// Reemplaza al layout raíz cuando algo rompe ahí mismo: por eso trae su
// propio <html> y los estilos.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body className="bg-page">
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="font-display text-2xl font-bold text-ink">Algo salió mal</h1>
          <p className="text-ink-secondary">
            Ya nos llegó el aviso. Probá de nuevo y, si sigue pasando, volvé en un rato.
          </p>
          <Button onClick={reset}>Reintentar</Button>
        </main>
      </body>
    </html>
  );
}
