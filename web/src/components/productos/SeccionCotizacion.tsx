"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { INPUT, LABEL } from "@/components/productos/EditorProducto";
import { EncabezadoDeSeccion } from "@/components/productos/SeccionSolicitud";
import { cn } from "@/lib/cn";
import {
  ETIQUETA_UNIDAD,
  LARGO_MAX_FORMULA,
  MAX_EXTRAS,
  MAX_RENGLONES_RECETA,
  SECCIONES_INSUMO,
  simularCotizacion,
  TIPOS_INSUMO,
  type Extra,
  type Insumo,
  type PoliticaCotizacion,
  type Receta,
  type ResultadoSimulacion,
} from "@/lib/costos";
import { centavosParaInput, ErrorDeApi, formatearCentavos, leerCentavos } from "@/lib/productos";
import { variablesDe, type PreguntaSolicitud } from "@/lib/solicitud";

/** Cuánto espera la vista previa a que se deje de tipear. */
const ESPERA_SIMULACION_MS = 500;

type CondicionEnEdicion = { pregunta: string; opcion: string };

type RenglonEnEdicion = { clave: string; insumoId: string; cantidad: string; cuando: CondicionEnEdicion | null };

type ExtraEnEdicion = {
  clave: string;
  nombre: string;
  modo: Extra["modo"];
  /** Pesos o porcentaje, como se escribe. */
  valor: string;
  formula: string;
  cuando: CondicionEnEdicion | null;
};

function renglonNuevo(insumoId = ""): RenglonEnEdicion {
  return { clave: crypto.randomUUID(), insumoId, cantidad: "1", cuando: null };
}

function extraNuevo(): ExtraEnEdicion {
  return { clave: crypto.randomUUID(), nombre: "", modo: "fijo", valor: "", formula: "", cuando: null };
}

function extraDesdeGuardado(extra: Extra): ExtraEnEdicion {
  return {
    clave: crypto.randomUUID(),
    nombre: extra.nombre,
    modo: extra.modo,
    valor: extra.modo === "fijo" ? centavosParaInput(extra.valor) : extra.modo === "porcentaje" ? String(extra.valor).replace(".", ",") : "",
    formula: extra.formula ?? "",
    cuando: extra.cuando ?? null,
  };
}

/** Lo que se mandaría de un extra; null si todavía no tiene valor (no se manda). */
function extraAGuardar(extra: ExtraEnEdicion): Extra | null {
  const nombre = extra.nombre.trim();
  const cuando = extra.cuando ? { cuando: extra.cuando } : {};
  if (extra.modo === "formula") return { nombre, modo: "formula", valor: 0, formula: extra.formula.trim(), ...cuando };
  const valor = extra.modo === "fijo" ? leerCentavos(extra.valor) : Number(extra.valor.trim().replace(",", "."));
  if (valor === null || !Number.isFinite(valor)) return { nombre, modo: extra.modo, valor: Number.NaN, ...cuando };
  return { nombre, modo: extra.modo, valor, ...cuando };
}

