-- 0545: guided onboarding saves its progress on the server (save and resume), keeps the uploaded rows like
-- import staging data (masked in the audit log, deleted when finished, started over or stale), and an upload can
-- be tied to a household that is already in the records by its Connect household number.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
-- Sign in as a user; fresh 2FA, because the import engine asks for it on some steps.
create or replace function pg_temp.sign_in(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create temp table ctx (k text primary key, v text);
grant all on ctx to public;

-- ── Fixtures ────────────────────────────────────────────────────────────────
\set c '''47b00000-0000-4000-8000-0000000000c1'''
\set c2 '''47b00000-0000-4000-8000-0000000000c2'''
\set ada '''47b00000-0000-4000-8000-000000000001'''
\set tara '''47b00000-0000-4000-8000-000000000002'''
\set priya '''47b00000-0000-4000-8000-000000000003'''
\set other '''47b00000-0000-4000-8000-000000000004'''
\set boss '''47b00000-0000-4000-8000-000000000005'''
insert into auth.users (id, email, phone) values
  (:ada, 'ada47@example.com', null), (:tara, 'tara47@example.com', null),
  (:priya, 'priya47@example.com', null), (:other, 'other47@example.com', null), (:boss, 'boss47@example.com', null);
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:c, 'onbprog1', 'Orbit Forty-Seven', 'OFS', 'TX', 'active'),
  (:c2, 'onbprog2', 'Moon Forty-Seven', 'MFS', 'TX', 'active');
-- The first center admin becomes the organization's owner (0151), who holds every permission: Boss is that.
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :boss, 'center_admin'),
  (:c, :ada, 'membership_coordinator'),  -- people.manage, no giving.manage
  (:c, :tara, 'treasurer'),              -- people.manage and giving.manage
  (:c2, :other, 'center_admin');
insert into app.people (id, center_id, first_name, last_name) values
  ('47b00000-0000-4000-8000-0000000000a2', :c, 'Priya', 'Patel');
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :priya, '47b00000-0000-4000-8000-0000000000a2');

-- ── Catalog ─────────────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) = 2 from app.module_tables where table_name in ('onboarding_progress','onboarding_rows') and module_key is null),
  'both tables are in module_tables (core platform)');
select pg_temp.assert((select count(*) = 2 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                        where c.relname in ('onboarding_progress','onboarding_rows') and t.tgname = 'audit_' || c.relname
                          and t.tgfoid = 'app.audit_row'::regproc and not t.tgisinternal),
  'both tables have an audit trigger');
select pg_temp.assert((select bool_and(relrowsecurity) from pg_class where relnamespace = 'app'::regnamespace and relname in ('onboarding_progress','onboarding_rows')),
  'row-level security is on for both tables');
select pg_temp.assert(exists (select 1 from pg_policy p where p.polrelid = 'app.onboarding_rows'::regclass and p.polname = 'module_switch' and not p.polpermissive),
  'the saved rows have a restrictive module_switch policy');
select pg_temp.assert(not has_table_privilege('authenticated', 'app.onboarding_rows', 'insert')
                      and not has_table_privilege('authenticated', 'app.onboarding_rows', 'update')
                      and not has_table_privilege('authenticated', 'app.onboarding_rows', 'delete')
                      and not has_table_privilege('authenticated', 'app.onboarding_progress', 'insert')
                      and has_table_privilege('authenticated', 'app.onboarding_rows', 'select'),
  'signed-in users can only read the tables; writes go through the functions');

-- ── Permissions ─────────────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:priya);
select pg_temp.assert_raises($$select app.onboarding_current('47b00000-0000-4000-8000-0000000000c1')$$, 'people.manage',
  'a member cannot open the guided onboarding');
select pg_temp.assert_raises($$select app.onboarding_start('47b00000-0000-4000-8000-0000000000c1')$$, 'people.manage',
  'a member cannot start it');
commit;
begin;
select pg_temp.sign_in(:other);
select pg_temp.assert_raises($$select app.onboarding_start('47b00000-0000-4000-8000-0000000000c1')$$, 'people.manage',
  'an admin of another organization cannot start this one''s guided onboarding');
commit;

