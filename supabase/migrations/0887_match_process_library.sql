-- 0887 · CatchTheMatch Phase 1, part 2: the library of how to claim from each employer (docs/CATCH_THE_MATCH.md section 12;
-- owner direction of 2026-10-17). Builder CTM3.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.match_processes   at most one row per employer program of the shared directory (0765): the steps that got a match paid,
--                         written by Weaver's team and read by every community that has CatchTheMatch on, like the directory
--                         itself. PUBLIC FACTS ONLY: who submits (the member, the organization, either), the steps in order,
--                         the documents to have ready, links, about how many days it takes, tips, and whether Weaver's team
--                         saw it work (a day and a short note). NEVER a person, a community's name, a gift or an amount; the
--                         "worked" figure a reader gets is how many communities have received a match through the program,
--                         a count and nothing else. Text only for now: a file (a form, a screenshot) needs a storage bucket,
--                         which is a later change.
--   WHO READS: Weaver's team and the organization's own CatchTheMatch readers (app.match_directory_can_read, 0765).
--   WHO WRITES: Weaver's team only, through app.save_match_process and app.remove_match_process, a reason each; the history is
--   the shared audit (app.audit_shared_row), which names Weaver's team and no community.
--     app.match_process_get(program, center)      one program's process, how many communities were paid through it, and (for a
--                                                 community's own reader) how many matches this community received through it
--     app.match_process_list(query, limit, offset) the programs that have a process, by name
set client_min_messages = warning;

create table if not exists app.match_processes (
  program_id    uuid primary key references app.match_programs(id) on delete cascade,
  summary       text not null check (char_length(summary) between 1 and 400),
  who_submits   text not null check (who_submits in ('member', 'organization', 'either')),
  steps         text[] not null check (cardinality(steps) between 1 and 20),
  documents     text[] not null default '{}' check (cardinality(documents) <= 10),
  links         jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 8),
  typical_days  integer check (typical_days is null or typical_days between 1 and 365),
  tips          text check (tips is null or char_length(tips) <= 1000),
  worked_on     date,
  worked_note   text check (worked_note is null or char_length(worked_note) <= 300),
  version       integer not null default 1 check (version >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint match_processes_worked check (worked_note is null or worked_on is not null)
);
comment on table app.match_processes is
  'How to claim a match from an employer program of the shared directory (0887, CatchTheMatch Phase 1): the steps that got a match paid, written by Weaver''s team. Public facts only: no person, no community, no amount. Read by Weaver''s team and CatchTheMatch readers; written only through app.save_match_process.';

create or replace function app.match_processes_tidy() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function app.match_processes_tidy() from public, anon, authenticated;
drop trigger if exists match_processes_tidy on app.match_processes;
create trigger match_processes_tidy before update on app.match_processes
  for each row execute function app.match_processes_tidy();

drop trigger if exists audit_match_processes on app.match_processes;
create trigger audit_match_processes after insert or update or delete on app.match_processes
  for each row execute function app.audit_shared_row();
-- Core platform: shared, like the directory (its readers need CatchTheMatch on somewhere).
insert into app.module_tables (table_name, module_key) values ('match_processes', null)
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.match_processes enable row level security;
drop policy if exists match_processes_read on app.match_processes;
create policy match_processes_read on app.match_processes for select to authenticated
  using ((select app.match_directory_can_read()));
revoke all on app.match_processes from public, anon, authenticated;
grant select on app.match_processes to authenticated;
grant all on app.match_processes to service_role;

