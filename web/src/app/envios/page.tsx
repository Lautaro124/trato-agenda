"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ConfiguracionGeneral } from "@/components/envios/ConfiguracionGeneral";
import { ConsultasSinResolver } from "@/components/envios/ConsultasSinResolver";
import { EditorZona } from "@/components/envios/EditorZona";
import { ListaZonas } from "@/components/envios/ListaZonas";
import { useAvisos } from "@/components/ui/Avisos";
import {
  cambiarActiva,
  eliminarZona,
  guardarConfiguracion,
  guardarZona,
  listarConflictos,
  listarSinResolver,
  listarZonas,
  obtenerConfiguracion,
  zonaVacia,
  type ConfiguracionEnvios,
  type Conflicto,
  type ConsultaSinResolver,
  type Zona,
  type ZonaAGuardar,
} from "@/lib/envios";
import { ErrorDeApi } from "@/lib/productos";
import { useRequireSession } from "@/lib/session";

function mensajeDe(err: unknown, porDefecto: string): string {
  return err instanceof ErrorDeApi ? err.message : porDefecto;
}

const MODALIDAD = { domicilio: "envío a domicilio", sucursal: "retiro en sucursal" } as const;

function Cargando() {
  return (
    <main className="grid min-h-dvh place-items-center bg-page p-6">
      <p className="text-sm text-muted">Cargando tus envíos…</p>
    </main>
  );
}

export default function EnviosPage() {
  const { user, status } = useRequireSession();
  const router = useRouter();
  const esVentas = user?.tipoAsistente === "ventas";

  // Una cuenta de agenda no vende ni envía.
  useEffect(() => {
    if (status === "authenticated" && user && !esVentas) router.replace("/inicio");
  }, [status, user, esVentas, router]);

  if (status !== "authenticated" || !user || !esVentas) return <Cargando />;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="envios" user={user} />
      <Envios />
    </div>
  );
}

type Edicion = { zona: Zona | null } | null;

