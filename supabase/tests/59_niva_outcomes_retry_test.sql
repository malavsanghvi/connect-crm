-- 0572: Niva outcomes and retry. answer_status through ask, store and set_outcome; the backfill
-- mapping; set_outcome is worker-only, keeps an answer while a cited source is still published and
-- queues a paused question again exactly once; regenerate and "try all again" never queue a question
-- twice and never count toward the monthly cap; Niva health for content staff; the conversation read
-- with the center's time zone and the member's own recent turns; go-live evidence and demo sources.
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
\set c '''59000000-0000-4000-8000-0000000000c1'''
\set cb '''59000000-0000-4000-8000-0000000000c2'''
\set c3 '''59000000-0000-4000-8000-0000000000c3'''
\set ch '''59000000-0000-4000-8000-0000000000c4'''
\set admin '''59000000-0000-4000-8000-000000000001'''
\set editor '''59000000-0000-4000-8000-000000000002'''
\set member '''59000000-0000-4000-8000-000000000003'''
\set member_b '''59000000-0000-4000-8000-000000000004'''
\set member3 '''59000000-0000-4000-8000-000000000005'''
\set outsider '''59000000-0000-4000-8000-000000000006'''
\set src_p '''59000000-0000-4000-8000-00000000000a'''
insert into auth.users (id, email) values
  (:admin, 'admin59@example.com'), (:editor, 'editor59@example.com'), (:member, 'member59@example.com'),
  (:member_b, 'member59b@example.com'), (:member3, 'member59c@example.com'), (:outsider, 'outsider59@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c, 'orbit59', 'Orbit Outcomes Community', 'OOC', 'TX', 'active', 'Asia/Kolkata'),
  (:cb, 'orbit59b', 'Orbit Backfill Community', 'OBC', 'TX', 'active', 'America/Chicago'),
  (:ch, 'orbit59h', 'Orbit Health Community', 'OHC', 'TX', 'active', 'America/Chicago');
insert into app.centers (id, slug, name, short_name, state_region, status, environment) values
  (:c3, 'orbit59c', 'Orbit Sandbox Community', 'OSC', 'TX', 'active', 'sandbox');
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :admin, 'center_admin'), (:c3, :admin, 'center_admin'), (:ch, :admin, 'center_admin'),
  (:c, :editor, 'content_editor'), (:ch, :editor, 'content_editor');
insert into app.households (id, center_id, display_name) values
  ('59000000-0000-4000-8000-0000000000a1', :c, 'Shah household'),
  ('59000000-0000-4000-8000-0000000000a3', :c, 'Mehta household'),
  ('59000000-0000-4000-8000-0000000000a5', :c3, 'Doshi household'),
  ('59000000-0000-4000-8000-0000000000a7', :ch, 'Shah household');
insert into app.people (id, center_id, first_name, last_name) values
  ('59000000-0000-4000-8000-0000000000a2', :c, 'Asha', 'Shah'),
  ('59000000-0000-4000-8000-0000000000a4', :c, 'Neha', 'Mehta'),
  ('59000000-0000-4000-8000-0000000000a6', :c3, 'Ravi', 'Doshi'),
  ('59000000-0000-4000-8000-0000000000a8', :ch, 'Asha', 'Shah');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('59000000-0000-4000-8000-0000000000a1', '59000000-0000-4000-8000-0000000000a2', :c, 'primary', true),
  ('59000000-0000-4000-8000-0000000000a3', '59000000-0000-4000-8000-0000000000a4', :c, 'primary', true),
  ('59000000-0000-4000-8000-0000000000a5', '59000000-0000-4000-8000-0000000000a6', :c3, 'primary', true),
  ('59000000-0000-4000-8000-0000000000a7', '59000000-0000-4000-8000-0000000000a8', :ch, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :member, '59000000-0000-4000-8000-0000000000a2'),
  (:c, :member_b, '59000000-0000-4000-8000-0000000000a4'),
  (:c3, :member3, '59000000-0000-4000-8000-0000000000a6'),
  (:ch, :member, '59000000-0000-4000-8000-0000000000a8');
-- 0579: Niva answers from the community's own content first, and queues a niva.answer job only while AI answers
-- are on (centers.rules.niva.ai = 'haiku'). This test covers the job path, so :c and :c3 have AI answers on and
-- :c's source is added after its first question (test 69 covers the own answers).
update app.centers set rules = coalesce(rules, '{}'::jsonb) || '{"niva": {"ai": "haiku"}}'::jsonb where id in (:c::uuid, :c3::uuid);

-- ── Asking saves the question as pending ─────────────────────────────────────
begin;
select pg_temp.sign_in(:member);
select (app.niva_ask(:c::uuid, 'When is the derasar open?')).id as qa \gset
commit;
select pg_temp.assert((select answer_status = 'pending' and unanswered and answered_at is null and model is null and attempted_at is null
                         from app.niva_conversations where id = :'qa'::uuid), 'a new question is saved as pending');
select pg_temp.assert(pg_temp.jobs_of(:'qa'::uuid, 'queued') = 1, 'asking queues one niva.answer job');

insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  (:src_p, :c, 'niva_source', 'timings-59', 'Derasar timings', 'The derasar is open every day from 6 AM to 12 PM.', 'published');

-- ── Storing an answer records answered, the model and when ───────────────────
begin;
set local role connect_worker;
select app.niva_worker_store_answer(:'qa'::uuid, 'The derasar is open from 6 AM to 12 PM.',
  '[{"content_item_id":"59000000-0000-4000-8000-00000000000a","title":"Derasar timings"}]'::jsonb, 'claude-opus-5-5');
