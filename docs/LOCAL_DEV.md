# Run Connect locally

This runs all three apps on your own computer against a local Supabase with made-up JSH
data. Nothing is deployed and nothing leaves your machine. Sign-in codes go to a local
inbox, not to real email.

About 20 minutes the first time (mostly downloads), about 1 minute after that.

## 1. Install once

| Tool | Why | Install |
|---|---|---|
| Docker Desktop | runs the local Supabase | docker.com/products/docker-desktop — start it before step 3 |
| Node.js 22 | runs the apps | nodejs.org (LTS) |
| pnpm | installs app packages | `npm install -g pnpm` |
| psql | loads the demo data | Mac: `brew install libpq && brew link --force libpq` · Windows: the PostgreSQL installer, "Command Line Tools" only |

The Supabase CLI does not need installing; `npx supabase` fetches it.

For the member app on a phone, install **Expo Go** from the App Store or Play Store.
You can also open the member app in a browser instead.

## 2. Get the code

Put all three repos side by side and use the build branch:

```bash
git clone https://github.com/malavsanghvi/connect-crm.git
git clone https://github.com/malavsanghvi/connect-admin.git
git clone https://github.com/malavsanghvi/connect-mobile.git
for r in connect-crm connect-admin connect-mobile; do git -C $r checkout claude/amazing-franklin-ip62z6; done
```

## 3. Start the database and load the demo data

```bash
cd connect-crm
npx supabase start          # applies every migration + seed.sql; first run pulls images
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/demo/demo.sql
```

`supabase start` prints an **API URL** (http://127.0.0.1:54321) and an **anon key**. Keep
them for step 5. `npx supabase status` shows them again later.

Local addresses:

| What | Where |
|---|---|
| Supabase Studio (tables, users) | http://127.0.0.1:54323 |
| Local inbox (your sign-in codes) | http://127.0.0.1:54324 |

## 4. Make yourself a login

Each login is tied to one person. Use made-up addresses such as `admin@jsh.test`; every
email lands in the local inbox whatever the address.

1. Studio → **Authentication** → **Add user** → **Create new user** → enter the email, tick
   **Auto confirm**, any password (it is never used; the apps sign in with codes).
2. Link it to a demo person and give it roles:

```bash
# Staff: sees everything in CRM and Admin
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -v email="admin@jsh.test" -v member="JSH-90009" \
  -v roles="center_admin,treasurer,executive_committee,pathshala_principal,communications_officer,religious_coordinator,store_lead" \
  -f supabase/demo/grant-login.sql
```

Other useful logins (make each user in Studio first):

| Email (suggested) | member | roles | What you see |
|---|---|---|---|
| `priya@jsh.test` | `JSH-90001` Priya Shah | `""` (none) | Member app as a parent: Shah family, kids in Pathshala, Tapasvi Bahuman RSVP and tickets, pledges |
| `teacher@jsh.test` | `JSH-90010` | `teacher` | Admin as a teacher of Jainism 3 only |
| `kiran@jsh.test` | `JSH-90005` Kiran Mehta | `checkin_volunteer` | Admin check-in station for the Tapasvi Bahuman only |

One person has one login: running it again for the same email or the same person replaces
the earlier link and roles. The two-person rule means a second staff login (e.g.
`kiran@jsh.test` with `treasurer`) is needed to approve a refund the admin requested.

## 5. Start the apps

Use the API URL and anon key from step 3.

**Connect CRM** (http://localhost:3000)

```bash
cd connect-crm
cp .env.example .env.local     # set NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 and the anon key
pnpm install
pnpm dev
```

**Connect Admin** (http://localhost:3001)

```bash
cd connect-admin
cp .env.example .env.local     # same two values
pnpm install
pnpm dev --port 3001
```

**Connect Mobile**

```bash
cd connect-mobile
cp .env.example .env.local     # EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY
pnpm install
pnpm start                     # then press w for the browser, or scan the QR code with Expo Go
```

On a real phone `127.0.0.1` means the phone itself, so for Expo Go set
`EXPO_PUBLIC_SUPABASE_URL=http://<your computer's LAN IP>:54321` (e.g. `192.168.1.20`) and
keep the phone on the same Wi-Fi. The browser view works with `127.0.0.1`.

## 6. Sign in

Enter the email, then open the local inbox (http://127.0.0.1:54324) and type the 6-digit
code. CRM and Admin only accept logins that already exist (step 4). The member app also
lets a brand-new address sign up and then walks through "find my family".

## Things to try

- **CRM → Bank**: five Chase lines. The "Zelle Rahul Shah" line suggests two households
  (Shah family and the Rahul & Mira Shah Household) and flags it as ambiguous; the remote
  deposit matches the two recorded checks.
- **CRM → Households → Shah**: JSH member ID `0417`, household `0212`, the old Neon and
  NamoCRM IDs, and the permanent Connect numbers.
- **Admin → Events → Tapasvi Bahuman**: RSVPs, lunch slots, then **Ops → Check-in**. Type
  `demo-ticket-priya` in the scanner box to check Priya in.
- **Admin → Bolis**: one digital boli taking bids and one in-person boli.
- **Admin → Pathshala**: 2026-2027 term, three classes, enrollments.
- **Member app**: family with JSH IDs, member card, tickets, Give, Gyan Path, Jain Way.

## Start over

```bash
cd connect-crm
npx supabase db reset          # wipes local data, re-applies migrations + seed
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/demo/demo.sql
```

Logins are wiped too; redo step 4. `npx supabase stop` shuts everything down.

## What will not work locally

- Card payments (no Stripe), QuickBooks posting, push/SMS/WhatsApp sending: not built yet.
- SMS sign-in: no SMS provider locally; use email.
- Everything else runs against the real schema and access rules, so what a login can see
  locally is what it will see in production.
