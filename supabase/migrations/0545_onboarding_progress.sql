-- Guided onboarding (Settings › Guided onboarding): save and resume.
--
-- Until now the wizard kept everything in the browser, so leaving the page (or a crash, or a closed laptop)
-- started it over. This migration makes the work durable on the server:
--
--   app.onboarding_progress   one DRAFT per organization (a partial unique index): where the wizard stands
--                             (stage), the per-file facts that hold no personal values (file name, column
--                             choices, row counts, the current question), the owner's merge / keep-separate
--                             answers, and the numbered import runs that Create has made so far.
--   app.onboarding_rows       the uploaded rows AFTER validation (and, once Create starts, the final household
--                             plan), stored in chunks of at most 300 rows: one row here is one chunk, so a
--                             20,000-row file is about 80 rows, not 20,000, and the audit log grows by the
--                             same small amount.
--
-- Personal data. The rows are personal data (names, emails, mobiles, addresses, donation amounts) held as
-- import staging data is held:
--   * nothing here is ever written to a server log, and the portal logs only the error code and message;
--   * the audit trigger is on (every app table has one) but app.audit_mask hides `staged_rows` and
--     `merge_answers` from the audit entry ("***"), so a change is visible and the values are not;
--   * rows are deleted the moment the draft is finished (Create done) or started over, and a draft nobody
--     touched for 90 days is abandoned and its rows deleted the next time anyone opens the wizard for the
--     organization (the same lazy 90-day retention app.import_create_run applies to a run's original cells;
--     this project has no scheduled job to do it sooner).
--
-- Access follows the import engine (0192): the data type's own write permission, read from
-- app.import_entities.write_perms (payments -> giving.manage, people -> people.manage), platform admins always.
-- Past-donation rows additionally stop with the giving module (a restrictive module_switch policy, the pattern of
-- app.payment_refunds, 0410). Everything is written through SECURITY DEFINER functions that re-check the
-- permission; `authenticated` can only SELECT.
set client_min_messages = warning;

