-- 0630-0632: what a run measures, saving a result twice, and the community's memory. A second file is not asked what the community
-- has already answered; a held item (a child, a money conflict) is asked every time; a withdrawn answer is not used any more.
--   A. The numbers of a run and the inbox   B. Answers move the numbers   C. Saving the same result again   D. A changed result
--   E. A second run: the remembered answer answers its items, once   F. Withdrawing it   G. A run that is being saved for too
--   long, new rows, and the 90-day clearing
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
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
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
  perform set_config('request.headers', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.su() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
create temp table ctx (k text primary key, v text);
-- One item that claims to be answered by a remembered answer, saved into the check that is being made.
create or replace function pg_temp.item_with_rule(p_run uuid, p_batch uuid, p_rule text) returns integer language sql as $
  select app.resolve_store_items(p_run, p_batch, jsonb_build_array(jsonb_build_object(
    'key', 'shared_phone_households:k1', 'signature', 'shared_phone_households', 'kind', 'pair', 'tier', 'C', 'subject', 'f#2',
    'record_ids', jsonb_build_array('f#1', 'f#2'), 'fingerprints', jsonb_build_array('fp1', 'fp2'), 'rule_id', p_rule, 'rule_answer', 'separate')))
$;
grant all on ctx to public;
create or replace function pg_temp.cx(p_k text) returns text language sql stable as $$ select v from ctx where k = p_k $$;
create or replace function pg_temp.gid(p_run uuid, p_sig text) returns uuid language sql stable as $$
  select id from app.import_exceptions where run_id = p_run and signature = p_sig $$;
create or replace function pg_temp.iid(p_run uuid, p_key text) returns uuid language sql stable as $$
  select id from app.import_exception_items where run_id = p_run and key = p_key $$;

-- The six rows of a file: three adults, a child and a gift seen twice with different amounts. The same people turn up in every run.
create or replace function pg_temp.stage(p_run uuid) returns integer language sql as $$
  select app.resolve_stage_records(p_run, $j$[
  {"id":"f#1","source":"people111.csv","source_kind":"spreadsheet","row_no":1,"order_no":0,"kind":"person","raw":{"id":"f#1","source":"people111.csv","sourceKind":"spreadsheet","row":1,"kind":"person","name":"Mira Shah","mobile":"713-555-0142"}},
  {"id":"f#2","source":"people111.csv","source_kind":"spreadsheet","row_no":2,"order_no":1,"kind":"person","raw":{"id":"f#2","source":"people111.csv","sourceKind":"spreadsheet","row":2,"kind":"person","name":"Meera Shah","mobile":"713-555-0142"}},
  {"id":"f#3","source":"people111.csv","source_kind":"spreadsheet","row_no":3,"order_no":2,"kind":"person","raw":{"id":"f#3","source":"people111.csv","sourceKind":"spreadsheet","row":3,"kind":"person","name":"Raj Patel","mobile":"713-555-0199"}},
  {"id":"f#4","source":"people111.csv","source_kind":"spreadsheet","row_no":4,"order_no":3,"kind":"person","raw":{"id":"f#4","source":"people111.csv","sourceKind":"spreadsheet","row":4,"kind":"person","name":"Dev Shah","isChild":true,"age":9}},
  {"id":"f#5","source":"people111.csv","source_kind":"spreadsheet","row_no":5,"order_no":4,"kind":"gift","raw":{"id":"f#5","source":"people111.csv","sourceKind":"spreadsheet","row":5,"kind":"gift","gift":{"amount":"50.00","date":"2025-12-31","ref":"1042"}}},
  {"id":"f#6","source":"people111.csv","source_kind":"spreadsheet","row_no":6,"order_no":5,"kind":"gift","raw":{"id":"f#6","source":"people111.csv","sourceKind":"spreadsheet","row":6,"kind":"gift","gift":{"amount":"51.00","date":"2025-12-31","ref":"1042"}}}
]$j$::jsonb, true)
$$;

-- What the engine would hand over for those rows, saved the way the server module saves it. A remembered answer (`p_rule`) answers
-- the phone items named in `p_rule_keys`; `p_drop` leaves one item out of the result. Returns what resolve_finish returns, and the batch.
create or replace function pg_temp.store(p_run uuid, p_rule text default null, p_rule_keys text[] default '{}', p_drop text default null) returns jsonb language plpgsql as $$
declare v_batch uuid; v_items jsonb;
begin
  v_batch := app.resolve_begin(p_run, 'resolve-1-test', '{"budget":{"secondsPerQuestion":30,"secondsPerHeldMoneyItem":30,"secondsPerHeldOtherItem":1}}'::jsonb);
  perform app.resolve_store_records(p_run, v_batch, $j$[
  {"id":"f#1","normalized":{"n":1},"fingerprint":"fp1","minor":false,"minor_reasons":[],"type_uncertain":false,"problems":[],"status":"asked","how":"question","tier":"C","cluster_id":"c:f#1","duplicate_of":null},
  {"id":"f#2","normalized":{"n":2},"fingerprint":"fp2","minor":false,"minor_reasons":[],"type_uncertain":false,"problems":[],"status":"asked","how":"question","tier":"C","cluster_id":"c:f#1","duplicate_of":null},
  {"id":"f#3","normalized":{"n":3},"fingerprint":"fp3","minor":false,"minor_reasons":[],"type_uncertain":false,"problems":[],"status":"asked","how":"question","tier":"C","cluster_id":null,"duplicate_of":null},
  {"id":"f#4","normalized":{"n":4},"fingerprint":"fp4","minor":true,"minor_reasons":["flag","age"],"type_uncertain":false,"problems":[],"status":"held","how":"hold","tier":"D","cluster_id":null,"duplicate_of":null},
  {"id":"f#5","normalized":{"n":5},"fingerprint":"fp5","minor":false,"minor_reasons":[],"type_uncertain":false,"problems":[],"status":"held","how":"hold","tier":"D","cluster_id":null,"duplicate_of":null},
  {"id":"f#6","normalized":{"n":6},"fingerprint":"fp6","minor":false,"minor_reasons":[],"type_uncertain":false,"problems":[],"status":"held","how":"hold","tier":"D","cluster_id":null,"duplicate_of":"f#5"}
]$j$::jsonb);
  perform app.resolve_store_pairs(p_run, v_batch, $j$[
  {"a":"f#1","b":"f#2","relation":"same_household","strength":"medium","score":55,"independent":1,"evidence":[{"kind":"phone","independent":true,"points":40,"label":"same mobile"}],"conflicts":[],"name_level":"surname_only","name_only":false,"via_keys":[],"money":null,"tier":"C","tier_reasons":[],"hold":null,"signature":"shared_phone_households","affected":["f#2"],"implied":false},
  {"a":"f#2","b":"f#3","relation":"same_household","strength":"medium","score":50,"independent":1,"evidence":[{"kind":"phone","independent":true,"points":40,"label":"same mobile"}],"conflicts":[],"name_level":"different","name_only":false,"via_keys":[],"money":null,"tier":"C","tier_reasons":[],"hold":null,"signature":"shared_phone_households","affected":["f#3"],"implied":false},
  {"a":"f#1","b":"f#3","relation":"same_household","strength":"medium","score":50,"independent":1,"evidence":[{"kind":"phone","independent":true,"points":40,"label":"same mobile"}],"conflicts":[],"name_level":"different","name_only":false,"via_keys":[],"money":null,"tier":"C","tier_reasons":[],"hold":null,"signature":"shared_phone_households","affected":["f#3"],"implied":false},
  {"a":"f#5","b":"f#6","relation":"same_gift","strength":"medium","score":60,"independent":1,"evidence":[{"kind":"gift_ref","independent":true,"points":40,"label":"same check number"}],"conflicts":[],"name_level":"unknown","name_only":false,"via_keys":[],"money":{"kind":"amount_differs_cents","aCents":5000,"bCents":5100},"tier":"D","tier_reasons":[],"hold":"money_conflict","signature":"amount_differs_cents","affected":["f#6"],"implied":false}
]$j$::jsonb);
  perform app.resolve_store_clusters(p_run, v_batch, '[{"kind":"household","id":"c:f#1","record_ids":["f#1","f#2"],"existing":[]}]'::jsonb);
  perform app.resolve_store_groups(p_run, v_batch, $j$[
  {"signature":"duplicate_gift_two_sources","tier":"C","question":{"title":"1 gift appears in two files.","detail":"d","answers":[],"recommended":"same_gift"},"recommended":"same_gift","subject_count":1,"item_count":1,"money_cents":5000,"members":0,"contacts":0,"rank_no":0,"route_suggested":"treasurer"},
  {"signature":"amount_differs","tier":"D","question":{"title":"1 gift differs.","detail":"d","answers":[],"recommended":"hold"},"recommended":"hold","subject_count":1,"item_count":1,"money_cents":5100,"members":0,"contacts":0,"rank_no":1,"route_suggested":"treasurer"},
  {"signature":"shared_phone_households","tier":"C","question":{"title":"3 rows share a phone number with another family.","detail":"d","answers":[],"recommended":"separate"},"recommended":"separate","subject_count":3,"item_count":3,"money_cents":0,"members":3,"contacts":1,"rank_no":2,"route_suggested":"membership"},
  {"signature":"minor_record","tier":"D","question":{"title":"1 row is about a child.","detail":"d","answers":[],"recommended":"person_will_add"},"recommended":"person_will_add","subject_count":1,"item_count":1,"money_cents":0,"members":1,"contacts":0,"rank_no":3,"route_suggested":"membership"}
]$j$::jsonb);
  v_items := $j$[
  {"key":"duplicate_gift_two_sources:k6","signature":"duplicate_gift_two_sources","kind":"pair","tier":"C","subject":"f#6","record_ids":["f#5","f#6"],"fingerprints":["fp5","fp6"],"evidence_kinds":["gift_ref"],"conflict_kinds":[],"shared":{},"money_cents":5000,"members":0,"contacts":0},
  {"key":"amount_differs:k5","signature":"amount_differs","kind":"pair","tier":"D","subject":"f#6","record_ids":["f#5","f#6"],"fingerprints":["fp5","fp6"],"evidence_kinds":["gift_ref"],"conflict_kinds":[],"shared":{},"money_cents":5100,"members":0,"contacts":0},
  {"key":"shared_phone_households:k1","signature":"shared_phone_households","kind":"pair","tier":"C","subject":"f#2","record_ids":["f#1","f#2"],"fingerprints":["fp1","fp2"],"evidence_kinds":["phone"],"conflict_kinds":[],"shared":{"phone":"+17135550142","email":null,"address":null,"id":null},"money_cents":0,"members":2,"contacts":1},
  {"key":"shared_phone_households:k2","signature":"shared_phone_households","kind":"pair","tier":"C","subject":"f#3","record_ids":["f#2","f#3"],"fingerprints":["fp2","fp3"],"evidence_kinds":["phone"],"conflict_kinds":[],"shared":{"phone":"+17135550199","email":null,"address":null,"id":null},"money_cents":0,"members":2,"contacts":1},
  {"key":"shared_phone_households:k3","signature":"shared_phone_households","kind":"pair","tier":"C","subject":"f#3","record_ids":["f#1","f#3"],"fingerprints":["fp1","fp3"],"evidence_kinds":["phone"],"conflict_kinds":[],"shared":{"phone":"+17135550142","email":null,"address":null,"id":null},"money_cents":0,"members":2,"contacts":1},
  {"key":"minor_record:rec~fp4","signature":"minor_record","kind":"record","tier":"D","subject":"f#4","record_ids":["f#4"],"fingerprints":["fp4"],"evidence_kinds":[],"conflict_kinds":[],"shared":{},"money_cents":0,"members":1,"contacts":0}
]$j$::jsonb;
  v_items := (select coalesce(jsonb_agg(case when p_rule is not null and (x->>'key') = any (p_rule_keys)
                                              then x || jsonb_build_object('rule_id', p_rule, 'rule_answer', 'separate') else x end), '[]'::jsonb)
                from jsonb_array_elements(v_items) x where (x->>'key') is distinct from p_drop);
  perform app.resolve_store_items(p_run, v_batch, v_items);
  return app.resolve_finish(p_run, v_batch, '{"rows":6,"auto":2,"bulk":0,"asked":3,"held":1,"learned":0,"questions":4,"questionsPer1000":666.7}'::jsonb)
         || jsonb_build_object('batch', v_batch);
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('111b0000-0000-4000-8000-000000000001', 'ada111@example.com'), ('111b0000-0000-4000-8000-000000000002', 'tara111@example.com'),
  ('111b0000-0000-4000-8000-000000000005', 'boss111@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status) values
  ('111b0000-0000-4000-8000-0000000000c1', 'resolve111', 'Orbit One-Eleven', 'O111', 'TX', 'active');
insert into app.role_grants (center_id, user_id, role_key) values
  ('111b0000-0000-4000-8000-0000000000c1', '111b0000-0000-4000-8000-000000000005', 'center_admin'),
  ('111b0000-0000-4000-8000-0000000000c1', '111b0000-0000-4000-8000-000000000001', 'membership_coordinator'),
  ('111b0000-0000-4000-8000-0000000000c1', '111b0000-0000-4000-8000-000000000002', 'treasurer');

select pg_temp.sign_in('111b0000-0000-4000-8000-000000000001');
insert into ctx select 'runA', (app.import_create_run('111b0000-0000-4000-8000-0000000000c1', 'people', 'onboarding', 'people111.csv'))->>'id';
select pg_temp.assert(pg_temp.stage(pg_temp.cx('runA')::uuid) = 6, 'six rows are staged');
select pg_temp.assert(app.resolve_inbox(pg_temp.cx('runA')::uuid)->>'status' = 'staged', 'before a result is saved the inbox says the rows are staged and there is nothing to show');
insert into ctx select 'batchA1', (pg_temp.store(pg_temp.cx('runA')::uuid))->>'batch';

-- ── A. The numbers of a run and the inbox ───────────────────────────────────
select pg_temp.assert(app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->>'status' = 'ready'
                      and app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->>'engine_version' = 'resolve-1-test'
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->>'record_count')::int = 6
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'metrics'->>'rows')::int = 6
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'metrics'->>'asked')::int = 3
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'config'->'budget'->>'secondsPerQuestion')::int = 30
                      and app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->>'stored_at' is not null,
  'the run keeps what the engine measured and the settings it ran with');
