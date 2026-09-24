# Give tab: prototype vs app parity audit

**Scope:** the Give tab and every screen reachable from it: opportunities, bolis, pledges, recurring gifts, labh, pay, confirmation, and the Satvik Store with its cart.
**Prototype:** `/home/user/connect-crm/docs/handoff/prototypes/source/Main.dc.html`. Line numbers are cited as `P:NNN`.
**App:** `/home/user/connect-mobile`. Paths are relative to that folder.
**Method:** I read the code only. I did not render screenshots. I made no edits, commits or pushes.

## The short version

1. **There is no in-app payment anywhere.**
   - **Prototype:** every "Pay…" button opens a Pay sheet (P:1559–1572). That leads to the animated "Saving" screen (P:901–926), then to "Thank you / Anumodana!" (P:443–450) or back to where the member came from.
   - **App:** every "Pay…" button calls `payNotice()` instead (`src/providers/feedback.tsx:94-118`). That opens an "Online payment" sheet saying payment "is being set up… pay at the office or by Zelle".
   - **Missing as a result:** the Pay sheet, the Saving screen and the Thank-you screen.
   - This was a deliberate choice for honesty (comment at `feedback.tsx:18-21`), but it is the largest visible gap. It needs a payment backend before it can be closed.
2. **Two screens are missing entirely:**
   - "New recurring gift" (`recsetup`). The app only shows an info banner instead (`recurring.tsx:97-98`).
   - "Birthday labh" (`labh`). There is no route and no strings for it.
3. **Giving opportunities use a different data model.**
   - **Prototype:** three kinds of opportunity:
     - `tier`: Platinum, Gold and Silver as large tiles.
     - `multi`: a pujan checklist with fixed bolis and "Already taken" rows.
     - `amount`: $10K / $25K / $50K / Other.
   - **App:** one generic screen with hard-coded chips at $101, $251, $501 and $1,001 (`opportunity/[id].tsx:30`).
   - **Schema:** `app.opportunities` (`0003_giving.sql:49`) has no tier, multi or preset-amount fields. Tiers would have to be separate rows, which would list as separate cards.
4. **The layout frame differs on every pushed screen:**
   - All Give sub-screens are pushed outside `(tabs)`, so the bottom tab bar disappears. The prototype keeps it visible on every view.
   - The header title is centred in the app; the prototype puts it left, beside the button, in Fraunces 22px navy.
   - The menu and back buttons are bare icons; the prototype uses 44px white circles with a `#E3D9C8` border.
   - The QR button is a plain icon; the prototype uses a solid navy circle with a white icon (P:21–40, `src/components/screen.tsx:47-75`, `ui.tsx:157`).

---

## 1. Give tab (root)

**Path:** tab bar → Give (P:362–398). **App:** `src/app/(app)/(tabs)/give.tsx`.

