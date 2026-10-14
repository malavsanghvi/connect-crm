# UX audit 05 · Settings and Setup (admin portal, `src/app/(app)/settings`, `src/app/(app)/setup`)

Read-only audit, 2026-10-09. Nothing in the repo was changed. Covered: **37 `page.tsx` screens** (28 under settings, 9 under setup) plus 3 non-page routes (import template download, import problems download, onboarding template download). Settings has **24 tabs** in one flat strip (`NAV` in `src/lib/permissions.ts:533-570`); Setup has 8 tabs plus the guided-onboarding page that is reachable only by a button on the checklist.

Legend used in every screen section
- Confirmation tiers for assistant actions: **R** read, no confirmation. **W1** reversible write: show a diff card, one click. **W2** write that must have an explicit confirm card, a reason and (when the database asks, SQLSTATE `CCSTP`) a step-up: roles and permissions, anything with the two-person rule, payment settings, credentials, security rules, anything destructive or hard to undo. **H** human-only surface: secret entry, legal acceptance, owner attestations, typed-word confirmations, provider redirects, DNS at a registrar, document upload.
- "Gate" = the `ACCESS` key in `src/lib/permissions.ts` (UI convenience); RLS and the RPC checks are the enforcement.

---

## A. Rules the redesign must keep (found in code and docs)

1. Errors in plain English beside the action, with retry: `failure()` in `src/lib/errors.ts`, `ActionMessage` in `src/components/action-form.tsx`, `QueryError`/`NoAccess` in `src/components/ui.tsx`. When RLS would return nothing: "You don't have access to this area", never an empty table. An assistant reply may not say "done" unless the Server Action returned `ok`.
2. Money is integer cents (`boli.step_cents`, `store.gift_pack_cents`, `membership_types.fee_cents`; forms take dollars and convert in TS: `dollarsToCents` in `src/lib/setup-lists.ts`). The assistant must pass cents, never floats, and show currency formatted at the edge only.
3. Secrets never shown: the vault shows only a fingerprint (last 4); the secret value goes to `app.set_integration_secret` once. Treat invitation links (`staff_invitations` token), join codes in transit, export paths, and the Stripe/PayPal OAuth state the same way: the model must not see or log them.
4. RLS is the enforcement, so the assistant acts with the signed-in user's own cookie client (`createSupabaseServerClient`, `dbWithReason` in `src/lib/session.ts`), never a service key and never the worker's key. Today `authorizeAction(key, doing)` is the only server-side gate and it must run for every tool call.
5. Reasons: `dbWithReason(session, reason)` sets `x-audit-reason` so audit rows carry it. Required in modules, access levels, payments, vault, support access, demo, join code, import undo; optional or defaulted elsewhere (see friction F3).
6. Two-person rule and step-up are database rules (`docs/ROLES.md`): roles `center_admin`, `treasurer`, `finance_volunteer`, `executive_committee`, `privacy_officer` wait for a different approver; payee changes (Zelle address, name, PayPal email) need a different holder of `giving.approve` with a fresh 2FA check and a reason, and a platform admin's blanket permission does not count; module switches, role grants, 2FA-off, exports, ownership transfer and 2FA resets need a fresh 2FA check (`app.assert_step_up`, 5 minutes). An assistant can never be the "second person", and one human can never approve their own request through it.
7. Households and people are never picked by name alone: show `household_card` details (`searchPeopleAction` in `settings/roles/actions.ts` already returns member number, org ID, email, household and number).
8. Rules bag (`centers.rules`): optimistic version guard, never put personal data or secrets in it (`docs/SETTINGS_RULES.md`). Several keys are **recorded only** (not read by any app yet): `security.admin_session_hours`, `admin_idle_minutes`, `printed_signin_codes`, `onboarding.fields.*`, `membership.life_references_required`, `membership.life_prior_yearly_months`, `points.streak_rest_days_per_month`, `points.behind_after_days`. An assistant must say so rather than imply they take effect.

---

## B. Cross-cutting friction (the patterns behind the per-screen notes)

- **F1. Organised by data store, not by job.** A job like "get texting working" crosses Setup › Legal identity (EIN, legal name are re-typed into the texting form via prefill from `org_profiles`), Settings › Texting (10DLC registration, days to weeks), Settings › Notifications (quiet hours), Settings › Security (phone sign-in toggle lives on the Texting page but is a security rule), Settings › Integrations (status row) and the Setup checklist. Every one of the 24 Settings pages has the same H1, "Settings"; the real name is only in the tab strip.
- **F2. The same thing is configurable in two or three places.** Modules switch (reason + 2FA, `set_module_enabled`) versus Rules › "Features switched on" (`centers.feature_flags`, no reason, no 2FA, no version guard, `saveBrandingAction`). Brand colours in Setup › Profile (`branding.colors`, RPC `set_center_branding`, logos must be uploaded) versus Rules › Branding (`branding.primary/accent/background`, a free "Logo URL (https)", raw `centers.update`). Two importers over one engine (Settings › Data import and Setup › Guided onboarding). Payments in Setup step, Integrations hub and its own page. Go-live approvals for statement templates and Niva live on Giving and Content pages, not in Setup.
- **F3. Reason and step-up are applied three different ways.** Mandatory reason modal (modules, access, payments, vault, support, join code, import undo, demo). Optional reason with a silent default (email, texting, WhatsApp, numbering, lists, roles). No reason field at all (custom fields, test recipients, data-request status, setup step, branding/features, every Rules section, Home shortcuts). Step-up usually opens the shared modal via the `stepUp` flag, but import undo only returns a sentence ("confirm with your authenticator, then try again", `settings/import/actions.ts:309`).
- **F4. A switch is not "ready".** Texting, email, WhatsApp, payments, QuickBooks and Weaver verification each need an external party (carrier, DNS host, Meta, Stripe, IRS check), and the page shows a record with a status, not a plan. Dead ends: Integrations rows "Panchang source" and "Background checks" have no provider and no link (`src/lib/integrations.ts`); "Clone as custom" role and "Export log" are disabled buttons; Notifications rows marked "Not sent yet"; Setup rows "Coming soon"; Privacy "Mark complete" on a deletion request only records the decision (the export or deletion itself is produced elsewhere; staff paste a file path); Team invitation "email and text sending are not connected yet" (copy a link); PayPal verification code "email sending isn't set up on Weaver yet".
- **F5. Jargon.** 10DLC, brand and campaign, DKIM-style DNS records, WABA ID, phone number ID, "vault", "step-up", "entitlements" (used for role permissions, sandbox limits and plan limits), "legacy systems" typed as `System | label` lines, "Advanced · all rules as JSON", "rules version 14".
- **F6. Hand-offs are invisible.** A role grant that "waits for a second person", a Zelle change, Weaver verification and go-live approval each end with a toast to the requester. I found nothing that notifies the approver: no message is queued in `grantRoleAction`, `requestZelleChangeAction` or `submitVerificationAction`, and neither migration 0017 (pending role grants) nor 0597 (payee change control) calls `enqueue_message`. The approver must open the page and look.
- **F7. Hidden side effects.** Saving Numbering or a Storage retention "also marks the Setup step as reviewed, even when nothing changed". Saving Legal identity after review silently resets verification. Rotating the join code kills every printed poster. Profile (a "Profile" form) changes `centers.currency` and `time_zone`. Access levels save one `set_feature_access` call per area, non-atomically, so a refusal leaves earlier ones saved (message says so, `settings/access/actions.ts:49-58`).
- **F8. Whole-section saves and "someone else saved".** Rules, notifications, security, onboarding fields, shortcuts, numbering systems and retention all share one JSON bag with an optimistic `version`; a stale tab gets "reload and save again" and loses typed work. Success is a transient toast; the only durable "what changed" is the audit log.

