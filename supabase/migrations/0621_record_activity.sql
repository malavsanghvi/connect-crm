-- 0621 · Recording activity (backlog B91): the community's agreement, app.record_activity, the opt-out and the guard.
--
-- OWNER DECISIONS recorded 2026-10-11: members are told with a notice and can opt out; the ADMINISTRATOR of each community
-- agrees too (below); retention 400 days; Weaver sees cross-community counts only for a community that opted in to sharing.
--
-- THE COMMUNITY'S AGREEMENT (all of it in centers.rules.activity; every step is audited, centers is audited and each function
-- also writes a named entry: activity.consent_given, activity.consent_withdrawn, activity.sharing_changed, activity.recording_on|off)
--   app.give_activity_consent(p_center uuid, p_share_with_weaver boolean, p_notice_version text)
--       a person with settings.manage in THAT community (never a platform admin), after a fresh 2FA check
--       (app.assert_step_up('activity.consent')): records consent = {by, at, version}, sets enabled = true and
--       share_with_weaver as given. p_notice_version names the notice they read (letters, digits . _ -, up to 40).
--   app.withdraw_activity_consent(p_center uuid)
--       the same permission (no 2FA check: stopping is always safe): enabled = false, the consent record and the share
--       flag removed, withdrawn = {by, at} kept. What was recorded stays until the 400-day purge.
--   app.set_activity_sharing(p_center uuid, p_share boolean)
--       settings.manage + a fresh 2FA check (activity.sharing); only while a consent record exists.
--   app.set_activity_recording(p_center uuid, p_enabled boolean)
--       a platform admin: OFF at any time; ON only while the community's consent record exists, else the plain-English error
--       "The community's administrator has not agreed yet."
--   Trigger centers_activity_guard
--       an ordinary write of centers.rules cannot change rules.activity.consent or share_with_weaver, cannot switch
--       recording on, and a community's own administrators cannot switch it at all outside the functions above (a platform
--       admin may only switch it off); recording can never be on without a consent record.
--   Recording is on only while a consent record exists. Weaver (platform admins) reads a community's ideas, usage totals,
--   cross-community counts and raw events only if recording is on AND share_with_weaver is true.
--
-- THE CONTRACT with the portal and the member app (built in parallel against exactly this):
--   app.record_activity(p_center uuid, p_events jsonb) returns integer      -- how many events were stored
--   each event: { key, kind: 'action'|'screen', outcome: 'ok'|'error'|'cancelled', error_code?, duration_ms?,
--                 via: 'screen'|'palette'|'assistant'|'app' (required), entity_id?, seq?, session_id?, app_version?, platform?, at? }
--   (entity_kind may be sent; it is ignored: the kind of record comes from the allowlist.)
--   The person and the community come from the SIGN-IN (auth.uid(), and p_center only as a claim that has to be true):
--   nothing in the payload can name a person, a community, a role or a surface. It never raises for bad input; it drops,
--   and counts only what it stored.
--
--   THE SURFACE is how the event was sent: via 'app' is the member app, any other via is the portal. An event is stored
--   only if its key (action or screen route pattern) is listed in app.activity_catalog FOR THAT SURFACE: a member-app caller
--   cannot post a portal key and the portal cannot post a member key.
--
--   WHO IS RECORDED (checked for every call, and again by the daily sweep, app.activity_purge)
--     member app   a person whose recorded birth date shows 18 or older (app.activity_member_ok). No birth date: not recorded.
--     portal       a person who holds a current staff role (or owns the community) and whose birth date is not under 18;
--                  none on file is allowed (app.activity_portal_ok)
--     never        a platform admin, a person who opted out, a sign-in that does not belong to p_center, a community whose
--                  switch is off (centers.rules.activity.enabled must be the boolean true; absent is off, so merging this
--                  changes nothing until a community's administrator agrees)
--   Also dropped: events past the first 100 of a call, events past a person's allowance of 2000 per hour per community.
--
--   WHAT IS KEPT of an accepted event (every field is held to its shape; what does not fit is stored as empty):
--     entity kind   the allowlist's, never the payload's
--     entity id     a uuid, and only for kinds that are not about a person or a child (app.activity_entity_id_ok)
--     error_code    letters and underscores, 2 to 40, only for outcome error
--     duration_ms   0 to 3,600,000          at   an ISO time, held within 7 days before and 5 minutes after now
--     session_id    a uuid                  app_version  1.2.3          platform  ios | android | web
--     role keys     the staff roles held now, for portal events only (member-app events carry none)
--
--   app.set_activity_opt_out(p_out boolean)   the signed-in person's own switch, for every community. Opting out deletes the
--                                             person's stored events in EVERY community that has a pseudonym for them (also
--                                             one they have since left) and hides the automation ideas of those communities
--                                             until the next mining run recomputes them.
--   app.activity_status(p_center uuid)        for a member or staff member of p_center (or a platform admin):
--                                             {enabled, opted_out, eligible, member, portal}; with settings.manage also
--                                             {consented, consent: {at, version} | null, share_with_weaver} (no names).
--                                             Anyone else gets enabled false and nothing else.

