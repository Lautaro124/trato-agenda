# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Trato Agenda: a WhatsApp bot that manages Google Calendar meetings via chat. The repo currently holds only the onboarding web frontend (`web/`) — **there is no backend, no real Google OAuth, and no real WhatsApp linking yet**. Everything user-facing is a simulated MVP flow.

UI copy is in Spanish (`<html lang="es">`, rioplatense voseo). Code comments are also in Spanish. Match that when editing.

## Commands

All run from `web/`:

```bash
npm run dev      # dev server on :3000
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint (flat config, eslint-config-next core-web-vitals + typescript)
```

No test runner is configured.

## Stack

Next.js 16 App Router (Turbopack), React 19, TypeScript strict, Tailwind CSS v4 (PostCSS plugin only — no `tailwind.config`), `qrcode` for QR generation. Path alias `@/*` → `web/src/*`.

`web/AGENTS.md` (imported by `web/CLAUDE.md`) is auto-generated and rewritten by `next dev`. It warns that this Next.js version differs from training data — consult `web/node_modules/next/dist/docs/` before writing Next-specific code, and commit AGENTS.md changes along with your work rather than reverting them.

## Architecture

**Two-step onboarding flow.** `/` redirects to `/entrar`; `/entrar` fakes Google sign-in and pushes to `/vincular`; `/vincular` is the WhatsApp QR-linking screen. Nothing exists after linking — the "Ir a mi agenda" button just restarts the demo.

**Session is client-side and fake.** `src/lib/session.tsx` is a React context holding a hardcoded `MOCK_USER`; `signIn()` sets it, no network involved. `SessionProvider` wraps everything in `app/layout.tsx`. Notably `/vincular` imports `MOCK_USER` directly rather than reading the context — real auth will need to fix that.

**`/vincular` is a state machine.** `LinkState = "active" | "connecting" | "connected" | "expired" | "error"` is declared in `src/app/vincular/page.tsx` and imported from there by components. Two effects drive it: a 1s interval counting down `TTL_SECONDS = 60` (active → expired) and a 2.5s timeout (connecting → connected). Each non-active state renders a card from `src/components/LinkStateCards.tsx`.

`src/components/DemoStateSwitcher.tsx` is a floating pill that force-switches state — it exists only because no backend can produce those states. Delete it when real linking lands.

The QR token is `trato-link:${crypto.randomUUID()}`, regenerated client-side; `QrCode.tsx` renders it at error-correction level `H` so the green center dot doesn't break scanning.

## Design system

`src/app/globals.css` is the whole design system, ported from an external `_ds_bundle.css` that is **not in this repo**. Three layers:

1. `:root` primitives (`--color-primitive-coral-500`, spacing, motion) — raw values.
2. `:root` semantic tokens (`--color-semantic-primary-default`, `--color-semantic-surface-page`) — reference primitives.
3. `@theme inline` — bridges semantics to Tailwind utilities: `bg-primary`, `text-ink`, `text-ink-secondary`, `text-muted`, `bg-page`, `bg-card`, `bg-sunken`, `border-line`, `font-display`, `rounded-md`, `shadow-md`, plus `success`/`warning`/`danger` families.

Use the Tailwind aliases, not raw `var(--color-…)`, except for tokens with no alias (info, `--color-primitive-neutral-200`). Radius and shadow tokens are prefixed `--ds-` to avoid self-referencing Tailwind's own namespaces — keep that prefix.

`next/font` variables (`--font-manrope`, `--font-jakarta`) must stay on `<html>` in `layout.tsx`, since `:root` tokens resolve them there.

`src/components/ui/` holds the primitives (`Button`, `Badge`) with variant/size lookup maps. `src/lib/cn.ts` is a dependency-free class joiner — no tailwind-merge, so don't rely on conflicting-class resolution.