| Element | Prototype | App | Status |
|---|---|---|---|
| Header | Menu button · "Give" · QR button | `Screen title=tab.give root` (give.tsx:60) | Title centred, button styling differs (see frame note above) |
| Hero label | "Your family's giving in 2026" | `give.heroTitle` (en.ts:442) | MATCH |
| Hero amount | "$1,240", Fraunces 30px | `formatCents(givenThisYearCents)`, variant `hero` (give.tsx:78) | MATCH (live data) |
| Hero footer | "Tax statement ready in January" | en.ts:443 | MATCH |
| Bolis card | Amber card, title "Bolis", sub "3 open for pledges · 2 in-person only", "›" | Adds a ribbon icon (give.tsx:88); sub is `'{open} open for pledges · {inPerson} in person'` (en.ts:445) | DIFFERS: sub copy should read "in-person only"; the icon is EXTRA |
| Bolis card click | Opens `bolis` view | `router.push('/bolis')` | MATCH |
| Section heading | "Open opportunities" | en.ts:446 | MATCH |
| Opportunity row, line 1 | Name, and amount in brown on the right ("From $1,000") | give.tsx:109-114 | MATCH |
| Opportunity row, line 2 | Descriptive sub, e.g. "Tapasvi Bahuman · Sep 27 · Platinum, Gold, Silver" | Campaign name (give.tsx:116-120) | DIFFERS: no per-opportunity subtitle field exists |
| Opportunity progress bar | Always shown (a campaign goal %, or slots taken) | Only when `quantity_available` is set; adds a caption "N of M taken" (give.tsx:121-128) | DIFFERS: no goal-% fallback (`campaigns.goal_cents` is unused); caption is EXTRA |
| Opportunity row click | Opens `opp` | Pushes `/opportunity/[id]` | MATCH |
| Recurring giving row | 44px green-tint square with repeat icon, "Recurring giving", sub "1 active · $252 a year", "›" | Plain green icon, no tinted square (give.tsx:135) | Copy MATCH, visual DIFFERS |
| Section heading "Family pledges" | Heading sits outside the card | Title sits inside the card (give.tsx:147) | DIFFERS (layout) |
| Pledge tiles | Two tinted tiles: amber "Open balance · 2 open / $651", green "Paid in 2026 / $209" | Plain `Stat` blocks with no tile background (give.tsx:148-151, ui.tsx:583) | DIFFERS (visual) |
| "See all pledges · open and closed" | Navy outline pill → `pledges` | Secondary button → `/pledges` | MATCH |
| "Pay open balance · $651" | Solid navy button → Pay sheet for all open pledges → Saving → back to pledges | `tone="brown"` → payNotice (give.tsx:155) | DIFFERS (colour); **pay flow MISSING** |
| Child view | "Ask a parent" lock: cream `#F6EFE3` circle, brown lock icon, outline "Back to Home" (P:983–990) | `LockedState`: navy-tint circle, navy lock, filled primary button (states.tsx:50-65) | DIFFERS (visual) |

## 2. Giving opportunity ("Sponsor")

**Path:** Give → opportunity row, or Home → "View and sponsor" (P:400–441). **App:** `src/app/(app)/opportunity/[id].tsx`.

| Element | Prototype | App | Status |
|---|---|---|---|
| Title | "Sponsor" | `opp.title` | MATCH |
| Hero | 120px-tall brown block, name bottom-aligned, Fraunces 21px, no eyebrow | `Band` with the campaign name as an eyebrow (:86) | DIFFERS |
| Description | Paragraph | :87-91 | MATCH |
| Availability card | Bold slots text ("11 families have sponsored so far" / "2 of 8 pujans already taken" / "41% of campaign goal"), a "Live availability" label on the right, and an 8px bar | "N of M taken", bar, caption "Availability updates as families sign up." (:92-99); only shown when a quantity is set | DIFFERS: "Live availability" label MISSING, caption EXTRA, goal-% variant MISSING |
| Tier picker (`tier`) | Heading "Choose a sponsorship level"; 3 tiles, 60px tall, name + amount (Platinum $5,000 / Gold $2,500 / Silver $1,000); selected tile has brown border and amber fill; first tile preselected | none | **MISSING** |
| Amount picker (`amount`) | Heading "Choose an amount"; 2-column tiles "$10,000", "$25,000", "$50,000", "Other / Your amount" | Chips from a hard-coded list `[10100,25100,50100,100100]` filtered by the minimum (:30,:117-122) | DIFFERS: presets must come from data, and the tile style is different |
| Custom amount | Label "Your amount", brown-bordered field with a "$" prefix, default 5000, `type=number min=1` | `TextField` using `events.yourAmount`, no $ prefix, empty default, error below the minimum (:123) | DIFFERS |
| Pujan checklist (`multi`) | "Choose the pujans your family will take"; 8 checkbox rows with name, note ("Fixed boli" / "Already taken by another family", greyed out and not tappable) and amount; footer "N pujans selected" / "Select pujans" with the total | none | **MISSING** |
| Fixed-amount card | not present | Amber "Amount" card (:105-113) | EXTRA-IN-APP |
| Minimum line | not present | "Minimum $X" (:124-128) | EXTRA |
| Dedication field | not present on this screen | "Dedication (optional)", placeholder "e.g. In honor of Ba" (:131) | EXTRA |
| "Show our family's name with this seva" | Checkbox, always shown, checked | `Toggle`, only shown when `allow_anonymous` (:132) | DIFFERS (control type) |
| Pledge button | "Commit $X as a pledge", navy, greyed `#8A93AE` when the amount is 0 | `tone="brown"`, disabled (:134) | DIFFERS (colour) |
| Pledge click | Saving screen with steps ("Finding the Shah family…", "Creating a $X pledge · …", "Recording: Gold sponsor", "Emailing…"), then "See family pledges" → pledges | Creates the pledge, toast "Pledge saved · $X · #", then `router.replace('/pledges')` (:73-76) | DIFFERS: Saving screen MISSING; destination matches |
| Pay button | "Pay $X now", black outline | Secondary (navy) outline (:135) | DIFFERS (colour) |
| Pay click | Pay sheet → Thank you. No pledge is created. | **Creates a pledge**, then payNotice, then goes to pledges (:75) | DIFFERS: behaviour and flow |
| Footnote | "Pledges appear in Family pledges · pay anytime · tax receipt on payment" | Same, with a trailing "." (en.ts:473) | Near MATCH |

