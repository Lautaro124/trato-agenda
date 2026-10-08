import { cn } from "@/lib/cn";
import type { ClaveMensaje, DefinicionMensaje, MensajeConfigurado, Validacion } from "@/lib/mensajes";

type Fila = { definicion: DefinicionMensaje; mensaje: MensajeConfigurado; validacion: Validacion };

function insignia({ definicion, mensaje, validacion }: Fila): { texto: string; clase: string } {
  if (validacion.error) return { texto: "Revisar", clase: "bg-danger-subtle text-danger-text" };
  if (mensaje.modo === "propio") return { texto: "Tu texto", clase: "bg-success-subtle text-success-text" };
  return { texto: definicion.fijo ? "Estándar" : "Automático", clase: "bg-sunken text-ink-secondary" };
}

/** Los mensajes que se pueden personalizar, con su estado de un vistazo. */
export function ListaMensajes({
  filas,
  seleccion,
  onElegir,
  className,
}: {
  filas: Fila[];
  seleccion: ClaveMensaje;
  onElegir: (clave: ClaveMensaje) => void;
  className?: string;
}) {
  return (
    <nav aria-label="Mensajes" className={cn("flex flex-col gap-2", className)}>
      {filas.map((fila) => {
        const activo = fila.definicion.clave === seleccion;
        const { texto, clase } = insignia(fila);
        return (
          <button
            key={fila.definicion.clave}
            type="button"
            aria-current={activo ? "true" : undefined}
            onClick={() => onElegir(fila.definicion.clave)}
            className={cn(
              "flex flex-col gap-1.5 rounded-md border-[1.5px] px-4 py-3.5 text-left transition-colors",
              activo ? "border-primary bg-primary-subtle" : "border-line bg-card hover:bg-sunken",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[15px] font-bold text-ink">{fila.definicion.nombre}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap", clase)}>{texto}</span>
            </span>
            <span className="text-[13px] text-ink-secondary">{fila.definicion.descripcion}</span>
          </button>
        );
      })}
    </nav>
  );
}
