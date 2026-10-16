# CRM navigation and filters: Option A (adopted 2026-10-16)

Owner request, 2026-10-16: move every workspace menu into the top bar (with a **More** menu for what does not fit), move the sub-menu to the left as a collapsible, scrolling section list, and shrink the filters. Giving's first screen is about 60% menus and tiles before the first row.

Design canvas (6 boards, sample data): https://claude.ai/artifact/36MJnv9ud5RcJ68E9hyTiG

Status: **Option A adopted by the owner on 2026-10-16 ("build and deploy").** Slice 1 (top bar, More, left panel) is built; slices 2 to 4 follow, each its own PR. Defaults taken from section 9: the left panel starts open from 1280px wide and each person's choice is remembered; Today, People, Giving, Events and Messages come first in the bar and the rest go under More as space runs out; it ships in the existing New look first.

As built in slice 1, where it differs from the text below: under 1024px the pages keep their own tab rows instead of a drawer behind a menu button; the collapsed strip shows two-letter marks (icons come later); Giving Today keeps its tab row because it carries the counts; Settings is the gear in the bar and Platform is in the account menu.

## 1. Where the first screen goes today (Giving › Pledges, 900px tall)

Estimated from the owner's screenshot; slice 1 measures the real numbers.

| Block | px |
|---|---|
| Top bar | 64 |
| Page title and description | 88 |
| Giving tab row | 52 |
| Card title and status chips | 56 |
| Search, Campaign, Pledged in form | 92 |
| "Behind by" chips | 48 |
| Tiles and aging | 110 |
| **Chrome** | **510 (57%)** |
| Table | 390 (43%) |

The classic look puts a 60px bar over a 220px sidebar of modules and a tab strip per module; the New look puts an 88px rail of 11 workspaces and one tab row for Giving (`src/components/shell/shell-v2.tsx`, `module-tabs.tsx`). Both spend a full row on the page title and another on the tabs. The Pledges filters are a labelled form (`Campaign`, `Pledged in`, `Apply`, `Clear`) plus chip rows.

## 2. What both options share

- **Top bar, 48px.** Logo, organization switcher, the workspaces from `src/lib/workspaces.ts` as text, **More**, search (Ctrl K), Niva, gear, avatar. Settings and Platform (placement `end`) move under the gear and the avatar. The workspace map and who sees what do not change.
- **Overflow.** Items that do not fit go into More in workspace order. The open workspace always stays visible (it swaps in for the last visible item). Measured with a `ResizeObserver`. More is a button with a menu (arrow keys, Esc, announces how many it holds).
- **Left panel.** The open workspace's sections, in collapsible groups, scrolling on its own. Expanded 232px (A) or 280px (B); collapsed 56px icon strip with name on hover and focus; Ctrl B toggles; remembered per person (cookie, like the look choice). Starts collapsed under 1280px; a drawer under 1024px. The phone bottom bar is untouched.
- **Page title.** One line: title, a count, the page's actions on the right. The long description moves to a tooltip or the page's help.
- **Totals and aging.** The tile row and the "Behind by" chips become one summary line (A) or a facet plus a thin bar (B). Aging buckets filter the list.
- **Filters in the address.** As today, so Back, refresh and a pasted link still work.

Left sections need grouping. Today a module's tabs are a flat list in `NAV` (`src/lib/permissions.ts`). Slice 1 adds an optional `group` to a tab (for example Giving: Overview, Money in, Bank and books, Campaigns, Donors); an ungrouped tab shows flat. `visibleNav`, `canOpenTab` and the workspace coverage test keep deciding what a person can open.

## 3. Option A: filter chips on top (Neon-like)

- White top bar, navy underline on the open workspace. Left panel 232px.
- On a record (household) the left panel **swaps** to that record's sections with a back link, as Neon's account record does.
- One filter line above the table: search, status switch with counts, Campaign, Pledged in, Behind by, + Filter, Saved views, Clear. A filter that is on shows its value in its chip.
- First screen: about 23% chrome, 16 rows visible. Costs 232px of width.

## 4. Option B: filters in the left panel

