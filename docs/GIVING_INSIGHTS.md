# Giving insights: finding who to approach (plan)

Status: plan, 2026-10-12, nothing built. Owner ask (2026-10-12): "What are the ideas so we can always find who we can approach for a particular category of donation. It should be available at person/household level as well as at community level. Need to enrich with such analytics at both levels." Built for every organization Weaver onboards (church, chamber, temple, club; any faith or none; any language): behaviour comes from the community's own records and settings. It starts where "Giving at a glance" ends (the year-filtered pledges, payments and pending dashboard on household and person pages, built in the same session) and does not repeat it. Related: B73 (donor playbooks: these insights are what they would read), B63 (employer matching), B72 (occasions), B60 (sending), B94 ([`UNIFIED_BOX.md`](UNIFIED_BOX.md)).

## 1. In short

- A **category** is a fund, a campaign, an opportunity (a boli item, a sponsorship tier) or an **appeal theme** (Building, Education, Relief, Annual fund, Memorial). Gifts reach a category through `payments` > `payment_allocations` > `pledges` (`fund_id`, `campaign_id`, `opportunity_id`). A gift with no pledge behind it (if any) shows as "No category".
- Three layers: **community numbers** (Giving > Insights), a **household panel** (affinity, story, next best ask), and **Who to approach** (ranked lists, reasons on every row).
- No AI in the numbers, score or reasons: arithmetic and wording templates. Niva only reads results through commands, behind the child filter.
- Safety comes before ranking (section 5): no one under 18, a do-not-ask flag, a stricter permission, an audit row per list view, an off switch.

## 2. The ideas, ranked

Ranked by value to a fundraiser for the effort. Data: **Have** = in the database today (tables named); **Small field** = needs one small new field; **Outside** = needs data from outside the community.

