"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { EditorMensaje } from "@/components/asistente/EditorMensaje";
import { ListaMensajes } from "@/components/asistente/ListaMensajes";
import { VistaPreviaMensaje } from "@/components/asistente/VistaPreviaMensaje";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  datosDeEjemplo,
  mensajesDe,
  validarMensaje,
  type ClaveMensaje,
  type MensajeConfigurado,
  type MensajesAgente,
  type TipoAsistente,
} from "@/lib/mensajes";
import { useRequireSession } from "@/lib/session";

type AgentGuardado = {
  tipoAsistente?: TipoAsistente;
  nombreBot: string;
  nombreTitular: string;
  mensajes?: MensajesAgente;
};

const AUTOMATICO: MensajeConfigurado = { modo: "auto", texto: "" };

export default function AsistentePage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const [agent, setAgent] = useState<AgentGuardado | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    apiFetch("/agents/me")
      .then(async (res) => {
        if (!res.ok) return null;
        // Sin agente la API contesta 200 con el cuerpo vacío.
        const texto = await res.text();
        return texto ? (JSON.parse(texto) as AgentGuardado) : null;
      })
      .then((guardado) => {
        if (!guardado) {
          router.replace("/contanos");
          return;
        }
        setAgent(guardado);
      })
      .catch(() => router.replace("/inicio"));
  }, [status, router]);

  if (status !== "authenticated" || !user || !agent) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando los mensajes de tu asistente…</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="asistente" user={user} />
      <Mensajes agent={agent} onGuardado={setAgent} />
      <MobileTabBar active="asistente" />
    </div>
  );
}

