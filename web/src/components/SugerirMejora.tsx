"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  ErrorDeApi,
  MAX_CARACTERES,
  TIPOS_SUGERENCIA,
  enviarSugerencia,
  validarSugerencia,
  type TipoSugerencia,
} from "@/lib/sugerencias";

export function Lamparita({ size }: Readonly<{ size: number }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z" />
    </svg>
  );
}

const FOCUSABLES = 'button:not([disabled]), textarea, input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Botón "Sugerir mejora" del header en escritorio (LAU-14). En el celular el
 * header no tiene lugar y se llega desde el menú de la cuenta; los dos abren
 * el mismo `PanelSugerencia`, que maneja AppHeader.
 */
export function BotonSugerirMejora({ abierto, onAbrir }: Readonly<{ abierto: boolean; onAbrir: () => void }>) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-haspopup="dialog"
      aria-expanded={abierto}
      className="hidden h-9 cursor-pointer items-center gap-2 rounded-full border border-[var(--color-primitive-coral-200)] bg-primary-subtle px-3.5 text-[13.5px] font-semibold text-primary-active hover:bg-[var(--color-primitive-coral-100)] md:flex"
    >
      <Lamparita size={16} />
      Sugerir mejora
    </button>
  );
}

/**
 * El formulario. Solo texto, validado acá con la misma regla que la API
 * (lib/sugerencias.ts). El usuario no ve qué pasa después con la sugerencia:
 * sólo que llegó.
 */
