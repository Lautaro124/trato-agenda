import { Button } from "@/components/ui/Button";

/** Ilustración decorativa: un gráfico de barras con la línea cortada y la señal caída. */
function Ilustracion() {
  return (
    <svg
      aria-hidden="true"
      width="200"
      height="153"
      viewBox="0 0 220 168"
      fill="none"
      className="max-w-full"
    >
      <ellipse cx="110" cy="150" rx="84" ry="9" fill="var(--color-semantic-surface-sunken)" />
      <rect x="38" y="84" width="30" height="62" rx="6" fill="#f6d9cb" />
      <rect x="84" y="56" width="30" height="90" rx="6" fill="#f0b9a0" />
      <rect x="130" y="100" width="30" height="46" rx="6" fill="#f6d9cb" />
      <path d="M30 146H170" stroke="var(--color-semantic-border-strong)" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M44 52L78 30L112 40"
        stroke="var(--color-semantic-primary-hover)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M126 44L142 34"
        stroke="var(--color-semantic-primary-hover)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray="1 9"
      />
      {[44, 78, 112].map((cx, i) => (
        <circle
          key={cx}
          cx={cx}
          cy={[52, 30, 40][i]}
          r="5"
          fill="var(--color-semantic-surface-card)"
          stroke="var(--color-semantic-primary-hover)"
          strokeWidth="3"
        />
      ))}
      <circle cx="168" cy="48" r="26" fill="var(--color-semantic-text-primary)" />
      <path d="M156 60L180 36" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path
        d="M158 40a14 14 0 0 1 19-2M180 56a14 14 0 0 1-19 2"
        stroke="#fff"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Cuando no se pudo cargar el rendimiento: una imagen y un texto, en vez de una línea roja. */
export function ErrorDeCarga({
  detalle,
  onReintentar,
}: {
  /** El motivo, si la API dio uno propio; sin él se tranquiliza con el texto por defecto. */
  detalle?: string;
  onReintentar: () => void;
}) {
  return (
    <section
      role="alert"
      aria-labelledby="rendimiento-error"
      className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-card px-6 py-12 text-center"
    >
      <Ilustracion />
      <h2
        id="rendimiento-error"
        className="mt-3 font-display text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink"
      >
        No pudimos cargar el rendimiento
      </h2>
      <p className="max-w-[420px] text-[15px] leading-[1.6] text-ink-secondary">
        {detalle ??
          "Tus datos están a salvo, sólo falló la conexión. Probá de nuevo en un momento."}
      </p>
      <Button onClick={onReintentar} className="mt-4 min-h-11 rounded-full px-6">
        Reintentar
      </Button>
    </section>
  );
}
