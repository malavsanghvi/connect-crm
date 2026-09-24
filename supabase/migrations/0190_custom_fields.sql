-- Onboarding · o-import · 1 of 4: custom fields (ONBOARDING_PLAN "Extra columns become custom fields").
--
--   app.custom_field_definitions   one row per (center, kind of record, key): label, type,
--                                  choices, sensitivity, searchable, source, status, sort
--   <table>.custom jsonb           the values, on every table the import tool can load
--   app.custom_values_check()      BEFORE trigger: every value is checked against its definition
--
-- Nothing here changes an existing policy or permission. Values are written by
-- the normal table write (RLS decides), by app.set_custom_value() (runs as the
-- caller, so RLS still decides) or by the import engine. The audit trail covers
-- them automatically (custom is an ordinary column of an audited table).

-- Any of a list of permissions (platform admins hold all).
create or replace function app.import_has_any(p_center uuid, p_perms text[]) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.is_platform_admin() or exists (select 1 from unnest(p_perms) p where app.has_permission(p_center, p))
$$;

-- The kinds of record that carry custom fields: every table the import tool loads.
create or replace function app.custom_field_entities() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    -- setup data
    'zones','inboxes','bank_accounts','funds','membership_types','store_categories','calendar_layers',
    'pathshala_tracks','pathshala_terms','practices','gyan_goals','campaigns','event_templates',
    'event_template_items','volunteer_groups','pathshala_levels','gyan_levels','gyan_steps','opportunities',
    'labh_options','pickup_windows','pathshala_classes','whatsapp_groups',
    -- records
    'households','people','household_members','external_ids','channel_optins','special_days','memberships',
    'pathshala_enrollments','pathshala_teachers','volunteer_interests','background_checks','store_items',
    -- history
    'pledges','payments','payment_allocations','recurring_gifts','bolis','boli_entries','events','attendees',
    'pathshala_attendance']::text[]
$$;

create table if not exists app.custom_field_definitions (
  id                uuid primary key default gen_random_uuid(),
  center_id         uuid not null references app.centers(id) on delete cascade,
  entity            text not null check (entity = any (app.custom_field_entities())),
  key               text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  label             text not null check (char_length(btrim(label)) between 1 and 120),
  type              text not null check (type in ('text','number','date','boolean','choice','money','email','phone','url')),
  choices           jsonb not null default '[]'::jsonb check (jsonb_typeof(choices) = 'array'),
  sensitivity       text not null default 'staff' check (sensitivity in ('staff','member_self','directory')),
  searchable        boolean not null default false,
  source            text not null default 'manual' check (source in ('manual','import')),
  source_import_run uuid references app.import_runs(id) on delete set null,
  status            text not null default 'active' check (status in ('active','archived')),
  sort              integer not null default 0,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (center_id, entity, key)
);
create index if not exists custom_field_definitions_entity_idx on app.custom_field_definitions (center_id, entity, status, sort);
drop trigger if exists touch_custom_field_definitions on app.custom_field_definitions;
create trigger touch_custom_field_definitions before update on app.custom_field_definitions
  for each row execute function app.touch_updated_at();
drop trigger if exists audit_custom_field_definitions on app.custom_field_definitions;
create trigger audit_custom_field_definitions after insert or update or delete on app.custom_field_definitions
  for each row execute function app.audit_row();