export function PanelSugerencia({ onCerrar }: Readonly<{ onCerrar: () => void }>) {
  const titulo = useId();
  const idAyuda = useId();
  const idError = useId();
  const panel = useRef<HTMLDivElement>(null);
  const primerCampo = useRef<HTMLInputElement>(null);

  const [tipo, setTipo] = useState<TipoSugerencia>("idea");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);
  const [errorApi, setErrorApi] = useState<string | null>(null);

  const validacion = validarSugerencia(texto);
  // "Muy corta" no es un error mientras se escribe: lo dice el botón deshabilitado.
  const errorTexto = !validacion.ok && !validacion.muyCorta ? validacion.error : null;
  const error = errorTexto ?? errorApi;

  const cerrar = () => {
    if (!enviada && texto.trim() && !window.confirm("Tenés una sugerencia sin mandar. ¿Descartarla?")) return;
    onCerrar();
  };
  useEffect(() => {
    primerCampo.current?.focus();
  }, []);

  /**
   * Teclado del panel, escuchado en el fondo. El foco nunca sale del diálogo:
   * arranca en el primer campo, Tab da la vuelta, y el diálogo mismo es
   * enfocable (tabIndex -1) para cuando el foco queda sin control — un click
   * en el título, el formulario que se desmonta al enviar, el botón que se
   * deshabilita mientras manda. Así todo keydown llega acá. Escape cierra.
   */
  const alTeclado = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      cerrar();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const focusables = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLES));
    const primero = focusables.at(0);
    const ultimo = focusables.at(-1);
    if (!primero || !ultimo) return;
    if (document.activeElement === panel.current) {
      e.preventDefault();
      (e.shiftKey ? ultimo : primero).focus();
    } else if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!validacion.ok || enviando) return;
    // El botón se deshabilita y después el formulario se desmonta: el foco
    // pasa al diálogo para que Escape y Tab sigan andando.
    panel.current?.focus();
    setEnviando(true);
    setErrorApi(null);
    enviarSugerencia(tipo, validacion.texto)
      .then(() => {
        setEnviada(true);
        setTexto("");
      })
      .catch((err: unknown) =>
        setErrorApi(err instanceof ErrorDeApi ? err.message : "No pudimos mandar la sugerencia. Probá de nuevo."),
      )
      .finally(() => setEnviando(false));
  };

  const otra = () => {
    setEnviada(false);
    setTipo("idea");
    setErrorApi(null);
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/35 sm:items-stretch sm:justify-end"
      // Sólo el fondo cierra: un click adentro del panel tiene otro target.
      onClick={(e) => {
        if (e.target === e.currentTarget) cerrar();
      }}
      onKeyDown={alTeclado}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo}
        tabIndex={-1}
        className="flex max-h-[92dvh] outline-none w-full flex-col overflow-y-auto rounded-t-[20px] bg-card pb-[env(safe-area-inset-bottom)] shadow-lg sm:max-h-none sm:w-[448px] sm:rounded-none"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 flex-none rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="flex items-start gap-3 px-5 pt-4 sm:px-6 sm:pt-6">
          <div className="flex flex-1 flex-col gap-1.5">
            <h2 id={titulo} className="font-display text-[21px] font-bold tracking-[-0.01em] text-ink">
              Sugerí una mejora
            </h2>
            <p className="text-sm leading-relaxed text-ink-secondary">
              ¿Qué le falta a Trato? La leemos nosotros y la sumamos a la lista de mejoras.
            </p>
          </div>
          <button
            type="button"
            onClick={cerrar}
            aria-label="Cerrar"
            className="grid size-11 flex-none cursor-pointer place-items-center rounded-full bg-sunken text-ink hover:bg-[var(--color-primitive-neutral-200)]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {enviada ? (
          <div className="flex flex-col items-start gap-3.5 px-5 py-8 sm:px-6">
            <span className="grid size-13 place-items-center rounded-full bg-success-subtle text-success-text" aria-hidden>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12 5 5 9-10" />
              </svg>
            </span>
            <div role="status" className="flex flex-col gap-2">
              <p className="font-display text-xl font-bold text-ink">¡Gracias! La recibimos.</p>
              <p className="text-sm leading-relaxed text-ink-secondary">
                Ya está en nuestra lista de mejoras. Gracias por ayudarnos a mejorar Trato.
              </p>
            </div>
            <div className="flex gap-2.5">
              <Button variant="secondary" onClick={otra}>
                Enviar otra
              </Button>
              <Button onClick={onCerrar}>Listo</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={enviar} noValidate className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6">
            <fieldset className="flex flex-col gap-2.5">
              <legend className="mb-2.5 text-[13.5px] font-semibold text-ink">¿De qué se trata?</legend>
              <div className="flex flex-wrap gap-2">
                {TIPOS_SUGERENCIA.map((opcion, i) => (
                  <label
                    key={opcion.id}
                    className={cn(
                      "flex h-11 cursor-pointer items-center rounded-full border px-3.5 text-[13.5px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-semantic-border-focus)]",
                      tipo === opcion.id
                        ? "border-primary-hover bg-primary-subtle font-semibold text-primary-active"
                        : "border-line-strong bg-card text-ink-secondary hover:bg-sunken",
                    )}
                  >
                    <input
                      ref={i === 0 ? primerCampo : undefined}
                      type="radio"
                      name="tipo-sugerencia"
                      value={opcion.id}
                      checked={tipo === opcion.id}
                      onChange={() => setTipo(opcion.id)}
                      className="sr-only"
                    />
                    {opcion.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-col gap-2">
              <label htmlFor="texto-sugerencia" className="text-[13.5px] font-semibold text-ink">
                Tu sugerencia
              </label>
              <textarea
                id="texto-sugerencia"
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                  setErrorApi(null);
                }}
                maxLength={MAX_CARACTERES}
                rows={6}
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${idAyuda} ${idError}` : idAyuda}
                placeholder="Ej.: me gustaría que el asistente le mande un recordatorio al cliente el día antes del turno."
                className="min-h-[150px] resize-none rounded-md border border-line-strong bg-page px-3.5 py-3 text-[14.5px] leading-normal text-ink outline-none placeholder:text-muted focus:border-[var(--color-semantic-border-focus)] aria-[invalid=true]:border-danger"
              />
              <div className="flex items-start gap-3 text-xs text-ink-secondary">
                <span id={idAyuda} className="flex-1 leading-snug">
                  Solo texto: sin links, mails, teléfonos, datos de clientes ni símbolos como &lt; &gt; @ #.
                </span>
                <span className="flex-none tabular-nums">
                  {texto.length} / {MAX_CARACTERES}
                </span>
              </div>
              {error && (
                <p id={idError} role="alert" className="rounded-sm bg-danger-subtle px-3 py-2.5 text-[13px] font-semibold text-danger-text">
                  {error}
                </p>
              )}
            </div>

            <Button type="submit" size="lg" fullWidth disabled={!validacion.ok || enviando}>
              {enviando ? "Enviando…" : "Enviar sugerencia"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
