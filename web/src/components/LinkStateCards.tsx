"use client";

import { QrCode } from "@/components/QrCode";
import { Button } from "@/components/ui/Button";

/** Marco blanco que envuelve al QR en todos los estados (1g del canvas). */
function QrFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded-md border border-line bg-white p-2.5">
      {children}
    </div>
  );
}

function StateCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[400px] w-[300px] max-w-full flex-col items-center justify-center gap-4 rounded-lg border border-line bg-card p-6 text-center shadow-md">
      {children}
    </div>
  );
}

export function ConnectingCard({ token }: { token: string }) {
  return (
    <StateCard>
      <QrFrame>
        <div className="opacity-35 blur-[3px]">
          <QrCode value={token} size={150} />
        </div>
        <span
          className="absolute top-1/2 left-1/2 size-[34px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-line border-t-primary"
          style={{ animation: "trato-spin 0.9s linear infinite" }}
        />
      </QrFrame>
      <div>
        <h3 className="mb-1.5 font-display text-lg font-bold text-ink">Conectando…</h3>
        <p className="text-[13px] leading-[1.55] text-ink-secondary">
          Estamos vinculando tu WhatsApp. No cierres esta ventana.
        </p>
      </div>
    </StateCard>
  );
}

export function ConnectedCard({
  phone,
  onContinue,
}: {
  phone: string;
  onContinue: () => void;
}) {
  return (
    <StateCard>
      <span className="grid size-16 place-items-center rounded-full bg-success-subtle">
        <span className="h-3.5 w-[26px] -translate-y-[3px] rotate-[-45deg] rounded-[2px] border-b-[3px] border-l-[3px] border-success" />
      </span>
      <div>
        <h3 className="mb-1.5 font-display text-[19px] font-bold text-ink">
          WhatsApp conectado
        </h3>
        <p className="text-[13px] leading-[1.55] text-ink-secondary">
          Ya podés escribirle al bot y pedirle una reunión.
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-full bg-sunken px-3 py-[7px] text-[12.5px] text-ink">
        <span className="size-[7px] rounded-full bg-success" />
        {phone}
      </div>
      <Button variant="primary" size="md" fullWidth onClick={onContinue}>
        Ir a mi agenda
      </Button>
    </StateCard>
  );
}

export function ExpiredCard({
  token,
  onRegenerate,
}: {
  token: string;
  onRegenerate: () => void;
}) {
  return (
    <StateCard>
      <QrFrame>
        <div className="opacity-[0.18]">
          <QrCode value={token} size={150} />
        </div>
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-warning-subtle px-[11px] py-[5px] text-[11.5px] font-semibold whitespace-nowrap text-warning-text">
          Vencido
        </span>
      </QrFrame>
      <div>
        <h3 className="mb-1.5 font-display text-lg font-bold text-ink">
          El código venció
        </h3>
        <p className="text-[13px] leading-[1.55] text-ink-secondary">
          Por seguridad dura un minuto. Generá uno nuevo y volvé a escanear.
        </p>
      </div>
      <Button variant="secondary" size="md" fullWidth onClick={onRegenerate}>
        Generar código nuevo
      </Button>
    </StateCard>
  );
}

export function ErrorCard({
  code,
  onRetry,
}: {
  code: string;
  onRetry: () => void;
}) {
  return (
    <StateCard>
      <span className="grid size-16 place-items-center rounded-full bg-danger-subtle font-display text-[30px] font-bold text-danger">
        !
      </span>
      <div>
        <h3 className="mb-1.5 font-display text-lg font-bold text-ink">
          No pudimos conectar
        </h3>
        <p className="text-[13px] leading-[1.55] text-ink-secondary">
          WhatsApp rechazó la vinculación. Revisá que el teléfono tenga internet y
          probá de nuevo.
        </p>
      </div>
      <div className="w-full overflow-hidden rounded-sm bg-sunken px-3 py-2 font-mono text-[11.5px] text-ellipsis whitespace-nowrap text-muted">
        {code}
      </div>
      <div className="flex w-full flex-col gap-2">
        <Button variant="primary" size="md" fullWidth onClick={onRetry}>
          Reintentar
        </Button>
        <Button variant="ghost" size="sm" fullWidth>
          Escribir a soporte
        </Button>
      </div>
    </StateCard>
  );
}