/** Estado de la receta y de quién cotiza un producto a medida. */
export function useRecetaEnEdicion(inicial: Receta | null, politicaInicial: PoliticaCotizacion) {
  const [politica, setPolitica] = useState<PoliticaCotizacion>(politicaInicial);
  const [renglones, setRenglones] = useState<RenglonEnEdicion[]>(() =>
    (inicial?.renglones ?? []).map((renglon) => ({
      clave: crypto.randomUUID(),
      insumoId: renglon.insumoId,
      cantidad: renglon.cantidad,
      cuando: renglon.cuando ?? null,
    })),
  );
  const [extras, setExtras] = useState<ExtraEnEdicion[]>(() => (inicial?.extras ?? []).map(extraDesdeGuardado));

  const armada = (): Receta | null => {
    const lista = renglones.filter((renglon) => renglon.insumoId).map((renglon) => ({
      insumoId: renglon.insumoId,
      cantidad: renglon.cantidad.trim(),
      ...(renglon.cuando ? { cuando: renglon.cuando } : {}),
    }));
    const extrasArmados = extras.flatMap((extra) => {
      const armado = extraAGuardar(extra);
      return armado ? [armado] : [];
    });
    return lista.length === 0 && extrasArmados.length === 0 ? null : { renglones: lista, extras: extrasArmados };
  };

  return {
    politica,
    setPolitica,
    renglones,
    extras,
    firma: JSON.stringify([politica, armada()]),
    receta: armada,
    agregarRenglon: (insumoId?: string) =>
      setRenglones((actuales) => (actuales.length >= MAX_RENGLONES_RECETA ? actuales : [...actuales, renglonNuevo(insumoId)])),
    cambiarRenglon: (clave: string, cambio: Partial<RenglonEnEdicion>) =>
      setRenglones((actuales) => actuales.map((renglon) => (renglon.clave === clave ? { ...renglon, ...cambio } : renglon))),
    quitarRenglon: (clave: string) => setRenglones((actuales) => actuales.filter((renglon) => renglon.clave !== clave)),
    agregarExtra: () => setExtras((actuales) => (actuales.length >= MAX_EXTRAS ? actuales : [...actuales, extraNuevo()])),
    cambiarExtra: (clave: string, cambio: Partial<ExtraEnEdicion>) =>
      setExtras((actuales) => actuales.map((extra) => (extra.clave === clave ? { ...extra, ...cambio } : extra))),
    quitarExtra: (clave: string) => setExtras((actuales) => actuales.filter((extra) => extra.clave !== clave)),
    /** Lo que falta para guardar, dicho para el pie del editor; null si está bien. */
    problema: (): string | null => {
      if (renglones.some((renglon) => renglon.insumoId && !renglon.cantidad.trim())) return "A un renglón de la receta le falta la cantidad.";
      if (extras.some((extra) => !extra.nombre.trim())) return "A un extra de la receta le falta el nombre.";
      if (extras.some((extra) => extra.modo !== "formula" && !((extraAGuardar(extra)?.valor ?? 0) > 0))) {
        return "Revisá los valores de los extras de la receta.";
      }
      if (politica !== "manual" && !armada()?.renglones.length && !armada()?.extras.some((e) => e.modo !== "porcentaje")) {
        return "Para que tu asistente cotice, cargá la receta: qué materiales y costos lleva.";
      }
      return null;
    },
  };
}

export type RecetaEnEdicion = ReturnType<typeof useRecetaEnEdicion>;

const POLITICAS: ReadonlyArray<{ valor: PoliticaCotizacion; titulo: string; detalle: string }> = [
  { valor: "manual", titulo: "Lo cotizás vos", detalle: "Te llega la solicitud y le pasás el precio desde Ventas." },
  {
    valor: "revision",
    titulo: "Tu asistente lo arma, vos lo aprobás",
    detalle: "Calcula el presupuesto con la receta y te lo deja para revisar antes de mandarlo.",
  },
  {
    valor: "automatica",
    titulo: "Tu asistente cotiza y lo manda",
    detalle: "Calcula con la receta y se lo pasa al cliente en el momento. Si falta algo, te lo deja a vos.",
  },
];

const OPERADORES: ReadonlyArray<[string, string]> = [
  ["+", " + "],
  ["−", " - "],
  ["×", " × "],
  ["÷", " ÷ "],
  ["(", "("],
  [")", ")"],
];

const FUNCIONES: ReadonlyArray<[string, string, string]> = [
  ["redondear para arriba", "techo(", "Placas, latas o rollos enteros"],
  ["redondear", "redondear(", "Al entero más cercano"],
];

/**
 * El campo de una cuenta, con botones que escriben en el cursor: los datos
 * del producto, las operaciones y las funciones. Nunca hace falta saber la
 * sintaxis; igual se puede escribir a mano.
 */