## 3. Pay sheet, Saving and "Thank you"

**App:** none of these exist; every pay action goes to `payNotice`.

| Screen | Prototype | App | Status |
|---|---|---|---|
| Pay sheet (P:1559) | "Pay" + "Cancel"; rows To "Jain Society of Houston" · For {payFor} · Card "Visa ···· 4417" · Total; black "Confirm with Face ID" | "Online payment" sheet: amount, "being set up… office or Zelle" copy, "Got it" | **MISSING** (replaced) |
| Saving (`sync`, P:901) | Center mark, title, "Please keep the app open", animated step list (✓ / … / pending, 750ms each), green "Saved to your JSH account" box with result, and a CTA ("See family pledges" / "See recurring giving" / "Done" / "Back to family pledges") | none (toasts instead) | **MISSING** |
| Thank you (`paid`, P:443) | ✓ in an 88px green circle; "Anumodana!"; "Your $X gift is received. A tax receipt is on its way to your email."; outline "Back to Give" | none | **MISSING** |
| Settings → "Saved payment methods" (P:1125, "Visa ···· 4417 · Apple Pay") | row | (Settings is out of scope; noted only) | — |

## 4. Bolis list

**Path:** Give → Bolis card (P:483–509). **App:** `src/app/(app)/bolis.tsx`.

| Element | Prototype | App | Status |
|---|---|---|---|
| Title / headings / intro copy | "Bolis"; "Pledge in the app"; "Pledge at or above the floor until the cutoff…" | en.ts:500-503 | MATCH |
| Digital card | Name; event; 3-column Floor / Top pledge / Closes; coloured status line | :52-66 | MATCH in structure |
| "Closes" value | Relative time: "4 days" / "44 days" | `formatDateTime(closes)`, an absolute date and time (:62) | DIFFERS: should use `formatTimeLeft` |
| Status "no pledges" | "No pledges yet · floor applies" | "No pledges yet · the floor applies" (en.ts:517) | DIFFERS |
| "In-person only" section + intro copy | as shown | en.ts:509-510 | MATCH |
| In-person row, sub line | "Tapasvi Bahuman · called about 11:30 AM" | Event · "called about" + full date and time (:82) | Minor DIFFERS: the prototype shows the time only |
| In-person row, **About** button | Separate text button → `hall` view | The whole card is tappable; "About" is plain text (:85-87) | DIFFERS |
| In-person row, **Remind me / Reminder set** toggle | Inline pill; filled navy when set | none on the list | **MISSING** |
| Empty states | none | "No bolis are open…", "No in-person bolis are scheduled." | EXTRA (fine) |

## 5. Digital boli ("Make a pledge")

**Path:** Bolis → digital card (P:511–547). **App:** `src/app/(app)/boli/[id].tsx` (`DigitalBoli`).

