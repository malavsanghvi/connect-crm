# Admin setup audit (organization admin, sandbox → go-live)

Onboarding Wave D, stream o-golive, 2026-09-24. The question: does the admin of a customer
organization have every setup screen they need — branding, setup, roles, permissions,
everything — and can they walk the Setup checklist to go-live without help?

How this was checked:
- A fresh organization was created the way a real one is (request → Community Connect approval →
  `/start` redemption) on a local stack, and its owner opened every screen the checklist and
  Settings link to (`e2e/flows/o-golive.cjs`, with `EXPLORE=1` it also dumps each screen).
- The same flow then walks the checklist through the UI, with the providers mocked, until all
  readiness checks pass and the go-live request succeeds. Steps marked **e2e** below are
  driven through the UI in that flow and asserted in the database (rows and audit rows).
- Screens the flow does not drive were read in code and opened as the owner; the other Wave A/B
  streams' flows cover them (named per row).

Status words: **Works** — built and working. **Built now** — missing or broken before this
stream, built or fixed here. **Honest limit** — works, and the screen says plainly what is not
connected yet. **Not built** — says why. **Owner decision** — waits for a rule only the owner sets.

## Setup areas

| Area | Route | Who | Status | Notes |
|---|---|---|---|---|
| Setup checklist (stages 0–8, owner, due date, notes, computed status) | `/setup` | settings.manage / owner | Works · Built now | Every step now opens a working screen (no "Coming soon", no "Off-screen"). More steps now compute their status from real data (2FA, team, agreements, vault, email, texting, WhatsApp, push, QuickBooks, storage, statements approval, imports, Niva, confirmations, go-live request). "Live" steps never show a stale stored "done" (migration 0302). **e2e** |
| Organization legal identity + non-profit documents + IRS lookup + submit for verification | `/setup/organization` | owner / settings.manage | Works | Verified by Community Connect in `/platform/verification`. **e2e** |
| Profile (mission, public contact, map pin, languages, time zone, short name) | `/setup/profile` | settings.manage | Works | **e2e** |
| Brand kit (horizontal logo, square mark, dark logo, email header, colors + contrast check) | `/setup/profile#brand` | settings.manage | Works | Logos are uploaded to the public `branding` store. **e2e** (logo, colors) |
| Key leaders | `/setup/leaders` | settings.manage | Works | Mirrored to the guide's Administration roster. **e2e** |
| Modules (18 switches, reason, fresh 2FA) | `/settings/modules` | settings.manage | Works | **e2e** (seven switched off) |
| Rules (membership, giving, bolis/store, lunch, points, branding, advanced JSON) | `/settings/rules` | settings.manage | Works | Saves are versioned; "Save" stays "No changes" until something changes — to accept the defaults, mark the step done in the checklist. |
| Membership types (tier, fee, period, reference / EC rules, voting wait) | `/setup/lists#membership` | settings.manage | **Built now** | No screen created them before (only Data import). Switch off instead of delete. **e2e** |
| Funds (restricted or not) | `/setup/lists#funds` | giving.manage (treasurer) | **Built now** | No screen created them before. **e2e** |
| Campaigns | `/giving/opportunities/campaigns` | giving.manage | Works | **e2e** |
| Inboxes | `/setup/lists#inboxes` | settings.manage | **Built now** | **e2e** |
| Zones and ZIP codes | `/setup/lists#zones` | settings.manage | **Built now** | **e2e** |
| Pathshala tracks | `/setup/lists#pathshala` | pathshala.manage | **Built now** | Terms stay in `/pathshala/terms`. |
| Numbering (member, household, pledge, order, receipt, event prefixes and next numbers) + identifier systems | `/settings/numbering` | settings.manage | **Built now** | A number already issued is never issued again (the database refuses to go back, in words). **e2e** |
| Roles and permissions: role definitions view (every role with its entitlements), grant, revoke, two-person approval | `/settings/roles` | roles.manage | Works | **e2e** (the second admin approves the treasurer). Custom roles: **Owner decision** (roles are shared by every center). |
| Team invitations (email or mobile, roles, resend, withdraw), 2FA reset, ownership transfer | `/settings/team`, `/invite/<token>` | roles.manage / owner | Works · Built now | Invited staff now open the portal on the inviting organization (it opened on the default one). **e2e** |
| Security (staff 2FA policy, admin session length and idle timeout, printed sign-in codes) | `/settings/security` | settings.manage | Works | o-security flow. |
| Agreements (terms, DPA, children's addendum; sandbox terms at `/start`) | `/settings/agreements` | owner | Works | **e2e** |
| Member app: join code (rotate, expiry), QR poster | `/settings/member-app` | settings.manage | Works · Honest limit | The web link needs the `MEMBER_APP_URL` repository variable (says so). The app's look comes from the brand kit. |
| Notifications (automatic messages, quiet hours) | `/settings/notifications` | settings.manage | Honest limit | Saves the rules; the page says the automatic sender is not switched on yet. Test push lives here (o-messaging). |
| Onboarding fields | `/settings/onboarding` | settings.manage | Honest limit | Saves the rules; the page says the member app does not read them yet. |
| Custom fields | `/settings/custom-fields` | settings.manage | Works | o-import flow. |
| Payments: Stripe / PayPal (test mode in a sandbox), $1 test, offline-only, offline methods with instructions, payouts | `/settings/payments` | giving.manage / integrations.manage | Works | **e2e** (offline only + cash); o-payments flow covers Stripe/PayPal with mocks. |
| Email: domain + DNS records, re-check, senders, footer, test send | `/settings/email` | settings.manage / integrations.manage | Works | **e2e** (Resend mock). |
| Texting: 10DLC / toll-free registration, phone sign-in switch, test text | `/settings/texting` | same | Works | **e2e** (phone sign-in off); o-messaging covers registration. |
| WhatsApp Business record + template submission | `/settings/whatsapp` | same | Honest limit | Recorded as "pending Meta approval"; the Meta connection itself is not built (G35, P2). |
| Push (Expo) | `/settings/notifications` | same | Works | Test push via o-messaging. |
| Sandbox test recipients (verified by code) and limits | `/settings/limits` | settings.manage | Works | **e2e** |
| Credential vault, background service, secret fingerprints | `/settings/integrations` | integrations.* | Works | o-vault flow. |
| QuickBooks: connect, pull lists, basis/posting/go-live date, mapping approval, test post, donor matching | `/accounting/qbo/setup`, `/accounting/qbo/matching` | accounting.manage | Works | o-quickbooks / o-qbo-match flows (Intuit mock). |
| Bank accounts | `/giving/payments/bank` | accounting.manage (treasurer) | Works | **e2e** |
| File storage: the nine areas, who reads each, file limits, this organization's usage vs its plan, retention of import files and recordings | `/settings/storage` | settings.manage | **Built now** | Saving a retention choice marks the step reviewed. Children's-photo consent retention (✱ in the plan) is not configurable. **e2e** |
| Data import (every data type; map, check, preview, import, reconcile, sign off, undo) | `/settings/import` | per data type | Works | **e2e** (households, people, memberships, pledges, payments). |
| Data quality | `/settings/data-quality` | people.view | Works | o-import flow. |
| Member legal documents (terms, privacy, photo policy, waivers; versions, publish) | `/content/legal` | content.manage | Works · Not built (templates) | **e2e**. Community Connect base texts to start from do not exist yet; each organization writes its own. |
| Guide sections | `/content/guide` | content.manage | Works | **e2e** |
| Receipt and year-end statement templates + the treasurer's approval (readiness 8) | `/giving/statements` | giving.manage / treasurer | Works · **Built now** (approval) | Statements from an uploaded sample are deferred by the owner; the approval covers today's templates and says so. **e2e** |
| Niva sources + the administrator's approval (readiness 12) | `/content/niva` | content.* / settings.manage | Works · **Built now** (approval) | The Niva training workflow is deferred by the owner; the approval covers today's sources and says so. DB test 28. |
| Message templates | `/settings/email` (built-in library) | — | Not built (deferred) | Communications › Templates is deferred by the owner. The step now points to the email test send and says the editor comes later. |
| Owner confirmations (staff trained, health check, pilot), go-live request, promotion | `/setup/go-live` | owner | Works | **e2e** (request). Packaged health check (G32) not built. |
| Go-live readiness (13 checks + background service) | `/setup/readiness` | settings.manage | Works · Built now | All 13 registered and honest (below); each row links to where it is fixed. **e2e** (all 14 pass) |
| Support access (owner's time-boxed consent) | `/settings/support-access` | owner | Honest limit | A consent record only; enforcing it is backlog B1 (owner decision). |
| Privacy (data requests, consents) | `/settings/privacy` | privacy.manage | Works | The owner (center admin) needs the Privacy officer role to open it, by design. |
| Audit log | `/settings/audit` | audit.view | Works | |

## The 13 readiness checks

| # | Check | Registered by | Honest? |
|---|---|---|---|
| 1 | Non-profit verified | o-setup | Yes: only Community Connect's verification passes it. |
| 2 | Agreements accepted | o-security | Yes: current version of each required agreement, by the owner. |
| 3 | Owner + second admin, both with 2FA | o-security | Yes. |
| 4 | Email domain verified, codes reach any address | o-messaging | Yes: verified domain, verified sender, a delivered test after verification. |
| 5 | Texting registered or phone sign-in off | o-messaging | Yes. |
| 6 | Payments | o-payments → **o-golive** | **Fixed**: a sandbox cannot charge in live mode, so it could only pass with "offline only". In a sandbox it now passes on a passing *test-mode* $1 charge and refund of the default processor, and says in words that live mode is connected in production after promotion. Production is unchanged. |
| 7 | QuickBooks ready or not used | o-quickbooks | Yes. |
| 8 | Statement and receipt templates approved | **o-golive (new)** | The treasurer's approval (active Treasurer role, not a platform admin) with a fingerprint of the templates; any later change fails the check until re-approved. Passes with Giving off. Says the full version comes later. |
| 9 | Setup data complete | o-setup | Yes; now also counts accepted payment methods (Giving on) and the QuickBooks chart of accounts (Accounting on). |
| 10 | Records imported and reconciled | o-import → **o-golive** | **Fixed**: passed with no import at all once the redeemer's own household existed. Now needs a reconciled, signed-off household or people import. |
| 11 | Member legal documents published | o-setup | Yes. |
| 12 | Niva content approved, or Niva off | **o-golive (new)** | An administrator's approval with a fingerprint of the published sources; any later edit fails it until re-approved. Says the full evaluation comes later. |
| 13 | Staff trained, health check, pilot | o-platform | Yes (the owner's confirmations). |
| 14 | Background service running | o-vault | Extra, kept: go-live needs it. |

The registry is now in plan order (sort 1–13, background service 14).

## Needs owner decision

1. **The first second administrator needs Community Connect.** An organization's first extra
   administrator is invited by the owner, so neither the owner (granter) nor the invitee
   (grantee) may approve it under the two-person rule; only a platform admin can. The e2e does
   this in the organization's Settings › Roles as a Community Connect admin. Options: an
   explicit platform approval screen, or letting an accepted invitation from the owner count as
   the first approval (related to backlog B5).
2. **Custom roles** (the Roles page's "Clone as custom" is off): roles are shared by every
   center; per-center roles need a schema and permission decision.
3. **Community Connect base texts for member legal documents** (terms, privacy, photo policy,
   waivers) — legal wording the owner must supply.
4. **Children's-photo consent retention** and other ✱ storage choices beyond imports and
   recordings — the rule for each.
5. **Center admins cannot do giving, accounting or privacy setup** without the Treasurer or
   Privacy officer role (existing role design). Small organizations need three people for a
   treasurer under the two-person rule. Confirm this is intended.

## Not built here (and why)

- Communications › Templates editor, statements from a sample, Niva training — deferred by the owner.
- Packaged sandbox health check (G32), panchang source (G31), WhatsApp via Meta (G35),
  background checks (G37), billing (G34) — later milestones in ONBOARDING_PLAN §11.
- The member app does not read the onboarding-fields rules yet (the portal says so).
