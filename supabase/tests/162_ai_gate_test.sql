-- 0755 and 0756: the iWeaver gate. Without the `ai` module nothing a community asks for reaches an AI provider, and whoever
-- asked is told "AI features are part of iWeaver, which is not on for your community.":
--   A. the sentence and the list of AI job kinds   B. Niva depends on iWeaver (module_enabled walks the chain)
--   C. the member app's niva_ask, the staff test, retry and regenerate refuse early and queue nothing; the guard's reasons
--      come in order (not offered, not enabled by Weaver, then iWeaver)
--   D. AI flyer art answers 'unavailable' with the sentence; its status says ai_off
--   E. enqueue_job refuses the iWeaver kinds for a community without `ai`, whoever asks (a platform admin too); the
--      onboarding AI kinds (import mapping, QuickBooks match suggestions) and every other kind are queued as before
--   F. Niva for admins: the chat mode needs iWeaver AND Niva; assistant_usage_check refuses the model call otherwise and
--      counts nothing; 'onboarding' is allowed only while the community's own status is 'onboarding' and Niva itself is on
--   J. the onboarding state cannot be faked: only Weaver changes a community's status (0756)
--   G. the background service's check (worker_job_blocked): iWeaver first, then the kind's own module; worker only
--   H. with iWeaver granted everything works as before   I. grants and search paths
-- Everything runs in one transaction that is rolled back. It does not depend on the catalog migration having added `ai`
-- (0750-0754): the row is added here if it is not there, and made default_off for every kind, as the catalog does.
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
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
-- Back to the test's own role, keeping (or clearing) who auth.uid() says is asking.
create or replace function pg_temp.as_owner(p_user uuid default null) returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', case when p_user is null then '' else jsonb_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
end $$;
create or replace function pg_temp.jobs_of(p_center uuid, p_kind text) returns bigint language sql as $$
  select count(*) from app.jobs where center_id = p_center and kind = p_kind
$$;
grant connect_worker to postgres;

\set off '''AI features are part of iWeaver, which is not on for your community.'''
\set c '''16200000-0000-4000-8000-0000000000c1'''
\set cg '''16200000-0000-4000-8000-0000000000c2'''
\set co '''16200000-0000-4000-8000-0000000000c3'''
\set admin '''16200000-0000-4000-8000-000000000001'''
\set member '''16200000-0000-4000-8000-000000000002'''
\set plat '''16200000-0000-4000-8000-000000000003'''
\set outsider '''16200000-0000-4000-8000-000000000004'''
\set conv '''16200000-0000-4000-8000-0000000000d1'''
\set e '''16200000-0000-4000-8000-0000000000e1'''
\set eg '''16200000-0000-4000-8000-0000000000e2'''

-- iWeaver as the catalog has it: off for every kind until Weaver grants it, and Niva needs it.
insert into app.modules (key, label, description, core, depends_on, sort)
values ('ai', 'iWeaver', 'AI features.', false, '{}', 900)
on conflict (key) do nothing;
update app.category_modules set availability = 'default_off' where module_key = 'ai';
update app.modules set depends_on = depends_on || '{ai}'::text[] where key = 'niva' and not ('ai' = any (depends_on));

