/** "$20.000", como se escribe en Argentina. */
export function formatearMonto(monto: number, moneda = "ARS"): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: moneda,
    maximumFractionDigits: 0,
  }).format(monto);
}
