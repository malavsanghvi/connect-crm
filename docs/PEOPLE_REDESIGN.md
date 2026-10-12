# People area redesign (plan)

Status: plan and clickable prototype, 2026-10-12. Owner request (2026-10-12): the People area's UX is abysmal (too many buttons just to edit a person); focus on People only and refine every screen; what must stay, what is not needed, the best way to find and review a person or family, and how to cut the admin's burden. Built for every organization Weaver onboards (any kind, any faith or none): wording comes from the kind terms (`src/lib/kind.ts`, `family_tab` is "Family" today), nothing here names one community. This plan says "family" for the page and keeps `households` in the code and database.

**Prototype** (clickable, desktop and phone): `people-redesign-prototype.html`, published as an artifact by the coordinator. Screenshots: `people-redesign-*.png`.

## Owner decisions this plan follows (2026-10-12)

1. **Find**: one box, type anything (name, phone, email, member number, any old or system ID); results show people and families; Enter opens the family. Recent and pinned families on the People home. Lists survive only as saved views for work queues.
2. **Edit**: click a field and type; edit in place, save with Enter, Undo toast. No Edit button, no mode switch.
3. **One family page** with the household and all its people on it, each editable there. A separate person page only for deep detail.
4. **Rare actions** (merge duplicate, move household, mark deceased, retire identifier, printed sign-in code) go under **More**, kept, with a reason and a confirmation where it matters.

## 1. Today, verified in the code (what the audit found)

| Finding | Where |
|---|---|
| Six list tabs (Households, People, Membership applications, Family change requests, Directory & expertise, Voting eligibility) repeat on every record page; a second set (Members, Identifiers, Memberships, Pledges, Payments, Audit) sits below | `NAV` in `src/lib/permissions.ts` (line 374), `TABS` in `households/[id]/page.tsx` |
| The people of a family are below six stat cells, Giving at a glance, two cards, a QuickBooks row and a custom-details card | `households/[id]/page.tsx` lines 168-248 |
| Everything is read-only first: "Edit household" and "Edit profile" open drawers that hold only part of the record and link to "Full record" | `people/_components/drawers.tsx`, `forms.tsx` |
| The New look's family card can only "Record a payment" or "Open the full page" | `components/people-v2/people-workspace.tsx` line 524 |
| Header buttons all weigh the same (History, Record payment, Merge duplicate, Edit household; on a person History, Edit profile, Move household, Merge duplicate, Mark as deceased) | both page headers |
| The person page stacks about eight cards (Profile, Households, Roles/teams/waivers, Account, About this member, Memberships held, Identifiers with an always-open Add form, audit) | `people/[id]/page.tsx` |
| Three search boxes: top bar, People ask box, Niva | B94 |
| No way to add a family from People (only import, QuickBooks matching, the public application); "Add a person" exists only in the classic side card | `drawers.tsx` line 203 |
| "Printed sign-in code" is a disabled button; declining a family request records the fixed reason "Declined by staff"; retiring an ID asks no reason | `drawers.tsx` 388, `requests/page.tsx` 166, `identifiers/actions.ts` |
| The People filters know area, tier, open balance, no RSVP, ending soon. Nothing about missing email, phone or address | `lib/people-v2/ask.ts` |

## 2. What stays, what goes, what merges

| Keep (the work people really do) | Remove (not needed) | Merge |
|---|---|---|
| Household card facts on every family and result; all identifier kinds; decide an application; decide a family request; compare and merge duplicates; move a person; mark deceased (and undo); set the primary member; membership tier change with reason; voting overrides with two people; directory opt-ins; Giving at a glance; Record payment; audit history; exports | The second tab set; the "Households / People" pill (one box finds both); Edit and Save modes and both edit drawers; the "Full record" link; the People ask box as a separate input; the always-open Add-ID form; equal-weight header buttons; the Audit tab's separate home; the six-card person page | Households + People lists become saved views; Pledges + Payments become one **Giving** tab; Audit + the History button become one **History** tab; the Identifiers tab becomes a small **IDs** section; Membership applications + Family change requests + Possible duplicates + To review become the **Inbox** |

