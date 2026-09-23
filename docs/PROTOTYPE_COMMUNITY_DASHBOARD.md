# Prototype spec — Public community dashboard

Source: JSH App Prototype artifact › project/CommunityDashboard.dc.html (1280×900). Read in full (215 lines), together with JSH App Prototype artifact › project/canvas.json for board linkage.

---

# Shared context (all four prototypes)

- **Framework**: each page is a `DCLogic` component (`./support.js`). Template directives: `sc-if value="{{flag}}"` (conditional block), `sc-for list="{{arr}}" as="x"` (repeat). All UI state lives in `this.state`; `renderVals()` maps state → template values and click handlers. `hint-placeholder-*` attributes are design-time hints only.
- **Board graph** (JSH App Prototype artifact › project/canvas.json, project "JSH App Prototype"): `Onboarding` → `Main.dc.html` (guest / go home); `Welcome` ↔ `Main` (back, registrations); `GyanPath` ← `Main` (back); `CommunityDashboard` → `Welcome` ("New to JSH? Start here"). `Main`, `Volunteer`, `AdminPortal` exist but were out of scope.
- **Design tokens** (inline, no CSS vars): bg cream `#FBF7F0`, page frame `#EDE6DA`, primary navy `#1B2C5C`, success green `#1F7A4D`, accent orange `#C9731C` / `#E8892A`, amber ink `#8A4608`, error red `#B3261E`, gold `#F2B632`, muted text `#5E5A52`, borders `#E3D9C8` / `#E8E0D2`. Fonts: Fraunces (display), DM Sans (body), JetBrains Mono (dashboard only). Every board carries a fixed "PROTOTYPE · SAMPLE DATA" badge (here: "PROTOTYPE · SAMPLE DATA · NOT LIVE", bottom-right).
- **Touch targets**: buttons are min 44px; primary CTAs 52–54px, 26px radius.

---

# 4. `CommunityDashboard.dc.html` — Public community dashboard (1280×900)

## 4.1 Overview

Public, no sign-in ("open to everyone, no sign-in needed"). On mount it calls `loadAll('ytd')`, which fires **8 parallel GETs** against a mocked REST API with 250–900 ms simulated latency; each panel shimmers (`kShim`) until its response lands. Period selector re-runs all 8 calls.

State: `{ period: 'ytd'|'l12m'|'y2025'|'all', showNet, calls[], sel, data{}, loading{} }`.

## 4.2 API contract (base `/v1/public/centers/{slug}`, slug `jsh`)

