# DonorDelight: Donor care and Member care (plan)

**Renamed 2026-10-16 (owner):** this product was called WeCare; its name is **DonorDelight** (Marketplace card, website, docs; migration 0880). The label of the section
in the portal stays per kind (Donor care for non-profit and civic kinds, Member care for faith and community kinds). The module key `care`, the permission
keys `care.view`, `care.own` and `care.manage`, the roles, the tables and the `/care` address are unchanged. Earlier migrations and test descriptions
still say WeCare: applied files are never edited. The prototype folder keeps its date-stamped name.

Status: plan, 2026-10-13. Slices 1 (0750, 0757-0758) and 2 (0760-0763, in review) are built; the rest is plan. It merges B73 (donor playbooks) and B98 (giving insights: who to approach,
[`GIVING_INSIGHTS.md`](GIVING_INSIGHTS.md)) into one product, backlog **B102**. Built for every organization Weaver
onboards (temple, church, mosque, chamber, club, food bank, school; any faith or none; any language): behaviour comes
from the organization's kind, its own settings and its own records, never from code written for one community.

**Status 2026-10-17:** slices 1 to 8 are built (see section 12); slice 9 follows, slice 10 (price and billing) stays in the backlog.

**Priority (owner, 2026-10-13):** build slices 2 to 4 (care basics, thank-you tracker, engagement signs), the usable core; then Marketplace billing (MARKETPLACE_PLAN phases 2 and 3) before any further paid slice. Slices 5 to 10 wait.

## 1. In short

- **The problem.** Most organizations reach their donors when they need money: an appeal, a campaign, a gala. The
  relationship lives in one or two people's heads and leaves with them. Touches that a supporter would enjoy (a call
  with no ask, a photo of what their gift built, a greeting on their day) happen by luck, not by plan.
- **The product.** DonorDelight turns the organization's mission into a yearly care plan, gives every key household a
  relationship owner, records every touch, tracks thank-yous, shows plain engagement signs with their reasons, and
  hands each owner a short weekly list with a ready draft. The ask comes last, after the relationship is healthy.