-- ── The audit entry never carries the staged rows or the answers ────────────────
-- (0546, which came from another branch, redefines this function from the older text and drops the two new keys;
-- 0548 sets the final definition with both sets, and test 47 fails if any later one loses them.)
create or replace function app.audit_mask(j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null then null else
    j - 'date_of_birth' - 'provider_ref' - 'fee_authorization_ref' - 'secret_ref'
      || case when j ? 'date_of_birth' then jsonb_build_object('date_of_birth', '***') else '{}'::jsonb end
      || case when j->>'ticket_token' is not null then jsonb_build_object('ticket_token', '***') else '{}'::jsonb end
      || case when j->>'attendance_token' is not null then jsonb_build_object('attendance_token', '***') else '{}'::jsonb end
      || case when j->>'token' is not null then jsonb_build_object('token', '***') else '{}'::jsonb end
      -- Guided onboarding (0545): uploaded rows are personal data, and the answers grow with the file.
      || case when j ? 'staged_rows' then jsonb_build_object('staged_rows', '***') else '{}'::jsonb end
      || case when j ? 'merge_answers' then jsonb_build_object('merge_answers', '***') else '{}'::jsonb end
  end
$$;

-- ── Tables ──────────────────────────────────────────────────────────────────────
create table if not exists app.onboarding_progress (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  status        text not null default 'draft' check (status in ('draft','created','abandoned')),
  stage         text not null default 'donations'
                check (stage in ('welcome','donations','members','family','review','confirm','done')),
  -- Per-file facts without personal values: {v, datasets:{donations:{status,fileName,headers,choices,...}}, qi}.
  state         jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  -- The owner's answers to "same household?", keyed by a stable question key: 'merge' | 'separate'.
  merge_answers jsonb not null default '{}'::jsonb check (jsonb_typeof(merge_answers) = 'object'),
  -- The numbered import runs Create has made: {households:{runId,...}, people:{...}, payments:{...}}.
  outcomes      jsonb not null default '{}'::jsonb check (jsonb_typeof(outcomes) = 'object'),
  -- Bumped by every save: two people on the same draft cannot silently overwrite each other.
  version       integer not null default 1,
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz,
  unique (id, center_id)
);
comment on table app.onboarding_progress is
  'Guided onboarding: where an organization''s wizard stands (one draft per organization), with no personal values. Rows are in onboarding_rows.';
create unique index if not exists onboarding_progress_one_draft on app.onboarding_progress (center_id) where status = 'draft';
create index if not exists onboarding_progress_center_idx on app.onboarding_progress (center_id, created_at desc);

create table if not exists app.onboarding_rows (
  id          bigint generated always as identity primary key,
  center_id   uuid not null references app.centers(id) on delete cascade,
  progress_id uuid not null,
  dataset     text not null check (dataset in ('donations','members','family','plan')),
  chunk_no    integer not null check (chunk_no >= 0),
  row_count   integer not null check (row_count between 1 and 300),
  -- PERSONAL DATA: the validated rows of this chunk (masked in the audit log, deleted when the draft ends).
  staged_rows jsonb not null check (jsonb_typeof(staged_rows) = 'array'),
  created_at  timestamptz not null default now(),
  unique (progress_id, dataset, chunk_no),
  foreign key (progress_id, center_id) references app.onboarding_progress (id, center_id) on delete cascade
);
comment on table app.onboarding_rows is
  'Guided onboarding: the uploaded rows after validation (and the final household plan), in chunks of at most 300 rows. Personal data: masked in the audit log, deleted when the draft is finished or started over, and after 90 days untouched.';

insert into app.module_tables (table_name, module_key) values ('onboarding_progress', null), ('onboarding_rows', null)
on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_onboarding_progress on app.onboarding_progress;
create trigger audit_onboarding_progress after insert or update or delete on app.onboarding_progress
  for each row execute function app.audit_row();
drop trigger if exists audit_onboarding_rows on app.onboarding_rows;
create trigger audit_onboarding_rows after insert or update or delete on app.onboarding_rows
  for each row execute function app.audit_row();

-- ── Access ──────────────────────────────────────────────────────────────────────
-- Whoever may write the data type the dataset becomes: donations -> payments, everything else -> people.
-- A null dataset is the draft itself: either.
create or replace function app.onboarding_perms(p_dataset text) returns text[]
language sql stable security definer set search_path = app, public, extensions as $$
  select case
    when p_dataset = 'donations' then coalesce((select write_perms from app.import_entities where key = 'payments'), '{}')
    when p_dataset in ('members','family','plan') then coalesce((select write_perms from app.import_entities where key = 'people'), '{}')
    else coalesce((select write_perms from app.import_entities where key = 'people'), '{}')
      || coalesce((select write_perms from app.import_entities where key = 'payments'), '{}')
  end
$$;

create or replace function app.onboarding_dataset_allowed(p_center uuid, p_dataset text default null) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.import_has_any(p_center, app.onboarding_perms(p_dataset))
$$;

-- Raises a plain sentence unless the caller may use the organization's guided onboarding (or one dataset of it).
create or replace function app.onboarding_assert(p_center uuid, p_dataset text default null) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not app.onboarding_dataset_allowed(p_center, p_dataset) then
    raise exception '% needs one of these permissions: %.',
      case p_dataset when 'donations' then 'Saving past donations' when 'members' then 'Saving members' when 'family' then 'Saving the rest of the family'
                     when 'plan' then 'Saving the household plan' else 'Guided onboarding' end,
      array_to_string(app.onboarding_perms(p_dataset), ', ')
      using errcode = 'insufficient_privilege';
  end if;
end $$;

alter table app.onboarding_progress enable row level security;
alter table app.onboarding_rows enable row level security;

drop policy if exists onboarding_progress_read on app.onboarding_progress;
create policy onboarding_progress_read on app.onboarding_progress for select to authenticated
  using (app.onboarding_dataset_allowed(center_id, null));
drop policy if exists onboarding_rows_read on app.onboarding_rows;
create policy onboarding_rows_read on app.onboarding_rows for select to authenticated
  using (app.onboarding_dataset_allowed(center_id, dataset));

-- Past-donation rows stop with the giving module (the rows of the other datasets belong to people, which is core).
drop policy if exists module_switch on app.onboarding_rows;
create policy module_switch on app.onboarding_rows as restrictive for all to public
  using ((select app.is_platform_admin()) or dataset <> 'donations' or center_id is null
         or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])))
  with check ((select app.is_platform_admin()) or dataset <> 'donations' or center_id is null
         or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])));

