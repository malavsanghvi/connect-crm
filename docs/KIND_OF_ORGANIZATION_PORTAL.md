# Kind of organization in the portal

How the portal (connect-crm) chooses, shows and follows an organization's **kind** (the database and the plan call it a category, the owner calls it an experience; the screens say "Kind of organization"). The database side is in [MODULES.md](MODULES.md) (0594) and the experiences migrations (0600 onward); the plan is [ORGANIZATION_CATEGORIES_PLAN.md](ORGANIZATION_CATEGORIES_PLAN.md).

## Choosing and changing the kind (Portal 1)

Owner direction 2026-10-08: the platform is for every kind of community (a Jain temple, a church, a chamber of commerce,
a club, a non-profit, a neutral organization), and a kind is **data**: a catalog row with its module defaults and wording
terms. The UI says **"Kind of organization"** (the database and the plan say category / experience).

| Where | What the portal does |
|---|---|
| Platform › New sandbox | One two-step picker built from `app.list_experiences()` (Faith-based › tradition › the kind, or Chamber of commerce / Club / Non-profit / Neutral …). It is the only choice that shapes the sandbox; it is sent as `p_category_key`. A sandbox may preview a kind that is not switched on for live organizations yet. |
| Platform › Requests | The applicant's "Kind of organization" stays a hint and pre-selects the picker; Weaver must choose the kind to approve (`app.set_access_request_category`, then `decide_access_request`). |
| Platform › Centers, a center's page | The Kind column; the page's **Kind of organization** card: the current kind, **Change…** with a preview from `app.category_change_preview`, a reason, and a fresh 2FA check (`app.set_center_category`). Nothing is deleted; changing back restores everything. |
| Platform › New center (legacy wizard) | The kind is chosen at step 1, when the center is created (the database refuses a plain update of it afterwards); step 2 asks for a tradition only when the kind keeps one. Only kinds switched on for live organizations are offered. |
| Settings › Modules | Rows come from `app.module_states`: a module the kind never offers is listed last, greyed, "{Module} is not part of a {Kind} organization", with no switch; a module the kind starts off says so and keeps its switch. A kind with every module on (a Jain Center) reads exactly as before. |
| The module gate | A direct link to a module the kind never offers says "{Module} is not part of a {Kind} organization" (no link to a switch that does not exist); a module the organization switched off reads as before. |
| The session | `session.kind` (from `app.category_profile`): the kind's name, wording terms and module availability, loaded once per request. If the database cannot answer, `LEGACY_KIND` (a Jain Center, today's words) is used so the live organization never changes because of a hiccup; a test pins it to the 0594 seed. |