insert into auth.users (id, email) values
  (:admin, 'admin162@example.com'), (:member, 'member162@example.com'), (:plat, 'plat162@example.com'), (:outsider, 'outsider162@example.com');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:c, 'orbit162', 'Orbit 162 Community', 'O162', 'TX', 'active'),
  (:cg, 'orbit162g', 'Orbit 162 With iWeaver', 'O162G', 'TX', 'active'),
  (:co, 'orbit162o', 'Orbit 162 Onboarding', 'O162O', 'TX', 'onboarding');
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:cg, 'ai', true, 'Test 162: iWeaver granted.');
insert into app.role_grants (center_id, user_id, role_key) values (:c, :admin, 'center_admin'), (:cg, :admin, 'center_admin'), (:co, :admin, 'center_admin');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  ('16200000-0000-4000-8000-0000000000a1', :c, 'Mira', 'Member', date '1982-01-01'),
  ('16200000-0000-4000-8000-0000000000a2', :cg, 'Mira', 'Member', date '1982-01-01'),
  ('16200000-0000-4000-8000-0000000000a3', :c, 'Anil', 'Admin', date '1975-01-01'),
  ('16200000-0000-4000-8000-0000000000a4', :cg, 'Anil', 'Admin', date '1975-01-01');
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :member, '16200000-0000-4000-8000-0000000000a1'), (:cg, :member, '16200000-0000-4000-8000-0000000000a2'),
  (:c, :admin, '16200000-0000-4000-8000-0000000000a3'), (:cg, :admin, '16200000-0000-4000-8000-0000000000a4');
insert into app.events (id, center_id, name, status, audience, confidential) values
  (:e, :c, 'Spring Fair', 'published', 'public', false),
  (:eg, :cg, 'Spring Fair', 'published', 'public', false);
insert into app.niva_conversations (id, center_id, user_id, question, unanswered, answer_status, created_at) values
  (:conv, :c, :member, 'When is the fair?', true, 'failed', now() - interval '1 hour');
-- A paused question's retry, queued for later (before iWeaver went off).
insert into app.jobs (center_id, kind, payload, run_after, max_attempts)
values (:c, 'niva.answer', jsonb_build_object('conversation_id', :conv::uuid, 'retry', true), now() + interval '6 hours', 3);

-- ── A. The sentence and the list ─────────────────────────────────────────────
select pg_temp.assert(app.ai_off_message() = :off, 'A · one plain sentence');
select pg_temp.assert(app.ai_job_kinds() = array['events.generate_flyer', 'niva.answer'], 'A · the iWeaver job kinds: Niva answers and AI flyer art (as worker/src/ai-kinds.ts)');

-- ── B. Niva depends on iWeaver ───────────────────────────────────────────────
select pg_temp.assert(not app.module_enabled(:c, 'ai') and app.module_enabled(:cg, 'ai'), 'B · iWeaver is off until Weaver grants it');
select pg_temp.assert(not app.module_enabled(:c, 'niva') and app.module_enabled(:cg, 'niva'), 'B · Niva is off while iWeaver is');
select pg_temp.assert(app.module_enabled(:c, 'events'), 'B · Events does not need iWeaver');

-- ── C. Niva refuses early ────────────────────────────────────────────────────
select pg_temp.sign_in(:member);
select pg_temp.assert_raises(format('select app.niva_ask(%L::uuid, %L)', :c, 'When is the fair?'), :off, 'C · a member asking Niva is told iWeaver is not on');
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises(format('select app.niva_test_ask(%L::uuid, %L)', :c, 'When is the fair?'), :off, 'C · so is staff testing Niva');
select pg_temp.assert_raises(format('select app.niva_retry_unanswered(%L::uuid)', :c), :off, 'C · and trying the unanswered questions again');
select pg_temp.assert_raises(format('select app.niva_regenerate(%L::uuid)', :conv), :off, 'C · and regenerating one answer (which checked no module before)');
select pg_temp.assert_raises(format('select app.assert_module_enabled(%L::uuid, %L)', :c, 'niva'), :off, 'C · every Niva guard says the same sentence');
select pg_temp.assert(app.assert_module_enabled(:c, 'events'), 'C · a module that needs no AI passes as before');
select pg_temp.assert_raises(format('select app.assert_module_enabled(%L::uuid, %L)', :c, 'ai'), 'Weaver has not enabled iWeaver for this community.',
  'C · the guard''s reasons keep their order: a module Weaver has not enabled says so first');
