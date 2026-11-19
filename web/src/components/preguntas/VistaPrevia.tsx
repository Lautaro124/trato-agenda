"use client";

import { opcionesDeRama, urlImagenPregunta, type PreguntaPedido } from "@/lib/preguntas";

function Burbuja({ children, delCliente = false }: Readonly<{ children: React.ReactNode; delCliente?: boolean }>) {
  return (
    <div
      className={
        delCliente
          ? "max-w-[80%] self-end rounded-[12px_4px_12px_12px] bg-success-subtle px-3 py-2 text-[14px] text-ink shadow-sm"
          : "max-w-[88%] self-start rounded-[4px_12px_12px_12px] bg-card px-3 py-2 text-[14px] whitespace-pre-line text-ink shadow-sm"
      }
    >
      {children}
    </div>
  );
}

/**
 * Cómo le llega la pregunta al cliente por WhatsApp, con las opciones de la
 * rama elegida en el editor. Es una muestra: el asistente la dice con sus
 * palabras.
 */
export function VistaPrevia({
  pregunta,
  todas,
  rama,
}: Readonly<{ pregunta: PreguntaPedido; todas: PreguntaPedido[]; rama: string | null }>) {
  const padre = pregunta.dependeDe ? todas.find((otra) => otra.id === pregunta.dependeDe?.preguntaId) : undefined;
  const elegida = padre ? (padre.opciones.find((opcion) => opcion.id === rama) ?? padre.opciones[0]) : undefined;
  const opciones =
    pregunta.tipo === "opciones"
      ? opcionesDeRama(pregunta.opciones, padre ? (elegida?.id ?? null) : null).filter((opcion) => opcion.texto.trim())
      : [];
  const nombres = opciones.map((opcion) => opcion.texto.trim().toLocaleLowerCase("es"));
  const enumeradas = nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} o ${nombres.at(-1)}` : (nombres[0] ?? "");
  const conImagen = [
    ...(pregunta.imagenId ? [{ id: pregunta.imagenId, texto: pregunta.texto.trim() }] : []),
    ...opciones.flatMap((opcion) => (opcion.imagenId ? [{ id: opcion.imagenId, texto: opcion.texto.trim() }] : [])),
  ];

  const ejemplo = pregunta.tipo === "texto" ? "Es para regalo, ¿lo pueden envolver?" : "¿Puede ser en otro?";
  const respuesta =
    pregunta.tipo === "texto"
      ? "Perfecto, lo dejo anotado en el pedido."
      : pregunta.otra
        ? "Lo anoto como pedido especial. El negocio te confirma si se puede."
        : `Por ahora tenemos ${enumeradas || "esas opciones"}. ¿Cuál preferís?`;

  return (
    <section aria-labelledby="vista-previa" className="flex min-w-0 flex-col gap-2.5">
      <div>
        <h2 id="vista-previa" className="font-display text-[15px] font-bold text-ink">
          Así lo ve el cliente
        </h2>
        <p className="text-[13px] text-ink-secondary">
          {padre && elegida ? `Si antes eligió ${elegida.texto.trim().toLocaleLowerCase("es") || "esa opción"}.` : "Un ejemplo de la charla."}
        </p>
      </div>
      <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-sunken p-3.5" aria-label="Ejemplo de chat">
        <Burbuja>
          {pregunta.texto.trim() || "Tu pregunta"}
          {pregunta.tipo === "texto" && pregunta.ayuda?.trim() ? `\n${pregunta.ayuda.trim()}` : ""}
        </Burbuja>
        {conImagen.length > 0 && (
          <div className="grid max-w-[88%] grid-cols-2 gap-1.5 self-start rounded-[4px_12px_12px_12px] bg-card p-1.5 shadow-sm">
            {conImagen.map((imagen) => (
              <figure key={imagen.id} className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- la sirve la API con la cookie de sesión */}
                <img src={urlImagenPregunta(imagen.id)} alt="" className="h-16 w-full rounded-[6px] object-cover" />
                <figcaption className="px-0.5 text-[12.5px] font-semibold text-ink">{imagen.texto}</figcaption>
              </figure>
            ))}
          </div>
        )}
        {pregunta.tipo === "opciones" && (
          <Burbuja>
            {enumeradas ? `Podés elegir ${enumeradas}.` : "Todavía no hay opciones para esta respuesta."}
            {pregunta.otra ? `\nSi querés otra cosa, escribí “${pregunta.otra.etiqueta.trim() || "Otro"}” y contame.` : ""}
          </Burbuja>
        )}
        <Burbuja delCliente>{ejemplo}</Burbuja>
        <Burbuja>{respuesta}</Burbuja>
      </div>
      {(pregunta.tipo === "texto" || pregunta.otra) && (
        <div className="flex flex-col gap-1 rounded-md border border-line bg-card px-3.5 py-3">
          <span className="text-[12px] font-bold text-ink-secondary">Nota en el pedido</span>
          <span className="text-[14px] text-ink">
            {pregunta.tipo === "texto"
              ? `“${pregunta.texto.trim() || "Tu pregunta"}”: ${ejemplo}`
              : `Pedido especial en “${pregunta.texto.trim() || "Tu pregunta"}”: lo que pidió${elegida ? ` (${padre?.texto.trim()} ${elegida.texto.trim()})` : ""}`}
          </span>
        </div>
      )}
      {pregunta.tipo === "opciones" && !pregunta.otra && (
        <p className="rounded-md bg-warning-subtle px-3 py-2.5 text-[13px] text-warning-text">
          Sin “Aceptar otra opción”, una respuesta fuera de la lista no se guarda: el asistente vuelve a ofrecer las opciones.
        </p>
      )}
    </section>
  );
}
