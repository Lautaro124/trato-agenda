# Trato Agenda — Web

Frontend Next.js 16 (App Router) + React 19 + Tailwind v4. Es el onboarding:
login con Google y vinculación de WhatsApp por QR.

El login es real y lo resuelve la API (`../api`): el botón manda a
`GET /auth/google`, y el callback vuelve acá con la cookie `httpOnly`
`trato_session`. El front nunca lee esa cookie — pregunta quién está logueado con
`GET /auth/me` (`src/lib/session.tsx`).

## Comandos

```bash
npm run dev      # servidor de desarrollo en :3000
npm run build    # build de producción
npm run start    # sirve el build
npm run lint     # eslint
```

Con Docker, desde la raíz del repo: `docker compose up --build` (levanta también
la API y Postgres, que el login necesita).

## Variables de entorno

| Variable | Descripción |
| -------- | ----------- |
| `NEXT_PUBLIC_API_URL` | Base de la API. Por defecto `http://localhost:4000` (`src/lib/api.ts`). `docker-compose.yml` ya la define para el contenedor. |

Como toda `NEXT_PUBLIC_*`, se **inlinea en tiempo de build**: para la imagen de
producción hay que pasarla como build arg
(`docker build --build-arg NEXT_PUBLIC_API_URL=...`), no como variable de runtime.

## Qué hay adentro

- `src/app/entrar` — pantalla de login. Redirige a `/vincular` si ya hay sesión.
- `src/app/vincular` — QR de WhatsApp. Protegida: sin sesión vuelve a `/entrar`.
  Los estados `connecting` / `connected` / `expired` / `error` siguen simulados,
  igual que el teléfono (`TELEFONO_DEMO`): no hay backend de vinculación todavía.
- `src/lib/session.tsx` — `SessionProvider`, `useSession`, `useRequireSession`.
- `src/lib/api.ts` — `apiFetch`, que manda siempre `credentials: "include"`.
- `src/app/globals.css` — el design system entero (tokens + puente a Tailwind).