revoke all on app.onboarding_progress, app.onboarding_rows from public, anon, authenticated, connect_worker;
grant select on app.onboarding_progress, app.onboarding_rows to authenticated;
grant all on app.onboarding_progress, app.onboarding_rows to service_role;

-- ── Helpers ─────────────────────────────────────────────────────────────────────
create or replace function app.onboarding_person_name(p_center uuid, p_user uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(
    (select coalesce(nullif(pe.preferred_name, ''), pe.first_name) || ' ' || pe.last_name
       from app.center_users cu join app.people pe on pe.id = cu.person_id
      where cu.center_id = p_center and cu.user_id = p_user limit 1),
    'Someone on your team')
$$;

-- The draft as the wizard reads it (no rows: those are read chunk by chunk).
create or replace function app.onboarding_view(p app.onboarding_progress) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'id', p.id, 'stage', p.stage, 'version', p.version, 'state', p.state, 'merge_answers', p.merge_answers, 'outcomes', p.outcomes,
    'created_by_name', app.onboarding_person_name(p.center_id, p.created_by),
    'updated_by_name', app.onboarding_person_name(p.center_id, p.updated_by),
    'created_at', p.created_at, 'updated_at', p.updated_at,
    'stored', jsonb_build_object(
      'donations', coalesce((select sum(row_count) from app.onboarding_rows where progress_id = p.id and dataset = 'donations'), 0),
      'members',   coalesce((select sum(row_count) from app.onboarding_rows where progress_id = p.id and dataset = 'members'), 0),
      'family',    coalesce((select sum(row_count) from app.onboarding_rows where progress_id = p.id and dataset = 'family'), 0),
      'plan',      coalesce((select sum(row_count) from app.onboarding_rows where progress_id = p.id and dataset = 'plan'), 0)),
    'can', jsonb_build_object(
      'donations', app.onboarding_dataset_allowed(p.center_id, 'donations') and app.module_enabled(p.center_id, 'giving'),
      'members', app.onboarding_dataset_allowed(p.center_id, 'members'),
      'family', app.onboarding_dataset_allowed(p.center_id, 'family'),
      'plan', app.onboarding_dataset_allowed(p.center_id, 'plan')))
$$;