select pg_temp.as_owner();
select pg_temp.assert((select count(*) from app.niva_conversations where center_id = :c::uuid) = 1, 'C · no question was saved');
select pg_temp.assert(pg_temp.jobs_of(:c, 'niva.answer') = 1
                      and (select run_after > now() + interval '5 hours' from app.jobs where center_id = :c::uuid and kind = 'niva.answer'),
  'C · nothing was queued, and the queued retry was not brought forward');

-- ── D. AI flyer art ──────────────────────────────────────────────────────────
select pg_temp.sign_in(:admin);
select app.events_request_flyer_art(:e::uuid, 'other', 'frame', 7, 'A decorative border frame. No text of any kind.') as d1 \gset
select pg_temp.assert(:'d1'::jsonb = jsonb_build_object('status', 'unavailable', 'reason', :off), 'D · asking for AI art answers unavailable, with the sentence');
select app.events_request_flyer(:e::uuid, 'An abstract pattern') as d2 \gset
select pg_temp.assert(:'d2'::jsonb = jsonb_build_object('status', 'unavailable', 'reason', :off), 'D · so does the older one-picture flyer');
select pg_temp.assert(app.flyer_art_status(:c) = jsonb_build_object('state', 'ai_off', 'reason', :off), 'D · the flyer panel is told iWeaver is off');
select pg_temp.assert(app.flyer_art_status(:cg) ->> 'state' <> 'ai_off', 'D · with iWeaver the status is the service''s, as before');
select pg_temp.as_owner();
select pg_temp.assert(app.flyer_art_over_limit(:c) = :off, 'D · the one reason both requests read');
select pg_temp.assert(pg_temp.jobs_of(:c, 'events.generate_flyer') = 0
                      and (select flyer_job_id is null from app.events where id = :e::uuid), 'D · no art job was queued');

-- ── E. The queue ─────────────────────────────────────────────────────────────
select pg_temp.assert_raises(format('select app.enqueue_job(%L::uuid, %L, %L::jsonb)', :c, 'niva.answer', '{}'), :off, 'E · a Niva answer is not queued without iWeaver');
select pg_temp.assert_raises(format('select app.enqueue_job(%L::uuid, %L, %L::jsonb)', :c, 'events.generate_flyer', '{}'), :off, 'E · nor AI flyer art');
select pg_temp.as_owner(:plat);
select pg_temp.assert(app.assert_module_enabled(:c, 'niva'), 'E · a platform admin still reads Niva''s screens, as in RLS');
select pg_temp.assert_raises(format('select app.enqueue_job(%L::uuid, %L, %L::jsonb)', :c, 'niva.answer', '{}'), :off, 'E · but cannot queue AI work for the community');
select pg_temp.sign_in(:plat);
select pg_temp.assert_raises(format('select app.niva_test_ask(%L::uuid, %L)', :c, 'When is the fair?'), :off, 'E · not even through the staff test');
select pg_temp.as_owner();
select app.enqueue_job(:c, 'import.suggest_mapping', '{}'::jsonb) is not null as e1 \gset
select app.enqueue_job(:c, 'qbo.match_suggest_ai', '{}'::jsonb) is not null as e2 \gset
select app.enqueue_job(:c, 'demo.ping', '{}'::jsonb) is not null as e3 \gset
select pg_temp.assert(:'e1' and :'e2', 'E · the AI used in onboarding stays core: mapping and QuickBooks match suggestions are queued');
select pg_temp.assert(:'e3', 'E · every other kind is queued as before');
select app.enqueue_job(null, 'niva.answer', '{}'::jsonb) is not null as e4 \gset
select pg_temp.assert(:'e4', 'E · a platform-wide job (no community) is never refused');
select pg_temp.assert_raises($$select app.enqueue_job(null, 'Bad Kind', '{}')$$, 'area.action', 'E · a malformed kind is still refused first');
delete from app.jobs where center_id is null and kind = 'niva.answer' and payload = '{}'::jsonb;

