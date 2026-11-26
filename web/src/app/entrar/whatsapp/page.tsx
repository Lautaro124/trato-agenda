import { redirect } from "next/navigation";

/**
 * Crear la cuenta escaneando el QR quedó cerrado: las cuentas nuevas se crean
 * con Google y conectan WhatsApp Business por la API oficial. La ruta queda
 * para quien tenga el enlace guardado.
 */
export default function EntrarConWhatsappPage(): never {
  redirect("/entrar");
}