---

## C. Assistant execution contract (applies to every screen below)

1. **Tool = a named Server Action or RPC with a declared risk tier**, reason requirement, step-up flag, two-person flag and the `ACCESS` key. Today these facts are spread over components (`confirmMessage` strings), `authorizeAction` keys and database triggers; they need one registry.
2. **Propose, then confirm.** The model proposes a structured change; the portal renders the confirm card from the structured diff (not from model prose) with household cards, amounts in cents formatted at the edge, the reason box and the step-up prompt, and calls the same Server Action the form would. No auto-confirm for W2.
3. **Results come from the action result.** `ok:false` text is shown verbatim with the retry; the assistant does not rephrase an error into a success.
4. **Humans only (H):** pasting a secret, accepting an agreement (`accept_org_agreement` stores IP and browser from request headers), owner attestations, typed-word clears (`clear_sandbox`, `reset_sandbox`), OAuth redirects, DNS records at the registrar, uploads of W-9/IRS letter, approving as the second person.
5. **Chat is not a data channel for PII or secrets.** Import files and onboarding rows (names, emails, mobiles, addresses, amounts) go to server-side tools; the model sees headers, counts and masked samples.

---

## D. Screens

### Settings

#### 1. `/settings` (index) · `settings/page.tsx`
- Who: anyone with a Settings tab. Job: land somewhere. Pattern: server redirect to the first visible tab (`visibleNav`). Friction: the "first tab" is Rules for admins and something arbitrary for others; no overview of what is configured or broken.
- Assistant: becomes the **Settings home**: a status board ("3 things need you: Zelle change waiting for approval, email domain not verified, 2 invitations expired") and the assistant's entry point. READ, backed by existing status RPCs (below). No confirmation.
- Fresh design: a per-product settings home inside the Marketplace plus four core areas (Organization, People and access, Products, System and trust). See section E.

#### 2. `/settings/center` · `settings/center/page.tsx`
- Legacy redirect to `/settings/rules`. Remove; keep the URL working only if bookmarks matter. No assistant role.

#### 3. `/settings/rules` · `settings/rules/page.tsx`, `rules-forms.tsx`, `actions.ts`
- Who: owner, admin (`settings.manage`). Jobs: set membership and reference rules, giving and privacy defaults, lunch and RSVP, boli step and gift-pack price, points, branding, feature flags; raw JSON for everything else.
- Pattern: nine cards, each its own form saving a section of `centers.rules` via `writeCenterRules` (`src/lib/data/center-rules-write.ts`): read-modify-write with `rules->>version` as the guard. Friction: version collisions, jargon ("Slot length for new events", keys), recorded-only settings look live (see A8), "Features switched on" duplicates Modules and bypasses its reason and 2FA, "Advanced · all rules as JSON" is a textarea for keys with no form (identifier labels, bank format, voting, accounting).
- Assistant: "Make lunch slots 20 minutes" (WRITE, W1, `saveRulesSectionAction` section `lunch`), "Boli step to $25" (WRITE, W2 because it is a money rule, `boli.step_cents` = 2500), "What are our reference rules for life membership?" (READ from `readRuleSettings`, plus `membership_types`). Needs a server function that takes a typed patch (`section`, `key`, `value`) and runs `parseSection` plus the version guard, rather than posting form fields.
- Visual / fresh: keep a visible diff and the version; lose the JSON editor for non-engineers (assistant asks plain questions, JSON stays behind "developer view"). Marketplace: each section moves to its product (Membership, Giving, Bolis, Digital Store, Event Weaver, My Jain Way/Gyan Path) as that product's Settings drawer. Branding and fonts go to the one brand editor (Setup › Profile).
- Keep: version guard (two admins never overwrite each other), audit trigger on `centers`, kind-aware hiding (`moduleNotOffered`), "Center" card read-only (name, slug, time zone changed by Weaver).

