# Seguridad: scan del 2026-09-26 y controles automáticos

Qué se revisó, qué se encontró, qué se arregló y qué queda pendiente. Los
controles que corren solos están en `.github/workflows/security.yml` y
`.github/dependabot.yml`.

## Qué se revisó

- **Dependencias**: `npm audit` de `api/`, `web/` y `e2e/` (producción y desarrollo).
- **Secretos**: el historial completo de git, buscando archivos `.env`, claves
  privadas y patrones de credenciales (Google, OpenRouter, Mercado Pago, GitHub,
  AWS). No apareció ninguno: sólo `.env.example`, que no tiene valores reales.
- **Código de la API**: autenticación (JWT en cookie, scrypt, códigos de
  acceso), CSRF (`csrf-origin.ts`), cookies, cifrado del refresh token
  (AES-256-GCM), firma del webhook de Mercado Pago, validación de entorno,
  autorización por dueño en `/calendar/eventos/:id` (IDOR), SQL crudo.
- **Web**: sinks de XSS (`dangerouslySetInnerHTML`, `eval`), cabeceras HTTP.
- **Contenedores**: `api/Dockerfile` y `web/Dockerfile`.

## Hallazgos y estado

| # | Severidad | Hallazgo | Estado |
|---|-----------|----------|--------|
| 1 | Alta | `undici` 6.20.1 (vía `openai` y `@nestjs/mau`): 15 avisos, entre ellos request smuggling, CRLF injection y DoS por WebSocket. | **Arreglado**: override a `^6.29.0`. |
| 2 | Alta | `multer` ≤ 2.2.0 (vía `@nestjs/platform-express`): DoS con nombres de campo armados y fuga de descriptores. | **Arreglado**: `@nestjs/platform-express` 12.1.0 → `multer` 2.4.0. |
| 3 | Alta | `mysql2` 3.15.3 y `deepmerge-ts` 7.1.5 (vía `prisma`): downgrade de auth a texto plano; stack exhaustion. La API usa Postgres, pero viajan en la imagen. | **Arreglado**: overrides a `mysql2 ^3.24.4` y `deepmerge-ts ^8.0.2`. `prisma generate`/`validate` y los 384 tests pasan. |
| 4 | Alta (dev) | `tmp` 0.0.33 (vía `@nestjs/mau` → `inquirer`): path traversal. | **Arreglado**: override a `^0.2.6`. |
| 5 | Media | Las imágenes de producción corrían como `root` y traían npm, corepack y yarn (con `tar`, `brace-expansion` e `ip-address` vulnerables adentro), que el runtime no usa. | **Arreglado**: `USER node`; el código queda de root (sólo lectura) y en la web sólo `.next` es escribible (cache de `next/image`). Se borran npm/npx/corepack/yarn y se hace `apk upgrade`; la API corre `prisma` directo desde `node_modules/.bin`. CI verifica que la imagen no sea root y Grype la escanea. |
| 6 | Media | La web no mandaba `X-Frame-Options` ni `frame-ancestors`: `/cuenta` (borrar la cuenta) y `/vincular` se podían embeber en un iframe (clickjacking). | **Arreglado**: cabeceras en `web/next.config.ts` (más `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS) y `poweredByHeader: false`. |
| 7 | Baja | La API no mandaba cabeceras de seguridad y anunciaba `X-Powered-By: Express`. | **Arreglado**: `api/src/security-headers.ts` (`nosniff`, `DENY`, CSP `default-src 'none'`, `no-referrer`) y `x-powered-by` apagado. |
| 8 | Media | Cambiar la contraseña (o recuperarla por código) **no invalida las sesiones abiertas**: un JWT robado sigue valiendo hasta 7 días aunque el dueño ya haya cambiado la clave. | **Pendiente**: requiere un `User.sesionVersion` (migración) que viaje en el JWT y se compare en `JwtStrategy.validate`, incrementado en `POST /auth/password`, en la verificación del código y en `/auth/logout`. |
| 9 | Baja | El webhook de Mercado Pago verifica la firma pero no la antigüedad de `ts`, así que una notificación firmada se puede reenviar. | **Aceptado por ahora**: el handler ignora el cuerpo y vuelve a leer el preapproval de la API de MP, así que un replay no cambia nada. Si se quiere cerrar, rechazar `ts` con más de ~5 minutos. |
| 10 | Info | Sin CSP completa en la web (sólo `frame-ancestors`). | **Pendiente**: una CSP con nonces en Next 16 necesita `proxy.ts`; ver la doc de Next en `web/node_modules/next/dist/docs/` antes de encararlo. |
| 11 | Info | `npx tsc --noEmit -p tsconfig.json` en `api/` falla en dos specs (`turnos-del-dueno.spec.ts`, `test/app.e2e-spec.ts`). No afecta al build (`tsconfig.build.json`) ni a vitest. | **Pendiente**: CI chequea tipos con `tsconfig.build.json`. |

Lo que se revisó y está bien: el CSRF por `Origin` más cookies `httpOnly`/`secure`;
la validación de entorno que rechaza `DEV_LOGIN_PASSWORD` en producción; el
refresh token cifrado con GCM e IV aleatorio; scrypt con `timingSafeEqual` y
hash falso para no delatar números; `ValidationPipe` con `whitelist`; los
eventos locales se buscan siempre por `userId` antes de editar o borrar; no hay
SQL crudo ni `dangerouslySetInnerHTML`.

## Controles automáticos

**`ci.yml`** (PRs y `main`): lint, tipos, tests y build de `api/`; lint, tipos y
build de `web/`; tipos de `e2e/`; build de las imágenes de producción
verificando que no corran como root; y los E2E de Playwright contra el stack
de compose con un `api/.env` de mentira generado en el momento.

**`security.yml`** (PRs, `main` y los lunes):

- `npm audit` por paquete: falla desde *moderate* en producción y desde *high*
  en desarrollo; más `npm audit signatures` sobre lo instalado.
- CodeQL (`security-extended`) sobre TypeScript y sobre los propios workflows.
- TruffleHog sobre los commits nuevos (y todo el historial en el cron).
- Dependency Review en PRs: frena dependencias nuevas vulnerables o con
  licencias GPL/AGPL. Queda salteado hasta que se prenda el Dependency graph y
  la variable `DEPENDENCY_REVIEW=on` (ver pasos manuales).
- Grype sobre las imágenes de producción, con los resultados en la pestaña
  *Security → Code scanning*.
- actionlint sobre los workflows.

**`dependabot.yml`**: PRs semanales agrupados para npm (`api`, `web`,
mensual para `e2e`), las imágenes base de Docker y las Actions.

Todas las Actions de terceros están fijadas por SHA de commit (con la versión
en un comentario), con `permissions` mínimos y `persist-credentials: false`.
Para las imágenes se eligió Grype y no `trivy-action`, que tuvo un compromiso
de supply chain (tags reescritos) en 2026.

## Pasos manuales en GitHub

1. *Settings → Branches*: proteger `main` exigiendo los checks de CI y
   Seguridad antes de mergear.
2. *Settings → Code security*: prender Dependency graph, Dependabot alerts,
   secret scanning y push protection (gratis en repos públicos).
3. *Settings → Secrets and variables → Actions → Variables*: crear
   `DEPENDENCY_REVIEW` con valor `on`, que activa el job de Dependency Review
   (sin el Dependency graph prendido ese job falla).