-- ── The community's switch: only the agreement functions change it ───────────
create or replace function app.centers_activity_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_old jsonb := case when jsonb_typeof(old.rules -> 'activity') = 'object' then old.rules -> 'activity' else '{}'::jsonb end;
  v_new jsonb := case when jsonb_typeof(new.rules -> 'activity') = 'object' then new.rules -> 'activity' else '{}'::jsonb end;
begin
  -- The database owner, the background service and migrations (no signed-in person), and the agreement functions below,
  -- which have checked who may do it.
  if auth.uid() is null or coalesce(current_setting('app.activity_apply', true), '') = 'on' then return new; end if;
  -- An ordinary write by a signed-in person may not touch the agreement or the sharing.
  if (v_new - 'enabled') is distinct from (v_old - 'enabled') then
    raise exception 'Agreeing to activity recording, and sharing it with Weaver, is done on the Privacy page with a 2FA check, not by editing the rules.'
      using errcode = '42501';
  end if;
  -- ... nor the switch, except that a platform admin may switch it off.
  if (v_new ->> 'enabled') is distinct from (v_old ->> 'enabled') then
    if not (app.is_platform_admin() and coalesce(v_new ->> 'enabled', 'false') <> 'true') then
      raise exception 'Activity recording is switched on or off on the Privacy page by the community''s administrator, not by editing the rules.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists centers_activity_guard on app.centers;
create trigger centers_activity_guard before update of rules on app.centers
  for each row when ((old.rules -> 'activity') is distinct from (new.rules -> 'activity'))
  execute function app.centers_activity_guard();

-- Writes rules.activity for the functions below (they set the flag the guard looks for, for this write only).
create or replace function app.activity_write_rules(p_center uuid, p_patch jsonb, p_remove text[] default '{}')
returns void language plpgsql security definer set search_path = app, public, extensions as $
declare v_n integer;
begin
  perform set_config('app.activity_apply', 'on', true);
  update app.centers c
     set rules = jsonb_set(coalesce(c.rules, '{}'::jsonb), '{activity}',
                           ((case when jsonb_typeof(c.rules -> 'activity') = 'object' then c.rules -> 'activity' else '{}'::jsonb end)
                            - p_remove) || p_patch, true)
   where c.id = p_center;
  get diagnostics v_n = row_count;
  perform set_config('app.activity_apply', '', true);
  if v_n = 0 then
    raise exception 'That community was not found.' using errcode = 'P0002';
  end if;
end $$;

-- May the signed-in person speak for this community's agreement? Its own administrator (settings.manage), never Weaver staff.
create or replace function app.activity_assert_admin(p_center uuid) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to do this.' using errcode = '28000';
  end if;
  if p_center is null or app.is_platform_admin() or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'You don''t have access to this area. Only the community''s own administrator can decide this.' using errcode = '42501';
  end if;
end $$;