#### 4. `/settings/roles` · `settings/roles/page.tsx`, `grant-form.tsx`, `actions.ts`
- Who: owner, admin (`roles.manage`); a second admin approves. Jobs: see what each default role can do, grant a role (whole center, or one event/class/zone, optional end date), approve/revoke, view history.
- Pattern: two-panel role viewer (read-only, "Clone as custom" disabled), grant form with person search, tabs Active / Waiting for approval / Ended / All. Friction: granting needs the person to have **signed in at least once** (`user_id`); otherwise the user must leave for Team › Invite; a custom role is impossible (roles are shared by all centers); the entitlement grid is 12 groups of checkboxes; end dates are "through end of day in the center time zone" (math in `grantRoleAction`); duplicate-grant check, platform/family-role refusals and tz math are in TS, with direct `role_grants` insert and update (no RPC).
- Assistant: "Give Priya the treasurer role for a year" → resolve Priya (`searchPeopleAction` / `resolve_identifier`, show household card, ask which Priya), check she has a login, then propose grant {treasurer, whole center, ends = today + 1 year, reason} → **W2** + step-up; result is **pending** because treasurer needs a second approver, and the assistant says who must approve. "What can the Membership Coordinator do?" (READ, `roles.permissions` + `entitlementGroupsFor`). "Who has access to payments?" (READ, `team_security` + `role_grants`). "Revoke Rahul's event-lead role for the Diwali event" (WRITE, W2, revoke).
- Needs: promote the grant/revoke logic into RPCs (`grant_role`, `revoke_role`) so the assistant and the form share one rule; the "who approves" notification (F6).
- Fresh design: person-first ("Priya Shah · 2 roles · treasurer pending approval"), role picker described in jobs not permission strings; "Ask" box for "who can refund?". Keep: two-person wording, "this is YOUR grant" warning on self-revoke, history button.

#### 5. `/settings/team` · `settings/team/page.tsx`, `team-client.tsx`, `actions.ts`
- Who: owner, admin (`roles.manage`). Jobs: invite staff by email or mobile, resend or withdraw, see who has 2FA, reset a lost phone, transfer ownership.
- Pattern: invite form, invitations table, staff-and-2FA table, owner card. Friction: **invitation delivery is manual** (link shown once, copy it); an invite cannot carry an end date or a scope (`p_scope: {kind:"center"}` is fixed in `inviteStaffAction`), so "treasurer for a year" is a Team invite then a Roles regrant; five roles (`TWO_PERSON` set) wait for a second admin after acceptance; go-live check "owner and a second admin both with 2FA" is explained here only.
- Assistant: "Invite Dev Patel (dev@x.org) as communications officer" (WRITE, W2, `invite_staff`; the link is returned to a reveal-once card outside the model context). "Who hasn't set up 2FA?" (READ, `team_security`). "Priya lost her phone" (WRITE, W2, `reset_staff_2fa`; reason required, another admin only). "Make Anita the owner" (W2/H: `transfer_ownership`, reason, step-up; owner only).
- Fresh design: one **People and access** screen = staff, pending invites, roles, 2FA state in one table; invitation delivery by the app once `enqueue_message` exists; invite carries role, scope, end date.

#### 6. `/settings/modules` · `settings/modules/page.tsx`, `modules-form.tsx`, `actions.ts`
- Who: owner, admin (`settings.manage`). Job: switch whole areas on or off. Pattern: table of 18 modules with a toggle, depends-on column, kind-aware "Not offered"; each switch opens a modal that requires a reason and a step-up (`set_module_enabled`). Friction: technical subsystems, not products; dependency refusals arrive as row notes; the duplicate in Rules (F2).
- Assistant: "Turn on the store" (WRITE, W2, `set_module_enabled(store)` today, `enable_product(store)` after Marketplace; assistant first reads `module_states` for dependencies and the kind, and the Setup steps it unlocks). "What's switched off and why?" (READ, `module_states` has `changed_by/reason`). "Turn on texting" is **not** a module: the assistant explains it is a messaging capability (registration days to weeks) and starts the Texting plan instead.
- Fresh design: becomes the **Marketplace** (docs/MARKETPLACE_PLAN.md): product cards (name, promise, status, what it needs, what it unlocks, "Included" for grandfathered JSH), enable with reason, per-product Settings and Setup steps on the card. The module table stays as the platform-admin low-level view (plan M8). Keep: reason in audit log, dependency refusal in plain words, nothing deleted when switched off.

#### 7. `/settings/access` · `settings/access/page.tsx`, `access-forms.tsx`, `actions.ts`
- Who: owner, admin (`settings.manage`). Job: choose the lowest level (Public, Community member, membership levels) that may use each member-app area; define the ladder. Pattern: table of areas with selects, a levels editor with reorder and tiers. Friction: two cards, a hidden save that issues N sequential RPCs; module-off notes per row; concept ("floor level", "tier") is heavy.
- Assistant: "Only yearly and life members can watch live darshan" (WRITE, W2, `set_feature_access(feature, level_key, reason)` + needs a reason and step-up); "Who can use Ask Niva today?" (READ, `access_settings`). Needs: `featureChanges`/`buildLevelsPayload` are TS helpers, so tools call them server-side; make the multi-area save atomic.
- Fresh design: one sentence per area ("Anyone / Members / Yearly and Life") on the product that owns the area; ladder editing only in Membership product settings.

#### 8. `/settings/member-app` · `settings/member-app/page.tsx`, `home-shortcuts-form.tsx`, `actions.ts`
- Who: owner, admin (`settings.manage`). Jobs: share the join code and QR, rotate it, order Home shortcuts. Pattern: invite-message composer (copy, WhatsApp, text, email links; nothing is sent), join code card, QR SVG, shortcuts card. Friction: rotating a code (`rotate_member_join_code`) invalidates posters, with the reason box and "Expires (optional)" date next to it; the QR is only downloadable as SVG.
- Assistant: "Write the invite for the new join code" (READ, composes from `member_join_codes`; sending stays a human tap), "Make a new join code expiring Friday" (WRITE, **W2**: destroys printed posters; needs reason), "Hide the podcast shortcut" (WRITE, W1, `saveHomeShortcutsAction` -> rules patch `home.shortcuts`).
- Fresh design: "Get members onto the app" as a guided step with Print poster / Share link / Send by WhatsApp; shortcuts become part of the Member App product.

#### 9. `/settings/onboarding` · `settings/onboarding/page.tsx`, `onboarding-form.tsx`
- Who: owner, admin, membership coordinator (gate `centerSettings`). Job: decide required/optional/hidden for 9 profile fields, and family-matching behaviour. Friction: the member app **does not read these yet** (page note), so the screen configures nothing in effect; name clash with Setup › Guided onboarding.
- Assistant: "Make employer optional" (WRITE, W1, rules patch `onboarding.fields.employer`); must also answer "does this take effect?" honestly ("recorded; the member app doesn't read it yet"). Rename to "Member profile questions" and fold into Membership product settings.

