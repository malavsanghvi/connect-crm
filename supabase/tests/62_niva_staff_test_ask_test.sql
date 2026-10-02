-- 0575: Niva staff tests. Who may test (content.draft or content.manage, no membership needed; a
-- member, content.view or an outsider may not); the test row and its niva.answer job with
-- include_in_review; the daily allowance of 100 tests per community (the community's own day);
-- tests stay out of the monthly question limit, Niva health's question counts, "Try all unanswered
-- questions again" and a member's follow-up context; the test result for the portal's test box
-- (who may read it, the job, each cited source's current status, live items from the schedule); a
-- staff test previews only the community's own sources waiting for approval, never the shared
-- library's; only content staff can save a question marked as a test (the niva_insert policy stays);
-- grants and search paths.
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
-- niva.answer jobs of one conversation, optionally of one status.
create or replace function pg_temp.jobs_of(p_conv uuid, p_status text default null) returns bigint language sql as $$
  select count(*) from app.jobs where kind = 'niva.answer' and payload->>'conversation_id' = p_conv::text
     and (p_status is null or status = p_status)
$$;
grant connect_worker to postgres;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
\set c '''62000000-0000-4000-8000-0000000000c1'''
\set cs '''62000000-0000-4000-8000-0000000000c2'''
\set c2 '''62000000-0000-4000-8000-0000000000c3'''
\set admin '''62000000-0000-4000-8000-000000000001'''
\set editor '''62000000-0000-4000-8000-000000000002'''
\set editor2 '''62000000-0000-4000-8000-000000000003'''
\set viewer '''62000000-0000-4000-8000-000000000004'''
\set member '''62000000-0000-4000-8000-000000000005'''
\set outsider '''62000000-0000-4000-8000-000000000006'''
\set src_pub '''62000000-0000-4000-8000-00000000000a'''
\set src_rev '''62000000-0000-4000-8000-00000000000b'''
\set guide '''62000000-0000-4000-8000-00000000000d'''
insert into auth.users (id, email) values
  (:admin, 'admin62@example.com'), (:editor, 'editor62@example.com'), (:editor2, 'editor62b@example.com'),
  (:viewer, 'viewer62@example.com'), (:member, 'member62@example.com'), (:outsider, 'outsider62@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c, 'orbit62', 'Orbit Test Ask Community', 'OTC', 'TX', 'active', 'Asia/Kolkata'),
  (:c2, 'orbit62b', 'Orbit Second Community', 'OSC', 'TX', 'active', 'America/Chicago');
insert into app.centers (id, slug, name, short_name, state_region, status, environment) values
  (:cs, 'orbit62s', 'Orbit Sandbox Test Community', 'OST', 'TX', 'active', 'sandbox');
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :admin, 'center_admin'), (:cs, :admin, 'center_admin'), (:c2, :admin, 'center_admin'),
  (:c, :editor, 'content_editor'), (:cs, :editor, 'content_editor'),
  (:c, :editor2, 'content_editor'),
  (:c, :viewer, 'executive_viewer');
insert into app.households (id, center_id, display_name) values
  ('62000000-0000-4000-8000-0000000000a1', :c, 'Shah household'),
  ('62000000-0000-4000-8000-0000000000a3', :cs, 'Shah household'),
  ('62000000-0000-4000-8000-0000000000a5', :c, 'Mehta household');
insert into app.people (id, center_id, first_name, last_name) values
  ('62000000-0000-4000-8000-0000000000a2', :c, 'Asha', 'Shah'),
  ('62000000-0000-4000-8000-0000000000a4', :cs, 'Asha', 'Shah'),
  ('62000000-0000-4000-8000-0000000000a6', :c, 'Ravi', 'Mehta');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('62000000-0000-4000-8000-0000000000a1', '62000000-0000-4000-8000-0000000000a2', :c, 'primary', true),
  ('62000000-0000-4000-8000-0000000000a3', '62000000-0000-4000-8000-0000000000a4', :cs, 'primary', true),
  ('62000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-0000000000a6', :c, 'primary', true);
-- The member belongs to c and cs; the admin is also a member of c (for the follow-up context check).
-- The content editors belong to no household: testing needs no membership.
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :member, '62000000-0000-4000-8000-0000000000a2'),
  (:cs, :member, '62000000-0000-4000-8000-0000000000a4'),
  (:c, :admin, '62000000-0000-4000-8000-0000000000a6');
-- 0579: Niva answers from the community's own content first, and queues a niva.answer job only while AI answers
-- are on (centers.rules.niva.ai = 'haiku'). This test covers the job path, so its communities have AI answers on and
-- :c's sources are added after the first two tests (test 69 covers the own answers).
update app.centers set rules = coalesce(rules, '{}'::jsonb) || '{"niva": {"ai": "haiku"}}'::jsonb where id in (:c::uuid, :cs::uuid, :c2::uuid);

-- ── Who may test ─────────────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_test_ask('62000000-0000-4000-8000-0000000000c1'::uuid, 'When is the derasar open?')$$,
  'content.draft or content.manage', 'a member cannot test Niva');