create or replace function app.give_activity_consent(p_center uuid, p_share_with_weaver boolean, p_notice_version text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare v_version text := btrim(coalesce(p_notice_version, ''));
begin
  perform app.activity_assert_admin(p_center);
  if v_version !~ '^[A-Za-z0-9._-]{1,40}$' then
    raise exception 'Say which version of the notice was agreed to.' using errcode = '22023';
  end if;
  perform app.assert_step_up('activity.consent');
  perform app.activity_write_rules(p_center,
    jsonb_build_object('enabled', true, 'share_with_weaver', coalesce(p_share_with_weaver, false),
                       'consent', jsonb_build_object('by', auth.uid(), 'at', now(), 'version', v_version)),
    array['withdrawn']);
  perform app.log_audit(p_center, 'activity.consent_given', 'centers', p_center::text, null,
                        jsonb_build_object('enabled', true, 'share_with_weaver', coalesce(p_share_with_weaver, false), 'version', v_version),
                        'Agreed to activity recording; notice version ' || v_version);
end $$;
comment on function app.give_activity_consent(uuid, boolean, text) is 'The community''s own administrator (settings.manage, never Weaver staff), after a fresh 2FA check, agrees to activity recording: records {by, at, version}, switches recording on, and says whether the ideas and counts are shared with Weaver (0621).';

create or replace function app.withdraw_activity_consent(p_center uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.activity_assert_admin(p_center);
  if not app.activity_consented(p_center) and not coalesce((select (c.rules #>> '{activity,enabled}') = 'true' from app.centers c where c.id = p_center), false) then
    return;   -- nothing to withdraw
  end if;
  perform app.activity_write_rules(p_center,
    jsonb_build_object('enabled', false, 'withdrawn', jsonb_build_object('by', auth.uid(), 'at', now())),
    array['consent', 'share_with_weaver']);
  perform app.log_audit(p_center, 'activity.consent_withdrawn', 'centers', p_center::text, null,
                        jsonb_build_object('enabled', false), 'Withdrew the agreement to activity recording');
end $$;
comment on function app.withdraw_activity_consent(uuid) is 'The community''s own administrator (settings.manage) withdraws the agreement: recording off, the consent record and the sharing flag removed, withdrawn {by, at} kept; what was recorded stays until the 400-day purge (0621).';

create or replace function app.set_activity_sharing(p_center uuid, p_share boolean) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.activity_assert_admin(p_center);
  if not app.activity_consented(p_center) then
    raise exception 'Agree to activity recording first.' using errcode = '22023';
  end if;
  perform app.assert_step_up('activity.sharing');
  perform app.activity_write_rules(p_center, jsonb_build_object('share_with_weaver', coalesce(p_share, false)));
  perform app.log_audit(p_center, 'activity.sharing_changed', 'centers', p_center::text, null,
                        jsonb_build_object('share_with_weaver', coalesce(p_share, false)),
                        case when coalesce(p_share, false) then 'Agreed to share activity ideas and counts with Weaver'
                             else 'Stopped sharing activity ideas and counts with Weaver' end);
end $$;
comment on function app.set_activity_sharing(uuid, boolean) is 'The community''s own administrator (settings.manage + a fresh 2FA check) decides whether Weaver may see its activity ideas, usage totals, cross-community counts and raw events; default no (0621).';

-- Weaver's switch: OFF at any time, ON only while the community's administrator has agreed.
create or replace function app.set_activity_recording(p_center uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Weaver team can switch activity recording on or off.' using errcode = '42501';
  end if;
  if not exists (select 1 from app.centers c where c.id = p_center) then
    raise exception 'That community was not found.' using errcode = 'P0002';
  end if;
  if coalesce(p_enabled, false) and not app.activity_consented(p_center) then
    raise exception 'The community''s administrator has not agreed yet.' using errcode = '22023';
  end if;
  perform app.activity_write_rules(p_center, jsonb_build_object('enabled', coalesce(p_enabled, false)));
  perform app.log_audit(p_center, case when coalesce(p_enabled, false) then 'activity.recording_on' else 'activity.recording_off' end,
                        'centers', p_center::text, null, jsonb_build_object('enabled', coalesce(p_enabled, false)),
                        case when coalesce(p_enabled, false) then 'Weaver switched activity recording on' else 'Weaver switched activity recording off' end);
end $$;

-- ── Recording ────────────────────────────────────────────────────────────────
create or replace function app.record_activity(p_center uuid, p_events jsonb) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_uid    uuid := auth.uid();
  v_hash   text;
  v_roles  text[];
  v_used   integer;
  v_allow  integer;
  v_member boolean;
  v_portal boolean;
  v_n      integer := 0;
begin
  -- The cheap refusals first. All of them are silent: a beacon must never break what the person is doing.
  if v_uid is null or p_center is null or p_events is null then return 0; end if;
  if jsonb_typeof(p_events) <> 'array' then return 0; end if;
  if jsonb_array_length(p_events) = 0 then return 0; end if;
  if not app.activity_enabled(p_center) then return 0; end if;
  if app.is_platform_admin() then return 0; end if;

  -- One person's calls (and their opt-out) run one at a time: the allowance below is counted and then spent, and an
  -- opt-out that commits first must be seen by the insert. Held to the end of the transaction.
  perform pg_advisory_xact_lock(hashtextextended('activity:' || v_uid::text, 0));

  if exists (select 1 from app.activity_optouts o where o.user_id = v_uid) then return 0; end if;
  v_member := app.activity_member_ok(p_center, v_uid);
  v_portal := app.activity_portal_ok(p_center, v_uid);
  if not v_member and not v_portal then return 0; end if;

  v_hash := app.activity_actor_hash(p_center, v_uid, true);

  -- Rate limit: 2000 events per person per community per hour, 100 per call.
  select count(*) into v_used from app.activity_events e
   where e.center_id = p_center and e.actor_hash = v_hash and e.received_at > now() - interval '1 hour';
  v_allow := least(100, 2000 - v_used);
  if v_allow <= 0 then return 0; end if;

  -- The staff roles held now (operational and center tier), and "owner" for the community's owner.
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
    -- The surface is how it was sent; a screen key is looked up in its stored form (placeholders lower-cased).
    select f.*,
           case when f.vi = 'app' then 'member' else 'portal' end as ev_surface,
           case when f.kd = 'screen' then app.activity_screen_key_norm(f.k) else f.k end as ckey
      from f
     where f.kd in ('action', 'screen')
       and f.vi in ('screen', 'palette', 'assistant', 'app')
       and f.oc in ('ok', 'error', 'cancelled')
  ), w as (
    select v.*, c.entity_kind as c_ek
      from v join app.activity_catalog c on c.key = v.ckey and c.kind = v.kd and c.surface = v.ev_surface
     where (v.ev_surface = 'member' and v_member) or (v.ev_surface = 'portal' and v_portal)
  )
  insert into app.activity_events (center_id, occurred_at, session_id, seq, surface, actor_hash, role_keys, key, kind,
                                   entity_kind, entity_id, outcome, error_code, duration_ms, via, app_version, platform)
  select p_center,
         least(greatest(coalesce(app.activity_ts(w.at_txt), now()), now() - interval '7 days'), now() + interval '5 minutes'),
         app.activity_uuid(w.sid),
         app.activity_int(w.sq, 0, 1000000),
         w.ev_surface,
         v_hash,
         case when w.ev_surface = 'portal' then v_roles else '{}'::text[] end,
         w.ckey,
         w.kd,
         w.c_ek,
         case when app.activity_entity_id_ok(w.c_ek) then app.activity_uuid(w.eid) end,
         w.oc,
         case when w.oc = 'error' and lower(w.ec) ~ '^[a-z_]{2,40}$' then lower(w.ec) end,
         app.activity_int(w.dur, 0, 3600000),
         w.vi,
         case when char_length(w.av) <= 32 and w.av ~ '^[0-9]+(\.[0-9]+){0,2}$' then w.av end,
         case when lower(w.pf) in ('ios', 'android', 'web') then lower(w.pf) end
    from w
   -- The opt-out is checked again here, in the statement that writes: it cannot be missed by a choice made a moment ago.
   where not exists (select 1 from app.activity_optouts o where o.user_id = v_uid)
   order by w.ord
   limit v_allow;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function app.record_activity(uuid, jsonb) is
  'Store a batch of activity events for the signed-in person in p_center (0621). Person and community come from the sign-in; the surface is the via (app = member app). Keys not in the allowlist for that surface, people who may not be recorded on that surface, platform admins, opted-out people and communities with recording off are dropped silently. At most 100 events per call, 2000 per person per hour. Returns how many were stored.';

-- ── The person's own switch ──────────────────────────────────────────────────
-- Opting out stops recording in every community and deletes the person's events in every community that has a pseudonym
-- for them (the salts are searched, not the person's current memberships, so a community they left is covered too). The
-- automation ideas of those communities are marked stale: hidden from administrators until the next mining run recomputes
-- them from what is left. Opting back in starts again from then on.
create or replace function app.set_activity_opt_out(p_out boolean) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_uid uuid := auth.uid(); r record; v_hash text; v_n integer;
begin
  if v_uid is null then
    raise exception 'Sign in to change this setting.' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('activity:' || v_uid::text, 0));
  if coalesce(p_out, false) then
    insert into app.activity_optouts (user_id) values (v_uid) on conflict (user_id) do nothing;
    for r in select s.center_id, s.salt from app.activity_salts s loop
      v_hash := app.activity_hash(v_uid, r.salt);
      delete from app.activity_events e where e.center_id = r.center_id and e.actor_hash = v_hash;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        update app.automation_candidates c set stale = true where c.center_id = r.center_id and not c.stale;
      end if;
    end loop;
  else
    delete from app.activity_optouts o where o.user_id = v_uid;
  end if;
end $$;
comment on function app.set_activity_opt_out(boolean) is 'The signed-in person''s own switch: true stops activity recording for them in every community and deletes what was already stored about them in every community that has a pseudonym for them; false starts it again (0621).';

create or replace function app.activity_status(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_uid uuid := auth.uid(); v_admin boolean; v_member boolean := false; v_portal boolean := false; v_out jsonb;
begin
  v_admin := coalesce(app.is_platform_admin(), false);
  if v_uid is null or not (v_admin
                           or exists (select 1 from app.center_users cu where cu.center_id = p_center and cu.user_id = v_uid)
                           or app.is_staff_of(p_center, v_uid)) then
    -- Not a member or staff member of that community: nothing is said about it.
    return jsonb_build_object('enabled', false,
                              'opted_out', v_uid is not null and exists (select 1 from app.activity_optouts o where o.user_id = v_uid),
                              'eligible', false, 'member', false, 'portal', false);
  end if;
  if not v_admin then
    v_member := app.activity_member_ok(p_center, v_uid);
    v_portal := app.activity_portal_ok(p_center, v_uid);
  end if;
  v_out := jsonb_build_object('enabled', app.activity_enabled(p_center),
                             'opted_out', exists (select 1 from app.activity_optouts o where o.user_id = v_uid),
                             'eligible', v_member or v_portal, 'member', v_member, 'portal', v_portal);
  -- Whoever manages the community's settings (and Weaver) also learns whether it has agreed and whether it shares. No names.
  if app.has_permission(p_center, 'settings.manage') then
    v_out := v_out || jsonb_build_object(
      'consented', app.activity_consented(p_center),
      'consent', (select case when nullif(c.rules #>> '{activity,consent,at}', '') is null then null
                                else jsonb_build_object('at', c.rules #>> '{activity,consent,at}', 'version', c.rules #>> '{activity,consent,version}') end
                       from app.centers c where c.id = p_center),
      'share_with_weaver', coalesce((select (c.rules #>> '{activity,share_with_weaver}') = 'true' from app.centers c where c.id = p_center), false));
  end if;
  return v_out;
end $;
comment on function app.activity_status(uuid) is 'For a member or staff member of p_center (or a platform admin): {enabled: recording is on for the community, opted_out: they chose not to be recorded, eligible: they can be recorded at all, member / portal: on which surface}; with settings.manage also {consented, consent: {at, version} or null, share_with_weaver}. Anyone else gets enabled false and nothing else (0621).';

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app.record_activity(uuid, jsonb), app.set_activity_opt_out(boolean), app.activity_status(uuid),
  app.set_activity_recording(uuid, boolean), app.give_activity_consent(uuid, boolean, text), app.withdraw_activity_consent(uuid),
  app.set_activity_sharing(uuid, boolean), app.activity_write_rules(uuid, jsonb, text[]), app.activity_assert_admin(uuid),
  app.centers_activity_guard()
  from public, anon, authenticated, service_role;
grant execute on function app.record_activity(uuid, jsonb), app.set_activity_opt_out(boolean), app.activity_status(uuid),
  app.set_activity_recording(uuid, boolean), app.give_activity_consent(uuid, boolean, text), app.withdraw_activity_consent(uuid),
  app.set_activity_sharing(uuid, boolean) to authenticated;
