-- 0530 (backlog B14): Niva answering — app.niva_ask enqueues the job, only
-- the background worker can read/search/write it, staff can regenerate,
-- and 30-day retention actually deletes.
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
create or replace function pg_temp.sign_in(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant connect_worker to postgres;

-- ── Fixtures ────────────────────────────────────────────────────────────────
\set c '''44000000-0000-4000-8000-0000000000c1'''
\set c2 '''44000000-0000-4000-8000-0000000000c2'''
\set admin '''44000000-0000-4000-8000-000000000001'''
\set member '''44000000-0000-4000-8000-000000000002'''
\set outsider '''44000000-0000-4000-8000-000000000003'''
insert into auth.users (id, email) values (:admin, 'admin44@example.com'), (:member, 'member44@example.com'), (:outsider, 'outsider44@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:c, 'orbit44', 'Orbit Test Community', 'OTC', 'TX', 'active'),
  (:c2, 'orbit44b', 'Other Test Community', 'OTC2', 'TX', 'active');
insert into app.role_grants (center_id, user_id, role_key) values (:c, :admin, 'center_admin');
insert into app.households (id, center_id, display_name) values ('44000000-0000-4000-8000-0000000000a1', :c, 'Shah household');
insert into app.people (id, center_id, first_name, last_name) values ('44000000-0000-4000-8000-0000000000a2', :c, 'Asha', 'Shah');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('44000000-0000-4000-8000-0000000000a1', '44000000-0000-4000-8000-0000000000a2', :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c, :member, '44000000-0000-4000-8000-0000000000a2');

-- 0579: Niva answers from the community's own content first, and queues a niva.answer job only while AI
-- answers are on (centers.rules.niva.ai = 'haiku'). This test covers the job path, so :c has AI answers on and
-- its sources are added after the first question (test 69 covers the own answers).
update app.centers set rules = coalesce(rules, '{}'::jsonb) || '{"niva": {"ai": "haiku"}}'::jsonb where id = :c::uuid;

-- ── A member asks a question: saved unanswered, and a job is enqueued ───────
begin;
select pg_temp.sign_in(:member);
select (app.niva_ask(:c::uuid, '  What time is the derasar open   today?  ')).id as conv \gset
commit;
select pg_temp.assert(:'conv' is not null, 'the question is saved');
select pg_temp.assert((select unanswered from app.niva_conversations where id = :'conv'::uuid) = true, 'saved as unanswered');
select pg_temp.assert((select answer_status = 'pending' and answered_at is null from app.niva_conversations where id = :'conv'::uuid),
  'saved with answer_status pending (0572)');
select pg_temp.assert((select user_id from app.niva_conversations where id = :'conv'::uuid) = :member::uuid, 'user_id is the asker, from auth.uid()');
select pg_temp.assert((select question from app.niva_conversations where id = :'conv'::uuid) = 'What time is the derasar open today?', 'the question is trimmed and whitespace-normalised');
select pg_temp.assert((select count(*) from app.jobs where kind = 'niva.answer' and center_id = :c::uuid and (payload->>'conversation_id')::uuid = :'conv'::uuid) = 1,
  'a niva.answer job was enqueued for this conversation');

insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  ('44000000-0000-4000-8000-00000000000a', :c, 'niva_source', 'timings', 'Derasar timings', 'The derasar is open every day from 6 AM to 12 PM and 4 PM to 8 PM.', 'published'),
  ('44000000-0000-4000-8000-00000000000b', :c, 'niva_source', 'draft-only', 'Unapproved draft', 'This mentions timings too but is only a draft.', 'draft'),
  ('44000000-0000-4000-8000-00000000000c', :c2, 'niva_source', 'other-center', 'Another center''s timings', 'A different center''s derasar timings, never this member''s.', 'published'),
  ('44000000-0000-4000-8000-00000000000d', null, 'niva_source', 'shared-pack', 'Shared Jainism basics', 'Ahimsa is the practice of non-violence, central to Jain philosophy.', 'published');

-- ── A blank question is refused ──────────────────────────────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_ask('44000000-0000-4000-8000-0000000000c1'::uuid, '   ')$$, 'type a question', 'a blank question is refused');
commit;

-- ── Someone who is not a member of the center cannot ask ────────────────────
begin;
select pg_temp.sign_in(:outsider);
select pg_temp.assert_raises($$select app.niva_ask('44000000-0000-4000-8000-0000000000c1'::uuid, 'Am I eligible to vote?')$$, 'not a member', 'a non-member cannot ask Niva for this center');
commit;

-- ── The niva module can be switched off ──────────────────────────────────────
insert into app.center_modules (center_id, module_key, enabled) values (:c, 'niva', false);
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_ask('44000000-0000-4000-8000-0000000000c1'::uuid, 'When is the derasar open?')$$, 'switched off', 'asking is refused once the niva module is switched off');
commit;
delete from app.center_modules where center_id = :c and module_key = 'niva';