commit;
select pg_temp.assert((select answer_status = 'answered' and not unanswered and model = 'claude-opus-5-5' and answered_at is not null
                              and attempted_at is not null and outcome_detail is null
                         from app.niva_conversations where id = :'qa'::uuid), 'storing an answer sets answered, the model and answered_at');

-- ── set_outcome is the background service's alone ───────────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_worker_set_outcome('$$ || :'qa' || $$'::uuid, 'no_source', 'x')$$,
  'permission denied', 'a member cannot record an outcome');
commit;
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.niva_worker_set_outcome('$$ || :'qa' || $$'::uuid, 'no_source', 'x')$$,
  'permission denied', 'a center admin cannot record an outcome either');
commit;
select pg_temp.assert(not has_function_privilege('authenticated', 'app.niva_worker_set_outcome(uuid,text,text,boolean,timestamptz)', 'execute')
                      and has_function_privilege('connect_worker', 'app.niva_worker_set_outcome(uuid,text,text,boolean,timestamptz)', 'execute'),
  'niva_worker_set_outcome: connect_worker only');

-- ── clear_answer keeps an answer while a source it cited is still published ──
begin;
set local role connect_worker;
select app.niva_worker_set_outcome(:'qa'::uuid, 'no_source', 'No approved source mentions these words.', true) as r_keep \gset
commit;
select pg_temp.assert((:'r_keep'::jsonb->>'cleared') = 'false' and (:'r_keep'::jsonb->>'status') = 'answered',
  'set_outcome reports the answer was kept');
select pg_temp.assert((select answer is not null and answer_status = 'answered' and not unanswered and attempted_at is not null
                         from app.niva_conversations where id = :'qa'::uuid),
  'the answer stays (and reads answered) while the cited source is still published');
update app.content_items set status = 'retired' where id = :src_p::uuid;
begin;
set local role connect_worker;
select app.niva_worker_set_outcome(:'qa'::uuid, 'no_source', 'No approved source mentions these words.', true) as r_clear \gset
commit;
select pg_temp.assert((:'r_clear'::jsonb->>'cleared') = 'true', 'set_outcome reports the answer was cleared');
select pg_temp.assert((select answer is null and sources = '[]'::jsonb and unanswered and answer_status = 'no_source'
                              and outcome_detail = 'No approved source mentions these words.'
                         from app.niva_conversations where id = :'qa'::uuid),
  'once no cited source is published, the stale answer is removed and the outcome recorded');

-- ── Outcomes that are not allowed ────────────────────────────────────────────
begin;
set local role connect_worker;
select pg_temp.assert_raises($$select app.niva_worker_set_outcome('$$ || :'qa' || $$'::uuid, 'answered', 'x')$$,
  'niva_worker_store_answer', '"answered" is recorded only by storing an answer');
select pg_temp.assert_raises($$select app.niva_worker_set_outcome('$$ || :'qa' || $$'::uuid, 'bogus', 'x')$$,
  'is not an outcome', 'an unknown outcome is refused');
select pg_temp.assert_raises($$select app.niva_worker_set_outcome('$$ || :'qa' || $$'::uuid, 'failed', 'x', false, now() + interval '1 hour')$$,
  'only with the paused outcome', 'a retry time goes only with paused');
select pg_temp.assert_raises($$select app.niva_worker_set_outcome('59000000-0000-4000-8000-0000000000ff'::uuid, 'failed', 'x')$$,
  'was not found', 'an unknown conversation is refused');
commit;

-- ── Paused with a retry time queues the question again, exactly once ─────────
begin;
select pg_temp.sign_in(:member);
select (app.niva_ask(:c::uuid, 'Is the derasar open on Sunday?')).id as qp \gset
commit;
-- The worker claims the job, then the AI service says its spending limit was reached.
update app.jobs set status = 'running', attempts = 1, locked_by = 'worker-59', locked_at = now()
 where kind = 'niva.answer' and payload->>'conversation_id' = :'qp';
begin;
set local role connect_worker;
select app.niva_worker_set_outcome(:'qp'::uuid, 'paused', 'The AI service''s spending limit was reached; Niva will try again at 3:00 PM. postgres://u:Sup3rpw@h/db',
                                   false, now() + interval '1 hour') as p1 \gset
commit;
select pg_temp.assert((select outcome_detail not like '%Sup3rpw%' and outcome_detail like '%postgres://u:[redacted]@h/db'
                         from app.niva_conversations where id = :'qp'::uuid), 'a secret in the detail is never stored');
begin;
set local role connect_worker;
select app.niva_worker_set_outcome(:'qp'::uuid, 'paused', 'The AI service''s spending limit was reached; Niva will try again at 3:00 PM.',
                                   false, now() + interval '1 hour') as p2 \gset
commit;
select pg_temp.assert((:'p1'::jsonb->>'retry_job_id') is not null and (:'p2'::jsonb->>'retry_job_id') is null,
  'the first paused outcome queues a retry, the second does not');
select pg_temp.assert(pg_temp.jobs_of(:'qp'::uuid, 'queued') = 1, 'exactly one retry is queued');
select pg_temp.assert((select run_after between now() + interval '55 minutes' and now() + interval '61 minutes'
                         from app.jobs where kind = 'niva.answer' and status = 'queued' and payload->>'conversation_id' = :'qp'),
  'the retry is due at the retry time');
select pg_temp.assert((select payload->>'deferrals' = '1' and max_attempts = 3
                         from app.jobs where kind = 'niva.answer' and status = 'queued' and payload->>'conversation_id' = :'qp'),
  'the retry counts its deferral');
