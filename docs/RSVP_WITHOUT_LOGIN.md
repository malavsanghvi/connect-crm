# RSVP without signing in (plan)

**Status: approved by the owner 2026-10-15 ("go with the recommendations"), slices 1-3 built** (migrations 0822 and 0823 in the first pull request (#285):
the masks, the switches, the locked tables, lookup / save / undo / view / cancel in mode `open`, the confirmation email and the `%MEMBER_APP_URL%` link; the
code mode (design B) in the second pull request), slice 4 (the portal screens, section 9), slice 5 (the member app, section 10, connect-mobile #113, 1.23.0) and slice 6
(the page behind the emailed link and See my tickets, section 11, connect-mobile #114, 1.24.0). Slice 7 (hardening and docs) is this section 12 and the abuse tests of 0822 to 0824;
what is still open is listed at its end. Owner request, 2026-10-15, verbatim:

> "Mobile app - RSVP - Allow RSVP using just phone number or email - without logging in. If user has not logged in, show all
> family members with names not fully visible... show Malav as M**AV, minimum of 50% of characters should be *. Show the phone
> number and email as well where the confirmation email would be sent."

**The owner approved the plan, and approves each pull request that builds it.** It adds functions that people without a session can call, and that read
people and households (section 6).

## 0. The short version

- A visitor on an event types a phone number or an email. If it belongs to an adult on a family record, the app shows the family
  with **masked names** and the **masked phone and email** the confirmation will go to. The visitor ticks who is coming and
  confirms. A confirmation goes to the email **on file** (never to anything typed) with a link to see tickets or cancel.
- The owner's example contradicts the owner's rule: **M\*\*AV hides 2 of 5 characters (40%), not 50%.** Hiding at least half of
  "Malav" means showing at most 2 letters: **M\*\*\*v** (section 4).
- Two designs (5.4). **A**: exactly what was asked, the masked family shows right after typing. **B**: the same screens, but the
  masked family shows only after a 6-digit code sent to that phone or email. **Recommendation: B by default**, A selectable per event.
- Off by default (a community switch, then a switch per event). Free events only. Never any money.
- Seven slices in order (6.3). Slice 1 changes who can call what, so the owner's OK is asked in its pull request.

## 1. How RSVP works today

| Topic | Today | Where |
|---|---|---|
| Tables | `rsvps` (one per family and event: `household_id`, `status`, `source` = app / guest_web / admin / walk_in / kiosk / import, guest name / phone / email columns); `attendees` (one per person: `person_id`, `is_child_under_12`, `is_senior`, `needs_assistance`, `ticket_token` from a trigger, `lunch_slot_id`); `events` (`status`, `audience`, `capacity`, `waitlist_enabled`, RSVP window, `lunch_*`, `is_paid`, `confidential`) | `0004_events.sql` |
| Who may RSVP for whom | An adult (18+, or no date of birth) of the household, for that household and its named guests. RLS lets a signed-in adult insert only `source = 'app'`; attendees only before check-in | `0010_rls.sql`, `docs/ROLES.md` |
| The rules function | `app.submit_rsvp`: event published or live, window open, audience eligibility (life members / Pathshala families / members), at least one person, **one live RSVP per family**, **capacity** (waitlist or "this event is full"), optional pledge | `0018_mobile_gaps.sql`, `0104_module_rpc_guards.sql` line 933 |
| Cancel and change | `app.cancel_my_rsvp` (releases seats, revokes tickets, optional pledge and credit), `app.raise_rsvp_commitment`; staff: `app.event_set_rsvp_status`, Events › RSVPs tab, add-by-staff, walk-ins, door lookup by phone (masks names for staff) | `0542`, `0543`, `0654`, `src/app/ops/[eventId]/actions.ts` |
| Lunch and counts | Nothing about lunch is chosen at RSVP. Slots are assigned at **check-in** from each attendee's two flags (set from date of birth on the event date). Seats = attendees on RSVPs not cancelled or waitlisted | `assign_lunch_for_rsvp`, `move_lunch_slot` |
| Money | Only an optional commitment (a pledge), adults only, needs Giving. `is_paid` and the prices are **settings only**: no ticket payment exists at RSVP | `docs/EVENT_CREATION.md` |
| Messages | Automatic email `registration_confirmed` (off until a community switches it on) to the household's adults with an email, or `guest_email` when there is no household; "please confirm" push needs a login with a registered phone | `0770`, `0598`, `worker/src/handlers/messaging.compose.ts` |

**In the member app** (connect-mobile, read only for this plan):

- `src/lib/api/events.ts` `saveRsvp` **does not call `submit_rsvp`**: it inserts `rsvps` then `attendees` straight through RLS, and the pledge through the giving API.
- Event screen `src/app/(app)/event/[id]/index.tsx`: a signed-in adult sees `RsvpForm`. A guest sees (lines 137-148) "Sign in to RSVP for your
  family." and a Sign in button that remembers the event (`src/features/return-to-event.tsx`) and leaves guest mode.
- **Guest mode**: Welcome → "Just visiting? Explore as a guest" (`src/app/(auth)/welcome.tsx`, `setGuest(true)`, `src/providers/app.tsx`). A guest is the
  anon client and reads only events allowed by `events_public_read`: audience `public` or `members_and_guests`, published / rsvp_closed / live, not
  confidential (0010, 0578). A flyer's QR link `/e/<id>` (`src/app/e/[id].tsx`) puts a signed-out visitor in guest mode on that event. In a demo
  community a guest looks around read-only and RSVP sends them to sign in (`docs/MEMBER_APP_DEMO.md`).
- After RSVP: `event/[id]/tickets.tsx` (a QR per person, lunch) and `event/[id]/confirm.tsx`.

**Found while reading, and it shapes the plan:**

1. **The app never checks capacity** (only `submit_rsvp` does, and the app does not call it). A door that cannot trust its client must check it.
2. **No unique index** stops two live RSVPs for one family and event; code checks it.
3. `guest_*` columns and `source = 'guest_web'` exist ("Guest page" in the portal) but **nothing writes `guest_web`**. That is for people on no record; this plan is for families on a record (decision 13).
4. `docs/ACCESS_LEVELS.md` says RSVP "always needs at least a signed-in community member". This plan changes that for events that opt in.
5. A family RSVP'd this way has no login: no "please confirm" push and no ticket screen. The emailed link stands in for both.

## 2. The proposed flow (member app)

**When the button shows.** A guest on an event sees, under the existing sign-in card, a second button **"RSVP without signing in"** only when the event's
`contact_rsvp` is `code` or `open` (the event row is already readable by guests), the RSVP window is open, and the event is free. Otherwise the screen is
exactly today's.

1. **Find your family.** "Enter the mobile number or email address we have for your family. We will show you who is on your family record, with names
   partly hidden." (Design B: "...We will send a 6-digit code to it.") Tabs "Mobile number" | "Email", one field, **Continue**. Links: "Sign in instead",
   "New here? Join the community".
2. **Enter the code (design B).** "If that number is on a family record, we sent a 6-digit code to it. It works for 10 minutes." Send a new code after
   60 seconds (3 at most). "No code? Check the number, try your email, or sign in." It never says whether the contact exists.
3. **Who is coming.** The app's existing checkbox rows, all ticked the first time:

   ```
   [x]  M***v S**h     Adult
   [x]  P***a S**h     Adult
   [x]  Child 1        Child · under 12
   Your confirmation will be sent to   m***@g***.com
   Phone on file                       +1 *** *** **87
   Names and numbers are partly hidden on purpose.   Not your family? Go back.
   [ RSVP for 3 people ]
   ```

   The optional "Needs help getting around" toggle appears where the event allows it (no free text). If lunch is on: "Lunch is served after the program. Your
   time is set when you check in." No donation section, no "Add a guest". At zero ticks: "Select at least one person who is coming."
4. **Saving.** The existing step screen: finding your family, registering 3 people, issuing tickets, sending your confirmation.
5. **Done.** "You are registered for <event>. We sent a confirmation to m***@g***.com. It has the link to see your tickets, change your plans or cancel."
   Buttons: **See my tickets**, **Undo this RSVP** (15 minutes), Done.
6. **Manage** (the emailed link, and "See my tickets"): route `/rsvp/<token>`, outside the route guards like `e/[id]` and `join/[code]`. The event, the people
   (masked, same rule), status, a QR per person, and **"We can't make it"** (cancel, with "Cancel this RSVP for 3 people?"). Opening it marks the RSVP
   verified. No "add people" in v1: sign in, or the office.

**Not signed in: what is read, and the next step** (plain English; business outcomes come back as `{ok:false, code}` and the app maps each code to a
sentence in all three languages; only real faults raise):

| Situation | The person reads | Buttons |
|---|---|---|
| Nothing found (A) | "We could not find a family record with that number. Check it, try your email instead, or sign in. If your family is new here, join first." | Try again · Sign in · Join |
| Number on two families | "That number is on more than one family record, so we cannot tell which is yours. Try your email, sign in, or ask the office." | Sign in |
| Family already has an RSVP | "Your family already has an RSVP for this event. To change it, use the link in your confirmation email, or sign in." (no names) | Sign in |
| No email on file, or it cannot be sent to (bounced, opted out, sandbox) | "We found your family, but we could not send a confirmation to the email we have, so we did not save your RSVP. Please sign in or call the office." | Sign in |
| Demo community | "This is a demo. RSVPs are not saved and nothing is sent." | none |
| Event full | "<Event> is full." (a no-login RSVP never waitlists in v1) | Back |
| Too many tries | "Too many tries from this phone. Please wait a few minutes, or sign in." | Sign in |
| Page waited too long, or a network fault | "This page timed out. Start again." / the app's usual "We couldn't save your RSVP. Check your internet connection and try again." | Start again · Try again |

**People already signed in see no change.** The button renders only when `!member`; `submit_rsvp`, the direct inserts, RLS and the confirm / tickets screens are untouched.

## 3. Backend design

### 3.1 Switches and storage

- **Community master** `centers.rules.rsvp.contact_lookup` = `off` (default) | `code` | `open`: the most open mode any event may use. Settings › Rules › Lunch
  and RSVP, `settings.manage`. Read only inside the new functions (guests cannot read `rules`, 0817).
- **Per event** `events.contact_rsvp text not null default 'off'` (`off` | `code` | `open`). A trigger refuses a value above the master, and any value on a
  paid event, a confidential event, or an audience other than `public` / `members_and_guests`. Changed by `events.manage` or the event's lead.
- **`app.rsvp_contact_handles`** (new; RLS on, no policy, privileges revoked from anon and authenticated, like the 0770 email tables): household, matched
  person, recipient person, mode, `members` (ordered person ids; position = the "slot"), `contact_hash`, `handle_hash`, `code_hash`, `code_attempts`,
  `verified_at`, `rsvp_id`, `used_at`, `expires_at` (30 minutes), `ip_hash`.
- **`app.rsvp_manage_links`** (new, same locking): `rsvp_id`, `token_hash`, `expires_at` (event end + 2 days), `last_opened_at`, `revoked_at`. Only a SHA-256 of
  the token is stored, as for staff invitations (0152).
- **`app.rsvps`**: `source` gains `guest_contact`; new `contact_kind`, `contact_person_id` (staff-only), `contact_verified_at`.
  **Unverified = `source = 'guest_contact' and contact_verified_at is null`.**
- **Counters**: `app.public_rate_events` with `app.rate_limited` / `rate_note` (0200); numbers in one function `app.rsvp_contact_limits()` like
  `demo_signin_limits` (0678). Phone and email hashes are **keyed** (HMAC, pepper in the Vault): a plain SHA-256 of a phone number can be reversed by
  trying every number. Every function uses `set search_path = app, public, extensions` (CLAUDE.md, 0019).

### 3.2 The functions (anon-callable)

All `security definer`, `revoke ... from public`, `grant execute ... to anon, authenticated, service_role`. They answer `{ok:true, ...}` or
`{ok:false, code, message}` (the pattern of `worker_demo_begin`, 0679). **No function takes an address to send to.**

| Function | Arguments | Returns |
|---|---|---|
| `app.rsvp_contact_lookup` | `p_event`, `p_contact` | **A:** `{step:'choose', handle, expires_in, members:[{slot, label, kind, under_12}], send_to:{email, phone}}` or a code (`not_found`, `ambiguous`, `already_rsvpd`, `no_email`, `full`, `closed`, `rate_limited`, `demo`, `unavailable`). **B:** `{step:'code', handle}` for any well-formed contact, found or not |
| `app.rsvp_contact_verify` | `p_handle`, `p_code` | B only: the "choose" answer, or `bad_code` (tries left) / `expired` / `locked` |
| `app.rsvp_contact_submit` | `p_handle`, `p_slots int[]`, `p_assist int[]` | `{status, count, send_to:{email}, undo_until}` or a code (`full`, `expired`, `used`, `already_rsvpd`, `cannot_send`, `rate_limited`) |
| `app.rsvp_contact_undo` | `p_handle` | cancels the RSVP made with that handle, within 15 minutes |
| `app.rsvp_contact_view` / `_cancel` | `p_token` | view: event, masked people with slots, ticket QR tokens, status (marks verified); cancel: release seats, revoke tickets |
| `app.rsvp_contact_verify_staff` | `p_rsvp` | `events.manage` or the event's lead: mark verified, with a reason, audited |

Helpers (not granted to callers): `app.mask_name`, `app.mask_email`, `app.mask_phone` (section 4), `app._rsvp_contact_find`.

### 3.3 From a lookup to an opaque handle

1. **Gate.** The event exists, is published or live, audience `public` / `members_and_guests`, not confidential, free, window open; `app.community_open` (0817);
   Events module on; the event's mode is not above the master; not a demo community.
2. **Limits** (5.2) before any work.
3. **Find.** Normalise (email lower-case; phone with `app.normalize_recipient('sms', ...)`, 0161). Match `people.phone_e164`, `people.email` or `person_emails.email` of
   **adults only** (`not app.person_is_minor`), not deceased, not merged, current household members. A child's phone never opens a family. Zero families =
   `not_found`; two or more = `ambiguous` and nothing is chosen for the visitor.
4. **Handle.** 24 random bytes (`extensions.gen_random_bytes`), base64url; only its SHA-256 is stored. The row freezes the household, the ordered members and the
   address the confirmation will use. The visitor gets the handle and **slots (1, 2, 3), never a person, household, RSVP or attendee id.** Single use, one event, 30 minutes.
5. **Submit.** Looks the handle up by hash, re-checks step 1, locks the event row (`for update`), counts seats, then writes. A slot not in the handle, a used or expired handle,
   or another event's handle is refused.
6. **Cleanup.** The next lookup deletes expired handles (100 at a time), and the existing 5-minute notices sweep gets one added call.

### 3.4 What an RSVP made this way stores

- `rsvps`: `source = 'guest_contact'`, `household_id` = the matched household, **`submitted_by_person_id` null** (nobody signed in), `contact_person_id`, `contact_verified_at` null
  (set when the code was passed in B, when the emailed link is opened, or by staff), `commitment_mode = 'none'`, no pledge, status `rsvpd`.
- `attendees`: the household member, the real name (staff see it), the two flags **worked out by the database** from date of birth on the event date, `needs_assistance` from the
  toggle, no free text. Tickets from the existing trigger.
- **Quota:** unverified contact RSVPs hold at most 25% of `capacity` (40 seats if there is no capacity); verified ones stop counting.
- **Audit:** `app.set_audit_context('RSVP made without signing in; the contact typed matched a family record')` and an `rsvp.contact_submitted` entry. No phone or email in the audit
  log or the handle table.
- **Staff see it:** Events › RSVPs: badge "Without signing in · unverified", a filter, **Mark verified**, Cancel; the Family page's Events tab label
  (`src/lib/people-v2/family-events.ts`). Door check-in is unchanged (QR, or `checkin_lookup_phone`).

### 3.5 Where the confirmation goes

- **To one address, chosen inside the database**: the matched person's email on file, else the primary adult's. What the visitor typed is only used to find the family.
- **By the existing path:** `rsvp_contact_submit` calls `app.enqueue_notice` (0598) in the same transaction: email, template `rsvp_contact_confirmation`, purpose `notification`,
  topic `events`. The manage token is passed as `token`, which `enqueue_notice` already keeps in the Vault and masks in the queue; `messaging.send` sends it. The email has the
  event, date, place, the number of people (no names) and the link.
- **The link**: the worker only knows the portal's address (`%PORTAL_URL%`). The slice adds a `%MEMBER_APP_URL%` mark in `worker/src/messaging.ts` (the member web app's
  address, repository variable `MEMBER_APP_URL`, which flyer QR codes already use; the worker needs it in its environment).
- **No RSVP without a confirmation.** If `enqueue_notice` refuses (no email, suppressed after a bounce, opted out, sandbox recipient rule) the transaction rolls back and the
  visitor reads the sentence in section 2. The sender already refuses demo communities.
- **No second email**: `rsvps_registered_email` (0770) is redefined to skip `guest_contact`.
- **Codes (B)**: template `rsvp_contact_code`, purpose `verification_code`, sent only to a contact on file: by email, or by text where texting is set up for the community
  (otherwise a phone is not accepted in B and the screen says to use the email). 6 digits, 10 minutes.

### 3.6 Tests

**Database** (`supabase/tests/<n>_rsvp_contact_test.sql`, run as `anon`, in the style of test 95):

- masks match the section 4 table and, over generated strings, hide at least half of every word;
- anon can call the functions but cannot select the new tables, `rsvps`, `attendees`, `people` or `households`;
- **no leak**: each function's output as text holds none of the real names, full email or full phone, and no uuid of a person, household, RSVP or attendee;
- every miss (a child's phone, deceased, merged, left) gives the same `not_found`; two households give `ambiguous` and no members;
- submit writes what 3.4 says and refuses a foreign slot and a reused, expired or other-event handle; the rules (closed, not open, draft, paid, audience, confidential,
  switches, demo, suspended community, full by exactly one, a second RSVP for the family, the 25% quota);
- confirmation: one message, `to_address` is the stored email even when a phone was typed; no email, suppressed or opted out leaves **no RSVP**; the token is in the
  Vault and not in `messages.payload`;
- manage: view marks verified, cancel releases seats and revokes tickets, wrong / expired / revoked tokens answer alike;
- design B: same answer found or not, code only to a contact on file, 5 wrong tries lock, expiry; each limit answers `rate_limited`, not an error;
- staff permissions; **signed-in paths unchanged** (tests 01, 45, 106).

**Unit.** connect-crm (vitest): `tests/mask.test.ts` runs the TypeScript reference rule against the same table; the portal switch validation; a worker test for the `%MEMBER_APP_URL%`
mark. connect-mobile: a pure state machine from each `code` to a screen and a sentence (every code has a sentence in en / gu / hi; the existing i18n test keeps the languages equal),
the phone / email validity check, and that the app only displays strings the database returned (it never masks anything itself).

### 3.7 Migrations

The highest merged migration is **0817**. **The builder must pick the next free numbers above 0820** after listing `supabase/migrations` and the open pull requests
(`gh pr list`), one migration per slice, never editing an applied one. After each: `supabase/tests/run_local.sh`, regenerate `src/lib/database.types.ts`
(`node supabase/scripts/gen-types.mjs`) and copy it to connect-admin and connect-mobile.

## 4. The masking rule

**The owner's example does not meet the owner's rule.** "M**AV" shows 3 of 5 characters, so 40% are stars. At least 50% stars on 5 characters needs at least 3 stars, so at
most 2 letters can show. Proposed rule:

- A **unit** is one visible character: a letter or digit with its combining marks (text is normalised first, so accents and Indic vowel signs are never split from their letter).
- A **word** is a run of units between separators (space, hyphen, apostrophe, period, comma). Separators show as they are and are not counted.
- For **n units**: n = 1 shows `*`; n = 2 or 3 shows the first unit then stars; **n >= 4 shows the first and the last unit** and stars between. Visible units never exceed
  floor(n/2), so at least half of every word, and so of the whole name, is hidden. Stars keep the word's length (as the example does). Case is kept: `M***v`, not `M***V`.
- **Adults**: first name (preferred name if set) and last name, each masked. **Children**: "Child 1", "Child 2" (oldest first) with an "under 12" tag when it applies, **no letters of the
  name and no age** (decision 5). A **single-member household is shown** like any other. Deceased, merged and past members are left out.
- **Email**: the local part shows its first character then `***` (just `***` if it has one character); each domain label except the last shows its first character then `***`; the last
  label stays. **Phone** (E.164): `+1` and the last 2 digits for a US or Canada number, otherwise `+` and the last 2 digits. Fixed `***` does not reveal an email's length.

| Input | Shown | | Input | Shown |
|---|---|---|---|---|
| Malav | `M***v` (3 of 5 hidden; `M**AV` hides 2) | | José | `J**é` |
| Al, Jo | `A*`, `J*` | | Zoë | `Z**` |
| A | `*` | | 李伟, 王小明 | `李*`, `王**` |
| Raj | `R**` | | محمد | `م**د` |
| Anil | `A**l` | | माला, માલવ | `मा*`, `મા**` |
| Priya Shah | `P***a S**h` | | name@gmail.com | `n***@g***.com` |
| Mary Ann | `M**y A**` | | a@gmail.com | `***@g***.com` |
| Jean-Luc | `J**n-L**` | | malav.sanghavi@mail.company.co.uk | `m***@m***.c***.c***.uk` |
| O'Brien | `*'B***n` | | +1 (312) 555-0187 | `+1 *** *** **87` |
| J. R. R. | `*. *. *.` | | +442071234567 | `+**********67` |

**Where it lives.** The real work is in the database, because the real value must never reach the phone: `app.mask_name`, `app.mask_email`, `app.mask_phone` (immutable, read no
table). A pure TypeScript reference (`src/lib/mask.ts`, `Intl.Segmenter` for units) has the same signatures and is tested against the same table, so a change to the rule changes both.

## 5. Threat model

### 5.1 Risks and mitigations

| Risk | What could happen | Mitigation | Left over |
|---|---|---|---|
| Who is a member | Anyone types numbers or emails and learns which are on a record | A: cannot be hidden, it is the feature; limits. B: lookup answers alike found or not; a code goes only to a contact on file | A leaks membership to anyone who guesses a number |
| Names and contacts from masked output | The masked output shows a family's shape | At most 2 letters per word; children by number, no letters, no age; fixed email stars; last 2 phone digits | A: head count, name lengths and ends, first letter of email and domain, last 2 digits, whether a child is under 12. B: the same, to someone holding the contact |
| Filling capacity, or RSVP for someone else | A bot or person RSVPs families who did not ask | One live RSVP per family and event; unverified quota 25%; the real owner gets the email with a one-tap cancel; staff see "unverified" and can cancel in bulk; free events; B needs the contact | In A, someone with a real number can RSVP that family once |
| Bots | Many lookups or submits | Keyed counters (5.2); single-use short handle; event row locked while counting; no free text; request size limits | No CAPTCHA in the system. The IP comes from request headers whose first value can be forged, so **the per-IP limit alone is weak**; the per-contact, per-event and global limits are the real brakes |
| Children's data | A child's name or age shown to a stranger | Never by name; only an adult's contact opens a family; flags set by the database; no pledge, no free text | The count of children and "under 12" |
| Timing and response differences | Different answers or speeds tell found from not found | B: same shape and same work (always hash, always write a handle, code queued not sent inline), one `not_found` for every miss | A shows it by design |
| Logs and PII | Contacts end up in logs | Contacts only as keyed hashes; never in error text, audit text or handle rows; handles purged; the builder checks the hosted project's log settings for request bodies | The gateway may keep request metadata |
| Email abuse | We email a family that did not ask | One confirmation per RSVP; one RSVP per family and event; 3 emails a day per address; codes only to contacts on file; the email says how to cancel | One unwanted email per event |
| Text cost (B) | Code texts to numbers an attacker controls | Only numbers already on file; 3 an hour per number; a daily cap per community | A cost the community carries |
| Leaked link | A forwarded email lets someone open the RSVP | Ends 2 days after the event; view and cancel only; masked names | Whoever holds the email can cancel |

### 5.2 Limits (starting numbers, one function)

Lookups: 10 an hour per IP (a miss counts double), 3 an hour per contact, 300 an hour per event, 2,000 an hour in all. Code requests: 3 an hour per contact; 5 wrong codes lock that contact for
15 minutes. Submits: 5 an hour per IP. A visitor's own limit is checked **before** any global lock (as 0679 does). Every limit answers `rate_limited` with a sentence.

### 5.3 Switch, and paid events

Off by default in both places. The master is set by `settings.manage`; an event by `events.manage` or its lead, never above the master. **Free events only**: a paid seat needs to know who
is paying, and today there is no ticket payment at RSVP at all. Nobody can make a pledge this way.

### 5.4 Design A or design B

| | **A: as asked** | **B: masked family after a code** |
|---|---|---|
| Steps | contact, tick, confirm | contact, code, tick, confirm |
| A stranger with only a phone or email learns | whether it is on a record, and the masked family | nothing, unless they hold that contact |
| Spam and capacity filling | once per family with a real number | needs the contact; quota as a second guard |
| Cost | none | an email or text per attempt, only to contacts on file |
| Needs working | email | email, and text for phones |
| Extra work | none | code fields, two messages, one screen, tests |

B is close to signing in, so why not sign in? The handle belongs to one event, lasts 30 minutes, creates no account and no session on the phone, skips family matching, onboarding and the legal
steps, and shows only masked names. **Recommendation: B by default, with A (`open`) selectable per event only when the community's master allows it,** and the portal saying plainly what A shows to
anyone who types a number. The functions are written once around the handle, so this is a setting, not two builds.

## 6. Permissions, decisions and slices

### 6.1 What this touches (the owner approves before any build)

No existing RLS policy is loosened. The new functions run as the table owner for anonymous callers, so they bypass RLS by design and are protected only by their own checks. The change:
**people without a session can now cause writes to `rsvps` and `attendees`, and read a masked view of people and households.**

| Object | By the new functions | Change |
|---|---|---|
| `app.events`, `app.centers` (`rules`) | read | `contact_rsvp` column + trigger; rule `rsvp.contact_lookup` |
| `app.people`, `household_members`, `households`, `person_emails` | read (find, mask) | none |
| `app.rsvps`, `app.attendees` | insert, update status | new columns, `source` value `guest_contact`; no policy changed |
| `app.rsvp_contact_handles`, `app.rsvp_manage_links`, `app.public_rate_events` | read / write | two new locked tables |
| `app.messages`, `jobs`, `message_templates`, Vault (through `app.enqueue_notice`), `audit_log` | write | two new templates |
| Functions | 7 new anon-callable, 3 mask helpers | `rsvps_registered_email` skips the new source |
| Outside the database | worker `messaging.ts`; portal Settings › Rules and event builder; member app screens | |

Documents to update when built: `docs/ROLES.md`, `docs/ACCESS_LEVELS.md` (the RSVP line), `docs/ARCHITECTURE.md` (RPC list), `docs/SETTINGS_RULES.md`, `docs/HANDOVER_RECEIPT.md`.

### 6.2 Decisions for the owner (each with my recommendation)

1. **Design.** A (as asked), B (code first), or both selectable? *B by default, A selectable per event behind the community master.*
2. **Switches.** Community master and per-event switch, both off by default; master by `settings.manage`, event by `events.manage` or its lead. *Yes.*
3. **Scope.** Free events only, audience `public` or `members_and_guests`, never a donation or pledge. *Yes.*
4. **Masking.** Replace "M**AV" with "first and last letter at most, at least half hidden" (`M***v`); `n***@g***.com`; last 2 phone digits. *Yes.*
5. **Children and one-person families.** Children as "Child 1, Child 2" with "under 12", no name letters, no age; single-member households shown. *Yes.*
6. **No full name without a session.** The manage page, the email and every anonymous answer show masked names or counts only. *Yes.*
7. **The household card.** The founder rule says a household is never confirmed by name alone and shows its `household_card`; an anonymous screen cannot show its numbers, zone, gifts or
   balance. This flow confirms by an exact contact match and shows masked members; staff always see the full card. *Approve the exception.*
8. **Who can open a family.** Only an adult's phone or email, only one household; a child's number or a number on two households is refused. *Yes.*
9. **No email, no RSVP.** If no email is on file, or the confirmation cannot be queued, nothing is saved. *Yes.*
10. **Unverified RSVPs.** Quota 25% of capacity; verified by the emailed link or by staff; no automatic release. Alternative: release after 48 hours. *As stated.*
11. **Limits and text cost.** The numbers in 5.2 and a daily text cap per community. *As stated; changeable later in one place.*
12. **Where the manage page lives.** The member app (`/rsvp/<token>`, needs `%MEMBER_APP_URL%` in the worker) or a public portal page. *The app.*
13. **Left out of v1.** Naming extra guests, waitlisting, adding people later, and people on no record (the `guest_web` columns would serve a later plan). *Leave out.*
14. **Approve the permission change** in 6.1 and the documents it updates. *Required before slice 1 merges.*

### 6.3 Slices, in build order

| # | Slice | Contents | Size |
|---|---|---|---|
| 1 | **Database** (owner's OK in its PR) | mask functions, `contact_rsvp` + master rule + trigger, two tables, `rsvps` columns, limits, lookup / submit / undo / view / cancel in mode `open`, database tests | large |
| 2 | **Messaging** | templates `rsvp_contact_confirmation` and `rsvp_contact_code`, `%MEMBER_APP_URL%` mark, skip in `rsvps_registered_email`, worker and database tests | medium |
| 3 | **Code mode (B)** | verify function, attempts and lockout, email and text codes, tests | medium |
| 4 | **Portal** | Settings › Rules master switch, event builder switch with a plain explanation, RSVPs tab badge / filter / Mark verified, Family page label | medium |
| 5 | **App screens** | find, code, who is coming, saving, done, state machine, en / gu / hi strings, tests; types copied to connect-admin and connect-mobile | large |
| 6 | **Manage page** | `/rsvp/<token>` with tickets and cancel | medium |
| 7 | **Hardening and docs** | abuse tests, the log-settings check, document updates | small |

Slices 1 to 3 are one backend track; 4 and 5 can then run in parallel; 6 follows 5. Each is its own pull request with App checks green (and Database tests where `supabase/**` changes).

## 7. As built: 0822 and 0823 (slices 1 and 2)

Migrations `0822_rsvp_contact_core.sql` and `0823_rsvp_contact_submit.sql`, tests `supabase/tests/822_rsvp_contact_test.sql` and `tests/mask.test.ts`,
`src/lib/mask.ts` (the TypeScript twin of the masks), `worker/src/messaging.ts` (`%MEMBER_APP_URL%`), `.github/workflows/deploy.yml` (passes `MEMBER_APP_URL` to the
background service). The code mode (design B) is `0824`, described in section 8.

### 7.1 For the portal and app builders: the exact calls

Everything below is `supabase.schema('app').rpc(name, args)`. The five visitor functions work with no session (role `anon`, also `authenticated`); they answer
`{ok: true, ...}` or `{ok: false, code, message}` (`message` is a plain-English sentence; the app maps `code` to its own words in each language). They raise only for faults.
**Nothing returned is an id, a real name, a real phone or a real email.**

| Call | Arguments | Success | Codes when `ok` is false |
|---|---|---|---|
| `rsvp_contact_lookup` | `p_event uuid`, `p_contact text` (a phone number in any format, or an email) | `{ok, step: "choose", handle, expires_in: 1800, members: [{slot, label, kind: "adult"\|"child", under_12}], send_to: {email, phone}}` (`handle` is 32 characters; `send_to.email` and `.phone` are masked, `phone` may be null) | `bad_contact`, `not_found`, `ambiguous`, `already_rsvpd`, `no_email`, `cannot_send`, `full`, `closed`, `demo`, `unavailable`, `rate_limited` |
| `rsvp_contact_submit` | `p_handle text`, `p_slots int[]` (the `slot` numbers ticked, no repeats, at most 24), `p_assist int[]` default `{}` (slots that need help getting around; each must be ticked) | `{ok, status: "rsvpd", count, send_to: {email}, undo_until}` | `bad_selection`, `expired`, `used`, `already_rsvpd`, `full`, `quota`, `no_email`, `cannot_send`, `closed`, `demo`, `unavailable`, `rate_limited` |
| `rsvp_contact_undo` | `p_handle text` (the handle that saved it, within 15 minutes) | `{ok, status: "cancelled"}` | `expired`, `too_late`, `rate_limited` |
| `rsvp_contact_view` | `p_token text` (the emailed token, or for 30 minutes the handle that saved the RSVP) | `{ok, event: {name, starts_at, ends_at, venue}, status, can_cancel, people: [{slot, label, kind, status, checked_in, ticket}]}` (`ticket` is the code behind the QR, null once cancelled; opening it with the emailed token marks the RSVP verified) | `expired`, `rate_limited` |
| `rsvp_contact_cancel` | `p_token text` (the emailed token only) | `{ok, status: "cancelled"}` | `expired`, `closed`, `too_late`, `rate_limited` |
| `rsvp_contact_verify_staff` | `p_rsvp uuid`, `p_reason text` default null | `true` (signed-in staff: `events.manage` or the event's lead; raises "You don't have access to this area." otherwise) | raises |

The link in the email is `<MEMBER_APP_URL>/rsvp/<token>`: the member app's route `/rsvp/[token]` (outside the route guards, like `e/[id]`) calls `rsvp_contact_view` and
`rsvp_contact_cancel` with the `<token>`.

Reading what a guest can read (no call needed): `events.contact_rsvp` (`off` | `code` | `open`) is on the event row, which guests already read. Show the button only when it is
not `off`, the RSVP window is open (`rsvpBlockReason` is null) and the event is free; the functions refuse anything else.

Staff data (the portal): `rsvps.source = 'guest_contact'` is "made without signing in"; **unverified = `contact_verified_at is null`**; `contact_kind` is `phone` or `email`;
`contact_person_id` is the adult whose contact it matched. The switches: the community's `centers.rules.rsvp.contact_lookup` (`off` | `code` | `open`, `settings.manage`) and the
event's `events.contact_rsvp` (a trigger refuses a value above the community's, and any value on a paid or confidential event or one that is not open to the public or to members
and guests; it quietly goes back to `off` if the event later becomes one of those).

### 7.2 Where this differs from the plan above (and why)

- **Own counter table.** The limits count in `app.rsvp_contact_attempts`, not `app.public_rate_events`: that table is audited on every insert (a row in the hash-chained audit log per
  attempt), which would bury the log under anonymous traffic. The new table is not audited; purged after two days (by whoever calls next, not by the notices sweep).
- **The handles table is not audited** either (test 13 lists both tables as left out on purpose); the RSVP, its tickets and its emailed link are.
- **More codes than the plan listed:** `bad_contact` (not a phone or an email), `bad_selection`, `quota` (the unverified share is taken), `too_late`, and `closed` / `demo` / `unavailable` from the gate.
- **The handle also shows the RSVP.** `rsvp_contact_view` accepts the handle that saved the RSVP for 30 minutes (so "See my tickets" works straight away); it does not verify the RSVP and cannot cancel
  (only `undo`, 15 minutes). Only the emailed token verifies and cancels.
- **The lookup checks the family can be served before it shows it:** no second RSVP, an email on file, that email not suppressed, opted out, bounced or limited (3 confirmations a day). The visitor is told
  before ticking anything, and the save checks again inside its transaction.
- **A contact is matched on digits / lower-case email** (`app.normalize_recipient`: a bare 10-digit number is read as +1, as everywhere else in Weaver). A stored phone is compared on its digits.
- **Shared addresses.** Mobile carriers and venue Wi-Fi put many people behind one address; 10 lookups and 5 saves an hour per address can then stop a crowd. Those people can sign in. The numbers are one function,
  `app.rsvp_contact_limits()`. Someone can also use up a phone number's 3 lookups an hour (a small denial of service on that one contact; signing in still works).
- **Caps that do not depend on the address.** The address a request comes from can be forged by a caller who adds their own `x-forwarded-for`, so the per-address limits alone are weak. The counters are
  therefore also capped in all: 2,000 lookups, 500 saves and 3,000 views / cancels / undos an hour (and 3,000 code tries when the code mode is on), and a contact, an event and a community's daily code texts
  have their own caps. The address that is counted is `cf-connecting-ip` when the platform sets it (Cloudflare overwrites it, so it cannot be forged), else the first of `x-forwarded-for` as the audit log
  reads it. **Check on the hosted project that `cf-connecting-ip` reaches the database** (a request to any function with a `cf-connecting-ip` header set by the platform); if it does not, the per-address limits
  stay as weak as above.
- **Dates in the email are English** (`Monday, October 19, 2026`, `10:30 AM`); the wording is the community's language when it has written one (the standard text is English).

### 7.3 Rollback (0822 and 0823)

```sql
begin;
-- Keep the families' RSVPs; they become office-entered ones. Cancel confirmations that have not gone yet.
update app.rsvps set source = 'admin' where source = 'guest_contact';
update app.messages set status = 'cancelled', failure_reason = 'Not sent: RSVP without signing in was rolled back.'
 where status = 'queued' and template_key in ('rsvp_contact_confirmation', 'rsvp_contact_code');
drop function if exists app.rsvp_contact_lookup(uuid, text), app.rsvp_contact_submit(text, integer[], integer[]), app.rsvp_contact_undo(text),
  app.rsvp_contact_view(text), app.rsvp_contact_cancel(text), app.rsvp_contact_verify_staff(uuid, text);
drop function if exists app._rsvp_contact_resolve(text), app._rsvp_contact_cancel_rsvp(uuid, text), app._rsvp_contact_email_problem(uuid, uuid, text, text),
  app._rsvp_contact_recipient(uuid, uuid), app._rsvp_contact_family(uuid, date), app._rsvp_contact_find(uuid, text, text), app._rsvp_contact_gate(app.events),
  app._rsvp_contact_seats(uuid, boolean), app._rsvp_contact_fail(text), app._rsvp_contact_cleanup(), app._rsvp_contact_over(text, text, interval, integer),
  app._rsvp_contact_hit(text, text, integer), app._rsvp_contact_hash(text, text), app._rsvp_contact_pepper(), app._rsvp_contact_ip(), app.rsvp_contact_limits(),
  app._rsvp_contact_mode(text, uuid), app._rsvp_contact_master(uuid), app._rsvp_contact_rank(text);
drop function if exists app.mask_phone(text), app.mask_email(text), app.mask_name(text), app._mask_word(text), app._mask_marks();
drop trigger if exists events_contact_rsvp_guard on app.events;
drop function if exists app.events_contact_rsvp_guard();
drop table if exists app.rsvp_manage_links, app.rsvp_contact_handles, app.rsvp_contact_attempts;
delete from app.module_tables where table_name in ('rsvp_manage_links', 'rsvp_contact_handles', 'rsvp_contact_attempts');
alter table app.events drop constraint if exists events_contact_rsvp_check;
alter table app.events drop column if exists contact_rsvp;
drop index if exists app.rsvps_unverified_contact_idx;
alter table app.rsvps drop constraint if exists rsvps_contact_kind_check;
alter table app.rsvps drop column if exists contact_kind, drop column if exists contact_person_id, drop column if exists contact_verified_at;
alter table app.rsvps drop constraint if exists rsvps_source_check;
alter table app.rsvps add constraint rsvps_source_check check (source in ('app', 'guest_web', 'admin', 'walk_in', 'kiosk', 'import'));
delete from app.message_templates where center_id is null and key in ('rsvp_contact_confirmation', 'rsvp_contact_code');
-- 0770's trigger function, without the line that skips the new source:
create or replace function app.rsvps_registered_email() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $fn$
declare v_auto uuid;
begin
  if app._email_in_import() then return null; end if;
  if new.status not in ('rsvpd', 'confirmed') or new.source = 'import' then return null; end if;
  if tg_op = 'UPDATE' and old.status in ('rsvpd', 'confirmed') then return null; end if;
  v_auto := app._email_automation_on(new.center_id, 'registration_confirmed');
  if v_auto is null then return null; end if;
  begin
    perform app._email_compose_later(new.center_id, v_auto, new.id);
  exception when others then
    raise warning 'rsvps_registered_email: could not queue the registration email for RSVP %: %', new.id, sqlerrm;
  end;
  return null;
end $fn$;
delete from public.connect_schema_migrations where version in ('0822_rsvp_contact_core', '0823_rsvp_contact_submit');
commit;
-- Optional, in the Vault: the pepper (delete from vault.secrets where name = 'connect/rsvp_contact/pepper').
-- Then restore src/lib/database.types.ts in the three repositories from before this change.
```
Also remove the two lines of `tests/13_modules_audit_test.sql` that name the two unaudited tables, and delete `supabase/tests/822_rsvp_contact_test.sql`.

## 8. As built: 0824 (slice 3, the code mode, design B)

Migration `0824_rsvp_contact_code.sql`, test `supabase/tests/824_rsvp_contact_code_test.sql` (and test 822's section D, which now expects a code step).
An event set to `code` (or an `open` event in a community that allows only `code`) now works. Nothing about a family is told before the code.

### 8.1 The calls (what changes for the builders)

| Call | Arguments | Success | Codes when `ok` is false |
|---|---|---|---|
| `rsvp_contact_lookup` (changed) | as in 7.1 | for a `code` event, for **every** well-formed phone or email, found or not: `{ok, step: "code", handle, expires_in: 600}` (the code works for 10 minutes; the handle for 30). For an `open` event as before | as before, plus `use_email` (a phone number where texting is not set up or the community's 200 code texts a day are used up; it depends on the set-up, never on the contact). **Not** `not_found`, `ambiguous`, `already_rsvpd`, `no_email` or `cannot_send`: those come after the code |
| `rsvp_contact_verify` (new) | `p_handle text`, `p_code text` (6 digits) | the right code gives the same answer as the `open` lookup: `{ok, step: "choose", handle (the same), expires_in, members: [{slot, label, kind, under_12}], send_to: {email, phone}}`; asking again is harmless | `bad_code` (with `tries_left`), `locked`, `expired`, `rate_limited`; and, only after the right code: `ambiguous`, `already_rsvpd`, `no_email`, `cannot_send`, `full`, `closed`, `demo`, `unavailable` |
| `rsvp_contact_submit` | as in 7.1 | as in 7.1; a `code` handle must have had its code typed (else `expired`); the RSVP is **verified at once** (`contact_verified_at` set), so it does not count against the unverified share of the places | as in 7.1 |

The app's steps for a `code` event: lookup → code screen ("No code? Check the number, try your email, or sign in." never says whether the contact exists) → verify → the same "who is coming" screen → submit. A `use_email` answer
sends the visitor to the email tab. "Send a new code" is a new lookup (3 an hour per phone or email).

### 8.2 What is the same for everyone before the code, and what is not

The same answer, keys and shape for: a contact on a family record, an unknown one, a child's, one that opted out, one whose family already has an RSVP, a number on two households. A handle in every case (for a contact that
is not on an adult's record it points at nothing, `households_matched = 0`). A wrong code on a real handle, on a handle that points at nothing, on one that never existed and on garbage all answer `bad_code` with the same `tries_left`. The same
counters move for all of them. **What is not the same:** the time it takes (only a real contact queues a message). The limits (3 lookups an hour per contact, 10 per connection, 5 wrong codes then a 15-minute lock on the handle **and** the
contact, 30 code tries an hour per connection) keep that from being measured; nothing here hides it from someone who can make thousands of calls from many addresses.

### 8.3 Differences from the plan

- A code goes to a contact on an **adult**'s record even if its address opted out of email: it is a transaction (purpose `verification_code`), like a sign-in code. The RSVP's confirmation does follow the opt-out (`cannot_send` after the code).
- **Texting** needs a connected Twilio connection for the community (`integration_connections`, provider `twilio`, status `connected`), the same one the sender checks; the daily cap is 200 code texts per community (`app.rsvp_contact_limits`).
- A contact on **two households** gets a code; `ambiguous` is said after it was typed.
- Someone who can make a handle for a victim's phone or email can use up that contact's 5 wrong tries and lock it for 15 minutes (the same small denial of service as the lookup limit); signing in still works.
- Sandbox communities: a code that the sender refuses (a sandbox sends only to verified test recipients) is never told to the visitor, who simply gets no code.

### 8.4 Rollback (0824 only; run after, or instead of, the 7.3 block)

```sql
begin;
update app.events set contact_rsvp = 'off' where contact_rsvp = 'code';
update app.centers set rules = jsonb_set(rules, '{rsvp,contact_lookup}', '"off"') where rules #>> '{rsvp,contact_lookup}' = 'code';
update app.messages set status = 'cancelled', failure_reason = 'Not sent: the code mode was rolled back.' where status = 'queued' and template_key = 'rsvp_contact_code';
delete from app.rsvp_contact_handles where mode = 'code';
drop function if exists app.rsvp_contact_verify(text, text), app._rsvp_contact_code_step(app.events, text, text, text, text, text),
  app._rsvp_contact_family_answer(uuid, uuid, app.events, text), app._rsvp_contact_code_hash(text, uuid, text), app._rsvp_contact_new_code(), app._rsvp_contact_texting_on(uuid);
alter table app.rsvp_contact_handles drop constraint if exists rsvp_contact_handles_family_check;
alter table app.rsvp_contact_handles drop column if exists verified_at, drop column if exists code_hash, drop column if exists code_sent_at,
  drop column if exists code_expires_at, drop column if exists households_matched;
alter table app.rsvp_contact_handles alter column household_id set not null, alter column matched_person_id set not null;
delete from app.message_templates where center_id is null and key = 'rsvp_contact_code';
-- Then run again, from 0822 and 0823, the create-or-replace statements of app.rsvp_contact_limits, app._rsvp_contact_fail, app.rsvp_contact_lookup and app.rsvp_contact_submit.
delete from public.connect_schema_migrations where version = '0824_rsvp_contact_code';
commit;
```

## 9. As built: the portal (slice 4)

No migration and no change to who can do what: the portal only calls what 0822 to 0824 already allow, as the signed-in person (row level security and the database's own checks still decide).

| Where | What |
|---|---|
| Settings › Rules › Lunch and RSVP (`settings.manage`) | "RSVP without signing in": **Off**, **With a code**, **Without a code**, saved as `rsvp.contact_lookup`. Said in words: with a code shows the masked family only after a 6-digit code; without a code shows it straight after the phone number or email is typed. The JSON editor (Advanced) refuses any other value. |
| Event › RSVPs tab, side card "RSVP without signing in" | The event's own switch (`events.contact_rsvp`), for event managers and the event's lead (`eventAreas.edit`); everyone who can see the RSVPs sees where it stands. Only the choices the community allows can be picked. A paid, confidential or non-public event, or a community that has not allowed it, gets the reason in words and no control. The card explains the places held (25% of the places, at least 1, or 40 with no limit) and where the confirmation goes. |
| Event › RSVPs tab, list | **Unverified** / **Verified** badge on RSVPs made without signing in, a "How the RSVP was made" filter (Any way, Without signing in, Unverified), and **Mark verified** (`app.rsvp_contact_verify_staff(p_rsvp, p_reason)`, role checked again by the database, reason kept in the audit log). |
| Family page › Events | Lines made this way read "Without signing in", with an **Unverified** badge until the family opens the link in the confirmation email, types a code, or staff mark it verified. |

Errors are shown next to what the person did ("Could not change RSVP without signing in — ..."), with the technical detail logged on the server. Where the database turns an event's switch back off (the event stopped qualifying), the card says why instead of "Saved".

## 10. As built: the member app (slice 5, connect-mobile #113, 1.23.0)

No database change; it calls the functions of section 7.1 and 8.1 as the anon client (`src/lib/api/rsvp-contact.ts`, `src/features/rsvp-contact/`).

- **When the button shows.** A visitor who is not signed in (`!member`), on an event whose own `contact_rsvp` is `code` or `open`, while the RSVP window is open, on a free event open to the public or to members and guests. The event row is
  all a guest can read; **the community's switch is not readable by a guest**, so with the community switch off (or lowered) and an event still at `code` / `open` the button shows and the database answers `unavailable`
  ("RSVP without signing in is not available for this event. Please sign in to RSVP.") with a Sign in button. A trigger that lowers events when the community switch is lowered, or a guest-readable flag, would hide it earlier; either is a migration.
- **The steps** are those of section 2: find (Mobile number | Email; the phone is sent as `+1...`, the email lower-case), the 6-digit code for a `code` event (resend after 60 seconds, 3 at most), who is coming (everyone ticked, partly hidden names and contacts,
  "Needs help getting around" where the event's `attendee_flags` has `assistance`, the lunch note where the event has lunch, no donation or guest), saving, done (where the confirmation went, Undo for the database's 15 minutes), and a refusal for every code with its own
  sentence in the dictionary (`guestRsvp.err.*`); a code the app does not know says the database's own sentence.
- **What the app keeps:** the handle and the `slot` numbers, the partly hidden labels it was shown, the choices. The phone or email typed lives in screen state only. Logged: the refusal code, never a contact or a handle.
- **Signed-in members** see the same RSVP form as before (a test renders the real event screen as a guest and as a member). Gujarati and Hindi show the English strings until reviewed translations are added.

## 11. As built: the page behind the emailed link and See my tickets (slice 6, connect-mobile #114, 1.24.0)

- **`/rsvp/<token>`** (`src/app/rsvp/[token].tsx`, `src/features/rsvp-contact/manage.tsx`, `src/lib/api/rsvp-manage.ts`) calls `rsvp_contact_view` and `rsvp_contact_cancel`: the event, the status, the people with partly hidden names, a QR per person (the `ticket` code), "We can't make it"
  (asks "Cancel this RSVP for 3 people?"), and a sentence for `expired`, `rate_limited`, `closed` and `too_late`. A token that is not 32 letters, digits, - or _ is not sent. Opening the page with the emailed token marks the RSVP verified (the database does that).
- **It needs no community and no sign-in.** The root layout decides this path before the community choice, the sign-in guards and the app lock (`isRsvpLinkPath`), so a family opening the email on a phone where the app was never set up sees its tickets and not "Find your community".
  "Open the app" leaves it for the normal start.
- **See my tickets** on the "You are registered" card opens `/rsvp/<handle>?visit=1` for 29 minutes after saving (the handle works for 30): `rsvp_contact_view` accepts the visit's handle (section 7.2) but cancel needs the emailed token, so `visit=1` hides the
  cancel button and says where cancelling is.
- **Time zone.** `rsvp_contact_view` has no time zone, so the date and time are in the community's zone when one is open in the app, otherwise the device's. Adding `time_zone` to the function's `event` object would make it exact (a migration).

## 12. Hardening: the screen name in the audit trail, and what is still open (slice 7)

**The finding.** The member app sends the current route in `x-client-screen` with every request, and the database copies it into `audit_log.client_screen` on every audited write (`app.audit_row()`, migrations 0100 and 0102). Viewing the emailed
link verifies the RSVP, which is an audited write, so a page address of `/rsvp/<token>` would have put the secret token (it cancels the RSVP) into the audit log. Fixed in connect-mobile #114: the app sends `/rsvp/[token]` (`auditScreenName`, tested; seen at
runtime as `/rsvp/%5Btoken%5D`). The activity recorder of both apps already sends route patterns, never ids.

**Where else a secret is in an address (checked 2026-10-16). The one place found, the portal's `/invite/<token>`, is fixed in connect-crm #295 (`traceHeaders` records `/invite/[token]`; `clientScreen` and the `x-pathname` the 2FA redirect reads keep the real path):**

| Where | Route | Recorded? | Notes |
|---|---|---|---|
| Portal | `/invite/<token>` (staff invitation) | **Yes, once per accepted invitation, until #295.** The proxy and the server client send the pathname as `x-client-screen` (`src/lib/supabase/proxy.ts`, `server.ts`, `trace.ts` `clientScreen`); `app.accept_invitation` updates `staff_invitations` (trigger `audit_staff_invitations`), so `audit_log.client_screen` holds `/invite/<token>`. | The database stores only the token's SHA-256 hash, and an accepted invitation cannot be used again, so what the log holds is a used token. Unneeded there, so #295 records `/invite/[token]` (rows written before it keep the old value: the audit log is append-only). The browser client on that page also stamps the same header on its requests; those are not audited writes. |
| Member app | `/join/<code>` (community join code) | No. `community_by_join_code` is a read-only `stable` function (no audit row) and choosing a community is local. | A join code is shared on purpose (flyers, posters); it only finds a community. |
| Member app | `/e/<event id>`, `/event/<id>`, `/person/<id>`, record ids in general | Yes, on audited writes made from those screens. | A record id is not a secret (it is readable only through RLS) and the screen it came from is what the column is for. |
| Portal | `/ops/<event id>`, `/c/<slug>`, record ids | Same as above. | Not secrets. |
| Both | Provider return, OAuth callback, unsubscribe | No. | Their secrets are in the query string, which `pathname` leaves out (and the unsubscribe link is signed). |

**Still open (not built, with the reason):** bulk-cancel of unverified RSVPs in the portal (staff can cancel each; the unverified share of the places already caps the exposure); the community switch not being readable by guests (section 10); `time_zone` in the view (section 11);
the unreviewed Gujarati and Hindi strings; the shared-NAT caveat of the per-address limits (7.2) and the check that `cf-connecting-ip` reaches the database on the hosted project (7.2), which is a production check, not code.
