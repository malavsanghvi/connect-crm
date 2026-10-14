# 06 - Platform console (Weaver team) - UX audit

Read-only audit, 2026-10-09. Area: `src/app/(app)/platform/` (14 `page.tsx` screens, plus `actions.ts`, `onboarding-actions.ts`, and each screen's own `actions.ts`).
Persona: the Weaver platform team (`accounts.is_platform_admin`), NOT a community's own admin. A handful of people; high stakes, low volume; every write is audited with a reason.

Screens covered (14): Centers `/platform`, Center detail `/platform/centers/[id]`, New sandbox, New center (legacy wizard), Requests, Sandbox codes, Onboarding pipeline, Go-live approvals, Verification, Support access, Payments (pauses), HTTPS, Agreements, Platform setup.

Docs read: CLAUDE.md, ARCHITECTURE, ROLES, MODULES, MARKETPLACE_PLAN, KIND_OF_ORGANIZATION_PORTAL, ONBOARDING_PLAN (sections 2, 3, 6). Marketplace is NOT built anywhere (no `products`, `center_products`, `product_interest` in `src/` or `supabase/migrations/`), so every Marketplace point below is a design requirement for the console, not a change to existing code.

---

## A. How the console works today (one paragraph)

Twelve flat nav tabs (`src/lib/permissions.ts:574-596`: Centers, Platform setup, New sandbox, Verification, Requests, Sandbox codes, Onboarding, Go-live approvals, Support access, Agreements, HTTPS, Payments), in the order they were built (waves), not the order work flows. Each tab is a table of one object type (`.crm-table`), a "Review/Manage/Open" button that opens a right-hand drawer (`_components/drawer-button.tsx`, `verification/review-button.tsx`), and a form inside the drawer that calls a Server Action, which calls one Postgres RPC. The organization (the real "thing" the team manages) is split across seven tables (`centers`, `access_requests`, `sandbox_codes`, `golive_requests`, `org_profiles`/`org_documents`, `support_grants`, `center_entitlements`) and each tab shows one slice, with the org name as plain, non-clickable text.

## B. Cross-cutting friction (applies to most screens)

1. **No single "organization" view.** The same org appears on Requests, Codes, Pipeline, Verification, Go-live, Support access and Centers as unlinked text. The only link to a per-org page is the cryptic "Limits & addresses" on the Centers row (`platform/page.tsx:125`); an org still in `onboarding` links its name to the legacy wizard instead (`:104-108`). Nothing links request -> code -> sandbox -> verification -> go-live. To answer "where is Riverside Chamber?" a person visits up to six tabs and matches by name (`codes/page.tsx:41-50` itself joins request id to org name by hand).
2. **No inbox, no "needs me" view.** There is no landing page that says what is waiting. The home is the Centers table (`platform/page.tsx`). Waiting work is split across Requests ("To review" chip), Verification (status text), Go-live (Review button), Setup reminder banner. The Pipeline KPI strip (`pipeline/page.tsx:40-45`) is the only counter, and it is not a queue.
3. **Almost every screen's heading is "Platform".** `PageHeader title="Platform"` on 12 of the 14 screens (Platform setup says "Platform setup"; Center detail uses the org name); the screen's real name lives in a grey description sentence. Only the browser-tab `<title>` differs. Hard to orient, bad for screen readers.
4. **Lists have no search, sort, filter or paging.** Hard caps with no "showing first N" notice: requests 200 (`requests/page.tsx:50`), codes 300 (`codes/page.tsx:31`), go-live 100 (`go-live/page.tsx:29`), support grants 200 (`support-access/page.tsx:25`). Only Requests has status chips.
5. **Two-person and self-review rules surface late.** Go-live disables "Approve" when you are the first approver (`go-live/page.tsx:102`), but not when you requested it (the DB refuses: "You requested this go-live"). Verification does not pre-warn that you cannot review an org you submitted (`decide_org_verification` raises it after the click). Errors are plain English and shown next to the action (good), but the person learns the rule by hitting it.
6. **Jargon and vocabulary drift.** "Center / community / organization / sandbox / experience / kind", "entitlement / limit", "readiness check / go-live check". Brand drift: "Community Connect" is still in `payments/*` copy, in database error text (`approve_golive`: "Only the Community Connect team approves go-live."), and in placeholders (`crm.communityconnect.app`) while the product is Weaver (ARCHITECTURE, 2026-10-08).
7. **Silent partial failures.** Where a secondary lookup fails, some pages degrade to the word "Unknown" with only a `console.error`: go-live and support access (`go-live/page.tsx:41-42`, `support-access/page.tsx:37-38`). Codes does say "Organization could not be loaded"; Centers says "Could not count". Inconsistent against "never a silent fallback".
8. **Slow, chatty pages.** Centers does one `count` query per center (`platform/page.tsx:54-64`); Agreements awaits 5 RPCs one after another (`agreements/page.tsx:80-86`); Go-live runs the whole `readiness` RPC per open request on every load (`go-live/page.tsx:44-51`); Verification mints 600-second signed URLs for every document of every queued org on every load (`verification/page.tsx:44`), including ones nobody opens.
9. **Stale generated types force casts.** `payment_plugin_pauses` via `untypedRpc` (`payments/page.tsx:27`), `requested_category_key` via a cast (`requests/page.tsx:32`), `list_experiences` hand-typed (`src/lib/experiences-db.ts`). Contradicts "regenerate types after each migration"; matters for any tool layer.
10. **The same guard copied eight times.** `platformSession`/`platformOnly` is re-implemented in `platform/actions.ts:14`, `onboarding-actions.ts:13`, `centers/[id]/actions.ts:11`, `payments/actions.ts:19`, `setup/actions.ts:20`, and the same check is written inline in `agreements/actions.ts`, `verification/actions.ts` and `new-sandbox/actions.ts`, each with slightly different wording of the refusal ("only platform admins can onboard centers" / "only Weaver platform admins" / "only Community Connect platform admins").
11. **Dead ends.** Platform cannot ask an owner for support access (only the owner can grant, `settings/support-access`); after go-live approval the console can only watch ("The owner promotes next", `pipeline/page.tsx:43`) with no nudge; an expired/at-risk sandbox (90-day inactivity, warnings at 60/80 days, `worker/src/handlers/platform.sandbox_expiry.ts`) is not shown as a date anywhere in the console.
12. **Good, keep:** every screen gates on `isPlatformAdmin` with a plain "You don't have access to this area" (`platform-no-access.tsx`); every list read failure shows `QueryError` with a retry link; every write shows its error inline plus a toast with `failure()` logging server-side; reasons are required and go to the audit log via `dbWithReason`; step-up (2FA) is retried automatically by `ActionForm`/`useStepUp`.

---

## C. Screens

Legend for assistant rows: R = read, W = write. Confirm tiers: **C0** none; **C1** confirm card with reason; **C2** confirm card that shows the exact outbound text (an email goes to an outside person, or every owner is asked to re-accept); **C3** C1/C2 plus the existing fresh-2FA step-up (the code is typed by the human in the browser, never in chat); **C4** C3 plus a two-person rule enforced by the database.

### 1. Centers - `/platform` (`platform/page.tsx`)

1. **Who:** any platform admin; the landing page and, for a new admin, redirected to Platform setup until it is complete (`(app)/page.tsx:22`).
2. **Jobs:** find an org; see live vs sandbox vs onboarding; see its kind and size; jump to its limits/addresses; start a new sandbox; see what is left of platform setup.
3. **Pattern / friction:** one table (name, slug, status, kind, "Size", tradition pack, "Limits & addresses"). Size = households only (no people, no last activity, no owner, no products). Onboarding orgs link to the legacy wizard, others are inert text. No search or filter. One count query per org (N+1). The "Tradition pack" column is "-" for any kind that keeps no tradition. "this portal" tag shows the host org, confirming the console lives inside one tenant's shell (dates use the host center's time zone, `session.center.time_zone`).
4. **Assistant:**
   - "How many live organizations do we have, and which ones are sandboxes older than 60 days?" - R - new aggregate read (`platform_org_summary()`, does not exist; today `centers` + `platform_onboarding_pipeline`) - C0.
   - "Create a sandbox for Riverside Chamber of Commerce, Houston TX, owner Priya Shah priya@riverside.org, because they met us at the expo" - W - `createSandboxAction` -> `platform_create_sandbox` (typed input, directly reusable) - C3 (step-up `platform.create_sandbox`; emails the owner an invitation; show slug `riverside-chamber-sandbox`, kind, owner email on the card).
   - "Open the Austin sandbox" - R/navigate - C0.
