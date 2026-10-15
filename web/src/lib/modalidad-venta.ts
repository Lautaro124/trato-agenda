"use client";

import { useState } from "react";

/**
 * Modalidad de venta del asistente de ventas (LAU-21): con stock (dice precio
 * y stock, reserva y manda el link) o a pedido (toma la solicitud y se la pasa
 * al dueño para que la cotice). Espejo de api/src/agents/modalidad-venta.ts:
 * los límites son los del backend, así que superarlos acá sería un 400.
 */

export type ModalidadVenta = "stock" | "pedido";

export const MIN_QUE_HACE = 30;
export const MAX_QUE_HACE = 600;

export const ETIQUETA_MODALIDAD: Record<ModalidadVenta, string> = {
  stock: "Con stock",
  pedido: "A pedido",
};

/** Ejemplos para no arrancar de una hoja en blanco en "Qué hacés". */
export const EJEMPLOS_QUE_HACE: Array<{ id: string; label: string; texto: string }> = [
  {
    id: "muebles",
    label: "Muebles a medida",
    texto:
      "Hacemos muebles de madera a medida: mesas, bibliotecas, racks y placares. Trabajamos con paraíso, pino y melamina. Entregamos en CABA y zona norte.",
  },
  {
    id: "tortas",
    label: "Tortas",
    texto:
      "Hago tortas, cookies y mesas dulces por encargo para cumpleaños y eventos. Trabajo con buttercream y fondant. Se retiran por mi casa o hago envíos en la zona.",
  },
  {
    id: "herreria",
    label: "Herrería",
    texto:
      "Hacemos rejas, portones, escaleras y estructuras de hierro a medida. Trabajamos con caño estructural, hierro macizo y chapa. Vamos a medir a domicilio.",
  },
  {
    id: "imprenta",
    label: "Imprenta",
    texto:
      "Imprimimos tarjetas, folletos, stickers y lonas, en pocas o muchas unidades. Trabajamos papel ilustración, vinilo y lona. Enviamos a todo el país.",
  },
];

/** Igual que normalizarQueHace de la API: lo que se cuenta es el texto sin espacios de más. */
export function largoQueHace(texto: string): number {
  return texto.replace(/\s+/g, " ").trim().length;
}

/** Lo que viaja en `POST /agents/generate-ventas` y `PUT /agents/me/modalidad`. */
export type PayloadModalidad = { modalidadVenta: ModalidadVenta; queHace?: string };

/**
 * Estado de la modalidad y de "Qué hacés". Lo usan los pasos del wizard y la
 * sección de /cuenta, que muestran los mismos controles sobre el mismo estado.
 */
export function useModalidadVenta(inicial?: { modalidadVenta: ModalidadVenta; queHace: string | null }) {
  const [modalidad, setModalidad] = useState<ModalidadVenta>(inicial?.modalidadVenta ?? "stock");
  const [queHace, setQueHace] = useState(inicial?.queHace ?? "");
  const largo = largoQueHace(queHace);
  const queHaceValido = largo >= MIN_QUE_HACE && largo <= MAX_QUE_HACE;
  const aPedido = modalidad === "pedido";

  return {
    modalidad,
    setModalidad,
    aPedido,
    queHace,
    setQueHace,
    largo,
    queHaceValido,
    /** Con stock "qué hacés" no hace falta; a pedido, sí. */
    valido: !aPedido || queHaceValido,
    resumen: ETIQUETA_MODALIDAD[modalidad],
    resumenQueHace: queHace.trim().length > 32 ? `${queHace.trim().slice(0, 30)}…` : queHace.trim(),
    /** A pedido manda el texto; con stock no lo toca (queda el que estaba guardado). */
    payload: (): PayloadModalidad => (aPedido ? { modalidadVenta: modalidad, queHace } : { modalidadVenta: modalidad }),
  };
}

export type ModalidadVentaState = ReturnType<typeof useModalidadVenta>;
