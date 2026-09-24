@AGENTS.md

## Project context

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first: Supabase client with `db: { schema: 'app' }`,
  env vars, the RPCs that carry business rules, integer cents, design tokens.
- **This repo owns the database.** `supabase/` (migrations, seed, tests) lives here. After any
  migration, regenerate `src/lib/database.types.ts` (`node supabase/scripts/gen-types.mjs`) and copy
  it to **connect-admin** and **connect-mobile**. Never hand-edit the generated types.
- **Errors are always surfaced.** Every Server Action returns `{ ok, error }`; the UI shows the
  error in plain English next to what the user did ("Could not record the payment — …"), with a
  retry where one exists. Log the technical detail on the server (`failure()` in `src/lib/errors.ts`).
  Never console-only, never a silent fallback, never "Saved" when the write failed.
- UI permission checks (`src/lib/permissions.ts`) are convenience only; RLS in the database is the
  enforcement. When RLS would return nothing because of permissions, show "You don't have access
  to this area", not an empty table.
- Households are never picked or confirmed by name alone: show the `household_card` details.

## Handover and memory (read at session start)
- **Handover receipt** — every handoff file, memory line and feature → where it is built: `docs/HANDOVER_RECEIPT.md`
- **Project memory** from the claude.ai prototyping sessions: `docs/handoff/project-memory.md` (kit context: `docs/handoff/HANDOFF_CLAUDE.md`)
- Decisions + open questions: `docs/DECISIONS.md` · architecture: `docs/ARCHITECTURE.md` · roles: `docs/ROLES.md` · design doc (9 tabs): `docs/design-doc/`
- Prototypes are reference only, never shipped: `docs/handoff/prototypes/source/`
- This repo owns the schema: after any migration run `supabase/tests/run_local.sh`, regenerate `src/lib/database.types.ts` with `supabase/scripts/gen-types.mjs`, and copy it to connect-admin and connect-mobile.
- Founder rules: bolis say "pledge", never "bid"; money is integer cents; never identify a household by name alone (show `household_card`); every member has several identifiers (Connect number, JSH person ID, JSH household ID, Neon/NamoCRM, QuickBooks, bank payer names); JSH banks with Chase.

## Deploy and migrations

- Deploy: `docs/DEPLOY.md` (DigitalOcean droplet + Supabase cloud, GitHub Actions on push to
  `main`). Local run: `docs/LOCAL_DEV.md`.
- Hosted Supabase keeps pgcrypto in the `extensions` schema. Every function that pins a search
  path must use `set search_path = app, public, extensions` (0019). The test stub mirrors this, so
  a function that cannot see `digest()` fails in CI, not in production.
- Migrations reach Supabase through `supabase/scripts/migrate.sh` (tracked in
  `public.connect_schema_migrations`, one transaction per file). Never edit an applied migration;
  add a new one.

## Pull requests — standing authorisation (owner, 2026-09-24)

Claude opens a PR for each change, waits for **App checks** (typecheck, lint, test, build;
plus **Database tests** in connect-crm when `supabase/**` changes) to pass, merges it, then
confirms the resulting **Deploy** run is green and the app answers. Ask the owner first,
even with checks green, for anything that changes money rules, permissions/RLS, or deletes
data. Repository settings, secrets and passwords stay with the owner.
