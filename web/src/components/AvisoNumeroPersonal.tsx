import { cn } from "@/lib/cn";

/**
 * Antes de vincular, con QR o con código: el asistente contesta todos los
 * chats individuales del número vinculado, así que en un celular personal
 * también les contestaría a amigos y familia (LAU-11).
 */
export function AvisoNumeroPersonal({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2.5 rounded-md border border-line bg-warning-subtle px-3.5 py-3 text-[13px] leading-[1.5] text-ink",
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-5 shrink-0 place-items-center rounded-full bg-warning text-[12px] font-bold text-warning-text"
      >
        !
      </span>
      <p>
        <strong className="font-semibold">No te recomendamos usar tu celular personal.</strong> Vinculá un WhatsApp
        del negocio: el asistente contesta todos los chats individuales de ese número, también los de amigos y
        familia.
      </p>
    </div>
  );
}
