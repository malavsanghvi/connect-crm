# Connect CRM

The system-of-record console for the Connect community platform: households,
people and their identifiers, memberships, pledges and payments, bank
reconciliation, QuickBooks, audit, roles and center settings. It serves the
treasurer, finance volunteers, the membership coordinator, the Executive
Committee, the center admin and the privacy officer.

Connect is multi-tenant; the Jain Society of Houston (JSH) is tenant #1. This
repo also **owns the database** (`supabase/`): migrations, seed, RLS tests and
the generated types the other two apps copy. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the platform conventions.

Stack: Next.js 16 (App Router, Server Components, Server Actions, `proxy.ts`),
React 19, Tailwind CSS v4, TypeScript, Supabase (`@supabase/ssr`), Vitest.

## Setup

```bash
pnpm install
cp .env.example .env.local   # then fill in the values below
pnpm dev                     # http://localhost:3000
```

Sign-in is a passwordless email code (Supabase `signInWithOtp` + `verifyOtp`).
The project's **Magic Link email template must include `{{ .Token }}`** so the
email carries the 6-digit code. The console never creates accounts
(`shouldCreateUser: false`): people sign in to the member app first, which links
their login to their person record; a center admin then grants them a staff role
under **Settings → Roles and access**.

### Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL (local: `http://localhost:54321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | The project's anon key. Never the service-role key. |
| `NEXT_PUBLIC_CENTER_SLUG` | no (default `jsh`) | Which `app.centers` row this console serves |

If a required variable is missing the app shows a setup page naming it; it never
falls back to sample data.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build / server |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Generate Next route types, then `tsc --noEmit` |
| `pnpm test` | Unit tests (Vitest) for the pure helpers in `src/lib` |

Database work (schema tests, type generation, pushing migrations) is described
in [docs/ARCHITECTURE.md → Working on the schema](docs/ARCHITECTURE.md#working-on-the-schema).

## How the code is organised

- `src/proxy.ts` — refreshes the Supabase session cookie and redirects signed-out users to `/login`.
- `src/lib/session.ts` — `getSession()` resolves user → center → role grants → permissions once per
  request; `authorizeAction()` re-checks inside every Server Action. UI gating mirrors
  `app.has_permission()`; the database enforces RLS regardless.
- `src/lib/permissions.ts` — what each area needs (`ACCESS`) and the navigation.
- `src/app/(app)/…` — the console routes; reads are Server Components, writes are Server Actions
  returning `{ ok, error }` and shown in plain English next to the form.
- `src/lib/database.types.ts` — generated from the migrations; do not edit by hand.
