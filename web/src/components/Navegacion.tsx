"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Usuario } from "@/lib/session";

export type Pantalla =
  | "inicio"
  | "vinculacion"
  | "calendario"
  | "reuniones"
  | "productos"
  | "preguntas"
  | "recomendaciones"
  | "ventas"
  | "envios"
  | "plan"
  | "cuenta"
  | "asistente"
  | "rendimiento"
  | "anuncios";

type Destino = { tipo: "destino"; pantalla: Pantalla; href: string; label: string; icono?: ReactNode; className?: string };
type Grupo = { tipo: "grupo"; id: string; label: string; icono: ReactNode; destinos: Destino[] };
type Seccion = (Destino | Grupo)[];

function Icono({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="flex-none"
    >
      {children}
    </svg>
  );
}

const ICONOS = {
  inicio: (
    <Icono>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </Icono>
  ),
  calendario: (
    <Icono>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 2v4" />
      <path d="M16 2v4" />
    </Icono>
  ),
  reuniones: (
    <Icono>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icono>
  ),
  productos: (
    <Icono>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </Icono>
  ),
  ventas: (
    <Icono>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </Icono>
  ),
  rendimiento: (
    <Icono>
      <path d="M3 3v18h18" />
      <path d="m7 15 4-4 3 3 5-6" />
    </Icono>
  ),
  asistente: (
    <Icono>
      <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 17v4" />
      <path d="M17 19h4" />
    </Icono>
  ),
  plan: (
    <Icono>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </Icono>
  ),
};

const destino = (pantalla: Pantalla, href: string, label: string, icono?: ReactNode, className?: string): Destino => ({
  tipo: "destino",
  pantalla,
  href,
  label,
  icono,
  className,
});

/**
 * Las pantallas dependen de qué hace el asistente: una cuenta de ventas no
 * tiene calendario ni reuniones, tiene catálogo. En ventas, arriba van
 * Inicio, Tratos y Rendimiento; lo del catálogo se agrupa en Productos.
 */
export function seccionesDe(user: Usuario): Seccion[] {
  // Las conversaciones de WhatsApp, el control bot/humano (LAU-81) y el estado del trato.
  const inicio = destino("inicio", "/inicio", "Inicio", ICONOS.inicio);
  const configuracion: Seccion = [
    destino("asistente", "/asistente", "Asistente", ICONOS.asistente),
    destino("plan", "/plan", "Plan", ICONOS.plan),
  ];
  if (user.tipoAsistente === "ventas") {
    return [
      [
        inicio,
        // Los pedidos: los que arma el asistente y los tratos que cerrás vos.
        destino("ventas", "/ventas", "Tratos", ICONOS.ventas),
        // Cómo les va a los productos en los chats: conversión, etapas y abandono (LAU-30).
        destino("rendimiento", "/rendimiento", "Rendimiento", ICONOS.rendimiento),
      ],
      [
        {
          tipo: "grupo",
          id: "productos",
          label: "Productos",
          icono: ICONOS.productos,
          destinos: [
            destino("productos", "/productos", "Catálogo"),
            // Lo que el asistente le pregunta al cliente al armar el pedido (LAU-100).
            destino("preguntas", "/preguntas", "Preguntas"),
            // Lo que el asistente recomienda o responde según lo que necesita el cliente (LAU-105).
            destino("recomendaciones", "/recomendaciones", "Recomendaciones"),
            // Zonas, tarifas y respuestas del asistente sobre envíos (LAU-102).
            destino("envios", "/envios", "Envíos"),
            // Los anuncios de Facebook o Instagram desde los que escriben los clientes (LAU-103).
            destino("anuncios", "/anuncios", "Anuncios"),
          ],
        },
      ],
      configuracion,
    ];
  }
  return [
    [inicio],
    [
      destino("calendario", "/calendario", "Calendario", ICONOS.calendario),
      destino("reuniones", "/reuniones", "Reuniones", ICONOS.reuniones),
    ],
    configuracion,
  ];
}

