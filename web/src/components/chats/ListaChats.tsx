"use client";

import { EtiquetaVenta } from "@/components/chats/EtiquetaVenta";
import { Badge } from "@/components/ui/Badge";
import {
  contextoDe,
  demoraDe,
  ETAPAS_VISIBLES,
  etiquetaDeVenta,
  horaCorta,
  inicialDe,
  nombreDe,
  type AtencionChat,
  type ChatResumen,
  type EtapaVenta,
  type ListaChats as Lista,
} from "@/lib/chats";
import { cn } from "@/lib/cn";

/** Quién contesta, la etapa de la venta (cuentas de ventas) o con turno (agenda). */
export type Filtro = "todos" | AtencionChat | EtapaVenta | "cancelado" | "con_turno";

const FILTROS: Array<{ id: Filtro; label: string }> = [
  { id: "todos", label: "Todos" },
  { id: "asistente", label: "Bot" },
  { id: "humana", label: "Vos" },
];

const FILTROS_VENTA: Array<{ id: Filtro; label: string }> = [
  ...ETAPAS_VISIBLES.map((etapa) => ({ id: etapa.id, label: etapa.label })),
  { id: "cancelado", label: "Cancelado" },
];

/** Bot o Vos: quién contesta este chat. */
export function InsigniaAtencion({ atencion }: Readonly<{ atencion: AtencionChat }>) {
  return atencion === "humana" ? <Badge tone="primary">Vos</Badge> : <Badge tone="success">Bot</Badge>;
}

function vistaPrevia(chat: ChatResumen): string {
  if (!chat.ultimo) return "";
  const quien = chat.ultimo.de === "asistente" ? "Bot: " : chat.ultimo.de === "dueno" ? "Vos: " : "";
  // Un mensaje del bot que fue sólo fotos no tiene texto que mostrar.
  return quien + (chat.ultimo.texto || (chat.ultimo.imagenes?.length ? "📷 Fotos" : ""));
}

/** Normaliza para buscar: sin mayúsculas ni tildes. */
function plano(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function pasaFiltro(chat: ChatResumen, filtro: Filtro): boolean {
  if (filtro === "todos") return true;
  if (filtro === "asistente" || filtro === "humana") return chat.atencion === filtro;
  if (filtro === "con_turno") return chat.turno !== null;
  return etiquetaDeVenta(chat)?.id === filtro;
}

export function coincide(chat: ChatResumen, filtro: Filtro, busqueda: string): boolean {
  if (!pasaFiltro(chat, filtro)) return false;
  const q = plano(busqueda.trim());
  if (!q) return true;
  const digitos = q.replace(/\D/g, "");
  return plano(chat.nombre ?? "").includes(q) || (digitos !== "" && (chat.telefono ?? "").includes(digitos));
}

/** La lista de chats con buscador, filtro Bot/Vos y, en ventas, filtro por etapa. */
export function ListaChats({
  lista,
  filtro,
  busqueda,
  seleccionado,
  onFiltro,
  onBusqueda,
  onElegir,
}: Readonly<{
  lista: Lista;
  filtro: Filtro;
  busqueda: string;
  seleccionado: string | null;
  onFiltro: (filtro: Filtro) => void;
  onBusqueda: (texto: string) => void;
  onElegir: (id: string) => void;
}>) {
  const cuenta = (id: Filtro): number =>
    id === "todos"
      ? lista.cuenta.todos
      : id === "asistente" || id === "humana"
        ? lista.cuenta[id]
        : lista.chats.filter((chat) => pasaFiltro(chat, id)).length;
  // Las etapas se muestran sólo en una cuenta de ventas (los chats traen su etapa o su trato).
  const ventas = lista.chats.some((chat) => chat.venta !== null || chat.trato !== null);
  const visibles = lista.chats.filter((chat) => coincide(chat, filtro, busqueda));

  return (
    <section
      aria-label="Lista de chats"
      data-tutorial="lista-chats"
      className="flex min-h-0 flex-col rounded-lg border border-line bg-card"
    >
      <div className="flex flex-col gap-2.5 border-b border-line p-3">
        <label className="flex h-10 items-center gap-2 rounded-md border border-line bg-page px-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="text-ink-secondary">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only">Buscar chat</span>
          <input
            type="search"
            value={busqueda}
            onChange={(e) => onBusqueda(e.target.value)}
            placeholder="Buscar por nombre o teléfono"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none"
          />
        </label>
        <div
          role="group"
          aria-label={ventas ? "Filtrar por quién contesta o por etapa de la venta" : "Filtrar por quién contesta"}
          data-tutorial="filtro-chats"
          className="flex gap-2 overflow-x-auto pb-0.5"
        >
          {[...FILTROS, ...(ventas ? FILTROS_VENTA : [])].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filtro === id}
              onClick={() => onFiltro(id)}
              className={cn(
                "h-8 flex-none rounded-full border px-3 text-[13px] font-semibold whitespace-nowrap",
                filtro === id ? "border-ink bg-ink text-white" : "border-line bg-card text-ink-secondary hover:bg-sunken",
              )}
            >
              {label} · {cuenta(id)}
            </button>
          ))}
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {visibles.map((chat) => {
          const activo = chat.id === seleccionado;
          const contexto = contextoDe(chat);
          const etiqueta = etiquetaDeVenta(chat);
          const demora = demoraDe(chat);
          return (
            <li key={chat.id} className="border-b border-sunken last:border-b-0">
              <button
                type="button"
                aria-current={activo ? "true" : undefined}
                onClick={() => onElegir(chat.id)}
                className={cn("flex w-full gap-2.5 px-3 py-2.5 text-left", activo ? "bg-primary-subtle" : "hover:bg-page")}
              >
                <span aria-hidden className="grid size-9 flex-none place-items-center rounded-full bg-sunken text-sm font-bold text-ink-secondary">
                  {inicialDe(chat)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14px] font-bold text-ink">{nombreDe(chat)}</span>
                    {chat.ultimo && (
                      <span className="flex-none text-xs text-ink-secondary">{horaCorta(chat.ultimo.createdAt)}</span>
                    )}
                  </span>
                  <span className="truncate text-[13px] text-ink-secondary">{vistaPrevia(chat)}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {etiqueta && <EtiquetaVenta etiqueta={etiqueta} />}
                    <InsigniaAtencion atencion={chat.atencion} />
                    {chat.teEspera && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-danger-text">
                        <span aria-hidden className="size-2 rounded-full bg-danger" />
                        Te espera
                      </span>
                    )}
                    {demora && <span className="text-xs font-semibold text-ink-secondary">{demora}</span>}
                    {!etiqueta && contexto && <span className="text-xs text-ink-secondary">{contexto}</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {visibles.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-ink-secondary">
          {lista.chats.length === 0
            ? "Todavía no hay chats. Cuando un cliente le escriba a tu WhatsApp, lo vas a ver acá."
            : "No hay chats en este filtro."}
        </p>
      )}
    </section>
  );
}
