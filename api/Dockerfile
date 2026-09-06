# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Desarrollo: el código real llega por bind mount y nest recompila solo.
FROM base AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 4000
# prisma generate en el arranque: el bind mount tapa lo generado en la imagen.
CMD ["sh", "-c", "npx prisma generate && npm run start:dev"]

FROM base AS build
COPY . .
# `prisma generate` no toca la base, pero prisma.config.ts resuelve
# env('DATABASE_URL') al cargarse y sin la variable aborta. Acá todavía no hay
# base: una URL de descarte alcanza, la real llega en runtime.
# Y no hay `npm prune --omit=dev` a propósito: la imagen de producción corre
# `prisma migrate deploy` al arrancar, y eso necesita el CLI de prisma y
# typescript (ambos dev) para leer prisma.config.ts.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate \
 && npm run build

FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/package.json ./package.json
# El PaaS inyecta PORT; EXPOSE es sólo documentación / detección de puerto.
EXPOSE 4000
# Migrar antes de levantar: el deploy queda autocontenido y la base nunca
# arranca atrasada respecto del código que la usa.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
