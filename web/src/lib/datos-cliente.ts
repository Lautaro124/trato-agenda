"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Los datos que el asistente de ventas le pide al cliente antes de crear el
 * pedido. Espejo de api/src/comercio/datos-cliente.rules.ts: los límites son
 * los del DTO, así que superarlos acá sería un 400.
 */

export type TipoCampoEstandar = "codigoPostal" | "direccion" | "provincia" | "pais" | "email" | "dni";
export type TipoCampo = TipoCampoEstandar | "personalizado";

export const CAMPOS_ESTANDAR: Array<{ tipo: TipoCampoEstandar; etiqueta: string }> = [
  { tipo: "codigoPostal", etiqueta: "Código postal" },
  { tipo: "direccion", etiqueta: "Dirección" },
  { tipo: "provincia", etiqueta: "Provincia" },
  { tipo: "pais", etiqueta: "País" },
  { tipo: "email", etiqueta: "Email" },
  { tipo: "dni", etiqueta: "DNI" },
];

export const MAX_CAMPOS_PERSONALIZADOS = 5;
export const LARGO_MIN_ETIQUETA = 2;
export const LARGO_MAX_ETIQUETA = 40;

/** Un campo como lo devuelve `GET /agents/me` (los estándar ya traen su etiqueta). */
export type CampoCliente = { tipo: TipoCampo; etiqueta: string; obligatorio: boolean };

/** Lo que viaja en `POST /agents/generate-ventas` y `PUT /agents/me/datos-cliente`. */
export type PayloadDatosCliente = {
  haceEnvios: boolean;
  datosCliente: Array<{ tipo: TipoCampo; etiqueta?: string; obligatorio: boolean }>;
};