| Element | Prototype | App | Status |
|---|---|---|---|
| Title | "Make a pledge" | en.ts:501 | MATCH |
| Hero | Name (Fraunces) / event / "Pledging closes Sat, Sep 26 · 9 PM · 4 days" | Band with the event as eyebrow **above** the name; subtitle "…· 4 days left" (:215, en.ts:520) | DIFFERS (order; the word "left" is added) |
| Explainer | 96×72 dark video thumbnail with ▶ and duration (e.g. "1:00") to the left; "WHAT IS THIS BOLI?"; short text; expandable extra text; "Playing explainer video…" state; "Read more" / "Show less" always shown | No thumbnail; a full-width secondary button "Play explainer video" opens a browser; "Read more" only when the text is over 220 characters (:145-173) | DIFFERS: thumbnail layout and duration MISSING |
| Stats | 3 separate white tiles: Floor / Top pledge / Pledges | One card with a 3-column `Stat` row (:217-223) | DIFFERS (visual) |
| Status banner | Tinted banner with the status text | `Banner` with tone mapped (:224) | MATCH |
| "Your pledge" stepper | 52px −/+ circles, Fraunces 32px value; "Minimum right now $772 · steps of $21" | `Stepper`; step comes from `step_cents` (default $101) (:230-240) | MATCH (the step is data-driven) |
| Anonymous toggle | none | "Don't show our family's name" (:241) | EXTRA-IN-APP |
| Pledge button | "Pledge $772", **navy** | `tone="brown"` (:243) | DIFFERS (colour) |
| Pledge click | Placed immediately; status updates; stepper moves up by one step | Confirm dialog "Pledge $X?" first, then toast "Pledge placed · $X" (:196-203) | EXTRA confirm (probably keep) |
| Notify note | "You'll be notified if another family pledges more…" | en.ts:536 | MATCH (the app puts it inside the card; the prototype puts it below) |
| "Demo: simulate another family…" | prototype-only demo | — | skip |

## 6. In-person boli

**Path:** Bolis → "About" (P:771–791). **App:** `boli/[id].tsx` (`HallBoli`).

| Element | Prototype | App | Status |
|---|---|---|---|
| Screen title | **"In-person boli"** | "Make a pledge", shared with the digital screen (:139) | DIFFERS |
| Hero | Eyebrow "IN-PERSON ONLY", name, when | Band in brownDark (:298) | MATCH |
| Explainer | Same thumbnail layout as the digital screen | Button version | DIFFERS (as in §5) |
| Hall note copy | "This boli is called live in the hall…" | en.ts:537 | MATCH |
| Remind button | "Remind me before it is called", navy; when set, "Reminder set · tap to remove", green | Brown when unset; secondary when set; bell icon (:304) | DIFFERS (colours) |

## 7. Family pledges

**Path:** Give → "See all pledges", or drawer → My Donations, or Settings → Receipts (P:928–981). **App:** `src/app/(app)/pledges.tsx`.

| Element | Prototype | App | Status |
|---|---|---|---|
| Year chips | "All years", 2026, 2025, 2024 as navy outline pills | `Chip`s built from the data (:116-121) | MATCH |
| Summary tiles | Amber tile: "Open balance" / $651 / "2 open"; green tile: "Paid · all years" or "Paid in 2025" / amount / "**N closed overall**" | One card with `Stat`s; the open label is "Open balance · N open"; **no "closed overall" line** (:122-127) | DIFFERS |
| Filter | Segmented All / Open / Closed | :128-137 | MATCH |
| Year group header | **Collapsible** (chevron circle; with "All years", 2026 is open and older years are collapsed); Fraunces 22px navy year; 2px navy underline | Static, no collapse, no underline (:143-153) | **MISSING** collapse; visual DIFFERS |
| Year summary line | "3 pledges · pledged $752 · paid $101" | "Pledges: 3 · pledged … · paid …" (en.ts:489) | DIFFERS |
| Statement action | Tappable: "Statement in Jan" (current year, does nothing) or "2025 tax statement ↓", which shows the toast "✓ 2025 giving statement emailed to {email}" | Static caption: "Statement ready · ask the office for a copy" / "Statement in January" / "Statement from the office" (:150-152) | **MISSING** action; copy DIFFERS |
| Pledge row | **Own card per row**; navy border when selected; navy checkbox; name / sub / "By Priya · Sep 12, 2026 · JSH-PL-24650"; amount on the right with the status pill **under the amount** ("Open" / "Paid Apr 12, 2026") | All rows inside one card; **brown** checkbox; pill under the meta text on the left (:40-75) | DIFFERS (layout and colour) |
| Empty group | "No pledges match this filter" shown under each year | One global EmptyState (:138) | Minor DIFFERS |
| Pay button | "Pay 2 pledges · $651" in navy; greyed "Select open pledges to pay"; **hidden when there are no open pledges** | "Pay selected (2) · $651" in brown, always shown (:168-173, en.ts:495) | DIFFERS |
| Pay click | Pay sheet → Saving "Recording your payment" → "Back to family pledges" (pledges marked Paid) | payNotice | **MISSING** flow |
| Footer | "Shows pledges by all adult family members…" | en.ts:497 | MATCH |

