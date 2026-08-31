import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Necesario para la imagen de producción del Dockerfile: copia solo lo que hace falta.
  output: "standalone",
};

export default nextConfig;