-- ── One draft per organization; Start twice gives the same draft ─────────────
begin;
select pg_temp.sign_in(:ada);
select pg_temp.assert(app.onboarding_current(:c) = '{"draft": null, "last": null}'::jsonb, 'before Start there is no draft');
insert into ctx select 'draft1', (app.onboarding_start(:c))->'draft'->>'id';
insert into ctx select 'draft2', (app.onboarding_start(:c))->'draft'->>'id';
select pg_temp.assert((select v from ctx where k = 'draft1') = (select v from ctx where k = 'draft2'), 'Start twice returns the same draft');
select pg_temp.assert((select count(*) = 1 from app.onboarding_progress where center_id = :c and status = 'draft'), 'there is one draft for the organization');
select pg_temp.assert((app.onboarding_current(:c))->'draft'->>'stage' = 'donations' and ((app.onboarding_current(:c))->'draft'->>'version')::int = 1
                      and (app.onboarding_current(:c))->'draft'->>'created_by_name' is not null, 'the draft starts at the first step, version 1');
commit;
select pg_temp.assert((select count(*) = 1 from app.audit_log where action = 'onboarding_progress.insert' and center_id = :c), 'starting is audited');

-- ── Saving: versions, merges, validation ─────────────────────────────────────
begin;
select pg_temp.sign_in(:ada);
select pg_temp.assert(((select app.onboarding_save((select v::uuid from ctx where k = 'draft1'), 1, 'members',
         '{"v":1,"datasets":{"members":{"status":"mapping","fileName":"members.csv"}},"qi":0}'::jsonb))->>'version')::int = 2,
  'a save returns the next version');
select pg_temp.assert_raises($$select app.onboarding_save((select v::uuid from ctx where k = 'draft1'), 1, 'family')$$, 'was changed since you opened it',
  'saving with an old version is refused, in plain words');
select pg_temp.assert(((select app.onboarding_save((select v::uuid from ctx where k = 'draft1'), 2, null, '{"qi":3}'::jsonb))->>'version')::int = 3, 'a save without a stage keeps the stage');
select pg_temp.assert((select stage = 'members' and state->>'qi' = '3' and state->'datasets'->'members'->>'fileName' = 'members.csv'
                         from app.onboarding_progress where id = (select v::uuid from ctx where k = 'draft1')),
  'state merges by key, so a later save does not lose earlier keys');
select app.onboarding_save((select v::uuid from ctx where k = 'draft1'), 3, null, null, '{"r2~r9":"merge","r4~r5":"separate"}'::jsonb);
select app.onboarding_save((select v::uuid from ctx where k = 'draft1'), 4, null, null, '{"r2~r9":null,"r7~r8":"merge"}'::jsonb);
select pg_temp.assert((select merge_answers = '{"r4~r5":"separate","r7~r8":"merge"}'::jsonb from app.onboarding_progress where id = (select v::uuid from ctx where k = 'draft1')),
  'answers merge by question, and null takes one back');
select pg_temp.assert_raises($$select app.onboarding_save((select v::uuid from ctx where k = 'draft1'), 5, null, null, '{"r1~r2":"maybe"}'::jsonb)$$, 'merge" or "separate',
  'an answer other than merge or separate is refused');
select pg_temp.assert_raises($$select app.onboarding_save((select v::uuid from ctx where k = 'draft1'), 5, 'elsewhere')$$, 'Unknown step',
  'an unknown step is refused');
select pg_temp.assert_raises($$select app.onboarding_save((select v::uuid from ctx where k = 'draft1'), 5, null, '[1,2]'::jsonb)$$, 'malformed',
  'a state that is not an object is refused');
commit;

-- ── Rows: chunks, who can read them, replacing them ─────────────────────────
begin;
select pg_temp.sign_in(:ada);
select pg_temp.assert_raises($$select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'donations', 0, '[{"name":"X"}]'::jsonb, true)$$, 'giving.manage',
  'a people manager without giving.manage cannot save past-donation rows');
