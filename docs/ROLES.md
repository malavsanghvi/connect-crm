# Roles and permissions

Access = **role + scope + relationship**, checked by the database on every
request (RLS), never only in an app. Role catalog and permission strings are
seeded in `supabase/seed.sql`; centers can rename, switch off, or clone roles.

## How a check works

| Mechanism | Helper | Used for |
|---|---|---|
| Center-wide permission | `app.has_permission(center, 'module.action')` | Staff roles granted with scope `center` |
| Scoped role | `app.has_scoped_role(center, scope_id, 'teacher', ...)` | One class, event, zone, campaign |
| Household relationship | `app.in_my_household`, `app.adult_of_household`, `app.can_act_for_person`, `app.same_household_person` | Members acting for themselves and their family |
| Platform | `app.is_platform_admin()` | Platform team only; support access is time-limited and audited |

Scoped grants never leak center-wide rights: `has_permission` ignores them.
Time-bound roles expire automatically via `role_grants.ends_at` (event-day
volunteers until midnight; EC roles at term end). Delegation is a grant with
`delegated_from` set.

## Permission strings

| Module | Permissions |
|---|---|
| People | `people.view`, `people.manage`, `people.approve` |
| Events | `events.view`, `events.manage`, `events.confidential` |
| Giving | `giving.view`, `giving.manage`, `giving.approve`, `giving.record_offline` |
| Accounting | `accounting.manage`, `accounting.close` |
| Bolis | `bolis.view`, `bolis.manage`, `bolis.record` |
| Store | `store.view`, `store.manage`, `store.pickup`, `kitchen.view` |
| Content | `content.view`, `content.draft`, `content.manage`, `content.approve` |
| Communications | `comms.view`, `comms.send`, `comms.approve`, `comms.inbox` |
| Pathshala | `pathshala.view`, `pathshala.manage`, `pathshala.teach` |
| Governance | `governance.view`, `governance.manage`, `governance.vote` |
| Volunteers / safety | `volunteers.view`, `volunteers.manage`, `safety.view`, `safety.manage` |
| Platform | `settings.manage`, `roles.manage`, `audit.view`, `integrations.view`, `integrations.manage`, `privacy.manage`, `reports.view` |

## Default roles

| Tier | Role key | Scope | Responsible for |
|---|---|---|---|
| Platform | `platform_owner` | Platform | Center creation, billing, global settings |
| Platform | `platform_support` | Center, time-limited | Troubleshooting with center approval |
| Platform | `content_curator` | Tradition packs | Shared religious content, Gyan Path templates |
| Center | `center_admin` | Center | Configuration, roles, integrations |
| Center | `executive_viewer` | Center | Dashboards and reports, read-only |
| Center | `treasurer` | Center | Giving, payments, refunds, statements, reconciliation, QuickBooks, month close |
| Center | `finance_volunteer` | Center | Record offline payments and reconcile bank lines; no refunds |
| Center | `membership_coordinator` | Center | Households, memberships, identifiers, verification, eligibility |
| Center | `religious_coordinator` | Center | Bolis, pujans, practice catalog, calendar, religious content approval |
| Center | `communications_officer` | Center | Announcements, newsletters, templates, WhatsApp queue, inboxes |
| Center | `content_editor` | Center | Guide, pages, photos, translations (draft only) |
| Center | `privacy_officer` | Center | Data export and deletion requests |
| Center | `volunteer_coordinator` | Center | Volunteer groups, shifts, waivers, background checks |
| Operational | `event_lead` | One event | Event setup, attendees, lunch, volunteers |
| Operational | `checkin_volunteer` | One event, event day | Scan, walk-ins, stations; no giving data |
| Operational | `kitchen_lead` | Center / event | Headcounts, store prep lists |
| Operational | `store_lead` | Store | Menu, pickup slots, orders, inventory |
| Operational | `store_pickup` | Center | Mark orders picked up |
| Operational | `boli_recorder` | One event | Record in-person boli results |
| Operational | `pathshala_principal` | Pathshala | Terms, classes, levels, teachers, committee |
| Operational | `pathshala_committee` | Pathshala | Year planning, checklists, resolutions |
| Operational | `teacher` | Own classes | Attendance, sign-offs, class announcements |
| Operational | `zone_lead` | One zone | Zone inbox, zone families |
| Family | `community_member`, `membership_reference`, `primary_adult`, `adult_member`, `child` | Own household | Derived from relationships, not granted |

## What families can do

- Adults (18+, or no date of birth on file) act for their household: RSVPs,
  pledges, bolis, store orders, recurring gifts, special days, children's profiles.