insert into app.module_tables (table_name, module_key) values ('custom_field_definitions', null)
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.custom_field_definitions enable row level security;
-- Staff who can see any kind of record can read the field names (labels only;
-- the values stay behind each table's own policies). Writes go through the RPCs below.
drop policy if exists custom_field_definitions_staff_read on app.custom_field_definitions;
create policy custom_field_definitions_staff_read on app.custom_field_definitions for select to authenticated
  using (app.import_has_any(center_id, array['people.view','people.manage','giving.view','giving.manage','settings.manage',
         'store.view','store.manage','events.view','events.manage','pathshala.view','pathshala.manage','content.manage',
         'volunteers.view','volunteers.manage','comms.send','accounting.manage','bolis.view','bolis.manage']));

-- ── The values ───────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array app.custom_field_entities() loop
    execute format('alter table app.%I add column if not exists custom jsonb not null default ''{}''::jsonb', t);
    if not exists (select 1 from pg_constraint where conrelid = ('app.' || quote_ident(t))::regclass and conname = t || '_custom_object') then
      execute format('alter table app.%I add constraint %I check (jsonb_typeof(custom) = ''object'')', t, t || '_custom_object');
    end if;
  end loop;
end $$;
-- Filtering by a custom field (list columns, segments) on the big record tables.
create index if not exists people_custom_idx on app.people using gin (custom jsonb_path_ops);
create index if not exists households_custom_idx on app.households using gin (custom jsonb_path_ops);
create index if not exists memberships_custom_idx on app.memberships using gin (custom jsonb_path_ops);
create index if not exists pledges_custom_idx on app.pledges using gin (custom jsonb_path_ops);
create index if not exists payments_custom_idx on app.payments using gin (custom jsonb_path_ops);

-- One value against one definition; raises a plain sentence (check_violation).
create or replace function app.custom_value_check(p_type text, p_choices jsonb, p_value jsonb, p_label text) returns void
language plpgsql immutable set search_path = app, public, extensions as $$
declare s text; t text := jsonb_typeof(p_value);
begin
  if t = 'null' then return; end if;
  s := case when t = 'string' then p_value #>> '{}' end;
  if p_type = 'text' then
    if t <> 'string' then raise exception '"%" takes text.', p_label using errcode = 'check_violation'; end if;
    if char_length(s) > 2000 then raise exception '"%" is too long (at most 2,000 characters).', p_label using errcode = 'check_violation'; end if;
  elsif p_type = 'number' then
    if t <> 'number' then raise exception '"%" takes a number.', p_label using errcode = 'check_violation'; end if;
  elsif p_type = 'money' then
    if t <> 'number' or (p_value::text)::numeric <> trunc((p_value::text)::numeric) then
      raise exception '"%" takes an amount in whole cents.', p_label using errcode = 'check_violation';
    end if;
  elsif p_type = 'boolean' then
    if t <> 'boolean' then raise exception '"%" takes yes or no.', p_label using errcode = 'check_violation'; end if;
  elsif p_type = 'date' then
    if t <> 'string' or s !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception '"%" takes a date (YYYY-MM-DD).', p_label using errcode = 'check_violation';
    end if;
    begin
      perform s::date;
    exception when others then
      raise exception '"%" is not a real date: %.', p_label, s using errcode = 'check_violation';
    end;
  elsif p_type = 'choice' then
    if t <> 'string' or not (p_choices ? s) then
      raise exception '"%" must be one of: %.', p_label,
        coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(p_choices) x), 'no choices yet')
        using errcode = 'check_violation';
    end if;
  elsif p_type = 'email' then
    if t <> 'string' or s !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception '"%" takes an email address.', p_label using errcode = 'check_violation';
    end if;
  elsif p_type = 'phone' then
    if t <> 'string' or s !~ '^\+[1-9][0-9]{6,14}$' then
      raise exception '"%" takes a phone number in international format (+1…).', p_label using errcode = 'check_violation';
    end if;
  elsif p_type = 'url' then
    if t <> 'string' or s !~* '^https?://\S+$' then
      raise exception '"%" takes a web address starting with http:// or https://.', p_label using errcode = 'check_violation';
    end if;
  end if;
end $$;