## 8. Recurring giving

**Path:** Give → Recurring giving row (P:1222–1233). **App:** `src/app/(app)/recurring.tsx`.

| Element | Prototype | App | Status |
|---|---|---|---|
| Title | "Recurring giving" | MATCH | |
| Hero label | "Recurring giving **this year**" | "Recurring giving a year" (en.ts:548) | DIFFERS |
| Hero sub | "1 active of 1" | en.ts:549 | MATCH |
| Row detail | "Monthly · since Aug 1, 2026 · **Visa ···· 4417**" | "Monthly · since … · next …" (:267); no payment method | DIFFERS: payment method MISSING; "next" is EXTRA |
| Row status | Plain text: "Active" green / "Paused" **amber `#8A4608`** | `Pill`: paused shows grey; adds "Payment failed" and "Stopped" (:272) | DIFFERS |
| Pause / Resume | Navy outline pill | Secondary small button | MATCH in behaviour (toast is EXTRA) |
| **Edit** button | Text button next to Pause (no action in the prototype) | none | MISSING |
| "Set up a recurring gift" | **Navy**; opens the `recsetup` screen | `tone="green"` with a + icon; shows an info banner "Online payments are being set up…" (:280-281) | DIFFERS; **flow MISSING** |
| Footer "Pause, change or stop anytime · receipts after each gift" | Belongs to the recsetup screen | Shown on the list screen (:282) | Misplaced |

## 9. New recurring gift

**Path:** Recurring → "Set up a recurring gift" (P:1235–1259). **App: MISSING.**

The prototype screen contains, in order:

- **"Give towards"**: six radio cards with label and sub:
  - Jeevdaya / Animal care and panjrapol support
  - Derasar upkeep / Daily puja, maintenance and utilities
  - Pathshala / Books, teachers and programs for kids
  - Bhojanshala / Community meals and ayambil
  - New temple construction / Founders Circle campaign
  - Sadharmik bhakti / Help for Jain families in need

  Selected card: navy border and `#EEF1F8` fill.
- **"Amount each time"**: $11, $21 (default), $51, $108, Other. "Other" shows a "$" number field (default 75, min 1).
- **"How often"**: Monthly, Quarterly, Yearly, "On family special days". The schema also supports `weekly`.
- **"Starting"**: Oct 1, 2026 · Oct 15, 2026 · "Next special day".
- **"For how long"**: "Until I stop" · "12 gifts" · "Through 2027".
- **"Pay with"**: "Visa ···· 4417" · "Bank account (ACH)".
- **Summary box**, e.g. "$21 monthly for Jeevdaya · first gift Oct 1, 2026 · until I stop · about $252 a year".
- **"Start recurring gift"** (navy). Clicking goes to the Saving screen, then "See recurring giving".
- Footer: "Pause, change or stop anytime · receipts after each gift".
- Back from this screen returns to Recurring.

The schema already supports purpose (`campaign_id` / `fund_id`), `amount_cents`, `frequency` and `method` (`0003_giving.sql:152`). **It has no end-condition or start-choice field**, and nothing links a gift to a special day beyond `special_day_id`.

## 10. Birthday labh

**Path:** Home labh card → "Choose a labh", or Family → Special days → "Plan labh" (P:1196–1220). **App: MISSING.** The view belongs to the Family tab but produces pledges and recurring gifts.

The prototype screen contains:

- **Hero:** "TUE, OCT 6 · {tithi}", "Anya's 10th birthday", "Choose one or more ways to mark the day".
- **Six checkbox rows** with amounts:
  - Snatra puja $51
  - Ashtaprakari puja $108
  - Pathshala class gift $151
  - Jeevdaya $51
  - Sponsor Sunday bhojanshala $251
  - Sadharmik bhakti $108

  Rows 1 and 3 are preselected. A counter reads "N labhs selected" next to the total.