select pg_temp.assert(((select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'members', 0,
    '[{"rowNo":1000002,"firstName":"Malav","lastName":"Sanghvi","email":"malav.secret@example.com","phone":"+12815550142"},
      {"rowNo":1000003,"firstName":"Palak","lastName":"Sanghvi","email":"palak.secret@example.com","phone":null}]'::jsonb, true))->>'stored')::int = 2,
  'the first chunk of an upload is stored');
select pg_temp.assert(((select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'members', 1,
    '[{"rowNo":1000004,"firstName":"Raj","lastName":"Shah","email":null,"phone":null}]'::jsonb))->>'stored')::int = 3,
  'the next chunk adds to it');
select pg_temp.assert(((select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'members', 1,
    '[{"rowNo":1000004,"firstName":"Raj","lastName":"Shah","email":null,"phone":null}]'::jsonb))->>'stored')::int = 3,
  'sending a chunk again replaces it (a retry never duplicates rows)');
select pg_temp.assert_raises($$select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'members', 2, (select jsonb_agg('{"a":1}'::jsonb) from generate_series(1, 301)))$$, 'at most 300',
  'more than 300 rows in one call is refused');
select pg_temp.assert_raises($$select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'members', 2, '{"a":1}'::jsonb)$$, 'must be a list',
  'rows that are not a list are refused');
select pg_temp.assert_raises($$select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'members', 2, '[]'::jsonb)$$, 'at least one row',
  'an empty chunk is refused unless it clears the list');
select pg_temp.assert_raises($$select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'people', 0, '[{"a":1}]'::jsonb)$$, 'Unknown list',
  'an unknown list is refused');
select pg_temp.assert((select (app.onboarding_current(:c))->'draft'->'stored' = '{"donations":0,"members":3,"family":0,"plan":0}'::jsonb), 'the draft reports how many rows are stored per list');
select pg_temp.assert((select count(*) = 2 from app.onboarding_rows where progress_id = (select v::uuid from ctx where k = 'draft1') and dataset = 'members'),
  'rows are stored in chunks (two rows hold three people)');
select pg_temp.assert((select sum(jsonb_array_length(staged_rows)) = 3 from app.onboarding_rows where dataset = 'members'), 'and read back through row-level security for the person who may');
commit;

begin;
select pg_temp.sign_in(:priya);
select pg_temp.assert((select count(*) = 0 from app.onboarding_rows) and (select count(*) = 0 from app.onboarding_progress), 'a member sees no saved rows and no draft');
commit;
begin;
select pg_temp.sign_in(:other);
select pg_temp.assert((select count(*) = 0 from app.onboarding_rows) and (select count(*) = 0 from app.onboarding_progress), 'another organization''s admin sees none of it');
select pg_temp.assert_raises($$select app.onboarding_save((select v::uuid from ctx where k = 'draft1'), null, 'review')$$, 'people.manage',
  'nor can they save to it');
select pg_temp.assert_raises($$select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'members', 5, '[{"a":1}]'::jsonb)$$, 'people.manage',
  'nor add rows to it');
commit;

-- A new upload of a list replaces the old rows and forgets the answers, which were about them.
begin;
select pg_temp.sign_in(:tara);
select pg_temp.assert(((select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'donations', 0,
    '[{"rowNo":2,"name":"Sanghvi Family","amountCents":10100}]'::jsonb, true))->>'stored')::int = 1, 'the treasurer can save past-donation rows');
select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'plan', 0, '[{"id":0,"rows":[2],"displayName":"Sanghvi Family","names":["Sanghvi Family"]}]'::jsonb, true);
select app.onboarding_save((select v::uuid from ctx where k = 'draft1'), null, null, null, '{"r2~r9":"merge"}'::jsonb);
select pg_temp.assert((select merge_answers <> '{}'::jsonb from app.onboarding_progress where id = (select v::uuid from ctx where k = 'draft1')), 'answers are there before any new upload');
select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'members', 0, '[{"rowNo":1000002,"firstName":"Malav","lastName":"Sanghvi"}]'::jsonb, true);
select pg_temp.assert((select merge_answers = '{}'::jsonb from app.onboarding_progress where id = (select v::uuid from ctx where k = 'draft1')), 'a new upload of a list forgets the answers about the old rows');
select pg_temp.assert((select count(*) = 0 from app.onboarding_rows where dataset = 'plan'), 'and the household plan built from them');
select pg_temp.assert((select (app.onboarding_current(:c))->'draft'->'stored' = '{"donations":1,"members":1,"family":0,"plan":0}'::jsonb), 'the old members rows were replaced, not added to');
select pg_temp.assert(((select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'members', 0, '[]'::jsonb, true))->>'stored')::int = 0, 'an empty first chunk clears the list (the step was skipped)');
select pg_temp.assert((select count(*) = 0 from app.onboarding_rows where dataset = 'members'), 'nothing of it is left');
commit;

