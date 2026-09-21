"use client";

import { INPUT_FORM } from "@/lib/password";
import { PAISES, limpiarNacional, paisPorIso, type Pais } from "@/lib/telefono";
import { cn } from "@/lib/cn";

type CampoTelefonoProps = {
  pais: Pais;
  onPais: (pais: Pais) => void;
  nacional: string;
  onNacional: (nacional: string) => void;
  autoFocus?: boolean;
  className?: string;
};

/**
 * País y número en dos controles: nadie tiene que acordarse de escribir el
 * "+54". El valor que viaja al API lo arma `telefonoCompleto` en quien lo usa.
 */
export function CampoTelefono({
  pais,
  onPais,
  nacional,
  onNacional,
  autoFocus = false,
  className,
}: CampoTelefonoProps) {
  return (
    <div className={cn("flex gap-2", className)}>
      <select
        value={pais.iso}
        onChange={(e) => onPais(paisPorIso(e.target.value))}
        aria-label="País"
        className={cn(INPUT_FORM, "!w-20 shrink-0 cursor-pointer px-2 pr-0 text-[13px]")}
      >
        {PAISES.map((opcion) => (
          <option key={opcion.iso} value={opcion.iso}>
            {opcion.bandera} +{opcion.prefijo}
          </option>
        ))}
      </select>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        autoFocus={autoFocus}
        value={nacional}
        onChange={(e) => onNacional(limpiarNacional(pais, e.target.value))}
        placeholder="11 2233 4455"
        aria-label="Número de WhatsApp"
        required
        className={cn(INPUT_FORM, "min-w-0 flex-1")}
      />
    </div>
  );
}
