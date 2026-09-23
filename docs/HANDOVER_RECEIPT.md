# Handover receipt — JSH platform (claude.ai → Claude Code)

| | |
|---|---|
| Received | 2026-09-23, in the Claude Code build session |
| Archive | `jsh-platform-handoff.zip` — 594,301 bytes, sha256 `3757096bb6f8f298e3882f04bd6817611b2a07e470f4d107d66fd9af84982322` |
| Contents | 28 files: `CLAUDE.md`, `README.md`, `docs/project-memory.md`, 7 prototype sources + format guide + canvas + runtime + 2 logos, and the 6-screen deployable site (+ index, manifest, runtime, 4 images) |
| Read | **All 28 files, in full** (text files line by line; prototypes diffed against the design-canvas copies the build already used) |
| Stored | Verbatim under [`docs/handoff/`](handoff/) — `HANDOFF_CLAUDE.md` (the kit's CLAUDE.md, renamed so it is not auto-loaded as instructions for this repo), `README.md`, `project-memory.md`, `prototypes/source/`, `prototypes/site/` |
| Design doc | All 9 tabs of *JSH Platform · Recommendations and Roadmap* exported to [`docs/design-doc/`](design-doc/) as the kit's README asks |
| Builds on it | connect-crm (this repo, owns the database), connect-admin, connect-mobile |

**Legend** — ✅ enforced in the database and covered by tests (`supabase/tests/`, 156 checks) ·
📱 member app (connect-mobile) · 🖥 admin console (connect-admin) · 🗂 CRM console (connect-crm) ·
⚙️ needs a background worker / edge function (not built yet) · 📄 recorded in docs ·
❓ needs a decision · ⏸ parked by JSH.

---

## 1. File manifest

| sha256 (16) | bytes | file | where it lives now | notes |
|---|---:|---|---|---|
| a0e2e52baece6e55 | 5,367 | `CLAUDE.md` | `docs/handoff/HANDOFF_CLAUDE.md` | Context + key decisions + conventions; merged into repo CLAUDE.md files (§6) |
| c9d308c3edb76c87 | 808 | `README.md` | `docs/handoff/README.md` | Setup, Netlify deploy, export instructions (§5) |
| 5e95100c0317ebb7 | 6,134 | `docs/project-memory.md` | `docs/handoff/project-memory.md` | **Memory file** — every line receipted in §2 |
| 1dc0228080127f0c | 174,026 | `prototypes/source/AdminPortal.dc.html` | `docs/handoff/prototypes/source/` | Identical to canvas copy except logo path |
| 0ae59d64c8a2e886 | 20,480 | `prototypes/source/CommunityDashboard.dc.html` | 〃 | Identical except logo path |
| e62d4a4679078547 | 10,973 | `prototypes/source/DC-FORMAT.md` | 〃 | Prototype format rules (for editing prototypes, not the product) |
| 963f94b76418b2a9 | 30,282 | `prototypes/source/GyanPath.dc.html` | 〃 | Byte-identical to canvas copy |
| 2da690adefd03830 | 266,953 | `prototypes/source/Main.dc.html` | 〃 | Identical except 8 logo paths |
| 4fe71e6eb1cac97b | 23,997 | `prototypes/source/Onboarding.dc.html` | 〃 | Identical except logo path |
| 7e12afff419a6d3e | 9,023 | `prototypes/source/Volunteer.dc.html` | 〃 | Byte-identical; marked deprecated in the kit (→ §4, ops) |
| a80c7ef4d65d0a5f | 35,607 | `prototypes/source/Welcome.dc.html` | 〃 | Byte-identical |
| aa0633db254434e9 | 1,721 | `prototypes/source/canvas.json` | 〃 | Byte-identical |
| 82ab863dabf94f79 | 185,864 | `prototypes/source/support.js` | 〃 | Prototype runtime (bundles React 18); same file in `site/` |
| 514ae4eb38bd9231 / a0340e44d0c08530 | 42,281 / 31,660 | `prototypes/source/assets/jsh-logo.png`, `jsh-mark.png` | 〃 | Brand assets — reused for app icons |
| 6587354b20b87bf5 … 6363b457993cafd3 | — | `prototypes/site/*.dc.html` (6) | `docs/handoff/prototypes/site/` | = source + viewport/PWA `<head>` + "All prototypes" link |
| 04325ec0ad5a6fdb / 0d823b05412f8f64 | 2,675 / 396 | `prototypes/site/index.html`, `manifest.json` | 〃 | Prototype hub page + PWA manifest |
| dc937287a798180e / 9d5da99377805ca4 | 23,060 / 26,260 | `prototypes/site/assets/icon-192.png`, `icon-512.png` | 〃 | PWA icons |

Prototype reconciliation: the build agents worked from the live design canvas
(`claude.ai/artifact/PL6zCn4kgCbzC6tKW6oXed`). After normalizing logo references, all 7
sources are **content-identical** to the handoff — nothing in the kit was missed by the build.

## 2. Memory receipt — `project-memory.md`, every line

### Goal and decisions

| # | Memory item | Carried into | Status |
|---|---|---|---|
| 1 | Consolidate member functions; retire JSH Connect, NamoCRM RSVP, JSH Events | Three repos; legacy QR codes accepted at check-in during the transition (`app.person_from_scan`, `app.check_in`); retirement at T+30 in [rollout plan](design-doc/06-center-onboarding-and-rollout.md) | ✅ 📱 🖥 |
| 2 | Handover documents + technology roadmap | `docs/ARCHITECTURE.md`, `DECISIONS.md`, `ROLES.md`, `design-doc/`, this receipt | 📄 |
| 3 | Alert members to donation opportunities; pay in-app | `campaigns`, `opportunities`, `messages` (topic `giving`); Give tab | ✅ 📱 · in-app card payment ⚙️ (Stripe edge function) |
| 4 | RSVP commitment $3/$5/$7 per person or $10/$25/$50/open lump sum → household pledge | `events.commitment_options` default, `rsvps.commitment_pledge_id`, pledge source `rsvp_commitment` | ✅ 📱 |
| 5 | Household pledge history (open + closed) for adults; children no RSVP / boli | RLS `pledges_household` (adults only), `rsvps_household_write`, `app.place_boli_entry` adult check | ✅ tested |
| 6 | Digital bolis (floor + cutoff) and in-person bolis, explainer video; **"pledge", never "bid"** | `bolis`, `boli_entries`, `app.place_boli_entry` (floor, step, soft close, outbid notice), `app.close_boli` (first recorded wins), `explainer_md/_video_url`; in-person entries by recorder; wording rule given to every app | ✅ tested 📱 🖥 |
| 7 | Pachchakhan library; My Jain Way practices, reminders, points, category percentiles, streaks; Jain Way tab (Today/Learn/Saathi/Library) | 9 pachchakhan `content_items`, 10 `practices`, `app.log_practice` (points once/day, +20 day bonus, streak), `points_ledger` append-only | ✅ tested 📱 · reminders + nightly percentiles ⚙️ |
| 8 | JSH Niva AI assistant from approved content | `content_items` kind `niva_source`, `niva_conversations` (30-day retention); flag off | 📱 placeholder · retrieval + model ⚙️ |
| 9 | Onboarding: each member's name, age, gender, profession, contact prefs, emails; digital-only vs physical mail; directory + photo opt-in | `people` fields, `households.physical_mail_opt_in` / `directory_opt_in`, `people.photo_opt_in`, `consents`, `notification_preferences`, `channel_optins`; `app.find_my_family` / `link_account` / `create_my_household` | ✅ tested 📱 |
| 10 | 24-hour RSVP confirmation reminder; per-person prefs editable | `events.confirmation_hours_before`, `rsvps.confirmed_at`, per-person `notification_preferences` | ✅ 📱 · reminder sender ⚙️ |
| 11 | Satvik Store make-to-order $6.99–$9.99; gift packing $2.99; full inventory | `store_items`, `pickup_windows`, `store_orders` (+ numbering), `rules.store.gift_pack_cents = 299`, `inventory_movements`; seed menu within range | ✅ 📱 🖥 · sales-tax calc ⚙️ |
| 12 | Opportunities: Swamivatsalya Platinum/Gold/Silver; Diwali pujans fixed bolis (multi-select); construction $10K/$25K/$50K/open | `opportunities` (fixed amount, quantity taken, open amount) under a `campaign` | ✅ 📱 🖥 · JSH's live campaigns entered by admins, not seeded |
| 13 | New to JSH guide: WhatsApp, timings, zones + leads, volunteer interest, roster, membership, registrations, ask a question | `guide_sections`, 7 zones with ZIPs, `whatsapp_groups` + join queue, `volunteer_groups`, `role_roster`, `membership_types`, `inboxes`/`threads` | ✅ 📱 🖥 |
| 14 | Calendar layers: tithi, Pathshala, events, Houston ISD | `calendar_layers` (Jain tithi, Pathshala, events, Katy/Fort Bend/Cy-Fair/Houston ISD), `tithi_days`, `daily_timings` | ✅ 📱 · ISD feed sync + panchang import ⚙️ |
| 15 | Profile: open to contact from members who joined in the last year; advertise expertise | `people.new_member_contact_opt_in`, `expertise_*`, `app.directory` view (verified, opted-in only) | ✅ 📱 |
| 16 | Special days with labh prompt 2 weeks before; recurring giving | `special_days` (household-private), `labh_options`, `recurring_gifts` (frequency `special_day`) | ✅ 📱 · prompt sender ⚙️ |
| 17 | Lunch slots: child under 12 or senior → lunch start; others by arrival then RSVP; missed → any later slot; reminder 5 min | `app.assign_lunch_for_rsvp` (tested), `app.move_lunch_slot` (later-only, capacity, household adult or volunteer — tested), reminders queued in `messages` | ✅ tested 📱 🖥 · push delivery ⚙️ |
| 18 | Gyan Path: gamified paths (Samayik, Pratikraman, Logassa, Navkar), levels, stars, teacher sign-off | 4 goals / 46 levels seeded, `gyan_steps`, `gyan_progress` (0–3 stars), `gyan_signoffs` | ✅ 📱 🖥 · lesson/quiz content from Pathshala ❓ |
| 19 | Saathi: celebrations, anumodana points; cheerers asked to help first | `anumodana`, `app.send_anumodana` (+5 / +3, daily cap), family-circle only | ✅ 📱 · "ask cheerers first" notification ⚙️ |
| 20 | Event feedback surveys, anonymous option, admin aggregation, feedback-request notification | `surveys` (`kind = event_feedback`, `event_id`, `anonymous`), `survey_responses` | ✅ 📱 🖥 · request notification ⚙️ |
| 21 | Public community dashboard, aggregated KPIs, no login | `app.public_kpis` (anon, groups < 10 suppressed) | ✅ · public page not yet assigned — proposed as a public route in connect-admin |
| 22 | White-label, multi-tenant for any Jain center | `centers` (branding, flags, rules), `center_id` + RLS everywhere; cross-center isolation tested | ✅ tested |
| 23 | Replaces Neon One; migration from any system with years of history | Identifier registry (`external_ids`, person + household org IDs, Neon, NamoCRM, QuickBooks, bank payers), `import_runs` | ✅ · importer ⚙️ (needs a Neon export sample ❓) |
| 24 | QuickBooks Online is the accounting record; push everything; cash basis | `ledger_postings` (idempotent), `qbo_account_mappings`, `accounting_periods`, `payouts`; `rules.accounting.basis = cash` | ✅ tested 🗂 · QuickBooks poster ⚙️ |
| 25 | Pay-now gifts: create pledge, record donation, close pledge | Pledge + payment + allocation closes it (`app.allocate_payment`) | ✅ tested · card capture ⚙️ |
| 26 | Allocation: earliest open pledge first unless specific invoice; overpay → next; partial keeps open; preview with override; shown on receipts | `app.allocate_payment(payment, pledge_ids?, apply)` preview + override; allocations stored per payment | ✅ tested 🗂 · receipt PDF ⚙️ |
| 27 | DAF and matching gifts matched manually by treasury | `known_originators`, bank lines flagged, `confirm_bank_match` records method `daf` / `matching_gift`, DAF names never learned as family payer | ✅ tested 🗂 |
| 28 | Card, ACH, Apple/Google Pay, checks, stock, offline cash/check; donor may cover fees | `payment_method` enum (+ Zelle), `donor_covered_fee_cents`, `rules.fees.ask_donor_to_cover` | ✅ · processing ⚙️ |
| 29 | Receipts: standard format, payer's name default, joint option | `payments.receipt_number` (JSH-R-…), `receipt_name`, `joint_receipt`, `statements` | ✅ · PDF rendering ⚙️ |
| 30 | Membership: community by default; yearly/life need a verified reference at same tier or higher, then center approval; configurable | `membership_types` (reference tier, EC approval), `membership_applications`, `app.my_reference_requests`, `app.decide_reference`; EC role approves life | ✅ 🗂 📱 |
| 31 | Child login age configurable; shared login with a child → one-time code for every financial transaction | `rules.child_login_age = 13` | ✅ config · **step-up code on money actions ⚙️ (auth hook) — not built** |
| 32 | Adult children can stay in a household and be primary of their own | `household_members` many-to-many with `is_primary` | ✅ |
| 33 | Events: waitlists, eligibility (life members only, Pathshala families) | `events.waitlist_enabled`, `eligibility`, `audience`, RSVP status `waitlisted` | ✅ schema 🖥 📱 · **eligibility not enforced in the DB yet** |
| 34 | Anonymous donor recognition; sales tax by center's state | `pledges.anonymous`, `boli_entries.anonymous`; `centers.state_region` | ✅ · tax calc ⚙️ |
| 35 | Granular entitlements, default roles; super-admin, treasurer and EC edit people-level data | 29 roles, permission strings, 357 policies; treasurer + `executive_committee` have `people.manage` | ✅ tested |
| 36 | Volunteers sign the center's waiver in the member app; versioned waivers; background checks for work with children; no 1:1 adult-to-minor messaging | `legal_documents` (versioned, yearly re-sign), `consents`, `volunteer_assignments.waiver_consent_id`, `background_checks` (expiry); messaging is member → role inbox only | ✅ 📱 🖥 · **"block assignment until waiver + check are current" not enforced in the DB yet** |
| 37 | Tap-to-pay; two-person envelopes for cash/checks; bhandar two-person counting; valuables register | `payments.envelope_number`, `counted_by[]`, `counting_sessions` (≥2 counters from different households — tested), `valuables_register` | ✅ tested · tap-to-pay ⚙️ |
| 38 | Full Pathshala domain; start 10DLC + WhatsApp Business early; event-day resilience; mobile-only sign-in with in-person recovery | Pathshala tables (terms → attendance → progress → sign-offs), `channel_optins`; offline check-in queue 🖥; phone OTP sign-in 📱 | ✅ 🖥 📱 · 10DLC/WhatsApp registration ❓ (JSH) · printed recovery code ⚙️ |
| 39 | Backup, governance and auditability in every domain | Hash-chained append-only `audit_log`, audit triggers on 30 tables, data classes in docs | ✅ tested · retention jobs ⚙️ · PITR = Supabase project setting |
| 40 | Deletion: app data deleted; financial records 7 years then anonymized; household stays; audit kept | `data_requests` (30-day due), `accounts.status` | ✅ schema · deletion/anonymization job ⚙️ |
| 41 | Parked: identity across centers, money-approval thresholds, platform ownership entity | `DECISIONS.md` open list | ⏸ |
| 42 | Launch target: Wave 1 within 2 months | — | 📄 |

### Legacy systems

| # | Legacy fact | How the build handles it | Status |
|---|---|---|---|
| 43 | Neon One: family tree, donations, registrations, comms; syncs to QuickBooks; life/yearly (spouse in life, kids roll off at 18); membership required for Pathshala; yearly maintenance fee; member portal with PayPal | Households + memberships; `pathshala_terms.membership_required`; Neon IDs in the registry; one-poster rule for QuickBooks (design doc tab 07) | ✅ · maintenance-fee billing cycle ❓ · kids-roll-off job ⚙️ |
| 44 | JSH Connect: email OTP, family QR tied to **Neon member IDs**, live darshan (RTSP.ME), voice lessons, voting banner, PayPal pledges, suggestion box, albums (Linktree) | OTP sign-in; **old family QR accepted at check-in** (`legacy_neon`); `content_items` kind `darshan_stream`; audio lessons in Gyan Path; `eligibility_snapshots`; `concerns` / `threads`; `photo_albums.external_url` | ✅ tested 📱 |
| 45 | NamoCRM RSVP: phone lookup, masked family list, flags (child <12, senior, assistance), SMS/WhatsApp consent, per-attendee email QR; **`contact_id_<n>` differs from JSH Connect IDs** | Attendee flags; one ticket token per attendee; consents; **`contact_id_<n>` accepted at check-in** (`legacy_namocrm`); NamoCRM IDs in the registry; masked family list → guest web pages ⚙️ | ✅ tested 🖥 |
| 46 | JSH Events Android: volunteer key/QR login, QR or external scanner, phone lookup, walk-ins, food + gift stations, kiosk | connect-admin `/ops/[event]/checkin`: stations, camera + keyboard-wedge scanner, masked phone lookup (`app.checkin_lookup_phone`), walk-ins, kiosk, offline queue; time-bound `checkin_volunteer` grants | ✅ 🖥 built |

## 3. `CLAUDE.md` (kit) — decisions and conventions

| Item | Where | Status |
|---|---|---|
| Member app, admin portal, ops app, public dashboard | 📱 connect-mobile · 🗂 connect-crm + 🖥 connect-admin (the kit's single admin portal is split along the user's three-project brief: records & money vs operations) · ops routes inside connect-admin · dashboard §2 #21 | 📄 |
| Admin portal modules: People, Events, Giving, Bolis, Store, Pathshala, Content, Calendar, Communications, Accounting, Reports, Settings, Platform | People / Giving / Accounting / Reports / Settings → 🗂; Events / Bolis / Store / Pathshala / Content / Calendar / Communications → 🖥; Platform (super-admin) → not yet built ⚙️ | — |
| Mock API enforced entitlements (403) and the two-person rule (409) | RLS (403-equivalent) everywhere; two-person rule DB-enforced for refunds, write-offs, eligibility overrides, all-member sends (`app.enforce_two_person`, `app.approve_as_second` — tested) | ✅ tested |
| Terms: household, pledge, payment, boli, labh, campaign, fund | Table and column names; "pledge, never bid" instructed to every app | ✅ |
| Brand: navy #1B2C5C, ivory #FBF7F0, saffron #C9731C; Fraunces / DM Sans | `centers.branding` (JSH), design tokens in `ARCHITECTURE.md`, all three apps | ✅ |
| Never hard-code JSH specifics | JSH lives in `seed.sql` as tenant #1 (`centers.rules`, zones, types, funds…) | ✅ |
| Next steps 1–3 (export doc tabs; product spec + tenant config schema; scaffold with center ID + RLS) | `docs/design-doc/`; `centers.rules` schema + `FEATURE_TRACEABILITY.md`; three repos scaffolded and building | ✅ |

## 4. Features — prototype screen → where it is built

| Prototype | Screens / features | Build | Status |
|---|---|---|---|
| `Main.dc.html` (member app) | Home (Today, darshan, My Jain Way, feedback, lunch, labh, confirm, store, opportunity, events, guide), Events (upcoming, calendar layers, photos, RSVP, tickets, confirm, feedback), Give (bolis, in-person, opportunities, pledges, recurring, labh, statements), Jain Way (Today, Learn, Saathi, Library, pachchakhan), Family (members, profile, special days, voting, member card), Store + cart, Niva, Settings, legal, child lock, notifications | 📱 connect-mobile — see its `docs/PROTOTYPE_SPEC.md` | in build |
| `Onboarding.dc.html` | Email/mobile OTP, family match, "not my family", about you, family review, contact prefs, documents & mail (required) | 📱 | in build |
| `Welcome.dc.html` | New to JSH guide (9 sections) | 📱 | in build |
| `GyanPath.dc.html` | Goals, map, lessons (learn / quiz / recite), stars, treasure, teacher sign-off | 📱 (+ 🖥 sign-offs) | in build |
| `CommunityDashboard.dc.html` | Public KPIs, 8 endpoints, k-anonymity | ✅ `app.public_kpis` · page not built | partial |
| `AdminPortal.dc.html` | Personas, entitlements, every module, audit log | 🗂 connect-crm (19 routes) + 🖥 connect-admin (45 routes) | **built** — lint, typecheck, 85 + 50 unit tests, production builds pass; CRM also exercised against a local PostgREST + headless browser |
| `Volunteer.dc.html` (deprecated in kit) | Stations, scan, walk-in, family confirm | 🖥 `/ops/[event]/checkin` (camera + keyboard-wedge scanner, legacy QR, kiosk, offline queue) | **built** |

The **member-app ↔ admin coverage** table (54 features, 50 covered, 4 partial) is exported at
[`design-doc/09-member-app-to-admin-coverage.md`](design-doc/09-member-app-to-admin-coverage.md);
the 4 partials (tickets/QR/Wallet reissue, Pathshala enrollment admin, volunteer waivers,
secondary admin actions) are in the build scope of 🖥 / 🗂.

## 5. Things in the kit that need you

| Item | Why it is open | Action |
|---|---|---|
| Original claude.ai conversation | Cannot be exported from here — it needs your claude.ai account | claude.ai › Settings › Privacy › Export data; drop the JSH conversation JSON into `docs/handoff/conversation/` |
| Netlify prototype deploy (site `c2f043f9-…`, project `jsh-prototypes`) | Outward-facing; not done without your go-ahead | Say the word and I will deploy `docs/handoff/prototypes/site` |
| Open decisions | Listed with owners in [`DECISIONS.md`](DECISIONS.md) | Treasurer / EC / Pathshala principal |

## 6. Warm start for the next session

- Each repo's `CLAUDE.md` ("Handover and memory" section) points to: this receipt, `docs/handoff/project-memory.md` (the
  memory), `DECISIONS.md`, `ARCHITECTURE.md`, `ROLES.md`, and the design-doc export.
- Decisions made after the handoff (Sep 23): three repos under `malavsanghvi`; Expo + Next.js
  + Supabase; identifier registry (Connect number + org person ID + org household ID + legacy
  Neon/NamoCRM + QuickBooks + bank payer names); JSH IDs 4-digit with leading zeros; Chase as
  the bank with Zelle reconciliation and batch deposits; names never matched alone.
- Workers not yet built (⚙️ above) are the next build wave: payments (Stripe Connect),
  QuickBooks poster, notification dispatcher (push / SMS / WhatsApp / email + reminders),
  Neon importer, nightly jobs (eligibility, percentiles, retention, kids turning 18).
