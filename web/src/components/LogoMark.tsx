/** Ícono de globo de chat del logo de Trato — hereda color vía `currentColor`. */
export function LogoMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 104 104"
      role="presentation"
      focusable="false"
      className="shrink-0"
    >
      <path d="M26 74 L26 98 L48 78 Z" fill="currentColor" />
      <rect
        x="9"
        y="9"
        width="86"
        height="72"
        rx="30"
        fill="none"
        stroke="currentColor"
        strokeWidth="17"
      />
    </svg>
  );
}
