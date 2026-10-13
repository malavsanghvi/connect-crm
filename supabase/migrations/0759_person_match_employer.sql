-- 0759 · CatchTheMatch slice 1, the People part: an employer for gift matching, on file only with the person's consent
-- (docs/CATCH_THE_MATCH.md section 6; owner answers of 2026-10-13). Builder PRIV.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.person_match_employers   one row per person: the employer whose matching program their gifts may go to, where it
--                                came from (the person in the app, or a paper form the office recorded), who recorded it,
--                                when, and the consent row behind it (app.consents, kind 'employer_matching').
--   It is NOT app.people.employer: that field is edited by staff, filled by imports and seen with people.view, with no
--   consent. It stays exactly as it is; it only PREFILLS the person's own answer ("Is this still your employer?").
--
--   Adults only (D2): a person under 18 by app.person_is_minor (0587) never has a row, whoever writes it.
--   The person (their own sign-in, not other adults of the household):
--     app.my_match_employer(center)                 what is on file, how it got there, and the suggestion from their profile
--     app.set_my_match_employer(center, employer)   adds or changes it (CatchTheMatch must be on), recording their consent
--     app.remove_my_match_employer(center)          removes it at once (even with CatchTheMatch off) and records the
--                                                   withdrawal; the row is deleted, nothing of it is kept
--   The office (matching.manage, through 0757's check: never a platform admin, never the filing grant):
--     app.record_match_employer(center, person, employer)   from a signed paper form: source 'paper_form', who recorded it
--                                                   and when; the consent row says the same. The person sees and removes
--                                                   it in the member app like any other.
--   Staff read the rows with app.matching_can(center, 'view') (0758): CatchTheMatch's own readers and a live Weaver filing
--   grant. People.view alone sees nothing. No AI feature reads this table.
--   Module 'matching' in app.module_tables, with a restrictive module_switch policy that has no platform-admin pass. The
--   person's own functions are SECURITY DEFINER, so removing works whatever the module says.
--   Audit: app.audit_private_row (0758): who, when and which columns, never the employer's name; the entries belong to
--   CatchTheMatch (0758's audit_read keeps them from platform admins and from audit.view alone).
set client_min_messages = warning;

create table if not exists app.person_match_employers (
  person_id     uuid primary key references app.people(id) on delete cascade,
  center_id     uuid not null references app.centers(id) on delete cascade,
  employer_name text not null check (char_length(btrim(employer_name)) between 1 and 120),
  source        text not null check (source in ('member', 'paper_form')),
  recorded_by   uuid not null references auth.users(id),
  recorded_at   timestamptz not null default now(),
  consent_id    uuid not null references app.consents(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index if not exists person_match_employers_center_idx on app.person_match_employers (center_id);
comment on table app.person_match_employers is
  'An adult''s employer for gift matching (0759, CatchTheMatch), on file only with their consent (consents kind employer_matching). Written only by set_my_match_employer / record_match_employer, removed by remove_my_match_employer. Read by the person and by matching_can(view). Not people.employer.';
comment on column app.person_match_employers.source is 'member: the person gave it in the app. paper_form: the office recorded it from a signed paper form (recorded_by, recorded_at).';

-- The row belongs to its person's community and to an adult; the name is trimmed. SECURITY DEFINER so the birth date and
-- household roles can be read whoever writes.
create or replace function app.person_match_employers_check() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.people;
begin
  select * into p from app.people where id = new.person_id;
  if p.id is null then raise exception 'That person was not found.' using errcode = '23503'; end if;
  if tg_op = 'UPDATE' and new.person_id is distinct from old.person_id then
    raise exception 'An employer on file belongs to one person and cannot be moved to another.' using errcode = '23514';
  end if;
  new.center_id := p.center_id;
  if app.person_is_minor(p.id) then
    raise exception 'An employer for gift matching can be recorded for an adult only.' using errcode = '23514';
  end if;
  new.employer_name := btrim(regexp_replace(coalesce(new.employer_name, ''), '\s+', ' ', 'g'));
  if char_length(new.employer_name) not between 1 and 120 then
    raise exception 'Enter the employer''s name (at most 120 characters).' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function app.person_match_employers_check() from public, anon, authenticated;
drop trigger if exists person_match_employers_check on app.person_match_employers;
create trigger person_match_employers_check before insert or update on app.person_match_employers
  for each row execute function app.person_match_employers_check();

drop trigger if exists audit_person_match_employers on app.person_match_employers;
create trigger audit_person_match_employers after insert or update or delete on app.person_match_employers
  for each row execute function app.audit_private_row('matching', 'person_id');
insert into app.module_tables (table_name, module_key) values ('person_match_employers', 'matching')
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.person_match_employers enable row level security;
drop policy if exists person_match_employers_own_read on app.person_match_employers;
create policy person_match_employers_own_read on app.person_match_employers for select to authenticated
  using (person_id = app.my_person_id(center_id));
drop policy if exists person_match_employers_staff_read on app.person_match_employers;
create policy person_match_employers_staff_read on app.person_match_employers for select to authenticated
  using (app.matching_can(center_id, 'view'));
-- CatchTheMatch off: hidden from every direct read (no platform-admin pass: platform admins have no read here at all).
drop policy if exists module_switch on app.person_match_employers;
create policy module_switch on app.person_match_employers as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])));
-- No write policies: only the functions below write.
revoke all on app.person_match_employers from public, anon, authenticated;
grant select on app.person_match_employers to authenticated;
grant all on app.person_match_employers to service_role;

