"use client";

import { useState } from "react";
import { conCorte, sinCorte, type SemanaState } from "@/app/contanos/useSemana";
import { HORARIOS_TIPICOS, HORAS_ATENCION } from "@/lib/horario-atencion";
import { cruzaMedianoche, DIAS_SEMANA, NOMBRE_DIA, type DiaEnPantalla, type SemanaEnPantalla } from "@/lib/local";
import { chip, INPUT } from "./controles";
import { SelectorZona, TEXTOS_ASISTENTE } from "./ControlesHorarioAtencion";
import { EditorSemana } from "./EditorSemana";

type Franjas = DiaEnPantalla["franjas"];

const BOTON_TEXTO = "min-h-11 cursor-pointer text-[13px] font-semibold hover:underline";

function clave(franjas: Franjas): string {
  return franjas.map(({ desde, hasta }) => `${desde}-${hasta}`).join(",");
}

/**
 * El horario general: el que más se repite entre los días que atienden (o en
 * toda la semana, si no atiende ninguno). Los días con otro son "distintos" y
 * se ajustan en el editor día por día.
 */
function horarioGeneral(semana: SemanaEnPantalla): Franjas {
  const abiertos = DIAS_SEMANA.filter((dia) => semana[dia].abierto);
  const veces = new Map<string, { franjas: Franjas; veces: number }>();
  for (const dia of abiertos.length > 0 ? abiertos : DIAS_SEMANA) {
    const { franjas } = semana[dia];
    const previa = veces.get(clave(franjas));
    veces.set(clave(franjas), { franjas, veces: (previa?.veces ?? 0) + 1 });
  }
  let general: { franjas: Franjas; veces: number } | undefined;
  for (const opcion of veces.values()) if (!general || opcion.veces > general.veces) general = opcion;
  return general!.franjas;
}

