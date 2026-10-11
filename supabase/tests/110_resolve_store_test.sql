-- 0630-0632: the matching questions are kept in the database (B87). Who can see them, who can answer them, what an answer does to
-- the other items of the same question, what is remembered, and that nothing held (a child, a money conflict) can ever be answered
-- from a remembered answer.
--   A. The catalog, the tables and the guards in the tables   B. Who can stage, read and open a card (a volunteers-only importer, a
--   guest, a platform admin)   C. Answering one item, "the same answer for the other N" with the number the person saw, changing an
--   answer on purpose, what is remembered and how widely   D. Children: one by one, never remembered   E. Gift questions need
--   giving.manage for everything done to them   F. Putting a question off, skipping it, sending it on   G. A result is refused when
--   it uses a remembered answer, or describes an item, where it must not   H. Taking answers back   I. Taking back goes no
--   further than the person may   J. What is audited
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
-- A visitor who is signed in but is nobody (no claims at all).
create or replace function pg_temp.guest() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
-- One item that claims to be answered by a remembered answer, saved into the check that is being made.
create or replace function pg_temp.item_with_rule(p_run uuid, p_batch uuid, p_key text, p_sig text, p_kind text, p_tier text, p_rule text, p_answer text,
                                                  p_shared jsonb default '{}', p_evidence jsonb default '[]') returns integer language sql as $$
  select app.resolve_store_items(p_run, p_batch, jsonb_build_array(jsonb_build_object(
    'key', p_key, 'signature', p_sig, 'kind', p_kind, 'tier', p_tier, 'subject', 'f#2', 'record_ids', jsonb_build_array('f#1', 'f#2'),
    'fingerprints', jsonb_build_array('fp1', 'fp2'), 'shared', p_shared, 'evidence_kinds', p_evidence, 'rule_id', p_rule, 'rule_answer', p_answer)))
$$;
-- One item with no remembered answer, about the rows given.
create or replace function pg_temp.raw_item(p_run uuid, p_batch uuid, p_key text, p_sig text, p_kind text, p_tier text, p_records jsonb) returns integer language sql as $$
  select app.resolve_store_items(p_run, p_batch, jsonb_build_array(jsonb_build_object(
    'key', p_key, 'signature', p_sig, 'kind', p_kind, 'tier', p_tier, 'subject', 'x', 'record_ids', p_records,
    'fingerprints', jsonb_build_array('fpx', 'fpy'))))
$$;
grant all on ctx to public;
create or replace function pg_temp.cx(p_k text) returns text language sql stable as $$ select v from ctx where k = p_k $$;
create or replace function pg_temp.gid(p_sig text) returns uuid language sql stable as $$
  select id from app.import_exceptions where run_id = pg_temp.cx('run')::uuid and signature = p_sig $$;
create or replace function pg_temp.iid(p_key text) returns uuid language sql stable as $$
  select id from app.import_exception_items where run_id = pg_temp.cx('run')::uuid and key = p_key $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('110b0000-0000-4000-8000-000000000001', 'ada110@example.com'), ('110b0000-0000-4000-8000-000000000002', 'tara110@example.com'),
  ('110b0000-0000-4000-8000-000000000003', 'priya110@example.com'), ('110b0000-0000-4000-8000-000000000004', 'other110@example.com'),
  ('110b0000-0000-4000-8000-000000000005', 'boss110@example.com'), ('110b0000-0000-4000-8000-000000000006', 'vera110@example.com'),
  ('110b0000-0000-4000-8000-000000000007', 'gina110@example.com');
insert into app.accounts (user_id, is_platform_admin) values ('110b0000-0000-4000-8000-000000000007', true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status) values
  ('110b0000-0000-4000-8000-0000000000c1', 'resolve110a', 'Orbit One-Ten', 'O110', 'TX', 'active'),
  ('110b0000-0000-4000-8000-0000000000c2', 'resolve110b', 'Moon One-Ten', 'M110', 'TX', 'active');
-- Boss is the first center admin (the owner). Ada: people.manage, no giving.manage. Tara: people.manage and giving.manage. Vera may
-- import volunteers and nothing in people or giving. Gina is a platform admin.
insert into app.role_grants (center_id, user_id, role_key) values
  ('110b0000-0000-4000-8000-0000000000c1', '110b0000-0000-4000-8000-000000000005', 'center_admin'),
  ('110b0000-0000-4000-8000-0000000000c1', '110b0000-0000-4000-8000-000000000001', 'membership_coordinator'),
  ('110b0000-0000-4000-8000-0000000000c1', '110b0000-0000-4000-8000-000000000002', 'treasurer'),
  ('110b0000-0000-4000-8000-0000000000c1', '110b0000-0000-4000-8000-000000000006', 'volunteer_coordinator'),
  ('110b0000-0000-4000-8000-0000000000c2', '110b0000-0000-4000-8000-000000000004', 'center_admin');

-- ── A. The catalog, the tables and who may touch them ───────────────────────
select pg_temp.assert((select count(*) = 16 from app.import_signatures), 'the 16 kinds of question are in the catalog');
select pg_temp.assert((select count(*) = 5 and bool_and(not rememberable) from app.import_signatures where tier = 'D'),
  'every held kind (a child, a money conflict, an unknown kind, an unreadable amount) is a kind that cannot be remembered');
select pg_temp.assert((select bool_and(not rememberable) and count(*) = 4 from app.import_signatures where money),
  'no question about money can be remembered: a gift is decided again each time');
select pg_temp.assert((select not rememberable from app.import_signatures where signature = 'name_only'),
  'and a question that has only a name to go on cannot be remembered either');
select pg_temp.assert((select array_agg(signature order by signature) = array['spouse_maiden_name'] from app.import_signatures where 'pattern' = any (scopes)),
  'only one kind of question can be remembered as a pattern, and it has an address to go on');
select pg_temp.assert((select not same_for_rest from app.import_signatures where signature = 'minor_record'),
  'a child''s row is never answered together with others');
select pg_temp.assert((select bool_and((tier = 'D') = (signature in ('amount_differs_cents', 'amount_differs', 'minor_record', 'uncertain_type', 'unreadable_money')))
                         and bool_and(item_kind = case when signature in ('low_confidence_read', 'minor_record', 'uncertain_type', 'unreadable_money') then 'record' else 'pair' end)
                         from app.import_signatures),
  'the catalog says which kinds are held and which are about one row: the database does not take the caller''s word for it');
select pg_temp.assert((select bool_and(answers[1] is not null and cardinality(answers) <= 3) from app.import_signatures), 'each kind has a recommended answer first and at most three answers');
select pg_temp.assert((select count(*) = 8 from app.module_tables where module_key is null
                         and table_name in ('import_signatures', 'import_decision_rules', 'import_run_metrics', 'import_staged_records',
                                            'import_record_links', 'import_clusters', 'import_exceptions', 'import_exception_items')),
  'the eight tables belong to the core platform');
select pg_temp.assert((select bool_and(c.relrowsecurity) and count(*) = 8 from pg_class c
                        where c.relnamespace = 'app'::regnamespace
                          and c.relname in ('import_signatures', 'import_decision_rules', 'import_run_metrics', 'import_staged_records',
                                            'import_record_links', 'import_clusters', 'import_exceptions', 'import_exception_items')),
  'row-level security is on for all eight');
select pg_temp.assert((select bool_and(has_table_privilege('authenticated', 'app.' || t, 'select')
                                       and not has_table_privilege('authenticated', 'app.' || t, 'insert')
                                       and not has_table_privilege('authenticated', 'app.' || t, 'update')
                                       and not has_table_privilege('authenticated', 'app.' || t, 'delete'))
                         from unnest(array['import_signatures', 'import_decision_rules', 'import_run_metrics', 'import_staged_records',
                                           'import_record_links', 'import_clusters', 'import_exceptions', 'import_exception_items']) t),
  'signed-in users can only read the tables: every change goes through the functions');
select pg_temp.assert((select count(*) = 2 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                        where c.relnamespace = 'app'::regnamespace and c.relname in ('import_signatures', 'import_run_metrics')
                          and t.tgname = 'audit_' || c.relname and t.tgfoid = 'app.audit_row'::regproc and not t.tgisinternal),
  'the catalog and the run header (settings and numbers, nothing personal) are audited row by row');
select pg_temp.assert((select count(*) = 0 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                        where c.relnamespace = 'app'::regnamespace
                          and c.relname in ('import_staged_records', 'import_record_links', 'import_clusters', 'import_exceptions', 'import_exception_items', 'import_decision_rules')
                          and t.tgfoid = 'app.audit_row'::regproc),
  'the uploaded rows, what was derived from them, the questions, the items and the remembered answers are not copied into the audit log row by row');