function Mensajes({ agent, onGuardado }: { agent: AgentGuardado; onGuardado: (agent: AgentGuardado) => void }) {
  const definiciones = useMemo(() => mensajesDe(agent.tipoAsistente ?? "agenda"), [agent.tipoAsistente]);
  const guardados = agent.mensajes ?? {};
  const [borrador, setBorrador] = useState<MensajesAgente>(guardados);
  const [seleccion, setSeleccion] = useState<ClaveMensaje>(definiciones[0].clave);
  // En el celular se ve la lista o un mensaje, nunca los dos.
  const [abiertoEnMovil, setAbiertoEnMovil] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "error" } | null>(null);

  const nombreBot = agent.nombreBot || "Tu asistente";
  const datos = datosDeEjemplo(nombreBot, agent.nombreTitular || "Tu negocio");

  const filas = definiciones.map((definicion) => {
    const mensaje = borrador[definicion.clave] ?? AUTOMATICO;
    return { definicion, mensaje, validacion: validarMensaje(definicion, mensaje) };
  });
  const actual = filas.find((fila) => fila.definicion.clave === seleccion) ?? filas[0];

  const cambiadas = filas.filter(({ definicion, mensaje }) => {
    const antes = guardados[definicion.clave] ?? AUTOMATICO;
    return antes.modo !== mensaje.modo || antes.texto !== mensaje.texto;
  });
  const hayErrores = filas.some((fila) => fila.validacion.error);
  const puedeGuardar = cambiadas.length > 0 && !hayErrores && !guardando;

  // Cerrar la pestaña con cambios sin guardar pide confirmación.
  useEffect(() => {
    if (cambiadas.length === 0) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [cambiadas.length]);

  const cambiar = (clave: ClaveMensaje, mensaje: MensajeConfigurado) => {
    setAviso(null);
    setBorrador((anterior) => ({ ...anterior, [clave]: mensaje }));
  };

  const guardar = () => {
    setGuardando(true);
    setAviso(null);
    const cuerpo = Object.fromEntries(cambiadas.map(({ definicion, mensaje }) => [definicion.clave, mensaje]));
    apiFetch("/agents/me/mensajes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    })
      .then(async (res) => {
        if (res.status === 400) {
          const { message } = (await res.json()) as { message?: string };
          throw new Error(typeof message === "string" ? message : "Revisá los mensajes marcados.");
        }
        if (!res.ok) throw new Error("No pudimos guardar los cambios. Probá de nuevo.");
        return res.json() as Promise<AgentGuardado>;
      })
      .then((guardado) => {
        onGuardado(guardado);
        setBorrador(guardado.mensajes ?? {});
        setAviso({ texto: `Guardado. ${nombreBot} los usa desde el próximo mensaje.`, tono: "ok" });
      })
      .catch((error: Error) => setAviso({ texto: error.message, tono: "error" }))
      .finally(() => setGuardando(false));
  };

  const descartar = () => {
    setAviso(null);
    setBorrador(guardados);
  };

  const estado = aviso && (
    <p role="status" className={cn("text-sm font-semibold", aviso.tono === "ok" ? "text-success-text" : "text-danger-text")}>
      {aviso.texto}
    </p>
  );

  return (
    <main className="flex-1 bg-page px-5 pt-6 pb-36 md:pb-10">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6">
        <div className={cn("flex-wrap items-end justify-between gap-4", abiertoEnMovil ? "hidden md:flex" : "flex")}>
          <div className="max-w-[640px]">
            <p className="mb-1 text-[13px] font-bold tracking-[0.04em] text-primary-hover uppercase">Tu asistente</p>
            <h1 className="mb-1.5 font-display text-[27px] leading-[1.15] font-bold tracking-[-0.025em] text-ink md:text-[32px]">
              Mensajes de {nombreBot}
            </h1>
            <p className="text-sm leading-[1.6] text-ink-secondary">
              Elegí qué mensajes querés escribir vos. Los que dejes en automático los sigue redactando {nombreBot} según
              cada charla. Las reglas de tu negocio (horarios, stock, precios) se respetan igual.
            </p>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            {estado}
            <Button variant="secondary" onClick={descartar} disabled={cambiadas.length === 0 || guardando}>
              Descartar
            </Button>
            <Button onClick={guardar} disabled={!puedeGuardar}>
              {guardando ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-6">
          <ListaMensajes
            filas={filas}
            seleccion={actual.definicion.clave}
            onElegir={(clave) => {
              setSeleccion(clave);
              setAbiertoEnMovil(true);
            }}
            className={cn("w-full md:w-[280px] md:flex-none", abiertoEnMovil && "hidden md:flex")}
          />

          <div className={cn("min-w-0 flex-[999_1_440px] flex-col gap-4", abiertoEnMovil ? "flex" : "hidden md:flex")}>
            <button
              type="button"
              onClick={() => setAbiertoEnMovil(false)}
              className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-bold text-ink-secondary md:hidden"
            >
              <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Mensajes de {nombreBot}
            </button>
            <EditorMensaje
              key={actual.definicion.clave}
              definicion={actual.definicion}
              mensaje={actual.mensaje}
              validacion={actual.validacion}
              nombreBot={nombreBot}
              onCambio={(mensaje) => cambiar(actual.definicion.clave, mensaje)}
            />
            <details className="overflow-hidden rounded-lg border border-line bg-card lg:hidden" open>
              <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-bold text-ink">Vista previa</summary>
              <div className="p-3">
                <VistaPreviaMensaje
                  definicion={actual.definicion}
                  mensaje={actual.mensaje}
                  datos={datos}
                  nombreBot={nombreBot}
                  nombreTitular={agent.nombreTitular}
                />
              </div>
            </details>
          </div>

          <aside aria-label="Vista previa" className="hidden w-[340px] flex-none flex-col gap-2.5 lg:flex">
            <h2 className="text-sm font-bold text-ink-secondary">Vista previa</h2>
            <VistaPreviaMensaje
              definicion={actual.definicion}
              mensaje={actual.mensaje}
              datos={datos}
              nombreBot={nombreBot}
              nombreTitular={agent.nombreTitular}
            />
          </aside>
        </div>
      </div>

      {/* En el celular el guardado queda fijo abajo, sobre la barra de pestañas. */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-10 flex-col gap-2 border-t border-line bg-card px-4 py-3 md:hidden",
          abiertoEnMovil || cambiadas.length > 0 ? "flex" : "hidden",
        )}
      >
        {estado}
        <Button fullWidth onClick={guardar} disabled={!puedeGuardar}>
          {guardando ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </main>
  );
}
