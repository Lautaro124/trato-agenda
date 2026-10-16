"use client";

import type { ReactNode } from "react";

export type PreguntaParaVista = { texto: string; opciones: string[] };

/** Cuántas preguntas se muestran en el chat: alcanza para entender cómo pregunta. */
const PREGUNTAS_EN_CHAT = 2;

function listaEnCastellano(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} o ${items[items.length - 1]}`;
}


function Burbuja({ deCliente = false, children }: Readonly<{ deCliente?: boolean; children: ReactNode }>) {
  return (
    <div
      // Mismas burbujas que la vista previa del registro (VistaPreviaChat).
      className={
        deCliente
          ? "max-w-[85%] self-end rounded-[16px_16px_4px_16px] border border-[#c9e9d6] bg-accent-subtle px-3 py-2 text-[13px] leading-[1.45] text-ink"
          : "max-w-[88%] self-start rounded-[16px_16px_16px_4px] border border-line bg-card px-3 py-2 text-[13px] leading-[1.45] text-ink shadow-sm"
      }
    >
      {children}
    </div>
  );
}

function Opciones({ opciones }: Readonly<{ opciones: string[] }>) {
  if (opciones.length === 0) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {opciones.map((opcion) => (
        <span key={opcion} className="rounded-full border border-line-strong px-2 py-0.5 text-[12px]">
          {opcion}
        </span>
      ))}
    </span>
  );
}

/**
 * Cómo le va a preguntar el asistente al cliente por WhatsApp y qué le llega
 * al dueño para cotizar, armado con lo que se va cargando. Es una muestra: el
 * asistente escribe con sus palabras.
 */
export function VistaPreviaAMedida({
  nombre,
  materiales,
  desde,
  preguntas,
}: Readonly<{ nombre: string; materiales: string[]; desde: string | null; preguntas: PreguntaParaVista[] }>) {
  const producto = nombre.trim() || "tu producto";
  const escritas = preguntas.filter((p) => p.texto.trim().length > 0);
  // Los materiales no los nombra por su cuenta: sólo si el cliente pregunta (REGLA_A_MEDIDA en la API).
  const enChat = escritas.slice(0, PREGUNTAS_EN_CHAT);
  const restantes = escritas.length - enChat.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-line bg-card">
        <p className="border-b border-sunken px-3.5 py-2.5 text-[13px] font-bold text-ink">
          Así pregunta tu asistente <span className="font-normal text-success-text">· por WhatsApp</span>
        </p>
        <div className="flex flex-col gap-2 bg-page px-3.5 py-4">
          <Burbuja deCliente>Hola, quería consultar por {producto.toLowerCase()}</Burbuja>
          <Burbuja>
            ¡Hola! Sí, lo hacemos a medida.{" "}
            {desde
              ? `Arranca desde ${desde}; el precio final te lo paso con la cotización.`
              : "El precio te lo paso con la cotización."}
          </Burbuja>
          {enChat.length === 0 ? (
            <Burbuja>Contame qué necesitás y para cuándo lo querés.</Burbuja>
          ) : (
            enChat.map((pregunta, indice) => (
              <Burbuja key={`${pregunta.texto}-${indice}`}>
                {pregunta.texto}
                <Opciones opciones={pregunta.opciones} />
              </Burbuja>
            ))
          )}
          {restantes > 0 && (
            <p className="self-center rounded-full bg-card px-2.5 py-0.5 text-[11.5px] text-muted">
              … y {restantes === 1 ? "1 pregunta más" : `${restantes} preguntas más`}, de a una o dos por mensaje
            </p>
          )}
          {materiales.length > 0 && (
            <>
              <Burbuja deCliente>¿De qué material lo hacen?</Burbuja>
              <Burbuja>Lo hacemos en {listaEnCastellano(materiales)}.</Burbuja>
            </>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-card p-4">
        <p className="text-[11.5px] font-bold tracking-[0.04em] text-muted uppercase">Lo que te llega para cotizar</p>
        <dl className="mt-2 flex flex-col gap-1.5 text-[13px]">
          <div className="flex gap-2">
            <dt className="text-muted">Producto:</dt>
            <dd className="text-ink">{nombre.trim() || "—"}</dd>
          </div>
          {escritas.length === 0 ? (
            <>
              <div className="flex gap-2">
                <dt className="text-muted">Qué necesita:</dt>
                <dd className="text-ink-secondary italic">lo que te cuente</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted">Para cuándo:</dt>
                <dd className="text-ink-secondary italic">su respuesta</dd>
              </div>
            </>
          ) : (
            escritas.map((pregunta, indice) => (
              <div key={`${pregunta.texto}-${indice}`} className="flex gap-2">
                <dt className="min-w-0 truncate text-muted">{pregunta.texto}</dt>
                <dd className="shrink-0 text-ink-secondary italic">su respuesta</dd>
              </div>
            ))
          )}
          <div className="flex gap-2">
            <dt className="text-muted">Cliente:</dt>
            <dd className="text-ink-secondary italic">su nombre y su WhatsApp</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
