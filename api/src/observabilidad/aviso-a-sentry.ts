import * as Sentry from '@sentry/nestjs';

/**
 * Manda a Sentry un aviso de nivel `warning`: algo que hay que poder contar y
 * filtrar, pero que no es un bug (`logger.warn` no llega a Sentry y
 * `logger.error` lo mezclaría con los fallos de verdad). Sin DSN no hace nada,
 * y el scrubbing de `beforeSend` aplica igual que al resto de los eventos.
 * Las etiquetas tienen que ser códigos o ids, nunca texto del cliente.
 */
export function avisarASentry(
  mensaje: string,
  opciones: { fingerprint: string[]; tags: Record<string, string | number | undefined>; userId?: string },
): void {
  Sentry.withScope((scope) => {
    scope.setFingerprint(opciones.fingerprint);
    for (const [clave, valor] of Object.entries(opciones.tags)) {
      if (valor !== undefined) scope.setTag(clave, String(valor));
    }
    if (opciones.userId) scope.setUser({ id: opciones.userId });
    Sentry.captureMessage(mensaje, 'warning');
  });
}