/** "Código Postal" y "codigo postal" son el mismo campo. */
function clave(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const CLAVES_ESTANDAR = new Set(CAMPOS_ESTANDAR.map((campo) => clave(campo.etiqueta)));

/** "No pide datos", "Envíos · 3 datos", "2 datos": lo que muestra el riel del wizard. */
export function resumenDatosCliente(haceEnvios: boolean, cantidad: number): string {
  const datos = `${cantidad} ${cantidad === 1 ? "dato" : "datos"}`;
  if (haceEnvios) return cantidad > 0 ? `Envíos · ${datos}` : "Hace envíos";
  return cantidad > 0 ? datos : "Sólo el nombre";
}

/**
 * Estado del editor de datos del cliente. Lo usan el paso del wizard y la
 * sección de /cuenta, que muestran los mismos controles sobre el mismo estado.
 */
export function useDatosCliente(inicial?: { haceEnvios: boolean; datosCliente: CampoCliente[] }) {
  const [haceEnvios, setHaceEnvios] = useState(inicial?.haceEnvios ?? false);
  /** tipo estándar → obligatorio. Sólo los tildados. */
  const [estandar, setEstandar] = useState<Partial<Record<TipoCampoEstandar, boolean>>>(() =>
    Object.fromEntries(
      (inicial?.datosCliente ?? [])
        .filter((campo) => campo.tipo !== "personalizado")
        .map((campo) => [campo.tipo, campo.obligatorio]),
    ),
  );
  const [personalizados, setPersonalizados] = useState<Array<{ etiqueta: string; obligatorio: boolean }>>(() =>
    (inicial?.datosCliente ?? [])
      .filter((campo) => campo.tipo === "personalizado")
      .map(({ etiqueta, obligatorio }) => ({ etiqueta, obligatorio })),
  );
  const [nuevo, setNuevo] = useState("");
  const [avisoNuevo, setAvisoNuevo] = useState<string | null>(null);

  const alternarEstandar = useCallback((tipo: TipoCampoEstandar) => {
    setEstandar((previos) => {
      if (previos[tipo] !== undefined) {
        const resto = { ...previos };
        delete resto[tipo];
        return resto;
      }
      // Recién tildado arranca obligatorio: es lo que casi siempre se quiere para un envío.
      return { ...previos, [tipo]: true };
    });
  }, []);

  const fijarObligatorioEstandar = useCallback((tipo: TipoCampoEstandar, obligatorio: boolean) => {
    setEstandar((previos) => (previos[tipo] === undefined ? previos : { ...previos, [tipo]: obligatorio }));
  }, []);

  const fijarObligatorioPersonalizado = useCallback((etiqueta: string, obligatorio: boolean) => {
    setPersonalizados((previos) =>
      previos.map((campo) => (campo.etiqueta === etiqueta ? { ...campo, obligatorio } : campo)),
    );
  }, []);

  const quitarPersonalizado = useCallback((etiqueta: string) => {
    setPersonalizados((previos) => previos.filter((campo) => campo.etiqueta !== etiqueta));
  }, []);

  const personalizadosLlenos = personalizados.length >= MAX_CAMPOS_PERSONALIZADOS;

  const agregarPersonalizado = useCallback(() => {
    const etiqueta = nuevo.replace(/\s+/g, " ").trim().slice(0, LARGO_MAX_ETIQUETA);
    if (etiqueta.length < LARGO_MIN_ETIQUETA) {
      setAvisoNuevo(`Escribí al menos ${LARGO_MIN_ETIQUETA} letras.`);
      return;
    }
    const nueva = clave(etiqueta);
    if (CLAVES_ESTANDAR.has(nueva) || personalizados.some((campo) => clave(campo.etiqueta) === nueva)) {
      setAvisoNuevo("Ese dato ya está en la lista.");
      return;
    }
    if (personalizados.length >= MAX_CAMPOS_PERSONALIZADOS) return;
    setPersonalizados((previos) => [...previos, { etiqueta, obligatorio: true }]);
    setNuevo("");
    setAvisoNuevo(null);
  }, [nuevo, personalizados]);

  const cambiarNuevo = useCallback((texto: string) => {
    setNuevo(texto);
    setAvisoNuevo(null);
  }, []);

  /** Los campos elegidos, en el orden de la lista: estándar primero, después los propios. */
  const campos: CampoCliente[] = useMemo(
    () => [
      ...CAMPOS_ESTANDAR.filter((campo) => estandar[campo.tipo] !== undefined).map((campo) => ({
        ...campo,
        obligatorio: estandar[campo.tipo] as boolean,
      })),
      ...personalizados.map((campo) => ({ tipo: "personalizado" as const, ...campo })),
    ],
    [estandar, personalizados],
  );

  const payload = useCallback(
    (): PayloadDatosCliente => payloadDatosCliente({ haceEnvios, datosCliente: campos }),
    [haceEnvios, campos],
  );

  return {
    haceEnvios,
    setHaceEnvios,
    estandar,
    alternarEstandar,
    fijarObligatorioEstandar,
    personalizados,
    fijarObligatorioPersonalizado,
    quitarPersonalizado,
    nuevo,
    cambiarNuevo,
    agregarPersonalizado,
    avisoNuevo,
    personalizadosLlenos,
    campos,
    payload,
    resumen: resumenDatosCliente(haceEnvios, campos.length),
  };
}

export type DatosClienteState = ReturnType<typeof useDatosCliente>;

/**
 * El body que corresponde a una config, en el orden del editor (estándar en
 * el orden de la lista, después los propios). Así lo guardado y lo que hay en
 * pantalla se comparan sin que el orden cuente como cambio.
 */
export function payloadDatosCliente(config: { haceEnvios: boolean; datosCliente: CampoCliente[] }): PayloadDatosCliente {
  const estandar = CAMPOS_ESTANDAR.flatMap(({ tipo }) =>
    config.datosCliente.filter((campo) => campo.tipo === tipo).slice(0, 1).map((campo) => ({ tipo, obligatorio: campo.obligatorio })),
  );
  const propios = config.datosCliente
    .filter((campo) => campo.tipo === "personalizado")
    .map(({ etiqueta, obligatorio }) => ({ tipo: "personalizado" as const, etiqueta, obligatorio }));
  return { haceEnvios: config.haceEnvios, datosCliente: [...estandar, ...propios] };
}

/** Para saber si lo que hay en pantalla difiere de lo guardado. */
export function firmaDatosCliente(payload: PayloadDatosCliente): string {
  return JSON.stringify(payload);
}
