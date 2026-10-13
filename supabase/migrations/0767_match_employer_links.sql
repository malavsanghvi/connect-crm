-- 0767 · CatchTheMatch slice 2, part 3: an employer on file (0759) linked to its program in the shared directory (0765),
-- confirmed by the community's staff (docs/CATCH_THE_MATCH.md sections 6 and 9). Builder MATCH2.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.person_match_programs   one row per person whose employer for gift matching is on file: the directory entry it is,
--                               how it was found (the same name, part of the name, or chosen from the directory), who
--                               confirmed it and when. The organization's own data (0757's contract): module 'matching',
--                               read through app.matching_readable_centers, adults only, a restrictive module_switch with no
--                               platform-admin pass, app.audit_private_row. The shared directory never points back: nothing
--                               there counts or names the people linked to an entry.
--   Matching is by name only, with no AI: app.employer_name_key (0765) of the employer on file against every name of every
--   entry (the same key, or one inside the other), so a company is found under any of its names in any script. A person is
--   never linked without a member of staff confirming it.
--     app.match_program_candidates(center, person)   the employer on file, its link, and up to 10 entries it may be, best
--                                                    first (matching_can view; the read is logged)
--     app.link_match_program(center, person, entry)  confirms one (matching.manage; an active entry; an adult with an
--                                                    employer on file)
--     app.unlink_match_program(center, person)       removes it (matching.manage)
--     app.match_employers_queue(center, filter, ...) the employers on file, linked or not, each with its best candidate
--                                                    (matching_can view; the read is logged)
--   The link goes when the employer on file changes or is withdrawn (the person, or the office at their request), and with
--   the record. An entry merged into another is followed when read; a retired one is shown as ended.
set client_min_messages = warning;

create table if not exists app.person_match_programs (
  person_id    uuid primary key references app.person_match_employers(person_id) on delete cascade,
  center_id    uuid not null references app.centers(id) on delete cascade,
  program_id   uuid not null references app.match_programs(id),
  how          text not null check (how in ('same_name', 'part_of_name', 'chosen')),
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now()
);
create index if not exists person_match_programs_center_idx on app.person_match_programs (center_id);
create index if not exists person_match_programs_program_idx on app.person_match_programs (program_id);
comment on table app.person_match_programs is
  'An adult''s employer on file for gift matching (person_match_employers, 0759) linked to its program in the shared directory (0767), confirmed by staff. The organization''s own data: matching_can readers only. Written only by link_match_program / unlink_match_program; removed when the employer on file changes or is withdrawn.';

-- The link belongs to an adult with an employer on file, in that person's community.
create or replace function app.person_match_programs_check() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.person_match_employers;
begin
  select * into e from app.person_match_employers where person_id = new.person_id;
  if e.person_id is null or e.employer_name is null then
    raise exception 'Nothing is on file for this person: their employer for gift matching was withdrawn or never given.'
      using errcode = '23514';
  end if;
  if app.person_is_minor(new.person_id) then
    raise exception 'Gift matching is for adults only.' using errcode = '23514';
  end if;
  new.center_id := e.center_id;
  return new;
end $$;
revoke execute on function app.person_match_programs_check() from public, anon, authenticated;
drop trigger if exists person_match_programs_check on app.person_match_programs;
create trigger person_match_programs_check before insert or update on app.person_match_programs
  for each row execute function app.person_match_programs_check();

drop trigger if exists audit_person_match_programs on app.person_match_programs;
create trigger audit_person_match_programs after insert or update or delete on app.person_match_programs
  for each row execute function app.audit_private_row('matching', 'person_id');
insert into app.module_tables (table_name, module_key) values ('person_match_programs', 'matching')
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.person_match_programs enable row level security;
drop policy if exists person_match_programs_read on app.person_match_programs;
create policy person_match_programs_read on app.person_match_programs for select to authenticated
  using (center_id = any ((select app.matching_readable_centers())::uuid[])
         and app.match_employer_adult(center_id, person_id));
drop policy if exists module_switch on app.person_match_programs;
create policy module_switch on app.person_match_programs as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])));
revoke all on app.person_match_programs from public, anon, authenticated;
grant select on app.person_match_programs to authenticated;
grant all on app.person_match_programs to service_role;

