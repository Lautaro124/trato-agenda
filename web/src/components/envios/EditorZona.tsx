"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  buscarUbicaciones,
  DIAS_DESPACHO,
  ETIQUETA_NIVEL,
  LARGO_MAX_INSTRUCCIONES,
  LARGO_MAX_NOMBRE_ZONA,
  NOMBRE_DIA,
  normalizarParaGuardar,
  problemaDeZona,
  type Cobertura,
  type EstadoZona,
  type Ubicacion,
  type Zona,
  type ZonaAGuardar,
} from "@/lib/envios";
import { centavosParaInput, formatearMonto, leerCentavos } from "@/lib/productos";

const ESPERA_BUSQUEDA_MS = 250;

const ESTADOS: Array<{ valor: EstadoZona; titulo: string; ayuda: string }> = [
  { valor: "tarifa", titulo: "Tarifa definida", ayuda: "El asistente informa precio y plazo" },
  { valor: "cotizacion", titulo: "Requiere cotización", ayuda: "Llegás, pero el costo se calcula por pedido" },
  { valor: "sin_cobertura", titulo: "Sin cobertura", ayuda: "No enviás; se ofrece retiro si lo tenés" },
];

const CAMPO = "min-h-11 rounded-md border border-line-strong bg-card px-3 font-medium text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";

function texto(centavos: number | null): string {
  return centavos === null ? "" : centavosParaInput(centavos);
}

function dias(valor: number | null): string {
  return valor === null ? "" : String(valor);
}

function leerDias(valor: string): number | null {
  const limpio = valor.trim();
  return limpio === "" ? null : Number.isInteger(Number(limpio)) ? Number(limpio) : Number.NaN;
}

function clave(c: Pick<Cobertura, "nivel" | "provinciaId" | "localidadId" | "cp">): string {
  return `${c.nivel}:${c.provinciaId ?? ""}:${c.localidadId ?? ""}:${c.cp ?? ""}`;
}