#### 10. `/settings/notifications` · `settings/notifications/page.tsx`, `notifications-form.tsx`
- Who: owner, admin, communications officer. Jobs: switch automatic messages on/off, set quiet hours, test a push. Pattern: table of 12 triggers with toggles (five are "Not sent yet" with no switch), global rules card, push devices, test send, recent pushes. Friction: some switches are live in the database (`app.notice_trigger`, quiet hours), others recorded-only; "Languages" shows templates on file.
- Assistant: "Stop lunch reminders" (WRITE, W1 → rules patch `notifications.triggers.lunch_reminder=false`, read by DB), "Quiet hours 10pm to 7am" (WRITE, W1), "Send me a test push" (WRITE, W1, `send_test_message`, no external recipient), "Why didn't the Smiths get the RSVP reminder?" (READ across `messages`, suppressions, quiet hours, trigger switch). Fresh: each trigger sits with the product that sends it (Event Weaver, Bolis, Store, Pathshala); Messaging product keeps quiet hours and channels.

#### 11. `/settings/security` · `settings/security/page.tsx`, `security-form.tsx`
- Who: owner (and `roles.manage` readers; saving needs `settings.manage`). Jobs: sign-in rules for members, 2FA for staff, session length. Friction: **two of four admin controls are policy-only** (session length, idle timeout, printed codes; says so in a hint at the bottom); 2FA-off is enforced by the database and needs a fresh check; phone sign-in is configured on Texting instead.
- Assistant: "Require 2FA for all staff" (WRITE, W2: security rule, step-up when turning off; first READ `team_security` and warn that staff without an authenticator will be locked into Account › Security), "Is anyone without 2FA?" (READ). Fresh: one Security page = rules + who has 2FA + phone sign-in; policy-only fields hidden until enforced.

