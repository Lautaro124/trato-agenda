/**
 * El número de WhatsApp como dato: normalizarlo, reconocer las distintas
 * formas de escribir el mismo número y encontrar la cuenta a partir de
 * cualquiera de ellas. Funciones puras (salvo la búsqueda, que recibe Prisma),
 * igual que agenda-rules.ts o subscription.rules.ts.
 *
 * El problema que resuelven: `User.phoneNumber` guarda los dígitos que entrega
 * Baileys, y en Argentina WhatsApp mete un 9 entre el código de país y el
 * número (5491122334455) que nadie dicta cuando dice su teléfono. México tiene
 * el mismo caso con el 1 de los números viejos. Sin esto, quien escribe su
 * número como lo dice no encuentra su cuenta.
 */
import type { PrismaService } from '../prisma/prisma.service.js';
import type { User } from '../generated/prisma/client.js';

/** Dígito que el país intercala entre el código y el número nacional. */
const DIGITO_MOVIL: Record<string, string> = { '54': '9', '52': '1' };

/** Sólo dígitos: "+54 9 11 2233-4455" y "5491122334455" son el mismo número. */
export function normalizarTelefono(crudo: string): string {
  return crudo.replace(/\D/g, '');
}

function partir(digitos: string): { pais: string; nacional: string } | null {
  for (const pais of Object.keys(DIGITO_MOVIL)) {
    if (digitos.startsWith(pais)) return { pais, nacional: digitos.slice(pais.length) };
  }
  return null;
}

/**
 * Lo que se arrastra de la marcación local: el 0 del código de área y el 15
 * del celular argentino. Sólo se sacan cuando están al principio del número
 * nacional — un "15" en el medio no se puede distinguir sin saber cuántos
 * dígitos mide el código de área, así que no se toca. El 15 es sólo argentino:
 * un número mexicano como 52 1 55 1234 5678 empieza con "15" y no lleva nada
 * que sacar más allá del 1.
 */
function sinPrefijosLocales(pais: string, nacional: string): string {
  const sinCero = nacional.startsWith('0') ? nacional.slice(1) : nacional;
  return pais === '54' && sinCero.startsWith('15') ? sinCero.slice(2) : sinCero;
}

/**
 * La forma a la que colapsan todas las maneras de escribir el mismo número.
 * Es la clave de los rate limits: si cada variante tuviera la suya, los
 * intentos permitidos se multiplicarían por la cantidad de formas de tipearlo.
 * No sirve para buscar en la base — para eso están las variantes.
 */
export function claveDeTelefono(crudo: string): string {
  const digitos = normalizarTelefono(crudo);
  const partes = partir(digitos);
  if (!partes) return digitos;
  return `${partes.pais}${sinDigitoMovil(partes)}`;
}

/**
 * Las formas equivalentes del mismo número, la tipeada primero. Se buscan
 * todas en la base porque no sabemos con cuál quedó registrado el WhatsApp.
 */
export function variantesDeTelefono(crudo: string): string[] {
  const digitos = normalizarTelefono(crudo);
  const partes = partir(digitos);
  if (!partes) return [digitos];

  const { pais } = partes;
  const movil = DIGITO_MOVIL[pais];
  const nacional = sinDigitoMovil(partes);
  const todas = [
    digitos,
    `${pais}${movil}${nacional}`,
    `${pais}${nacional}`,
    // Un número nacional que ya empieza con el dígito de móvil es ambiguo: no
    // se puede saber si ese dígito es el de WhatsApp o parte del número. Van
    // las dos lecturas.
    `${pais}${movil}${sinPrefijosLocales(pais, partes.nacional)}`,
  ];
  // El mismo rango que el DTO (whatsapp-auth.controller.ts): agregar un dígito
  // puede pasarse de largo, y un número imposible no se busca en la base.
  return [...new Set(todas)].filter((variante) => variante.length >= 8 && variante.length <= 15);
}

/** El número nacional sin el 0, el 15 ni el dígito de móvil del país. */
function sinDigitoMovil({ pais, nacional }: { pais: string; nacional: string }): string {
  const movil = DIGITO_MOVIL[pais];
  const limpio = sinPrefijosLocales(pais, nacional);
  return limpio.startsWith(movil) ? limpio.slice(movil.length) : limpio;
}

/**
 * La cuenta de ese número, escrito como sea. Una sola consulta y no una por
 * variante: con early return, el tiempo diría cuál de las formas existe.
 *
 * Que aparezca más de una cuenta es raro (`phoneNumber` es único, pero dos
 * variantes son dos strings distintos) y para eso el desempate es fijo: gana
 * la que matchea exactamente lo tipeado y, si no, la más vieja. Nunca el orden
 * que quiera devolver Postgres.
 */
export async function buscarUsuarioPorTelefono(prisma: PrismaService, crudo: string): Promise<User | null> {
  const variantes = variantesDeTelefono(crudo);
  const usuarios = await prisma.user.findMany({
    where: { phoneNumber: { in: variantes } },
    orderBy: { createdAt: 'asc' },
  });
  if (usuarios.length <= 1) return usuarios[0] ?? null;
  return usuarios.find((usuario) => usuario.phoneNumber === variantes[0]) ?? usuarios[0];
}
