"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SessionChip } from "@/components/SessionChip";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { useRequireSession } from "@/lib/session";

type TipoUsoId =
  | "comercio"
  | "consultorio"
  | "reuniones"
  | "visitas"
  | "personal"
  | "otro";

const TIPOS_USO: Array<{ id: TipoUsoId; label: string }> = [
  { id: "comercio", label: "Comercio" },
  { id: "consultorio", label: "Consultorio" },
  { id: "reuniones", label: "Reuniones" },
  { id: "visitas", label: "Visitas" },
  { id: "personal", label: "Agenda personal" },
  { id: "otro", label: "Otro" },
];

const EJEMPLOS: Record<TipoUsoId, string[]> = {
  comercio: [
    "Turnos de 20 minutos para probarse ropa, de martes a sábado por la tarde.",
    "Reservas para el salón, corte y color, cada 45 minutos de lunes a viernes.",
  ],
  consultorio: [
    "Sesiones de kinesiología de 45 minutos, de lunes a viernes por la tarde, con quince minutos entre paciente.",
    "Consultas médicas de 20 minutos, turno mañana y tarde, con urgencias los sábados.",
  ],
  reuniones: [
    "Demos de producto de 30 minutos con prospectos, de lunes a viernes por la mañana.",
    "Uno a uno semanal con cada persona del equipo, martes y jueves a la tarde.",
    "Entrevistas de selección de 45 minutos, coordinadas con Recursos Humanos toda la semana.",
  ],
  visitas: [
    "Visitas a domicilio de una hora, zona norte los lunes y zona sur los jueves.",
    "Recorridas de obra de 40 minutos con el cliente, de martes a viernes por la mañana.",
  ],
  personal: [
    "Bloques de una hora para estudiar o entrenar, de lunes a viernes antes del mediodía.",
    "Recordatorios de citas médicas y trámites personales, con aviso el día anterior por la tarde.",
  ],
  otro: [
    "Turnos de 30 minutos para asesorías puntuales, coordinados por WhatsApp toda la semana.",
    "Reservas de sala compartida por hora, de lunes a sábado en horario de oficina.",
  ],
};

const MINIMO_PALABRAS = 10;

function contarPalabras(texto: string): number {
  return texto.trim().split(/\s+/).filter(Boolean).length;
}

export default function ContanosPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const [tipoUso, setTipoUso] = useState<TipoUsoId>("comercio");
  const [descripcion, setDescripcion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const palabras = useMemo(() => contarPalabras(descripcion), [descripcion]);
  const listo = palabras >= MINIMO_PALABRAS;

  async function continuar() {
    setEnviando(true);
    setError(null);

    const res = await apiFetch("/agents/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoUso, descripcion }),
    });

    if (!res.ok) {
      setError("No pudimos crear tu agente. Probá de nuevo.");
      setEnviando(false);
      return;
    }

    router.push("/vincular");
  }

  if (status !== "authenticated" || !user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando tu sesión…</p>
      </main>
    );
  }

  return (
    <main className="relative grid min-h-dvh place-items-center bg-page p-6">
      <div className="absolute top-6 right-6">
        <SessionChip user={user} />
      </div>

      <div className="flex w-full max-w-[860px] flex-col overflow-hidden rounded-lg border border-line bg-card shadow-md md:flex-row">
        {/* Columna del tipo de uso */}
        <div className="flex flex-col gap-4 border-b border-line bg-sunken p-6 md:w-[38%] md:border-r md:border-b-0">
          <Badge tone="primary">Paso 2 de 3</Badge>
          <div>
            <h2 className="mb-2 font-display text-xl font-bold tracking-[-0.02em] text-ink">
              Tipo de uso
            </h2>
            <p className="text-sm leading-[1.55] text-ink-secondary">
              Elegí el que más se parezca.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            {TIPOS_USO.map((tipo) => {
              const activo = tipo.id === tipoUso;
              return (
                <button
                  key={tipo.id}
                  type="button"
                  onClick={() => setTipoUso(tipo.id)}
                  className={
                    activo
                      ? "flex cursor-pointer items-center justify-between rounded-sm bg-primary px-3.5 py-2.5 text-left text-sm font-semibold text-primary-on"
                      : "cursor-pointer rounded-sm px-3.5 py-2.5 text-left text-sm text-ink hover:bg-card"
                  }
                >
                  {tipo.label}
                  {activo && (
                    <span className="h-2 w-[7px] -translate-y-0.5 rotate-[-45deg] border-b-2 border-l-2 border-current" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Columna de la descripción */}
        <div className="flex-1 p-6">
          <h1 className="mb-2 font-display text-2xl leading-[1.18] font-bold tracking-[-0.02em] text-ink text-pretty">
            Contanos qué querés agendar
          </h1>
          <p className="mb-4 text-sm leading-[1.6] text-ink-secondary text-pretty">
            Duración, días, con quién. Cuanto más claro, mejor coordina el bot.
          </p>

          <div className="rounded-md border border-line bg-card p-3 focus-within:border-[var(--color-semantic-border-focus)]">
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Reuniones de 30 minutos con clientes, entre las 10 y las 18…"
              rows={4}
              className="min-h-[88px] w-full resize-none bg-transparent text-[14.5px] leading-[1.6] text-ink placeholder:text-muted focus:outline-none"
            />
            <div className="flex items-center justify-between border-t border-line pt-2">
              <span
                className={
                  listo ? "text-xs text-success-text" : "text-xs text-warning-text"
                }
              >
                {listo
                  ? "Listo, con eso alcanza"
                  : `Faltan ${MINIMO_PALABRAS - palabras} palabras`}
              </span>
              <span className="font-mono text-xs text-muted">
                {palabras} / {MINIMO_PALABRAS} palabras
              </span>
            </div>
          </div>

          <p className="mt-4 mb-2 text-[12.5px] font-semibold text-ink-secondary">
            Tocá un ejemplo para empezar
          </p>
          <div className="flex flex-wrap gap-2">
            {EJEMPLOS[tipoUso].map((ejemplo) => (
              <button
                key={ejemplo}
                type="button"
                onClick={() => setDescripcion(ejemplo)}
                className="cursor-pointer rounded-full border border-line bg-sunken px-[11px] py-1.5 text-left text-[12.5px] text-ink hover:border-line-strong"
              >
                {ejemplo}
              </button>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              disabled={!listo || enviando}
              onClick={continuar}
            >
              {enviando ? "Creando tu agente…" : "Continuar"}
            </Button>
            {!listo && (
              <span className="text-[12.5px] text-muted">
                Se habilita al llegar a {MINIMO_PALABRAS} palabras
              </span>
            )}
          </div>
          {error && <p className="mt-3 text-[12.5px] text-danger-text">{error}</p>}
        </div>
      </div>
    </main>
  );
}
