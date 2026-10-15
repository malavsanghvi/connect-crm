# The member app's "Try the demo": the HTTP side

A person can try the member app without installing anything: the member app has a web build (https://app.weaverams.org, the same Expo app),
and "Try the demo" there needs no emailed code, which the demo people (addresses on `demo.weaverams.org`, nobody has a mailbox) cannot use.
The portal gives the app two endpoints. They say what the portal's `/demo` page says, as JSON, and they run the **same core** (`startDemoSession`,
`src/lib/demo-signin/start.ts`; how it is guarded is in [DEMO_SIGNIN.md](DEMO_SIGNIN.md)). This page is the contract the app builds against.

## The flow in the app

1. **Try the demo** → **choose a community** (`GET /api/demo/choices`: the faith-based demo, the not faith-based one).
2. **A guest-style look around** of the chosen community with no sign-in, exactly as a guest browses a live community: Home with the public
   events and the sign-in card, the guide, the store. The app opens the community by the `slug` (and `id`) the list gives, in its guest mode.
   Read only. RSVP, giving and shopping send a guest to sign in, as they do anywhere.
3. A visible **Be someone in the demo** button → **the people** (the same `GET /api/demo/choices`: six people in two areas).
4. Choosing one → `POST /api/demo/session` → the app stores the returned session like a normal sign-in → a signed-in demo for two hours.
5. **Leave the demo** (`rpc demo_leave`) or **Switch role** (`rpc demo_leave`, back to step 3).

## Where

The portal's address, `https://admin.weaverams.org` in production (the same host as the web demo). Nothing here needs a cookie or a portal
sign-in; the portal's proxy leaves `/api/demo/*` alone (no session refresh, no redirect to sign-in, no demo check of a stray cookie).

## `GET /api/demo/choices`

```json
{
  "ok": true,
  "enabled": true,
  "communities": [
    {
      "kind": "faith",
      "name": "Sunrise Worship Center (Demo)",
      "id": "9a1b2c3d-0e1f-4a2b-8c3d-4e5f6a7b8c01",
      "slug": "sunrise-demo",
      "people": [
        { "id": "5b3f1c7e-…", "role": "Treasurer", "name": "Tara Test", "story": "Keeps the books: …", "area": "operations" },
        { "id": "6c4a2d8f-…", "role": "Community member · Adult", "name": "Tarun Patni", "story": "Is the main adult of a family: …", "area": "community" }
      ]
    }
  ]
}
```

- `kind` is `"faith"` or `"neutral"`; faith-based comes first. `id` and `slug` are the community's own, public ones (invented data): open it in
  guest mode with them. Never an address and never an id of a real thing.
- `people` are the **featured** demo people only (owner decision 2026-10-14), each in one `area`, ordered by area and then in a fixed order:
  - `"operations"` (**Non-profit operational roles**): the organization's administrator, treasurer, membership coordinator, event lead and teacher;
  - `"community"` (**Community roles**): the family's main adult, shown as "Community member · Adult".
  A community without one of these roles simply lacks it. The list lives in one place in the database (`app.demo_featured_roles()`, migration 0815).
  The other demo people still exist (the pack keeps one per role) but are not offered.
- When the demo switch is off: `{ "ok": true, "enabled": false, "communities": [], "message": "The demo is switched off right now. Please try again later." }`.
  Enabled but nothing set up: `enabled: true`, `communities: []` and a `message` ("The demo is not ready yet. …"). Show the `message`.
- The list cannot be loaded: **503** `{ "ok": false, "error": "Could not load the demo — the list of demo people could not be loaded. Please try again in a minute.", "code": "failed" }`.

## `POST /api/demo/session`

Request: `Content-Type: application/json`, body `{ "persona": "<a person's id from the list>" }`.

Success, **200**:

```json
{
  "ok": true,
  "session": { "access_token": "…", "refresh_token": "…", "expires_in": 3600, "expires_at": 1790000000, "token_type": "bearer" },
  "demo": { "ends_at": "2026-10-14T20:00:00.000Z", "role": "Treasurer", "name": "Tara Test", "community": "Sunrise Worship Center (Demo)" }
}
```

`session` is Supabase's own session (give it to `supabase.auth.setSession({ access_token, refresh_token })`). `demo.ends_at` is when the two hours end;
`demo.role` is said as the list said it. Nothing else of the sign-in is returned (no user record, no address).

Failure: `{ "ok": false, "error": "<plain English>", "code": "off" | "limit" | "unknown_person" | "failed" }`. Show `error` as it is (it is the same wording
the web flow shows, always starting "Could not start the demo — …").