-- ── The person ───────────────────────────────────────────────────────────────

-- The caller's own person in the community, or a plain-English error.
create or replace function app._my_person_or_raise(p_center uuid) returns uuid
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  v := app.my_person_id(p_center);
  if v is null then
    raise exception 'Your sign-in is not linked to a person in this community.' using errcode = 'insufficient_privilege';
  end if;
  return v;
end $$;

create or replace function app._match_employer_card(p_person uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'employer', e.employer_name,
    'source', e.source,
    'recorded_at', e.recorded_at,
    'recorded_by', case when e.source = 'paper_form' then app._user_label(p.center_id, e.recorded_by) end,
    -- From the profile, to confirm: only while nothing is on file, and only for an adult.
    'suggestion', case when e.person_id is null and not app.person_is_minor(p.id) then nullif(btrim(coalesce(p.employer, '')), '') end,
    'is_adult', not app.person_is_minor(p.id),
    'matching_on', app._org_private_module_on(p.center_id, 'matching'))
    from app.people p
    left join app.person_match_employers e on e.person_id = p.id
   where p.id = p_person
$$;

create or replace function app.my_match_employer(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  return app._match_employer_card(app._my_person_or_raise(p_center));
end $$;

-- One consent row per change: granted when an employer is put on file, withdrawn when it is removed.
create or replace function app._record_match_consent(p_center uuid, p_person uuid, p_granted boolean, p_source text) returns uuid
language sql security definer set search_path = app, public, extensions as $$
  insert into app.consents (center_id, person_id, given_by_user, kind, granted, source)
  values (p_center, p_person, auth.uid(), 'employer_matching', p_granted, p_source)
  returning id
$$;

create or replace function app._put_match_employer(p_center uuid, p_person uuid, p_employer text, p_source text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_consent uuid;
begin
  if app.person_is_minor(p_person) then
    raise exception 'An employer for gift matching can be recorded for an adult only.' using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(p_employer, ''))) not between 1 and 120 then
    raise exception 'Enter the employer''s name (at most 120 characters).' using errcode = '22023';
  end if;
  v_consent := app._record_match_consent(p_center, p_person, true, case p_source when 'paper_form' then 'paper_form' else 'app' end);
  insert into app.person_match_employers (person_id, center_id, employer_name, source, recorded_by, recorded_at, consent_id)
  values (p_person, p_center, p_employer, p_source, auth.uid(), now(), v_consent)
  on conflict (person_id) do update
    set employer_name = excluded.employer_name, source = excluded.source, recorded_by = excluded.recorded_by,
        recorded_at = excluded.recorded_at, consent_id = excluded.consent_id;
end $$;

create or replace function app.set_my_match_employer(p_center uuid, p_employer text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_person uuid := app._my_person_or_raise(p_center);
begin
  if not app._org_private_module_on(p_center, 'matching') then
    raise exception '% is not on for this community, so an employer for gift matching cannot be added.',
      app._module_label(p_center, 'matching') using errcode = 'insufficient_privilege';
  end if;
  perform app.set_audit_context('Added or changed by the person in the app');
  perform app._put_match_employer(p_center, v_person, p_employer, 'member');
  return app._match_employer_card(v_person);
end $$;

create or replace function app.remove_my_match_employer(p_center uuid) returns boolean
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_person uuid := app._my_person_or_raise(p_center); v_gone int;
begin
  perform app.set_audit_context('Removed by the person');
  delete from app.person_match_employers where person_id = v_person;
  get diagnostics v_gone = row_count;
  if v_gone > 0 then perform app._record_match_consent(p_center, v_person, false, 'app'); end if;
  return v_gone > 0;
end $$;

-- ── The office: from a signed paper form ─────────────────────────────────────
create or replace function app.record_match_employer(p_center uuid, p_person uuid, p_employer text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if not app.matching_can(p_center, 'manage') then
    raise exception 'Recording an employer for gift matching needs the CatchTheMatch manager role (matching.manage).'
      using errcode = 'insufficient_privilege';
  end if;
  if p_person is null or not exists (select 1 from app.people where id = p_person and center_id = p_center) then
    raise exception 'That person was not found in this community.';
  end if;
  if exists (select 1 from app.people where id = p_person and (is_deceased or merged_into_id is not null)) then
    raise exception 'This person''s record is closed (deceased or merged), so nothing new can be recorded for them.';
  end if;
  perform app.set_audit_context('Recorded from a paper form');
  perform app._put_match_employer(p_center, p_person, p_employer, 'paper_form');
  return app._match_employer_card(p_person);
end $$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app._my_person_or_raise(uuid), app._match_employer_card(uuid),
  app._record_match_consent(uuid, uuid, boolean, text), app._put_match_employer(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function app.my_match_employer(uuid), app.set_my_match_employer(uuid, text), app.remove_my_match_employer(uuid),
  app.record_match_employer(uuid, uuid, text) from public, anon;
grant execute on function app.my_match_employer(uuid), app.set_my_match_employer(uuid, text), app.remove_my_match_employer(uuid),
  app.record_match_employer(uuid, uuid, text) to authenticated;
grant execute on all functions in schema app to service_role;
