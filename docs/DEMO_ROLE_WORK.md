# What is waiting for each demo role when it signs in

The owner's request (2026-10-14): *"In the demo, make sure each role has something to be done inside when they login."* This page is the
inventory (what each of the 26 roles of the faith demo, **Sunrise Worship Center (Demo)**, finds right after signing in at `/demo`, worked out
from the code), what the pack now puts there, and which roles still have no portal screen at all.

It was worked out from `src/lib/tasks.ts` and `src/lib/data/home-tasks.ts` (Home "My tasks"), `src/lib/permissions.ts` (what opens a
screen), `src/lib/routines/*` (the New look's Today), the screens themselves, and the row level security the database applies to each person.
Two tests keep it honest: `tests/demo-role-work.test.ts` (what the portal shows each role: its Home queue, its screens, or only Home) and
`supabase/tests/184_demo_role_work_test.sql` (signs in as each of the 26 people with their own token and asks their questions with row level
security on). The people and their pledges, gifts, events and orders are the pack of `supabase/scripts/build-demo-packs.mjs`; this change is its
version 3 (migration 0797), and 0796 fixes how three of the people are signed in.

## What the portal shows, in one paragraph

Home "My tasks" is a list of queues, each shown only to someone who holds one of the permissions that act on it (`visibleTaskSources`). The
navigation shows a module only if the person holds a permission that opens one of its tabs. Both read the person's **whole-community** role
grants: a role held for one event, one class or one zone adds no permission (`computePermissions`), and a family role (community member,
membership reference, primary adult, adult member, child) holds no permission at all. So a person is in one of three states: they have a
queue on Home; they have no queue but a screen that holds their work; or the portal shows them Home and nothing else, and Home says "Nothing
here for your role". The community's first administrator is its **owner** (`app.ensure_center_owner`), and the owner holds every permission, so
the demo administrator sees every queue.

## Before and after, role by role

"Before" is the pack at version 2 (0786). "Now" is version 3. *Home* means Home "My tasks"; the path after an arrow is the screen one click
from Home in the navigation. A queue row's wording is the portal's own.

| Role | Person | Before (v2) | Now: what is waiting | Provided by | How they reach it |
| --- | --- | --- | --- | --- | --- |
| Center admin (owner) | Asha Varma | One row: the 6 volunteers of the Tapasvi event with no signed waiver | 13 rows: the waiver row (now 8 volunteers), the treasurer's write-off and bank lines, 2 membership applications, a message to approve, 5 member questions, 2 WhatsApp requests, a text to approve, items under their reorder level, a boli closing, a waitlisted learner, 2 data requests | everything below; she is the owner so every queue is hers | Home |
| Executive committee | Rohit Varma | Nothing waiting | 2 membership applications, one of them a **life membership waiting for the executive committee** | `membership_applications` (Lalit's life application, Tarun's yearly one) | Home; People › Membership applications |
| Executive viewer | Kavita Rathore | Home "At a glance": next event RSVPs | Same, read only (by design this role changes nothing): the Tapasvi RSVPs, the open bolis, Reports › Center health | events, RSVPs, bolis | Home "At a glance"; Reports; Events; Bolis |
| Treasurer | Meera Doshiwal | Nothing waiting | A **write-off** a colleague asked for, to confirm as the second approver; **4 bank lines** to match (one is a check deposit); the current month still to close (its checklist has the statements check for her to mark, then the lock; in the New look her month-end routine says to match every bank line first) | pledge `w1` with `written_off_by`; `bank_accounts` + 4 `bank_transactions` | Home; Giving › Payments & deposits › Bank; Accounting › Month-end close |
| Finance volunteer | Kiran Doshiwal | Nothing waiting | The 4 bank lines to match; open pledges to record gifts against (Giving › Payments) | the same bank lines; pledges `a7`, `b1`, `b2`, `g2`, `g3` ... | Home; Giving |
| Membership coordinator | Hemant Parmar | Nothing waiting | 2 applications to decide (Tarun Patni's yearly one, Lalit Rathore's life one); a **family change request** (add a family member to the Wadhwa household) | 3 `membership_applications`, 1 `household_change_requests` | Home; People › Membership applications / Family change requests |
| Religious coordinator | Bharat Kataria | Nothing waiting | A religious text to approve ("Porisi pachchakhan"); a digital boli (the first lamp at Diwali) that closes in 4 days, with 3 entries | `content_items` (in review), `bolis` + `boli_entries` | Home; Content › Approval queue; Bolis |
| Communications officer | Pooja Salecha | Nothing waiting (a draft is in Newsletters) | A message to approve ("Diwali greetings"); **5 member questions** nobody has taken; 2 WhatsApp join requests; the Pathshala draft to finish and send | `comms_campaigns`, `inboxes` + `threads` + `thread_messages`, `whatsapp_groups` + `whatsapp_join_requests` | Home; Communications |
| Content editor | Nikhil Salecha | Home: "Nothing here for your role"; no drafts | 2 drafts to write and send for approval (an audio lesson to record, a pachchakhan to write) | `content_items` (draft) | Content › Library |
| Privacy officer | Falguni Singhvi | Nothing waiting | 2 data requests (an export, a deletion in progress) | `data_requests` | Home; Settings › Privacy |
| Volunteer coordinator | Dipak Singhvi | Home: "Nothing here"; interests to answer and free shifts existed | 3 people who asked to volunteer, a **background check** that was asked for and has not come back, and 3 shifts with free places | `volunteer_interests`, `background_checks`, `volunteer_shifts` | Events › Volunteers (also from any event's Volunteers tab) |
| Event lead | Sanjay Lunawat | Nothing in the portal; the Tapasvi event 9 days away | The Tapasvi event is **5 days away** with 24 people to check in (12 confirmed, 12 who have RSVPd), a checklist of 5 actions (one overdue, one due tomorrow and his own, one in 3 days, one nobody owns) and live numbers | `events`, RSVPs + attendees, `actions` | **No portal screen.** The event page (`/events/<id>`) opens by its link; in the New look, Today lists "Check RSVPs against capacity" while the event is within 7 days |
| Check-in volunteer | Riya Lunawat | Nothing in the portal | The same 24 people to check in; her own confirmed shift at the door | RSVPs + attendees, `volunteer_assignments` | **No portal screen.** The event-day app (connect-admin) and the member app's volunteer mode |
| Kitchen lead | Vijay Bhandari | Nothing in the portal | The prep list (3 lines of 2 store orders waiting) and the Tapasvi headcount (12 confirmed people) | store orders, attendees | **No portal screen.** The kitchen display of the event-day app |
| Store lead | Sunil Nahar | Nothing in the portal (the grant was scoped to 'store', which the portal ignores: see below) | **2 items at or under their reorder level** (Farsi puri, Chakri) and 2 orders to prepare and hand out | `store_items` with stock and a reorder level; orders `o3`, `o4` | Home; My Store |
| Store pickup | Rekha Nahar | The same 2 orders (it was already there) | The 2 orders (one ready, one placed) for the pickup window in 2 days | orders `o3`, `o4` | My Store › Orders by pickup |
| Boli recorder | Sarla Kataria | Nothing: there was no boli | An **in-person boli** for the Tapasvi event to record when it is called | `bolis` (in person) | **No portal screen.** The event-day app / the member app's volunteer mode |
| Pathshala principal | Deepa Chopda | Nothing in the portal (the grant was scoped to 'pathshala') | A late **registration waiting to be placed** (Zara asks for a level with no class), a learner on the **waitlist** (Aarav) | `pathshala_enrollments` | Home; Pathshala › Enrollments |
| Pathshala committee | Manish Chopda | Nothing in the portal (scoped to 'pathshala') | The committee's "next two weeks": an overdue action, one due tomorrow, one in 3 days, two nobody owns | `actions` on the Tapasvi and Diwali events | Pathshala › Committee |
| Teacher | Anita Bhandari | Her class and its roster | Her class 2 (3 students) with **attendance not taken** for the latest Sunday | `pathshala_classes`, enrollments | Pathshala › My classes (her landing) |
| Zone lead | Lalit Rathore | Nothing in the portal; no inbox | **2 questions in the north zone's inbox**, and the 7 families of the zone | `inboxes` (zone), `threads` | **No portal screen.** `/comms/inbox` opens by its link (the Inbox tab needs comms.inbox); the member app |
| Community member | Priya Wadhwa | Nothing | Her **membership application waiting for her reference to answer**; an open pledge; a parking shift to confirm; 2 events to RSVP to; a notice; her two questions to the office | `membership_applications`, pledge `g3`, `volunteer_assignments`, `threads` | **No portal screen.** The member app |
| Membership reference | Kusum Parmar | Nothing | An application that **names her as reference**, waiting for her answer | `membership_applications` (reference = Kusum) | **No portal screen.** The member app (Membership › Requests to vouch) |
| Primary adult | Tarun Patni | An open pledge, an RSVP | The family's membership application (waiting for the team); the open pledge; the Diwali RSVP; the open boli | `membership_applications`, pledge `g2`, `bolis` | **No portal screen.** The member app |
| Adult member | Nisha Patni | An open family pledge | The open family pledge; a **parking shift to confirm** | pledge `g2`, `volunteer_assignments` | **No portal screen.** The member app |
| Child | Zara Singhvi | Events | Events to see; her **Pathshala registration** (waiting for a class for her level); the notices. Never a pledge, gift or boli | `pathshala_enrollments`, events, alerts | **No portal screen.** The member app |

## The roles that still have no portal screen

Ten of the 26 roles hold nothing the portal opens a screen with (`tests/demo-role-work.test.ts` pins this, and
`supabase/tests/184_demo_role_work_test.sql` section C asserts that they hold no permission center-wide). Their work above is real and sits in
the database behind row level security, and each reaches it in the app that was built for it. A visitor who signs in to the portal as one of
them sees "Nothing here for your role" on Home and a navigation with only Home in it.

| Roles | Their real surface | Smallest sensible addition (for the owner to decide) |
| --- | --- | --- |
| Community member, membership reference, primary adult, adult member, child | The member app (`connect-mobile`): the family's pledges, RSVPs, membership application, requests to vouch, shifts, notices | A Home card for a person with no staff queue: "Your work is in the member app", with the link and a few counts from the same functions the app uses (`my_membership_application`, `my_reference_requests`, the family's open pledges, shifts to confirm). No new portal for members |
| Event lead, check-in volunteer, boli recorder | The event-day app (`connect-admin`) and the member app's volunteer mode | A Home card "My assignments" that lists the event, class or zone grants the person holds, one line each with a link (`/events/<id>`, the live check-in) |
| Kitchen lead | The kitchen display of the event-day app | Add `kitchen.view` to the `storeOrders` rule so My Store › Orders by pickup opens for them. The database already lets them read the orders and their lines, so this changes only what the portal shows |
| Zone lead | The member app and the zone inbox by its link | The same "My assignments" card, linking to `/comms/inbox` |

Nothing in the list was built here: they are either a new portal screen or a change to what a permission opens, which the owner decides.

## The club demo (Lakeside Neighbors Club, 21 roles) has the same

Migration **0798** gives `demo_neutral_club_v1` version 2 the same kinds of waiting work, role by role: applications at three stages (Mateo Reyes's
waits for Emeka Okonkwo, the reference), a family change request, a bank account with four lines (generic statement), a write-off, the clean-up
day's checklist, inboxes with member and zone questions, WhatsApp requests, a message and a text to approve, two audio-lesson drafts, two data
requests, a background check, a shift for Mateo to confirm, and the clean-up day moved to five days away. It has no bolis, no Pathshala and no
religious coordinator, so its roles with no portal screen are nine (the same, minus the boli recorder).

**One step for the owner: the club's shop is off.** A community that is not faith-based has the Store module off until Weaver's team grants it
(0594 `default_off`, 0740 grants), so the club's shop, its orders and its low stock are in the pack but nobody can see them, and its store lead,
pickup volunteer and kitchen lead have nothing until the grant is made. Grant **Store** to the club demo once (Platform › Centers › the club demo
› Modules); a reset keeps it. The faith demo is a Jain Center, where Store is on. `supabase/tests/184_demo_role_work_test.sql` section G
checks both halves: the store lead sees no order before the grant and finds the work after it.

## Things found on the way

1. **Three demo people were signed in with a scope the portal ignores.** The pack built each demo person with the role's own default scope,
   which for the Pathshala principal, the Pathshala committee member and the store lead is `pathshala` or `store`. The database counts those as
   center-wide (`app.has_permission`), but the portal's `computePermissions` counts only center and platform grants, and the Roles screen
   itself grants only "whole center", "one event", "one class" or "one zone". So those three saw no Pathshala, no My Store and no tasks.
   Migration **0796** gives a demo person the scope the Roles screen would choose. Nothing else changed: no policy, no real community. (The
   portal ignoring `pathshala` / `store` grants is a difference from the database that real communities do not meet today, because their grants
   are made on the Roles screen; it is left alone.)
2. **The Tapasvi event moves from 9 to 5 days away.** Close enough that the event lead's routine (the New look's Today) and the Home waiver task
   are due, far enough that the volunteers' waivers still matter. Everything about it (RSVP close, shifts, the parking notice) moves with it.
