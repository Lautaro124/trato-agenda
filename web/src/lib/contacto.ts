/**
 * Datos de contacto públicos, en un solo lugar: aparecen en la landing, en las
 * dos páginas legales y en las tarjetas de ayuda, y en la verificación de
 * Google el contacto de la política tiene que coincidir con el del sitio.
 */
/**
 * Contacto de soporte, en el dominio propio: las verificaciones de Google y de
 * Meta cruzan el contacto y el titular con lo que muestra el sitio. Tiene que
 * ser una casilla que existe y se lee; una que rebota es mucho peor.
 */
export const EMAIL_SOPORTE = "lautarogonzalez@tratoagenda.com";
export const DOMINIO = "tratoagenda.com";

/**
 * Responsable del tratamiento de los datos. Una política de privacidad tiene
 * que identificar a quién reclamarle, y la verificación OAuth de Google lo
 * mira: tiene que coincidir con el titular del proyecto en Cloud Console. La
 * verificación del negocio en Meta exige además que el nombre legal aparezca en
 * el sitio, por eso también va en los pies de página (landing y FooterLegal).
 */
export const RESPONSABLE = "LAUTARO GABRIEL GONZALEZ";
export const CUIT = "20-42672267-5";