select pg_temp.assert((select bool_and(not has_table_privilege('anon', 'app.' || t, 'select') and not has_table_privilege('anon', 'app.' || t, 'insert'))
                         from unnest(array['import_decision_rules', 'import_run_metrics', 'import_staged_records', 'import_record_links', 'import_clusters',
                                           'import_exceptions', 'import_exception_items']) t)
                      and not has_function_privilege('anon', 'app.resolve_inbox(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.resolve_answer(uuid, text, uuid, boolean, boolean, text, integer, boolean)', 'execute')
                      and not has_function_privilege('anon', 'app.resolve_rules(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.resolve_item_detail(uuid)', 'execute'),
  'a visitor who is not signed in at all can read none of it and call none of it');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.resolve_purge(integer)', 'execute')
                      and not has_function_privilege('service_role', 'app.resolve_purge(integer)', 'execute')
                      and has_function_privilege('connect_worker', 'app.resolve_purge(integer)', 'execute'),
  'the retention sweep is the background service''s alone');
select pg_temp.assert((select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                         from pg_proc p where p.pronamespace = 'app'::regnamespace
                           and p.proname in ('resolve_stage_records', 'resolve_begin', 'resolve_store_records', 'resolve_store_pairs', 'resolve_store_clusters',
                                             'resolve_store_groups', 'resolve_store_items', 'resolve_finish', 'resolve_answer', 'resolve_set_group_status',
                                             'resolve_reopen', 'resolve_revoke_rule', 'resolve_rules', 'resolve_assert_run', 'resolve_assert_batch', 'resolve_withdraw',
                                             'resolve_purge', 'resolve_assert_money', 'resolve_money_ok')),
  'every function that writes is a security definer with the pinned search path');
select pg_temp.assert((select bool_and(not p.prosecdef) from pg_proc p where p.pronamespace = 'app'::regnamespace
                         and p.proname in ('resolve_inbox', 'resolve_item_detail', 'resolve_run_metrics', 'resolve_staged_page', 'resolve_progress')),
  'the reading functions run as the signed-in person, so row-level security decides what they return');
select pg_temp.assert_raises($$insert into app.import_decision_rules (id, center_id, signature, scope, conditions, answer)
    values ('rule:x', '110b0000-0000-4000-8000-0000000000c1', 'minor_record', 'exact_pair', '[{"type":"pair","fingerprints":["a","b"]}]', 'separate')$$,
  'never remembered', 'a remembered answer for a child is refused');
select pg_temp.assert_raises($$insert into app.import_decision_rules (id, center_id, signature, scope, conditions, answer)
    values ('rule:y', '110b0000-0000-4000-8000-0000000000c1', 'amount_differs', 'exact_pair', '[{"type":"pair","fingerprints":["a","b"]}]', 'separate')$$,
  'never remembered', 'and for a money conflict');
select pg_temp.assert_raises($$insert into app.import_decision_rules (id, center_id, signature, scope, conditions, answer)
    values ('rule:z', '110b0000-0000-4000-8000-0000000000c1', 'name_only', 'exact_pair', '[{"type":"pair","fingerprints":["a","b"]}]', 'same_person')$$,
  'never remembered', 'and for a name alone');
select pg_temp.assert_raises($$insert into app.import_decision_rules (id, center_id, signature, scope, conditions, answer)
    values ('rule:g', '110b0000-0000-4000-8000-0000000000c1', 'duplicate_gift_two_sources', 'exact_pair', '[{"type":"pair","fingerprints":["a","b"]}]', 'separate')$$,
  'never remembered', 'and for a gift in two sources');
select pg_temp.assert_raises($$insert into app.import_decision_rules (id, center_id, signature, scope, conditions, answer)
    values ('rule:p', '110b0000-0000-4000-8000-0000000000c1', 'shared_phone_households', 'pattern', '[{"type":"evidence","requires":["phone"],"allowsConflicts":[]}]', 'separate')$$,
  'not a way to remember', 'a phone question cannot be remembered as a pattern');
select pg_temp.assert_raises($$insert into app.import_decision_rules (id, center_id, signature, scope, conditions, answer)
    values ('rule:n', '110b0000-0000-4000-8000-0000000000c1', 'spouse_maiden_name', 'pattern', '[{"type":"evidence","requires":["name"],"allowsConflicts":[]}]', 'same_household')$$,
  'name alone', 'a remembered answer never joins two records because of a name alone');
select pg_temp.assert_raises($$insert into app.import_decision_rules (id, center_id, signature, scope, conditions, answer)
    values ('rule:i', '110b0000-0000-4000-8000-0000000000c1', 'shared_phone_households', 'identifier', '[{"type":"identifier","field":"phone","value":" "}]', 'separate')$$,
  'needs which one', 'nor from a phone number that is blank');
select pg_temp.assert_raises($$insert into app.import_decision_rules (id, center_id, signature, scope, conditions, answer)
    values ('rule:a', '110b0000-0000-4000-8000-0000000000c1', 'shared_phone_households', 'identifier', '[{"type":"identifier","field":"phone","value":"+1"}]', 'same_gift')$$,
  'not one of the answers', 'nor with an answer that is not one of the question''s');

-- ── B. Who can stage, read and open a card ──────────────────────────────────
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000001');
insert into ctx select 'run', (app.import_create_run('110b0000-0000-4000-8000-0000000000c1', 'people', 'onboarding', 'people110.csv'))->>'id';
select pg_temp.su();

select pg_temp.sign_in('110b0000-0000-4000-8000-000000000003');
select pg_temp.assert_raises($$select app.resolve_stage_records(pg_temp.cx('run')::uuid, '[]'::jsonb, true)$$, 'needs one of these permissions',
  'a member cannot stage rows for matching');
select pg_temp.assert_raises($$select app.resolve_rules('110b0000-0000-4000-8000-0000000000c1')$$, 'permissions', 'a member cannot read the remembered answers');
select pg_temp.su();
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000004');
select pg_temp.assert_raises($$select app.resolve_stage_records(pg_temp.cx('run')::uuid, '[]'::jsonb, true)$$, 'needs one of these permissions',
  'an admin of another community cannot stage rows for this one');
select pg_temp.su();

-- Someone who may import only volunteers (and nothing in people or giving) gets nothing; and a file of another kind is not matched.
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000006');
insert into ctx select 'vrun', (app.import_create_run('110b0000-0000-4000-8000-0000000000c1', 'volunteer_interests', 'onboarding', 'vol110.csv'))->>'id';
select pg_temp.assert_raises($$select app.resolve_stage_records(pg_temp.cx('vrun')::uuid, '[]'::jsonb, true)$$, 'not a people, households or donations file',
  'a file of another kind is not checked for matches, even by the person who may import it');
select pg_temp.assert_raises($$select app.resolve_begin(pg_temp.cx('vrun')::uuid, 'x', '{}'::jsonb)$$, 'not a people, households or donations file', 'nor begun');
select pg_temp.assert_raises($$select app.resolve_stage_records(pg_temp.cx('run')::uuid, '[]'::jsonb, true)$$, 'needs one of these permissions',
  'and that person cannot stage a people file');
select pg_temp.assert_raises($$select app.resolve_runs('110b0000-0000-4000-8000-0000000000c1')$$, 'permissions', 'cannot list the imports that can be checked');
select pg_temp.assert_raises($$select app.resolve_rules('110b0000-0000-4000-8000-0000000000c1')$$, 'permissions', 'cannot read the remembered answers');
select pg_temp.assert_raises($$select app.resolve_revoke_rule('110b0000-0000-4000-8000-0000000000c1', 'rule:x')$$, 'permissions', 'cannot withdraw one');
select pg_temp.assert(cardinality(app.resolve_runs_allowed()) = 0, 'and may use no run for matching');
select pg_temp.su();

-- A visitor who is signed in but is nobody.
select pg_temp.guest();
select pg_temp.assert_raises($$select app.resolve_stage_records(pg_temp.cx('run')::uuid, '[]'::jsonb, true)$$, 'needs one of these permissions', 'a guest cannot stage rows');
select pg_temp.assert_raises($$select app.resolve_rules('110b0000-0000-4000-8000-0000000000c1')$$, 'permissions', 'nor read the remembered answers');
select pg_temp.assert(cardinality(app.resolve_runs_allowed()) = 0 and (select count(*) = 0 from app.import_exceptions) and (select count(*) = 0 from app.import_staged_records),
  'and sees nothing');