#### 12. `/settings/payments` · `settings/payments/page.tsx`, `payments-panel.tsx`, `plugin-cards.tsx`, `change-control.tsx`, `actions.ts`, `change-actions.ts`
- Who: treasurer, owner, `integrations.manage`/`giving.manage`; second approver `giving.approve`. Jobs: connect Stripe or PayPal, test/live mode, default processor, statement descriptor, $1 test, Zelle/check/cash instructions, "offline only", payout sync, approve Zelle instructions, change where gifts go.
- Pattern: plugin cards (Card, Apple Pay, Google Pay, ACH, PayPal, Zelle, Check, Cash, wire, stock, DAF, matching gift), each with an on/off switch that opens a reason modal; "Changes to where gifts go" queue; "Ready to go live?" readiness. Friction: ~20 actions, each with its own reason; provider redirect for OAuth; Apple/Google Pay confirmed by word (`confirm_wallet_in_stripe`); `payee_change_queue`, `request_payee_change`, `decide_payee_change`, `payment_readiness`, `set_payment_plugin` are called through `untypedRpc` (not in generated types).
- Assistant: "Are we ready to take cards?" (READ: `payment_readiness`, `payment_settings`, plugin status). "Connect Stripe" (WRITE, **W2 + H**: `begin_payment_connect`, then a button to Stripe; the assistant cannot complete OAuth). "Turn on Zelle and tell members to send to giving@jsh.org" (WRITE, W2: `set_payment_method`; changing a saved address becomes a **two-person payee change**, the assistant files the request but never confirms it). "Switch Stripe to live" (WRITE, W2, `set_payment_mode`, step-up, reason). "Approve the Zelle change from Anita" (second person only, H-like: a deliberate click with 2FA and a reason in that person's own session).
- Fresh design: this is **Giving product settings** (or "Ways to give" inside the Giving card), a vertical checklist (Connect, Test, Go live) rather than 12 cards; the change-control queue stays prominent. Keep: no card data in the platform; donors covering fees is not offered (saved off, `p_donor_covers_fee_allowed=false`); money formatting; "a platform admin cannot confirm"; every change audited.

#### 13. `/settings/integrations` · `settings/integrations/page.tsx`, `vault-panel.tsx`, `background-service.tsx`, `step-up.tsx`, `actions.ts`
- Who: owner, treasurer, comms (`integrations.view/manage`). Jobs: see connected services, background service health, AI service health, virus scanning, vault secrets (add/replace/rotate/remove), secret-access log, queue a test job.
- Pattern: status hub (8 services; QuickBooks, payments, email, texting, WhatsApp, push link out), background service card with jobs table, vault table with fingerprints, access log. Friction: operational health mixed with credentials; 2 services are dead ends (F4); "Anthropic key source" text is developer information.
- Assistant: "Is QuickBooks connected?" / "Is the background service healthy?" (READ: `integration_connections`, `background_service_status`). "Rotate the Resend key" (WRITE, **W2 + H**: step-up and reason, the *value* is typed into a masked field that posts directly to `setSecretAction`; the assistant gets only "saved, ends 4f2a"). "Remove the old Twilio token" (W2, `revoke_integration_secret`). "Connect QuickBooks" (starts the connection in Accounting › QuickBooks setup, H for the Intuit redirect).
- Fresh: split into **System health** (read-only) and a per-product "Connections" panel. Keep: fingerprint-only display, access log, reason + 2FA for every secret change.

#### 14. `/settings/email` · `settings/email/page.tsx`, `actions` in `settings/messaging-actions.ts`
- Who: communications officer, owner (`messaging`; manage needs `settings.manage`/`integrations.manage`). Jobs: choose Resend or Postmark, add a sending domain, copy DNS records, set senders (auth, receipts, newsletters), footer with postal address, suppressions, test email.
- Pattern: five cards, DNS table with copy buttons, per-purpose sender forms. Friction: DNS is done elsewhere, then "Check again"; reason box optional (defaults silently: `reasonOf`); changing the provider re-adds domains.
- Assistant: "Set up email for mail.jsh.org" (WRITE, W2: `add_email_domain`; then READ the records and hand a copy-ready checklist for the DNS host, H for the registrar; recheck later). "Is our domain verified? What's missing?" (READ: `email_domains.dns_records[].status`). "Send me a test email" (W1, `send_test_message`). "Unblock bounced@x.org" (W2, `lift_message_suppression`, reason).
- Fresh: part of the Messaging product with a stepper (Domain, DNS, Senders, Footer, Test) and an assistant that re-checks DNS and tells you when it passes.

#### 15. `/settings/texting` · `settings/texting/page.tsx`
- Who: communications officer, owner. Jobs: register for US texting (10DLC brand + campaign or toll-free), phone sign-in on/off, STOP/HELP, quiet hours, suppressions, test text. Friction: one 12-field form with SMS segment counters; the legal name, EIN, website, email are prefilled from Legal identity but are entered twice conceptually; submission cannot be edited while carriers review; carrier answer takes days to weeks.
- Assistant: "Turn on texting" (the headline case): assistant reads `org_profiles`, drafts the registration (use case, three samples, opt-in text), shows the draft, saves (W1, `save_texting_registration` draft), then **submits only after W2 confirmation** (cannot be changed while reviewed), then schedules a status check. "Why are texts not going out?" (READ: registration status, `messages`, suppressions, quiet hours, sandbox recipients). "Turn off phone sign-in" (W2, security rule `security.phone_sign_in`).
- Fresh: Messaging product → Texting step with status timeline ("Submitted 3 Oct, carriers usually 5-15 days"). Keep: carrier status is relayed, never assumed.

#### 16. `/settings/whatsapp` · `settings/whatsapp/page.tsx`
- Who: communications officer, owner (module `comms` must be on). Jobs: WhatsApp Business account and number, message templates, test. Friction: IDs the user may not have ("if you have one"); Meta approval outside; template submission is a long form.
- Assistant: "Set up WhatsApp with 713-555-0100" (W2, `save_whatsapp_account`), "Submit a template announcing Diwali dinner" (W2, `submit_whatsapp_template`; the model drafts body text within Meta rules), "Is the template approved?" (READ). Fresh: Messaging product step; shows the 24-hour window rule in context.

#### 17. `/settings/agreements` · `settings/agreements/page.tsx`
- Who: owner only to accept; others read. Job: read and accept the org terms, DPA, children's addendum, order form or sandbox terms. Friction: legal text in a `<details>`; go-live check shown above.
- Assistant: "Which agreements are still open?" (READ, `org_agreement_status`) and a link to the exact card. **Acceptance stays H**: a deliberate human act that records who, version, time, IP and browser (`accept_org_agreement`); an assistant-originated request would record the wrong IP. Fresh: keep a dedicated, quiet page; surface in Setup as a blocker.

#### 18. `/settings/privacy` · `settings/privacy/page.tsx`, `actions.ts`
- Who: privacy officer (`privacy.manage`). Job: work data requests (export, delete, deactivate, reactivate), due 30 days. Pattern: tabs, table, per-row "Start / Finish / Reject"; export path pasted by hand. Friction: states flip with direct `data_requests.update` (state machine in TS `MOVES`), no reason box on Reject although the confirm says "the member should be told why", completing a deletion does not delete (policy card says the privacy service produces it), legal holds "not tracked in the app".
- Assistant: "What privacy requests are overdue?" (READ), "Start Raj's export" (W1, status `in_progress`), "Complete the deletion for X" (W2/H: destructive and consequential; assistant must say the app only records the decision unless the privacy service ran, and add reason). Fresh: one request timeline per person with the household card; automatic status from the privacy service; reject requires a message to the member.

#### 19. `/settings/audit` · `settings/audit/page.tsx`
- Who: owner, admin (`audit.view`). Job: see who changed what. Pattern: chip filters, filter form (module, app, table, record, reason, date), table with before/after; "Export log" disabled (no `data.export`). Friction: hard to ask "who turned off the store?" without knowing table names (24 listed in `TABLES`).
- Assistant (best READ case): "Who changed the Zelle details last week?" / "What did Anita change today?" (READ: `audit_log` filtered, `app.record_history(table, record_id)`, respecting masks and `audit.view`). Answers cite entries with links. No confirmation. Fresh: the log as the "what happened" footer of every product plus the assistant for questions; keep tamper-evident, masked fields.

#### 20. `/settings/support-access` · `settings/support-access/page.tsx`, `actions.ts`
- Who: owner only. Job: give a Weaver person time-boxed access, end it. Pattern: grant form (who, how long up to 720 hours, reason), grants table. Assistant: "Give Weaver support access for 24 hours to help with the Neon import" (WRITE, **W2 + step-up**, `grant_support_access`, owner only), "Who from Weaver has access now?" (READ). Fresh: surface as a banner when Weaver is in your account; ending it one tap. Keep: audited, time-boxed.

#### 21. `/settings/limits` · `settings/limits/page.tsx`
- Who: owner, admin. Jobs: see plan/sandbox limits and usage; manage sandbox test recipients (up to 10, verified by code). Friction: limits set by Weaver ("Ask Weaver to change"), test recipients table of mixed forms; `sandbox_test_recipients` insert/delete direct, no reason.
- Assistant: "How many people can we add?" (READ, `center_entitlement_list`), "Add tester sam@x.org for email" (W1) then "Send the code" (W1) and the human reads the code back (H to verify). "Ask Weaver to raise the limit" → a request message (needs a request channel). Fresh: limits appear on product cards (Marketplace phase 2 prices and trials), test recipients inside Messaging.

#### 22. `/settings/numbering` · `settings/numbering/page.tsx`, `actions.ts`
- Who: owner/admin during setup. Jobs: member/household/pledge/order/receipt/event prefixes and next numbers; declare legacy ID systems. Friction: a number once used can only go up (database refuses to go back) yet the form looks freely editable; "next looks like" preview is client-side string concat; legacy systems typed as `System | label` lines; saving marks the Setup step done even with no change (F7).
- Assistant: "Our old member numbers go up to 3,820, continue from there" (WRITE, **W2**: irreversible upward, `save_numbering(items, reason)`), "What does our next receipt number look like?" (READ, `numbering_overview`). Fresh: a one-time setup question inside Setup (never a standing screen), with the irreversible warning.

#### 23. `/settings/storage` · `settings/storage/page.tsx`, `actions.ts`
- Who: owner/admin. Jobs: see storage areas, usage vs plan, virus scan state, set retention days for import files, recordings, homework answers. Friction: read-heavy; retention per area is a mini-form per row; saving marks the Setup step reviewed.
- Assistant: "How much storage are we using?" (READ, `center_storage_overview`), "Keep import files 30 days" (W1, rules patch `storage.retention_days.<bucket>`; files older than that are deleted by the daily job: confirm as W2 when shortening). Fresh: storage line on each product that holds files; "Files and retention" under System.

#### 24. `/settings/custom-fields` · `settings/custom-fields/page.tsx`, `custom-fields-form.tsx`, `actions.ts`
- Who: owner, admin, membership coordinator. Jobs: add or edit fields on people, households, memberships, pledges, payments, store items, events, classes; choose who sees it (staff / member self / directory) and searchable. Friction: fields created by import start staff-only "until someone reviews them"; "Directory" exposes data to members; archive is the only removal.
- Assistant: "Add a 'Senior status' yes/no on people, staff only" (W1, `define_custom_field`), "Make 'Dietary note' visible in the directory" (W2: visibility widened to members), "Which fields came from the Neon import?" (READ, `source_import_run`). Fresh: fields live on each record type's product (People core, Giving, Store) and in the import mapping step.

#### 25. `/settings/data-quality` · `settings/data-quality/page.tsx`
- Who: membership coordinator, admin (`people.view/manage`). Jobs: find households nobody can reach, likely duplicates, children without a birth date, missing consent, bad emails and phones; coverage target.
- Pattern: five KPI tiles and six cards of up to 25 rows, with links to compare/merge. Friction: no fixes inline; coverage target is edited elsewhere (`onboarding.contact_coverage_target` in Advanced JSON).
- Assistant (strong READ plus guided WRITE): "Who can't we reach?" (READ, `data_quality`), "Fix the invalid emails" → walk through each with household card, W1 edits via people tools; "Merge the Shahs" → opens `/people/merge?person=…&other=…` for a human **W2** (merges need step-up). Fresh: a "Tidy-up" queue in People with one decision at a time, and the assistant working through it.

#### 26. `/settings/import` · `settings/import/page.tsx` (+ `template/[entity]/route.ts`)
- Who: treasurer, membership coordinator, admins (`dataImport`, per-entity write permission). Job: load data in order (setup, records, history), see last run per type, download templates. Pattern: three tiers table (Data, last import, CSV/Excel/Columns template, action). Friction: the order is explained, not enforced; runs list is only the latest per type; names "Data import" vs "Guided onboarding".
- Assistant: "Import last year's donations from this QuickBooks file" starts a run (see 27); "What have we imported so far?" (READ, `import_run_list`); "Get me the people template" (READ, link). Fresh: "Bring in your data" panel on each product (the registry already tags each entity with `module`).

#### 27. `/settings/import/new` · `settings/import/new/page.tsx`, `new/wizard.tsx`, `steps.tsx`, `actions.ts`
- Who: as above. Job: upload, map, check, preview, import one file. Pattern: browser-side wizard (`readFile`, mapping UI, `buildRow` checks, 250-row chunk loop of `stageRowsAction`, then navigate to the run). Friction: the file is parsed in the browser; AI mapping goes through the worker queue (`requestAiMappingAction` then polling `aiMappingResultAction`); extra columns become custom fields (decision hidden in the mapping table).
- Assistant: "Import this spreadsheet as pledges" → server-side tools `import_create_run`, suggest mapping (existing AI mapping), `import_stage_rows`, `import_preview`; the model sees headers, counts, and masked samples only. READ for preview counts; staging is W1; **commit is W2** (shows counts: add, update, no change, needs decision, errors). Needs: the parse/map/check/stage loop moved into a server-callable function (the code is isomorphic TS in `src/lib/import`, but the loop is driven by the client component).
- Fresh: a conversational import ("Which system is this from? I mapped 14 of 16 columns; two look like custom fields: keep them?") with the same plain-English problems file.

#### 28. `/settings/import/[id]` · `settings/import/[id]/page.tsx`, `run-controls.tsx`, `problems/route.ts`
- Who: as above. Jobs: review preview, decide look-alike rows, import (100-row batches driven by the page), reconcile totals with the file, sign off, bring in opening balances, undo within 30 days, download problems. Friction: five stats, three ordered buttons, rows table with decisions; undo needs step-up and a reason but returns text rather than the modal (F3).
- Assistant: "How did the import go?" (READ), "Explain the 12 errors" (READ problems; plain-English), "Add row 41, skip row 47" (W1, `import_decide`, show household card of the look-alike), "Import them" (W2), "Sign it off" (W2: the data owner signs, `import_sign_off`), "Undo import 7" (**W2**, `import_undo`, reason + step-up). Opening balances are money history (cents): W2.
- Keep: nothing posts to QuickBooks from history; undo reports values changed since.

### Setup

#### 29. `/setup` (checklist) · `setup/page.tsx`, `actions.ts`, `_components/setup-ui.tsx`, `_components/demo-card.tsx`
- Who: owner mainly (`settings.manage`); owners per step (treasurer, comms). Job: work the 54-step, 9-stage list from sandbox to live (org foundation, services, templates, setup data, records, history, Niva, test, go-live). Pattern: four KPIs, demo-data card, one table per stage; each step opens a drawer for status, owner, due date, notes; "Open" links to the screen; some steps are checked automatically, some manual, some "Coming soon" or "Off-screen". Friction: the checklist mostly **points at** Settings screens; progress is partly derived (`auto`) and partly typed; owners and dates are per-step forms.
- Assistant (the centrepiece): "What's left before go-live?" (READ: `setup_checklist` + `readiness`, grouped by who and by wait time), "Assign the email step to Dev, due Friday" (W1, writes `center_setup_steps`; bulk "assign all stage 1 steps"), "Do the next step with me" (opens the right screen's plan). Risk: stage 8 requests are H.
- Fresh: **Launch plan**, filtered by the enabled products (`setup_steps.module_key` already exists and steps of an off module are skipped); the Marketplace adds "Choose your products" as step 0 (plan M3). The assistant owns the plan; the table remains as the visual audit of it. Keep: owner, due date, notes, audit; "Done means" text.

#### 30. `/setup/organization` · `setup/organization/page.tsx`, `irs-result.tsx`
- Who: owner. Jobs: legal name, EIN, entity type, state, registered address, authorized signer; upload W-9 and IRS letter; check against IRS; submit for Weaver verification. Pattern: form, IRS lookup card (`irs_lookup`), documents table with signed URLs, submit card with blockers. Friction: changing name/EIN/type after review sends it back; documents upload one at a time.
- Assistant: "Check our EIN against the IRS" (READ, `irs_lookup`), "What do I still need to submit?" (READ, `verificationBlockers`), "Our signer is Anita Shah, President" (W1, `saveLegalIdentityAction`: warn that it resets verification if already reviewed → W2 then), **uploads and "Submit for verification" are H/W2**. Fresh: a chat-led interview that fills the form and asks for the two files.

#### 31. `/setup/profile` · `setup/profile/page.tsx`, `brand-colors.tsx`
- Who: owner. Jobs: display name, short name, time zone, currency, fiscal year, mission/about, contacts, office hours, socials, languages, map pin; brand logos and colours with a readability check and preview. Friction: **time zone and currency are edited here** as part of "Profile" (`saveProfileAction` updates `centers`), and brand colours exist twice (F2); map pin lat/long typed numerically (a map preview exists).
- Assistant: "Our address is 123 Temple Rd, Houston" (W1; geocode to the pin, ask to confirm the pin), "Make the primary colour our logo's blue" (READ the logo, propose; W1 `set_center_branding`; readability check shown), "Change currency to CAD" (**W2**: affects every money display; cents unchanged). Logo upload is H.
- Fresh: Organization → Identity: one brand editor with the preview; time zone and currency as a deliberate "Region" card.

#### 32. `/setup/leaders` · `setup/leaders/page.tsx`, `leader-fields.tsx`
- Who: owner. Jobs: add key leaders (President, Secretary, Treasurer, EC, trustees) with terms, photos; link to a person record. Pattern: table + drawers; photo upload. Friction: linking needs the person search (`searchLeaderPeopleAction`, household cards required).
- Assistant: "Add Ravi Mehta as Treasurer from Jan 2026 to Dec 2027" (W1, `org_leaders` insert; resolve Ravi with household card). Note: leaders are display records, not roles; the assistant must offer, not do, a role grant ("Make him the treasurer role too?" → Roles flow, W2).

#### 33. `/setup/lists` · `setup/lists/page.tsx` (860 lines), `actions.ts`, `dietary-actions.ts`
- Who: owner/admin (`settings.manage`), treasurer for funds (`giving.manage`), principal for Pathshala tracks. Jobs: membership types (tier, fee, period, voting wait, reference and approval rules), funds (restricted flag), inboxes (response target), zones (ZIPs), Pathshala tracks, dietary options. Pattern: six cards each with a table and add/edit drawer; deactivate instead of delete. Friction: membership fee and fund restriction are **money rules** edited as plain table fields; direct inserts/updates by TS parsers (`parseMembershipType`, `dollarsToCents`); optional reason; one page for six unrelated modules.
- Assistant: "Add a Youth membership at $25 a year, no voting for 90 days" (WRITE, **W2** because fee_cents = 2500 and voting rules), "Create a Building Fund, restricted" (W2), "Add zone Katy for 77494 and 77449" (W1), "List our membership types" (READ). Fresh: each list moves to its product (Membership: types; Giving: funds; Messaging: inboxes; People: zones; Pathshala: tracks; Store: dietary).

#### 34. `/setup/readiness` · `setup/readiness/page.tsx`, `readiness-table.tsx`
- Who: owner, treasurer (read). Job: see the 13 go-live checks (plus background service) with evidence and what's missing. Pattern: three KPIs, one table with links; "not built yet" rows confirmed by Weaver by hand. Friction: checks are generic; no sequence.
- Assistant: "Why can't we go live?" (READ: `readiness`), then "Fix the first one" → opens the owning plan (Team 2FA, Agreements, Payments readiness…) with the exact missing item. READ only; no confirmation. Fresh: same checks, grouped by product ("Giving: ready; Texting: waiting on carrier").

#### 35. `/setup/go-live` · `setup/go-live/page.tsx`, `actions.ts`
- Who: **owner only**. Jobs: confirm test/train/pilot attestations, request go-live, wait for Weaver approval, "Go live in place" or "Promote to production". Pattern: three KPIs, attestation list with notes, request card, promote card with reason. Friction: irreversible, high-stakes steps use the same form idiom as a settings tweak.
- Assistant: "How close are we?" (READ). Attestations, the request and the promote button are **H** (legal statements and an irreversible environment change after which messages reach real members). The assistant can pre-fill the reason and show the blockers.
- Fresh: a ceremony page (summary of what changes, who approves) – not a form among forms.

#### 36. `/setup/demo` · `setup/demo/page.tsx`, `actions.ts`
- Who: owner/admin in a sandbox only. Jobs: load a demo pack, reset, clear. Pattern: KPI row, scope alert, progress with auto-refresh, forms with typed confirmation word and reason; step-up for deletes. Assistant: "Load the demo community" (W2: `activate_demo_pack`, reason), "What demo data is in here?" (READ, `demo_data_counts`). **Clear and reset are H** (type the short name; `clear_sandbox`/`reset_sandbox` with step-up; warns if the sandbox holds the organization's own records). Fresh: one "Practice with demo data" toggle in Marketplace/Setup for sandbox.

#### 37. `/setup/onboarding` · `setup/onboarding/page.tsx`, `wizard.tsx` (917 lines), `dataset-step.tsx`, `review-step.tsx`, `decisions.tsx`, `actions.ts`, `template/route.ts`
- Who: owner, treasurer, membership coordinator (`dataImport`; donations need `giving.manage`, people need `people.manage`). Job: seven steps (Welcome, Past donations, Members, Rest of family, Households, Create, Done) to load past gifts and families, matching payers into households with as few questions as possible. Pattern: browser wizard with save/resume (`onboarding_start/save/close`, rows in `onboarding_rows`, version-checked), merge/keep-separate questions, then Create runs numbered import runs. Friction: orchestration and matching (`src/lib/onboarding/match.ts`, `donations.ts`, `create-flow.ts`) are pure TS but driven by the browser; closing the tab leaves a half-made state (resumable by design); questions show both records; it is a second importer next to Data import.
- Assistant (natural fit: already "one question at a time"): "Load our donations from this Neon export" (upload), "Are Raj Shah and Rajesh Shah the same family?" (the existing question card with household cards; **Merge / Keep separate** is a W2 each because merges are hard to reverse, undoable per run), "Create them" (W2, shows counts). Needs: matching and Create orchestration callable server-side with the user's session (no service key), progress in `onboarding_progress`.
- Fresh: the assistant runs this as its first-class flow; the wizard remains as the visual review of questions, counts, and undo. Keep: names never match alone, stable `ONB-xxxxxx-H-00001` IDs, 90-day cleanup, personal data not logged.

---

## E. Folding Settings and Setup into the Marketplace and an assistant-run setup

**Four core areas, not 24 tabs** (core = not products, per MARKETPLACE_PLAN): **Organization** (Setup profile, legal identity, brand, leaders, numbering, custom fields, storage, import, data quality), **People and access** (Team, Roles, Security, Access levels, Agreements, Support access, Privacy), **Marketplace** (products and their settings), **System and trust** (Audit, Integrations health, Limits).

**Where each current screen goes**

| Product (Marketplace) | Settings that move into its card |
|---|---|
| Giving (+Bolis) | Payments page, Rules › Giving and Bolis, Setup › Lists › Funds, Receipts approval, payment imports |
| Accounting and QuickBooks | Integrations QuickBooks row, bank accounts, `svc.quickbooks`, `svc.bank_accounts` steps |
| Event Weaver | Rules › Lunch and RSVP, event templates, notification triggers for RSVP and lunch |
| Digital Store | Rules › Store, dietary options, store imports, store notification |
| Newsletters and Messaging | Email, Texting, WhatsApp, Notifications, inboxes, suppressions, test recipients |
| Membership | Rules › Membership, membership types, onboarding fields, access ladder, reference rules |
| Pathshala / Gyan Path / My Jain Way | tracks, points rules, homework retention |
| Niva | Content › Niva sources and go-live approval |
| Member app (core) | join code, Home shortcuts, branding |

Existing hooks that make the fold cheap: `setup_steps.module_key`, `import registry` entity `module`, access features `moduleKey`, notification triggers keyed to modules, `category_modules` for kinds. Not present yet: `app.products` / `app.center_products` (not in migrations through 0614), so every card above is a design target.

**Assistant-run setup.** The 54-step checklist becomes the assistant's plan (steps already have owner, due date, status, auto/manual, `done_means`). Per product it reads the readiness checks, asks one question at a time, fills forms from known facts (legal identity → texting registration; profile → WhatsApp display name; leaders → roles), schedules provider waits ("carrier answer expected ~10 days"), and reports. It never completes the **H** steps (secrets, agreements, attestations, go-live, DNS, uploads, typed clears); it prepares them. Resume state lives where it already does (`center_setup_steps`, `onboarding_progress`).

**What must stay visual**: the diff/confirm card, role and permission matrix review, household cards and merge compare, the vault and secret entry, the audit log, readiness evidence, Zelle change-control queue, DNS records table, import preview and reconcile totals, brand preview, the go-live ceremony.

---

## F. Things in the code that would block an assistant (summary)

1. No synchronous agent runtime. Anthropic is called only from the background worker through queued jobs (`niva.answer`, `import.suggest_mapping`, `qbo.match_suggest_ai`; `src/lib/ai-service.ts`). Niva reads only approved `niva_source` content, not tables (BACKLOG B14). The admin assistant needs a portal-server tool loop running with the user's cookie client and its own key handling.
2. Rules live in TypeScript, not RPCs: `writeCenterRules` (read-modify-write with a version predicate), `validateRulesJson`/`RULE_CHECKS`, `applyRulesPatch`, `parseSection` (`src/lib/data/center-rules-write.ts`, `src/lib/center-rules.ts`, `src/lib/settings-rules.ts`). The database only sees an update to `centers.rules`; type and range checks are not in Postgres except keys it reads. Same for: role grant/revoke (direct `role_grants` insert/update; dup check, tier refusals, end-of-day maths), Setup lists (`parse*`, `dollarsToCents`, direct inserts/updates), `center_setup_steps` upsert, `org_profiles`/`centers` profile update, `org_leaders`, `data_requests` transitions, `sandbox_test_recipients`, branding/feature flags (`centers.update`, no version).
3. Orchestration in the browser: Data import wizard (file parse, mapping, 250-row staging loop, 100-row commit loop), Guided onboarding (matching, file builders, `runOne` sequencing), step-up (`StepUpProvider` promise flow), payments redirects. Pure TS is portable, but the drivers are client components.
4. No single registry of risk, reason, step-up and two-person flags per action; confirm text is composed in components.
5. Reads are ad hoc selects in `page.tsx`; only some have status RPCs (`module_states`, `setup_checklist`, `readiness`, `data_quality`, `center_storage_overview`, `numbering_overview`, `payment_settings`, `payment_readiness`, `team_security`, `background_service_status`, `org_agreement_status`, `import_run_list`, `demo_data_counts`, `center_entitlement_list`). Roles/grants, messaging status (four tables), privacy requests, audit filters and access settings need a read model.
6. Several RPCs are called through `untypedRpc` and are not in `database.types.ts` (`set_payment_plugin`, `request_payee_change`, `decide_payee_change`, `cancel_payee_change`, `payee_change_queue`, `payment_readiness`, `approve_zelle_instructions`, `confirm_wallet_in_stripe`), so tool schemas cannot be generated from types for the most sensitive area.
7. Delivery channels are missing: invitations and the PayPal email code cannot be sent by the platform yet; there is no notification to a second approver.
8. Secrets and one-time links pass through client forms into Server Actions; the assistant needs an out-of-band masked input and reveal-once cards so they never enter chat context.
9. Recorded-only settings (A8) and "Not sent yet" rows: the assistant needs a registry of which settings are enforced, or it will overpromise.
10. Agreement acceptance reads IP and user agent from headers of the request; an assistant-driven call would record the server's.
