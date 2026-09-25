-- Wave F (stream f-sandbox) · 1 of 4: a sandbox that holds an organization's own records.
-- Owner decisions (2026-09-25, second batch): "JSH's current organization is a sandbox".
-- JSH is the first sandbox that is also in use, with records its staff entered; this
-- migration makes the sandbox rules behave sensibly for such a sandbox. Nothing here
-- changes JSH itself (0503 does), and nothing is deleted.
--
--   entitlement `promotion.in_place`  (new key; false by default in both environments)
--        Community Connect sets it on a sandbox whose records are the organization's own.
--        Going live then switches THAT organization to production in place — same web
--        name, every person, household, payment and setting kept — instead of copying the
--        configuration into a new production organization (0203). It goes through the same
--        steps: go-live request, two Community Connect approvals, the owner's promotion
--        with a fresh 2FA check, the platform.promote job. Refused while demo data is loaded
--        (demo records would become production records).
--   `expiry_days_inactive` = no limit  (existing key) exempts a sandbox from the 60/80-day
--        inactivity warnings: app.worker_sandbox_expiry already skips a JSON-null value.
--   app.demo_center_problem  a sandbox that members already use (status 'active') may hold
--        demo data too when Community Connect marked it with `promotion.in_place` (it is the
--        organization in use, deliberately a sandbox); any other live organization stays
--        protected, and a promoted sandbox or a production organization still never can.
set client_min_messages = warning;

-- ── The new entitlement key ──────────────────────────────────────────────────
insert into app.entitlement_defaults (environment, key, value) values
  ('sandbox', 'promotion.in_place', 'false'),
  ('production', 'promotion.in_place', 'false')
on conflict (environment, key) do nothing;

