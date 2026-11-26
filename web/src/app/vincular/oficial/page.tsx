"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ConnectedCard } from "@/components/LinkStateCards";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { INPUT_FORM } from "@/lib/password";
import { useRequireSession } from "@/lib/session";
import { abrirEmbeddedSignup, cargarSdk, useConfigOficial } from "@/lib/whatsapp-oficial";

type Paso = { tipo: "elegir" } | { tipo: "conectando" } | { tipo: "conectado"; telefono: string } | { tipo: "error"; texto: string };

/** El texto de la API para un error, o uno genérico. Nunca el detalle de Meta. */
async function textoDeRespuesta(respuesta: Response): Promise<string> {
  const cuerpo = (await respuesta.json().catch(() => null)) as { message?: unknown; motivo?: unknown } | null;
  if (cuerpo?.motivo === "numero_en_uso") return "Ese WhatsApp ya es la cuenta de otra persona en Trato.";
  if (typeof cuerpo?.message === "string" && respuesta.status < 500) return cuerpo.message;
  return "No pudimos conectar tu WhatsApp. Probá de nuevo en unos minutos.";
}

/**
 * Conectar el WhatsApp del negocio por la API oficial de Meta (Embedded
 * Signup). Con Coexistence el número sigue andando en la app WhatsApp
 * Business del celular; sin ella, el número pasa a atenderse sólo desde Trato.
 */
export default function VincularOficialPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const config = useConfigOficial(status === "authenticated");
  const [coexistencia, setCoexistencia] = useState(true);
  const [pin, setPin] = useState("");
  const [paso, setPaso] = useState<Paso>({ tipo: "elegir" });

  if (status !== "authenticated" || !user || config === null) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando…</p>
      </main>
    );
  }

  const pinValido = /^\d{6}$/.test(pin);

  async function conectar() {
    if (!config?.disponible) return;
    setPaso({ tipo: "conectando" });
    try {
      const sdk = await cargarSdk(config);
      const resultado = await abrirEmbeddedSignup(sdk, config.configId, coexistencia);
      if (resultado.tipo === "cancelado") {
        setPaso({ tipo: "elegir" });
        return;
      }
      if (resultado.tipo === "error") {
        setPaso({ tipo: "error", texto: "Meta no terminó la conexión. Probá de nuevo." });
        return;
      }
      const respuesta = await apiFetch("/whatsapp/cloud/alta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo: resultado.codigo,
          ...resultado.datos,
          coexistencia,
          ...(coexistencia ? {} : { pin }),
        }),
      });
      if (!respuesta.ok) {
        setPaso({ tipo: "error", texto: await textoDeRespuesta(respuesta) });
        return;
      }
      const datos = (await respuesta.json()) as { phoneNumber?: string | null };
      setPaso({ tipo: "conectado", telefono: datos.phoneNumber ?? "" });
    } catch {
      setPaso({ tipo: "error", texto: "No pudimos abrir la ventana de Meta. Revisá que el navegador no la bloquee." });
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="vinculacion" user={user} />
      <main className="grid flex-1 place-items-center bg-page p-4 md:p-6">
        {paso.tipo === "conectado" ? (
          <ConnectedCard phone={paso.telefono} onContinue={() => router.push("/inicio")} />
        ) : (
          <section className="flex w-full max-w-[440px] flex-col gap-5 rounded-lg border border-line bg-card p-6 shadow-md">
            <div>
              <h1 className="mb-1.5 font-display text-xl font-bold text-ink">Conectá WhatsApp Business</h1>
              <p className="text-[13.5px] leading-[1.55] text-ink-secondary">
                Vas a autorizar a Trato desde Meta para atender a tus clientes con la API oficial de WhatsApp. Se abre
                una ventana de Facebook donde elegís tu negocio y tu número.
              </p>
            </div>

            {!config.disponible ? (
              <p className="text-[13.5px] text-ink-secondary">
                La conexión oficial todavía no está disponible. Mientras tanto podés{" "}
                <Link href="/vincular" className="text-primary underline">
                  vincular tu WhatsApp
                </Link>
                .
              </p>
            ) : (
              <>
                <fieldset className="flex flex-col gap-2.5">
                  <legend className="mb-1 text-[13px] font-semibold text-ink">¿Cómo usás hoy ese número?</legend>
                  <label className="flex cursor-pointer gap-2.5 rounded-md border border-line p-3 text-[13.5px] text-ink">
                    <input
                      type="radio"
                      name="modo"
                      checked={coexistencia}
                      onChange={() => setCoexistencia(true)}
                      className="mt-0.5"
                    />
                    <span>
                      <strong className="block">Con la app WhatsApp Business</strong>
                      <span className="text-ink-secondary">
                        Seguís usando la app en tu celular y Trato atiende al mismo tiempo. Necesitás la versión
                        2.24.17 o más nueva. Los grupos no se sincronizan.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer gap-2.5 rounded-md border border-line p-3 text-[13.5px] text-ink">
                    <input
                      type="radio"
                      name="modo"
                      checked={!coexistencia}
                      onChange={() => setCoexistencia(false)}
                      className="mt-0.5"
                    />
                    <span>
                      <strong className="block">Un número sin la app</strong>
                      <span className="text-ink-secondary">
                        El número deja de funcionar en la app del celular y se atiende sólo desde Trato.
                      </span>
                    </span>
                  </label>
                </fieldset>

                {!coexistencia && (
                  <label className="flex flex-col gap-1.5 text-[13px] text-ink">
                    PIN de 6 dígitos de la verificación en dos pasos
                    <input
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      value={pin}
                      onChange={(evento) => setPin(evento.target.value.replace(/\D/g, ""))}
                      className={INPUT_FORM}
                    />
                    <span className="text-[12px] text-muted">
                      Si el número todavía no tiene uno, este pasa a ser su PIN. Trato no lo guarda.
                    </span>
                  </label>
                )}

                {paso.tipo === "error" && (
                  <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-[13px] text-danger-text">
                    {paso.texto}
                  </p>
                )}

                <Button
                  variant="primary"
                  size="md"
                  fullWidth
                  disabled={paso.tipo === "conectando" || (!coexistencia && !pinValido)}
                  onClick={() => void conectar()}
                >
                  {paso.tipo === "conectando" ? "Conectando…" : "Continuar con Facebook"}
                </Button>
                <p className="text-[12px] leading-[1.5] text-muted">
                  Trato sólo lee los mensajes que le mandan al número para atenderlos. Podés desconectarlo cuando
                  quieras desde Trato o desde la configuración de tu cuenta de Meta.
                </p>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