-- ── Only the background service can read a conversation for answering ───────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_worker_get_conversation('$$ || :'conv' || $$'::uuid)$$, 'permission denied', 'a member cannot call the worker''s read function');
commit;
begin;
set local role connect_worker;
select (app.niva_worker_get_conversation(:'conv'::uuid)->>'question') as q \gset
commit;
select pg_temp.assert(:'q' = 'What time is the derasar open today?', 'connect_worker reads the conversation''s question');

-- ── Retrieval: only this center''s published niva_source rows, plus the shared pack ──
begin;
set local role connect_worker;
select app.niva_worker_search_sources(:c::uuid, 'derasar timings', 6) as found \gset
commit;
select pg_temp.assert((:'found'::jsonb @> '[{"id":"44000000-0000-4000-8000-00000000000a"}]'::jsonb), 'the published, matching source for this center is found');
select pg_temp.assert(not (:'found'::jsonb::text like '%00000000000b%'), 'a draft source is never offered, even if it matches');
select pg_temp.assert(not (:'found'::jsonb::text like '%00000000000c%'), 'a published source belonging to a different center is never offered');
begin;
set local role connect_worker;
select app.niva_worker_search_sources(:c::uuid, 'ahimsa non-violence', 6) as shared \gset
commit;
select pg_temp.assert((:'shared'::jsonb @> '[{"id":"44000000-0000-4000-8000-00000000000d"}]'::jsonb), 'the shared platform-pack source (center_id null) is offered to any center');
begin;
set local role connect_worker;
select app.niva_worker_search_sources(:c::uuid, 'quantum astrophysics blockchain', 6) as nothing \gset
commit;
select pg_temp.assert(:'nothing' = '[]', 'an unrelated question matches no source');

-- ── Only the background service can write an answer ──────────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_worker_store_answer('$$ || :'conv' || $$'::uuid, 'The derasar is open 6-12 and 4-8.', '[]'::jsonb, 'claude-opus-5')$$,
  'permission denied', 'a member cannot write an answer directly');
commit;
begin;
set local role connect_worker;
select app.niva_worker_store_answer(:'conv'::uuid, 'The derasar is open 6 AM-12 PM and 4-8 PM.', '[{"content_item_id":"44000000-0000-4000-8000-00000000000a","title":"Derasar timings"}]'::jsonb, 'claude-opus-5');
commit;
select pg_temp.assert((select unanswered from app.niva_conversations where id = :'conv'::uuid) = false, 'the conversation is now answered');
select pg_temp.assert((select answer from app.niva_conversations where id = :'conv'::uuid) = 'The derasar is open 6 AM-12 PM and 4-8 PM.', 'the answer text is stored');
select pg_temp.assert((select sources->0->>'title' from app.niva_conversations where id = :'conv'::uuid) = 'Derasar timings', 'the cited source is stored');
select pg_temp.assert((select answer_status = 'answered' and model = 'claude-opus-5' and answered_at is not null
                         from app.niva_conversations where id = :'conv'::uuid), 'answer_status, the model and answered_at are stored (0572)');
begin;
set local role connect_worker;
select pg_temp.assert_raises($$select app.niva_worker_store_answer('$$ || :'conv' || $$'::uuid, '   ', '[]'::jsonb, 'claude-opus-5')$$,
  'non-empty answer', 'an empty answer cannot be written (the caller must leave the conversation unanswered instead)');
commit;

-- ── The member reads their own answered conversation ─────────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert((select count(*) from app.niva_conversations where id = :'conv'::uuid and user_id = auth.uid()) = 1, 'the member reads back their own answered question');
commit;

-- ── Regenerate: content.manage only, re-enqueues the job ────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_regenerate('$$ || :'conv' || $$'::uuid)$$, 'content.manage', 'a plain member cannot regenerate an answer');
commit;
-- The first job has finished (the worker stored the answer above). Since 0572 a regenerate adds
-- nothing while a job for the same question is running or already due.
update app.jobs set status = 'done', finished_at = now() where kind = 'niva.answer' and payload->>'conversation_id' = :'conv';
begin;
select pg_temp.sign_in(:admin);
select app.niva_regenerate(:'conv'::uuid);
commit;
select pg_temp.assert((select count(*) from app.jobs where kind = 'niva.answer' and (payload->>'conversation_id')::uuid = :'conv'::uuid) = 2,
  'regenerate enqueues a second niva.answer job, keeping the first');
select pg_temp.assert((select answer from app.niva_conversations where id = :'conv'::uuid) is not null, 'the existing answer stays visible until the new job finishes');
select pg_temp.assert((select answer_status from app.niva_conversations where id = :'conv'::uuid) = 'answered',
  'a question that still shows its answer stays answered while it is regenerated (0572)');

