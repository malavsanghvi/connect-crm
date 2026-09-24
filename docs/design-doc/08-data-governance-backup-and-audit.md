> Exported from the JSH Platform · Recommendations and Roadmap doc (claude.ai artifact 338356dc…) on 2026-09-23. Source of truth for decisions made before the build; later decisions live in ../DECISIONS.md.

# Data governance, backup and audit

Backup, governance and auditability are built into every service domain as a shared contract, and enforced platform-wide by shared services, so no domain can ship without them.

## Principles every domain must meet

A domain is not "done" until it meets all eight; the architecture review checks them before each release.

1. **Classified data:** every field has a data class and an owner in the data catalog.
2. **Center isolation:** every record carries a center ID; isolation enforced in the database and in backups.
3. **Audited changes:** every create, change, delete, export and sensitive view emits an audit event through the shared audit service.
4. **Retention by rule:** each record type has a retention period and a disposal method; nothing is kept "forever" by default.
5. **Recoverable:** each data store is backed up and restorable to a point in time, and restores are tested.
6. **Reversible:** deletes are soft first, with a recovery window, except where law requires hard deletion.
7. **Traceable to source:** synced data records its origin (app, CRM, QuickBooks, payment provider) and sync reference.
8. **Least privilege:** access only through roles and scopes; no shared admin accounts; service accounts are named and rotated.

## Data classification

Five classes drive encryption, access, logging and retention automatically.

| Class | Examples | Handling |
| --- | --- | --- |
| Public | Timings, guide pages, published events, content packs | No restrictions; versioned |
| Internal | Event plans, menus, volunteer schedules, draft content | Staff roles only |
| Personal | Names, contacts, household links, preferences, RSVPs, attendance, practice logs | Role and scope access; export logged; masked in logs |
| Sensitive | Children's DOB and gender, assistance and senior flags, giving amounts, membership decisions and reference reasons, punyatithi and special days, recordings | Field-level access; every view logged; extra encryption; never in analytics except as totals |
| Restricted | Payment tokens, bank details, QuickBooks and CRM credentials, identity secrets | Held only by the payment provider or a secrets vault; never in the platform database, logs or backups in readable form |

## Backup, recovery and resilience

Suggested targets: lose at most 5 minutes of data (RPO) and be back within 4 hours (RTO) for core services; event-day check-in keeps working offline even if the platform is down.

| Layer | Method | Frequency and retention | Recovery target |
| --- | --- | --- | --- |
| Main database | Managed database with continuous backup and point-in-time restore, replica in a second availability zone | Continuous; 35 days point-in-time; monthly snapshots kept 7 years | RPO 5 min, RTO 4 h |
| Cross-region copy | Encrypted backups copied to a second region, different account, write-once (immutable) | Daily; 90 days | Region loss: RTO 24 h |
| Files and media | Versioned object storage with cross-region replication | Continuous; deleted versions kept 30 days | RTO 4 h |
| Audit log | Append-only, write-once storage, separate account | Continuous; 7 years | Never deletable by center or platform admins |
| Analytics warehouse | Rebuilt from the main database and event history | Nightly | RTO 24 h (not critical) |
| Configuration and secrets | Infrastructure as code in version control; secrets vault with versioning | Every change | RTO 1 h |
| Ops app on event day | Local encrypted cache of attendee list; syncs when online | Per event | Works offline for the whole event |

Per-center restore: a single center can be restored to a point in time without touching other centers.

## Audit trail

One shared audit service receives events from every domain; entries are tamper-evident and searchable by center admins for their own center.

- **Every entry records:** center, actor (person, role, or service), on-behalf-of (for a parent acting for a child, or platform support), action, record type and ID, before and after values (sensitive fields masked), reason when required, device, IP, time, and correlation ID linking it to the originating request.
- **Tamper evidence:** entries are chained with cryptographic hashes and stored write-once; a daily check proves no entry was altered or removed.
- **What is always audited:** logins and failed logins, role grants and expiries, approvals and rejections, money events and QuickBooks posts, exports, sensitive field views, membership decisions, content publishing, configuration changes, support access.
- **Search and export:** the center admin's audit viewer filters by person, record, action and date; exports are themselves audited.
- **Alerts:** unusual patterns (bulk exports, many refunds, off-hours role grants, repeated failed logins) notify the center admin and platform security.

## Per-domain embedding

Each service domain carries its own data class, retention, extra backup needs, key audit events and a named data owner. Retention periods are suggested defaults for each center to confirm with its accountant and counsel.

