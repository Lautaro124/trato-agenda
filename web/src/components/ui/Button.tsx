import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-on border-transparent shadow-sm hover:bg-primary-hover active:bg-primary-active",
  secondary:
    "bg-card text-ink border-line-strong shadow-sm hover:bg-sunken active:bg-sunken",
  ghost:
    "bg-transparent text-primary border-transparent hover:bg-primary-subtle active:bg-primary-subtle",
  danger:
    "bg-danger text-white border-transparent shadow-sm hover:bg-danger-text active:bg-danger-text",
};

const SIZES: Record<Size, string> = {
  sm: "px-3 py-1 text-[13px]",
  md: "px-4 py-2 text-[15px]",
  lg: "px-6 py-3 text-[17px]",
};

type ButtonProps = {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  icon?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

/** Trato Button — coral primario, radio generoso, sombra suave. */
export function Button({
  children,
  variant = "primary",
  size = "md",
  fullWidth = false,
  icon = null,
  className,
  type = "button",
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md border font-body font-semibold leading-none whitespace-nowrap",
        "transition-[background-color,transform] duration-[120ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
        "cursor-pointer active:scale-[0.97]",
        "disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[var(--color-primitive-neutral-200)] disabled:text-muted disabled:shadow-none disabled:active:scale-100",
        SIZES[size],
        VARIANTS[variant],
        fullWidth ? "w-full" : "w-auto",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
