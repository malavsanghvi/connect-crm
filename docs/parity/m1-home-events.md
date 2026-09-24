# Prototype vs app parity audit: Home tab and Events tab

**Scope:** `Main.dc.html` (prototype), compared with `/home/user/connect-mobile`. Read-only; I made no edits, commits or renders. Everything below comes from reading the code: the prototype markup (lines 22–360 and 726–1430), `renderVals()`/`_rv()` (lines 1586–2305), and the app sources. Prototype line numbers are given as `P:NNN`. App paths are relative to `connect-mobile/`.

**Prototype-only scaffolding I ignored:** the "PROTOTYPE · SAMPLE DATA" badge (P:20), the "PROTOTYPE TOUR" demo buttons (P:140–153) and the sample-data footer (P:154). The tour buttons do point at real flows the app needs (push notifications, the in-app pop-up, check-in, lunch reminder), so those flows are covered in §9.

---

## 0. Shared chrome: header, tab bar, drawer, Niva button

| Element | Prototype | App | Status |
|---|---|---|---|
| Home header centre | JSH logo image (46px) plus a two-line serif wordmark "JAIN SOCIETY" / "OF HOUSTON", centred (P:29–33) | `CenterMark` (logo, or initials in a navy circle) plus the center name as one uppercase caption, left-aligned (`src/components/screen.tsx:35-45, 59`) | DIFFERS (P3) |
| Sub-screen title | Fraunces 22, navy, left-aligned right after the back button (P:36) | `Txt variant="title"`, centred (`screen.tsx:59-65`) | DIFFERS (P3) |
| Menu / back buttons | 44px white circles with a 1px `#E3D9C8` border (P:24, 27) | Bare icons in `IconButton` (`ui.tsx:157-169`) | DIFFERS (P3) |
| Member-card (QR) button | Filled navy circle with a white QR icon; shown on every screen (P:38) | Bare navy `qr-code-outline` icon; members only (`screen.tsx:70-71`) | DIFFERS (P3) |
| Tab bar | Home · Events · Give · Jain Way · Family; the Jain Way icon is an open book (P:1325) | Same labels; the Jain Way icon is a `flower` (`(tabs)/_layout.tsx:56`) | icon DIFFERS (P3) |
| **Niva floating button** | Saffron pill "✦ Niva", bottom-right on every tab and most sub-views (P:1398–1411). Tapping opens a popover: "Ask JSH Niva", "Timings, events, bolis, membership and practices", three quick questions, and an "Open chat" button that goes to the Niva view | Not present anywhere | **MISSING (P1)** |
| Niva chat (`view='niva'`, title "JSH Niva") | Chat bubbles with "Source: …", "Try asking" chips, an input with placeholder "Ask in English, Gujarati or Hindi", a send button, and the footer "Niva answers from JSH-approved content…" (P:726–747) | `niva.tsx` shows a "Niva is coming soon" placeholder | **MISSING (P1/P2)**. Owned by the drawer, but it is reachable from Home via the FAB |
| Drawer header | Logo image, "Jain Society of Houston", "Priya Shah · Shah family · Life members" (P:1347–1352) | No logo; center name plus the identity line (`drawer.tsx:73-80`) | DIFFERS (P3) |
| Drawer items | Calendar · **Pathshala Connect** ("Classes, attendance and teachers") · **My Donations** · Satvik Store ("Mithai and namkeen, made to order") · **RSVP** ("Upcoming events and your tickets"). Then a divider, **Community dashboard**, "New to JSH guide and help", and Settings at the bottom (P:1355–1392) | "Pathshala and learning" / "Gyan Path, classes and progress"; "My donations"; store sub "Order Jain mithai and namkeen"; "Events and tickets"; "New here? Start with the guide"; plus Ask Niva and Volunteer mode, which the prototype does not have. Community dashboard is missing (`en.ts:45-66`, `drawer.tsx:83-106`) | DIFFERS / MISSING (P2) |
| Drawer version line | "JSH app · version 1.0.0" (P:1393) | "Connect · version {version}" (`en.ts:66`) | **Brand: should read "Community Connect · version 1.0.0"** |

---

## 1. Home (`tab='home'`, no `view`). App: `src/app/(app)/(tabs)/index.tsx` and `src/features/home.tsx`

### 1a. Section order

- **Prototype (P:43–139):** deactivated banner → Today at JSH → My Jain Way → Feedback requested → Lunch times (after check-in) → Special-day labh → Please confirm → Satvik Store → New giving opportunity → Next event row → "New to JSH? Start here".
- **App (`index.tsx:24-34`):** deactivated → Today → **Alerts** (not in the prototype) → My Jain Way → Surveys → [lunch → confirm → next event] → Giving → Special day → Store → Guide → guest card.
- **Result: DIFFERS (P2).**
  - The special-day card should come before the confirm card.
  - Store → Giving → Event row should come after the confirm card.
  - The app has the event block before Giving/Special/Store, and Store after Giving.

### 1b. Element by element