function CampoFormula({
  valor,
  onCambio,
  variables,
  etiqueta,
  placeholder,
}: {
  valor: string;
  onCambio: (valor: string) => void;
  variables: string[];
  etiqueta: string;
  placeholder: string;
}) {
  const id = useId();
  const campo = useRef<HTMLInputElement>(null);
  const insertar = (texto: string) => {
    const input = campo.current;
    const desde = input?.selectionStart ?? valor.length;
    const hasta = input?.selectionEnd ?? valor.length;
    const nuevo = `${valor.slice(0, desde)}${texto}${valor.slice(hasta)}`.slice(0, LARGO_MAX_FORMULA);
    onCambio(nuevo);
    requestAnimationFrame(() => {
      input?.focus();
      const posicion = desde + texto.length;
      input?.setSelectionRange(posicion, posicion);
    });
  };
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={LABEL}>
        {etiqueta}
      </label>
      <input
        id={id}
        ref={campo}
        value={valor}
        maxLength={LARGO_MAX_FORMULA}
        placeholder={placeholder}
        onChange={(e) => onCambio(e.target.value)}
        className={cn(INPUT, "font-mono")}
      />
      <div role="toolbar" aria-label={`Armar ${etiqueta.toLowerCase()}`} className="mt-1.5 flex flex-wrap gap-1">
        {variables.map((variable) => (
          <button
            key={variable}
            type="button"
            onClick={() => insertar(variable)}
            className="cursor-pointer rounded-full border border-[var(--color-primitive-coral-200)] bg-primary-subtle px-2.5 py-0.5 font-mono text-[12.5px] text-[var(--color-primitive-coral-700)]"
          >
            {variable}
          </button>
        ))}
        {OPERADORES.map(([texto, inserta]) => (
          <button
            key={texto}
            type="button"
            aria-label={`Insertar ${texto}`}
            onClick={() => insertar(inserta)}
            className="min-w-8 cursor-pointer rounded-md border border-line bg-card px-2 py-0.5 text-[13px] text-ink hover:border-line-strong"
          >
            {texto}
          </button>
        ))}
        {FUNCIONES.map(([texto, inserta, ayuda]) => (
          <button
            key={texto}
            type="button"
            title={ayuda}
            onClick={() => insertar(inserta)}
            className="cursor-pointer rounded-md border border-line bg-card px-2 py-0.5 text-[12.5px] text-ink-secondary hover:border-line-strong"
          >
            {texto}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "Sólo si [pregunta] es [opción]": para los renglones y extras que dependen de lo que elige el cliente. */
function SoloSi({
  valor,
  onCambio,
  preguntas,
}: {
  valor: CondicionEnEdicion | null;
  onCambio: (valor: CondicionEnEdicion | null) => void;
  preguntas: PreguntaSolicitud[];
}) {
  const conOpciones = preguntas.filter((pregunta) => pregunta.opciones.length > 0);
  if (conOpciones.length === 0) return null;
  const elegida = conOpciones.find((pregunta) => pregunta.texto === valor?.pregunta) ?? null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-secondary">
      <span>Sólo si</span>
      <select
        aria-label="Sólo si la pregunta"
        value={elegida?.texto ?? ""}
        onChange={(e) => {
          const pregunta = conOpciones.find((p) => p.texto === e.target.value);
          onCambio(pregunta ? { pregunta: pregunta.texto, opcion: pregunta.opciones[0] } : null);
        }}
        className="rounded-md border border-line bg-card px-2 py-1 text-[12.5px] text-ink"
      >
        <option value="">siempre</option>
        {conOpciones.map((pregunta) => (
          <option key={pregunta.texto} value={pregunta.texto}>
            {pregunta.texto}
          </option>
        ))}
      </select>
      {elegida && (
        <>
          <span>es</span>
          <select
            aria-label="Sólo si la respuesta es"
            value={valor?.opcion ?? ""}
            onChange={(e) => onCambio({ pregunta: elegida.texto, opcion: e.target.value })}
            className="rounded-md border border-line bg-card px-2 py-1 text-[12.5px] text-ink"
          >
            {elegida.opciones.map((opcion) => (
              <option key={opcion} value={opcion}>
                {opcion}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

/** Respuestas de ejemplo + la cuenta que haría el asistente, calculada por la API. */
function ProbarCotizacion({ estado, preguntas }: { estado: RecetaEnEdicion; preguntas: PreguntaSolicitud[] }) {
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<ResultadoSimulacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const receta = estado.receta();
  const relevantes = preguntas.filter((pregunta) => pregunta.numero || pregunta.opciones.length > 0);
  const clave = JSON.stringify({ receta, preguntas, respuestas });

  useEffect(() => {
    if (!receta) return;
    const ctrl = { cancelado: false };
    const timer = setTimeout(() => {
      simularCotizacion({
        receta,
        solicitud: { preguntas },
        respuestas: relevantes.map((pregunta) => ({ pregunta: pregunta.texto, respuesta: respuestas[pregunta.texto] ?? "" })),
      })
        .then((datos) => {
          if (ctrl.cancelado) return;
          setResultado(datos);
          setError(null);
        })
        .catch((err: unknown) => !ctrl.cancelado && setError(err instanceof ErrorDeApi ? err.message : "No pudimos calcular."));
    }, ESPERA_SIMULACION_MS);
    return () => {
      ctrl.cancelado = true;
      clearTimeout(timer);
    };
    // La clave junta todo lo que cambia la cuenta: receta, preguntas y respuestas de ejemplo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  if (!receta) return null;
  return (
    <section aria-label="Probá la cotización" className="flex flex-col gap-2 rounded-lg border border-line bg-sunken p-3">
      <h4 className="font-display text-[14.5px] font-bold text-ink">Probá la cotización</h4>
      {relevantes.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {relevantes.map((pregunta) => (
            <label key={pregunta.texto} className="min-w-0">
              <span className={cn(LABEL, "truncate")}>
                {pregunta.texto}
                {pregunta.numero?.unidad ? ` (${pregunta.numero.unidad})` : ""}
              </span>
              {pregunta.numero ? (
                <input
                  inputMode="decimal"
                  value={respuestas[pregunta.texto] ?? ""}
                  placeholder="Ej.: 120"
                  onChange={(e) => setRespuestas((actuales) => ({ ...actuales, [pregunta.texto]: e.target.value }))}
                  className={INPUT}
                />
              ) : (
                <select
                  value={respuestas[pregunta.texto] ?? ""}
                  onChange={(e) => setRespuestas((actuales) => ({ ...actuales, [pregunta.texto]: e.target.value }))}
                  className={INPUT}
                >
                  <option value="">Sin elegir</option>
                  {pregunta.opciones.map((opcion) => (
                    <option key={opcion} value={opcion}>
                      {opcion}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ))}
        </div>
      )}
      <div role="status" aria-live="polite">
        {error ? (
          <p className="text-[13px] text-danger-text">{error}</p>
        ) : !resultado ? (
          <p className="text-[13px] text-muted">Calculando…</p>
        ) : resultado.ok ? (
          <table className="w-full text-[13px]">
            <tbody>
              {resultado.renglones.map((renglon, i) => (
                <tr key={`${renglon.concepto}-${i}`} className="border-b border-line">
                  <td className="py-1 text-ink">
                    {renglon.concepto}
                    {(renglon.cantidad !== 1 || renglon.unidad) && (
                      <span className="text-muted">
                        {" "}
                        · {String(renglon.cantidad).replace(".", ",")} {renglon.unidad} × {formatearCentavos(renglon.precioUnitarioCentavos)}
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right text-ink tabular-nums">{formatearCentavos(renglon.subtotalCentavos)}</td>
                </tr>
              ))}
              <tr>
                <td className="pt-1.5 font-semibold text-ink">Total</td>
                <td className="pt-1.5 text-right font-semibold text-ink tabular-nums">{formatearCentavos(resultado.totalCentavos)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-[13px] text-ink-secondary">{resultado.motivo}</p>
        )}
      </div>
    </section>
  );
}

/**
 * "¿Cómo se cotiza?" de un producto a medida (LAU-26): quién lo cotiza y la
 * receta con que el asistente calcula el presupuesto (materiales, fabricación
 * y mano de obra de /costos, cada uno con su cantidad como cuenta sobre las
 * preguntas de número), más los extras del producto.
 */
export function SeccionCotizacion({
  numero,
  estado,
  insumos,
  preguntas,
}: {
  numero: number;
  estado: RecetaEnEdicion;
  /** null mientras se cargan. */
  insumos: Insumo[] | null;
  preguntas: PreguntaSolicitud[];
}) {
  const variables = variablesDe(preguntas).map((dato) => dato.variable).filter(Boolean);
  const porId = new Map((insumos ?? []).map((insumo) => [insumo.id, insumo]));
  const sinInsumos = insumos !== null && insumos.length === 0;

  return (
    <section aria-label="Cómo se cotiza" className="flex flex-col gap-3">
      <EncabezadoDeSeccion
        numero={numero}
        titulo="¿Cómo se cotiza?"
        ayuda="Quién le pasa el precio al cliente y, si querés que lo calcule tu asistente, con qué receta."
      />
      <div className="flex flex-col gap-4 sm:pl-10">
        <div role="radiogroup" aria-label="Quién cotiza" className="grid gap-2 sm:grid-cols-3">
          {POLITICAS.map((opcion) => (
            <label
              key={opcion.valor}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-[13px]",
                estado.politica === opcion.valor ? "border-primary bg-primary-subtle" : "border-line bg-card hover:border-line-strong",
              )}
            >
              <input
                type="radio"
                name="politica-cotizacion"
                checked={estado.politica === opcion.valor}
                onChange={() => estado.setPolitica(opcion.valor)}
                className="sr-only"
              />
              <span className="font-semibold text-ink">{opcion.titulo}</span>
              <span className="text-ink-secondary">{opcion.detalle}</span>
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <h4 className="font-display text-[15px] font-bold text-ink">Receta</h4>
            <p className="text-[12.5px] text-ink-secondary">
              {estado.politica === "manual"
                ? "Opcional: con receta, desde Ventas podés calcular el presupuesto en un toque."
                : "Qué lleva y cuánto. Las cantidades pueden usar las preguntas de número"}
              {estado.politica !== "manual" && variables.length === 0 && " (marcá alguna como “Se contesta con un número”)"}
              {estado.politica !== "manual" && "."}
            </p>
          </div>

          {sinInsumos && (
            <p className="rounded-md bg-sunken px-4 py-3 text-[13px] text-ink-secondary">
              Todavía no cargaste materiales ni costos.{" "}
              <Link href="/costos" className="font-semibold text-link">
                Cargalos en Materiales y costos
              </Link>{" "}
              y volvé a armar la receta.
            </p>
          )}

          {estado.renglones.map((renglon, i) => {
            const insumo = porId.get(renglon.insumoId);
            return (
              <div
                key={renglon.clave}
                role="group"
                aria-label={`Renglón ${i + 1} de la receta`}
                className="flex flex-col gap-2 rounded-lg border border-line bg-card p-3"
              >
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-start">
                  <label>
                    <span className={LABEL}>Qué usa</span>
                    <select
                      value={renglon.insumoId}
                      onChange={(e) => estado.cambiarRenglon(renglon.clave, { insumoId: e.target.value })}
                      className={INPUT}
                    >
                      <option value="">Elegí…</option>
                      {renglon.insumoId && !insumo && insumos !== null && <option value={renglon.insumoId}>(ya no está cargado)</option>}
                      {TIPOS_INSUMO.map((tipo) => {
                        const delTipo = (insumos ?? []).filter((item) => item.tipo === tipo);
                        if (delTipo.length === 0) return null;
                        return (
                          <optgroup key={tipo} label={SECCIONES_INSUMO[tipo].titulo}>
                            {delTipo.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.nombre} ({formatearCentavos(item.costoCentavos)} por {ETIQUETA_UNIDAD[item.unidad]})
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  </label>
                  <CampoFormula
                    etiqueta={insumo ? `Cuánto (en ${ETIQUETA_UNIDAD[insumo.unidad]})` : "Cuánto"}
                    valor={renglon.cantidad}
                    variables={variables}
                    placeholder="ancho × alto ÷ 10000"
                    onCambio={(cantidad) => estado.cambiarRenglon(renglon.clave, { cantidad })}
                  />
                  <button
                    type="button"
                    aria-label={`Quitar renglón ${i + 1} de la receta`}
                    onClick={() => estado.quitarRenglon(renglon.clave)}
                    className="cursor-pointer self-start text-[12.5px] text-muted hover:text-danger-text sm:mt-7"
                  >
                    Quitar
                  </button>
                </div>
                <SoloSi
                  valor={renglon.cuando}
                  preguntas={preguntas}
                  onCambio={(cuando) => estado.cambiarRenglon(renglon.clave, { cuando })}
                />
              </div>
            );
          })}
          {estado.renglones.length < MAX_RENGLONES_RECETA && !sinInsumos && (
            <button
              type="button"
              onClick={() => estado.agregarRenglon()}
              className="cursor-pointer self-start rounded-md border border-dashed border-line-strong bg-card px-3.5 py-2 text-[14px] font-semibold text-primary hover:bg-primary-subtle"
            >
              + Agregar a la receta
            </button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <h4 className="font-display text-[15px] font-bold text-ink">Extras de este producto</h4>
            <p className="text-[12.5px] text-ink-secondary">
              Montos fijos (instalación), un porcentaje o una cuenta. Los que van en todas las cotizaciones (ganancia, IVA) se cargan
              en{" "}
              <Link href="/costos" className="text-link">
                Materiales y costos
              </Link>
              .
            </p>
          </div>
          {estado.extras.map((extra, i) => (
            <div key={extra.clave} role="group" aria-label={`Extra ${i + 1}`} className="flex flex-col gap-2 rounded-lg border border-line bg-card p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)_auto] sm:items-start">
                <label>
                  <span className={LABEL}>Nombre</span>
                  <input
                    value={extra.nombre}
                    maxLength={60}
                    placeholder="Instalación"
                    onChange={(e) => estado.cambiarExtra(extra.clave, { nombre: e.target.value })}
                    className={INPUT}
                  />
                </label>
                <label>
                  <span className={LABEL}>Cómo se suma</span>
                  <select
                    value={extra.modo}
                    onChange={(e) => estado.cambiarExtra(extra.clave, { modo: e.target.value as Extra["modo"] })}
                    className={INPUT}
                  >
                    <option value="fijo">Monto fijo</option>
                    <option value="porcentaje">Porcentaje</option>
                    <option value="formula">Con una cuenta</option>
                  </select>
                </label>
                {extra.modo === "formula" ? (
                  <CampoFormula
                    etiqueta="Cuánto (en pesos)"
                    valor={extra.formula}
                    variables={variables}
                    placeholder="ancho × 50"
                    onCambio={(formula) => estado.cambiarExtra(extra.clave, { formula })}
                  />
                ) : (
                  <label>
                    <span className={LABEL}>{extra.modo === "fijo" ? "Monto ($)" : "Porcentaje (%)"}</span>
                    <input
                      inputMode="decimal"
                      value={extra.valor}
                      placeholder={extra.modo === "fijo" ? "15.000" : "10"}
                      onChange={(e) => estado.cambiarExtra(extra.clave, { valor: e.target.value })}
                      className={INPUT}
                    />
                  </label>
                )}
                <button
                  type="button"
                  aria-label={`Quitar extra ${i + 1}`}
                  onClick={() => estado.quitarExtra(extra.clave)}
                  className="cursor-pointer self-start text-[12.5px] text-muted hover:text-danger-text sm:mt-7"
                >
                  Quitar
                </button>
              </div>
              <SoloSi valor={extra.cuando} preguntas={preguntas} onCambio={(cuando) => estado.cambiarExtra(extra.clave, { cuando })} />
            </div>
          ))}
          {estado.extras.length < MAX_EXTRAS && (
            <button
              type="button"
              onClick={() => estado.agregarExtra()}
              className="cursor-pointer self-start rounded-md border border-dashed border-line-strong bg-card px-3.5 py-2 text-[14px] font-semibold text-primary hover:bg-primary-subtle"
            >
              + Agregar extra
            </button>
          )}
        </div>

        <ProbarCotizacion estado={estado} preguntas={preguntas} />
      </div>
    </section>
  );
}
