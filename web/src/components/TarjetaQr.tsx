import { QrCode } from "@/components/QrCode";

const PASOS = [
  <>Abrí WhatsApp en tu teléfono.</>,
  <>
    Entrá a <strong className="font-semibold">Dispositivos vinculados</strong> y tocá{" "}
    <strong className="font-semibold">Vincular un dispositivo</strong>.
  </>,
  <>Apuntá la cámara al código de la izquierda.</>,
];

/**
 * El QR con las instrucciones para escanearlo: lo usan /vincular (con sesión)
 * y /entrar/whatsapp (alta sin cuenta), que sólo cambian los textos.
 */
export function TarjetaQr({
  qr,
  titulo,
  bajada,
  pie,
  acciones,
}: {
  qr: string | null;
  titulo: string;
  bajada: string;
  pie: React.ReactNode;
  acciones?: React.ReactNode;
}) {
  return (
    <div className="flex w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-line bg-card shadow-md md:flex-row">
      {/* Columna del código */}
      <div className="flex flex-col items-center justify-center gap-4 border-b border-line bg-sunken p-6 md:w-[44%] md:border-r md:border-b-0 md:p-8">
        <div className="grid place-items-center rounded-md bg-white p-3 shadow-sm">
          {qr ? (
            <QrCode value={qr} size={210} />
          ) : (
            <div className="grid size-[210px] place-items-center">
              <span className="text-xs text-muted">Generando código…</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-[7px] text-xs text-muted">
          <span className="size-2 rounded-full bg-accent" />
          Código activo · se renueva solo
        </div>
      </div>

      {/* Columna de instrucciones */}
      <div className="flex-1 p-6 md:p-8">
        <h1 className="mb-2 font-display text-2xl leading-[1.2] font-bold tracking-[-0.02em] text-ink">
          {titulo}
        </h1>
        <p className="mb-6 text-sm leading-[1.6] text-ink-secondary">{bajada}</p>

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

        {acciones && (
          <>
            <div className="my-6 h-px bg-line" />
            <div className="flex flex-wrap items-center gap-3">{acciones}</div>
          </>
        )}

        <p className="mt-6 text-[12.5px] leading-[1.6] text-muted">{pie}</p>
      </div>
    </div>
  );
}
