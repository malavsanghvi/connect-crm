# Marketplace: every major feature is a product an organization chooses to enable

**Status: draft plan for the owner (2026-10-09). Nothing is built.** Owner direction, 2026-10-09: each major
feature becomes an individual product that an organization's team can enable, and some may be paid later. Examples
the owner gave: Giving, Digital Store, MatchMyGenerosity (employer matching), Event Weaver. Every other major
feature is treated the same way.

Per `CLAUDE.md`, the owner approves before merge anything that changes money rules, permissions or RLS. Phase 1
below touches RLS (who may enable a product), and phase 3 is money.

## What already exists (reuse it, do not rebuild)

The platform already has a per-organization switch for each subsystem. See [MODULES.md](MODULES.md).

| Piece | What it gives the marketplace |
|---|---|
| `app.modules` (18 rows), `app.center_modules` | The switch itself. Off means the organization's rows are neither readable nor writable (restrictive RLS `module_switch`) and every module RPC refuses (`assert_module_enabled`). Switching off never deletes data. |
| `app.category_modules` (`default_on`, `default_off`, `not_available`) | Which kinds of organization can have a module at all. `default_off` already means "off until the organization chooses it". |
| `app.module_states`, `app.my_modules`, `app.member_experience` | What the portal and the member app read to hide what is off. A product that switches modules reaches both apps with no new plumbing. |
| Settings › Modules | A plain list of switches with a reason box. The starting point for the Marketplace screen. |
| `app.center_entitlements` (0160, `src/lib/tenancy.ts`) | **Sandbox limits** (people saved, Niva questions per month, payments mode). A different thing. |
| `ENTITLEMENT_GROUPS` (`src/lib/entitlements.ts`) | **Permission strings** for roles. A third meaning of the word. |

**Naming:** "entitlement" already means two things here, so the commercial layer uses **product** (what is offered)
and **subscription** (what an organization holds).

## What is missing

1. **The catalog is technical, not commercial.** The 18 modules are subsystems. A product has a name, a promise,
   a status and later a price, and may span several modules (Event Weaver is events, tickets, check-in, lunch and
   flyers).
2. **Most new major features do not exist yet** (B60, B63, B71 to B75 in [BACKLOG.md](BACKLOG.md)). They can be
   listed as "coming soon" before they are built.
3. **Everything is on by default** ("no row means on"). A marketplace needs "off until chosen" for new products,
   without taking anything away from communities that already use it (JSH).
4. **No price, trial or subscription state, and no billing.**
5. **No Marketplace screen** for the people who run the organization.

## Design

A **product** is a named bundle of modules. The module layer stays the enforcement, so no RLS policy or RPC guard
changes. Enabling a product switches its modules on through the same code path as `set_module_enabled`.

| Table or function | Purpose |
|---|---|
| `app.products` | `key`, `name`, `tagline`, `description`, `status` (`available`, `beta`, `coming_soon`, `retired`), `module_keys[]`, `depends_on[]` (other products), `category_keys` (which kinds of organization see it, with the existing `catalog_shows` rule), `sort`, `icon`. Platform data, written by migrations. |
| `app.center_products` | `center_id`, `product_key`, `state` (`active`, `trial`, `comped`, `requested`, `off`), `source` (`self_serve`, `granted`, `grandfathered`), `since`, `trial_ends`, `changed_by`, `reason`. Written only by the functions below. Audited. |
| `app.enable_product(center, product, reason)`, `app.disable_product(...)` | Check dependencies, the organization's kind, and (once billing exists) the subscription; then switch the product's modules. A module stays on while any enabled product includes it. |
| `app.product_states(center)` | One read for the Marketplace screen: every product the kind shows, with state, what it needs, what it unlocks, and who changed it and why. |
| `app.product_interest` | "Tell me when it is ready" for a coming-soon product: a count the owner can read. |
| `app.product_prices` (phase 2) | `product_key`, `interval`, `amount_cents` (integer cents), `currency`, provider price id. No price is set until the owner decides. |

