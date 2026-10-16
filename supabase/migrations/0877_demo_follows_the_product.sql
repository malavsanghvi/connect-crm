-- 0877 · The demo follows the product, by itself (owner request 2026-10-16: "make sure all changes that were made so far are reflected in the demo automatically").
--
-- What was wrong. A demo community is cleared and loaded again every night, and a clear removes every table that carries a center_id
-- except the keep list (app.demo_keep_tables). The ways to pay another way (center_payment_methods) are not on that list: 0875 added check,
-- cash and bank transfer once, the first reset deleted them, and the member app then said "your community does not take that way of
-- paying here". Payment confirmations (giving_proofs) was switched on for the sandboxes that existed on 2026-10-16 (0869) and for nobody
-- after them, so a demo community made or re-made later would not have it. (Module grants themselves survive a reset: the club demo's
-- shop, granted by hand, is still there afterwards.) And nothing told a demo to load again when the product changed: the hourly check
-- reset it only when a visitor had changed it, or its dates were three days old, so a new pack or a new module reached it up to three
-- days late.
--
-- What this does (no policy, grant, permission or money rule of any other object changes):
--   1. app.demo_module_exclusions(): the modules a demo does not switch on by itself: iWeaver and WhatsApp send things to outside services,
--      the website builder is the platform team's, and WeCare, CatchTheMatch and the Community Market each bring a role (care_lead and
--      relationship_owner, matching_lead, market_lead) that needs a demo person the packs do not have yet (a demo community will not load
--      with a role that has none). Put the people in the packs, then take the module off the list. Every add-on of a module the demo already has (the Giving add-ons: Payment confirmations,
--      Bank reconciliation, Statements ...) that its kind offers (app.module_availability) is switched on by app.demo_align_center at every
--      load, so an add-on added to the platform tomorrow is in the demo at its next load, with no edit here. A base module the pack leaves
--      out (the club has no shop) stays out.
--   2. app.demo_seed_product_extras(center, actor): what a demo needs beyond its pack to show the newest features: the offline ways to pay
--      (plus Zelle) and one payment confirmation waiting for the treasury team, sent by the community member's family, with its soft
--      credit. This is the one place to add "the demo should show X" for a new feature.
--   3. app.demo_recipe_hash(center): a fingerprint of everything that decides what a demo looks like: the pack, the code above and the
--      modules on offer. The load stores it (center_demo_state.detail.recipe).
--   4. app.worker_demo_reset_due: a demo whose stored fingerprint is not today's is loaded again in the next hourly check, unless someone is
--      in it (then at 3 a.m. in its time zone, like any other reset). A deploy that changes the pack, the demo code or the modules
--      therefore reaches the demo within the hour, with nobody to remember it.
-- The community that exists has no stored fingerprint, so the first check after this migration loads it again.
set client_min_messages = warning;

-- ── 1. The modules a demo never switches on by itself ───────────────────────────────────────────────────────────────�
create or replace function app.demo_module_exclusions() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['ai', 'channels', 'website', 'care', 'matching', 'market']::text[]
$$;
revoke execute on function app.demo_module_exclusions() from public, anon, authenticated;