| # | Element | Prototype | App | Status |
|---|---|---|---|---|
| 1 | Deactivated banner | Amber row: "Account deactivated" / "Notifications are paused", with a **green** inline "Reactivate" button (P:46–48) | Amber card; body "Notifications are paused. Reactivate to receive them again."; full-width **brown** button (`home.tsx:55-64`, `en.ts:265`) | DIFFERS (P3) |
| 2 | Today card: surface | **White** card with a border; tiles on `#F6EFE3` (P:52, 58–60) | **Navy** card with `navyPanel` tiles (`home.tsx:117, 70`) | **DIFFERS (P2 visual)** |
| 3 | Today card: greeting | "Jai Jinendra, Shah family" | `home.greetingFamily` using `household.display_name` (`home.tsx:87`). Matches only if `display_name` is "Shah family" | verify data |
| 4 | Today card: title | "Today at JSH" | "Today at {center short_name}" (`en.ts:267`) | MATCH |
| 5 | Today card: date line | "Tue, Sep 22 · Bhadarva sud 11" | `formatDay · tithiLabel` (`home.tsx:127`) | MATCH (format to verify) |
| 6 | Hide button | Circle ×, aria "Hide Today at JSH" | aria "Hide Today card" (`en.ts:268`) | DIFFERS (P3) |
| 7 | Tiles | Sunrise / Navkarsi / Chauvihar | Same, built from `daily_timings`; "Today's timings haven't been published yet." when empty | MATCH (empty state is extra) |
| 8 | Darshan button | One button: red dot + "Watch live darshan · Aarti at 4:30 PM". **Tap goes to the Jain Way (Learn) tab** (`goLearn`, P:62) | A separate "Aarti at {time}" text line, plus a white button "Watch live darshan" that **opens an external browser** (`home.tsx:143-148`, `107-114`) | **DIFFERS (P2)**: copy, layout and click target |
| 9 | Collapsed state | "Jai Jinendra, **Shah family**" plus an outlined button "Show Today at JSH" (P:66–69) | Headline greeting plus ghost button "Show Today" (`en.ts:269`). The app does not remember the collapse across remounts (`useState`, `home.tsx:85`) | DIFFERS (P3) |
| 10 | My Jain Way card | Title; "{n} of {m} done" in green; progress bar; flame + "11-day streak · 1,285 **JSH points**"; "Next: Navkar Mantra on waking · **6:45 AM**" (P:71–76). Tap → Learn tab | Points text is "{points} points" (`en.ts:278`); next line is "Next: {name}" with **no time** (`en.ts:279`) | DIFFERS (P2): add "{center} points" and the practice time |
| 11 | Feedback card: frame | **White card with a 2px purple border** (P:78) | `tone="purple"`: purple-tint fill with a 1px border (`home.tsx:209`) | DIFFERS (P3) |
| 12 | Feedback card: eyebrow row | "FEEDBACK REQUESTED" on the left; **"2 minutes · anonymous if you like"** on the right | "Feedback requested" or "Feedback requested · anonymous"; nothing on the right (`en.ts:282-283`) | DIFFERS (P2) |
| 13 | Feedback card: title | "How was Paryushan Mahaparva 2026?" | `survey.title` | data-driven; OK |
| 14 | Feedback card: body | Fixed line "Your answers help the event team plan the next one." | `survey.description`, or nothing | MISSING fallback line (P2) |
| 15 | Feedback card: button | "Share feedback", left-aligned pill → feedback view | "Share feedback", full width → `/survey/[id]` | MATCH (width differs, P3) |
| 16 | Lunch card: frame | **Solid green (#1F7A4D) card with white text** (P:86) | `tone="green"`: green tint with dark-green text (`home.tsx:268`) | DIFFERS (P3) |
| 17 | Lunch card: eyebrow | "TODAY · TAPASVI BAHUMAN · **CHECKED IN 10:42 AM**" | "Today · {event}"; no check-in time (`en.ts:285`) | DIFFERS (P2) |
| 18 | Lunch card: title | "Your lunch times" | Same | MATCH |
| 19 | Lunch card: rows | Names on the left, **time bold on the right**, one row per group | A single string "names · time" (`rules.ts:126-129`, `home.tsx:277-281`) | DIFFERS (P3) |
| 20 | Lunch card: footer | "Reminder 5 minutes before · now serving 12:00 PM slot" | Same when serving; otherwise "We'll remind you 5 minutes before." | MATCH |
| 21 | Lunch card: tap | Opens tickets | Opens `/event/[id]/tickets` | MATCH |
| 22 | Special-day card: frame | White, 2px saffron border (P:94) | Amber tint with a saffron border (`home.tsx:395`) | DIFFERS (P3) |
| 23 | Special-day card: eyebrow row | "IN 2 WEEKS · SPECIAL DAY" on the left, "Tue, Oct 6" on the right | "In {n} days · {date}" as one string (`en.ts:299`) | DIFFERS (P2) |
| 24 | Special-day card: title | "Anya turns 10" | `listDisplayName(...)`. Needs checking that it produces "{name} turns {age}" for birthdays | verify (P2) |
| 25 | Special-day card: body | "Mark her birthday with a labh: a puja at the derasar, a gift for her Pathshala class, or a jeevdaya donation." | Generic: "Mark the day with a puja, a gift for the Pathshala class or a jeevdaya donation." (`en.ts:301`) | DIFFERS (P2) |
| 26 | Special-day card: buttons | Two side by side: **"Choose a labh"** → Birthday labh view (Family tab), and **"Not this year"** → dismiss (P:99–100) | One button, "See special days" → `/special-days` (`home.tsx:405`, `en.ts:302`). No labh deep link, no dismiss | **MISSING (P1)**: labh deep link and "Not this year". The labh screen itself belongs to the Family tab |
| 27 | Confirm card: eyebrow row | "PLEASE CONFIRM" on the left; "Sent Sat 10 AM · 24 hrs before" on the right | "Please confirm"; nothing on the right | DIFFERS (P3) |
| 28 | Confirm card: headline | "Still coming to Tapasvi Bahuman **tomorrow**?" | "Still coming to {event} on {when}?" (`en.ts:290`) | DIFFERS (P2) |
| 29 | Confirm card: body | "3 people on your RSVP · confirming helps the kitchen plan meals" | "On your RSVP: {n} · confirming helps the kitchen plan meals." (`en.ts:291`) | DIFFERS (P2) |
| 30 | Confirm card: buttons | **Side by side** in two columns: "Yes, we're coming" (**green**) and "Change or cancel" (navy outline) | Stacked full width; "Yes" uses the navy primary tone (`home.tsx:306-307`) | DIFFERS (P3) |
| 31 | Confirm card: behaviour | Yes → marks confirmed. Change → confirm view | Yes → `confirmAttendance` + toast "✓ Confirmed · N attending". Change → `/event/[id]/confirm` | MATCH |
| 32 | Store banner: icon | 52px icon tile (shopping bag) on the left (P:116) | No icon tile (`home.tsx:417-427`) | MISSING (P3) |
| 33 | Store banner: copy | Eyebrow "JSH SATVIK STORE"; title "Fresh Jain mithai and namkeen, made to order"; body "**Order by Thursday for weekend pickup · gift packing available**" | Eyebrow and title match; body is "Order ahead for weekend pickup." (`en.ts:305`) | DIFFERS (P2) |
| 34 | Giving card: eyebrow and title | "NEW GIVING OPPORTUNITY"; title is the opportunity name | Same | MATCH |
| 35 | Giving card: sub line | Tier ladder "Platinum $5,000 · Gold $2,500 · Silver $1,000" | "{campaign} · From $X" (`home.tsx:360`) | DIFFERS (P2): list the tiers when the opportunity has them |
| 36 | Giving card: button | "View and sponsor", left-aligned pill → opportunity | Full-width button → `/opportunity/[id]` | MATCH (width P3) |
| 37 | Next-event row: date block | **Navy** "SEP / 27" (P:126) | **Maroon** (`home.tsx:314`) | DIFFERS (P3) |
| 38 | Next-event row: title | "Tapasvi Bahuman" | `event.name` | MATCH |
| 39 | Next-event row: sub line | "3 attending · **Sun 10 AM**" / "RSVP open · Sun 10 AM" / "You cancelled · RSVP again anytime" | "{n} attending · 10:00 AM" (time only, no weekday); "RSVP open · {date} {time}" (`home.tsx:257-262`) | DIFFERS (P2): use a "Sun 10 AM" style for both |
| 40 | Next-event row: right side | Outlined **"RSVP" pill button**, or a chevron when already RSVP'd | Plain maroon text "RSVP", or a chevron (`home.tsx:328`) | DIFFERS (P3) |
| 41 | Guide link: icon | "i" tile on navy tint | `compass-outline` icon | DIFFERS (P3) |
| 42 | Guide link: title | "New to JSH? Start here" | "New to {center}? Start here" | MATCH |
| 43 | Guide link: sub | "WhatsApp groups, your zone, timings, **volunteering, who's who**" | "WhatsApp groups, your zone, timings, and who to ask" (`en.ts:307`) | DIFFERS (P2) |
| 44 | Guide link: tap | Guide (Welcome.dc.html) | `/guide` | MATCH (guide is out of scope) |
| 45 | Alerts banners | Not in the prototype | `AlertsSection` (`home.tsx:153-165`) | EXTRA-IN-APP (keep; fine) |
| 46 | Guest sign-in card | Not in the prototype | `GuestSignInCard` | EXTRA-IN-APP (fine) |

**Child view (Dev, 14):**
- In the prototype, a child's Home hides the labh card and the lunch card. RSVP, tickets, confirm, bolis and pay views show "Ask a parent" (P:1590–1597, 983–990).
- The app hides Giving and Special-day for children and shows `LockedState` on the event, tickets and confirm screens.
- MATCH in intent.

---

## 2. Events: Upcoming (`tab='events'`, `evTab=0`). App: `src/app/(app)/(tabs)/events.tsx`

| Element | Prototype | App | Status |
|---|---|---|---|
| Segmented control | **Upcoming · Calendar · Photos** (P:160–163, 2152) | Upcoming · Calendar only (`events.tsx:35-43`) | **MISSING "Photos" (P1)** |
| Event card: band | 88px colour band; a **white date pill "Sun, Sep 27" at the bottom left** (P:169) | 76px band; a **"SEP / 27" box at the top left**, plus a "Live" badge (`events.tsx:62-80`) | DIFFERS (P3) |
| Event card: name | Fraunces 18 | `headline` | MATCH |
| Event card: place line | "Stafford Center · 10 AM" | "{date} · {venue} · {time}" (`events.tsx:84`). The date repeats, and the time format is "10:00 AM", not "10 AM" | DIFFERS (P2) |
| Event card: status | "3 attending · tickets ready" / "3 confirmed · tickets ready" (green); "RSVP open" (**#8A4608 brown**); "RSVP opens Oct 15" (muted); "RSVP cancelled · seats released" | Same strings (`en.ts:317-323`). "RSVP open" is **maroon** (`features/events.ts:137`). The app also adds "You attended" and "RSVPs closed" | Copy MATCH; open colour DIFFERS (P3) |
| Event card: tap | RSVP'd → tickets; otherwise → RSVP view | Same (`events.tsx:59`) | MATCH |
| "Past event photos" row | Photo icon tile; "Past event photos"; "6 albums · latest: Mahavir Janma Vanchan"; › → Photos tab (P:177–181) | Not present | **MISSING (P1)** |
| Feedback row: copy | One row: "Share feedback on a recent event" (after sending: "Feedback sent · thank you"); sub "Paryushan Mahaparva 2026 · you attended"; › chevron; purple tint (P:182) | One card per open survey: "Share feedback on {event}" / `survey.title`; no chevron (`events.tsx:93-106`) | DIFFERS (P2): sub-line wording ("· you attended") and chevron |
| Feedback row: sent state | "Feedback sent · thank you" | Not shown after sending (the row just disappears) | MISSING (P3) |
| Empty state | n/a | "No upcoming events" / "New events appear here…" | EXTRA-IN-APP (fine) |

---

## 3. Events: Calendar (`evTab=1`). Also opened from the drawer's "Calendar". App: `src/features/calendar.tsx`

| Element | Prototype | App | Status |
|---|---|---|---|
| Layer chips | "SHOW CALENDARS" chips (Jain tithi, Pathshala, JSH events), **each drawn in its layer colour with a coloured dot**. Then a sub-heading **"School calendars"** with a second chip group (Katy ISD, Fort Bend ISD, Cy-Fair ISD, Houston ISD) (P:187–200) | One `ChipGroup` of navy chips with no colour dot and no school sub-group (`calendar.tsx:213-224`) | DIFFERS (P2) |
| Month header | "September 2026" (Fraunces) with, underneath in brown, "**Bhadarva – Aso · Vir Samvat 2552**" (P:204) | Month and year; Jain months in muted text; **no Vir Samvat** (`calendar.tsx:229-234`) | DIFFERS (P2) |
| Month navigation | ‹ › in 40px bordered circles | `IconButton` chevrons | MATCH (styling P3) |
| Day cells | 58px tall; day number; tithi (brown 9px); up to 4 layer dots; today = peach fill with a saffron ring; selected = navy | Same model. Tithi is muted rather than brown (`calendar.tsx:254-283`) | MATCH (tithi colour P3) |
| Selected-day heading | "Tuesday, Sep 22" on the left, tithi in **brown on the right**, one row (P:220) | `formatDay` headline with the tithi on the next line, plus " · Parva day" (`calendar.tsx:290-298`) | DIFFERS (P3); Parva day is EXTRA |
| Day items | Card with a 4px colour bar, title, "sub · layer" | Same (`calendar.tsx:304-317`) | MATCH |
| Empty day | **Dashed card**: "Nothing on the selected calendars this day" | Plain muted text, with a trailing full stop (`en.ts:435`) | DIFFERS (P3) |
| **"Add these calendars to my phone"** | Navy outline button (P:234) | Not present | **MISSING (P2)** (ICS subscribe / export) |
| Footer note | A prototype disclaimer | "Tithis follow the panchang your center publishes…" | OK |

---

## 4. Events: Photos, album and viewer. App: **MISSING entirely**

The schema already supports this: `app.photo_albums` and `app.photos` (connect-crm `0007_learning_content_calendar.sql:34-57`), with RLS in `0010_rls.sql:473-480`, including member uploads (`photos_upload`).

| Screen / element | Prototype |
|---|---|
| Photos grid (`evTab=2`) | Two-column album cards. Each has a 120px three-tile collage (big tile with a photo icon plus two small tiles), the name (e.g. "Mahavir Janma Vanchan 2026"), the date ("Sep 12, 2026"), and "86 photos · 4 videos" in brown. Tap → album (P:238–255) |
| Album (`view='album'`, title "Photo album", back → Events) | Colour hero with the name and "{date} · {n photos · n videos}". Three buttons: **Share**, **Download**, **Add yours** (navy). A three-column tile grid (112px) with a "VIDEO" badge on video tiles; tap → viewer (P:992–1009) |
| Viewer (full screen, dark) | Close ×; album name plus "1 of 90"; large image; buttons **‹ Prev · Share · Save · Next ›** (P:1413–1428) |

**App files needed:**
- A new Photos segment in `src/app/(app)/(tabs)/events.tsx`.
- `src/app/(app)/album/[id].tsx` (new), plus a viewer, for example `src/app/(app)/album/[id]/photo.tsx` or a modal.
- `src/lib/api/photos.ts` (new).
- New `en.ts` keys.

---

## 5. Event detail / RSVP (`view='event'`, title "RSVP"). App: `src/app/(app)/event/[id]/index.tsx`

| Element | Prototype | App | Status |
|---|---|---|---|
| Screen title | "RSVP" | "RSVP" (`en.ts:325`) | MATCH |
| Hero | 120px maroon band with **only the event name** (P:261) | `Band` with name, date and time range, venue, and a directions icon inside the band (`index.tsx:65-74`) | DIFFERS (P3) |
| When / where | Plain text under the hero: "Sun, Sep 27 · 10:00 AM – 2:00 PM" / "Stafford Center · **Directions**" (underlined link) (P:262) | Inside the band; directions is an icon button that opens Google Maps | DIFFERS (P3) |
| Description | none | `event.description` paragraph | EXTRA-IN-APP (fine) |
| "Who's coming?" | Card title, rows inside the card | `SectionTitle` above the card | DIFFERS (P3) |
| Member rows: layout | Checkbox, name, and a sub-line with **relationship and membership**, e.g. "Primary · Life member", "Child · 14" (P:266–268, 1604–1607) | Checkbox and name; the sub-line only shows the event flags "Under 12" / "Senior" (`index.tsx:172-180`) | DIFFERS (P2): show role · age / tier |
| Member rows: default | Everyone ticked except Dev (demo state) | Everyone ticked on a first RSVP | OK |
| Guests | Dashed tile "+ Add guest" (P:272) | Inline text field "Add a guest" / "Guest name" plus an "Add" button, shown only when the event allows guests (`index.tsx:202-219`) | DIFFERS (P3) (the app's version is functional) |
| Senior / assistance | Dashed tile "Senior / assistance" (P:273) | Per-person "Needs assistance" toggle and a note field "What would help?", only when the event flag is set | DIFFERS (P3) (the app's version is richer) |
| Donation section: header | Card titled "**Commit a donation**", with "**Optional**" on the right | `SectionTitle` "Commit a donation (optional)" (`en.ts:342`) | DIFFERS (P3) |
| Donation section: default mode | Segmented None / Per person / Lump sum; **defaults to Per person with $5 selected** | Defaults to **None** (`index.tsx:123`) | DIFFERS (P2) (product decision) |
| Amount options | Per person $3 / $5 / $7; Lump $10 / $25 / $50 / Other. Large bordered tiles in a grid | Options come from the event config, shown as brown chips (`index.tsx:242-247`) | MATCH (data); look DIFFERS (P3) |
| Custom amount | "Enter your family's amount" with a $-prefixed field | "Your amount ($)", placeholder "101" (`en.ts:347`) | DIFFERS (P3) |
| Math line | Amber strip: "$5 × 3 people" / "One amount for the family", total in brown on the right | Plain row: "{amount} per person × {n}" (`en.ts:348`) | DIFFERS (P3) |
| **"Pay now" / "Add as pledge" choice** | Two-option picker, default "Pay now" (P:299–303) | Not present. It always pledges, with the note "Saved as an open pledge on your family account. Pay anytime." (`en.ts:350`) | **MISSING (P1)** (tied to payments, which are not built yet) |
| Existing pledge | n/a | Info banner "Your family committed {amount} with this RSVP ({pledge})." | EXTRA-IN-APP (fine) |
| CTA label | "RSVP 3 people · commit $15"; "Update RSVP · 3 people"; "Select who is coming" | "RSVP for {n}" / "Update RSVP · {n} coming" / "Select who is coming", plus " · commit $X" (`en.ts:352-355`) | DIFFERS (P2): use "RSVP {n} people" / "Update RSVP · {n} people" |
| CTA colour | **Navy** | **Maroon** (`index.tsx:266`) | DIFFERS (P3) |
| Submit flow | **"Saving" progress screen** (Sync view: JSH mark, step list with ✓ / … / pending, the green box "Saved to your JSH account" plus the result text, and a CTA "See your tickets"; P:901–926). With "Pay now", the **Pay sheet** comes first: To / For / Card / Total / "Confirm with Face ID" (P:1559–1570) | A toast ("RSVP saved · tickets ready ({n})") and `router.replace` to tickets (`index.tsx:150-153`) | DIFFERS (P2): the sync screen is optional polish; the Pay sheet is blocked on payments |
| "View your tickets" link | n/a | Link shown when an RSVP exists (`index.tsx:267`) | EXTRA-IN-APP (fine) |

---

## 6. Tickets (`view='tickets'`, title "Your tickets"). App: `src/app/(app)/event/[id]/tickets.tsx`

| Element | Prototype | App | Status |
|---|---|---|---|
| Top of screen | Starts with the green "You're all set" card; **no hero band** | Starts with a `Band` hero (name, date, time, venue) (`tickets.tsx:68`) | EXTRA-IN-APP (P3) |
| Success card | ✓ circle; "You're all set"; "**3 tickets added** · we will ask you to confirm 24 hours before" / "… · attendance confirmed" (P:313–316, 2087, 2226) | "Tickets: {n} · we'll ask you to confirm {hours} hours before" / "Tickets: {n} · attendance confirmed" (`en.ts:371-372`) | DIFFERS (P2) |
| Commitment card: copy | "Donation committed · $15"; "$5 per person × 3 · JSH-PL-24817 · open pledge on your account" | "Donation committed · {amount}", an Open/Paid pill, and "{pledge#} · Open pledge on your account" (`tickets.tsx:87-100`) | MATCH (the pill is extra; the "how" part, "$5 per person × 3", is missing, P3) |
| Commitment card: "Pay now" | Opens the Pay sheet | Opens `payNotice` ("Online payment is being set up") | blocked on payments; honest |
| Ticket rows | **Compact rows**: 44px navy QR-icon tile, name, "Ticket · Tapasvi Bahuman" (P:325–330) | `SectionTitle` "Tickets"; each ticket is a card with the name, sub-line, "Checked in" pill and a **170px real QR** (`tickets.tsx:102-122`) | DIFFERS (P3). The real QR is needed; consider compact rows that tap to expand the QR |
| Lunch card: frame | **White card with a green border**; header row with a fork-and-knife icon tile, "Lunch after the program" and a head line (P:331–332) | `tone="green"` tint; no icon (`tickets.tsx:125-131`) | DIFFERS (P3) |
| Lunch: before check-in | In a panel: "Your lunch time is set when you check in. Families with a child under 12 eat together from 12:00 PM, as do seniors. Other adults get a slot based on arrival time, then RSVP order." | "Lunch times are assigned when you check in. Families with a child under 12 and seniors eat at the first slot; everyone else is seated by arrival time, then RSVP order." (`en.ts:388`) | DIFFERS (P2) |
| Lunch: slot rows | Left column: time in the group colour plus a tag ("Lunch starts" / "Assigned slot" / "You moved"). Right: names plus a **"why" line**, e.g. "Family with a child under 12 · the whole family eats together", "Checked in 10:42 AM · #87 by arrival, then RSVP order" (P:338–343, 1905–1906) | Time, names and tag; **no "why" line, no "You moved" tag** (`tickets.tsx:134-157`) | MISSING (P2) |
| Lunch: footer | "Dining hall · we'll notify you 5 minutes before each slot · now serving: 12:00 PM slot" | "… 5 minutes before · now serving {slot}" (`en.ts:393`) | DIFFERS slightly (P3) |
| Lunch: later slots | Always visible under a divider: "Missed it or staying for the program? **Join any later slot**", with the slot chips inline (P:345–351) | Hidden behind a link, "Missed it or staying for the program? Choose a later time", then "Join any later slot that still has seats:" and chips (`en.ts:394-395`, `tickets.tsx:230-243`) | DIFFERS (P2) |
| "Add to Apple Wallet" | Black button (P:356) | Disabled secondary button "Add to Wallet — coming soon" (`en.ts:383`) | MISSING feature (P2) |
| **"Share with family on WhatsApp"** | Green outline button (P:357) | Not present | **MISSING (P2)** (share the tickets link / text) |
| "Change RSVP" | **Text link** at the bottom (P:358) | Secondary button (`tickets.tsx:177`) | DIFFERS (P3) |
| "Confirm or cancel attendance" | Not on tickets (reached from the Home card or the notification) | Primary button when the RSVP is not yet confirmed (`tickets.tsx:176`) | EXTRA-IN-APP (keep; useful) |
| Feedback card | n/a | Survey card (`tickets.tsx:183-192`) | EXTRA-IN-APP |
| Wallet footnote | n/a | "Show these codes at the entrance…" (`en.ts:384`) | EXTRA-IN-APP |
| Cancelled / none states | n/a | "RSVP cancelled" card, "RSVP again", empty state | EXTRA-IN-APP (fine) |

---

## 7. Confirm attendance (`view='confirm'`, title "Confirm attendance"). App: `src/app/(app)/event/[id]/confirm.tsx`

| Element | Prototype | App | Status |
|---|---|---|---|
| Hero | Maroon: name; "**Tomorrow** · Sun, Sep 27 · 10 AM · Stafford Center" | `Band`: "{date} · {time} · {venue}", with no "Tomorrow" (`confirm.tsx:331`) | DIFFERS (P2) |
| Instruction | "Untick anyone who can't come. **Please reply by Sat 9 PM.**" | "Untick anyone who can't come." (`en.ts:400`) | DIFFERS (P2): add the reply-by deadline |
| Rows | **All household members** (anyone can be re-ticked) | Only the attendees already on the RSVP; checked-in people are disabled (`confirm.tsx:336-338`) | DIFFERS (P2) |
| Confirm button | "Confirm 3 people", **green** | "Confirm attendance · {n} coming", navy (`en.ts:401`) | DIFFERS (P2 copy, P3 colour) |
| Confirm result | → tickets | → tickets, plus a toast | MATCH |
| Cancel button | "We can't make it · release our seats", **red outline**. Acts **immediately** and goes to Home, where the event row shows "You cancelled · RSVP again anytime" | Same label, **navy secondary** tone, with a confirmation dialog first ("Cancel your RSVP?" / "Release our seats" / "Keep our RSVP"), then Home plus the toast "RSVP cancelled · seats released" (`confirm.tsx:312-327, 342`) | colour DIFFERS (P3); the dialog is EXTRA (acceptable) |
| Footer | "**No reply? We send one more nudge at 6 PM.** Your tickets stay valid either way." | "Your tickets stay valid either way." (+ pledge note) (`en.ts:408`) | DIFFERS (P2) |

---

## 8. Event feedback (`view='feedback'`, title "**Event feedback**"). App: `src/app/(app)/survey/[id].tsx`

The app's form is built from the survey's questions in the database. That is fine. The gaps below are in the fixed copy and in how each question type is drawn.

| Element | Prototype | App | Status |
|---|---|---|---|
| Screen title | "Event feedback" | "Feedback" (`en.ts:412`) | DIFFERS (P2) |
| Hero | Purple band: eyebrow "EVENT FEEDBACK · SEP 8–16", title "Paryushan Mahaparva 2026" | `Band` with eyebrow "Feedback", `survey.title`, description (`survey/[id].tsx:152`) | DIFFERS (P2): eyebrow should include the event date range |
| Overall rating | "Overall, how was it?" with five 30px gold stars | `rating` question type with stars | MATCH (if the question is defined) |
| **"Rate each part"** | Per category (Program and pravachan, Food and bhojanshala, Organization and check-in, Venue and parking), a **horizontal five-button scale**: Poor · Fair · Good · Great · Superb (P:1271–1276) | `likert` / `scale` types map to `single`, drawn as **vertical radio buttons** (`surveys.ts:21`, `survey/[id].tsx:83-89`) | DIFFERS (P2): add a horizontal scale renderer and a grouped "rate each part" card |
| NPS | "How likely are you to recommend JSH events to a friend?" with **0–10 in one row** (11 columns), "Not likely" / "Very likely" | 44px squares that wrap onto two rows (`survey/[id].tsx:48-62`) | DIFFERS (P3) |
| "What did you attend?" | Multi-select chips | `multi` type with chips | MATCH |
| Free text | "Anything else? (optional)", placeholder "**What went well, and what should we change?**" | Label "Your answer", no placeholder (`en.ts:417`) | DIFFERS (P2) |
| Anonymous toggle: title | "Submit anonymously" | Same | MATCH |
| Anonymous toggle: note (on) | "On · your name and household are not stored with your answers. We only record that you responded, so you won't get reminders." | "Your name and household are not stored with your answers." (`en.ts:419`) | DIFFERS (P2) |
| Anonymous toggle: note (off) | "Off · the event team can see your name and follow up with you." | "Your name is included so the team can follow up." (`en.ts:420`) | DIFFERS (P2) |
| Submit button | "Submit feedback" / "**Submit feedback anonymously**". Disabled label: "**Choose an overall rating to submit**" | "Send feedback", disabled with no explanation (`en.ts:422`) | DIFFERS (P2) |
| Done state | Green card: large ✓, "Thank you for your feedback", then "Sent anonymously. The event team sees your answers in the combined results, never your name." / "Sent with your name, so the event team can follow up if needed." No button | "Thank you for your feedback" + "Your answers were sent anonymously." / "…with your name so the team can follow up." + a "Done" button (`en.ts:425-427`) | DIFFERS (P3) |
| Toast | "✓ Feedback sent" / "✓ Feedback sent anonymously" | Same (`en.ts:428-429`) | MATCH |

---

## 9. Notifications and the in-app pop-up (Home demo flows that map to real features)

The app never listens for notification taps (no `addNotificationResponseReceivedListener` or `getLastNotificationResponseAsync` anywhere in `src/`). `providers/push.tsx` only registers the device.

| Flow | Prototype | App | Status |
|---|---|---|---|
| RSVP reminder push, 24 h before | Title "Still coming to Tapasvi Bahuman tomorrow?"; body "3 people on your RSVP. Tap to confirm so the kitchen can plan meals."; **action buttons "Yes, we're coming" and "Change or cancel"**. Tap → the in-app pop-up (P:1506–1529, 2070–2073) | No tap routing; no notification category/actions | **MISSING (P1)** |
| In-app confirm pop-up | Modal: maroon header "TOMORROW · PLEASE CONFIRM", event, "Sun, Sep 27 · 10 AM · Stafford Center"; "Are you still coming? 3 people on your RSVP."; chips for each attending member; "Yes, we're coming" (green), "Change or cancel", "Remind me later". Yes → toast "✓ Confirmed · 3 people attending" (P:1531–1553) | Not present. Only the Home card exists | **MISSING (P1)** |
| Lunch reminder push | "Lunch in 5 minutes"; "Your slot starts at 12:00 PM in the dining hall · …". Tap → tickets | No tap routing | MISSING (P1; server side is separate) |
| Feedback push | "How was Paryushan Mahaparva?"; "A 2-minute survey helps the event team. You can answer anonymously." Tap → feedback | No tap routing | MISSING (P1) |
| Special-day push | "Anya turns 10 in 2 weeks". Tap → labh | No tap routing | MISSING (P1) |
| Family (Saathi) push | Owned by Jain Way | n/a | out of scope |
| Toast banner | Green, top of screen (P:1556) | `useFeedback().toast` | MATCH (to verify placement and colour) |

---

## 10. Member card (header QR button on every screen). App: `src/app/(app)/member-card.tsx`

| Element | Prototype | App | Status |
|---|---|---|---|
| Presentation | A normal sub-view with a back button, title "Member card", and the bottom tabs still visible | Full-screen modal with a close ×, title "Member card" | DIFFERS (P3) |
| Eyebrow | "JAIN SOCIETY OF HOUSTON" | `center.name` | MATCH |
| Identity line | "Primary · Life member · JSH-10421" | role · age · tier, then a separate line "{org} member ID … · **Connect** JSH-10421" (`rules.ts:~197`, `member-card.tsx:219-225`) | **Brand DIFFERS**: "Connect JSH-10421" must not use the product name as an ID prefix (use "Community Connect ID" or just the number) |
| QR caption | "**Refreshes every 30 seconds · works offline**" | "Use at event check-in and Pathshala attendance." (`en.ts:759`). The QR is also static | DIFFERS (P2): needs a rotating token (already noted in `member-card.tsx:14-18`) |
| Member pills | Pill per member | Chips | MATCH |
| Wallet button | Black "Add family cards to Apple Wallet" | Disabled "Add family cards to Wallet — coming soon" | MISSING feature (P2) |

---

## 11. Satvik Store and cart (linked from Home and the drawer)

This is mostly MATCH in `store.tsx` and `cart.tsx`. The differences:

- The hero is missing the chip "**Order by Thu 9 PM · pickup Sat or Sun**" (P:1017).
- Item image tiles are empty tint squares rather than product images.
- Checkout is "Place order · $X" with a pay-later notice, instead of "Pay $X with Apple Pay". This is blocked on payments.
- Pickup windows show as radio buttons with extra "order by" text, not the prototype's plain bordered tiles.
- "+ Add more items" is a ghost button (OK).

All P3, except the payment gap.

---

## 12. Brand text ("Community Connect")

| Location | Current text | Fix |
|---|---|---|
| `app.json` `expo.name` | "Connect" | "Community Connect" (scheme and bundle id can stay) |
| `en.ts:66` `drawer.version` | "Connect · version {version}" | "Community Connect · version {version}" (prototype P:1393 says "JSH app") |
| `en.ts:82` `setup.title` | "Connect is not configured yet" | "Community Connect is not configured yet" |
| `en.ts:90` `lock.body` | "Connect is locked…" | "Community Connect is locked…" |
| `en.ts:543` `bolis.reminderUnavailable` | "…in the Connect app…" | "…in the Community Connect app…" |
| `en.ts:769` `settings.biometricSub` | "Unlock Connect with…" | "Unlock Community Connect with…" |
| `en.ts:800` `settings.aboutSub` | "Connect version {version}" | "Community Connect version {version}" |
| `en.ts:929` `scan.cameraDenied` | "Camera access is off for Connect…" | "…for Community Connect…" |
| `src/lib/rules.ts:~197` `identifierLine` (member card) | "Connect JSH-10421" | Neutral label, e.g. "Member no. JSH-10421" |
| `src/app/(app)/(tabs)/family.tsx:46` (out of scope, hard-coded) | `` `Connect ${household_number}` `` | Same fix, and move it into i18n |
| `gu.ts` / `hi.ts` | Fall back to English | Re-check after the English fix |

**Places where the prototype's "JSH" means the community (keep as the tenant name, via `{center}`):**
- "Today at JSH", "New to JSH?", "JSH Satvik Store" (already `{center}` in the app).
- "JSH points": the app drops "JSH". Use "{center} points".
- "Ask JSH Niva" / "JSH Niva": use "{center} Niva".
- "Saved to your JSH account" (sync screen): use "{center} account".

---

## Prioritized fix list (Home and Events scope)

### P1: broken or missing flows
1. **Photos segment, albums and viewer.** Upcoming / Calendar / Photos tabs; album grid; album screen with Share / Download / Add yours; full-screen viewer with Prev / Share / Save / Next; the "Past event photos" row on Upcoming. The schema (`photo_albums`, `photos`) already exists.
   - Files: `src/app/(app)/(tabs)/events.tsx`, new `src/app/(app)/album/[id].tsx` plus a viewer route, new `src/lib/api/photos.ts`, `src/i18n/en.ts`.
2. **Notification tap routing, action buttons and the in-app confirm pop-up.** Route taps to confirm, tickets, survey and special day; add "Yes, we're coming" / "Change or cancel" actions; add the in-app "TOMORROW · PLEASE CONFIRM" modal with "Remind me later".
   - Files: `src/providers/push.tsx`, `src/lib/push.ts`, a new modal component (e.g. `src/components/confirm-popup.tsx`), `src/app/(app)/_layout.tsx`.
3. **Niva floating button and popover** (quick questions plus "Open chat") on the tabs.
   - Files: new `src/components/niva-fab.tsx`, `src/app/(app)/(tabs)/_layout.tsx` or `src/components/screen.tsx`, `src/app/(app)/niva.tsx` (the chat UI, even before the backend exists).
4. **Special-day card actions.** "Choose a labh" deep link to the Birthday labh view (Family tab) and a "Not this year" dismiss.
   - Files: `src/features/home.tsx:394-407`, `en.ts:299-302`, persisted dismiss state.
5. **RSVP "Pay now / Add as pledge" choice and the Pay sheet.** Blocked on payments; at minimum add the choice UI and the honest notice.
   - File: `src/app/(app)/event/[id]/index.tsx`.

### P2: wrong fields, copy or behaviour
6. **Home section order**: Today → Jain Way → Feedback → Lunch → Special day → Confirm → Store → Giving → Event row → Guide. Files: `src/app/(app)/(tabs)/index.tsx`, and split `EventsSection` in `src/features/home.tsx` so the lunch/confirm cards and the event row can be placed separately.
7. **Today card**: white surface with panel tiles; one darshan button "Watch live darshan · Aarti at {time}" that goes to the Jain Way tab; "Show Today at {center}"; "Hide Today at {center}". Files: `home.tsx:68-151`, `en.ts:268-275`.
8. **Jain Way card**: "{center} points"; "Next: {name} · {time}". Files: `home.tsx:190-194`, `en.ts:278-279`.
9. **Feedback card**: right-hand "2 minutes · anonymous if you like"; fallback body line. File: `home.tsx:200-226`.
10. **Lunch card**: eyebrow with "CHECKED IN {time}". Files: `home.tsx:269-271`, `en.ts:285`.
11. **Confirm card**: "Still coming to {event} tomorrow?" (relative day); "{n} people on your RSVP · confirming helps…". Files: `en.ts:290-291`, `home.tsx:294-309`.
12. **Store banner body**: "Order by Thursday for weekend pickup · gift packing available" (from the store config). File: `en.ts:305`.
13. **Giving card**: tier ladder sub-line. File: `home.tsx:360`.
14. **Next-event row**: "{n} attending · Sun 10 AM" / "RSVP open · Sun 10 AM". Files: `home.tsx:257-262`, `lib/format.ts`.
15. **Guide sub-line**: "WhatsApp groups, your zone, timings, volunteering, who's who". File: `en.ts:307`.
16. **Events list**: place line "{venue} · {time}" (drop the repeated date); feedback row "Share feedback on a recent event" / "{event} · you attended" with a chevron, plus the sent state. File: `events.tsx:84, 93-106`.
17. **Calendar**: layer-coloured chips with dots; "School calendars" sub-group; Vir Samvat line; "Add these calendars to my phone" (ICS). Files: `src/features/calendar.tsx`, `src/lib/api/calendar.ts`, `en.ts:432-437`.
18. **RSVP form**: member sub-line "role · age / tier"; CTA "RSVP {n} people · commit $X" / "Update RSVP · {n} people"; decide the default donation mode (the prototype defaults to Per person). Files: `event/[id]/index.tsx:161-180`, `en.ts:352-355`.
19. **Tickets**: "{n} tickets added · …" copy; lunch "why" line and "You moved" tag; later slots shown inline as "Join any later slot"; the prototype's pre-check-in lunch text; a "Share with family on WhatsApp" button. Files: `event/[id]/tickets.tsx`, `lib/rules.ts` (`lunchCard`), `en.ts:369-396`.
20. **Confirm**: "Tomorrow ·" in the hero; "Please reply by {deadline}"; list all household members; "Confirm {n} people"; "No reply? We send one more nudge at {time}." Files: `event/[id]/confirm.tsx`, `en.ts:399-409`.
21. **Feedback form**: title "Event feedback"; eyebrow "EVENT FEEDBACK · {dates}"; horizontal Poor–Superb scale for likert/scale questions; placeholder "What went well, and what should we change?"; the prototype's anonymous notes; submit "Submit feedback [anonymously]" and the disabled hint "Choose an overall rating to submit". Files: `survey/[id].tsx`, `lib/api/surveys.ts`, `en.ts:412-429`.
22. **Drawer**: the prototype's labels (Pathshala Connect, My Donations, RSVP, the store sub-line); add "Community dashboard"; logo in the header. Files: `src/components/drawer.tsx`, `en.ts:45-66`.
23. **Member card**: "Refreshes every 30 seconds · works offline" once rotating tokens exist; fix the ID line. Files: `member-card.tsx`, `lib/rules.ts`, `en.ts:759`.
24. **Brand text**: every row in §12. Files: `app.json`, `en.ts`, `lib/rules.ts`, `(tabs)/family.tsx`.

### P3: visual polish
25. **Header**: centred logo plus the two-line "JAIN SOCIETY / OF HOUSTON" wordmark on Home; left-aligned Fraunces title on sub-screens; bordered circle menu/back buttons; filled navy QR button. File: `src/components/screen.tsx`.
26. **Tab bar**: open-book icon for Jain Way. File: `(tabs)/_layout.tsx:56`.
27. **Card styling**:
    - Feedback and special-day cards: white with a 2px coloured border.
    - Lunch card: solid green with white text, time right-aligned.
    - Confirm buttons: two columns, green "Yes".
    - Event-row date block: navy.
    - "RSVP": outlined pill.
    - Store banner: icon tile.
    - Guide: "i" tile.
    - Deactivated banner: green inline button.
    - Files: `src/features/home.tsx`, `src/components/ui.tsx` (card tones).
28. **Event cards**: 88px band with a white date pill at the bottom left; "RSVP open" in brown (#8A4608). Files: `events.tsx:62-80`, `features/events.ts:137`.
29. **RSVP screen**: hero with the name only; when/where plus a "Directions" link under it; card-contained section titles; amount tiles and amber math strip; navy CTA. File: `event/[id]/index.tsx`.
30. **Tickets**: drop the hero band; compact ticket rows (tap to show the QR); white lunch card with a green border and icon; "Change RSVP" as a text link. File: `event/[id]/tickets.tsx`.
31. **Confirm**: red-outline cancel button. File: `confirm.tsx:342`.
32. **Calendar**: selected-day heading and tithi on one row; tithi text in brown; dashed empty-day card. File: `features/calendar.tsx`.
33. **Feedback form**: NPS 0–10 in a single row; done card without a button. File: `survey/[id].tsx`.
34. **Store**: "Order by Thu 9 PM · pickup Sat or Sun" hero chip; product image tiles. File: `store.tsx`.

**Additions in the app that are not in the prototype, recommended to keep:**
- Home: alerts banners and the guest sign-in card.
- Events: "Live" badge; "You attended" / "RSVPs closed" statuses; event description; empty states.
- Confirm: the confirmation dialog before releasing seats.
- Tickets: the "Confirm or cancel attendance" button.
- RSVP: per-person assistance notes and functional guest entry.