/** Buscador de provincias, localidades y CP: nunca elige solo, el dueño toca la opción. */
function BuscadorUbicaciones({
  elegidas,
  onElegir,
}: Readonly<{ elegidas: Set<string>; onElegir: (ubicacion: Ubicacion) => void }>) {
  const id = useId();
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<Ubicacion[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    const q = consulta.trim();
    if (q.length < 2) return;
    const temporizador = setTimeout(() => {
      buscarUbicaciones(q)
        .then((encontradas) => {
          setResultados(encontradas);
          setError(false);
        })
        .catch(() => setError(true));
    }, ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(temporizador);
  }, [consulta]);
  // Con menos de dos letras no se busca: lo de una búsqueda anterior no se muestra.
  const visibles = consulta.trim().length >= 2 ? resultados : [];

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[14px] font-semibold text-ink">
        Agregar ubicación
      </label>
      <input
        id={id}
        type="search"
        value={consulta}
        onChange={(e) => setConsulta(e.target.value)}
        placeholder="Provincia, localidad o código postal"
        maxLength={80}
        autoComplete="off"
        aria-describedby={`${id}-ayuda`}
        className={CAMPO}
      />
      <span id={`${id}-ayuda`} className="text-[13px] text-ink-secondary">
        Un CP lleva la provincia que elijas: si otra zona tiene un CP propio dentro de esta, ese CP usa su zona.
      </span>
      {error && <p className="text-[13.5px] text-danger-text">No pudimos buscar. Probá de nuevo.</p>}
      {visibles.length > 0 && (
        <ul aria-label="Ubicaciones encontradas" className="flex flex-col rounded-md border border-line-strong bg-card p-1 shadow-md">
          {visibles.map((ubicacion) => {
            const ya = elegidas.has(clave(ubicacion));
            return (
              <li key={clave(ubicacion)}>
                <button
                  type="button"
                  disabled={ya}
                  onClick={() => {
                    onElegir(ubicacion);
                    setConsulta("");
                  }}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-[14.5px] text-ink hover:bg-sunken disabled:cursor-default disabled:text-ink-secondary"
                >
                  <span>
                    <span className="mr-2 text-[11.5px] font-bold tracking-wide text-ink-secondary uppercase">
                      {ETIQUETA_NIVEL[ubicacion.nivel]}
                    </span>
                    {ubicacion.etiqueta}
                  </span>
                  {ya && <span className="text-[13px]">Ya está</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CampoMonto({
  etiqueta,
  valor,
  moneda,
  error,
  disabled,
  onChange,
}: Readonly<{
  etiqueta: string;
  valor: string;
  moneda: string;
  error?: string | null;
  disabled?: boolean;
  onChange: (valor: string) => void;
}>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[14px] font-semibold text-ink">
        {etiqueta}
      </label>
      <span
        className={cn(
          "flex min-h-11 items-stretch overflow-hidden rounded-md border bg-card",
          error ? "border-2 border-danger" : "border-line-strong",
        )}
      >
        <span className="flex items-center bg-sunken px-2.5 text-[14px] text-ink-secondary">{moneda === "USD" ? "US$" : "$"}</span>
        <input
          id={id}
          inputMode="decimal"
          value={valor}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-w-0 flex-1 px-2.5 font-semibold text-ink outline-none disabled:bg-sunken"
        />
      </span>
      {error && (
        <span id={`${id}-error`} className="text-[13.5px] font-semibold text-danger-text">
          {error}
        </span>
      )}
    </div>
  );
}

type Borrador = {
  zona: ZonaAGuardar;
  coberturas: Cobertura[];
  tarifaDomicilio: string;
  tarifaSucursal: string;
  gratisDesde: string;
  conGratis: boolean;
  preparacion: string;
  transporteDesde: string;
  transporteHasta: string;
};

function borradorDe(zona: Zona | null, nueva: ZonaAGuardar): Borrador {
  const base = zona ?? { ...nueva, id: "", coberturas: [] };
  return {
    zona: { ...base, coberturas: [] },
    coberturas: zona?.coberturas ?? [],
    tarifaDomicilio: texto(base.tarifaDomicilioCentavos),
    tarifaSucursal: texto(base.tarifaSucursalCentavos),
    gratisDesde: texto(base.gratisDesdeCentavos),
    conGratis: base.gratisDesdeCentavos !== null,
    preparacion: dias(base.preparacionDias),
    transporteDesde: dias(base.transporteDesdeDias),
    transporteHasta: dias(base.transporteHastaDias),
  };
}

/** La zona tal como se mandaría, o el problema que hay que mostrar. */
function armar(b: Borrador): { zona: ZonaAGuardar } | { problema: string } {
  const monto = (valor: string): number | null | "invalido" => {
    if (!valor.trim()) return null;
    return leerCentavos(valor) ?? "invalido";
  };
  const domicilio = monto(b.tarifaDomicilio);
  const sucursal = monto(b.tarifaSucursal);
  const gratis = b.conGratis ? monto(b.gratisDesde) : null;
  if (domicilio === "invalido" || sucursal === "invalido" || gratis === "invalido") {
    return { problema: "Revisá los importes: van como 5.000 o 5.000,50." };
  }
  if (b.conGratis && gratis === null) return { problema: "Completá desde qué monto el envío es gratis." };
  const plazos = [b.preparacion, b.transporteDesde, b.transporteHasta].map(leerDias);
  if (plazos.some((d) => Number.isNaN(d))) return { problema: "Los plazos van en días enteros." };
  const zona = normalizarParaGuardar({
    ...b.zona,
    tarifaDomicilioCentavos: domicilio,
    tarifaSucursalCentavos: sucursal,
    gratisDesdeCentavos: gratis,
    preparacionDias: plazos[0],
    transporteDesdeDias: plazos[1],
    transporteHastaDias: plazos[2],
    coberturas: b.coberturas.map(({ nivel, provinciaId, localidadId, cp }) => ({ nivel, provinciaId, localidadId, cp })),
  });
  const problema = problemaDeZona(zona);
  return problema ? { problema } : { zona };
}

/** Alta y edición de una zona: cobertura, qué se responde, tarifas, gratis y plazos. */
export function EditorZona({
  zona,
  nueva,
  moneda,
  guardando,
  onGuardar,
  onCancelar,
}: Readonly<{
  zona: Zona | null;
  nueva: ZonaAGuardar;
  moneda: string;
  guardando: boolean;
  onGuardar: (zona: ZonaAGuardar) => void;
  onCancelar: () => void;
}>) {
  const [b, setB] = useState<Borrador>(() => borradorDe(zona, nueva));
  const [problema, setProblema] = useState<string | null>(null);
  const cambiarZona = (cambios: Partial<ZonaAGuardar>) => setB((actual) => ({ ...actual, zona: { ...actual.zona, ...cambios } }));
  const elegidas = new Set(b.coberturas.map(clave));
  const tieneGeneral = b.coberturas.some((c) => c.nivel === "pais");
  const estado = b.zona.estado;
  const conTarifa = estado === "tarifa";
  const conModalidades = estado !== "sin_cobertura";

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    const resultado = armar(b);
    if ("problema" in resultado) {
      setProblema(resultado.problema);
      return;
    }
    setProblema(null);
    onGuardar(resultado.zona);
  };

  const plazo = (() => {
    const prep = leerDias(b.preparacion) ?? 0;
    const desde = leerDias(b.transporteDesde);
    const hasta = leerDias(b.transporteHasta);
    if (desde === null || hasta === null || Number.isNaN(desde) || Number.isNaN(hasta) || Number.isNaN(prep)) return null;
    return `“demora entre ${prep + desde} y ${prep + hasta} días hábiles, estimado”`;
  })();

  return (
    <form onSubmit={guardar} noValidate className="flex flex-col gap-5">
      <section aria-labelledby="t-zona" className="flex flex-col gap-4 rounded-lg border border-line bg-card p-5 md:p-6">
        <h2 id="t-zona" className="font-display text-[22px] font-extrabold text-ink">
          {zona ? "Editar zona" : "Nueva zona"}
        </h2>
        <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-ink">
          <span>Nombre de la zona</span>
          <input
            value={b.zona.nombre}
            maxLength={LARGO_MAX_NOMBRE_ZONA}
            onChange={(e) => cambiarZona({ nombre: e.target.value })}
            placeholder="Córdoba capital, Resto del país…"
            className={cn(CAMPO, "text-[16px] font-semibold")}
          />
          <span className="font-normal text-ink-secondary">Sólo lo ves vos; el cliente no lo lee.</span>
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[14px] font-semibold text-ink">Qué pasa con los envíos a esta zona</legend>
          <div className="grid gap-2 md:grid-cols-3">
            {ESTADOS.map((opcion) => {
              const elegida = estado === opcion.valor;
              return (
                <label
                  key={opcion.valor}
                  aria-label={opcion.titulo}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-md border p-3",
                    elegida ? "border-2 border-success bg-success-subtle" : "border-line",
                  )}
                >
                  <input
                    type="radio"
                    name="estado-zona"
                    checked={elegida}
                    onChange={() => cambiarZona({ estado: opcion.valor })}
                    className="mt-1 size-4 accent-[var(--color-semantic-success-text)]"
                  />
                  <span className="flex flex-col">
                    <span className="text-[14.5px] font-semibold text-ink">{opcion.titulo}</span>
                    <span className="text-[13px] text-ink-secondary">{opcion.ayuda}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="t-cobertura" className="flex flex-col gap-3.5 rounded-lg border border-line bg-card p-5 md:p-6">
        <div className="flex flex-col gap-0.5">
          <h3 id="t-cobertura" className="font-display text-[17px] font-bold text-ink">
            Cobertura
          </h3>
          <p className="text-[14px] text-ink-secondary">Sumá provincias, localidades o códigos postales.</p>
        </div>
        {b.coberturas.length > 0 && (
          <ul aria-label="Lugares de la zona" className="flex flex-wrap gap-2">
            {b.coberturas.map((c) => (
              <li key={clave(c)} className="flex items-center gap-1 rounded-full bg-sunken py-1 pr-1 pl-3 text-[14px] font-semibold text-ink">
                <span className="text-[11.5px] font-bold tracking-wide text-success-text uppercase">{ETIQUETA_NIVEL[c.nivel]}</span>
                {c.etiqueta}
                <button
                  type="button"
                  aria-label={`Quitar ${c.etiqueta}`}
                  onClick={() => setB((actual) => ({ ...actual, coberturas: actual.coberturas.filter((otra) => clave(otra) !== clave(c)) }))}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-secondary hover:bg-line"
                >
                  <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
        <BuscadorUbicaciones
          elegidas={elegidas}
          onElegir={(u) => setB((actual) => ({ ...actual, coberturas: [...actual.coberturas, { ...u }] }))}
        />
        <label className="flex min-h-11 items-center gap-2.5 text-[14.5px] text-ink">
          <input
            type="checkbox"
            checked={tieneGeneral}
            onChange={(e) =>
              setB((actual) => ({
                ...actual,
                coberturas: e.target.checked
                  ? [...actual.coberturas, { nivel: "pais", provinciaId: null, localidadId: null, cp: null, etiqueta: "Todo el país" }]
                  : actual.coberturas.filter((c) => c.nivel !== "pais"),
              }))
            }
            className="size-4 accent-[var(--color-semantic-primary-hover)]"
          />
          <span>Usar como regla general para todo el país (aplica donde no haya otra zona)</span>
        </label>
      </section>

      {conModalidades && (
        <section aria-labelledby="t-entrega" className="flex flex-col gap-4 rounded-lg border border-line bg-card p-5 md:p-6">
          <h3 id="t-entrega" className="font-display text-[17px] font-bold text-ink">
            Entrega y tarifa
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {(
              [
                ["domicilio", "Envío a domicilio", "tarifaDomicilio"],
                ["sucursal", "Retiro en sucursal del correo", "tarifaSucursal"],
              ] as const
            ).map(([modalidad, titulo, campo]) => {
              const ofrece = b.zona[modalidad];
              const valor = b[campo];
              const sinCargo = valor.trim() === "0";
              return (
                <div key={modalidad} className="flex flex-col gap-3 rounded-md border border-line p-4">
                  <label className="flex items-center gap-2.5 text-[15px] font-bold text-ink">
                    <input
                      type="checkbox"
                      checked={ofrece}
                      onChange={(e) => cambiarZona({ [modalidad]: e.target.checked })}
                      className="size-4 accent-[var(--color-semantic-primary-hover)]"
                    />
                    {titulo}
                  </label>
                  {ofrece && conTarifa && (
                    <>
                      <CampoMonto
                        etiqueta="Tarifa"
                        valor={valor}
                        moneda={moneda}
                        disabled={sinCargo}
                        onChange={(v) => setB((actual) => ({ ...actual, [campo]: v }))}
                      />
                      <label className="flex items-center gap-2.5 text-[14px] text-ink">
                        <input
                          type="checkbox"
                          checked={sinCargo}
                          onChange={(e) => setB((actual) => ({ ...actual, [campo]: e.target.checked ? "0" : "" }))}
                          className="size-4 accent-[var(--color-semantic-primary-hover)]"
                        />
                        Sin cargo ({formatearMonto(0, moneda)})
                      </label>
                    </>
                  )}
                  {ofrece && !conTarifa && <p className="text-[13.5px] text-ink-secondary">Sin tarifa fija: se cotiza por pedido.</p>}
                </div>
              );
            })}
          </div>
          {conTarifa && (
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-line pt-4">
              <label className="flex min-h-11 items-center gap-2.5 text-[15px] font-bold text-ink">
                <input
                  type="checkbox"
                  checked={b.conGratis}
                  onChange={(e) => setB((actual) => ({ ...actual, conGratis: e.target.checked }))}
                  className="size-4 accent-[var(--color-semantic-primary-hover)]"
                />
                <span>Envío gratis desde un monto</span>
              </label>
              {b.conGratis && (
                <div className="w-56">
                  <CampoMonto
                    etiqueta="Subtotal mínimo"
                    valor={b.gratisDesde}
                    moneda={moneda}
                    onChange={(v) => setB((actual) => ({ ...actual, gratisDesde: v }))}
                  />
                </div>
              )}
              <p className="flex-[1_1_260px] text-[14px] text-ink-secondary">
                Se compara con el subtotal de productos del pedido, sin el envío, e incluye el monto exacto. Si todavía no hay
                pedido, el asistente sólo cuenta la condición.
              </p>
            </div>
          )}
        </section>
      )}

      {conModalidades && (
        <section aria-labelledby="t-plazos" className="flex flex-col gap-4 rounded-lg border border-line bg-card p-5 md:p-6">
          <h3 id="t-plazos" className="font-display text-[17px] font-bold text-ink">
            Plazos y despacho
          </h3>
          <div className="grid gap-3 md:grid-cols-3">
            {(
              [
                ["preparacion", "Preparación (días hábiles)"],
                ["transporteDesde", "Transporte, desde"],
                ["transporteHasta", "Transporte, hasta"],
              ] as const
            ).map(([campo, etiqueta]) => (
              <label key={campo} className="flex flex-col gap-1.5 text-[14px] font-semibold text-ink">
                {etiqueta}
                <input
                  type="number"
                  min={0}
                  max={365}
                  inputMode="numeric"
                  value={b[campo]}
                  onChange={(e) => setB((actual) => ({ ...actual, [campo]: e.target.value }))}
                  className={CAMPO}
                />
              </label>
            ))}
          </div>
          {plazo && <p className="rounded-md bg-sunken px-3 py-2.5 text-[14px] text-ink">El cliente lee: {plazo}. Nunca una fecha exacta.</p>}
          <fieldset>
            <legend className="mb-2 text-[14px] font-semibold text-ink">Días de despacho</legend>
            <div className="flex flex-wrap gap-2">
              {DIAS_DESPACHO.map((dia) => {
                const elegido = b.zona.diasDespacho.includes(dia);
                return (
                  <label
                    key={dia}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold text-ink",
                      elegido ? "border-2 border-primary bg-primary-subtle" : "border border-line-strong",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={elegido}
                      onChange={(e) =>
                        cambiarZona({
                          diasDespacho: e.target.checked
                            ? DIAS_DESPACHO.filter((d) => d === dia || b.zona.diasDespacho.includes(d))
                            : b.zona.diasDespacho.filter((d) => d !== dia),
                        })
                      }
                      className="accent-[var(--color-semantic-primary-hover)]"
                    />
                    {NOMBRE_DIA[dia]}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-ink">
            <span>Aclaraciones para el cliente (opcional)</span>
            <textarea
              rows={2}
              maxLength={LARGO_MAX_INSTRUCCIONES}
              value={b.zona.instrucciones ?? ""}
              onChange={(e) => cambiarZona({ instrucciones: e.target.value })}
              placeholder="Se puede pagar al recibir, en efectivo."
              className="rounded-md border border-line-strong bg-card px-3 py-2.5 font-medium text-ink outline-none focus:border-[var(--color-semantic-border-focus)]"
            />
            <span className="font-normal text-ink-secondary">Pagar al recibir no hace que el envío sea gratis.</span>
          </label>
        </section>
      )}

      {problema && (
        <p role="alert" className="rounded-md bg-danger-subtle px-4 py-3 text-[14.5px] font-semibold text-danger-text">
          {problema}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-2.5 text-[14.5px] text-ink">
          <input
            type="checkbox"
            checked={b.zona.activa}
            onChange={(e) => cambiarZona({ activa: e.target.checked })}
            className="size-4 accent-[var(--color-semantic-success-text)]"
          />
          <span>Zona activa</span>
        </label>
        <div className="flex flex-wrap gap-3">
          <Button variant="ghost" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="submit" disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar zona"}
          </Button>
        </div>
      </div>
    </form>
  );
}
