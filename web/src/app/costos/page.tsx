"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { INPUT, LABEL } from "@/components/productos/EditorProducto";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  actualizarInsumo,
  borrarInsumo,
  crearInsumo,
  ETIQUETA_UNIDAD,
  guardarConfigCotizacion,
  LARGO_MAX_NOMBRE_INSUMO,
  MAX_EXTRAS,
  obtenerCostos,
  SECCIONES_INSUMO,
  TIPOS_INSUMO,
  UNIDADES_INSUMO,
  type ConfigCotizacion,
  type CostosDelComercio,
  type Insumo,
  type TipoInsumo,
  type UnidadInsumo,
} from "@/lib/costos";
import { centavosParaInput, ErrorDeApi, leerCentavos } from "@/lib/productos";
import { useRequireSession } from "@/lib/session";

function mensajeDe(err: unknown, porDefecto: string): string {
  return err instanceof ErrorDeApi ? err.message : porDefecto;
}

function Cargando() {
  return (
    <main className="grid min-h-dvh place-items-center bg-page p-6">
      <p className="text-sm text-muted">Cargando tus costos…</p>
    </main>
  );
}

export default function CostosPage() {
  const { user, status } = useRequireSession();
  const router = useRouter();
  const aPedido = user?.tipoAsistente === "ventas" && user.modalidadVenta === "pedido";

  // Sólo una cuenta que vende a pedido cotiza: el resto vuelve a su pantalla.
  useEffect(() => {
    if (status === "authenticated" && user && !aPedido) router.replace(user.tipoAsistente === "ventas" ? "/productos" : "/inicio");
  }, [status, user, aPedido, router]);

  if (status !== "authenticated" || !user || !aPedido) return <Cargando />;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="costos" user={user} />
      <Costos />
      <MobileTabBar active="costos" />
    </div>
  );
}