select pg_temp.assert((select answer_status = 'paused' and outcome_detail like 'The AI service''s spending limit was reached%'
                         from app.niva_conversations where id = :'qp'::uuid), 'the question reads paused, with the detail');
update app.jobs set status = 'done', finished_at = now(), result = '{"answered":false,"reason":"ai_spending_limit"}'
 where kind = 'niva.answer' and status = 'running' and payload->>'conversation_id' = :'qp';

-- ── Regenerate never queues a second job; a retry queued for later is brought forward ──
-- The owner raised the spending limit and presses Try again: the paused question's retry (an hour
-- away here, possibly next month for a monthly limit) runs now instead.
begin;
select pg_temp.sign_in(:admin);
select app.niva_regenerate(:'qp'::uuid);
commit;
select pg_temp.assert(pg_temp.jobs_of(:'qp'::uuid) = 2 and pg_temp.jobs_of(:'qp'::uuid, 'queued') = 1,
  'regenerate adds no job while the retry is queued');
select pg_temp.assert((select run_after <= now() and payload->>'regenerate' = 'true' and payload->>'deferrals' = '1'
                         from app.jobs where kind = 'niva.answer' and status = 'queued' and payload->>'conversation_id' = :'qp'),
  'Try again brings the paused question''s retry forward to now, as a regenerate');
select pg_temp.assert((select answer_status = 'pending' and outcome_detail is null from app.niva_conversations where id = :'qp'::uuid),
  'the paused question reads pending again');
begin;
select pg_temp.sign_in(:admin);
select app.niva_regenerate(:'qp'::uuid);
commit;
select pg_temp.assert(pg_temp.jobs_of(:'qp'::uuid) = 2 and pg_temp.jobs_of(:'qp'::uuid, 'queued') = 1,
  'a second press while the job is due adds nothing');
-- The worker takes it: still nothing more while it runs.
update app.jobs set status = 'running', attempts = 1, locked_by = 'worker-59', locked_at = now()
 where kind = 'niva.answer' and status = 'queued' and payload->>'conversation_id' = :'qp';
begin;
select pg_temp.sign_in(:admin);
select app.niva_regenerate(:'qp'::uuid);
commit;
select pg_temp.assert(pg_temp.jobs_of(:'qp'::uuid) = 2 and pg_temp.jobs_of(:'qp'::uuid, 'running') = 1,
  'regenerate adds nothing while a job is running');
begin;
set local role connect_worker;
select app.niva_worker_set_outcome(:'qp'::uuid, 'no_source', 'No approved source mentions these words.');
commit;
update app.jobs set status = 'done', finished_at = now(), locked_by = null, locked_at = null,
                    result = '{"answered":false,"reason":"no_matching_source"}'
 where kind = 'niva.answer' and status = 'running' and payload->>'conversation_id' = :'qp';
begin;
select pg_temp.sign_in(:admin);
select app.niva_regenerate(:'qp'::uuid);
select app.niva_regenerate(:'qp'::uuid);
commit;
select pg_temp.assert(pg_temp.jobs_of(:'qp'::uuid, 'queued') = 1 and pg_temp.jobs_of(:'qp'::uuid) = 3,
  'regenerate queues one job once nothing is on its way, and a second press adds nothing');
select pg_temp.assert((select payload->>'regenerate' = 'true' from app.jobs where kind = 'niva.answer' and status = 'queued' and payload->>'conversation_id' = :'qp'),
  'the job is marked as a regenerate');
select pg_temp.assert((select answer_status = 'pending' and outcome_detail is null from app.niva_conversations where id = :'qp'::uuid),
  'regenerate sets the question back to pending');

-- ── The conversation read: time zone, local time and the member's own recent turns ──
insert into app.niva_conversations (id, center_id, user_id, question, answer, unanswered, answer_status, created_at) values
  ('59000000-0000-4000-8000-0000000000d0', :c, :member, 'An old question', 'An old answer', false, 'answered', now() - interval '20 minutes'),
  ('59000000-0000-4000-8000-0000000000d1', :c, :member, 'Question one', 'Answer one', false, 'answered', now() - interval '10 minutes'),
  ('59000000-0000-4000-8000-0000000000d2', :c, :member, 'Question two', 'Answer two', false, 'answered', now() - interval '8 minutes'),
  ('59000000-0000-4000-8000-0000000000d3', :c, :member, 'Question three', 'Answer three', false, 'answered', now() - interval '6 minutes'),
  ('59000000-0000-4000-8000-0000000000d4', :c, :member, 'Question four, no answer', null, true, 'no_source', now() - interval '5 minutes'),
  ('59000000-0000-4000-8000-0000000000d5', :c, :member_b, 'Another member asks', 'Another member''s answer', false, 'answered', now() - interval '4 minutes'),
  ('59000000-0000-4000-8000-0000000000d6', :c, :member, 'And on Sunday?', null, true, 'pending', now() - interval '1 minute'),
  ('59000000-0000-4000-8000-0000000000d7', :c, :member, 'Is the derasar open today?', null, true, 'paused', now() - interval '3 days');
begin;
set local role connect_worker;
select app.niva_worker_get_conversation('59000000-0000-4000-8000-0000000000d6'::uuid) as g \gset
select app.niva_worker_get_conversation('59000000-0000-4000-8000-0000000000d5'::uuid) as gb \gset
select app.niva_worker_get_conversation('59000000-0000-4000-8000-0000000000d7'::uuid) as gold \gset
commit;
select pg_temp.assert((:'g'::jsonb->>'time_zone') = 'Asia/Kolkata' and (:'g'::jsonb->>'center_name') = 'Orbit Outcomes Community',
  'the read names the center and its time zone');