5. **Visual vs fresh:** keep a scannable list but make it the **Organizations** index: columns for stage, kind, owner, days in stage, blockers count, products on; row opens one organization page (all seven slices). Search box and saved filters ("stuck > 14 days"). **Marketplace:** add "Products" (count/names) and a "Requested" badge when a paid product waits for approval.

### 2. Center detail - `/platform/centers/[id]` (`centers/[id]/page.tsx`, `actions.ts`, `kind-panel.tsx`)

1. **Who:** platform admin changing an org's technical settings.
2. **Jobs:** see environment/promotion; change the kind of organization; add/remove an org's own web address; override sandbox/plan limits; read the member-app join code.
3. **Pattern / friction:** five cards. The **Kind of organization** flow is the best pattern in the console: pick -> **Preview what changes** (`category_change_preview`) -> reason -> **Change** with 2FA (`set_center_category`; the owner is emailed). Weak spots: Limits is a table with one two-field form (value + reason) per limit row, so a page with several limits has that many separate forms (value hint text like `'a number, or "No limit"'`, `page.tsx:164-170`), "Limits" in the UI vs "entitlement" in code/docs; no history of past overrides beyond the latest; no link back to the org's request, verification, go-live or support grants; no module list (Settings › Modules is only reachable inside that org's own portal); DNS add has no verification result per address (HTTPS lives on another tab). Join code is shown in clear (`:215`), fine for a sandbox gate but it is the access key to the sandbox in the member app.
4. **Assistant:**
   - "Raise Riverside's people limit to 5,000 until the pilot ends; reason: pilot of 3,800 households" - W - `setEntitlementAction` -> `set_center_entitlement` (value parsing in `parseEntitlementInput`) - C1 (no step-up in the action; show old vs new vs default).
   - "What would change if we switched Riverside from Neutral to Chamber of commerce?" - R - `previewKindChangeAction` -> `category_change_preview` - C0.
   - "Switch it to Chamber of commerce" - W - `changeKindAction` -> `set_center_category` - C3 (must show the preview text on the card; step-up `platform.category`; owner is emailed; nothing deleted).
   - "Add portal.riverside.org for them" - W - `addDomainAction` - C1 (+ say "point DNS at the server first"); "remove" is C1 with the existing wording.