select pg_temp.assert((app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'groups_total')::int = 4
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'questions_left')::int = 4
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'items_total')::int = 6
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'items_open')::int = 6
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'minutes_left')::numeric = 2.5,
  'how the questions stand: four questions, six items, and 2.5 minutes left by the run''s own time per question');
select pg_temp.assert(app.resolve_run_metrics('00000000-0000-4000-8000-00000000dead') is null, 'a run with no result has no numbers');
select pg_temp.assert(jsonb_array_length(app.resolve_runs('111b0000-0000-4000-8000-0000000000c1')) = 1
                      and app.resolve_runs('111b0000-0000-4000-8000-0000000000c1')->0->>'id' = pg_temp.cx('runA')
                      and app.resolve_runs('111b0000-0000-4000-8000-0000000000c1')->0->>'result' = 'ready'
                      and (app.resolve_runs('111b0000-0000-4000-8000-0000000000c1')->0->>'groups_total')::int = 4
                      and (app.resolve_runs('111b0000-0000-4000-8000-0000000000c1')->0->>'questions_left')::int = 4
                      and app.resolve_runs('111b0000-0000-4000-8000-0000000000c1')->0->>'entity' = 'people',
  'the list of imports says which have a result and how many questions are left');
select pg_temp.assert(app.resolve_inbox(pg_temp.cx('runA')::uuid)->>'status' = 'ready'
                      and (app.resolve_inbox(pg_temp.cx('runA')::uuid)->>'stalled')::boolean is false
                      and app.resolve_inbox(pg_temp.cx('runA')::uuid)->'groups'->0->>'signature' = 'duplicate_gift_two_sources'
                      and app.resolve_inbox(pg_temp.cx('runA')::uuid)->'groups'->1->>'signature' = 'amount_differs'
                      and app.resolve_inbox(pg_temp.cx('runA')::uuid)->'groups'->2->>'signature' = 'shared_phone_households'
                      and app.resolve_inbox(pg_temp.cx('runA')::uuid)->'groups'->3->>'signature' = 'minor_record',
  'the inbox ranks the questions: money first, then members');