- Navy top bar. Left panel 280px with Sections on top, then **Views and filters** for the open list: saved views with counts, then facets with checkboxes and counts (Campaign, Pledged in, Behind by).
- On a record the panel **keeps the workspace tree** and nests the record's sections under it.
- Main area: title, search and applied-filter pills on one line; aging as a 6px bar on the table.
- First screen: about 13% chrome, about 780px of table. Costs 280px of width. When the panel is collapsed, the facets move into a Filters drawer with a count badge.

## 5. Comparison

| | A | B |
|---|---|---|
| Vertical chrome | 23% | 13% |
| Horizontal cost | 232px | 280px |
| Filters visible without opening | yes, on the line | yes, in the panel (not when collapsed) |
| Facet counts per option | no | yes: needs a count query per list |
| Works on a short laptop | yes | panel scrolls |
| Familiar to Neon users | yes | partly |
| Work per list | one shared toolbar | toolbar plus facet counts per list |

## 6. Recommendation

Build **A** everywhere, then add B's facet panel as an optional "More filters" drawer on the lists that need it (Payments, Bank reconcile, People). A fixes the 60% problem on every screen with one shell change and one toolbar component, and only the lists that gain from counts pay for them.

## 7. Slices (after approval; each is its own PR, behind the existing New look switch first)

1. Shell: 48px top bar with More, left section panel (collapse, group, scroll, remembered), `group` on tabs. Retires the 88px rail in the New look. Tests: workspace coverage, overflow ordering (open workspace kept), nav gating unchanged.
2. Shared one-line list toolbar (search, status switch, filter chips, + Filter, Saved views, active-value chips) on Giving › Pledges and People › Households; the summary line replaces tiles and chips.
3. Record pages with left sections (household first, then person).
4. The remaining workspaces' lists onto the toolbar; Settings left tree (about 30 pages) grouped.
5. Remove the classic sidebar and the look switch once the owner is happy.

No database change in any slice. Option B's facet counts would add read-only RPCs per list, to be planned separately.

## 8. Risks

- Hidden items: More hides workspaces, so the pinned list and the open-workspace rule matter. A wrong default makes a daily workspace two clicks away.
- Collapsed panel plus a filter in the panel (B only) hides state; the badge on the Filters button is the answer.
- Permissions: the bar and the panel only read what `visibleNav` already returns; RLS stays the enforcement. A restricted area still says "You don't have access to this area".
- Accessibility: the bar is a `nav` with real links, More is a menu button, the panel is a `nav` with a collapse button that has a label; chips are buttons with the value in their name.

## 9. Decisions needed from the owner

1. A, B, or A with B's drawer later (recommended).
2. Left panel starts expanded and the choice is remembered per person.
3. Which workspaces stay pinned in the bar when space is tight (suggested: Today, People, Giving, Events, Messages).
4. Roll out behind the New look switch first, then make it the only look.

## 10. Shipped 2026-10-16, and what is left

Shipped, each as its own PR: slice 1 (#316) the top bar with More and the left section panel; slice 2 (#317) the one-line toolbar on Giving › Pledges, Giving › Payments and People › Households; slice 3 (#318) a household's own sections in the panel with the way back; slice 4 (#320) headings for Settings, Content, Messages and the school, and Giving › Bank, Counts and Statements on the toolbar pieces.

Left, each its own piece of work:

- **Saved views and the + Filter picker.** Both need somewhere to keep a person's choices (a table with its own access rules) and extra query fields per list. Ask the owner before building.
- **The other lists' own chip rows and filter forms** (Events, People lists other than Households, Store, Messages, Content). They keep their old controls; move them onto the toolbar pieces (src/components/list-toolbar) one list at a time.
- **Option B's facet drawer** (a "More filters" panel with counts) on Payments, Bank reconcile and People: one read-only count query per list.
- **Under 1024px** the pages keep their tab rows; a drawer for the panel is still to do. The collapsed strip shows two-letter marks; icons are still to do. Counts on panel items (Payment confirmations waiting) are still on Giving Today's row only.
- **Records.** Only the household registers sections with the panel (src/components/shell/record-nav.tsx). A person's own page, and other records, can do the same. The panel shows the workspace list for a moment before a record page registers, because the registration happens after the page loads in the browser.