/** Una fila de insumo: se edita en el lugar y aparece "Guardar" cuando cambió algo. */
function FilaInsumo({
  insumo,
  onGuardado,
  onBorrado,
}: {
  insumo: Insumo;
  onGuardado: (insumo: Insumo) => void;
  onBorrado: (id: string) => void;
}) {
  const [nombre, setNombre] = useState(insumo.nombre);
  const [unidad, setUnidad] = useState<UnidadInsumo>(insumo.unidad);
  const [costo, setCosto] = useState(centavosParaInput(insumo.costoCentavos));
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cambio = nombre !== insumo.nombre || unidad !== insumo.unidad || costo !== centavosParaInput(insumo.costoCentavos);

  const guardar = () => {
    const costoCentavos = leerCentavos(costo);
    if (!nombre.trim() || costoCentavos === null || costoCentavos <= 0) {
      setError("Poné el nombre y un costo mayor que cero.");
      return;
    }
    setTrabajando(true);
    setError(null);
    actualizarInsumo(insumo.id, { tipo: insumo.tipo, nombre: nombre.trim(), unidad, costoCentavos })
      .then(onGuardado)
      .catch((err: unknown) => setError(mensajeDe(err, "No pudimos guardarlo.")))
      .finally(() => setTrabajando(false));
  };

  const borrar = () => {
    if (!window.confirm(`¿Quitar ${JSON.stringify(insumo.nombre)}? Los productos que lo usan en su receta van a quedar para cotizar a mano.`)) return;
    setTrabajando(true);
    borrarInsumo(insumo.id)
      .then(() => onBorrado(insumo.id))
      .catch((err: unknown) => {
        setError(mensajeDe(err, "No pudimos quitarlo."));
        setTrabajando(false);
      });
  };

  return (
    <li role="group" aria-label={insumo.nombre} className="flex flex-col gap-1 py-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_140px_160px_auto] sm:items-center">
        <input
          aria-label="Nombre"
          value={nombre}
          maxLength={LARGO_MAX_NOMBRE_INSUMO}
          onChange={(e) => setNombre(e.target.value)}
          className={cn(INPUT, "col-span-2 sm:col-span-1")}
        />
        <select aria-label="Unidad" value={unidad} onChange={(e) => setUnidad(e.target.value as UnidadInsumo)} className={INPUT}>
          {UNIDADES_INSUMO.map((valor) => (
            <option key={valor} value={valor}>
              por {ETIQUETA_UNIDAD[valor]}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] text-muted">$</span>
          <input aria-label="Costo" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} className={INPUT} />
        </div>
        <div className="col-span-2 flex justify-end gap-1 sm:col-span-1">
          {cambio && (
            <Button size="sm" disabled={trabajando} onClick={guardar}>
              Guardar
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={trabajando} onClick={borrar}>
            Quitar
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-[12.5px] text-danger-text">
          {error}
        </p>
      )}
    </li>
  );
}

/** Materiales, fabricación o mano de obra: la lista y el alta. */
function SeccionInsumos({
  tipo,
  insumos,
  onCambio,
}: {
  tipo: TipoInsumo;
  insumos: Insumo[];
  onCambio: (insumos: Insumo[]) => void;
}) {
  const seccion = SECCIONES_INSUMO[tipo];
  const delTipo = insumos.filter((insumo) => insumo.tipo === tipo);
  const [nombre, setNombre] = useState("");
  const [unidad, setUnidad] = useState<UnidadInsumo>(seccion.unidad);
  const [costo, setCosto] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agregar = (e: React.FormEvent) => {
    e.preventDefault();
    const costoCentavos = leerCentavos(costo);
    if (!nombre.trim()) return setError("Poné el nombre.");
    if (costoCentavos === null || costoCentavos <= 0) return setError("Poné cuánto te cuesta, mayor que cero.");
    setTrabajando(true);
    setError(null);
    crearInsumo({ tipo, nombre: nombre.trim(), unidad, costoCentavos })
      .then((nuevo) => {
        onCambio([...insumos, nuevo]);
        setNombre("");
        setCosto("");
      })
      .catch((err: unknown) => setError(mensajeDe(err, "No pudimos agregarlo.")))
      .finally(() => setTrabajando(false));
  };

  return (
    <section aria-labelledby={`titulo-${tipo}`} className="rounded-lg border border-line bg-card p-4">
      <h2 id={`titulo-${tipo}`} className="font-display text-[17px] font-bold text-ink">
        {seccion.titulo}
      </h2>
      <p className="mb-2 text-[13px] text-ink-secondary">{seccion.ayuda}</p>
      {delTipo.length > 0 && (
        <ul aria-label={seccion.titulo} className="divide-y divide-line">
          {delTipo.map((insumo) => (
            <FilaInsumo
              key={insumo.id}
              insumo={insumo}
              onGuardado={(guardado) => onCambio(insumos.map((i) => (i.id === guardado.id ? guardado : i)))}
              onBorrado={(id) => onCambio(insumos.filter((i) => i.id !== id))}
            />
          ))}
        </ul>
      )}
      <form
        onSubmit={agregar}
        aria-label={`Agregar a ${seccion.titulo.toLowerCase()}`}
        className="mt-2 grid grid-cols-2 gap-2 border-t border-dashed border-line pt-3 sm:grid-cols-[minmax(0,1fr)_140px_160px_auto] sm:items-end"
      >
        <label className="col-span-2 sm:col-span-1">
          <span className={LABEL}>Nuevo</span>
          <input
            value={nombre}
            maxLength={LARGO_MAX_NOMBRE_INSUMO}
            placeholder={`Ej.: ${seccion.ejemplo}`}
            onChange={(e) => setNombre(e.target.value)}
            className={INPUT}
          />
        </label>
        <label>
          <span className={LABEL}>Se cobra</span>
          <select value={unidad} onChange={(e) => setUnidad(e.target.value as UnidadInsumo)} className={INPUT}>
            {UNIDADES_INSUMO.map((valor) => (
              <option key={valor} value={valor}>
                por {ETIQUETA_UNIDAD[valor]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={LABEL}>Te cuesta ($)</span>
          <input inputMode="decimal" value={costo} placeholder="0" onChange={(e) => setCosto(e.target.value)} className={INPUT} />
        </label>
        <Button type="submit" variant="secondary" disabled={trabajando} className="col-span-2 sm:col-span-1">
          Agregar
        </Button>
        {error && (
          <p role="alert" className="col-span-2 text-[12.5px] text-danger-text sm:col-span-4">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

const REDONDEOS: ReadonlyArray<[number, string]> = [
  [0, "Sin redondear"],
  [1_000, "A los $ 10"],
  [10_000, "A los $ 100"],
  [100_000, "A los $ 1.000"],
  [1_000_000, "A los $ 10.000"],
];

type ExtraGeneral = { clave: string; nombre: string; modo: "fijo" | "porcentaje"; valor: string };

/** Lo que se suma a toda cotización y cómo se presenta el presupuesto. */
function SeccionConfig({ inicial }: { inicial: ConfigCotizacion }) {
  const [extras, setExtras] = useState<ExtraGeneral[]>(() =>
    inicial.extras.map((extra) => ({
      clave: crypto.randomUUID(),
      nombre: extra.nombre,
      modo: extra.modo,
      valor: extra.modo === "fijo" ? centavosParaInput(extra.valor) : String(extra.valor).replace(".", ","),
    })),
  );
  const [redondeo, setRedondeo] = useState(inicial.redondeoCentavos);
  const [estimativo, setEstimativo] = useState(inicial.estimativo);
  const [vigencia, setVigencia] = useState(inicial.vigenciaDias === null ? "" : String(inicial.vigenciaDias));
  const [desglose, setDesglose] = useState(inicial.desgloseAlCliente);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const cambiarExtra = (clave: string, cambio: Partial<ExtraGeneral>) => {
    setGuardado(false);
    setExtras((actuales) => actuales.map((extra) => (extra.clave === clave ? { ...extra, ...cambio } : extra)));
  };

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    const armados: ConfigCotizacion["extras"] = [];
    for (const extra of extras) {
      const valor = extra.modo === "fijo" ? leerCentavos(extra.valor) : Number(extra.valor.trim().replace(",", "."));
      if (!extra.nombre.trim() || valor === null || !Number.isFinite(valor) || valor <= 0) {
        setError("Cada extra necesita un nombre y un valor mayor que cero.");
        return;
      }
      armados.push({ nombre: extra.nombre.trim(), modo: extra.modo, valor });
    }
    const dias = vigencia.trim() ? Number(vigencia) : null;
    if (dias !== null && (!Number.isInteger(dias) || dias < 1 || dias > 365)) {
      setError("La vigencia tiene que ser de 1 a 365 días, o dejala vacía.");
      return;
    }
    setTrabajando(true);
    setError(null);
    guardarConfigCotizacion({ extras: armados, redondeoCentavos: redondeo, estimativo, vigenciaDias: dias, desgloseAlCliente: desglose })
      .then(() => setGuardado(true))
      .catch((err: unknown) => setError(mensajeDe(err, "No pudimos guardar.")))
      .finally(() => setTrabajando(false));
  };

  return (
    <form
      onSubmit={guardar}
      onChange={() => setGuardado(false)}
      aria-labelledby="titulo-config"
      className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
    >
      <div>
        <h2 id="titulo-config" className="font-display text-[17px] font-bold text-ink">
          Cómo cotiza tu asistente
        </h2>
        <p className="text-[13px] text-ink-secondary">Vale para todos los productos que cotiza con su receta.</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={LABEL}>Se suma a toda cotización</legend>
        <p className="text-[12.5px] text-muted">
          Los porcentajes van en orden, cada uno sobre lo que lleva sumado: “Ganancia 40 %” y después “IVA 21 %” es el IVA sobre el
          precio con ganancia.
        </p>
        {extras.map((extra, i) => (
          <div key={extra.clave} role="group" aria-label={`Extra general ${i + 1}`} className="grid grid-cols-[minmax(0,1fr)_130px_120px_auto] gap-2">
            <input
              aria-label="Nombre del extra"
              value={extra.nombre}
              maxLength={60}
              placeholder="Ganancia"
              onChange={(e) => cambiarExtra(extra.clave, { nombre: e.target.value })}
              className={INPUT}
            />
            <select
              aria-label="Cómo se suma"
              value={extra.modo}
              onChange={(e) => cambiarExtra(extra.clave, { modo: e.target.value as ExtraGeneral["modo"] })}
              className={INPUT}
            >
              <option value="porcentaje">Porcentaje</option>
              <option value="fijo">Monto fijo</option>
            </select>
            <input
              aria-label={extra.modo === "fijo" ? "Monto" : "Porcentaje"}
              inputMode="decimal"
              value={extra.valor}
              placeholder={extra.modo === "fijo" ? "$" : "%"}
              onChange={(e) => cambiarExtra(extra.clave, { valor: e.target.value })}
              className={INPUT}
            />
            <Button variant="ghost" size="sm" onClick={() => setExtras((actuales) => actuales.filter((e) => e.clave !== extra.clave))}>
              Quitar
            </Button>
          </div>
        ))}
        {extras.length < MAX_EXTRAS && (
          <button
            type="button"
            onClick={() =>
              setExtras((actuales) => [...actuales, { clave: crypto.randomUUID(), nombre: "", modo: "porcentaje", valor: "" }])
            }
            className="cursor-pointer self-start text-[13px] font-semibold text-link"
          >
            + Agregar extra
          </button>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={LABEL}>Redondeo del total (para arriba)</span>
          <select value={redondeo} onChange={(e) => setRedondeo(Number(e.target.value))} className={INPUT}>
            {REDONDEOS.map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={LABEL}>
            Vale por (días) <span className="font-normal text-muted">· vacío: no se dice</span>
          </span>
          <input inputMode="numeric" value={vigencia} placeholder="Ej.: 7" onChange={(e) => setVigencia(e.target.value)} className={INPUT} />
        </label>
      </div>

      <fieldset className="flex flex-col gap-1.5 text-[13.5px] text-ink">
        <legend className={LABEL}>El precio que calcula tu asistente es</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="estimativo" checked={estimativo} onChange={() => setEstimativo(true)} />
          Estimativo: le avisa que el precio final puede variar un poco
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="estimativo" checked={!estimativo} onChange={() => setEstimativo(false)} />
          Definitivo
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-1.5 text-[13.5px] text-ink">
        <legend className={LABEL}>Lo que ve el cliente</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="desglose" checked={desglose === "total"} onChange={() => setDesglose("total")} />
          Sólo el total (vos ves el detalle en Ventas)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="desglose" checked={desglose === "detallado"} onChange={() => setDesglose("detallado")} />
          Cada material, fabricación y extra con su precio
        </label>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      )}
      {guardado && (
        <p role="status" className="text-sm text-success-text">
          Guardado.
        </p>
      )}
      <Button type="submit" disabled={trabajando} className="self-end">
        Guardar
      </Button>
    </form>
  );
}

function Costos() {
  const [datos, setDatos] = useState<CostosDelComercio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = { cancelado: false };
    obtenerCostos()
      .then((cargados) => !ctrl.cancelado && setDatos(cargados))
      .catch((err: unknown) => !ctrl.cancelado && setError(mensajeDe(err, "No pudimos cargar tus costos.")));
    return () => {
      ctrl.cancelado = true;
    };
  }, []);

  return (
    <main className="flex-1 bg-page p-5 pb-24 md:pb-8">
      <div className="mx-auto flex max-w-[960px] flex-col gap-4">
        <div>
          <h1 className="mb-1 font-display text-[27px] leading-[1.15] font-bold tracking-[-0.025em] text-ink">Materiales y costos</h1>
          <p className="text-sm leading-[1.6] text-ink-secondary">
            Lo que te cuesta hacer cada pedido. Con esto y la receta de cada producto, tu asistente calcula el presupuesto: la cuenta
            la hace el sistema, nunca la inventa.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
        {!datos ? (
          !error && <p className="py-10 text-center text-sm text-muted">Cargando tus costos…</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
            <div className="flex flex-col gap-4">
              {TIPOS_INSUMO.map((tipo) => (
                <SeccionInsumos
                  key={tipo}
                  tipo={tipo}
                  insumos={datos.insumos}
                  onCambio={(insumos) => setDatos((actual) => (actual ? { ...actual, insumos } : actual))}
                />
              ))}
            </div>
            <div className="lg:sticky lg:top-4">
              <SeccionConfig inicial={datos.config} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