select pg_temp.assert((app.resolve_inbox(pg_temp.cx('runA')::uuid)->'groups'->2->>'open_items')::int = 3
                      and app.resolve_inbox(pg_temp.cx('runA')::uuid)->'groups'->2->>'next_item_id' = pg_temp.iid(pg_temp.cx('runA')::uuid, 'shared_phone_households:k1')::text
                      and (app.resolve_inbox(pg_temp.cx('runA')::uuid)->'groups'->2->>'same_for_rest')::boolean
                      and (app.resolve_inbox(pg_temp.cx('runA')::uuid)->'groups'->1->>'money')::boolean
                      and not (app.resolve_inbox(pg_temp.cx('runA')::uuid)->'groups'->1->>'same_for_rest')::boolean,
  'each question says how many items are open, which one comes next, whether it can be answered for all, and whether it is about money');
select pg_temp.assert((select count(*) = 1 from app.import_record_links where run_id = pg_temp.cx('runA')::uuid and tier = 'D' and hold = 'money_conflict')
                      and (select duplicate_of = 'f#5' from app.import_staged_records where run_id = pg_temp.cx('runA')::uuid and id = 'f#6'),
  'the pairs are kept with their tier and hold, and the gift seen twice points at the one that is kept');

-- ── B. Answers move the numbers ─────────────────────────────────────────────
select pg_temp.assert((app.resolve_answer(pg_temp.gid(pg_temp.cx('runA')::uuid, 'shared_phone_households'), 'separate', null, true)->>'answered')::int = 3,
  'the phone question is answered for all three items at once (the recommended answer)');
