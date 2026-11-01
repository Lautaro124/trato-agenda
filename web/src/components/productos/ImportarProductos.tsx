"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { conValor, leerPlanilla, MAX_FILAS, plantillaCsv, type FilaPlanilla } from "@/lib/planilla";
import { ErrorDeApi, importarProductos, type ErrorDeFila, type ResumenImportacion } from "@/lib/productos";
import { CompletarFilasModal, type Cambios } from "./CompletarFilasModal";

type Paso =
  | { tipo: "elegir" }
  | { tipo: "leyendo" }
  | { tipo: "vista-previa"; archivo: string; filas: FilaPlanilla[]; etiquetas: Etiquetas; resumen: ResumenImportacion }
  | { tipo: "importando"; archivo: string }
  | { tipo: "listo"; resumen: ResumenImportacion; etiquetas: Etiquetas };

type Etiquetas = Record<string, string>;

function cantidad(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString("es-AR")} ${n === 1 ? singular : plural}`;
}

function descargarPlantilla() {
  const url = URL.createObjectURL(new Blob([plantillaCsv()], { type: "text/csv;charset=utf-8" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = "plantilla-productos.csv";
  enlace.click();
  URL.revokeObjectURL(url);
}

/**
 * Importación en dos pasos: primero la API valida y cuenta qué va a pasar
 * (sin escribir nada), y recién con "Importar" guarda. Los productos con
 * errores no se importan; el resto sí.
 */
export function ImportarProductos({ onCerrar, onImportado }: { onCerrar: () => void; onImportado: () => void }) {
  const [paso, setPaso] = useState<Paso>({ tipo: "elegir" });
  const [error, setError] = useState<string | null>(null);
  const [completando, setCompletando] = useState(false);

  const elegir = (archivo: File | undefined) => {
    if (!archivo) return;
    setError(null);
    setPaso({ tipo: "leyendo" });
    leerPlanilla(archivo)
      .then(({ filas, etiquetas }) => {
        if (filas.length === 0) throw new Error("vacia");
        if (filas.length > MAX_FILAS) throw new Error("larga");
        return importarProductos(filas, false).then((resumen) => {
          setPaso({ tipo: "vista-previa", archivo: archivo.name, filas, etiquetas, resumen });
        });
      })
      .catch((err: unknown) => {
        const mensaje =
          err instanceof ErrorDeApi
            ? err.message
            : err instanceof Error && err.message === "formato"
              ? "Subí un archivo .csv o .xlsx."
              : err instanceof Error && err.message.startsWith("columnas:")
                ? `A la planilla le falta la columna ${err.message.slice("columnas:".length).split(",").join(", ")}. Usá la fila de encabezados de la plantilla o el archivo tal como lo exporta Mercado Libre.`
              : err instanceof Error && err.message === "vacia"
                ? "La planilla no tiene filas con productos."
                : err instanceof Error && err.message === "larga"
                  ? `La planilla tiene más de ${MAX_FILAS.toLocaleString("es-AR")} filas: subila en partes.`
                  : "No pudimos leer el archivo. Revisá que sea la plantilla.";
        setError(mensaje);
        setPaso({ tipo: "elegir" });
      });
  };

  /** Aplica lo que escribió el usuario sobre las filas leídas y vuelve a revisar, sin escribir nada. */
  const completar = async (cambios: Cambios): Promise<string | null> => {
    if (paso.tipo !== "vista-previa") return null;
    const filas = paso.filas.map((fila) => ({ ...fila }));
    for (const { fila, columna, valor } of cambios) filas[fila - 1] = conValor(filas[fila - 1], columna, valor);
    try {
      const resumen = await importarProductos(filas, false);
      setPaso({ ...paso, filas, resumen });
      if (!resumen.errores.some((e) => e.columna)) setCompletando(false);
      return null;
    } catch (err) {
      return err instanceof ErrorDeApi ? err.message : "No pudimos revisar los cambios. Probá de nuevo.";
    }
  };

  const confirmar = () => {
    if (paso.tipo !== "vista-previa") return;
    const { etiquetas } = paso;
    setPaso({ tipo: "importando", archivo: paso.archivo });
    importarProductos(paso.filas, true)
      .then((resumen) => {
        setPaso({ tipo: "listo", resumen, etiquetas });
        onImportado();
      })
      .catch((err: unknown) => {
        setError(err instanceof ErrorDeApi ? err.message : "No pudimos importar. Probá de nuevo.");
        setPaso({ tipo: "elegir" });
      });
  };

  return (
    <section aria-label="Importar productos" className="rounded-lg border border-line bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[18px] font-bold text-ink">Importar desde una planilla</h2>
          <p className="text-[13px] text-ink-secondary">
            Una fila por variante (talle, color…). Las filas con el mismo código son el mismo producto. Si el código ya
            existe, se actualiza; lo que no está en la planilla no se toca. También podés subir el archivo de
            publicaciones que exportás de Mercado Libre, tal como viene.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCerrar}>
          Cerrar
        </Button>
      </div>

      {(paso.tipo === "elegir" || paso.tipo === "leyendo") && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-line-strong bg-card px-4 py-2 text-[15px] font-semibold text-ink shadow-sm hover:bg-sunken">
            {paso.tipo === "leyendo" ? "Revisando la planilla…" : "Elegir archivo (.csv o .xlsx)"}
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              disabled={paso.tipo === "leyendo"}
              aria-label="Planilla de productos"
              onChange={(e) => {
                elegir(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <Button variant="ghost" size="sm" onClick={descargarPlantilla}>
            Descargar plantilla
          </Button>
        </div>
      )}

      {paso.tipo === "vista-previa" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink">
            <strong>{paso.archivo}</strong>
          </p>
          <Fichas resumen={paso.resumen} />
          <ListaErrores resumen={paso.resumen} etiquetas={paso.etiquetas} />
          {completando && (
            <CompletarFilasModal
              filas={paso.filas}
              errores={paso.resumen.errores}
              etiquetas={paso.etiquetas}
              onGuardar={completar}
              onCerrar={() => setCompletando(false)}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {paso.resumen.errores.some((e) => e.columna) && (
              <Button onClick={() => setCompletando(true)}>
                Completar {cantidad(new Set(paso.resumen.errores.filter((e) => e.columna).map((e) => e.fila)).size, "fila", "filas")} a mano
              </Button>
            )}
            <Button
              variant={paso.resumen.totalErrores > 0 ? "secondary" : "primary"}
              onClick={confirmar}
              disabled={paso.resumen.nuevos + paso.resumen.actualizados === 0}
            >
              {paso.resumen.totalErrores > 0 ? "Importar sólo los válidos" : "Importar"}{" "}
              ({cantidad(paso.resumen.nuevos + paso.resumen.actualizados, "producto", "productos")})
            </Button>
            <Button variant="ghost" onClick={() => setPaso({ tipo: "elegir" })}>
              Elegir otro archivo
            </Button>
          </div>
        </div>
      )}

      {paso.tipo === "importando" && <p className="text-sm text-muted">Importando {paso.archivo}…</p>}

      {paso.tipo === "listo" && (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-sm text-success-text">
            ✓ Listo: {cantidad(paso.resumen.nuevos, "nuevo", "nuevos")} y{" "}
            {cantidad(paso.resumen.actualizados, "actualizado", "actualizados")}. El asistente los encuentra por nombre
            desde ya, y por significado en unos minutos.
          </p>
          <ListaErrores resumen={paso.resumen} etiquetas={paso.etiquetas} />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-text">
          {error}
        </p>
      )}
    </section>
  );
}

/** Tres números grandes para leer de un vistazo qué va a pasar. */
function Fichas({ resumen }: { resumen: ResumenImportacion }) {
  const fichas = [
    { numero: resumen.nuevos, texto: resumen.nuevos === 1 ? "nuevo" : "nuevos", icono: "✓", estilo: "bg-success-subtle text-success-text" },
    { numero: resumen.actualizados, texto: resumen.actualizados === 1 ? "actualizado" : "actualizados", icono: "↻", estilo: "bg-sunken text-ink" },
    { numero: resumen.totalErrores, texto: resumen.totalErrores === 1 ? "con error" : "con errores", icono: "⚠", estilo: resumen.totalErrores > 0 ? "bg-danger-subtle text-danger-text" : "bg-sunken text-muted" },
  ];
  return (
    <ul className="grid grid-cols-3 gap-2" aria-label="Resumen de la planilla">
      {fichas.map((ficha) => (
        <li key={ficha.texto} className={`rounded-md px-3 py-2 ${ficha.estilo}`}>
          <p className="font-display text-[26px] font-bold leading-none">
            <span aria-hidden>{ficha.icono} </span>
            {ficha.numero.toLocaleString("es-AR")}
          </p>
          <p className="mt-1 text-[12.5px] font-semibold">{ficha.texto}</p>
        </li>
      ))}
    </ul>
  );
}

function ListaErrores({ resumen, etiquetas }: Readonly<{ resumen: ResumenImportacion; etiquetas: Etiquetas }>) {
  if (resumen.totalErrores === 0) return null;
  // Una línea por fila: "Fila 5 · Precio: Falta el precio".
  const porFila = new Map<number, ErrorDeFila[]>();
  for (const error of resumen.errores) porFila.set(error.fila, [...(porFila.get(error.fila) ?? []), error]);
  return (
    <div className="rounded-md bg-danger-subtle p-3">
      <p className="mb-2 text-[13px] font-semibold text-danger-text">
        {resumen.totalErrores === 1 ? "1 fila no se importa:" : `${resumen.totalErrores} filas no se importan:`}
      </p>
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-[13px] text-danger-text">
        {[...porFila.entries()].map(([fila, errores]) => (
          <li key={fila} className="flex gap-2">
            <span className="flex-none rounded-sm bg-card px-1.5 font-semibold">Fila {fila + 1}</span>
            <span>
              {errores
                .map((e) => (e.columna ? `${etiquetas[e.columna] ?? e.columna}: ${e.mensaje}` : e.mensaje))
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      {resumen.totalErrores > resumen.errores.length && (
        <p className="mt-1 text-[12px] text-danger-text">…y {resumen.totalErrores - resumen.errores.length} más.</p>
      )}
    </div>
  );
}
