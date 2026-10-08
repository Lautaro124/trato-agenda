"use client";

import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  activarPromocion,
  eliminarPromocion,
  guardarPromocion,
  leerValorDescuento,
  listarPromociones,
  problemaDeDescuento,
  vigenciaDe,
  type Descuento,
  type TipoDescuento,
} from "@/lib/descuentos";
import { centavosParaInput, ErrorDeApi, type Categoria } from "@/lib/productos";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-[14px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";
const LABEL = "mb-1 block text-[12.5px] font-semibold text-ink-secondary";

/** Lo que se tipea en el formulario de una promo. */
type Borrador = {
  nombre: string;
  categoria: string;
  tipo: TipoDescuento;
  valor: string;
  desde: string;
  hasta: string;
  activo: boolean;
};

const VACIO: Borrador = { nombre: "", categoria: "", tipo: "porcentaje", valor: "", desde: "", hasta: "", activo: true };

function borradorDe(promo: Descuento): Borrador {
  return {
    nombre: promo.nombre,
    categoria: promo.categoria ?? "",
    tipo: promo.tipo,
    valor: promo.tipo === "porcentaje" ? String(promo.valor) : centavosParaInput(promo.valor),
    desde: promo.desde ?? "",
    hasta: promo.hasta ?? "",
    activo: promo.activo,
  };
}

/**
 * Las promos generales de la cuenta: para todo el catálogo o una categoría.
 * El descuento propio de cada producto va en su formulario. `onCambio` avisa
 * para que el listado vuelva a pedir los precios finales.
 */
export function Promociones({ categorias, onCambio }: Readonly<{ categorias: Categoria[]; onCambio: () => void }>) {
  const [promos, setPromos] = useState<Descuento[] | null>(null);
  const [editando, setEditando] = useState<Descuento | "nueva" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recargas, setRecargas] = useState(0);

  useEffect(() => {
    listarPromociones()
      .then((datos) => {
        setPromos(datos);
        setError(null);
      })
      .catch(() => setError("No pudimos cargar las promociones."));
  }, [recargas]);

  const despuesDeCambiar = () => {
    setRecargas((n) => n + 1);
    onCambio();
  };

  const pausarOActivar = (promo: Descuento) => {
    activarPromocion(promo.id, !promo.activo)
      .then(despuesDeCambiar)
      .catch(() => setError("No pudimos cambiar la promoción."));
  };

  const borrar = (promo: Descuento) => {
    if (!window.confirm(`¿Borrar la promoción "${promo.nombre}"?`)) return;
    eliminarPromocion(promo.id)
      .then(despuesDeCambiar)
      .catch(() => setError("No pudimos borrar la promoción."));
  };

  return (
    <section aria-label="Promociones" className="flex flex-col gap-3 rounded-lg border border-line bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[18px] font-bold text-ink">Promociones</h2>
        {editando === null && (
          <Button variant="secondary" size="sm" onClick={() => setEditando("nueva")}>
            Nueva promoción
          </Button>
        )}
      </div>
      <p className="text-[13px] leading-[1.5] text-ink-secondary">
        Para todo el catálogo o una categoría. Si a un producto le toca más de una, se aplica la que más le conviene
        al cliente; nunca se suman.
      </p>

      {error && (
        <p role="alert" className="text-[13px] text-danger-text">
          {error}
        </p>
      )}

      {editando !== null && (
        <FormularioPromocion
          promo={editando === "nueva" ? null : editando}
          categorias={categorias}
          onCancelar={() => setEditando(null)}
          onGuardada={() => {
            setEditando(null);
            despuesDeCambiar();
          }}
        />
      )}

      {promos?.length === 0 && editando === null && (
        <p className="text-[13px] text-muted">Todavía no tenés promociones.</p>
      )}
      {promos && promos.length > 0 && (
        <ul aria-label="Lista de promociones" className="flex flex-col gap-2">
          {promos.map((promo) => (
            <li key={promo.id} className="flex flex-col gap-1 rounded-md border border-line px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[14px] font-bold text-ink">{promo.nombre}</span>
                <button
                  type="button"
                  onClick={() => pausarOActivar(promo)}
                  aria-pressed={promo.activo}
                  aria-label={`${promo.nombre}: ${promo.activo ? "activa" : "pausada"}`}
                  className="cursor-pointer"
                >
                  <Badge tone={promo.activo ? "success" : "neutral"}>{promo.activo ? "Activa" : "Pausada"}</Badge>
                </button>
              </div>
              <p className="text-[12.5px] text-ink-secondary">
                {promo.etiqueta} · {promo.categoria ? `Categoría: ${promo.categoria}` : "Todo el catálogo"} ·{" "}
                {vigenciaDe(promo)}
              </p>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditando(promo)} aria-label={`Editar ${promo.nombre}`}>
                  Editar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => borrar(promo)} aria-label={`Borrar ${promo.nombre}`}>
                  Borrar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FormularioPromocion({
  promo,
  categorias,
  onCancelar,
  onGuardada,
}: Readonly<{
  promo: Descuento | null;
  categorias: Categoria[];
  onCancelar: () => void;
  onGuardada: () => void;
}>) {
  const id = useId();
  const [borrador, setBorrador] = useState<Borrador>(() => (promo ? borradorDe(promo) : VACIO));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cambiar = (cambios: Partial<Borrador>) => setBorrador((actual) => ({ ...actual, ...cambios }));

  // Una categoría que ya no tiene productos sigue apareciendo si la promo la usa.
  const opciones = categorias.map((c) => c.nombre);
  if (borrador.categoria && !opciones.includes(borrador.categoria)) opciones.push(borrador.categoria);

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    if (borrador.nombre.trim().length < 2) {
      setError("Poné un nombre para la promoción.");
      return;
    }
    const valor = leerValorDescuento(borrador.tipo, borrador.valor);
    const problema = problemaDeDescuento({ tipo: borrador.tipo, valor, desde: borrador.desde, hasta: borrador.hasta });
    if (problema || valor === null) {
      setError(problema ?? "Revisá el descuento.");
      return;
    }
    setGuardando(true);
    setError(null);
    guardarPromocion(
      {
        nombre: borrador.nombre.trim(),
        categoria: borrador.categoria || null,
        tipo: borrador.tipo,
        valor,
        activo: borrador.activo,
        desde: borrador.desde || null,
        hasta: borrador.hasta || null,
      },
      promo?.id,
    )
      .then(onGuardada)
      .catch((err: unknown) =>
        setError(err instanceof ErrorDeApi ? err.message : "No pudimos guardar la promoción. Probá de nuevo."),
      )
      .finally(() => setGuardando(false));
  };

  return (
    <form
      onSubmit={guardar}
      aria-label={promo ? `Editar promoción ${promo.nombre}` : "Nueva promoción"}
      className="flex flex-col gap-3 rounded-md bg-sunken p-3"
    >
      <div>
        <label htmlFor={`${id}-nombre`} className={LABEL}>
          Nombre
        </label>
        <input
          id={`${id}-nombre`}
          value={borrador.nombre}
          maxLength={60}
          placeholder="Semana del mate"
          onChange={(e) => cambiar({ nombre: e.target.value })}
          className={INPUT}
        />
      </div>
      <div>
        <label htmlFor={`${id}-alcance`} className={LABEL}>
          Para
        </label>
        <select
          id={`${id}-alcance`}
          value={borrador.categoria}
          onChange={(e) => cambiar({ categoria: e.target.value })}
          className={INPUT}
        >
          <option value="">Todo el catálogo</option>
          {opciones.map((nombre) => (
            <option key={nombre} value={nombre}>
              Categoría: {nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-[1fr_96px] items-end gap-2">
        <div role="radiogroup" aria-label="Tipo de descuento de la promoción">
          <span className={LABEL} aria-hidden="true">
            Tipo
          </span>
          <div className="flex gap-1 rounded-md border border-line bg-card p-1">
            {(
              [
                ["porcentaje", "Porcentaje"],
                ["monto", "Monto fijo"],
              ] as const
            ).map(([tipo, texto]) => (
              <label
                key={tipo}
                className={cn(
                  "flex-1 cursor-pointer rounded-sm px-2 py-1.5 text-center text-[13px] font-semibold",
                  borrador.tipo === tipo ? "bg-primary-subtle text-ink" : "text-ink-secondary",
                )}
              >
                <input
                  type="radio"
                  name={`${id}-tipo`}
                  value={tipo}
                  checked={borrador.tipo === tipo}
                  onChange={() => cambiar({ tipo, valor: "" })}
                  className="sr-only"
                />
                {texto}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-valor`} className={LABEL}>
            {borrador.tipo === "porcentaje" ? "%" : "$"}
          </label>
          <input
            id={`${id}-valor`}
            inputMode={borrador.tipo === "porcentaje" ? "numeric" : "decimal"}
            value={borrador.valor}
            placeholder={borrador.tipo === "porcentaje" ? "10" : "500"}
            onChange={(e) => cambiar({ valor: e.target.value })}
            className={INPUT}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${id}-desde`} className={LABEL}>
            Desde
          </label>
          <input
            id={`${id}-desde`}
            type="date"
            value={borrador.desde}
            onChange={(e) => cambiar({ desde: e.target.value })}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor={`${id}-hasta`} className={LABEL}>
            Hasta
          </label>
          <input
            id={`${id}-hasta`}
            type="date"
            value={borrador.hasta}
            min={borrador.desde || undefined}
            onChange={(e) => cambiar({ hasta: e.target.value })}
            className={INPUT}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar promoción"}
        </Button>
      </div>
    </form>
  );
}
