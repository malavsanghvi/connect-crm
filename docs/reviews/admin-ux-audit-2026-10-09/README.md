# Admin portal UX audit (2026-10-09)

Six read-only reviews of every page of the admin portal, one section per screen: who uses it, the real jobs, the friction, what a conversational assistant could do (read or write, which RPC, whether it needs a confirmation), and what must stay visual. They were written from the code; the app was not run, so a few findings (marked "read from code") should be reproduced before they are fixed. One has been: the store stock adjustment, fixed in #128.

Summary and plan: [../../ADMIN_REDESIGN.md](../../ADMIN_REDESIGN.md). Backlog: B78 to B83.

| Report | Covers |
|---|---|
| [01-home-people.md](01-home-people.md) | home, shell, people, households, identifiers, memberships, search, account, privacy, audit, approvals |
| [02-money.md](02-money.md) | giving, accounting, bolis, store, reports |
| [03-events-community.md](03-events-community.md) | events, calendar, comms, content |
| [04-pathshala.md](04-pathshala.md) | pathshala |
| [05-settings-setup.md](05-settings-setup.md) | settings, setup |
| [06-platform.md](06-platform.md) | platform console (Weaver team) |

Their pre-0594 parity notes in `docs/parity/` are stale in places (they call Month close, the Opportunity builder, Labh, Bolis and Store "missing"); these reports reflect the code as of 2026-10-09.