commit;
begin;
select pg_temp.sign_in(:viewer);
select pg_temp.assert_raises($$select app.niva_test_ask('62000000-0000-4000-8000-0000000000c1'::uuid, 'When is the derasar open?')$$,
  'content.draft or content.manage', 'content.view is not enough to test Niva');
commit;
begin;
select pg_temp.sign_in(:outsider);
select pg_temp.assert_raises($$select app.niva_test_ask('62000000-0000-4000-8000-0000000000c1'::uuid, 'When is the derasar open?')$$,
  'content.draft or content.manage', 'someone outside the community cannot test Niva');
commit;
begin;
select pg_temp.sign_in(:editor);
select pg_temp.assert(not app.is_member_of(:c::uuid), 'the content editor is not a member of the community');
select app.niva_test_ask(:c::uuid, '  When is   the derasar open?  ') as t1 \gset
commit;
select pg_temp.assert((:'t1'::jsonb->>'id') is not null and (:'t1'::jsonb->>'question') = 'When is the derasar open?'
                      and (:'t1'::jsonb->>'include_in_review') = 'false'
                      and (:'t1'::jsonb->>'tests_today')::int = 1 and (:'t1'::jsonb->>'daily_limit')::int = 100,
  'content.draft staff can test Niva without being a member; the reply says how many tests today and the limit');
select (:'t1'::jsonb->>'id') as t1_id \gset
select pg_temp.assert((select is_test and user_id = :editor::uuid and answer_status = 'pending' and unanswered and answer is null
                         from app.niva_conversations where id = :'t1_id'::uuid),
  'the test is saved as a pending staff test, asked by the tester');
select pg_temp.assert(pg_temp.jobs_of(:'t1_id'::uuid, 'queued') = 1
                      and (select payload = jsonb_build_object('conversation_id', :'t1_id', 'include_in_review', false) and max_attempts = 3
                             from app.jobs where kind = 'niva.answer' and payload->>'conversation_id' = :'t1_id'),
  'one niva.answer job is queued, with include_in_review false');

begin;
select pg_temp.sign_in(:admin);
select app.niva_test_ask(:c::uuid, 'Where do I park?', true) as t2 \gset
commit;
select (:'t2'::jsonb->>'id') as t2_id \gset
select pg_temp.assert((:'t2'::jsonb->>'include_in_review') = 'true' and (:'t2'::jsonb->>'tests_today')::int = 2,
  'content.manage staff can test, including sources waiting for approval');
select pg_temp.assert((select payload->'include_in_review' = 'true'::jsonb from app.jobs
                        where kind = 'niva.answer' and payload->>'conversation_id' = :'t2_id'),
  'the job carries include_in_review true, for the worker to search sources waiting for approval');

insert into app.content_items (id, center_id, kind, slug, title, body_md, status, metadata) values
  (:src_pub, :c, 'niva_source', 'timings-62', 'Derasar timings', 'The derasar is open every day from 6 AM to 12 PM.', 'published', '{}'),
  (:src_rev, :c, 'niva_source', 'parking-62', 'Parking', 'Park in the east lot on festival days.', 'in_review',
   '{"source_url":"https://example.org/visit"}');
insert into app.guide_sections (id, center_id, slug, title, body_md, public) values
  (:guide, :c, 'visiting-62', 'Visiting the derasar', 'Remove your shoes before entering.', true);

