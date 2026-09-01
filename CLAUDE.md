# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Trato Agenda: a WhatsApp bot that manages Google Calendar meetings via chat. Monorepo: `api/` (NestJS 12 + Prisma 7 + Postgres 16) and `web/` (Next.js 16 onboarding frontend), wired together by `docker-compose.yml` (db :5432, api :4000, web :3000).

**Google login, WhatsApp linking, Google Calendar, and the WhatsApp conversation itself are all real** — nothing is simulated anymore except the screen after linking. `/vincular` does a real Baileys QR pairing over SSE (`api/src/whatsapp/`). `/contanos` (tipo de uso + free-text description) generates a real per-user agent via OpenRouter (`api/src/agents/`); that agent then answers incoming WhatsApp messages for real, checking availability and booking/cancelling/rescheduling on the owner's Google Calendar (`api/src/calendar/`, `api/src/conversation/`). There is no screen after linking — "Ir a mi agenda" restarts the demo.

UI copy is in Spanish (`<html lang="es">`, rioplatense voseo). Code comments are also in Spanish. Match that when editing.

## Commands

From the repo root — this is how you actually run the thing, since the login needs the API and the DB:

```bash
docker compose up --build
docker compose exec api npx prisma migrate dev --name init   # first time only
```

The API needs `api/.env` (never committed; the variable table is in the root `README.md`). Without real `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, the API boots but Google rejects the consent screen.

From `web/`:

```bash
npm run dev      # dev server on :3000
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint (flat config, eslint-config-next core-web-vitals + typescript)
```

From `api/` (better via `docker compose exec api ...`): `npm run start:dev`, `npm run lint` (oxlint), `npm test` (vitest).

The web side has no test runner configured.

## Stack

`web/`: Next.js 16 App Router (Turbopack), React 19, TypeScript strict, Tailwind CSS v4 (PostCSS plugin only — no `tailwind.config`), `qrcode` for QR generation. Path alias `@/*` → `web/src/*`. Its only env var is `NEXT_PUBLIC_API_URL` (inlined at build time — the Dockerfile takes it as a build arg).

`api/`: NestJS 12 on ESM, Passport (`passport-google-oauth20` + `passport-jwt` reading the cookie), Prisma 7 with the `@prisma/adapter-pg` driver (connection URL in `prisma.config.ts`, generated client in `src/generated/prisma`), oxlint, vitest. The Google refresh token is stored AES-256-GCM-encrypted (`src/auth/token-crypto.ts`) and never leaves the API — `UsuarioPublico` (`src/auth/auth.types.ts`) is the only user shape the frontend sees. `googleapis` uses that same refresh token for real Google Calendar access (`src/calendar/`). `src/agents/` (the meta-agent that generates a user's system prompt + allowed actions) and `src/conversation/` (the runtime that answers WhatsApp messages, tool-calling into Calendar) both call OpenRouter through a small `fetch` wrapper (`src/agents/openrouter.client.ts`, no SDK) — configured with `OPENROUTER_API_KEY`/`OPENROUTER_MODEL`, deliberately not tied to one AI provider.

`web/AGENTS.md` (imported by `web/CLAUDE.md`) is auto-generated and rewritten by `next dev`. It warns that this Next.js version differs from training data — consult `web/node_modules/next/dist/docs/` before writing Next-specific code, and commit AGENTS.md changes along with your work rather than reverting them.

## Architecture

**Three-step onboarding flow.** `/` redirects to `/entrar`; `/entrar` sends the browser to the API's `GET /auth/google`; the OAuth callback redirects back to `/contanos` ("Paso 2 de 3": pick a tipo de uso — comercio/consultorio/reuniones/visitas/agenda personal/otro — and write a free-text description). Its "Continuar" button `POST`s that to `/agents/generate` (`api/src/agents/`), which generates and persists the user's `Agent` (system prompt + allowed actions) before navigating to `/vincular`, the WhatsApp QR-linking screen. Nothing exists after linking — the "Ir a mi agenda" button just restarts the demo.

**The WhatsApp conversation is a tool-calling loop, not a script.** `WhatsappService.handleMessagesUpsert` (`api/src/whatsapp/whatsapp.service.ts`) listens to Baileys' `messages.upsert`, ignores group chats and the owner's own messages, and hands each text message to `ConversationService.handleIncoming` (`api/src/conversation/`). That loads the owner's `Agent` (its `systemPrompt` + `allowedActions`, generated once by the meta-agent in `api/src/agents/agents.service.ts` from the tipoUso/descripción collected in `/contanos`), replays the `Conversation`'s recent `Message` history, and calls OpenRouter with only the tools in `allowedActions` — a fixed catalog in `api/src/agents/agent-catalog.ts`, one tool implementation per id in `api/src/conversation/conversation-tools.ts`. Tool calls run against real Google Calendar (`api/src/calendar/calendar.service.ts`, fixed to `America/Argentina/Buenos_Aires`) using the owner's refresh token; `crear_turno`/`cancelar_turno`/`reprogramar_turno` track the resulting event in a `Turno` row so cancelling/rescheduling doesn't need the model to remember a Google event id. A `CalendarUnavailableError` (revoked/missing token, Google API failure) is caught and turned into an apology reply instead of crashing the loop, which is capped at 4 round-trips.

**The session lives in a cookie, and the API owns it.** `GET /auth/google/callback` (`api/src/auth/auth.controller.ts`) sets a `httpOnly` JWT cookie named `trato_session`. The frontend can never read it — `SessionProvider` (`web/src/lib/session.tsx`) asks `GET /auth/me` on mount and exposes `status: "loading" | "authenticated" | "anonymous"`. `useRequireSession()` is the route guard (redirects to `/entrar`); `signIn()` is a full-document `window.location` navigation, because `router.push` cannot cross origins. All API calls go through `apiFetch` (`web/src/lib/api.ts`), which sets `credentials: "include"`; CORS on the API side is `origin: FRONTEND_URL, credentials: true`.

The guard is deliberately client-side: verifying the JWT in a Next `proxy.ts` (Next 16's renamed `middleware.ts`) would mean sharing `JWT_SECRET` with the frontend. Do not add one.

Cookies are not scoped by port, so `:4000` and `:3000` share `localhost` and `sameSite: 'lax'` is enough locally. Separate production domains will need `sameSite: 'none'` + `secure`, or a shared domain.

**`/vincular` is a state machine.** `LinkState = "active" | "connecting" | "connected" | "expired" | "error"` is declared in `src/app/vincular/page.tsx` and imported from there by components. Two effects drive it: a 1s interval counting down `TTL_SECONDS = 60` (active → expired) and a 2.5s timeout (connecting → connected). Each non-active state renders a card from `src/components/LinkStateCards.tsx`.

`src/components/DemoStateSwitcher.tsx` is a floating pill that force-switches state — it exists only because no backend can produce those states. So does `TELEFONO_DEMO` in the same page: the real number will come from WhatsApp linking, never from the Google user. Delete both when real linking lands.

The QR token is `trato-link:${crypto.randomUUID()}`, regenerated client-side; `QrCode.tsx` renders it at error-correction level `H` so the green center dot doesn't break scanning.

## Design system

`src/app/globals.css` is the whole design system, ported from an external `_ds_bundle.css` that is **not in this repo**. Three layers:

1. `:root` primitives (`--color-primitive-coral-500`, spacing, motion) — raw values.
2. `:root` semantic tokens (`--color-semantic-primary-default`, `--color-semantic-surface-page`) — reference primitives.
3. `@theme inline` — bridges semantics to Tailwind utilities: `bg-primary`, `text-ink`, `text-ink-secondary`, `text-muted`, `bg-page`, `bg-card`, `bg-sunken`, `border-line`, `font-display`, `rounded-md`, `shadow-md`, plus `success`/`warning`/`danger` families.

Use the Tailwind aliases, not raw `var(--color-…)`, except for tokens with no alias (info, `--color-primitive-neutral-200`). Radius and shadow tokens are prefixed `--ds-` to avoid self-referencing Tailwind's own namespaces — keep that prefix.

`next/font` variables (`--font-manrope`, `--font-jakarta`) must stay on `<html>` in `layout.tsx`, since `:root` tokens resolve them there.

`src/components/ui/` holds the primitives (`Button`, `Badge`) with variant/size lookup maps. `src/lib/cn.ts` is a dependency-free class joiner — no tailwind-merge, so don't rely on conflicting-class resolution.
