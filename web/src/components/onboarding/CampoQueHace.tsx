"use client";

import { cn } from "@/lib/cn";
import {
  EJEMPLOS_QUE_HACE,
  MAX_QUE_HACE,
  MIN_QUE_HACE,
  type ModalidadVentaState,
} from "@/lib/modalidad-venta";
import { INPUT, chip } from "./controles";

const QUE_CONTAR = [
  { titulo: "Qué hacés y qué no", detalle: "\"Mesas y bibliotecas, no tapizados.\"" },
  { titulo: "Con qué trabajás", detalle: "Los materiales que el cliente puede elegir." },
  { titulo: "Para quién y dónde", detalle: "Zona de entrega, si vas a medir, etc." },
];

/**
 * "Contanos qué hacés" (LAU-21): lo que el asistente a pedido le cuenta a los
 * clientes y con lo que decide qué solicitudes tomar. Lo usan el wizard de
 * /contanos y la sección de /cuenta.
 */
export function CampoQueHace({ modalidad, conAyudas = true }: { modalidad: ModalidadVentaState; conAyudas?: boolean }) {
  const { queHace, largo, queHaceValido } = modalidad;
  return (
    <div className="max-w-[620px]">
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[13px] font-semibold text-ink-secondary">Empezar con un ejemplo:</span>
        {EJEMPLOS_QUE_HACE.map((ejemplo) => (
          <button
            key={ejemplo.id}
            type="button"
            aria-pressed={queHace === ejemplo.texto}
            onClick={() => modalidad.setQueHace(ejemplo.texto)}
            className={chip(queHace === ejemplo.texto)}
          >
            {ejemplo.label}
          </button>
        ))}
      </div>

      <label htmlFor="que-haces" className="mb-2 block text-[13px] font-semibold text-ink-secondary">
        ¿Qué hacés?
      </label>
      <textarea
        id="que-haces"
        value={queHace}
        onChange={(e) => modalidad.setQueHace(e.target.value)}
        maxLength={MAX_QUE_HACE * 2}
        rows={5}
        aria-describedby="que-haces-ayuda"
        placeholder="Ej.: Hacemos muebles de madera a medida: mesas, bibliotecas y racks. Trabajamos con paraíso y pino. Entregamos en CABA."
        className={cn(INPUT, "resize-y leading-[1.55]")}
      />
      <div id="que-haces-ayuda" className="mt-1.5 flex justify-between gap-3 text-[12.5px]">
        <span className={cn("font-semibold", queHaceValido ? "text-success-text" : "text-warning-text")}>
          {largo > MAX_QUE_HACE
            ? `Usá ${MAX_QUE_HACE} caracteres como mucho.`
            : queHaceValido
              ? "Listo, con esto alcanza para arrancar."
              : `Escribí al menos ${MIN_QUE_HACE} caracteres.`}
        </span>
        <span className="text-ink-secondary">
          {largo} / {MAX_QUE_HACE}
        </span>
      </div>

      {conAyudas && (
        <div className="mt-5">
          <p className="mb-2.5 text-[13px] font-semibold text-ink-secondary">Conviene que cuentes</p>
          <ul className="grid gap-2.5 sm:grid-cols-3">
            {QUE_CONTAR.map((item) => (
              <li key={item.titulo} className="flex flex-col gap-1 rounded-md border border-line bg-page px-3.5 py-3">
                <span className="text-[13.5px] font-bold text-ink">{item.titulo}</span>
                <span className="text-[12.5px] leading-[1.45] text-ink-secondary">{item.detalle}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