select pg_temp.assert((app.resolve_answer(pg_temp.gid(pg_temp.cx('runA')::uuid, 'minor_record'), 'ignore_row')->>'status') = 'answered',
  'the question about a child is answered with an answer that is not the recommended one');
select pg_temp.assert((app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'questions_left')::int = 2
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'groups_answered')::int = 2
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'items_answered')::int = 4
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'answered_by_people')::int = 4
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'answered_by_rules')::int = 0
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'suggestions_accepted')::int = 3
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'minutes_left')::numeric = 1.5
                      and app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'first_answered_at' is not null,
  'two questions are left, four items were answered by a person, three of them by taking the recommended answer, and 1.5 minutes remain');
select pg_temp.assert((select count(*) = 1 from app.import_decision_rules where signature = 'shared_phone_households' and revoked_at is null)
                      and (select count(*) = 0 from app.import_decision_rules where signature = 'minor_record'),
  'one remembered answer was made (from the first item), none for the child');

-- ── C. Saving the same result again ─────────────────────────────────────────
insert into ctx select 'batchA2', (pg_temp.store(pg_temp.cx('runA')::uuid))->>'batch';
select pg_temp.assert(pg_temp.cx('batchA1') <> pg_temp.cx('batchA2'), 'each check has its own batch');
select pg_temp.assert((select count(*) = 6 from app.import_staged_records where run_id = pg_temp.cx('runA')::uuid)
                      and (select count(*) = 4 from app.import_record_links where run_id = pg_temp.cx('runA')::uuid)
                      and (select count(*) = 1 from app.import_clusters where run_id = pg_temp.cx('runA')::uuid)
                      and (select count(*) = 4 from app.import_exceptions where run_id = pg_temp.cx('runA')::uuid)
                      and (select count(*) = 6 from app.import_exception_items where run_id = pg_temp.cx('runA')::uuid),
  'saving the same result again adds nothing: the same rows, pairs, groups and items');
