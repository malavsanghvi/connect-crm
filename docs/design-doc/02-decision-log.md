> Exported from the JSH Platform · Recommendations and Roadmap doc (claude.ai artifact 338356dc…) on 2026-09-23. Source of truth for decisions made before the build; later decisions live in ../DECISIONS.md.

# Decision log

## Decisions made

The biggest change: the platform replaces Neon and becomes each center's CRM and system of record, posting all money to QuickBooks. Decided Sep 2026 by the JSH technology officer.

| Area | Decision |
| --- | --- |
| CRM | Platform replaces Neon with its own CRM; migration tooling must handle any prior system and many years of history |
| Accounting | Cash basis; QuickBooks is the accounting record; platform posts everything |
| Pay-now gifts | Create a pledge, record the donation against it, close the pledge |
| Receipts | Tax, pledge and donation receipts in a standard format with light per-center personalization |
| Payment methods | Card, ACH, Apple Pay, Google Pay, check, stock, offline cash and check |
| Processing fees | Donor may choose to cover fees; each center decides whether to ask |
| Sales tax | Follows the law of the center's state |
| Pledge visibility | All adult household members |
| Donor recognition | Anonymous recognition allowed |
| Bolis | First recorded wins; every pledge entry kept, since the center usually accommodates all interested families; digital bolis mainly reduce admin work and surface the most interested |
| Entitlements | Granular entitlements in every domain (e.g. limited-access finance team members), with default roles out of the box |
| Membership rules | Prior-membership and reference-count rules configurable per center |
| Child login age | Configurable per center and at platform level |
| Households | Adult children can stay in the parents' household and also be primary of their own |
| Lunch slots | A family with a child under 12 or a senior eats together at lunch start |
| Events | Waitlists can be enabled; eligibility controls (e.g. life members only, children enrolled in Pathshala) |
| Privacy defaults | Directory, photo and physical-mail preferences asked as opt-in or opt-out during onboarding |
| Deletion | App data deleted; financial records kept 7 years then anonymized; household stays; audit log kept |
| Store | Admin backend includes full inventory management |
| Launch target | Within 2 months, using all available compute and AI agents |
| Shared contact with a child | If a login email or phone is shared with a child, every financial transaction needs a 2FA one-time code |
| In-person bolis | Admins add results one by one or bulk-upload them |
| Volunteer legal sign-off | Any volunteer registering for any service signs the center's uploaded legal form in the member app before they can serve |
| Payment allocation | A payment closes the earliest open pledge first unless it is for a specific invoice; overpayment goes to the next earliest open pledge; partial payment keeps the pledge open |
| DAF and matching gifts | Matched manually; treasury team applies them to a household account |
| Balances in the member app | Shown at household level, regardless of which member pledged or paid |
| Identity across centers | Deferred to later |
| Allocation transparency | Payment screen shows which pledges a payment will close, with a "choose instead" option; receipts list the allocation; recurring gifts never auto-close pledges unless the donor links them |
| Receipt name | Payer's name by default, with an option for a joint receipt |
| In-person payments | Tap-to-pay in the ops app, card readers only at the busiest stations; cash and checks in numbered envelopes entered in the ops app, counted and signed off by two volunteers; same pledge and allocation logic as the app |
| Bhandar and offerings | Counting sessions with two or more counters from different households, totals by denomination, sealed numbered bags; posted as anonymous general donations and matched to the bank deposit; gold, silver and other in-kind offerings in a valuables register with photos and custody log, never valued on receipts |
| Pathshala domain | Term calendar and registration windows (membership required); fees per child billed as pledges; placement by level, teacher assignments, class waitlists, QR attendance, term progress reports, Gyan Path sign-offs feed levels; parent communication only via class announcements and parent inbox |
| Child and organization safety | Waivers versioned, re-signed yearly or on change, stored with signer, time, version and document copy; background checks with expiry for anyone working with children, via an outside provider, blocking assignment until current; no one-to-one adult-to-minor messaging; parent signs a minor volunteer's waiver; photos follow onboarding opt-in with moderation |
| SMS and WhatsApp | Start US carrier registration (10DLC) and WhatsApp Business number now under JSH's name; store opt-in with time and source; honor STOP automatically; WhatsApp for community messages, SMS only for codes and time-critical reminders |
| Event-day resilience | Load test 2,000 check-ins in 30 minutes; ops app fully offline including on-device lunch slots; on-call engineer and on-site volunteer tech lead for major events; printed attendee list with QR codes as fallback; no releases 48 hours before a major event |
| Sign-in without email | Mobile-only sign-in allowed; family member can manage a senior's profile; staff can issue a one-time printed sign-in code in person; recovery via a second verified contact or in person at the office with ID |

## Parked and open

| Question | Status | Owner |
| --- | --- | --- |
| Money approval thresholds (refunds, write-offs, month close) | Parked | Treasurer |
| Platform ownership entity (likely a new nonprofit) | Parked | EC |
| Soft close for digital bolis, and extension length | Open | Religious coordinator |
| Membership history on account deletion (keep minimal record or erase) | Open | Membership coordinator |
| Member uploads and messages on deletion (remove or anonymize) | Open | Privacy officer |
| Membership and maintenance fee billing cycle, auto-renew, grace period | Open | Treasurer |
| Pledge due dates, reminders, installments, write-off timing | Open | Treasurer |
| Restricted funds list for QuickBooks classes | Open | Treasurer |
| Receipt wording for gifts with benefits (store, meals) and religious honors | Open | Treasurer with accountant |
| Neon cutover: history depth, parallel run, cutover date | Open | Technology officer |
| Paid events, guest vs. member pricing, cancellations; default lunch slot length and seats | Open | Event leads |
| WhatsApp Business number, email sending domain | Open | Communications officer |
| Store: kitchen capacity per slot; delivery | Open | Store lead |
| Who can take card payments at events (all volunteers or designated finance volunteers) | Open | Treasurer |
| Bhandar counting frequency and who can be a counter | Open | Treasurer |
| Pathshala fee per child or per family; sibling discounts | Open | Pathshala principal |
| Who pays for background checks; which roles require them | Open | EC |
| Weekend and festival-day on-call staffing | Open | Technology officer |