begin;
select pg_temp.sign_in(:editor);
select pg_temp.assert_raises($$select app.niva_test_ask('62000000-0000-4000-8000-0000000000c1'::uuid, '   ')$$,
  'type a question first', 'a blank test is refused');
select app.niva_test_ask(:c::uuid, repeat('a', 1500)) as tlong \gset
commit;
select pg_temp.assert((select char_length(question) = 1000 from app.niva_conversations where id = (:'tlong'::jsonb->>'id')::uuid),
  'a long test question is cut to 1000 characters');
insert into app.center_modules (center_id, module_key, enabled) values (:c, 'niva', false);
begin;
select pg_temp.sign_in(:editor);
select pg_temp.assert_raises($$select app.niva_test_ask('62000000-0000-4000-8000-0000000000c1'::uuid, 'Is Niva on?')$$,
  'switched off', 'testing is refused while the niva module is off');
commit;
delete from app.center_modules where center_id = :c and module_key = 'niva';

-- ── The daily allowance: 100 tests per community per day ─────────────────────
-- A test from before the community's midnight does not count; one at midnight does.
insert into app.niva_conversations (center_id, user_id, question, unanswered, is_test, created_at) values
  (:c, :editor, 'Yesterday''s test', true, true, app.niva_center_day_start(:c::uuid) - interval '1 minute'),
  (:c, :editor, 'A test at midnight', true, true, app.niva_center_day_start(:c::uuid));
select pg_temp.assert(app.niva_center_day_start(:c::uuid) = (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),
  'the day starts at midnight in the community''s time zone');
select pg_temp.assert(app.niva_tests_today(:c::uuid) = 4, 'today''s tests: three asked now and the one at midnight, not yesterday''s');
-- Members' questions never count toward the test allowance.
insert into app.niva_conversations (center_id, user_id, question, unanswered) values (:c, :member, 'A member question', true);
select pg_temp.assert(app.niva_tests_today(:c::uuid) = 4, 'members'' questions do not count toward the test allowance');
-- Up to 99 tests today, then the 100th fits and the 101st does not.
insert into app.niva_conversations (center_id, user_id, question, unanswered, is_test)
select :c::uuid, :editor::uuid, 'Filler test ' || g, true, true from generate_series(1, 99 - app.niva_tests_today(:c::uuid)) g;
begin;
select pg_temp.sign_in(:editor);
select app.niva_test_ask(:c::uuid, 'The hundredth test') as t100 \gset
commit;
select pg_temp.assert((:'t100'::jsonb->>'tests_today')::int = 100, 'the 100th test of the day fits');
begin;
select pg_temp.sign_in(:editor2);
select pg_temp.assert_raises($$select app.niva_test_ask('62000000-0000-4000-8000-0000000000c1'::uuid, 'One test too many')$$,
  'test Niva 100 times a day', 'the 101st test of the day is refused, whoever asks');
commit;
begin;
select pg_temp.sign_in(:member);
select (app.niva_ask(:c::uuid, 'Members can still ask')).id as qm \gset
commit;
select pg_temp.assert(:'qm' is not null, 'members can still ask once staff tests are used up');
begin;
select pg_temp.sign_in(:admin);
select app.niva_test_ask(:c2::uuid, 'A test in another community') as tother \gset
select app.niva_health(:c::uuid) as hc \gset
commit;
select pg_temp.assert((:'tother'::jsonb->>'tests_today')::int = 1, 'the allowance is per community');
select pg_temp.assert((:'hc'::jsonb->'tests_today') = '{"used":100,"limit":100}'::jsonb, 'Niva health says how many tests are used today, and the limit');

-- ── Tests stay out of the monthly question limit and the health counts ───────
-- Exactly one more member question fits this month in the sandbox.
insert into app.center_entitlements (center_id, key, value, reason)
select :cs::uuid, 'niva.monthly_questions', to_jsonb(count(*) + 1), 'Test 62: one more question fits'
  from app.niva_conversations where center_id = :cs::uuid and created_at >= date_trunc('month', current_date)::timestamptz;