| # | Idea | Why it helps a fundraiser | Data |
|---|---|---|---|
| 1 | **Likely supporters** | Households that gave to this category before, often and lately: the warmest list and the best return per ask | Have: `payments`, `payment_allocations`, `pledges` |
| 2 | **Pledge but pay late: remind, do not ask** | Asking someone who is behind erodes trust; a reminder is the right move, and they leave the ask list until they are caught up | Have: `pledges` (`due_on`, `status`, `paid_cents`); command `giving.pledges_behind` |
| 3 | **Lapsed givers to win back** | Gave to this category in earlier years, nothing in the last 12 months: cheaper to win back than to find new | Have |
| 4 | **First-time givers to thank and invite** | First-ever gift in the last 12 months: thank within days, invite to an event, ask later | Have |
| 5 | **Upgrade candidates** | Steady givers (3+ years) whose gift has stayed the same or sits below the category's median | Have |
| 6 | **Recurring-gift candidates** | Gave to the same category 3+ years running with no active recurring gift: a monthly gift is worth more than one more appeal | Have: `recurring_gifts` |
| 7 | **Families who take part but have never given** | Checked in at an event (`attendees.checked_in_at`, adults only) or volunteered (`volunteer_assignments`, completed) with no gift: an invitation, not an ask | Have |
| 8 | **Who has not been asked for this yet** | Stops the same loyal few being asked every time | Have for pledges; **Small field**: link an appeal (`comms_campaigns`, kind appeal) to a fund or campaign, and record an in-person ask |
| 9 | **Ask fatigue** | Asked within the rest period (default 60 days): the household rests | Have for any appeal message (`messages` by person); Small field for in-person asks and for "by category" |
| 10 | **Ask amount range from their own history** | Median and highest gift to this category and to others, shown as a range, never one number | Have |
| 11 | **Best time and channel** | The month they usually give, the method (`payments.method`), the channel they open (`messages.opened_at`) and agreed to (`consents`); shown only with 3+ data points | Have |
| 12 | **Milestone moments** | Membership anniversary (`memberships.starts_on`), the date of a past gift, a wedding anniversary the family recorded (`special_days`). A remembrance date only if the family recorded it and agreed (new consent value `milestone_prompts`; `consents.kind` is free text). **Births are never used** (a birth is a record about someone under 18, D2) | Have + a consent value |
| 13 | **Peer networks** | Who could make the introduction: an adult who belongs to two households (`household_members`), the same zone (`households.zone_id`), the same events and shifts. There is no household-to-household link table, so "relation" is inferred. Never shows one household's giving to another | Have |
| 14 | **Memorial and dedication affinity** | Households that gave "in memory of" or "in honor of" suit a memorial appeal | Have, crude (`pledges.dedication` is free text); structured dedication is undecided in `giving_taxonomy_plan.md` |
| 15 | **Matching-gift and employer flags** | An employer on file (`people.employer`, only with the person's consent) and past matched gifts (`payments.method = 'matching_gift'`) | Small field: the employer-programme list and consent are B63's work |
| 16 | **Outside wealth screening** (property, income, board seats) | Common in large charities | **Outside. Recommend NOT using it, by default or in this plan**: it conflicts with section 5 |

## 3. Analytics

All amounts are integer cents in the community's currency. Years follow the community's fiscal year (the helper reports already use). A gift is a payment that completed, less refunds; failed payments and imported **opening-balance** lines (`is_opening_balance`, which carry made-up dates) are left out of timing and retention, as on year-end statements. Membership fees, school fees and store sales (`pledges.source`) are split out: lists count donations only unless the community switches fees in.

### 3.1 Community level (Giving > Insights)

- **Giving by category by year** (fund, campaign, opportunity, theme), this year against last, plus "No category".
- **Retention**: *kept* (gave last year and this), *lost* (last year, not this), *new* (first-ever gift this year), *regained* (gave before last year, none last year, gave this year). Also per category.
- **Cohorts**: households grouped by first-gift year, and how many still give in year 2, 3, 4.
- **Concentration**: share given by the top 10 percent of giving households. With fewer than 10 giving households it says "too few to show" (the under-10 rule of the public dashboard, 0011).
- **Average and median gift**; typical yearly giving per giving household; **giving per member household** (all members, giving or not) and the participation rate.
- **Pledge fulfilment rate** and **ageing of open pledges** (1 to 30, 31 to 60, 61 to 90, over 90 days: the buckets `giving.pledges_behind` uses).
- **Recurring share**: the part of giving that arrives through recurring gifts, and active recurring gifts.
- **Seasonality**: giving by month, so "December is 40 percent of our year" informs timing.
- **Pipeline**: open pledges by due month (a pledge with no due date counts as due 30 days after it was made, as today).
- **Against the community's own goals**: `campaigns.goal_cents`, `starts_on`, `ends_on`: raised against goal and against time elapsed, and "on pace" measured against the same campaign's last-year curve. A community with no goal sees no target; none is invented.

### 3.2 Household and person level (a panel under "Giving at a glance")

- **Giving story**: a timeline of membership start, first gift, each pledge and gift, recurring gifts starting and stopping, events attended or volunteered (that the household took part, never who in it) and asks received.
- **Affinity by category**: share of the last five years per category, each with a reason: "62 percent of what this household gave went to Education: 9 gifts in 5 years, every year".
- **Next best ask card**: category, range, timing and channel, each with its reason. "No suggestion: behind on a pledge, send a reminder first" is a valid answer.
- **Ask history and flags**: who asked what and when (as recorded), the rest-until date, and any do-not-ask flag (flag details only for the stricter permission tier).
- **Person**: gifts are recorded to the household, with the payer or pledger person when known (`payments.payer_person_id`, `pledges.pledged_by_person_id`). A person's page shows the gifts recorded in their name and links to the household panel. A person under 18 has no giving panel at all.

## 4. How a prospect list works

**Pick a category** (fund, campaign, opportunity or theme) and **a list** (the ideas 1 to 8 above: Likely supporters, Win back, Upgrade, Thank and invite, Recurring candidates, Engaged but never given, Not yet asked, Behind on pledges). The list is **ranked households**, each shown with the **household card** (adults, number, city or zone, last gift), never a name alone. **Every row shows its reasons in plain words**, for example: "Gave to the building fund in 3 of the last 5 years; last gift 14 months ago; no open pledge".

**The score is additive and visible.** A page "How the score works" lists every signal and its points; an administrator can change the points (Settings), and the change is recorded. One function returns the score and its reasons together, so the explanation cannot disagree with the number. Default points for "Likely supporters" (other lists use the same signals with their own defaults):

| Signal | Points | Reason shown |
|---|---|---|
| Gave to this category, per year of the last 5 (max 40) | +8 | "gave to the Roof fund in 3 of the last 5 years" |
| Last gift to it within 12 months / 13 to 24 / 25 to 36 months | +15 / +10 / +5 | "last gift 14 months ago" |
| Gave to a related theme but not this one | +6 | "has not given to this fund; gave to Building" |
| Usual gift at or above the category's median | +5 | "usual gift is above the typical gift" |
| Took part in an event or volunteered in the last 12 months | +8 | "volunteered in the last year" |
| Active membership; renewal due within 60 days (both can apply) | +4; +6 | "membership renews in 40 days" |
| Behind on a pledge by 60+ days | -30 | "Hold: remind about the open pledge first" |
| Asked about anything within the rest period | -20 | "Rest: asked 21 days ago" |
| Open pledge to this category already | excluded | listed under "Already pledged" |
| Do-not-ask flag, or a quiet period applies | excluded | counted ("3 households not shown"), never explained |

**Filters**: area (zone), membership status, last gift (before or after a date), amount band, never asked. **Saved lists**: a list is saved as the question (category, list, filters, weights version) and is re-run when opened, with an optional frozen copy of the households. **Draft a message to these**: hands the households to message drafting (below). **Export**: a spreadsheet with the card, score and reasons; it leaves out the postal address of a household that opted out of physical mail, and is audited and step-up protected like other exports (`app.record_export`, 0154).

**What exists for the message step today**: `messages.audience_preview` counts reachable households and adults per channel; `messages.draft_reminder` writes wording per community language but only for an event; `comms_campaigns` has an `appeal` kind and a compose form; approval and the quiet-hours rule exist. **Campaigns do not send yet (B60).** So v1 creates wording and a draft for people to review; it sends nothing.

### Worked example (all names invented)

**Riverside Community Church, "Roof fund", default weights.** Row scores add exactly as above.

| Rank | Household card | Score | Reasons | Suggested range |
|---|---|---|---|---|
| 1 | #1187 Tom and Priya Nowak, Northgate, last gift 5 months ago | 64 | Gave to the Roof fund in 4 of the last 5 years (32); last gift 5 months ago (15); usual gift above typical (5); volunteered in the last year (8); active member (4); no open pledge | $150 to $400 |
| 2 | #2041 Ana and Luis Rivera, Eastside, last gift 14 months ago | 51 | Gave in 3 of the last 5 years (24); last gift 14 months ago (10); usual gift above typical (5); volunteered in the last year (8); active member (4); no open pledge | $100 to $300 |
| 3 | #1530 Mei Chen and Daniel Park, Westfield | 31 | Gave in 3 of 5 years (24); last gift 8 months ago (15); volunteered (8); active (4); **Rest: asked 21 days ago (-20)** | $75 to $200 |
| 4 | #3310 Grace Okafor, Eastside | 4 | Gave in 2 of 5 years (16); last gift 20 months ago (10); volunteered (8); **70 days behind on a Christmas pledge (-30). Hold: remind first** | not shown |

**Lakeshore Chamber of Commerce, "Scholarship fund".** Members are shown by their contact adults.

| Rank | Member card | Score | Reasons | Suggested range |
|---|---|---|---|---|
| 1 | #4402 Lopez Bakery, contact Ana Lopez, Downtown | 54 | Sponsored the scholarship gala in 2 of the 3 years we have (16); last sponsorship 11 months ago (15); usual gift above typical (5); attends mixers (8); active member (4); membership renews in 40 days (6) | $250 to $750 |
| 2 | #4377 Harbor Dental, contact Dr. Sam Reyes, Harbor | 46 | 3 of 5 years (24); last gift 20 months ago (10); attends mixers (8); active (4) | $200 to $500 |
| 3 | #4511 Northside Print, contact Jo Walker | 18 | Has not given to this fund; sponsored the Business Awards, a related program (6); attends mixers (8); active (4) | first ask: $100 to $250 |

## 5. Privacy and respect

1. **Children (D2).** No one under 18 appears in a list, a score, a reason, an export or a prompt. Mechanically: the source is household money records plus adult people only; household cards come from the adults-only loader (`adultHouseholdCards`); "took part" is a yes or no per household counted from adult check-ins only (`attendees` also holds children), never who; a child's school enrolment or attendance is never a signal; birth dates are not read at all; and Niva results pass the existing child filter (`src/lib/commands/child-filter.ts`). A test fixture with a child's name in a dedication and in an event note must come out clean.
2. **Opt-outs and the flag.** Directory, photo and physical-mail opt-outs are honoured: a household hidden from the directory is never used for peer suggestions; mail exports leave out postal addresses of those who opted out; drafts reach only adults who agreed to the channel (the audience preview already counts by channel, from `consents`). **There is no "do not solicit" flag today** (searched): propose a **do-not-ask** flag on a household (and optionally one category), with a reason class (family request, hardship, bereavement, leadership guidance, other), who set it, when, and an optional review date, plus a softer **rest until** date. A flagged household is excluded from every list, draft and Niva answer; only the stricter tier sees the reason; Niva sees only "N households not shown".
3. **Who may see.** The household panel's history and affinity reuse the existing payments permission (`payments`: anyone who already sees that household's payments; event-day volunteers who see only their own entries get the same limited view, `limited_view`). Community numbers reuse `paymentsAll` (giving view or manage). **Ranked lists, the next best ask card and ask history need a stricter tier: a new permission, proposed `giving.approach`**, given by the community to named roles (treasurer, fundraising lead). Owner to confirm (question 1).
4. **Audited.** Every view of a ranked list writes an audit row through the same database function that returns it (who, when, category, list, filters, number of rows; no names); opening a next best ask card records the household; exports are step-up protected. Members never see their own score or the lists.
5. **Off switches.** Two community switches: **Giving analytics** (counts and the household panel) and **Who to approach** (ranked lists, next best ask, Niva commands). Switched off, the tabs, panels and commands disappear and Niva says it is switched off. Turning on Who to approach shows a plain page on what it uses and does not use.
6. **Any culture, any faith or none.** No assumption about names (cards come from the data, with no first/last order), faiths or customs. **Configurable data, not code**: a community's **quiet periods** (name, dates or yearly repeat, applies to messages, in person or both; a fast, a mourning period, a holy day, a season) which hold asks and block scheduling an appeal inside one, as quiet hours already do for messages; a per-fund **"can be asked for"** switch for purposes the community does not solicit; the rest period length; anonymous gifts stay anonymous (the staff view exists already; nothing is shown to peers or in recognition). Reason wording is templated per community language, with English marked "needs translation" as reminders do.
7. **What the score does NOT use**: religion or tradition, caste, ethnicity, nationality, language, gender, age or birth date, marital or family status, health, income, property or occupation, photos, anything about a child, anything from outside the community's own records, how other named households gave, or how a name is spelled. Employer appears only as the matching-gift flag, and only with consent. The score orders a list for a person to read: nothing is sent or asked automatically.

