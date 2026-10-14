# The faith-based demo with QuickBooks: the whole sequence

One demo community, **Sunrise Jain Temple (Demo)** (slug `sunrise-jain-demo`, a Jain Center), made of invented people, with one demo
person for each of the 26 roles, and connected to its own **QuickBooks sandbox company**. It starts over every night; its QuickBooks
connection and account mapping do not (0785). The machinery is the demo communities of B88 ([DEMO_SIGNIN.md](DEMO_SIGNIN.md),
migrations 0627-0629, 0678-0679); this page adds the QuickBooks half and the order to do everything in.

## Two decisions (and why)

1. **Do not rename the JSH sandbox into the demo.** JSH's community is a sandbox that its staff also use for their own records
   (0500: "JSH is the first sandbox that is also in use"). A demo community is flagged `rules.demo`, wiped and reloaded every night
   (`app.demo_populate`), shown to anyone who presses *Try the demo*, and takes the demo people's sign-ins. Renaming JSH into it would
   delete JSH's records at the next reset and show them to visitors. The faith demo already exists as code and is separate from JSH.
2. **Give the demo its own QuickBooks sandbox company**, not JSH's (`Sandbox Company US dd17`). Two communities on one company share
   a chart, items and classes, mix their test receipts, and compete for the same sign-in. Creating another sandbox company in the
   same Intuit developer account is free and takes a minute.

## What is built, and what is left

| | |
| --- | --- |
| Built | The pack `demo_faith_jain_v1` (13 households, 34 people, 18 pledges, 14 test-mode payments, 4 events with 20 RSVPs, a store with 5 items and 4 orders, 2 alerts and 3 campaigns, 4 volunteer groups, a Pathshala term with 7 enrolments); the 26 demo people; the sign-in at `/demo`; the nightly reset; QuickBooks in a sandbox community (connect, pull, map, test post, poster). |
| Built in this change (0785) | The reset keeps the QuickBooks account mapping and its approvals, and puts each fund's QuickBooks class (and each bank account's QuickBooks account) back on the freshly loaded rows. Before it, the connection survived but the mapping did not, so the poster stopped after the first night. |
| Not done by anyone yet | The demo community has not been created (Platform › Setup says *Demo communities: 0*), the sign-ins are not set up, the switch is off, and no QuickBooks company is connected to it. These need you (a reason and a fresh 2FA check each; a person I cannot be). |
| Not built | Books sample data in the pack: no bank account, bank lines, bolis or recurring gifts. The 14 payments are history ("already in your books") and are never posted to QuickBooks. See "More sample data" below. |

## The sequence

### 0. Merge the change (Claude, with your OK)
PR "A demo community keeps its QuickBooks setup across its reset" (migration 0785 + test 183 + this page). It changes what a demo
reset deletes, so it waits for your OK. Nothing below needs it until the first reset after QuickBooks is connected, but do it first
so you never see the "connected, but not posting" state.

### 1. Intuit: a sandbox company for the demo (you)
1. <https://developer.intuit.com> › sign in › **My Hub › Sandboxes** › **Add sandbox company** (country US, QuickBooks Online).
   Name it so you can tell it apart, e.g. *Weaver Demo - Sunrise Jain Temple*.
2. Open it (**Open** in the Sandboxes list) once, so the company is fully created.
3. In that company: **Settings › Account and settings › Advanced › Categories › Track classes: On** (one class per transaction),
   then **Settings › All lists › Classes › New**: `General fund`, `Temple building`, `Pathshala`. The mapping step lets you tag each
   fund with a class; it is optional, but a demo that shows funds reaching QuickBooks as classes is the point.
4. Nothing to change in the Intuit app itself: the one Weaver app, its Development keys and the redirect URI
   `https://admin.weaverams.org/api/oauth/intuit/callback` are already in place (the JSH sandbox connected through them).

### 2. Create the community (you; Platform › Setup › Demo sign-in)
1. <https://admin.weaverams.org/platform/setup> › **Demo sign-in** › **Create the faith-based demo** (reason + fresh 2FA code).
   Check the page now says *Demo communities: 1* and *26 demo people*.
2. Leave **the not-faith demo** for later unless you want it now (the same button; Lakeside Neighbors Club).