select pg_temp.su();

select pg_temp.sign_in('110b0000-0000-4000-8000-000000000001');
select pg_temp.assert(app.resolve_stage_records(pg_temp.cx('run')::uuid, $$[
  {"id":"f#1","source":"people110.csv","source_kind":"spreadsheet","row_no":1,"order_no":0,"kind":"person","raw":{"id":"f#1","source":"people110.csv","sourceKind":"spreadsheet","row":1,"kind":"person","name":"Mira Shah","mobile":"713-555-0142","email":"mira110@example.com","address1":"12 Lotus Ln","zip":"77478","dob":"1984-03-02","children":"Dev, Anu","notes":"allergic to nuts","school":"Lotus Elementary","ids":{"household_number":"0417"}}},
  {"id":"f#2","source":"people110.csv","source_kind":"spreadsheet","row_no":2,"order_no":1,"kind":"person","raw":{"id":"f#2","source":"people110.csv","sourceKind":"spreadsheet","row":2,"kind":"person","name":"Meera Shah","mobile":"713-555-0142","address1":"90 Cedar Dr","zip":"77478"}},
  {"id":"f#3","source":"people110.csv","source_kind":"spreadsheet","row_no":3,"order_no":2,"kind":"person","raw":{"id":"f#3","source":"people110.csv","sourceKind":"spreadsheet","row":3,"kind":"person","name":"Raj Patel","mobile":"713-555-0199","address1":"5 Elm St","zip":"77479"}},
  {"id":"f#4","source":"people110.csv","source_kind":"spreadsheet","row_no":4,"order_no":3,"kind":"person","raw":{"id":"f#4","source":"people110.csv","sourceKind":"spreadsheet","row":4,"kind":"person","name":"Dev Shah","isChild":true,"age":9,"school":"Lotus Elementary"}},
  {"id":"f#5","source":"people110.csv","source_kind":"spreadsheet","row_no":5,"order_no":4,"kind":"gift","raw":{"id":"f#5","source":"people110.csv","sourceKind":"spreadsheet","row":5,"kind":"gift","gift":{"amount":"50.00","date":"2025-12-31","ref":"1042"}}},
  {"id":"f#6","source":"people110.csv","source_kind":"spreadsheet","row_no":6,"order_no":5,"kind":"gift","raw":{"id":"f#6","source":"people110.csv","sourceKind":"spreadsheet","row":6,"kind":"gift","gift":{"amount":"51.00","date":"2025-12-31","ref":"1042"}}},
  {"id":"f#7","source":"people110.csv","source_kind":"spreadsheet","row_no":7,"order_no":6,"kind":"person","raw":{"id":"f#7","source":"people110.csv","sourceKind":"spreadsheet","row":7,"kind":"person","name":"Anu Shah","isChild":true,"age":6}}
]$$::jsonb, true) = 7, 'a person who may import people stages the rows of a people file');
insert into ctx select 'batch', app.resolve_begin(pg_temp.cx('run')::uuid, 'resolve-1-test', '{"budget":{"secondsPerQuestion":30,"secondsPerHeldMoneyItem":30,"secondsPerHeldOtherItem":1}}'::jsonb)::text;
select pg_temp.assert(app.resolve_store_records(pg_temp.cx('run')::uuid, pg_temp.cx('batch')::uuid, $$[
  {"id":"f#1","normalized":{"n":1},"fingerprint":"fp1","minor":false,"minor_reasons":[],"type_uncertain":false,"problems":[],"status":"asked","how":"question","tier":"C","cluster_id":null,"duplicate_of":null},
  {"id":"f#2","normalized":{"n":2},"fingerprint":"fp2","minor":false,"minor_reasons":[],"type_uncertain":false,"problems":[],"status":"asked","how":"question","tier":"C","cluster_id":null,"duplicate_of":null},
  {"id":"f#3","normalized":{"n":3},"fingerprint":"fp3","minor":false,"minor_reasons":[],"type_uncertain":false,"problems":[],"status":"asked","how":"question","tier":"C","cluster_id":null,"duplicate_of":null},
  {"id":"f#4","normalized":{"n":4},"fingerprint":"fp4","minor":true,"minor_reasons":["flag","age"],"type_uncertain":false,"problems":[],"status":"held","how":"hold","tier":"D","cluster_id":null,"duplicate_of":null},
  {"id":"f#5","normalized":{"n":5},"fingerprint":"fp5","minor":false,"minor_reasons":[],"type_uncertain":false,"problems":[],"status":"held","how":"hold","tier":"D","cluster_id":null,"duplicate_of":null},
  {"id":"f#6","normalized":{"n":6},"fingerprint":"fp6","minor":false,"minor_reasons":[],"type_uncertain":false,"problems":[],"status":"held","how":"hold","tier":"D","cluster_id":null,"duplicate_of":null},
  {"id":"f#7","normalized":{"n":7},"fingerprint":"fp7","minor":true,"minor_reasons":["flag"],"type_uncertain":false,"problems":[],"status":"held","how":"hold","tier":"D","cluster_id":null,"duplicate_of":null}
]$$::jsonb) = 7, 'what was found about each row is saved');
select pg_temp.assert(app.resolve_store_pairs(pg_temp.cx('run')::uuid, pg_temp.cx('batch')::uuid, $$[
  {"a":"f#1","b":"f#2","relation":"same_household","strength":"medium","score":55,"independent":1,"evidence":[{"kind":"phone","independent":true,"points":40,"label":"same mobile"}],"conflicts":[],"name_level":"surname_only","name_only":false,"via_keys":["phone:+17135550142"],"money":null,"tier":"C","tier_reasons":["one identifier agrees"],"hold":null,"signature":"shared_phone_households","affected":["f#2"],"implied":false},
  {"a":"f#2","b":"f#3","relation":"same_household","strength":"weak","score":30,"independent":0,"evidence":[{"kind":"name","independent":false,"points":6,"label":"same family name"}],"conflicts":[{"kind":"unit","severity":"lower","label":"a different unit at the same address"}],"name_level":"surname_only","name_only":true,"via_keys":[],"money":null,"tier":"C","tier_reasons":[],"hold":null,"signature":"name_only","affected":["f#3"],"implied":false},
  {"a":"f#1","b":"f#3","relation":"same_household","strength":"medium","score":50,"independent":1,"evidence":[{"kind":"phone","independent":true,"points":40,"label":"same mobile"}],"conflicts":[],"name_level":"different","name_only":false,"via_keys":[],"money":null,"tier":"C","tier_reasons":[],"hold":null,"signature":"shared_phone_households","affected":["f#3"],"implied":false},
  {"a":"f#5","b":"f#6","relation":"same_gift","strength":"medium","score":60,"independent":1,"evidence":[{"kind":"gift_ref","independent":true,"points":40,"label":"same check number"}],"conflicts":[],"name_level":"unknown","name_only":false,"via_keys":[],"money":{"kind":"amount_differs_cents","aCents":5000,"bCents":5100},"tier":"D","tier_reasons":["the amounts differ"],"hold":"money_conflict","signature":"amount_differs_cents","affected":["f#6"],"implied":false},
  {"a":"f#5","b":"f#6","relation":"same_gift","strength":"medium","score":60,"independent":1,"evidence":[],"conflicts":[],"name_level":"unknown","name_only":false,"via_keys":[],"money":null,"tier":"C","tier_reasons":[],"hold":null,"signature":"duplicate_gift_two_sources","affected":["f#6"],"implied":false}
]$$::jsonb) = 4, 'the pairs are saved, and a pair that appears twice is one pair');
select pg_temp.assert(app.resolve_store_clusters(pg_temp.cx('run')::uuid, pg_temp.cx('batch')::uuid,
  '[{"kind":"household","id":"c:f#1","record_ids":["f#1","f#2"],"existing":[]},{"kind":"person","id":"c:f#1","record_ids":["f#1","f#2"],"existing":[]}]'::jsonb) = 2,
  'households and people joined automatically are saved');
