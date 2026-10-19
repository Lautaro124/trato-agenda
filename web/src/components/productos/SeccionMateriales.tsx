"use client";

import { ListaDePastillas } from "@/components/productos/ListaDePastillas";
import { EncabezadoDeSeccion } from "@/components/productos/SeccionSolicitud";
import { claveDeTexto, enUnaLinea, LARGO_MAX_MATERIAL, MAX_MATERIALES } from "@/lib/solicitud";

const IDEAS_DE_MATERIALES = ["Madera", "Melamina", "MDF", "Metal", "Vidrio", "Tela"];

/**
 * "¿En qué materiales lo hacés?" de un producto a medida: una lista de
 * pastillas. Opcional; el asistente ofrece sólo estos y le pregunta al
 * cliente cuál quiere.
 */
export function SeccionMateriales({
  numero,
  materiales,
  nuevo,
  onNuevo,
  onCambio,
}: Readonly<{
  numero: number;
  materiales: string[];
  /** Lo tipeado sin apretar Enter: al guardar también cuenta, como en las opciones. */
  nuevo: string;
  onNuevo: (texto: string) => void;
  onCambio: (materiales: string[]) => void;
}>) {
  const llena = materiales.length >= MAX_MATERIALES;
  const claves = new Set(materiales.map(claveDeTexto));
  const ideas = IDEAS_DE_MATERIALES.filter((idea) => !claves.has(claveDeTexto(idea)));

  const sumar = (texto: string) => {
    const material = enUnaLinea(texto);
    if (!material || llena) return;
    if (!claves.has(claveDeTexto(material))) onCambio([...materiales, material]);
    if (texto === nuevo) onNuevo("");
  };

  return (
    <section aria-label="Materiales" className="flex flex-col gap-3">
      <EncabezadoDeSeccion
        numero={numero}
        titulo="¿En qué materiales lo hacés?"
        opcional
        ayuda="Tu asistente ofrece sólo estos y le pregunta al cliente cuál quiere."
      />
      <div className="flex flex-col gap-2.5 sm:pl-10">
        <ListaDePastillas
          items={materiales}
          nombreLista="Materiales cargados"
          nombreNuevo="Nuevo material"
          placeholder="+ Material (Enter)"
          nuevo={nuevo}
          largoMaximo={LARGO_MAX_MATERIAL}
          llena={llena}
          onNuevo={onNuevo}
          onAgregar={() => sumar(nuevo)}
          onQuitar={(indice) => onCambio(materiales.filter((_, i) => i !== indice))}
        />
        {!llena && ideas.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] text-muted">Ideas:</span>
            {ideas.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => sumar(idea)}
                className="cursor-pointer rounded-full border border-line bg-card px-3 py-1 text-[13px] text-ink hover:border-line-strong"
              >
                + {idea}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
