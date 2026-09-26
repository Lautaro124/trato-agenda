import type { NextConfig } from "next";

// Cabeceras de seguridad para todas las páginas. Sin CSP completa a propósito:
// Next inyecta scripts inline y una política con nonces es otro trabajo; lo que
// sí va es `frame-ancestors`, que es lo que frena el clickjacking sobre pantallas
// como /cuenta (borrar la cuenta) o /vincular.
const cabecerasDeSeguridad = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Los browsers la ignoran sobre http, así que no molesta en local.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  // Necesario para la imagen de producción del Dockerfile: copia solo lo que hace falta.
  output: "standalone",
  // No anunciar el framework en cada respuesta.
  poweredByHeader: false,
  images: {
    // Las fotos de perfil de Google salen de este host.
    remotePatterns: [new URL("https://lh3.googleusercontent.com/**")],
  },
  async headers() {
    return [{ source: "/:path*", headers: cabecerasDeSeguridad }];
  },
};

export default nextConfig;
