import { cn } from "@/lib/cn";
import { partesDelTexto, type DefinicionMensaje, type MensajeConfigurado } from "@/lib/mensajes";

/**
 * Cómo le llega el mensaje al cliente por WhatsApp, con datos de ejemplo. Los
 * datos completados van resaltados para que se entienda qué cambia en cada charla.
 */
export function VistaPreviaMensaje({
  definicion,
  mensaje,
  datos,
  nombreBot,
  nombreTitular,
  className,
}: {
  definicion: DefinicionMensaje;
  mensaje: MensajeConfigurado;
  datos: Record<string, string>;
  nombreBot: string;
  nombreTitular: string;
  className?: string;
}) {
  const propio = mensaje.modo === "propio";
  const partes = partesDelTexto(propio ? mensaje.texto : definicion.ejemploAuto, datos);
  const nota = propio
    ? "Lo resaltado se completa con los datos de cada cliente."
    : definicion.fijo
      ? "Así le llega al cliente. Los datos son de ejemplo."
      : `Ejemplo: ${nombreBot} lo escribe distinto en cada charla.`;

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="overflow-hidden rounded-[20px] border border-line bg-card shadow-md">
        <div className="flex items-center gap-2.5 bg-success-text px-4 py-3 text-white">
          <span
            aria-hidden
            className="grid size-[34px] flex-none place-items-center rounded-full bg-success-subtle text-sm font-extrabold text-success-text"
          >
            {(nombreBot.trim()[0] ?? "A").toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[15px] font-bold">{nombreTitular || "Tu negocio"}</span>
            <span className="text-xs opacity-85">Responde {nombreBot}</span>
          </span>
        </div>
        <div className="flex min-h-[260px] flex-col gap-2.5 bg-[#efe7dc] px-3 pt-4 pb-5">
          <span className="self-center rounded-sm bg-page px-2.5 py-0.5 text-xs font-semibold text-ink-secondary">Hoy</span>
          <div className="max-w-[82%] self-start rounded-[4px_12px_12px_12px] bg-card px-3 py-2 text-sm text-ink shadow-sm">
            {definicion.ejemploCliente}
          </div>
          <div className="max-w-[86%] self-end rounded-[12px_4px_12px_12px] bg-[#d9f3e2] px-3 py-2 text-sm text-ink shadow-sm">
            <p className="whitespace-pre-line [overflow-wrap:anywhere]">
              {partes.map((parte, indice) =>
                parte.dato ? (
                  <mark key={indice} className="rounded-[4px] bg-[var(--color-primitive-coral-100)] font-bold text-ink">
                    {parte.texto}
                  </mark>
                ) : (
                  <span key={indice}>{parte.texto}</span>
                ),
              )}
            </p>
          </div>
        </div>
      </div>
      <p className="text-[13px] text-ink-secondary">{nota}</p>
    </div>
  );
}
