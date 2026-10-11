-- B85 · D2: nothing about a child reaches an AI provider (0680).
-- app.qbo_worker_ai_input builds the JSON the background job sends to the model. A household with adults, children and
-- members of unknown age must reach it with the adults only: no child's first name (or preferred name), no unknown
-- age, and no email domain taken from a child. The whole file runs in one transaction that is rolled back, so it leaves
-- nothing behind for the other test files (27_qbo_match_test.sql counts QuickBooks customers).
\set ON_ERROR_STOP 1
\set jsh '''00000000-0000-4000-8000-000000000001'''
\set hh '''e3100000-0000-4000-8000-000000000001'''
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
grant connect_worker to postgres;
create temp table ctx (k text primary key, v text);
grant all on ctx to public;

begin;

-- ── Fixtures (test data): the Zzquillan household ────────────────────────────
-- Dates of birth are relative to today so the file does not age out.
insert into app.households (id, center_id, display_name, city, postal_code)
values (:hh, :jsh, 'Zzquillan family', 'Katy', '77494');
insert into app.people (id, center_id, first_name, last_name, preferred_name, email, date_of_birth) values
  ('e3100000-0000-4000-8000-000000000101', :jsh, 'Zandor',  'Zzquillan', null,    'zandor@adultmail.test',  '1975-03-04'),
  ('e3100000-0000-4000-8000-000000000102', :jsh, 'Zelda',   'Zzquillan', null,    null,                     null),
  ('e3100000-0000-4000-8000-000000000103', :jsh, 'Zeno',    'Zzquillan', null,    null,                     (current_date - interval '18 years')::date),
  ('e3100000-0000-4000-8000-000000000104', :jsh, 'Zoltrix', 'Zzquillan', 'Zippy', 'zoltrix@kidschool.test', (current_date - interval '9 years')::date),
  ('e3100000-0000-4000-8000-000000000105', :jsh, 'Zubin',   'Zzquillan', null,    null,                     (current_date - interval '18 years' + interval '1 day')::date),
  ('e3100000-0000-4000-8000-000000000106', :jsh, 'Zephra',  'Zzquillan', null,    null,                     null),
  ('e3100000-0000-4000-8000-000000000107', :jsh, 'Zirkon',  'Zzquillan', null,    null,                     null);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:hh, 'e3100000-0000-4000-8000-000000000101', :jsh, 'primary', true),    -- Zandor: adult, born 1975
  (:hh, 'e3100000-0000-4000-8000-000000000102', :jsh, 'spouse',  false),   -- Zelda: no birth date, but the spouse
  (:hh, 'e3100000-0000-4000-8000-000000000103', :jsh, 'sibling', false),   -- Zeno: turned 18 today, so an adult whatever the role
  (:hh, 'e3100000-0000-4000-8000-000000000104', :jsh, 'child',   false),   -- Zoltrix: 9, preferred name Zippy, own email domain
  (:hh, 'e3100000-0000-4000-8000-000000000105', :jsh, 'sibling', false),   -- Zubin: turns 18 tomorrow, still a minor whatever the role
  (:hh, 'e3100000-0000-4000-8000-000000000106', :jsh, 'child',   false),   -- Zephra: a child with no birth date
  (:hh, 'e3100000-0000-4000-8000-000000000107', :jsh, 'other',   false);   -- Zirkon: unknown age, no adult role
select pg_temp.assert((select count(*) = 7 from app.household_members where household_id = :hh and left_at is null),
  'fixture: the household has seven current members, so the checks below are not vacuous');

-- ── The worker asks for what goes to the model ───────────────────────────────
set local role connect_worker;
select pg_temp.assert(app.qbo_worker_store_customers(:jsh, '[{"qbo_id":"T131-1","display_name":"Zzquillan Family","family_name":"Zzquillan"}]'::jsonb) = 1,
  'fixture: the QuickBooks customer is copied');
insert into ctx select 'ai', app.qbo_worker_ai_input(:jsh, 200)::text;
reset role;
insert into ctx
select 'cand', c::text
  from jsonb_array_elements((select v::jsonb from ctx where k = 'ai')) r, jsonb_array_elements(r->'candidates') c
 where r->>'qbo_id' = 'T131-1' and c->>'household_id' = 'e3100000-0000-4000-8000-000000000001';

select pg_temp.assert(exists (select 1 from ctx where k = 'cand'),
  'the customer goes to the model with the Zzquillan household as a candidate');
select pg_temp.assert((select v::jsonb->'member_first_names' = '["Zandor","Zelda","Zeno"]'::jsonb from ctx where k = 'cand'),
  'the adults are named: the 1975 primary member, the spouse with no birth date, and the member who turned 18 today');
select pg_temp.assert((select position('zoltrix' in lower(v)) = 0 and position('zippy' in lower(v)) = 0 from ctx where k = 'ai'),
  'D2: a child''s first name and preferred name never appear in the JSON the model receives');
select pg_temp.assert((select position('zubin' in lower(v)) = 0 from ctx where k = 'ai'),
  'D2: someone who turns 18 tomorrow is still a child');
select pg_temp.assert((select position('zephra' in lower(v)) = 0 and position('zirkon' in lower(v)) = 0 from ctx where k = 'ai'),
  'D2: a member with no birth date and no adult role (a child, or an unknown age) never appears');
select pg_temp.assert((select v::jsonb->'email_domains' = '["adultmail.test"]'::jsonb and position('kidschool' in lower(v)) = 0 from ctx where k = 'cand')
                      and (select position('kidschool' in lower(v)) = 0 from ctx where k = 'ai'),
  'D2: the email domains come from the adults only; a child''s domain is not sent');

-- ── The grants are the ones 0243 gave ────────────────────────────────────────
select pg_temp.assert(has_function_privilege('connect_worker', 'app.qbo_worker_ai_input(uuid, int)', 'execute')
                      and not has_function_privilege('authenticated', 'app.qbo_worker_ai_input(uuid, int)', 'execute')
                      and not has_function_privilege('anon', 'app.qbo_worker_ai_input(uuid, int)', 'execute'),
  'only the background service can call it');

rollback;
