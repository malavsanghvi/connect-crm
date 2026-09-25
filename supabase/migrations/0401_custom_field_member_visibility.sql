-- Wave E (stream e-access) · 2 of 2: members never receive staff-only custom-field values.
-- Owner decisions batch 2026-09-25, item (22) (docs/DECISIONS.md).
--
-- Until now every value lived in the record's own `custom` column, so a member who may read a
-- row (their own person, household, membership, pledges, payments, and every public row such
-- as events or store items) received ALL its custom values over the API, staff-only ones
-- included. Postgres cannot hide one JSON key per reader, and a column privilege would break
-- every `select *` in the three apps, so the staff-only values move out of the row:
--
--   <table>.custom             only values whose definition is member_self or directory
--                              (what members may see) — unchanged for everything else
--   app.custom_staff_values    values whose definition is `staff`, one row per record,
--                              readable only by staff who may read that kind of record
--
-- Writes do not change: whoever writes `custom` (set_custom_value, the import engine, the
-- demo pack, a Server Action) writes it on the record as before, and the BEFORE trigger
-- (app.custom_values_check) routes each staff-only key to app.custom_staff_values. A JSON null
-- still removes a value, wherever it is kept. Staff read a record's full set with
-- app.custom_values(entity, ids) (runs as the caller, so each table's own RLS still decides).
-- Changing a field's sensitivity moves its values across. Members read their own member_self
-- and directory values with app.person_custom_fields (now directory ones too).
--
-- Nothing here loosens a policy: the new table only restricts, and the rows lose data members
-- should never have had.

-- ── Who may read a kind of record's staff-only values ───────────────────────
-- The permissions that write it (0190), their .view counterparts, and settings.manage.
create or replace function app.custom_entity_read_perms(p_entity text) returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array(select distinct x from unnest(
           app.custom_entity_write_perms(p_entity)
        || array(select replace(p, '.manage', '.view') from unnest(app.custom_entity_write_perms(p_entity)) p)
        || case when p_entity in ('pledges','payments','payment_allocations','recurring_gifts','funds','campaigns',
                                  'opportunities','labh_options','bank_accounts')
                then array['giving.view','giving.record_offline','accounting.manage'] else array[]::text[] end
        || array['settings.manage']) x order by 1)
$$;

-- The key of a record in app.custom_staff_values: its id, or "household:person" for a membership row.
create or replace function app.custom_record_key(p_table text, p_row jsonb) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case when p_table = 'household_members' then (p_row->>'household_id') || ':' || (p_row->>'person_id')
              else p_row->>'id' end
$$;

create table if not exists app.custom_staff_values (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  entity      text not null check (entity = any (app.custom_field_entities())),
  record_key  text not null,
  custom      jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object'),
  updated_at  timestamptz not null default now(),
  unique (entity, record_key)
);
create index if not exists custom_staff_values_center_idx on app.custom_staff_values (center_id, entity);
comment on table app.custom_staff_values is
  'Staff-only custom-field values (definition sensitivity = staff), kept off the record so members never receive them. Written only by app.custom_values_check.';

alter table app.custom_staff_values enable row level security;
drop policy if exists custom_staff_values_staff_read on app.custom_staff_values;
create policy custom_staff_values_staff_read on app.custom_staff_values for select to authenticated
  using (app.import_has_any(center_id, app.custom_entity_read_perms(entity)));
-- No write policy: only the trigger and the RPCs below (security definer) write it.
revoke all on app.custom_staff_values from anon;
grant select on app.custom_staff_values to authenticated;
grant all on app.custom_staff_values to service_role;
drop trigger if exists audit_custom_staff_values on app.custom_staff_values;
create trigger audit_custom_staff_values after insert or update or delete on app.custom_staff_values
  for each row execute function app.audit_row();
insert into app.module_tables (table_name, module_key) values ('custom_staff_values', null)
  on conflict (table_name) do update set module_key = excluded.module_key;

-- ── The write path ──────────────────────────────────────────────────────────
-- 0190's check, unchanged in what it accepts; staff-only keys now land in
-- app.custom_staff_values instead of the row. Set app.custom_moving = 'on' (transaction-local)
-- to skip the "only staff" guard while update_custom_field moves values between the two.
create or replace function app.custom_values_check() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; k text; v jsonb; d app.custom_field_definitions; v_out jsonb := '{}'::jsonb;
        v_staff jsonb := '{}'::jsonb; v_drop text[] := array[]::text[]; v_key text;
begin
  if new.custom is null then new.custom := '{}'::jsonb; end if;
  if new.custom = '{}'::jsonb then return new; end if;
  if tg_op = 'UPDATE' and new.custom = old.custom then return new; end if;
  if jsonb_typeof(new.custom) <> 'object' then
    raise exception 'Custom fields must be a JSON object.' using errcode = 'check_violation';
  end if;
  if tg_table_name = 'gyan_levels' then
    select g.center_id into v_center from app.gyan_goals g where g.id = (to_jsonb(new)->>'goal_id')::uuid;
  elsif tg_table_name = 'gyan_steps' then
    select g.center_id into v_center from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id
     where l.id = (to_jsonb(new)->>'level_id')::uuid;
  else
    v_center := (to_jsonb(new)->>'center_id')::uuid;
  end if;
  -- Custom details are staff data: a member (who may edit their family's
  -- profile) never changes them, not even the ones they can see.
  if auth.uid() is not null and coalesce(current_setting('app.custom_moving', true), '') <> 'on'
     and not app.import_has_any(v_center, app.custom_entity_write_perms(tg_table_name))
     and new.custom is distinct from (case when tg_op = 'UPDATE' then old.custom else '{}'::jsonb end) then
    raise exception 'Only staff can change these details.' using errcode = 'insufficient_privilege';
  end if;
  for k, v in select * from jsonb_each(new.custom) loop
    select * into d from app.custom_field_definitions where center_id = v_center and entity = tg_table_name and key = k;
    if jsonb_typeof(v) = 'null' then                          -- null removes the value
      if d.id is not null and d.sensitivity = 'staff' then v_drop := v_drop || k; end if;
      continue;
    end if;
    if tg_op = 'UPDATE' and (old.custom -> k) is not distinct from v then
      if d.id is not null and d.sensitivity = 'staff' then v_staff := v_staff || jsonb_build_object(k, v);
      else v_out := v_out || jsonb_build_object(k, v); end if;
      continue;
    end if;
    if d.id is null then
      raise exception 'There is no custom field "%" for this kind of record. Add it in Settings › Custom fields first.', k
        using errcode = 'check_violation';
    end if;
    if d.status = 'archived' then
      raise exception 'The custom field "%" is archived, so it cannot take new values.', d.label using errcode = 'check_violation';
    end if;
    perform app.custom_value_check(d.type, d.choices, v, d.label);
    if d.sensitivity = 'staff' then v_staff := v_staff || jsonb_build_object(k, v);
    else v_out := v_out || jsonb_build_object(k, v); end if;
  end loop;
  new.custom := v_out;
  if v_staff <> '{}'::jsonb or cardinality(v_drop) > 0 then
    v_key := app.custom_record_key(tg_table_name, to_jsonb(new));
    if v_key is null or v_center is null then
      raise exception 'Could not keep the staff-only details of this record (no record id).' using errcode = 'check_violation';
    end if;
    insert into app.custom_staff_values as s (center_id, entity, record_key, custom)
    values (v_center, tg_table_name, v_key, v_staff)
    on conflict (entity, record_key) do update
      set custom = (s.custom - v_drop) || excluded.custom, updated_at = now()
      where (s.custom - v_drop) || excluded.custom is distinct from s.custom;
  end if;
  return new;
end $$;

-- A record that goes takes its staff-only values with it.
create or replace function app.custom_staff_values_cleanup() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  delete from app.custom_staff_values where entity = tg_table_name and record_key = app.custom_record_key(tg_table_name, to_jsonb(old));
  return old;
end $$;

do $$
declare t text;
begin
  foreach t in array app.custom_field_entities() loop
    execute format('drop trigger if exists custom_staff_values_cleanup on app.%I', t);
    execute format('create trigger custom_staff_values_cleanup after delete on app.%I
                    for each row execute function app.custom_staff_values_cleanup()', t);
  end loop;
end $$;

-- ── Move what is already there ──────────────────────────────────────────────
-- One field's values leave the rows of its kind of record for app.custom_staff_values.
create or replace function app.custom_move_to_staff(p_center uuid, p_entity text, p_key text) returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_where text := case when p_entity in ('gyan_levels','gyan_steps') then '' else ' and t.center_id = $1' end; n bigint;
begin
  -- gyan_levels / gyan_steps carry no center_id; their definitions still belong to one center.
  execute format($q$
    insert into app.custom_staff_values as s (center_id, entity, record_key, custom)
    select $1, %1$L, app.custom_record_key(%1$L, to_jsonb(t)), jsonb_build_object($2, t.custom -> $2)
      from app.%1$I t where t.custom ? $2%2$s
    on conflict (entity, record_key) do update set custom = s.custom || excluded.custom, updated_at = now()$q$,
    p_entity, v_where) using p_center, p_key;
  perform set_config('app.custom_moving', 'on', true);
  execute format('update app.%I t set custom = t.custom - $2 where t.custom ? $2%s', p_entity, v_where) using p_center, p_key;
  get diagnostics n = row_count;
  perform set_config('app.custom_moving', '', true);
  return n;
end $$;

-- Every existing staff-only value leaves its row (the audit log records each row change).
do $$
declare d record; n bigint;
begin
  perform set_config('app.audit_reason', 'Staff-only custom fields kept off member-readable records (owner decision 22)', true);
  for d in select * from app.custom_field_definitions where sensitivity = 'staff' order by entity, key loop
    n := app.custom_move_to_staff(d.center_id, d.entity, d.key);
    if n > 0 then raise notice 'custom field %.% (%): % value(s) moved to app.custom_staff_values', d.entity, d.key, d.center_id, n; end if;
  end loop;
  perform set_config('app.audit_reason', '', true);
end $$;

-- ── Reading ─────────────────────────────────────────────────────────────────
-- A record's full custom values as the caller may see them: the row's own (member-visible)
-- values plus, for staff who may read that kind of record, the staff-only ones. Runs as the
-- caller, so each table's RLS decides which records come back at all.
create or replace function app.custom_values(p_entity text, p_ids text[])
returns table (record_key text, custom jsonb)
language plpgsql stable security invoker set search_path = app, public, extensions as $$
begin
  if p_entity is null or not (p_entity = any (app.custom_field_entities())) then
    raise exception 'Custom fields are not kept for "%".', coalesce(p_entity, '(none)');
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  if cardinality(p_ids) > 1000 then raise exception 'Ask for at most 1,000 records at a time.'; end if;
  return query execute format($q$
    select k, t.custom || coalesce(s.custom, '{}'::jsonb)
      from app.%1$I t
      cross join lateral (select app.custom_record_key(%1$L, to_jsonb(t)) as k) x
      left join app.custom_staff_values s on s.entity = %1$L and s.record_key = x.k
     where x.k = any ($1)$q$, p_entity) using p_ids;
end $$;

-- Set (or, with null, clear) one value in place — 0190, now also clearing a staff-only value
-- (a null goes through the trigger, which removes it wherever it is kept) and returning the
-- record's full set as the caller may see it.
create or replace function app.set_custom_value(p_entity text, p_record uuid, p_key text, p_value jsonb)
returns jsonb
language plpgsql security invoker set search_path = app, public, extensions as $$
declare v jsonb; v_staff jsonb;
begin
  if p_entity is null or not (p_entity = any (app.custom_field_entities())) or p_entity = 'household_members' then
    raise exception 'Custom fields cannot be set on "%".', coalesce(p_entity, '(none)');
  end if;
  if coalesce(p_key, '') !~ '^[a-z][a-z0-9_]{0,62}$' then raise exception 'That is not a custom field key.'; end if;
  execute format('update app.%I set custom = custom || jsonb_build_object($1, coalesce($2, ''null''::jsonb))
                   where id = $3 returning custom', p_entity)
    into v using p_key, p_value, p_record;
  if v is null then raise exception 'That record was not found, or you don''t have permission to change it.' using errcode = 'insufficient_privilege'; end if;
  select s.custom into v_staff from app.custom_staff_values s where s.entity = p_entity and s.record_key = p_record::text;
  return v || coalesce(v_staff, '{}'::jsonb);
end $$;

-- Change a definition (0190). A sensitivity change moves the field's values between the record
-- (member_self / directory) and app.custom_staff_values (staff).
create or replace function app.update_custom_field(
  p_id uuid, p_label text default null, p_type text default null, p_choices jsonb default null,
  p_sensitivity text default null, p_searchable boolean default null, p_status text default null, p_sort int default null)
returns app.custom_field_definitions
language plpgsql security definer set search_path = app, public, extensions as $$
declare d app.custom_field_definitions; v_used boolean; v_was text; r record;
begin
  select * into d from app.custom_field_definitions where id = p_id for update;
  if d.id is null then raise exception 'That custom field was not found.'; end if;
  if not app.has_permission(d.center_id, 'settings.manage') then
    raise exception 'Changing custom fields needs settings.manage.' using errcode = 'insufficient_privilege';
  end if;
  if p_type is not null and p_type <> d.type then
    if d.entity in ('gyan_levels','gyan_steps') then
      execute format('select exists (select 1 from app.%I where custom ? $1)', d.entity) into v_used using d.key;
    else
      execute format('select exists (select 1 from app.%I where center_id = $1 and custom ? $2)', d.entity)
        into v_used using d.center_id, d.key;
    end if;
    v_used := v_used or exists (select 1 from app.custom_staff_values s
                                 where s.center_id = d.center_id and s.entity = d.entity and s.custom ? d.key);
    if v_used then
      raise exception 'The type of "%" cannot change because records already have values. Add a new field instead.', d.label;
    end if;
  end if;
  v_was := d.sensitivity;
  update app.custom_field_definitions set
    label = coalesce(nullif(btrim(p_label), ''), label),
    type = coalesce(p_type, type),
    choices = coalesce(p_choices, choices),
    sensitivity = coalesce(p_sensitivity, sensitivity),
    searchable = coalesce(p_searchable, searchable),
    status = coalesce(p_status, status),
    sort = coalesce(p_sort, sort)
  where id = p_id returning * into d;

  if (v_was = 'staff') is distinct from (d.sensitivity = 'staff') then
    perform set_config('app.custom_moving', 'on', true);
    if d.sensitivity = 'staff' then
      -- Members could see it; now staff only: out of the rows.
      perform app.custom_move_to_staff(d.center_id, d.entity, d.key);
    else
      -- Staff only until now; members may see it: back onto the rows.
      for r in select s.record_key, s.custom -> d.key as v from app.custom_staff_values s
                where s.center_id = d.center_id and s.entity = d.entity and s.custom ? d.key loop
        if d.entity = 'household_members' then
          update app.household_members t set custom = t.custom || jsonb_build_object(d.key, r.v)
           where t.household_id::text = split_part(r.record_key, ':', 1) and t.person_id::text = split_part(r.record_key, ':', 2);
        else
          execute format('update app.%I t set custom = t.custom || jsonb_build_object($1, $2) where t.id::text = $3', d.entity)
            using d.key, r.v, r.record_key;
        end if;
      end loop;
      update app.custom_staff_values s set custom = s.custom - d.key, updated_at = now()
       where s.center_id = d.center_id and s.entity = d.entity and s.custom ? d.key;
    end if;
    perform set_config('app.custom_moving', '', true);
  end if;
  return d;
end $$;

-- A member's own details kept by the community that it shows them: fields marked member_self or
-- directory, on their person and their household (0190 showed member_self only). Never staff-only.
create or replace function app.person_custom_fields(p_center uuid, p_person uuid)
returns table (entity text, key text, label text, type text, value jsonb, sort int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not app.can_act_for_person(p_center, p_person) then
    raise exception 'You can only see your own details and your family''s.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select d.entity, d.key, d.label, d.type, p.custom -> d.key, d.sort
      from app.people p join app.custom_field_definitions d
        on d.center_id = p.center_id and d.entity = 'people' and d.status = 'active' and d.sensitivity in ('member_self','directory')
     where p.id = p_person and p.center_id = p_center and p.custom ? d.key
    union all
    select d.entity, d.key, d.label, d.type, h.custom -> d.key, 1000 + d.sort
      from app.household_members hm join app.households h on h.id = hm.household_id
      join app.custom_field_definitions d
        on d.center_id = h.center_id and d.entity = 'households' and d.status = 'active' and d.sensitivity in ('member_self','directory')
     where hm.person_id = p_person and hm.left_at is null and h.center_id = p_center and h.custom ? d.key
    order by 6, 3;
end $$;

-- Segments (0194) filter on searchable fields, staff-only ones included: read both places.
create or replace function app.segment_recipient_count(p_center uuid, p_audience jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_n int; a jsonb := coalesce(p_audience, '{}'::jsonb);
begin
  perform app.assert_module_enabled(p_center, 'comms');
  if not app.has_permission(p_center, 'comms.send') then raise exception 'not allowed to preview recipients'; end if;
  select count(distinct h.id) into v_n
    from app.households h
   where h.center_id = p_center and h.merged_into_id is null
     and (
       (coalesce((a->>'all_members')::boolean, false) and exists (
          select 1 from app.memberships m where m.household_id = h.id and m.status = 'active'))
       or (a ? 'zone_ids' and h.zone_id::text in (select jsonb_array_elements_text(a->'zone_ids')))
       or (a ? 'pathshala_class_ids' and exists (
          select 1 from app.pathshala_enrollments e where e.household_id = h.id and e.status in ('placed','active','waitlisted')
            and e.class_id::text in (select jsonb_array_elements_text(a->'pathshala_class_ids'))))
       or (a ? 'event_id' and exists (
          select 1 from app.rsvps r where r.household_id = h.id and r.event_id = (a->>'event_id')::uuid
            and (not a ? 'rsvp_statuses' or r.status::text in (select jsonb_array_elements_text(a->'rsvp_statuses')))))
       or (a ? 'membership_tiers' and exists (
          select 1 from app.memberships m where m.household_id = h.id and m.status = 'active'
            and m.tier::text in (select jsonb_array_elements_text(a->'membership_tiers'))))
       or (jsonb_typeof(a->'custom_fields') = 'array' and exists (
          select 1 from jsonb_array_elements(a->'custom_fields') f
            join app.custom_field_definitions d on d.center_id = p_center and d.entity = f->>'entity' and d.key = f->>'key'
                                               and d.searchable and d.status = 'active'
           where (d.entity = 'households'
                  and (h.custom || coalesce((select s.custom from app.custom_staff_values s
                                              where s.entity = 'households' and s.record_key = h.id::text), '{}'::jsonb)) -> d.key = f->'value')
              or (d.entity = 'people' and exists (
                    select 1 from app.household_members hm2 join app.people p2 on p2.id = hm2.person_id
                     where hm2.household_id = h.id and hm2.left_at is null and p2.merged_into_id is null
                       and (p2.custom || coalesce((select s.custom from app.custom_staff_values s
                                                    where s.entity = 'people' and s.record_key = p2.id::text), '{}'::jsonb)) -> d.key = f->'value'))))
     )
     and exists (
       select 1 from app.household_members hm join app.people p on p.id = hm.person_id
        where hm.household_id = h.id and hm.left_at is null
          and not p.is_deceased and p.merged_into_id is null
          and coalesce(p.email::text, '') <> ''
          and (p.date_of_birth is null or p.date_of_birth <= current_date - interval '18 years')
          and coalesce((select o.opted_in from app.channel_optins o where o.person_id = p.id and o.channel = 'email'
                         order by o.recorded_at desc limit 1), false)
          and coalesce((select cs.granted from app.consents cs where cs.person_id = p.id and cs.kind = 'marketing_email'
                         order by cs.recorded_at desc limit 1), true));
  return v_n;
end $function$;

revoke execute on function app.custom_staff_values_cleanup(), app.custom_values_check(), app.custom_move_to_staff(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function app.custom_values(text, text[]) from public, anon;
grant execute on function app.custom_entity_read_perms(text), app.custom_record_key(text, jsonb),
  app.custom_values(text, text[]), app.set_custom_value(text, uuid, text, jsonb),
  app.update_custom_field(uuid, text, text, jsonb, text, boolean, text, int), app.person_custom_fields(uuid, uuid) to authenticated;
grant execute on all functions in schema app to service_role;

-- The demo pack (0312) keeps two staff-only fields (senior citizen, legacy account); their values
-- now land in app.custom_staff_values, so the pack's catalog counts them where it counts people.
update app.demo_packs p
   set contents = (select jsonb_agg(case when m->'rows' ? 'custom_field_definitions'
                                         then jsonb_set(m, '{rows,custom_staff_values}', '8'::jsonb) else m end order by i)
                     from jsonb_array_elements(p.contents) with ordinality x(m, i))
 where p.key = 'community' and not exists (select 1 from jsonb_array_elements(p.contents) m where m->'rows' ? 'custom_staff_values');