- **"Dedication (shown at the derasar and to the Pathshala class)"** text field, default "In honor of Anya Shah's 10th birthday".
- **Toggle:** "Repeat every year on her birthday / Adds a yearly recurring commitment, reminded 2 weeks before".
- **"Commit $X as a pledge"**: Saving screen (adds a yearly recurring gift when the toggle is on) → "Back to special days".
- **"Pay $X now"**: Pay sheet.
- Back returns to Special days.

In the app, `special-days.tsx` has no "Plan labh" button. `grep labh` finds only `source.labh` and copy strings.

## 11. Satvik Store

**Path:** Home store banner, or drawer → Satvik Store (P:1012–1047). **App:** `src/app/(app)/store.tsx`.

| Element | Prototype | App | Status |
|---|---|---|---|
| Title | "Satvik Store" | MATCH | |
| Hero | Green card, "JSH Satvik Store" (Fraunces 24), body copy, **pill "Order by Thu 9 PM · pickup Sat or Sun"** | Title `{short_name} Satvik Store` and body (:42-49) | Pill **MISSING**. It could come from the next `pickup_windows.order_cutoff_at`. |
| Category chips | All, Mithai, Namkeen, Meals as green outline pills | Data-driven chips (:55-61) | MATCH |
| Item card | 72px coloured tile with photo icon; name; description; price in green; card border turns green when in the cart | 64px blank tint square; **`photo_path` is ignored**; price plus `pack_size` (:67-81); no selected border | DIFFERS |
| "Add to order" | Green outline button | `tone="store"`, filled (:102) | DIFFERS (filled vs outline) |
| In-cart controls | **One row**: − qty + and a gift toggle filling the rest ("Gift pack +$2.99" / "Gift packed ✓", amber when on) | Stepper, with a gift Chip **below** it; label "Gift packed ✓ (n)" (:83-99) | DIFFERS |
| Floating cart bar | Floating pill above the tab bar: "View order · 3 items" … "$26.97" | Footer bar "View order (3)" … total (:30-40, en.ts:884) | DIFFERS (copy "· N items") |

## 12. Your order (cart and checkout)

**Path:** Store → View order (P:1050–1085). **App:** `src/app/(app)/cart.tsx`.

| Element | Prototype | App | Status |
|---|---|---|---|
| Title | "Your order" | MATCH | |
| Line | "Mohanthal × 2" with the total; "$8.99 each + gift packing $2.99 each"; − and + buttons (no count shown) and a **gift toggle** | Stepper with count (:198); detail copy "…each + gift packing {gift} × {n}"; **no gift toggle in the cart** | DIFFERS; gift toggle MISSING |
| "+ Add more items" | Goes to the store | "Add more items" (no "+"), `router.back()` (:201) | Minor DIFFERS |
| Gift message | "Gift card message (optional)", placeholder "**e.g. Happy Diwali from the Shah family**", single line | No placeholder; multiline (:203) | DIFFERS |
| Pickup heading | "Pickup at Jain Center" | "Pickup at **the** Jain Center" (en.ts:892) | DIFFERS |
| Pickup options | Bordered buttons ("Sat, Sep 26 · 11 AM – 1 PM"…), selected in green | `Radio` with an extra sub "location · order by …" (:212) | Visual DIFFERS; the sub is EXTRA |
| Totals | Items (N) · "Gift packing (N × $2.99)" **always shown** · Total | Gift line only when above 0; adds "Sales tax, if any, is added at pickup." (:223-235) | Minor DIFFERS / EXTRA |
| Checkout button | "Pay $X **with Apple Pay**", black | "Place order · $X", store green (:246) | DIFFERS |
| Checkout click | Pay sheet → Saving "Placing your order" (4 steps) → "Order JSH-S-1042 is confirmed for pickup … N gift-packed." → "Done" → Home | Creates the order, toast "✓ Order # placed", payNotice ("Nothing has been charged"), `router.replace('/')` | DIFFERS: pay and Saving MISSING; the order is placed unpaid |
| Footer | "Made fresh for your order · cancel up to 24 hours before pickup" | Same plus "." | MATCH |
| Child access | Cart view fully locked | Cart shown, with LockedState in place of the button | Minor DIFFERS |

