-- 0620 · One activity stream (backlog B91, absorbs B77; docs/MASTER_PLAN §5): the tables, the allowlist and the helpers.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Today only table writes are audited (audit_log). Reads, screens, denied attempts and everything in the member app
--   leave nothing behind. This adds ONE stream of events for what staff do in the portal and what members do in the apps,
--   so repeated work can be found and automated (0622). It is built switched OFF: nothing is recorded in any community
--   until a Weaver platform admin switches that community on (centers.rules.activity.enabled, 0621).
--
--   WHAT AN EVENT IS (and is not)
--     who          a pseudonym: hmac-sha256 of the sign-in's user id with a random salt of that community only
--                  (app.activity_salts, unreadable through the API), so the same person cannot be followed from one
--                  community to another and the raw id is never stored
--     role(s)      the role keys the person held at the time (operational / center tier; "member" has none)
--     what         a key from the allowlist (app.activity_catalog) or a screen ROUTE PATTERN ("screen:/events/[id]")
--     about what   an entity kind from the catalog and, if given, the record's id
--     how it went  ok | error | cancelled, an error CODE, how long it took, how it was started (screen, palette,
--                  assistant, app), the sequence number in the session, the app version and the platform
--     NO free text and NO values anywhere: no names, amounts, notes, addresses, search words or URLs with ids.
--   Every column has a check; keys that are not in the allowlist, and screen keys that are not route patterns, never get
--   in (0621 drops them). Nothing is recorded for anyone under 18, for any account the records do not show to be an
--   adult's, for a person who opted out, or for a community whose switch is off.
--
--   WHO CAN READ WHAT
--     app.activity_events    raw rows: Weaver platform admins only. Nobody can insert, update or delete through the API;
--                            the only writer is app.record_activity (0621), which takes the person and the community from
--                            the sign-in and never from the payload.
--     app.activity_catalog   the allowlist with plain-English labels: every signed-in person reads it.
--     app.activity_optouts   a person reads their own row (the member app's Profile › Privacy switch).
--     app.activity_salts     nobody through the API.
--   A community's administrators see SUMMARIES (0622: automation ideas; 0623: usage totals), never raw rows.
--
--   AUDIT: the three tables below are deliberately NOT in the row-level audit (0102 audits every other app table):
--     activity_events  the volume (every click), and copying events into audit_log would hand audit.view holders a
--                      second, readable copy of what raw access is withheld from
--     activity_optouts it would record, in a log many people can read, who chose not to be recorded
--     activity_salts   a secret; the audit row would print it
--   Test 13's coverage rule lists exactly these three; test 99 checks that no audit row is ever written for them.
--   The allowlist (activity_catalog) IS audited like any other reference table.
--
-- Migrations 0620 to 0623 (tests 99, 100):
--   0620 this file   tables, helpers, the seeded allowlist
--   0621             record_activity, set_activity_opt_out, activity_status, set_activity_recording, the switch guard
--   0622             automation_candidates and the miner
--   0623             retention (400 days), the cross-community backlog view, the administrators' usage totals

-- ── Helpers that need no tables ──────────────────────────────────────────────

-- A screen key is "screen:/" plus a ROUTE PATTERN: lower-case segments, dynamic parts written as [name]. Returns the
-- key in its stored form (the [name] placeholders lower-cased, so [goalId] and [goalid] are one key), or null when it is
-- not a route pattern: a character outside a-z 0-9 _ - / [ ], more than 80 characters after "screen:/", an empty
-- segment (a//b, a trailing slash), or a segment that looks like an id (digits only, a long digit run, a uuid or other
-- hex id, a mix of letters and digits of 6 or more characters). "screen:/" alone is the home screen.
create or replace function app.activity_screen_key_norm(p_key text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case
    when p_key is null then null
    when p_key = 'screen:/' then p_key
    when p_key !~ '^screen:/[]A-Za-z0-9_[/-]{1,80}$' then null
    else (
      select case when bool_and(s.ok) then 'screen:/' || string_agg(s.seg, '/' order by s.ord) end
        from (
          select t.ord,
                 case when t.raw ~ '^\[[A-Za-z][A-Za-z_]{0,20}\]$' then lower(t.raw) else t.raw end as seg,
                 (t.raw ~ '^\[[A-Za-z][A-Za-z_]{0,20}\]$')
                 or (t.raw ~ '^[a-z0-9_-]{1,40}$'
                     and t.raw !~ '^[0-9_-]+$'
                     and t.raw !~ '[0-9]{3,}'
                     and not (t.raw ~ '^[0-9a-f-]{8,}$' and t.raw ~ '[0-9]')
                     and not (char_length(t.raw) >= 6 and t.raw ~ '[a-z]' and t.raw ~ '[0-9]')) as ok
            from regexp_split_to_table(substr(p_key, 9), '/') with ordinality as t(raw, ord)
        ) s
    )
  end
$$;
comment on function app.activity_screen_key_norm(text) is 'A screen activity key in its stored form, or null when it is not a route pattern (no free text, no ids). 0620.';

-- Safe casts for the values of an event: null instead of an error, because recording never raises.
create or replace function app.activity_uuid(p text) returns uuid
language sql immutable set search_path = app, public, extensions as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

create or replace function app.activity_int(p text, p_lo integer, p_hi integer) returns integer
language sql immutable set search_path = app, public, extensions as $$
  select case when p ~ '^[0-9]{1,9}(\.[0-9]{1,6})?$'
              then (case when round(p::numeric) between p_lo and p_hi then round(p::numeric)::integer end)
         end
$$;

create or replace function app.activity_ts(p text) returns timestamptz
language plpgsql stable set search_path = app, public, extensions as $$
begin
  if p is null or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
    return null;
  end if;
  return p::timestamptz;
exception when others then
  return null;
end $$;

-- ── The allowlist ────────────────────────────────────────────────────────────
create table if not exists app.activity_catalog (
  key             text primary key,
  kind            text not null check (kind in ('action', 'screen')),
  surface         text not null check (surface in ('portal', 'member')),
  label           text not null check (char_length(label) between 1 and 120),
  entity_kind     text check (entity_kind is null or entity_kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  -- The key of the command (the portal's one command layer) that does the same thing; null until there is one. The miner
  -- proposes a Niva command only for a sequence whose every step has one.
  commandable_key text check (commandable_key is null or commandable_key ~ '^[a-z][a-z0-9_.]{0,79}$'),
  created_at      timestamptz not null default now(),
  check (kind <> 'action' or key ~ '^[a-z][a-z0-9_]{1,40}(\.[a-z][a-z0-9_]{1,40}){0,2}$'),
  check (kind <> 'screen' or coalesce(app.activity_screen_key_norm(key) = key, false))
);
comment on table app.activity_catalog is
  'The allowlist of activity keys (0620): every action key an event may carry, with a plain-English label, the surface (portal | member), the kind of record it is about and, once the command layer has one, the command that does the same. Screens are listed for their labels only: any valid route pattern is accepted. Add keys with app.activity_register in a later migration.';

-- Add or change a key. For later migrations (the command layer registers its commands here): a null entity kind or command
-- key keeps what is already there. Not callable through the API.
create or replace function app.activity_register(p_key text, p_kind text, p_surface text, p_label text,
                                                 p_entity_kind text default null, p_commandable_key text default null)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  insert into app.activity_catalog (key, kind, surface, label, entity_kind, commandable_key)
  values (p_key, p_kind, p_surface, p_label, p_entity_kind, p_commandable_key)
  on conflict (key) do update
    set kind = excluded.kind, surface = excluded.surface, label = excluded.label,
        entity_kind = coalesce(excluded.entity_kind, app.activity_catalog.entity_kind),
        commandable_key = coalesce(excluded.commandable_key, app.activity_catalog.commandable_key);
end $$;

-- ── The pseudonym's salt, the opt-outs and the events ───────────────────────
create table if not exists app.activity_salts (
  center_id  uuid primary key references app.centers(id) on delete cascade,
  salt       bytea not null,
  created_at timestamptz not null default now()
);
comment on table app.activity_salts is
  'One random salt per community (0620), the key of the pseudonym in activity_events.actor_hash. Readable by nobody through the API: only the security definer functions of the activity stream use it. Not audited (the audit row would print the secret).';

create table if not exists app.activity_optouts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table app.activity_optouts is
  'People who chose not to be recorded (0620), in every community; app.set_activity_opt_out. A person reads only their own row. Not audited (the audit log must not list who opted out).';

create table if not exists app.activity_events (
  id          bigint generated always as identity primary key,
  center_id   uuid not null references app.centers(id) on delete cascade,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  session_id  text check (session_id is null or session_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  seq         integer check (seq is null or seq between 0 and 1000000),
  surface     text not null check (surface in ('portal', 'member')),
  actor_hash  text not null check (actor_hash ~ '^[0-9a-f]{64}$'),
  role_keys   text[] not null default '{}',
  key         text not null check (char_length(key) between 2 and 120),
  kind        text not null check (kind in ('action', 'screen')),
  entity_kind text check (entity_kind is null or entity_kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  entity_id   uuid,
  outcome     text not null check (outcome in ('ok', 'error', 'cancelled')),
  error_code  text check (error_code is null or error_code ~ '^[a-z0-9_.-]{1,40}$'),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 3600000),
  via         text not null check (via in ('screen', 'palette', 'assistant', 'app')),
  app_version text check (app_version is null or app_version ~ '^[0-9A-Za-z._+-]{1,32}$'),
  platform    text check (platform is null or platform ~ '^[a-z0-9_-]{1,16}$')
);
comment on table app.activity_events is
  'What staff do in the portal and members do in the apps (0620). Pseudonymous (actor_hash), allowlisted keys only, no free text and no values. Insert only through app.record_activity; raw rows are readable by platform admins only; kept 400 days (app.activity_purge, 0623). Not audited: the volume, and a readable copy would defeat the access rule.';
comment on column app.activity_events.actor_hash is 'hmac-sha256(user id, the community''s salt), hex. Never the user id.';
comment on column app.activity_events.received_at is 'When the database stored it (rate limit and retention); occurred_at is the device''s time, held within 7 days before and 5 minutes after it.';

-- The two the brief asks for, plus the rate limit's (one person, one community, the last hour) and a small time index the
-- purge scans (events arrive roughly in time order).
create index if not exists activity_events_center_time_idx on app.activity_events (center_id, occurred_at);
create index if not exists activity_events_actor_session_idx on app.activity_events (center_id, actor_hash, session_id, seq);
create index if not exists activity_events_actor_received_idx on app.activity_events (center_id, actor_hash, received_at);
create index if not exists activity_events_time_brin on app.activity_events using brin (occurred_at);

insert into app.module_tables (table_name, module_key) values
  ('activity_catalog', null), ('activity_events', null), ('activity_optouts', null), ('activity_salts', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- ── Row level security and grants ────────────────────────────────────────────
alter table app.activity_catalog enable row level security;
drop policy if exists activity_catalog_read on app.activity_catalog;
create policy activity_catalog_read on app.activity_catalog for select to authenticated using (true);
revoke all on app.activity_catalog from public, anon, authenticated, service_role, connect_worker;
grant select on app.activity_catalog to authenticated;
grant all on app.activity_catalog to service_role;

alter table app.activity_salts enable row level security;
revoke all on app.activity_salts from public, anon, authenticated, service_role, connect_worker;

alter table app.activity_optouts enable row level security;
drop policy if exists activity_optouts_own on app.activity_optouts;
create policy activity_optouts_own on app.activity_optouts for select to authenticated using (user_id = auth.uid());
revoke all on app.activity_optouts from public, anon, authenticated, service_role, connect_worker;
grant select on app.activity_optouts to authenticated;

alter table app.activity_events enable row level security;
drop policy if exists activity_events_platform_read on app.activity_events;
create policy activity_events_platform_read on app.activity_events for select to authenticated using (app.is_platform_admin());
-- No insert, update or delete for anyone through the API (not the service key either): app.record_activity writes,
-- app.activity_purge deletes, both as the database owner.
revoke all on app.activity_events from public, anon, authenticated, service_role, connect_worker;
grant select on app.activity_events to authenticated;

-- ── Who may be recorded, and the pseudonym ───────────────────────────────────

-- Is recording on for this community? Off unless rules.activity.enabled is true (a platform admin sets it).
create or replace function app.activity_enabled(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select (c.rules -> 'activity' ->> 'enabled') = 'true' from app.centers c where c.id = p_center), false)
$$;

-- May this sign-in be recorded in this community? Only a person the records show to be an ADULT, linked to this sign-in
-- in this community (staff and members alike have that link). Conservative on purpose:
--   a date of birth that says 18 or older                                         -> yes
--   no date of birth, but a current household role of primary or spouse (and not recorded as a child anywhere,
--   app.person_is_minor)                                                          -> yes
--   under 18, or no date of birth and nothing that shows an adult, or no person   -> no
-- (app.i_am_adult counts every person without a birth date as an adult; this does not.)
create or replace function app.activity_person_ok(p_center uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((
    select (p.date_of_birth is not null and p.date_of_birth <= current_date - interval '18 years')
        or (p.date_of_birth is null
            and exists (select 1 from app.household_members hm
                         where hm.person_id = p.id and hm.left_at is null and hm.role in ('primary', 'spouse'))
            and not app.person_is_minor(p.id))
      from app.center_users cu join app.people p on p.id = cu.person_id
     where cu.center_id = p_center and cu.user_id = p_user), false)
$$;

-- The pseudonym of one person in one community. p_create false: look only (null if the community has no salt yet).
create or replace function app.activity_actor_hash(p_center uuid, p_user uuid, p_create boolean default true) returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_salt bytea;
begin
  select s.salt into v_salt from app.activity_salts s where s.center_id = p_center;
  if v_salt is null then
    if not p_create then return null; end if;
    insert into app.activity_salts (center_id, salt) values (p_center, gen_random_bytes(32))
    on conflict (center_id) do nothing;
    select s.salt into v_salt from app.activity_salts s where s.center_id = p_center;
  end if;
  return encode(hmac(convert_to(p_user::text, 'UTF8'), v_salt, 'sha256'), 'hex');
end $$;

-- Internal: none of these is callable through the API (the activity functions of 0621 call them as the owner).
revoke execute on function app.activity_screen_key_norm(text), app.activity_uuid(text), app.activity_int(text, integer, integer),
  app.activity_ts(text), app.activity_register(text, text, text, text, text, text), app.activity_enabled(uuid),
  app.activity_person_ok(uuid, uuid), app.activity_actor_hash(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

-- ── The allowlist, seeded ────────────────────────────────────────────────────
-- Portal screens: the route patterns of the NAV tabs (src/lib/permissions.ts) and their detail pages. Every dynamic part is
-- written [id] (the portal's beacon replaces id-like segments), so one pattern is one screen.
select app.activity_register(v.k, 'screen', 'portal', v.l, v.e)
  from (values
    ('screen:/', 'Home', null),
    ('screen:/households', 'Households', null), ('screen:/households/[id]', 'A household', 'household'),
    ('screen:/people', 'People', null), ('screen:/people/[id]', 'A person', 'person'),
    ('screen:/memberships/applications', 'Membership applications', null),
    ('screen:/people/requests', 'Family change requests', null),
    ('screen:/people/directory', 'Directory and expertise', null),
    ('screen:/people/voting', 'Voting eligibility', null),
    ('screen:/people/merge', 'Merge people', null),
    ('screen:/events', 'All events', null), ('screen:/events/[id]', 'An event', 'event'),
    ('screen:/events/builder', 'Event builder', null), ('screen:/events/live', 'Live check-in', null),
    ('screen:/events/feedback', 'Event feedback', null), ('screen:/events/feedback/[id]', 'Feedback on one event', 'survey'),
    ('screen:/events/volunteers', 'Volunteers', null),
    ('screen:/giving/pledges', 'Pledges', null), ('screen:/giving/payments', 'Payments and deposits', null),
    ('screen:/giving/payments/bank', 'Bank lines', null), ('screen:/giving/bank', 'Bank', null),
    ('screen:/giving/opportunities', 'Opportunities', null), ('screen:/giving/opportunities/campaigns', 'Campaigns', null),
    ('screen:/giving/campaigns', 'Campaigns', null), ('screen:/giving/recurring', 'Recurring gifts', null),
    ('screen:/giving/labh', 'Labh fulfillment', null), ('screen:/giving/statements', 'Receipts and statements', null),
    ('screen:/bolis', 'Digital bolis', null), ('screen:/bolis/upload', 'In-person boli upload', null),
    ('screen:/store', 'Store inventory', null), ('screen:/store/menu', 'Store menu and pickup', null),
    ('screen:/store/orders', 'Store orders by pickup', null),
    ('screen:/pathshala', 'Pathshala classes', null), ('screen:/pathshala/classes', 'Classes', null),
    ('screen:/pathshala/classes/[id]', 'A class', 'class'), ('screen:/pathshala/classes/[id]/attendance', 'Class attendance', 'class'),
    ('screen:/pathshala/classes/[id]/reports', 'Class progress reports', 'class'),
    ('screen:/pathshala/signoffs', 'Gyan Path sign-offs', null), ('screen:/pathshala/homework', 'Homework', null),
    ('screen:/pathshala/terms', 'Terms', null), ('screen:/pathshala/terms/[id]', 'A term', 'term'),
    ('screen:/pathshala/terms/[id]/fees', 'A term''s fees and rules', 'term'),
    ('screen:/pathshala/levels', 'Levels', null), ('screen:/pathshala/enrollments', 'Enrollments', null),
    ('screen:/pathshala/teachers', 'Teacher positions', null), ('screen:/pathshala/my-classes', 'My classes', null),
    ('screen:/pathshala/announcements', 'Pathshala announcements', null),
    ('screen:/pathshala/committee', 'Pathshala committee', null), ('screen:/pathshala/committee/actions', 'Committee actions', null),
    ('screen:/pathshala/committee/actions/[id]', 'A committee action', null), ('screen:/pathshala/committee/concerns', 'Committee concerns', null),
    ('screen:/pathshala/committee/resolutions', 'Committee resolutions', null), ('screen:/pathshala/committee/resolutions/[id]', 'A committee resolution', null),
    ('screen:/pathshala/committee/templates', 'Committee templates', null), ('screen:/pathshala/committee/templates/[id]', 'A committee template', null),
    ('screen:/pathshala/committee/year', 'Committee year', null),
    ('screen:/content', 'Content', null), ('screen:/content/queue', 'Approval queue', null),
    ('screen:/content/today', 'Today and darshan', null), ('screen:/content/practices', 'Practices and points', null),
    ('screen:/content/gyan-path', 'Gyan Path content', null), ('screen:/content/library', 'Library', null),
    ('screen:/content/media', 'Media library', null), ('screen:/content/photos', 'Photo albums', null),
    ('screen:/content/photos/[id]', 'A photo album', 'album'), ('screen:/content/niva', 'Niva', null),
    ('screen:/content/guide', 'Guide and directory', null), ('screen:/content/legal', 'Legal and waivers', null),
    ('screen:/calendar', 'Calendar', null),
    ('screen:/comms', 'Communications', null), ('screen:/comms/newsletters', 'Newsletters', null),
    ('screen:/comms/inbox', 'Inbox', null), ('screen:/comms/whatsapp', 'WhatsApp queue', null),
    ('screen:/comms/surveys', 'Surveys', null), ('screen:/comms/surveys/[id]', 'A survey', 'survey'),
    ('screen:/comms/alerts', 'Alerts', null), ('screen:/comms/campaigns/[id]', 'A message campaign', null),
    ('screen:/comms/threads/[id]', 'A conversation', 'thread'),
    ('screen:/accounting/qbo', 'QuickBooks sync', null), ('screen:/accounting/qbo/setup', 'QuickBooks setup', null),
    ('screen:/accounting/qbo/matching', 'Donor matching', null), ('screen:/accounting/close', 'Month-end close', null),
    ('screen:/reports', 'Center health', null), ('screen:/reports/community', 'Community dashboard', null),
    ('screen:/setup', 'Setup checklist', null), ('screen:/setup/organization', 'Legal identity', null),
    ('screen:/setup/profile', 'Profile and brand', null), ('screen:/setup/leaders', 'Leaders', null),
    ('screen:/setup/lists', 'Setup lists', null), ('screen:/setup/readiness', 'Go-live readiness', null),
    ('screen:/setup/go-live', 'Go-live', null), ('screen:/setup/demo', 'Demo data', null),
    ('screen:/setup/onboarding', 'Onboarding', null),
    ('screen:/settings', 'Settings', null), ('screen:/settings/rules', 'Rules', null),
    ('screen:/settings/roles', 'Roles and entitlements', null), ('screen:/settings/integrations', 'Integrations', null),
    ('screen:/settings/payments', 'Payment settings', null), ('screen:/settings/privacy', 'Privacy', null),
    ('screen:/settings/onboarding', 'Onboarding fields', null), ('screen:/settings/notifications', 'Notifications', null),
    ('screen:/settings/security', 'Security', null), ('screen:/settings/audit', 'Audit log', null),
    ('screen:/settings/modules', 'Modules', null), ('screen:/settings/access', 'Access levels', null),
    ('screen:/settings/team', 'Team', null), ('screen:/settings/agreements', 'Agreements', null),
    ('screen:/settings/member-app', 'Member app settings', null), ('screen:/settings/limits', 'Limits', null),
    ('screen:/settings/numbering', 'Numbering', null), ('screen:/settings/storage', 'Storage', null),
    ('screen:/settings/import', 'Data import', null), ('screen:/settings/import/[id]', 'One data import', null),
    ('screen:/settings/import/new', 'New data import', null), ('screen:/settings/custom-fields', 'Custom fields', null),
    ('screen:/settings/data-quality', 'Data quality', null), ('screen:/settings/support-access', 'Support access', null),
    ('screen:/settings/email', 'Email settings', null), ('screen:/settings/texting', 'Texting settings', null),
    ('screen:/settings/whatsapp', 'WhatsApp settings', null), ('screen:/settings/center', 'Community profile', null),
    ('screen:/audit', 'Audit', null), ('screen:/privacy/requests', 'Privacy requests', null),
    ('screen:/account/security', 'My sign-in security', null),
    ('screen:/platform', 'Platform: communities', null), ('screen:/platform/setup', 'Platform setup', null),
    ('screen:/platform/new', 'New community', null), ('screen:/platform/new-sandbox', 'New sandbox', null),
    ('screen:/platform/centers/[id]', 'One community', 'community'), ('screen:/platform/verification', 'Verification', null),
    ('screen:/platform/requests', 'Requests', null), ('screen:/platform/codes', 'Sandbox codes', null),
    ('screen:/platform/pipeline', 'Onboarding pipeline', null), ('screen:/platform/go-live', 'Go-live approvals', null),
    ('screen:/platform/support-access', 'Support access grants', null), ('screen:/platform/agreements', 'Platform agreements', null),
    ('screen:/platform/https', 'HTTPS', null), ('screen:/platform/payments', 'Platform payments', null)
  ) as v(k, l, e);

-- Member app screens (connect-mobile app/ routes, route groups removed). Where the portal has the same pattern the row
-- above stands for both: a screen event's surface comes from how it was sent (via = app), not from this table.
select app.activity_register(v.k, 'screen', 'member', v.l, v.e)
  from (values
    ('screen:/legal', 'Legal', null), ('screen:/family', 'Family', null), ('screen:/give', 'Give', null), ('screen:/jain-way', 'The Jain Way', null),
    ('screen:/album/[id]', 'Photo album', 'album'), ('screen:/boli/[id]', 'A boli', 'boli'), ('screen:/cart', 'Cart', null),
    ('screen:/darshan', 'Darshan', null), ('screen:/event/[id]', 'An event', 'event'),
    ('screen:/event/[id]/confirm', 'Confirm RSVP', 'event'), ('screen:/event/[id]/tickets', 'Tickets', 'event'),
    ('screen:/family-review', 'Review family details', null), ('screen:/guide', 'Guide', null),
    ('screen:/guide/[id]', 'A guide page', null), ('screen:/guide/admin', 'Guide: administration', null),
    ('screen:/guide/apply', 'Guide: apply', null), ('screen:/guide/ask', 'Guide: ask', null),
    ('screen:/guide/links', 'Guide: links', null), ('screen:/guide/membership', 'Guide: membership', null),
    ('screen:/guide/registrations', 'Guide: registrations', null), ('screen:/guide/timings', 'Guide: timings', null),
    ('screen:/guide/volunteer', 'Guide: volunteer', null), ('screen:/guide/whatsapp', 'Guide: WhatsApp', null),
    ('screen:/guide/zones', 'Guide: zones', null), ('screen:/gyan', 'Gyan Path', null),
    ('screen:/gyan/[id]', 'A Gyan Path goal', null), ('screen:/gyan/[id]/level/[id]', 'A Gyan Path level', null),
    ('screen:/gyan/homework', 'Homework', null), ('screen:/gyan/homework/[id]', 'One homework', null),
    ('screen:/labh/[id]', 'Labh', null), ('screen:/listen/playlist', 'Playlist', null),
    ('screen:/listen/podcast-random', 'Random podcast', null), ('screen:/media/[kind]', 'Media list', null),
    ('screen:/media/[kind]/[id]', 'Media item', null), ('screen:/member-card', 'Member card', null),
    ('screen:/niva', 'Niva', null), ('screen:/opportunity/[id]', 'An opportunity', 'opportunity'),
    ('screen:/pachchakhan/[id]', 'A pachchakhan', null), ('screen:/pathshala-enroll', 'Pathshala registration', null),
    ('screen:/pathshala-scan', 'Pathshala scan', null), ('screen:/pathshala-teach', 'Pathshala teaching', null),
    ('screen:/person/[id]', 'A family member', 'person'), ('screen:/pledges', 'Pledges', null),
    ('screen:/preferences', 'Preferences', null), ('screen:/puja', 'Puja', null), ('screen:/recipe/[id]', 'A recipe', null),
    ('screen:/recipe/random', 'Random recipe', null), ('screen:/recurring', 'Recurring gifts', null),
    ('screen:/recurring-setup', 'Set up a recurring gift', null), ('screen:/reference-requests', 'Reference requests', null),
    ('screen:/special-days', 'Special days', null), ('screen:/survey/[id]', 'A survey', 'survey'),
    ('screen:/volunteer', 'Volunteer', null), ('screen:/zelle-report', 'Zelle report', null),
    ('screen:/sign-in', 'Sign in', null), ('screen:/welcome', 'Welcome', null), ('screen:/about', 'Onboarding: about', null),
    ('screen:/address', 'Onboarding: address', null), ('screen:/contact', 'Onboarding: contact', null),
    ('screen:/details', 'Onboarding: details', null), ('screen:/done', 'Onboarding: done', null),
    ('screen:/family-match', 'Onboarding: family match', null), ('screen:/plan-days', 'Onboarding: plan days', null),
    ('screen:/whatsapp-groups', 'Onboarding: WhatsApp groups', null), ('screen:/e/[id]', 'Event link', 'event'),
    ('screen:/join/[code]', 'Join link', null)
  ) as v(k, l, e);

-- Member app funnel steps (the questions of B77): where RSVP, pledge and payment flows start, finish or fail.
select app.activity_register(v.k, 'action', 'member', v.l, v.e)
  from (values
    ('rsvp_started', 'RSVP started', 'event'), ('rsvp_completed', 'RSVP completed', 'event'),
    ('pledge_placed', 'Pledge placed', 'opportunity'),
    ('payment_started', 'Payment started', 'payment'), ('payment_completed', 'Payment completed', 'payment'),
    ('payment_failed', 'Payment failed', 'payment'), ('account_linked', 'Account linked to a family', null)
  ) as v(k, l, e);

-- The important portal actions (the Server Actions people use every day). The key is <area>.<what happened>.
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('giving.record_payment', 'Record a payment', 'payment'), ('giving.record_pledge', 'Record a pledge', 'pledge'),
    ('giving.apply_payment', 'Apply a payment to pledges', 'payment'), ('giving.save_campaign', 'Save a campaign', 'campaign'),
    ('giving.save_opportunity', 'Save an opportunity', 'opportunity'), ('giving.confirm_bank_match', 'Confirm a bank match', 'bank_line'),
    ('giving.import_bank_lines', 'Import bank lines', null),
    ('people.add_person', 'Add a person', 'person'), ('people.update_person', 'Update a person', 'person'),
    ('people.create_household', 'Create a household', 'household'), ('people.update_household', 'Update a household', 'household'),
    ('people.merge_people', 'Merge two people', 'person'), ('people.merge_households', 'Merge two households', 'household'),
    ('people.decide_application', 'Decide a membership application', 'application'),
    ('people.decide_household_request', 'Decide a family change request', 'change_request'),
    ('events.save', 'Save an event', 'event'), ('events.set_status', 'Change an event''s status', 'event'),
    ('events.create_from_template', 'Create an event from a template', 'event'), ('events.set_rsvp_status', 'Change an RSVP', 'rsvp'),
    ('events.assign_volunteer', 'Assign a volunteer', 'event'),
    ('comms.send', 'Send a newsletter or message', 'message'), ('comms.reply_thread', 'Reply to a conversation', 'thread'),
    ('comms.create_alert', 'Create an alert', 'alert'), ('comms.save_survey', 'Save a survey', 'survey'),
    ('bolis.save', 'Save a boli', 'boli'), ('bolis.close', 'Close a boli', 'boli'),
    ('bolis.import_upload', 'Import in-person boli results', 'boli'),
    ('store.record_movement', 'Record a stock movement', 'store_item'), ('store.save_item', 'Save a store item', 'store_item'),
    ('store.move_order', 'Move an order', 'order'),
    ('pathshala.enroll_student', 'Enroll a student', 'enrollment'), ('pathshala.set_enrollment_status', 'Change an enrollment', 'enrollment'),
    ('pathshala.mark_attendance', 'Mark attendance', 'class'), ('pathshala.save_class', 'Save a class', 'class'),
    ('pathshala.review_homework', 'Review homework', 'homework'), ('pathshala.decide_signoff', 'Decide a Gyan Path sign-off', 'signoff'),
    ('content.decide_content', 'Decide on a piece of content', 'content_item'), ('content.save_item', 'Save a content item', 'content_item'),
    ('accounting.post_to_qbo', 'Post to QuickBooks', null), ('accounting.lock_month', 'Lock a month', null),
    ('settings.save_rules', 'Save the community''s rules', null)
  ) as v(k, l, e);

-- Audited from here on: the allowlist only (see the note at the top). Created after the seed so the migration does not
-- write a few hundred audit rows for it.
drop trigger if exists audit_activity_catalog on app.activity_catalog;
create trigger audit_activity_catalog after insert or update or delete on app.activity_catalog
  for each row execute function app.audit_row('key');