| Status | `code` | When |
| --- | --- | --- |
| 503 | `off` | the demo is switched off, or its sign-ins are not set up |
| 429 | `limit` | this visitor started many demos in the last hour (24 per hour per address), or the whole platform is at its limit |
| 404 | `unknown_person` | the person is not on the list (or the database does not know them) |
| 400 | `unknown_person` | no person given, or the id is not an id |
| 400 | `failed` | the body is not JSON, not an object, or over 4 KB |
| 403 | `failed` | the request came from a web page on another site (see CORS) |
| 503 | `failed` | the list of people could not be loaded |
| 500 | `failed` | anything else (the database, the sign-in); the real reason is logged on the server |

Nothing is signed out, and no cookie of the caller is read, set or cleared. The caller's earlier demo session (if any) is **not** ended by a start:
the app ends it first with `rpc('demo_leave')` (below) when it switches person.

## Headers (both endpoints)

- `Cache-Control: no-store` and `Vary: Origin`.
- CORS, only for a web page whose `Origin` is exactly `https://app.weaverams.org` (or the address the portal's `MEMBER_APP_URL` names), and, outside
  production only, `http://localhost:8081`, `http://localhost:19006` and `http://127.0.0.1:8081`:
  `Access-Control-Allow-Origin: <that origin>`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`,
  no credentials (call `fetch` with `credentials: "omit"`, the default across origins). `OPTIONS` answers the preflight with 204.
  Any other origin gets none of these headers, so its browser refuses the answer, and a `POST` from one is also refused (403).
- React Native sends no `Origin` and is not affected by CORS.

## After the session: the demo through the Supabase client

With the session set, the app talks to Supabase as that demo person, like any signed-in member (row level security shows them one demo community).

- `rpc('demo_session_state')` (schema `app`; for the banner and the end of the demo) → `{ "state": "ok", "expires_at", "seconds_left", "role", "name",
  "center_name", "center_slug" }`, or `{ "state": "expired" | "off" | "unknown" | "not_demo" }`. Anything but `ok` means the demo is over: the database has
  already deleted the Auth session (so it cannot be refreshed); clear the app's session and go back to the list.
- `rpc('demo_leave')` ends the person's own demo session now (the database deletes the Auth session). Then clear the app's session.

Both are granted to every signed-in person and use the session id inside the token, so they work from outside the portal as they are.

## The guest look-around (migration 0816)

While the demo is **on**, the demo communities are open to guests (people who are not signed in), and only then. The gate is one question,
`app.demo_public_open(center)`, and a demo community that guests may not see now is `app.demo_closed_to_guests(center)`.

Covered, so the guest Home, events, guide and store work for a demo community as for a live one, and all disappear for a guest when the demo is
switched off: the community by web name and by id (`community_public`, `community_public_by_id`, via `app.community_open`), the areas and the
experience (`feature_access_for_me`, `can_use_feature`, `category_profile`, `member_experience`, `resolve_template`, via `app.access_center_open`), the
public profile and leaders, the community row for old builds that read the table (policy `centers_public_read`; since 0817, which closes the table to guests, the policy `centers_guest_read`: the plain columns of an active community, and of a demo community exactly while `app.demo_public_open` is true), and the public rows of
`events`, `guide_sections`, `store_items`, `store_categories`, `pickup_windows`, `content_items` (darshan, listen, learn), `photo_albums`,
`daily_timings`, `role_roster`, `campaigns`, `opportunities` and `membership_types` (a restrictive `demo_guest_gate` policy for the role `anon`).

**Guests never write.** No insert, update or delete policy or grant is touched.

Not covered (they never looked at the status of the community, so they work for the demo community as they always did, and are not hidden when the
demo is off): the shared catalogs and calendars (`gyan_*`, `practices`, Pathshala tracks and levels, calendar layers, entries and tithis), the media
library functions (`media_library`, `random_media`, `media_item`), storage object reads by path, notification topics. Alerts are not read by guests at
all (the app shows none to a guest). The list of communities a guest can pick from (`communities_public_list`) still lists live communities only, which
is why the app opens a demo community by the `slug` from `GET /api/demo/choices`.

## Guardrails and what a person with the token can do

Everything in [DEMO_SIGNIN.md](DEMO_SIGNIN.md) holds: the switch, the demo-person check, the two-hour session, 24 starts per hour per visitor address and
300 per hour (20 per 5 minutes) for the platform, the audit entries, the Auth session tied to the demo session with `auth.sessions.not_after`. With
this endpoint the visitor holds the session openly (the app stores it), exactly as a visitor who copies a token out of the web demo does:
they can act as that demo person, in that one demo community, for the rest of the token's life, and nothing they do leaves the demo or is kept
(the community starts over every night). Details and the one thing they can still do (sign the shared demo person out everywhere) are in DEMO_SIGNIN.md.
