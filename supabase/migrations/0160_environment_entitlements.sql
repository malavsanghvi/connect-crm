-- Onboarding (stream o-tenancy) · 1 of 3: sandbox / production environments
-- and entitlements (docs/ONBOARDING_PLAN.md §3 "Sandbox restrictions";
-- /home/user/wt/ONBOARDING_CONTRACT.md "Environment and entitlements").
--
--   app.centers.environment      'production' (every existing center) or 'sandbox'
--   app.centers.sandbox_for      on a sandbox: the production center it was promoted to
--   app.entitlement_defaults     the value of each key per environment
--   app.center_entitlements      per-center overrides; only platform admins write them
--   app.entitlement(c, key)      the override if there is one, else the environment default
--   app.assert_entitlement(...)  raises SQLSTATE CCENT with a plain-English message
--
-- Enforced here, now: max_people / max_households on insert (statement
-- triggers) and public_dashboard (app.public_kpis refuses for a sandbox).
-- messaging.recipients is enforced by the future sender through
-- app.recipient_allowed() (0161). The other keys are read by the streams that
-- own them (payments, QuickBooks, Niva, storage, expiry).
--
-- A JSON null value means "no limit" (production "per plan" values).
set client_min_messages = warning;

-- ── Columns on centers ───────────────────────────────────────────────────────
alter table app.centers add column if not exists environment text not null default 'production';
alter table app.centers add column if not exists sandbox_for uuid references app.centers(id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'centers_environment_check') then
    alter table app.centers add constraint centers_environment_check check (environment in ('production','sandbox'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'centers_sandbox_for_check') then
    alter table app.centers add constraint centers_sandbox_for_check
      check (sandbox_for is null or (environment = 'sandbox' and sandbox_for <> id));
  end if;
end $$;
comment on column app.centers.environment is
  'production or sandbox (docs/ONBOARDING_PLAN.md §3). Only platform admins change it; entitlement defaults follow it.';
comment on column app.centers.sandbox_for is
  'On a sandbox: the production center it was promoted to, once promoted.';

-- A center admin may update their own center (centers_admin_update), but
-- never its environment: flipping a sandbox to production would lift every
-- sandbox limit. Jobs and migrations (no signed-in user) and platform admins pass.
create or replace function app.centers_guard_environment() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if (new.environment is distinct from old.environment or new.sandbox_for is distinct from old.sandbox_for)
     and auth.uid() is not null and not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can change whether a community is a sandbox.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists centers_guard_environment on app.centers;
create trigger centers_guard_environment before update on app.centers
  for each row execute function app.centers_guard_environment();

-- ── Defaults per environment ─────────────────────────────────────────────────
create table if not exists app.entitlement_defaults (
  environment text not null check (environment in ('production','sandbox')),
  key         text not null check (key ~ '^[a-z][a-z0-9_.]*$'),
  value       jsonb not null,
  primary key (environment, key)
);
comment on table app.entitlement_defaults is
  'Entitlement value per environment. JSON null = no limit. Community Connect can change any value at any time (decision O3).';

insert into app.entitlement_defaults (environment, key, value) values
  ('sandbox',    'max_people',             '2000'),
  ('sandbox',    'max_households',         '800'),
  ('sandbox',    'messaging.recipients',   '"test_only"'),
  ('sandbox',    'payments.mode',          '"test"'),
  ('sandbox',    'qbo.mode',               '"sandbox_or_read_only"'),
  ('sandbox',    'public_dashboard',       'false'),
  ('sandbox',    'niva.monthly_questions', '300'),
  ('sandbox',    'storage.bytes',          '2147483648'),
  ('sandbox',    'expiry_days_inactive',   '90'),
  ('production', 'max_people',             'null'),
  ('production', 'max_households',         'null'),
  ('production', 'messaging.recipients',   '"all"'),
  ('production', 'payments.mode',          '"live"'),
  ('production', 'qbo.mode',               '"live"'),
  ('production', 'public_dashboard',       'true'),
  ('production', 'niva.monthly_questions', 'null'),
  ('production', 'storage.bytes',          'null'),
  ('production', 'expiry_days_inactive',   'null')
on conflict (environment, key) do nothing;

-- ── Overrides per center ─────────────────────────────────────────────────────
create table if not exists app.center_entitlements (
  center_id uuid not null references app.centers(id) on delete cascade,
  key       text not null,
  value     jsonb not null,
  set_by    uuid references auth.users(id),
  set_at    timestamptz not null default now(),
  reason    text not null check (btrim(reason) <> ''),
  primary key (center_id, key)
);
comment on table app.center_entitlements is
  'Per-center entitlement overrides (a plan, a raised sandbox limit). Only platform admins write them, with a reason; audited.';

alter table app.entitlement_defaults enable row level security;
alter table app.center_entitlements enable row level security;

drop policy if exists entitlement_defaults_read on app.entitlement_defaults;
create policy entitlement_defaults_read on app.entitlement_defaults for select to authenticated using (true);
drop policy if exists entitlement_defaults_platform on app.entitlement_defaults;
create policy entitlement_defaults_platform on app.entitlement_defaults for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

drop policy if exists center_entitlements_read on app.center_entitlements;
create policy center_entitlements_read on app.center_entitlements for select to authenticated
  using (app.has_permission(center_id, 'settings.manage'));
drop policy if exists center_entitlements_platform on app.center_entitlements;
create policy center_entitlements_platform on app.center_entitlements for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

grant select, insert, update, delete on app.entitlement_defaults, app.center_entitlements to authenticated;
grant all on app.entitlement_defaults, app.center_entitlements to service_role;

drop trigger if exists audit_entitlement_defaults on app.entitlement_defaults;
create trigger audit_entitlement_defaults after insert or update or delete on app.entitlement_defaults
  for each row execute function app.audit_row('environment', 'key');
drop trigger if exists audit_center_entitlements on app.center_entitlements;
create trigger audit_center_entitlements after insert or update or delete on app.center_entitlements
  for each row execute function app.audit_row('center_id', 'key');

insert into app.module_tables (table_name, module_key) values
  ('entitlement_defaults', null), ('center_entitlements', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- ── Reads ────────────────────────────────────────────────────────────────────
-- Security definer: limits are enforced for callers who cannot read the
-- override table (a member saving their family, an import run by a coordinator).
create or replace function app.entitlement(p_center uuid, p_key text) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(
    (select ce.value from app.center_entitlements ce where ce.center_id = p_center and ce.key = p_key),
    (select d.value from app.entitlement_defaults d
       join app.centers c on c.environment = d.environment
      where c.id = p_center and d.key = p_key))
$$;

-- Plain-English wording for a refused entitlement. Pure, so it is unit-tested.
create or replace function app.entitlement_message(p_environment text, p_key text, p_value jsonb, p_needed jsonb)
returns text language plpgsql immutable set search_path = app, public, extensions as $$
declare
  v_who text := case when p_environment = 'sandbox' then 'This sandbox' else 'This community''s plan' end;
  v_raise text := case when p_environment = 'sandbox'
                       then 'ask Community Connect to raise the limit'
                       else 'ask Community Connect about a larger plan' end;
  v_n text := case when jsonb_typeof(p_value) = 'number' then to_char((p_value #>> '{}')::numeric, 'FM999,999,999,990') end;
begin
  return case p_key
    when 'max_people' then
      format('%s can hold up to %s people. Remove some %speople, or %s.', v_who, v_n,
             case when p_environment = 'sandbox' then 'test ' else '' end, v_raise)
    when 'max_households' then
      format('%s can hold up to %s households. Remove some %shouseholds, or %s.', v_who, v_n,
             case when p_environment = 'sandbox' then 'test ' else '' end, v_raise)
    when 'public_dashboard' then
      case when p_environment = 'sandbox' then 'Sandboxes have no public community dashboard. It opens once the community goes live.'
           else 'The public community dashboard is not part of this community''s plan.' end
    when 'messaging.recipients' then
      case when p_environment = 'sandbox' then 'Sandboxes can send only to verified test recipients.'
           else 'This community can send only to verified test recipients.' end
    when 'payments.mode' then
      case when p_environment = 'sandbox' then 'Sandboxes can take payments only in the payment provider''s test mode.'
           else 'This community can take payments only in the payment provider''s test mode.' end
    when 'qbo.mode' then
      'This community can connect only to an Intuit sandbox company, or to its real company read-only (nothing is posted).'
    when 'niva.monthly_questions' then
      format('%s allows %s Niva questions a month, and they are used up. Niva answers again next month, or %s.', v_who, v_n, v_raise)
    when 'storage.bytes' then
      format('%s has %s of file storage, and it is full. Remove some files, or %s.', v_who,
             case when jsonb_typeof(p_value) = 'number'
                  then trim(to_char((p_value #>> '{}')::numeric / 1073741824.0, 'FM999,990.0')) || ' GB' else 'no' end, v_raise)
    else format('%s does not include this (%s).', v_who, p_key)
  end;
end $$;

-- Raises SQLSTATE CCENT when the center's entitlement does not allow what is needed:
--   number   p_needed (a number, default 1) must not exceed it
--   boolean  it must be true
--   text     it must equal p_needed (when given)
--   null     no limit
create or replace function app.assert_entitlement(p_center uuid, p_key text, p_needed jsonb default null) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb; v_env text; v_ok boolean := true;
begin
  if not exists (select 1 from app.entitlement_defaults where key = p_key) then
    raise exception 'There is no entitlement called "%".', p_key;
  end if;
  select environment into v_env from app.centers where id = p_center;
  if v_env is null then raise exception 'That community was not found.'; end if;
  v := app.entitlement(p_center, p_key);
  if v is null or jsonb_typeof(v) = 'null' then return; end if;
  case jsonb_typeof(v)
    when 'number' then
      v_ok := coalesce(case when jsonb_typeof(p_needed) = 'number' then (p_needed #>> '{}')::numeric end, 1)
              <= (v #>> '{}')::numeric;
    when 'boolean' then
      v_ok := (v #>> '{}')::boolean;
    when 'string' then
      v_ok := p_needed is null or jsonb_typeof(p_needed) = 'null' or v = p_needed;
    else v_ok := true;
  end case;
  if not v_ok then
    raise exception using errcode = 'CCENT', message = app.entitlement_message(v_env, p_key, v, p_needed),
      hint = 'Community Connect sets these limits (Platform › Centers).';
  end if;
end $$;

-- Every key for one center: default, override, effective value and who set it.
create or replace function app.center_entitlement_list(p_center uuid)
returns table (key text, default_value jsonb, override_value jsonb, effective jsonb,
               set_by_name text, set_at timestamptz, reason text)
language sql stable security definer set search_path = app, public, extensions as $$
  select d.key, d.value, ce.value, coalesce(ce.value, d.value),
         case when ce.set_by is null then null
              else coalesce((select coalesce(nullif(p.preferred_name, ''), p.first_name) || ' ' || p.last_name
                               from app.center_users cu join app.people p on p.id = cu.person_id
                              where cu.user_id = ce.set_by limit 1),
                            (select u.email::text from auth.users u where u.id = ce.set_by),
                            'Platform team') end,
         ce.set_at, ce.reason
    from app.centers c
    join app.entitlement_defaults d on d.environment = c.environment
    left join app.center_entitlements ce on ce.center_id = c.id and ce.key = d.key
   where c.id = p_center and app.has_permission(p_center, 'settings.manage')
   order by d.key
$$;

-- ── The override switch (platform admins only) ──────────────────────────────
-- p_value NULL (SQL null) removes the override; JSON 'null' means "no limit".
create or replace function app.set_center_entitlement(p_center uuid, p_key text, p_value jsonb, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare v_default jsonb;
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can change a community''s limits.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from app.centers where id = p_center) then raise exception 'That community was not found.'; end if;
  select d.value into v_default from app.entitlement_defaults d join app.centers c on c.environment = d.environment
   where c.id = p_center and d.key = p_key;
  if not found then raise exception 'There is no entitlement called "%".', p_key; end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Give a reason for changing this limit. It goes in the audit log.';
  end if;
  if p_value is not null and jsonb_typeof(p_value) <> 'null' then
    -- Same kind as the defaults (either environment), so a typo cannot turn a number into text.
    if not exists (select 1 from app.entitlement_defaults d where d.key = p_key
                     and jsonb_typeof(d.value) = jsonb_typeof(p_value)) then
      raise exception 'That value does not fit this limit: expected %.',
        (select string_agg(distinct case jsonb_typeof(d.value) when 'number' then 'a number' when 'boolean' then 'on or off'
                                      when 'string' then 'one of ' || (select string_agg(distinct x.value #>> '{}', ', ')
                                                                           from app.entitlement_defaults x where x.key = p_key
                                                                            and jsonb_typeof(x.value) = 'string')
                                      else 'no limit' end, ' or ')
           from app.entitlement_defaults d where d.key = p_key and jsonb_typeof(d.value) <> 'null');
    end if;
    if jsonb_typeof(p_value) = 'number' and (p_value #>> '{}')::numeric < 0 then
      raise exception 'A limit cannot be negative.';
    end if;
  end if;
  perform app.set_audit_context(p_reason);
  if p_value is null then
    delete from app.center_entitlements where center_id = p_center and key = p_key;
  else
    insert into app.center_entitlements (center_id, key, value, set_by, set_at, reason)
    values (p_center, p_key, p_value, auth.uid(), now(), app.audit_clean_reason(p_reason))
    on conflict (center_id, key) do update
      set value = excluded.value, set_by = excluded.set_by, set_at = excluded.set_at, reason = excluded.reason;
  end if;
end $$;

-- ── Enforcement: people and households saved ────────────────────────────────
-- Statement-level, so an import of 2,000 rows counts once, not once per row.
-- The limit is read once per center touched; production (no limit) returns
-- after that read.
create or replace function app.enforce_people_cap() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; v_limit jsonb; v_count bigint; v_key text; v_table text;
begin
  v_key := case tg_table_name when 'people' then 'max_people' else 'max_households' end;
  for r in select distinct center_id from new_rows loop
    v_limit := app.entitlement(r.center_id, v_key);
    continue when v_limit is null or jsonb_typeof(v_limit) <> 'number';
    -- One writer per center at a time, so two parallel imports cannot both slip under the cap.
    perform pg_advisory_xact_lock(hashtextextended('app.' || tg_table_name || '.cap:' || r.center_id::text, 0));
    if tg_table_name = 'people' then
      select count(*) into v_count from app.people where center_id = r.center_id and merged_into_id is null;
    else
      select count(*) into v_count from app.households where center_id = r.center_id;
    end if;
    perform app.assert_entitlement(r.center_id, v_key, to_jsonb(v_count));
  end loop;
  return null;
end $$;

drop trigger if exists people_entitlement_cap on app.people;
create trigger people_entitlement_cap after insert on app.people
  referencing new table as new_rows for each statement execute function app.enforce_people_cap();
drop trigger if exists households_entitlement_cap on app.households;
create trigger households_entitlement_cap after insert on app.households
  referencing new table as new_rows for each statement execute function app.enforce_people_cap();

-- ── Enforcement: the public community dashboard ─────────────────────────────
-- The dashboard body (0023, guarded in 0104) is kept as it is under a private
-- name; app.public_kpis checks the entitlement first. Returns NULL for an
-- unknown slug exactly as before.
do $$
begin
  if to_regprocedure('app.public_kpis_unchecked(text, date, date, text)') is null then
    alter function app.public_kpis(text, date, date, text) rename to public_kpis_unchecked;
  end if;
end $$;
revoke execute on function app.public_kpis_unchecked(text, date, date, text) from public, anon, authenticated;

create or replace function app.public_kpis(p_slug text,
  p_from date default (date_trunc('year', current_date::timestamptz))::date,
  p_to date default current_date, p_campaign text default null)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_center uuid;
begin
  select id into v_center from app.centers where slug = p_slug and status = 'active';
  if v_center is null then return null; end if;
  perform app.assert_entitlement(v_center, 'public_dashboard');
  return app.public_kpis_unchecked(p_slug, p_from, p_to, p_campaign);
end $$;

revoke execute on function app.enforce_people_cap(), app.centers_guard_environment() from public, anon, authenticated;
revoke execute on function app.set_center_entitlement(uuid, text, jsonb, text), app.center_entitlement_list(uuid) from public, anon;
grant execute on function app.entitlement(uuid, text), app.assert_entitlement(uuid, text, jsonb),
  app.entitlement_message(text, text, jsonb, jsonb), app.set_center_entitlement(uuid, text, jsonb, text),
  app.center_entitlement_list(uuid) to authenticated;
grant execute on function app.public_kpis(text, date, date, text) to anon, authenticated;
grant execute on all functions in schema app to service_role;