## 6. Where it lives, and how Niva uses it

- **Giving > Insights** and **Giving > Who to approach**: two new tabs in the Giving group (`src/lib/permissions.ts`), in the kind's own words where it has them.
- **Household and person pages**: a "Giving insights" panel under Giving at a glance.
- **The one box (B94)**: "who could we ask for the library fund?" routes to Who to approach with the category filled in. It opens the page rather than answering inline, because it needs the stricter permission and the audit row.

**Niva today** (existing commands, read-only): `giving.pledges_behind` (who is late, limited to a fund), `giving.household_summary` (one household's giving, after `people.search`), `reports.campaign_progress` and `reports.giving_totals` (campaign and yearly totals, counts only), `messages.audience_preview`. So today it can answer "who is behind on the library fund?" and "how is the annual appeal doing?"; it cannot answer "who could we ask?", "who lapsed?", "retention?" or "who has never been asked?".

**New read commands** (`level: read`, built on `src/lib/commands/catalog/giving-*` and `reports/`):

| Key | Question it answers | Inputs | Permission |
|---|---|---|---|
| `reports.giving_by_category` | "How did each fund do against last year?" | year, category kind | `paymentsAll` |
| `reports.giving_retention` | "How many kept giving, lapsed, are new?" (counts, average, median, top-10-percent share, recurring share) | year | `paymentsAll` |
| `giving.household_insights` | "What does this household care about?" | household id | `payments`; next ask and ask history only with `giving.approach` |
| `giving.prospects` | "Who could we ask for the library fund?" (household cards, score, reasons, range) | category, list, limit 1 to 25, zone, last gift, amount band, never asked | `giving.approach` |
| `messages.draft_appeal` (draft) | "Draft a message to these" | list or household ids, category | `commsDraft` |
| `giving.set_ask_block` (confirm) | "Do not ask the Rivera household for now" | household id, scope, reason class, review date | needs owner OK (below) |

**Activity-allowlist note (AGENT_RULES):** every key above must be registered in the activity allowlist (`app.activity_catalog`, 0620) in the slice's own migration; `tests/activity-commands.test.ts` reads migrations from 0625 on and fails otherwise. Add the keys to `tests/commands/catalog.test.ts` and the assistant test lists. Confirm-level commands stay off for Niva until a community ticks them in Platform > Niva for admins; the same tick is proposed for `giving.prospects` and `giving.household_insights`, default off, because ranked lists are more sensitive than the totals Niva reads today. A consequence: slice 1 (screens only) needs no migration, but the commands wait for slice 2.

## 7. Build order

Each slice ships on its own. S is under about 500 lines with tests, M up to about 1,500, L more. Pure core first (`src/lib/giving-insights/`: plain functions and tests), screens after. No migration numbers are chosen here.

| Slice | What | Size | Migration | Owner must approve |
|---|---|---|---|---|
| **1 (recommended first)** | Community numbers (3.1) as Giving > Insights, plus the household affinity card and giving story (3.2). Computed in the portal from narrow paged reads of `payments`, `payment_allocations` and `pledges`; no AI; fixtures for a church, a chamber and a temple | M | None | Nothing: read-only, reuses `paymentsAll` and `payments` |
| 2 | Read commands `reports.giving_by_category`, `reports.giving_retention`, `giving.household_insights` (affinity and story only until slice 3) for Niva and the box; database functions if a big community is slow | S to M | Yes: functions and allowlist rows | Niva access tick (default off) |
| 3 | **Safety data first**: do-not-ask flag and rest-until, quiet periods, per-fund "can be asked for", consent value `milestone_prompts`, the two switches, the `giving.approach` permission | M | Yes | **NEEDS OWNER OK: permission/RLS, sensitive data, audit rule** |
| 4 | **Who to approach v1**: lists Likely supporters, Win back, Thank and invite, Behind on pledges, Engaged but never given; visible and editable weights; filters; audited view; export | L | Yes: the list function (it checks permission and writes the audit row) | **NEEDS OWNER OK: new permission tier, audit, export** |
| 5 | Saved lists, `messages.draft_appeal` hand-off, ask history (appeal linked to a fund; in-person ask logged), Niva `giving.prospects` | M | Yes: saved lists, appeal link | **NEEDS OWNER OK**: messaging use and Niva access |
| 6 | Next best ask card, Upgrade and Recurring candidates, ask ranges, best time and channel | M | Likely none | The card needs the stricter tier (already approved in 3) |
| 7 | Milestones, peer networks, matching-gift flag (with B63), feeding B73 playbooks | M to L | Small | Consent wording |

Slice 3 must land before slice 4: no ranked list exists before the flag, the quiet periods and the switch do. Slices 1 and 2 show counts and a household's own history, so they can go first.

## 8. Open questions for the owner

1. **Who sees ranked lists?** *Recommend* the new `giving.approach` permission, given by the community only to the treasurer and the fundraising lead; giving view and manage holders do not get it automatically.
2. **Default switches.** *Recommend* Giving analytics on, Who to approach off until the community reads the "what it uses and does not use" page and turns it on.
3. **What counts as giving in lists?** *Recommend* donations only (funds, campaigns, boli and sponsorship pledges, event commitments); membership fees, school fees and store sales out, with a per-community switch to include them.
4. **Milestones and bereavement.** *Recommend* births never; a remembrance date only if the family recorded it and agreed, and then a "reach out with care" task, never an ask unless that family has given in that person's memory before.
5. **Niva and the lists.** *Recommend* off for Niva until a community ticks it; at most 10 households per answer; never the reason someone is excluded.
6. **Rest period after an ask.** *Recommend* 60 days by default, editable per community and per category; and no outside wealth data in this plan, revisited only with a separate privacy review.