5. **Visual vs fresh:** this page becomes the **organization page** (tabs: Timeline, Setup/readiness, People to contact, Kind & modules, Products, Limits, Addresses, Support, Audit). Keep the kind preview diff and the limits table (default vs in-effect vs override) visual; the assistant fills them in. **Marketplace:** a Products card (each product: state `active/trial/comped/requested/off`, source `self_serve/granted/grandfathered`, `trial_ends`, who/why) with Grant, Comp, Switch off (all with reason, audited). Keep Settings › Modules as the low-level view here (MARKETPLACE_PLAN M8).

### 3. New sandbox - `/platform/new-sandbox` (`new-sandbox/page.tsx`, `new-sandbox-form.tsx`, `actions.ts`)

1. **Who:** platform admin creating an org directly, no request or code (`platform_create_sandbox`, migration 0502/0594).
2. **Jobs:** name + web name + kind + city/state + owner name/email + reason -> sandbox and owner invitation.
3. **Pattern / friction:** one 9-field form; slug auto-suggested; two-step Kind picker (the only choice that shapes the org). 2FA at submit. The success card shows the invitation link **once** (DB keeps only a hash) with copy; if email is not set up the admin must paste the link into their own email. Friction: no way to pick an existing request to convert (the request flow and this flow are separate; a person who requested access is re-typed); state is a free two-letter field; city/state/owner are retyped data the request already had; nothing says whether this person already has a sandbox or request (duplicate check).
4. **Assistant:**
   - "Set up a sandbox for the person who requested access yesterday from Riverside" - W - looks up the request (R), pre-fills, then `createSandboxAction` - C3; prefer approving the request instead (see Requests) unless the team deliberately bypasses.
   - "Do we already have anything for riverside-chamber?" - R - C0 (duplicate check before create).
   - The link: result is rendered to the human only; the model gets "invitation created, expires <date>", never the token.
5. **Visual vs fresh:** a form is the right surface for a new org when fields come from nowhere; but from a Request it should be a one-click "Approve and create" with fields pre-filled and editable. Keep the Kind picker visual (it groups by tradition family). **Marketplace:** after kind is chosen, show the starter product set for that kind (MARKETPLACE_PLAN M3) and let the admin adjust before creating.

### 4. New center (legacy wizard) - `/platform/new?center=...` (`new/page.tsx`, `wizard-form.tsx`, `platform/actions.ts`)

1. **Who:** reachable only with `?center=` (otherwise redirects to New sandbox, `new/page.tsx:39`); continues a center the old 6-step wizard created.
2. **Jobs:** finish steps 2-6 for an older onboarding center; "Go live".
3. **Pattern / friction:** six chip-steps; steps 3-5 are mostly info boxes ("set up by the center after it is created", "not in the portal yet", disabled admin/treasurer inputs). **Risk:** the final "Go live" calls `goLiveAction` (`platform/actions.ts:110-120`), a plain `centers.update({status:'active'})` by one person: no readiness re-check ("the app does not verify them"), no second approver, no step-up. I found no database trigger that guards `centers.status` (only `centers_golive_live` closes the go-live request after the fact, migration 0203). It sidesteps everything the Go-live approvals screen enforces.
4. **Assistant:** nothing. This action must NOT be exposed as an assistant tool. Recommend (owner decision, it is a go-live rule) retiring the wizard and the action, or routing it through `approve_golive`.
5. **Visual vs fresh:** delete. Anything still in `onboarding` status should be migrated into the same sandbox -> go-live flow.

### 5. Requests - `/platform/requests` (`requests/page.tsx`, `onboarding-actions.ts:35`)