select pg_temp.assert(app.resolve_store_groups(pg_temp.cx('run')::uuid, pg_temp.cx('batch')::uuid, $$[
  {"signature":"duplicate_gift_two_sources","tier":"C","question":{"title":"1 gift appears in two files.","detail":"d","answers":[],"recommended":"same_gift"},"recommended":"same_gift","subject_count":1,"item_count":1,"money_cents":5000,"members":0,"contacts":0,"rank_no":0,"route_suggested":"treasurer"},
  {"signature":"amount_differs","tier":"D","question":{"title":"1 gift differs.","detail":"d","answers":[],"recommended":"hold"},"recommended":"hold","subject_count":1,"item_count":1,"money_cents":5100,"members":0,"contacts":0,"rank_no":1,"route_suggested":"treasurer"},
  {"signature":"shared_phone_households","tier":"C","question":{"title":"3 rows share a phone number with another family.","detail":"d","answers":[],"recommended":"separate"},"recommended":"separate","subject_count":3,"item_count":3,"money_cents":0,"members":3,"contacts":1,"rank_no":2,"route_suggested":"membership"},
  {"signature":"name_only","tier":"C","question":{"title":"2 rows only share a name.","detail":"d","answers":[],"recommended":"separate"},"recommended":"separate","subject_count":2,"item_count":2,"money_cents":0,"members":2,"contacts":0,"rank_no":3,"route_suggested":"membership"},
  {"signature":"minor_record","tier":"D","question":{"title":"2 rows are about children.","detail":"d","answers":[],"recommended":"person_will_add"},"recommended":"person_will_add","subject_count":2,"item_count":2,"money_cents":0,"members":2,"contacts":0,"rank_no":4,"route_suggested":"membership"}
]$$::jsonb) = 5, 'the questions are saved');
select pg_temp.assert(app.resolve_store_items(pg_temp.cx('run')::uuid, pg_temp.cx('batch')::uuid, $$[
  {"key":"shared_phone_households:k1","signature":"shared_phone_households","kind":"pair","tier":"C","subject":"f#2","record_ids":["f#1","f#2"],"fingerprints":["fp1","fp2"],"evidence_kinds":["phone"],"conflict_kinds":[],"shared":{"phone":"+17135550142","email":null,"address":null,"id":null},"money_cents":0,"members":2,"contacts":1,"rule_id":null,"rule_answer":null},
  {"key":"shared_phone_households:k2","signature":"shared_phone_households","kind":"pair","tier":"C","subject":"f#3","record_ids":["f#2","f#3"],"fingerprints":["fp2","fp3"],"evidence_kinds":["phone"],"conflict_kinds":[],"shared":{"phone":"+17135550199","email":null,"address":null,"id":null},"money_cents":0,"members":2,"contacts":1,"rule_id":null,"rule_answer":null},
  {"key":"shared_phone_households:k3","signature":"shared_phone_households","kind":"pair","tier":"C","subject":"f#3","record_ids":["f#1","f#3"],"fingerprints":["fp1","fp3"],"evidence_kinds":["phone"],"conflict_kinds":[],"shared":{"phone":"+17135550142","email":null,"address":null,"id":null},"money_cents":0,"members":2,"contacts":1,"rule_id":null,"rule_answer":null},
  {"key":"name_only:k8","signature":"name_only","kind":"pair","tier":"C","subject":"f#3","record_ids":["f#2","f#3"],"fingerprints":["fp2","fp3"],"evidence_kinds":["name"],"conflict_kinds":["unit"],"shared":{},"money_cents":0,"members":2,"contacts":0,"rule_id":null,"rule_answer":null},
  {"key":"name_only:k9","signature":"name_only","kind":"pair","tier":"C","subject":"f#2","record_ids":["f#1","f#2"],"fingerprints":["fp1","fp2"],"evidence_kinds":["name"],"conflict_kinds":[],"shared":{},"money_cents":0,"members":2,"contacts":0,"rule_id":null,"rule_answer":null},
  {"key":"minor_record:rec~fp4","signature":"minor_record","kind":"record","tier":"D","subject":"f#4","record_ids":["f#4"],"fingerprints":["fp4"],"evidence_kinds":[],"conflict_kinds":[],"shared":{},"money_cents":0,"members":1,"contacts":0,"rule_id":null,"rule_answer":null},
  {"key":"minor_record:rec~fp7","signature":"minor_record","kind":"record","tier":"D","subject":"f#7","record_ids":["f#7"],"fingerprints":["fp7"],"evidence_kinds":[],"conflict_kinds":[],"shared":{},"money_cents":0,"members":1,"contacts":0,"rule_id":null,"rule_answer":null},
  {"key":"amount_differs:k5","signature":"amount_differs","kind":"pair","tier":"D","subject":"f#6","record_ids":["f#5","f#6"],"fingerprints":["fp5","fp6"],"evidence_kinds":["gift_ref"],"conflict_kinds":["gift_ref"],"shared":{},"money_cents":5100,"members":0,"contacts":0,"rule_id":null,"rule_answer":null},
  {"key":"duplicate_gift_two_sources:k6","signature":"duplicate_gift_two_sources","kind":"pair","tier":"C","subject":"f#6","record_ids":["f#5","f#6"],"fingerprints":["fp5","fp6"],"evidence_kinds":["gift_ref"],"conflict_kinds":[],"shared":{},"money_cents":5000,"members":0,"contacts":0,"rule_id":null,"rule_answer":null}
]$$::jsonb) = 9, 'the items of the questions are saved');
select pg_temp.assert((app.resolve_finish(pg_temp.cx('run')::uuid, pg_temp.cx('batch')::uuid, '{"rows":7,"auto":0}'::jsonb)->>'questions')::int = 5, 'the result is finished: five questions');
select pg_temp.su();

-- Who can read what was saved.
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000001');
select pg_temp.assert((select count(*) = 7 from app.import_staged_records) and (select count(*) = 4 from app.import_record_links)
                      and (select count(*) = 2 from app.import_clusters) and (select count(*) = 5 from app.import_exceptions)
                      and (select count(*) = 9 from app.import_exception_items) and (select count(*) = 1 from app.import_run_metrics),
  'a person who may import people reads everything saved for the run');
select pg_temp.assert(app.resolve_inbox(pg_temp.cx('run')::uuid)->>'status' = 'ready'
                      and jsonb_array_length(app.resolve_inbox(pg_temp.cx('run')::uuid)->'groups') = 5
                      and app.resolve_inbox(pg_temp.cx('run')::uuid)->'groups'->0->>'signature' = 'duplicate_gift_two_sources'
                      and app.resolve_inbox(pg_temp.cx('run')::uuid)->'groups'->4->>'signature' = 'minor_record',
  'the inbox lists the questions in the order they were ranked');
select pg_temp.su();

select pg_temp.sign_in('110b0000-0000-4000-8000-000000000003');
select pg_temp.assert((select count(*) = 0 from app.import_staged_records) and (select count(*) = 0 from app.import_record_links)
                      and (select count(*) = 0 from app.import_clusters) and (select count(*) = 0 from app.import_exceptions)
                      and (select count(*) = 0 from app.import_exception_items) and (select count(*) = 0 from app.import_run_metrics)
                      and (select count(*) = 0 from app.import_decision_rules),
  'a member reads nothing of it');
select pg_temp.assert_raises($$select app.resolve_runs('110b0000-0000-4000-8000-0000000000c1')$$, 'permissions', 'a member cannot list the imports that can be checked');
select pg_temp.assert(app.resolve_inbox(pg_temp.cx('run')::uuid)->>'status' = 'none' and app.resolve_item_detail(pg_temp.iid('name_only:k8')) is null
                      and app.resolve_staged_page(pg_temp.cx('run')::uuid) = '[]'::jsonb,
  'and the functions that read hand a member nothing');
select pg_temp.assert((select count(*) = 16 from app.import_signatures), 'the catalog of kinds of question is readable by everyone signed in');
select pg_temp.su();
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000004');
select pg_temp.assert((select count(*) = 0 from app.import_staged_records) and (select count(*) = 0 from app.import_exceptions)
                      and (select count(*) = 0 from app.import_exception_items) and (select count(*) = 0 from app.import_run_metrics),
  'an admin of another community reads nothing of it');
select pg_temp.su();
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000002');
select pg_temp.assert((select count(*) = 9 from app.import_exception_items), 'the treasurer, who may also import people, reads it');
select pg_temp.su();
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000006');
select pg_temp.assert((select count(*) = 0 from app.import_staged_records) and (select count(*) = 0 from app.import_exceptions)
                      and (select count(*) = 0 from app.import_exception_items) and (select count(*) = 0 from app.import_run_metrics)
                      and app.resolve_inbox(pg_temp.cx('run')::uuid)->>'status' = 'none',
  'the volunteers-only importer reads nothing of it');