## 3. Click budget

Counting rule: one click, tap or key press such as Enter is one action; typing, Tab and scrolling are free; counted from wherever the admin starts (any page).

| Task | Today | Target |
|---|---|---|
| Find and open a family | **4**: People, type and Ask, click the family row (side card), "Open the full page" | **2**: Ctrl+K or click the box, Enter (3 if the first result is not the right one) |
| Edit a phone or an email | **7**: People, Ask, family row, Open the full page, the person (below the fold), Edit profile, Save | **4**: box, Enter, click the number, Enter |
| Edit a family address | **6**: People, Ask, row, Open the full page, Edit household, Save | **4**: box, Enter, click the address, Enter |
| Add a person to a family | **6**, classic look only: People, Ask, row, "+ Add a person", relationship, Save (the New look has no entry) | **5** (**3** once the family is open): box, Enter, "+ Add person", relationship, Enter |
| Add a new family | **Not possible** in People | **2** (3 when similar families exist): "Add a family", Enter; possible matches shown first |
| Record a payment from the family page | **4**: People, Ask, row, Record a payment | **3**: box, Enter, Record payment (Giving's own form follows, unchanged) |
| Approve a membership application | **5**: People, Membership applications tab, open it, Approve, confirm | **3**: People, Approve in the Inbox row, "Yes, approve" |
| Answer a family-change request | **5**: People, Family change requests tab, relationship, Approve, confirm | **3** (4 if a relationship must be chosen); declining asks a real reason |
| Review and merge a duplicate | **6** (7 with a 2FA code): People, Possible duplicates, Compare, choose, Merge, confirm | **4** (5 with a code): People, open the Inbox item (comparison opens in place), Merge, confirm |
| Mark someone deceased | **8**: find the person (5), Mark as deceased, date and reason, submit | **5**: box, Enter, the person's ⋯, Mark as deceased, the red button that names them |
| Move a person to another household | **9**: find the person (5), Move household, pick household, relationship, Move | **6**: box, Enter, ⋯, Move, pick the family card, Move |
| Find "who has no email" | **Not possible** in the New look (no such filter) | **3**: box, Enter, Enter on "Show 42 adults with no email" |
| Export a list | Households only, classic look: Households, Export (+ code) | Any list or saved view: **Export** on it (+ code) |

Headline: editing a phone drops from 7 to 4, opening a family from 4 to 2, the Inbox decisions from 5 to 3, and two jobs that cannot be done today become possible (add a family, find missing contact details).

## 4. Information architecture

**People home** (`/people`, New look). Top: the one box, focused on arrival (the same component as B94, large). Below it, left to right: **Inbox** (counts, each opens in place): Membership applications, Family change requests, Possible duplicates, Needs a look (a household with no primary member, an adult in no household: signals the pages already detect). Then **Pinned families** and **Recent families** (cards with the household card line). Then **Saved views** (chips: "Memberships ending soon", "Adults with no email", your own) and a **Lists** menu holding Directory & expertise, Voting eligibility and Memberships history. The old Households and People lists, and the tab row, are gone; a saved view opens the same list component with its filters as chips.

**Family page** (address stays `/households/[id]`, so every existing link keeps working; the New look renders the new body). Top to bottom:

1. **Header**: the household name (editable), then the **household card line** as plain facts (household number, the organization's household ID, adults, city, area), never a name alone. Right side: one primary button **Record payment** (only with `recordPayment`; Giving's form is unchanged), one **+ Add person**, and **More ⋯**. Status chips: membership tier and end date, open pledges (giving permission), "on the app: 2 of 3 adults".
2. **People** (left, two thirds): one card per person, adults first, children after (question 5). Each card: name, relationship, age (computed, read-only), mobile, email, language, "on the app", and a ⋯ with Open details, Move, Mark deceased, Printed sign-in code, Merge. Every value is click-to-edit.
3. **Right column**: Address (one editable block), **Giving at a glance** (the merged panel with the year filter and "Show giving by", unchanged, `src/components/giving-glance/*`), Preferences (directory, mail: toggles that save at once), IDs strip (household IDs as chips, QuickBooks customer for finance readers), Notes.
4. **One tab row** under that: **Giving** (Pledges and Payments, the existing tab bodies, following the glance's year), **Memberships**, **Events** (RSVPs and attendance, read-only, only with the Events module), **History** (the household and all its people, filter by person).
5. **More ⋯** (family level): Merge with another family, Change the primary member. Person-level rare actions are on the person's ⋯.

**Person slide-over** (opens from a card, a box result or a list row; address `?person=<id>` on the family page so it can be shared). Sections, the first two open: Profile (birth date, gender, profession, employer, language, anniversary, dietary needs, emergency contact), **Account and sign-in** (app account, sign-in methods, member card with the rotating QR, printed sign-in code "coming next"), Roles, teams and waivers (read, with a link to the owner screens), Privacy and directory (photo, new-member contact, expertise listing), **IDs** (chips by kind with a "+ Add ID" popover; each chip's ⋯ offers Retire), Memberships held, Giving at a glance (when "Show giving by" is person), About this member (custom details), History. Footer: More ⋯. `/people/[id]` redirects to the family with this open (a person in several households gets a chooser of household cards; in none, the slide-over alone).

**Add family, Add person**: short inline flows (section 5 of the prototype), never a form page. Add person is a new card at the end of the people list with first name, last name, relationship chips, "More" for birth date, mobile, email; Enter adds. Add family is a sheet: first adult's name, mobile or email, optional address; as you type, **possible matches** show with household cards ("Already here? Open it") before anything is created.

**Inbox items**: each row shows who, what, since when, and the household card; **Approve** and **Decline** act in the row. Decline opens a reason line (required, already a rule of both commands). Approve asks one inline "Yes, approve" because it activates a membership and may record a fee pledge. A second-step item (EC approval) shows "Waiting for a different Executive Committee member" to the person who already approved. A duplicate opens a side-by-side comparison in the row with Merge / Not the same.

**Lists** (under People home › Lists): *Directory & expertise* and *Voting eligibility* stay as the screens they are (reporting and two-person overrides), reached from the Lists menu and linked from the person (a "Voting: eligible" line, the Privacy section). *Memberships history* keeps past applications; the live queue is the Inbox and "ending soon" is a saved view.

**Removed or merged** in the New look: the six-tab People row and the second tab set; the Households/People pill; the People ask input (chips stay); the Edit/Save drawers; "Full record"; the Identifiers tab; the always-open Add-ID form; the History header button. The classic look is untouched until it retires.

## 5. Inline editing rules

| Class | Fields | Behavior | Command |
|---|---|---|---|
| **Just type** | mobile, email, language, gender, profession, employer, relationship, address block, household name, area, preferences (toggles) | Click, type, Enter saves; leaving the field also saves; Esc cancels | `people.update_person` (people.manage, partial update) / `people.update_household` |
| **Type, then a one-line why** | first and last name, date of birth | Enter saves with the default reason "Correction"; chips ("Legal name change", "Married", "Verified from ID") change it; leaving the field does not save. A birth date that moves someone across 18 says so ("This makes Aarav 12, a child") | same, with new optional `reason` |
| **Sheet with a reason (and the checks that already exist)** | merge (fresh 2FA, `CCSTP`), move, mark deceased (date, reason; name on the button), change primary member (reason), membership tier (`people.approve` plus reason), retire an ID (reason, new), voting override (two people) | Small confirmation sheet from More; no new approval rule is introduced | existing commands and RPCs |

- **Undo** writes a compensating, audited change with the earlier value (reason "Undo of …"); it appears on the toast for 30 seconds (question 6). An undo that would overwrite a newer change by someone else does not run and says so.
- **Concurrency**: each edit sends the value it started from (`expect`, a new optional input on the two update commands, checked in `plan()` against the current row). If someone else changed that field, the cell shows "Ravi changed this a minute ago to 555-0199" with **Use theirs** and **Keep mine**; the rest of the card refreshes.
- **Validation** appears under the field, from the same pure parsers the server uses (`parsePersonForm`, `parseHouseholdForm`, `normalizePhone`, all in `src/lib/people.ts`, no server imports); the server checks again. An email or mobile already on another person warns with their household card and offers Compare; it does not block.
- **Errors are never silent**: a failed save restores the old value, keeps what was typed in the input and says it in words ("Could not save Jaya's mobile: the number needs an area code. Try again"), with technical detail logged by `failure()`. "Saved" appears only after the server said so (the cell shows a dot while saving).
- **Keyboard**: Tab and Shift+Tab move between fields in reading order, Enter saves, Esc cancels, Ctrl+K focuses the box, ⋯ menus open with Enter and close with Esc, focus returns to the field after a save.
- **Permissions**: without `people.manage` every value is plain text, no pencil, with a "View only" chip. A section the role cannot read says "You don't have access to this area", never an empty table. Finance IDs and Giving follow their own permissions. RLS stays the enforcement.
- **Audit and activity**: edits run `via: "screen"` through `runScreenCommand`, so the activity keys (`people.update_person`, `people.update_household`) and the audit are the ones Niva and the palette already share.

## 6. Finding: the one box

- **Matches**: names in any script and with or without accents (`foldName`, `src/lib/commands/name-fold.ts`); phone digits in any format (the last digits too); email; the Connect member and household numbers; the organization's own member and household IDs (padded: "417" finds "0417"); old CRM IDs; QuickBooks customer; bank payer names (`app.resolve_identifier` via `searchHouseholds`, `src/lib/data/search.ts`). The row says **why it matched** ("Old CRM ID 20417").
- **Results** are two groups, **Families** and **People**, ten rows at most. A family row shows the household card line; a person row shows relationship and the family's card line ("Jaya Shah, mother, household 0212, Maple Ct, Riverside"). **Enter** opens the highlighted family; on a person result it opens that person's family with the slide-over open. Two families with the same name are always told apart by the card line.
- **Questions**: text that is a question or has no match hands off to Niva (B94 stage e). **Filters**: "adults with no email" becomes a list with a count and **Export**. Contact-gap filters (no email, no mobile, no address, not on the app, age band) are new keys for the existing `people.filters` extractor and `loadHouseholdList` (code only).
- **Shared with B94, nothing duplicated**: the box component, Ctrl+K, the overlay and ranking contract (`Candidate`, `/api/box`), stage a's records source and stage d's People extractor. This plan adds only the person and family **row design**, the Enter-opens-family action, and the Family page and Inbox as destinations. The People home shows the same box large; the People ask input and the pill disappear. If B94 slice 1 is not merged when slice 3 starts, slice 3 builds only the People lane (`src/lib/box/people-lane.ts`) behind B94's interface.
- **Recent** families are a per-viewer convenience (localStorage); **Pinned** families and **saved views** are per person on the server.

## 7. Children and respect (D2)

A child's record is visible to authorised staff (`people.view` or `people.manage`) on the Family page, in the box and in the slide-over. Rules: the card shows **age**, not the birth date, until the field is clicked; a child has no mobile or email fields ("contact via parents") and no app-account row beyond "managed by parents until age N"; the slide-over and the card for anyone under 18 have **no Ask Niva button**, and nothing about them is offered to Niva. Anything sent toward a provider passes `filterChildren` with `databaseMinorNames` (`src/lib/commands/child-filter.ts`) first, and household cards for a model list adults only. Inline edits of a child run `via: "screen"`; the commands already refuse `via: "assistant"` for children. The box's activity event never stores typed text. A household is never picked or confirmed by name alone: every result, merge, move and Add-family match shows the card.

## 8. Phone layout (390 px)

Family page: header shrinks to the name, two card lines and chips; a **sticky bottom bar** holds Record payment, + Add person and More; people cards stack full width; tapping a value opens a 44 px input with the keyboard's Done as Enter, Cancel beside it; Address, Giving at a glance, Preferences and IDs follow the people; the tab row scrolls sideways. The slide-over is a full-screen sheet with a back arrow. People home: the box on top (the phone's Ask item opens it), the Inbox as stacked cards, Recent and Pinned as a horizontal strip. The Undo toast sits above the bottom bar for 30 seconds. Everything works at 200% zoom.

## 9. Build slices (each ships behind the New look)

| # | Slice | Size | Migration | Touches permissions/RLS |
|---|---|---|---|---|
| 1 | **Family page with inline editing**: new body for `/households/[id]` (people cards on top, Address, Giving at a glance, one tab row of Giving, Memberships, History), click-to-edit with Undo and conflict handling, `expect` and `reason` added to `people.update_person` and `people.update_household`; a family row in the list opens the Family page directly (the side-card step goes); phone layout; screenshots on fixtures | L | No | No |
| 2 | **Person slide-over** with the deep sections, IDs section and add popover, inline **Add person**, `/people/[id]` redirect | M | No | No |
| 3 | **Find**: the box on People home, person and family rows, Enter opens, recent families; the pill, tab row and ask input go | M | No | No |
| 4 | **Inbox**: applications, family requests, duplicates and "needs a look" in place, real decline reasons | M | No | No (same commands and gates) |
| 5 | **More menu as commands**: `people.mark_deceased`, `people.set_primary`, `people.add_identifier`, `people.retire_identifier` (with reason) wrap the RPCs the actions call today; activity allowlist | M | Yes (allowlist rows) | **NEEDS OWNER OK** (retire now asks a reason; deceased and primary keep their gates) |
| 6 | **Add a family**: `people.add_household` and its database function, possible-match check | M | Yes | **NEEDS OWNER OK** (a new write path with its own permission check) |
| 7 | **Saved views, pinned families, contact-gap filters, export from lists, Lists menu** | L | Yes (one table) | **NEEDS OWNER OK** (new table and its RLS) |
| 8 | **Events tab** (RSVPs and attendance, read-only) | S | No | No |

**Recommend slice 1.** It removes most of the clicks in the owner's example (editing a phone goes from 7 to 5 on its own, to 4 with slice 3), needs no migration, uses commands that already exist, and does not wait for B94. Slice 3 is next: it is where the two-click find arrives.

## 10. Open questions for the owner

1. **Directory & expertise.** Keep, tuck under a menu, or fold? *Recommend*: tuck under **Lists** on the People home, screen unchanged; each person's choices live in the slide-over's Privacy section.
2. **Voting eligibility.** *Recommend*: keep as its own list under **Lists** (shown only with the membership module and `voting` access), with a read-only "Voting: eligible" line on the person; overrides stay two-person.
3. **Identifiers.** *Recommend*: no screen; a compact **IDs** section (chips by kind, "+ Add ID" popover, Retire with a reason), everything searchable from the box. Finance kinds only for finance readers.
4. **History.** *Recommend*: a **History** tab on the Family page (the household and all its people, filter by person) and a link in the slide-over; the header History button goes.
5. **Children** inline or behind "Show children"? *Recommend*: **inline and compact** (name, age, relationship; full card on click): staff update children often and the screen is staff-only; D2 is about AI, which never sees them.
6. **Undo window.** *Recommend*: **30 seconds** on the toast; a "Put back" on each History row (while the value is unchanged) later.
7. **Mark as deceased** admin-only? *Recommend*: keep it with `people.manage` as today (reason and date required, name on the button, Undo needs a reason, shown only under More); no second approver, because families ask staff to record a death promptly and it can be undone.
8. **Save when leaving a field, or only on Enter?** *Recommend*: leaving a changed field saves it (with Undo), except name and birth date, which wait for Enter and a reason. It means typed edits are never lost; say if you want Enter only.