-- ── The giving module switch hides past-donation rows and nothing else ──────
begin;
select pg_temp.sign_in(:tara);
select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'members', 0, '[{"rowNo":1000002,"firstName":"Malav","lastName":"Sanghvi"}]'::jsonb, true);
commit;
-- Switched off directly (the module RPC refuses while Bolis and Accounting depend on giving; the policies read this table).
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving', false, 'onboarding test');
begin;
select pg_temp.sign_in(:tara);
select pg_temp.assert((select count(*) filter (where dataset = 'donations') = 0 and count(*) filter (where dataset = 'members') = 1 from app.onboarding_rows),
  'with giving switched off the donation rows are hidden and the member rows are not');
select pg_temp.assert_raises($$select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft1'), 'donations', 0, '[{"a":1}]'::jsonb, true)$$, 'switched off',
  'and donation rows cannot be saved');
select pg_temp.assert((select (app.onboarding_current(:c))->'draft'->'can'->>'donations' = 'false' and (app.onboarding_current(:c))->'draft'->'can'->>'members' = 'true'),
  'the draft tells the wizard that past donations are unavailable');
commit;
delete from app.center_modules where center_id = :c and module_key = 'giving';
begin;
select pg_temp.sign_in(:tara);
select pg_temp.assert((select count(*) filter (where dataset = 'donations') = 1 from app.onboarding_rows), 'switched back on, the donation rows are there again');
commit;

-- ── Personal values never reach the audit log ───────────────────────────────
-- The mask is one function that several migrations have extended (0102, 0546, 0545/0548): the final one keeps every
-- key. (0546 once replaced it from the older text and silently dropped these two; this is the canary.)
select pg_temp.assert(app.audit_mask('{"staged_rows":[{"name":"X"}],"merge_answers":{"a":"merge"},"dietary_other":"no onions","date_of_birth":"2000-01-01","note":"kept"}'::jsonb)
                      = '{"staged_rows":"***","merge_answers":"***","dietary_other":"***","date_of_birth":"***","note":"kept"}'::jsonb,
  'the audit mask hides the uploaded rows and the answers as well as what earlier migrations hide');
select pg_temp.assert((select count(*) > 0 from app.audit_log where record_table = 'onboarding_rows' and center_id = :c), 'saving rows is audited');
select pg_temp.assert(not exists (select 1 from app.audit_log where record_table = 'onboarding_rows' and center_id = :c
                                    and (coalesce(after::text, '') || coalesce(before::text, '')) ~* '(sanghvi|secret@example|malav|palak)'),
  'the audit entries of the saved rows carry none of the personal values');
select pg_temp.assert((select bool_and(coalesce(after->>'staged_rows', before->>'staged_rows') = '***') from app.audit_log where record_table = 'onboarding_rows' and center_id = :c),
  'they show the rows as *** (the change is visible, the values are not)');
select pg_temp.assert((select bool_and(coalesce(after->>'merge_answers', before->>'merge_answers') = '***') from app.audit_log where record_table = 'onboarding_progress' and center_id = :c and action = 'onboarding_progress.update'),
  'and so do the answers');

