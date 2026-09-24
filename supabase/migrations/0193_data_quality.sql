-- Onboarding · o-import · 4 of 4: the data-quality view (G29) and the
-- "records imported" readiness check.
--
--   app.data_quality(center)             contact coverage by household, likely duplicates,
--                                        minors without a birth date, people without a
--                                        consent record, invalid emails and phones
--   app.check_records_imported(center)   readiness check (o-setup's registry): records
--                                        imported and reconciled; contact coverage above target
--
-- The readiness registry belongs to o-setup (app.readiness_checks, contract
-- "Readiness checks"). It is created here only if it does not exist yet, with
-- the contract's shape, so this stream can register its check either way.

create table if not exists app.readiness_checks (
  key      text primary key,
  title    text not null,
  sort     integer not null default 0,
  check_fn regproc not null
);
alter table app.readiness_checks enable row level security;
do $$
begin
  if not exists (select 1 from pg_policy where polrelid = 'app.readiness_checks'::regclass) then
    create policy readiness_checks_read on app.readiness_checks for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'app.readiness_checks'::regclass and tgname = 'audit_readiness_checks') then
    create trigger audit_readiness_checks after insert or update or delete on app.readiness_checks
      for each row execute function app.audit_row('key');
  end if;
end $$;
insert into app.module_tables (table_name, module_key) values ('readiness_checks', null) on conflict (table_name) do nothing;

-- The contact-coverage target (percent of households with a way to reach an
-- adult): centers.rules.onboarding.contact_coverage_target, 80 by default.
create or replace function app.contact_coverage_target(p_center uuid) returns integer
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(case when (rules->'onboarding'->>'contact_coverage_target') ~ '^\d{1,3}$'
                       then least(100, (rules->'onboarding'->>'contact_coverage_target')::int) end, 80)
    from app.centers where id = p_center
$$;

-- Households (not merged away) with at least one current adult member who has
-- an email or a mobile number.
create or replace function app.contact_coverage(p_center uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  with allowed as (select app.import_has_any(p_center, array['people.view','people.manage','settings.manage']) ok),
  hh as (
    select h.id,
           exists (select 1 from app.household_members hm join app.people p on p.id = hm.person_id
                    where hm.household_id = h.id and hm.left_at is null and not p.is_deceased and p.merged_into_id is null
                      and (p.date_of_birth is null or p.date_of_birth <= current_date - interval '18 years')
                      and (coalesce(p.email::text, '') <> '' or coalesce(p.phone_e164, '') <> '')) as reachable
      from app.households h where h.center_id = p_center and h.merged_into_id is null and (select ok from allowed))
  select case when not (select ok from allowed) then null else jsonb_build_object('households', count(*), 'reachable', count(*) filter (where reachable),
                            'percent', case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where reachable) / count(*))::int end,
                            'target', app.contact_coverage_target(p_center)) end
    from hh
$$;