begin;
select pg_temp.sign_in(:editor);
select app.niva_test_ask(:cs::uuid, 'Test one');
select app.niva_test_ask(:cs::uuid, 'Test two');
select app.niva_test_ask(:cs::uuid, 'Test three');
commit;
begin;
select pg_temp.sign_in(:member);
select (app.niva_ask(:cs::uuid, 'The question that fits')).id as qfit \gset
commit;
select pg_temp.assert(:'qfit' is not null, 'staff tests do not use up the monthly question limit');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_ask('62000000-0000-4000-8000-0000000000c2'::uuid, 'And one too many')$$,
  'niva questions a month, and they are used up', 'the limit still holds for members'' questions');
commit;
begin;
select pg_temp.sign_in(:admin);
select app.niva_health(:cs::uuid) as hs \gset
commit;
select pg_temp.assert((:'hs'::jsonb->'month'->>'used')::int = 1
                      and (:'hs'::jsonb->'month'->>'limit')::int = 1,
  'Niva health''s monthly count is members'' questions only, as the limit counts them');
select pg_temp.assert((:'hs'::jsonb->'outcomes_7d'->>'pending')::int = 1, 'Niva health''s outcomes count members'' questions only');
select pg_temp.assert((:'hs'::jsonb->'tests_today'->>'used')::int = 3, 'the sandbox''s three tests show as today''s tests');

-- ── "Try all unanswered questions again" leaves tests alone ──────────────────
update app.niva_conversations set answer_status = 'no_source', created_at = now() - interval '1 hour'
 where id in (:'t1_id'::uuid, :'qm'::uuid);
update app.jobs set status = 'done', finished_at = now(), result = '{"answered":false,"reason":"no_matching_source"}'
 where kind = 'niva.answer' and payload->>'conversation_id' in (:'t1_id', :'qm');
-- Every other test and question in c is left out of this check: they are pending and new, or have a job queued.
begin;
select pg_temp.sign_in(:admin);
select app.niva_retry_unanswered(:c::uuid) as nr \gset
commit;
select pg_temp.assert(pg_temp.jobs_of(:'qm'::uuid, 'queued') = 1, 'the member''s unanswered question is tried again');
select pg_temp.assert(pg_temp.jobs_of(:'t1_id'::uuid, 'queued') = 0
                      and (select answer_status from app.niva_conversations where id = :'t1_id'::uuid) = 'no_source',
  'a staff test is never tried again with the members'' questions');

-- ── A follow-up's context keeps to the same kind of question ─────────────────
insert into app.niva_conversations (id, center_id, user_id, question, answer, unanswered, answer_status, is_test, created_at) values
  ('62000000-0000-4000-8000-0000000000d1', :c, :admin, 'My own question', 'My own answer', false, 'answered', false, now() - interval '6 minutes'),
  ('62000000-0000-4000-8000-0000000000d2', :c, :admin, 'A test question', 'A test answer', false, 'answered', true, now() - interval '4 minutes'),
  ('62000000-0000-4000-8000-0000000000d3', :c, :admin, 'And on Sunday?', null, true, 'pending', false, now() - interval '1 minute'),
  ('62000000-0000-4000-8000-0000000000d4', :c, :admin, 'And for a test?', null, true, 'pending', true, now() - interval '1 minute');
begin;
set local role connect_worker;
select app.niva_worker_get_conversation('62000000-0000-4000-8000-0000000000d3'::uuid) as gm \gset
select app.niva_worker_get_conversation('62000000-0000-4000-8000-0000000000d4'::uuid) as gt \gset
commit;
select pg_temp.assert(jsonb_array_length(:'gm'::jsonb->'recent') = 1 and (:'gm'::jsonb->'recent'->0->>'question') = 'My own question'
                      and (:'gm'::jsonb->>'is_test') = 'false',
  'a member''s follow-up reads only their own member questions, never a staff test');
select pg_temp.assert(jsonb_array_length(:'gt'::jsonb->'recent') = 1 and (:'gt'::jsonb->'recent'->0->>'question') = 'A test question'
                      and (:'gt'::jsonb->>'is_test') = 'true',
  'a staff test''s follow-up reads only the tester''s earlier tests');

-- ── The test result, for the test box ────────────────────────────────────────
begin;
select pg_temp.sign_in(:editor);
select app.niva_test_result(:'t1_id'::uuid) as r1 \gset
commit;
select pg_temp.assert((:'r1'::jsonb->>'id') = :'t1_id' and (:'r1'::jsonb->>'question') = 'When is the derasar open?'
                      and (:'r1'::jsonb->>'answer_status') = 'no_source' and (:'r1'::jsonb->>'include_in_review') = 'false'
                      and (:'r1'::jsonb->'job'->>'status') = 'done' and (:'r1'::jsonb->'sources') = '[]'::jsonb,
  'the tester reads their test: its outcome, its job and no sources');