select pg_temp.assert((select count(distinct batch) = 1 and min(batch::text) = pg_temp.cx('batchA2') from app.import_exceptions where run_id = pg_temp.cx('runA')::uuid)
                      and (select count(distinct batch) = 1 and min(batch::text) = pg_temp.cx('batchA2') from app.import_exception_items where run_id = pg_temp.cx('runA')::uuid)
                      and (select count(distinct batch) = 1 and min(batch::text) = pg_temp.cx('batchA2') from app.import_record_links where run_id = pg_temp.cx('runA')::uuid),
  'and everything belongs to the newest check');
select pg_temp.assert((app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'items_answered')::int = 4
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'answered_by_people')::int = 4
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'questions_left')::int = 2
                      and (select status = 'answered' from app.import_exceptions where run_id = pg_temp.cx('runA')::uuid and signature = 'shared_phone_households')
                      and (select status = 'open' from app.import_exceptions where run_id = pg_temp.cx('runA')::uuid and signature = 'duplicate_gift_two_sources'),
  'the answers people gave are still there, and so is where each question stood');
select pg_temp.assert((select count(*) = 1 from app.import_decision_rules where signature = 'shared_phone_households') and (select uses = 0 from app.import_decision_rules where signature = 'shared_phone_households'),
  'saving again does not make a second remembered answer, and does not count as using it');

