"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { leerPlanilla, MAX_FILAS, plantillaCsv, type FilaPlanilla } from "@/lib/planilla";
import { ErrorDeApi, importarProductos, type ResumenImportacion } from "@/lib/productos";

type Paso =
  | { tipo: "elegir" }
  | { tipo: "leyendo" }
  | { tipo: "vista-previa"; archivo: string; filas: FilaPlanilla[]; resumen: ResumenImportacion }
  | { tipo: "importando"; archivo: string }
  | { tipo: "listo"; resumen: ResumenImportacion };

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

  const elegir = (archivo: File | undefined) => {
    if (!archivo) return;
    setError(null);
    setPaso({ tipo: "leyendo" });
    leerPlanilla(archivo)
      .then((filas) => {
        if (filas.length === 0) throw new Error("vacia");
        if (filas.length > MAX_FILAS) throw new Error("larga");
        return importarProductos(filas, false).then((resumen) => {
          setPaso({ tipo: "vista-previa", archivo: archivo.name, filas, resumen });
        });
      })
      .catch((err: unknown) => {
        const mensaje =
          err instanceof ErrorDeApi
            ? err.message
            : err instanceof Error && err.message === "formato"
              ? "Subí un archivo .csv o .xlsx."
              : err instanceof Error && err.message === "vacia"
                ? "La planilla no tiene filas con productos."
                : err instanceof Error && err.message === "larga"
                  ? `La planilla tiene más de ${MAX_FILAS.toLocaleString("es-AR")} filas: subila en partes.`
                  : "No pudimos leer el archivo. Revisá que sea la plantilla.";
        setError(mensaje);
        setPaso({ tipo: "elegir" });
      });
  };

  const confirmar = () => {
    if (paso.tipo !== "vista-previa") return;
    setPaso({ tipo: "importando", archivo: paso.archivo });
    importarProductos(paso.filas, true)
      .then((resumen) => {
        setPaso({ tipo: "listo", resumen });
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
            existe, se actualiza; lo que no está en la planilla no se toca.
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
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink">
            <strong>{paso.archivo}</strong>: {cantidad(paso.resumen.nuevos, "producto nuevo", "productos nuevos")},{" "}
            {cantidad(paso.resumen.actualizados, "actualizado", "actualizados")} (
            {cantidad(paso.resumen.variantes, "variante", "variantes")}).
          </p>
          <ListaErrores resumen={paso.resumen} />
          <div className="flex gap-2">
            <Button onClick={confirmar} disabled={paso.resumen.nuevos + paso.resumen.actualizados === 0}>
              Importar {cantidad(paso.resumen.nuevos + paso.resumen.actualizados, "producto", "productos")}
            </Button>
            <Button variant="secondary" onClick={() => setPaso({ tipo: "elegir" })}>
              Elegir otro archivo
            </Button>
          </div>
        </div>
      )}

      {paso.tipo === "importando" && <p className="text-sm text-muted">Importando {paso.archivo}…</p>}

      {paso.tipo === "listo" && (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-sm text-success-text">
            Listo: {cantidad(paso.resumen.nuevos, "nuevo", "nuevos")} y{" "}
            {cantidad(paso.resumen.actualizados, "actualizado", "actualizados")}. El asistente los encuentra por nombre
            desde ya, y por significado en unos minutos.
          </p>
          <ListaErrores resumen={paso.resumen} />
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

function ListaErrores({ resumen }: { resumen: ResumenImportacion }) {
  if (resumen.totalErrores === 0) return null;
  return (
    <div className="rounded-md bg-danger-subtle p-3">
      <p className="mb-1 text-[13px] font-semibold text-danger-text">
        {resumen.totalErrores === 1 ? "1 fila con errores" : `${resumen.totalErrores} filas con errores`} (no se
        importan):
      </p>
      <ul className="max-h-48 overflow-y-auto text-[12.5px] text-danger-text">
        {resumen.errores.map((error, indice) => (
          <li key={`${error.fila}-${indice}`}>
            Fila {error.fila + 1}: {error.mensaje}
          </li>
        ))}
      </ul>
      {resumen.totalErrores > resumen.errores.length && (
        <p className="mt-1 text-[12px] text-danger-text">…y {resumen.totalErrores - resumen.errores.length} más.</p>
      )}
    </div>
  );
}