begin;
select pg_temp.sign_in(:editor2);
select pg_temp.assert_raises($$select app.niva_test_result('$$ || :'t1_id' || $$'::uuid)$$, 'was not found',
  'another content editor cannot read someone else''s test');
commit;
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_test_result('$$ || :'t1_id' || $$'::uuid)$$, 'was not found',
  'a member cannot read a staff test');
commit;
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert((app.niva_test_result(:'t1_id'::uuid)->>'id') = :'t1_id', 'content.manage staff can read any test of the community');
select pg_temp.assert_raises($$select app.niva_test_result('$$ || :'qm' || $$'::uuid)$$, 'was not found',
  'a member''s question is not a test, so it cannot be read as one');
commit;
-- The worker answers the admin's test from a published source, one waiting for approval, a Guide
-- section and a source that has since been deleted.
update app.jobs set status = 'running', attempts = 1, locked_by = 'worker-62', locked_at = now()
 where kind = 'niva.answer' and payload->>'conversation_id' = :'t2_id';
begin;
set local role connect_worker;
select app.niva_worker_store_answer(:'t2_id'::uuid, 'Park in the east lot on festival days.',
  jsonb_build_array(
    jsonb_build_object('content_item_id', '62000000-0000-4000-8000-00000000000b', 'title', 'Parking', 'url', 'https://example.org/visit'),
    jsonb_build_object('content_item_id', '62000000-0000-4000-8000-00000000000a', 'title', 'Derasar timings'),
    jsonb_build_object('content_item_id', 'guide_section:62000000-0000-4000-8000-00000000000d', 'title', 'Visiting the derasar'),
    jsonb_build_object('content_item_id', '62000000-0000-4000-8000-0000000000ff', 'title', 'A deleted source')),
  'claude-opus-5-5');
commit;
begin;
select pg_temp.sign_in(:admin);
select app.niva_test_result(:'t2_id'::uuid) as r2 \gset
commit;
select pg_temp.assert((:'r2'::jsonb->>'answer') = 'Park in the east lot on festival days.' and (:'r2'::jsonb->>'answer_status') = 'answered'
                      and (:'r2'::jsonb->>'model') = 'claude-opus-5-5' and (:'r2'::jsonb->>'include_in_review') = 'true'
                      and (:'r2'::jsonb->'job'->>'status') = 'running' and (:'r2'::jsonb->>'answered_at') is not null,
  'the result carries the answer, the model, include_in_review from the job, and the job''s state');
select pg_temp.assert(:'r2'::jsonb->'sources' = jsonb_build_array(
    jsonb_build_object('id', '62000000-0000-4000-8000-00000000000b', 'title', 'Parking', 'url', 'https://example.org/visit', 'kind', 'niva_source', 'status', 'in_review'),
    jsonb_build_object('id', '62000000-0000-4000-8000-00000000000a', 'title', 'Derasar timings', 'url', null, 'kind', 'niva_source', 'status', 'published'),
    jsonb_build_object('id', 'guide_section:62000000-0000-4000-8000-00000000000d', 'title', 'Visiting the derasar', 'url', null, 'kind', 'guide_section', 'status', 'published'),
    jsonb_build_object('id', '62000000-0000-4000-8000-0000000000ff', 'title', 'A deleted source', 'url', null, 'kind', null, 'status', 'missing')),
  'each cited source comes with its status now: waiting for approval, published, a public Guide section, gone');
update app.guide_sections set public = false where id = :guide::uuid;
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert((app.niva_test_result(:'t2_id'::uuid)->'sources'->2->>'status') = 'hidden', 'a Guide section that is no longer public reads hidden');
commit;
begin;
select pg_temp.sign_in(:editor);
select pg_temp.assert_raises($$select app.niva_test_result('$$ || :'t2_id' || $$'::uuid)$$, 'was not found',
  'a content editor cannot read a test someone else asked, even an answered one');
commit;

