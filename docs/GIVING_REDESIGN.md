# Giving area redesign (plan)

Status: plan and clickable prototype, 2026-10-12, nothing built. Owner request (2026-10-12): "Start a similar exercise as People to prototype/plan the Giving area consolidation." His reasons after the People exercise: the admin clicks far too many buttons for ordinary jobs, screens repeat tab sets, things that belong together are spread over pages; he wants ONE find box, in-place actions, a work queue instead of hunting, fewer screens and fewer clicks, for every kind of organization (donations, dues, fundraising, any currency). Built for every organization Weaver onboards: wording comes from the kind terms (`src/lib/kind.ts`, `src/lib/wording.ts`), nothing here names one community. The invented community in the prototype is a neutral "Riverside Community" (the same one as the People prototype, so the two areas fit). Money is integer cents in the community's currency; in a community that uses another currency or number format the same screens show, for example, "1,25,000.00 rupees" or "1.250,00 euros" from its settings.

**Prototype** (clickable, desktop and phone): `giving-redesign-prototype.html`, published as an artifact by the coordinator. Screenshots: `giving-redesign-*.png`. Related plans: `PEOPLE_REDESIGN.md` (the Family page this plan plugs into), `UNIFIED_BOX.md` (B94, the one box), `GIVING_INSIGHTS.md` (B98, Insights and Who to approach), B93 (Bhandar counting in its own tab).

## Owner decisions this plan follows (People exercise, 2026-10-12)

1. **Find**: one box, type anything (a name, a receipt number, an amount, a bank line, a campaign); results show families with their household cards; Enter acts on the best result.
2. **Work queue, not hunting**: the Giving home lists what needs doing today, each item acts in its row.
3. **In place**: money jobs happen in a sheet over the page you are on, never on a page of their own.
4. **Rare actions** go behind a menu, kept, with a reason and a confirmation.

**Money rules are untouchable** (CLAUDE.md, `docs/DECISIONS.md`): integer cents; "pledge", never "bid"; cash basis; a household is never picked or confirmed by name alone (the household card); the two-person rule and the fresh 2FA checks stay exactly as they are. This plan changes where a button sits, never what it is allowed to do. Any slice that would add a rule, a permission or a write path is marked **NEEDS OWNER OK**.

## 1. Today, verified in the code and on the sandbox (the audit)

Read in `src/app/(app)/giving/*`, `bolis/*`, `accounting/*`, `src/components/giving-workspace/*`, `giving-glance/*`, `src/lib/commands/catalog/giving-*.ts`, and checked read-only on the sandbox community (nothing saved, approved or changed). **Assumptions for a typical community**: about 400 families, one treasurer, one or two finance volunteers, a second approver (an officer), about 25 gifts a week recorded by hand, the bank statement imported weekly, an offering box counted weekly (kinds that have one), 3 to 6 campaigns a year, year-end statements once a year, a handful of refunds and write-offs a year, a month-end close every month.