-- True when going live keeps this organization (in place) rather than copying it.
create or replace function app.promotes_in_place(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((app.entitlement(p_center, 'promotion.in_place') #>> '{}')::boolean, false)
$$;

-- ── Demo data in a sandbox members already use ───────────────────────────────
-- Same as 0310 except that an ACTIVE sandbox (one whose members already use it, like
-- JSH) may hold demo data. The Reset / Clear screens say plainly that clearing removes
-- every record the organization entered, and keep the typed name and the fresh 2FA check.
create or replace function app.demo_center_problem(p_center uuid) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers;
begin
  select * into c from app.centers where id = p_center;
  if c.id is null then return 'Demo data is only for sandboxes. This organization was not found.'; end if;
  if c.environment is distinct from 'sandbox' then
    return 'Demo data is only for sandboxes. ' || c.name || ' is a production organization, so its data can never be cleared or replaced with demo data.';
  end if;
  if c.sandbox_for is not null then
    return 'Demo data is only for sandboxes that have not gone live. This sandbox was promoted to production, so it is kept as it is.';
  end if;
  -- A live organization stays protected even if its environment says sandbox by mistake,
  -- unless Community Connect has marked it as a sandbox that holds its own records.
  if c.status = 'active' and not app.promotes_in_place(c.id) then
    return 'Demo data is only for sandboxes. ' || c.name || ' is live.';
  end if;
  if c.status in ('suspended','exited') then
    return 'Demo data is only for open sandboxes. This sandbox is ' || c.status || '.';
  end if;
  return null;
end $$;

-- ── Promotion in place ───────────────────────────────────────────────────────
-- 0203's request, with the in-place branch: the production web name is the one the
-- organization already has, and demo data must not be loaded.
create or replace function app.promote_sandbox(p_sandbox uuid, p_slug text, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; g app.golive_requests; v_slug text := lower(btrim(coalesce(p_slug, ''))); v_id uuid; v_job bigint;
        v_in_place boolean; v_demo text;
begin
  if auth.uid() is null or not app.is_center_owner(p_sandbox) then
    raise exception 'Only the owner of this sandbox can promote it to production.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from app.centers where id = p_sandbox for update;
  if c.environment <> 'sandbox' then raise exception 'Only a sandbox can be promoted. This organization is already in production.'; end if;
  if c.sandbox_for is not null then raise exception 'This sandbox has already been promoted.'; end if;
  if exists (select 1 from app.sandbox_promotions where sandbox_id = p_sandbox and status = 'queued') then
    raise exception 'A promotion of this sandbox is already running.';
  end if;
  select * into g from app.golive_requests where center_id = p_sandbox and status = 'approved' order by requested_at desc limit 1;
  if g.id is null then raise exception 'Community Connect must approve go-live (two approvals) before the sandbox can be promoted.'; end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Give a reason for the promotion. It goes in the audit log.'; end if;
  v_in_place := app.promotes_in_place(p_sandbox);
  if v_in_place then
    -- The organization keeps its web name; a different one is not offered.
    if v_slug <> '' and v_slug <> lower(c.slug::text) then
      raise exception '% goes live under its own web name "%", keeping all its records. Leave the web name as it is.', c.name, c.slug;
    end if;
    v_slug := lower(c.slug::text);
    select d.status into v_demo from app.center_demo_state d where d.center_id = p_sandbox;
    if coalesce(v_demo, 'empty') <> 'empty' then
      raise exception 'Demo data is loaded in %. Going live in place would turn it into real records. Clear it first (Setup › Demo data) — clearing removes everything the organization entered.', c.name;
    end if;
  else
    if v_slug !~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$' or v_slug like '%--%' or v_slug ~ '-sandbox$' then
      raise exception 'Choose the production web name: 2 to 40 lowercase letters, numbers and single dashes, without "-sandbox".';
    end if;
    if exists (select 1 from app.centers x where lower(x.slug::text) = v_slug) then
      raise exception 'The web name "%" is already taken. Choose another.', v_slug;
    end if;
  end if;
  perform app.assert_step_up('platform.promote');
  perform app.set_audit_context(p_reason);
  insert into app.sandbox_promotions (sandbox_id, golive_id, slug, reason, requested_by)
  values (p_sandbox, g.id, v_slug, app.audit_clean_reason(p_reason), auth.uid()) returning id into v_id;
  v_job := app.enqueue_job(p_sandbox, 'platform.promote', jsonb_build_object('promotion_id', v_id, 'in_place', v_in_place), now(), 3);
  update app.sandbox_promotions set job_id = v_job where id = v_id;
  return v_id;
end $$;

-- The copy (0203) stays as it was, under a private name; the job calls this wrapper.
do $$ begin
  if to_regprocedure('app._worker_promote_sandbox_copy(uuid)') is null then
    alter function app.worker_promote_sandbox(uuid) rename to _worker_promote_sandbox_copy;
  end if;
end $$;
revoke execute on function app._worker_promote_sandbox_copy(uuid) from public, anon, authenticated;

create or replace function app.worker_promote_sandbox(p_promotion uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.sandbox_promotions; s app.centers; v_demo text; v_result jsonb;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into p from app.sandbox_promotions where id = p_promotion for update;
  if p.id is null then raise exception 'Promotion % was not found.', p_promotion; end if;
  if p.status = 'done' then return coalesce(p.result, '{}'::jsonb); end if;
  select * into s from app.centers where id = p.sandbox_id for update;
  if not app.promotes_in_place(s.id) then
    return app._worker_promote_sandbox_copy(p_promotion);
  end if;

  -- In place: the organization itself becomes production. Nothing is copied or removed.
  if s.environment <> 'sandbox' then raise exception 'Center % is not a sandbox.', s.slug; end if;
  if s.sandbox_for is not null then raise exception 'Sandbox % was already promoted.', s.slug; end if;
  if not exists (select 1 from app.golive_requests g where g.id = p.golive_id and g.status = 'approved') then
    raise exception 'The go-live approval for this promotion is no longer in place.';
  end if;
  select d.status into v_demo from app.center_demo_state d where d.center_id = s.id;
  if coalesce(v_demo, 'empty') <> 'empty' then
    raise exception 'Demo data was loaded in % after the promotion was requested. Clear it, then ask the owner to promote again.', s.name;
  end if;
  perform app.set_audit_context('Promotion in place (' || s.slug || '): ' || p.reason);
  update app.centers
     set environment = 'production',
         rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{onboarding}',
                           coalesce(rules->'onboarding', '{}'::jsonb)
                             || jsonb_build_object('promoted_in_place_at', now(), 'promotion_id', p.id))
   where id = s.id;
  update app.golive_requests set status = 'live' where center_id = s.id and status = 'approved';
  v_result := jsonb_build_object('production_id', s.id, 'slug', s.slug, 'in_place', true, 'tables', '[]'::jsonb,
                                 'staff_reinvited', 0,
                                 'note', 'Every record was kept. Services connected in test mode stay in test mode until they are switched to live.');
  update app.sandbox_promotions
     set status = 'done', production_id = s.id, finished_at = now(), last_error = null, result = v_result
   where id = p.id;
  return v_result;
end $$;

revoke execute on function app.promotes_in_place(uuid) from public, anon;
grant execute on function app.promotes_in_place(uuid) to authenticated;
revoke execute on function app.worker_promote_sandbox(uuid) from public, anon, authenticated;
grant execute on function app.worker_promote_sandbox(uuid), app._worker_promote_sandbox_copy(uuid) to connect_worker;
grant execute on all functions in schema app to service_role;