- Children see events, learning and My Jain Way; never pledges, bolis or payments.
- Special days, practice logs and standings are private to the person (parents see
  their children's). Staff never see special days except as labh totals.
- A membership reference sees only the applicant's name, household, tier and note
  (`app.my_reference_requests`) and decides with `app.decide_reference`.

## Identifier visibility

| Identifier kind | Members | People staff | Finance staff |
|---|---|---|---|
| Connect member / household number | own household | all | all |
| `org_member` (org person ID), `org_household` (org household ID) | own household | read + write | read |
| `crm` (legacy CRM) | — | read + write | read |
| `accounting`, `bank_payer`, `payment_provider` | — | — | read; write with `giving.manage` |

## Prototype permission names → schema permissions (Content and Communications)

The AdminPortal prototype uses shorthand permission names. The portal maps them to the
schema's keys (no new keys; `src/lib/permissions.ts` ACCESS):

| Prototype | Schema | What it allows in the portal |
|---|---|---|
| `content.edit` | `content.draft` (drafts, send for approval) or `content.manage` (edit every Content area) | Content tabs; `content.view` alone is read-only |
| `content.approve` | `content.approve` **and** `content.manage` | Approve/Return in the Approval queue (RLS lets only content managers change an item's status) |
| `comms.compose` | `comms.send` | Write newsletters, surveys, alerts; WhatsApp queue |
| `comms.approve` | `comms.approve` | Approve newsletters (all-member sends need two different approvers) |
| `comms.inbox` | `comms.inbox` (zone leads see their zone's inbox) | Inbox |

Center-rule forms under Content (daily timing text, points and Saathi rules) and Legal & waivers
write `centers.rules` / `legal_documents`, which need `settings.manage`.

## Two-step verification, step-up and the owner (onboarding · o-security, 0150–0156)

| Piece | What it does |
|---|---|
| `security.require_2fa_for_staff` (centers.rules) | On by default for a new community; recorded **off** for JSH until its staff have enrolled (Settings › Security). When on, a staff session (any active role grant) that has not passed 2FA (`aal2`) opens only Account › Security until it does. Switching it off needs a fresh 2FA check. |
| `app.is_aal2()`, `app.has_recent_step_up(minutes = 5)` | Read the session JWT: `aal`, and the `totp` time in `amr` (GoTrue refreshes it on every challenge). |
| `app.assert_step_up(action)` | Raises SQLSTATE `CCSTP` "This needs a fresh 2FA check." unless the session passed a TOTP check in the last 5 minutes. Asked of anyone with an authenticator app, and of staff of a community that requires 2FA; nobody else yet (JSH during its transition). Never asked of the service role. |
| Where it is enforced (0154) | Role grants (insert/approve/revoke), module switches, write-off and refund requests and approvals, the month lock, person and household merges, switching the 2FA rule off, exports (`app.record_export`), ownership transfer, invitations and 2FA resets. BEFORE triggers, so every route that writes is covered. |
| Step-up in the portal | A refused action returns `stepUp: true`; `ActionForm` and `StepUpProvider` open the modal, verify the code on the server (Supabase MFA challenge) and retry once. |
| `app.center_owners`, `app.is_center_owner`, `app.transfer_ownership` | One owner per community (the first active center_admin, automatically). Only the owner accepts the agreements and transfers ownership, to another active center_admin, with a reason and a fresh check. |
| `app.staff_invitations`, `app.invite_staff` / `resend_invitation` / `revoke_invitation` / `accept_invitation` | Invite people without a login by email or mobile (roles.manage + step-up). Only a SHA-256 of the link token is stored. Accepting links the login to a person and grants the roles **as the inviter's grants**: center_admin, treasurer, finance_volunteer, executive_committee and privacy_officer still wait for a second, different approver. |
| `app.org_agreements`, `app.accept_org_agreement`, `app.org_agreement_status` | The owner accepts Community Connect's terms (`legal_documents.kind = 'org_terms'`), DPA, children's addendum, order form (production) or sandbox terms (sandbox); who, version, time, IP and browser are kept. Platform admins publish the texts (`app.publish_platform_document`). |
| `app.reset_staff_2fa(center, user, reason)` | Lost phone: another administrator (roles.manage + an active center_admin grant, never oneself) or a platform admin removes the person's authenticator apps and signs them out everywhere. Audited. This is the recovery path; there are no recovery codes. |
| Readiness checks | `owner_and_second_admin_2fa` (an owner and a second admin, both with 2FA) and `agreements_accepted`, registered in `app.readiness_checks`. |
