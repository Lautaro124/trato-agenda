/**
 * El número de WhatsApp en el front: la lista de países del selector y cómo se
 * arma el número que viaja al API (dígitos con código de país y sin "+", que es
 * como lo guarda la base — ver api/src/auth/telefono.ts).
 */

export type Pais = { iso: string; nombre: string; prefijo: string; bandera: string };

/** Argentina primero, después el resto de donde puede haber gente usando esto. */
export const PAISES: Pais[] = [
  { iso: "AR", nombre: "Argentina", prefijo: "54", bandera: "🇦🇷" },
  { iso: "UY", nombre: "Uruguay", prefijo: "598", bandera: "🇺🇾" },
  { iso: "CL", nombre: "Chile", prefijo: "56", bandera: "🇨🇱" },
  { iso: "PY", nombre: "Paraguay", prefijo: "595", bandera: "🇵🇾" },
  { iso: "BO", nombre: "Bolivia", prefijo: "591", bandera: "🇧🇴" },
  { iso: "BR", nombre: "Brasil", prefijo: "55", bandera: "🇧🇷" },
  { iso: "PE", nombre: "Perú", prefijo: "51", bandera: "🇵🇪" },
  { iso: "EC", nombre: "Ecuador", prefijo: "593", bandera: "🇪🇨" },
  { iso: "CO", nombre: "Colombia", prefijo: "57", bandera: "🇨🇴" },
  { iso: "VE", nombre: "Venezuela", prefijo: "58", bandera: "🇻🇪" },
  { iso: "MX", nombre: "México", prefijo: "52", bandera: "🇲🇽" },
  { iso: "CR", nombre: "Costa Rica", prefijo: "506", bandera: "🇨🇷" },
  { iso: "PA", nombre: "Panamá", prefijo: "507", bandera: "🇵🇦" },
  { iso: "GT", nombre: "Guatemala", prefijo: "502", bandera: "🇬🇹" },
  { iso: "SV", nombre: "El Salvador", prefijo: "503", bandera: "🇸🇻" },
  { iso: "HN", nombre: "Honduras", prefijo: "504", bandera: "🇭🇳" },
  { iso: "NI", nombre: "Nicaragua", prefijo: "505", bandera: "🇳🇮" },
  { iso: "DO", nombre: "República Dominicana", prefijo: "1809", bandera: "🇩🇴" },
  { iso: "ES", nombre: "España", prefijo: "34", bandera: "🇪🇸" },
  { iso: "US", nombre: "Estados Unidos", prefijo: "1", bandera: "🇺🇸" },
];

export const PAIS_POR_DEFECTO = PAISES[0];

export function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

/** Lo que espera el API: código de país pegado al número nacional, sin "+". */
export function telefonoCompleto(pais: Pais, nacional: string): string {
  return `${pais.prefijo}${soloDigitos(nacional)}`;
}

/**
 * Lo que se tipea o se pega en el campo nacional. Si alguien pega el número
 * completo ("+54 9 11…"), el prefijo del país elegido se descarta para no
 * mandarlo dos veces.
 */
export function limpiarNacional(pais: Pais, texto: string): string {
  const digitos = soloDigitos(texto);
  const pegoElPrefijo = texto.trimStart().startsWith("+") && digitos.startsWith(pais.prefijo);
  return pegoElPrefijo ? digitos.slice(pais.prefijo.length) : digitos;
}

export function paisPorIso(iso: string): Pais {
  return PAISES.find((pais) => pais.iso === iso) ?? PAIS_POR_DEFECTO;
}
