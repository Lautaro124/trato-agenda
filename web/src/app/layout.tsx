import type { Metadata, Viewport } from "next";
import { Manrope, Plus_Jakarta_Sans } from "next/font/google";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Trato Agenda",
  description:
    "Entrá con Google y el bot coordina tus reuniones desde WhatsApp: las crea, las mueve y te avisa.",
};

// viewport-fit=cover habilita env(safe-area-inset-*) para la barra inferior móvil.
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
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