-- A test that cites live items from the schedule (0574's worker stores them as {kind, id, title}).
-- The event's id is a content item's on purpose: a live item is never looked up as a content item.
-- 0574 (the live schedule) may be applied before or after 0575: with it, each item is checked by its
-- own "still current" test (an address that is set: live; regular timings that are not, or an event
-- that is not on the schedule: missing); without it, a live item reads live.
update app.centers set branding = coalesce(branding, '{}'::jsonb) || '{"address": "1 Orbit Way, Austin TX"}'::jsonb
 where id = :c::uuid;
insert into app.niva_conversations (id, center_id, user_id, question, answer, unanswered, answer_status, is_test, sources, model) values
  ('62000000-0000-4000-8000-0000000000e1', :c, :admin, 'Where is the derasar, and what is on?', 'At 1 Orbit Way.', false, 'answered', true,
   jsonb_build_array(
     jsonb_build_object('kind', 'center', 'id', 'address', 'title', 'Address'),
     jsonb_build_object('kind', 'center', 'id', 'hours', 'title', 'Regular timings'),
     jsonb_build_object('kind', 'event', 'id', '62000000-0000-4000-8000-00000000000a', 'title', 'Paryushan pratikraman'),
     jsonb_build_object('content_item_id', '62000000-0000-4000-8000-00000000000a', 'title', 'Derasar timings')),
   'claude-opus-5-5');
select to_regprocedure('app.niva_live_ref_current(uuid,text,text)') is not null as has_live_check \gset
begin;
select pg_temp.sign_in(:admin);
select app.niva_test_result('62000000-0000-4000-8000-0000000000e1'::uuid) as rl \gset
commit;
select pg_temp.assert(:'rl'::jsonb->'sources' = jsonb_build_array(
    jsonb_build_object('id', 'center:address', 'title', 'Address', 'url', null, 'kind', 'center', 'status', 'live'),
    jsonb_build_object('id', 'center:hours', 'title', 'Regular timings', 'url', null, 'kind', 'center',
                       'status', case when :'has_live_check'::boolean then 'missing' else 'live' end),
    jsonb_build_object('id', 'event:62000000-0000-4000-8000-00000000000a', 'title', 'Paryushan pratikraman', 'url', null, 'kind', 'event',
                       'status', case when :'has_live_check'::boolean then 'missing' else 'live' end),
    jsonb_build_object('id', '62000000-0000-4000-8000-00000000000a', 'title', 'Derasar timings', 'url', null, 'kind', 'niva_source', 'status', 'published')),
  'a cited live item comes back as <kind>:<id> with its kind and status live (missing once it is off the schedule), never as a missing content item');

-- ── A staff test previews only the community's own sources waiting for approval ──
-- The shared library's sources (center_id null) are the platform's to approve: before that only platform
-- admins can read them (RLS 0010), so a community's staff test never answers from one.
update app.centers set rules = coalesce(rules, '{}'::jsonb) || '{"niva": {"answer_from": ["faq"]}}'::jsonb where id = :c::uuid;
insert into app.content_items (id, center_id, tradition, kind, slug, title, body_md, status) values
  ('62000000-0000-4000-8000-0000000000f1', :c, null, 'niva_source', 'palanquin-own-62', 'Palanquin procession (ours, waiting)',
   'The palanquin procession leaves the derasar at 9 AM.', 'in_review'),
  ('62000000-0000-4000-8000-0000000000f2', null, null, 'niva_source', 'palanquin-shared-62', 'Palanquin procession (shared, waiting)',
   'A palanquin procession is part of many festivals.', 'in_review'),
  ('62000000-0000-4000-8000-0000000000f3', null, null, 'niva_source', 'palanquin-shared-pub-62', 'Palanquin procession (shared, published)',
   'The palanquin procession carries the idol around the town.', 'published'),
  ('62000000-0000-4000-8000-0000000000f4', :c, null, 'faq', 'palanquin-faq-own-62', 'Who carries the palanquin? (ours, waiting)',
   'Volunteers carry the palanquin procession.', 'in_review'),
  ('62000000-0000-4000-8000-0000000000f5', null, null, 'faq', 'palanquin-faq-shared-62', 'Who carries the palanquin? (shared, waiting)',
   'Anyone may carry the palanquin procession.', 'in_review');
begin;
set local role connect_worker;
select app.niva_worker_search_sources(:c::uuid, 'palanquin procession', 20, array['published', 'in_review']) as sr \gset
select app.niva_worker_search_sources(:c::uuid, 'palanquin procession', 20, array['published']) as sp \gset
commit;
select pg_temp.assert((select array_agg(e->>'id' order by e->>'id') from jsonb_array_elements(:'sr'::jsonb) e where e->>'id' like '62000000-%')
                      = array['62000000-0000-4000-8000-0000000000f1', '62000000-0000-4000-8000-0000000000f3', '62000000-0000-4000-8000-0000000000f4'],
  'a staff test with sources waiting for approval gets the community''s own (a Niva source and an FAQ item) and the shared published one, never a shared one waiting for approval');
select pg_temp.assert((select array_agg(e->>'id' order by e->>'id') from jsonb_array_elements(:'sp'::jsonb) e where e->>'id' like '62000000-%')
                      = array['62000000-0000-4000-8000-0000000000f3'],
  'a member''s question still gets published sources only, the shared library''s included');
delete from app.content_items where id in ('62000000-0000-4000-8000-0000000000f2', '62000000-0000-4000-8000-0000000000f3',
                                           '62000000-0000-4000-8000-0000000000f5');

-- ── Only content staff save a question marked as a test ──────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$insert into app.niva_conversations (center_id, user_id, question, unanswered, is_test)
                               values ('62000000-0000-4000-8000-0000000000c1', '62000000-0000-4000-8000-000000000005', 'Sneaky', true, true)$$,
  'only content staff', 'a member cannot insert a question marked as a test');
