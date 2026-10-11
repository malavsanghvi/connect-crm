-- 0621 · Recording activity (backlog B91): app.record_activity, the opt-out, the community switch and its guard.
--
-- THE CONTRACT with the portal and the member app (built in parallel against exactly this):
--   app.record_activity(p_center uuid, p_events jsonb) returns integer      -- how many events were stored
--   each event: { key, kind: 'action'|'screen', entity_kind?, entity_id?, outcome: 'ok'|'error'|'cancelled', error_code?,
--                 duration_ms?, via: 'screen'|'palette'|'assistant'|'app', seq?, session_id?, app_version?, platform?, at? }
--   The person and the community come from the SIGN-IN (auth.uid(), and p_center only as a claim that has to be true):
--   nothing in the payload can name a person, a community or a role. It never raises for bad input; it drops, and counts
--   only what it stored. What it drops:
--     * a kind 'action' whose key is not in app.activity_catalog (the allowlist)
--     * a kind 'screen' whose key is not a route pattern (app.activity_screen_key_norm: lower-case segments, [name]
--       placeholders, no segment that looks like a number, a uuid or another id, at most 80 characters)
--     * everything for a person the records do not show to be an adult (app.activity_person_ok), for a platform admin,
--       for a person who opted out, and for a sign-in that does not belong to p_center
--     * everything when the community's switch is off: centers.rules.activity.enabled must be the boolean true, and it is
--       false when absent, so merging this changes nothing until a platform admin switches a community on
--     * events past the first 100 of a call, and events past a person's allowance of 2000 per hour per community
--   Values are held to their shapes: entity_kind from the catalog (an action's comes from the catalog itself), entity_id a
--   uuid, error_code a short code (a-z 0-9 _ . -, only for outcome error), duration_ms 0 to 3,600,000, `at` an ISO time
--   held within 7 days before and 5 minutes after now (missing: now), session_id, app_version and platform short tokens.
--   Anything else in an event is ignored, and anything that does not fit is stored as empty, never as free text.
--   `via` missing: 'app' for a member-app action, 'screen' otherwise. An action's surface is the catalog's; a screen's is
--   'member' when via is 'app' and 'portal' otherwise.
--
--   app.set_activity_opt_out(p_out boolean)   the signed-in person's own switch, for every community. Opting out also
--                                             deletes the person's events already stored.
--   app.activity_status(p_center uuid)        {enabled, opted_out, eligible} for the signed-in person: lets the apps stay quiet
--                                             and show the Privacy switch only where recording can happen.
--   app.set_activity_recording(p_center, p_enabled)   platform admins only: the community's switch.
--   Trigger centers_activity_guard            a community's own administrators can switch recording OFF but not ON.

-- ── The community's switch: only a platform admin may turn it on ─────────────
create or replace function app.centers_activity_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null or app.is_platform_admin() then return new; end if;   -- the database owner, the background service, Weaver
  if (new.rules #>> '{activity,enabled}') = 'true' then
    raise exception 'Weaver switches activity recording on for a community. Ask the Weaver team.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists centers_activity_guard on app.centers;
create trigger centers_activity_guard before update of rules on app.centers
  for each row when ((old.rules -> 'activity') is distinct from (new.rules -> 'activity'))
  execute function app.centers_activity_guard();

create or replace function app.set_activity_recording(p_center uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Weaver team can switch activity recording on or off.' using errcode = '42501';
  end if;
  update app.centers c
     set rules = jsonb_set(coalesce(c.rules, '{}'::jsonb), '{activity}',
                           (case when jsonb_typeof(c.rules -> 'activity') = 'object' then c.rules -> 'activity' else '{}'::jsonb end)
                           || jsonb_build_object('enabled', coalesce(p_enabled, false)), true)
   where c.id = p_center;
  if not found then
    raise exception 'That community was not found.' using errcode = 'P0002';
  end if;
end $$;

-- ── Recording ────────────────────────────────────────────────────────────────
create or replace function app.record_activity(p_center uuid, p_events jsonb) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_uid   uuid := auth.uid();
  v_hash  text;
  v_roles text[];
  v_used  integer;
  v_allow integer;
  v_n     integer := 0;
begin
  -- The cheap refusals first. All of them are silent: a beacon must never break what the person is doing.
  if v_uid is null or p_center is null or p_events is null then return 0; end if;
  if jsonb_typeof(p_events) <> 'array' then return 0; end if;
  if jsonb_array_length(p_events) = 0 then return 0; end if;
  if not app.activity_enabled(p_center) then return 0; end if;
  if app.is_platform_admin() then return 0; end if;
  if exists (select 1 from app.activity_optouts o where o.user_id = v_uid) then return 0; end if;
  if not app.activity_person_ok(p_center, v_uid) then return 0; end if;

  v_hash := app.activity_actor_hash(p_center, v_uid, true);

  -- Rate limit: 2000 events per person per community per hour, 100 per call.
  select count(*) into v_used from app.activity_events e
   where e.center_id = p_center and e.actor_hash = v_hash and e.received_at > now() - interval '1 hour';
  v_allow := least(100, 2000 - v_used);
  if v_allow <= 0 then return 0; end if;

  -- The roles held now (operational and center tier; a plain member has none), and "owner" for the community's owner.
  select coalesce(array_agg(distinct g.role_key order by g.role_key), '{}'::text[]) into v_roles
    from app.role_grants g join app.roles r on r.key = g.role_key
   where g.center_id = p_center and g.user_id = v_uid and g.status = 'active' and r.tier <> 'family'
     and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now());
  if exists (select 1 from app.center_owners w where w.center_id = p_center and w.user_id = v_uid) then
    v_roles := array_append(v_roles, 'owner');
  end if;

  with src as (
    select g.i + 1 as ord, p_events -> g.i as ev
      from generate_series(0, least(jsonb_array_length(p_events), 100) - 1) as g(i)
  ), f as (
    select s.ord,
           case when jsonb_typeof(s.ev -> 'key') = 'string' then s.ev ->> 'key' end as k,
           case when jsonb_typeof(s.ev -> 'kind') = 'string' then s.ev ->> 'kind' end as kd,
           case when jsonb_typeof(s.ev -> 'entity_kind') = 'string' then s.ev ->> 'entity_kind' end as ek,
           case when jsonb_typeof(s.ev -> 'entity_id') = 'string' then s.ev ->> 'entity_id' end as eid,
           coalesce(case when jsonb_typeof(s.ev -> 'outcome') = 'string' then s.ev ->> 'outcome' end, 'ok') as oc,
           case when jsonb_typeof(s.ev -> 'error_code') = 'string' then s.ev ->> 'error_code' end as ec,
           case when jsonb_typeof(s.ev -> 'duration_ms') = 'number' then s.ev ->> 'duration_ms' end as dur,
           case when jsonb_typeof(s.ev -> 'via') = 'string' then s.ev ->> 'via' end as vi,
           case when jsonb_typeof(s.ev -> 'seq') = 'number' then s.ev ->> 'seq' end as sq,
           case when jsonb_typeof(s.ev -> 'session_id') = 'string' then s.ev ->> 'session_id' end as sid,
           case when jsonb_typeof(s.ev -> 'app_version') = 'string' then s.ev ->> 'app_version' end as av,
           case when jsonb_typeof(s.ev -> 'platform') = 'string' then s.ev ->> 'platform' end as pf,
           case when jsonb_typeof(s.ev -> 'at') = 'string' then s.ev ->> 'at' end as at_txt
      from src s
     where jsonb_typeof(s.ev) = 'object'
  ), v as (
    select f.*, c.surface as c_surface, c.entity_kind as c_ek,
           case when f.kd = 'screen' then app.activity_screen_key_norm(f.k) end as skey
      from f
      left join app.activity_catalog c on c.key = f.k and c.kind = 'action' and f.kd = 'action'
     where f.oc in ('ok', 'error', 'cancelled')
       and (f.vi is null or f.vi in ('screen', 'palette', 'assistant', 'app'))
       and ((f.kd = 'action' and c.key is not null)
         or (f.kd = 'screen' and app.activity_screen_key_norm(f.k) is not null))
  )
  insert into app.activity_events (center_id, occurred_at, session_id, seq, surface, actor_hash, role_keys, key, kind,
                                   entity_kind, entity_id, outcome, error_code, duration_ms, via, app_version, platform)
  select p_center,
         least(greatest(coalesce(app.activity_ts(v.at_txt), now()), now() - interval '7 days'), now() + interval '5 minutes'),
         case when v.sid ~ '^[A-Za-z0-9_-]{8,64}$' then v.sid end,
         app.activity_int(v.sq, 0, 1000000),
         case when v.kd = 'action' then v.c_surface
              when coalesce(v.vi, 'screen') = 'app' then 'member'
              else 'portal' end,
         v_hash, v_roles,
         case when v.kd = 'action' then v.k else v.skey end,
         v.kd,
         case when v.kd = 'action' then v.c_ek
              else (select x.entity_kind from app.activity_catalog x where x.entity_kind = v.ek limit 1) end,
         app.activity_uuid(v.eid),
         v.oc,
         case when v.oc = 'error' and lower(v.ec) ~ '^[a-z0-9_.-]{1,40}$' then lower(v.ec) end,
         app.activity_int(v.dur, 0, 3600000),
         coalesce(v.vi, case when v.kd = 'action' and v.c_surface = 'member' then 'app' else 'screen' end),
         case when v.av ~ '^[0-9A-Za-z._+-]{1,32}$' then v.av end,
         case when lower(v.pf) ~ '^[a-z0-9_-]{1,16}$' then lower(v.pf) end
    from v
   order by v.ord
   limit v_allow;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function app.record_activity(uuid, jsonb) is
  'Store a batch of activity events for the signed-in person in p_center (0621). Person and community come from the sign-in; unknown keys, id-like screen routes, minors, opted-out people, platform admins and communities with recording off are dropped silently. At most 100 events per call, 2000 per person per hour. Returns how many were stored.';

-- ── The person's own switch ──────────────────────────────────────────────────
-- Opting out stops recording in every community and deletes the person's events already stored (found by their pseudonym
-- in each community they belong to). Opting back in starts again from then on.
create or replace function app.set_activity_opt_out(p_out boolean) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_uid uuid := auth.uid(); r record; v_hash text;
begin
  if v_uid is null then
    raise exception 'Sign in to change this setting.' using errcode = '28000';
  end if;
  if coalesce(p_out, false) then
    insert into app.activity_optouts (user_id) values (v_uid) on conflict (user_id) do nothing;
    for r in select cu.center_id from app.center_users cu where cu.user_id = v_uid loop
      v_hash := app.activity_actor_hash(r.center_id, v_uid, false);
      if v_hash is not null then
        delete from app.activity_events e where e.center_id = r.center_id and e.actor_hash = v_hash;
      end if;
    end loop;
  else
    delete from app.activity_optouts o where o.user_id = v_uid;
  end if;
end $$;
comment on function app.set_activity_opt_out(boolean) is 'The signed-in person''s own switch: true stops activity recording for them in every community and deletes what was already stored about them; false starts it again (0621).';

create or replace function app.activity_status(p_center uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'enabled', app.activity_enabled(p_center),
    'opted_out', exists (select 1 from app.activity_optouts o where o.user_id = auth.uid()),
    'eligible', coalesce(auth.uid() is not null and not app.is_platform_admin()
                         and app.activity_person_ok(p_center, auth.uid()), false))
$$;
comment on function app.activity_status(uuid) is 'For the signed-in person in p_center: {enabled: recording is on for the community, opted_out: they chose not to be recorded, eligible: the records show them to be an adult who can be recorded} (0621).';

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app.record_activity(uuid, jsonb), app.set_activity_opt_out(boolean), app.activity_status(uuid),
  app.set_activity_recording(uuid, boolean), app.centers_activity_guard()
  from public, anon, authenticated, service_role;
grant execute on function app.record_activity(uuid, jsonb), app.set_activity_opt_out(boolean), app.activity_status(uuid),
  app.set_activity_recording(uuid, boolean) to authenticated;
