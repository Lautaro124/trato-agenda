import Link from "next/link";
import { EMAIL_SOPORTE } from "@/lib/contacto";
import { cn } from "@/lib/cn";

/**
 * Fila de enlaces legales. Va en todas las pantallas públicas, y en particular
 * en /entrar: es la pantalla que dispara el consentimiento de Google, y quien
 * revisa la verificación OAuth busca ahí el link a la política de privacidad.
 */
export function FooterLegal({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-line pt-4 text-[12.5px] text-muted",
        className,
      )}
    >
      <Link href="/privacidad" className="text-muted">
        Privacidad
      </Link>
      <Link href="/terminos" className="text-muted">
        Términos
      </Link>
      <a href={`mailto:${EMAIL_SOPORTE}`} className="text-muted">
        {EMAIL_SOPORTE}
      </a>
    </footer>
  );
}