-- ── D. A changed result ─────────────────────────────────────────────────────
select pg_temp.store(pg_temp.cx('runA')::uuid, null, '{}', 'shared_phone_households:k3');
select pg_temp.assert(pg_temp.iid(pg_temp.cx('runA')::uuid, 'shared_phone_households:k3') is null
                      and (select count(*) = 5 from app.import_exception_items where run_id = pg_temp.cx('runA')::uuid)
                      and (select count(*) = 2 and bool_and(answer = 'separate') from app.import_exception_items where run_id = pg_temp.cx('runA')::uuid and signature = 'shared_phone_households'),
  'an item the new check no longer finds is gone, and the others keep their answers');
select pg_temp.store(pg_temp.cx('runA')::uuid);
select pg_temp.assert((select answer is null from app.import_exception_items where run_id = pg_temp.cx('runA')::uuid and key = 'shared_phone_households:k3')
                      and (select status = 'open' from app.import_exceptions where run_id = pg_temp.cx('runA')::uuid and signature = 'shared_phone_households')
                      and (app.resolve_run_metrics(pg_temp.cx('runA')::uuid)->'live'->>'questions_left')::int = 3,
  'an item that comes back is asked again, and its question opens again');
select pg_temp.assert((app.resolve_answer(pg_temp.gid(pg_temp.cx('runA')::uuid, 'shared_phone_households'), 'separate')->>'status') = 'answered', 'answering it again closes the question...');
select pg_temp.assert((select count(*) = 1 from app.import_decision_rules where signature = 'shared_phone_households' and revoked_at is null),
  '...and the same answer to the same phone is the same remembered answer');
select pg_temp.assert_raises(format($j$select app.resolve_store_pairs(%L::uuid, %L::uuid, '[]'::jsonb)$j$, pg_temp.cx('runA'), pg_temp.cx('batchA1')),
  'Another check for matches', 'a page of an older check is refused');
select pg_temp.su();

-- ── E. A second run: the remembered answer answers its items, once ──────────
select pg_temp.sign_in('111b0000-0000-4000-8000-000000000001');
select pg_temp.assert(jsonb_array_length(app.resolve_rules('111b0000-0000-4000-8000-0000000000c1')) = 1
                      and app.resolve_rules('111b0000-0000-4000-8000-0000000000c1')->0->>'signature' = 'shared_phone_households'
                      and app.resolve_rules('111b0000-0000-4000-8000-0000000000c1')->0->>'scope' = 'identifier'
                      and app.resolve_rules('111b0000-0000-4000-8000-0000000000c1')->0->>'answer' = 'separate'
                      and app.resolve_rules('111b0000-0000-4000-8000-0000000000c1')->0->'conditions'->0->>'value' = '+17135550142'
                      and app.resolve_rules('111b0000-0000-4000-8000-0000000000c1')->0->>'decidedBy' = '111b0000-0000-4000-8000-000000000001'
                      and app.resolve_rules('111b0000-0000-4000-8000-0000000000c1')->0->>'fromGroup' = 'grp:shared_phone_households'
                      and app.resolve_rules('111b0000-0000-4000-8000-0000000000c1')->0->'revokedAt' = 'null'::jsonb,
  'the community''s remembered answers come back in the shape the engine reads: which phone, what answer, who and when');