select pg_temp.su();
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000007');
select pg_temp.assert((select count(*) = 9 from app.import_exception_items) and jsonb_array_length(app.resolve_runs('110b0000-0000-4000-8000-0000000000c1')) = 1
                      and app.resolve_rules('110b0000-0000-4000-8000-0000000000c1') = '[]'::jsonb and app.resolve_inbox(pg_temp.cx('run')::uuid)->>'status' = 'ready',
  'a platform admin reads it, and lists the one file that can be matched (not the volunteers file)');
select pg_temp.su();

-- A card shows what tells households apart, and nothing a row says about children; a child's record is never opened.
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000001');
select pg_temp.assert(app.resolve_item_detail(pg_temp.iid('shared_phone_households:k1'))->'records'->0->'card' ? 'name'
                      and app.resolve_item_detail(pg_temp.iid('shared_phone_households:k1'))->'records'->0->'card' ? 'address1'
                      and app.resolve_item_detail(pg_temp.iid('shared_phone_households:k1'))->'records'->0->'card' ? 'ids',
  'a card carries the name, the address and the identifiers');
select pg_temp.assert(not (app.resolve_item_detail(pg_temp.iid('shared_phone_households:k1'))->'records'->0->'card' ? 'children')
                      and not (app.resolve_item_detail(pg_temp.iid('shared_phone_households:k1'))->'records'->0->'card' ? 'notes')
                      and not (app.resolve_item_detail(pg_temp.iid('shared_phone_households:k1'))->'records'->0->'card' ? 'school')
                      and not (app.resolve_item_detail(pg_temp.iid('shared_phone_households:k1'))->'records'->0->'card' ? 'dob')
                      and app.resolve_item_detail(pg_temp.iid('shared_phone_households:k1'))::text not like '%Lotus Elementary%'
                      and app.resolve_item_detail(pg_temp.iid('shared_phone_households:k1'))::text not like '%allergic%',
  'a card never carries children, notes, school or birth date');
select pg_temp.assert(app.resolve_item_detail(pg_temp.iid('shared_phone_households:k1'))->'link'->'evidence'->0->>'label' = 'same mobile'
                      and jsonb_array_length(app.resolve_item_detail(pg_temp.iid('shared_phone_households:k1'))->'records') = 2,
  'and the evidence that the two agree, beside the two records');
select pg_temp.assert((app.resolve_item_detail(pg_temp.iid('minor_record:rec~fp4'))->'records'->0->>'minor')::boolean
                      and not (app.resolve_item_detail(pg_temp.iid('minor_record:rec~fp4'))->'records'->0 ? 'card')
                      and app.resolve_item_detail(pg_temp.iid('minor_record:rec~fp4'))::text not like '%Dev%',
  'a child''s record is held and never opened: no card, no name');
select pg_temp.assert((app.resolve_item_detail(pg_temp.iid('amount_differs:k5'))->'item'->>'limited')::boolean
                      and not (app.resolve_item_detail(pg_temp.iid('shared_phone_households:k1'))->'item'->>'limited')::boolean
                      and app.resolve_card_limited('{"name":"Mira Shah","mobile":"713","email":"m@x.org","address1":"12 Lotus Ln","ids":{"household_number":"0417"},"gift":{"amount":"5.00"},"children":"Dev"}'::jsonb)
                          = '{"name":"Mira Shah","ids":{"household_number":"0417"},"gift":{"amount":"5.00"}}'::jsonb,
  'a held item (a money conflict) shows who and what gift, and no phone, e-mail or address');
select pg_temp.su();

-- ── C. Answering one item, and "the same answer for the other N" ────────────
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000001');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('shared_phone_households'), 'same_gift')$$, 'not one of the answers',
  'an answer that does not belong to the question is refused');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('shared_phone_households'), 'separate', pg_temp.iid('name_only:k8'))$$, 'does not belong to this question',
  'an item of another question is refused');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('shared_phone_households'), 'separate', null, false, true, 'pattern')$$, 'not a way to remember',
  'a phone question cannot be remembered as a pattern: only for that phone or for those two rows');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('name_only'), 'separate', null, false, true, 'pattern')$$, 'not a way to remember',
  'nor can a question that has only a name to go on, in any scope');
select pg_temp.assert((app.resolve_answer(pg_temp.gid('shared_phone_households'), 'separate', pg_temp.iid('shared_phone_households:k2'))->>'answered')::int = 1,
  'one answer is for one item');
select pg_temp.assert((select answer = 'separate' and answer_source = 'person' and answered_by = '110b0000-0000-4000-8000-000000000001' and answered_at is not null
                         from app.import_exception_items where key = 'shared_phone_households:k2')
                      and (select count(*) = 2 from app.import_exception_items where signature = 'shared_phone_households' and answer is null)
                      and (select status = 'open' and answer = 'separate' from app.import_exceptions where signature = 'shared_phone_households'),
  'the item records who answered and when, and the question stays open while items are left');
select pg_temp.assert((select count(*) = 1 from app.import_decision_rules where signature = 'shared_phone_households')
                      and (select scope = 'identifier' and answer = 'separate' and conditions = '[{"type":"identifier","field":"phone","value":"+17135550199"}]'::jsonb
                                  and decided_by = '110b0000-0000-4000-8000-000000000001' and from_group = 'grp:shared_phone_households' and revoked_at is null and uses = 0
                             from app.import_decision_rules where signature = 'shared_phone_households'),
  'the answer is remembered for the community as a rule about that phone number, with who and when');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('shared_phone_households'), 'same_household', pg_temp.iid('shared_phone_households:k2'))$$, 'already has an answer',
  'an item that already has an answer is not overwritten by accident');
select pg_temp.assert((select answer = 'separate' and answer_source = 'person' from app.import_exception_items where key = 'shared_phone_households:k2'),
  'and it still has the answer it had');

-- The number the person was shown must be the number the database would answer.
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('name_only'), 'separate', null, true, true, null, 5)$$, 'There are now 1 other items',
  'the same answer for "the other 5" is refused when only 1 other is left');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('name_only'), 'separate', null, true)$$, 'Look at the question again',
  'and when no number was given at all');
select pg_temp.assert((select count(*) = 0 from app.import_exception_items where signature = 'name_only' and answer is not null), 'a refused answer changed nothing');
select pg_temp.assert((app.resolve_answer(pg_temp.gid('name_only'), 'separate', pg_temp.iid('name_only:k8'), false, false)->>'open_items')::int = 1,
  'a question that has only a name to go on is answered, and the other item stays open');
select pg_temp.assert((select count(*) = 0 from app.import_decision_rules where signature = 'name_only'), 'a name-only answer is never remembered, whatever was asked');

-- Same answer for the other N: an answer that differs from the one a person gave earlier, so an override would show.
select pg_temp.assert((app.resolve_answer(pg_temp.gid('shared_phone_households'), 'same_household', null, true, true, null, 1)->>'answered')::int = 2,
  'the same answer for the other item: the first open item and the other open one are answered in one go');
select pg_temp.assert((select answer = 'separate' and answer_source = 'person' from app.import_exception_items where key = 'shared_phone_households:k2'),
  'an item a person answered earlier keeps its own answer: the bulk answer does not override it');
select pg_temp.assert((select answer = 'same_household' and answer_source = 'person' from app.import_exception_items where key = 'shared_phone_households:k1')
                      and (select answer = 'same_household' and answer_source = 'person_bulk' from app.import_exception_items where key = 'shared_phone_households:k3')
                      and (select status = 'answered' and apply_to_rest and answered_by = '110b0000-0000-4000-8000-000000000001' from app.import_exceptions where signature = 'shared_phone_households'),
  'the others are answered, the bulk one marked as such, and the question is answered');
select pg_temp.assert((select count(*) = 2 from app.import_decision_rules where signature = 'shared_phone_households' and revoked_at is null)
                      and (select answer = 'same_household' from app.import_decision_rules where signature = 'shared_phone_households' and conditions->0->>'value' = '+17135550142'),
  'a second rule, about the phone number of the item that was answered first');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('shared_phone_households'), 'separate')$$, 'already has an answer',
  'a question with every item answered has nothing left to answer');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('shared_phone_households'), 'separate', pg_temp.iid('shared_phone_households:k3'), true, true, null, 0, true)$$, 'one item at a time',
  'a changed answer is for one item, never for the others');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('shared_phone_households'), 'separate', null, false, true, null, null, true)$$, 'Say which item',
  'and it says which');
select pg_temp.assert((app.resolve_answer(pg_temp.gid('shared_phone_households'), 'separate', pg_temp.iid('shared_phone_households:k3'), false, true, null, null, true)->>'answered')::int = 1,
  'an answer can be changed on purpose, for one item');