## 13. Entry points (other tabs; noted only)

- **Drawer:** "My Donations" (capital D) with sub "Pledges, payments and receipts". App: "My donations" (en.ts:50). DIFFERS on case.
- **Drawer:** "Satvik Store" with sub "Mithai and namkeen, made to order". App: "Order Jain mithai and namkeen" (en.ts:53). DIFFERS.
- **Home store banner:** sub "Order by Thursday for weekend pickup · gift packing available". App: "Order ahead for weekend pickup." (en.ts:305). DIFFERS.
- **Home opportunity card** "NEW GIVING OPPORTUNITY … View and sponsor": MATCH (`features/home.tsx:346-362`).
- **Home labh card** ("Choose a labh"): MISSING, since the labh flow is missing.

## 14. Brand text

The product brand must read "Community Connect"; JSH stays as the tenant name. User-visible strings that say "Connect":

- **In scope:** `bolis.reminderUnavailable` (en.ts:543), "…turned on in the Connect app…".
- **App-wide:**
  - en.ts:66 `drawer.version` "Connect · version"
  - :82 `setup.title`
  - :90 `lock.body`
  - :769 `settings.biometricSub`
  - :800 `settings.aboutSub`
  - :929 `scan.cameraDenied`
  - `app.json:3` `"name": "Connect"`
  - `app.json:51` and `:58`: camera and Face ID permission strings
- **Prototype strings to keep as tenant:** "JSH Satvik Store", "To: Jain Society of Houston", "Saved to your JSH account". If the Saving screen is built, parameterise the last one as "{center} account".
- The prototype's own `<title>JSH member app</title>` is not user-visible in the app.

---

## Prioritised fix list

### P1: broken or missing flows

1. **Payment flow.** Build a Pay sheet (To {center} / For / Card / Total / Confirm) → Saving screen → "Thank you / Anumodana!" screen, and route every pay button through it:
   - Give "Pay open balance"
   - Opportunity "Pay now"
   - Pledges "Pay N pledges"
   - Cart checkout
   - Tickets "Pay now"
   - Labh "Pay now"

   This is blocked on a payment edge function. Until then, keep `payNotice`, but say in the handoff that the prototype flow is not reproduced.
   Files: `src/providers/feedback.tsx`; new `src/app/(app)/pay.tsx`, `paid.tsx` and a `SyncProgress` component; plus give.tsx, opportunity/[id].tsx, pledges.tsx and cart.tsx.
2. **"New recurring gift" screen.** Build `src/app/(app)/recurring-setup.tsx`: purpose, amount presets plus Other, frequency, start, duration, pay-with, summary, "Start recurring gift". Wire it from the recurring.tsx:281 button (navy). Add i18n keys. A migration is needed for start and end choices, and gift creation needs a payment method or mandate.
3. **"Birthday labh" screen and its entry points.** Build `src/app/(app)/labh/[dayId].tsx`: options checklist, dedication, repeat-yearly toggle, commit as pledge, pay now. Add "Plan labh" in `special-days.tsx` and a labh card on Home (`features/home.tsx`). The labh options need a data source; there is no table for them today.
4. **Opportunity kinds.** Support tier tiles, preset-amount tiles plus Other, and the multi-pujan checklist with taken rows. Remove the hard-coded `SUGGESTED` list. Files: `opportunity/[id].tsx`, `lib/api/giving.ts`, and a schema addition in `connect-crm/supabase/migrations`, e.g. `opportunities.kind`, `options jsonb` / preset amounts, and a subtitle; or group opportunities by campaign.
5. **Opportunity "Pay now" should not silently create a pledge**, or the button label should say so (`opportunity/[id].tsx:75`).
6. **In-person boli "Remind me" toggle** inline on the Bolis list, plus a separate "About" button (`bolis.tsx:76-90`).
7. **Pledges year groups** should collapse (current year open, older years collapsed under "All years"). The statement action should be tappable ("{year} tax statement ↓" → email or download; `statements.storage_path` already exists) (`pledges.tsx:139-166`).

### P2: wrong fields, copy or behaviour