- **What makes it different.** Donor tools see only money. Weaver also sees event check-ins, volunteering, messages
  opened, special days, interests, expertise and the best call time (People, #213 and #216), so most signs come from
  work the organization already does, with no extra typing.
- **Its biggest risk is that nobody uses it.** Every design choice below makes the weekly work small (3 to 5 touches,
  each with a reason and a draft, done in one tap) and shows the payoff (retention and thank-you speed moving).
- **Names.** One product, **DonorDelight**, shown as **Donor care** for non-profit and civic kinds and **Member care** for
  faith and community kinds; the label is data per kind (`app.category_modules`, like "Cash counts").

## 2. Owner decisions (2026-10-13)

| # | Decision |
|---|---|
| W1 | B73 and B98 merge into this plan; one product, one module. |
| W2 | **Proprietary data.** Only people in roles the organization gives DonorDelight access can see care data, and only roles that can also see amounts see amounts. **Nobody else**: not other staff, not members, not Weaver's platform admins. |
| W3 | DonorDelight is a **subscription product in the Marketplace** that an organization chooses to take. |
| W4 | Volunteers see what their role allows (W2); there is no separate "volunteers never see amounts" rule. |
| W5 | `giving_insights` keeps the numbers (B98 slices 1 and 2); people and relationships move to DonorDelight (section 4). |
| W6 | A narrower `care.own` level (only my own households) alongside `care.view`. |
| W7 | The thank-you tracker is part of DonorDelight; organizations without DonorDelight keep receipts as today. |
| W8 | Weaver support may open DonorDelight settings with a support grant, never care records. |

## 3. Who can see (W2, the proprietary rule)

**Today's gap (found 2026-10-13):** `app.has_permission` returns true for every platform admin in every community
([0400_owner_every_task.sql](../supabase/migrations/0400_owner_every_task.sql), line 22; also backlog B1). Reusing it
would let Weaver staff read every organization's care records. DonorDelight therefore gets its own check.

| Rule | How |
|---|---|
| Own access check | `app.care_can(center, level)`: the center owner, or an active role grant in that center whose role holds the DonorDelight key (or `*`, the organization's own admin roles). **No `is_platform_admin()` branch.** Every DonorDelight table's RLS and every DonorDelight function uses it. |
| Permission keys | `care.view` (all care records), `care.own` (only households where I am the relationship owner), `care.manage` (owners, playbooks, gesture library, care plan, settings). Given to roles by the organization, never by default. |
| Amounts | A gift amount, range or total appears in DonorDelight only if the person **also** holds `giving.view` (or `giving.manage`). Without it the screen says "thank them warmly", never a number. Enforced in the functions that return the rows, not only in the UI. |
| Platform admins | No read of care records, even with a support grant (`app.support_grants`). A support grant may open DonorDelight **settings** (to fix setup), never touches, notes, scores or lists. |
| Platform screens | `platform_community_summary` and every cross-community count leave DonorDelight out (at most "DonorDelight: on"). |
| Activity stream (0620) | DonorDelight actions record an action key only, no entity id, and are never in the share-with-Weaver set. |
| AI | Needs **iWeaver** (module `ai`, [`MARKETPLACE_PACKS.md`](MARKETPLACE_PACKS.md)) as well as DonorDelight, and the organization's own tick; it runs on Weaver's platform AI keys (no community has its own key today); drafts only, a person sends; nothing about anyone under 18; nothing kept by Weaver for training or across organizations (section 8). |
| Export | Only `care.manage`, step-up 2FA, audited. The organization can export everything it holds at any time, including after it cancels. |
| Audit | Every list view, export, owner change and settings change writes an audit row (who, when, what, row count; no names). |
| Members | A member sees only their own care preferences (section 5, slice 9): never notes, signs, owners or lists. |
| Children | No one under 18 in a list, a sign, a reason, an export or a prompt (D2; `GIVING_INSIGHTS.md` section 5.1 rules carry over). |

Honest limit: people who run Weaver's database (service role, backups) can technically read any table. W2 is
enforced by policy, audit and process, not by encryption. Encrypting care notes with a per-organization key is a
later option; it costs search and AI drafting, so it is not in v1.
A platform admin cannot give their own Weaver account a role or ownership, but could act through a second account they
control (for example one the organization was led to invite as an administrator): that is detected, not prevented, by
the audit log and the owner's emails for every administrator grant and ownership change Weaver's team makes.

**Built (2026-10-13, migrations 0757 and 0758, test 163):** `app.org_private_can`, `app.care_can`, `app.care_amounts_can`,
the three keys and the roles `care_lead` and `relationship_owner` (given only by the owner or a `care.manage` holder; each
grant audited and the owner emailed), the `care.settings` support area (`app.care_settings_can`), read logging
(`app.log_private_read`), the masked audit trigger (`app.audit_private_row`) and the audit-log rule. The contract every care
table follows is in the 0757 header and [`ROLES.md`](ROLES.md).

**Built (slice 2, migrations 0760-0763, tests 164-165):** `app.care_owners` (owner and backup, `app.set_care_owner`,
care.manage only; "needs an owner" worked out on read), `app.care_profiles` (thanks, recognition, channel, one of the
community's own languages, the adult to reach first, do not ask with rest-until), `app.care_notes` (archived, never
deleted) and `app.care_touches` (kind, channel, outcome, ask or no ask; voided, never deleted). `app.care_household_can`:
care.view and care.manage see every household, care.own the households they own or back up; whoever sees a household's
record writes its touches, notes and profile (owner decision 2026-10-13). Reads only through `app.care_household_card`,
`app.care_households` and `app.care_household_touches`, each logged; the touches Weaver already knows (messages,
receipts, statements, check-ins, volunteer shifts) are read live, adults only, receipt amounts only with
`app.care_amounts_can`; People fields are read where they live and only with people.view. Portal: the Care card on the
Family page and the DonorDelight area (`/care`), neither recorded in the activity stream. No export, no AI. Care records never
disappear with a household or a person: deleting either is refused in plain words (an import undo too), and merging two
households moves notes and touches to the survivor (its profile and owner win; the merged one fills blanks). The touch
log counts only community messages (`app.care_message_kinds`: campaign kinds and topics as data, never learning or
account messages) and each former member only for the time they lived in the household. The Marketplace card
stays "Not built yet" until a separate catalog change (0764) after a sandbox check: that change emails the communities that
asked to be told.

## 4. Product and module

- **Module key `care`** (a neutral key; the label is DonorDelight, [`MARKETPLACE_PACKS.md`](MARKETPLACE_PACKS.md) P6), depends on **People** only. It reads Giving when Giving is on (amount signs, thank-you
  tracker, who to approach); without Giving it still runs member care (welcome visits, care moments, involvement).
- **Off until granted.** `category_modules.availability = default_off` for every kind; a platform admin grants it per
  community through the module grants of 0740 (reason, fresh 2FA, audit); the organization's admin may pause it.
- **Subscription.** Marketplace phases 2 and 3 (prices, billing) are not built ([`MARKETPLACE_PLAN.md`](MARKETPLACE_PLAN.md)).
  Until they are, DonorDelight shows on the Marketplace card as **Request**: the organization asks, the Weaver team grants by
  hand. No price is set in this plan (the owner decides; nothing about pricing is promised).
- **Lapse.** A lapsed subscription makes DonorDelight read-only for 30 days, then hidden. Data is never deleted and stays
  exportable (Marketplace M9).
- **Split with `giving_insights`.** That add-on keeps the plain numbers of `GIVING_INSIGHTS.md` slices 1 and 2
  (Giving > Insights by category and year, a household's own giving story; read-only, existing giving permissions).
  Everything about people and relationships moves here: slices 3 to 7 (safety data, who to approach, next best ask,
  ask history, milestones, peer networks). Matching-gift flags move to **CatchTheMatch**
  ([`CATCH_THE_MATCH.md`](CATCH_THE_MATCH.md)); when both products are on, a DonorDelight playbook step can prompt a
  donor whose gift may be matched.

## 5. Building blocks

1. **Care profile** (per household, adults only): how they like to be thanked (in person, call, card, message,
   none), recognition (public, private only, anonymous: some traditions give in secret), preferred channel and
   language, do-not-ask with a rest-until date, care notes. Reuses People fields rather than copying them (interests,
   expertise areas, best call time, anniversary, dietary needs, special days, consents). DonorDelight-only fields live in
   DonorDelight tables so W2 applies to them; the People fields keep their own visibility.
2. **Relationship owner**: one person per household (staff or volunteer with `care.own` or more), with a backup.
   When an owner leaves or loses the role, their households show as "needs an owner" and the history hands over
   intact: this is what fixes "the relationship leaves with the person".
3. **Touch log**: every touch with kind, channel, who, when, outcome and an optional note. Manual touches take one tap
   ("Called, no answer", "Card sent", "Visited"). Touches Weaver already knows are read from their own tables, not
   copied: messages sent and opened, receipts, statements, event check-ins, volunteer shifts. Each touch is marked
   **ask** or **no ask**.
4. **Thank-you tracker**: every gift opens a "thank" step due within the organization's window (default 2 days). It
   closes when a thank-you touch is logged. Today shows what is unthanked. Larger or first gifts can require a
   personal touch (call or card), not only the receipt.
5. **Engagement signs** (section 6): each household's health with its reasons, and the organization's dashboard.
6. **Playbooks** (was B73): a set of timed steps for a kind of household (first gift, new family, steady, cooling,
   lapsed, monthly giver, volunteers who don't give, givers who don't take part, pledge falling due: remind, never
   ask). Each step becomes a task for the owner with a ready template and a recorded outcome. Starter playbooks per
   kind are data; the organization edits them.
7. **Gesture library**: things to do for a supporter, never paired with an ask. Each gesture has a cost (free, low),
   an effort, who should do it (leader, staff, volunteer) and which care profiles it suits. Starter set per kind, for
   example: a thank-you call with no ask, a handwritten card, a short video from a leader, a photo of what their gift
   built, asking their advice (expertise), a greeting on their special day, a quiet behind-the-scenes visit, a
   welcome visit for a new family, a small token tied to the mission (a book, a calendar, a blessed item, a seedling),
   recognition only if they opted in, and a care moment only if the family shared it and agreed.
8. **Your 5 this week**: each owner gets 3 to 5 tasks (a playbook step, a thank-you, a gesture), each with why, a
   draft and one-tap done. Shown on Today, in the weekly notification and later in the mobile staff view.
9. **Care plan from the mission**: the organization's agent drafts a yearly calendar from the mission, programmes and
   calendar (festivals and holy days, fiscal year end, Giving Tuesday for secular kinds, quiet periods), saying which
   touches each group gets and when. An admin edits and approves; nothing runs unapproved.
10. **Who to approach** (was B98 slices 3 to 7): ranked lists with reasons, ask history, ask fatigue and rest periods,
    ask ranges from a household's own history. **Held behind the touch balance**: a household is suggested for an ask
    only after enough no-ask touches since the last ask (default 3, editable).

## 6. Engagement signs

No AI and no black box: arithmetic and wording templates; every sign shows its reasons. A sign that needs history
says "not enough history yet" until the organization has about 12 months of records in Weaver.

| Level | Sign | From |
|---|---|---|
| Household | Giving recency, frequency and trend (up, steady, down) | payments, allocations, pledges (needs `giving.view` to see amounts) |
| Household | Taking part: events, volunteering, messages opened (yes or no and counts, adults only) | attendees, volunteer_assignments, messages |
| Household | Days since the last personal touch; unthanked gifts | touch log, thank-you tracker |
| Household | Touch balance: no-ask touches per ask in the last 12 months (aim 3 or more) | touch log, appeals |
| Household | Health: Thriving, Steady, Cooling, At risk, Lapsed, each with its reasons | the above |
| Organization | Retention and first-year retention, last year but not this year, some year but not this year | payments |
| Organization | Thank-you speed (median hours to thanks; share within 48 hours) | thank-you tracker |
| Organization | Touches per ask; share of key households with an owner; weekly task completion | touch log, owners, tasks |

The pseudonymous activity stream (0620) is never used for signs: it cannot and must not identify a person.

## 7. Respect

The privacy rules of `GIVING_INSIGHTS.md` section 5 carry over unchanged: no one under 18; opt-outs honoured;
quiet periods as data (a fast, a mourning period, a season) that hold asks and gestures that would jar; the score
never uses religion, caste, ethnicity, language, gender, age, health, income, property, photos, anything about a
child or anything from outside the organization's own records; **no outside wealth screening**. Added here: an
anonymous giver gets private thanks only; a care moment (illness, bereavement) becomes a "reach out with care" task,
never an ask.

## 8. Niva and the organization's agent

DonorDelight is a first job for the per-organization agent (the owner's direction of 2026-10-11, see
[`ONBOARDING_INTERVIEW.md`](ONBOARDING_INTERVIEW.md)): it learns
the mission at onboarding and the people through DonorDelight. Commands only, with the asking person's own rights (W2
applies to Niva exactly as to a screen): `care.my_week`, `care.household_brief` (what to know before you call),
`care.draft_note` (a personal note from the mission, the household's history and their preferences),
`care.log_touch` (a dictated note becomes a touch the person confirms), `care.draft_care_plan`. Needs iWeaver
(module `ai`) as well as DonorDelight. Off until the
organization ticks it; at most 10 households per answer; never sends anything; never the reason a household is
excluded; nothing about anyone under 18 goes to the AI provider.

## 9. Build order

Each slice ships on its own. S is under about 500 lines with tests, M up to about 1,500, L more. Pure logic first
(`src/lib/care/`, plain functions with fixtures for a church, a chamber, a temple and a food bank), screens after.
Migration and test numbers are reserved when a slice is approved, not here. Rollout: a sandbox community first, then
any community that takes DonorDelight.

| Slice | What | Size | Owner OK |
|---|---|---|---|
| 1 | Module `care` (default off, grant-only, Marketplace "Request" card), labels per kind, permission keys, `app.care_can` without the platform-admin branch, Setup step | M | **Yes: permissions/RLS** |
| 2 | Care profile, relationship owners, touch log, care notes; a Care card on the Family page | L | **Yes: RLS, sensitive data** |
| 3 | Thank-you tracker and Today; thank-you speed | M | No new rule (reads payments inside slice 1 access) |
| 4 | Engagement signs: household health with reasons; organization dashboard | M | No |
| 5 | Playbooks (B73) and Your 5 this week (Today + weekly notification) | L | **Yes: messaging** |
| 6 | Gesture library (starter sets per kind as data; organization edits) | S to M | No |
| 7 | Who to approach (B98 slices 3 to 7), gated by touch balance | L | **Yes: already flagged in B98** |
| 8 | Niva commands and the care plan from the mission | L | Niva access tick per organization |
| 9 | Member app: "How would you like to be thanked?" (their own preferences only); mobile release + OTA | S | No |
| 10 | Subscription: price and billing once Marketplace phases 2 and 3 exist | M | **Yes: money, pricing** |

Slices 1 and 2 first: without the access check and the touch log there is nothing safe to show and nothing to learn
from. Slice 7 never lands before slices 2 and 3.

## 10. How we will know it works

Measured per organization, inside that organization only: first-year retention after 12 months against its own
earlier year; at least 80% of gifts thanked within the window; 3 or more no-ask touches per ask; at least 60% of
weekly tasks done. These are targets to measure, not promises to make to anyone.

## 11. Owner answers (2026-10-13: every recommendation approved, recorded as W5 to W8)

1. **The `giving_insights` split** (section 4): numbers stay in the Giving add-on, people and relationships move to
   DonorDelight. **Approved**; it leaves the Insights slice in progress (S10b) unchanged.
2. **`care.own`**: a narrower level so an organization can give a volunteer only their own households.
   **Approved**, alongside `care.view`.
3. **Thank-you tracker inside DonorDelight** (paid), while organizations without DonorDelight keep receipts as today.
   **Approved.**
4. **Weaver support** may open DonorDelight settings with a support grant, never care records. **Approved.**

## 12. Slices 3 and 4: plan awaiting the owner (2026-10-13)

Slice 2 shipped as crm #245 (0760-0763, tests 164-165). Slices 3 and 4 are planned, not approved: the owner asked to see
the prototypes first (`docs/handoff/prototypes/wecare-catchthematch-2026-10/`). Numbers: slice 3 = migrations 0800-0802,
test 190; slice 4 = 0803-0805, test 191 (the earlier 0769-0774 collided with other work).

**Slice 3, thank-you tracker.** `care_settings` (thank window 2 days; a first gift needs a personal touch; an optional
amount from which a gift needs one, integer cents; fees and memberships off; thanks start the day the rules are first
saved, with an optional "include the last 30 days"); `care_thanks`, one step per gift, opened by an idempotent sync the
reads run (no trigger on payments: the money path is untouched); gifts found with 0749's rule (completed donations,
after refunds, no opening balances or history imports); a receipt or any thank-you touch closes an ordinary step, a
personal step needs a call, visit, card or video; voiding that touch reopens it; reads `care_thanks_queue`,
`care_thanks_summary` (median hours, share within the window); without amounts the screens say "Thank them warmly".
Portal: the Care card, /care, a Home task source and a Giving Today group for care holders only, Settings > DonorDelight
(which also opens the W8 support area).

**Slice 4, engagement signs.** `care_health_facts` per household (gifts in the last 12 months and the 12 before, taking
part, last personal touch, touches per ask, unthanked gifts; adults only; every read logged); `care_dashboard` (care.view:
kept, lost, first-year retention, last year but not this, some year but not this, thank-you speed, touches per ask, key
households with an owner); `src/lib/care/health.ts`: Lapsed (no gift or taking part in 18 months), At risk (gave the
year before, not the last 12 months), Cooling (fewer gifts, or nothing for 6 months), Thriving (steady giving, takes
part, 3 or more no-ask touches per ask), Steady (the rest); "Not enough history yet" under about 12 months; wording
templates, no amounts, no AI.

**Built (slice 3, 2026-10-16, migrations 0881-0883, test 881; the numbers 0800-0802 above were taken by other work):** `app.care_settings` and
`app.care_settings_get` / `app.save_care_settings` (a manager, or support with the care.settings area: W8); `app.care_thanks` (one step per gift: the
payment, its day, the due day, personal or not, set aside with a reason; no amount and no household, both read from the payment so a merge carries it);
`app._care_gifts` (0749's rule: payments that went through, less refunds, never opening balances or history imports, never a payer under 18, fees only when
the rules say so); `app._care_thanks_sync` (idempotent, run by the reads, no trigger on payments); `app._care_thanked` (closing is READ from the receipt sent and
the thank-you touches, never stored: voiding the touch opens the step again); `app.set_aside_care_thank` / `app.reopen_care_thank`; reads
`app.care_thanks_queue`, `care_thanks_summary`, `care_household_thanks` (each logged) and `care_thanks_counts` (three numbers for Home, no names, not
logged). Portal: Thank-yous (`/care/thanks`) with the counts, the on-time share and the median time, the one-tap ways to thank, "No thanks needed"; Thank-you
rules (`/care/settings`); "Thank-yous waiting" on the Care card; a Home task row "N gifts to thank".

How the recommendations above were taken, until the owner says otherwise: a recurring gift is thanked once (recorded payments carry no link to the recurring
gift that made them, so a repeat is recognised as the same amount from a household with a recurring gift within 45 days of the one before); a receipt closes
an ordinary step; thank-yous start from the first save, with the option to include the last 30 days; a first gift is judged against every earlier gift, also
one from before the rules began; relationship owners see gift dates and counts, never amounts. **Not in slice 3:** the Giving Today group (the Home row is
there; Today's own group is a later change).

**Built (slice 4, 2026-10-16, migrations 0884-0885, test 884):** `app.care_health_facts(center, households)` (up to 100 households the caller may see:
gifts in the last 12 months and the 12 before by 0882's rule, first and last gift day, adults who checked in or served, messages an adult opened, personal
touches that went well with how many were asks, last touch, open thank-you steps; counts and dates only, **no amount**, so no giving role is needed beyond the
care key; asking for a household the caller may not see refuses the whole call; logged) and `app.care_dashboard(center)` (care.view and care.manage; counts
only: households that gave in each window, kept, last year but not this, some year but not this, retention, the first-year group kept, thank-you speed of the
last 90 days, no-ask touches per ask, key households with an owner; logged). `app._care_history_months` says how many months of records Weaver holds.
Portal: `src/lib/care/health.ts` turns the facts into a level and its reasons in words (arithmetic and templates: no score, no AI, no amounts); the level shows as
a **Sign** column on the Households list and as "How the relationship is going" on the Care card, with every reason; **Dashboard** (`/care/dashboard`, a new tab for
care.view and care.manage; a relationship owner sees households, not the totals). Rules as built: Lapsed = nothing on record (a gift, an event, a shift) for
18 months; At risk = gave the year before, not in the last 12 months; Cooling = fewer gifts than the year before, or no gift for 6 months; Thriving = as many
gifts as the year before, took part, and 3 or more no-ask touches for every ask; Steady = the rest; No activity yet = nothing on record. Under about 11 months of
records every household reads "Not enough history yet", and the dashboard shows "Not enough yet" for any number that compares two years until Weaver holds
about 23 months. Without Giving the gift rules are left out. The Today group for the weakest signs is below (Today groups).

**Built (Today groups, 2026-10-17, migration 0890, test 890):** `app.care_signs_watch(center, limit)` is the shortlist (at most 100, the portal asks for 50) of
households the caller may see that gave in the last 24 months and either gave nothing in the last 12, gave fewer times than the year before, or have not given for six months;
at risk first, then the longest quiet. It is deliberately a little wider than the sign rules, because `src/lib/care/health.ts` is the one place that decides a level and its
reasons: the portal asks `care_health_facts` for the shortlist and `src/lib/care/watch.ts` keeps only Cooling and At risk. No amount is read, each household comes as its
household card (adults only) with its relationship owner, every read is logged, and Giving off answers `giving_off`. Portal: a **Care group** on Giving > Today (the kind's word, Donor care or
Member care), drawn only for whoever holds a care key (relationship owners see only their own households): a row "N gifts to thank" (the three numbers of `care_thanks_counts`), then up to five
households with their sign and every reason, then one "more" row pointing at `/care`. Each button opens the Care card or the list; nothing asks anyone for money. A read that fails
shows as a problem next to the group, never an empty group. Home keeps its thank-you task row; the weak signs are on Today only (reading them costs a facts call per load).

**Built (slice 5, playbooks and "Your 5 this week", 2026-10-17, migrations 0891-0893, tests 891-893, worker job `care.week_sweep`):**
`app.care_playbooks` / `care_playbook_steps` (a trigger, a window, a cooldown, 1 to 12 steps: days after entering, title, why, kind, channel, a draft with `{{name}}`, `{{me}}`
and `{{org}}`) edited only by care.manage; a step is a touch to record and **has no ask** (a step cannot carry one; a care moment is never planned; the pledge reminder
reminds and never asks for more); a removed step is archived, never deleted. `app.care_starters` holds the starter playbooks as data per kind of organization (faith: "Member
care" wording, civic: "Donor care" wording; ten each: first gift, new household, steady, cooling, at risk, lapsed, volunteer who does not give, giver who does not take part,
pledge falling due, monthly giver; no starter names a community, a religion or a language), picked from the category's `faith_based` and copied once into the community's own
playbooks by `app.install_care_starters` (idempotent). `app.care_runs` is a household's time in a playbook, opened by `app._care_runs_sync` (at most once a day per community and
when a playbook changes; no trigger on payments or households); `app._care_trigger_rows` decides who is in which trigger with the SAME arithmetic as `care_health_facts` and
`health.ts` (the test pins the same worked cases; nothing before about a year of records), adults only; a sign-based run **stops when the sign stops** (the household gave
again), so nobody calls to say "we miss you" after a gift. `app.care_week` gives the caller's own list (the households they own or back up): open thank-yous first, then steps overdue
(a step more than 21 days late is not offered again), then what falls due in 7 days; the top five with the true total; a household that asked for no thanks gets no thank-you task;
a manager also hears of households with a task and no owner. `app.complete_care_task` is the one tap: it records the step's touch (no ask) through `log_care_touch` and marks the task;
`skip_care_task` needs a reason (kept). Reads are logged. Portal: **Your week** (`/care/week`, a tab; a task per card with why, the filled draft and a Copy button, "Done · <how>",
"Add a note or change how", "Set aside"; a thank-you task shows the tracker's own ways to thank), **Playbooks** (`/care/playbooks`, a tab; everyone with a care key reads, care.manage adds the
starters, edits in a form that checks the database's own rules in its own words, pauses and resumes), a Home task row "Your week: N care tasks" and the same row in the Care group on Giving > Today.
**The weekly reminder** (migration 0893): care.manage switches it on (off by default) and picks the weekday; the worker job `care.week_sweep` (hourly) calls `app.worker_care_week_sweep`: from that
weekday at 08:00 local time (and for two days after, in case the service was down) each person with at least one task gets ONE email through `app.enqueue_message` (template `care_week`, purpose
`notification`): a number and the section's name, never a household, a name or a step. A sandbox that may message only verified recipients is refused WITH the reason in `app.care_week_log`
(shown, never hidden); a person with no email address is logged as such; nobody is told twice in a week. **The email provider is not configured yet (backlog B116), so nothing can actually be
sent today**; the path is built and tested to the queue, and it goes out when the provider is connected. Owner decisions to confirm: who may be told (every owner or backup with a task), the
wording of the starters, the weekday default (Monday), and that the reminder holds a number only.

**Built (slice 6, the gesture library, 2026-10-17, migration 0894, test 894):** `app.care_gestures` is the community's own library of things to do FOR a supporter, each with a cost
(free or low), an effort (a few minutes, under an hour, half a day or more), who should do it (a leader, staff, a volunteer, anyone), the care profiles it suits (how they like to be
thanked, how they like to be recognised; empty = any), what the household's own records must hold (a special day, an anniversary, expertise, interests: read from People, never copied, and
never anything from outside the organization), whether it is offered on its own (a care moment never is: a person chooses it, and only when the family shared it and agreed), the touch it
records and a draft. **A gesture is never paired with an ask:** there is no ask field (an unknown field is refused with that sentence), the touch it records is always "no ask", and a
gesture whose name, description or draft asks for a gift, a donation or a pledge cannot be saved (`app._care_words_ask` in the database and `wordsAsk` in the portal use the same list; a
plain check on words that cannot catch every phrasing, which is why the touch is always no ask). `app.care_gesture_starters` holds the starter set per kind of organization as data (thirteen
each, faith and civic wording: a thank-you call with no ask, a handwritten card, a short video from a leader, a photo of what their gift built, ask for their advice, a greeting on their special
day, an anniversary greeting, a quiet behind-the-scenes visit, a welcome visit, a small token tied to the mission, share something about their interest, recognition only if they chose it, a care
moment); `install_care_gestures` copies the ones a community lacks (idempotent), `save_care_gesture` and `set_care_gesture_enabled` are care.manage only; everyone with a care key reads the
library; the audit holds who and when and which columns, never the words. Portal: **Gestures** (`/care/gestures`, a tab; filter by who should do it; a manager adds the starters, edits, pauses),
and **Ideas for this household** on the Care card: the gestures that suit it, best first (how they like to be thanked, a special day or an expertise on file, recognition only if they chose it; none
of the thank-you kind for a household that asked for no thanks), each with why, a draft filled with the adult to reach and the organization (Copy), and one tap "I did this" that records the touch
with no ask. Nothing is sent. Not built: tying a gesture to a playbook step, and gesture ideas in Your week.

**Built (slice 7, who to approach, 2026-10-17, migration 0895, test 895; the doc's B98 slices 3 to 7 folded into DonorDelight's own keys, so the proposed `giving.approach` permission is not needed):**
a ranked list of the households an organization could ask, each with its reasons, **held behind the touch balance**. It is **off until a care manager has read what it uses and never uses** and turns it on
(`app.care_approach_settings.enabled`; the screen lists both). A household is READY only when nothing holds it; otherwise it is HELD, with the reason in words, in this order: **pledge** (behind by more than 60
days: remind, do not ask), **thank** (a gift not thanked yet: thank first), **rest** (asked within the rest period, default 60 days, editable, 0 = none: **ask fatigue**), **balance** (fewer touches with no ask than the
touch balance since the last ask, default 3, editable 1 to 10; never asked: the no-ask touches of the last 12 months) and **quiet** (inside a quiet period). A household with **do-not-ask** (with or without a
rest-until date, from the Care profile) is **counted, never named or explained** ("N households are not shown"); a household that never gave is invited, not asked, so it is not a candidate. The score is additive
and visible: the same function returns the score and its signals, so the explanation cannot disagree with the number (years of the last five with a gift, how recent the last gift is, taking part in the last 12
months, all gifts thanked; the points are the organization's to change, 0 to 50, years up to 100). A **range** is the median and the highest of the household's OWN gifts of the last five years (to the chosen fund,
when one is chosen), only with three or more gifts and only for someone who also holds `giving.view`/`giving.manage` (`care_amounts_can`); rounded outwards ($10 steps, $50 above $1,000), never one number. Quiet
periods (`app.care_quiet_periods`) are data: a name, from and to, optionally every year (it may cross the new year); archived, never deleted. A relationship owner (care.own) sees only the households they own; care.view
and care.manage see every household; platform admins and everyone else see nothing; every read is logged without names. No religion, tradition, caste, ethnicity, language, gender, age, health, income, property or
occupation, no photo, nothing about anyone under 18 (the cards list adults only and a minor payer's gift never counts), and **no outside wealth screening** (a test pins that there is no such weight). Nothing is sent
or asked: it orders a list for a person to read. Portal: **Who to approach** (`/care/approach`, a tab): Ready and Held with the reasons, a fund filter, the settings (touch balance, rest, weights), the quiet periods and
the plain page on what it uses and never uses; and an **Asking** block on the Care card (ready, "Not yet" with every reason, or "Do not ask"). Not built (still in B98): per-fund "can be asked for" switches, saved lists,
an export, the next-best-ask category card, upgrade and recurring-gift lists, peer networks and milestone prompts; a draft appeal goes through slice 8's note drafting once that is on.

**Built (slice 8, Niva and the care plan, 2026-10-17, migration 0896, test 896, tests/commands/care-commands.test.ts):**
**Niva.** Five commands in the existing command layer (`src/lib/commands/catalog/care`), all for **Niva's chat only** (`assistantOnly`: the screens and the palette have their own pages), all needing **iWeaver (module `ai`) AND DonorDelight (module `care`)
AND the organization's own tick** (`app.care_niva_settings`, off by default, set by care.manage on the Playbooks page; the commands also check it when they run and say in words which of the three is missing). They run with the
asking person's own rights: they call the same database functions as the screens, as the signed-in person, so a platform admin or a role without a care key is refused exactly as on a screen (W2); a relationship owner (care.own) gets the
reads and drafts about their own households. `care.my_week` (read: the person's own week, up to five tasks, each with why and a draft with the names filled), `care.household_brief` (read: what to know before you call: the card, owner,
preferences, interests and expertise on file, the sign and its reasons, thank-yous waiting, whether it is time to ask, the last touches), `care.draft_note` (draft: the material for one personal note: who to write to, the way and
language, the mission in a line, starting drafts from the gesture library and playbooks, and the rules for this note), `care.log_touch` (confirm: a dictated note becomes a touch, a person confirms the card first, off for Niva until
the platform ticks it like every confirm command; a care moment is never an ask) and `care.draft_care_plan` (draft; care.manage: the material for the plan and a first draft). **What a model is given:** at most ten households, no amount, no
free-text note (only the count of notes), never the reason a household is not to be asked ("Do not ask", nothing more), nothing about anyone under 18 (the cards list adults only and the child filter checks the answer again). **They draft;
a person sends:** nothing is sent or saved. DonorDelight's commands are **not recorded in the activity stream at all** (`commandActivityKey` returns nothing for `care.*`): the community's agreement to share that stream with Weaver is one
switch for every key and cannot leave these out. Two additive fields on the command type: `alsoModules` (further modules that must be on, with iWeaver's one sentence) and `assistantOnly`.
**The care plan from the mission.** `app.care_plans`: one plan per community and year, status draft or approved, a summary and up to 60 moments (a day, a title, a group of households, a kind of touch, a note). `src/lib/care/plan.ts`
drafts it from what the organization has (plain arithmetic and wording, no model): its mission, its own calendar entries (a greeting a few days before each), its fiscal year (thank every household before it closes, share what
the year made possible), its quiet periods (named, and a moment inside one says asks wait), and its groups of households (a group with no households is left out); a civic organization gets the day of giving, which
thanks before it asks. A care manager saves the draft, edits every moment and approves it; **an edit returns an approved plan to draft; nothing in a plan runs by itself**; no moment asks for money (the same word check as a
gesture, in the database and the portal). Portal: **Care plan** (`/care/plan`, a tab: year chips, the status, what is coming up in 30 days, the moments by month; managers draft, edit and approve) and the **Niva** card on Playbooks.
Not built: tasks created from an approved plan's moments (the plan is a calendar for the team to follow today), and the Niva command for saving the plan (a care manager does it on the screen).

**Recommendations put to the owner (not yet answered):** thank only the first gift of a recurring series; key
households = a gift in the last 24 months or a care profile (every member household when Giving is off); a receipt
closes an ordinary step; start from the first save with "include the last 30 days"; relationship owners see gift dates
and counts, never amounts; the defaults and thresholds above.

**Owner decisions made while building slice 2:** partly refunded payments count as receipt touches (the remaining
amount shows to those who may see amounts); do-not-ask survives a household merge if either household asked.
