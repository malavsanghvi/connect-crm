-- Onboarding · o-import · 3 of 4: the import engine (ONBOARDING_PLAN Steps 3–5, G16).
--
-- One engine for every uploaded data type (Appendix A), run as numbered,
-- traceable, reversible runs:
--
--   app.import_runs      (exists, 0009) grows: run number, request id, file name and
--                        fingerprint, counts, reconciliation + sign-off, undo, delta link
--   app.import_entities  the allow-list: data type → table, write permission, module,
--                        the columns an import may write, the natural key
--   app.import_rows      staged rows: the original cells, the transformed values,
--                        problems, the preview action, the outcome
--   app.import_changes   every row the engine inserted or updated (undo walks it backwards)
--   app.import_keys      source key → record, so re-running a file (or a top-up
--                        file) updates instead of duplicating
--   app.import_mappings  saved column mappings per source ("Neon export")
--
-- Every write of a run carries app.set_audit_context('Import #<n> · <file>', <run request id>)
-- and client_app 'import'. Matching is on identifiers first, then email or mobile —
-- never on a name alone: a name-only look-alike becomes a merge_candidates row.
--
-- All entry points are SECURITY DEFINER RPCs that check the data type's own
-- write permission (the table's 0010 policy) and module switch first, so an
-- import can never write what the person could not write by hand. No existing
-- policy, permission or money rule changes; import_runs keeps its policies.

-- ── Audit: 'import' is a client app ────────────────────────────────────────
create or replace function app.audit_clean_app(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case when lower(btrim(p)) in ('portal','member','kiosk','job','import') then lower(btrim(p)) end
$$;

-- ── Runs ────────────────────────────────────────────────────────────────────
alter table app.import_runs add column if not exists run_number integer;
alter table app.import_runs add column if not exists request_id uuid not null default gen_random_uuid();
alter table app.import_runs add column if not exists file_name text;
alter table app.import_runs add column if not exists file_fingerprint text;
alter table app.import_runs add column if not exists file_size bigint;
alter table app.import_runs add column if not exists tier text;
alter table app.import_runs add column if not exists counts jsonb not null default '{}'::jsonb;
alter table app.import_runs add column if not exists reconciliation jsonb;
alter table app.import_runs add column if not exists signed_off_by uuid references auth.users(id);
alter table app.import_runs add column if not exists signed_off_at timestamptz;
alter table app.import_runs add column if not exists sign_off_note text;
alter table app.import_runs add column if not exists committed_at timestamptz;
alter table app.import_runs add column if not exists undone_by uuid references auth.users(id);
alter table app.import_runs add column if not exists undone_at timestamptz;
alter table app.import_runs add column if not exists undo_reason text;
alter table app.import_runs add column if not exists previous_run_id uuid references app.import_runs(id) on delete set null;
alter table app.import_runs add column if not exists options jsonb not null default '{}'::jsonb;
alter table app.import_runs add column if not exists ai_job_id bigint;
alter table app.import_runs add column if not exists created_at timestamptz not null default now();
alter table app.import_runs add column if not exists raw_purged_at timestamptz;

alter table app.import_runs drop constraint if exists import_runs_status_check;
alter table app.import_runs add constraint import_runs_status_check check (status in (
  'pending','staged','previewed','committing','committed','reconciled','undone','cancelled',
  'running','completed','failed','rolled_back'));   -- the last four are 0009's, kept for old rows

create unique index if not exists import_runs_number_idx on app.import_runs (center_id, run_number);
create index if not exists import_runs_center_idx on app.import_runs (center_id, created_at desc);

create or replace function app.import_runs_number() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.run_number is null then
    perform pg_advisory_xact_lock(hashtextextended('app.import_runs:' || new.center_id::text, 0));
    new.run_number := coalesce((select max(run_number) from app.import_runs where center_id = new.center_id), 0) + 1;
  end if;
  return new;
end $$;
drop trigger if exists import_runs_number on app.import_runs;
create trigger import_runs_number before insert on app.import_runs for each row execute function app.import_runs_number();

-- ── The allow-list of data types ─────────────────────────────────────────────
create table if not exists app.import_entities (
  key          text primary key,
  label        text not null,
  tier         text not null check (tier in ('setup','records','history')),
  sort         integer not null,
  target_table text not null,
  write_perms  text[] not null,
  module_key   text references app.modules(key),
  columns      text[] not null,                  -- columns an import may write
  extras       text[] not null default '{}',     -- side values the engine applies
  natural_key  text[] not null default '{}',     -- columns that identify an existing row
  money_columns text[] not null default '{}',
  has_center   boolean not null default true
);
alter table app.import_entities enable row level security;
drop policy if exists import_entities_read on app.import_entities;
create policy import_entities_read on app.import_entities for select to authenticated using (true);
drop trigger if exists audit_import_entities on app.import_entities;
create trigger audit_import_entities after insert or update or delete on app.import_entities
  for each row execute function app.audit_row('key');

-- ── Staged rows, changes, keys, saved mappings ───────────────────────────────
create table if not exists app.import_rows (
  id          bigint generated always as identity primary key,
  center_id   uuid not null references app.centers(id) on delete cascade,
  run_id      uuid not null references app.import_runs(id) on delete cascade,
  row_no      integer not null,
  source_key  text not null,
  raw         jsonb,                               -- the original cells (purged after 90 days)
  data        jsonb not null default '{}'::jsonb,  -- column → value ({"$ref": …} for links)
  extra       jsonb not null default '{}'::jsonb,
  custom      jsonb not null default '{}'::jsonb,
  problems    jsonb not null default '[]'::jsonb,
  action      text check (action in ('create','update','skip','needs_decision','error')),
  decision    text check (decision in ('create','skip')),
  match       jsonb,
  status      text not null default 'staged' check (status in ('staged','created','updated','unchanged','skipped','failed','undone')),
  target_id   text,
  message     text,
  unique (run_id, row_no)
);
create index if not exists import_rows_run_status_idx on app.import_rows (run_id, status, row_no);

create table if not exists app.import_changes (
  id          bigint generated always as identity primary key,
  center_id   uuid not null references app.centers(id) on delete cascade,
  run_id      uuid not null references app.import_runs(id) on delete cascade,
  row_no      integer,
  table_name  text not null,
  record_id   text not null,
  op          text not null check (op in ('insert','update')),
  before      jsonb,        -- the changed columns before (for masked audit fields)
  after       jsonb,        -- what the import wrote (to spot later edits at undo time)
  undone_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists import_changes_run_idx on app.import_changes (run_id, id desc);

create table if not exists app.import_keys (
  center_id  uuid not null references app.centers(id) on delete cascade,
  entity     text not null,
  source_key text not null,
  table_name text not null,
  record_id  text not null,
  run_id     uuid references app.import_runs(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (center_id, entity, source_key)
);

create table if not exists app.import_mappings (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  source      text not null check (char_length(btrim(source)) between 1 and 80),
  entity      text not null references app.import_entities(key),
  mapping     jsonb not null default '{}'::jsonb,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  unique (center_id, source, entity)
);

do $$
declare t text;
begin
  foreach t in array array['import_rows','import_changes','import_mappings'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('drop trigger if exists audit_%1$s on app.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on app.%1$I for each row execute function app.audit_row()', t);
  end loop;
end $$;
alter table app.import_keys enable row level security;
drop trigger if exists audit_import_keys on app.import_keys;
create trigger audit_import_keys after insert or update or delete on app.import_keys
  for each row execute function app.audit_row('entity', 'source_key');

insert into app.module_tables (table_name, module_key) values
  ('import_entities', null), ('import_rows', null), ('import_changes', null), ('import_keys', null), ('import_mappings', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- Who may use a run: whoever may write its data type (platform admins always).
create or replace function app.import_run_allowed(p_run uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.import_runs r join app.import_entities e on e.key = r.entity
                  where r.id = p_run and app.import_has_any(r.center_id, e.write_perms))
$$;

-- Read-only policies: the engine writes through the RPCs below.
drop policy if exists import_rows_read on app.import_rows;
create policy import_rows_read on app.import_rows for select to authenticated using (app.import_run_allowed(run_id));
drop policy if exists import_changes_read on app.import_changes;
create policy import_changes_read on app.import_changes for select to authenticated using (app.import_run_allowed(run_id));
drop policy if exists import_keys_read on app.import_keys;
create policy import_keys_read on app.import_keys for select to authenticated
  using (exists (select 1 from app.import_entities e where e.key = entity and app.import_has_any(center_id, e.write_perms)));
drop policy if exists import_mappings_read on app.import_mappings;
create policy import_mappings_read on app.import_mappings for select to authenticated
  using (exists (select 1 from app.import_entities e where e.key = entity and app.import_has_any(center_id, e.write_perms)));

-- ── Guards ──────────────────────────────────────────────────────────────────

-- The run, checked: it exists, the caller may write its data type, and the
-- data type's module is on. Raises a plain sentence otherwise.
create or replace function app.import_assert_run(p_run uuid) returns app.import_runs
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare r app.import_runs; e app.import_entities;
begin
  select * into r from app.import_runs where id = p_run;
  if r.id is null then raise exception 'That import was not found.'; end if;
  select * into e from app.import_entities where key = r.entity;
  if e.key is null then raise exception 'Import #% is for "%", which the import tool does not load.', r.run_number, r.entity; end if;
  if not app.import_has_any(r.center_id, e.write_perms) then
    raise exception 'Importing % needs one of these permissions: %.', lower(e.label), array_to_string(e.write_perms, ', ')
      using errcode = 'insufficient_privilege';
  end if;
  if e.module_key is not null then perform app.assert_module_enabled(r.center_id, e.module_key); end if;
  return r;
end $$;

-- Step-up (o-security's app.assert_step_up) when it exists in this database.
create or replace function app.import_step_up(p_action text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if to_regprocedure('app.assert_step_up(text)') is not null then
    execute 'select app.assert_step_up($1)' using p_action;
  end if;
end $$;

-- Every write of a run carries its reason, request id and client app.
create or replace function app.import_audit(r app.import_runs, p_prefix text default 'Import') returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.set_audit_context(format('%s #%s · %s', p_prefix, r.run_number, coalesce(r.file_name, r.entity)), r.request_id);
  perform set_config('app.client_app', 'import', true);
end $$;

-- ── Links ({"$ref": …}) ─────────────────────────────────────────────────────

-- One record, or null when none; raises when the value fits more than one.
create or replace function app.import_ref(p_center uuid, p_ref jsonb, p_crm_system text default null) returns uuid
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare k text := p_ref->>'$ref'; v text := btrim(p_ref->>'value'); ids uuid[]; t text; b text;
        v_goal text; v_level text;
begin
  if coalesce(v, '') = '' then return null; end if;
  if k = 'household' then
    select array_agg(distinct x) into ids from (
      select e.household_id x from app.external_ids e
       where e.center_id = p_center and e.kind = 'org_household' and e.valid_to is null
         and e.normalized = app.canonical_org_id(p_center, 'org_household', v)
      union select e.household_id from app.external_ids e
       where e.center_id = p_center and e.kind = 'crm' and e.person_id is null and e.valid_to is null
         and (p_crm_system is null or e.system = p_crm_system) and e.normalized = app.normalize_identifier(v)
      union select record_id::uuid from app.import_keys where center_id = p_center and entity = 'households' and source_key = v
      union select h.id from app.households h where h.center_id = p_center and h.household_number = v) s
     where x is not null and exists (select 1 from app.households h where h.id = x and h.merged_into_id is null);
  elsif k = 'person' then
    select array_agg(distinct x) into ids from (
      select e.person_id x from app.external_ids e
       where e.center_id = p_center and e.kind = 'org_member' and e.valid_to is null
         and e.normalized = app.canonical_org_id(p_center, 'org_member', v)
      union select e.person_id from app.external_ids e
       where e.center_id = p_center and e.kind = 'crm' and e.person_id is not null and e.valid_to is null
         and (p_crm_system is null or e.system = p_crm_system) and e.normalized = app.normalize_identifier(v)
      union select record_id::uuid from app.import_keys where center_id = p_center and entity = 'people' and source_key = v
      union select p.id from app.people p where p.center_id = p_center and p.member_number = v
      union select p.id from app.people p where p.center_id = p_center and v like '%@%' and lower(p.email::text) = lower(v)) s
     where x is not null and exists (select 1 from app.people p where p.id = x and p.merged_into_id is null);
  elsif k = 'pledge' then
    select array_agg(distinct x) into ids from (
      select id x from app.pledges where center_id = p_center and (crm_external_id = v or pledge_number = v)
      union select record_id::uuid from app.import_keys where center_id = p_center and entity = 'pledges' and source_key = v) s;
  elsif k = 'payment' then
    select array_agg(distinct x) into ids from (
      select id x from app.payments where center_id = p_center and crm_external_id = v
      union select record_id::uuid from app.import_keys where center_id = p_center and entity = 'payments' and source_key = v) s;
  elsif k = 'event' then
    select array_agg(distinct x) into ids from (
      select id x from app.events where center_id = p_center and event_number = v
      union select record_id::uuid from app.import_keys where center_id = p_center and entity = 'events' and source_key = v) s;
  elsif k = 'gyan_level' then
    v_goal := btrim(split_part(v, '/', 1)); v_level := btrim(split_part(v, '/', 2));
    select array_agg(l.id) into ids from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id
     where g.center_id = p_center and lower(g.key) = lower(v_goal) and lower(l.key) = lower(v_level);
  elsif k = 'pathshala_level' then
    v_goal := btrim(split_part(v, '/', 1)); v_level := btrim(split_part(v, '/', 2));
    select array_agg(l.id) into ids from app.pathshala_levels l join app.pathshala_tracks t on t.id = l.track_id
     where l.center_id = p_center and lower(t.key) = lower(v_goal) and lower(l.key) = lower(v_level);
  elsif k = 'lookup' then
    t := p_ref->>'table'; b := p_ref->>'by';
    -- Only these tables and columns can be looked up (never a person or a household by name).
    if (t, b) not in (('funds','key'), ('campaigns','name'), ('membership_types','key_or_name'), ('zones','name'),
                      ('store_categories','name'), ('pathshala_tracks','key'), ('pathshala_terms','name'),
                      ('pathshala_classes','name'), ('gyan_goals','key'), ('event_templates','name'),
                      ('volunteer_groups','name'), ('bolis','name')) then
      raise exception 'A link to % by % is not allowed.', coalesce(t, '?'), coalesce(b, '?');
    end if;
    if b = 'key_or_name' then
      execute format('select array_agg(id) from app.%I where center_id = $1 and lower(key) = lower($2)', t) into ids using p_center, v;
      if ids is null then
        execute format('select array_agg(id) from app.%I where center_id = $1 and lower(name) = lower($2)', t) into ids using p_center, v;
      end if;
    else
      execute format('select array_agg(id) from app.%I where center_id = $1 and lower(%I::text) = lower($2)', t, b) into ids using p_center, v;
    end if;
  else
    raise exception 'Unknown link kind "%".', coalesce(k, '(none)');
  end if;
  if ids is null or array_length(ids, 1) is null then return null; end if;
  if array_length(ids, 1) > 1 then
    raise exception '"%" matches more than one %; use an ID that points at exactly one.', v,
      case k when 'household' then 'household' when 'person' then 'person' when 'lookup' then replace(t, '_', ' ') else k end;
  end if;
  return ids[1];
end $$;

-- Plain words for a link that was not found.
create or replace function app.import_ref_missing(p_ref jsonb) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p_ref->>'$ref'
    when 'household' then format('No household has the ID "%s" — import households first, or check the ID.', p_ref->>'value')
    when 'person' then format('No person has the ID "%s" — import people first, or check the ID.', p_ref->>'value')
    when 'pledge' then format('No pledge has the number "%s" — import pledges first, or check the number.', p_ref->>'value')
    when 'payment' then format('No payment has the number "%s" — import payments first, or check the number.', p_ref->>'value')
    when 'event' then format('No event has the ID "%s" — import events first.', p_ref->>'value')
    when 'gyan_level' then format('No Gyan Path level "%s" (goal key/level key) — import levels first.', p_ref->>'value')
    when 'pathshala_level' then format('No Pathshala level "%s" (track key/level key) — import levels first.', p_ref->>'value')
    else format('No %s called "%s" — import it first, or check the spelling.', replace(coalesce(p_ref->>'table', 'record'), '_', ' '), p_ref->>'value')
  end
$$;

-- Replace every {"$ref": …} in an object with the record id; raises for one not found.
create or replace function app.import_resolve(p_center uuid, p_obj jsonb, p_crm_system text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare k text; v jsonb; out jsonb := '{}'::jsonb; id uuid;
begin
  for k, v in select * from jsonb_each(coalesce(p_obj, '{}'::jsonb)) loop
    if jsonb_typeof(v) = 'object' and v ? '$ref' then
      id := app.import_ref(p_center, v, p_crm_system);
      if id is null then raise exception '%', app.import_ref_missing(v) using errcode = 'P0002'; end if;
      out := out || jsonb_build_object(k, id);
    else
      out := out || jsonb_build_object(k, v);
    end if;
  end loop;
  return out;
end $$;

-- ── Generic writes ──────────────────────────────────────────────────────────

-- The values as the table would store them (dates, times and enums normalised).
create or replace function app.import_canonical(p_table text, p_data jsonb) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb;
begin
  execute format('select to_jsonb(jsonb_populate_record(null::app.%I, $1))', p_table) into v using p_data;
  return (select coalesce(jsonb_object_agg(k, v -> k), '{}'::jsonb) from jsonb_object_keys(p_data) k);
end $$;

create or replace function app.import_insert(p_table text, p_data jsonb) returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_cols text; v_id text;
begin
  select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(p_data) k;
  if p_table = 'household_members' then
    execute format('insert into app.household_members (%s) select %s from jsonb_populate_record(null::app.household_members, $1)
                    returning household_id::text || '':'' || person_id::text', v_cols, v_cols) into v_id using p_data;
  else
    execute format('insert into app.%I (%s) select %s from jsonb_populate_record(null::app.%I, $1) returning id::text',
                   p_table, v_cols, v_cols, p_table) into v_id using p_data;
  end if;
  return v_id;
end $$;

create or replace function app.import_current(p_table text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb;
begin
  if p_table = 'household_members' then
    select to_jsonb(hm) into v from app.household_members hm
     where household_id::text = split_part(p_id, ':', 1) and person_id::text = split_part(p_id, ':', 2);
  else
    execute format('select to_jsonb(t) from app.%I t where t.id::text = $1', p_table) into v using p_id;
  end if;
  return v;
end $$;

create or replace function app.import_set(p_table text, p_id text, p_changes jsonb) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_cols text;
begin
  if p_changes = '{}'::jsonb then return; end if;
  select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(p_changes) k;
  if p_table = 'household_members' then
    execute format('update app.household_members t set (%s) = (select %s from jsonb_populate_record(null::app.household_members, $1))
                     where t.household_id::text = split_part($2, '':'', 1) and t.person_id::text = split_part($2, '':'', 2)',
                   v_cols, v_cols) using p_changes, p_id;
  else
    execute format('update app.%I t set (%s) = (select %s from jsonb_populate_record(null::app.%I, $1)) where t.id::text = $2',
                   p_table, v_cols, v_cols, p_table) using p_changes, p_id;
  end if;
end $$;

create or replace function app.import_delete(p_table text, p_id text) returns boolean
language plpgsql security definer set search_path = app, public, extensions as $$
declare n int;
begin
  if p_table = 'household_members' then
    delete from app.household_members where household_id::text = split_part(p_id, ':', 1) and person_id::text = split_part(p_id, ':', 2);
  else
    execute format('delete from app.%I where id::text = $1', p_table) using p_id;
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function app.import_log(r app.import_runs, p_row int, p_table text, p_id text, p_op text,
                                          p_before jsonb default null, p_after jsonb default null) returns void
language sql security definer set search_path = app, public, extensions as $$
  insert into app.import_changes (center_id, run_id, row_no, table_name, record_id, op, before, after)
  values (r.center_id, r.id, p_row, p_table, p_id, p_op, p_before, p_after)
$$;

-- Insert a row the engine owns, and log it for undo.
create or replace function app.import_add(r app.import_runs, p_row int, p_table text, p_data jsonb) returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id text;
begin
  v_id := app.import_insert(p_table, p_data);
  perform app.import_log(r, p_row, p_table, v_id, 'insert', null, app.import_canonical(p_table, p_data));
  return v_id;
end $$;

-- Update only the columns whose value differs; log before/after. Returns the changed keys.
create or replace function app.import_patch(r app.import_runs, p_row int, p_table text, p_id text, p_data jsonb, p_custom jsonb default '{}'::jsonb)
returns text[]
language plpgsql security definer set search_path = app, public, extensions as $$
declare cur jsonb; want jsonb; k text; changes jsonb := '{}'::jsonb; before jsonb := '{}'::jsonb; v_custom jsonb;
begin
  cur := app.import_current(p_table, p_id);
  if cur is null then raise exception 'The matched record is gone (merged or deleted since the preview).'; end if;
  want := app.import_canonical(p_table, p_data);
  for k in select jsonb_object_keys(want) loop
    if jsonb_typeof(want -> k) = 'null' then continue; end if;       -- a blank cell never clears a value
    if (cur -> k) is distinct from (want -> k) then
      changes := changes || jsonb_build_object(k, want -> k);
      before := before || jsonb_build_object(k, cur -> k);
    end if;
  end loop;
  if p_custom is not null and p_custom <> '{}'::jsonb and cur ? 'custom' then
    v_custom := coalesce(cur -> 'custom', '{}'::jsonb) || p_custom;
    if v_custom is distinct from cur -> 'custom' then
      changes := changes || jsonb_build_object('custom', v_custom);
      before := before || jsonb_build_object('custom', cur -> 'custom');
    end if;
  end if;
  if changes = '{}'::jsonb then return '{}'::text[]; end if;
  perform app.import_set(p_table, p_id, changes);
  perform app.import_log(r, p_row, p_table, p_id, 'update', before, changes);
  return (select array_agg(x) from jsonb_object_keys(changes) x);
end $$;

-- ── Matching ────────────────────────────────────────────────────────────────

-- How a staged row meets the database. Identifiers first, then email or mobile;
-- a name alone is never a match (it can only be a look-alike for merge review).
-- Returns {id, by} for a match, {ambiguous: [ids], by} when an identifier or an
-- email fits several records, {lookalikes: [ids]} for name-only look-alikes, or {}.
create or replace function app.import_find(r app.import_runs, e app.import_entities, p_source_key text, p_data jsonb, p_extra jsonb)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c uuid := r.center_id; v_id text; ids uuid[]; v text; q text; k text; canon jsonb; v_crm text := r.options->>'crm_system';
begin
  -- 1. The same source key imported before (a re-run, or a top-up file).
  select record_id into v_id from app.import_keys where center_id = c and entity = e.key and source_key = p_source_key;
  if v_id is not null and app.import_current(e.target_table, v_id) is not null then
    return jsonb_build_object('id', v_id, 'by', 'source_key');
  end if;

  if e.key = 'people' then
    v := p_extra->>'legacy_id';
    if v is not null then
      select array_agg(distinct person_id) into ids from app.external_ids x join app.people p on p.id = x.person_id and p.merged_into_id is null
       where x.center_id = c and x.kind = 'org_member' and x.valid_to is null and x.normalized = app.canonical_org_id(c, 'org_member', v);
      if array_length(ids, 1) = 1 then return jsonb_build_object('id', ids[1], 'by', 'person_id'); end if;
    end if;
    v := p_extra->>'crm_id';
    if v is not null and v_crm is not null then
      select array_agg(distinct person_id) into ids from app.external_ids x join app.people p on p.id = x.person_id and p.merged_into_id is null
       where x.center_id = c and x.kind = 'crm' and x.system = v_crm and x.valid_to is null and x.normalized = app.normalize_identifier(v);
      if array_length(ids, 1) = 1 then return jsonb_build_object('id', ids[1], 'by', 'crm_id'); end if;
    end if;
    v := lower(p_data->>'email');
    if v is not null then
      select array_agg(distinct id) into ids from (
        select p.id from app.people p where p.center_id = c and p.merged_into_id is null and lower(p.email::text) = v
        union select pe.person_id from app.person_emails pe join app.people p on p.id = pe.person_id and p.merged_into_id is null
         where pe.center_id = c and lower(pe.email::text) = v) s;
      if array_length(ids, 1) = 1 then return jsonb_build_object('id', ids[1], 'by', 'email'); end if;
      if array_length(ids, 1) > 1 then return jsonb_build_object('ambiguous', to_jsonb(ids), 'by', 'email'); end if;
    end if;
    v := p_data->>'phone_e164';
    if v is not null then
      select array_agg(id) into ids from app.people where center_id = c and merged_into_id is null and phone_e164 = v;
      if array_length(ids, 1) = 1 then return jsonb_build_object('id', ids[1], 'by', 'mobile'); end if;
      if array_length(ids, 1) > 1 then return jsonb_build_object('ambiguous', to_jsonb(ids), 'by', 'mobile'); end if;
    end if;
    select array_agg(id) into ids from app.people
     where center_id = c and merged_into_id is null
       and lower(btrim(first_name)) = lower(btrim(p_data->>'first_name')) and lower(btrim(last_name)) = lower(btrim(p_data->>'last_name'));
    if ids is not null then return jsonb_build_object('lookalikes', to_jsonb(ids)); end if;
    return '{}'::jsonb;
  elsif e.key = 'households' then
    v := p_extra->>'legacy_id';
    if v is not null then
      select array_agg(distinct household_id) into ids from app.external_ids x join app.households h on h.id = x.household_id and h.merged_into_id is null
       where x.center_id = c and x.kind = 'org_household' and x.valid_to is null and x.normalized = app.canonical_org_id(c, 'org_household', v);
      if array_length(ids, 1) = 1 then return jsonb_build_object('id', ids[1], 'by', 'household_id'); end if;
    end if;
    v := p_extra->>'crm_id';
    if v is not null and v_crm is not null then
      select array_agg(distinct household_id) into ids from app.external_ids x join app.households h on h.id = x.household_id and h.merged_into_id is null
       where x.center_id = c and x.kind = 'crm' and x.person_id is null and x.system = v_crm and x.valid_to is null
         and x.normalized = app.normalize_identifier(v);
      if array_length(ids, 1) = 1 then return jsonb_build_object('id', ids[1], 'by', 'crm_id'); end if;
    end if;
    v := p_data->>'household_number';
    if v is not null then
      select id into v_id from app.households where center_id = c and household_number = v;
      if v_id is not null then return jsonb_build_object('id', v_id, 'by', 'household_number'); end if;
    end if;
    select array_agg(id) into ids from app.households
     where center_id = c and merged_into_id is null and lower(btrim(display_name)) = lower(btrim(p_data->>'display_name'));
    if ids is not null then return jsonb_build_object('lookalikes', to_jsonb(ids)); end if;
    return '{}'::jsonb;
  elsif e.key = 'memberships' then
    if p_data ? 'crm_external_id' then
      select id into v_id from app.memberships where center_id = c and crm_external_id = p_data->>'crm_external_id';
      if v_id is not null then return jsonb_build_object('id', v_id, 'by', 'membership_id'); end if;
    end if;
    select id into v_id from app.memberships where center_id = c and household_id = (p_data->>'household_id')::uuid
       and membership_type_id = (p_data->>'membership_type_id')::uuid and starts_on = (p_data->>'starts_on')::date
       and person_id is not distinct from (p_data->>'person_id')::uuid;
    if v_id is not null then return jsonb_build_object('id', v_id, 'by', 'household_type_start'); end if;
    return '{}'::jsonb;
  elsif e.key = 'pledges' then
    select id into v_id from app.pledges where center_id = c and crm_external_id = p_data->>'crm_external_id';
    if v_id is null and p_data ? 'pledge_number' then
      select id into v_id from app.pledges where center_id = c and pledge_number = p_data->>'pledge_number';
    end if;
    return case when v_id is null then '{}'::jsonb else jsonb_build_object('id', v_id, 'by', 'pledge_number') end;
  elsif e.key = 'payments' then
    select id into v_id from app.payments where center_id = c and crm_external_id = p_data->>'crm_external_id';
    return case when v_id is null then '{}'::jsonb else jsonb_build_object('id', v_id, 'by', 'payment_number') end;
  elsif e.key = 'external_ids' then
    select id into v_id from app.external_ids x
     where x.center_id = c and x.kind::text = p_data->>'kind' and x.system = p_data->>'system' and x.valid_to is null
       and x.normalized = case when p_data->>'kind' in ('org_member','org_household')
                               then app.canonical_org_id(c, p_data->>'kind', p_data->>'value')
                               else app.normalize_identifier(p_data->>'value') end
       and (x.kind <> 'bank_payer' or x.household_id is not distinct from (p_data->>'household_id')::uuid);
    return case when v_id is null then '{}'::jsonb else jsonb_build_object('id', v_id, 'by', 'identifier') end;
  elsif e.key = 'household_members' then
    if exists (select 1 from app.household_members where household_id = (p_data->>'household_id')::uuid and person_id = (p_data->>'person_id')::uuid) then
      return jsonb_build_object('id', (p_data->>'household_id') || ':' || (p_data->>'person_id'), 'by', 'person_household');
    end if;
    return '{}'::jsonb;
  elsif e.key = 'attendees' then
    select id into v_id from app.attendees where center_id = c and event_id = (p_data->>'event_id')::uuid and person_id = (p_data->>'person_id')::uuid;
    return case when v_id is null then '{}'::jsonb else jsonb_build_object('id', v_id, 'by', 'event_person') end;
  elsif e.key = 'pathshala_attendance' then
    select a.id into v_id from app.pathshala_attendance a
      join app.pathshala_sessions s on s.id = a.session_id
      join app.pathshala_enrollments en on en.id = a.enrollment_id
     where s.class_id = (p_extra->>'class_id')::uuid and s.held_on = (p_extra->>'held_on')::date
       and en.student_person_id = (p_extra->>'student_person_id')::uuid;
    return case when v_id is null then '{}'::jsonb else jsonb_build_object('id', v_id, 'by', 'class_date_child') end;
  end if;

  -- Setup data and the rest: the natural key.
  if array_length(e.natural_key, 1) > 0 then
    canon := app.import_canonical(e.target_table, p_data);
    q := format('select array_agg(t.id) from app.%I t where true', e.target_table);
    if e.has_center then q := q || ' and t.center_id = $1'; end if;
    foreach k in array e.natural_key loop
      if not canon ? k or jsonb_typeof(canon -> k) = 'null' then return '{}'::jsonb; end if;
      q := q || format(' and lower(to_jsonb(t) ->> %L) = lower($2 ->> %L)', k, k);
    end loop;
    execute q into ids using c, canon;
    if array_length(ids, 1) = 1 then return jsonb_build_object('id', ids[1], 'by', array_to_string(e.natural_key, '+')); end if;
    if array_length(ids, 1) > 1 then return jsonb_build_object('ambiguous', to_jsonb(ids), 'by', array_to_string(e.natural_key, '+')); end if;
  end if;
  return '{}'::jsonb;
end $$;

-- The columns whose values would change (canonical form); custom merges.
create or replace function app.import_diff(p_table text, p_id text, p_data jsonb, p_custom jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare cur jsonb; want jsonb; k text; out jsonb := '{}'::jsonb; v_custom jsonb;
begin
  cur := app.import_current(p_table, p_id);
  if cur is null then return null; end if;
  want := app.import_canonical(p_table, p_data);
  for k in select jsonb_object_keys(want) loop
    if jsonb_typeof(want -> k) = 'null' then continue; end if;
    if (cur -> k) is distinct from (want -> k) then
      out := out || jsonb_build_object(k, jsonb_build_object('from', cur -> k, 'to', want -> k));
    end if;
  end loop;
  if p_custom is not null and p_custom <> '{}'::jsonb and cur ? 'custom' then
    v_custom := coalesce(cur -> 'custom', '{}'::jsonb) || p_custom;
    if v_custom is distinct from cur -> 'custom' then
      out := out || jsonb_build_object('custom', jsonb_build_object('from', cur -> 'custom', 'to', v_custom));
    end if;
  end if;
  return out;
end $$;

-- Plain words for a failed row.
create or replace function app.import_explain(p_state text, p_msg text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case
    when p_state = '23505' then 'A record with the same number or key already exists (' || coalesce(substring(p_msg from 'constraint "([^"]+)"'), 'duplicate') || ').'
    when p_state = '23503' then 'It points at a record that does not exist.'
    when p_state = '23502' then 'A required value is missing (' || coalesce(substring(p_msg from 'column "([^"]+)"'), '?') || ').'
    when p_state like '22%' then 'One of the values has the wrong format: ' || p_msg
    when p_state = '23514' and p_msg ~ '^(new row for relation|.*violates check constraint)' then
      'One of the values is not allowed (' || coalesce(substring(p_msg from 'constraint "([^"]+)"'), 'check') || ').'
    else p_msg end
$$;

-- An identifier for a person or household, unless it is already theirs.
-- Raises when the same identifier belongs to someone else.
create or replace function app.import_add_identifier(r app.import_runs, p_row int, p_kind text, p_system text, p_value text,
                                                    p_person uuid, p_household uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_norm text; o record;
begin
  if coalesce(btrim(p_value), '') = '' or p_system is null then return; end if;
  v_norm := case when p_kind in ('org_member','org_household') then app.canonical_org_id(r.center_id, p_kind, p_value)
                 else app.normalize_identifier(p_value) end;
  select * into o from app.external_ids
   where center_id = r.center_id and kind::text = p_kind and system = p_system and normalized = v_norm and valid_to is null;
  if o.id is not null then
    if (p_person is not null and o.person_id is distinct from p_person) or (p_person is null and o.household_id is distinct from p_household) then
      raise exception 'The ID "%" already belongs to another %.', p_value, case when p_person is null then 'household' else 'person' end;
    end if;
    return;
  end if;
  perform app.import_add(r, p_row, 'external_ids', jsonb_build_object(
    'center_id', r.center_id, 'person_id', p_person, 'household_id', p_household, 'kind', p_kind, 'system', p_system,
    'value', btrim(p_value), 'source', 'import', 'created_by', auth.uid(), 'label', 'Imported'));
end $$;

-- Apply one staged row. Returns {status, target_id, message}.
create or replace function app.import_apply_row(r app.import_runs, e app.import_entities, x app.import_rows) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  c uuid := r.center_id; d jsonb; ex jsonb; m jsonb; v_id text; v_changed text[]; v_status text; v_msg text;
  v_crm text := nullif(r.options->>'crm_system', ''); v_rules jsonb; v_hh uuid; v_pledge uuid; v_amt bigint;
  v_rsvp uuid; v_session uuid; v_enr uuid; v_term uuid; v_email text; v_optin jsonb; v_pay app.payments; v_alloc bigint;
  v_look uuid; v_name text;
begin
  d := app.import_resolve(c, x.data, v_crm);
  ex := app.import_resolve(c, x.extra, v_crm);
  select rules into v_rules from app.centers where id = c;

  -- Values the engine derives before matching.
  if e.key = 'memberships' and not d ? 'tier' then
    d := d || jsonb_build_object('tier', (select tier from app.membership_types where id = (d->>'membership_type_id')::uuid));
  elsif e.key = 'pathshala_attendance' then
    select term_id into v_term from app.pathshala_classes where id = (ex->>'class_id')::uuid;
    select id into v_enr from app.pathshala_enrollments where term_id = v_term and student_person_id = (ex->>'student_person_id')::uuid;
    if v_enr is null then raise exception 'The child is not enrolled in that class''s term — import enrollments first.'; end if;
  elsif e.key = 'payment_allocations' then
    select * into v_pay from app.payments where id = (d->>'payment_id')::uuid;
    if (select household_id from app.pledges where id = (d->>'pledge_id')::uuid) is distinct from v_pay.household_id then
      raise exception 'That pledge belongs to a different household from the payment.';
    end if;
  end if;

  m := app.import_find(r, e, x.source_key, d, ex);

  if m ? 'id' then
    v_id := m->>'id';
    v_changed := app.import_patch(r, x.row_no, e.target_table, v_id, d, x.custom);
    v_status := case when coalesce(array_length(v_changed, 1), 0) = 0 then 'unchanged' else 'updated' end;
  elsif m ? 'ambiguous' and coalesce(x.decision, '') <> 'create' then
    return jsonb_build_object('status', 'skipped', 'message',
      format('Needs a decision: it matches %s existing records by %s. Nothing was changed.', jsonb_array_length(m->'ambiguous'), m->>'by'));
  elsif m ? 'lookalikes' and x.decision = 'skip' then
    return jsonb_build_object('status', 'skipped', 'message', 'Skipped: you chose not to add this look-alike.');
  else
    if x.custom <> '{}'::jsonb then d := d || jsonb_build_object('custom', x.custom); end if;
    if e.has_center then d := d || jsonb_build_object('center_id', c); end if;
    -- What an imported record of each kind always is.
    case e.key
      when 'payments' then
        d := d || jsonb_build_object('is_historical', true, 'provider', coalesce(d->>'provider', 'offline'),
                                     'status', coalesce(d->>'status', 'settled'), 'recorded_by', auth.uid());
      when 'pledges' then
        v_amt := coalesce((ex->>'paid_so_far')::bigint, 0);
        d := d || jsonb_build_object('created_by', auth.uid(), 'paid_cents', v_amt);
        if not d ? 'status' then
          d := d || jsonb_build_object('status', case when v_amt >= (d->>'amount_cents')::bigint then 'paid' when v_amt > 0 then 'partially_paid' else 'open' end);
        end if;
      when 'bolis' then d := d || jsonb_build_object('status', 'closed', 'kind', coalesce(d->>'kind', 'in_person'), 'created_by', auth.uid());
      when 'events' then d := d || jsonb_build_object('status', 'completed', 'created_by', auth.uid());
      when 'campaigns' then d := d || jsonb_build_object('created_by', auth.uid());
      when 'recurring_gifts' then d := d || jsonb_build_object('status', 'pending_payment_method');
      when 'boli_entries' then d := d || jsonb_build_object('is_in_person', true, 'entered_by', auth.uid());
      when 'store_items' then d := d || jsonb_build_object('stock_on_hand', 0);
      when 'pathshala_enrollments' then d := d || jsonb_build_object('registered_by', auth.uid());
      when 'background_checks' then d := d || jsonb_build_object('recorded_by', auth.uid());
      when 'external_ids' then d := d || jsonb_build_object('source', 'import', 'created_by', auth.uid());
      when 'channel_optins' then d := d || jsonb_build_object('source', coalesce(d->>'source', 'import'), 'recorded_at', coalesce(d->>'recorded_at', now()::text));
      when 'attendees' then
        v_hh := (ex->>'household_id')::uuid;
        select id into v_rsvp from app.rsvps where event_id = (d->>'event_id')::uuid and household_id = v_hh order by created_at limit 1;
        if v_rsvp is null then
          v_rsvp := app.import_add(r, x.row_no, 'rsvps', jsonb_build_object('center_id', c, 'event_id', d->>'event_id', 'household_id', v_hh,
                      'submitted_by_person_id', d->>'person_id', 'status', 'attended', 'source', 'import', 'commitment_mode', 'none'))::uuid;
        end if;
        select coalesce(nullif(preferred_name, ''), first_name) || ' ' || last_name into v_name from app.people where id = (d->>'person_id')::uuid;
        d := d || jsonb_build_object('rsvp_id', v_rsvp, 'display_name', coalesce(v_name, 'Guest'), 'status', 'attended');
      when 'pathshala_attendance' then
        select id into v_session from app.pathshala_sessions where class_id = (ex->>'class_id')::uuid and held_on = (ex->>'held_on')::date;
        if v_session is null then
          v_session := app.import_add(r, x.row_no, 'pathshala_sessions', jsonb_build_object('center_id', c, 'class_id', ex->>'class_id',
                         'held_on', ex->>'held_on', 'opened_by', auth.uid()))::uuid;
        end if;
        d := d || jsonb_build_object('session_id', v_session, 'enrollment_id', v_enr, 'marked_via', 'admin', 'marked_by', auth.uid());
      when 'payment_allocations' then
        select coalesce(sum(amount_cents), 0) into v_alloc from app.payment_allocations where payment_id = v_pay.id;
        if v_alloc + (d->>'amount_cents')::bigint > v_pay.amount_cents then
          raise exception 'The allocations of payment % would add up to more than the payment.', coalesce(v_pay.crm_external_id, v_pay.receipt_number);
        end if;
      else null;
    end case;
    v_id := app.import_add(r, x.row_no, e.target_table, d);
    v_status := 'created';
    -- A name-only look-alike is never merged automatically: it goes to merge review.
    if m ? 'lookalikes' then
      for v_look in select (jsonb_array_elements_text(m->'lookalikes'))::uuid loop
        if not exists (select 1 from app.merge_candidates where center_id = c and status = 'open'
                         and ((left_id = v_id::uuid and right_id = v_look) or (left_id = v_look and right_id = v_id::uuid))) then
          perform app.import_add(r, x.row_no, 'merge_candidates', jsonb_build_object('center_id', c,
            'kind', case when e.key = 'people' then 'person' else 'household' end, 'left_id', v_id, 'right_id', v_look, 'score', 0.5));
        end if;
      end loop;
      v_msg := 'Added; a record with the same name already exists, so both went to merge review.';
    end if;
  end if;

  -- Side values, for created and matched records alike.
  if e.key = 'people' then
    v_hh := (ex->>'household_id')::uuid;
    if v_hh is not null then
      if not exists (select 1 from app.household_members where household_id = v_hh and person_id = v_id::uuid) then
        perform app.import_add(r, x.row_no, 'household_members', jsonb_build_object('center_id', c, 'household_id', v_hh, 'person_id', v_id,
          'role', coalesce(ex->>'relationship', 'other'), 'is_primary', coalesce((ex->>'is_primary')::boolean, false)));
        if v_status = 'unchanged' then v_status := 'updated'; end if;
      elsif ex ? 'relationship' or ex ? 'is_primary' then
        if coalesce(array_length(app.import_patch(r, x.row_no, 'household_members', v_hh || ':' || v_id,
             jsonb_strip_nulls(jsonb_build_object('role', ex->>'relationship', 'is_primary', (ex->>'is_primary')::boolean))), 1), 0) > 0
           and v_status = 'unchanged' then v_status := 'updated'; end if;
      end if;
    end if;
    perform app.import_add_identifier(r, x.row_no, 'org_member',
      coalesce(v_rules->'identifiers'->>'org_member_system', 'org_register'), ex->>'legacy_id', v_id::uuid, null);
    if v_crm is not null then perform app.import_add_identifier(r, x.row_no, 'crm', v_crm, ex->>'crm_id', v_id::uuid, null); end if;
    if jsonb_typeof(ex->'other_emails') = 'array' then
      for v_email in select lower(jsonb_array_elements_text(ex->'other_emails')) loop
        if not exists (select 1 from app.person_emails where person_id = v_id::uuid and lower(email::text) = v_email)
           and v_email is distinct from (select lower(email::text) from app.people where id = v_id::uuid) then
          perform app.import_add(r, x.row_no, 'person_emails', jsonb_build_object('center_id', c, 'person_id', v_id, 'email', v_email, 'label', 'other'));
        end if;
      end loop;
    end if;
    v_optin := ex->'email_optin';
    if jsonb_typeof(v_optin) = 'object' then
      v_email := coalesce(lower(d->>'email'), (select lower(email::text) from app.people where id = v_id::uuid));
      -- Only an explicit opt-in with its date and source counts; an opt-out always imports.
      if v_email is not null and ((v_optin->>'opted_in')::boolean = false
          or (coalesce(v_optin->>'date', '') <> '' and coalesce(v_optin->>'source', '') <> '')) then
        if not exists (select 1 from app.channel_optins where person_id = v_id::uuid and channel = 'email' and lower(address) = v_email
                         and opted_in = (v_optin->>'opted_in')::boolean
                         and recorded_at = coalesce((v_optin->>'date')::timestamptz, recorded_at)) then
          perform app.import_add(r, x.row_no, 'channel_optins', jsonb_build_object('center_id', c, 'person_id', v_id, 'channel', 'email',
            'address', v_email, 'opted_in', (v_optin->>'opted_in')::boolean, 'source', coalesce(nullif(v_optin->>'source', ''), 'import'),
            'recorded_at', coalesce(nullif(v_optin->>'date', ''), now()::text)));
        end if;
      end if;
    end if;
  elsif e.key = 'households' then
    perform app.import_add_identifier(r, x.row_no, 'org_household',
      coalesce(v_rules->'identifiers'->>'org_household_system', 'org_register'), ex->>'legacy_id', null, v_id::uuid);
    if v_crm is not null then perform app.import_add_identifier(r, x.row_no, 'crm', v_crm, ex->>'crm_id', null, v_id::uuid); end if;
  elsif e.key = 'payments' then
    v_pledge := (ex->>'allocate_to')::uuid;
    if v_pledge is not null and not exists (select 1 from app.payment_allocations where payment_id = v_id::uuid and pledge_id = v_pledge) then
      select * into v_pay from app.payments where id = v_id::uuid;
      if (select household_id from app.pledges where id = v_pledge) is distinct from v_pay.household_id then
        raise exception 'The paid pledge belongs to a different household from the payment.';
      end if;
      v_amt := coalesce((ex->>'allocation_cents')::bigint, v_pay.amount_cents);
      select coalesce(sum(amount_cents), 0) into v_alloc from app.payment_allocations where payment_id = v_pay.id;
      if v_alloc + v_amt > v_pay.amount_cents then raise exception 'The allocations would add up to more than the payment.'; end if;
      perform app.import_add(r, x.row_no, 'payment_allocations', jsonb_build_object('center_id', c, 'payment_id', v_id, 'pledge_id', v_pledge, 'amount_cents', v_amt));
      if v_status = 'unchanged' then v_status := 'updated'; end if;
    end if;
  elsif e.key = 'store_items' and ex ? 'opening_stock' then
    if v_status = 'created' then
      if (ex->>'opening_stock')::int <> 0 then
        perform app.import_add(r, x.row_no, 'inventory_movements', jsonb_build_object('center_id', c, 'item_id', v_id,
          'delta', (ex->>'opening_stock')::int, 'reason', 'adjustment', 'recorded_by', auth.uid()));
      end if;
    else
      v_msg := 'Opening stock is set only for new items; adjust stock on the Store screen.';
    end if;
  end if;

  insert into app.import_keys (center_id, entity, source_key, table_name, record_id, run_id)
  values (c, e.key, x.source_key, e.target_table, v_id, r.id)
  on conflict (center_id, entity, source_key) do update
    set table_name = excluded.table_name, record_id = excluded.record_id, run_id = excluded.run_id, updated_at = now()
    where app.import_keys.record_id is distinct from excluded.record_id or app.import_keys.run_id is distinct from excluded.run_id;
  return jsonb_build_object('status', v_status, 'target_id', v_id, 'message', v_msg);
end $$;

-- ── Run lifecycle ───────────────────────────────────────────────────────────

-- Start a run (Upload). Also clears the original cells of runs older than 90 days.
create or replace function app.import_create_run(p_center uuid, p_entity text, p_source text, p_file_name text,
  p_fingerprint text default null, p_file_size bigint default null, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.import_entities; v_prev app.import_runs; v_same int; v_id uuid; v_n int;
begin
  select * into e from app.import_entities where key = p_entity;
  if e.key is null then raise exception 'The import tool does not load "%".', coalesce(p_entity, '(none)'); end if;
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then raise exception 'That community was not found.'; end if;
  if not app.import_has_any(p_center, e.write_perms) then
    raise exception 'Importing % needs one of these permissions: %.', lower(e.label), array_to_string(e.write_perms, ', ')
      using errcode = 'insufficient_privilege';
  end if;
  if e.module_key is not null then perform app.assert_module_enabled(p_center, e.module_key); end if;
  if coalesce(btrim(p_file_name), '') = '' then raise exception 'Choose a file to import.'; end if;

  -- Retention: the original cells of a run are kept 90 days.
  update app.import_rows set raw = null
   where center_id = p_center and raw is not null
     and run_id in (select id from app.import_runs where center_id = p_center and created_at < now() - interval '90 days');
  update app.import_runs set raw_purged_at = now()
   where center_id = p_center and created_at < now() - interval '90 days' and raw_purged_at is null;

  select * into v_prev from app.import_runs
   where center_id = p_center and entity = p_entity and source = coalesce(nullif(btrim(p_source), ''), 'csv')
     and status in ('committed','reconciled') order by created_at desc limit 1;
  select run_number into v_same from app.import_runs
   where center_id = p_center and entity = p_entity and file_fingerprint = p_fingerprint and p_fingerprint is not null
     and status in ('committed','reconciled') order by created_at desc limit 1;
  insert into app.import_runs (center_id, source, entity, file_name, file_fingerprint, file_size, tier, options, status,
                               started_by, previous_run_id)
  values (p_center, coalesce(nullif(btrim(p_source), ''), 'csv'), p_entity, left(btrim(p_file_name), 200), p_fingerprint, p_file_size, e.tier,
          coalesce(p_options, '{}'::jsonb), 'pending', auth.uid(), v_prev.id)
  returning id, run_number into v_id, v_n;
  return jsonb_build_object('id', v_id, 'run_number', v_n, 'previous_run_number', v_prev.run_number, 'same_file_run_number', v_same);
end $$;

-- Create (or reuse) the custom fields a run keeps extra columns in. Returns [{label, key}].
create or replace function app.import_define_fields(p_run uuid, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; e app.import_entities; f jsonb; d app.custom_field_definitions; out jsonb := '[]'::jsonb; v_key text;
begin
  r := app.import_assert_run(p_run);
  select * into e from app.import_entities where key = r.entity;
  if not (e.target_table = any (app.custom_field_entities())) then
    raise exception 'Custom fields cannot be kept on %.', lower(e.label);
  end if;
  perform app.import_audit(r);
  for f in select * from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) loop
    v_key := nullif(f->>'key', '');
    select * into d from app.custom_field_definitions
     where center_id = r.center_id and entity = e.target_table
       and (key = v_key or (v_key is null and lower(label) = lower(btrim(f->>'label'))))
     order by status, created_at limit 1;
    if d.id is not null then
      if d.status = 'archived' then
        raise exception 'The custom field "%" is archived. Restore it in Settings › Custom fields, or keep the column under another name.', d.label;
      end if;
      if d.type <> coalesce(f->>'type', 'text') then
        raise exception 'The custom field "%" already exists as %; the column looks like %. Pick the same type or another name.', d.label, d.type, f->>'type';
      end if;
      if d.type = 'choice' and jsonb_typeof(f->'choices') = 'array' then
        update app.custom_field_definitions set choices = (select jsonb_agg(distinct x) from (
            select jsonb_array_elements_text(d.choices) x union select jsonb_array_elements_text(f->'choices')) s)
         where id = d.id;
      end if;
    else
      d := app.define_custom_field(r.center_id, e.target_table, f->>'label', coalesce(f->>'type', 'text'),
                                   coalesce(f->'choices', '[]'::jsonb), 'staff', false, v_key, 'import', r.id);
    end if;
    out := out || jsonb_build_array(jsonb_build_object('label', f->>'label', 'key', d.key));
  end loop;
  return out;
end $$;

-- Stage checked rows (Check). Re-staging a row replaces it and clears its preview.
create or replace function app.import_stage_rows(p_run uuid, p_rows jsonb, p_mapping jsonb default null) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; e app.import_entities; x jsonb; k text; n int := 0; v_extras text[];
begin
  r := app.import_assert_run(p_run);
  if r.status not in ('pending','staged','previewed') then
    raise exception 'Import #% has already started, so its rows cannot change. Start a new import instead.', r.run_number;
  end if;
  select * into e from app.import_entities where key = r.entity;
  v_extras := e.extras || array['email_optin'];
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'The rows must be a list.'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'Send at most 1,000 rows at a time.'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    for k in select jsonb_object_keys(coalesce(x->'data', '{}'::jsonb)) loop
      if not (k = any (e.columns)) then raise exception 'Row %: % cannot be imported into "%".', x->>'row_no', k, e.label; end if;
    end loop;
    for k in select jsonb_object_keys(coalesce(x->'extra', '{}'::jsonb)) loop
      if not (k = any (v_extras)) then raise exception 'Row %: "%" is not a value % take.', x->>'row_no', k, lower(e.label); end if;
    end loop;
    for k in select jsonb_object_keys(coalesce(x->'custom', '{}'::jsonb)) loop
      if not exists (select 1 from app.custom_field_definitions where center_id = r.center_id and entity = e.target_table and key = k and status = 'active') then
        raise exception 'Row %: there is no custom field "%" for %.', x->>'row_no', k, lower(e.label);
      end if;
    end loop;
    insert into app.import_rows (center_id, run_id, row_no, source_key, raw, data, extra, custom, problems)
    values (r.center_id, r.id, (x->>'row_no')::int, coalesce(nullif(x->>'source_key', ''), 'row:' || (x->>'row_no')),
            x->'raw', coalesce(x->'data', '{}'::jsonb), coalesce(x->'extra', '{}'::jsonb), coalesce(x->'custom', '{}'::jsonb),
            coalesce(x->'problems', '[]'::jsonb))
    on conflict (run_id, row_no) do update set source_key = excluded.source_key, raw = excluded.raw, data = excluded.data,
      extra = excluded.extra, custom = excluded.custom, problems = excluded.problems, action = null, decision = null,
      match = null, status = 'staged', target_id = null, message = null;
    n := n + 1;
  end loop;
  update app.import_runs set status = 'staged', mapping = coalesce(p_mapping, mapping),
         rows_total = (select count(*) from app.import_rows where run_id = r.id)
   where id = r.id;
  return n;
end $$;

-- Preview: what each row will do (create / update / skip / needs a decision / error), with examples.
create or replace function app.import_preview(p_run uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; e app.import_entities; x app.import_rows; d jsonb; ex jsonb; m jsonb; v_action text; v_prev int;
        v_diff jsonb; v_counts jsonb; v_crm text; v_err text;
begin
  r := app.import_assert_run(p_run);
  if r.status not in ('staged','previewed') then raise exception 'Import #% has no checked rows to preview (it is %).', r.run_number, r.status; end if;
  select * into e from app.import_entities where key = r.entity;
  v_crm := nullif(r.options->>'crm_system', '');
  for x in select * from app.import_rows where run_id = r.id order by row_no loop
    m := null; v_diff := null;
    if exists (select 1 from jsonb_array_elements(x.problems) p where p->>'level' = 'error') then
      v_action := 'error';
    else
      begin
        d := app.import_resolve(r.center_id, x.data, v_crm);
        ex := app.import_resolve(r.center_id, x.extra, v_crm);
        if e.key = 'memberships' and not d ? 'tier' then
          d := d || jsonb_build_object('tier', (select tier from app.membership_types where id = (d->>'membership_type_id')::uuid));
        end if;
        m := app.import_find(r, e, x.source_key, d, ex);
        if not (m ? 'id') then
          -- A later row of the same file that is the same record updates the earlier one.
          select row_no into v_prev from app.import_rows p
           where p.run_id = r.id and p.row_no < x.row_no and p.action in ('create','needs_decision')
             and ((p.source_key = x.source_key and x.source_key not like 'row:%')
               or (e.key = 'people' and x.data ? 'email' and lower(p.data->>'email') = lower(x.data->>'email'))
               or (e.key = 'people' and x.data ? 'phone_e164' and p.data->>'phone_e164' = x.data->>'phone_e164'))
           order by p.row_no limit 1;
          if v_prev is not null then m := jsonb_build_object('same_file_row', v_prev, 'by',
             case when x.source_key = (select source_key from app.import_rows where run_id = r.id and row_no = v_prev) then 'the same ID'
                  when e.key = 'people' and lower((select data->>'email' from app.import_rows where run_id = r.id and row_no = v_prev)) = lower(x.data->>'email') then 'email'
                  else 'mobile' end);
          end if;
        end if;
        if m ? 'id' then
          v_diff := app.import_diff(e.target_table, m->>'id', d, x.custom);
          v_action := case when v_diff is null or v_diff = '{}'::jsonb then 'skip' else 'update' end;
          if e.key in ('people','payments') and v_action = 'skip' and (x.extra ? 'household_id' or x.extra ? 'allocate_to' or x.extra ? 'legacy_id') then
            v_action := 'update';   -- links and identifiers may still be added; the import reports "unchanged" if not
          end if;
        elsif m ? 'same_file_row' then v_action := 'update';
        elsif m ? 'ambiguous' or m ? 'lookalikes' then v_action := 'needs_decision';
        else v_action := 'create';
        end if;
      exception when others then
        v_action := 'error';
        v_err := app.import_explain(sqlstate, sqlerrm);
        x.problems := x.problems || jsonb_build_array(jsonb_build_object('level', 'error', 'column', null, 'message', v_err));
      end;
    end if;
    update app.import_rows set action = v_action, problems = x.problems,
           match = case when m is null then null else m || coalesce(jsonb_build_object('changes', v_diff), '{}'::jsonb) end
     where id = x.id;
  end loop;
  select jsonb_build_object(
      'create', count(*) filter (where action = 'create'), 'update', count(*) filter (where action = 'update'),
      'skip', count(*) filter (where action = 'skip'), 'needs_decision', count(*) filter (where action = 'needs_decision'),
      'error', count(*) filter (where action = 'error'), 'total', count(*))
    into v_counts from app.import_rows where run_id = r.id;
  update app.import_runs set status = 'previewed', counts = jsonb_build_object('preview', v_counts) where id = r.id;
  return v_counts;
end $$;

-- A person's decision on a row that needs one: 'create' (add it anyway) or 'skip'.
create or replace function app.import_decide(p_run uuid, p_row_no int, p_decision text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs;
begin
  r := app.import_assert_run(p_run);
  if r.status not in ('previewed','committing') then raise exception 'Decisions are made on the preview of Import #%.', r.run_number; end if;
  if p_decision not in ('create','skip') then raise exception 'Choose "add it" or "skip it".'; end if;
  update app.import_rows set decision = p_decision where run_id = r.id and row_no = p_row_no and status = 'staged';
  if not found then raise exception 'Row % is not waiting for a decision.', p_row_no; end if;
end $$;

-- Import (Commit): process the next batch of staged rows. Safe to call again
-- until `remaining` is 0; each row succeeds or fails on its own.
create or replace function app.import_commit_batch(p_run uuid, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; e app.import_entities; x app.import_rows; res jsonb; n int := 0; v_rem int; v_counts jsonb; v_err text;
begin
  perform app.import_assert_run(p_run);
  select * into r from app.import_runs where id = p_run for update;
  if r.status not in ('previewed','committing') then
    raise exception 'Import #% is %, so it cannot be imported now.%', r.run_number, r.status,
      case when r.status in ('pending','staged') then ' Look at the preview first.' else '' end;
  end if;
  select * into e from app.import_entities where key = r.entity;
  perform app.import_audit(r);
  update app.import_runs set status = 'committing', started_at = coalesce(started_at, now()), started_by = coalesce(started_by, auth.uid())
   where id = r.id;
  for x in select * from app.import_rows where run_id = r.id and status = 'staged' order by row_no
           limit greatest(1, least(coalesce(p_limit, 100), 500)) loop
    n := n + 1;
    if x.action = 'error' or exists (select 1 from jsonb_array_elements(x.problems) p where p->>'level' = 'error') then
      update app.import_rows set status = 'failed',
             message = (select p->>'message' from jsonb_array_elements(x.problems) p where p->>'level' = 'error' limit 1)
       where id = x.id;
      continue;
    end if;
    begin
      res := app.import_apply_row(r, e, x);
      update app.import_rows set status = res->>'status', target_id = res->>'target_id', message = res->>'message' where id = x.id;
    exception when others then
      v_err := app.import_explain(sqlstate, sqlerrm);
      update app.import_rows set status = 'failed', message = v_err where id = x.id;
    end;
  end loop;
  select count(*) filter (where status = 'staged'),
         jsonb_build_object('created', count(*) filter (where status = 'created'), 'updated', count(*) filter (where status = 'updated'),
                            'unchanged', count(*) filter (where status = 'unchanged'), 'skipped', count(*) filter (where status = 'skipped'),
                            'failed', count(*) filter (where status = 'failed'), 'total', count(*))
    into v_rem, v_counts from app.import_rows where run_id = r.id;
  update app.import_runs set counts = coalesce(counts, '{}'::jsonb) || jsonb_build_object('result', v_counts),
         rows_ok = (v_counts->>'created')::int + (v_counts->>'updated')::int + (v_counts->>'unchanged')::int,
         rows_failed = (v_counts->>'failed')::int,
         status = case when v_rem = 0 then 'committed' else 'committing' end,
         committed_at = case when v_rem = 0 then now() else committed_at end,
         finished_at = case when v_rem = 0 then now() else finished_at end
   where id = r.id;
  return jsonb_build_object('processed', n, 'remaining', v_rem, 'counts', v_counts, 'status', case when v_rem = 0 then 'committed' else 'committing' end);
end $$;

-- Reconcile: row counts and money totals, file versus database.
create or replace function app.import_reconcile(p_run uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; e app.import_entities; v_counts jsonb; v_money jsonb := '[]'::jsonb; col text; f bigint; b bigint;
        v_years jsonb := '[]'::jsonb; v_ok boolean; v_mismatch jsonb := '[]'::jsonb; v_rec jsonb; t record;
begin
  r := app.import_assert_run(p_run);
  if r.status not in ('committed','reconciled') then raise exception 'Import #% has not finished importing yet.', r.run_number; end if;
  select * into e from app.import_entities where key = r.entity;
  select jsonb_build_object('file_rows', count(*), 'created', count(*) filter (where status = 'created'),
                            'updated', count(*) filter (where status = 'updated'), 'unchanged', count(*) filter (where status = 'unchanged'),
                            'skipped', count(*) filter (where status = 'skipped'), 'failed', count(*) filter (where status = 'failed'))
    into v_counts from app.import_rows where run_id = r.id;

  foreach col in array e.money_columns loop
    if col = any (e.columns) then
      select coalesce(sum((data->>col)::bigint), 0) into f from app.import_rows where run_id = r.id;
      execute format('select coalesce(sum(t.%I), 0) from app.%I t where t.id::text in (
                        select distinct target_id from app.import_rows where run_id = $1 and status in (''created'',''updated'',''unchanged''))',
                     col, e.target_table) into b using r.id;
    elsif e.key = 'pledges' and col = 'paid_so_far' then
      select coalesce(sum((extra->>'paid_so_far')::bigint), 0) into f from app.import_rows where run_id = r.id and extra ? 'paid_so_far';
      select coalesce(sum(p.paid_cents), 0) into b from app.pledges p where p.id::text in (
        select target_id from app.import_rows where run_id = r.id and extra ? 'paid_so_far' and status in ('created','updated','unchanged'));
      select coalesce(jsonb_agg(jsonb_build_object('row', x.row_no, 'pledge', p.crm_external_id, 'file_cents', (x.extra->>'paid_so_far')::bigint,
                                                   'db_cents', p.paid_cents) order by x.row_no), '[]'::jsonb)
        into v_mismatch
        from app.import_rows x join app.pledges p on p.id::text = x.target_id
       where x.run_id = r.id and x.extra ? 'paid_so_far' and (x.extra->>'paid_so_far')::bigint <> p.paid_cents;
    else
      continue;
    end if;
    v_money := v_money || jsonb_build_array(jsonb_build_object('column', col, 'file_cents', f, 'db_cents', b, 'ok', f = b));
  end loop;

  if e.key = 'payments' then
    for t in
      with fy as (select left(data->>'received_on', 4) y, sum((data->>'amount_cents')::bigint) s from app.import_rows where run_id = r.id group by 1),
           dy as (select extract(year from p.received_on)::int::text y, sum(p.amount_cents) s from app.payments p
                   where p.id::text in (select target_id from app.import_rows where run_id = r.id and status in ('created','updated','unchanged')) group by 1)
      select coalesce(fy.y, dy.y) y, coalesce(fy.s, 0) fs, coalesce(dy.s, 0) ds from fy full join dy on dy.y = fy.y order by 1
    loop
      v_years := v_years || jsonb_build_array(jsonb_build_object('year', t.y, 'file_cents', t.fs, 'db_cents', t.ds, 'ok', t.fs = t.ds));
    end loop;
    select coalesce(sum(coalesce((extra->>'allocation_cents')::bigint, (data->>'amount_cents')::bigint)), 0) into f
      from app.import_rows where run_id = r.id and extra ? 'allocate_to';
    select coalesce(sum(a.amount_cents), 0) into b from app.payment_allocations a
     where a.payment_id::text in (select target_id from app.import_rows where run_id = r.id and extra ? 'allocate_to' and status in ('created','updated','unchanged'));
    if f > 0 or b > 0 then
      v_money := v_money || jsonb_build_array(jsonb_build_object('column', 'allocations', 'file_cents', f, 'db_cents', b, 'ok', f = b));
    end if;
  end if;

  v_ok := (v_counts->>'failed')::int = 0 and (v_counts->>'skipped')::int = 0
          and not exists (select 1 from jsonb_array_elements(v_money) m where not (m->>'ok')::boolean)
          and not exists (select 1 from jsonb_array_elements(v_years) m where not (m->>'ok')::boolean);
  v_rec := jsonb_build_object('counts', v_counts, 'money', v_money, 'by_year', v_years, 'paid_mismatches', v_mismatch,
                              'ok', v_ok, 'computed_at', now());
  update app.import_runs set reconciliation = v_rec where id = r.id;
  return v_rec;
end $$;

-- The person who owns the data signs the reconciliation off. When the totals
-- differ, a note explaining why is required.
create or replace function app.import_sign_off(p_run uuid, p_note text default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs;
begin
  r := app.import_assert_run(p_run);
  if r.status not in ('committed','reconciled') then raise exception 'Import #% has not finished importing yet.', r.run_number; end if;
  if r.reconciliation is null then raise exception 'Reconcile Import #% before signing it off.', r.run_number; end if;
  if not coalesce((r.reconciliation->>'ok')::boolean, false) and coalesce(btrim(p_note), '') = '' then
    raise exception 'The totals of Import #% do not match the file. Say why in a note to sign it off anyway.', r.run_number;
  end if;
  perform app.import_audit(r);
  update app.import_runs set status = 'reconciled', signed_off_by = auth.uid(), signed_off_at = now(),
         sign_off_note = nullif(btrim(p_note), '')
   where id = r.id;
end $$;

-- Undo within 30 days: rows it created are removed; rows it changed are put
-- back from the audit log's before-values (a value someone changed since the
-- import is left as it is, and reported).
create or replace function app.import_undo(p_run uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; ch app.import_changes; v_before jsonb; v_cur jsonb; v_restore jsonb; k text; v_val jsonb;
        v_removed int := 0; v_restored int := 0; v_kept jsonb := '[]'::jsonb; v_later text;
begin
  r := app.import_assert_run(p_run);
  if r.status not in ('committed','reconciled') then raise exception 'Import #% is %; only a finished import can be undone.', r.run_number, r.status; end if;
  if r.committed_at < now() - interval '30 days' then
    raise exception 'Import #% finished more than 30 days ago, so it can no longer be undone.', r.run_number;
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why this import is being undone. It goes in the audit log.'; end if;
  perform app.import_step_up('import.undo');
  perform app.set_audit_context(format('Undo import #%s · %s — %s', r.run_number, coalesce(r.file_name, r.entity), btrim(p_reason)), r.request_id);
  perform set_config('app.client_app', 'import', true);
  begin
    for ch in select * from app.import_changes where run_id = r.id and undone_at is null order by id desc loop
      if ch.op = 'insert' then
        if app.import_delete(ch.table_name, ch.record_id) then v_removed := v_removed + 1; end if;
      else
        v_cur := app.import_current(ch.table_name, ch.record_id);
        if v_cur is null then continue; end if;
        select a.before into v_before from app.audit_log a
         where a.correlation_id = r.request_id and a.record_table = ch.table_name and a.record_id = ch.record_id
           and a.action = ch.table_name || '.update' and a.occurred_at >= ch.created_at - interval '1 minute'
         order by a.id limit 1;
        v_restore := '{}'::jsonb;
        for k in select jsonb_object_keys(coalesce(ch.before, '{}'::jsonb)) loop
          if (v_cur -> k) is distinct from (ch.after -> k) then
            v_kept := v_kept || jsonb_build_array(jsonb_build_object('table', ch.table_name, 'id', ch.record_id, 'column', k));
            continue;
          end if;
          -- The audit log's before-value, unless the log masks that field (birth dates, processor references).
          v_val := case when v_before ? k and v_before ->> k is distinct from '***' then v_before -> k else ch.before -> k end;
          v_restore := v_restore || jsonb_build_object(k, v_val);
        end loop;
        if v_restore <> '{}'::jsonb then
          perform app.import_set(ch.table_name, ch.record_id, v_restore);
          v_restored := v_restored + 1;
        end if;
      end if;
      update app.import_changes set undone_at = now() where id = ch.id;
    end loop;
  exception when foreign_key_violation then
    select string_agg('#' || run_number, ', ' order by run_number) into v_later from app.import_runs
     where center_id = r.center_id and run_number > r.run_number and status in ('committed','reconciled','committing');
    raise exception 'Import #% cannot be undone: records it added are now used by other records%. Nothing was changed.', r.run_number,
      case when v_later is not null then ' (undo the later imports first: ' || v_later || ')' else ' (payments, pledges or memberships added since)' end;
  end;
  delete from app.import_keys k2 where k2.center_id = r.center_id and k2.run_id = r.id
     and not exists (select 1 from app.import_rows x where x.run_id = r.id and x.target_id = k2.record_id and x.status in ('updated','unchanged'));
  update app.import_rows set status = 'undone' where run_id = r.id and status = 'created';
  update app.import_runs set status = 'undone', undone_by = auth.uid(), undone_at = now(), undo_reason = btrim(p_reason) where id = r.id;
  return jsonb_build_object('removed', v_removed, 'restored', v_restored, 'kept', v_kept);
end $$;

-- Throw a staged run away (before it imports anything).
create or replace function app.import_cancel(p_run uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs;
begin
  r := app.import_assert_run(p_run);
  if r.status not in ('pending','staged','previewed') then raise exception 'Import #% has started; undo it instead.', r.run_number; end if;
  perform app.import_audit(r, 'Cancel import');
  delete from app.import_rows where run_id = r.id;
  update app.import_runs set status = 'cancelled', finished_at = now() where id = r.id;
end $$;

-- ── Reads for the portal ─────────────────────────────────────────────────────
create or replace function app.import_run_list(p_center uuid, p_limit int default 100)
returns table (id uuid, run_number int, entity text, entity_label text, tier text, source text, file_name text, status text,
               rows_total int, counts jsonb, reconciliation jsonb, started_by uuid, created_at timestamptz, committed_at timestamptz,
               signed_off_by uuid, signed_off_at timestamptz, undone_at timestamptz, undo_reason text, previous_run_number int,
               can_undo boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  select r.id, r.run_number, r.entity, e.label, e.tier, r.source, r.file_name, r.status, r.rows_total, r.counts, r.reconciliation,
         r.started_by, r.created_at, r.committed_at, r.signed_off_by, r.signed_off_at, r.undone_at, r.undo_reason,
         (select p.run_number from app.import_runs p where p.id = r.previous_run_id),
         r.status in ('committed','reconciled') and r.committed_at >= now() - interval '30 days'
    from app.import_runs r join app.import_entities e on e.key = r.entity
   where r.center_id = p_center and app.import_has_any(p_center, e.write_perms)
   order by r.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;

create or replace function app.import_run_get(p_run uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare r app.import_runs;
begin
  r := app.import_assert_run(p_run);
  return to_jsonb(r) || jsonb_build_object('entity_label', (select label from app.import_entities where key = r.entity),
    'previous_run_number', (select run_number from app.import_runs where id = r.previous_run_id));
end $$;

-- Save the column mapping for a source ("Neon export") so the next file maps itself.
create or replace function app.import_save_mapping(p_center uuid, p_entity text, p_source text, p_mapping jsonb) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.import_entities;
begin
  select * into e from app.import_entities where key = p_entity;
  if e.key is null then raise exception 'The import tool does not load "%".', coalesce(p_entity, '(none)'); end if;
  if not app.import_has_any(p_center, e.write_perms) then
    raise exception 'Saving a mapping for % needs one of: %.', lower(e.label), array_to_string(e.write_perms, ', ') using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_source), '') = '' then raise exception 'Name the source, for example "Neon export".'; end if;
  insert into app.import_mappings (center_id, source, entity, mapping, updated_by)
  values (p_center, btrim(p_source), p_entity, coalesce(p_mapping, '{}'::jsonb), auth.uid())
  on conflict (center_id, source, entity) do update set mapping = excluded.mapping, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- ── AI mapping suggestions (worker job import.suggest_mapping) ──────────────
-- Only when o-vault's job queue exists in this database; otherwise the screen
-- says honestly that name-based matching is all that ran.
create or replace function app.import_request_ai_mapping(p_run uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; v text;
begin
  r := app.import_assert_run(p_run);
  if to_regprocedure('app.enqueue_job(uuid,text,jsonb,timestamp with time zone)') is null then
    return jsonb_build_object('status', 'unavailable', 'reason', 'The background service is not set up yet, so only name-based matching ran.');
  end if;
  begin
    execute 'select (app.enqueue_job($1, $2, $3))::text' into v
      using r.center_id, 'import.suggest_mapping', coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('run_id', r.id, 'entity', r.entity);
  exception when others then
    return jsonb_build_object('status', 'unavailable', 'reason', 'The background service did not accept the request: ' || sqlerrm);
  end;
  update app.import_runs set ai_job_id = v::bigint where id = r.id;
  return jsonb_build_object('status', 'queued', 'job_id', v);
end $$;

create or replace function app.import_ai_mapping_result(p_run uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; v jsonb;
begin
  r := app.import_assert_run(p_run);
  if r.ai_job_id is null then return jsonb_build_object('status', 'none'); end if;
  if to_regclass('app.jobs') is null then return jsonb_build_object('status', 'unavailable', 'reason', 'The background service is not set up.'); end if;
  execute 'select jsonb_build_object(''status'', status, ''result'', result, ''error'', last_error) from app.jobs where id = $1'
    into v using r.ai_job_id;
  return coalesce(v, jsonb_build_object('status', 'missing'));
end $$;

revoke execute on function app.import_insert(text, jsonb), app.import_set(text, text, jsonb), app.import_delete(text, text),
  app.import_add(app.import_runs, int, text, jsonb), app.import_patch(app.import_runs, int, text, text, jsonb, jsonb),
  app.import_log(app.import_runs, int, text, text, text, jsonb, jsonb),
  app.import_apply_row(app.import_runs, app.import_entities, app.import_rows),
  app.import_add_identifier(app.import_runs, int, text, text, text, uuid, uuid),
  app.import_current(text, text), app.import_canonical(text, jsonb), app.import_diff(text, text, jsonb, jsonb),
  app.import_find(app.import_runs, app.import_entities, text, jsonb, jsonb), app.import_resolve(uuid, jsonb, text),
  app.import_ref(uuid, jsonb, text), app.import_audit(app.import_runs, text), app.import_runs_number()
  from public, anon, authenticated;
grant execute on function app.import_create_run(uuid, text, text, text, text, bigint, jsonb), app.import_define_fields(uuid, jsonb),
  app.import_stage_rows(uuid, jsonb, jsonb), app.import_preview(uuid), app.import_decide(uuid, int, text),
  app.import_commit_batch(uuid, integer), app.import_reconcile(uuid), app.import_sign_off(uuid, text), app.import_undo(uuid, text),
  app.import_cancel(uuid), app.import_run_list(uuid, int), app.import_run_get(uuid), app.import_save_mapping(uuid, text, text, jsonb),
  app.import_request_ai_mapping(uuid, jsonb), app.import_ai_mapping_result(uuid), app.import_run_allowed(uuid),
  app.import_assert_run(uuid), app.import_step_up(text), app.import_ref_missing(jsonb), app.import_explain(text, text)
  to authenticated;
grant execute on all functions in schema app to service_role;

-- ── The data types (kept in step with src/lib/import/registry.ts by tests/import-registry.test.ts) ──
-- BEGIN import_entities seed (generated from src/lib/import/registry.ts)
insert into app.import_entities (key, label, tier, sort, target_table, write_perms, module_key, columns, extras, natural_key, money_columns, has_center) values
  ('zones', 'Zones and ZIP codes', 'setup', 30, 'zones', array['settings.manage'], 'people',
   array['name','zip_codes'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('inboxes', 'Inboxes', 'setup', 31, 'inboxes', array['settings.manage'], 'comms',
   array['key','name','response_target_hours'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('bank_accounts', 'Bank accounts', 'setup', 32, 'bank_accounts', array['accounting.manage'], 'giving',
   array['active','institution','last4','name','statement_format'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('funds', 'Funds', 'setup', 33, 'funds', array['giving.manage'], 'giving',
   array['active','key','name','qbo_class_id','restricted'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('membership_types', 'Membership types', 'setup', 34, 'membership_types', array['settings.manage'], 'membership',
   array['active','ec_approval_required','fee_cents','includes_spouse','key','name','period_months','reference_required','tier','voting_wait_days'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('store_categories', 'Store categories', 'setup', 35, 'store_categories', array['store.manage'], 'store',
   array['name','sort_order'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('calendar_layers', 'Calendar layers', 'setup', 36, 'calendar_layers', array['content.manage'], 'calendar',
   array['color','default_on','key','kind','name','source_url'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('pathshala_tracks', 'Pathshala tracks', 'setup', 37, 'pathshala_tracks', array['pathshala.manage'], 'pathshala',
   array['key','name'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('pathshala_terms', 'Pathshala terms', 'setup', 38, 'pathshala_terms', array['pathshala.manage'], 'pathshala',
   array['ends_on','fee_per_child_cents','fee_per_family_cap_cents','membership_required','name','registration_closes_at','registration_opens_at','sibling_discount_pct','starts_on','status'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('practices', 'Practices (My Jain Way)', 'setup', 39, 'practices', array['content.manage'], 'jain_way',
   array['active','category','default_minutes','description','key','name','points','sort_order'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('gyan_goals', 'Gyan Path goals', 'setup', 40, 'gyan_goals', array['content.manage'], 'gyan_path',
   array['description','key','name','recommended','sort_order'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('campaigns', 'Campaigns', 'setup', 50, 'campaigns', array['giving.manage'], 'giving',
   array['description','ends_on','fund_id','goal_cents','kind','name','starts_on','status'],
   '{}'::text[], array['name'], array['goal_cents'], true),
  ('event_templates', 'Event templates', 'setup', 51, 'event_templates', array['events.manage'], 'events',
   array['description','name'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('event_template_items', 'Event template checklist items', 'setup', 52, 'event_template_items', array['events.manage'], 'events',
   array['name','offset_days','phase','priority','sort_order','template_id'],
   '{}'::text[], array['template_id','name'], '{}'::text[], true),
  ('volunteer_groups', 'Volunteer groups', 'setup', 53, 'volunteer_groups', array['volunteers.manage'], 'volunteers',
   array['name','requires_background_check','requires_waiver_kind'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('pathshala_levels', 'Pathshala levels', 'setup', 54, 'pathshala_levels', array['pathshala.manage'], 'pathshala',
   array['key','max_age','min_age','name','sort_order','track_id'],
   '{}'::text[], array['track_id','key'], '{}'::text[], true),
  ('gyan_levels', 'Gyan Path levels', 'setup', 55, 'gyan_levels', array['content.manage'], 'gyan_path',
   array['chapter','goal_id','key','name','points','requires_teacher_signoff','sort_order'],
   '{}'::text[], array['goal_id','key'], '{}'::text[], false),
  ('gyan_steps', 'Gyan Path steps', 'setup', 60, 'gyan_steps', array['content.manage'], 'gyan_path',
   array['kind','level_id','points','sort_order','title'],
   '{}'::text[], array['level_id','title'], '{}'::text[], false),
  ('opportunities', 'Opportunities and sponsorships', 'setup', 70, 'opportunities', array['giving.manage'], 'giving',
   array['amount_cents','campaign_id','description','kind','min_amount_cents','name','quantity_available','sort_order','status'],
   '{}'::text[], array['campaign_id','name'], array['amount_cents'], true),
  ('labh_options', 'Labh options', 'setup', 71, 'labh_options', array['giving.manage'], 'giving',
   array['active','amount_cents','campaign_id','fund_id','name','sort_order'],
   '{}'::text[], array['name'], array['amount_cents'], true),
  ('pickup_windows', 'Store pickup windows', 'setup', 72, 'pickup_windows', array['store.manage'], 'store',
   array['capacity','ends_at','location','order_cutoff_at','starts_at'],
   '{}'::text[], array['starts_at'], '{}'::text[], true),
  ('pathshala_classes', 'Pathshala classes', 'setup', 73, 'pathshala_classes', array['pathshala.manage'], 'pathshala',
   array['capacity','ends_time','level_id','meets_on','name','room','starts_time','term_id'],
   '{}'::text[], array['term_id','name'], '{}'::text[], true),
  ('whatsapp_groups', 'WhatsApp groups', 'setup', 74, 'whatsapp_groups', array['comms.send'], 'comms',
   array['active','audience','description','name','zone_id'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('households', 'Households', 'records', 100, 'households', array['people.manage'], 'people',
   array['address_line1','address_line2','city','directory_opt_in','display_name','household_number','notes','physical_mail_opt_in','postal_code','state_region','zone_id'],
   array['crm_id','legacy_id'], '{}'::text[], '{}'::text[], true),
  ('people', 'People', 'records', 101, 'people', array['people.manage'], 'people',
   array['date_of_birth','email','employer','first_name','gender','is_deceased','language','last_name','member_number','phone_e164','preferred_name','profession'],
   array['crm_id','email_opt_in','email_opt_in_date','email_opt_in_source','full_name','household_id','is_primary','legacy_id','other_emails','relationship'], '{}'::text[], '{}'::text[], true),
  ('household_members', 'Household members and relationships', 'records', 110, 'household_members', array['people.manage'], 'people',
   array['household_id','is_primary','joined_at','left_at','person_id','role'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('external_ids', 'Identifiers', 'records', 111, 'external_ids', array['people.manage','giving.manage'], 'people',
   array['household_id','kind','label','person_id','system','value'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('channel_optins', 'Consents, opt-ins and opt-outs', 'records', 112, 'channel_optins', array['comms.send'], 'comms',
   array['address','channel','opted_in','person_id','recorded_at','source'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('special_days', 'Special days', 'records', 120, 'special_days', array['people.manage'], 'people',
   array['calendar_date','household_id','kind','label','person_id','tithi','tithi_month'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('memberships', 'Memberships (current and past)', 'records', 121, 'memberships', array['people.manage'], 'membership',
   array['crm_external_id','ends_on','household_id','membership_type_id','notes','person_id','starts_on','status'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('pathshala_enrollments', 'Pathshala enrollments', 'records', 122, 'pathshala_enrollments', array['pathshala.manage'], 'pathshala',
   array['class_id','household_id','notes','status','student_person_id','term_id'],
   '{}'::text[], array['term_id','student_person_id'], '{}'::text[], true),
  ('pathshala_teachers', 'Pathshala teachers', 'records', 123, 'pathshala_teachers', array['pathshala.manage'], 'pathshala',
   array['class_id','person_id','role'],
   '{}'::text[], array['class_id','person_id'], '{}'::text[], true),
  ('volunteer_interests', 'Volunteer interests', 'records', 124, 'volunteer_interests', array['volunteers.manage'], 'volunteers',
   array['group_id','person_id','status'],
   '{}'::text[], array['person_id','group_id'], '{}'::text[], true),
  ('background_checks', 'Background checks', 'records', 125, 'background_checks', array['safety.manage'], 'volunteers',
   array['cleared_on','expires_on','person_id','provider','status'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('store_items', 'Store items and opening stock', 'records', 130, 'store_items', array['store.manage'], 'store',
   array['category_id','description','low_stock_threshold','name','pack_size','price_cents','qbo_item_id','sku','status','taxable','track_inventory'],
   array['opening_stock'], array['sku'], array['price_cents'], true),
  ('pledges', 'Pledges', 'history', 200, 'pledges', array['giving.manage'], 'giving',
   array['amount_cents','anonymous','campaign_id','closed_at','crm_external_id','dedication','due_on','fund_id','household_id','pledge_number','pledged_at','pledged_by_person_id','source','status'],
   array['paid_so_far'], '{}'::text[], array['amount_cents','paid_so_far'], true),
  ('payments', 'Payments (history)', 'history', 210, 'payments', array['giving.manage'], 'giving',
   array['amount_cents','check_number','crm_external_id','household_id','memo','method','payer_person_id','provider_ref','receipt_number','received_on','status'],
   array['allocate_to','allocation_cents'], '{}'::text[], array['amount_cents'], true),
  ('payment_allocations', 'Payment allocations', 'history', 220, 'payment_allocations', array['giving.manage'], 'giving',
   array['amount_cents','payment_id','pledge_id'],
   '{}'::text[], array['payment_id','pledge_id'], array['amount_cents'], true),
  ('recurring_gifts', 'Recurring gifts', 'history', 230, 'recurring_gifts', array['giving.manage'], 'giving',
   array['amount_cents','campaign_id','frequency','fund_id','household_id','method','next_charge_on','person_id','starts_on'],
   array['legacy_id'], '{}'::text[], array['amount_cents'], true),
  ('bolis', 'Past bolis', 'history', 240, 'bolis', array['bolis.manage'], 'bolis',
   array['campaign_id','closes_at','event_id','kind','name'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('boli_entries', 'Boli results', 'history', 241, 'boli_entries', array['bolis.manage'], 'bolis',
   array['amount_cents','boli_id','display_name','entered_at','household_id','person_id'],
   array['legacy_id'], '{}'::text[], array['amount_cents'], true),
  ('events', 'Past events', 'history', 242, 'events', array['events.manage'], 'events',
   array['description','ends_at','name','program_year','starts_at','venue'],
   array['legacy_id'], '{}'::text[], '{}'::text[], true),
  ('attendees', 'Event attendance', 'history', 243, 'attendees', array['events.manage'], 'events',
   array['checked_in_at','event_id','person_id'],
   array['household_id'], '{}'::text[], '{}'::text[], true),
  ('pathshala_attendance', 'Pathshala attendance', 'history', 244, 'pathshala_attendance', array['pathshala.manage'], 'pathshala',
   array['note','status'],
   array['class_id','held_on','student_person_id'], '{}'::text[], '{}'::text[], true)
on conflict (key) do update set label = excluded.label, tier = excluded.tier, sort = excluded.sort, target_table = excluded.target_table,
  write_perms = excluded.write_perms, module_key = excluded.module_key, columns = excluded.columns, extras = excluded.extras,
  natural_key = excluded.natural_key, money_columns = excluded.money_columns, has_center = excluded.has_center;
-- END import_entities seed
