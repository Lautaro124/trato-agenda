"use client";

import { useState } from "react";
import { LARGO_MAX_BOT, LARGO_MAX_TITULAR, SUGERENCIAS_BOT } from "@/app/contanos/useOnboarding";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { INPUT, chip } from "./controles";

export type DatosVentas = { nombreTitular: string; nombreBot: string };

/**
 * Onboarding del asistente de ventas: el nombre del negocio y el del
 * asistente. No pide franja horaria (vende 24/7) ni tipos de evento: lo que
 * vende sale del catálogo, que se carga después en /productos.
 */
export function FormularioVentas({
  enviando,
  onFinalizar,
}: {
  enviando: boolean;
  onFinalizar: (datos: DatosVentas) => void;
}) {
  const [nombreTitular, setNombreTitular] = useState("");
  const [nombreBot, setNombreBot] = useState("");
  const completo = nombreTitular.trim().length >= 2 && nombreBot.trim().length >= 2;

  const negocio = nombreTitular.trim() || "tu negocio";
  const bot = nombreBot.trim() || "tu asistente";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (completo) onFinalizar({ nombreTitular: nombreTitular.trim(), nombreBot: nombreBot.trim() });
      }}
      className="flex w-full flex-col gap-5 rounded-lg border border-line bg-card p-5 shadow-md md:p-6"
    >
      <div>
        <Badge tone="primary">Paso 2 de 3</Badge>
        <h1 className="mt-3 mb-1 font-display text-[25px] leading-[1.18] font-bold tracking-[-0.02em] text-ink">
          Contanos de tu negocio
        </h1>
        <p className="text-sm leading-[1.6] text-ink-secondary">
          Tu asistente va a responder por WhatsApp las 24 horas: busca en tu catálogo, informa precio y stock, y
          manda el link de pago. Los productos los cargás en el paso siguiente, desde tu panel.
        </p>
      </div>

      <div>
        <label htmlFor="nombre-negocio" className="mb-2 block text-[12.5px] font-semibold text-ink-secondary">
          ¿Cómo se llama tu negocio?
        </label>
        <input
          id="nombre-negocio"
          value={nombreTitular}
          onChange={(e) => setNombreTitular(e.target.value)}
          maxLength={LARGO_MAX_TITULAR}
          placeholder="Ej.: Mates del Sur"
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor="nombre-asistente-ventas" className="mb-2 block text-[12.5px] font-semibold text-ink-secondary">
          ¿Cómo se llama tu asistente?
        </label>
        <input
          id="nombre-asistente-ventas"
          value={nombreBot}
          onChange={(e) => setNombreBot(e.target.value)}
          maxLength={LARGO_MAX_BOT}
          placeholder="Ej.: Nina"
          className={INPUT}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGERENCIAS_BOT.map((nombre) => (
            <button key={nombre} type="button" onClick={() => setNombreBot(nombre)} className={chip(nombreBot === nombre)}>
              {nombre}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12.5px] font-semibold text-ink-secondary">Así arranca la conversación</p>
        <div className="flex flex-col gap-2 rounded-md border border-line bg-sunken p-4">
          <div className="max-w-[80%] self-end rounded-[16px_16px_4px_16px] border border-[#c9e9d6] bg-accent-subtle px-[13px] py-[11px] text-[13.5px] leading-[1.5] text-ink">
            Hola, ¿tenés mates de calabaza?
          </div>
          <div className="max-w-[88%] self-start rounded-[16px_16px_16px_4px] border border-line bg-card px-[13px] py-[11px] text-[13.5px] leading-[1.5] text-ink shadow-sm">
            Hola, soy {bot}, el asistente de {negocio}. Sí, tengo el mate de calabaza curado a $ 8.000. ¿Te lo
            reservo?
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <span className="text-[12.5px] text-muted">Podés cambiar todo después</span>
        <Button type="submit" size="lg" disabled={!completo || enviando}>
          {enviando ? "Creando tu asistente…" : "Vincular WhatsApp"}
        </Button>
      </div>
    </form>
  );
}