-- ── 2. The community is aligned with its pack AND with the product ────────────────────────────────────────────────────�
-- 0820's body; only the module loop changed (marked 0877): the pack's own modules, plus every module the platform offers this kind.
create or replace function app.demo_align_center(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; p app.demo_packs; spec jsonb; v_personas jsonb; v_cat text; v_kind_key text; v_from text; v_tradition app.tradition;
        m text; v_granted text[] := '{}'; v_n int; v_rows int; v_round int; v_stories int := 0; v_diet int := 0; v_changed boolean := false;
begin
  select * into c from app.centers where id = p_center for update;
  if c.id is null or not app.is_demo_center(p_center) then
    raise exception 'This is not a demo community, so nothing was changed.';
  end if;
  perform app.demo_assert_sandbox(p_center);
  select * into p from app.demo_packs where key = c.rules ->> 'demo_pack' and content is not null;
  if p.key is null then raise exception 'This demo community has no pack to align with.'; end if;
  spec := coalesce(p.content -> 'center', '{}'::jsonb);
  v_personas := coalesce(p.content -> 'personas', '[]'::jsonb);

  -- The category.
  v_cat := nullif(btrim(coalesce(spec ->> 'category_key', '')), '');
  if v_cat is not null and c.category_key is distinct from v_cat then
    select k.key into v_kind_key from app.organization_categories k where k.key = v_cat;
    if v_kind_key is null then
      raise exception 'The demo pack % names a kind of organization (%) that does not exist.', p.key, v_cat;
    end if;
    v_from := c.category_key;
    perform set_config('app.category_change', txid_current()::text, true);
    update app.centers set category_key = v_kind_key where id = p_center;
    perform set_config('app.category_change', '', true);
    select x.tradition into v_tradition from app.centers x where x.id = p_center;
    perform app.log_audit(p_center, 'category.changed', 'centers', p_center::text,
      jsonb_build_object('category', v_from, 'tradition', c.tradition),
      jsonb_build_object('category', v_kind_key, 'tradition', v_tradition),
      'Demo community: the kind of organization its pack names');
    v_changed := true;
    -- A dietary choice only the old kind offers goes with it (the new kind's own extras are seeded for a new community only).
    if not exists (select 1 from app.category_dietary_options d, app.organization_categories o
                    where o.key = v_kind_key and d.key = 'jain' and d.category_key = any (o.lineage)) then
      delete from app.dietary_options where center_id = p_center and key = 'jain';
      get diagnostics v_diet = row_count;
    end if;
  end if;

  -- The modules (0877). First the ones the pack names (0820). Then every add-on of a module the community already has (Giving > Payment
  -- confirmations, Bank reconciliation, Statements ...), so a feature the product gains next month is in the demo at its next load; a base
  -- module the pack leaves out (the club has no shop) stays out, and so does one the kind does not have or the exclusion list names.
  for m in select e.value from jsonb_array_elements_text(coalesce(spec -> 'modules', '[]'::jsonb)) e loop
    if exists (select 1 from app.modules x where x.key = m and not x.core) and app.module_availability(p_center, m) <> 'not_available' then
      insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at)
      values (p_center, m, true, 'Demo community: its pack switches this module on, so every demo person has their work (0820).', null, now())
      on conflict (center_id, module_key) do nothing;
      get diagnostics v_n = row_count;
      if v_n > 0 then v_granted := v_granted || m; end if;
    end if;
  end loop;
  for v_round in 1..5 loop
    v_n := 0;
    for m in
      select x.key from app.modules x
       where not x.core and x.key <> all (app.demo_module_exclusions())
         and app.module_availability(p_center, x.key) <> 'not_available' and not app.module_enabled(p_center, x.key)
         and exists (select 1 from unnest(coalesce(x.depends_on, '{}'::text[])) d join app.modules dm on dm.key = d
                      where not dm.core and app.module_enabled(p_center, d))
       order by x.key
    loop
      insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at)
      values (p_center, m, true, 'Demo community: an add-on of a module it has, so it shows everything the product offers there (0877).', null, now())
      on conflict (center_id, module_key) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then v_granted := v_granted || m; v_n := v_n + 1; end if;
    end loop;
    exit when v_n = 0;
  end loop;

  -- The story of each demo person.
  update app.demo_personas d set story = x.value ->> 'story'
    from jsonb_array_elements(v_personas) x(value)
   where d.center_id = p_center and d.role_key = x.value ->> 'role'
     and nullif(btrim(coalesce(x.value ->> 'story', '')), '') is not null
     and d.story is distinct from x.value ->> 'story';
  get diagnostics v_stories = row_count;

  return jsonb_build_object('category_changed', v_changed, 'from', v_from, 'to', v_kind_key,
                            'modules_granted', to_jsonb(v_granted), 'dietary_removed', v_diet, 'stories', v_stories);
end $$;
revoke execute on function app.demo_align_center(uuid) from public, anon, authenticated;

