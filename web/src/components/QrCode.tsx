"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * QR real del token de vinculación. Nivel de corrección "H" para que siga
 * escaneándose con el punto de marca encima, igual que el QrPlaceholder del diseño.
 */
export function QrCode({ value, size }: { value: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: size * 2,
      color: { dark: "#2C2C2AFF", light: "#FFFFFFFF" },
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div
      className="relative overflow-hidden rounded-sm bg-white"
      style={{ width: size, height: size }}
    >
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- data: URI generado en cliente
        <img src={src} alt="Código QR de vinculación" width={size} height={size} />
      )}
      <span className="absolute top-1/2 left-1/2 grid size-[22%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md bg-white">
        <span className="grid size-[80%] place-items-center rounded-full bg-accent">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[62%] fill-white">
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.86 9.86 0 0 0 12.04 2Zm5.8 14.07c-.25.7-1.23 1.28-2.02 1.45-.55.11-1.26.2-3.66-.79-2.99-1.24-4.92-4.27-5.07-4.47-.15-.2-1.21-1.61-1.21-3.07s.75-2.18 1.02-2.48c.25-.28.55-.35.73-.35h.53c.17 0 .4-.03.62.48.25.6.85 2.06.92 2.21.07.15.12.33.02.53-.1.2-.15.32-.3.5-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.3.77 1.27 1.65 2.05 1.13 1.01 2.09 1.33 2.39 1.48.3.15.47.13.65-.08.17-.2.75-.87.95-1.17.2-.3.4-.25.66-.15.27.1 1.71.81 2 .96.3.15.49.22.56.35.07.13.07.75-.18 1.45Z" />
          </svg>
        </span>
      </span>
    </div>
  );
}
