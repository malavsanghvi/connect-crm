# Access levels

Who can use each area of the member app, per community. Built from the owner's request of 2026-10-02:
*"make darshan and puja available without login too. Give control at each of such areas to what level of
access one should have to be able to use the feature. Life member / community member / public... those
levels also would be different for different organizations."*

Schema and rules: `supabase/migrations/0586_access_levels.sql` · tests: `supabase/tests/71_access_levels_test.sql`,
`tests/access.test.ts`, `tests/access-render.test.ts` · portal: **Settings › Access levels**
(`src/app/(app)/settings/access/`) · pure helpers: `src/lib/access.ts`. The member app reads the result
with one call, `app.feature_access_for_me(center)`.

## The model

### Levels

Each community has an **ordered ladder**. A person's level is the **highest-ranked level whose rule they
meet**, separately in every community (someone in two communities has two levels).

| Level | Rank | Who is at it | Can the community change it? |
|---|---|---|---|
| **Public** (`public`) | 0 | Anyone: not signed in, or signed in but not linked to this community | Its name only |
| **Community member** (`community`) | 10 | Signed in **and** linked to this community (`center_users`) | Its name only |
| Membership levels | 20 and up | A household with an **active membership** of a tier or a membership type named by the level's rule | Everything: add, rename, re-order, change the rule, remove |

Every community starts with two membership levels: **Member** (rank 20: a yearly or life membership) and
**Life member** (rank 30: a life membership). They are ordinary levels: rename, change or remove them.

A membership level's **rule** names membership **tiers** (`community`, `yearly`, `life`: the platform's
`app.membership_tier`) and/or this community's membership **types** (`app.membership_types.key`, for example
`senior_yearly`). The level is met when the household has an active membership of any of them.

What counts as an active membership (`app.my_access`):

- `status = 'active'` and today between `starts_on` and `ends_on` (an open end counts), **today being the
  community's own date** (`centers.time_zone`), so the last day counts to the end of that day.
- **Lapsed, ended, pending, suspended and not-yet-started memberships never count.**
- **The household shares it**: children, spouses and other members of a household who have a login are at
  the household's level. Someone who left the household (`left_at`) is not. A person in two households gets
  the highest of them.
- Another community's memberships never count.
- **While the Membership module is switched off, nobody counts as a member** (its data is switched off), so
  everyone linked is at the community level. The settings page says so.
- Staff and platform admins are judged like anyone else, by their own link and household, not by role. (They
  pass the staff policies of each table separately.)

### Areas

`app.access_features` is the platform's catalog. Each area has a **default level**, a **floor** (the lowest
level a community may choose), the **module** it belongs to and where it is **enforced**. A community's own
choice is a row in `app.center_feature_access`; **no row means the catalog default**.

| Area (`key`) | Label | Default | Floor | Module | Enforced by |
|---|---|---|---|---|---|
| `darshan` | Live darshan | Public | Public | Content & library | **database** |
| `puja` | Virtual puja | Public | Public | Gyan Path | app |
| `timings` | Today's timings | Public | Public | none | app |
| `guide` | New to the community guide and directory | Public | Public | none | app |
| `listen` | Stavans, podcasts and playlist | Community member | Community member | Content & library | app |
| `look` | Videos and recipes | Community member | Community member | Content & library | app |
| `learn` | Gyan Path lessons and progress | Community member | Community member | Gyan Path | app |
| `niva` | Ask Niva | Community member | Community member | Niva assistant | app |

- **Defaults are today's behaviour**, except `darshan` and `puja`, which become public (the owner's request).
  Before this change a guest could not watch the live stream.
- **Floors**: listen, look, learn and Niva can never be opened to the public, because their files are
  members-only in storage and their data is personal. The database refuses a choice below the floor and
  ignores one that somehow got into the table (it is lifted to the floor).
- **An area is off while its module is off** (`reason: "module_off"`), whatever level is chosen.
- **Money and personal areas are not in the catalog and are not configurable**: giving, RSVP, the store,
  family, Pathshala and the directory always need at least a signed-in community member.

### Who may use an area

