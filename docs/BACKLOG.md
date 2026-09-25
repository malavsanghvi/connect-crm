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
| B6 | **Custom roles per organization** | Needs per-organization role definitions and new permission keys. Build when a customer asks. | Owner, 2026-09-25 |
| B7 | **Donor covers the fee** | No extra fee is charged for now. Needs a rule for recording the extra amount (proposed: a separate fee line not applied to pledges). | Owner, 2026-09-25 |
| B8 | **Partial refunds after the first** | One refund request per payment today. Revisit allowing several partial refunds, each with two-person approval. | Owner, 2026-09-25 |
| B9 | **Live QuickBooks test post** | Today it creates four real $1.00 entries the treasurer voids by hand (after explicit confirmation). Revisit: void them automatically, or test without posting. | Owner, 2026-09-25 |
| B10 | **Push-token claim** | Holding a push token lets a login claim it. Tighten (e.g. bind a token to its first login, device attestation). | Owner, 2026-09-25 |
| B11 | **Automate texting and WhatsApp registrations** | Today a platform admin records 10DLC/toll-free and Meta decisions by hand. Automate through Twilio Trust Hub and the Meta Cloud API when volume justifies it. | Owner, 2026-09-25 |

