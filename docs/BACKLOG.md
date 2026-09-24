# Backlog

Work the owner has parked on purpose. Each item says why it waits and what doing it involves.
New items go at the bottom with the date and who parked them.

| # | Item | Why it waits / what it involves | Parked |
|---|---|---|---|
| B1 | **Enforce support access** | Platform admins already hold every permission in every organization (`app.has_permission`), so the owner's time-boxed grant (`app.support_grants`, Settings › Support access) is a consent record only. Enforcing it means limiting platform-admin reads and writes to organizations with a live grant (an RLS change) and tagging their audit rows `on_behalf_of`. | Owner, 2026-09-24 |
| B2 | **Deleting data in onboarding** | Not built: removing sandboxes after 90 days of inactivity (only the 60- and 80-day warnings exist), withdrawing an owner confirmation (readiness check 13), undoing a promotion. Each deletes records, so each needs its rule first. | Owner, 2026-09-24 |
| B3 | **Refunds and credit memos from QuickBooks history** | Donor matching leaves them in Needs review ("Refunds from QuickBooks need an owner decision"). Needs a refund-import rule (how a past refund reduces a historical payment or pledge). | Owner, 2026-09-24 |
| B4 | **Undo a donor mapping after its history was brought in** | Would delete historical payments and pledges; blocked today with Remap offered instead. | Owner, 2026-09-24 |
| B5 | **Replace the sandbox-owner grant workaround** | Today the first owner role skips the two-person rule (see DECISIONS.md). Replace with an explicit, audited platform grant that names both approvers. | Owner, 2026-09-24 |