-- Retention: a draft nobody touched for 90 days is abandoned; the rows of every finished or abandoned draft go.
create or replace function app.onboarding_purge(p_center uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.set_audit_context('Guided onboarding · saved rows removed (draft finished, started over or untouched for 90 days)');
  update app.onboarding_progress set status = 'abandoned', finished_at = now(), updated_at = now()
   where center_id = p_center and status = 'draft' and updated_at < now() - interval '90 days';
  delete from app.onboarding_rows r using app.onboarding_progress p
   where r.progress_id = p.id and r.center_id = p_center and p.status <> 'draft';
end $$;

-- ── Entry points ────────────────────────────────────────────────────────────────

-- {draft: {...}|null, last: {finished_at, outcomes, finished_by}|null}: the draft to continue, or the last finished one.
create or replace function app.onboarding_current(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.onboarding_progress; v_last app.onboarding_progress;
begin
  perform app.onboarding_assert(p_center);
  perform app.onboarding_purge(p_center);
  select * into p from app.onboarding_progress where center_id = p_center and status = 'draft';
  if p.id is not null then
    return jsonb_build_object('draft', app.onboarding_view(p), 'last', null);
  end if;
  select * into v_last from app.onboarding_progress where center_id = p_center and status = 'created' order by finished_at desc nulls last limit 1;
  return jsonb_build_object('draft', null, 'last', case when v_last.id is null then null else jsonb_build_object(
    'finished_at', v_last.finished_at, 'outcomes', v_last.outcomes, 'finished_by', app.onboarding_person_name(p_center, v_last.updated_by)) end);
end $$;

-- Start the organization's draft (or return the one already there: two people pressing Start get the same draft).
create or replace function app.onboarding_start(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.onboarding_assert(p_center);
  perform app.onboarding_purge(p_center);
  perform app.set_audit_context('Guided onboarding · started');
  insert into app.onboarding_progress (center_id, created_by, updated_by) values (p_center, auth.uid(), auth.uid())
  on conflict (center_id) where status = 'draft' do nothing;
  return app.onboarding_current(p_center);
end $$;

-- Save where the wizard stands. `p_version` is the version the caller last saw: a different number means someone
-- else saved in between. State and outcomes merge by key; answers merge with null removing one.
create or replace function app.onboarding_save(p_id uuid, p_version integer default null, p_stage text default null,
  p_state jsonb default null, p_answers jsonb default null, p_outcomes jsonb default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.onboarding_progress; v_merged jsonb;
begin
  select * into p from app.onboarding_progress where id = p_id for update;
  if p.id is null then raise exception 'That guided onboarding was not found. Reload the page.'; end if;
  perform app.onboarding_assert(p.center_id);
  if p.status <> 'draft' then raise exception 'This guided onboarding was already finished or started over. Reload the page.'; end if;
  if p_version is not null and p_version <> p.version then
    raise exception 'This guided onboarding was changed since you opened it, by someone else or in another tab of yours. Reload the page to see the changes.' using errcode = '40001';
  end if;
  if p_stage is not null and p_stage not in ('welcome','donations','members','family','review','confirm','done') then
    raise exception 'Unknown step "%".', p_stage;
  end if;
  if p_state is not null and (jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 200000) then
    raise exception 'The progress to save is malformed or too large.';
  end if;
  if p_outcomes is not null and (jsonb_typeof(p_outcomes) <> 'object' or octet_length(p_outcomes::text) > 100000) then
    raise exception 'The import results to save are malformed or too large.';
  end if;
  if p_answers is not null then
    if jsonb_typeof(p_answers) <> 'object' then raise exception 'The answers to save are malformed.'; end if;
    if exists (select 1 from jsonb_each(p_answers) e where e.value <> all (array['"merge"'::jsonb, '"separate"'::jsonb, 'null'::jsonb])) then
      raise exception 'An answer must be "merge" or "separate".';
    end if;
    v_merged := jsonb_strip_nulls(p.merge_answers || p_answers);
    if octet_length(v_merged::text) > 4000000 then raise exception 'There are too many saved answers.'; end if;
  end if;
  update app.onboarding_progress
     set stage = coalesce(p_stage, stage),
         state = case when p_state is null then state else state || p_state end,
         merge_answers = coalesce(v_merged, merge_answers),
         outcomes = case when p_outcomes is null then outcomes else outcomes || p_outcomes end,
         version = version + 1, updated_by = auth.uid(), updated_at = now()
   where id = p.id returning * into p;
  return jsonb_build_object('version', p.version, 'updated_at', p.updated_at);
end $$;

-- Store one chunk (at most 300 rows) of a dataset. The first chunk of an upload (`p_first`) removes what the
-- dataset held before and forgets the answers and the plan, which were about the old rows; an empty first
-- chunk only clears the dataset (the step was skipped).
create or replace function app.onboarding_put_rows(p_id uuid, p_dataset text, p_chunk integer, p_rows jsonb, p_first boolean default false)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.onboarding_progress; v_n integer; v_total bigint;
begin
  select * into p from app.onboarding_progress where id = p_id for update;
  if p.id is null then raise exception 'That guided onboarding was not found. Reload the page.'; end if;
  if p_dataset is null or p_dataset not in ('donations','members','family','plan') then raise exception 'Unknown list "%".', coalesce(p_dataset, '(none)'); end if;
  perform app.onboarding_assert(p.center_id, p_dataset);
  if p_dataset = 'donations' then perform app.assert_module_enabled(p.center_id, 'giving'); end if;
  if p.status <> 'draft' then raise exception 'This guided onboarding was already finished or started over. Reload the page.'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'The rows must be a list.'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 300 then raise exception 'Send at most 300 rows at a time.'; end if;
  if octet_length(p_rows::text) > 4000000 then raise exception 'That batch of rows is too large. Send fewer rows at a time.'; end if;
  if coalesce(p_chunk, -1) < 0 then raise exception 'Unknown batch number.'; end if;
  if p_first then
    delete from app.onboarding_rows where progress_id = p.id and dataset = p_dataset;
    if p_dataset <> 'plan' then
      delete from app.onboarding_rows where progress_id = p.id and dataset = 'plan';
      update app.onboarding_progress set merge_answers = '{}'::jsonb, version = version + 1, updated_by = auth.uid(), updated_at = now()
       where id = p.id returning * into p;
    end if;
  end if;
  if v_n = 0 then
    if not coalesce(p_first, false) then raise exception 'Send at least one row.'; end if;
    return jsonb_build_object('stored', 0, 'version', p.version);
  end if;
  insert into app.onboarding_rows (center_id, progress_id, dataset, chunk_no, row_count, staged_rows)
  values (p.center_id, p.id, p_dataset, p_chunk, v_n, p_rows)
  on conflict (progress_id, dataset, chunk_no) do update set row_count = excluded.row_count, staged_rows = excluded.staged_rows;
  select coalesce(sum(row_count), 0) into v_total from app.onboarding_rows where progress_id = p.id and dataset = p_dataset;
  return jsonb_build_object('stored', v_total, 'version', p.version);
end $$;

-- Finish ('created': Create is done) or start over ('abandoned'). The saved rows go at once; the draft row stays as
-- the record of what happened, with the numbered imports it made.
create or replace function app.onboarding_close(p_id uuid, p_status text, p_outcomes jsonb default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.onboarding_progress;
begin
  if p_status is null or p_status not in ('created','abandoned') then raise exception 'A guided onboarding ends as created or started over.'; end if;
  select * into p from app.onboarding_progress where id = p_id for update;
  if p.id is null then raise exception 'That guided onboarding was not found. Reload the page.'; end if;
  perform app.onboarding_assert(p.center_id);
  if p.status <> 'draft' then
    if p.status = p_status then return; end if;
    raise exception 'This guided onboarding was already finished or started over. Reload the page.';
  end if;
  if p_outcomes is not null and (jsonb_typeof(p_outcomes) <> 'object' or octet_length(p_outcomes::text) > 100000) then
    raise exception 'The import results to save are malformed or too large.';
  end if;
  perform app.set_audit_context(case p_status when 'created' then 'Guided onboarding · finished' else 'Guided onboarding · started over' end);
  delete from app.onboarding_rows where progress_id = p.id;
  update app.onboarding_progress
     set status = p_status, stage = case when p_status = 'created' then 'done' else stage end,
         outcomes = case when p_outcomes is null then outcomes else outcomes || p_outcomes end,
         finished_at = now(), version = version + 1, updated_by = auth.uid(), updated_at = now()
   where id = p.id;
end $$;

revoke execute on function app.onboarding_perms(text), app.onboarding_dataset_allowed(uuid, text), app.onboarding_assert(uuid, text),
  app.onboarding_person_name(uuid, uuid), app.onboarding_view(app.onboarding_progress), app.onboarding_purge(uuid),
  app.onboarding_current(uuid), app.onboarding_start(uuid), app.onboarding_save(uuid, integer, text, jsonb, jsonb, jsonb),
  app.onboarding_put_rows(uuid, text, integer, jsonb, boolean), app.onboarding_close(uuid, text, jsonb) from public, anon;
-- The policies call the two access functions as the signed-in user; everything else is reached through the entry points.
grant execute on function app.onboarding_perms(text), app.onboarding_dataset_allowed(uuid, text),
  app.onboarding_current(uuid), app.onboarding_start(uuid), app.onboarding_save(uuid, integer, text, jsonb, jsonb, jsonb),
  app.onboarding_put_rows(uuid, text, integer, jsonb, boolean), app.onboarding_close(uuid, text, jsonb) to authenticated;
grant execute on all functions in schema app to service_role;