select pg_temp.assert((:'g'::jsonb->>'local_now')::timestamp between (now() at time zone 'Asia/Kolkata') - interval '5 minutes'
                                                               and (now() at time zone 'Asia/Kolkata') + interval '1 minute',
  'local_now is the time in the center''s time zone');
select pg_temp.assert((:'g'::jsonb->>'local_today') = to_char((:'g'::jsonb->>'local_now')::timestamp, 'FMDay, FMDD FMMonth YYYY'),
  'local_today spells out the center''s date');
select pg_temp.assert((:'g'::jsonb->>'answer_status') = 'pending' and (:'g'::jsonb->>'has_answer') = 'false' and (:'g'::jsonb->>'created_at') is not null,
  'the read carries the status and when it was asked');
select pg_temp.assert((:'g'::jsonb->>'asked_local') = (select to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS')
                                                        from app.niva_conversations where id = '59000000-0000-4000-8000-0000000000d6')
                      and (:'g'::jsonb->>'asked_today') = (select to_char(created_at at time zone 'Asia/Kolkata', 'FMDay, FMDD FMMonth YYYY')
                                                            from app.niva_conversations where id = '59000000-0000-4000-8000-0000000000d6'),
  'asked_local and asked_today give when the member asked, in the center''s time zone');
select pg_temp.assert((:'gold'::jsonb->>'asked_today') = (select to_char(created_at at time zone 'Asia/Kolkata', 'FMDay, FMDD FMMonth YYYY')
                                                            from app.niva_conversations where id = '59000000-0000-4000-8000-0000000000d7')
                      and (:'gold'::jsonb->>'asked_today') <> (:'gold'::jsonb->>'local_today'),
  'a question answered days later still says the day it was asked');
select pg_temp.assert(jsonb_array_length(:'g'::jsonb->'recent') = 2
                      and (:'g'::jsonb->'recent'->0->>'question') = 'Question two'
                      and (:'g'::jsonb->'recent'->1->>'question') = 'Question three'
                      and (:'g'::jsonb->'recent'->1->>'answer') = 'Answer three',
  'recent holds the member''s last 2 answered questions of the last 15 minutes, oldest first');
select pg_temp.assert(:'g'::text not like '%Another member%' and :'g'::text not like '%An old question%' and :'g'::text not like '%Question four%',
  'recent never holds another member''s rows, older rows or unanswered ones');
select pg_temp.assert(:'gb'::jsonb->'recent' = '[]'::jsonb, 'another member''s read sees none of this member''s turns');

