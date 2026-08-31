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
        <span className="size-[74%] rounded-full bg-accent" />
      </span>
    </div>
  );
}