select pg_temp.assert((select answer = 'separate' and answer_source = 'person' from app.import_exception_items where key = 'shared_phone_households:k3'),
  'and then it is the new answer, given by a person');
select app.resolve_answer(pg_temp.gid('shared_phone_households'), 'same_household', pg_temp.iid('shared_phone_households:k3'), false, true, null, null, true);
select pg_temp.su();

-- ── D. Held items: no remembered answer, ever ───────────────────────────────
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000001');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('minor_record'), 'person_will_add', null, true, true, null, 1)$$, 'needs its own answer',
  'children are answered one by one: never in bulk');
select pg_temp.assert((app.resolve_answer(pg_temp.gid('minor_record'), 'person_will_add')->>'open_items')::int = 1, 'the first child''s row is answered by a person...');
select pg_temp.assert((app.resolve_answer(pg_temp.gid('minor_record'), 'ignore_row')->>'status') = 'answered', '...and the second one separately');
select pg_temp.assert((select count(*) = 2 and bool_and(answer_source = 'person') from app.import_exception_items where signature = 'minor_record')
                      and (select count(*) = 0 from app.import_decision_rules where signature = 'minor_record'),
  'nothing about a child is ever remembered');
select pg_temp.su();
select pg_temp.assert_raises($$update app.import_exception_items set answer = 'person_will_add', answer_source = 'rule:rule:x' where key = 'minor_record:rec~fp4'$$,
  'import_exception_items_held_by_a_person', 'the table itself refuses a remembered answer as the source for a held item');
select pg_temp.assert_raises($$update app.import_exception_items set answer = 'use_first', answer_source = 'rule:rule:x' where key = 'amount_differs:k5'$$,
  'import_exception_items_held_by_a_person', 'and for a money conflict');

-- ── E. Money questions need giving.manage, for everything done to them ──────
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000001');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('duplicate_gift_two_sources'), 'same_gift')$$, 'giving.manage',
  'a people manager without giving.manage cannot answer a question about a gift');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('amount_differs'), 'hold')$$, 'giving.manage', 'nor one about a money conflict');
select pg_temp.assert_raises($$select app.resolve_set_group_status(pg_temp.gid('duplicate_gift_two_sources'), 'postponed')$$, 'giving.manage', 'nor put it off');
select pg_temp.assert_raises($$select app.resolve_set_group_status(pg_temp.gid('duplicate_gift_two_sources'), 'skipped')$$, 'giving.manage', 'nor skip it');
select pg_temp.assert_raises($$select app.resolve_set_group_status(pg_temp.gid('amount_differs'), 'sent')$$, 'giving.manage', 'nor send it on');
select pg_temp.assert_raises($$select app.resolve_reopen(pg_temp.gid('amount_differs'))$$, 'giving.manage', 'nor take its answers back');
select pg_temp.assert((select status = 'open' from app.import_exceptions where signature = 'duplicate_gift_two_sources'), 'and nothing changed');
select pg_temp.su();
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000002');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('amount_differs'), 'use_first', null, true, true, null, 0)$$, 'needs its own answer',
  'a money conflict is never answered in bulk, even by the treasurer');
select pg_temp.assert((app.resolve_answer(pg_temp.gid('amount_differs'), 'use_first')->>'status') = 'answered', 'the treasurer answers a money conflict item by item');
select pg_temp.assert((select answer = 'use_first' and answer_source = 'person' from app.import_exception_items where key = 'amount_differs:k5')
                      and (select count(*) = 0 from app.import_decision_rules where signature = 'amount_differs'),
  'and it is not remembered');
select pg_temp.assert((app.resolve_answer(pg_temp.gid('duplicate_gift_two_sources'), 'same_gift')->>'status') = 'answered', 'a gift in two sources is answered by the treasurer...');
select pg_temp.assert((select count(*) = 0 from app.import_decision_rules where signature = 'duplicate_gift_two_sources'),
  '...and not remembered either: a gift is decided again each time');
select pg_temp.su();
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000001');
select pg_temp.assert_raises($$select app.resolve_reopen(pg_temp.gid('duplicate_gift_two_sources'))$$, 'giving.manage', 'a people manager cannot take back the treasurer''s answer');
select pg_temp.assert((select answer = 'same_gift' from app.import_exception_items where key = 'duplicate_gift_two_sources:k6'), 'which stands');
select pg_temp.su();

-- ── F. Putting a question off, skipping it, sending it on ───────────────────
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000001');
select pg_temp.assert_raises($$select app.resolve_set_group_status(pg_temp.gid('shared_phone_households'), 'postponed')$$, 'already answered',
  'an answered question has to be reopened first');
select pg_temp.assert_raises($$select app.resolve_set_group_status(pg_temp.gid('name_only'), 'answered')$$, 'put off, skipped, sent on or opened again',
  'a question cannot be marked answered without an answer');
select app.resolve_set_group_status(pg_temp.gid('name_only'), 'postponed');
select pg_temp.assert((select status = 'postponed' and status_by = '110b0000-0000-4000-8000-000000000001' and status_at is not null from app.import_exceptions where signature = 'name_only'),
  'a question can be put off until later');
select app.resolve_set_group_status(pg_temp.gid('name_only'), 'skipped');
select pg_temp.assert((select status = 'skipped' from app.import_exceptions where signature = 'name_only'), 'or skipped');
select app.resolve_set_group_status(pg_temp.gid('name_only'), 'sent');
select pg_temp.assert((select status = 'sent' and routed_to = 'membership' from app.import_exceptions where signature = 'name_only'),
  'or sent on, to the person best placed to answer it');
select pg_temp.assert((app.resolve_answer(pg_temp.gid('name_only'), 'separate')->>'status') = 'answered', 'answering a question that was put off answers it');
select pg_temp.su();

-- ── G. A result is refused when it tries to use a remembered answer, or to describe an item, where it must not ──
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000001');
insert into ctx select 'rule_phone', id from app.import_decision_rules where signature = 'shared_phone_households' and conditions->0->>'value' = '+17135550142';
insert into ctx select 'batch2', app.resolve_begin(pg_temp.cx('run')::uuid, 'resolve-1-test', '{}'::jsonb)::text;
select pg_temp.assert_raises(format($f$select pg_temp.item_with_rule(%L::uuid, %L::uuid, 'minor_record:rec~fp4', 'minor_record', 'record', 'D', %L, 'same_household')$f$,
    pg_temp.cx('run'), pg_temp.cx('batch2'), pg_temp.cx('rule_phone')), 'does not apply', 'a remembered answer on a child is refused');
select pg_temp.assert_raises(format($f$select pg_temp.item_with_rule(%L::uuid, %L::uuid, 'amount_differs:k5', 'amount_differs', 'pair', 'D', %L, 'same_household')$f$,
    pg_temp.cx('run'), pg_temp.cx('batch2'), pg_temp.cx('rule_phone')), 'does not apply', 'a remembered answer on a money conflict is refused');
select pg_temp.assert_raises(format($f$select pg_temp.item_with_rule(%L::uuid, %L::uuid, 'name_only:k8', 'name_only', 'pair', 'C', %L, 'same_household')$f$,
    pg_temp.cx('run'), pg_temp.cx('batch2'), pg_temp.cx('rule_phone')), 'does not apply', 'a remembered answer for another kind of question is refused');
select pg_temp.assert_raises(format($f$select pg_temp.item_with_rule(%L::uuid, %L::uuid, 'shared_phone_households:k1', 'shared_phone_households', 'pair', 'C', %L, 'separate', '{"phone":"+17135550142"}', '["phone"]')$f$,
    pg_temp.cx('run'), pg_temp.cx('batch2'), pg_temp.cx('rule_phone')), 'does not apply', 'a remembered answer that says something else is refused');
select pg_temp.assert_raises(format($f$select pg_temp.item_with_rule(%L::uuid, %L::uuid, 'shared_phone_households:k1', 'shared_phone_households', 'pair', 'C', 'rule:nobody', 'same_household', '{"phone":"+17135550142"}', '["phone"]')$f$,
    pg_temp.cx('run'), pg_temp.cx('batch2')), 'does not apply', 'a remembered answer that is not there is refused');
select pg_temp.assert_raises(format($f$select pg_temp.item_with_rule(%L::uuid, %L::uuid, 'shared_phone_households:k1', 'shared_phone_households', 'record', 'C', %L, 'same_household', '{"phone":"+17135550142"}', '["phone"]')$f$,
    pg_temp.cx('run'), pg_temp.cx('batch2'), pg_temp.cx('rule_phone')), 'does not apply', 'a remembered answer on a single record is refused');