-- The employer on file changes (another name) or is withdrawn (no name): the link it had goes.
create or replace function app.match_employer_changed_unlinks() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.employer_name is distinct from old.employer_name then
    delete from app.person_match_programs where person_id = new.person_id;
  end if;
  return null;
end $$;
revoke execute on function app.match_employer_changed_unlinks() from public, anon, authenticated;
drop trigger if exists match_employer_changed_unlinks on app.person_match_employers;
create trigger match_employer_changed_unlinks after update of employer_name on app.person_match_employers
  for each row execute function app.match_employer_changed_unlinks();

-- ── Reading ──────────────────────────────────────────────────────────────────
-- One entry as a link or a candidate shows it: the entry it is now (a merged one is followed), its name, country and state.
create or replace function app._match_entry_brief(p_program uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('id', g.id, 'company_name', g.company_name, 'country', g.country, 'status', g.status,
                            'match_ratio_bp', g.match_ratio_bp, 'portal', g.portal, 'religious_orgs', g.religious_orgs,
                            'last_verified_on', g.last_verified_on, 'verified_by_kind', g.verified_by_kind)
    from app._match_program_current(p_program) g
   where g.id is not null
$$;

-- What a link says: the entry, how it was found, who confirmed it and when.
create or replace function app._match_link_card(p_person uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('program', app._match_entry_brief(l.program_id), 'how', l.how,
                            'confirmed_at', l.confirmed_at, 'confirmed_by', app._user_label(l.center_id, l.confirmed_by))
    from app.person_match_programs l
   where l.person_id = p_person
$$;

-- The active entries a key may be, best first: the same name, then the closest name.
create or replace function app._match_candidates(p_key text, p_limit int) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb)
    from (select jsonb_build_object('id', g.id, 'company_name', g.company_name, 'country', g.country,
                                    'match_ratio_bp', g.match_ratio_bp, 'portal', g.portal,
                                    'matched_name', f.matched_name, 'how', f.how) as j,
                 row_number() over (order by (f.how = 'same_name') desc, f.gap, lower(g.company_name), g.id) as ord
            from app._match_find(p_key) f
            join app.match_programs g on g.id = f.program_id
           where g.status = 'active'
           order by 2
           limit greatest(coalesce(p_limit, 10), 1)) x
$$;

create or replace function app.match_program_candidates(p_center uuid, p_person uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.person_match_employers; v_out jsonb;
begin
  if not app.matching_can(p_center, 'view') then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  select * into e from app.person_match_employers
   where person_id = p_person and center_id = p_center and withdrawn_at is null and employer_name is not null;
  if e.person_id is null or app.person_is_minor(p_person) then
    return jsonb_build_object('employer', null, 'link', null, 'candidates', '[]'::jsonb);
  end if;
  v_out := jsonb_build_object('employer', e.employer_name, 'link', app._match_link_card(p_person),
                              'candidates', app._match_candidates(app.employer_name_key(e.employer_name), 10));
  perform app.log_private_read(p_center, 'matching', 'employer_candidates', 1);
  return v_out;
end $$;

-- ── Confirming ───────────────────────────────────────────────────────────────
create or replace function app.link_match_program(p_center uuid, p_person uuid, p_program uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.person_match_employers; g app.match_programs; v_key text; v_how text;
begin
  if not app.matching_can(p_center, 'manage') then
    raise exception 'Linking an employer to the gift matching directory needs the CatchTheMatch manager role (matching.manage).'
      using errcode = 'insufficient_privilege';
  end if;
  perform app._match_office_check(p_center, p_person);
  select * into e from app.person_match_employers
   where person_id = p_person and center_id = p_center and withdrawn_at is null and employer_name is not null;
  if e.person_id is null then
    raise exception 'Nothing is on file for this person: their employer for gift matching was withdrawn or never given.';
  end if;
  if app.person_is_minor(p_person) then raise exception 'Gift matching is for adults only.'; end if;
  g := app._match_program_current(p_program);
  if g.id is null then raise exception 'That directory entry was not found.'; end if;
  if g.status <> 'active' then
    raise exception 'That program has ended (it is retired in the directory). Choose another entry.';
  end if;
  v_key := app.employer_name_key(e.employer_name);
  select f.how into v_how from app._match_find(v_key) f where f.program_id = g.id;
  perform app.set_audit_context('Linked to the gift matching directory');
  insert into app.person_match_programs (person_id, center_id, program_id, how, confirmed_by, confirmed_at)
  values (p_person, p_center, g.id, coalesce(v_how, 'chosen'), auth.uid(), now())
  on conflict (person_id) do update
    set program_id = excluded.program_id, how = excluded.how, confirmed_by = excluded.confirmed_by,
        confirmed_at = excluded.confirmed_at;
  return app._match_link_card(p_person);
end $$;

create or replace function app.unlink_match_program(p_center uuid, p_person uuid) returns boolean
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_gone int;
begin
  if not app.matching_can(p_center, 'manage') then
    raise exception 'Removing a link to the gift matching directory needs the CatchTheMatch manager role (matching.manage).'
      using errcode = 'insufficient_privilege';
  end if;
  perform app._match_office_check(p_center, p_person);
  perform app.set_audit_context('Link to the gift matching directory removed');
  delete from app.person_match_programs where person_id = p_person and center_id = p_center;
  get diagnostics v_gone = row_count;
  return v_gone > 0;
end $$;

-- ── The employers on file ────────────────────────────────────────────────────
-- p_filter: unlinked (default), linked, all. Adults with an employer on file, in order of the employer's name.
--   {"total": 12, "rows": [{"person_id", "first_name", "last_name", "preferred_name", "member_number", "employer",
--     "link": <_match_link_card> | null, "best": <candidate> | null, "candidates": 2}]}
create or replace function app.match_employers_queue(p_center uuid, p_filter text default 'unlinked', p_limit int default 50,
                                                     p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_filter text := case when p_filter in ('unlinked', 'linked', 'all') then p_filter else 'unlinked' end;
        v_total int; v_rows jsonb; v_n int;
begin
  if not app.matching_can(p_center, 'view') then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  with base as (
    select e.person_id, e.employer_name, p.first_name, p.last_name, p.preferred_name, p.member_number,
           (l.person_id is not null) as linked
      from app.person_match_employers e
      join app.people p on p.id = e.person_id
      left join app.person_match_programs l on l.person_id = e.person_id
     where e.center_id = p_center and e.withdrawn_at is null and e.employer_name is not null
       and p.merged_into_id is null and not app.person_is_minor(e.person_id)
       and (v_filter = 'all' or (v_filter = 'linked') = (l.person_id is not null))),
  pg as (
    select b.*, row_number() over (order by lower(b.employer_name), lower(b.last_name), lower(b.first_name), b.person_id) as ord
      from base b
     order by ord
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0))
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'person_id', x.person_id, 'first_name', x.first_name, 'last_name', x.last_name,
                     'preferred_name', x.preferred_name, 'member_number', x.member_number, 'employer', x.employer_name,
                     'link', case when x.linked then app._match_link_card(x.person_id) end,
                     'best', c.cands->0, 'candidates', jsonb_array_length(c.cands)) order by x.ord)
                     from pg x
                     cross join lateral (select app._match_candidates(app.employer_name_key(x.employer_name), 10) as cands) c),
                  '[]'::jsonb)
    into v_total, v_rows;
  v_n := jsonb_array_length(v_rows);
  perform app.log_private_read(p_center, 'matching', 'employers_on_file', v_n);
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app._match_entry_brief(uuid), app._match_link_card(uuid), app._match_candidates(text, int)
  from public, anon, authenticated;
revoke execute on function app.match_program_candidates(uuid, uuid), app.link_match_program(uuid, uuid, uuid),
  app.unlink_match_program(uuid, uuid), app.match_employers_queue(uuid, text, int, int) from public, anon;
grant execute on function app.match_program_candidates(uuid, uuid), app.link_match_program(uuid, uuid, uuid),
  app.unlink_match_program(uuid, uuid), app.match_employers_queue(uuid, text, int, int) to authenticated;
