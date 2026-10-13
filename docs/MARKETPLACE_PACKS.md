# Marketplace packs: iWeaver, WeaverSite, CommunityConnect (plan)

Status: plan, 2026-10-13. Slice 1 built (migrations 0750 to 0753: the module rows, grandfathering, the catalog, requests;
Settings › Marketplace and Platform › Communities › Products follow). Backlog **B104**. Owner direction, 2026-10-13: move Niva, AI flyer art and
every other AI feature (except AI used in onboarding) into an **iWeaver** pack; move the integrated website into
**WeaverSite** (working name, to be renamed); put Facebook and Instagram for events and WhatsApp for messages into
**CommunityConnect**. With WeCare ([`WECARE.md`](WECARE.md)) and CatchTheMatch ([`CATCH_THE_MATCH.md`](CATCH_THE_MATCH.md))
that makes five Marketplace products. Built for every organization Weaver onboards. It extends
[`MARKETPLACE_PLAN.md`](MARKETPLACE_PLAN.md) and does not replace it.

## 1. Rules for all five products (owner, 2026-10-13)

| # | Rule |
|---|---|
| P1 | A **platform admin** turns each product on or off per community, with a reason and a **fresh 2FA** check, audited. This is the module grant of 0740 (`app.set_module_grant`, `app.center_module_grants`), already built. |
| P2 | The community's own admin may pause or resume a product that has been granted (the existing 0740 rule), never grant one. |
| P3 | Each product is a subscription in the Marketplace. Until Marketplace phases 2 and 3 exist (prices, billing), its card says **Request** and Weaver grants by hand. Only CatchTheMatch has a price (10% of each match, capped at $500). |
| P4 | Lapse: read-only for 30 days, then hidden. Data is never deleted (Marketplace M9). |
| P5 | **Off for every kind of organization by default.** A new module key gets `default_on` for Jain centers automatically ([0594](../supabase/migrations/0594_organization_categories.sql), `modules_seed_category_rows`), so each pack's migration must set `default_off` for every kind, with a test. |
| P6 | **A module key never changes; the label does.** Installed member apps ignore keys they do not know and treat a known key that disappears as on (0741 header). So the packs get plain, neutral keys and brand labels, and the existing `comms`, `events` and `niva` keys are neither renamed nor split. |

Proposed keys (labels are data and can change at any time):

| Product (label) | Module key | Depends on |
|---|---|---|
| iWeaver | `ai` | nothing |
| WeaverSite | `website` | People |
| CommunityConnect | `channels` | Communications (`comms`); the Facebook and Instagram part also uses Events |
| WeCare | `care` (was `wecare` in the plan; permissions become `care.view`, `care.own`, `care.manage`) | People |
| CatchTheMatch | `matching` (was `catch_the_match`) | Giving |

## 2. iWeaver (`ai`)