select pg_temp.assert_raises(format($f$select pg_temp.item_with_rule(%L::uuid, %L::uuid, 'shared_phone_households:k2', 'shared_phone_households', 'pair', 'C', %L, 'same_household', '{"phone":"+17135550199"}', '["phone"]')$f$,
    pg_temp.cx('run'), pg_temp.cx('batch2'), pg_temp.cx('rule_phone')), 'does not apply',
  'a remembered answer about one phone number is refused for an item about another: its conditions have to hold for the item');
select pg_temp.assert_raises(format($f$select pg_temp.item_with_rule(%L::uuid, %L::uuid, 'shared_phone_households:k1', 'shared_phone_households', 'pair', 'C', %L, 'same_household', '{"phone":"+17135550142"}', '["name"]')$f$,
    pg_temp.cx('run'), pg_temp.cx('batch2'), pg_temp.cx('rule_phone')), 'does not apply',
  'a remembered answer that joins two records is refused for an item where only a name agrees');
select pg_temp.assert(pg_temp.item_with_rule(pg_temp.cx('run')::uuid, pg_temp.cx('batch2')::uuid, 'shared_phone_households:k1', 'shared_phone_households', 'pair', 'C',
                      pg_temp.cx('rule_phone'), 'same_household', '{"phone":"+17135550142"}', '["phone"]') = 1,
  'and a remembered answer that fits the item is accepted');
select pg_temp.assert_raises(format($f$select pg_temp.raw_item(%L::uuid, %L::uuid, 'name_only:kz', 'name_only', 'pair', 'C', '["f#4", "f#1"]')$f$, pg_temp.cx('run'), pg_temp.cx('batch2')),
  'name a child', 'a child''s row is never in an item of another kind: it has to be held on its own');
select pg_temp.assert_raises(format($f$select pg_temp.raw_item(%L::uuid, %L::uuid, 'amount_differs:kz', 'amount_differs', 'pair', 'C', '["f#5", "f#6"]')$f$, pg_temp.cx('run'), pg_temp.cx('batch2')),
  'do not fit', 'a money conflict cannot be saved as an item that is not held: the database knows which kinds are held');
select pg_temp.assert_raises(format($f$select pg_temp.raw_item(%L::uuid, %L::uuid, 'minor_record:kz', 'minor_record', 'pair', 'D', '["f#4", "f#1"]')$f$, pg_temp.cx('run'), pg_temp.cx('batch2')),
  'do not fit', 'a child''s item is about one row, not a pair');
select pg_temp.assert_raises(format($f$select pg_temp.raw_item(%L::uuid, %L::uuid, 'name_only:kz', 'name_only', 'pair', 'C', '["f#1", "nope"]')$f$, pg_temp.cx('run'), pg_temp.cx('batch2')),
  'do not fit', 'an item that names a row that is not in the import is refused');
select pg_temp.assert_raises(format($f$select app.resolve_store_pairs(%L::uuid, %L::uuid, '[]'::jsonb)$f$, pg_temp.cx('run'), pg_temp.cx('batch')), 'Another check for matches started',
  'a page of an older check is refused once a newer one has started');
select pg_temp.assert_raises($$select app.resolve_answer(pg_temp.gid('name_only'), 'separate')$$, 'still being worked out',
  'nothing is answered while a new result is being saved');
select pg_temp.assert(app.resolve_inbox(pg_temp.cx('run')::uuid)->>'status' = 'storing' and app.resolve_inbox(pg_temp.cx('run')::uuid)->'groups' = '[]'::jsonb
                      and app.resolve_item_detail(pg_temp.iid('minor_record:rec~fp4')) is null and app.resolve_item_detail(pg_temp.iid('shared_phone_households:k1')) is null,
  'and while it is saved, the old questions and cards are not shown: they may describe rows that have changed');
select pg_temp.su();

-- ── H. Taking answers back ──────────────────────────────────────────────────
-- The new check never finished; finish it as it was (the same items), so the rest of the test sees a ready result.
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000001');
select pg_temp.assert(app.resolve_store_groups(pg_temp.cx('run')::uuid, pg_temp.cx('batch2')::uuid, $$[
  {"signature":"duplicate_gift_two_sources","tier":"C","question":{"title":"1 gift appears in two files.","detail":"d","answers":[],"recommended":"same_gift","examples":[{"lines":["Mira Shah, 12 Lotus Ln"]}]},"recommended":"same_gift","subject_count":1,"item_count":1,"money_cents":5000,"members":0,"contacts":0,"rank_no":0,"route_suggested":"treasurer"},
  {"signature":"amount_differs","tier":"D","question":{"title":"1 gift differs.","detail":"d","answers":[],"recommended":"hold"},"recommended":"hold","subject_count":1,"item_count":1,"money_cents":5100,"members":0,"contacts":0,"rank_no":1,"route_suggested":"treasurer"},
  {"signature":"shared_phone_households","tier":"C","question":{"title":"3 rows share a phone number with another family.","detail":"d","answers":[],"recommended":"separate"},"recommended":"separate","subject_count":3,"item_count":3,"money_cents":0,"members":3,"contacts":1,"rank_no":2,"route_suggested":"membership"},
  {"signature":"name_only","tier":"C","question":{"title":"2 rows only share a name.","detail":"d","answers":[],"recommended":"separate"},"recommended":"separate","subject_count":2,"item_count":2,"money_cents":0,"members":2,"contacts":0,"rank_no":3,"route_suggested":"membership"},
  {"signature":"minor_record","tier":"D","question":{"title":"2 rows are about children.","detail":"d","answers":[],"recommended":"person_will_add"},"recommended":"person_will_add","subject_count":2,"item_count":2,"money_cents":0,"members":2,"contacts":0,"rank_no":4,"route_suggested":"membership"}
]$$::jsonb) = 5, 'the groups of the new check are saved');
select pg_temp.assert(not (select question ? 'examples' from app.import_exceptions where signature = 'duplicate_gift_two_sources'),
  'the example lines of a question (names and addresses) are not kept');
select pg_temp.assert(app.resolve_store_items(pg_temp.cx('run')::uuid, pg_temp.cx('batch2')::uuid, $$[
  {"key":"shared_phone_households:k1","signature":"shared_phone_households","kind":"pair","tier":"C","subject":"f#2","record_ids":["f#1","f#2"],"fingerprints":["fp1","fp2"],"evidence_kinds":["phone"],"shared":{"phone":"+17135550142"}},
  {"key":"shared_phone_households:k2","signature":"shared_phone_households","kind":"pair","tier":"C","subject":"f#3","record_ids":["f#2","f#3"],"fingerprints":["fp2","fp3"],"evidence_kinds":["phone"],"shared":{"phone":"+17135550199"}},
  {"key":"shared_phone_households:k3","signature":"shared_phone_households","kind":"pair","tier":"C","subject":"f#3","record_ids":["f#1","f#3"],"fingerprints":["fp1","fp3"],"evidence_kinds":["phone"],"shared":{"phone":"+17135550142"}},
  {"key":"name_only:k8","signature":"name_only","kind":"pair","tier":"C","subject":"f#3","record_ids":["f#2","f#3"],"fingerprints":["fp2","fp3"],"evidence_kinds":["name"],"shared":{}},
  {"key":"name_only:k9","signature":"name_only","kind":"pair","tier":"C","subject":"f#2","record_ids":["f#1","f#2"],"fingerprints":["fp1","fp2"],"evidence_kinds":["name"],"shared":{}},
  {"key":"minor_record:rec~fp4","signature":"minor_record","kind":"record","tier":"D","subject":"f#4","record_ids":["f#4"],"fingerprints":["fp4"],"shared":{}},
  {"key":"minor_record:rec~fp7","signature":"minor_record","kind":"record","tier":"D","subject":"f#7","record_ids":["f#7"],"fingerprints":["fp7"],"shared":{}},
  {"key":"amount_differs:k5","signature":"amount_differs","kind":"pair","tier":"D","subject":"f#6","record_ids":["f#5","f#6"],"fingerprints":["fp5","fp6"],"money_cents":5100,"shared":{}},
  {"key":"duplicate_gift_two_sources:k6","signature":"duplicate_gift_two_sources","kind":"pair","tier":"C","subject":"f#6","record_ids":["f#5","f#6"],"fingerprints":["fp5","fp6"],"money_cents":5000,"shared":{}}
]$$::jsonb) = 9, 'saving the same items again is allowed...');
select pg_temp.assert((app.resolve_finish(pg_temp.cx('run')::uuid, pg_temp.cx('batch2')::uuid, '{"rows":7}'::jsonb)->>'items')::int = 9, 'the new check is finished...');
select pg_temp.assert((select count(*) = 9 from app.import_exception_items)
                      and (select count(*) = 9 from app.import_exception_items where answer is not null),
  '...and the answers people gave are still there (a person''s answer survives a new check)');