function SelectorHora({
  id,
  valor,
  onChange,
  etiqueta,
}: Readonly<{ id: string; valor: string; onChange: (hora: string) => void; etiqueta: string }>) {
  // Una hora guardada que no está en la grilla (09:15 de los horarios del local) se sigue mostrando.
  const opciones = HORAS_ATENCION.includes(valor)
    ? HORAS_ATENCION
    : [...HORAS_ATENCION, valor].sort((a, b) => a.localeCompare(b));
  return (
    <div className="flex-1">
      <label htmlFor={id} className="mb-2 block text-[12.5px] font-semibold text-ink-secondary">
        {etiqueta}
      </label>
      <select id={id} value={valor} onChange={(e) => onChange(e.target.value)} className={INPUT}>
        {opciones.map((hora) => (
          <option key={hora} value={hora}>
            {hora}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * El paso "Cuándo atiende" del onboarding (LAU-29): atender siempre o en un
 * horario que se carga de un toque (un horario típico, los días y una sola
 * franja para todos). Los días que atienden distinto se ajustan con el mismo
 * editor día por día de /cuenta.
 */
export function PasoCuandoAtiende({
  semana,
  zona,
  onZona,
  siempre,
  onSiempre,
}: Readonly<{
  semana: SemanaState;
  zona: string;
  onZona: (zona: string) => void;
  siempre: boolean;
  onSiempre: (siempre: boolean) => void;
}>) {
  const general = horarioGeneral(semana.semana);
  const claveGeneral = clave(general);
  const distintos = DIAS_SEMANA.filter(
    (dia) => semana.semana[dia].abierto && clave(semana.semana[dia].franjas) !== claveGeneral,
  );
  const problemaGeneral = DIAS_SEMANA.map((dia) => semana.problemas[dia]).find(Boolean);
  // Con días distintos (los horarios del local, por ejemplo) o un problema en uno, el editor arranca abierto.
  const [porDia, setPorDia] = useState(distintos.length > 0);
  const verPorDia = porDia || distintos.some((dia) => semana.problemas[dia]);

  /** Cambia el horario general en todos los días que lo tienen, abran o no. */
  const fijarGeneral = (franjas: Franjas) =>
    semana.fijarDias(
      Object.fromEntries(
        DIAS_SEMANA.filter((dia) => clave(semana.semana[dia].franjas) === claveGeneral).map((dia) => [
          dia,
          { ...semana.semana[dia], franjas },
        ]),
      ),
    );

  const fijarHora = (indice: number, campo: "desde" | "hasta", hora: string) =>
    fijarGeneral(general.map((franja, i) => (i === indice ? { ...franja, [campo]: hora } : franja)));

  const conCorteGeneral = general.length > 1;
  const partes = conCorteGeneral ? ["Mañana", "Tarde"] : [""];
  // De 19:00 a 07:00: atiende de noche y no hay mediodía que cortar.
  const nocturnaGeneral = !conCorteGeneral && cruzaMedianoche(general[0]);

  return (
    <div className="flex flex-col gap-5">
      <label className="flex cursor-pointer items-center gap-3.5 rounded-md border border-line bg-page px-3.5 py-3">
        <span className="flex flex-1 flex-col gap-0.5">
          <span id="atender-siempre" className="text-[14px] font-semibold text-ink">
            Atender todos los días, todo el día
          </span>
          <span id="atender-siempre-ayuda" className="text-[13px] leading-[1.5] text-ink-secondary">
            {siempre ? "Contesta a cualquier hora, sin límite de horario." : "Apagado: elegí los días y el horario."}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={siempre}
          onChange={(e) => onSiempre(e.target.checked)}
          aria-labelledby="atender-siempre"
          aria-describedby="atender-siempre-ayuda"
          className="relative h-7 w-12 flex-none cursor-pointer appearance-none rounded-full bg-line-strong transition-colors before:absolute before:top-[3px] before:left-[3px] before:size-[22px] before:rounded-full before:bg-card before:shadow-sm before:transition-[left] checked:bg-primary checked:before:left-[23px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-semantic-border-focus)]"
        />
      </label>

      {!siempre && (
        <>
          <div>
            <p className="mb-2 text-[13px] font-semibold text-ink-secondary">Empezá con</p>
            <div className="flex flex-wrap gap-2">
              {HORARIOS_TIPICOS.map((tipico) => {
                const elegido = DIAS_SEMANA.every((dia) => {
                  const { abierto, franjas } = semana.semana[dia];
                  const atiende = tipico.dias.includes(dia);
                  return abierto === atiende && (!atiende || clave(franjas) === `${tipico.desde}-${tipico.hasta}`);
                });
                return (
                  <button
                    key={tipico.etiqueta}
                    type="button"
                    aria-pressed={elegido}
                    onClick={() =>
                      semana.fijarDias(
                        Object.fromEntries(
                          DIAS_SEMANA.map((dia) => [
                            dia,
                            { abierto: tipico.dias.includes(dia), franjas: [{ desde: tipico.desde, hasta: tipico.hasta }] },
                          ]),
                        ),
                      )
                    }
                    className={chip(elegido)}
                  >
                    {tipico.etiqueta} · {tipico.desde}–{tipico.hasta}
                  </button>
                );
              })}
            </div>
          </div>

          <fieldset className="min-w-0">
            <legend className="mb-2 text-[13px] font-semibold text-ink-secondary">Qué días atiende</legend>
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {DIAS_SEMANA.map((dia) => {
                const { abierto } = semana.semana[dia];
                return (
                  <button
                    key={dia}
                    type="button"
                    aria-pressed={abierto}
                    aria-label={NOMBRE_DIA[dia]}
                    onClick={() => semana.alternarDia(dia)}
                    className={`${chip(abierto)} min-h-11 px-0`}
                  >
                    {NOMBRE_DIA[dia].slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <div className="flex flex-col gap-3">
              {general.map((franja, indice) => {
                const parte = partes[indice];
                const prefijo = parte ? `${parte}: ` : "";
                return (
                  <div key={parte} className="flex items-end gap-4">
                    <SelectorHora
                      id={`atencion-desde-${indice}`}
                      etiqueta={`${prefijo}Desde`}
                      valor={franja.desde}
                      onChange={(hora) => fijarHora(indice, "desde", hora)}
                    />
                    <span className="pb-3.5 text-sm text-muted">a</span>
                    <SelectorHora
                      id={`atencion-hasta-${indice}`}
                      etiqueta={`${prefijo}Hasta`}
                      valor={franja.hasta}
                      onChange={(hora) => fijarHora(indice, "hasta", hora)}
                    />
                  </div>
                );
              })}
            </div>
            {nocturnaGeneral && (
              <p className="mt-2 text-[12.5px] text-ink-secondary">
                Termina a las {general[0].hasta} del día siguiente: cada día marcado es la noche que empieza ese día.
              </p>
            )}
            {problemaGeneral && !verPorDia && (
              <p role="alert" className="mt-2 text-[12.5px] text-danger-text">
                {problemaGeneral}
              </p>
            )}
            <div className="mt-1 flex flex-wrap gap-x-4">
              {!nocturnaGeneral && (
                <button
                  type="button"
                  onClick={() => fijarGeneral(conCorteGeneral ? sinCorte(general) : conCorte(general))}
                  className={`${BOTON_TEXTO} text-primary-hover`}
                >
                  {conCorteGeneral ? "Sin corte" : "Cierra al mediodía"}
                </button>
              )}
              <button
                type="button"
                aria-expanded={verPorDia}
                onClick={() => setPorDia(!verPorDia)}
                className={`${BOTON_TEXTO} text-ink-secondary`}
              >
                {verPorDia ? "Ocultar el horario por día" : "Algún día atiende distinto"}
              </button>
            </div>
          </div>

          {verPorDia && (
            <EditorSemana semana={semana} leyenda="Día por día" textos={TEXTOS_ASISTENTE} horas={HORAS_ATENCION} />
          )}

          <SelectorZona zona={zona} onZona={onZona} />
        </>
      )}
    </div>
  );
}
