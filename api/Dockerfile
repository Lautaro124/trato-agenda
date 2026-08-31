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
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/package.json ./package.json
EXPOSE 4000
CMD ["node", "dist/main"]