select pg_temp.assert((select count(*) = 5 and bool_and(status = 'answered') from app.import_exceptions),
  'and so are the answered questions');

-- Take the phone question's answers back: the answers a person gave are cleared, the rules made from it are withdrawn.
select pg_temp.assert((app.resolve_reopen(pg_temp.gid('shared_phone_households'))->>'rules_withdrawn')::int = 2,
  'reopening a question withdraws the two remembered answers made from it');
select pg_temp.assert((select count(*) = 3 from app.import_exception_items where signature = 'shared_phone_households' and answer is null)
                      and (select status = 'open' and answer is null from app.import_exceptions where signature = 'shared_phone_households')
                      and (select count(*) = 0 from app.import_decision_rules where signature = 'shared_phone_households' and revoked_at is null)
                      and (select count(*) = 2 from app.import_decision_rules where signature = 'shared_phone_households' and revoked_at is not null),
  'its items are open again and the rules are withdrawn, not deleted');
select pg_temp.assert((select bool_and(conditions = '[{"type":"redacted"}]'::jsonb and answer is not null and signature = 'shared_phone_households')
                         from app.import_decision_rules where signature = 'shared_phone_households'),
  'a withdrawn rule keeps its kind of question and its answer, and loses the phone number it was made from');
select pg_temp.assert(app.resolve_rules('110b0000-0000-4000-8000-0000000000c1') = '[]'::jsonb,
  'the engine is handed no remembered answers: none are left');
select pg_temp.assert_raises($$select app.resolve_revoke_rule('110b0000-0000-4000-8000-0000000000c1', 'rule:nobody')$$, 'was not found',
  'withdrawing an answer that is not there says so');
select pg_temp.su();

-- ── I. Taking back goes no further than the person may ──────────────────────
-- A rule made for these checks (valid for its kind of question), and a gift rule that the table now refuses to hold: the guard and
-- the constraint are taken off inside this transaction to show that the functions refuse on their own.
insert into app.import_decision_rules (id, center_id, signature, scope, conditions, answer, decided_at)
values ('rule:withdraw-test', '110b0000-0000-4000-8000-0000000000c1', 'shared_phone_households', 'identifier',
        '[{"type":"identifier","field":"phone","value":"+19995550000"}]', 'separate', now());
drop trigger import_decision_rules_guard on app.import_decision_rules;
select pg_temp.assert_raises($$insert into app.import_decision_rules (id, center_id, signature, scope, conditions, answer)
    values ('rule:x2', '110b0000-0000-4000-8000-0000000000c1', 'minor_record', 'exact_pair', '[{"type":"pair","fingerprints":["a","b"]}]', 'separate')$$,
  'import_decision_rules_never_held', 'with the guard gone, the table itself still refuses a remembered answer for a child');
select pg_temp.assert_raises($$insert into app.import_decision_rules (id, center_id, signature, scope, conditions, answer)
    values ('rule:g2', '110b0000-0000-4000-8000-0000000000c1', 'duplicate_gift_two_sources', 'exact_pair', '[{"type":"pair","fingerprints":["a","b"]}]', 'separate')$$,
  'import_decision_rules_never_held', 'and for a gift');
alter table app.import_decision_rules drop constraint import_decision_rules_never_held;
insert into app.import_decision_rules (id, center_id, signature, scope, conditions, answer, decided_at)
values ('rule:gift-test', '110b0000-0000-4000-8000-0000000000c1', 'duplicate_gift_two_sources', 'exact_pair',
        '[{"type":"pair","fingerprints":["fp5","fp6"]}]', 'separate', now());
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000002');
insert into ctx select 'prun', (app.import_create_run('110b0000-0000-4000-8000-0000000000c1', 'payments', 'onboarding', 'gifts110.csv'))->>'id';
select pg_temp.su();
-- Items answered by the test rules: a phone item (people file), a gift item (people file), and an item in a payments file.
update app.import_exception_items set answer = 'separate', answer_source = 'rule:rule:withdraw-test', answered_by = null
 where key = 'shared_phone_households:k1' and run_id = pg_temp.cx('run')::uuid;
update app.import_exception_items set answer = 'separate', answer_source = 'rule:rule:withdraw-test', answered_by = null
 where key = 'duplicate_gift_two_sources:k6' and run_id = pg_temp.cx('run')::uuid;
insert into app.import_exception_items (center_id, run_id, key, signature, kind, tier, subject, record_ids, fingerprints, answer, answer_source)
values ('110b0000-0000-4000-8000-0000000000c1', pg_temp.cx('prun')::uuid, 'shared_phone_households:kp', 'shared_phone_households', 'pair', 'C', 'p2',
        array['p1', 'p2'], array['pf1', 'pf2'], 'separate', 'rule:rule:withdraw-test');
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000001');
select pg_temp.assert_raises($$select app.resolve_revoke_rule('110b0000-0000-4000-8000-0000000000c1', 'rule:gift-test')$$, 'giving.manage',
  'a people manager cannot withdraw a gift rule');
select pg_temp.assert((app.resolve_revoke_rule('110b0000-0000-4000-8000-0000000000c1', 'rule:withdraw-test')->>'items_reopened')::int = 1,
  'withdrawing another rule reopens only what the person may reopen: the phone item');
select pg_temp.su();
select pg_temp.assert((select answer is null from app.import_exception_items where key = 'shared_phone_households:k1' and run_id = pg_temp.cx('run')::uuid)
                      and (select answer_source = 'rule:rule:withdraw-test' from app.import_exception_items where key = 'duplicate_gift_two_sources:k6' and run_id = pg_temp.cx('run')::uuid)
                      and (select answer_source = 'rule:rule:withdraw-test' from app.import_exception_items where key = 'shared_phone_households:kp'),
  'a gift item is left alone (they may not decide about gifts), and so is an item in a payments file they cannot open');
select pg_temp.sign_in('110b0000-0000-4000-8000-000000000002');
select pg_temp.assert((app.resolve_revoke_rule('110b0000-0000-4000-8000-0000000000c1', 'rule:gift-test')->>'items_reopened')::int = 0,
  'the treasurer can withdraw the gift rule');
select pg_temp.su();

-- ── J. What is audited ──────────────────────────────────────────────────────
-- What a person decided is in the log, by explicit entries that carry no personal value; the uploaded rows, the items and the
-- rules are not copied into it row by row, so no phone number reached it.
select pg_temp.assert((select count(*) >= 3 from app.audit_log where center_id = '110b0000-0000-4000-8000-0000000000c1' and action = 'import_exceptions.answer'
                         and actor_user_id = '110b0000-0000-4000-8000-000000000001' and after->>'signature' is not null and after->>'answer' is not null)
                      and (select count(*) >= 2 from app.audit_log where center_id = '110b0000-0000-4000-8000-0000000000c1' and action = 'import_decision_rules.remember')
                      and (select count(*) >= 3 from app.audit_log where center_id = '110b0000-0000-4000-8000-0000000000c1' and action = 'import_exceptions.status')
                      and (select count(*) >= 1 from app.audit_log where center_id = '110b0000-0000-4000-8000-0000000000c1' and action = 'import_exceptions.reopen')
                      and (select count(*) >= 2 from app.audit_log where center_id = '110b0000-0000-4000-8000-0000000000c1' and action = 'import_decision_rules.revoke'),
  'answers, put-offs, remembered answers, take-backs and withdrawals are in the audit log, with who made them');
select pg_temp.assert((select count(*) = 0 from app.audit_log where center_id = '110b0000-0000-4000-8000-0000000000c1'
                         and action ~ '^(import_staged_records|import_record_links|import_clusters|import_exceptions|import_exception_items|import_decision_rules)\.(insert|update|delete)$'),
  'none of the six tables is audited row by row');
select pg_temp.assert((select count(*) = 0 from app.audit_log where center_id = '110b0000-0000-4000-8000-0000000000c1'
                         and (coalesce(before::text, '') || coalesce(after::text, '')) ~ '(713555|mira110|Mira Shah|Lotus)'),
  'and no phone number, e-mail, name or address reached the audit log');
rollback;