-- ── 3. What a demo needs beyond its pack to show the newest features ────────────────────────────────────────────────────�
-- Runs after the pack and the demo people are in. Every part is safe to run again and leaves a part that cannot be done (a module the
-- kind does not have, a family with no open pledge) out rather than failing the reset.
create or replace function app.demo_seed_product_extras(p_center uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_methods int := 0; v_zelle boolean := false; v_proofs int := 0; v_name text; v_persona record; v_pledge record; v_id uuid; v_cents bigint;
        v_tz text; v_today date;
begin
  perform app.demo_assert_sandbox(p_center);
  select name, time_zone into v_name, v_tz from app.centers where id = p_center;
  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;

  -- The ways to pay another way (0875 for a sandbox with none), and Zelle, which needs a recipient a demo can invent.
  v_methods := app._proof_sandbox_methods(p_center);
  begin
    insert into app.center_payment_methods (center_id, method, accepted, instructions, sort)
    values (p_center, 'zelle', true, jsonb_build_object('recipient', 'treasurer@demo.weaverams.org', 'name', v_name, 'memo_hint', 'Your family name'), 4)
    on conflict (center_id, method) do nothing;
    v_zelle := true;
  exception when others then
    raise warning 'demo: Zelle was not added to %: %', p_center, sqlerrm;
  end;

  -- One payment confirmation waiting for the treasury team, from the family of the community member: their oldest open pledge shows
  -- Soft credit until the treasurer decides. Only where Payment confirmations is on and the family has such a pledge.
  if exists (select 1 from app.center_module_grants g where g.center_id = p_center and g.module_key = 'giving_proofs' and g.granted) then
    select d.household_id, d.person_id into v_persona
      from app.demo_personas d
     where d.center_id = p_center and d.household_id is not null and d.person_id is not null
       and d.role_key in (select f.role_key from app.demo_featured_roles() f where f.area = 'community')
     order by d.sort_order limit 1;
    if v_persona.household_id is not null then
      select p.id, p.amount_cents - p.paid_cents - p.soft_credit_cents as open_cents into v_pledge
        from app.pledges p
       where p.center_id = p_center and p.household_id = v_persona.household_id and p.status in ('open', 'partially_paid')
         and p.amount_cents - p.paid_cents - p.soft_credit_cents >= 2500
       order by p.pledged_at, p.created_at, p.id limit 1;
      if v_pledge.id is not null then
        v_cents := least(v_pledge.open_cents, 10000);
        v_id := app.demo_id(p_center, 'proof:waiting');
        insert into app.payment_proofs (id, center_id, household_id, submitted_by_person, entry, method, amount_cents, paid_on, reference, note,
                                        idempotency_key, is_test, created_at, updated_at)
          values (v_id, p_center, v_persona.household_id, v_persona.person_id, 'open_pledges', 'check', v_cents, v_today - 1, '1042',
                  'Mailed it to the office.', 'demo-' || substr(p_center::text, 1, 8) || '-waiting', true, now() - interval '1 day', now() - interval '1 day')
          on conflict (id) do nothing;
        get diagnostics v_proofs = row_count;
        if v_proofs > 0 then
          insert into app.soft_credits (center_id, proof_id, pledge_id, amount_cents, position) values (p_center, v_id, v_pledge.id, v_cents, 0)
            on conflict (proof_id, pledge_id) do nothing;
          insert into app.payment_proof_events (center_id, proof_id, kind, body)
            values (p_center, v_id, 'submitted', 'Sent from the member app. The pledge shows Soft credit while the treasury team checks it.');
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object('payment_methods', v_methods, 'zelle', v_zelle, 'confirmations_waiting', v_proofs);
end $$;
revoke execute on function app.demo_seed_product_extras(uuid, uuid) from public, anon, authenticated;

-- ── 4. The fingerprint of what decides a demo's look ────────────────────────────────────────────────────────────────�
create or replace function app.demo_recipe_hash(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select md5(
    coalesce((select p.version::text || ':' || md5(p.content::text)
                from app.demo_packs p join app.centers c on c.rules ->> 'demo_pack' = p.key where c.id = p_center), '')
    || '|' ||
    coalesce((select string_agg(pr.proname || ':' || md5(pr.prosrc), ',' order by pr.proname)
                from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
               where n.nspname = 'app'
                 and pr.proname in ('demo_populate', 'demo_align_center', 'demo_seed_product_extras', 'demo_module_exclusions', '_proof_sandbox_methods')), '')
    || '|' ||
    coalesce((select string_agg(m.key || ':' || app.module_availability(p_center, m.key), ',' order by m.key) from app.modules m where not m.core), '')
  )
$$;
revoke execute on function app.demo_recipe_hash(uuid) from public, anon, authenticated;

-- ── 5. The load stores the fingerprint and runs the extras ────────────────────────────────────────────────────────────�
-- 0820's body; the lines marked 0877 are new.
create or replace function app.demo_populate(p_center uuid, p_operation text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.demo_packs; v_pack text; v_cleared jsonb := '{}'::jsonb; v_loaded jsonb; v_personas int; v_missing text[]; v_actor uuid;
        v_steps int; v_qbo jsonb := '{}'::jsonb; v_extras jsonb := '{}'::jsonb;
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
    perform app.demo_qbo_save(p_center);           -- 0785: the QuickBooks classes and accounts are written down before they go
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
  perform app.demo_align_center(p_center);     -- 0820: the pack's kind of organization and modules, before its rows load
  v_loaded := app.demo_load_pack(p_center, p.key, v_actor);
  v_qbo := app.demo_qbo_restore(p_center);         -- 0785: and put back on the freshly loaded funds and bank accounts
  v_personas := app.demo_make_personas(p_center, p.key);
  if v_personas <> jsonb_array_length(p.content->'personas') then
    raise exception 'The demo pack % names % demo people but only % could be made (a person or role is missing).',
      p.key, jsonb_array_length(p.content->'personas'), v_personas;
  end if;
  v_missing := app.demo_missing_roles(p_center);
  if cardinality(v_missing) > 0 then
    raise exception 'The demo pack % has no demo person for these roles: %.', p.key, array_to_string(v_missing, ', ');
  end if;
  v_extras := app.demo_seed_product_extras(p_center, v_actor);   -- 0877: what the newest features need to be seen
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
         detail = jsonb_build_object('loaded', v_loaded->'loaded', 'cleared', v_cleared->'removed', 'personas', v_personas, 'quickbooks', v_qbo,
                                     'extras', v_extras, 'recipe', app.demo_recipe_hash(p_center)),   -- 0877
         updated_at = now()
   where center_id = p_center;
  return jsonb_build_object('center_id', p_center, 'loaded', v_loaded->'loaded', 'personas', v_personas);
end $$;
revoke execute on function app.demo_populate(uuid, text, uuid) from public, anon, authenticated;

-- ── 6. The hourly check loads a demo again when the product changed ────────────────────────────────────────────────────�
-- 0679's body; the lines marked 0877 are new.
create or replace function app.worker_demo_reset_due(p_force boolean default false, p_stale interval default interval '3 days') returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare c record; v_out jsonb := '[]'::jsonb; v_checked int := 0; v_reset int := 0; v_skipped int := 0; v_failed int := 0;
        v_dirty boolean; v_hour int; v_why text; v_changed boolean; v_busy boolean;
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
    select ce.id, ce.name, ce.time_zone, s.status, s.loaded_at, s.detail ->> 'recipe' as recipe
      from app.centers ce left join app.center_demo_state s on s.center_id = ce.id
     where app.is_demo_center(ce.id) and ce.environment = 'sandbox'
     order by ce.created_at, ce.id
  loop
    v_checked := v_checked + 1;
    v_hour := extract(hour from (now() at time zone c.time_zone))::int;
    v_dirty := c.loaded_at is not null
               and exists (select 1 from app.audit_log a where a.center_id = c.id and a.occurred_at > c.loaded_at and a.client_app is distinct from 'job');
    -- 0877: the pack, the demo code or the modules on offer are not what this load was made from; and whether anyone is in it right now
    v_changed := c.status = 'loaded' and c.recipe is distinct from app.demo_recipe_hash(c.id);
    v_busy := exists (select 1 from app.demo_sessions ds join app.demo_personas dp on dp.email = ds.persona_email
                       where dp.center_id = c.id and ds.ended_at is null and ds.expires_at > now());
    v_why := case
      when p_force then 'asked for'
      when c.status is distinct from 'loaded' or c.loaded_at is null then 'not loaded'
      when v_changed and (not v_busy or v_hour = 3 or c.loaded_at < now() - interval '30 hours') then 'the product changed'
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
revoke execute on function app.worker_demo_reset_due(boolean, interval) from public, anon, authenticated;
grant execute on function app.worker_demo_reset_due(boolean, interval) to connect_worker;
