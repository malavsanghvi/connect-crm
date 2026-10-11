-- Demo communities (B88) · 3 of 3: create, reset and the nightly check.
--
--   app.create_demo_community(kind)    platform team only ("faith" or "neutral"): makes a SANDBOX flagged rules.demo = true,
--                                      loads its pack and builds its demo people. Already there: says so and changes nothing.
--   app.reset_demo_community(center)   platform team only, and only for a community flagged as a demo: deletes what is in
--                                      it (app.demo_clear_center, with its sandbox-only guard) and loads the pack again,
--                                      all in ONE transaction, so a failure keeps what was there. Idempotent: the same ids,
--                                      the same rows, every time.
--   app.worker_demo_reset_due(...)     the background service's hourly check (job demo.reset): resets a demo community that
--                                      someone changed (around 3 a.m. in its own time zone, or at once if a night was
--                                      missed), one nobody touched but whose dates are 3 days old, and one that failed to
--                                      load. An untouched community is left alone: every reset writes the audit log.
--
-- No policy or grant of an existing object is changed. Nothing here signs anyone in: the demo people are login-less
-- (app.demo_personas holds their role assignment as data) until the session endpoint and role switcher are built.
set client_min_messages = warning;

-- Who the community's own records name as their author (the platform person who created it, else any platform admin).
create or replace function app.demo_actor(p_center uuid) returns uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(auth.uid(),
                  (select s.requested_by from app.center_demo_state s where s.center_id = p_center),
                  (select a.user_id from app.accounts a where a.is_platform_admin order by a.user_id limit 1))
$$;

-- Load a pack's steps into a community (the sandbox guard is checked first). Ids are derived from the community's own
-- id, so every reload gives every record the same id again.
create or replace function app.demo_load_pack(p_center uuid, p_pack text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.demo_packs; v_step text; v_before jsonb; v_after jsonb; v_loaded jsonb := '{}'::jsonb; k text; n int := 0;
begin
  select * into p from app.demo_packs where key = p_pack;
  if p.key is null or p.content is null then
    raise exception 'There is no demo community pack called "%".', coalesce(p_pack, '');
  end if;
  perform app.demo_assert_sandbox(p_center);
  perform set_config('app.client_app', 'job', true);
  v_before := app.demo_counts_raw(p_center);
  for v_step in select e.value from jsonb_array_elements_text(p.content->'order') e loop
    if not (p.content->'steps' ? v_step) then
      raise exception 'Demo pack % has no step called "%".', p.key, v_step;
    end if;
    perform app.set_audit_context('Demo community · ' || p.title || ' · ' || v_step, p_center);
    perform app.demo_apply_ops(p_center, p_center, p_actor, p.content->'steps'->v_step);
    n := n + 1;
  end loop;
  v_after := app.demo_counts_raw(p_center);
  for k in select jsonb_object_keys(v_after) loop
    if (v_after->>k)::bigint - coalesce((v_before->>k)::bigint, 0) <> 0 then
      v_loaded := v_loaded || jsonb_build_object(k, (v_after->>k)::bigint - coalesce((v_before->>k)::bigint, 0));
    end if;
  end loop;
  return jsonb_build_object('steps', n, 'loaded', v_loaded);
end $$;

-- The demo people of a pack: one per entry of its "personas" (a person of the pack, a role, a one-sentence story).
create or replace function app.demo_make_personas(p_center uuid, p_pack text) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.demo_packs; n int;
begin
  select * into p from app.demo_packs where key = p_pack;
  insert into app.demo_personas (id, center_id, role_key, display_name, headline, story, email, person_id, household_id, scope_kind, scope_id, sort_order)
  select app.demo_id(p_center, 'persona:' || (x.value->>'role')), p_center, x.value->>'role', pe.first_name || ' ' || pe.last_name, r.name,
         x.value->>'story', lower(pe.email::text), pe.id,
         (select hm.household_id from app.household_members hm where hm.person_id = pe.id and hm.left_at is null order by hm.is_primary desc limit 1),
         r.default_scope, case when x.value ? 'scope' then app.demo_id(p_center, x.value->>'scope') end, x.ord::int
    from jsonb_array_elements(p.content->'personas') with ordinality x(value, ord)
    join app.roles r on r.key = x.value->>'role'
    join app.people pe on pe.id = app.demo_p(p_center, x.value->>'person') and pe.center_id = p_center;
  get diagnostics n = row_count;
  return n;
end $$;

-- The roles of the community's role catalog (every role of its kind except the platform's own) with no demo person.
create or replace function app.demo_missing_roles(p_center uuid) returns text[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(r.key order by r.key), '{}'::text[])
    from app.roles r
   where r.tier <> 'platform' and app.catalog_shows(r.category_keys, app.center_category(p_center))
     and not exists (select 1 from app.demo_personas d where d.center_id = p_center and d.role_key = r.key)
