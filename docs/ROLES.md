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
| `org_member` (register number) | own household | read + write | read |
| `crm` (legacy CRM) | — | read + write | read |
| `accounting`, `bank_payer`, `payment_provider` | — | — | read; write with `giving.manage` |
