# Giving — taxonomy, experiences & user flows (planning note, not built yet)

Owner request, 2026-09-25. Paused for credits — pick this up as the next Giving wave. Nothing
in this file is implemented; it is the agreed shape to build from.

## Taxonomy (owner's words)

1. **Donation Opportunity** — target $ or # of donations; fixed or open (donor types an amount).
   Can attach one or more of: photo album / description / video link / voice message / webpage
   link. Any opportunity can be made recurring (checkbox → recurrence options shown). At each
   recurrence, auto-add the pledge to the household/primary member's account and send a pledge
   confirmation using the notification template set at opportunity creation.
   - **Live / in-person** opportunities: not directly payable online. Shows a floor amount;
     interested members contact the admin team, who follow up.
   - **Auction / bidding** opportunities: floor amount, minimum increment, date-based cutoff —
     "like what we have" (matches the existing bolis system).
   - Opportunities can be created **in bulk via upload**.
2. **Campaign** — a collection of opportunities.
3. Each opportunity and campaign can be **saved as a template**.
4. Each opportunity/campaign can be **active/inactive**, and made **visible ahead of a schedule**
   by admins/treasurers (visibility date can differ from when it's operationally open).

## How this maps onto the existing schema (already built, `supabase/migrations/0003_giving.sql`)

Already covers most of this — the gaps are listed below, not a rebuild:

- `app.campaigns` — container: name, fund, goal, start/end, status (draft/published/closed/archived).
- `app.opportunities` — fixed or open amount (`amount_cents` null = open), `min_amount_cents`,
  `quantity_available`/`quantity_taken`, `allow_anonymous`, `recognition`, `sort_order`,
  `status` (draft/open/taken/closed). Belongs to a campaign.
- `app.bolis` + `app.boli_entries` — **the auction/bidding system already matches the ask**:
  floor (`floor_cents`), minimum increment (`step_cents`), open/close timestamps, anti-sniping
  soft-close extension, in-person vs digital entries, winner tracking, `keep_all_entries` (losing
  bids become pledges). No new schema needed here — just needs to be reachable as an opportunity
  *type* from the same campaign/opportunity picker instead of living as a separate area.
- `app.recurring_gifts` — frequency, start/end rule (`end_kind`/`end_count`/`end_on`), status.
  **Gap**: only references `campaign_id`/`fund_id`, not `opportunity_id` — can't yet say "this
  specific opportunity is recurring-enabled" or trace a cycle's pledge back to the opportunity.
- `app.pledges` / `app.payments` / `app.payment_allocations` — unaffected, reused as-is.

## Gaps to close (the actual build list for the next wave)

1. **`recurring_gifts.opportunity_id`** [new FK] — so "make this opportunity recurring" is a
   real link, not just a campaign/fund-level recurring gift.
2. **Notification template on the opportunity** [new column/table] — `notification_template_id`
   picked at opportunity creation; each recurrence auto-creates a pledge and sends this template
   (tokens: `{amount}`, `{frequency}`, `{next_date}`, `{opportunity_name}`).
3. **Media attachments** [new `opportunity_media` table, or reuse Events' photo-album
   infrastructure if it already generalizes] — multiple photo albums / video links / voice
   messages / webpage links per opportunity or campaign, each with a caption.
4. **Live/in-person fulfillment mode** [new `fulfillment_mode` column: `self_serve` |
   `contact_office`] — floor amount shown, no checkout button, routes to the existing
   team-inbox messaging pattern pre-filled with the opportunity name.
5. **Templates** [new `is_template` flag + a small templates library] — "Save as template" /
   "Start from template" for both campaigns and opportunities.
6. **Bulk upload** — CSV import (same review-before-publish pattern as the People importer):
   rows land as `draft` opportunities for a human to check before they go live. Open question:
   is CSV right, or does "duplicate this opportunity N times with a name pattern" (e.g. 50
   identical pujan slots) serve the real need better?
7. **Active/inactive split from `status`** [new `active` boolean, separate from the existing
   `status` enum] — an admin kill switch independent of the open/taken/closed lifecycle.
8. **Scheduled visibility** [new `visible_from` / `visible_until` timestamptz] — publish now,
   show to members starting a future date/time. No background job needed — just a filter at
   query time.

## Experiences & user flows (agreed shape)

### Admin / Treasurer
- Create campaign → add opportunities (type picker: Fixed / Open / Tiered / Live-in-person /
  Auction) → attach media → (if recurring-eligible) pick allowed frequencies + confirmation
  template → set active/inactive + visible-from/until → publish.
- Save campaign or opportunity as a template; start new ones from a template.
- Bulk-import opportunities via CSV into a campaign, review as drafts, publish.
- Auctions: unchanged from today's bolis admin flow (open/close, soft-close, settle winner).

### Member (donor)
- Give tab → campaign list (featured first, goal progress bar) → opportunity list (the
  "row + short description" style from the recurring-gift screen, which the owner prefers over
  the earlier duplicated-card layout) → opportunity detail.
- Opportunity detail: media gallery, amount selector (fixed price / open amount field / tier
  chips), anonymous toggle, dedication field, **Give once** vs **Make this recurring** (only
  shown when the opportunity allows it, revealing the admin-permitted frequency choices).
- Live/in-person opportunity detail: floor amount + **Contact us** → pre-filled message thread,
  no checkout.
- Auction opportunity detail: routes to the existing bolis bidding screen, unchanged.
- "My giving" / recurring-gifts screen: list grouped by opportunity, each with
  pause/cancel/change-amount. (This is the screen with the duplicate fund-list rendering bug —
  worth fixing in the same pass since it's the same surface.)
- Every pledge (one-time or each recurring cycle) triggers the opportunity's confirmation
  template; tax receipts continue through the existing `app.statements` flow, unaffected.

### Event-day / volunteer
- In-person bolis entry and in-person live-opportunity pledge intake — both unchanged from
  today's manual-entry patterns.

### Background jobs
- Recurring-cycle job (new, or extend the existing one): on `next_charge_on` for rows with an
  `opportunity_id`, create the pledge, advance the date, send the confirmation template.
- Auction close job — unchanged, existing.
- No new job for visibility scheduling (query-time filter only).

## Ideas raised but not yet decided (flag for the owner when resuming)

- **Tiered amounts** within one opportunity card (e.g. $51/$101/$251) vs. just creating three
  separate opportunities under one campaign — worth the extra schema, or good enough as-is?
- **Dedication** ("in honor of" / "in memory of") — formalize `pledges.dedication` into
  structured `dedication_kind` + `dedication_name`, or keep the free-text field?
- **Waitlist** when `quantity_available` is reached — in scope for v1 or a later wave?
- Should campaigns get the same active/inactive + visible-from/until + template treatment as
  opportunities, or is that opportunity-only?
- Smaller, not-yet-scoped ideas from the same planning pass: matching-gift capture, campaign
  "featured" pin, QR/short-link per opportunity for event-day tablets, localized (Gujarati/Hindi)
  opportunity text, recurring-gift reminder cadence (expiring card / missed cycle).

## Immediate, separate bug (not part of this taxonomy work)

The "New recurring gift" screen's fund list renders duplicated entries — worth a quick,
standalone fix whenever this wave starts, since it's the same screen this plan touches anyway.
