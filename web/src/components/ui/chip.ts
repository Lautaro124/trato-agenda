import { cn } from "@/lib/cn";

/** Botón en forma de píldora que se elige o no (`aria-pressed`): horarios, días, cantidades de cuotas. */
export function chip(activo: boolean): string {
  return cn(
    "cursor-pointer rounded-full border px-3 py-[7px] text-[13px] select-none",
    activo
      ? "border-primary bg-primary font-semibold text-primary-on"
      : "border-line bg-card text-ink hover:border-line-strong",
  );
}
