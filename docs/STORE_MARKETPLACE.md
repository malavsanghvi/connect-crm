# Community Market: people offer products and services inside the store (plan)

Status: plan, 2026-10-15. **The owner accepted every recommendation (CM1 to CM24, section 16) on 2026-10-15 ("go with the
recommendations"). Slice 1 is built** (migration 0830, test 830; [`STORE_SECTIONS.md`](STORE_SECTIONS.md) section 7): the module, the
permissions and role, the policies, and the portal's Community Market for the community's own listings, which the member app shows
**read-only and not orderable** (CM8; whether they may be ordered is open, CM25; CM14's members-only default is open, CM26). **Slice 2
onward is still a plan and each needs the owner's approval before it is built** (permissions, RLS and money). The Community Market does not exist for a
community until Weaver grants it: no tab, no teaser, no "coming soon" for anyone else. The store's sections are 0821.

Owner request, 2026-10-15 (verbatim): *"in the store - reorg a bit.. Have Food section and put all current food items in there.
then say Marketplace style people can offer their services there - For example Memories book printing, laser engraving pieces, Gift
articles, Many communi related products organized."*

Built for every organization Weaver onboards (temple, church, mosque, chamber, club, school, alumni group; any faith or none; any
language). The owner's examples are examples: nothing below is written for one community, and the categories, the rules and the
words are data each community sets.

> **Nothing here is built until the owner approves it.** Per `CLAUDE.md`, anything that changes **money rules, permissions or RLS**
> waits for the owner. This plan changes all three (sections 9, 10 and 11), so no slice is built until the owner has answered the
> decisions in section 16 and approved that slice by name. Slice 1 moves no money and adds no seller permission, but it does add the
> module and one restrictive policy, so it waits for the owner too; it is the one that can start first (section 14).

## 1. In short

- **The idea.** Inside a community's store there are two sections. **Food** is what the community itself makes and sells (built).
  The second section is a place where **members, approved vendors and the community itself** offer their own products and services:
  a memories book printed from the family's photos, laser-engraved pieces, gift articles, community products. Buyers browse it in
  the member app, ask questions, and order; sellers manage their listings; the community keeps it safe and tidy.
- **The words (a warning).** "Marketplace" already means something else in Weaver: the catalog of paid products an organization
  turns on (Settings › Marketplace). This section is a different thing, so its data key is `market` and its proposed label is
  **Community Market** (section 2).
- **It is a Marketplace product.** Like WeCare and CatchTheMatch it is a product an organization turns on: **off by default for
  every kind of organization**, switched on by Weaver's platform admin with a reason and a fresh 2FA check, paused or resumed by the
  community (rules P1 to P6, [`MARKETPLACE_PACKS.md`](MARKETPLACE_PACKS.md); section 12).
- **The smallest useful path.** (1) The community's own non-food products, organized, in the new section: no new money rule.
  (2) Members and approved vendors list products and services, buyers **ask** (inquiry) and settle **directly with the seller**:
  no money moves through Weaver or the community. (3) Orders as a record (quote, accept, make, deliver, review), still paid directly.
  (4) **Only then**, and only after the owner, a lawyer and an accountant agree: pay through the community, fees, tax, refunds,
  payouts, QuickBooks. The first three slices need no money decision (they still need the permissions and RLS approvals).
- **The biggest risks**, in order: a seller's goods or conduct harming a buyer and the community being blamed (section 10); money
  and sales-tax law the day a payment passes through the community (section 9); and old member apps that do not yet group by section
  showing market rows among the food (section 3.1 and 14).

## 2. The words

| What | Proposal | Why |
|---|---|---|
| Label of the section in the store | **Community Market** | Keeps the owner's idea ("marketplace style") and cannot be mistaken for Settings › Marketplace. "Community Marketplace" also works and is the owner's word with a qualifier; the cost is that an administrator then sees "Marketplace" in Settings and "Community Marketplace" in the Store. The label is copy in one place and can change at any time. |
| Data key of the section | `market` (already in the database, 0821) | A key never changes (P6), so it avoids the word Weaver's catalog already uses. |
| Module key (the product's switch) | `market` | Neutral, short, the same as the section key. Brand label in Settings › Marketplace: "Community Market". |
| A person who sells | **seller** (the app says "Sell in the Community Market") | "Vendor" is used only for a seller who is not a member. |
| What a seller offers | **listing** | One thing for sale: a product, a made-to-order product, a service, or something priced by quote. |

## 3. What exists today, and what is reused

| Piece | What it gives this plan |
|---|---|
| Store sections (0821, [`STORE_SECTIONS.md`](STORE_SECTIONS.md)) | `section` on `store_categories` and `store_items`; Food holds everything; the portal shows Food and a second section only if it holds something; the contract the member app reads. The community's own non-food products can already be filed in the `market` section by a later slice. |
| The Store module (`store`, tables `store_categories`, `store_items`, `pickup_windows`, `store_orders`, `store_order_lines`, `inventory_movements`; permissions `store.view`, `store.manage`, `store.pickup`) | Categories, items, photos (a private bucket), pickup, cart and checkout through the payment sheet (context `store`) or "pay at pickup", stock, the kitchen display. All of it is Food's today. The community's own market listings are rows of the same tables, but in slice 1 they are shown **read-only and are not orderable** through the cart and pickup (the member app enforces it; no database rule does; whether they may be ordered is open, CM25). |
| Module switches and the Marketplace packs ([`MODULES.md`](MODULES.md), [`MARKETPLACE_PACKS.md`](MARKETPLACE_PACKS.md)) | `app.modules`, `category_modules` (`default_off`), `set_module_grant`, `center_module_grants`, `module_tables` (a test fails if a table is missing), restrictive `module_switch` policies, `assert_module_enabled`, `marketplace_states` and the Settings › Marketplace card, requests and "tell me when it is ready". |
| Payment plugins ([`PAYMENTS_PLAN.md`](PAYMENTS_PLAN.md)) | Card, Apple Pay, Google Pay, ACH, PayPal, Zelle, check, cash and more, switched on per organization in Settings › Payments; one Stripe Connect account per organization; `member_payment_methods` for what the app may offer; card data never touches Weaver. |
| Refunds and approvals (`payment_refunds`, `giving.manage`, `giving.approve` as second approver) | The existing way a refund is requested and approved, with a reason. |
| QuickBooks posting (`ledger_postings`, `app.account_for_role`, the mapping the treasurer approves) | One queue, one mapping, a plain reason when an account is missing (`CCMAP`). **Store-sale postings are not built yet** (B59 item 2), so money through the community waits for that too. |
| People and households (`household_card`, `staff_add_person`, the invitation flow) | Identity for sellers and buyers. A household is never picked or confirmed by name alone: every approval screen shows the household card. |
| Access levels ([`ACCESS_LEVELS.md`](ACCESS_LEVELS.md)) | Who may use an area of the member app, per community: the Community Market becomes an area (members by default). |
| Notifications (`notification_topics`, preferences, push and email, the 0598 rule that a notice follows the community's switch) | New topics for inquiries, replies and order steps. |
| Legal documents and consents (`legal_documents`, `consents`) | A seller's terms and the buyer's notice, versioned, with who accepted which version and when. |
| Storage and virus scanning (0589, off until the platform switches it on) | Listing photos follow the same rules as store photos and homework. |
| Reports and the activity stream | Counts for the community; no names in cross-community counts. |

### 3.1 The one dependency on the member app

Installed member apps read every active store item and every category with no notion of sections. A `market` row written to
`store_items` would show among the food in an old app. That is why the portal creates market rows only while the module is
on (`sectionOpen()`, slice 1) and the database hides them from a community without it (the policy `market_section_switch`), and why the module is **off by default**: only a community for which Weaver has deliberately switched the
Community Market on is affected, and Weaver can first check the app situation for that community. Seller listings live in **their own
tables** (section 11) that no installed app reads, so only slice 1 (the community's own products, which are `store_items`) has this
dependency. The order of work in [`STORE_SECTIONS.md`](STORE_SECTIONS.md) section 4.5 applies: the app that groups by section ships
first.

## 4. Who can sell, and how a seller is approved

| Seller | Who | Approved by | Notes |
|---|---|---|---|
| **The community itself** | The organization, selling its own non-food products: T-shirts, books, gift articles, calendars | Nobody (a person with `store.manage` or `market.manage` lists them) | These are rows of `store_items` filed in the `market` section. **In slice 1 (built, 0830) they are shown read-only and cannot be ordered**; whether the community's own listings may use the store's cart, pickup, stock and tax handling is an open owner question (CM25). Listings by every other kind of seller are never store items. |
| **A member** | An adult in a household of the community, selling something they make or do: a maker, a photographer, a tutor | A person with `market.manage`, after an application | The common case. The seller is the adult, never a child (a child's craft business is run by a parent as the seller). |
| **An approved vendor** | A business or person who is not a member: a local print shop, an engraver, a frame shop | A person with `market.manage`, after an application or an invitation | Needs a Weaver sign-in. Staff create the person with the existing add-person flow so identity, the audit trail and the household card keep working; the vendor is invited by email. |

**How approval works** (members and vendors):

1. The person opens **Sell in the Community Market** in the member app (or is invited) and gives: the name they sell under, a
   short description of what they offer, up to three sample photos, how they may be contacted (in the app, phone or email), the area
   they serve, and that they are an adult and accept the seller terms (a versioned document, section 10).
2. An application appears in the portal's **Community Market › Sellers** queue. The reviewer sees the **household card** of the
   applicant (never a name alone), their membership, how long they have been a member, and any earlier reports.
3. The reviewer approves, asks for more, or declines with a reason the applicant is shown in plain words. Every decision is audited
   with the reason. The applicant is notified.
4. An approved seller can create listings. Their listings go through review (section 10) until the community trusts them.
5. A seller can be **paused** (hidden, reversible) or **ended** (hidden, history kept) by a person with `market.manage`, with a
   reason, and can end their own seller account at any time. A seller who is ended keeps their order history; nothing is deleted.

A seller record is one per person per community. The community decides in settings whether members may apply, whether vendors may,
and whether every listing needs review (section 16, CM4 and CM5).

## 5. Listings: types and fields

### 5.1 The four kinds of listing

| Kind | What it is | Example | What the buyer supplies | How it is priced |
|---|---|---|---|---|
| **Product** | A ready thing at a fixed price | A gift hamper, a handmade card set, a tote bag | Quantity, and delivery or pickup choice | A price in cents, optionally "from" a price |
| **Made to order** | A product made after the order, with details the buyer supplies | Laser-engraved pieces, a memories book printed from the family's photos | The seller's questions: text to engrave, material, size, uploaded photos or a design | A price in cents or "from", often confirmed in a quote |
| **Service** | Work done for the buyer | Book printing and binding, photography, tutoring, translation | The seller's questions: dates, place, what is needed | Per project, per hour or per session, or by quote |
| **Quote only** | No price shown; the buyer asks | A custom commission, a large print run | A description of what they want | "Ask for a quote" |

Underneath, a listing has a **kind** (product, made to order, service) and a **price mode** (fixed, from, quote). "Quote only" is the
quote price mode on any kind. The app shows the four plainly.

### 5.2 The fields of a listing

| Field | Notes |
|---|---|
| Title and description | Plain text, in the seller's language; no HTML. Length limits so a listing stays readable on a phone. |
| Category | One of the community's Community Market categories (section 6). |
| Photos | Up to six, the first is the cover. A photo is required for a product and optional for a service. Uploaded to a private bucket with the same size limit and virus-scan rule as store photos; moderated (section 10). No photo of a child's face. |
| Kind and price mode | As above. |
| Price | Integer **cents**, in the community's currency (`price_cents`). Empty when the price mode is quote. "From" shows "From $X". |
| Lead time | A range in days (for example 5 to 10) and a plain note ("engraving takes a week; rush on request"). |
| Delivery or pickup | Any of: pickup from the seller, delivered locally, shipped (the seller arranges it), done in person, done online. No shipping rates or labels in the first slices. |
| Area | The places served, in words and an optional list of ZIP codes. |
| The seller's questions | For made-to-order and service listings: up to ten questions the buyer answers when asking (text, a choice, a number, a file). Stored as data on the listing. |
| Terms for this listing | Optional free text: returns, rush fees, what is not included. Shown to the buyer. |
| Availability | Open, or paused (on holiday, backlog); a seller can pause a listing without losing it. |
| Featured | Set by the community, not by the seller (section 6). |
| Status | Draft, submitted for review, published, paused, rejected (with the reviewer's reason), retired. |

**Contact details are never on the listing.** The buyer asks through the app; the seller's phone or email is shared only after
the seller replies and chooses to (section 10).

## 6. How listings are organized

All of this is **per community** and data, not code.

- **Categories.** The Community Market has its own categories, in the same table as the store's (`store_categories`, section
  `market`), so the portal's existing screens add, order and rename them. When the community first turns the market on it is offered a
  **starter set** it can edit or delete: *Gifts*, *Printing & books*, *Personalised*, *Services*, *Community products*. These match the
  owner's examples; they are suggestions, not fixtures, and a chamber of commerce would choose differently (*Business services*,
  *Printing*, *Promotional items*). A listing has one category.
- **Featured.** A person with `market.manage` can feature listings (and set the order of the featured shelf). Featured listings show
  first, on a shelf at the top of the section in the app. A seller cannot feature their own listing.
- **Search.** One search box over title, description and category, in the member app and the portal. Slice 2 uses a simple text match;
  anything cleverer (spelling, language, the community's words) is later and is an iWeaver matter.
- **Sorting.** Newest, nearest in lead time, and price; featured first by default.
- **By seller.** A seller's page lists their published listings, with the name they sell under and, once reviews exist, a rating.
- **In the app.** The store has a switch between Food and the Community Market only when both have something to show, then the
  category chips of that section ([`STORE_SECTIONS.md`](STORE_SECTIONS.md) section 4.2). Listings from sellers appear in the same
  chips as the community's own products.

## 7. The buyer journey

**In the member app** (a signed-in adult; children never buy or sell):

1. Store › **Community Market**. Featured shelf, category chips, search.
2. A listing page: photos, kind, price or "Ask for a quote", lead time, delivery and area, the seller's name and rating, the seller's
   terms, and the community's notice that sellers are independent (section 10). A **Report** link on every listing.
3. **Ask about this** (slice 2). The buyer writes a message and answers the seller's questions; for made-to-order work they can
   attach photos. The seller is notified.
4. The seller replies in the same thread. For quote-only and made-to-order work the seller sends a **quote**: price in cents, lead
   time, what is included. (Slice 3.)
5. The buyer accepts the quote, which creates the **order** (slice 3). Until slice 4 the app says plainly: **"Pay the seller directly.
   [Community name] and Weaver do not handle this payment."**
6. The buyer follows the order, collects or receives it, marks it complete, and leaves a review.

**For a seller** (member app and the member web app; there is no seller portal): Sell in the Community Market → apply → my listings
(create, edit, pause) → my inbox (inquiries, quotes) → my orders. Sellers manage everything on their phone.

**In the portal** (Store › Community Market tab, which appears once there is something in it): Sellers (applications and the
list), Listings (the review queue and all listings), Reports and takedowns, Inquiries and orders (an overview for the community,
with message bodies hidden unless a report opens them, section 10), Categories and featured, Settings (who may sell, whether every
listing is reviewed, the house rules, the notice text).

**A guest** (not signed in) sees nothing of the Community Market by default (section 16, CM14), while the Food store stays as it is.

## 8. The order flow and notifications

| Step | Who moves it | Slice | What the other person is told |
|---|---|---|---|
| Inquiry sent | Buyer | 2 | Seller: "New question about *listing*" |
| Reply | Seller (or buyer) | 2 | The other party: "*Name* replied" |
| Quote sent | Seller | 3 | Buyer: "A quote for *listing*: $X, ready in N days" |
| Accepted (the order starts) | Buyer | 3 | Seller: "*Name* accepted your quote" |
| In progress ("making it") | Seller | 3 | Buyer: "*Seller* has started" |
| Ready | Seller | 3 | Buyer: "Your order is ready for pickup / on its way" |
| Delivered or picked up | Seller (buyer confirms) | 3 | Both |
| Completed | Buyer confirms, or automatically after N days | 3 | Seller; buyer is asked for a review |
| Declined / cancelled | Seller or buyer, with a reason | 3 | The other party |
| Reported / in dispute | Either party, or the community | 2 | Moderators; the parties are told it is being looked at |
| Reviewed | Buyer, once, after completion | 3 | Seller; the review is moderated |

Notifications use the existing machinery: new topics (inquiries, replies, order steps, seller decisions, review prompts) with the
community's switch honoured (the 0598 rule), push and email, quiet hours. **No SMS in the first slices.** Message bodies are never
put in a push or an email: the notice says there is a message and opens the app.

Status changes are written by database functions (no direct updates by the app), each with a reason where a person declines or
cancels, and audited.

## 9. Money (integer cents)

**Principle.** Every amount is integer cents (`*_cents`). The Community Market is **sales, not giving**: nothing here creates a pledge
or touches a fund, and no market sale is ever a tax-deductible donation or appears on a donation receipt.

### 9.1 Slice by slice: who pays whom

| Slice | Who pays whom | Does Weaver or the community touch the money? |
|---|---|---|
| 1: the community's own products (built, 0830) | **Nobody pays: the listings are read-only and not orderable** (CM8: no money moves in slices 1 to 3). The member app enforces it; no database rule does (see 15). If the owner answers CM25 yes, the buyer would pay the community exactly as the Food store works today (the payment sheet or "pay at pickup"; staff add sales tax at pickup, 0120), with the sales-tax and QuickBooks questions of CM25. | None in slice 1. If CM25 is yes: the community, as today, plus the questions in CM25. |
| 2: inquiries | The buyer and seller settle **directly** (their own Zelle, cash, check, card reader) | **No.** |
| 3: orders as a record | Same: **directly with the seller** | **No.** The order records the agreed price in cents; it does not collect it. |
| 4: pay through the community | The buyer pays the **community** with the plugins it already has; the community owes the seller; the community pays the seller (check or ACH, recorded) | **Yes.** Needs the owner, a lawyer and an accountant first. |
| 5: automated seller payouts | The buyer pays; the platform splits (Stripe Connect accounts for sellers) | **Yes, a different business.** Not planned; revisit only with volume and advice. |

### 9.2 What slices 1 to 3 do instead of money

- The app says in plain words, on the listing and on the order: *"Pay the seller directly. The community and Weaver do not handle
  this payment, and cannot refund it."* The wording is the community's notice (section 10) and needs a lawyer's text.
- A seller may add **how they take payment** to their own listing as free text ("Zelle to the number I send you, cash on pickup").
  It is shown only to a buyer who has asked, never on the public listing, and the app warns buyers never to pay before they have the
  seller's reply in the app. (This is a known scam pattern; the warning is part of the screen.)
- Price is shown in the community's currency from integer cents. No tax is computed, and the screen says sellers are responsible for
  any tax they owe.

### 9.3 Slice 4 in detail (not approved, not built)

| Question | Plan |
|---|---|
| Who is paid | The **community** receives the buyer's payment through its own payment plugins (Settings › Payments), into its own connected account or bank. Weaver does not hold the money. |
| Does the community take a fee | An optional **community fee**, a percent in basis points set by the community inside a platform maximum, taken from the seller's side and shown to the seller before they list; the buyer pays the listed price. Off by default. Weaver takes no fee in any slice described here (pricing is not committed, section 12). |
| Sales tax | Today the store does not compute tax online (a member order carries 0 and staff add it at pickup). Market sales through the community raise a harder question: where the community collects the payment it may be treated as the seller or as a marketplace facilitator for sales tax in some states. **A lawyer and the community's accountant decide this before slice 4.** The design leaves a `tax_cents` on the order and a per-listing `taxable` flag, and calculates nothing until then. |
| How payments go through the plugins | The same payment sheet and plugins as the store (`member_payment_methods`, context `market`), recorded in `payments` with a new `source` and linked to the order; card data stays at the provider. A plugin that is off is not offered. |
| What the community owes the seller | A **due-to-seller balance** per seller (cents), increased when a payment is received, decreased when the community records a payout (check number or ACH reference). Visible to the seller in their app and to the community's treasurer. |
| Seller payouts | Slice 4: the **treasurer pays the seller by check or ACH and records it**; the balance goes down. A payout is a money movement, so it uses the existing second-approver rule (`giving.approve`). Automated payouts to sellers (slice 5) would need each seller to be a payee on a payment provider, and are not planned. |
| Refunds | The existing refund request and approval (`payment_refunds`, with a reason and a second approver), which reverses the due-to-seller amount; if the seller was already paid the balance goes negative and is netted against later sales or collected, recorded either way. |
| Disputes and chargebacks | The community's moderators mediate the seller and buyer (report, evidence, outcome recorded). A card chargeback goes through the payment provider's dispute process; who bears its cost (the plan assumes the seller, through the balance) is a lawyer's and the owner's decision. |
| QuickBooks | New account roles in `app.account_roles`: market sales income, sales tax payable, **due to sellers** (a liability), market fee income and market refunds. A missing account raises `CCMAP` and the posting waits in the exception queue; **never a default account**. The pieces that post a store sale are not built yet (B59 item 2), and slice 4 builds on them. |
| Receipts | A **sales receipt** (seller name, item, price, tax, community fee never shown to the buyer), clearly not a donation receipt. Numbered like other receipts. |
| What is not built | Everything in this table. |

### 9.4 What I could not settle and the owner must put to an adviser

Marketplace-facilitator sales-tax rules, whether holding and paying out other people's money needs a licence in the community's
state, how a seller's income is reported (a payment provider that pays sellers has its own reporting duties; a community paying by check
may have its own), and what insurance the community needs. These are not engineering questions. The same
discipline applies as for CatchTheMatch's fee (C9): **a lawyer's view before any money flows**, and slices 1 to 3 are built meanwhile
because they move none.

## 10. Trust and safety

| Area | Rule |
|---|---|
| **Prohibited, everywhere (the platform minimum)** | Weapons and ammunition; alcohol, tobacco, vaping and cannabis; drugs and prescription items; adult content; live animals; recalled or counterfeit goods; stolen goods; hate speech; investment, lending or "make money" offers; multi-level and recruiting schemes; anything illegal where the community or the buyer is; regulated professional services (medical, legal, tax, financial advice) in the first slices. |
| **Food** | The Community Market is not a way for members to sell home-cooked food. Food stays in the **Food section**, which the community itself runs. A community that wants sellers' food states which food rules apply (many places regulate it) and the seller attests it; off in the first slices (CM6). |
| **The community's own house rules** | Free text each community adds to the minimum (a temple may exclude meat, alcohol or leather; a chamber may exclude competitors of its members). Shown to sellers before they list and enforced by reviewers. A community can add rules; it cannot remove the minimum. |
| **Review before publishing** | Every new listing is reviewed in the first slices (CM5). A listing that changes its title, category, price mode or photos goes back to review. |
| **Reporting** | A **Report** link on every listing, seller and message thread: reason (prohibited item, scam, rude, not as described, other) and a note. A report goes to the moderation queue (`market.moderate`), which can hide the listing at once, pause the seller, or dismiss with a reason. The reporter is told the outcome. |
| **Moderation queue** | One screen: new listings, reports, edited listings waiting again. Each row shows the household card of the seller, their history and the reason it is here. Decisions need a reason and are audited. |
| **Messages are private** | A thread is visible to the two parties. Moderators see it only when a report opens it (and the opening is audited); platform admins do not read it. Message bodies never go in a push or an email. |
| **Contact details** | A seller's phone and email are not on the listing. A buyer's contact details are shared only if the buyer chooses to in a message. |
| **Minors** | Sellers and buyers are adults. A child never sells, buys or messages; a parent acts. No listing may show a child's face or name, or be aimed at children without a parent's account. Money flows are adults-only, as everywhere in Weaver. |
| **Photos** | Private bucket, size limit, virus scan when the platform's scan is on, reviewed with the listing. Metadata (location) is stripped on upload. |
| **Fraud signs** | A new seller asking for payment before replying, a listing asking buyers to move off the app, links to other sites, a price far from the category's norm: flagged to moderators, never auto-punished. |
| **Liability notice** | Shown to sellers (accepted, versioned, recorded in `consents`) and to buyers (on every listing and order): *sellers are independent; the community does not make, inspect, guarantee or insure what they offer and is not a party to a sale; Weaver provides the software only; trade carefully.* **The final wording is a lawyer's, supplied by the owner; the Community Market does not launch without it** (CM18). |
| **Appeals** | A declined or removed seller sees the reason and may reply once; a person with `market.manage` who did not make the decision reviews it. |
| **Who is blamed** | The notice, the seller terms and the audit trail are the community's protection. No design removes the risk entirely; the lawyer's text and insurance advice are part of launch (section 9.4). |

## 11. Who administers it: permissions, roles and RLS impact

**All of this changes permissions and RLS, and so needs the owner's approval before it is built.**

### 11.1 New permissions

| Permission | Meaning |
|---|---|
| `market.view` | See the Community Market in the portal: sellers, listings, orders (counts and statuses; message bodies only through a report). |
| `market.manage` | Approve, pause and end sellers; review and edit listings; categories, featured, settings, house rules; handle orders as the community. |
| `market.moderate` | The queue only: review new and edited listings, handle reports, hide a listing, pause a seller. A communications or content lead can hold this without being able to change settings. |

A new role, **Community Market lead** (`market_lead`, operational), holds all three. The existing **store lead** (`store.manage`) keeps
running the Food section and the community's own products (slice 1 reuses the store permissions) but does **not** automatically manage
sellers: that is a different job (CM15). A person's seller status is not a permission; it is a relationship (an approved seller record),
like being an adult of a household.

### 11.2 New tables (proposed; every one gets RLS, an audit trigger and a `module_tables` row for the `market` module)

| Table | Slice | Who reads | Who writes |
|---|---|---|---|
| `market_sellers` | 2 | The person; the community's `market.view`; (approved sellers' public name and about, to signed-in members) | The person applies; only `market.manage` decides; changes by function, audited |
| `market_listings` | 2 | Signed-in members read published listings of an active seller; the seller reads their own; `market.view` and `market.moderate` read all | The seller writes their own as draft and submit; only `market.moderate` or `market.manage` publish, reject, feature |
| `market_listing_photos` (or a path list) | 2 | As the listing | The seller, for their own draft |
| `market_inquiries`, `market_messages` | 2 | The two parties only; a moderator through a report | The parties, through functions |
| `market_reports` | 2 | Moderators; the reporter their own | Any signed-in member |
| `market_orders`, `market_order_events` | 3 | The buyer, the seller, `market.view` (no message bodies) | By functions only, with a reason where a person declines or cancels |
| `market_reviews` | 3 | Signed-in members read published reviews | The buyer once per completed order; moderation hides |
| `market_payments` / due-to-seller ledger, `market_payouts` | 4 | Seller (own), treasurer | By functions only, second approver for a payout |

Community settings live in `centers.rules.market` (a `settings.manage` write, as the store's rules do). Categories reuse
`store_categories` with `section = 'market'` (no new table). **No policy is written until the owner approves**; the table above is
what the owner is asked to approve.

### 11.3 What the module switch does

The `market` module `depends_on` `store` and `people`. A community with the Store module off has no Community Market. The restrictive
`module_switch` policy hides every market table when the module is off or paused, data never deleted. The guest look-around gate
(`demo_guest_gate`, 0816) is added for any table a guest may ever read. Slice 1's community products are `store_items`, which the
Store module gates; if the market module is later paused, those rows would still be visible unless a restrictive policy ties
`section = 'market'` rows to the `market` module. That policy is part of slice 1 and needs the owner's approval.

### 11.4 Platform admins and Weaver staff

The standard rules apply: a platform admin turns the product on or off with a reason and a fresh 2FA check (P1) and can see
operational data for support under the existing support-grant model. **Message bodies and buyers' details are not read by platform
admins** (CM16): the market does not need the stricter WeCare rule for everything, but private messages are private.

## 12. How it relates to the rest of Weaver

### 12.1 The Marketplace packs and Settings › Marketplace (rules P1 to P6)

| Rule | Applied to the Community Market |
|---|---|
| P1 | A platform admin turns it on per community with a reason and a fresh 2FA check, audited (`app.set_module_grant`, already built). |
| P2 | The community's own admin may pause or resume it once granted, never grant it. |
| P3 | It is a Marketplace product with a card in Settings › Marketplace that says **Request** until Marketplace phases 2 and 3 (prices, billing) exist; Weaver grants by hand. It has **no price** and none is promised. |
| P4 | A lapse makes it read-only for 30 days, then hidden; data is never deleted. |
| P5 | **Off for every kind of organization by default.** The migration that adds the module must set `default_off` for every kind, with a test (a new module key gets `default_on` for Jain centers automatically, so this is explicit). |
| P6 | The key `market` never changes; the label ("Community Market") can. Installed apps ignore a key they do not know. |

Proposed card: key `market`, label Community Market, depends on Store and People, tables as listed in section 11.2, guards on every
function that writes them.

### 12.2 WeCare

Independent products. The Community Market reads People and nothing of WeCare; WeCare reads nothing of the market. A seller or buyer is
not a "donor". If the owner later wants a seller to give a share of sales to the community, that is a Giving matter (a gift), kept
apart from the sale.

### 12.3 CatchTheMatch

Independent. The one thing in common is the **discipline**: a fee only after a lawyer's view (C9), and Weaver's own fee not
committed. The Community Market has no Weaver fee in any slice described here.

### 12.4 Demos

Both demo packs (faith and neutral) get a few **invented** sellers and listings (no real businesses, no real names) when slice 2
lands, so a visitor can browse the Community Market; the guest look-around gate covers any table a guest may read. The neutral
demo's **Club shop** (T-shirt, tote bag, mug, cookbook, lemon bars) is not food and sits under the Food heading after 0821; slice 1 files it
in the Community Market. The demo's seller messages and orders are test data, reset nightly with the rest.

### 12.5 The Food section

Unchanged. Ordering, pickup slots, the kitchen display and the prep list are Food's. In slice 1 a market listing is not orderable, so
nothing of the market reaches a kitchen; the portal's prep list and the event-day kitchen display still show Food's lines only, as a
safeguard. If the owner opens ordering of the community's own listings (CM25), connect-admin's kitchen display and store page need the
same Food-only filter.

## 13. Any kind of organization

- No code or wording is specific to one community. Categories, house rules, the notice, the starter set and the word for a seller are
  data; the kind of organization changes the starter set and the examples.
- A faith community may exclude things its tradition excludes; a chamber of commerce may use it as a member directory with offers.
  Both use the same module.
- Languages: a listing is written in one language; the app's own words are in English, Gujarati and Hindi like the rest. No automatic
  translation in the first slices (iWeaver can offer it later).
- Currency is the community's own (`centers.currency`); prices are integer cents everywhere.

## 14. Build order

Each slice ships on its own. Migration and test numbers are reserved when a slice is approved. "Owner OK" means the owner approves
before it is built, because it changes money rules, permissions or RLS.

| Slice | What | DB | Portal | Member app | Size | Owner OK |
|---|---|---|---|---|---|---|
| 0 | **Store sections** (built) | 0821 | Food heading | contract documented | S | No (no money, permission or policy change) |
| 1 | **BUILT (0830).** **Community products, organized.** The community files its own non-food products in the Community Market, with the starter categories and a featured shelf; the product switch exists | The `market` module row (`default_off` for every kind, test), the product card, a restrictive policy tying `section = 'market'` rows to the module, a category starter function | Creation opens when the module is on (`sectionOpen()`); the Community Market page, categories and listings; the kitchen prep list shows food lines only (a safeguard); the featured shelf is NOT built (it needs a column and the app's agreement) | Reads `section`, the switch, category chips; **listings shown read-only, no Add button, the cart refuses them** (connect-mobile 1.22.0); search over items is not built | M | **Yes: module, RLS** |
| 2 | **Sellers and listings, inquiry only.** Applications and approval; listings of all four kinds with photos; review queue; browse, search, "Ask about this"; reports and takedowns; the notice and the seller terms | Tables `market_sellers`, `market_listings`, photos, `market_inquiries`, `market_messages`, `market_reports`; the three permissions and the role; notification topics; the bucket; functions for every write | Store › Community Market: Sellers, Listings, Reports, Settings; the seller terms and notice in `legal_documents` | Browse, listing page, ask, my listings, my inbox, apply to sell, report | L, several PRs | **Yes: permissions, RLS** (money: none) |
| 3 | **Orders as a record, and reviews.** Quote, accept, make, deliver, complete, review | `market_orders`, `market_order_events`, `market_reviews`; status functions | Orders overview | Quote, accept, order status, review | M | **Yes: RLS** (money: none, price recorded in cents, not collected) |
| 4 | **Pay through the community.** Fee, tax, refunds, payouts, QuickBooks, receipts | Payments `source`, due-to-seller ledger, payouts, account roles, refund link | Payments, payouts and mapping screens for the treasurer | Pay in the order | L | **Yes: money rules, permissions, RLS.** After a lawyer, an accountant and the store-sale postings (B59 item 2) |
| 5 | Automated seller payouts | Seller payees on a provider | | | L | Not planned |
| 6 | Polish: seller pages, rating averages, scheduled featuring, public pages on WeaverSite, iWeaver listing drafts | | | | M | Per item |

Slice 1 can start as soon as the owner approves CM1, CM2 and the module/RLS item; it moves no money and needs no seller. Slice 2 is the
one that makes the section real for people; it should be built **only after** slice 1's app release is in members' hands, otherwise sellers
would list things that no installed app can show.

## 15. What is not built, and honest limits

- **Only slice 1 is built** (0830): the module, the permissions, the policies and the portal's page for the community's own listings,
  shown read-only in the member app. Everything from slice 2 on is a plan.
- **In slice 1 the app, not the database, keeps a market listing out of an order.** No database rule blocks an order line that names a
  market item: the pricing trigger on order lines (0120) checks only that the item exists and is active and ignores the section and the
  module. So slice 1 relies on the member app (no Add button, the cart refuses a market item) and on the module being **off by default
  for every community**; only a community Weaver deliberately granted the market to is exposed, and only to a member who calls the API
  directly. A database rule is an owner decision (money and RLS), tracked as CM25 and in `STORE_SECTIONS.md` section 8.
- **CM14 (members only by default, through Access levels) is not implemented in slice 1.** Today it is the app's behavior (it shows the
  market to signed-in members) and the store's "Store visible to" setting; the database lets a guest who queries directly read an
  active market item as it lets them read an active Food item. The Access-levels area comes with seller listings (CM26).
- No money moves in slices 1 to 3 other than what the Food store already does. The community and Weaver cannot refund a payment a
  buyer made directly to a seller, and the app says so.
- Weaver cannot verify that a seller is who they say, only that the community's staff approved them. Photos and messages can be
  abused; moderation is a person's work. The notice and the terms are a lawyer's.
- Old member apps ignore sections (section 3.1).
- Analytics: Weaver has no usage analytics in the member app (B77), so adoption of the app release that groups by section cannot be
  measured; the module is off by default so only a community Weaver switches on is affected.

## 16. Decisions for the owner

Each has my recommendation first. **Accepted by the owner on 2026-10-15 ("go with the recommendations"): all of CM1 to CM24.** Slice 1 is
built on that; every later slice still needs the owner's approval of its money rules, permissions and RLS before it is built.
**CM25 and CM26 were raised after slice 1 was built and are open.**

| # | Question | Recommendation |
|---|---|---|
| CM1 | **The name.** What does a person read in the store: "Community Market", "Community Marketplace", or another? (The data key `market` is fixed.) | **Community Market.** Same idea as "marketplace", no clash with Settings › Marketplace. |
| CM2 | **Is it a Marketplace product?** Off by default for every kind, granted by a platform admin (P1 to P6), a card that says Request. | **Yes.** It is a major feature with its own tables, rules and risk, like WeCare. No price is set. |
| CM3 | **Who may sell, in what order?** The community itself, members, approved vendors. | **All three, built in that order:** the community's own products first (slice 1), members next (slice 2), vendors once members work (they need an account). |
| CM4 | **How is a seller approved?** | A person with `market.manage` reviews an application with the applicant's household card, approves or declines with a reason; sellers are adults; terms accepted. |
| CM5 | **Is every listing reviewed before it is published?** | **Yes, every new listing and every change to title, category, price mode or photos** in the first slices. A community setting "trusted sellers publish at once" can come later. |
| CM6 | **Food from sellers?** May members sell home-cooked food in the Community Market? | **No in the first slices.** Food stays in the Food section the community runs. Revisit with local food-safety rules in view. |
| CM7 | **Listing kinds.** The four the owner named (product, made to order, service, quote only). | **Yes.** Modeled as three kinds and a price mode (fixed, from, quote), shown as four. |
| CM8 | **First money slice.** Inquiry and pay the seller directly. | **Yes.** Slices 1 to 3 move no money; the app says "Pay the seller directly" in plain words. |
| CM9 | **A community fee on market sales.** | **None at first.** Later, an optional percent set by the community within a maximum, only in slice 4. |
| CM10 | **Weaver's own fee or price for the product.** | **None committed.** Pricing is not committed; the card says Request. If a success fee is ever chosen it follows CatchTheMatch's discipline (a lawyer first). |
| CM11 | **Sales tax.** | None computed in slices 1 to 3 (sellers are responsible; the screen says so). For slice 4, **a lawyer and the community's accountant decide before building.** |
| CM12 | **Refunds and disputes.** | Slices 2 to 3: the community's moderators mediate, no money. Slice 4: the existing refund approval, reversing the due-to-seller amount. |
| CM13 | **Seller payouts.** | Slice 4: the treasurer pays by check or ACH and records it, second approver. **No automated payouts or seller accounts at a payment provider** unless volume and advice justify it. |
| CM14 | **Who can see the market?** Guests, members only, or per community? | **Members only by default, per community through Access levels.** The Food store stays as it is (guests may see it). *Accepted; **not implemented in slice 1** (CM26).* |
| CM15 | **Permissions and role.** `market.view`, `market.manage`, `market.moderate` and a Community Market lead role; the store lead keeps the Food section and the community's own products. | **Yes**, as in section 11.1. |
| CM16 | **Platform admin access to messages and buyers' details.** | **No** for message bodies and buyer details; the normal audited rules for the rest. |
| CM17 | **The old-app problem.** Ship the member app that groups by section before the first community turns the market on; accept the short period when an old app shows market products among the food. | **Yes.** The module is off by default so only a deliberately switched-on community is affected; Weaver checks the app situation for that community first. |
| CM18 | **The liability notice and seller terms.** The owner supplies a lawyer's text; the market does not launch without it. | **Required before slice 2 goes live.** I will draft a plain-English outline for the lawyer, not the final text. |
| CM19 | **Prohibited list.** The platform minimum in section 10, plus each community's house rules. | **Yes.** |
| CM20 | **Reviews.** Buyers review after a completed order, once, moderated; sellers may reply. | **Yes, in slice 3.** |
| CM21 | **Notifications.** Push and email; no SMS; no message bodies. | **Yes.** |
| CM22 | **Where sellers work.** The member app and its web version; no seller portal. | **Yes.** |
| CM23 | **Demos.** A few invented sellers and listings in both demo packs when slice 2 lands; the neutral demo's Club shop moves into the Community Market in slice 1. | **Yes.** |
| CM24 | **Build order against other priorities.** Slice 1 can start now (no seller, no money); slice 2 after slice 1's app is out; slice 4 after Marketplace billing, the store-sale postings and the advice. | **Yes.** |
| CM25 | **OPEN. May the community's own listings (slice 1) be ordered through the existing store checkout?** Today they are shown read-only and are not orderable (CM8: no money moves in slices 1 to 3); the member app enforces it, and **no database rule does**, so slice 1 relies on the app and on the module being off by default. Saying yes would involve: orders for market items reaching the kitchen and pickup lists (the slot, the cutoff and the "ready" notice are Food's); the Food-only filters in the portal (done) and in connect-admin (kitchen display and store page, not done); **sales tax** (a member's order carries 0 today and staff add tax at pickup, 0120); **QuickBooks posting of store sales** (not built, B59 item 2); the store sales reports (0670, 0672); stock and gift-pack rules; the member app (an Add button and the cart rule); and a database rule on order lines saying which sections they may name (a money-rule and RLS change). | **Not yet.** Keep the listings read-only until paying through the community is designed (slice 4), then decide once for all sellers. If the owner wants a community's own T-shirts and books orderable sooner, put them in Food, which already works end to end. |
| CM26 | **OPEN. CM14 (members only by default, through Access levels) is not implemented in slice 1.** The market has no Access-levels area yet; the member app shows it to signed-in members and the store's "Store visible to" setting applies, but no database rule keeps a guest who queries directly from reading an active market item (as for Food). | Add the market as an Access-levels area (default: members) with the seller listings in slice 2, which have tables of their own. Until then accept that "members only" is the app's behavior. |

**Reminder:** money rules, permissions and RLS need the owner's approval before anything is built. This plan is the request for that
approval; it does not assume it.