| Endpoint | Query | Response shape (sample values at period=ytd) |
|---|---|---|
| `GET /kpis/summary` | `period` | `{center{slug,name}, period, asOf:'2026-09-22', metrics[{key,label,value,delta}]}` — member_families 1 184 "+62 new this year" · community_people 3 920 "+188 this year" · events_held 146 "+14% vs last year" · attendance 28 450 "+9% vs last year" · volunteer_hours 9 820 "412 volunteers" · app_adoption "71%" "Goal 80% by Dec" |
| `GET /kpis/practice` | `period` | `{period, suppressedBelow: 10, metrics[{key,label,value,sub}]}` — samayik 12 340 "48 minutes of equanimity each" · pratikraman 4 210 "At the derasar and on Zoom" · tapasvis 312 "Paryushan and Ayambil Oli" · navkar_malas 48 600 "108 recitations each" · gyan_levels 2 145 "Across 4 learning goals" · anumodana 9 902 "Families cheering each other on" |
| `GET /kpis/campaigns/temple-construction` | — | `{campaign:'New temple construction', raised: 4120000, goal: 10000000, donorFamilies: 684, participationRate: 0.58, largestMonth:'Paryushan 2026', nextMilestone:'Shikhar foundation at $5M'}` |
| `GET /kpis/timeseries` | `metric=attendance&interval=month&period` | `{metric, interval:'month', points[{label, value, partial}]}` — Jan 1840 · Feb 1720 · Mar 2210 · Apr 3120 · May 1980 · Jun 1760 · Jul 1690 · Aug 2340 · Sep 4980 · Oct 3420 · Nov 3890 · Dec 2100; `partial = period==='ytd' && month ∈ {Oct,Nov,Dec}` |
| `GET /kpis/zones` | — | `{zones[{zone, families}]}` — Southwest 260 · West 210 · Northwest 165 · North 140 · South 120 · Central 95 · Northeast 70 (matches the Welcome guide's zone table) |
| `GET /kpis/learning` | `period` | `{metrics[{label,value}]}` — Pathshala students 420 · Volunteer teachers 48 · Class attendance rate "88%" · Children who completed Navkar 96 |
| `GET /kpis/seva` | `period` | `{metrics[{label,value}]}` — Meals served (bhojanshala) 21 300 · Jeevdaya contributions "$38,500" · Families supported (sadharmik) 26 · Satvik Store orders 1 240 |
| `GET /kpis/allocation` | `period`, `basis=cash` | `{source:'quickbooks', basis:'cash', categories[{label, share}]}` — Temple construction .31 · Religious programs .27 · Education and Pathshala .18 · Facilities and operations .16 · Community seva .08 |
| anything else | | `{error:'not_found'}` |

**Period scaling in the mock** (`f`): ytd 1 · l12m 1.28 · y2025 1.19 · all 6.4 (timeseries uses 5.2 for "all"). Scaled = **flow** metrics (events_held, attendance, volunteer_hours, all six practice counters, children-completed-Navkar, all seva values, monthly points). Not scaled = **stock / point-in-time** metrics (member_families, community_people, app_adoption, Pathshala students, teachers, attendance rate, campaign totals, zone counts, allocation shares). Production API should preserve this flow-vs-stock distinction.

## 4.3 Layout & rendering rules

1. **Header**: logo, "JSH Community Dashboard", subtitle "Jain Society of Houston · open to everyone, no sign-in needed", period segmented control: This year (ytd) · Last 12 months (l12m) · 2025 (y2025) · All time (all).
2. **Headline** "Our community · {period label lowercase}" + "Updated {asOf} · refreshed nightly" (or "Fetching latest numbers…").
3. **Summary row** — 6 KPI tiles (label, value formatted `toLocaleString('en-US')`, green delta line).
4. **Practicing together** — "From My Jain Way and Gyan Path · totals only"; 6 tinted tiles (per-index tint/ink pairs).
5. **Temple construction** — `$X.XXM of $YM goal`, orange progress bar `round(raised/goal×100)%`, stats: % of goal · donor families · member participation `round(participationRate×100)%`; "Next milestone: …".
6. **Attendance by month** — "Check-ins at all events and Pathshala"; 12 bars, height `max(6, round(value×160/max))px`; **partial months** render as a 4px grey stub with no value label; **September highlighted orange** (Paryushan); values ≥1000 shown as `N.Nk`. Note: ytd → "September peak: Paryushan Mahaparva. Later months fill in as the year goes on."; otherwise "Seasonal peaks follow Mahavir Janma Kalyanak, Paryushan and Diwali."
7. **Families by zone** — 7 horizontal bars scaled to the largest zone (`round(families×100/max)%`), ordered descending.
8. **Pathshala and learning**, **Seva and community care** — 4 label/value rows each.
9. **Where contributions go** — stacked bar + legend from `share`, fixed colour order `[#C9731C, #1B2C5C, #5B4B8A, #8A8478, #1F7A4D]`; caption "From the audited books (QuickBooks), shared at the EC's discretion".
10. **Footer banner** — "Be part of these numbers" / "Everything here is aggregated. Groups smaller than 10 are hidden, and no individual is ever shown." CTA `New to JSH? Start here` → `Welcome.dc.html`.

Loading placeholders: summary/practice render 6 shimmer tiles ("Loading…", "—"), learning/seva 4 rows, months 12 grey 60px bars labelled J F M A M J J A S O N D, zones 7 rows at 50%, allocation a single full-width grey segment, campaign "—" values and "…" milestone.

## 4.4 KPI definitions (as expressed in labels/subs)

| Key | Definition |
|---|---|
| member_families | Count of member families (stock); delta = new this year |
| community_people | Individuals across member families (stock) |
| events_held | Events in period; delta YoY % |
| attendance | Event + class **check-ins** (visits, not unique people); YoY % |
| volunteer_hours | Seva hours logged in period; delta shows distinct volunteers |
| app_adoption | % of families on the app; target 80% by December |
| samayik | Samayiks completed (48 min each) — from My Jain Way |
| pratikraman | Pratikraman attendances (derasar + Zoom) |
| tapasvis | Tapasvis honoured (Paryushan, Ayambil Oli) |
| navkar_malas | Malas counted (108 recitations each) |
| gyan_levels | Gyan Path levels completed across 4 goals |
| anumodana | Anumodanas (cheers) sent between families |
| campaign | raised, goal, donor families, participation rate = donor families ÷ member families (684/1184 ≈ 0.58), largest month, next milestone |
| learning | students, volunteer teachers, class attendance rate, children who completed Navkar |
| seva | meals served, Jeevdaya $, sadharmik families supported, Satvik Store orders |
| allocation | cash-basis shares from QuickBooks, 5 categories summing to 1.00 |

## 4.5 Privacy / governance rules visible

- **k-anonymity**: `suppressedBelow: 10` on the practice payload and the banner "Groups smaller than 10 are hidden, and no individual is ever shown" — any cell with n < 10 must be suppressed server-side; only totals are exposed.
- Financial allocation is published only at the Executive Committee's discretion, cash basis, from audited books.
- Data is refreshed nightly (`asOf` date), not real-time.

## 4.6 Prototype notes

- A **network inspector** is half-built: state (`showNet`, `calls` capped at 30, `sel`) and renderVals (`toggleNet`, `netLabel`, `calls[]`, `selectedBody`) exist, but no markup renders them — dead code, safe to drop or finish.
- `api()` builds URLs with `encodeURIComponent` query strings and routes on `path.endsWith(...)`; there is no error path in the UI for `{error:'not_found'}` or network failure (panels would shimmer forever).
