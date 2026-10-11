-- Demo sign-in (B88) · 2 of 3 · part 2: starting, checking and ending a demo session, and the public list of demo people.
--
--   app.worker_demo_begin(persona, ip hash)   connect_worker only (the portal server). Checks the switch, the person, the rate limits,
--                                             records the session and the audit entry, and returns the sign-in the portal uses
--   app.worker_demo_attach(session, auth)     connect_worker only. Ties the new Auth session to the demo session
--   app.demo_session_state()                  the demo user's own call, on every request while in a demo: 'ok' or why not
--                                             (ended, expired, switched off); also what the banner shows. Ends what has run out
--   app.demo_leave()                          the demo user ends their own session
--   app.demo_choices()                        public: the demo people to choose from (role, name, story; never an address)
--   app.demo_populate / worker_demo_reset_due replaced (same behaviour) to take the demo sign-ins apart before a reset clears the
--                                             community and put them back after, and to sweep expired sessions every hour
--
-- Why the portal can sign a demo person in without any service-role key: it reads their password through worker_demo_begin, which
-- only the portal's connect_worker connection can call, and which refuses unless the switch is on, the person is a demo person of a
-- flagged demo sandbox, and the limits allow it. The password is never sent to a browser.
set client_min_messages = warning;

-- ── Start ────────────────────────────────────────────────────────────────────
create or replace function app.worker_demo_begin(p_persona uuid, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare per app.demo_personas; au app.demo_auth_users; c app.centers; v_ip text; v_pw text; v_lim jsonb := app.demo_signin_limits();
        v_n_ip int; v_n_hour int; v_n_5 int; v_id uuid; v_exp timestamptz;
begin
  perform app.assert_worker();
  v_ip := coalesce(nullif(left(btrim(coalesce(p_ip_hash, '')), 64), ''), 'unknown');
  if not app.demo_signin_enabled() then
    return jsonb_build_object('ok', false, 'code', 'off');
  end if;
  select d.* into per from app.demo_personas d where d.id = p_persona;
  if per.id is null or per.email is distinct from lower(per.email) or per.email not like ('%@' || app.demo_persona_domain()) then
    return jsonb_build_object('ok', false, 'code', 'unknown_persona');
  end if;
  select ce.* into c from app.centers ce where ce.id = per.center_id;
  if c.id is null or c.environment is distinct from 'sandbox' or not app.is_demo_center(c.id) then
    return jsonb_build_object('ok', false, 'code', 'unknown_persona');
  end if;
  select a.* into au from app.demo_auth_users a where a.email = per.email;
  if au.email is null then
    return jsonb_build_object('ok', false, 'code', 'not_ready');
  end if;
  -- One start at a time, so simultaneous requests cannot overrun a limit.
  perform pg_advisory_xact_lock(hashtext('connect.demo_signin'));
  perform app.demo_signin_sweep();
  select count(*) filter (where d.ip_hash = v_ip),
         count(*),
         count(*) filter (where d.started_at > now() - interval '5 minutes')
    into v_n_ip, v_n_hour, v_n_5
    from app.demo_sessions d where d.started_at > now() - interval '1 hour';
  if v_n_ip >= (v_lim ->> 'per_ip_hour')::int then
    return jsonb_build_object('ok', false, 'code', 'ip_limit');
  end if;
  if v_n_hour >= (v_lim ->> 'global_hour')::int or v_n_5 >= (v_lim ->> 'global_5min')::int then
    return jsonb_build_object('ok', false, 'code', 'busy');
  end if;
  select dsec.decrypted_secret into v_pw from vault.decrypted_secrets dsec where dsec.id = au.vault_secret_id;
  if v_pw is null then
    return jsonb_build_object('ok', false, 'code', 'not_ready');
  end if;
  insert into app.secret_access_log (center_id, connection_id, name, reader, purpose, outcome)
  values (null, null, left('demo:' || au.email, 200),
          left(coalesce(nullif(btrim(current_setting('app.worker_id', true)), ''), session_user::text), 200), 'demo sign-in', 'read');
  perform app.demo_assert_auth_user(au.user_id, au.email, v_pw);
  v_exp := now() + make_interval(hours => app.demo_signin_hours());
  insert into app.demo_sessions (persona_email, user_id, role_key, ip_hash, expires_at)
  values (per.email, au.user_id, per.role_key, v_ip, v_exp) returning id into v_id;
  perform app.demo_audit(c.id, 'demo.sign_in', au.user_id, v_id::text,
    jsonb_build_object('persona', per.email, 'role', per.role_key, 'ip_hash', v_ip, 'expires_at', v_exp), 'Demo sign-in');
  return jsonb_build_object('ok', true, 'demo_session_id', v_id, 'email', per.email, 'password', v_pw, 'center_slug', c.slug::text,
                            'role', per.headline, 'name', per.display_name, 'expires_at', v_exp);
end $$;

-- The portal has signed in; tie the new Auth session to the demo session. Only the demo person's own, fresh, unattached session counts.
create or replace function app.worker_demo_attach(p_demo uuid, p_auth_session uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.demo_sessions;
begin
  perform app.assert_worker();
  select d.* into s from app.demo_sessions d where d.id = p_demo for update;
  if s.id is null or s.ended_at is not null or s.auth_session_id is not null or s.started_at < now() - interval '5 minutes' then
    return jsonb_build_object('ok', false, 'code', 'unknown');
  end if;
  if p_auth_session is null or not exists (select 1 from auth.sessions x where x.id = p_auth_session and x.user_id = s.user_id) then
    return jsonb_build_object('ok', false, 'code', 'mismatch');
  end if;
  update app.demo_sessions set auth_session_id = p_auth_session where id = p_demo;
  return jsonb_build_object('ok', true, 'expires_at', s.expires_at);
end $$;

-- ── Check, on every request of a demo session ────────────────────────────────
-- The caller's own session only (the session id is read from their sign-in token). 'not_demo' for anyone who is not a demo person.
-- A demo person whose session is not on record, has ended, ran out or whose switch is off is answered as such AND its Auth session is
-- deleted, so it cannot be refreshed any more.
create or replace function app.demo_session_state() returns jsonb
language plpgsql volatile security definer set search_path = app, public, extensions as $$
declare v_user uuid := auth.uid(); v_sid uuid; s app.demo_sessions; d app.demo_personas; c app.centers;
begin
  if v_user is null or not exists (select 1 from app.demo_auth_users a where a.user_id = v_user) then
    return jsonb_build_object('state', 'not_demo');
  end if;
  begin
    v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    v_sid := null;
  end;
  if v_sid is null then
    return jsonb_build_object('state', 'unknown');
  end if;
  select x.* into s from app.demo_sessions x where x.auth_session_id = v_sid and x.user_id = v_user;
  if s.id is null or s.ended_at is not null then
    delete from auth.sessions where id = v_sid and user_id = v_user;
    return jsonb_build_object('state', 'unknown');
  end if;
  if not app.demo_signin_enabled() then
    perform app.demo_end(s.id, 'switched_off');
    return jsonb_build_object('state', 'off');
  end if;
  if s.expires_at <= now() then
    perform app.demo_end(s.id, 'expired');
    return jsonb_build_object('state', 'expired');
  end if;
  select p.* into d from app.demo_personas p where p.email = s.persona_email;
  select ce.* into c from app.centers ce where ce.id = d.center_id;
  return jsonb_build_object('state', 'ok', 'expires_at', s.expires_at,
                            'seconds_left', greatest(0, extract(epoch from (s.expires_at - now()))::int),
                            'role', d.headline, 'name', d.display_name, 'center_name', c.name, 'center_slug', c.slug::text);
end $$;

-- The demo person ends their own session (Leave the demo, or Switch role).
create or replace function app.demo_leave() returns jsonb
language plpgsql volatile security definer set search_path = app, public, extensions as $$
declare v_sid uuid; s app.demo_sessions;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false); end if;
  begin
    v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    v_sid := null;
  end;
  select x.* into s from app.demo_sessions x where x.auth_session_id = v_sid and x.user_id = auth.uid() and x.ended_at is null;
  if s.id is not null then perform app.demo_end(s.id, 'left'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── The public list: who can I be? ───────────────────────────────────────────
-- Only demo people that already have a sign-in. Role, name and a sentence about them; never an address, never an id of a real thing.
create or replace function app.demo_choices() returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'enabled', app.demo_signin_enabled(),
    'communities', coalesce((
      select jsonb_agg(q.x order by q.x ->> 'kind')
        from (select jsonb_build_object(
                'kind', c.rules ->> 'demo_kind', 'name', c.name,
                'people', (select jsonb_agg(jsonb_build_object('id', d.id, 'role', d.headline, 'name', d.display_name, 'story', d.story)
                                            order by d.sort_order, d.display_name)
                             from app.demo_personas d join app.demo_auth_users a on a.email = d.email where d.center_id = c.id)) as x
                from app.centers c where app.is_demo_center(c.id) and c.environment = 'sandbox') q
       where jsonb_typeof(q.x -> 'people') = 'array'), '[]'::jsonb))
$$;

-- ── A reset takes the sign-ins apart first and puts them back after ──────────
-- app.demo_populate and app.worker_demo_reset_due are the 0629 functions, unchanged except for the lines marked "0679".
create or replace function app.demo_populate(p_center uuid, p_operation text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.demo_packs; v_pack text; v_cleared jsonb := '{}'::jsonb; v_loaded jsonb; v_personas int; v_missing text[]; v_actor uuid;
        v_steps int;
begin
  perform 1 from app.centers where id = p_center for update;
  if not app.is_demo_center(p_center) then
    raise exception 'This is not a demo community, so nothing was changed.';
  end if;
  -- Sandbox only, never live, never promoted: the same guard that protects every sandbox from a clear.
  perform app.demo_assert_sandbox(p_center);
  v_pack := (select c.rules->>'demo_pack' from app.centers c where c.id = p_center);
  select * into p from app.demo_packs where key = v_pack and content is not null;
  if p.key is null then raise exception 'This demo community has no pack to load.'; end if;
  v_actor := coalesce(p_actor, app.demo_actor(p_center));
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Demo community · ' || case p_operation when 'reset' then 'reset' else 'create' end || ' · ' || p.title, p_center);
  insert into app.center_demo_state (center_id) values (p_center) on conflict (center_id) do nothing;
  if p_operation = 'reset' then
    perform app.demo_unlink_personas(p_center);   -- 0679: the demo sign-ins are taken apart, so nothing a visitor changed is kept
    v_cleared := app.demo_clear_center(p_center);
    -- Member and household numbers start again from the beginning, so every night gives the same numbers (a clear keeps
    -- the numbering of a real organization; a demo community has nothing to protect).
    delete from app.number_sequences where center_id = p_center;
    -- A new community gets its standard family-relationship choices from a trigger (0491); a clear removes them with the
    -- rest, so put the same ones back.
    insert into app.relationship_options (center_id, name, sort) values
      (p_center, 'Spouse', 1), (p_center, 'Child', 2), (p_center, 'Parent', 3), (p_center, 'Sibling', 4),
      (p_center, 'Grandparent', 5), (p_center, 'Grandchild', 6), (p_center, 'Guardian', 7),
      (p_center, 'Other relative', 8), (p_center, 'Other', 9)
    on conflict (center_id, name) do nothing;
  end if;
  v_loaded := app.demo_load_pack(p_center, p.key, v_actor);
  v_personas := app.demo_make_personas(p_center, p.key);
  if v_personas <> jsonb_array_length(p.content->'personas') then
    raise exception 'The demo pack % names % demo people but only % could be made (a person or role is missing).',
      p.key, jsonb_array_length(p.content->'personas'), v_personas;
  end if;
  v_missing := app.demo_missing_roles(p_center);
  if cardinality(v_missing) > 0 then
    raise exception 'The demo pack % has no demo person for these roles: %.', p.key, array_to_string(v_missing, ', ');
  end if;
  perform app.demo_link_personas(p_center);   -- 0679: and put back on the freshly loaded people
  v_steps := jsonb_array_length(p.content->'order');
  update app.center_demo_state
     set pack_key = p.key, version = p.version, status = 'loaded',
         operation = case when p_operation = 'reset' then 'reset' else 'activate' end, reason = 'Demo community',
         requested_by = coalesce(auth.uid(), requested_by), requested_at = now(), steps_done = v_steps, steps_total = v_steps, step_label = null,
         load_seed = p_center, loaded_at = now(), loaded_by = v_actor,
         cleared_at = case when p_operation = 'reset' then now() else cleared_at end,
         cleared_by = case when p_operation = 'reset' then v_actor else cleared_by end,
         last_error = null,
         detail = jsonb_build_object('loaded', v_loaded->'loaded', 'cleared', v_cleared->'removed', 'personas', v_personas),
         updated_at = now()
   where center_id = p_center;
  return jsonb_build_object('center_id', p_center, 'loaded', v_loaded->'loaded', 'personas', v_personas);
end $$;

create or replace function app.worker_demo_reset_due(p_force boolean default false, p_stale interval default interval '3 days') returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare c record; v_out jsonb := '[]'::jsonb; v_checked int := 0; v_reset int := 0; v_skipped int := 0; v_failed int := 0;
        v_dirty boolean; v_hour int; v_why text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  -- 0679: end the demo sign-ins that have run out (all of them when the switch is off)
  begin
    perform app.demo_signin_sweep();
  exception when others then
    raise warning 'demo sign-in sweep failed: %', sqlerrm;
  end;
  for c in
    select ce.id, ce.name, ce.time_zone, s.status, s.loaded_at
      from app.centers ce left join app.center_demo_state s on s.center_id = ce.id
     where app.is_demo_center(ce.id) and ce.environment = 'sandbox'
     order by ce.created_at, ce.id
  loop
    v_checked := v_checked + 1;
    v_hour := extract(hour from (now() at time zone c.time_zone))::int;
    v_dirty := c.loaded_at is not null
               and exists (select 1 from app.audit_log a where a.center_id = c.id and a.occurred_at > c.loaded_at and a.client_app is distinct from 'job');
    v_why := case
      when p_force then 'asked for'
      when c.status is distinct from 'loaded' or c.loaded_at is null then 'not loaded'
      when (v_dirty or c.loaded_at < now() - p_stale) and (v_hour = 3 or c.loaded_at < now() - interval '30 hours')
        then case when v_dirty then 'changed' else 'dates going stale' end
    end;
    if v_why is null then
      v_skipped := v_skipped + 1;
      v_out := v_out || jsonb_build_object('center_id', c.id, 'name', c.name, 'status', 'skipped');
      continue;
    end if;
    begin
      perform app.demo_populate(c.id, 'reset', null);
      v_reset := v_reset + 1;
      v_out := v_out || jsonb_build_object('center_id', c.id, 'name', c.name, 'status', 'reset', 'why', v_why);
    exception when others then
      v_failed := v_failed + 1;
      update app.center_demo_state set last_error = left(sqlerrm, 2000), updated_at = now() where center_id = c.id;
      v_out := v_out || jsonb_build_object('center_id', c.id, 'name', c.name, 'status', 'failed', 'error', left(sqlerrm, 500));
    end;
  end loop;
  return jsonb_build_object('checked', v_checked, 'reset', v_reset, 'skipped', v_skipped, 'failed', v_failed, 'centers', v_out);
end $$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app.worker_demo_begin(uuid, text), app.worker_demo_attach(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function app.worker_demo_begin(uuid, text), app.worker_demo_attach(uuid, uuid) to connect_worker;
revoke execute on function app.demo_session_state(), app.demo_leave() from public, anon;
grant execute on function app.demo_session_state(), app.demo_leave() to authenticated;
revoke execute on function app.demo_choices() from public;
grant execute on function app.demo_choices() to anon, authenticated;
revoke execute on function app.demo_populate(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function app.worker_demo_reset_due(boolean, interval) from public, anon, authenticated;
grant execute on function app.worker_demo_reset_due(boolean, interval) to connect_worker;