### 3. Give yourself a role in it (you; Supabase › SQL Editor, once)
A platform admin sees every community in the switcher, but connecting QuickBooks is deliberately not a platform shortcut
(`app.qbo_can_connect`: the owner, or a role grant in *that* community with `accounting.manage` or `integrations.manage`), and the
Roles screen can only grant to a person who is in the community. So grant it directly, as a bare grant with no person:
```sql
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason)
select c.id, u.id, 'treasurer', 'center', 'Platform owner connects QuickBooks to the demo'
  from app.centers c, auth.users u
 where c.slug = 'sunrise-jain-demo' and lower(u.email) = 'malav.sanghavi@gmail.com';
```
- **Treasurer** carries `accounting.manage` and `giving.approve`. Do **not** grant Center admin: the first active administrator becomes
  the owner, and the owner of the demo should be the demo administrator (Asha Varma) once sign-in is on.
- **Do not make yourself a person in the demo** (`app.bootstrap_first_admin`, a join code): a reset restarts member and household
  numbers at the beginning (`app.demo_populate`) and a kept real person's number could collide with a new one. A grant without a
  person is not kept as a person and cannot collide.
- Your grant survives every reset (`role_grants` is kept); the demo people's grants are taken apart and rebuilt each night.

### 4. Connect QuickBooks in the demo community (you; Accounting › QuickBooks setup)
The screen numbers its steps. It is the same flow as the JSH sandbox (docs/DEPLOY.md, memory of 2026-10-14):
1. **Connection** › Connect (Intuit sandbox company) › a reason, fresh 2FA › Intuit asks you to sign in and choose the company:
   choose the **new** one. You come back to the page; the *Company* and *Company id* appear after the background service finishes
   the exchange (about a minute).
2. **Accounting basis**: **Cash** (accrual posting is not available yet).
3. **Chart of accounts and lists**: wait for the first pull (the lists fill in; *Pull now* if not).
4. **Posting and go-live date**: per transaction; **go-live date = today**. Money received before that date never posts, and a demo
   visitor's gift is dated the day they record it.
5. **Account mapping**: the required accounts (income, bank, undeposited funds, payment clearing, merchant fees, store sales, sales
   tax) **and the three funds**: *General* → income account, *Temple building* → construction income, *Pathshala* → Pathshala
   income; and a class for each fund (Funds → QuickBooks classes). A fund's income account needs a QuickBooks item (Product/Service)
   that books to it; the Intuit sandbox has a *Services* item you can use, or add one per fund in QuickBooks.
6. **Approve the mapping** (the treasurer role you just took), then **Test post** (a $1.00 sales receipt, refund receipt, deposit and
   journal entry) and approve it.
7. **Go-live readiness, check 7: Ready.** From now on the poster sends any gift recorded in the demo to the sandbox company.

Do this **before** the first nightly reset if you can; if a reset comes first, nothing is lost: the community is rebuilt, and the
mapping you do afterwards survives all later resets.

