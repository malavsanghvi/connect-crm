# What is waiting for each demo role when it signs in

The owner's request (2026-10-14): *"In the demo, make sure each role has something to be done inside when they login."* This page is the
inventory (what each of the 25 roles of the faith demo, **Sunrise Worship Center (Demo)**, finds right after signing in at `/demo`, worked out
from the code), what the pack now puts there, and what Home shows the eight roles that still have no portal screen.

**Since 2026-10-15 (migration 0820) the faith demo is not any one faith** (owner decision: "make everything in the Demo app neutral"). It is a
Faith community (the platform's neutral faith experience, category `faith_other`), so what this page used to call the Tapasvi event is the
**annual appreciation dinner**, the Diwali puja is the **community festival night**, the Pathshala is the **Learning Center** (the platform's word for the school in a Faith community, 0820; levels 1 to 4, not
"Jainism 1 to 4"), the store sells baked goods and snacks, and there are **no bolis**: a Faith community does not have them, so the boli recorder
(Sarla Kataria) is no longer a demo person. She is still in the Kataria household and on the dinner's food shift. That makes 25 demo people, one
for every role the Faith community kind has. The names below are the neutral ones; the "Before" column keeps the same names for the same things.
The role names the platform's catalog gives (for example "Pathshala principal") are the platform's, shared by every community, and are unchanged.

It was worked out from `src/lib/tasks.ts` and `src/lib/data/home-tasks.ts` (Home "My tasks"), `src/lib/permissions.ts` (what opens a
screen), `src/lib/routines/*` (the New look's Today), the screens themselves, and the row level security the database applies to each person.
Two tests keep it honest: `tests/demo-role-work.test.ts` (what the portal shows each role: its Home queue, its screens, or only Home) and
`supabase/tests/184_demo_role_work_test.sql` (signs in as each of the 25 people with their own token and asks their questions with row level
security on). The people and their pledges, gifts, events and orders are the pack of `supabase/scripts/build-demo-packs.mjs`; this change is its
version 3 (migration 0797), and 0796 fixes how three of the people are signed in.

**Who the public list offers (0815).** All 25 people exist and can start a demo, but the list a visitor chooses from (the `/demo` page and the member
app's "Try the demo") offers six: the administrator, treasurer, membership coordinator, event lead and teacher (non-profit operational roles) and the
family's main adult (community roles). The list is `app.demo_featured_roles()`; see [DEMO_SIGNIN.md](DEMO_SIGNIN.md). Since 2026-10-15 the community role
does not start in the portal at all: its button on `/demo` opens the member app straight at that person (see [MEMBER_APP_DEMO.md](MEMBER_APP_DEMO.md) "The one-step
path"). The portal Home card "Your work is in the member app" is still what any family-role account finds when it signs in to the portal.

## What the portal shows, in one paragraph

Home "My tasks" is a list of queues, each shown only to someone who holds one of the permissions that act on it (`visibleTaskSources`). The
navigation shows a module only if the person holds a permission that opens one of its tabs. Both read the person's **whole-community** role
grants: a role held for one event, one class or one zone adds no permission (`computePermissions`), and a family role (community member,
membership reference, primary adult, adult member, child) holds no permission at all. So a person is in one of three states: they have a
queue on Home; they have no queue but a screen that holds their work; or the portal shows them Home and nothing else. Until 2026-10-14 Home then said "Nothing here for your role"; it now carries a card for their work
(see below). The community's first administrator is its **owner** (`app.ensure_center_owner`), and the owner holds every permission, so
the demo administrator sees every queue.

## Before and after, role by role

"Before" is the pack at version 2 (0786). "Now" is version 3. *Home* means Home "My tasks"; the path after an arrow is the screen one click
from Home in the navigation. A queue row's wording is the portal's own.

| Role | Person | Before (v2) | Now: what is waiting | Provided by | How they reach it |
| --- | --- | --- | --- | --- | --- |
| Center admin (owner) | Asha Varma | One row: the 6 volunteers of the appreciation dinner with no signed waiver | 12 rows: the waiver row (now 8 volunteers), the treasurer's write-off and bank lines, 2 membership applications, a message to approve, 5 member questions, 2 WhatsApp requests, a text to approve, items under their reorder level, a waitlisted learner, 2 data requests | everything below; she is the owner so every queue is hers | Home |
| Executive committee | Rohit Varma | Nothing waiting | 2 membership applications, one of them a **life membership waiting for the executive committee** | `membership_applications` (Lalit's life application, Tarun's yearly one) | Home; People › Membership applications |
| Executive viewer | Kavita Rathore | Home "At a glance": next event RSVPs | Same, read only (by design this role changes nothing): the dinner's RSVPs, Reports › Center health | events, RSVPs | Home › **Start here** (Reports › Center health); Home "At a glance"; Reports; Events |
| Treasurer | Meera Doshiwal | Nothing waiting | A **write-off** a colleague asked for, to confirm as the second approver; **4 bank lines** to match (one is a check deposit); the current month still to close (its checklist has the statements check for her to mark, then the lock; in the New look her month-end routine says to match every bank line first) | pledge `w1` with `written_off_by`; `bank_accounts` + 4 `bank_transactions` | Home; Giving › Payments & deposits › Bank; Accounting › Month-end close |
| Finance volunteer | Kiran Doshiwal | Nothing waiting | The 4 bank lines to match; open pledges to record gifts against (Giving › Payments) | the same bank lines; pledges `a7`, `b1`, `b2`, `g2`, `g3` ... | Home; Giving |
| Membership coordinator | Hemant Parmar | Nothing waiting | 2 applications to decide (Tarun Patni's yearly one, Lalit Rathore's life one); a **family change request** (add a family member to the Wadhwa household) | 3 `membership_applications`, 1 `household_change_requests` | Home; People › Membership applications / Family change requests |
| Religious coordinator | Bharat Kataria | Nothing waiting | A religious text to approve (the explainer "What to expect at our weekly service") | `content_items` (in review) | Home; Content › Approval queue |
| Communications officer | Pooja Salecha | Nothing waiting (a draft is in Newsletters) | A message to approve ("Festival greetings"); **5 member questions** nobody has taken; 2 WhatsApp join requests; the Learning Center draft to finish and send | `comms_campaigns`, `inboxes` + `threads` + `thread_messages`, `whatsapp_groups` + `whatsapp_join_requests` | Home; Communications |
| Content editor | Nikhil Salecha | Home: "Nothing here for your role"; no drafts | 2 drafts to write and send for approval (an audio lesson to record, an FAQ to write) | `content_items` (draft) | Home › **Start here** (Content › Library, with the drafts to finish); Content › Library |
| Privacy officer | Falguni Singhvi | Nothing waiting | 2 data requests (an export, a deletion in progress) | `data_requests` | Home; Settings › Privacy |
| Volunteer coordinator | Dipak Singhvi | Home: "Nothing here"; interests to answer and free shifts existed | 3 people who asked to volunteer, a **background check** that was asked for and has not come back, and 3 shifts with free places | `volunteer_interests`, `background_checks`, `volunteer_shifts` | Home › **Start here** (Events › Volunteers, with the sign-ups and the shifts with free places); Events › Volunteers (also from any event's Volunteers tab) |
| Event lead | Sanjay Lunawat | Nothing in the portal; the appreciation dinner 9 days away | The appreciation dinner is **5 days away** with 24 people to check in (12 confirmed, 12 who have RSVPd), a checklist of 5 actions (one overdue, one due tomorrow and his own, one in 3 days, one nobody owns) and live numbers | `events`, RSVPs + attendees, `actions` | Home › **My assignments** (the event, its date and live numbers; links to the event page, the check-in screen and the kitchen display); in the New look, Today lists "Check RSVPs against capacity" while the event is within 7 days |
| Check-in volunteer | Riya Lunawat | Nothing in the portal | The same 24 people to check in; her own confirmed shift at the door | RSVPs + attendees, `volunteer_assignments` | Home › **My assignments** (the event, its numbers and the check-in screen); the event-day app and the member app's volunteer mode |
| Kitchen lead | Vijay Bhandari | Nothing in the portal | The prep list (3 lines of 2 store orders waiting) and the appreciation dinner's headcount (12 confirmed people) | store orders, attendees | Home › **Start here** (My Store › Orders by pickup, with the orders waiting); My Store › Orders by pickup (`kitchen.view` opens it); the kitchen display of the event-day app |
| Store lead | Sunil Nahar | Nothing in the portal (the grant was scoped to 'store', which the portal ignores: see below) | **2 items at or under their reorder level** (trail mix, pretzel twists) and 2 orders to prepare and hand out | `store_items` with stock and a reorder level; orders `o3`, `o4` | Home; My Store |
| Store pickup | Rekha Nahar | The same 2 orders (it was already there) | The 2 orders (one ready, one placed) for the pickup window in 2 days | orders `o3`, `o4` | Home › **Start here** (My Store › Orders by pickup, with the orders waiting); My Store › Orders by pickup |
| Boli recorder | Sarla Kataria | Nothing: there was no boli | **Not a demo person any more (0820).** A Faith community has no bolis and no boli recorder; Sarla stays in the Kataria household and on the dinner's food shift | none | none |
| Pathshala principal | Deepa Chopda | Nothing in the portal (the grant was scoped to 'pathshala') | A late **registration waiting to be placed** (Zara asks for a level with no class), a learner on the **waitlist** (Aarav) | `pathshala_enrollments` | Home; Learning Center › Enrollments |
| Pathshala committee | Manish Chopda | Nothing in the portal (scoped to 'pathshala') | The committee's "next two weeks": an overdue action, one due tomorrow, one in 3 days, two nobody owns | `actions` on the dinner and the festival night | Home › **Start here** (Learning Center › Committee, with the actions at risk); Learning Center › Committee |
| Teacher | Anita Bhandari | Her class and its roster | Her class, "Introduction to Jainism" (5 learners: Anaya, Jay, Ishaan and the two Patni children, Dev and Maya) with **attendance not taken** for the latest Sunday | `pathshala_classes`, enrollments | Learning Center › My classes (her landing) |
| Zone lead | Lalit Rathore | Nothing in the portal; no inbox | **2 questions in the north zone's inbox**, and the 7 families of the zone | `inboxes` (zone), `threads` | Home › **My assignments** (the zone, the open questions in its inbox, a link to `/comms/inbox`); the member app |
| Community member | Priya Wadhwa | Nothing | Her **membership application waiting for her reference to answer**; an open pledge; a parking shift to confirm; 2 events to RSVP to; a notice; her two questions to the office | `membership_applications`, pledge `g3`, `volunteer_assignments`, `threads` | Home › **Your work is in the member app** (a link to it and what waits there); the member app |
| Membership reference | Kusum Parmar | Nothing | An application that **names her as reference**, waiting for her answer | `membership_applications` (reference = Kusum) | Home › **Your work is in the member app** (a link to it and what waits there); the member app |
| Primary adult | Tarun Patni | An open pledge, an RSVP | The family's membership application (waiting for the team); the open pledge; the festival night's RSVP; **two children enrolled in the Learning Center** (Dev and Maya, in Anita Bhandari's class; their two fee pledges are open) and a third, Aarav, on the waitlist | `membership_applications`, pledge `g2` | Home › **Your work is in the member app** (a link to it and what waits there); the member app |
| Adult member | Nisha Patni | An open family pledge | The open family pledge; a **parking shift to confirm** | pledge `g2`, `volunteer_assignments` | Home › **Your work is in the member app** (a link to it and what waits there); the member app |
| Child | Zara Singhvi | Events | Events to see; her **Learning Center registration** (waiting for a class for her level); the notices. Never a pledge or a gift | `pathshala_enrollments`, events, alerts | Home › **Your work is in the member app** (events and notices only, never money); the member app |

The Treasurer also finds an offer of a **guided tour** of the bank-line work (Home card, "Take the tour" in the demo banner, the Tour menu): the
sample of Spotlight, [SPOTLIGHT.md](SPOTLIGHT.md). No other role has a tour yet.

## The roles that have no portal screen: Home gives them a card

Eight of the 25 roles hold nothing the portal opens a screen with (`tests/demo-role-work.test.ts` pins this, and
`supabase/tests/184_demo_role_work_test.sql` section C asserts that they hold no permission center-wide). Their work above is real and sits in the
database behind row level security. This page used to propose three small additions; **the owner decided on 2026-10-14 to build them**. The
ninth role of the old list, the kitchen lead, now has a portal screen. What each of the eight sees on Home:

| Roles | What Home shows | Where the rest of their work is |
| --- | --- | --- |
| Community member, membership reference, primary adult, adult member | **Your work is in the member app**: a link to it, and what waits there, one plain sentence each: the family's membership application and the stage it is at, requests to vouch for an applicant, the family's open pledges, its RSVPs and the events open to RSVP to, the community's notices | The member app |
| Child | The same card with **events and notices only**. Never a pledge, a payment, an RSVP or a membership application: money and RSVPs are for adults | The member app |
| Event lead, check-in volunteer | **My assignments** (below), and also the member-app card, because they hold no permission either | The event-day app (connect-admin) and the member app's volunteer mode |
| Zone lead | **My assignments**: the zone, the open questions in its inbox, a link to `/comms/inbox`; and the member-app card | The member app |

## What was built (2026-10-14)

Nothing in the demo pack changed, so there is nothing to reset: the cards read the data the pack already puts there. They work for **every
community**, not only the demo: a real community's event lead for one event, or any family-role account, sees the same cards.

1. **"Your work is in the member app"** (Home and Today). Shown to a signed-in person who holds no staff queue and no module screen (`holdsNoStaffWork`
   in `src/lib/home/member-work.ts`: no Home task source and a navigation of only Home). It reads, as the signed-in person and through the same
   database functions and tables the member app uses (connect-mobile `src/lib/api`): `app.i_am_adult` (the rule row level security uses for money and
   RSVPs), `app.my_membership_application`, `app.my_reference_requests`, the household's open pledges, its RSVPs for the upcoming events, and the
   notices. Only an adult gets the pledge, application, vouch and RSVP lines; a child, or a person whose age could not be checked, gets events and
   notices. A module the community switched off is not read. The link is the member app's address as the portal knows it
   (`NEXT_PUBLIC_MEMBER_APP_URL`, the repository variable `MEMBER_APP_URL`, docs/DEPLOY.md). It is **one address for the whole deployment**, the
   member app's "choose your community" page, not a per-community address. If it is not set the card says so and draws no link. A count never names a
   household or a person ("A pledge of $51.00 is open."). A read that fails is a line in red that says what could not be loaded and why, with
   "Try again", never a zero.
2. **"My assignments"** (Home and Today). One line for each event, class or zone the person holds a role for through a scoped grant (the grants
   `computePermissions` ignores), also for staff who hold other things; never for someone who holds none. Each line has the name, the role in the
   community's words, the date and place of an event or the day and room of a class, and only the links that role can open (the same checks the pages
   make): the event page for an event lead, the check-in screen (`/ops/<id>/checkin`) for an event lead or check-in volunteer, the kitchen display for
   an event lead or kitchen lead, the class page and its attendance for a teacher, `/comms/inbox` for a zone lead. The live dashboard
   (`/events/live`) is for events staff, so a scoped lead is not sent to it. A role with no portal page (the boli recorder of a community that has bolis) gets the line and a note
   that the work is in the event-day app, never a link that ends in "You don't have access". For an event, `app.event_live_stats` gives the people on
   RSVPs, the confirmed and the checked in, asked only for the events the database lets this person count and that are not drafts, cancelled or over;
   for a zone, the open conversations in its inbox, read the way the inbox page reads them. A number that could not be read is not shown, and the line
   says so. Past 20 assignments the rest are counted, not dropped.
3. **Kitchen lead**: `kitchen.view` was added to the `storeOrders` rule (`src/lib/permissions.ts`), which opens My Store › Orders by pickup. The database
   already let them read exactly what that page reads: the orders, their lines, the pickup slots (`store_orders_pickup`, `store_lines_kitchen`,
   `pickup_windows_kitchen`) and the active item names (`store_items_public`), and section C2 of the database test asks each of these as the kitchen
   lead. No migration was needed. They move nothing: marking an order along still needs `store.manage` or `store.pickup`. Their navigation is Home and
   My Store with only that one tab. The Niva command that lists the orders waiting for pickup (`store.orders_waiting`) follows the same rule.
4. **Home stays honest.** "Nothing here for your role" is not shown to a person who has a card, and the empty "At a glance" tile is left out under
   a card. The subtitle under the greeting then says "What is waiting for you". A person with a staff queue sees My tasks exactly as before, with
   My assignments above it if they also hold a scoped role.

5. **"Start here"** (Home and Today; owner's decision, 2026-10-14). For a person who holds a screen but no staff queue and neither of the cards above. It
   is derived from what the person holds and the screens the navigation opens (`src/lib/home/start-here.ts`), **never from a role key**, so a role the
   community renamed, cloned or built itself gets the same card. The first of these fits: Reports (`reports.view`), Content › Library
   (`content.draft` or `content.manage`), Events › Volunteers (any volunteers or safety permission), My Store › Orders by pickup (`store.pickup` or
   `kitchen.view`), Learning Center › Committee (`governance.vote` or `governance.manage`); a person who fits none but has a screen gets the first module of their
   navigation. The screen's name is the navigation's own (a church's store is its Bookshop). The card is one plain sentence naming the screen and a button
   to it, and where a count is cheap and the person's own access reads it: drafts to finish; people who asked to volunteer and shifts with free places
   (only for those who may read the sign-ups); orders waiting for pickup; the committee's actions overdue, due within 3 days or with no owner (the
   committee dashboard's own rule). A count that fails is a red line with the reason and "Try again", never a zero; a count that comes back at zero says
   "Nothing is waiting right now." It never shows to someone who has a queue, My assignments or the member-app card, and it replaces "Nothing here for
   your role" for these six: the executive viewer, content editor, volunteer coordinator, store pickup volunteer, kitchen lead and Pathshala committee.

What is not counted on the member-app card, on purpose: a **volunteer shift to confirm** (the member app has no screen that reads or confirms
shifts, so a count would point at work they cannot do there), a child's **Learning Center registration**, the family's **questions to the office**, and the
open **pledge round** of a community that has bolis. They can be added when the member app grows a screen for them.

## Which roles show which card

- **Only a card** (no portal screen at all, Home plus the card): the eight above. The event lead, check-in volunteer and zone lead get
  two cards (their assignments, and the member app); the five family roles get the member-app card.
- **Start here** (a screen, no queue, no other card): the executive viewer (Reports), content editor (Content › Library), volunteer coordinator
  (Events › Volunteers), store pickup volunteer and kitchen lead (My Store › Orders by pickup) and Pathshala committee (Learning Center › Committee).
  `tests/demo-role-work.test.ts` pins exactly these six and that nobody else gets the card.
- **A queue**: every other role. The teacher has a card of her own (the class under My assignments).
- No role of the 25 is told "Nothing here for your role" any more. The message stays only as a last resort, for a person to whom no card applies.
- **Open for the owner**: the member app's address is one for the whole deployment, so a link straight into "your community" needs the
  per-community member addresses, which are switched off.

## The club demo (Lakeside Neighbors Club, 21 roles) has the same

Migration **0798** gives `demo_neutral_club_v1` version 2 the same kinds of waiting work, role by role: applications at three stages (Mateo Reyes's
waits for Emeka Okonkwo, the reference), a family change request, a bank account with four lines (generic statement), a write-off, the clean-up
day's checklist, inboxes with member and zone questions, WhatsApp requests, a message and a text to approve, two audio-lesson drafts, two data
requests, a background check, a shift for Mateo to confirm, and the clean-up day moved to five days away. It has no bolis, no Learning Center and no
religious coordinator, so its roles with no portal screen are eight (the same as the faith demo's, which has no boli recorder either). Its kitchen lead has My Store › Orders by
pickup, as the faith demo's does, once the shop is granted (below).

**One step for the owner: the club's shop is off.** A community that is not faith-based has the Store module off until Weaver's team grants it
(0594 `default_off`, 0740 grants), so the club's shop, its orders and its low stock are in the pack but nobody can see them, and its store lead,
pickup volunteer and kitchen lead have nothing until the grant is made. Grant **Store** to the club demo once (Platform › Centers › the club demo
› Modules); a reset keeps it. The faith demo is a Faith community, where Store is also off until granted: its pack asks for the grant itself (0820, below). `supabase/tests/184_demo_role_work_test.sql` section G
checks both halves: the store lead sees no order before the grant and finds the work after it.

## Things found on the way

1. **Three demo people were signed in with a scope the portal ignores.** The pack built each demo person with the role's own default scope,
   which for the Pathshala principal, the Pathshala committee member and the store lead is `pathshala` or `store`. The database counts those as
   center-wide (`app.has_permission`), but the portal's `computePermissions` counts only center and platform grants, and the Roles screen
   itself grants only "whole center", "one event", "one class" or "one zone". So those three saw no Pathshala, no My Store and no tasks.
   Migration **0796** gives a demo person the scope the Roles screen would choose. Nothing else changed: no policy, no real community. (The
   portal ignoring `pathshala` / `store` grants is a difference from the database that real communities do not meet today, because their grants
   are made on the Roles screen; it is left alone.)
2. **The dinner moves from 9 to 5 days away.** Close enough that the event lead's routine (the New look's Today) and the Home waiver task
   are due, far enough that the volunteers' waivers still matter. Everything about it (RSVP close, shifts, the parking notice) moves with it.
3. **The refund requests, credits and Gyan Path sign-offs are not in the pack.** A refund request is a field of a *payment*, and the pack's payments
   come from the loader's `pay` operation, which cannot set it. A credit needs a cancelled paid RSVP, a sign-off needs the Gyan Path goals, which are
   shared records with random ids. Each would need a new loader operation; the write-off, bank lines, applications and the rest do not.
4. **Resolutions need a relative date range.** A committee resolution is only votable inside a `voting_period` (a date range), and the loader
   resolves relative dates ("+5d") only when they are the whole value. Left out rather than given a range that would go stale.
5. **The family members' items are all reached through the member app**; Home carries a card that says so and counts them (see "What was built").

## The bank account and QuickBooks

The pack now has **one bank account** (`Chase operating ··4608`) and four statement lines. With a single active bank account that has no
QuickBooks account of its own, its money uses the community's main bank account, so the account mapping of
[DEMO_QUICKBOOKS.md](DEMO_QUICKBOOKS.md) is not touched and readiness is unchanged. Nothing is posted until a person confirms a match; the pack's
payments stay history (`is_historical`) and never post. A bank match the treasurer confirms in the demo is a real gift of the demo community and posts
to the QuickBooks sandbox company like the one in step 6 of that page. The bank account keeps its id across resets, so a QuickBooks account chosen for
it in Account mapping is put back by 0785 like a fund's class.

## The faith demo's modules (0820)

A Faith community leaves several modules for Weaver to switch on (0594 `default_off`), among them the Learning Center, the store, the learning path and Niva.
The faith pack says which ones it needs (`center.modules`: `pathshala`, `store`, `gyan_path`, `niva`) and
`app.demo_align_center` grants them (Weaver's grant, no person involved) whenever the community is made, reset or started over, so every demo person
has their work and the store, the school and Niva show. Bolis, My Jain Way and Labh are not available to that kind at all. Section A of
`supabase/tests/184_demo_role_work_test.sql` and `supabase/tests/820_demo_faith_neutral_test.sql` check both.

## After the merge

(Written for version 3, 0797; 0820 changed the pack to version 4 the same way.) The running demo community still has the older pack loaded. **Press "Start over" on the demo community** (Platform › Setup › Demo
sign-in), or wait for the nightly reset: the reset loads the current version (4 since 0820), rebuilds the 25 demo people with the new scopes and puts the sign-ins back
(0678, 0679, 0785 untouched). The QuickBooks connection and the account mapping survive it, as they do every night.

## Changing it

`supabase/scripts/build-demo-packs.mjs` holds the pack as data. Change it, then add a **new** migration
(`node supabase/scripts/build-demo-packs.mjs <new path> --only demo_faith_jain_v1 --version <n+1>`; the script refuses to overwrite a migration), and
update `supabase/tests/184_demo_role_work_test.sql` and `tests/demo-role-work.test.ts` if the work or the screens change.