-- ── F. Niva for admins: the chat mode and the model call's count ─────────────
select pg_temp.assert(app.assistant_chat_mode(:c) = 'off' and app.assistant_chat_mode(:cg) = 'on' and app.assistant_chat_mode(:co) = 'onboarding',
  'F · the chat: off without iWeaver, on with iWeaver and Niva, onboarding pages only while onboarding');
insert into app.center_modules (center_id, module_key, enabled, reason) values
  (:cg, 'niva', false, 'Test 162: Niva paused.'), (:co, 'niva', false, 'Test 162: Niva paused.');
select pg_temp.assert(app.assistant_chat_mode(:cg) = 'off' and app.assistant_chat_mode(:co) = 'off',
  'F · pausing Niva keeps the chat off, with iWeaver or while onboarding');
select pg_temp.sign_in(:admin);
select app.assistant_usage_check(:cg) as f0 \gset
select app.assistant_usage_check(:co, 1, 'onboarding') as f00 \gset
select pg_temp.assert((:'f0'::jsonb ->> 'allowed')::boolean = false and (:'f00'::jsonb ->> 'allowed')::boolean = false
                      and :'f0'::jsonb ->> 'reason' like '% is switched off for your community, so Niva for admins can''t answer questions.'
                      and :'f00'::jsonb ->> 'reason' = :'f0'::jsonb ->> 'reason',
  'F · and the count says so in plain words, counting nothing');
select pg_temp.as_owner();
delete from app.center_modules where center_id in (:cg::uuid, :co::uuid) and module_key = 'niva';
select pg_temp.assert(not exists (select 1 from app.assistant_usage where center_id in (:cg::uuid, :co::uuid)), 'F · nothing was counted while Niva was paused');
select pg_temp.sign_in(:admin);
select app.assistant_usage_check(:c) as f1 \gset
select pg_temp.assert((:'f1'::jsonb ->> 'allowed')::boolean = false and :'f1'::jsonb ->> 'reason' = :off and (:'f1'::jsonb ->> 'used')::int = 0,
  'F · the chat''s model call is refused without iWeaver, and nothing is counted');
select app.assistant_usage_check(:c, 1, 'onboarding') as f2 \gset
select pg_temp.assert((:'f2'::jsonb ->> 'allowed')::boolean = false and :'f2'::jsonb ->> 'reason' = :off,
  'F · ''onboarding'' does not open it for a community that is not onboarding');
select app.assistant_usage_check(:co) as f3 \gset
select pg_temp.assert((:'f3'::jsonb ->> 'allowed')::boolean = false, 'F · an onboarding community''s ordinary chat needs iWeaver too');
select app.assistant_usage_check(:co, 1, 'onboarding') as f4 \gset
select app.assistant_usage_check(:co, 2, 'onboarding') as f5 \gset
select pg_temp.assert((:'f4'::jsonb ->> 'allowed')::boolean and (:'f4'::jsonb ->> 'used')::int = 1 and (:'f5'::jsonb ->> 'used')::int = 3,
  'F · asking during onboarding stays core, and counts against the same month');
select app.assistant_usage_check(:cg) as f6 \gset
select pg_temp.assert((:'f6'::jsonb ->> 'allowed')::boolean and (:'f6'::jsonb ->> 'used')::int = 1, 'F · with iWeaver the chat counts as before');
select pg_temp.assert_raises(format('select app.assistant_usage_check(%L::uuid, 1, %L)', :cg, 'everything'), 'chat or onboarding', 'F · the purpose is one of two');
select pg_temp.assert_raises(format('select app.assistant_usage_check(%L::uuid, 9, %L)', :co, 'onboarding'), 'between 1 and 5', 'F · and the cost is checked as before');
select pg_temp.sign_in(:outsider);
select pg_temp.assert_raises(format('select app.assistant_usage_check(%L::uuid, 1, %L)', :co, 'onboarding'), 'have access to this area', 'F · only the community''s staff');
select pg_temp.as_owner();
update app.centers set status = 'active' where id = :co::uuid;
select pg_temp.sign_in(:admin);
select app.assistant_usage_check(:co, 1, 'onboarding') as f7 \gset
select pg_temp.assert((:'f7'::jsonb ->> 'allowed')::boolean = false, 'F · once the community is live, onboarding no longer opens the chat');
select pg_temp.as_owner();
select pg_temp.assert(not exists (select 1 from app.assistant_usage where center_id = :c::uuid), 'F · the refused community''s month is untouched');

