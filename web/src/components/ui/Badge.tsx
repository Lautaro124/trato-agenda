import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-secondary",
  primary: "bg-primary-subtle text-primary-hover",
  success: "bg-success-subtle text-success-text",
  warning: "bg-warning-subtle text-warning-text",
  danger: "bg-danger-subtle text-danger-text",
  info: "bg-[var(--color-semantic-info-subtle)] text-[var(--color-semantic-info-text)]",
};

/** Trato Badge — indicador de estado o conteo. */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-body text-xs leading-[1.4] font-semibold",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