insert into app.niva_conversations (center_id, user_id, question, unanswered)
values (:c, :member, 'A question inserted the old way', true);
commit;
select pg_temp.assert(exists (select 1 from app.niva_conversations where question = 'A question inserted the old way' and not is_test),
  'the niva_insert policy is unchanged: a member can still insert a plain question');
select pg_temp.assert(exists (select 1 from pg_policies where schemaname = 'app' and tablename = 'niva_conversations' and policyname = 'niva_insert'),
  'the niva_insert policy is still there (owner decision)');

-- ── Grants and search paths ──────────────────────────────────────────────────
select pg_temp.assert(has_function_privilege('authenticated', 'app.niva_test_ask(uuid,text,boolean)', 'execute')
                      and has_function_privilege('authenticated', 'app.niva_test_result(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.niva_test_ask(uuid,text,boolean)', 'execute')
                      and not has_function_privilege('anon', 'app.niva_test_result(uuid)', 'execute'),
  'testing is for signed-in staff (checked inside), never anon');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.niva_tests_today(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_center_day_start(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_test_daily_limit()', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_conversations_guard_test()', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_test_live_status(uuid,text,text)', 'execute'),
  'the helpers are internal');
select pg_temp.assert(has_function_privilege('authenticated', 'app.niva_ask(uuid,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.niva_health(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.niva_retry_unanswered(uuid,interval,int)', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_worker_get_conversation(uuid)', 'execute')
                      and has_function_privilege('connect_worker', 'app.niva_worker_get_conversation(uuid)', 'execute')
                      and has_function_privilege('connect_worker', 'app.niva_worker_search_sources(uuid,text,int,text[])', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_worker_search_sources(uuid,text,int,text[])', 'execute'),
  'the replaced functions keep their grants');
select pg_temp.assert((select count(distinct p.proname) = 12 and bool_and(exists (select 1 from unnest(p.proconfig) as g(setting)
                                                          where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p
                        where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('niva_test_ask','niva_test_result','niva_conversations_guard_test','niva_test_daily_limit',
                                            'niva_center_day_start','niva_tests_today','niva_test_live_status','niva_ask',
                                            'niva_worker_get_conversation','niva_retry_unanswered','niva_health',
                                            'niva_worker_search_sources')),
  'every new or replaced function pins search_path app, public, extensions');
select pg_temp.assert((select count(distinct p.proname) = 8 and bool_and(p.prosecdef)
                         from pg_proc p
                        where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('niva_test_ask','niva_test_result','niva_conversations_guard_test','niva_ask',
                                            'niva_worker_get_conversation','niva_retry_unanswered','niva_health',
                                            'niva_worker_search_sources')),
  'the functions that read or write for the caller are security definer');
