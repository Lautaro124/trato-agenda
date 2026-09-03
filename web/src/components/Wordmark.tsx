import { LogoMark } from "@/components/LogoMark";
import { cn } from "@/lib/cn";

/** Logotipo "Trato Agenda". `onColor` lo invierte para el panel coral. */
export function Wordmark({
  size = 27,
  onColor = false,
}: {
  size?: number;
  onColor?: boolean;
}) {
  const markSize = Math.round(size * 0.62);

  return (
    <div className="flex items-baseline gap-[7px]">
      <span
        className={cn(
          "flex items-baseline font-display font-bold tracking-[-0.02em]",
          onColor ? "text-white" : "text-ink",
        )}
        style={{ fontSize: size }}
      >
        trat
        <LogoMark size={markSize} />
        <span className="sr-only">o</span>
      </span>
      <span
        className={cn(
          "text-[15px]",
          onColor ? "text-white/80" : "text-muted",
        )}
      >
        Agenda
      </span>
    </div>
  );
}
