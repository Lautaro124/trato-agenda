"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Conversacion } from "@/components/chats/Conversacion";
import { DevolverDialog } from "@/components/chats/DevolverDialog";
import { Indicadores, type AtajoIndicador } from "@/components/chats/Indicadores";
import { ListaChats, type Filtro } from "@/components/chats/ListaChats";
import { PanelLateralVenta } from "@/components/chats/PanelLateralVenta";
import { PanelVenta } from "@/components/chats/PanelVenta";
import { useAvisos } from "@/components/ui/Avisos";
import { sseUrl } from "@/lib/api";
import {
  cambiarTrato,
  devolverAlBot,
  enviarMensaje,
  etiquetaDeVenta,
  listarChats,
  nombreDe,
  obtenerChat,
  obtenerFicha,
  obtenerIndicadores,
  tomarControl,
  type CambioDeTrato,
  type ChatResumen,
  type DetalleChat,
  type FichaChat,
  type IndicadoresChats,
  type ListaChats as Lista,
} from "@/lib/chats";
import { cn } from "@/lib/cn";
import { useMediaQuery } from "@/lib/pantalla";
import { ErrorDeApi } from "@/lib/productos";

function mensajeDe(err: unknown, porDefecto: string): string {
  return err instanceof ErrorDeApi ? err.message : porDefecto;
}

/**
 * Desde qué ancho de la ventana (`md`, 48rem) las columnas van lado a lado:
 * lista | chat en agenda y lista | chat | datos de la venta en ventas. Por
 * debajo se ve la lista o el chat, uno por vez. Las clases son literales para
 * que Tailwind las genere; la conversación usa el mismo corte.
 */
const CORTES = {
  agenda: {
    soloUna: "max-md:hidden",
    grilla: "md:grid-cols-[var(--lista)_minmax(0,1fr)]",
  },
  ventas: {
    soloUna: "max-md:hidden",
    grilla: "md:grid-cols-[var(--lista)_minmax(0,1fr)_auto]",
  },
} as const;

const TEXTO_TRATO: Record<CambioDeTrato["estado"], string> = {
  hecho: "Listo: el trato quedó hecho y el pedido, pendiente de pago.",
  pagado: "Listo: la venta quedó pagada.",
  cancelado: "Listo: el trato quedó cancelado.",
};

/**
 * Los chats de WhatsApp en Inicio (LAU-81): indicadores rápidos, la lista con
 * la etapa de cada venta, el chat abierto y, en cuentas de ventas, los datos
 * para cerrar el trato. Con poco ancho se ve la lista o el chat, uno por vez.
 */
