"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AvisoSuscripcion } from "@/components/AvisoSuscripcion";
import { Conversacion } from "@/components/chats/Conversacion";
import { DevolverDialog } from "@/components/chats/DevolverDialog";
import { ListaChats, type Filtro } from "@/components/chats/ListaChats";
import { Button } from "@/components/ui/Button";
import { useAvisos } from "@/components/ui/Avisos";
import { sseUrl } from "@/lib/api";
import {
  devolverAlBot,
  enviarMensaje,
  listarChats,
  nombreDe,
  obtenerChat,
  tomarControl,
  type DetalleChat,
  type ListaChats as Lista,
} from "@/lib/chats";
import { cn } from "@/lib/cn";
import { ErrorDeApi } from "@/lib/productos";
import { useRequireSession } from "@/lib/session";
import { useAbrirTutorial, useTutorial } from "@/lib/tutorial";

function mensajeDe(err: unknown, porDefecto: string): string {
  return err instanceof ErrorDeApi ? err.message : porDefecto;
}

/**
 * Chats (LAU-81): las conversaciones de WhatsApp que atiende el asistente.
 * Cada chat lo contesta el bot o vos, y un botón lo cambia. En el celular se
 * ve la lista o el chat abierto, uno por vez.
 */
export default function ChatsPage() {
  const { user, status } = useRequireSession();
  const { avisar } = useAvisos();
  const abrirTutorial = useAbrirTutorial("chats");
  const [lista, setLista] = useState<Lista | null>(null);
  const [errorLista, setErrorLista] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<DetalleChat | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [devolviendo, setDevolviendo] = useState(false);
  // Una llave por mensaje: si el envío falla y se reintenta, la API no lo manda dos veces.
  const clave = useRef<string | null>(null);
  const seleccionadoRef = useRef<string | null>(null);
  // Espera al chat abierto: el paso del botón de control se saltea si no está a la vista.
  useTutorial("chats", lista !== null && (!seleccionado || detalle !== null));

  const cargarDetalle = useCallback(
    (id: string) =>
      obtenerChat(id).then(
        (nuevo) => {
          if (seleccionadoRef.current === id) setDetalle(nuevo);
        },
        // Un chat que ya no existe (o de otra cuenta) no se muestra.
        () => {
          if (seleccionadoRef.current === id) setDetalle(null);
        },
      ),
    [],
  );

  const elegir = useCallback(
    (id: string | null) => {
      seleccionadoRef.current = id;
      setSeleccionado(id);
      setDetalle(null);
      clave.current = null;
      if (id) void cargarDetalle(id);
    },
    [cargarDetalle],
  );

  const cargarLista = useCallback(
    () =>
      listarChats().then(
        (nueva) => {
          setLista(nueva);
          setErrorLista(false);
          // En escritorio se abre el más reciente, así la pantalla no arranca vacía.
          if (!seleccionadoRef.current && nueva.chats[0] && window.matchMedia("(min-width: 768px)").matches) {
            elegir(nueva.chats[0].id);
          }
        },
        () => setErrorLista(true),
      ),
    [elegir],
  );

  useEffect(() => {
    if (status !== "authenticated") return;
    void cargarLista();
  }, [status, cargarLista]);

  // Tiempo real: la API avisa cuando cambia algo y se vuelve a pedir lo que se ve.
  useEffect(() => {
    if (status !== "authenticated") return;
    const source = new EventSource(sseUrl("/chats/eventos"), { withCredentials: true });
    source.onmessage = () => {
      void cargarLista();
      if (seleccionadoRef.current) void cargarDetalle(seleccionadoRef.current);
    };
    return () => source.close();
  }, [status, cargarLista, cargarDetalle]);

  const actualizarChat = (chat: DetalleChat["chat"]) => {
    setDetalle((previo) => (previo && previo.chat.id === chat.id ? { ...previo, chat } : previo));
    setLista((previa) => previa && { ...previa, chats: previa.chats.map((c) => (c.id === chat.id ? chat : c)) });
  };

  const tomar = async () => {
    if (!detalle) return;
    setTrabajando(true);
    try {
      const { chat } = await tomarControl(detalle.chat.id);
      actualizarChat(chat);
      avisar("Listo: ahora contestás vos. El bot no escribe en este chat.", "exito");
      void cargarLista();
    } catch (err) {
      avisar(mensajeDe(err, "No pudimos tomar el control. Probá de nuevo."), "error");
    } finally {
      setTrabajando(false);
    }
  };

  const devolver = async (opciones: { contestar: boolean; nota?: string }) => {
    if (!detalle) return;
    setTrabajando(true);
    try {
      const { chat, contesta } = await devolverAlBot(detalle.chat.id, opciones);
      actualizarChat(chat);
      setDevolviendo(false);
      avisar(
        contesta
          ? "El bot vuelve a atender este chat y ya le está contestando."
          : opciones.contestar
            ? "El bot vuelve a atender este chat. No pudo contestar ahora: lo hace con el próximo mensaje."
            : "El bot vuelve a atender este chat y espera el próximo mensaje.",
        "exito",
      );
      void cargarLista();
    } catch (err) {
      avisar(mensajeDe(err, "No pudimos devolver el chat. Probá de nuevo."), "error");
    } finally {
      setTrabajando(false);
    }
  };

  const pedirDevolucion = () => {
    if (detalle?.chat.teEspera) setDevolviendo(true);
    else void devolver({ contestar: false });
  };

  const enviar = async (texto: string): Promise<boolean> => {
    if (!detalle) return false;
    clave.current ??= crypto.randomUUID();
    setEnviando(true);
    try {
      const mensaje = await enviarMensaje(detalle.chat.id, texto, clave.current);
      clave.current = null;
      setDetalle((previo) =>
        previo && previo.chat.id === detalle.chat.id && !previo.mensajes.some((m) => m.id === mensaje.id)
          ? { ...previo, mensajes: [...previo.mensajes, mensaje] }
          : previo,
      );
      void cargarDetalle(detalle.chat.id);
      void cargarLista();
      return true;
    } catch (err) {
      avisar(mensajeDe(err, "No se pudo mandar el mensaje. Probá de nuevo."), "error");
      // Lo que no salió ya no está en el chat: se vuelve a pedir para no quedarse con un estado viejo.
      void cargarDetalle(detalle.chat.id);
      void cargarLista();
      return false;
    } finally {
      setEnviando(false);
    }
  };

  if (status !== "authenticated" || !user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando tus chats…</p>
      </main>
    );
  }

  const ultimoDelCliente = detalle?.mensajes.filter((m) => m.de === "cliente").at(-1)?.texto ?? "";

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader active="chats" user={user} />
      <AvisoSuscripcion />

      <main
        className={cn(
          "mx-auto flex min-h-0 w-full max-w-[1360px] flex-1 flex-col gap-4 bg-page p-4 md:gap-5 md:p-6",
          seleccionado ? "pb-4" : "md:pb-6",
        )}
      >
        <div className={cn("flex flex-wrap items-end justify-between gap-3", seleccionado && "max-md:hidden")}>
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-[26px] font-extrabold tracking-[-0.02em] md:text-[28px]">Chats</h1>
            <p className="text-[15px] text-ink-secondary">Mirá lo que habla tu asistente y, cuando quieras, contestá vos.</p>
          </div>
          {abrirTutorial && (
            <Button variant="secondary" onClick={abrirTutorial}>
              Cómo funciona
            </Button>
          )}
        </div>

        {errorLista && !lista && (
          <p role="alert" className="rounded-md bg-danger-subtle p-3 text-sm text-danger-text">
            No pudimos cargar tus chats. Revisá tu conexión y recargá la página.
          </p>
        )}

        {lista && (
          <div className="flex min-h-0 flex-1 gap-5">
            <div className={cn("flex min-h-0 w-full flex-col md:w-[360px] md:flex-none lg:w-[380px]", seleccionado && "max-md:hidden")}>
              <ListaChats
                lista={lista}
                filtro={filtro}
                busqueda={busqueda}
                seleccionado={seleccionado}
                onFiltro={setFiltro}
                onBusqueda={setBusqueda}
                onElegir={elegir}
              />
            </div>
            <div className={cn("min-h-0 min-w-0 flex-1 flex-col", seleccionado ? "flex" : "max-md:hidden md:flex")}>
              {detalle ? (
                <Conversacion
                  detalle={detalle}
                  trabajando={trabajando}
                  enviando={enviando}
                  onVolver={() => elegir(null)}
                  onTomar={() => void tomar()}
                  onDevolver={pedirDevolucion}
                  onEnviar={enviar}
                />
              ) : (
                <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-secondary">
                  {seleccionado ? "Cargando el chat…" : "Elegí un chat para leerlo."}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {devolviendo && detalle && (
        <DevolverDialog
          nombre={nombreDe(detalle.chat)}
          ultimoDelCliente={ultimoDelCliente}
          trabajando={trabajando}
          onConfirmar={(opciones) => void devolver(opciones)}
          onCancelar={() => setDevolviendo(false)}
        />
      )}

    </div>
  );
}