-- ── Finish: rows go at once, the record stays ───────────────────────────────
begin;
select pg_temp.sign_in(:tara);
select app.onboarding_save((select v::uuid from ctx where k = 'draft1'), null, 'confirm', null, null, '{"households":{"runNumber":7,"state":"done"}}'::jsonb);
select app.onboarding_close((select v::uuid from ctx where k = 'draft1'), 'created', '{"people":{"runNumber":8,"state":"done"}}'::jsonb);
select pg_temp.assert((select count(*) = 0 from app.onboarding_rows where progress_id = (select v::uuid from ctx where k = 'draft1')), 'finishing deletes the saved rows');
select pg_temp.assert((select status = 'created' and stage = 'done' and finished_at is not null
                              and outcomes = '{"households":{"runNumber":7,"state":"done"},"people":{"runNumber":8,"state":"done"}}'::jsonb
                         from app.onboarding_progress where id = (select v::uuid from ctx where k = 'draft1')),
  'the draft is kept as created, with the imports it made');
select app.onboarding_close((select v::uuid from ctx where k = 'draft1'), 'created');
select pg_temp.assert_raises($$select app.onboarding_save((select v::uuid from ctx where k = 'draft1'), null, 'review')$$, 'already finished',
  'a finished draft cannot be saved to');
select pg_temp.assert_raises($$select app.onboarding_close((select v::uuid from ctx where k = 'draft1'), 'abandoned')$$, 'already finished',
  'nor started over');
select pg_temp.assert((select (app.onboarding_current(:c))->'draft' = 'null'::jsonb and (app.onboarding_current(:c))->'last'->'outcomes'->'households'->>'runNumber' = '7'),
  'with no draft, the wizard is told about the last finished one');
commit;

-- ── Start over, and retention ───────────────────────────────────────────────
begin;
select pg_temp.sign_in(:ada);
insert into ctx select 'draft3', (app.onboarding_start(:c))->'draft'->>'id';
select pg_temp.assert((select v from ctx where k = 'draft3') <> (select v from ctx where k = 'draft1'), 'after finishing, Start makes a new draft');
select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft3'), 'members', 0, '[{"rowNo":1000002,"firstName":"Raj","lastName":"Shah"}]'::jsonb, true);
select app.onboarding_close((select v::uuid from ctx where k = 'draft3'), 'abandoned');
select pg_temp.assert((select status = 'abandoned' from app.onboarding_progress where id = (select v::uuid from ctx where k = 'draft3')) and
                      (select count(*) = 0 from app.onboarding_rows where progress_id = (select v::uuid from ctx where k = 'draft3')), 'starting over abandons the draft and deletes its rows');
insert into ctx select 'draft4', (app.onboarding_start(:c))->'draft'->>'id';
select app.onboarding_put_rows((select v::uuid from ctx where k = 'draft4'), 'members', 0, '[{"rowNo":1000002,"firstName":"Raj","lastName":"Shah"}]'::jsonb, true);
commit;
-- Nobody touched it for 100 days (set as the database owner: the tables have no write access for users).
update app.onboarding_progress set updated_at = now() - interval '100 days' where id = (select v::uuid from ctx where k = 'draft4');
begin;
select pg_temp.sign_in(:ada);
select pg_temp.assert((app.onboarding_current(:c))->'draft' = 'null'::jsonb, 'a draft untouched for 90 days is no longer offered');
commit;
select pg_temp.assert((select status = 'abandoned' from app.onboarding_progress where id = (select v::uuid from ctx where k = 'draft4'))
                      and (select count(*) = 0 from app.onboarding_rows where progress_id = (select v::uuid from ctx where k = 'draft4')),
  'it is abandoned and its saved rows are deleted');

-- ── An upload can name a household that is already in the records by its Connect number ──
-- (Onboarding attaches people and donations to an existing household this way: no new household, no extra ID.)
insert into app.households (id, center_id, display_name, household_number) values
  ('47b00000-0000-4000-8000-0000000000b1', :c, 'Shah family', 'OFS-H-2001');
select pg_temp.assert(app.import_ref(:c, '{"$ref":"household","value":"OFS-H-2001","by":"legacy"}'::jsonb) = '47b00000-0000-4000-8000-0000000000b1',
  'the import engine finds an existing household by its Connect household number');
