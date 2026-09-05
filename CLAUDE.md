# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Trato Agenda: a WhatsApp bot that manages Google Calendar meetings via chat. Monorepo: `api/` (NestJS 12 + Prisma 7 + Postgres 16) and `web/` (Next.js 16 onboarding frontend), wired together by `docker-compose.yml` (db :5432, api :4000, web :3000).

**Google login, WhatsApp linking, Google Calendar, and the WhatsApp conversation itself are all real** — nothing is simulated anymore except the screen after linking. `/vincular` does a real Baileys QR pairing over SSE (`api/src/whatsapp/`). `/contanos` (a five-step wizard: nombre del titular, tipo de uso, tipos de evento con duración, franja horaria, nombre del asistente) generates a real per-user agent via OpenRouter (`api/src/agents/`); that agent then answers incoming WhatsApp messages for real, checking availability and booking/cancelling/rescheduling on the owner's Google Calendar (`api/src/calendar/`, `api/src/conversation/`). There is no screen after linking — "Ir a mi agenda" restarts the demo.

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

`api/`: NestJS 12 on ESM, Passport (`passport-google-oauth20` + `passport-jwt` reading the cookie), Prisma 7 with the `@prisma/adapter-pg` driver (connection URL in `prisma.config.ts`, generated client in `src/generated/prisma`), oxlint, vitest. The Google refresh token is stored AES-256-GCM-encrypted (`src/auth/token-crypto.ts`) and never leaves the API — `UsuarioPublico` (`src/auth/auth.types.ts`) is the only user shape the frontend sees. `googleapis` uses that same refresh token for real Google Calendar access (`src/calendar/`). `src/agents/` (the meta-agent that generates a user's system prompt + allowed actions) calls OpenRouter through a small `fetch` wrapper (`src/agents/openrouter.client.ts`, no SDK), and so does the client-summary step of the conversation runtime. `src/conversation/` itself runs on LangGraph (`@langchain/langgraph` + `@langchain/openai`): its single LLM node talks to the same OpenRouter endpoint through `ChatOpenAI` pointed at `https://openrouter.ai/api/v1` (`src/conversation/llm.provider.ts`). Both paths are configured with `OPENROUTER_API_KEY`/`OPENROUTER_MODEL` and stay deliberately untied to one AI provider.

`web/AGENTS.md` (imported by `web/CLAUDE.md`) is auto-generated and rewritten by `next dev`. It warns that this Next.js version differs from training data — consult `web/node_modules/next/dist/docs/` before writing Next-specific code, and commit AGENTS.md changes along with your work rather than reverting them.

## Architecture

**Three-step onboarding flow.** `/` redirects to `/entrar`; `/entrar` sends the browser to the API's `GET /auth/google`; the OAuth callback redirects back to `/contanos` ("Paso 2 de 3"). That screen is a five-step wizard — nombre del titular (persona o negocio), tipo de uso (comercio/consultorio/reuniones/visitas/personal/otro), tipos de evento con su duración, franja horaria de atención, y nombre del asistente con vista previa del saludo. State and catalogs live in `web/src/app/contanos/useOnboarding.ts`; the controls are shared by `WizardEscritorio.tsx` (escritorio) and `FormularioMovil.tsx` (móvil, todo en un scroll) under `web/src/components/onboarding/`. Its last button `POST`s the five fields to `/agents/generate` (`api/src/agents/`), which derives `Agent.descripcion` from them (`construirDescripcion`), generates and persists the user's `Agent` (system prompt + allowed actions) before navigating to `/vincular`, the WhatsApp QR-linking screen. Nothing exists after linking — the "Ir a mi agenda" button just restarts the demo.

**The WhatsApp conversation is a LangGraph graph, not a script.** `WhatsappService.handleMessagesUpsert` (`api/src/whatsapp/whatsapp.service.ts`) listens to Baileys' `messages.upsert`, ignores group chats and the owner's own messages, and hands each text message to `ConversationService.handleIncoming` (`api/src/conversation/conversation.service.ts`), now a thin facade that resolves the owner's `Agent` and invokes the compiled graph with `thread_id = Conversation.id`. The graph (`api/src/conversation/graph/`) has one LLM node and four code nodes:

```
START -> cargar_contexto -> conversacion --sin tool calls--> persistir -> END
                                 ^              |
                                 |          (tool calls)
                                 |              v
                              calendar <--ok-- validacion
                                 |              |
                                 +--------------+ (rechazo: vuelve sin tocar Google)
```

- **`cargar_contexto`** (code) loads the `Agent` (+`user`), the `Conversation`, the active `Turno`, and calls `freeBusy` **once** over the next `DIAS_VENTANA` (14) days, merging into it the owner's own confirmed `Turno` rows (`unirOcupados`) — a free DB read that covers what `freeBusy` hasn't propagated yet and events the owner marked "Disponible", which `freeBusy` never reports as busy. It turns that into a compact per-day list of free gaps that goes straight into the system prompt, alongside the generated `systemPrompt`, the hard-rules block and the scope block (`reglasDeAgenda` / `reglasDeAlcance`), both built from the `Agent` row. That snapshot is why a whole conversation costs one Google read instead of one per tool call.
- **`conversacion`** is the only node that calls the model. It binds the tools in `allowedActions` (plus the owner-only ones when the message comes from the Home test bench) as zod schemas — `api/src/conversation/conversation-tools.ts` now holds only the definitions, no execution.
- **`validacion`** (code) checks each tool call against the snapshot and rejects with a `ToolMessage` without touching Google. Within one `AIMessage` it accumulates the ranges it already approved (`provisorios`), so two `crear_turno` in the same model response cannot both be measured against the same stale photo and end up overlapping. It also answers `consultar_disponibilidad` straight from the snapshot whenever the range falls inside the preloaded window.
- **`calendar`** (code) is the only door to Google Calendar and the `Turno` rows; it runs just what validation approved and updates the in-memory snapshot so the rest of the turn stays consistent. Before writing a `crear_turno` or `reprogramar_turno` it re-reads that one range in Google (`choqueDeUltimoMomento`) — a small `freeBusy` per booked turno, not per message — and aborts without writing if something got in between the snapshot and now (a parallel conversation, or the owner adding an event by hand). That is the last barrier against double-booking; the rules themselves still live in `agenda-rules.ts`.
- **`persistir`** mirrors the turn into the `Message` table in the same OpenAI-shaped JSON as before, and recomputes `Conversation.resumen` only every `CADA_CUANTOS_MENSAJES_RESUMIR` (6) messages, since that is a second model call.

Conversation state lives in a `PostgresSaver` checkpointer (`checkpointer.provider.ts`). Its tables (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`, `checkpoint_migrations`) are created by `setup()` at boot and are **outside** the Prisma migrations on purpose — `prisma migrate reset` wipes them. When that happens with the API already up, the saver recreates them by itself: `SaverAutoReparable` (same file) catches Postgres' `42P01` on any checkpointer operation, re-runs the idempotent `setup()` once (sharing a single repair across concurrent messages) and retries — no `docker compose restart api` needed. Everything in the graph state except `messages` is an `UntrackedValue`, so the owner's Google refresh token never gets serialized into a checkpoint. Threads created before the migration are seeded once from the `Message` table (`graph/historial.ts`).

The three agenda rules — no overlapping, at least `MARGEN_MINIMO_MIN` (5) minutes between turnos, and always asking the client's name — live in `graph/agenda-rules.ts` as pure functions and are enforced by the `validacion` node, not only by the generated prompt: `crear_turno` requires a `nombreCliente`, both it and `reprogramar_turno` reject anything outside the `Agent`'s `horaDesde`/`horaHasta`, and collisions are checked over the range widened by the margin (`conMargen`). A collision rejection carries the fix, not just the refusal: `mensajeOcupado` appends the nearest free slot found by `horariosCercanos`, which walks the loaded window through `huecosDelDia` and picks, inside each gap, the point closest to what was asked (asking for 10:03 right after a turno ending at 10:00 suggests 10:05, not the 09:00 start of the gap). `parsearFecha` anchors any ISO string without an offset to `TIMEZONE` before `new Date`: the API container runs in UTC, so "14:00" used to become 11:00 ART and every collision check ran against the wrong instant. `reprogramar_turno` filters the turno's own event out of the busy periods (`conflictos`), otherwise the margin makes a small move collide with itself. The rules block in the system prompt is built from the `Agent` row (not from the generated prompt, so it survives regeneration), and `Conversation.nombreCliente` is reused so the agent doesn't ask for the name twice. `reglasDeAlcance` (same file, same reason it lives in code) is what keeps the agent on topic: it may only talk about turnos and the business data already in the `Agent` row (attention window, tipos de turno, who attends), it must refuse anything else in one line — including an off-topic question smuggled into a booking message — and it must never invent business data it wasn't given (prices, address), deferring to the owner instead. The meta-agent's `META_SYSTEM_PROMPT` asks for the same restriction so a freshly generated prompt agrees with it, but the code block is the guarantee and covers agents generated before it existed, with no regeneration. A `CalendarUnavailableError` (revoked/missing token, Google API failure) turns into an apology instead of crashing the graph; if it happens while loading the snapshot, the validation node refuses to book anything. `LIMITE_RECURSION` (14 supersteps) replaces the old 4-round-trip cap.

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
