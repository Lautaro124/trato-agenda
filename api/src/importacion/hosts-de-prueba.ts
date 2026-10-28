/**
 * IMPORTACION_HOSTS_DE_PRUEBA ("importacion-stub,otro") → el conjunto de
 * hosts. Vacío en producción: validateEnv no arranca si viene puesta.
 */
export function hostsDePrueba(valor: string): ReadonlySet<string> {
  return new Set(
    valor
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}
