import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Necesario para la imagen de producción del Dockerfile: copia solo lo que hace falta.
  output: "standalone",
  images: {
    // Las fotos de perfil de Google salen de este host.
    remotePatterns: [new URL("https://lh3.googleusercontent.com/**")],
  },
};

export default nextConfig;