$$;

-- (Clear and) load a demo community, build its demo people, record what is there. p_operation: 'create' | 'reset'.
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
    v_cleared := app.demo_clear_center(p_center);
    -- Member and household numbers start again from the beginning, so every night gives the same numbers (a clear keeps
    -- the numbering of a real organization; a demo community has nothing to protect).
    delete from app.number_sequences where center_id = p_center;
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

-- ── Create ───────────────────────────────────────────────────────────────────
create or replace function app.create_demo_community(p_kind text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_kind text := lower(btrim(coalesce(p_kind, ''))); p app.demo_packs; v_spec jsonb; v_center uuid; v_existing uuid;
        v_actor uuid := auth.uid(); v_res jsonb;
begin
  if v_actor is null or not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can create a demo community.' using errcode = 'insufficient_privilege';
  end if;
  select * into p from app.demo_packs where content is not null and content->'center'->>'kind' = v_kind order by key limit 1;
  if p.key is null then
    raise exception 'Choose which demo community to create: "faith" or "neutral".';
  end if;
  perform app.assert_step_up('platform.create_demo_community');
  select c.id into v_existing from app.centers c where c.rules->'demo' = 'true'::jsonb and c.rules->>'demo_kind' = v_kind limit 1;
  if v_existing is not null then
    return jsonb_build_object('center_id', v_existing, 'created', false, 'note', 'This demo community already exists. Use reset to start it over.');
  end if;
  v_spec := p.content->'center';
  perform app.set_audit_context('Demo community · create · ' || p.title);
  v_center := app._create_sandbox_center(v_spec->>'slug', v_spec->>'name', v_spec->>'state', v_spec->>'city', null,
                jsonb_build_object('source', 'demo_community', 'created_by', v_actor, 'category_key', v_spec->>'category_key'));
  update app.centers
     set short_name = v_spec->>'short_name',
         rules = rules || jsonb_build_object('demo', true, 'demo_kind', v_kind, 'demo_pack', p.key)
   where id = v_center;
  v_res := app.demo_populate(v_center, 'create', v_actor);
  return jsonb_build_object('created', true) || v_res;
end $$;

-- ── Reset ────────────────────────────────────────────────────────────────────
create or replace function app.reset_demo_community(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can reset a demo community.' using errcode = 'insufficient_privilege';
  end if;
  if not app.is_demo_center(p_center) then
    raise exception 'This is not a demo community, so it cannot be reset. Nothing was changed.';
  end if;
  perform app.assert_step_up('platform.reset_demo_community');
  return app.demo_populate(p_center, 'reset', auth.uid());
end $$;

-- ── The hourly check (job demo.reset) ────────────────────────────────────────
-- Due when: asked for (p_force); never loaded or failed; or (someone changed it, or its dates are p_stale old) and it is
-- 3 a.m. in its time zone, or its last load is over 30 hours old (the night was missed). A failure is written on the
-- community's demo state and reported; the data it had stay as they were (the reset is one transaction).
create or replace function app.worker_demo_reset_due(p_force boolean default false, p_stale interval default interval '3 days') returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare c record; v_out jsonb := '[]'::jsonb; v_checked int := 0; v_reset int := 0; v_skipped int := 0; v_failed int := 0;
        v_dirty boolean; v_hour int; v_why text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
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
revoke execute on function app.demo_actor(uuid), app.demo_load_pack(uuid, text, uuid), app.demo_make_personas(uuid, text),
  app.demo_missing_roles(uuid), app.demo_populate(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function app.create_demo_community(text), app.reset_demo_community(uuid) from public, anon;
grant execute on function app.create_demo_community(text), app.reset_demo_community(uuid) to authenticated;
revoke execute on function app.worker_demo_reset_due(boolean, interval) from public, anon, authenticated;
grant execute on function app.worker_demo_reset_due(boolean, interval) to connect_worker;
grant execute on all functions in schema app to service_role;
