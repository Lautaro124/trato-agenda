import { cn } from "@/lib/cn";

/** Logotipo "Trato Agenda". `onColor` lo invierte para el panel coral. */
export function Wordmark({
  size = 22,
  onColor = false,
}: {
  size?: number;
  onColor?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-[7px]">
      <span
        className={cn(
          "font-display font-bold tracking-[-0.02em]",
          onColor ? "text-white" : "text-ink",
        )}
        style={{ fontSize: size }}
      >
        Trato
      </span>
      <span
        className={cn(
          "text-[13px]",
          onColor ? "text-white/80" : "text-muted",
        )}
      >
        Agenda
      </span>
    </div>
  );
}