insert into ctx select 'rule', app.resolve_rules('111b0000-0000-4000-8000-0000000000c1')->0->>'id';
insert into ctx select 'runB', (app.import_create_run('111b0000-0000-4000-8000-0000000000c1', 'people', 'onboarding', 'people111-again.csv'))->>'id';
select pg_temp.assert(pg_temp.stage(pg_temp.cx('runB')::uuid) = 6, 'the same people arrive again in a second file');
-- The engine, given the remembered answer, answers the two items about the phone it was made for; the third (another phone) and
-- everything held are still asked.
insert into ctx select 'finishB', pg_temp.store(pg_temp.cx('runB')::uuid, pg_temp.cx('rule'), array['shared_phone_households:k1', 'shared_phone_households:k3'])::text;
select pg_temp.assert((pg_temp.cx('finishB')::jsonb->>'items_answered_by_rules')::int = 2, 'the second run reports two items answered by a remembered answer');
select pg_temp.assert((select count(*) = 2 and bool_and(answer = 'separate' and answer_source = 'rule:' || pg_temp.cx('rule') and answered_by is null and answered_at is not null)
                         from app.import_exception_items where run_id = pg_temp.cx('runB')::uuid and answer is not null),
  'those two items are answered by the rule, not by a person');
select pg_temp.assert((app.resolve_inbox(pg_temp.cx('runB')::uuid)->'groups'->2->>'signature') = 'shared_phone_households'
                      and (app.resolve_inbox(pg_temp.cx('runB')::uuid)->'groups'->2->>'open_items')::int = 1
                      and (app.resolve_inbox(pg_temp.cx('runB')::uuid)->'groups'->2->>'answered_items')::int = 2
                      and (app.resolve_inbox(pg_temp.cx('runB')::uuid)->'groups'->2->>'status') = 'open',
  'the phone question now has one item to ask about, not three: it never asks twice');
select pg_temp.assert((app.resolve_run_metrics(pg_temp.cx('runB')::uuid)->'live'->>'answered_by_rules')::int = 2
                      and (app.resolve_run_metrics(pg_temp.cx('runB')::uuid)->'live'->>'answered_by_people')::int = 0
                      and (app.resolve_run_metrics(pg_temp.cx('runB')::uuid)->'live'->>'items_open')::int = 4
                      and (app.resolve_run_metrics(pg_temp.cx('runB')::uuid)->'live'->>'questions_left')::int = 4,
  'two items answered by remembered answers, four still open (one phone item, the child, the money conflict, the duplicate gift)');
select pg_temp.assert((select count(*) = 0 from app.import_exception_items where run_id = pg_temp.cx('runB')::uuid and tier = 'D' and answer is not null),
  'a child and a money conflict are asked again, every time');
select pg_temp.assert((select uses = 2 and last_used_at is not null and revoked_at is null from app.import_decision_rules where id = pg_temp.cx('rule')),
  'the remembered answer counts how often it has been used, and when');
select pg_temp.store(pg_temp.cx('runB')::uuid, pg_temp.cx('rule'), array['shared_phone_households:k1', 'shared_phone_households:k3']);
select pg_temp.assert((select uses = 2 from app.import_decision_rules where id = pg_temp.cx('rule'))
                      and (select count(*) = 6 from app.import_exception_items where run_id = pg_temp.cx('runB')::uuid)
                      and (select count(*) = 2 from app.import_exception_items where run_id = pg_temp.cx('runB')::uuid and answer_source like 'rule:%'),
  'saving the second run again changes nothing, and does not use the remembered answer twice');
select pg_temp.assert((select count(*) = 3 and bool_and(answer_source in ('person', 'person_bulk')) from app.import_exception_items where run_id = pg_temp.cx('runA')::uuid and signature = 'shared_phone_households'),
  'the first run is untouched: its items are still answered by a person');
select pg_temp.su();

-- ── F. Withdrawing it ───────────────────────────────────────────────────────
select pg_temp.sign_in('111b0000-0000-4000-8000-000000000001');
select pg_temp.assert((app.resolve_revoke_rule('111b0000-0000-4000-8000-0000000000c1', pg_temp.cx('rule'))->>'items_reopened')::int = 2,
  'withdrawing the remembered answer opens the two items it had answered');
