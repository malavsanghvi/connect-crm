> Exported from the JSH Platform · Recommendations and Roadmap doc (claude.ai artifact 338356dc…) on 2026-09-23. Source of truth for decisions made before the build; later decisions live in ../DECISIONS.md.

# Roles and permissions

## Permission model

Access = role + scope + field rules, checked on every request by the API, never only in the app.

- **Roles** bundle permissions (e.g. Treasurer, Event lead). A person can hold several roles.
- **Scopes** limit where a role applies: platform, center, zone, event, campaign, class, or own household.
- **Actions** per module: view, create, edit, approve, publish, export, delete.
- **Field-level rules** hide sensitive fields even from people who can see the record: children's DOB and gender, giving amounts, health or assistance flags, contact details.
- **Relationship rules** come from the family graph: an adult acts for their household; a parent acts for their children; a child acts only for themselves within child limits.
- **Center isolation** is enforced in the database: no role, except audited platform support, ever crosses centers.

Example: an event lead for Tapasvi Bahuman can see that event's attendee list and assistance flags, but not attendees' giving history or other events.

## Role catalog

25 default roles in four tiers; centers can rename them, switch them off, or clone and adjust them.

| Tier | Role | Scope | Responsible for |
| --- | --- | --- | --- |
| Platform | Platform owner | Platform | Center creation, billing, global settings |
| Platform | Platform support | Center, time-limited | Troubleshooting with center approval; every action audited |
| Platform | Content curator | Tradition packs | Shared religious content and Gyan Path templates |
| Center | Center admin | Center | Configuration, roles, integrations |
| Center | Executive viewer (EC, Board) | Center | Dashboards and reports, read-only |
| Center | Treasurer | Center | Giving, payments, refunds, statements, store finances |
| Center | Finance volunteer | Center | Record offline payments, reminders; no refunds |
| Center | Membership coordinator | Center | Households, memberships, verification, eligibility |
| Center | Religious coordinator | Center | Bolis, pujans, practice catalog, Jain calendar, religious content approval |
| Center | Communications officer | Center | Announcements, templates, WhatsApp queue |
| Center | Content editor | Center | Guide, pages, photos, translations (draft only) |
| Center | Privacy officer | Center | Data export and deletion requests |
| Operational | Event lead | One event | Event setup, attendee list, lunch settings, volunteer assignment |
| Operational | Check-in volunteer | One event, event day | Scan, walk-ins, stations; no giving data |
| Operational | Kitchen lead | Center | Headcounts, store prep lists |
| Operational | Store lead | Store | Menu, pickup slots, order issues |
| Operational | Boli caller and recorder | One event | Record in-person boli results |
| Operational | Pathshala principal | Pathshala | Classes, levels, teachers, Pathshala calendar |
| Operational | Teacher | Own classes | Attendance, sign-offs, class announcements |
| Operational | Zone lead | One zone | Zone inbox, zone families' contact info, zone reports |
| Family | Community member | Own household | Account without membership: events, RSVP, giving, store, learning; can apply for yearly or life membership with a reference |
| Family | Membership reference | Applications naming them | Any verified member at the applicant's tier or higher; approves or declines applications that name them; sees only the applicant's name, household, tier and note |
| Family | Primary adult | Own household | Family details, children's profiles, payments, RSVPs |
| Family | Adult member | Own household | Own profile, family pledges, RSVPs, payments |
| Family | Child (under 18) | Self | View events, learning, My Jain Way; no RSVP, bolis, pledges or payments |

## Permission matrix

Default access for the main center and operational roles. M = manage (create, edit, publish), A = approve, V = view, S = scoped view (own event, zone or class), O = own household only, — = none.

| Role | Members and families | Events and check-in | Giving and pledges | Bolis | Store | Content and calendar | Communications | Learning | Reports |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Center admin | M | M | V | V | V | M | M | V | V |
| Executive viewer | V (no children's details) | V | V (totals) | V | V | V | V | V (totals) | V |
| Treasurer | V | V | M + A | V | M (finance) | — | — | — | V (finance) |
| Finance volunteer | V (contact only) | — | M (offline payments) | V | — | — | — | — | S |
| Membership coordinator | M + A | V | V (membership fees) | — | — | — | S | — | V (membership) |
| Religious coordinator | — | V | V (bolis, pujans) | M | — | M + A (religious) | S | M (catalog) | V |
| Communications officer | V (contact) | V | — | — | — | V | M | — | V (comms) |
| Content editor | — | — | — | — | — | M (draft) | — | — | — |
| Event lead | S (attendees) | M (own event) | S (commitment totals) | V | — | — | S (attendees) | — | S |
| Check-in volunteer | S (name, flags) | S (scan) | — | — | S (pickup) | — | — | — | — |
| Store lead | — | — | — | — | M | — | S (buyers) | — | S |
| Pathshala principal | S (students, parents) | V | — | — | — | M (Pathshala) | S (parents) | M | S |
| Teacher | S (own class) | — | — | — | — | V | S (own class) | S (sign-off) | S |
| Zone lead | S (zone contacts) | V | — | — | — | V | S (zone inbox) | — | S (zone) |
| Community member | O | O (RSVP) | O | O (pledge) | O (order) | V (no member-only) | O | O (no Pathshala) | — |
| Adult member | O | O (RSVP) | O | O (pledge) | O (order) | V | O | O | — |
| Child | O (view) | V (no RSVP) | — | — | V (no checkout) | V | O | O | — |

## Granular controls

Five controls keep a volunteer-run organization safe without slowing it down.

| Control | How it works | Where it applies |
| --- | --- | --- |
| Two-person approval | A second authorized person approves before the action takes effect | Refunds, pledge write-offs, membership overrides, voting eligibility overrides, publishing religious content, bulk announcements to all members, role grants for finance |
| Time-bound roles | Roles expire automatically: event-day access ends at midnight; EC roles end with the term | Check-in volunteers, boli recorders, platform support, election-term roles |
| Delegation | A role holder can delegate a scoped subset for a set period, visible to the center admin | Treasurer to finance volunteer during travel; event lead to co-lead |
| Step-up verification | A fresh biometric or code before sensitive actions | Exports, refunds, role changes, viewing children's details in bulk |
| Audit trail | Append-only log of who did what, to which record, before and after, from which device | Every admin and ops action; access reviews each quarter; center admin sees their center's log, platform team sees support access |

Bulk exports carry a watermark and expire; personal data never leaves the platform through personal WhatsApp or email.