-- ── Try all unanswered questions again ───────────────────────────────────────
-- q1: no source matched. q2: paused, its retry queued an hour from now (the owner has since raised
-- the AI service's limit, so it should not wait).
begin;
select pg_temp.sign_in(:member3);
select (app.niva_ask(:c3::uuid, 'Can non-members attend pathshala?')).id as q1 \gset
select (app.niva_ask(:c3::uuid, 'Is the derasar open today?')).id as q2 \gset
commit;
update app.jobs set status = 'running', attempts = 1, locked_by = 'worker-59', locked_at = now()
 where kind = 'niva.answer' and payload->>'conversation_id' in (:'q1', :'q2');
begin;
set local role connect_worker;
select app.niva_worker_set_outcome(:'q1'::uuid, 'no_source', 'No approved source mentions these words.');
select app.niva_worker_set_outcome(:'q2'::uuid, 'paused', 'The AI service''s spending limit was reached.', false, now() + interval '1 hour');
commit;
update app.jobs set status = 'done', finished_at = now(), result = '{"answered":false}'
 where kind = 'niva.answer' and status = 'running' and payload->>'conversation_id' in (:'q1', :'q2');
-- A question inserted straight into the table (the legacy niva_insert policy) never got a job; one
-- inserted just now is still too new to retry; an answered question is never retried.
begin;
select pg_temp.sign_in(:member3);
insert into app.niva_conversations (id, center_id, user_id, question, unanswered, created_at) values
  ('59000000-0000-4000-8000-0000000000e1', :c3, :member3, 'An orphan question', true, now() - interval '10 minutes'),
  ('59000000-0000-4000-8000-0000000000e2', :c3, :member3, 'A fresh question', true, now());
commit;
insert into app.niva_conversations (id, center_id, user_id, question, answer, unanswered, answer_status, created_at) values
  ('59000000-0000-4000-8000-0000000000e3', :c3, :member3, 'An answered question', 'An answer', false, 'answered', now() - interval '1 hour');
-- On its way already: e4's job is running; e5's job is queued again in a minute (the queue's own back-off).
insert into app.niva_conversations (id, center_id, user_id, question, unanswered, answer_status, created_at) values
  ('59000000-0000-4000-8000-0000000000e4', :c3, :member3, 'Being answered right now', true, 'unsure', now() - interval '1 hour'),
  ('59000000-0000-4000-8000-0000000000e5', :c3, :member3, 'Retrying in a minute', true, 'failed', now() - interval '1 hour');
insert into app.jobs (center_id, kind, payload, status, run_after, attempts, max_attempts, locked_by, locked_at) values
  (:c3, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000e4"}', 'running', now() - interval '1 minute', 1, 3, 'worker-59', now()),
  (:c3, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000e5"}', 'queued', now() + interval '1 minute', 1, 3, null, null);

begin;
select pg_temp.sign_in(:member3);
select pg_temp.assert_raises($$select app.niva_retry_unanswered('59000000-0000-4000-8000-0000000000c3'::uuid)$$, 'content.manage',
  'a member cannot try the unanswered questions again');
commit;
begin;
select pg_temp.sign_in(:editor);
select pg_temp.assert_raises($$select app.niva_retry_unanswered('59000000-0000-4000-8000-0000000000c1'::uuid)$$, 'content.manage',
  'content.draft is not enough to try them again');
commit;
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.niva_retry_unanswered('59000000-0000-4000-8000-0000000000c3'::uuid, interval '-1 day')$$,
  'goes back in time', 'a period in the future is refused');
commit;
insert into app.center_modules (center_id, module_key, enabled) values (:c3, 'niva', false);
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.niva_retry_unanswered('59000000-0000-4000-8000-0000000000c3'::uuid)$$, 'switched off',
  'retrying is refused while the niva module is off');
commit;
delete from app.center_modules where center_id = :c3 and module_key = 'niva';

-- The cap: exactly one more question fits this month.
select count(*) as c3_count from app.niva_conversations where center_id = :c3::uuid \gset
insert into app.center_entitlements (center_id, key, value, reason)
select :c3::uuid, 'niva.monthly_questions', to_jsonb(count(*) + 1), 'Test 59: one more question fits'
  from app.niva_conversations where center_id = :c3::uuid and created_at >= date_trunc('month', current_date)::timestamptz;

begin;
select pg_temp.sign_in(:admin);
select app.niva_retry_unanswered(:c3::uuid) as n1 \gset
commit;
select pg_temp.assert(:n1::int = 3, 'three questions are tried again (no source, the orphan, and the paused one)');
select pg_temp.assert((select bool_and(answer_status = 'pending' and outcome_detail is null) from app.niva_conversations
                        where id in (:'q1'::uuid, :'q2'::uuid, '59000000-0000-4000-8000-0000000000e1'::uuid)), 'they are back to pending');
select pg_temp.assert(pg_temp.jobs_of(:'q1'::uuid, 'queued') = 1 and pg_temp.jobs_of('59000000-0000-4000-8000-0000000000e1'::uuid, 'queued') = 1
                      and pg_temp.jobs_of(:'q2'::uuid, 'queued') = 1 and pg_temp.jobs_of(:'q2'::uuid) = 2,
  'each has exactly one job queued (the paused one keeps its retry; no second job)');
select pg_temp.assert((select bool_and(payload->>'retry' = 'true' and max_attempts = 3) from app.jobs
                        where kind = 'niva.answer' and status = 'queued'
                          and payload->>'conversation_id' in (:'q1', :'q2', '59000000-0000-4000-8000-0000000000e1')),
  'the jobs are marked as a retry');
select pg_temp.assert((select max(run_after) - min(run_after) from app.jobs
                        where kind = 'niva.answer' and status = 'queued'
                          and payload->>'conversation_id' in (:'q1', :'q2', '59000000-0000-4000-8000-0000000000e1'))
                      = interval '4 seconds', 'the retries are spaced 2 seconds apart');
select pg_temp.assert((select run_after < now() + interval '1 minute' and payload->>'deferrals' = '1'
                         from app.jobs where kind = 'niva.answer' and status = 'queued' and payload->>'conversation_id' = :'q2'),
  'Try all brings the paused question''s retry forward (an hour away before), keeping its deferral count');
select pg_temp.assert(pg_temp.jobs_of('59000000-0000-4000-8000-0000000000e4'::uuid) = 1
                      and (select answer_status from app.niva_conversations where id = '59000000-0000-4000-8000-0000000000e4') = 'unsure',
  'a question whose job is running is left to it');
select pg_temp.assert(pg_temp.jobs_of('59000000-0000-4000-8000-0000000000e5'::uuid) = 1
                      and (select run_after > now() + interval '30 seconds' from app.jobs
                            where kind = 'niva.answer' and payload->>'conversation_id' = '59000000-0000-4000-8000-0000000000e5')
                      and (select answer_status from app.niva_conversations where id = '59000000-0000-4000-8000-0000000000e5') = 'failed',
  'a question whose job is due within 5 minutes is on its way and left alone');
select pg_temp.assert(pg_temp.jobs_of('59000000-0000-4000-8000-0000000000e2'::uuid) = 0, 'a question asked under 5 minutes ago is left alone');
select pg_temp.assert(pg_temp.jobs_of('59000000-0000-4000-8000-0000000000e3'::uuid) = 0, 'an answered question is never retried');
select pg_temp.assert((select count(*) from app.niva_conversations where center_id = :c3::uuid) = :c3_count, 'retrying adds no question');
begin;
select pg_temp.sign_in(:admin);
select app.niva_retry_unanswered(:c3::uuid) as n2 \gset
commit;
select pg_temp.assert(:n2::int = 0, 'pressing it again queues nothing more');
begin;
select pg_temp.sign_in(:member3);
select (app.niva_ask(:c3::uuid, 'One more question fits')).id as qlast \gset
commit;
select pg_temp.assert(:'qlast' is not null, 'the retries did not use up the monthly cap');
begin;
select pg_temp.sign_in(:member3);
select pg_temp.assert_raises($$select app.niva_ask('59000000-0000-4000-8000-0000000000c3'::uuid, 'And one too many')$$,
  'niva questions a month, and they are used up', 'the cap still holds for new questions');
commit;

-- ── Niva health for content staff ────────────────────────────────────────────
insert into app.niva_conversations (center_id, user_id, question, answer, unanswered, answer_status, created_at) values
  (:ch, :member, 'Health one', 'An answer', false, 'answered', now() - interval '1 hour'),
  (:ch, :member, 'Health two', 'An answer', false, 'answered', now() - interval '2 hours'),
  (:ch, :member, 'Health three', null, true, 'no_source', now() - interval '3 hours'),
  (:ch, :member, 'Health four', null, true, 'failed', now() - interval '1 day'),
  (:ch, :member, 'Health five', null, true, 'paused', now() - interval '30 minutes'),
  (:ch, :member, 'Health six (old)', 'An answer', false, 'answered', now() - interval '8 days');
insert into app.jobs (center_id, kind, payload, status, run_after, attempts, max_attempts, last_error, created_at, finished_at) values
  (:ch, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000f1"}', 'queued', now() + interval '30 minutes', 0, 3, null, now() - interval '10 minutes', null),
  (:ch, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000f2"}', 'queued', now() + interval '1 hour', 0, 3, null, now() - interval '10 minutes', null),
  (:ch, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000f3"}', 'running', now() - interval '1 minute', 1, 3, null, now() - interval '1 minute', null),
  (:ch, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000f4"}', 'failed', now() - interval '2 hours', 3, 3,
   'Niva''s answering request was not accepted: connect postgres://connect_worker.abc:Sup3rpw@db.example.com:5432/postgres; key sk-ant-api03-AbCdEf123456 refused; GET https://api.example.com/v1?token=abc123',
   now() - interval '2 hours', now() - interval '1 hour'),
  (:ch, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000f5"}', 'failed', now() - interval '2 days', 3, 3, 'An older failure', now() - interval '2 days', now() - interval '2 days'),
  (:ch, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000f6"}', 'done', now() - interval '3 hours', 1, 3, null, now() - interval '3 hours', now() - interval '3 hours'),
  (:ch, 'niva.import_page', '{"url":"https://example.org"}', 'failed', now() - interval '1 hour', 3, 3, 'Not a Niva answer', now() - interval '1 hour', now() - interval '30 minutes');
begin;
set local role connect_worker;
select app.worker_heartbeat('worker-59', now(), '0.5.9', array['niva.answer'],
  '{"handlers":{"niva.answer":{"configured":false,"reason":"Anthropic (Niva, mapping suggestions) is not configured on the background service (needs ANTHROPIC_API_KEY)"}}}');
commit;

begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_health('59000000-0000-4000-8000-0000000000c4'::uuid)$$, 'content.draft or content.manage',
  'a member cannot see Niva health');
commit;
begin;
select pg_temp.sign_in(:outsider);
select pg_temp.assert_raises($$select app.niva_health('59000000-0000-4000-8000-0000000000c4'::uuid)$$, 'content.draft or content.manage',
  'someone outside the community cannot see Niva health');
commit;
begin;
select pg_temp.sign_in(:admin);
select (app.niva_health(:ch::uuid)->>'state') as admin_state \gset
commit;
select pg_temp.assert(:'admin_state' = 'running', 'content.manage staff see Niva health');
begin;
select pg_temp.sign_in(:editor);
select app.niva_health(:ch::uuid) as h \gset
commit;
select pg_temp.assert((:'h'::jsonb->>'state') = 'running' and (:'h'::jsonb->>'module_on') = 'true',
  'content.draft staff see Niva health: the service is running');
select pg_temp.assert((:'h'::jsonb->'handler'->>'configured') = 'false' and (:'h'::jsonb->'handler'->>'reason') like 'Anthropic%',
  'health shows whether niva.answer is configured, from the latest heartbeat');
select pg_temp.assert((:'h'::jsonb->'jobs'->>'queued')::int = 2 and (:'h'::jsonb->'jobs'->>'running')::int = 1
                      and (:'h'::jsonb->'jobs'->>'failed_24h')::int = 1 and (:'h'::jsonb->'jobs'->>'done_24h')::int = 1,
  'health counts this center''s niva.answer jobs: queued, running, failed and done in the last 24 hours');
select pg_temp.assert((:'h'::jsonb->'jobs'->>'next_run_after')::timestamptz between now() + interval '25 minutes' and now() + interval '35 minutes',
  'health says when the next queued question is due');
select pg_temp.assert((:'h'::jsonb->'jobs'->>'last_error') like 'Niva''s answering request was not accepted%'
                      and (:'h'::jsonb->'jobs'->>'last_error_status') = 'failed',
  'health shows the latest error');
select pg_temp.assert((:'h'::jsonb->'jobs'->>'last_error') not like '%Sup3rpw%'
                      and (:'h'::jsonb->'jobs'->>'last_error') not like '%sk-ant-api03-AbCdEf123456%'
                      and (:'h'::jsonb->'jobs'->>'last_error') not like '%token=abc123%'
                      and (:'h'::jsonb->'jobs'->>'last_error') like '%[redacted]%',
  'the error is scrubbed of passwords, keys and query strings');
select pg_temp.assert((:'h'::jsonb->'month'->>'used')::int = (select count(*) from app.niva_conversations
                         where center_id = :ch::uuid and created_at >= date_trunc('month', current_date)::timestamptz)
                      and (:'h'::jsonb->'month'->>'limit') is null,
  'health counts this month''s questions; a production community has no monthly limit');
select pg_temp.assert(:'h'::jsonb->'outcomes_7d' = '{"pending":0,"answered":2,"no_source":1,"unsure":0,"refused":0,"paused":1,"failed":1}'::jsonb,
  'health counts the last 7 days'' questions by outcome');
begin;
select pg_temp.sign_in(:admin);
select (app.niva_health(:c3::uuid)->'month'->>'limit') as c3_limit \gset
commit;
select pg_temp.assert(:'c3_limit'::int = (select (value #>> '{}')::int from app.center_entitlements
                                            where center_id = :c3::uuid and key = 'niva.monthly_questions'),
  'health shows the monthly limit when there is one');
delete from app.worker_heartbeats where worker = 'worker-59';

-- ── The backfill maps each question's latest job to its outcome ──────────────
insert into app.niva_conversations (id, center_id, question, answer, unanswered, created_at) values
  ('59000000-0000-4000-8000-0000000000b1', :cb, 'Answered', 'An answer', false, now() - interval '3 hours'),
  ('59000000-0000-4000-8000-0000000000b2', :cb, 'No source', null, true, now() - interval '3 hours'),
  ('59000000-0000-4000-8000-0000000000b3', :cb, 'Unsure', null, true, now() - interval '3 hours'),
  ('59000000-0000-4000-8000-0000000000b4', :cb, 'Refused', null, true, now() - interval '3 hours'),
  ('59000000-0000-4000-8000-0000000000b5', :cb, 'Spending limit', null, true, now() - interval '3 hours'),
  ('59000000-0000-4000-8000-0000000000b6', :cb, 'Other failure', null, true, now() - interval '3 hours'),
  ('59000000-0000-4000-8000-0000000000b7', :cb, 'Still queued', null, true, now() - interval '3 hours'),
  ('59000000-0000-4000-8000-0000000000b8', :cb, 'Failed, then no source', null, true, now() - interval '3 hours'),
  ('59000000-0000-4000-8000-0000000000b9', :cb, 'No job at all', null, true, now() - interval '3 hours'),
  ('59000000-0000-4000-8000-0000000000ba', :cb, 'Answered by a job', 'An answer', false, now() - interval '3 hours'),
  ('59000000-0000-4000-8000-0000000000bb', :cb, 'Not configured', null, true, now() - interval '3 hours');
insert into app.jobs (center_id, kind, payload, status, attempts, max_attempts, result, last_error, created_at, finished_at) values
  (:cb, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000b2"}', 'done', 1, 3, '{"answered":false,"reason":"no_matching_source"}', null, now() - interval '3 hours', now() - interval '3 hours'),
  (:cb, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000b3"}', 'done', 1, 3, '{"answered":false,"reason":"model_unsure"}', null, now() - interval '3 hours', now() - interval '3 hours'),
  (:cb, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000b4"}', 'done', 1, 3, '{"answered":false,"reason":"model_refused"}', null, now() - interval '3 hours', now() - interval '3 hours'),
  (:cb, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000b5"}', 'failed', 1, 3, null,
   'Niva''s answering request was not accepted: 400 You have reached your specified API usage limits.', now() - interval '3 hours', now() - interval '3 hours'),
  (:cb, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000b6"}', 'failed', 3, 3, null, 'Something else broke', now() - interval '3 hours', now() - interval '3 hours'),
  (:cb, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000b7"}', 'queued', 0, 3, null, null, now() - interval '3 hours', null),
  (:cb, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000b8"}', 'failed', 3, 3, null, 'Something broke first', now() - interval '3 hours', now() - interval '3 hours'),
  (:cb, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000b8","regenerate":true}', 'done', 1, 3, '{"answered":false,"reason":"no_matching_source"}', null, now() - interval '2 hours', now() - interval '2 hours'),
  (:cb, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000ba"}', 'done', 1, 3, '{"answered":true,"sources":1,"model":"claude-opus-5"}', null, now() - interval '3 hours', now() - interval '150 minutes'),
  (:cb, 'niva.answer', '{"conversation_id":"59000000-0000-4000-8000-0000000000bb"}', 'failed', 1, 3, null,
   'Anthropic (Niva, mapping suggestions) is not configured on the background service (needs ANTHROPIC_API_KEY)', now() - interval '3 hours', now() - interval '3 hours');
select app.niva_outcome_backfill(:cb::uuid) as nb \gset
select pg_temp.assert(:nb::int = 9, 'the backfill fills in every question whose outcome is known (and leaves the rest pending)');
create temporary table bf as select question, answer_status, outcome_detail, model, answered_at, attempted_at
  from app.niva_conversations where center_id = :cb::uuid;
select pg_temp.assert((select answer_status from bf where question = 'Answered') = 'answered', 'backfill: an answer gives answered');
select pg_temp.assert((select answer_status = 'answered' and model = 'claude-opus-5'
                              and answered_at = (select finished_at from app.jobs where payload->>'conversation_id' = '59000000-0000-4000-8000-0000000000ba')
                         from bf where question = 'Answered by a job'), 'backfill: the answering job gives the model and when');
select pg_temp.assert((select answer_status from bf where question = 'No source') = 'no_source', 'backfill: no_matching_source gives no_source');
select pg_temp.assert((select answer_status from bf where question = 'Unsure') = 'unsure', 'backfill: model_unsure gives unsure');
select pg_temp.assert((select answer_status from bf where question = 'Refused') = 'refused', 'backfill: model_refused gives refused');
select pg_temp.assert((select answer_status = 'failed' and outcome_detail = 'The AI service''s spending limit was reached.' and attempted_at is not null
                         from bf where question = 'Spending limit'), 'backfill: a failed job gives failed, and a spending limit says so');
select pg_temp.assert((select answer_status = 'failed' and outcome_detail = 'The AI service is not set up on the background service, or its key was refused.'
                         from bf where question = 'Not configured'), 'backfill: a not-configured failure says so');
select pg_temp.assert((select answer_status = 'failed' and outcome_detail = 'The background service gave up after an error.'
                         from bf where question = 'Other failure'), 'backfill: any other failure is plain English, not the raw error');
select pg_temp.assert((select answer_status from bf where question = 'Failed, then no source') = 'no_source', 'backfill: the latest job decides');
select pg_temp.assert((select answer_status from bf where question = 'Still queued') = 'pending', 'backfill: a queued job stays pending');
select pg_temp.assert((select answer_status from bf where question = 'No job at all') = 'pending', 'backfill: no job stays pending');
select app.niva_outcome_backfill(:cb::uuid) as nb2 \gset
select pg_temp.assert(:nb2::int = 0, 'running the backfill again changes nothing');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.niva_outcome_backfill(uuid)', 'execute')
                      and not has_function_privilege('connect_worker', 'app.niva_outcome_backfill(uuid)', 'execute'),
  'the backfill is internal');

-- ── Go-live evidence covers published sources only ───────────────────────────
select app.golive_evidence_hash(app.niva_content_evidence(:c::uuid)) as ev1 \gset
insert into app.content_items (center_id, kind, slug, title, body_md, status) values
  (:c, 'niva_source', 'web-59-draft-01', 'Imported page: a section', 'An imported draft.', 'draft'),
  (:c, 'niva_source', 'web-59-review-01', 'Imported page: another', 'Waiting for approval.', 'in_review');
select pg_temp.assert(app.golive_evidence_hash(app.niva_content_evidence(:c::uuid)) = :'ev1', 'importing drafts does not change what go-live approved');
insert into app.content_items (center_id, kind, slug, title, body_md, status) values
  (:c, 'niva_source', 'hand-59-published', 'Parking', 'Park in the east lot.', 'published');
select pg_temp.assert(app.golive_evidence_hash(app.niva_content_evidence(:c::uuid)) <> :'ev1', 'publishing a source does');

-- ── 'approved' is not a state a Niva source stays in ─────────────────────────
select pg_temp.assert((select count(*) from app.content_items where kind = 'niva_source' and status = 'approved') = 0,
  'no niva_source is left in the dead "approved" state');
select pg_temp.assert(pg_get_functiondef('app.demo_community_community'::regproc)
                        like '%''demo-bylaws-summary'', ''Bylaws summary'', ''Membership tiers, voting and elections in brief. (Demo.)'', ''published''%',
  'the demo pack writes its Niva source as published');
-- What the migration did to 'approved' rows, run here on fixtures: the demo pack's own rows (slug
-- demo-…, in a center with a demo pack) are published; every other approved niva_source waits in the
-- approval queue; other kinds are left alone.
insert into app.center_demo_state (center_id, pack_key, status) values (:cb, 'community', 'loaded');
insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  ('59000000-0000-4000-8000-0000000005a1', :cb, 'niva_source', 'demo-59-sample', 'Demo sample', 'Sample data.', 'approved'),
  ('59000000-0000-4000-8000-0000000005a2', :cb, 'niva_source', 'web-59-approved', 'A real page', 'Real text.', 'approved'),
  ('59000000-0000-4000-8000-0000000005a3', :c, 'niva_source', 'demo-59-not-a-demo-center', 'Named like a demo row', 'Real text.', 'approved'),
  ('59000000-0000-4000-8000-0000000005a4', null, 'niva_source', 'demo-59-shared', 'A shared source', 'Shared text.', 'approved'),
  ('59000000-0000-4000-8000-0000000005a5', :cb, 'faq', 'demo-59-faq', 'Not a Niva source', 'An FAQ.', 'approved');
select app.niva_settle_approved_sources() as settle \gset
select pg_temp.assert(:'settle'::jsonb = '{"published":1,"in_review":3}'::jsonb, 'settling reports one published and three sent for approval');
select pg_temp.assert((select status = 'published' and published_at is not null from app.content_items where id = '59000000-0000-4000-8000-0000000005a1'),
  'a demo pack''s approved Niva source becomes published');
select pg_temp.assert((select bool_and(status = 'in_review') from app.content_items
                        where id in ('59000000-0000-4000-8000-0000000005a2', '59000000-0000-4000-8000-0000000005a3', '59000000-0000-4000-8000-0000000005a4')),
  'any other approved Niva source (a real page, a demo-named row outside a demo center, a shared one) waits for approval');
select pg_temp.assert((select status from app.content_items where id = '59000000-0000-4000-8000-0000000005a5') = 'approved',
  'other kinds of content are left alone');
select pg_temp.assert((app.niva_settle_approved_sources()) = '{"published":0,"in_review":0}'::jsonb, 'settling again changes nothing');
delete from app.content_items where id in ('59000000-0000-4000-8000-0000000005a1', '59000000-0000-4000-8000-0000000005a2',
  '59000000-0000-4000-8000-0000000005a3', '59000000-0000-4000-8000-0000000005a4', '59000000-0000-4000-8000-0000000005a5');
delete from app.center_demo_state where center_id = :cb;

-- ── Grants and search paths ──────────────────────────────────────────────────
select pg_temp.assert(has_function_privilege('authenticated', 'app.niva_retry_unanswered(uuid,interval,int)', 'execute')
                      and has_function_privilege('authenticated', 'app.niva_health(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.niva_retry_unanswered(uuid,interval,int)', 'execute')
                      and not has_function_privilege('anon', 'app.niva_health(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_scrub_text(text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_settle_approved_sources()', 'execute')
                      and not has_function_privilege('connect_worker', 'app.niva_settle_approved_sources()', 'execute'),
  'retry and health are for signed-in staff (checked inside), never anon; the scrub and settle helpers are internal');
select pg_temp.assert((select count(distinct p.proname) = 10 and bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) as g(setting)
                                                          where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p
                        where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('niva_ask','niva_regenerate','niva_worker_get_conversation','niva_worker_store_answer',
                                            'niva_worker_set_outcome','niva_retry_unanswered','niva_health','niva_outcome_backfill',
                                            'niva_content_evidence','niva_settle_approved_sources')),
  'every Niva function is security definer with search_path app, public, extensions');