-- ── J. The onboarding state cannot be faked (0756) ───────────────────────────
-- The community's admin may update its own row (centers_admin_update), but never its status.
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises(format('update app.centers set status = %L where id = %L::uuid', 'onboarding', :c), 'Only the Weaver team',
  'J · a live community''s admin cannot set it back to onboarding to get the chat without iWeaver');
select pg_temp.assert_raises(format('update app.centers set status = %L where id = %L::uuid', 'onboarding', :co), 'Only the Weaver team',
  'J · not even for a community that was onboarding before');
select pg_temp.assert_raises(format('update app.centers set status = %L where id = %L::uuid', 'suspended', :c), 'Only the Weaver team',
  'J · nor change it any other way');
update app.centers set short_name = 'O162C' where id = :c::uuid;
select app.assistant_usage_check(:c, 1, 'onboarding') ->> 'allowed' as j1 \gset
select pg_temp.as_owner();
select pg_temp.assert((select status = 'active' and short_name = 'O162C' from app.centers where id = :c::uuid),
  'J · the status is unchanged, and the rest of the row is still the admin''s to change');
select pg_temp.assert(:'j1' = 'false' and app.assistant_chat_mode(:c) = 'off', 'J · so the chat stays off without iWeaver');
select pg_temp.sign_in(:plat);
update app.centers set status = 'onboarding' where id = :co::uuid;
select pg_temp.as_owner();
select pg_temp.assert((select status from app.centers where id = :co::uuid) = 'onboarding' and app.assistant_chat_mode(:co) = 'onboarding',
  'J · Weaver still sets a community''s status');

-- ── G. The background service's check ────────────────────────────────────────
set local role connect_worker;
select pg_temp.assert(app.worker_job_blocked(:c, array['ai', 'niva']) = :off, 'G · a Niva job of a community without iWeaver is not run');
select pg_temp.assert(app.worker_job_blocked(:c, array['ai', 'events']) = :off, 'G · nor an AI art job');
select pg_temp.assert(app.worker_job_blocked(:cg, array['ai', 'niva']) is null, 'G · with iWeaver and Niva on it runs');
select pg_temp.assert(app.worker_job_blocked(null, array['ai', 'niva']) is null, 'G · a platform-wide job is never stopped');
select pg_temp.assert(app.worker_job_blocked(:c, '{}'::text[]) is null, 'G · a kind that needs nothing runs');
reset role;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:cg, 'niva', false, 'Test 162: Niva paused.');
set local role connect_worker;
select app.worker_job_blocked(:cg, array['ai', 'niva']) as g1 \gset
select pg_temp.assert(:'g1' like '% is switched off for your community.' and :'g1' <> :off,
  'G · a queued answer stops once Niva is switched off, saying Niva is off');
reset role;
delete from app.center_modules where center_id = :cg::uuid and module_key = 'niva';
select pg_temp.assert_raises(format('select app.worker_job_blocked(%L::uuid, array[%L])', :c, 'ai'), 'Only the background service', 'G · the check is for the background service only');

-- ── H. With iWeaver granted ──────────────────────────────────────────────────
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c, 'ai', true, 'Test 162: iWeaver granted.');
select pg_temp.sign_in(:member);
select (app.niva_ask(:c, 'When is the fair?')).id as h1 \gset
select pg_temp.sign_in(:admin);
select app.events_request_flyer_art(:e::uuid, 'other', 'frame', 8, 'A decorative border frame. No text of any kind.') ->> 'status' as h2 \gset
select (app.niva_regenerate(:conv)).answer_status as h3 \gset
select pg_temp.as_owner();
select pg_temp.assert(:'h1' is not null and exists (select 1 from app.jobs where kind = 'niva.answer' and payload ->> 'conversation_id' = :'h1'),
  'H · with iWeaver a member''s question is saved and queued');