-- BEFORE INSERT/UPDATE: every new or changed key must be an active definition of
-- this center and kind of record, and its value must fit the type. A JSON null
-- removes the key. Values that did not change pass (an archived field keeps
-- its old values).
create or replace function app.custom_values_check() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; k text; v jsonb; d app.custom_field_definitions; v_out jsonb := '{}'::jsonb;
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
  if auth.uid() is not null and not app.import_has_any(v_center, app.custom_entity_write_perms(tg_table_name))
     and new.custom is distinct from (case when tg_op = 'UPDATE' then old.custom else '{}'::jsonb end) then
    raise exception 'Only staff can change these details.' using errcode = 'insufficient_privilege';
  end if;
  for k, v in select * from jsonb_each(new.custom) loop
    if jsonb_typeof(v) = 'null' then continue; end if;      -- null removes the value
    if tg_op = 'UPDATE' and (old.custom -> k) is not distinct from v then
      v_out := v_out || jsonb_build_object(k, v);
      continue;
    end if;
    select * into d from app.custom_field_definitions where center_id = v_center and entity = tg_table_name and key = k;
    if d.id is null then
      raise exception 'There is no custom field "%" for this kind of record. Add it in Settings › Custom fields first.', k
        using errcode = 'check_violation';
    end if;
    if d.status = 'archived' then
      raise exception 'The custom field "%" is archived, so it cannot take new values.', d.label using errcode = 'check_violation';
    end if;
    perform app.custom_value_check(d.type, d.choices, v, d.label);
    v_out := v_out || jsonb_build_object(k, v);
  end loop;
  new.custom := v_out;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array app.custom_field_entities() loop
    execute format('drop trigger if exists custom_values_check on app.%I', t);
    execute format('create trigger custom_values_check before insert or update of custom on app.%I
                    for each row execute function app.custom_values_check()', t);
  end loop;
end $$;

-- ── RPCs ─────────────────────────────────────────────────────────────────────

-- The module a kind of record belongs to (for the module switch) and the
-- permission that writes it (the table's own write policy, 0010).
create or replace function app.custom_entity_write_perms(p_entity text) returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select case p_entity
    when 'zones' then array['settings.manage'] when 'inboxes' then array['settings.manage']
    when 'membership_types' then array['settings.manage']
    when 'bank_accounts' then array['accounting.manage']
    when 'funds' then array['giving.manage'] when 'campaigns' then array['giving.manage']
    when 'opportunities' then array['giving.manage'] when 'labh_options' then array['giving.manage']
    when 'pledges' then array['giving.manage'] when 'payment_allocations' then array['giving.manage']
    when 'recurring_gifts' then array['giving.manage']
    when 'payments' then array['giving.manage','giving.record_offline']
    when 'store_categories' then array['store.manage'] when 'pickup_windows' then array['store.manage']
    when 'store_items' then array['store.manage']
    when 'calendar_layers' then array['content.manage'] when 'practices' then array['content.manage']
    when 'gyan_goals' then array['content.manage'] when 'gyan_levels' then array['content.manage']
    when 'gyan_steps' then array['content.manage']
    when 'pathshala_tracks' then array['pathshala.manage'] when 'pathshala_terms' then array['pathshala.manage']
    when 'pathshala_levels' then array['pathshala.manage'] when 'pathshala_classes' then array['pathshala.manage']
    when 'pathshala_enrollments' then array['pathshala.manage'] when 'pathshala_teachers' then array['pathshala.manage']
    when 'pathshala_attendance' then array['pathshala.manage']
    when 'event_templates' then array['events.manage'] when 'event_template_items' then array['events.manage']
    when 'events' then array['events.manage'] when 'attendees' then array['events.manage']
    when 'volunteer_groups' then array['volunteers.manage'] when 'volunteer_interests' then array['volunteers.manage']
    when 'background_checks' then array['safety.manage']
    when 'whatsapp_groups' then array['comms.send'] when 'channel_optins' then array['comms.send']
    when 'bolis' then array['bolis.manage'] when 'boli_entries' then array['bolis.manage']
    when 'external_ids' then array['people.manage','giving.manage']
    else array['people.manage'] end   -- households, people, household_members, special_days, memberships
$$;

-- Add a custom field. settings.manage, or (for the import tool) whoever may write that kind of record.
create or replace function app.define_custom_field(
  p_center uuid, p_entity text, p_label text, p_type text, p_choices jsonb default '[]'::jsonb,
  p_sensitivity text default 'staff', p_searchable boolean default false, p_key text default null,
  p_source text default 'manual', p_import_run uuid default null)
returns app.custom_field_definitions
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_key text; v_row app.custom_field_definitions; v_n int := 1; v_base text;
begin
  if p_entity is null or not (p_entity = any (app.custom_field_entities())) then
    raise exception 'Custom fields cannot be added to "%".', coalesce(p_entity, '(none)');
  end if;
  if not (app.has_permission(p_center, 'settings.manage') or app.import_has_any(p_center, app.custom_entity_write_perms(p_entity))) then
    raise exception 'Adding a custom field needs settings.manage or permission to manage this kind of record.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_label), '') = '' then raise exception 'Give the custom field a name.'; end if;
  v_base := coalesce(nullif(p_key, ''), left(trim(both '_' from regexp_replace(lower(btrim(p_label)), '[^a-z0-9]+', '_', 'g')), 50));
  if v_base = '' or v_base !~ '^[a-z]' then v_base := 'field_' || v_base; end if;
  v_key := v_base;
  if p_key is null then
    -- A label that turns into an existing key gets a numbered one ("senior_status_2").
    while exists (select 1 from app.custom_field_definitions where center_id = p_center and entity = p_entity and key = v_key) loop
      v_n := v_n + 1; v_key := v_base || '_' || v_n;
    end loop;
  end if;
  insert into app.custom_field_definitions (center_id, entity, key, label, type, choices, sensitivity, searchable, source,
                                            source_import_run, created_by, sort)
  values (p_center, p_entity, v_key, btrim(p_label), p_type, coalesce(p_choices, '[]'::jsonb), coalesce(p_sensitivity, 'staff'),
          coalesce(p_searchable, false), coalesce(p_source, 'manual'), p_import_run, auth.uid(),
          coalesce((select max(sort) + 1 from app.custom_field_definitions where center_id = p_center and entity = p_entity), 0))
  returning * into v_row;
  return v_row;
end $$;

-- Change a definition. The type changes only while no record has a value.
create or replace function app.update_custom_field(
  p_id uuid, p_label text default null, p_type text default null, p_choices jsonb default null,
  p_sensitivity text default null, p_searchable boolean default null, p_status text default null, p_sort int default null)
returns app.custom_field_definitions
language plpgsql security definer set search_path = app, public, extensions as $$
declare d app.custom_field_definitions; v_used boolean;
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
    if v_used then
      raise exception 'The type of "%" cannot change because records already have values. Add a new field instead.', d.label;
    end if;
  end if;
  update app.custom_field_definitions set
    label = coalesce(nullif(btrim(p_label), ''), label),
    type = coalesce(p_type, type),
    choices = coalesce(p_choices, choices),
    sensitivity = coalesce(p_sensitivity, sensitivity),
    searchable = coalesce(p_searchable, searchable),
    status = coalesce(p_status, status),
    sort = coalesce(p_sort, sort)
  where id = p_id returning * into d;
  return d;
end $$;

-- Set (or, with null, clear) one value in place. Runs as the caller: the
-- table's own RLS and module switch decide, and the audit log records it.
create or replace function app.set_custom_value(p_entity text, p_record uuid, p_key text, p_value jsonb)
returns jsonb
language plpgsql security invoker set search_path = app, public, extensions as $$
declare v jsonb;
begin
  if p_entity is null or not (p_entity = any (app.custom_field_entities())) or p_entity = 'household_members' then
    raise exception 'Custom fields cannot be set on "%".', coalesce(p_entity, '(none)');
  end if;
  if coalesce(p_key, '') !~ '^[a-z][a-z0-9_]{0,62}$' then raise exception 'That is not a custom field key.'; end if;
  execute format('update app.%I set custom = case when $2 is null or jsonb_typeof($2) = ''null'' then custom - $1
                                                   else custom || jsonb_build_object($1, $2) end
                   where id = $3 returning custom', p_entity)
    into v using p_key, p_value, p_record;
  if v is null then raise exception 'That record was not found, or you don''t have permission to change it.' using errcode = 'insufficient_privilege'; end if;
  return v;
end $$;

-- A member's own "member_self" fields (and their household's), for their profile
-- in the member app. Read-only; never a staff-only field.
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
        on d.center_id = p.center_id and d.entity = 'people' and d.status = 'active' and d.sensitivity = 'member_self'
     where p.id = p_person and p.center_id = p_center and p.custom ? d.key
    union all
    select d.entity, d.key, d.label, d.type, h.custom -> d.key, 1000 + d.sort
      from app.household_members hm join app.households h on h.id = hm.household_id
      join app.custom_field_definitions d
        on d.center_id = h.center_id and d.entity = 'households' and d.status = 'active' and d.sensitivity = 'member_self'
     where hm.person_id = p_person and hm.left_at is null and h.center_id = p_center and h.custom ? d.key
    order by 6, 3;
end $$;

revoke execute on function app.custom_values_check(), app.custom_value_check(text, jsonb, jsonb, text) from public, anon;
grant execute on function app.import_has_any(uuid, text[]), app.custom_field_entities(), app.custom_entity_write_perms(text),
  app.define_custom_field(uuid, text, text, text, jsonb, text, boolean, text, text, uuid),
  app.update_custom_field(uuid, text, text, jsonb, text, boolean, text, int),
  app.set_custom_value(text, uuid, text, jsonb), app.person_custom_fields(uuid, uuid) to authenticated;
grant execute on all functions in schema app to service_role;