1. **Who:** platform admin on triage duty. Source: the public `/request-access` form.
2. **Jobs:** read the application; choose the kind; approve (issues a sandbox code, emailed), decline with a reason (emailed), or ask a question (emailed).
3. **Pattern / friction:** table (org, contact, households, received, status) + drawer with a 13-row definition list and a form. Friction: reading is the work, but the page is one request at a time in a drawer, 200 max, newest first (no oldest-waiting-first, no SLA/age flag); `select("*")` pulls `ip`/`user_agent` (shown as "Sent from"); the kind picker is inside the drawer and required only for approve; approving does two RPC calls (`set_access_request_category`, then `decide_access_request`, `onboarding-actions.ts:54,57`) so a failure between them leaves the kind set but the request undecided; after approve the list is deliberately not refreshed so the one-time code stays visible (needs a "Done - refresh" click, `code-form.tsx:43`); no duplicate/known-org check; the "Interested in" modules are shown but nothing carries them into the sandbox. Approve has no confirm and no step-up. Email status ("not set up - send by hand") is shown after the fact.
4. **Assistant:**
   - "Who is waiting for approval and what is missing?" - R - `access_requests` where status in (`new`,`more_info`) plus a compact missing-info check (no website, no kind, households blank, free-mail contact, duplicate of an existing org) - C0. The best single assistant win on this screen.
   - "Approve Riverside Chamber as a Chamber of commerce" - W - `decideRequestAction` (approve) - C2: card shows kind, contact email, that a code is issued and emailed, and the 14-day single-use terms. Code value goes to the UI card only.
   - "Decline the second Sunrise Temple request, it's a duplicate; tell them we already set them up" - W - `decideRequestAction` (decline) - C2: show the exact email text the contact will receive (the note is emailed verbatim).
   - "Ask Riverside how many households they actually have" - W - `more_info` - C2 (emailed text shown).
5. **Visual vs fresh:** triage is a queue + a reading pane, not a table + drawer: left = waiting list ordered by age with "what's missing" chips, right = the application with the kind picker and the email preview inline; keyboard next/prev. Keep a visual surface for the application itself (people verify facts). Fresh: approve -> go straight to "sandbox created / code issued" and carry "Interested in" and "Uses today" into the new org's Setup. **Marketplace:** show interest as products (map `modules_interested` to product names), and preselect the starter product set at approval. **Untrusted input:** `org_legal_name`, `org_detail`, `website`, `heard_from`, `contact_*` come from an unauthenticated form (`src/app/request-access/actions.ts:18`) - the assistant must treat them as data, never as instructions.

### 6. Sandbox codes - `/platform/codes` (`codes/page.tsx`, `onboarding-actions.ts:70,88`)

1. **Who:** platform admin supporting a requester who lost or never got the email.
2. **Jobs:** see which codes are unused/redeemed/revoked/expired; re-issue (old stops working, new shown once); revoke.
3. **Pattern / friction:** table with masked code `CC-SBX-····-1234`, org · email, issued/expires, state, email status, "Manage" drawer. The Manage button's visibility rule is a hard-to-read compound condition (`codes/page.tsx:110`): no button for redeemed codes, and for expired codes only on the newest one. Re-issue requires typing a reason like "the email went to spam" even when that is the only possible reason. A requester who has not redeemed in N days is not highlighted (no "unredeemed for 6 days" nudge). A code cannot be created here (only via Requests approve), and the screen does not link to the request or the resulting sandbox except by slug text.
4. **Assistant:**
   - "Which sandbox codes were issued more than a week ago and haven't been used?" - R - C0.
   - "Re-issue Riverside's code, their email went to spam" - W - `reissueCodeAction` -> `issue_sandbox_code` - C1 (reason pre-filled from the sentence; says the old code stops working); code shown on the card only.
   - "Revoke the Sunrise code, wrong contact" - W - `revokeCodeAction` -> `revoke_sandbox_code` - C1 (existing page already confirms "It stops working at once").
5. **Visual vs fresh:** not a top-level tab. Codes are a **state of an organization/request**; show them in the org timeline ("Code sent 4 Oct - not redeemed - re-issue"). A small audit-style table remains useful for "all outstanding codes". **Secrets:** never show full codes after issue (already true: hash + last4); the assistant must keep that.

### 7. Onboarding pipeline - `/platform/pipeline` (`pipeline/page.tsx`, RPC `platform_onboarding_pipeline`)