function Envios() {
  const { avisar, confirmar } = useAvisos();
  const [config, setConfig] = useState<ConfiguracionEnvios | null>(null);
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [conflictos, setConflictos] = useState<Conflicto[]>([]);
  const [sinResolver, setSinResolver] = useState<ConsultaSinResolver[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion>(null);
  const [guardando, setGuardando] = useState(false);
  const [ocupada, setOcupada] = useState<string | null>(null);

  const cargar = useCallback(() => {
    Promise.all([obtenerConfiguracion(), listarZonas(), listarConflictos(), listarSinResolver()])
      .then(([c, z, cf, sr]) => {
        setConfig(c);
        setZonas(z);
        setConflictos(cf);
        setSinResolver(sr);
        setError(null);
      })
      .catch((err) => setError(mensajeDe(err, "No pudimos cargar tus envíos.")));
  }, []);

  useEffect(cargar, [cargar]);

  const cambiarConfig = (cambios: Parameters<typeof guardarConfiguracion>[0]) => {
    const anterior = config;
    // Se ve el cambio al instante; si la API lo rechaza, vuelve a como estaba.
    setConfig((actual) => (actual ? { ...actual, ...cambios } : actual));
    setGuardando(true);
    guardarConfiguracion(cambios)
      .then((c) => {
        setConfig(c);
        avisar("Guardamos la configuración.", "exito");
      })
      .catch((err) => {
        setConfig(anterior);
        avisar(mensajeDe(err, "No pudimos guardar la configuración."), "error");
      })
      .finally(() => setGuardando(false));
  };

  /** Una zona que quedó pausada por chocar con otra: se avisa qué choca. */
  const avisarConflictos = (zona: Zona, encontrados: Conflicto[]) => {
    setConflictos((actuales) => [...actuales.filter((c) => !c.zonas.some((z) => z.id === zona.id)), ...encontrados]);
    if (encontrados.length > 0) {
      avisar(`“${zona.nombre}” quedó pausada: choca con otra zona activa. Mirá el aviso arriba.`, "error");
    }
  };

  const guardar = (datos: ZonaAGuardar) => {
    setGuardando(true);
    guardarZona(datos, edicion?.zona?.id)
      .then(({ zona, conflictos: encontrados }) => {
        setEdicion(null);
        avisarConflictos(zona, encontrados);
        if (encontrados.length === 0) avisar("Guardamos la zona.", "exito");
        cargar();
        window.scrollTo({ top: 0 });
      })
      .catch((err) => avisar(mensajeDe(err, "No pudimos guardar la zona."), "error"))
      .finally(() => setGuardando(false));
  };

  const activar = (zona: Zona, activa: boolean) => {
    setOcupada(zona.id);
    cambiarActiva(zona.id, activa)
      .then(({ zona: actualizada, conflictos: encontrados }) => {
        setZonas((actuales) => actuales.map((z) => (z.id === actualizada.id ? actualizada : z)));
        avisarConflictos(actualizada, encontrados);
      })
      .catch((err) => avisar(mensajeDe(err, "No pudimos cambiar la zona."), "error"))
      .finally(() => setOcupada(null));
  };

  const borrar = async (zona: Zona) => {
    const ok = await confirmar({
      titulo: `¿Borrar “${zona.nombre}”?`,
      texto: "El asistente deja de usar sus tarifas desde la próxima consulta.",
      confirmar: "Sí, borrar",
      tono: "peligro",
    });
    if (!ok) return;
    setOcupada(zona.id);
    eliminarZona(zona.id)
      .then(() => {
        setZonas((actuales) => actuales.filter((z) => z.id !== zona.id));
        setConflictos((actuales) => actuales.filter((c) => !c.zonas.some((z) => z.id === zona.id)));
      })
      .catch((err) => avisar(mensajeDe(err, "No pudimos borrar la zona."), "error"))
      .finally(() => setOcupada(null));
  };

  if (error) {
    return (
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 md:px-6">
        <p role="alert" className="rounded-md bg-danger-subtle px-4 py-3 text-danger-text">
          {error}
        </p>
      </main>
    );
  }
  if (!config) return <Cargando />;

  if (edicion) {
    return (
      <main className="mx-auto flex w-full max-w-[960px] flex-1 flex-col gap-4 px-4 pt-6 pb-28 md:px-6 md:pb-16">
        <nav aria-label="Ruta" className="text-[14px] text-ink-secondary">
          <button type="button" onClick={() => setEdicion(null)} className="cursor-pointer text-link underline">
            Envíos
          </button>{" "}
          <span aria-hidden>›</span> {edicion.zona?.nombre ?? "Nueva zona"}
        </nav>
        <EditorZona
          zona={edicion.zona}
          nueva={zonaVacia()}
          moneda={config.moneda}
          guardando={guardando}
          onGuardar={guardar}
          onCancelar={() => setEdicion(null)}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 px-4 pt-8 pb-28 md:px-6 md:pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-[640px] flex-col gap-1">
          <h1 className="font-display text-[30px] leading-tight font-extrabold text-ink">Envíos</h1>
          <p className="text-ink-secondary">
            Definí a dónde llegás y cuánto cuesta. Tu asistente responde con estas reglas y, si le falta un dato, se lo pide
            al cliente.
          </p>
        </div>
        <Link
          href="/envios/probar"
          className="inline-flex min-h-11 items-center rounded-md bg-primary-hover px-4 font-semibold text-primary-on shadow-sm hover:bg-primary-active"
        >
          Probar respuestas
        </Link>
      </div>

      <ConfiguracionGeneral config={config} guardando={guardando} onCambiar={cambiarConfig} />

      {conflictos.length > 0 && (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-warning bg-warning-subtle px-5 py-4 text-warning-text">
          <p className="font-semibold">Hay zonas que se pisan: el asistente no usa ninguna de las dos para ese lugar.</p>
          <ul className="list-disc pl-5 text-[14.5px]">
            {conflictos.map((c) => (
              <li key={`${c.clave}-${c.zonas.map((z) => z.id).join()}`}>
                {c.zonas.map((z) => `“${z.nombre}”`).join(" y ")} cubren {c.lugar} con {MODALIDAD[c.modalidad]}. Quitá ese lugar de
                una de ellas o cambiá la modalidad.
              </li>
            ))}
          </ul>
        </div>
      )}

      <ListaZonas
        zonas={zonas}
        moneda={config.moneda}
        ocupada={ocupada}
        onNueva={() => setEdicion({ zona: null })}
        onEditar={(zona) => setEdicion({ zona })}
        onActiva={activar}
        onEliminar={(zona) => void borrar(zona)}
      />

      <ConsultasSinResolver consultas={sinResolver} />

      <p className="text-[13px] text-ink-secondary">
        Provincias y localidades del catálogo Georef (datos.gob.ar, actualizado al {config.fechaCatalogo}). Los códigos postales
        no se deducen: cada CP vale para la provincia que le asignes.
      </p>
    </main>
  );
}
