import { cn } from "@/lib/cn";

/**
 * La vinculación por QR o código conecta a Trato como un "dispositivo
 * vinculado" (como WhatsApp Web), algo que WhatsApp no permite para
 * asistentes automáticos: puede bloquear el número. Se muestra en cada lugar
 * donde se ofrece ese camino y a quien ya lo usa, junto a la opción oficial.
 */
export function AvisoRiesgoBloqueo({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2.5 rounded-md border border-line bg-danger-subtle px-3.5 py-3 text-[13px] leading-[1.5] text-ink",
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-5 shrink-0 place-items-center rounded-full bg-danger text-[12px] font-bold text-white"
      >
        !
      </span>
      <div className="flex flex-col gap-2">
        <p>
          <strong className="font-semibold">Esta vinculación no es oficial.</strong> WhatsApp puede bloquear el número
          de forma temporal o definitiva por usarlo con un asistente automático. Para evitarlo, conectá tu WhatsApp
          Business con la API oficial de Meta.
        </p>
        {children}
      </div>
    </div>
  );
}