JSH and every existing community keep exactly what they have: a migration writes a `grandfathered` row for each
product they use today, and a test compares their module states before and after (as test 79 does for categories).

## Proposed product line-up (working names; the owner confirms)

| Product | Built from | Status |
|---|---|---|
| **Giving** (pledges, campaigns, receipts, statements) | `giving` | available |
| Bolis (add-on to Giving; kinds of organization that have it) | `bolis` | available |
| **Accounting and QuickBooks** | `accounting` (needs Giving) | available |
| **Event Weaver** (events, RSVP, tickets, check-in, lunch, flyers) | `events` | available |
| **Digital Store** (B71 grows it into custom and ready-made products) | `store` | available, expanding |
| **MatchMyGenerosity** (employer matching, B63) | new module (needs Giving) | coming soon |
| **Gala and Auctions** (B74) | new module (needs Event Weaver and Giving) | coming soon |
| **Donor Playbooks** (B73) | new module (needs Giving and Communications) | coming soon |
| **Special Days and Occasions** (B72) | partly `calendar`; new | coming soon |
| **Newsletters and Messaging** (B60) | `comms` | available, expanding |
| **Website and Social** (B75, B54, B55, B57, B61) | new module | coming soon |
| **Pathshala** (B41), **Gyan Path**, **My Jain Way** | `pathshala`, `gyan_path`, `jain_way` | available (shown by kind of organization) |
| **Niva assistant** | `niva` | available |
| Membership, Volunteers, Surveys, Governance, Calendar, Content and library, Reports and dashboard | the same-named modules | available |
| Not products (always on): people and families, Setup, roles, audit, Settings | core | core |

Rule for everything built from now on: **a new major feature ships as a product** with a module key, its tables in
`app.module_tables`, guards in its RPCs, its permission keys, a flag in `member_experience`, and a Setup step.

## Phases

| Phase | What | Money | Owner approval |
|---|---|---|---|
| **1. Catalog and Marketplace** | `products`, `center_products`, grandfathering, `enable_product` and `product_states`, the Marketplace screen (Settings › Marketplace) with Enable and "Tell me when ready", the choice of products as a Setup step, connect-mobile and connect-admin reading the same states. Everything free. | none | RLS on the new tables and who may enable |
| **2. Ready for paid** | `product_prices`, trial and comped states, a "Request" flow for a paid product that the Weaver team approves by hand, and a price shown on the card. Still no charge. | none | the pricing model |
| **3. Billing** | Weaver's own subscriptions (separate from the Stripe Connect account that receives a community's gifts): invoices, receipts, failed payments. Lapse rule: read-only for a grace period, then hidden, never deleted. | yes | all of it |

## Questions for the owner (recommended answers first)

| # | Question | Recommendation |
|---|---|---|
| M1 | Who enables a free product? | Anyone with `settings.manage` in the organization, with a reason, audited. A paid product is "Request" until phase 3. |
| M2 | Existing communities? | Everything they use today stays on and shows "Included" (grandfathered). Nothing disappears. |
| M3 | What is on for a new organization? | A starter set per kind of organization, chosen in Setup (a new first step, "Choose your products"). The rest stay off until chosen. |
| M4 | Which products become paid, and how (per product, per tier, by usage)? | Decide later. Build the fields, set no price. Likely candidates: Accounting and QuickBooks, Niva, texting and WhatsApp (carrier cost), Gala and Auctions, Website and Social. |
| M5 | One naming scheme? The examples mix plain names (Giving, Digital Store) with brand names (MatchMyGenerosity, Event Weaver). | Pick one rule, then apply it to the website, Setup and the member app. A plain name plus a short brand line works for both. |
| M6 | Should the coming-soon products show in the Marketplace? | Yes, with "Tell me when it is ready", so demand is counted before building. |
| M7 | Does the public website's product list come from the same catalog? | Yes: one source, so the homepage and the Marketplace never disagree. |
| M8 | Settings › Modules? | Keep it for platform admins as the low-level view; owners use the Marketplace. |
| M9 | A lapsed subscription? | Read-only for 30 days, then hidden; data is never deleted (the existing module rule). |