`app.can_use_feature(center, area)`: **false** when the area's module is off, otherwise **true when the
caller's level rank is at least the area's minimum rank**. It is the member-facing rule: staff are not special
in it (a policy adds a staff bypass where one is needed). It never raises, because row level security calls it;
an unknown area or community is simply false.

## Where it is enforced

| | What the database does | What only the app does |
|---|---|---|
| **Live darshan** | Row level security on `app.content_items`: a published `darshan_stream` is readable by anyone (guests included) whose level meets the community's darshan level. A closed stream is **not returned** to others, so a hand-made API call gets nothing | Hides the buttons and shows "Sign in to watch…" |
| **Puja, timings, guide** | Nothing new: the lesson tables, daily timings and guide pages were already readable by guests | Shows or hides the entry points and screens |
| **Listen, look, learn, Niva** | Nothing new: stavans, videos, podcasts and recipes (`content_items`) are readable by every member of the community; lessons by everyone; the files are members-only in storage | Hides them from people below the level |

The Settings page says this next to every area: **"Applies in the app"** or **"Also enforced by the
database"**. Database enforcement for the other areas is future work: BACKLOG **B45**.

### The row level security change (owner's approval)

`content_published` (0010) let any member of a community read every published item of it. Recreated in 0586:

```sql
using (status = 'published'
       and (center_id is null                                  -- shared rows: as before
            or kind in ('guide_page', 'faq')                   -- public pages: as before
            or (kind <> 'darshan_stream' and app.is_member_of(center_id))))   -- members: no longer darshan
```

and two policies for the stream itself:

- `content_darshan_feature` (select, `anon` and `authenticated`): `kind = 'darshan_stream' and status =
  'published' and center_id is not null and app.can_use_feature(center_id, 'darshan')`.
- `content_darshan_staff` (select, `authenticated`): the same rows for anyone with `content.view`, so staff
  who could read the stream before (as members) still can in Content › Today & darshan, whatever level they
  hold. People who manage content read every row through `content_manage` as before; drafts are unchanged.

**What changes for users:** with the default (public), **a guest can now read a community's published live
stream**. Everything else `content_published` allowed it still allows. A community that closes the area gets
the old behaviour or stricter (members, Members, Life members only).

## The database objects

| Object | What it is |
|---|---|
| `app.access_features` | The catalog above. Readable by guests and members; written only by migrations |
| `app.access_levels` | A community's ladder: `(center_id, key, label, rank, kind, tiers, membership_type_keys)`. Table checks keep the two base levels fixed (`public` rank 0, `community` rank 10), membership levels at rank 20 or more with a rule, keys of 2 to 30 lower-case letters and underscores, names of 1 to 40 characters, ranks unique per community (checked at the end of the transaction so two levels can swap places). Readable by `settings.manage` and `content.manage`; written only by `save_access_levels` |
| `app.center_feature_access` | A community's choice per area: `(center_id, feature_key, level_key, changed_by, changed_at, reason)`. The level must be one of the community's (a foreign key, so a level an area uses cannot be removed). Readable like the ladder; written only by `set_feature_access` |
| `app.my_access(center)` | The caller's level: `(key, label, rank, signed_in)`. Callable by guests |
| `app.can_use_feature(center, area)` | Boolean, as above. Callable by guests |
| `app.feature_access_for_me(center)` | What the member app asks once per community (below). Callable by guests; raises "That community was not found." for an unknown one |
| `app.access_settings(center)` | Everything the settings page needs: levels, areas, membership types, `membership_on`. `settings.manage` |
| `app.set_feature_access(center, area, level, reason)` | Choose an area's level. Refuses a level below the floor, one that does not exist, and one **nobody can reach** (a membership level whose only rule is membership types that are no longer offered) |
| `app.save_access_levels(center, levels, base_labels, reason)` | Replace the membership levels and the two base names in one go. Refuses a bad key, rank, name or rule, a type the community does not have, more than 10 levels, and **removing a level an area still uses (the error names the areas)** |
| `app.access_seed_center(center)` + trigger on `app.centers` | Gives every community the four starting levels; run once for the existing communities by the migration |

