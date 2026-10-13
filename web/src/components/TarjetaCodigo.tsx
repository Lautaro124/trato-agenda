"use client";

import { useState, type FormEvent } from "react";
import { AvisoNumeroPersonal } from "@/components/AvisoNumeroPersonal";
import { Button } from "@/components/ui/Button";
import { CampoTelefono } from "@/components/ui/CampoTelefono";
import { PAIS_POR_DEFECTO, telefonoCompleto, type Pais } from "@/lib/telefono";
import type { ResultadoCodigo } from "@/lib/vinculacion";

const PASOS = [
  <>Copiá el código.</>,
  <>
    Tocá la notificación de WhatsApp que te acaba de llegar. Si no aparece, entrá a{" "}
    <strong className="font-semibold">Dispositivos vinculados</strong> ›{" "}
    <strong className="font-semibold">Vincular un dispositivo</strong> ›{" "}
    <strong className="font-semibold">Vincular con el número de teléfono</strong>.
  </>,
  <>Pegá el código y volvé a esta pantalla: se conecta sola.</>,
];

/**
 * Vincular desde el mismo celular, sin QR: un celular no puede escanear lo
 * que muestra su propia pantalla. La persona escribe su número, la API pide
 * el código a WhatsApp y WhatsApp le manda una notificación para ingresarlo.
 * Lo usan /vincular y /entrar/whatsapp, igual que `TarjetaQr`.
 */
export function TarjetaCodigo({
  titulo,
  bajada,
  pie,
  vencido,
  onPedir,
  onUsarQr,
}: {
  titulo: string;
  bajada: string;
  pie: React.ReactNode;
  /** El SSE avisó que el código venció sin que lo ingresaran. */
  vencido: boolean;
  onPedir: (telefono: string) => Promise<ResultadoCodigo>;
  onUsarQr: () => void;
}) {
  const [pais, setPais] = useState<Pais>(PAIS_POR_DEFECTO);
  const [nacional, setNacional] = useState("");
  const [codigo, setCodigo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const telefono = telefonoCompleto(pais, nacional);

  async function pedir() {
    setPidiendo(true);
    setError(null);
    setCopiado(false);
    const resultado = await onPedir(telefono);
    setPidiendo(false);
    if ("error" in resultado) {
      setCodigo(null);
      setError(resultado.error);
      return;
    }
    setCodigo(resultado.codigo);
  }

  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void pedir();
  }

  function copiar() {
    if (!codigo) return;
    // Sin el guion: WhatsApp lo acepta igual, pero así se pega limpio.
    navigator.clipboard
      .writeText(codigo.replace("-", ""))
      .then(() => setCopiado(true))
      .catch(() => setCopiado(false));
  }

  return (
    <div className="flex w-full max-w-[460px] flex-col gap-5 rounded-lg border border-line bg-card p-6 shadow-md md:p-8">
      <div>
        <h1 className="mb-2 font-display text-2xl leading-[1.2] font-bold tracking-[-0.02em] text-ink">{titulo}</h1>
        <p className="text-sm leading-[1.6] text-ink-secondary">{bajada}</p>
      </div>

      <AvisoNumeroPersonal />

      {codigo && !vencido ? (
        <>
          <div className="flex flex-col items-center gap-3 rounded-md bg-sunken p-5">
            <span className="text-xs text-muted">Tu código para WhatsApp</span>
            <output
              aria-label="Código de vinculación"
              className="font-mono text-[30px] font-bold tracking-[0.12em] text-ink select-all"
            >
              {codigo}
            </output>
            <Button variant="primary" size="md" fullWidth onClick={copiar}>
              {copiado ? "Copiado" : "Copiar código"}
            </Button>
          </div>

          <ol className="flex flex-col gap-4">
            {PASOS.map((paso, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-subtle text-xs font-bold text-primary-hover">
                  {i + 1}
                </span>
                <span className="text-sm leading-[1.55] text-ink">{paso}</span>
              </li>
            ))}
          </ol>

          <Button variant="ghost" size="sm" onClick={() => void pedir()} disabled={pidiendo}>
            {pidiendo ? "Pidiendo…" : "Pedir otro código"}
          </Button>
        </>
      ) : (
        <form onSubmit={enviar} aria-label="Vincular con código" className="flex flex-col gap-2.5">
          {vencido && (
            <p role="alert" className="text-[13px] text-warning-text">
              El código venció antes de que lo ingresaras. Pedí uno nuevo.
            </p>
          )}
          <p className="text-[13px] font-semibold text-ink">El número de WhatsApp que vas a vincular</p>
          <CampoTelefono pais={pais} onPais={setPais} nacional={nacional} onNacional={setNacional} />
          <Button type="submit" size="lg" fullWidth disabled={pidiendo || telefono.length < 8}>
            {pidiendo ? "Pidiendo código…" : vencido ? "Pedir otro código" : "Pedir código"}
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-danger-text">
          {error}
        </p>
      )}

      <button type="button" onClick={onUsarQr} className="self-center text-[13.5px] text-link">
        Prefiero escanear un QR desde otro teléfono
      </button>

      <p className="text-[12.5px] leading-[1.6] text-muted">{pie}</p>
    </div>
  );
}
