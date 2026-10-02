-- 0586 · Access levels: who can use each area of the member app.
--
-- Owner request 2026-10-02: "make darshan and puja available without login too. Give control at each of
-- such areas to what level of access one should have to be able to use the feature. Life member /
-- community member / public... those levels also would be different for different organizations."
--
-- LEVELS. Each community has an ordered ladder. A person's level is the highest-ranked level whose rule
-- they satisfy, per community (a person in two communities has two levels).
--   public     rank  0   anyone, signed in or not                               (fixed; the label can be changed)
--   community  rank 10   signed in AND linked to this community (center_users)  (fixed; the label can be changed)
--   membership levels, rank 20 and up, defined by the community: each has a rule, membership TIERS
--   (community, yearly, life) and/or this community's membership TYPE keys. A level is met when the person's
--   household has an ACTIVE membership (status active, today between starts_on and ends_on) of such a tier or
--   type. Children and other household members share the household's membership. "Today" is the community's
--   own date. Lapsed, ended, pending, suspended and not-yet-started memberships never count, and nobody counts
--   as a member while the Membership module is switched off.
--   Every community starts with: member ("Member", rank 20, tiers yearly and life) and life ("Life member",
--   rank 30, tier life). They can be renamed, re-ordered, changed or removed like any other level.
--
-- AREAS. app.access_features is the platform's catalog of areas, each with a default level and a floor (the
-- lowest level it may be set to). app.center_feature_access holds a community's own choice per area; no row
-- means the catalog default. The defaults are today's behaviour, except darshan and puja, which become
-- public (the owner's request). Money and personal areas (giving, RSVP, store, family, Pathshala, directory)
-- are not in the catalog: they always need at least a signed-in community member.
--
-- WHERE IT IS ENFORCED. enforced_by says it: 'database' for darshan (the live stream row is protected by RLS,
-- below); 'app' for the rest (the member app hides them; lesson, media and Niva content stays readable by
-- community members in the database, and the Settings page says so). Database enforcement for those is
-- BACKLOG B45.
--
-- ACCESS CHANGE (needs the owner's OK, see the PR): content_published is recreated so that the member branch
-- no longer covers kind darshan_stream, and content_darshan_feature lets anyone (guests too) read a PUBLISHED
-- darshan stream of a community whose darshan level they meet. With the default (public) a guest can now
-- watch the live stream. Staff who could read it before still can (content_darshan_staff).
--
-- Reading and deciding (callable by guests):  my_access · can_use_feature · feature_access_for_me
-- Settings › Access levels (settings.manage, a reason, a fresh 2FA check, audited):
--                                           access_settings · set_feature_access · save_access_levels
set client_min_messages = warning;

-- ── The catalog of areas ─────────────────────────────────────────────────────
create table if not exists app.access_features (
  key           text primary key check (key ~ '^[a-z][a-z_]{1,29}$'),
  label         text not null check (char_length(btrim(label)) between 1 and 80),
  description   text not null default '',
  default_level text not null check (default_level in ('public', 'community')),
  floor_level   text not null check (floor_level in ('public', 'community')),
  module_key    text references app.modules(key),
  enforced_by   text not null check (enforced_by in ('database', 'app')),
  sort          integer not null default 0,
  -- an area cannot start below its own floor
  constraint access_features_default_at_floor check (floor_level = 'public' or default_level = 'community')
);
comment on table app.access_features is
  'Areas of the member app whose access level a community can choose (0586). default_level is what a community gets until it chooses; floor_level is the lowest level it may choose (public or community). module_key: the area is off while that module is switched off. enforced_by: database = row level security protects the data, app = the member app hides it.';

insert into app.access_features (key, label, description, default_level, floor_level, module_key, enforced_by, sort) values
('darshan', 'Live darshan', 'The live stream from the derasar, on Home and in the library. The database protects the stream itself, so only people at or above this level can open it.', 'public', 'public', 'content', 'database', 10),
('puja', 'Virtual puja', 'The guided virtual puja (the Navang puja lesson). Anyone at or above this level can open it; progress and points are only kept for people who are signed in.', 'public', 'public', 'gyan_path', 'app', 20),
('timings', 'Today''s timings', 'Sunrise, navkarsi, chauvihar and aarti for today, on Home. The timings are readable by everyone in the database; this choice is for the member app.', 'public', 'public', null, 'app', 30),
('guide', 'New to the community guide and directory', 'The guide for newcomers: first steps, the community directory pages and who to ask.', 'public', 'public', null, 'app', 40),
('listen', 'Stavans, podcasts and playlist', 'Listen in the member app: stavans, podcast episodes and My playlist. The files are kept for community members only, so this cannot be opened to the public.', 'community', 'community', 'content', 'app', 50),
('look', 'Videos and recipes', 'Look in the member app: videos and recipes. The files are kept for community members only, so this cannot be opened to the public.', 'community', 'community', 'content', 'app', 60),
('learn', 'Gyan Path lessons and progress', 'Learn in the member app: Gyan Path lessons and each person''s progress. Progress is personal, so this cannot be opened to the public.', 'community', 'community', 'gyan_path', 'app', 70),
('niva', 'Ask Niva', 'Niva, the assistant that answers from the community''s own pages. Questions are kept for the person who asked, so this cannot be opened to the public.', 'community', 'community', 'niva', 'app', 80)
on conflict (key) do update set label = excluded.label, description = excluded.description, default_level = excluded.default_level,
  floor_level = excluded.floor_level, module_key = excluded.module_key, enforced_by = excluded.enforced_by, sort = excluded.sort;

-- ── Each community's ladder ──────────────────────────────────────────────────
create table if not exists app.access_levels (
  center_id            uuid not null references app.centers(id) on delete cascade,
  key                  text not null check (key ~ '^[a-z][a-z_]{1,29}$'),
  label                text not null check (char_length(btrim(label)) between 1 and 40),
  rank                 integer not null check (rank between 0 and 1000),
  kind                 text not null check (kind in ('public', 'community', 'membership')),
  tiers                app.membership_tier[],
  membership_type_keys text[],
  primary key (center_id, key),
  -- deferred, so a save can swap two levels' places inside one transaction
  constraint access_levels_rank_unique unique (center_id, rank) deferrable initially deferred,
  -- the two base levels are fixed; the others sit above them and say who they are for
  constraint access_levels_shape check (
       (kind = 'public'     and key = 'public'    and rank = 0  and tiers is null and membership_type_keys is null)
    or (kind = 'community'  and key = 'community' and rank = 10 and tiers is null and membership_type_keys is null)
    or (kind = 'membership' and key not in ('public', 'community') and rank >= 20
        and coalesce(cardinality(tiers), 0) + coalesce(cardinality(membership_type_keys), 0) > 0))
);
comment on table app.access_levels is
  'A community''s ordered access levels (0586). public (rank 0) and community (rank 10) are fixed and only their label changes; membership levels (rank 20 and up) are the community''s own, each with a rule: tiers and/or membership_type_keys, met by an active membership of the person''s household. Written only by app.save_access_levels.';

-- ── What a community chose for each area ─────────────────────────────────────
create table if not exists app.center_feature_access (
  center_id   uuid not null references app.centers(id) on delete cascade,
  feature_key text not null references app.access_features(key),
  level_key   text not null,
  changed_by  uuid references auth.users(id) on delete set null,
  changed_at  timestamptz not null default now(),
  reason      text,
  primary key (center_id, feature_key),
  -- a level an area still uses cannot be removed
  constraint center_feature_access_level_fk foreign key (center_id, level_key) references app.access_levels(center_id, key)
);
create index if not exists center_feature_access_level_idx on app.center_feature_access (center_id, level_key);
comment on table app.center_feature_access is
  'The minimum level a community chose for an area (0586). No row means the catalog default. Written only by app.set_feature_access.';

-- ── Seeding: every community gets the starting ladder ────────────────────────
-- Existing communities now; new ones from the trigger below. Never re-adds a level the community removed
-- (it only runs when a community is created, and here once).
create or replace function app.access_seed_center(p_center uuid) returns void
language sql security definer set search_path = app, public, extensions as $$
  insert into app.access_levels (center_id, key, label, rank, kind, tiers, membership_type_keys)
  select p_center, v.key, v.label, v.rank, v.kind, v.tiers::app.membership_tier[], null
    from (values ('public',    'Public',           0,  'public',     null),
                 ('community', 'Community member', 10, 'community',  null),
                 ('member',    'Member',           20, 'membership', '{yearly,life}'),
                 ('life',      'Life member',      30, 'membership', '{life}')) v(key, label, rank, kind, tiers)
  on conflict (center_id, key) do nothing
$$;

create or replace function app.access_seed_new_center() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.access_seed_center(new.id);
  return new;
end $$;
drop trigger if exists access_seed_center on app.centers;
create trigger access_seed_center after insert on app.centers
  for each row execute function app.access_seed_new_center();
-- (The communities that exist today are seeded at the very end of this file: access_levels has a deferred
-- constraint, and Postgres refuses to alter or add triggers to a table that has pending deferred checks.)

-- ── Module map, audit, access ────────────────────────────────────────────────
insert into app.module_tables (table_name, module_key) values
  ('access_features', null), ('access_levels', null), ('center_feature_access', null)
  on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_access_features on app.access_features;
create trigger audit_access_features after insert or update or delete on app.access_features
  for each row execute function app.audit_row('key');
drop trigger if exists audit_access_levels on app.access_levels;
create trigger audit_access_levels after insert or update or delete on app.access_levels
  for each row execute function app.audit_row('center_id', 'key');
drop trigger if exists audit_center_feature_access on app.center_feature_access;
create trigger audit_center_feature_access after insert or update or delete on app.center_feature_access
  for each row execute function app.audit_row('center_id', 'feature_key');

alter table app.access_features enable row level security;
alter table app.access_levels enable row level security;
alter table app.center_feature_access enable row level security;

-- The catalog is public (it names areas, not people). The ladder and the choices are for the people who
-- manage settings or content; everyone else learns their own access from feature_access_for_me.
drop policy if exists access_features_read on app.access_features;
create policy access_features_read on app.access_features for select to anon, authenticated using (true);
drop policy if exists access_levels_staff_read on app.access_levels;
create policy access_levels_staff_read on app.access_levels for select to authenticated
  using (app.has_permission(center_id, 'settings.manage') or app.has_permission(center_id, 'content.manage'));
drop policy if exists center_feature_access_staff_read on app.center_feature_access;
create policy center_feature_access_staff_read on app.center_feature_access for select to authenticated
  using (app.has_permission(center_id, 'settings.manage') or app.has_permission(center_id, 'content.manage'));

-- No write policy and no write privilege: the three RPCs below write.
revoke all on app.access_features, app.access_levels, app.center_feature_access from public, anon, authenticated;
grant select on app.access_features to anon, authenticated;
grant select on app.access_levels, app.center_feature_access to authenticated;
grant all on app.access_features, app.access_levels, app.center_feature_access to service_role;

-- A sandbox reset clears every center table that is not on the keep list (0310). A community's access
-- settings are its own configuration, kept like its module switches. Listed here, in the function that
-- builds the clear list, so a later rewrite of demo_keep_tables() cannot expose them to a reset.
create or replace function app.demo_clear_tables() returns text[]
language sql stable set search_path = app, public, extensions as $$
  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r'
     and (exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'center_id' and not a.attisdropped)
          or c.relname in ('gyan_levels','gyan_steps'))
     and c.relname <> all (app.demo_keep_tables())
     and c.relname <> all (array['access_levels', 'center_feature_access']::text[])
$$;

-- ── Who is this person, in this community? ───────────────────────────────────
-- One row: the level (key, label, rank) and whether anyone is signed in. Guests and signed-in people who are
-- not linked to the community are public. A platform admin is judged like anyone else: by their own link and
-- household (they pass the staff policies of the tables separately). Several memberships: the highest level
-- wins. Another community's memberships never count.
create or replace function app.my_access(p_center uuid)
returns table (key text, label text, rank integer, signed_in boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare
  v_uid    uuid := auth.uid();
  v_linked boolean := false;
  v_key    text := 'public';
  v_label  text;
  v_rank   integer;
  v_today  date;
  m        record;
begin
  if v_uid is not null and p_center is not null then
    v_linked := exists (select 1 from app.center_users cu where cu.center_id = p_center and cu.user_id = v_uid);
  end if;
  if v_linked then v_key := 'community'; end if;

  select l.label, l.rank into v_label, v_rank from app.access_levels l where l.center_id = p_center and l.key = v_key;
  if v_label is null then
    -- the community's ladder is missing (it should not be): the platform's own names and ranks
    v_label := case v_key when 'community' then 'Community member' else 'Public' end;
    v_rank  := case v_key when 'community' then 10 else 0 end;
  end if;

  if v_linked and app.module_enabled(p_center, 'membership') then
    begin
      select (now() at time zone coalesce(c.time_zone, 'UTC'))::date into v_today from app.centers c where c.id = p_center;
    exception when others then
      v_today := null;                                   -- a time zone name the database does not know: use the database's date
    end;
    v_today := coalesce(v_today, current_date);
    select l.key, l.label, l.rank into m
      from app.access_levels l
     where l.center_id = p_center and l.kind = 'membership' and l.rank > v_rank
       and exists (
             select 1
               from app.memberships ms
               left join app.membership_types t on t.id = ms.membership_type_id
              where ms.center_id = p_center
                and ms.household_id in (select app.my_household_ids(p_center))
                and ms.status = 'active'
                and ms.starts_on <= v_today
                and (ms.ends_on is null or ms.ends_on >= v_today)
                and ((l.tiers is not null and ms.tier = any (l.tiers))
                     or (l.membership_type_keys is not null and t.key = any (l.membership_type_keys))))
     order by l.rank desc
     limit 1;
    if m.key is not null then
      v_key := m.key; v_label := m.label; v_rank := m.rank;
    end if;
  end if;

  return query select v_key, v_label, v_rank, v_uid is not null;
end $$;

-- The level an area needs in a community: the community's choice, else the catalog default, never below the
-- area's floor (a choice below the floor, which the RPC refuses, is lifted to it). Nothing when the
-- community's ladder is missing; the callers then use the catalog default.
create or replace function app.feature_min_level(p_center uuid, p_feature text)
returns table (key text, label text, rank integer)
language sql stable security definer set search_path = app, public, extensions as $$
  select x.key, x.label, x.rank
    from (
      select l.key, l.label, l.rank
        from app.access_features f
        left join app.center_feature_access s on s.center_id = p_center and s.feature_key = f.key
        join app.access_levels l on l.center_id = p_center and l.key = coalesce(s.level_key, f.default_level)
       where f.key = p_feature
      union all
      select l.key, l.label, l.rank
        from app.access_features f
        join app.access_levels l on l.center_id = p_center and l.key = f.floor_level
       where f.key = p_feature
    ) x
   order by x.rank desc
   limit 1
$$;

-- May the caller use this area in this community? The member-facing rule: false when the area's module is
-- off, else true when the caller's level reaches the area's minimum. Staff are not special here (policies add
-- their own staff access). Never raises: it runs inside row level security policies. An unknown area or
-- community is false.
create or replace function app.can_use_feature(p_center uuid, p_feature text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare f app.access_features; v_min integer; v_rank integer;
begin
  select * into f from app.access_features where key = p_feature;
  if f.key is null or p_center is null then return false; end if;
  if f.module_key is not null and not app.module_enabled(p_center, f.module_key) then return false; end if;
  select m.rank into v_min from app.feature_min_level(p_center, f.key) m;
  v_min := coalesce(v_min, case f.default_level when 'public' then 0 else 10 end);
  if v_min <= 0 then                                   -- open to everyone: no membership lookup needed
    return exists (select 1 from app.centers c where c.id = p_center);
  end if;
  select a.rank into v_rank from app.my_access(p_center) a;
  return coalesce(v_rank, 0) >= v_min;
end $$;

-- What the member app asks once per community, with or without a session:
--   {"level": {"key","label","rank"}, "signed_in": bool,
--    "features": {"<area>": {"allowed": bool, "reason": null | "sign_in" | "level" | "module_off",
--                            "min_level": {"key","label","rank"}}}}
-- reason: module_off = the area's module is switched off; sign_in = the caller is not signed in and the area
-- needs more than public; level = signed in but below the minimum.
create or replace function app.feature_access_for_me(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare me record; f record; v_out jsonb := '{}'::jsonb; v_on boolean; v_ok boolean; v_reason text;
        v_min_key text; v_min_label text; v_min_rank integer;
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  select * into me from app.my_access(p_center);
  for f in select * from app.access_features order by sort, key loop
    select m.key, m.label, m.rank into v_min_key, v_min_label, v_min_rank from app.feature_min_level(p_center, f.key) m;
    if v_min_key is null then
      -- the community's ladder is missing (it should not be): the catalog default, by the platform's own names
      v_min_key := f.default_level;
      v_min_label := case f.default_level when 'community' then 'Community member' else 'Public' end;
      v_min_rank := case f.default_level when 'community' then 10 else 0 end;
    end if;
    v_on := f.module_key is null or app.module_enabled(p_center, f.module_key);
    v_ok := v_on and me.rank >= v_min_rank;
    v_reason := case when not v_on then 'module_off'
                     when v_ok then null
                     when not me.signed_in then 'sign_in'
                     else 'level' end;
    v_out := v_out || jsonb_build_object(f.key, jsonb_build_object(
               'allowed', v_ok, 'reason', v_reason,
               'min_level', jsonb_build_object('key', v_min_key, 'label', v_min_label, 'rank', v_min_rank)));
  end loop;
  return jsonb_build_object('level', jsonb_build_object('key', me.key, 'label', me.label, 'rank', me.rank),
                            'signed_in', me.signed_in, 'features', v_out);
end $$;

-- ── Settings › Access levels ─────────────────────────────────────────────────
-- Can anyone reach this level? A membership level needs a tier, or a membership type the community still offers.
create or replace function app.access_level_reachable(p_center uuid, p_level text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select l.kind <> 'membership'
                          or coalesce(cardinality(l.tiers), 0) > 0
                          or exists (select 1 from app.membership_types t
                                      where t.center_id = l.center_id and t.active and t.key = any (l.membership_type_keys))
                     from app.access_levels l where l.center_id = p_center and l.key = p_level), false)
$$;

-- Everything the page needs, for people who manage settings:
--   levels            [{key,label,rank,kind,tiers,membership_type_keys,locked}] in rank order (locked = a base level)
--   features          [{key,label,description,default_level,floor_level,level_key,enforced_by,module_key,module_on}]
--                     level_key is the level the area needs now (the choice, else the default)
--   membership_types  [{key,name,tier,active}]
--   membership_on     false while the Membership module is off (then nobody reaches a membership level)
create or replace function app.access_settings(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not (app.has_permission(p_center, 'settings.manage') or app.is_platform_admin()) then
    raise exception 'Seeing who can use each area needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'levels', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', l.key, 'label', l.label, 'rank', l.rank, 'kind', l.kind,
                 'tiers', coalesce(to_jsonb(l.tiers::text[]), '[]'::jsonb),
                 'membership_type_keys', coalesce(to_jsonb(l.membership_type_keys), '[]'::jsonb),
                 'locked', l.kind <> 'membership') order by l.rank)
                 from app.access_levels l where l.center_id = p_center), '[]'::jsonb),
    'features', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', f.key, 'label', f.label, 'description', f.description,
                 'default_level', f.default_level, 'floor_level', f.floor_level,
                 'level_key', coalesce((select m.key from app.feature_min_level(p_center, f.key) m), f.default_level),
                 'enforced_by', f.enforced_by, 'module_key', f.module_key,
                 'module_on', f.module_key is null or app.module_enabled(p_center, f.module_key)) order by f.sort, f.key)
                 from app.access_features f), '[]'::jsonb),
    'membership_types', coalesce((select jsonb_agg(jsonb_build_object('key', t.key, 'name', t.name, 'tier', t.tier, 'active', t.active)
                                                   order by t.active desc, t.tier, t.name)
                                    from app.membership_types t where t.center_id = p_center), '[]'::jsonb),
    'membership_on', app.module_enabled(p_center, 'membership'));