3. **The refund requests, credits and Gyan Path sign-offs are not in the pack.** A refund request is a field of a *payment*, and the pack's payments
   come from the loader's `pay` operation, which cannot set it. A credit needs a cancelled paid RSVP, a sign-off needs the Gyan Path goals, which are
   shared records with random ids. Each would need a new loader operation; the write-off, bank lines, applications and the rest do not.
4. **Resolutions need a relative date range.** A committee resolution is only votable inside a `voting_period` (a date range), and the loader
   resolves relative dates ("+5d") only when they are the whole value. Left out rather than given a range that would go stale.
5. **The family members' items are all reached through the member app**, so nothing else in the portal was changed for them.

## The bank account and QuickBooks

The pack now has **one bank account** (`Chase operating ··4608`) and four statement lines. With a single active bank account that has no
QuickBooks account of its own, its money uses the community's main bank account, so the account mapping of
[DEMO_QUICKBOOKS.md](DEMO_QUICKBOOKS.md) is not touched and readiness is unchanged. Nothing is posted until a person confirms a match; the pack's
payments stay history (`is_historical`) and never post. A bank match the treasurer confirms in the demo is a real gift of the demo community and posts
to the QuickBooks sandbox company like the one in step 6 of that page. The bank account keeps its id across resets, so a QuickBooks account chosen for
it in Account mapping is put back by 0785 like a fund's class.

## After the merge

The running demo community still has version 2 and the old scopes. **Press "Start over" on the demo community** (Platform › Setup › Demo
sign-in), or wait for the nightly reset: the reset loads version 3, rebuilds the 26 demo people with the new scopes and puts the sign-ins back
(0678, 0679, 0785 untouched). The QuickBooks connection and the account mapping survive it, as they do every night.

## Changing it

`supabase/scripts/build-demo-packs.mjs` holds the pack as data. Change it, then add a **new** migration
(`node supabase/scripts/build-demo-packs.mjs <new path> --only demo_faith_jain_v1 --version <n+1>`; the script refuses to overwrite a migration), and
update `supabase/tests/184_demo_role_work_test.sql` and `tests/demo-role-work.test.ts` if the work or the screens change.