All three tables are audited (`audit_<table>` on `app.audit_row`, keyed by their primary key) and mapped to the
core platform in `app.module_tables`. `save_access_levels` also writes one `access.levels_saved` entry with the
whole ladder before and after. The two settings RPCs need `settings.manage` (or a platform admin), a **reason**
(kept in the audit log), and a **fresh 2FA check** (`app.assert_step_up('access.change')`), like switching a
module. A sandbox reset keeps a community's access settings, like its module switches (`app.demo_clear_tables`).

## What the member app reads

```jsonc
// app.feature_access_for_me(center) — also callable without a session (the anon key)
{
  "level": { "key": "public", "label": "Public", "rank": 0 },
  "signed_in": false,
  "features": {
    "darshan": { "allowed": true,  "reason": null,      "min_level": { "key": "public",    "label": "Public",           "rank": 0 } },
    "listen":  { "allowed": false, "reason": "sign_in", "min_level": { "key": "community", "label": "Community member", "rank": 10 } }
    // … one entry per area in the catalog
  }
}
```

`reason`: **`sign_in`** = the caller is not signed in and the area needs more than public; **`level`** =
signed in but below the minimum; **`module_off`** = the area's module is switched off (takes precedence).
Labels are the community's own, so "Life member" in one community can be "Patron" in another.

## Settings › Access levels

`/settings/access`, for `settings.manage`. Two cards:

1. **Who can use each area**: a row per area with its description, a dropdown limited to the levels at or
   above its floor, a line saying in words who that is, "Applies in the app" or "Also enforced by the
   database", and a plain-English line when the area's module is off. One **Save** with a reason; each area
   is its own call, so if one is refused the ones before it stay saved and the message says which.
2. **Levels for {community}**: the ladder in order. The two base levels have editable names. Membership
   levels can be added, renamed, moved up and down (the page numbers them 20, 30, 40 …), given a rule (tier
   checkboxes and this community's membership types), and removed (refused, naming the area, while an area
   uses the level). One **Save** with a reason.

Errors are shown next to the button in plain English. A database without 0586 shows that the update has not
been applied instead of an empty page. After this migration the generated types do not know the three RPCs
yet, so the page calls them through one narrow cast (`src/lib/access-db.ts`); remove it once
`src/lib/database.types.ts` has been regenerated.

## How to add an area

1. **A new migration** inserts the row into `app.access_features` (key, label, description, default, floor,
   module, `enforced_by`, sort). One row per line, starting `('key', …`, because the sync test reads them.
2. **`src/lib/access.ts`**: add the same row to `ACCESS_FEATURES` and its key to `ACCESS_FEATURE_KEYS`.
   `tests/access.test.ts` fails until the two agree.
3. **If the database should protect it**, add a row level security policy that calls
   `app.can_use_feature(center_id, '<area>')` (the way `content_darshan_feature` does), keep any staff bypass
   in the policy, and set `enforced_by = 'database'`. Otherwise leave it `app`.
4. **The member app** maps its route or section to the area key and shows a notice when it is blocked.
5. Add a row to the table above.

Money and personal areas are **not** added here: they always need a signed-in community member.

## Decisions and edge cases

- **Why a ladder, not roles.** A level is about the person's relationship to the community (public, member of
  the community, paid member), not what they may administer. Roles (`docs/ROLES.md`) are unchanged.
- **Reordering changes meaning.** Areas are compared by rank, so moving Life member below Member makes an
  area set to Life member open to Members too. That is the ladder working as an order.
- **A level's name is the community's.** The keys (`life`, `member`) are internal; the member app shows the
  labels.
- **A promoted sandbox starts on the default ladder**: promotion (0203) copies the configuration tables in
  its own list, and the access settings are not in it yet (BACKLOG B45). A sandbox reset keeps them.
- **Platform admins** are public in a community they are not linked to; the staff policies, not their level,
  give them access to data.

## What is not enforced yet

- Listen, look, learn and Niva are hidden by the app, not by the database (BACKLOG **B45**): a community
  member who calls the API directly can still read those rows. Their files are members-only in storage whatever
  level is chosen, which is why they cannot be opened to the public.
- Puja and timings are public in the database already (the shared Gyan Path lessons, which include the Navang
  puja, and the daily timings are readable by guests), so choosing a higher level for them only changes what
  the app shows.