| Screen (address) | What it is for | Who | How often | What repeats or is missing |
|---|---|---|---|---|
| **Giving** `/giving` (New look only) | Conversation that prepares a payment; side panel: open pledges, month-end checks, waiting items | Treasurer | Daily to weekly | Its "second approver" row links to `/approvals`, which does not exist (the sandbox shows "Not found"); the conversation ends by opening the old Record payment screen unless the owner switched money commands on (default off) |
| **Pledges** `/giving/pledges` | Pledge list, aging, write-off request, approval, completion | Treasurer, second approver | Weekly | No search by family or pledge number (filters: status, campaign, year); no way to record a pledge (pledges come only from the member app, boli close, labh, RSVP commitments, fees and imports; the family's Pledges tab is read-only); aging sits below the list |
| **Payments & deposits** `/giving/payments` | Record an offline payment; DAF grants to match; flagged provider refunds; refund requests; Bhandar counting; all payments | Treasurer, finance volunteer | Several times a week | One page does five jobs. The list cannot be searched by family, receipt number or amount (filters: method, source, dates). Counting sits at the bottom (B93) |
| **Bank reconciliation** `/giving/payments/bank` | Import the statement; match gift lines, deposits, Zelle reports; look at payouts, money out | Treasurer | Weekly | Seven tabs. Payout differences appear here and again in QuickBooks sync, with no way to explain one |
| **Opportunities** `/giving/opportunities` | Builder (about 25 controls) above the list of what members see in the Give tab | Treasurer, fundraiser | A few times a year | Two chips (Opportunities, Campaigns) repeat the area's tab row |
| **Campaigns** `/giving/opportunities/campaigns` | Campaigns with goals; a nine-field form | Treasurer | A few times a year | Same chip row; a separate page for what is one idea to the person |
| **Recurring** `/giving/recurring` | Recurring gifts set up in the member app | Treasurer | Monthly glance | Read-only (no actions); needs the card provider connected (columns say so); six status chips |
| **Labh fulfilment** `/giving/labh` | Special-day offerings to schedule | Kinds that have them | Per special day | Kind-gated already (`KindGate`) |
| **Receipts & statements** `/giving/statements` | Template wording, treasurer's approval, issued list | Treasurer | Yearly | Generation is off ("the statements service is not connected"): year-end work cannot be done in the console today |
| **Bolis** `/bolis`, `/bolis/upload` | Pledge auctions (digital and in person) | Treasurer, boli volunteers | Per event | A second module pill beside Giving |
| **Accounting** `/accounting/*` (four pages) | QuickBooks status and exceptions, setup, donor matching, month-end close | Treasurer, accountant | Monthly; setup once | A third module pill; its manual close checks ("payouts matched", "refunds approved", "statements generated") repeat work done elsewhere |
| **Family and person pages** | Pledges and Payments tabs, Giving at a glance, Record payment link | Anyone who sees the family | Daily | Giving at a glance (new) is the only place that shows what a family owes at a glance |
| **Home My tasks** | Cross-area queue with Approve in the row (`src/lib/tasks.ts`: refund, write-off, credit, deposits, QuickBooks, bolis) | Approvers | Daily | The only in-place approval today; Giving has no queue of its own |

**Navigation**: three module pills (Giving, Bolis, Accounting), a tab row of six or seven, a chip row on two pages, then seven bank tabs: up to **four nested rows** on the Bank screen, and every page is titled "Giving" so the page's own name is the third thing you read. Fifteen addresses plus the bank, pledge and recurring views.

**Verified click paths** (count rule in section 2): Record a check, best path today: click the top-bar box, Enter (the family page opens), Record payment (the form opens with the family chosen), Save payment = **4** (5 for cash, Zelle or stock: one more click for the method). Through Giving's own page: Giving, Payments, name and Enter, Select, Save = 5. To see everything waiting today a treasurer opens Giving, Pledges, Payments, Bank, Recurring, QuickBooks sync and Donor matching: **7 pages**.

## 2. Click budget

Counting rule (as in People): one click, tap or key press such as Enter is one action; typing, Tab and scrolling are free; counted from any page, to the end of the job. "Today" is the best path that exists now (the New look; the classic look in brackets when it is shorter or longer). The proposed counts need nothing but the screens in section 4.

| Job | Today | Proposed |
|---|---|---|
| See everything that needs doing | **7** page loads (above) | **1**: Giving (Today) |
| Record a check for a family | **4**: top-bar box, Enter, Record payment, Save payment | **3**: Ctrl+K, Enter (the sheet opens filled in: "200 check patel"), "Record $200.00" (4 when two families match and you pick the card) |
| Record cash, Zelle or stock | **5** (method click) | **3**: the method is in the sentence |
| Card payment | 0, the provider records it (not an admin job) | 0; it shows in Payments, and refunds start there |
| Record a pledge | **Not possible** | **3**: Ctrl+K, Enter on "pledge 500 patel building fund", Record pledge. **NEEDS OWNER OK** |
| Find a family's giving and what they owe | **2**: top-bar box, Enter (the family page; Giving at a glance is below the header). Giving's lists cannot search by family | **2** and you stay in Giving: the sheet shows owes, last gifts, open pledges, with Record payment and Record pledge on it |
| Find a payment by receipt number or amount | **Not possible** (scan pages of 50) | **2**: Ctrl+K, Enter |
| Request a pledge write-off | **4**: Giving, Pledges, Write off, Request write-off (3 classic), after scanning an unsearchable list | **3**: Giving, Write off on the row in "Pledges behind", Request write-off (4 from the box) |
| Second approver approves | **2**: Home, Approve (the Giving link goes nowhere) | **2**: Giving, Approve, with amount, household card, reason and requester in the row |
| Complete an approved write-off | **4**: Giving, Pledges, Complete, browser confirm | **3**: Giving, Complete on the "Approved by two people" row, "Yes, write off $60.00" |
| Request a refund | **4**: Giving, Payments, Request refund (row, after scanning), Request refund | **3**: Ctrl+K, Enter on "refund R-2026-0388", Request refund |
| Record an approved refund (fresh 2FA stays) | **3** + code | **2** + code: Giving, Record refund |
| Match a bank deposit to its checks | **4** (5 classic): Giving, Bank row, Deposits tab, Confirm | **3**: Giving, Review on the deposit row, Confirm deposit |
| Match a bank gift line (ACH, Zelle, fund grant) | **3** (4 classic) | **2**: Giving, "Confirm $120.00 for the Adeyemi household" on the row |
| Confirm Zelle reports | **3** (5 classic): Giving, Zelle row, Confirm N | **2**: Giving, Confirm 4 exact matches |
| Handle a payout difference | **Not possible** (shown in two places, nothing to explain it; the close check is a manual Mark done): about 7 to look | **3**: Giving, the payout row (both sides and the difference together), Explain and accept (a reason). **NEEDS OWNER OK** |
| Record a Bhandar (offering box) count | **6**: Giving, Payments, New counting session, counter 1, counter 2, Save (+4 later for the deposit slip) | **3**: Giving, Start on the "Count the offering" row (last counters filled in), Save; later **3** to match the deposit |
| Set up a campaign | **4** (6 with kind and fund): Giving, Opportunities, Campaigns, Create | **3**: Ctrl+K, Enter on "new campaign Building fund", Create draft |
| Set up an opportunity | **3** minimum, about 25 controls, **6** typical | **3**: Ctrl+K, Enter, Publish; four questions, the rest later |
| Year-end statements | **Not possible** in the console | **3**: Giving, Review and send, Send 71 emails (the send stays off until the statements service exists) |
| Resolve a QuickBooks donor match | **4**: Giving, Accounting, Donor matching, Approve | **2**: Giving, Approve on the row (3 in Books) |
| Export giving for the treasurer | **Not possible** (no export in Giving; People's Export button is disabled) | **3** + code: Ctrl+K "export payments 2026", Enter, Export. **NEEDS OWNER OK** |

Headline: checking what needs doing drops from 7 pages to 1, recording a check from 4 to 3 and cash or Zelle from 5 to 3, confirming Zelle from 5 (3) to 2, matching a deposit from 5 (4) to 3, a counting session from 6 to 3. **Six jobs that cannot be done today become possible**: record a pledge, find a payment by receipt number, explain a payout difference, send year-end statements, export for the treasurer, and approve from Giving (the link to nowhere is replaced by a queue). Where the count barely moves (the approver, a campaign) the gain is that nothing has to be hunted for.

## 3. What stays, what goes, what merges

| Keep (the work people really do, and every safeguard) | Remove or tuck away (not needed, or rarely used) | Merge |
|---|---|---|
| Record offline payment (check, cash, ACH, Zelle, stock) with the allocation preview; recorded together with its pledges or not at all, one confirmation records once (0658); the "looks like a repeat" check; Zelle report matching with exact-match bulk confirm; deposit match to the cent; gift-line matching with learned payer names; the **two-person rule** (write-off, refund, flagged provider refund) and the **fresh 2FA** on provider refunds; payouts are never matched to households; pledge aging; campaigns with goals; opportunities; Bolis; counting by two counters from different households; month-end lock; template approval by the treasurer; QuickBooks as the book of record with the treasurer's mapping approval; History on every money row; Giving at a glance | The module pill row (Giving, Bolis, Accounting) and the repeated "Giving" page title in the New look; the "Payments and deposits / Bank" and "Opportunities / Campaigns" chip rows; the household quick-view drawer (the family giving sheet replaces it); the "Aging of outstanding pledges" card at the bottom (the same numbers become chips at the top); the conversation page's opening input and sample-prompt list (the box replaces them); "Matched" and "Ignored" and "Money out" as three of seven bank tabs; "Recently learned payer names" as a page-level card (it moves under More on Bank) | Pledges + aging + write-offs = **Pledges**; record form + payments list + refund requests + flagged refunds + DAF grants + **Recurring** = **Payments** (views); seven bank tabs = five; Campaigns + Opportunities + **Bolis** + **Labh** = **Campaigns & opportunities** (views); Bhandar counting leaves Payments = **its own tab** (B93); the four Accounting pages = **Books**; Giving conversation + side panel = **Today**; Home My tasks and Giving Today share one task source (`src/lib/tasks.ts`) so they never disagree |

**Evidence, honestly**: page views are not recorded today (the activity stream, 0620, records actions only), so "rarely used" is a judgement from the code and the sandbox: Recurring has no actions and its columns say it needs the provider; Statements has its generate button off; Payouts have no action; Labh is already kind-gated; the sandbox shows empty states for DAF, counting, statements. Nothing is deleted: every tuck-away stays one click away under More or a view for one release, in the New look only (the classic look is untouched), and the activity stream tells us what is used before anything else goes. The questions that decide the merges are in section 10.

## 4. Information architecture

**Today** (`/giving`, New look). Top: the box, large (the same component as B94). Below it, the **work queue**: tiles with counts (Approvals, Bank, Pledges, Offering counts, Books) that filter the list, then rows. Each row says who or what, why it is here and since when, shows the household card line wherever a family is involved, and acts in place. Order: what blocks others first (approvals), then bank, pledges, counts, books. A done row stays on the page as "Done: receipt R-2026-0413" until reload.

| Row | Existing source | Shown to | In the row | Same action as today |
|---|---|---|---|---|
| Waiting for your approval | `giving.waiting_for_second_approver`, flagged refunds, credits | `giving.approve` | **Approve as second person**; amount, card, reason, requester and date in the row. The requester sees "Waiting for a different person" | `approveAsSecondAction`, `approveFlaggedRefundAction` |
| Ready to complete / record | write-off approved by two; approved refund | `giving.manage` | Complete write-off; Record refund (fresh 2FA in the sheet) | `completeWriteOffAction`, `recordRefundAction`, provider refund |
| Zelle exact matches | `giving.zelle_waiting`, Zelle queue | `bankConfirm` | **Confirm 4 exact matches** (listed, pre-ticked, each with card and amount) | `confirmExactMatchesAction` |
| Gift lines with a suggestion | `giving.bank_lines_unmatched`, bank suggestions | `bankConfirm` | **Confirm $120.00 for the Adeyemi household**; Pick another | `confirmBankMatchAction` |
| Deposits to match | bank deposit lines, `giving_deposit_context` | `bankConfirm` | Review (the checks that add up are pre-ticked), **Confirm deposit** | `matchDepositAction` |
| Pledges behind | `giving.pledges_behind` | `pledges` | Open family; **Write off…**; Draft a reminder (a draft only) | `requestWriteOffAction` |
| Offering counts | counting sessions not deposited | `counting` | Record the count; match its deposit | counting actions |
| Payments to apply | recorded but not applied; DAF grants | `allocatePayment` | Apply to pledges; Match | `applyPaymentAction`, DAF match |
| Month-end close | `month-close-blockers` | `close` | Mark done (judgement checks); the checks the system can prove tick themselves | existing |
| QuickBooks donor matches, failed recurring gifts, receipts due | existing counts; statements | their own permissions | Review; Open; Review and send | links, new send (slice 8) |

A row the person cannot act on shows a plain count ("2 waiting for the second approver"), never a hidden row and never an empty table. Below the queue, three numbers for the month (recorded, open pledges, matched share) and Recent families.

**The one box** (`/api/box`, Ctrl+K, the top bar on every page; large on Today). It adds a **Giving lane** to B94: families (household cards), payments (receipt number, amount, date), pledges (number), bank lines (amount, description, payer name), campaigns, and commands built on what exists: `parsePaymentAsk` already reads amount, method, date and reference; it grows to "pledge …", "refund …", "write off …", "new campaign …", "export …". The box says **"I understood: record a $200.00 check for the Patel family"**, shows the best action as a large row with the household card, and the families below. **Nothing in the box changes data**: Enter opens a sheet filled in, and the sheet's own button does the work (UNIFIED_BOX principle). Filters ("overdue pledges", "unmatched", "Zelle waiting") open the tab with chips. A question in prose goes to Niva. If B94 slice 1 is not merged when slice 2 starts, slice 2 builds only the Giving lane behind B94's interface.

**In place**: **sheets** (centre on desktop, bottom sheet on phone) for Record payment, Record pledge, Write off, Refund, Complete write-off, Confirm deposit, Counting and New campaign or opportunity; a **slide-over** for a family's giving. Every sheet has the same anatomy: household card at the top; fields with defaults; a "what happens" line ("Closes pledge PL-20455 and leaves $12.00 open"); a button that names the amount and the family; a reason line where the rules need one; an inline fresh-2FA field where the rules need one; Cancel. Existing server actions are called as they are today (`recordOfflinePaymentAction`, `confirmBankMatchAction`, `matchDepositAction`, `approveAsSecondAction` …) through `runScreenCommand` where a command already covers them. The three Giving money commands stay behind the owner's switch for Niva and the box's "prepare" path; the sheets do not need that switch because they are the screen's own confirmation, as today.

**One tab row** (container-width scroll on a phone), each tab with a count where a queue exists:

| Tab | Holds | Shown when |
|---|---|---|
| **Today** | the box and the work queue | always |
| **Pledges** | list searchable by family and number; chips Open, Behind, Waiting for approval, Closed, aging buckets; row menu: Record payment, Write off, Open family | `pledges` |
| **Payments** | all payments (search by family, receipt, amount; chips for method and source); Record payment button; views **Refunds** (requests and flagged provider refunds), **Grants to match** (DAF, matching gifts), **Recurring** | `payments` |
| **Bank** | Import (a sheet); five views: To match, Deposits, Zelle, Card payouts (provider side and bank side in one row, difference shown), History (matched, ignored, money out); "Recently learned payer names" under More | `bank` |
| **Campaigns & opportunities** | campaigns with goal progress; opportunities; views **Bolis** (module on) and **Labh** (kinds that have it); quick create sheets, full builder one click away | `campaigns` |
| **Statements** | year-end review and send; receipt copy on request; template wording and treasurer approval | `statements` |
| **Insights** | B98: community numbers; later Who to approach (stricter permission, off by default) | analytics switch |
| **Offering counts** (the kind's own word: Bhandar, plate, offering) | counting sessions, New count, deposit matching (B93) | community collects an offering box; `counting` |
| **Books** | month-end close first; QuickBooks sync and exceptions; donor matching; setup | accounting module; `close` or `qbo` |

**What moves to the Family page, what stays here** (fits `PEOPLE_REDESIGN.md`): the Family page holds **one family's** giving: Giving at a glance, the Pledges and Payments rows (the same row component, filtered to the family, with the same write-off and refund menus), recurring gifts, statement history, and the **Record payment** and **Record pledge** buttons, which open the Giving sheets in place instead of navigating to `/giving/payments?household=`. Giving holds **everything across families**: queue, bank, campaigns, statements run, insights, counts, books. A family's giving sheet in Giving is the same panel with an "Open family page" link; nothing about editing people lives in Giving. Build the rows and sheets once (`src/components/giving-actions/*`); both areas use them.

**Accounting and Bolis**: Bolis (pledge auctions) are a view under Campaigns & opportunities; a closed boli's pledges appear in Pledges as today. Accounting becomes **Books**; the module stays switchable; QuickBooks setup stays reachable from Books and Settings. The pill row goes in the New look.

**Insights (B98) in this structure**: a tab with read-only community numbers; the household panel from B98 sits under Giving at a glance on the Family page and in the family giving sheet; Who to approach stays inside Insights behind its switch, its stricter permission and its audited view, exactly as `GIVING_INSIGHTS.md` section 5 says (no one under 18, do-not-ask flag, no AI in the score). Nothing here relaxes it.

## 5. Money safety in the interface

1. **Nothing moves money without a click on a button that names the amount and the family** ("Record $200.00 check for the Patel household 0127"). Enter in the box opens a sheet; Enter inside a sheet never submits.
2. **The household card is repeated at every confirm step**, with amounts: a family is never picked or confirmed by name alone, including the box's results, Pick another, deposit lines and counters.
3. **What happens is stated before the click** (which pledges close, what stays open, "recorded but not applied: a treasurer can apply it" for someone without allocation rights).
4. **Undo**: payments, matches, refunds and write-offs have no undo; the sheet says **"This cannot be undone here. A mistake is fixed with a refund that a second person approves."** Things that move no money have Undo (a draft campaign, a saved filter, a counted-but-not-deposited session edit). A payment recorded in error stays a refund (question 4).
5. **One confirmation records once**: the button disables while saving and becomes "Recorded as R-2026-0413"; the existing repeat check and 0658 stay.
6. **Errors are always surfaced**, next to what the person did, in plain English with a retry ("Could not record the payment: the server did not respond. Nothing was saved. Try again."), technical detail logged with `failure()`. "Recorded" appears only after the server said so; a list never shows a row as done until the server confirmed.
7. **Reasons and codes stay**: write-off, refund, decline and "explain a difference" need a typed reason the second approver reads; fresh 2FA appears inline where the rules ask (provider refunds, flagged refunds, exports).
8. **Bulk is visible**: "Confirm 4 exact matches" lists the four pairs with household card and amount, pre-ticked, each untickable; the same per-pair checks run again on the server.
9. **Niva never moves money from here**; the confirm-level commands stay off until the community ticks them.

## 6. Permissions and roles

| Role | Sees | Does |
|---|---|---|
| **Treasurer** (`giving.manage`, bank, close) | every tab | everything today's screens allow; requests write-offs and refunds; completes and records them after approval |
| **Finance volunteer, limited view** (`giving.record_offline`) | Today (their own queue rows), Payments limited to the entries they recorded (as today), Offering counts | record a payment (recorded, not applied), count the offering; no Bank, no Pledges write-off, no Insights |
| **Second approver** (`giving.approve`) | Today's approval rows with evidence; Pledges and Payments read | approve as second person, never their own request (the database refuses it; the row says so) |

UI checks (`src/lib/permissions.ts`) are convenience; RLS enforces. A tab the role cannot open is hidden; opened by address it says **"You don't have access to this area"** (never an empty table). A queue row the person cannot act on is a plain count. A module that is off (Bolis, Accounting) removes its views, and a direct address says it is switched off (`ModuleGate`). Nothing here adds or widens a permission; the two new ones (export, record a pledge) are slices that say NEEDS OWNER OK.

## 7. Children and respect (D2)

Giving records belong to **households and the adults who pay**. The family giving sheet, the box and every list show the household card (adults only for anything sent toward a model) and a payer or pledger who is an adult; a child's name never appears in Giving. Fee pledges for children (a school term) show the family and "2 children", never a child's name. Counters are adults. Statements are addressed to adults. Anything handed to Niva passes `filterChildren` with `databaseMinorNames` (`src/lib/commands/child-filter.ts`) first; the box's "ask" fallback sends text only, and household cards for a model list adults only. Insights and Who to approach exclude anyone under 18 mechanically (`GIVING_INSIGHTS.md` section 5). The box never stores typed text in the activity event.

## 8. Phone layout (390 px)

The bottom bar keeps Today, People, Giving, Events and **Ask** (the box as a sheet). Giving: the tab row scrolls sideways; Today's queue is stacked cards; a **sticky bottom bar** holds Record payment and Find; sheets become bottom sheets with the confirm button at the bottom, 44 px high, numeric keypad for amounts; lists become cards (receipt, household card, amount, status); counting works at the door (big inputs, last counters pre-picked); Bank is read-and-confirm on a phone (a statement import says "works best on a computer"). The undo-less toast sits above the bottom bar for 6 seconds with "View". Everything works at 200% zoom and with the keyboard (Ctrl+K, arrows, Enter, Esc; focus returns to the row after a sheet).

## 9. Build slices (each ships behind the New look)

| # | Slice | Size | Migration | Touches money rules, permissions or RLS |
|---|---|---|---|---|
| 1 | **Today: the work queue** (approvals, Zelle exact matches, gift lines, deposits, pledges behind, counts, close) with in-row actions on the existing server actions; fixes the dead `/approvals` link; the single tab row pointing at today's screens; shares `src/lib/tasks.ts` | M | No | No (same actions, same checks) |
| 2 | **Record in place and find**: the Giving lane of the box, Record payment sheet, family giving sheet, Family page buttons open the sheet; replaces the conversation page's input and the household drawer | M | No | No |
| 3 | **Pledges and Payments rebuilt**: search by family, number, receipt, amount; chips; in-place write-off, complete, refund request and record; Refunds, Grants and Recurring views | L | No (a search function if slow) | No |
| 4 | **Bank tab**: five views, import sheet, payout row with both sides and the difference | M | No | No |
| 5 | **Offering counts tab** (B93): own tab, last counters remembered, deposit matched by picking the bank line, per-community switch | M | Yes, small (link column, switch) | No |
| 6 | **Campaigns & opportunities**: quick create sheets, Bolis and Labh as views | M | No | No |
| 7 | **Record a pledge** in place: new write path and database function, permission check, source "manual" | M | Yes | **NEEDS OWNER OK** (a new money write path) |
| 8 | **Statements**: year-end review and send, receipt copy; send stays off until the statements service is connected | M to L | Maybe | **NEEDS OWNER OK** (tax receipts and messages to donors) |
| 9 | **Export on every list** and **Explain a payout difference** (reason, audited) | M | Yes (permission, audit, reason column) | **NEEDS OWNER OK** (new permission, audited export, new write) |
| 10 | **Books tab** (Accounting tucked in; auto-tick the close checks the system can prove) and **Insights** (B98 slice 1) | M | No | No (B98's later slices carry their own OK) |

**Recommend slice 1.** It covers the treasurer's weekly routine in one place (Zelle 5 to 2, deposits 5 to 3, approvals), needs no migration and no new rule, uses actions that already exist, and replaces a link that goes nowhere. It does not wait for B94. Slice 2 is next: it is where the two-click find and the three-click record arrive.

## 10. Open questions for the owner

1. **Recurring, Bolis and Labh.** Fold Recurring into Payments (read-only, needs the provider), and Bolis and Labh into Campaigns & opportunities? *Recommend*: yes; each appears only when the module, kind or data exists.
2. **Where does Accounting live?** *Recommend*: a **Books** tab in Giving (close first, then QuickBooks and donor matching); setup stays reachable from Books and Settings; the module pill row goes.
3. **Who may record a pledge for a family**, and does a large one need a second person? *Recommend*: anyone with `giving.manage`; no second approver (it moves no money); shown in History with a reason; source "manual".
4. **A payment recorded in error**: allow the same person to void it within ten minutes if no deposit or statement uses it? *Recommend*: **no new rule**; keep refund with a second approver, and keep the repeat check.
5. **Export for the treasurer.** *Recommend*: share People's decision: a data-export permission for the treasurer, a fresh 2FA code each time, a watermarked audited file; lists: payments, pledges, bank lines, year-end totals.
6. **Offering counts.** *Recommend*: its own tab, on by default only for kinds that have an offering box; counters stay two adults from different households; match the count to the bank deposit by picking the line, not typing a slip number.
7. **Queue scope.** Show every waiting item to anyone with giving view, or only what they can act on? *Recommend*: only what they can act on, the rest as counts.
8. **Statements.** Build the review and receipt-copy screens now and keep Send off until the statements service exists? *Recommend*: yes; the send button says "Coming next", never a fake success.
