-- Onboarding · stream o-setup · 3 of 5: go-live readiness checks (ONBOARDING_PLAN §4 Step 8).
--
--   app.readiness_checks     the registry: (key, title, sort, check_fn). Each stream
--                            inserts its own rows; a check function is
--                            app.check_<key>(p_center uuid) returns jsonb {ok, detail}.
--   app.readiness(center)    every registered check, in `sort` order, with its result.
--                            A check that raises is reported as not passing, with the
--                            reason, instead of failing the whole list.
--   app.readiness_all_ok(center)  true when every registered check passes.
--
-- The plan's 13 checks and their keys (the portal lists all 13 and shows an
-- unregistered one as "not built yet"):
--    1 nonprofit_verified                  o-setup   (this migration)
--    2 agreements_accepted                 o-security
--    3 owner_and_second_admin_2fa          o-security
--    4 email_domain_verified               o-messaging
--    5 texting_registered                  o-messaging
--    6 payments_live                       o-payments
--    7 quickbooks_ready                    o-quickbooks
--    8 statement_templates_approved        o-templates
--    9 setup_data_complete                 o-setup   (this migration)
--   10 records_imported_reconciled         o-import
--   11 member_legal_documents_published    o-setup   (this migration)
--   12 niva_evaluated                      o-niva
--   13 staff_trained_pilot_done            o-platform
-- Register with: insert into app.readiness_checks (key, title, sort, check_fn)
--   values ('<key>', '<title>', <n>, 'app.check_<key>'::regproc) on conflict (key) do update set …;

create table if not exists app.readiness_checks (
  key       text primary key check (key ~ '^[a-z0-9_]+$'),
  title     text not null,
  sort      int not null,
  check_fn  regproc not null
);
comment on table app.readiness_checks is
  'Go-live readiness registry (ONBOARDING_PLAN §4 Step 8). check_fn is app.check_<key>(uuid) returning jsonb {ok, detail}.';

alter table app.readiness_checks enable row level security;
drop policy if exists readiness_checks_read on app.readiness_checks;
create policy readiness_checks_read on app.readiness_checks for select to authenticated using (true);

insert into app.module_tables (table_name, module_key) values ('readiness_checks', null)
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_readiness_checks on app.readiness_checks;
create trigger audit_readiness_checks after insert or update or delete on app.readiness_checks
  for each row execute function app.audit_row('key');

-- ── The three checks this stream owns ────────────────────────────────────────
create or replace function app.check_nonprofit_verified(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare p app.org_profiles; v_who text;
begin
  select * into p from app.org_profiles where center_id = p_center;
  if not found or p.verification_status = 'unverified' then
    return jsonb_build_object('ok', false, 'detail', coalesce(p.verification_note, 'Not submitted for verification yet (Setup › Legal identity).'));
  elsif p.verification_status = 'submitted' then
    return jsonb_build_object('ok', false, 'detail', 'Submitted ' || to_char(p.submitted_at at time zone 'UTC', 'FMMonth FMDD, YYYY') || '; waiting for Community Connect to review.');
  elsif p.verification_status = 'rejected' then
    return jsonb_build_object('ok', false, 'detail', 'Sent back by Community Connect: ' || coalesce(p.verification_note, 'no note'));
  end if;
  select coalesce(nullif(pe.preferred_name, ''), pe.first_name) || ' ' || pe.last_name into v_who
    from app.center_users cu join app.people pe on pe.id = cu.person_id where cu.user_id = p.verified_by limit 1;
  return jsonb_build_object('ok', true, 'detail',
    'Verified non-profit' || coalesce(' by ' || v_who, ' by Community Connect') || ' on ' || to_char(p.verified_at at time zone 'UTC', 'FMMonth FMDD, YYYY')
    || coalesce(' (' || p.legal_name || ', EIN ' || p.ein || ')', '') || '.');
end $$;

-- Setup data for every module that is on: the automatic stage-3 steps plus
-- bank accounts (Appendix A1 "Required: Yes"). Steps the database cannot see
-- (numbering, payment methods, the QuickBooks lists) are other checks' job.
create or replace function app.check_setup_data_complete(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_auto jsonb := app.setup_auto_status(p_center, false); v_missing text[]; v_done int;
begin
  select coalesce(array_agg(s.title || coalesce(' (' || (v_auto->s.key->>'detail') || ')', '') order by s.stage, s.sort), '{}')
    into v_missing
    from app.setup_steps s
   where s.auto and s.required and (s.stage = 3 or s.key = 'svc.bank_accounts')
     and (s.module_key is null or app.module_enabled(p_center, s.module_key))
     and coalesce(v_auto->s.key->>'status', 'not_started') <> 'done';
  select count(*) into v_done
    from app.setup_steps s
   where s.auto and s.required and (s.stage = 3 or s.key = 'svc.bank_accounts')
     and (s.module_key is null or app.module_enabled(p_center, s.module_key))
     and v_auto->s.key->>'status' = 'done';
  if cardinality(v_missing) = 0 then
    return jsonb_build_object('ok', true, 'detail', 'Complete for every module that is on (' || v_done || ' checks).');
  end if;
  return jsonb_build_object('ok', false, 'detail', 'Still missing: ' || array_to_string(v_missing, '; ') || '.');
end $$;

create or replace function app.check_member_legal_documents_published(p_center uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('ok', (s->>'ok')::boolean, 'detail', s->>'detail' || '.')
    from (select app.legal_documents_status(p_center) s) x
$$;

insert into app.readiness_checks (key, title, sort, check_fn) values
  ('nonprofit_verified', 'Non-profit status verified', 1, 'app.check_nonprofit_verified'::regproc),
  ('setup_data_complete', 'Setup data complete for every module that is on', 9, 'app.check_setup_data_complete'::regproc),
  ('member_legal_documents_published', 'Member legal documents published', 11, 'app.check_member_legal_documents_published'::regproc)
on conflict (key) do update set title = excluded.title, sort = excluded.sort, check_fn = excluded.check_fn;

-- ── Running them ─────────────────────────────────────────────────────────────
create or replace function app.readiness(p_center uuid)
returns table (key text, title text, ok boolean, detail text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare r record; v jsonb;
begin
  if not (app.setup_can_manage(p_center) or app.is_platform_admin()) then
    raise exception 'You don''t have access to this community''s go-live readiness (it needs settings.manage or the owner).' using errcode = '42501';
  end if;
  for r in select c.key, c.title, c.check_fn from app.readiness_checks c order by c.sort, c.key loop
    begin
      execute format('select %s($1)', r.check_fn) into v using p_center;
      key := r.key; title := r.title;
      ok := coalesce((v->>'ok')::boolean, false);
      detail := coalesce(v->>'detail', case when ok then 'Passes.' else 'Does not pass.' end);
    exception when others then
      key := r.key; title := r.title; ok := false;
      detail := 'The check could not run: ' || sqlerrm;
    end;
    return next;
  end loop;
end $$;

create or replace function app.readiness_all_ok(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(bool_and(r.ok), false) from app.readiness(p_center) r
$$;

-- The checks run through app.readiness (which checks who is asking), never directly.
revoke execute on function app.check_nonprofit_verified(uuid), app.check_setup_data_complete(uuid),
  app.check_member_legal_documents_published(uuid) from public, anon, authenticated;
grant execute on function app.readiness(uuid), app.readiness_all_ok(uuid) to authenticated;
grant select on app.readiness_checks to authenticated;
grant all on app.readiness_checks to service_role;
grant execute on all functions in schema app to service_role;