select pg_temp.assert((select count(*) = 3 from app.import_exception_items where run_id = pg_temp.cx('runB')::uuid and signature = 'shared_phone_households' and answer is null)
                      and (select count(*) = 3 from app.import_exception_items where run_id = pg_temp.cx('runA')::uuid and signature = 'shared_phone_households' and answer = 'separate')
                      and app.resolve_rules('111b0000-0000-4000-8000-0000000000c1') = '[]'::jsonb
                      and (select revoked_at is not null from app.import_decision_rules where id = pg_temp.cx('rule')),
  'the first run''s answers stand, the engine is handed no rules, and the rule is marked withdrawn, not deleted');
insert into ctx select 'batchB', app.resolve_begin(pg_temp.cx('runB')::uuid, 'resolve-1-test', '{}'::jsonb)::text;
select pg_temp.assert_raises(format($f$select pg_temp.item_with_rule(%L::uuid, %L::uuid, %L)$f$, pg_temp.cx('runB'), pg_temp.cx('batchB'), pg_temp.cx('rule')),
  'does not apply', 'a withdrawn remembered answer is refused if a result still uses it');
select pg_temp.store(pg_temp.cx('runB')::uuid);
select pg_temp.assert((select count(*) = 0 from app.import_exception_items where run_id = pg_temp.cx('runB')::uuid and answer is not null)
                      and (app.resolve_run_metrics(pg_temp.cx('runB')::uuid)->'live'->>'items_open')::int = 6,
  'a later check without the rule asks all six');
select pg_temp.assert_raises($$select app.resolve_revoke_rule('111b0000-0000-4000-8000-0000000000c1', pg_temp.cx('rule'))$$, 'already withdrawn',
  'withdrawing it twice says so');
select pg_temp.su();

-- ── G. A run that is being saved for too long, new rows, and the 90-day clearing ──
update app.import_run_metrics set status = 'storing', started_at = now() - interval '20 minutes' where run_id = pg_temp.cx('runB')::uuid;
select pg_temp.sign_in('111b0000-0000-4000-8000-000000000001');
select pg_temp.assert(app.resolve_inbox(pg_temp.cx('runB')::uuid)->>'status' = 'storing' and (app.resolve_inbox(pg_temp.cx('runB')::uuid)->>'stalled')::boolean,
  'a check that has been saving for twenty minutes is reported as stalled');
select pg_temp.store(pg_temp.cx('runB')::uuid);
select pg_temp.assert(app.resolve_inbox(pg_temp.cx('runB')::uuid)->>'status' = 'ready' and not (app.resolve_inbox(pg_temp.cx('runB')::uuid)->>'stalled')::boolean,
  'and a new check takes over');
select pg_temp.assert(pg_temp.stage(pg_temp.cx('runB')::uuid) = 6, 'staging the rows again...');
select pg_temp.assert(app.resolve_inbox(pg_temp.cx('runB')::uuid)->>'status' = 'staged', '...hides the last result until a new one is saved');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid(pg_temp.cx('runB')::uuid, 'minor_record'), 'ignore_row')$$, 'still being worked out',
  'and nothing can be answered meanwhile');
select pg_temp.su();
update app.import_runs set created_at = now() - interval '100 days' where id = pg_temp.cx('runA')::uuid;
select pg_temp.sign_in('111b0000-0000-4000-8000-000000000001');
select pg_temp.assert(pg_temp.stage(pg_temp.cx('runB')::uuid) = 6, 'staging a run again clears the original rows of runs older than 90 days');
select pg_temp.su();
select pg_temp.assert((select count(*) = 6 from app.import_staged_records where run_id = pg_temp.cx('runA')::uuid)
                      and (select count(*) = 0 from app.import_staged_records where run_id = pg_temp.cx('runA')::uuid and (raw is not null or normalized is not null))
                      and (select count(*) = 6 from app.import_staged_records where run_id = pg_temp.cx('runB')::uuid and raw is not null),
  'the old run keeps its rows'' ids and outcomes but no longer holds the uploaded data; the new run is untouched');
select pg_temp.sign_in('111b0000-0000-4000-8000-000000000001');
select pg_temp.assert_raises($$select app.resolve_begin(pg_temp.cx('runA')::uuid, 'resolve-1-test', '{}'::jsonb)$$, 'cleared after 90 days',
  'an old run cannot be checked again: its rows are gone');
select pg_temp.su();
rollback;