Every AI call Weaver makes today, found 2026-10-13 (all use Weaver's own platform keys, set in Platform > Setup;
nothing uses a community's own key):

| Feature | Today's switch | Goes to |
|---|---|---|
| Ask Niva in the member app (`app.niva_ask`, worker `niva.answer`) | `niva` module | **iWeaver** |
| Niva staff test, regenerate, retry unanswered (`/content/niva`) | `niva` module | **iWeaver** |
| Niva for admins, the portal chat (`/api/assistant/chat`) | `rules.assistant.enabled` + `niva` | **iWeaver** |
| AI flyer art (Gemini, `events.generate_flyer`) | `events` only | **iWeaver** (flyer templates whose words are set by code stay in Events) |
| Import column-mapping suggestions (`import.suggest_mapping`) | import permission only | **Stays core**: used in onboarding (Setup step 10) |
| QuickBooks donor-match suggestions (`qbo.match_suggest_ai`) | `accounting` | **Stays core**: used when QuickBooks history is brought in at onboarding |
| Provider Test buttons (Platform > Setup) | platform admin | Unchanged: platform only, not a community feature |
| Every AI feature built from now on (WeCare drafts, CommunityConnect post drafts, event-creation help, the org agent) | | **iWeaver**, plus its own product where there is one (for example WeCare AI needs both `care` and `ai`) |

How the gate works:

1. **Niva sits behind iWeaver by dependency**: `niva.depends_on` becomes `{content, ai}`. `app.module_enabled` already
   walks the chain (0740 `_module_chain`), so with `ai` off, `niva` reads off everywhere: RLS, RPC guards,
   `my_modules` and `member_experience`. Installed member apps hide Niva with **no app release**.
2. **One check where AI jobs run.** Every worker AI job goes through `processJob` (worker `runner.ts`). An "AI job
   kinds" list (including `events.generate_flyer`, which is missing from today's `ANTHROPIC_KINDS`) is checked there
   against `module_enabled(center, 'ai')`. That also stops a queued Niva retry from running after Niva is switched
   off, which happens today: the answer job does not check the module again when it runs.
3. **The request functions refuse early** with a plain message (`app.niva_ask`, `app.events_request_flyer_art`):
   "AI features are part of iWeaver, which is not on for your community."
4. **Admin chat** gets the same check in `authorizeAssistant` (the portal calls the provider directly).
5. **The portal** hides or disables AI buttons when `ai` is off and says why, with the Marketplace card one tap
   away. It never shows a silent failure (CLAUDE.md error rule).
6. Monthly limits stay as they are (`niva.monthly_questions`, `assistant.monthly_actions`) and can become the pack's
   tiers later. AI costs Weaver real money per use on its own keys, which is why this is a paid pack.

## 3. WeaverSite (`website`)

| Piece | Status today | Goes to |
|---|---|---|
| Crawl of the organization's current site and up to 3 sites it likes (0640/0641, `site.crawl`) | built, Setup | **Stays core**: it teaches the organization's agent at onboarding |
| Site model, first draft and private preview (0642/0643, `/setup/website`) | built, private, no module key | **WeaverSite** (`app.module_tables` gets `website` for `sites`, `site_pages`, `site_blocks`) |
| Publishing, public pages, menus, editor roles, donate page, news (B55, B61, B75) | planned | **WeaverSite** |
| The organization's own domain on its site | planned (`center_domains` today holds portal addresses only) | **WeaverSite**, with the TLS care below |
| Guest event page `/e/<id>`, the public KPI page `/c/<slug>`, the member web app at `<short>.weaverams.org` | built | **Stay where they are** (Events, Reports, the member app): they are not the website |
| Weaver's own marketing site (`www.`, `src/app/site`) | built | Not a product; unchanged |

**Custom domains and TLS:** the 2026-10-08 HTTPS outage came from a wildcard member-address block. WeaverSite
domains must be added one by one through the existing on-demand TLS check (`/api/tenancy/tls-ask`), never with a
wildcard, `MEMBER_BASE_DOMAIN` or a DNS `*`.

## 4. CommunityConnect (`channels`)

| Piece | Status today | Goes to |
|---|---|---|
| WhatsApp messages through the Business API (Twilio `whatsapp:` sending, `whatsapp_accounts`, `whatsapp_template_submissions`, Settings > WhatsApp) | built, sends only once Meta approved the account (recorded by hand) | **CommunityConnect**: those tables move to `channels` in `module_tables`; the send path asserts `channels` for the WhatsApp channel as well as `comms` (0221) |
| WhatsApp group links and the join queue (staff add members by hand; member app guide and onboarding screens) | built, `comms` | **Stays in Communications**: no integration, and moving it would leave installed apps showing an empty screen |
| Email, SMS, push | built | Stay core / Communications |
| Facebook Page and Instagram posting for events (the "Coming next" rows in the event publish box) | **not built**: no Meta connection, no tokens | **CommunityConnect** |

Facebook and Instagram, what it takes:

- A Meta connection per community: a new `integration_connections.provider` value, an exchanger in the existing
  `oauth.exchange` skeleton (built for Stripe, PayPal and Intuit), page and account tokens in the vault.
- **Meta app review and business verification are the owner's to do** (accounts and secrets stay with the owner).
  They take time, so they start before the build ends.
- What gets posted: the event's flyer and text with its link, to the community's Facebook Page and its Instagram
  professional account, now or at the scheduled time (`events.publish_at` already exists). As far as is known,
  Meta's API does not let apps create Facebook **Events**; this is confirmed during app review.
- WhatsApp Business messages cost money per conversation (Meta pricing), and that cost belongs in the pack's price.

## 5. Moving features without taking them away

- **Grandfathering by use.** The migration grants a pack, with the reason "grandfathered", to every community that
  uses its features today: iWeaver where Niva is on or flyer art was made in the last 90 days; CommunityConnect where
  a WhatsApp account is recorded; WeaverSite where a site draft exists. A test compares each community's effective
  modules before and after (as test 79 does for categories and 0740 for grants).
- **Sandbox communities** (prospects trying Weaver) get iWeaver on as a trial, within the existing sandbox limits.
- New communities start with every pack off until a platform admin grants it (P1, P5).

## 6. Build order

Each slice ships on its own; migration and test numbers are reserved when a slice is approved.

| Slice | What | Size | Owner OK |
|---|---|---|---|
| 1 | Module rows `ai`, `website`, `channels` (default off for every kind), labels, `niva` depends on `ai`, `module_tables` moves, grandfather grants, the before/after test | M | **Yes: modules and RLS; switches features off where not grandfathered** |
| 2 | The AI gate: worker `processJob` check and AI job kinds list, request functions, `authorizeAssistant`; portal buttons and messages | M | No new rule (enforces slice 1) |
| 3 | Platform > Communities shows the five products with their grant switches; a Marketplace card for each ("Request") | S to M | No |
| 4 | WeaverSite build-out: publishing, public pages, menus, roles, domains (B55, B61, B75) | L, several PRs | Domains and public reads |
| 5 | CommunityConnect Meta: connection, posting from the publish box, scheduling, status back on the event | L | **Yes: outside service, tokens**; Meta review first (owner) |
| 6 | CommunityConnect WhatsApp: Business account sign-up flow instead of status recorded by hand | M | Messaging cost |

## 7. Owner answers (2026-10-13: every recommendation approved)

1. **Neutral keys** (`ai`, `website`, `channels`, `care`, `matching`) with brand labels, so renaming a product never
   breaks an installed app. **Approved.**
2. **Grandfathering by use** and **iWeaver on for sandboxes** (section 5). **Approved.**
3. **WhatsApp group links stay in Communications**; only Business API messaging moves. **Approved.**
4. **The website crawl stays core** (it teaches the agent at onboarding); building and publishing the site is
   WeaverSite. **Approved.**