end $$;

-- Choose the lowest level that may use an area. Refuses a level below the area's floor, one that does not
-- exist, and one nobody can reach. Needs settings.manage, a reason and a fresh 2FA check, like switching a module.
create or replace function app.set_feature_access(p_center uuid, p_feature text, p_level_key text, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare f app.access_features; l app.access_levels; fl app.access_levels;
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not (app.has_permission(p_center, 'settings.manage') or app.is_platform_admin()) then
    raise exception 'Changing who can use an area needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  select * into f from app.access_features where key = p_feature;
  if f.key is null then raise exception 'There is no area called "%".', p_feature; end if;
  select * into l from app.access_levels where center_id = p_center and key = p_level_key;
  if l.key is null then raise exception 'There is no access level called "%" in this community.', p_level_key; end if;
  select * into fl from app.access_levels where center_id = p_center and key = f.floor_level;
  if fl.key is not null and l.rank < fl.rank then
    raise exception '% cannot be opened to %: its content is kept for signed-in members only, so choose % or a higher level.',
      f.label, l.label, fl.label;
  end if;
  if not app.access_level_reachable(p_center, l.key) then
    raise exception 'Nobody can reach "%": none of its membership types is offered any more. Change that level''s rule first.', l.label;
  end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Give a reason for changing who can use %. It goes in the audit log.', f.label;
  end if;
  -- One change at a time per community.
  perform pg_advisory_xact_lock(hashtextextended('app.access:' || p_center::text, 0));
  perform app.assert_step_up('access.change');
  perform app.set_audit_context(p_reason);
  insert into app.center_feature_access (center_id, feature_key, level_key, changed_by, changed_at, reason)
  values (p_center, f.key, l.key, auth.uid(), now(), app.audit_clean_reason(p_reason))
  on conflict (center_id, feature_key) do update
    set level_key = excluded.level_key, changed_by = excluded.changed_by, changed_at = excluded.changed_at, reason = excluded.reason;
end $$;

-- Replace the community's membership levels and the two base names in one go.
--   p_levels       [{key, label, rank, tiers: ["life", …], membership_type_keys: ["senior_yearly", …]}, …]
--                  the membership levels (rank 20 up); a level left out is removed, unless an area still uses it
--   p_base_labels  {"public": "Public", "community": "Community member"}; a name left out is kept
-- Refuses what the tables would: a bad key, a rank below 20 or used twice, a name that is empty, too long or used
-- twice, a rule that names no tier or type, a type the community does not have; and removing a level an area
-- still uses (the error names the areas). The two base levels' keys and ranks are never touched.
create or replace function app.save_access_levels(p_center uuid, p_levels jsonb, p_base_labels jsonb, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_item jsonb; v_key text; v_label text; v_rank integer; v_tiers app.membership_tier[]; v_types text[]; v_txt text[];
  v_keys text[] := '{}'; v_ranks integer[] := '{}'; v_labels text[] := '{}';
  v_pub text; v_com text; v_bad text; v_used text; v_old record; v_before jsonb; v_after jsonb;
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not (app.has_permission(p_center, 'settings.manage') or app.is_platform_admin()) then
    raise exception 'Changing the access levels needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  if p_levels is null or jsonb_typeof(p_levels) <> 'array' then
    raise exception 'Send the membership levels as a list.';
  end if;
  if p_base_labels is not null and jsonb_typeof(p_base_labels) <> 'object' then
    raise exception 'Send the names of the Public and Community levels as an object.';
  end if;
  if jsonb_array_length(p_levels) > 10 then
    raise exception 'A community can have at most 10 membership levels above its community level.';
  end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Give a reason for changing the access levels. It goes in the audit log.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('app.access:' || p_center::text, 0));
  perform app.assert_step_up('access.change');

  -- The two base names (rank 0 and 10 and their keys are fixed).
  v_pub := btrim(coalesce(p_base_labels->>'public', (select l.label from app.access_levels l where l.center_id = p_center and l.key = 'public'), 'Public'));
  v_com := btrim(coalesce(p_base_labels->>'community', (select l.label from app.access_levels l where l.center_id = p_center and l.key = 'community'), 'Community member'));
  if char_length(v_pub) not between 1 and 40 or v_pub ~ '[[:cntrl:]]' then
    raise exception 'Give the Public level a name of 1 to 40 characters.';
  end if;
  if char_length(v_com) not between 1 and 40 or v_com ~ '[[:cntrl:]]' then
    raise exception 'Give the community level a name of 1 to 40 characters.';
  end if;
  v_labels := array[lower(v_pub), lower(v_com)];
  if lower(v_pub) = lower(v_com) then
    raise exception 'Two levels cannot share the name "%". Give each level its own name.', v_pub;
  end if;

  for v_item in select * from jsonb_array_elements(p_levels) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each membership level needs a name, a position and a rule.';
    end if;
    v_key := v_item->>'key';
    v_label := btrim(coalesce(v_item->>'label', ''));
    if v_key is null or v_key !~ '^[a-z][a-z_]{1,29}$' then
      raise exception 'The key of a level must be 2 to 30 lower-case letters and underscores, starting with a letter (got "%").', coalesce(v_key, '');
    end if;
    if v_key in ('public', 'community') then
      raise exception '"%" is one of the two fixed levels; its name is set on its own, and it cannot be a membership level.', v_key;
    end if;
    if v_key = any (v_keys) then raise exception 'The level key "%" is used twice.', v_key; end if;
    if char_length(v_label) not between 1 and 40 or v_label ~ '[[:cntrl:]]' then
      raise exception 'Give the level "%" a name of 1 to 40 characters.', v_key;
    end if;
    if lower(v_label) = any (v_labels) then
      raise exception 'Two levels cannot share the name "%". Give each level its own name.', v_label;
    end if;
    if coalesce(v_item->>'rank', '') !~ '^[0-9]{1,4}$' then
      raise exception 'The position of "%" must be a whole number.', v_label;
    end if;
    v_rank := (v_item->>'rank')::integer;
    if v_rank < 20 or v_rank > 1000 then
      raise exception 'The position of "%" must be between 20 and 1000 (Public is 0 and the community level is 10).', v_label;
    end if;
    if v_rank = any (v_ranks) then
      raise exception 'Two levels cannot share the position %. Give "%" its own place in the order.', v_rank, v_label;
    end if;

    if v_item->'tiers' is not null and jsonb_typeof(v_item->'tiers') not in ('array', 'null') then
      raise exception 'The membership tiers of "%" must be a list.', v_label;
    end if;
    if v_item->'membership_type_keys' is not null and jsonb_typeof(v_item->'membership_type_keys') not in ('array', 'null') then
      raise exception 'The membership types of "%" must be a list.', v_label;
    end if;
    v_txt := coalesce(array(select distinct t from jsonb_array_elements_text(
                              case when jsonb_typeof(v_item->'tiers') = 'array' then v_item->'tiers' else '[]'::jsonb end) t), '{}');
    select string_agg(t, ', ') into v_bad from unnest(v_txt) t where t <> all (enum_range(null::app.membership_tier)::text[]);
    if v_bad is not null then
      raise exception 'There is no membership tier called "%" (the tiers are community, yearly and life).', v_bad;
    end if;
    v_tiers := array(select t::app.membership_tier from unnest(v_txt) t order by t::app.membership_tier);
    v_types := coalesce(array(select distinct t from jsonb_array_elements_text(
                              case when jsonb_typeof(v_item->'membership_type_keys') = 'array' then v_item->'membership_type_keys' else '[]'::jsonb end) t
                             order by t), '{}');
    select string_agg(k, ', ') into v_bad from unnest(v_types) k
     where not exists (select 1 from app.membership_types mt where mt.center_id = p_center and mt.key = k);
    if v_bad is not null then
      raise exception 'This community has no membership type called "%".', v_bad;
    end if;
    if cardinality(v_tiers) + cardinality(v_types) = 0 then
      raise exception 'Choose at least one membership tier or type for "%", so the level says who it is for.', v_label;
    end if;

    v_keys := v_keys || v_key;
    v_ranks := v_ranks || v_rank;
    v_labels := v_labels || lower(v_label);
  end loop;

  -- (An object, not a bare list: the audit log masks personal fields by key, which a list would turn into extra elements.)
  select jsonb_build_object('levels', coalesce(jsonb_agg(jsonb_build_object('key', l.key, 'label', l.label, 'rank', l.rank, 'tiers', l.tiers,
                                                                              'membership_type_keys', l.membership_type_keys) order by l.rank), '[]'::jsonb))
    into v_before from app.access_levels l where l.center_id = p_center;

  -- A level that goes away must not be one an area still uses.
  for v_old in select l.key, l.label from app.access_levels l
                where l.center_id = p_center and l.kind = 'membership' and l.key <> all (v_keys) order by l.rank loop
    select string_agg(f.label, ', ' order by f.sort) into v_used
      from app.center_feature_access s join app.access_features f on f.key = s.feature_key
     where s.center_id = p_center and s.level_key = v_old.key;
    if v_used is not null then
      raise exception 'The level "%" cannot be removed while it is the level for: %. Choose another level for those areas first.', v_old.label, v_used;
    end if;
  end loop;

  perform app.set_audit_context(p_reason);
  delete from app.access_levels l where l.center_id = p_center and l.kind = 'membership' and l.key <> all (v_keys);

  insert into app.access_levels (center_id, key, label, rank, kind, tiers, membership_type_keys)
  values (p_center, 'public', v_pub, 0, 'public', null, null), (p_center, 'community', v_com, 10, 'community', null, null)
  on conflict (center_id, key) do update set label = excluded.label;

  for v_item in select * from jsonb_array_elements(p_levels) loop
    v_txt := coalesce(array(select distinct t from jsonb_array_elements_text(
                              case when jsonb_typeof(v_item->'tiers') = 'array' then v_item->'tiers' else '[]'::jsonb end) t), '{}');
    v_tiers := array(select t::app.membership_tier from unnest(v_txt) t order by t::app.membership_tier);
    v_types := coalesce(array(select distinct t from jsonb_array_elements_text(
                              case when jsonb_typeof(v_item->'membership_type_keys') = 'array' then v_item->'membership_type_keys' else '[]'::jsonb end) t
                             order by t), '{}');
    insert into app.access_levels (center_id, key, label, rank, kind, tiers, membership_type_keys)
    values (p_center, v_item->>'key', btrim(v_item->>'label'), (v_item->>'rank')::integer, 'membership',
            nullif(v_tiers, '{}'::app.membership_tier[]), nullif(v_types, '{}'::text[]))
    on conflict (center_id, key) do update
      set label = excluded.label, rank = excluded.rank, tiers = excluded.tiers, membership_type_keys = excluded.membership_type_keys;
  end loop;

  select jsonb_build_object('levels', coalesce(jsonb_agg(jsonb_build_object('key', l.key, 'label', l.label, 'rank', l.rank, 'tiers', l.tiers,
                                                                              'membership_type_keys', l.membership_type_keys) order by l.rank), '[]'::jsonb))
    into v_after from app.access_levels l where l.center_id = p_center;
  perform app.log_audit(p_center, 'access.levels_saved', 'access_levels', p_center::text, v_before, v_after, p_reason);
end $$;

-- ── Darshan: guests may watch it when the community's level allows ───────────
-- 0010's content_published let ANY member of a community read every published item of it. For the live
-- darshan stream that is now the community's choice (default: everyone, signed in or not), so the member branch
-- no longer covers kind darshan_stream. Everything else it allowed it still allows: shared rows
-- (center_id null), public guide pages and FAQ, every other kind for the community's members.
drop policy if exists content_published on app.content_items;
create policy content_published on app.content_items for select to anon, authenticated
  using (status = 'published'
         and (center_id is null
              or kind in ('guide_page', 'faq')
              or (kind <> 'darshan_stream' and app.is_member_of(center_id))));

-- The member-facing rule, for guests and members alike: the published stream of a community whose darshan
-- level the caller meets (and whose Content module is on: can_use_feature checks it).
drop policy if exists content_darshan_feature on app.content_items;
create policy content_darshan_feature on app.content_items for select to anon, authenticated
  using (kind = 'darshan_stream' and status = 'published' and center_id is not null
         and app.can_use_feature(center_id, 'darshan'));

-- Staff who could read a published stream before (as members of the community) still can, so the portal's
-- Content › Today & darshan shows the stream to everyone who has content.view, whatever level they hold.
-- (People who manage content already read every row through content_manage.)
drop policy if exists content_darshan_staff on app.content_items;
create policy content_darshan_staff on app.content_items for select to authenticated
  using (kind = 'darshan_stream' and status = 'published' and center_id is not null
         and app.has_permission(center_id, 'content.view'));

-- ── Access ───────────────────────────────────────────────────────────────────
revoke execute on function app.my_access(uuid), app.can_use_feature(uuid, text), app.feature_access_for_me(uuid) from public;
grant execute on function app.my_access(uuid), app.can_use_feature(uuid, text), app.feature_access_for_me(uuid) to anon, authenticated;
-- Internal: not callable over the API.
revoke execute on function app.feature_min_level(uuid, text), app.access_level_reachable(uuid, text),
  app.access_seed_center(uuid), app.access_seed_new_center() from public, anon, authenticated;
-- Settings › Access levels.
revoke execute on function app.access_settings(uuid), app.set_feature_access(uuid, text, text, text),
  app.save_access_levels(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function app.access_settings(uuid), app.set_feature_access(uuid, text, text, text),
  app.save_access_levels(uuid, jsonb, jsonb, text) to authenticated;
-- The service role gets exactly these ten functions. (Not "all functions in the schema": later migrations took some
-- worker-only functions away from it on purpose, and a blanket grant here would give them back.)
grant execute on function app.my_access(uuid), app.can_use_feature(uuid, text), app.feature_access_for_me(uuid),
  app.feature_min_level(uuid, text), app.access_level_reachable(uuid, text), app.access_seed_center(uuid),
  app.access_seed_new_center(), app.access_settings(uuid), app.set_feature_access(uuid, text, text, text),
  app.save_access_levels(uuid, jsonb, jsonb, text) to service_role;

-- ── The communities that exist today get the starting ladder ─────────────────
-- Last on purpose (see above). Recorded in the audit log as the system's own change, with its reason.
do $$
begin
  perform app.set_audit_context('Starting access levels for every community (migration 0586)');
  perform app.access_seed_center(id) from app.centers;
end $$;