-- ── 30-day retention: only the background service, and it actually deletes ──
insert into app.niva_conversations (id, center_id, user_id, question, answer, created_at) values
  ('44000000-0000-4000-8000-00000000000e', :c, :member, 'An old question', 'An old answer', now() - interval '31 days'),
  ('44000000-0000-4000-8000-00000000000f', :c, :member, 'A recent question', 'A recent answer', now() - interval '2 days');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_expired_conversations(100)$$, 'permission denied', 'only the background service runs retention');
commit;
begin;
set local role connect_worker;
select app.niva_expired_conversations(1000) as n \gset
commit;
select pg_temp.assert(:n::int >= 1, 'at least the 31-day-old conversation was removed');
select pg_temp.assert((select count(*) from app.niva_conversations where id = '44000000-0000-4000-8000-00000000000e') = 0, 'the 31-day-old conversation is gone');
select pg_temp.assert((select count(*) from app.niva_conversations where id = '44000000-0000-4000-8000-00000000000f') = 1, 'the 2-day-old conversation stays');

-- ── Grants: the worker-only functions really are worker-only ────────────────
select pg_temp.assert(not has_function_privilege('authenticated', 'app.niva_worker_get_conversation(uuid)', 'execute'), 'authenticated cannot execute niva_worker_get_conversation');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.niva_worker_search_sources(uuid,text,int)', 'execute'), 'authenticated cannot execute niva_worker_search_sources');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.niva_worker_store_answer(uuid,text,jsonb,text)', 'execute'), 'authenticated cannot execute niva_worker_store_answer');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.niva_expired_conversations(int)', 'execute'), 'authenticated cannot execute niva_expired_conversations');
select pg_temp.assert(has_function_privilege('connect_worker', 'app.niva_worker_get_conversation(uuid)', 'execute'), 'connect_worker can execute niva_worker_get_conversation');
select pg_temp.assert(has_function_privilege('authenticated', 'app.niva_ask(uuid,text)', 'execute'), 'authenticated can execute niva_ask');
select pg_temp.assert(not has_function_privilege('anon', 'app.niva_ask(uuid,text)', 'execute'), 'anon cannot execute niva_ask');

-- 0531: the niva.monthly_questions entitlement (sandbox: 300/month) is enforced
-- by app.niva_ask itself — a running count of this center's niva_conversations
-- created since the start of the current calendar month, +1 for the question
-- about to be asked, against app.entitlement_defaults('sandbox','niva.monthly_questions').
\set c3 '''44000000-0000-4000-8000-0000000000c3'''
\set member2 '''44000000-0000-4000-8000-000000000004'''
insert into auth.users (id, email) values (:member2, 'member2-44@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, environment) values
  (:c3, 'orbit44c', 'Sandbox Test Community', 'OTC3', 'TX', 'active', 'sandbox');
insert into app.households (id, center_id, display_name) values ('44000000-0000-4000-8000-0000000000b1', :c3, 'Mehta household');
insert into app.people (id, center_id, first_name, last_name) values ('44000000-0000-4000-8000-0000000000b2', :c3, 'Neha', 'Mehta');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('44000000-0000-4000-8000-0000000000b1', '44000000-0000-4000-8000-0000000000b2', :c3, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c3, :member2, '44000000-0000-4000-8000-0000000000b2');

-- 299 questions already asked this month — one short of the sandbox's 300 cap.
insert into app.niva_conversations (center_id, user_id, question, unanswered, created_at)
select :c3::uuid, :member2::uuid, 'Filler question ' || gs, true, now() - (gs || ' seconds')::interval
  from generate_series(1, 299) gs;

-- The 300th question this month is still allowed (299 + 1 = 300, at the cap, not over it).
begin;
select pg_temp.sign_in(:member2);
select (app.niva_ask(:c3::uuid, 'This is question number three hundred')).id as conv300 \gset
commit;
select pg_temp.assert(:'conv300' is not null, 'the 300th question this month is allowed (300 is not over the 300 cap)');

-- The 301st question this month is refused with the entitlement's own plain-English message.
begin;
select pg_temp.sign_in(:member2);
select pg_temp.assert_raises($$select app.niva_ask('44000000-0000-4000-8000-0000000000c3'::uuid, 'This is question number three hundred and one')$$,
  'niva questions a month, and they are used up', 'the 301st question this month is refused once the sandbox cap is used up');
commit;
select pg_temp.assert((select count(*) from app.niva_conversations where center_id = :c3::uuid
  and question = 'This is question number three hundred and one') = 0, 'the refused 301st question was never saved');
select pg_temp.assert((select count(*) from app.jobs where kind = 'niva.answer' and center_id = :c3::uuid
  and payload->>'conversation_id' in (select id::text from app.niva_conversations where center_id = :c3::uuid and question like '%three hundred and one%')) = 0,
  'no answering job was enqueued for the refused question');

-- A production-environment center (the default, e.g. center :c above) has no monthly cap.
select pg_temp.assert(jsonb_typeof(app.entitlement(:c::uuid, 'niva.monthly_questions')) = 'null', 'a production center has no niva.monthly_questions limit (null = unlimited)');