begin;
select pg_temp.sign_in(:tara);
insert into ctx select 'pay_run', (app.import_create_run(:c, 'payments', 'onboarding', 'onboarding-payments.csv', null, null, '{"crm_system":"onboarding"}'))->>'id';
select app.import_stage_rows((select v::uuid from ctx where k = 'pay_run'), $$[
  {"row_no":1,"source_key":"ONB-A1B2C3-P-000002","data":{"crm_external_id":"ONB-A1B2C3-P-000002","household_id":{"$ref":"household","value":"OFS-H-2001","by":"legacy"},
   "amount_cents":10100,"method":"check","received_on":"2024-09-02"}}
]$$);
select pg_temp.assert((app.import_preview((select v::uuid from ctx where k = 'pay_run'))->>'create')::int = 1, 'a donation for that household previews as a new payment, with no error');
select pg_temp.assert((app.import_commit_batch((select v::uuid from ctx where k = 'pay_run')))->>'status' = 'committed', 'and imports');
commit;
select pg_temp.assert((select household_id = '47b00000-0000-4000-8000-0000000000b1' and is_historical from app.payments where crm_external_id = 'ONB-A1B2C3-P-000002'),
  'the payment is on the existing household, as history');
select pg_temp.assert((select count(*) = 1 from app.households where center_id = :c), 'and no household was created');
select pg_temp.assert((select count(*) = 0 from app.external_ids where household_id = '47b00000-0000-4000-8000-0000000000b1'), 'nor any identifier added to the existing household');

-- People of an uploaded family join that household too. Someone already on file (same email) is updated, not
-- duplicated, and — because onboarding sends no relationship for people of an existing household — keeps the
-- relationship and primary-contact flag the office recorded.
insert into app.people (id, center_id, first_name, last_name, email) values
  ('47b00000-0000-4000-8000-0000000000a3', :c, 'Raj', 'Shah', 'raj47@example.com');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('47b00000-0000-4000-8000-0000000000b1', '47b00000-0000-4000-8000-0000000000a3', :c, 'primary', true);
begin;
select pg_temp.sign_in(:tara);
insert into ctx select 'ppl_run', (app.import_create_run(:c, 'people', 'onboarding', 'onboarding-people.csv', null, null, '{"crm_system":"onboarding"}'))->>'id';
select app.import_stage_rows((select v::uuid from ctx where k = 'ppl_run'), $$[
  {"row_no":1,"source_key":"ONB-A1B2C3-M-000001","data":{"first_name":"Raj","last_name":"Shah","email":"raj47@example.com"},
   "extra":{"legacy_id":"ONB-A1B2C3-M-000001","household_id":{"$ref":"household","value":"OFS-H-2001","by":"legacy"}}},
  {"row_no":2,"source_key":"ONB-A1B2C3-M-000002","data":{"first_name":"Mira","last_name":"Shah","email":"mira47@example.com"},
   "extra":{"legacy_id":"ONB-A1B2C3-M-000002","household_id":{"$ref":"household","value":"OFS-H-2001","by":"legacy"},"relationship":"spouse"}}
]$$);
select pg_temp.assert((select (p->>'create')::int = 1 and (p->>'update')::int = 1 and (p->>'error')::int = 0 and (p->>'needs_decision')::int = 0
                         from app.import_preview((select v::uuid from ctx where k = 'ppl_run')) p),
  'preview: the new person is added, the person already on file (same email) is an update, and nothing needs a decision');
select pg_temp.assert((app.import_commit_batch((select v::uuid from ctx where k = 'ppl_run')))->>'status' = 'committed', 'the people import runs');
commit;
select pg_temp.assert((select count(*) = 1 from app.people where center_id = :c and lower(email::text) = 'raj47@example.com'), 'the person already on file was not duplicated');
select pg_temp.assert((select role = 'primary' and is_primary from app.household_members where household_id = '47b00000-0000-4000-8000-0000000000b1' and person_id = '47b00000-0000-4000-8000-0000000000a3'),
  'and keeps the relationship and primary-contact flag the office recorded');
select pg_temp.assert((select hm.role = 'spouse' and not hm.is_primary from app.household_members hm join app.people p on p.id = hm.person_id
                        where hm.household_id = '47b00000-0000-4000-8000-0000000000b1' and lower(p.email::text) = 'mira47@example.com'),
  'the new person joins the existing household as its spouse');
select pg_temp.assert((select count(*) = 1 from app.households where center_id = :c), 'and still no household was created');