export function BandejaChats({
  ventas,
  saludo,
  sinChats,
}: Readonly<{
  ventas: boolean;
  saludo: string;
  /** Lo que se muestra mientras la cuenta no tiene ningún chat (por ejemplo, lo que falta para vender). */
  sinChats?: ReactNode;
}>) {
  const { avisar } = useAvisos();
  const [lista, setLista] = useState<Lista | null>(null);
  const [errorLista, setErrorLista] = useState(false);
  const [indicadores, setIndicadores] = useState<IndicadoresChats | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const corte = CORTES[ventas ? "ventas" : "agenda"];
  const columnasAlLado = useMediaQuery("(min-width: 48rem)");
  const columnasRef = useRef(columnasAlLado);
  useEffect(() => {
    columnasRef.current = columnasAlLado;
  }, [columnasAlLado]);
  const [busqueda, setBusqueda] = useState("");
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<DetalleChat | null>(null);
  const [ficha, setFicha] = useState<FichaChat | null>(null);
  const [errorFicha, setErrorFicha] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [devolviendo, setDevolviendo] = useState(false);
  // Una llave por mensaje: si el envío falla y se reintenta, la API no lo manda dos veces.
  const clave = useRef<string | null>(null);
  const seleccionadoRef = useRef<string | null>(null);

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

  const cargarFicha = useCallback(
    (id: string) => {
      if (!ventas) return Promise.resolve();
      return obtenerFicha(id).then(
        (nueva) => {
          if (seleccionadoRef.current === id) {
            setFicha(nueva);
            setErrorFicha(false);
          }
        },
        () => {
          if (seleccionadoRef.current === id) setErrorFicha(true);
        },
      );
    },
    [ventas],
  );

  const elegir = useCallback(
    (id: string | null) => {
      seleccionadoRef.current = id;
      setSeleccionado(id);
      setDetalle(null);
      setFicha(null);
      setErrorFicha(false);
      clave.current = null;
      if (id) {
        void cargarDetalle(id);
        void cargarFicha(id);
      }
    },
    [cargarDetalle, cargarFicha],
  );

  const cargarLista = useCallback(
    () =>
      listarChats().then(
        (nueva) => {
          setLista(nueva);
          setErrorLista(false);
          // Con lista y chat a la vista se abre el más reciente, así la pantalla no arranca vacía.
          const columnas = columnasRef.current;
          if (!seleccionadoRef.current && nueva.chats[0] && columnas) {
            elegir(nueva.chats[0].id);
          }
        },
        () => setErrorLista(true),
      ),
    [elegir],
  );

  const cargarIndicadores = useCallback(
    () =>
      obtenerIndicadores().then(setIndicadores, () => {
        /* Sin indicadores la bandeja sigue andando: quedan en "–". */
      }),
    [],
  );

  useEffect(() => {
    void cargarLista();
    void cargarIndicadores();
  }, [cargarLista, cargarIndicadores]);

  // Tiempo real: la API avisa cuando cambia algo y se vuelve a pedir lo que se ve.
  useEffect(() => {
    const source = new EventSource(sseUrl("/chats/eventos"), { withCredentials: true });
    source.onmessage = () => {
      void cargarLista();
      void cargarIndicadores();
      if (seleccionadoRef.current) {
        void cargarDetalle(seleccionadoRef.current);
        void cargarFicha(seleccionadoRef.current);
      }
    };
    return () => source.close();
  }, [cargarLista, cargarIndicadores, cargarDetalle, cargarFicha]);

  const actualizarChat = (chat: ChatResumen) => {
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
      void cargarIndicadores();
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

  const marcarTrato = async (cambio: CambioDeTrato): Promise<boolean> => {
    const id = seleccionadoRef.current;
    if (!id) return false;
    setTrabajando(true);
    try {
      actualizarChat(await cambiarTrato(id, cambio));
      avisar(TEXTO_TRATO[cambio.estado], "exito");
      void cargarFicha(id);
      void cargarIndicadores();
      return true;
    } catch (err) {
      avisar(mensajeDe(err, "No pudimos guardar el estado del trato. Probá de nuevo."), "error");
      void cargarFicha(id);
      return false;
    } finally {
      setTrabajando(false);
    }
  };

  const atajo: AtajoIndicador | null =
    filtro === "todos" ? "nuevos" : filtro === "humana" ? "intervenciones" : filtro === "pagado" || filtro === "con_turno" ? "convertidos" : null;
  const elegirAtajo = (elegido: AtajoIndicador) => {
    setFiltro(elegido === "nuevos" ? "todos" : elegido === "intervenciones" ? "humana" : ventas ? "pagado" : "con_turno");
  };

  const ultimoDelCliente = detalle?.mensajes.filter((m) => m.de === "cliente").at(-1)?.texto ?? "";
  const panel = ventas ? (
    <PanelVenta
      key={seleccionado}
      ficha={ficha}
      etapa={detalle ? (etiquetaDeVenta(detalle.chat)?.label ?? null) : null}
      error={errorFicha}
      trabajando={trabajando}
      onTrato={marcarTrato}
    />
  ) : null;
  // Los datos de la venta van en la tercera columna; con una sola, los muestra la conversación.
  const conPanel = Boolean(panel && detalle) && columnasAlLado;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3",
          seleccionado && corte.soloUna,
        )}
      >
        <h1 className="font-display text-[24px] leading-[1.15] font-bold tracking-[-0.025em] text-ink [@media(max-height:820px)]:text-[20px]">
          {saludo}
        </h1>
        <Indicadores
          indicadores={indicadores}
          teEsperan={lista?.chats.filter((chat) => chat.teEspera).length ?? 0}
          activo={atajo}
          onElegir={elegirAtajo}
        />
      </div>

      {errorLista && !lista && (
        <p role="alert" className="rounded-md bg-danger-subtle p-3 text-sm text-danger-text">
          No pudimos cargar tus chats. Revisá tu conexión y recargá la página.
        </p>
      )}

      {lista && lista.chats.length === 0 && sinChats && <div className="min-h-0 flex-1 overflow-y-auto">{sinChats}</div>}

      {lista && (lista.chats.length > 0 || !sinChats) && (
        <div
          className={cn(
            // Una columna: lista o chat de a uno. Con lugar, lista | chat | datos de la venta
            // (plegables a un riel); en agenda, lista | chat. Lista y datos crecen por
            // escalones (--lista, --panel) y el chat se queda con el resto. En pantallas
            // grandes (1920) los datos de la venta ganan aire para leerse sin apretarse.
            "grid min-h-0 flex-1 grid-flow-col grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-3 [--lista:15rem] [--panel:15rem] lg:[--lista:18rem] lg:[--panel:16.25rem] xl:[--panel:18.75rem] xl:gap-4 xl:[--lista:20rem] 2xl:[--lista:22.5rem] 2xl:[--panel:23.75rem]",
            corte.grilla,
          )}
        >
          <div className={cn("flex min-h-0 min-w-0 flex-col", seleccionado && corte.soloUna)}>
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
          <div className={cn("flex min-h-0 min-w-0 flex-col", !seleccionado && corte.soloUna)}>
            {detalle ? (
              <Conversacion
                detalle={detalle}
                trabajando={trabajando}
                enviando={enviando}
                onVolver={() => elegir(null)}
                onTomar={() => void tomar()}
                onDevolver={pedirDevolucion}
                onEnviar={enviar}
                panel={panel}
              />
            ) : (
              <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-secondary">
                {seleccionado ? "Cargando el chat…" : "Elegí un chat para leerlo."}
              </div>
            )}
          </div>
          {conPanel && (
            <PanelLateralVenta>
              {panel}
            </PanelLateralVenta>
          )}
        </div>
      )}

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