select pg_temp.assert(:'h2' = 'queued', 'H · AI art is queued');
select pg_temp.assert(:'h3' = 'pending'
                      and (select run_after <= now() from app.jobs where kind = 'niva.answer' and payload ->> 'conversation_id' = :conv::text),
  'H · regenerating brings the queued retry forward, as before');
select pg_temp.assert(app.module_enabled(:c, 'niva'), 'H · Niva is on again');

-- ── I. Grants and search paths ───────────────────────────────────────────────
select pg_temp.assert(has_function_privilege('connect_worker', 'app.worker_job_blocked(uuid, text[])', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_job_blocked(uuid, text[])', 'execute')
                      and not has_function_privilege('anon', 'app.worker_job_blocked(uuid, text[])', 'execute'),
  'I · the worker''s check is the worker''s alone');
select pg_temp.assert((select bool_and(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'))
                         from unnest(array['app.ai_off_message()', 'app.ai_job_kinds()', 'app.assert_ai_enabled(uuid)', 'app.ai_onboarding_exempt(uuid)',
                                           'app._module_on_apart_from_ai(uuid, text)', 'app.flyer_art_over_limit(uuid)',
                                           'app.centers_guard_status()']) f),
  'I · the helpers cannot be called from outside');
select pg_temp.assert(has_function_privilege('authenticated', 'app.assistant_chat_mode(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.assistant_chat_mode(uuid)', 'execute'),
  'I · the chat mode is for signed-in people (the portal reads it before the chat answers)');
select pg_temp.assert(exists (select 1 from pg_trigger t where t.tgrelid = 'app.centers'::regclass and t.tgname = 'centers_guard_status' and not t.tgisinternal),
  'I · the status guard is on the communities table');
select pg_temp.assert(has_function_privilege('authenticated', 'app.assistant_usage_check(uuid, integer, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.assistant_usage_check(uuid, integer)', 'execute')
                      and not has_function_privilege('anon', 'app.assistant_usage_check(uuid, integer, text)', 'execute'),
  'I · both forms of the count are for signed-in people only');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.enqueue_job(uuid, text, jsonb, timestamptz, integer)', 'execute'),
  'I · the queue is still not callable over the API');
select pg_temp.assert((select count(*) from pg_proc p
                        where p.oid in ('app.ai_off_message()'::regprocedure, 'app.ai_job_kinds()'::regprocedure, 'app.assert_ai_enabled(uuid)'::regprocedure,
                                        'app.ai_onboarding_exempt(uuid)'::regprocedure, 'app.worker_job_blocked(uuid, text[])'::regprocedure,
                                        'app.assistant_usage_check(uuid, integer, text)'::regprocedure, 'app.assistant_chat_mode(uuid)'::regprocedure,
                                        'app._module_on_apart_from_ai(uuid, text)'::regprocedure, 'app.centers_guard_status()'::regprocedure)
                          and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) = 0,
  'I · none of the new functions is open to PUBLIC');
select pg_temp.assert((select bool_and(p.proconfig @> array['search_path=app, public, extensions'])
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app'
                          and p.proname in ('ai_off_message', 'ai_job_kinds', 'assert_ai_enabled', 'ai_onboarding_exempt', 'assert_module_enabled',
                                            'enqueue_job', 'niva_regenerate', 'flyer_art_over_limit', 'flyer_art_status', 'assistant_usage_check',
                                            'worker_job_blocked', 'assistant_chat_mode', '_module_on_apart_from_ai', 'centers_guard_status')),
  'I · every function here pins the search path with extensions');
rollback;
