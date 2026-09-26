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
# El runtime sólo necesita `node`. npm, npx, corepack y yarn vienen en la imagen
# base y traen sus propias dependencias (tar, brace-expansion, ip-address...)
# con CVEs que el scan de imágenes marca: afuera, y de paso los paquetes del
# sistema al día.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
# Los archivos quedan de root (sólo lectura para el proceso) y el proceso corre
# como el usuario sin privilegios que ya trae la imagen: si alguien toma el
# proceso, no puede reescribir el código ni instalar nada en el contenedor.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/package.json ./package.json
USER node
EXPOSE 4000
# Las migraciones corren al arrancar el contenedor, no a mano: en un deploy
# (Railway y compañía) la base arranca vacía y nadie entra a correr
# `prisma migrate deploy`. Es idempotente, así que repetirlo no molesta.
# Por eso el CLI de prisma vive en `dependencies` y no en `devDependencies`:
# `npm prune --omit=dev` se lo llevaría. Se llama directo y no con `npx`, que
# ya no está en la imagen.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main"]