-- ── What Weaver's team sends, cleaned (every rule in plain English) ──────────
create or replace function app._match_process_clean(p jsonb) returns jsonb
language plpgsql immutable set search_path = app, public, extensions as $$
declare v_summary text; v_who text; v_steps text[] := '{}'; v_docs text[] := '{}'; v_links jsonb := '[]'::jsonb;
        v_days bigint; v_tips text; v_worked date; v_note text; x jsonb; t text; v_label text; v_url text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Send the process as an object.' using errcode = '22023'; end if;
  v_summary := app._mj_text(p, 'summary', 400, 'The summary');
  if v_summary is null then raise exception 'Give a one-line summary of how the claim works.' using errcode = '22023'; end if;
  v_who := app._mj_choice(p, 'who_submits', array['member', 'organization', 'either'], 'Who submits');
  if v_who is null then raise exception 'Say who submits the request: the member, the organization, or either.' using errcode = '22023'; end if;

  if p ? 'steps' and jsonb_typeof(p->'steps') <> 'null' then
    if jsonb_typeof(p->'steps') <> 'array' then raise exception 'Send the steps as a list.' using errcode = '22023'; end if;
    for x in select * from jsonb_array_elements(p->'steps') loop
      if jsonb_typeof(x) <> 'string' then raise exception 'Each step must be text.' using errcode = '22023'; end if;
      t := btrim(regexp_replace(x #>> '{}', '\s+', ' ', 'g'));
      if t <> '' then
        if char_length(t) > 400 then raise exception 'A step can be at most 400 characters.' using errcode = '22023'; end if;
        v_steps := v_steps || t;
      end if;
    end loop;
  end if;
  if cardinality(v_steps) = 0 then raise exception 'Give at least one step.' using errcode = '22023'; end if;
  if cardinality(v_steps) > 20 then raise exception 'At most 20 steps.' using errcode = '22023'; end if;

  if p ? 'documents' and jsonb_typeof(p->'documents') <> 'null' then
    if jsonb_typeof(p->'documents') <> 'array' then raise exception 'Send the documents as a list.' using errcode = '22023'; end if;
    for x in select * from jsonb_array_elements(p->'documents') loop
      if jsonb_typeof(x) <> 'string' then raise exception 'Each document must be text.' using errcode = '22023'; end if;
      t := btrim(regexp_replace(x #>> '{}', '\s+', ' ', 'g'));
      if t <> '' then
        if char_length(t) > 120 then raise exception 'A document can be at most 120 characters.' using errcode = '22023'; end if;
        v_docs := v_docs || t;
      end if;
    end loop;
  end if;
  if cardinality(v_docs) > 10 then raise exception 'At most 10 documents.' using errcode = '22023'; end if;

  if p ? 'links' and jsonb_typeof(p->'links') <> 'null' then
    if jsonb_typeof(p->'links') <> 'array' then raise exception 'Send the links as a list.' using errcode = '22023'; end if;
    for x in select * from jsonb_array_elements(p->'links') loop
      if jsonb_typeof(x) <> 'object' then raise exception 'Each link needs a label and an address.' using errcode = '22023'; end if;
      v_label := app._mj_text(x, 'label', 80, 'A link''s label');
      v_url := app._mj_https(x, 'url', 'A link''s address');
      if v_label is null or v_url is null then raise exception 'Each link needs a label and an address.' using errcode = '22023'; end if;
      v_links := v_links || jsonb_build_array(jsonb_build_object('label', v_label, 'url', v_url));
    end loop;
  end if;
  if jsonb_array_length(v_links) > 8 then raise exception 'At most 8 links.' using errcode = '22023'; end if;

  v_days := app._mj_int(p, 'typical_days', 1, 365, 'About how many days it takes');
  v_tips := app._mj_text(p, 'tips', 1000, 'The tips', false);
  v_note := app._mj_text(p, 'worked_note', 300, 'The note on how it worked');
  t := app._mj_text(p, 'worked_on', 10, 'The day it worked');
  if t is not null then
    if t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'The day it worked must look like 2026-10-17.' using errcode = '22023'; end if;
    begin
      v_worked := t::date;
    exception when others then
      raise exception 'The day it worked must be a real date, like 2026-10-17.' using errcode = '22023';
    end;
    if v_worked > current_date + 1 then raise exception 'The day it worked cannot be in the future.' using errcode = '22023'; end if;
  end if;
  if v_note is not null and v_worked is null then
    raise exception 'Give the day it worked with the note.' using errcode = '22023';
  end if;

  return jsonb_build_object('summary', v_summary, 'who_submits', v_who, 'steps', to_jsonb(v_steps), 'documents', to_jsonb(v_docs),
                            'links', v_links, 'typical_days', v_days, 'tips', v_tips, 'worked_on', v_worked, 'worked_note', v_note);
end $$;
revoke execute on function app._match_process_clean(jsonb) from public, anon, authenticated;

-- ── Writing (Weaver's team) ──────────────────────────────────────────────────
-- Adds the process of a program or changes it. Returns its version. A merged entry cannot hold one: write it on the entry it
-- was merged into.
create or replace function app.save_match_process(p_program uuid, p_process jsonb, p_reason text) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare c jsonb; g app.match_programs; v_version integer; v_reason text;
begin
  perform app._assert_weaver('change the how-to-claim library');
  v_reason := app.audit_clean_reason(p_reason);
  if v_reason is null then
    raise exception 'Say what changed and why. It goes in the library''s history.' using errcode = '22023';
  end if;
  select * into g from app.match_programs where id = p_program;
  if g.id is null then raise exception 'That directory entry was not found.' using errcode = '22023'; end if;
  if g.status = 'merged' then raise exception 'This entry was merged into another one. Write the process there.' using errcode = '22023'; end if;
  c := app._match_process_clean(p_process);
  perform app.set_audit_context('Weaver''s team: ' || v_reason);
  insert into app.match_processes (program_id, summary, who_submits, steps, documents, links, typical_days, tips, worked_on, worked_note)
  values (p_program, c->>'summary', c->>'who_submits',
          array(select jsonb_array_elements_text(c->'steps')), array(select jsonb_array_elements_text(c->'documents')),
          c->'links', (c->>'typical_days')::int, c->>'tips', (c->>'worked_on')::date, c->>'worked_note')
  on conflict (program_id) do update
     set summary = excluded.summary, who_submits = excluded.who_submits, steps = excluded.steps, documents = excluded.documents,
         links = excluded.links, typical_days = excluded.typical_days, tips = excluded.tips, worked_on = excluded.worked_on,
         worked_note = excluded.worked_note, version = app.match_processes.version + 1
  returning version into v_version;
  return v_version;
end $$;

create or replace function app.remove_match_process(p_program uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_reason text;
begin
  perform app._assert_weaver('remove a how-to-claim entry');
  v_reason := app.audit_clean_reason(p_reason);
  if v_reason is null then raise exception 'Say why. It goes in the library''s history.' using errcode = '22023'; end if;
  perform app.set_audit_context('Weaver''s team: ' || v_reason);
  delete from app.match_processes where program_id = p_program;
end $$;

-- ── Reading ──────────────────────────────────────────────────────────────────
create or replace function app._match_process_json(m app.match_processes) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select jsonb_build_object('summary', m.summary, 'who_submits', m.who_submits, 'steps', to_jsonb(m.steps),
                            'documents', to_jsonb(m.documents), 'links', m.links, 'typical_days', m.typical_days, 'tips', m.tips,
                            'worked_on', m.worked_on, 'worked_note', m.worked_note, 'version', m.version, 'updated_at', m.updated_at)
$$;
revoke execute on function app._match_process_json(app.match_processes) from public, anon, authenticated;

-- How many communities received a match through the program (a count, never which), for the entry and the entries merged into it.
create or replace function app._match_worked_communities(p_program uuid) returns integer
language sql stable security definer set search_path = app, public, extensions as $$
  select count(distinct c.center_id)::int
    from app.match_claims c
   where c.state = 'received'
     and c.program_id in (select g.id from app.match_programs g where g.id = p_program or g.merged_into = p_program)
$$;
revoke execute on function app._match_worked_communities(uuid) from public, anon, authenticated;

create or replace function app.match_process_get(p_program uuid, p_center uuid default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.match_programs; m app.match_processes; v_here jsonb := null;
begin
  if not app.match_directory_can_read() then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  select * into g from app._match_program_current(p_program);
  if g.id is null then raise exception 'That directory entry was not found.' using errcode = '22023'; end if;
  select x.* into m from app.match_processes x
   where x.program_id in (select y.id from app.match_programs y where y.id = g.id or y.merged_into = g.id)
   order by (x.program_id = g.id) desc, x.updated_at desc limit 1;
  if p_center is not null and app._matching_org_can(p_center) then
    select jsonb_build_object('received', count(*), 'last_on', max(c.received_on)) into v_here
      from app.match_claims c
     where c.center_id = p_center and c.state = 'received'
       and c.program_id in (select y.id from app.match_programs y where y.id = g.id or y.merged_into = g.id);
  end if;
  return jsonb_build_object(
    'program', jsonb_build_object('id', g.id, 'company_name', g.company_name, 'country', g.country, 'portal', g.portal,
                                  'portal_url', g.portal_url, 'status', g.status),
    'process', case when m.program_id is null then null else app._match_process_json(m) end,
    'worked_communities', app._match_worked_communities(g.id),
    'here', v_here);
end $$;

create or replace function app.match_process_list(p_query text default null, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_key text; v_total int; v_rows jsonb;
begin
  if not app.match_directory_can_read() then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  v_key := nullif(app.employer_name_key(coalesce(p_query, '')), '');
  with base as (
    select g.id, g.company_name, g.country, g.portal, m.who_submits, m.summary, m.version, m.updated_at, m.worked_on
      from app.match_processes m join app.match_programs g on g.id = m.program_id
     where g.status <> 'merged'
       and (v_key is null or exists (select 1 from app.match_program_names n
                                      where n.program_id = g.id and n.retired_at is null and position(v_key in n.name_key) > 0))
  ),
  pg as (select * from base order by lower(company_name), id
          limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0))
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'company_name', x.company_name, 'country', x.country,
                     'portal', x.portal, 'who_submits', x.who_submits, 'summary', x.summary, 'version', x.version,
                     'updated_at', x.updated_at, 'worked_on', x.worked_on,
                     'worked_communities', app._match_worked_communities(x.id)) order by lower(x.company_name), x.id) from pg x),
                  '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

revoke execute on function app.save_match_process(uuid, jsonb, text), app.remove_match_process(uuid, text),
  app.match_process_get(uuid, uuid), app.match_process_list(text, int, int) from public, anon;
grant execute on function app.save_match_process(uuid, jsonb, text), app.remove_match_process(uuid, text),
  app.match_process_get(uuid, uuid), app.match_process_list(text, int, int) to authenticated, service_role;
