"use client";

import { useLayoutEffect, useRef, type InputHTMLAttributes } from "react";
import { formatearNumeroEnEdicion, posicionTrasSignificativos, significativos } from "@/lib/numeros";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode"> & {
  value: string;
  /** Recibe el texto ya formateado ("1.500" o "1.500,50"). */
  onValueChange: (valor: string) => void;
  /** Acepta hasta dos decimales con coma (montos). */
  decimales?: boolean;
};

/**
 * Campo numérico con punto de miles mientras se escribe: "1.000",
 * "100.000", "1.000.000". El cursor queda donde estaba aunque se agreguen o
 * saquen puntos, y borrar justo sobre un punto borra el dígito de al lado.
 * Con `decimales`, un punto tipeado al final se toma como la coma decimal
 * (hay teclados del celular que sólo tienen punto).
 */
export function CampoNumero({ value, onValueChange, decimales = false, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const cursor = useRef<number | null>(null);
  const mostrado = formatearNumeroEnEdicion(value, decimales);

  useLayoutEffect(() => {
    const el = input.current;
    if (cursor.current !== null && el && document.activeElement === el) el.setSelectionRange(cursor.current, cursor.current);
    cursor.current = null;
  });

  return (
    <input
      {...props}
      ref={input}
      type="text"
      inputMode={decimales ? "decimal" : "numeric"}
      value={mostrado}
      onChange={(e) => {
        let texto = e.currentTarget.value;
        let posicion = e.currentTarget.selectionStart ?? texto.length;
        const tipo = (e.nativeEvent as InputEvent).inputType;

        if (decimales && !texto.includes(",") && posicion === texto.length && texto.endsWith(".")) {
          texto = `${texto.slice(0, -1)},`;
        } else if (formatearNumeroEnEdicion(texto, decimales) === mostrado) {
          // Sólo se borró un punto de miles: se borra el dígito que lo acompaña.
          if (tipo === "deleteContentBackward") {
            const antes = texto.slice(0, posicion).replace(/\d(?=\D*$)/, "");
            texto = antes + texto.slice(posicion);
            posicion = antes.length;
          } else if (tipo === "deleteContentForward") {
            texto = texto.slice(0, posicion) + texto.slice(posicion).replace(/\d/, "");
          }
        }

        const nuevo = formatearNumeroEnEdicion(texto, decimales);
        cursor.current = posicionTrasSignificativos(nuevo, significativos(texto.slice(0, posicion)));
        onValueChange(nuevo);
      }}
    />
  );
}