1. en.ts copy fixes:
   - `give.bolisSub` → "{open} open for pledges · {inPerson} in-person only"
   - `bolis.statusNoPledges` → "No pledges yet · floor applies"
   - `recurring.heroTitle` → "Recurring giving this year"
   - `pledges.groupLine` → "{n} pledges · pledged {pledged} · paid {paid}"
   - `pledges.payN` → "Pay {n} pledges · {amount}" (with singular/plural)
   - `store.pickup` → "Pickup at Jain Center"
   - `store.viewOrderShort` → "View order · {n} items"
   - `store.giftPacked` → "Gift packed ✓"
   - `store.addMore` → "+ Add more items"
   - Add the gift-message placeholder "e.g. Happy Diwali from the Shah family"
   - `drawer.donations` → "My Donations"
   - `drawer.storeSub` → "Mithai and namkeen, made to order"
   - `home.storeBody` → "Order by Thursday for weekend pickup · gift packing available"
2. Bolis list "Closes" column: use `formatTimeLeft` (e.g. "4 days") instead of the date and time (`bolis.tsx:62`).
3. In-person boli screen title "In-person boli" (`boli/[id].tsx:139`).
4. Pledges summary: add "{n} closed overall" under the paid tile; show the open tile as "Open balance" / amount / "{n} open"; hide the pay button when nothing is open (`pledges.tsx:122-127,168`).
5. Recurring row: add the payment method to the detail line; show paused in amber; add the "Edit" action; move the footer to the setup screen (`recurring.tsx:267-282`).
6. Store:
   - Add the hero pill "Order by {cutoff} · pickup {days}", derived from `pickup_windows`.
   - Render `store_items.photo_path` in a 72px tile.
   - Add the gift toggle to cart lines (`cart.tsx:189-200`).
   - "+ Add more items" should navigate to `/store`.
7. Opportunity screen:
   - Add the "Live availability" label.
   - Add the campaign goal-% progress (use `campaigns.goal_cents`) on the Give list and the detail screen.
   - Add a per-opportunity subtitle line on the Give list.
   - Drop the "Availability updates…" caption and the list caption "N of M taken".
8. Explainer:
   - Show the "Read more" / "Show less" toggle for any extra text.
   - Replace the Play button with a video thumbnail that shows the duration (`boli/[id].tsx:145-173`).
9. Brand: replace user-visible "Connect" with "Community Connect" in the en.ts lines listed in §14 and in `app.json` name and permission strings.

### P3: visual polish

1. App frame (`src/components/screen.tsx`, `ui.tsx` `IconButton`, `(app)/_layout.tsx`):
   - Left-aligned Fraunces 22px navy title.
   - Bordered white 44px circular menu and back buttons.
   - Navy-filled QR button.
   - Keep the bottom tab bar visible on Give sub-screens, e.g. nest bolis, pledges, recurring, opportunity, boli, store and cart in a Give stack inside `(tabs)`.
2. Button colours to match the prototype:
   - Navy primary: "Pay open balance", "Commit … as a pledge", "Pledge $X", "Set up a recurring gift", "Pay N pledges".
   - Black outline: "Pay $X now".
   - Black filled: checkout.
   - Green outline: "Add to order".

   Files: give.tsx:155, opportunity/[id].tsx:134-135, boli/[id].tsx:243/304, recurring.tsx:281, pledges.tsx:170, store.tsx:102, cart.tsx:246.
3. Give tab:
   - Tinted amber and green pledge tiles.
   - "Family pledges" heading outside the card.
   - Green-tint icon square on the Recurring row.
   - Remove the ribbon icon from the Bolis card.
4. Pledge rows as individual cards with a navy selected border and navy checkbox, and the status pill under the amount (`pledges.tsx:40-75`). Year header in Fraunces 22px with a navy underline.
5. Boli stats as three separate tiles; hero with the name first and the event under it (`boli/[id].tsx:215-223`).
6. Store: item card border turns green when in the cart; stepper and gift toggle on one row; floating cart pill (`store.tsx`).
7. Tier and amount pickers as 60px tiles, not chips; custom amount field with a "$" prefix and brown border.
8. LockedState: cream circle, brown lock, outline "Back to Home" (`src/components/states.tsx:50-65`).