### 5. Sign-ins and the switch (you; Platform › Setup › Demo sign-in)
1. Check Supabase Auth once, as listed in [DEMO_SIGNIN.md](DEMO_SIGNIN.md#to-turn-it-on-owner-once): *Single session per user* **off**,
   *Secure email change* **on**, manual identity linking **off**, phone auto-confirm **off**, captcha **off** for password sign-ins.
2. **Set up the sign-ins** (reason + fresh 2FA): one real Auth user per demo person on `…@demo.weaverams.org`, a random password
   in the Vault that no one sees.
3. **Turn the demo on.** Open `https://admin.weaverams.org/demo` in a private window.

### 6. Check it (Claude can drive the browser with you; a fresh private window)
| Check | Expect |
| --- | --- |
| `/demo` shows *Sunrise Jain Temple (Demo)* with its people | 26 people, the administrator first |
| Start as **Asha Varma** (Center admin) | Banner "You are exploring a demo community as Center admin"; Settings, People, Roles open |
| Start as **Meera Doshiwal** (Treasurer) › Giving › record a $25 gift | It appears in QuickBooks (the demo's sandbox company) as a sales receipt within about a minute, tagged with the fund's class |
| Platform › Setup › Demo sign-in › **Start “Sunrise Jain Temple (Demo)” over** (or wait for 3 a.m. community time) | The community is rebuilt; **Accounting › QuickBooks setup** still shows *Connected*, mapping approved, check 7 *Ready* |
| Record another gift after the reset | It posts again |

## The 26 demo people

Each signs in only through *Try the demo*; the address is `<role>.sunrise@demo.weaverams.org` with the role's underscores as hyphens, for
example `center-admin.sunrise@demo.weaverams.org` (nobody receives mail there; the password is in the Vault and never shown).

| Role | Person | What they can do |
| --- | --- | --- |
| Center admin (**the demo administrator**) | Asha Varma | Looks after the whole organization: settings, people, roles, connections |
| Executive committee | Rohit Varma | Edits people-level information, approves memberships, reads reports |
| Executive viewer | Kavita Rathore | Looks at dashboards and reports, changes nothing |
| **Treasurer** | Meera Doshiwal | Records and refunds gifts, matches the bank, QuickBooks mapping, closes each month |
| Finance volunteer | Kiran Doshiwal | Records offline gifts and matches bank lines; cannot refund |
| Membership coordinator | Hemant Parmar | Families and memberships, new-family checks, approvals |
| Religious coordinator | Bharat Kataria | Religious calendar, bolis, practice catalog |
| Communications officer | Pooja Salecha | Announcements, newsletters, templates, shared inboxes |
| Content editor | Nikhil Salecha | Writes guide pages and photos (waits for approval) |
| Privacy officer | Falguni Singhvi | Export/delete requests, reads the audit log |
| Volunteer coordinator | Dipak Singhvi | Volunteer groups, shifts, waivers |
| Event lead | Sanjay Lunawat | Runs one event (Tapasvi) |
| Check-in volunteer | Riya Lunawat | Scans tickets at that event; sees no giving |
| Kitchen lead | Vijay Bhandari | Headcounts and prep lists |
| Store lead | Sunil Nahar | Menu, pickup times, orders, stock |
| Store pickup | Rekha Nahar | Hands out store orders |
| Boli recorder | Sarla Kataria | Calls the bolis at that event |
| Pathshala principal | Deepa Chopda | Terms, classes, levels, teachers |
| Pathshala committee | Manish Chopda | The Pathshala year's checklists and resolutions |
| Teacher | Anita Bhandari | Attendance and progress for one class |
| Zone lead | Lalit Rathore | One zone's inbox, contacts and reports |
| Community member | Priya Wadhwa | Has an account, not a member yet |
| Membership reference | Kusum Parmar | Vouches for newcomers |
| Primary adult | Tarun Patni | Manages a family: household, children, payments, RSVPs |
| Adult member | Nisha Patni | The other adult of that family |
| Child | Zara Singhvi | Events and learning only; no pledges or payments |

## More sample data (not built; say what you want)

The pack covers people, memberships, events, the store, Pathshala, notices and volunteers well, and giving thinly. If the demo
should also show, say, **bolis, recurring gifts, a bank statement to match, Zelle and check deposits, pledges due this month,
Gyan Path, WeCare or CatchTheMatch**, they are added to the pack builder (`supabase/scripts/build-demo-packs.mjs`, then a new
migration, the pack version bumped). Two rules to keep it honest and the QuickBooks story simple:
- History stays history: pack payments are `is_historical` and never post. A demo that wants *posted* entries on first view needs
  real postings, and a real posting creates a real receipt in the sandbox company every night. Prefer "the treasurer records a gift
  live" (step 6) over seeded postings.
- Sample bank lines are fine (a statement imported, some matched, some waiting); nothing posts until a line is confirmed.

## Housekeeping

- The nightly reset deletes the demo's gifts, but the sandbox company keeps the receipts they made. Void them in QuickBooks now and
  then, or delete the sandbox company and make a new one (then step 4 again).
- To start QuickBooks over for the demo: *Disconnect* in QuickBooks setup (reason + 2FA), then step 4 with the same or a new company.
  Switching to a different company withdraws the approvals and asks for the mapping again, by design (0779).
- The Intuit **Development** keys serve sandbox companies only. A real QuickBooks company needs Intuit's production review first.