1. **Who:** the onboarding lead checking who is stuck.
2. **Jobs:** see every sandbox/onboarding org's stage, days in stage, checklist progress, readiness pass count, blockers, owner contact, last activity, whether support access is live.
3. **Pattern / friction:** four KPI tiles and a wide 8-column table; no filter, sort or row link; blockers are truncated to 3 with "and N more" and no drill-down; "Could not load" appears when the per-org checklist call failed inside the RPC (swallowed by the RPC's `exception when others`, shown as text); the stage tone expression is redundant (`:80` both branches "warn"); stage "Approved - promote next" is a wait on the owner with no action for Weaver; no sandbox expiry date though the worker emails owners at 60/80 days.
4. **Assistant:**
   - "Who's stuck and why?" - R - the same RPC, summarised by days in stage and top blocker - C0.
   - "Which sandboxes have been quiet for 60 days?" - R - `last_activity_at` (expiry = last activity + 90 days, computed) - C0.
   - "Remind Riverside's owner to finish verification" - W - NO action exists today; would need a new RPC to send a templated reminder (via `platform_send_message`) - C2 once it exists.
5. **Visual vs fresh:** keep this **visual**: a board by stage (Setting up | Sandbox | Go-live requested | Approved - owner promotes | Promoted) with cards showing days-in-stage ageing colour, X of Y steps, blockers; this is the one place a spatial view beats text. Cards open the organization page. **Marketplace:** card badges "2 products requested", "needs paid-product approval" so product requests are visible in the same board.

### 8. Go-live approvals - `/platform/go-live` (`go-live/page.tsx`, `onboarding-actions.ts:104`)

1. **Who:** two different platform admins, for a request an org's owner made from Setup › Go-live.
2. **Jobs:** inspect the readiness checks with evidence; give first or second approval; or send back with a note the org sees.
3. **Pattern / friction:** table (org, requested, status, "0/1/2 of 2 approvals") and a Review drawer containing the live `ReadinessTable` (check, result, evidence, how it's proven; some rows say "Not built yet"). Two buttons: **Send back** (needs note) and **Approve (first)/(second)** (disabled only when you are the first approver). Approving has **no confirmation dialog** (the form has no `confirmMessage`/`data-confirm`), only the 2FA step-up; the DB also rechecks readiness (`CCRDY`) and bars the requester. "Not built yet" checks mean the team approves partly on trust. After the second approval the screen gives no next step (the owner promotes, `platform.promote` step-up).
4. **Assistant:**
   - "What is still failing for Riverside's go-live request?" - R - `readiness(p_center)` via `mergeReadiness` - C0.
   - "Approve Riverside's go-live" - W - `decideGoliveAction` -> `approve_golive` - C4: card states "this will be the FIRST/SECOND approval", lists failing/not-built checks, who requested and who gave the first approval, and uses the human's own 2FA. Refuse if the user requested it or already approved (and say why before calling).
   - "Send it back: the second admin's 2FA isn't set up" - W - `reject_golive` - C1 (the note is shown to the org).
5. **Visual vs fresh:** keep the readiness table **visual**, side-by-side with the org's timeline; the assistant adds a plain-language "why this is safe/unsafe to approve" summary but never approves unprompted. The approval should become a deliberate two-click action with the summary on it. **Marketplace:** add a check "starter products chosen; any paid-product request resolved".

### 9. Verification - `/platform/verification` (`verification/page.tsx`, `actions.ts`)

1. **Who:** platform admin (not the person who submitted) verifying non-profit status.
2. **Jobs:** compare legal name/EIN/entity/state against the IRS lookup and uploaded documents (W-9, determination letter); verify, send back with a note, or withdraw verification.
3. **Pattern / friction:** table (org, legal name/EIN, status, IRS Match/Check/Not found, documents count) + drawer with identity facts, IRS lookup result, document links (signed, 10 minutes), and **Verify / Send back / Withdraw**. Friction: the comparison is done by eye (IRS result and documents are separate sections; mismatches are not highlighted field by field); the "mine" restriction is only enforced by the database; "Withdraw verification" has no confirm (Verify has one); a verified org that later changes its EIN is not flagged; signed URLs are generated for every row up front (see B8).
4. **Assistant:**
   - "Who is waiting for non-profit verification, and is the IRS record a match?" - R - `org_verification_queue` (irs result is already in the row) - C0.
   - "Compare the EIN and legal name on the W-9 with the IRS record for Riverside" - R - needs the document contents, which today are files behind signed URLs; privacy decision required before any model reads a W-9 (it carries an EIN and possibly a signatory). Default: the model sees only the structured fields, not the files.
   - "Verify Riverside" - W - `decideVerificationAction` -> `decide_org_verification` - C1 (show IRS match state; recorded under the admin's name; org's readiness check passes). "Send back: the W-9 isn't signed" - W - C1 (note shown to org).
5. **Visual vs fresh:** keep a **side-by-side visual**: submitted facts | IRS record | document viewer, with differences highlighted; the assistant narrates, a human decides. **Marketplace:** none directly (but verified status may gate paid products).

### 10. Support access - `/platform/support-access` (`support-access/page.tsx`)

1. **Who:** platform admin who was granted time-boxed access by an org's owner.
2. **Jobs:** see which grants exist (org, reason, window, live/ended/expired); end my own grant early.
3. **Pattern / friction:** read-only table, one action ("End now", only for your own live grant, no confirm). "Given to: You / Another Weaver admin" (names exist via `platform_admin_directory`, used in setup but not here). The page honestly says a grant is only a recorded consent: "Platform admins' database access is not yet limited to live grants" (`:44-47`), and `is_platform_admin()` appears in 63 migrations, so the grant gates nothing technically. The team cannot ask an owner for access: only the owner can create a grant (`app.grant_support_access` requires `is_center_owner` and a fresh 2FA, migration 0202), on the owner's own Settings › Support access screen.
4. **Assistant:**
   - "Do I have live support access to Riverside?" - R - C0.
   - "End my access to Riverside" - W - `endSupportGrantAction` -> `revoke_support_access` - C1.
   - "Ask Riverside's owner for 24 hours of access to look at their import" - W - no such action exists (would need a new request RPC + owner email) - C2 when built.
5. **Visual vs fresh:** a small table inside the organization page ("Support: live until 6pm, granted by Priya, reason...") plus a global "live grants" strip on the inbox. Policy for the assistant: while no live grant exists, tools must not read that community's member or money data even though the admin's RLS technically allows it.

### 11. Payments (pauses) - `/platform/payments` (`payments/page.tsx`, `pauses-panel.tsx`, `actions.ts`)

1. **Who:** platform admin pausing a way to pay (Card, Zelle, PayPal ...) for everyone or one community. "The only power a platform admin has over payments."
2. **Jobs:** see state per way to pay; pause/resume for everyone or one org; read the history.
3. **Pattern / friction:** table plugin x state x pauses x buttons, plus a Modal with reason and 2FA; history list. Friction: no **impact preview** before pausing (how many orgs use it, any payment in flight, which orgs are live vs sandbox); per-org pause chooses from a long `<select>` of all orgs; "Community Connect" wording; success message is long, but good. This is a **money rule** - Per CLAUDE.md the owner approves any change to money rules; the pause itself is an operation (already built and audited).
4. **Assistant:**
   - "Which ways to pay are paused right now, for whom, and why?" - R - `payment_plugin_pauses` - C0.
   - "How many live communities take Zelle?" - R - needs a new read (impact) - C0.
   - "Pause Zelle for Riverside: they reported a wrong payee" - W - `suspendPluginAction` (typed args, reusable) -> `suspend_payment_plugin` - C3 (step-up `payments.suspend`; card says "members stop seeing it, new payments cannot start, recorded money unchanged"). "Pause Card for everyone" is the highest blast radius in the console and warrants a second confirm field (type the plugin name).
   - "Resume it" - W - `liftPauseAction` - C3.
5. **Visual vs fresh:** keep a **matrix** (way to pay x organization) as the visual; the pause list is better as a grid where cells show paused/on with who/why on hover than as nested text. **Marketplace:** the Giving product's payments are a sub-surface; if Giving becomes a product, a pause is a separate control from "product off" (different power); keep them distinct.

### 12. HTTPS - `/platform/https` (`https/page.tsx`, `src/components/https/https-status-panel.tsx`)

1. **Who:** platform admin checking certificate/DNS health.
2. **Jobs:** see whether the portal address and each org address have HTTPS; read the next step.
3. **Pattern / friction:** read-only card ("Checked every minute"), headline alert + per-name lines + the Caddy reload note. The same panel is embedded in Platform setup steps `portal` and `wildcard`. No action here; adding an org address happens on a different page (Center detail), and verifying that address's certificate is back here.
4. **Assistant:**
   - "Is riverside's custom address serving HTTPS yet?" - R - `readHttpsStatus` - C0.
   - "Why is portal.sunrise.org showing http:// only?" - R - `summarizeHttps` text plus DNS guidance - C0.
5. **Visual vs fresh:** do not keep as a tab; surface as a health tile on the inbox ("1 address waiting for DNS") and inside the org's Addresses card. A single status strip suffices.

### 13. Agreements - `/platform/agreements` (`agreements/page.tsx`, `actions.ts`)

1. **Who:** platform admin (with counsel) editing Weaver's legal texts (terms, DPA, children's addendum, order form, sandbox terms, privacy policy).
2. **Jobs:** edit a draft; publish a new version; see acceptance counts.
3. **Pattern / friction:** one card per document: status, "Accepted by X of Y organizations", draft box with Edit (drawer: title, version, 14-row Markdown textarea, reason) and Publish (confirm). No diff between current and draft; no list of which orgs have not accepted (acceptance blocks go-live and is asked of every owner); publishing records the auto-reason "Published <title>" (`actions.ts:53`), no human reason, and **no step-up and no second person** for a change that re-prompts every owner and (for privacy/terms) every member. Five sequential acceptance RPCs (`:80-86`; `.slice(0, 5)` is a magic number tied to the list order).
4. **Assistant:**
   - "Which organizations haven't accepted the new DPA, and are any of them waiting on go-live?" - R - needs per-org acceptance (today only counts via `platform_agreement_acceptance`) - C0.
   - "Draft version 2026-10 of the sandbox terms from this text" - W - `savePlatformDraftAction` -> `save_platform_document` - C1 (draft; nothing visible to orgs).
   - "Publish it" - W - `publishPlatformDraftAction` -> `publish_platform_document` - C2 (card states: cannot be changed afterwards, every owner is asked to accept, go-live checks wait); recommend adding step-up/second approver (owner decision; it is a legal-terms rule).
5. **Visual vs fresh:** keep a **visual diff** (current vs draft) and a version history; the assistant helps summarise differences for owners and drafts changelog emails. Counsel's wording must be authored by a human; the assistant may suggest but not publish unprompted.

### 14. Platform setup - `/platform/setup` (`setup/page.tsx`, `setup-client.tsx`, `actions.ts`, `src/lib/platform-setup/*`)

1. **Who:** the Weaver super admin, first sign-in and whenever a provider changes. Redirected here until required steps are done (`(app)/page.tsx:22`, can postpone with "Continue to the portal for now").
2. **Jobs:** configure 11 providers/infrastructure steps (background service, portal address and HTTPS, email, sign-in hooks, payments, texting, QuickBooks, AI, art, push, wildcard domain); store keys in the vault; test; mark done/park/reopen.
3. **Pattern / friction:** a stepper (left) + a step page (right): what/why/status/instructions/fields/last test. The **instructions are hard-coded prose pointing at about nine outside consoles** (Supabase, GitHub, Resend/Postmark, Stripe, PayPal, Twilio, Intuit, Anthropic, Google AI Studio; `page.tsx:371-523`) with copy buttons for URLs; the admin hops between this page and those consoles for each key. Keys are entered in a password input in a modal, with a reason; **every key change asks a fresh authenticator check** (`0320`); the field shows only the last 4 characters. Tests run in the background service and the page polls every 2 s up to a minute. Friction: step 1 (`WORKER_DATABASE_URL`) cannot be done here at all and needs a terminal, SQL editor and GitHub; "Mark done" is disabled with only a tooltip as the reason (`setup-client.tsx:247`); placeholders still say `communityconnect.app`; no diff of what changed since last test.
4. **Assistant:**
   - "What's left before the first real customer can sign in?" - R - `platform_setup_steps` + `live` checks (`loadSetupView`) - C0.
   - "Walk me through connecting Resend" - R/guide - assistant narrates the existing step text and links; tells the human where each key goes; the human pastes the key into the existing masked field - C0.
   - "Test the email provider" - W (enqueues a job) - `testStepAction` -> `enqueue_platform_test` - C1 (no money, no outbound customer message, but it contacts the provider).
   - "Park the Gemini step, we don't need art yet" - W - `parkStepAction` - C1.
   - **Never:** "Here's the Stripe key sk_live_..." typed into chat. Secrets must be entered only into the masked field; the assistant must refuse and point at the field (and not log the attempt text).
5. **Visual vs fresh:** keep the stepper and the masked-field modal **visual**; this is a checklist the assistant can accompany, not replace. A fresh design would put a single "Platform health" panel (portal, email, hooks, worker heartbeat, AI, HTTPS) on the inbox and keep Setup as a rarely used settings area under a "Platform" group, separate from per-org work.

---

## D. Marketplace in the platform console (not built; from `docs/MARKETPLACE_PLAN.md`)

Needs: the console is where Weaver (a) sees the catalog, (b) approves requested paid products by hand (phase 2), (c) reads demand for coming-soon products, (d) grants or comps products.

| Where | What to show | Source (planned) | Assistant |
|---|---|---|---|
| Inbox / Requests | "Product requests" queue: org, product, price shown, trial?, note; Approve / Decline with reason (like a Request) | `center_products.state = 'requested'` | "Which product requests are waiting?" R; "Approve Riverside's Gala and Auctions request" W C2 (customer is told) |
| Organization page | Products card: state, source (`self_serve`/`granted`/`grandfathered`), trial end, who/why | `product_states(center)` | "Give Riverside a 30-day trial of MatchMyGenerosity" W C1; switch off W C1 |
| Demand view | Coming-soon products ranked by "Tell me when ready" count, split by kind of organization, with org names for communities | `product_interest` | "Which coming-soon product do chambers want most?" R C0 |
| Pipeline cards / Go-live | badge for requested products, check "products chosen" | `center_products` | "Any go-live blocked on a product decision?" R |
| Catalog (read-only) | name, status (`available/beta/coming_soon/retired`), modules, dependencies, kinds that see it | `products` (written by migrations) | explain dependencies R |
| Prices (phase 2) | owner-decided; no price set until then | `product_prices` | **price changes are a money rule: owner approval before anything ships; the assistant never edits prices** |

Naming: the console already uses "Limits" for sandbox/plan limits (`entitlements`) and "permissions" for role strings; keep "Products" distinct (MARKETPLACE_PLAN naming note) to avoid a third meaning of "entitlement".

## E. What a fresh platform console would look like (summary)

- **Today** (inbox): requests to review, verifications waiting, go-live approvals that need me (not ones I requested/approved), sandboxes stuck or expiring, unredeemed codes, live support grants, paused ways to pay, platform health (setup, HTTPS, worker, AI), product requests. Each row: one line of "what's missing" and one primary action.
- **Organizations**: index + one organization page with a timeline from request to promoted; the seven slices become tabs.
- **Pipeline board**: stage columns with ageing (the one view that stays spatial).
- **Platform** (rare): Setup, HTTPS, Agreements, Payments pauses, Marketplace catalog/demand.
- **Assistant** as a right-hand panel and a command bar on every screen, aware of the open organization/request, answering from the same RPCs, and proposing writes as confirm cards (diff + exact outbound text + reason box), executed by the human's click with the existing step-up modal.

## F. Blockers and cautions in the code for an assistant

1. **Server Actions are form-shaped, not command-shaped.** Most take `(prev, FormData)` for `useActionState` and return UI sentences (e.g. `decideRequestAction`, `decideGoliveAction`, `endSupportGrantAction`); a few are typed and directly reusable (`createSandboxAction(input)`, `suspendPluginAction(key, center, reason)`, `changeKindAction`, `previewKindChangeAction`, `saveFieldAction(name, value, reason)`). A tool layer should call shared typed command functions (one `platformSession` guard, see B10), not parse FormData.
2. **Step-up is browser-mediated.** The DB raises `CCSTP`; `failure()` returns `stepUp: true`; `ActionForm`/`useStepUp` opens a modal, verifies the TOTP on the server and retries (`src/components/step-up.tsx`, `action-form.tsx:97-106`). A model running server-side cannot satisfy this; the pattern must be: model proposes -> confirm card in the UI -> the user's browser runs the existing action with step-up. The TOTP code never enters the conversation.
3. **One-time secrets travel in action results.** `decideRequestAction`/`reissueCodeAction` return the sandbox code in `data.code` (`onboarding-actions.ts:66,85`); `createSandboxAction` returns the owner invitation link (`new-sandbox/actions.ts:60`). If a tool wrapper hands these to the model they land in transcripts and logs. Needs a redaction layer: the model gets last4/expiry, the card gets the value.
4. **Untrusted text + a super-user session = prompt-injection risk.** Public-form fields (`org_detail`, `website`, `heard_from`, contact names), uploaded document names/notes, owner-written support reasons, and audit reasons are all attacker-influenced. The platform admin's session passes RLS for every community (`is_platform_admin()` in 63 migrations; the support-access page admits grants do not limit it). Mitigations: tool allowlist limited to console RPCs (no generic table/SQL tool), content marked as data, every write only via a human-confirmed card built from structured arguments (never model prose), and outbound text (decline/ask emails, agreements) shown verbatim.
5. **Audit tagging is not possible yet.** `audit_log.client_app` accepts only `portal|member|kiosk|job` (`audit_clean_app`, migration 0100), so assistant-initiated writes would be recorded as `portal`. A migration to add a value (e.g. `assistant`) is needed so the log shows who really clicked; the request id and reason already flow through `dbWithReason`.
6. **No Anthropic call from the portal process today.** Niva runs as queued jobs in the worker under the `connect_worker` role (`worker/src/handlers/niva.answer.ts`); the Anthropic key lives in the platform vault and is read by the worker (and by the portal only if `WORKER_DATABASE_URL` is set, `setup/page.tsx:76-82`). The worker role is not the signed-in user's rights, which conflicts with "RLS is the enforcement; act with the signed-in user's rights". The admin assistant must run in the portal request with the user's JWT (`createSupabaseServerClient`), for both tool calls and the model call, using the vault key only for the model call.
7. **No aggregate/read RPCs shaped for questions.** Pages query tables directly (`select("*")` on `access_requests`, `support_grants`, `golive_requests`), pulling fields an assistant must not see (`ip`, `user_agent`, storage paths, signed URLs). Needed: field-allowlisted read RPCs (`platform_inbox()`, `platform_org_summary(center|request)`, per-org agreement acceptance, impact preview for a pause) to avoid N+1 and over-exposure.
8. **Generated types lag the database** (B9); a typed tool layer will otherwise be built on casts.
9. **Legacy `goLiveAction`** is a one-person go-live with no checks (screen 4); must stay out of any tool list.
10. **Identity by name alone.** Orgs have near-identical names (`jsh`, `jsh-sandbox`, a request and a sandbox with the same legal name). Mirroring the household rule, every assistant confirmation must show slug, kind, environment (sandbox/production), city/state and owner email, never the name alone.
11. **Latency and approvals across turns.** Go-live and verification need a different second person; the assistant must keep per-user state (who gave the first approval) from the database, never from conversation memory.

## G. Rules the redesign must keep

1. Every Server Action/tool returns `{ ok, error }`; failures are shown in plain English **next to what the user did** ("Could not approve go-live - ..."), with a retry where one exists; technical detail goes to the server log (`failure()` in `src/lib/errors.ts`); no console-only error, no silent fallback, never "Saved/Approved" when the write failed. An assistant message is not a substitute: the card shows the same inline error and a Retry.
2. **Secrets never shown.** Keys are masked after save (last 4 only), sandbox codes and owner invitation links are shown once to the human, the assistant never repeats, stores or logs them, and never accepts one typed into chat.
3. **RLS is the enforcement.** UI/permission checks and the assistant's tool allowlist are conveniences. The assistant acts with the signed-in admin's own session (no service key, no worker role). When RLS returns nothing because of permissions the screen/assistant says "You don't have access to this area", not an empty list.
4. **Reasons, audit and request ids** on every write (`dbWithReason`); the assistant supplies the reason from the user's words and shows it on the card.
5. **Two-person and step-up rules stay in the database:** go-live (two different Weaver admins; requester cannot approve; readiness rechecked), verification (not the submitter), kind change (reason + fresh 2FA + owner emailed), create sandbox, payments pause/resume, platform keys (always fresh 2FA). The assistant never tries to route around them; the confirm card says which one applies.
6. **Money rules need the owner.** Per CLAUDE.md, anything that changes money rules, permissions/RLS, or deletes data needs the owner before merge: the product price table, a payments pause policy change, giving the assistant write tools that touch support access, and any change to the audit allowlist all fall under that.
7. Households/orgs are never identified by name alone (show the card: slug + kind + environment + owner).
8. Faith or tradition never appears as the default in console copy; kind labels come from the catalog.
9. Accessibility: 44px targets, visible headings per screen (fix B3), no information by colour alone (stage and pass/fail already have text).
