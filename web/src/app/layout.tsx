import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AvisosProvider } from "@/components/ui/Avisos";
import { SessionProvider } from "@/lib/session";
import { SuscripcionProvider } from "@/lib/suscripcion";
import { TutorialProvider } from "@/lib/tutorial";
import "./globals.css";

// Fuentes guardadas en el repo (subset latin, variables de peso 400–700, licencia
// OFL al lado). Con next/font/google el build bajaba el CSS de Google y Turbopack
// fallaba al procesarlo según lo que respondiera ("next/font/google queries have
// exactly one entry"), lo que tumbó el deploy de la web en Railway.
const manrope = localFont({
  src: "./fonts/manrope-latin.woff2",
  variable: "--font-manrope",
  weight: "400 700",
  display: "swap",
});

const jakarta = localFont({
  src: "./fonts/plus-jakarta-sans-latin.woff2",
  variable: "--font-jakarta",
  weight: "400 700",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Trato",
  description:
    "La atención al cliente de tu negocio por WhatsApp: un asistente que suena como alguien de tu equipo y se ocupa de los turnos, el stock y los cobros.",
};

// viewport-fit=cover habilita env(safe-area-inset-*) para los pies fijos del celular.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Las variables de next/font van en <html>: los tokens del design system
    // se declaran en :root y necesitan resolverlas en ese mismo elemento.
    <html lang="es" className={`${manrope.variable} ${jakarta.variable}`}>
      <body>
        <SessionProvider>
          <SuscripcionProvider>
            <AvisosProvider>
              <TutorialProvider>{children}</TutorialProvider>
            </AvisosProvider>
          </SuscripcionProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
