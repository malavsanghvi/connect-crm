# Prototype parity: gap list and plan

The owner's direction (2026-09-24): the member app and the admin portal must look and behave
exactly like the prototypes in `docs/handoff/prototypes/source/`, screen by screen, field by
field, click by click. The product brand is **Community Connect** everywhere; the community
(Jain Society of Houston, JSH) is the tenant. **Pathshala is a module of the one admin portal.**

The full audit (read-only, every element marked match / differs / missing / extra, with file and
line references) is in [`docs/parity/`](parity/):

| Report | Prototype | App today |
|---|---|---|
| [m1-home-events](parity/m1-home-events.md) | Main › Home, Events (Upcoming, Calendar, Photos), RSVP, tickets, confirm, feedback, notifications | connect-mobile |
| [m2-give-store](parity/m2-give-store.md) | Main › Give, opportunities, bolis, pledges, recurring, labh, pay, Satvik Store, cart | connect-mobile |
| [m3-learn-gyan](parity/m3-learn-gyan.md) | Main › Jain Way (Today, Learn, Saathi, Library), pachchakhan, Niva; GyanPath | connect-mobile |
| [m4-family-onboarding](parity/m4-family-onboarding.md) | Main › Family, profile, card, special days, settings, shell; Onboarding; Welcome; Volunteer | connect-mobile |
| [p1-shell-people-settings](parity/p1-shell-people-settings.md) | AdminPortal › shell, login, Home, People, Settings, Platform, brand strings | connect-crm |
| [p2-events-bolis-store-calendar](parity/p2-events-bolis-store-calendar.md) | AdminPortal › Events, Bolis, Satvik Store, Calendar | connect-admin → move |
| [p3-giving-accounting-reports](parity/p3-giving-accounting-reports.md) | AdminPortal › Giving, Accounting, Reports; CommunityDashboard | connect-crm |
| [p4-pathshala-content-comms](parity/p4-pathshala-content-comms.md) | AdminPortal › Pathshala, Content, Communications | connect-admin → move |

## The big differences

1. **One admin portal, not two apps.** The prototype is a single portal: a white sidebar with 14
   modules (Home, People, Events, Giving, Bolis, Satvik Store, Pathshala, Content, Calendar,
   Communications, Accounting, Reports, Settings, Platform), in-page tabs per module, a right-hand
   drawer for records, confirmation/step-up modals and toasts. Today the admin side is split into
   connect-crm (navy grouped sidebar, one page per item, no drawers/modals/toasts) and
   connect-admin. **connect-crm becomes the portal; connect-admin's modules move in; connect-admin
   is retired once everything has moved** (owner to confirm the retirement).
2. **Look and feel.** Both apps use the right fonts (Fraunces + DM Sans) and palette, but differ in
   component shape: header buttons, left-aligned titles, chips, pill buttons, tables, KPI tiles,
   card styles, the Jain Way tab icon, and the tab bar staying visible on sub-screens.
3. **Whole screens missing.**
   - Member app: Niva chat + floating button; Photos (albums, viewer); Birthday labh;
     New recurring gift; Gyan Path goals map / one-step lesson / level-complete; Saathi celebrate
     and support cards; notification tap routing and the in-app confirm pop-up; volunteer
     "confirm who is here"; most of the New-to-JSH guide.
   - Portal: Home "My tasks"; People list, directory, voting eligibility, household/person edit,
     merge; Settings as 8 tabs (Rules form, roles editor, integrations, onboarding fields,
     notifications, security); Platform; opportunity builder; labh fulfillment; month-end close;
     bhandar counting; receipt templates; public community dashboard; event live check-in
     dashboard and feedback results; in-person boli upload; content approval queue, Gyan Path,
     library, albums, Niva, legal & waivers; calendar layers; newsletter one-screen flow.
4. **Payments.** Every "Pay" in the prototype opens a pay sheet → saving → thank-you. Card
   payments are not built (no payment provider yet), so the app shows an honest "pay at the office
   or by Zelle" notice. The screens will be built to the prototype; the charge itself waits on the
   payment backend.

## Plan (in order; each step ships as PRs, merged when checks pass, and deploys)

1. **Foundations.**
   - Community Connect branding in all three apps.
   - Exact prototype tokens and components: header, tab bar, chips, buttons, cards, tables,
     tabs, KPI tiles, toggles.
   - Portal: shell (white top bar, flat sidebar, role footer), drawer, modal and toast primitives.
2. **Portal modules**, in prototype nav order.
   - Move each module from connect-admin while bringing it to the prototype: Home tasks,
     People, Events, Giving, Bolis, Store, Pathshala, Content, Calendar, Communications,
     Accounting, Reports, Settings, Platform.
3. **Member app tabs** in prototype order: Home, Events, Give, Jain Way (+ Gyan Path, Niva),
   Family (+ onboarding, guide, volunteer).
4. **Retire connect-admin** after its last module has moved (owner confirms).

## Decisions taken by default (owner can overrule)

- App-only features the prototype lacks are **kept** and placed where the prototype would put them:
  - Pathshala terms, enrollments, attendance and teacher view: Pathshala tabs.
  - Committee (EAMS replacement): a Pathshala tab.
  - General surveys: Events › Feedback.
  - Alerts: Communications.
  - Inbox replies, manual check-in code entry.
- Where the prototype hard-codes "JSH", the app shows the community's own short name. For example
  "JSH points" → "{community} points".
- The product name is never used as an ID prefix: "Connect JSH-10421" becomes "Member no. JSH-10421".
- Payment-dependent screens are built to the prototype with an honest "online payment is being set
  up" step until the payment provider is connected.
