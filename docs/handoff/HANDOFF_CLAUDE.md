# JSH Platform — project context for Claude Code

This folder continues work started in a claude.ai conversation (Sep 22–23, 2026) with the Jain Society of Houston (JSH) technology officer. Read this file first, then `docs/project-memory.md` for the full decision history.

## What we are building
A consolidated, multi-tenant community platform for Jain centers, with JSH as tenant #1:
- **Member app** (iOS/Android): Home, Events (RSVP, tickets, lunch slots, calendar, photos, feedback), Give (pledges, bolis, opportunities, recurring gifts, special-day labh), Satvik Store, Jain Way (Today practices, Gyan Path learning, Saathi family support, Library), Family (profiles, special days, voting eligibility), Niva AI assistant, onboarding, New to JSH guide.
- **Admin portal** (web): People, Events, Giving, Bolis, Store, Pathshala, Content, Calendar, Communications, Accounting (QuickBooks), Reports, Settings, Platform (super-admin). Granular entitlements for every module; default roles out of the box; audit log for every action.
- **Ops app** for volunteers (check-in, kiosk, stations) — separate prototype, not in this folder.
- **Public community dashboard** (no login) with aggregated KPIs.

White-label goal: any Jain center can onboard with configuration, not code.

## Key decisions (see docs/project-memory.md for all)
- The platform **replaces Neon One** and becomes the CRM / system of record. Migration tooling must handle any prior system with many years of history.
- **QuickBooks Online** is the accounting record; the platform posts every money event. **Cash basis.**
- Pay-now gifts: create a pledge, record the donation against it, close the pledge.
- Payment allocation: earliest open pledge first unless tied to a specific invoice; overpayment to the next open pledge; partial payments keep the pledge open; show an allocation preview with override.
- Balances shown at **household level** to all adult members; children cannot RSVP, pledge, pay or join bolis.
- Bolis: say **"pledge", never "bid"**. First recorded wins; keep every entry. Digital (floor + cutoff) and in-person (bulk upload) bolis.
- Membership: anyone can be a community member; yearly/life membership needs a verified reference at the same tier or higher, then center approval. Rules configurable per center.
- Lunch slots: families with a child under 12 or a senior eat together at lunch start; others by arrival, then RSVP order; missed slot → any later slot; reminder 5 minutes before.
- Privacy: directory, photos and **digital-only documents / no physical mail** asked explicitly at onboarding. Deletion keeps financial records 7 years then anonymizes.
- Shared login with a child → one-time code for every financial transaction.
- Volunteers must sign the center's uploaded legal waiver in the member app before serving.
- Event feedback surveys with an anonymous option; admin aggregation; feedback-request notification.
- Data backup, governance and auditability built into every service domain.
- Launch target: within 2 months (Wave 1), using AI agents heavily.

## Prototypes (in `prototypes/`)
- `prototypes/site/` — runnable static site. Run locally: `npx serve prototypes/site` then open http://localhost:3000.
  Deploy: `npx netlify-cli deploy --dir prototypes/site --prod --site c2f043f9-3043-4713-9869-dec78ee40bac` (Netlify project `jsh-prototypes`).
- `prototypes/source/` — editable source. Each `*.dc.html` is one screen/app in the Design Component format (template with `{{holes}}`, `<sc-if>`, `<sc-for>`, plus a `class Component extends DCLogic` logic block). Rules: `DC-FORMAT.md`. `support.js` is the runtime (bundles React 18).
  - `Main.dc.html` member app · `Onboarding.dc.html` · `Welcome.dc.html` New to JSH · `GyanPath.dc.html` · `CommunityDashboard.dc.html` · `AdminPortal.dc.html` · `Volunteer.dc.html` (deprecated; moving to its own prototype)
  - Admin portal and dashboard use an in-page mock API (`api()` → `server()`), which enforces entitlements (403) and the two-person rule (409).
  - To rebuild `site/` from `source/`: copy the `.dc.html` files, then re-add the viewport/fit/PWA `<head>` snippet and "All prototypes" link that `site/` pages already contain.
- All data is made up. Every screen shows a PROTOTYPE badge.

## Conventions
- Terms: household (not "family account"), pledge, payment, boli, labh, campaign, fund.
- Brand: navy #1B2C5C, ivory #FBF7F0, saffron #C9731C; Fraunces headings, DM Sans body.
- Never hard-code JSH specifics in the real build — they become tenant configuration.

## Where else things live
- Recommendations doc (9 tabs: roadmap, decision log, platform components, feature traceability, roles and permissions, center onboarding, QuickBooks, data governance, member-app-to-admin coverage): https://claude.ai/code/artifact/338356dc-8bc9-4cbf-9c06-7040f443f72a — export each tab as Markdown into `docs/`.
- Design canvas with all prototypes: https://claude.ai/artifact/PL6zCn4kgCbzC6tKW6oXed
- Original conversation: export from claude.ai (see README) into `docs/conversation/`.

## Suggested next steps in Claude Code
1. Export the doc tabs into `docs/` and read them.
2. Write the product spec and tenant configuration schema from the prototypes and decision log.
3. Scaffold the real codebase (API, data model with center ID + row-level security, admin web, mobile app).