| Domain | Highest class | Retention | Domain-specific backup or recovery | Key audit events | Data owner |
| --- | --- | --- | --- | --- | --- |
| Identity and access | Restricted | Sessions 90 days; login history 2 years | Secrets vault versioning; key rotation | Logins, failed logins, role grants, support access | Center admin |
| Families and memberships | Sensitive | Life of membership + 7 years | CRM remains a second copy; sync reconciliation | Merges, household moves, membership grants, eligibility overrides | Membership coordinator |
| Membership applications and references | Sensitive | 7 years after decision | Point-in-time restore | Reference decisions, final approvals, waivers | Membership coordinator |
| Events, RSVP, check-in, lunch | Personal | Attendance 7 years; flags deleted 90 days after event | Offline ops cache; replay of check-in queue | RSVP changes, check-in overrides, slot reassignments, list exports | Event lead |
| Giving, pledges, payments, recurring | Sensitive | 7 years (tax and audit) | Payment provider and QuickBooks as independent copies; three-way reconciliation | Pledges, payments, refunds, write-offs, QuickBooks posts and failures | Treasurer |
| Bolis and sponsorships | Sensitive | 7 years | Every pledge entry kept, never overwritten | Entries, extensions, tie resolution, winner entry, early close | Religious coordinator |
| Satvik Store | Personal | Orders and tax 7 years | Point-in-time restore | Price changes, refunds, cancellations | Store lead |
| Calendar and special days | Sensitive (special days) | Until the family deletes them | Point-in-time restore | Panchang source changes; special-day edits (family only) | Religious coordinator; family |
| My Jain Way, Gyan Path, Saathi | Personal; recordings Sensitive | Logs 3 years; recordings 90 days | Points ledger append-only | Catalog and points-rule changes, sign-offs, point corrections | Religious coordinator; Pathshala principal |
| Content and Niva | Public; Niva logs Personal | Content versions forever; Niva logs 30 days | Versioned content store | Draft, approve, publish, retire; knowledge-source changes | Content editor; religious coordinator |
| Photos | Personal (children Sensitive) | Until removed; removed items 30 days | Versioned storage | Uploads, approvals, removals | Content editor |
| Communications and newsletters | Personal | Messages 3 years; delivery logs 1 year | Point-in-time restore | Sends to large audiences, approvals, template changes, opt-outs | Communications officer |
| Guide, directory, expertise | Personal | While opted in | Point-in-time restore | Opt-ins and opt-outs, roster changes | Office |
| Settings, privacy, account lifecycle | Sensitive | Data requests 7 years | Deletion tombstones prevent restores from reviving deleted accounts | Deactivation, deletion, export requests | Privacy officer |
| Integrations (CRM, QuickBooks, payments) | Restricted (credentials) | Sync logs 2 years | Idempotent replays from the event history | Connections, mapping changes, replays | Center admin; treasurer |

## Governance operating model

Each center owns its data; the platform operates it on the center's behalf under a data-processing agreement.

| Area | How it works | Cadence |
| --- | --- | --- |
| Ownership | Each center owns its members' data; the platform is the processor; roles and owners recorded per domain | At onboarding |
| Access reviews | Center admin confirms every role holder is still correct; expired terms removed | Quarterly and after each election |
| Retention and disposal | Automated jobs delete or anonymize expired records; a disposal log is kept | Nightly |
| Legal hold | Center admin or platform can freeze deletion for named records or a whole center | As needed |
| Member data rights | Export and deletion requests from Settings, tracked with a 30-day deadline | Continuous |
| Center exit | Full export (CRM-ready files, QuickBooks references, documents, audit log) handed over; data deleted after an agreed period, with a deletion certificate | On request |
| Incidents | Runbook: contain, assess, notify the center within 72 hours of confirming a breach affecting its data, notify members as the law requires, post-incident review | As needed |
| Changes | Schema and retention changes reviewed by the data owner and platform architect | Each release |

## How it is proven

Controls count only when tested; evidence is collected automatically for audits and SOC 2.

| Test | What it proves | Cadence |
| --- | --- | --- |
| Restore drill | A full restore and a single-center restore meet the RPO and RTO targets | Quarterly |
| Region failover drill | Services come up in the second region from immutable backups | Yearly |
| Audit integrity check | Hash chain intact; no gaps in audit events | Daily, automated |
| Financial reconciliation | Platform, CRM, payment provider and QuickBooks totals agree by campaign | Daily and at month-end |
| Access review evidence | Every center completed its quarterly review | Quarterly |
| Retention job report | Expired records disposed of as scheduled | Monthly |
| Offline check-in test | Ops app runs a full event without connectivity and syncs cleanly | Before each major event season |
| Penetration test | External testers probe center isolation and permissions | Yearly |

The release checklist blocks any new feature that lacks a data class, retention rule, audit events or backup coverage.
