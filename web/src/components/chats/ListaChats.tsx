"use client";

import { Badge } from "@/components/ui/Badge";
import { contextoDe, horaCorta, inicialDe, nombreDe, type AtencionChat, type ChatResumen, type ListaChats as Lista } from "@/lib/chats";
import { cn } from "@/lib/cn";

export type Filtro = "todos" | AtencionChat;

const FILTROS: Array<{ id: Filtro; label: string }> = [
  { id: "todos", label: "Todos" },
  { id: "asistente", label: "Bot" },
  { id: "humana", label: "Vos" },
];

/** Bot o Vos: quién contesta este chat. */
export function InsigniaAtencion({ atencion }: Readonly<{ atencion: AtencionChat }>) {
  return atencion === "humana" ? <Badge tone="primary">Vos</Badge> : <Badge tone="success">Bot</Badge>;
}

function vistaPrevia(chat: ChatResumen): string {
  if (!chat.ultimo) return "";
  const quien = chat.ultimo.de === "asistente" ? "Bot: " : chat.ultimo.de === "dueno" ? "Vos: " : "";
  return quien + chat.ultimo.texto;
}

/** Normaliza para buscar: sin mayúsculas ni tildes. */
function plano(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function coincide(chat: ChatResumen, filtro: Filtro, busqueda: string): boolean {
  if (filtro !== "todos" && chat.atencion !== filtro) return false;
  const q = plano(busqueda.trim());
  if (!q) return true;
  const digitos = q.replace(/\D/g, "");
  return plano(chat.nombre ?? "").includes(q) || (digitos !== "" && (chat.telefono ?? "").includes(digitos));
}

/** La lista de chats con buscador y filtro Bot/Vos. */
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
  const cuenta: Record<Filtro, number> = {
    todos: lista.cuenta.todos,
    asistente: lista.cuenta.asistente,
    humana: lista.cuenta.humana,
  };
  const visibles = lista.chats.filter((chat) => coincide(chat, filtro, busqueda));

  return (
    <section
      aria-label="Lista de chats"
      data-tutorial="lista-chats"
      className="flex min-h-0 flex-col rounded-lg border border-line bg-card"
    >
      <div className="flex flex-col gap-3 border-b border-line p-4">
        <label className="flex h-11 items-center gap-2 rounded-md border border-line bg-page px-3">
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
        <div role="group" aria-label="Filtrar por quién contesta" data-tutorial="filtro-chats" className="flex flex-wrap gap-2">
          {FILTROS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filtro === id}
              onClick={() => onFiltro(id)}
              className={cn(
                "h-9 rounded-full border px-3.5 text-sm font-semibold",
                filtro === id ? "border-ink bg-ink text-white" : "border-line bg-card text-ink-secondary hover:bg-sunken",
              )}
            >
              {label} · {cuenta[id]}
            </button>
          ))}
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {visibles.map((chat) => {
          const activo = chat.id === seleccionado;
          const contexto = contextoDe(chat);
          return (
            <li key={chat.id} className="border-b border-sunken last:border-b-0">
              <button
                type="button"
                aria-current={activo ? "true" : undefined}
                onClick={() => onElegir(chat.id)}
                className={cn("flex w-full gap-3 px-4 py-3.5 text-left", activo ? "bg-primary-subtle" : "hover:bg-page")}
              >
                <span aria-hidden className="grid size-11 flex-none place-items-center rounded-full bg-sunken font-bold text-ink-secondary">
                  {inicialDe(chat)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-bold text-ink">{nombreDe(chat)}</span>
                    {chat.ultimo && (
                      <span className="flex-none text-xs text-ink-secondary">{horaCorta(chat.ultimo.createdAt)}</span>
                    )}
                  </span>
                  <span className="truncate text-sm text-ink-secondary">{vistaPrevia(chat)}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2">
                    <InsigniaAtencion atencion={chat.atencion} />
                    {chat.teEspera && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-danger-text">
                        <span aria-hidden className="size-2 rounded-full bg-danger" />
                        Te espera
                      </span>
                    )}
                    {contexto && <span className="text-xs text-ink-secondary">{contexto}</span>}
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
            : "No hay chats que coincidan."}
        </p>
      )}
    </section>
  );
}