create or replace function app.data_quality(p_center uuid, p_limit int default 25) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_lim int := greatest(1, least(coalesce(p_limit, 25), 200)); v jsonb;
begin
  if not app.import_has_any(p_center, array['people.view','people.manage']) then
    raise exception 'The data-quality view needs people.view or people.manage.' using errcode = 'insufficient_privilege';
  end if;
  with ppl as (
    select p.* from app.people p where p.center_id = p_center and p.merged_into_id is null and not p.is_deceased
  ),
  hh_of as (
    select distinct on (hm.person_id) hm.person_id, hm.household_id, hm.role
      from app.household_members hm where hm.center_id = p_center and hm.left_at is null
     order by hm.person_id, hm.is_primary desc
  ),
  card as (
    select p.id, p.first_name || ' ' || p.last_name as name, p.member_number,
           (select x.value from app.external_ids x where x.person_id = p.id and x.kind = 'org_member' and x.valid_to is null limit 1) as org_id,
           h.id as household_id, h.display_name as household, h.household_number
      from ppl p left join hh_of o on o.person_id = p.id left join app.households h on h.id = o.household_id
  ),
  dupe_pairs as (
    -- Likely duplicates: the same email, the same mobile, or the same name AND birth date.
    select a.id a_id, b.id b_id, 'same email' why from ppl a join ppl b on a.id < b.id and a.email is not null and lower(a.email::text) = lower(b.email::text)
    union
    select a.id, b.id, 'same mobile' from ppl a join ppl b on a.id < b.id and a.phone_e164 is not null and a.phone_e164 = b.phone_e164
    union
    select a.id, b.id, 'same name and birth date' from ppl a join ppl b on a.id < b.id and a.date_of_birth is not null
       and a.date_of_birth = b.date_of_birth and lower(a.first_name) = lower(b.first_name) and lower(a.last_name) = lower(b.last_name)
  ),
  minors as (
    select c.* from card c join hh_of o on o.person_id = c.id join ppl p on p.id = c.id
     where o.role = 'child' and p.date_of_birth is null
  ),
  no_consent as (
    select c.* from card c
     where not exists (select 1 from app.channel_optins o where o.person_id = c.id)
       and not exists (select 1 from app.consents cs where cs.person_id = c.id)
  ),
  bad_email as (
    select c.*, p.email::text as value from card c join ppl p on p.id = c.id
     where p.email is not null and p.email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  bad_phone as (
    select c.*, p.phone_e164 as value from card c join ppl p on p.id = c.id
     where p.phone_e164 is not null and p.phone_e164 !~ '^\+[1-9][0-9]{6,14}$'
  ),
  unreachable as (
    select h.id, h.display_name, h.household_number from app.households h
     where h.center_id = p_center and h.merged_into_id is null
       and not exists (select 1 from app.household_members hm join app.people p on p.id = hm.person_id
                        where hm.household_id = h.id and hm.left_at is null and not p.is_deceased and p.merged_into_id is null
                          and (p.date_of_birth is null or p.date_of_birth <= current_date - interval '18 years')
                          and (coalesce(p.email::text, '') <> '' or coalesce(p.phone_e164, '') <> ''))
  )
  select jsonb_build_object(
    'coverage', app.contact_coverage(p_center),
    'unreachable', jsonb_build_object('count', (select count(*) from unreachable),
        'rows', coalesce((select jsonb_agg(to_jsonb(u) order by u.display_name) from (select * from unreachable order by display_name limit v_lim) u), '[]'::jsonb)),
    'duplicates', jsonb_build_object('count', (select count(*) from dupe_pairs),
        'open_merge_candidates', (select count(*) from app.merge_candidates m where m.center_id = p_center and m.status = 'open'),
        'rows', coalesce((select jsonb_agg(jsonb_build_object('why', d.why, 'a', to_jsonb(ca), 'b', to_jsonb(cb)))
                            from (select * from dupe_pairs limit v_lim) d join card ca on ca.id = d.a_id join card cb on cb.id = d.b_id), '[]'::jsonb)),
    'minors_without_birth_date', jsonb_build_object('count', (select count(*) from minors),
        'rows', coalesce((select jsonb_agg(to_jsonb(m) order by m.name) from (select * from minors order by name limit v_lim) m), '[]'::jsonb)),
    'without_consent', jsonb_build_object('count', (select count(*) from no_consent),
        'rows', coalesce((select jsonb_agg(to_jsonb(n) order by n.name) from (select * from no_consent order by name limit v_lim) n), '[]'::jsonb)),
    'invalid_emails', jsonb_build_object('count', (select count(*) from bad_email),
        'rows', coalesce((select jsonb_agg(to_jsonb(b) order by b.name) from (select * from bad_email order by name limit v_lim) b), '[]'::jsonb)),
    'invalid_phones', jsonb_build_object('count', (select count(*) from bad_phone),
        'rows', coalesce((select jsonb_agg(to_jsonb(b) order by b.name) from (select * from bad_phone order by name limit v_lim) b), '[]'::jsonb)),
    'people', (select count(*) from ppl),
    'computed_at', now())
  into v;
  return v;
end $$;

-- Readiness: records imported and reconciled; contact coverage above target.
create or replace function app.check_records_imported(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_cov jsonb; v_hh int; v_ppl int; v_open text; v_unsigned text; v_pct int; v_target int; v_problems text[] := '{}';
begin
  if not app.import_has_any(p_center, array['people.view','people.manage','settings.manage']) then
    raise exception 'This readiness check needs people.view or settings.manage.' using errcode = 'insufficient_privilege';
  end if;
  select count(*) into v_hh from app.households where center_id = p_center and merged_into_id is null;
  select count(*) into v_ppl from app.people where center_id = p_center and merged_into_id is null;
  if v_hh = 0 or v_ppl = 0 then
    return jsonb_build_object('ok', false, 'detail', 'No households or people have been loaded yet (Settings › Data import).');
  end if;
  select string_agg('#' || run_number, ', ' order by run_number) into v_open from app.import_runs
   where center_id = p_center and status in ('pending','staged','previewed','committing');
  select string_agg('#' || run_number, ', ' order by run_number) into v_unsigned from app.import_runs
   where center_id = p_center and status = 'committed';
  v_cov := app.contact_coverage(p_center);
  v_pct := (v_cov->>'percent')::int; v_target := (v_cov->>'target')::int;
  if v_open is not null then v_problems := v_problems || format('imports not finished: %s', v_open); end if;
  if v_unsigned is not null then v_problems := v_problems || format('imports not reconciled and signed off: %s', v_unsigned); end if;
  if v_pct < v_target then
    v_problems := v_problems || format('contact coverage %s%% is below the %s%% target (%s of %s households reachable)',
                                       v_pct, v_target, v_cov->>'reachable', v_cov->>'households');
  end if;
  if array_length(v_problems, 1) is null then
    return jsonb_build_object('ok', true, 'detail', format('%s households and %s people loaded; every import reconciled; contact coverage %s%% (target %s%%).',
                                                           v_hh, v_ppl, v_pct, v_target));
  end if;
  return jsonb_build_object('ok', false, 'detail', initcap(left(array_to_string(v_problems, '; '), 1)) || substr(array_to_string(v_problems, '; '), 2) || '.');
end $$;

insert into app.readiness_checks (key, title, sort, check_fn)
values ('records_imported_reconciled', 'Records imported and reconciled; contact coverage above target', 40, 'app.check_records_imported'::regproc)
on conflict (key) do update set title = excluded.title, check_fn = excluded.check_fn;

grant execute on function app.contact_coverage_target(uuid), app.contact_coverage(uuid), app.data_quality(uuid, int),
  app.check_records_imported(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
