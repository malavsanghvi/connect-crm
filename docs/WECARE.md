# WeCare: Donor care and Member care (plan)

Status: plan, 2026-10-13, nothing built. It merges B73 (donor playbooks) and B98 (giving insights: who to approach,
[`GIVING_INSIGHTS.md`](GIVING_INSIGHTS.md)) into one product, backlog **B102**. Built for every organization Weaver
onboards (temple, church, mosque, chamber, club, food bank, school; any faith or none; any language): behaviour comes
from the organization's kind, its own settings and its own records, never from code written for one community.

## 1. In short

- **The problem.** Most organizations reach their donors when they need money: an appeal, a campaign, a gala. The
  relationship lives in one or two people's heads and leaves with them. Touches that a supporter would enjoy (a call
  with no ask, a photo of what their gift built, a greeting on their day) happen by luck, not by plan.
- **The product.** WeCare turns the organization's mission into a yearly care plan, gives every key household a
  relationship owner, records every touch, tracks thank-yous, shows plain engagement signs with their reasons, and
  hands each owner a short weekly list with a ready draft. The ask comes last, after the relationship is healthy.
- **What makes it different.** Donor tools see only money. Weaver also sees event check-ins, volunteering, messages
  opened, special days, interests, expertise and the best call time (People, #213 and #216), so most signs come from
  work the organization already does, with no extra typing.
- **Its biggest risk is that nobody uses it.** Every design choice below makes the weekly work small (3 to 5 touches,
  each with a reason and a draft, done in one tap) and shows the payoff (retention and thank-you speed moving).
- **Names.** One product, **WeCare**, shown as **Donor care** for non-profit and civic kinds and **Member care** for
  faith and community kinds; the label is data per kind (`app.category_modules`, like "Cash counts").

## 2. Owner decisions (2026-10-13)

| # | Decision |
|---|---|
| W1 | B73 and B98 merge into this plan; one product, one module. |
| W2 | **Proprietary data.** Only people in roles the organization gives WeCare access can see care data, and only roles that can also see amounts see amounts. **Nobody else**: not other staff, not members, not Weaver's platform admins. |
| W3 | WeCare is a **subscription product in the Marketplace** that an organization chooses to take. |
| W4 | Volunteers see what their role allows (W2); there is no separate "volunteers never see amounts" rule. |
| W5 | `giving_insights` keeps the numbers (B98 slices 1 and 2); people and relationships move to WeCare (section 4). |
| W6 | A narrower `wecare.own` level (only my own households) alongside `wecare.view`. |
| W7 | The thank-you tracker is part of WeCare; organizations without WeCare keep receipts as today. |
| W8 | Weaver support may open WeCare settings with a support grant, never care records. |

## 3. Who can see (W2, the proprietary rule)

**Today's gap (found 2026-10-13):** `app.has_permission` returns true for every platform admin in every community
([0400_owner_every_task.sql](../supabase/migrations/0400_owner_every_task.sql), line 22; also backlog B1). Reusing it
would let Weaver staff read every organization's care records. WeCare therefore gets its own check.

| Rule | How |
|---|---|
| Own access check | `app.wecare_can(center, level)`: the center owner, or an active role grant in that center whose role holds the WeCare key (or `*`, the organization's own admin roles). **No `is_platform_admin()` branch.** Every WeCare table's RLS and every WeCare function uses it. |
| Permission keys | `wecare.view` (all care records), `wecare.own` (only households where I am the relationship owner), `wecare.manage` (owners, playbooks, gesture library, care plan, settings). Given to roles by the organization, never by default. |
| Amounts | A gift amount, range or total appears in WeCare only if the person **also** holds `giving.view` (or `giving.manage`). Without it the screen says "thank them warmly", never a number. Enforced in the functions that return the rows, not only in the UI. |
| Platform admins | No read of care records, even with a support grant (`app.support_grants`). A support grant may open WeCare **settings** (to fix setup), never touches, notes, scores or lists. |
| Platform screens | `platform_community_summary` and every cross-community count leave WeCare out (at most "WeCare: on"). |
| Activity stream (0620) | WeCare actions record an action key only, no entity id, and are never in the share-with-Weaver set. |
| AI | Off until the organization turns it on, using that organization's own AI key; drafts only, a person sends; nothing about anyone under 18; nothing kept by Weaver for training or across organizations (section 8). |
| Export | Only `wecare.manage`, step-up 2FA, audited. The organization can export everything it holds at any time, including after it cancels. |
| Audit | Every list view, export, owner change and settings change writes an audit row (who, when, what, row count; no names). |
| Members | A member sees only their own care preferences (section 5, slice 9): never notes, signs, owners or lists. |
| Children | No one under 18 in a list, a sign, a reason, an export or a prompt (D2; `GIVING_INSIGHTS.md` section 5.1 rules carry over). |

Honest limit: people who run Weaver's database (service role, backups) can technically read any table. W2 is
enforced by policy, audit and process, not by encryption. Encrypting care notes with a per-organization key is a
later option; it costs search and AI drafting, so it is not in v1.

## 4. Product and module

- **Module key `wecare`**, depends on **People** only. It reads Giving when Giving is on (amount signs, thank-you
  tracker, who to approach); without Giving it still runs member care (welcome visits, care moments, involvement).
- **Off until granted.** `category_modules.availability = default_off` for every kind; a platform admin grants it per
  community through the module grants of 0740 (reason, fresh 2FA, audit); the organization's admin may pause it.
- **Subscription.** Marketplace phases 2 and 3 (prices, billing) are not built ([`MARKETPLACE_PLAN.md`](MARKETPLACE_PLAN.md)).
  Until they are, WeCare shows on the Marketplace card as **Request**: the organization asks, the Weaver team grants by
  hand. No price is set in this plan (the owner decides; nothing about pricing is promised).
- **Lapse.** A lapsed subscription makes WeCare read-only for 30 days, then hidden. Data is never deleted and stays
  exportable (Marketplace M9).
- **Split with `giving_insights`.** That add-on keeps the plain numbers of `GIVING_INSIGHTS.md` slices 1 and 2
  (Giving > Insights by category and year, a household's own giving story; read-only, existing giving permissions).
  Everything about people and relationships moves here: slices 3 to 7 (safety data, who to approach, next best ask,
  ask history, milestones, peer networks). Matching-gift flags move to **CatchTheMatch**
  ([`CATCH_THE_MATCH.md`](CATCH_THE_MATCH.md)); when both products are on, a WeCare playbook step can prompt a
  donor whose gift may be matched.

## 5. Building blocks

1. **Care profile** (per household, adults only): how they like to be thanked (in person, call, card, message,
   none), recognition (public, private only, anonymous: some traditions give in secret), preferred channel and
   language, do-not-ask with a rest-until date, care notes. Reuses People fields rather than copying them (interests,
   expertise areas, best call time, anniversary, dietary needs, special days, consents). WeCare-only fields live in
   WeCare tables so W2 applies to them; the People fields keep their own visibility.
2. **Relationship owner**: one person per household (staff or volunteer with `wecare.own` or more), with a backup.
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

WeCare is a first job for the per-organization agent (the owner's direction of 2026-10-11, see
[`ONBOARDING_INTERVIEW.md`](ONBOARDING_INTERVIEW.md)): it learns
the mission at onboarding and the people through WeCare. Commands only, with the asking person's own rights (W2
applies to Niva exactly as to a screen): `wecare.my_week`, `wecare.household_brief` (what to know before you call),
`wecare.draft_note` (a personal note from the mission, the household's history and their preferences),
`wecare.log_touch` (a dictated note becomes a touch the person confirms), `wecare.draft_care_plan`. Off until the
organization ticks it; at most 10 households per answer; never sends anything; never the reason a household is
excluded; nothing about anyone under 18 goes to the AI provider.

## 9. Build order

Each slice ships on its own. S is under about 500 lines with tests, M up to about 1,500, L more. Pure logic first
(`src/lib/wecare/`, plain functions with fixtures for a church, a chamber, a temple and a food bank), screens after.
Migration and test numbers are reserved when a slice is approved, not here. Rollout: a sandbox community first, then
any community that takes WeCare.

| Slice | What | Size | Owner OK |
|---|---|---|---|
| 1 | Module `wecare` (default off, grant-only, Marketplace "Request" card), labels per kind, permission keys, `app.wecare_can` without the platform-admin branch, Setup step | M | **Yes: permissions/RLS** |
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
   WeCare. **Approved**; it leaves the Insights slice in progress (S10b) unchanged.
2. **`wecare.own`**: a narrower level so an organization can give a volunteer only their own households.
   **Approved**, alongside `wecare.view`.
3. **Thank-you tracker inside WeCare** (paid), while organizations without WeCare keep receipts as today.
   **Approved.**
4. **Weaver support** may open WeCare settings with a support grant, never care records. **Approved.**