/** Dónde está la pantalla en la navegación, para el encabezado: "Productos / Envíos". */
export function ubicacionDe(secciones: Seccion[], active: Pantalla): { grupo: string | null; label: string } | null {
  for (const entrada of secciones.flat()) {
    if (entrada.tipo === "destino" && entrada.pantalla === active) return { grupo: null, label: entrada.label };
    if (entrada.tipo === "grupo") {
      const d = entrada.destinos.find((x) => x.pantalla === active);
      if (d) return { grupo: entrada.label, label: d.label };
    }
  }
  return null;
}

const ITEM = "flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-sm px-3 text-left text-[14px] max-md:min-h-11";
const ACTIVO = "bg-primary-subtle font-semibold text-primary-active";
const INACTIVO = "font-medium text-ink-secondary hover:bg-sunken hover:text-ink";

function Flecha({ abierto }: Readonly<{ abierto: boolean }>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("flex-none text-muted transition-transform", abierto && "rotate-180")}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

type PropsNavegacion = Readonly<{
  id: string;
  secciones: Seccion[];
  active: Pantalla;
  /** Sólo íconos: los nombres quedan para lectores de pantalla y en el `title`. */
  contraida: boolean;
  gruposCerrados: readonly string[];
  onAlternarGrupo: (id: string) => void;
  /** Tocar un grupo con la barra contraída la despliega con ese grupo abierto. */
  onDesplegarEn: (id: string) => void;
  onNavegar?: () => void;
  tutorial?: string;
}>;

/** La lista de pantallas: la usan la barra lateral de escritorio y el cajón del celular. */
export function Navegacion({
  id,
  secciones,
  active,
  contraida,
  gruposCerrados,
  onAlternarGrupo,
  onDesplegarEn,
  onNavegar,
  tutorial,
}: PropsNavegacion) {
  const enlace = (d: Destino, conIcono: boolean) => {
    const activa = d.pantalla === active;
    return (
      <li key={d.pantalla} className={d.className}>
        <Link
          href={d.href}
          aria-current={activa ? "page" : undefined}
          title={contraida ? d.label : undefined}
          onClick={onNavegar}
          className={cn(ITEM, activa ? ACTIVO : INACTIVO, contraida && "justify-center px-0", !conIcono && "text-[13.5px]")}
        >
          {conIcono && d.icono}
          <span className={cn(contraida && "sr-only")}>{d.label}</span>
        </Link>
      </li>
    );
  };

  return (
    <nav id={id} aria-label="Navegación principal" data-tutorial={tutorial} className="min-h-0 flex-1 overflow-y-auto">
      {secciones.map((seccion, i) => (
        <ul key={i} className={cn("flex flex-col gap-0.5", i > 0 && "mt-2 border-t border-line pt-2")}>
          {seccion.map((entrada) => {
            if (entrada.tipo === "destino") return enlace(entrada, true);
            const abierto = !gruposCerrados.includes(entrada.id);
            const contieneActiva = entrada.destinos.some((d) => d.pantalla === active);
            const panel = `${id}-${entrada.id}`;
            const estilo =
              contieneActiva && (contraida || !abierto) ? ACTIVO : contieneActiva ? "font-semibold text-ink hover:bg-sunken" : INACTIVO;
            return (
              <li key={entrada.id}>
                <button
                  type="button"
                  aria-expanded={!contraida && abierto}
                  aria-controls={contraida ? undefined : panel}
                  title={contraida ? entrada.label : undefined}
                  onClick={() => (contraida ? onDesplegarEn(entrada.id) : onAlternarGrupo(entrada.id))}
                  className={cn(ITEM, estilo, contraida && "justify-center px-0")}
                >
                  {entrada.icono}
                  <span className={cn("flex-1", contraida && "sr-only")}>{entrada.label}</span>
                  {!contraida && <Flecha abierto={abierto} />}
                </button>
                {!contraida && abierto && (
                  <ul id={panel} className="my-0.5 ml-[21px] flex flex-col gap-0.5 border-l border-line pl-2.5">
                    {entrada.destinos.map((d) => enlace(d, false))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ))}
    </nav>
  );
}
