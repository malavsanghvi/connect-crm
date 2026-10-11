-- 0617 + 0618 (Niva for admins, step A1): the monthly limit per community, and retention.
--   A. Counting: default 300, per community, shared by its staff, status without counting   B. Who may count
--   C. The limit is a per-community entitlement: raise it, lower it, remove it, no limit   D. Month rollover   E. Who sees the
--   counter, no row-by-row audit   F. Retention: expire, abandon, remove after 30 and 90 days, through the existing sweep
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
create or replace function pg_temp.claims(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
grant connect_worker to postgres;

\set c1 '''98000000-0000-4000-8000-0000000000c1'''
\set c2 '''98000000-0000-4000-8000-0000000000c2'''
\set c3 '''98000000-0000-4000-8000-0000000000c3'''
\set ada '''98000000-0000-4000-8000-000000000a01'''
\set bo '''98000000-0000-4000-8000-000000000b01'''
\set cy '''98000000-0000-4000-8000-000000000c01'''
\set dee '''98000000-0000-4000-8000-000000000d01'''
\set mem '''98000000-0000-4000-8000-000000000e01'''
\set plat '''98000000-0000-4000-8000-000000000f01'''
\set nobody '''98000000-0000-4000-8000-000000000a02'''

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- ada and bo: staff of c1. cy: staff of c2. dee: staff of c3. mem: an ordinary member of c1. plat: a platform admin.
select pg_temp.no_claims();
insert into auth.users (id, email) values
  (:ada, 'ada98@asst.test'), (:bo, 'bo98@asst.test'), (:cy, 'cy98@asst.test'), (:dee, 'dee98@asst.test'),
  (:mem, 'mem98@asst.test'), (:plat, 'plat98@asst.test'), (:nobody, 'nobody98@asst.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:c1, 'asst98a', 'Assistant 98 A', 'A98', 'TX', 'active'),
  (:c2, 'asst98b', 'Assistant 98 B', 'B98', 'TX', 'active'),
  (:c3, 'asst98c', 'Assistant 98 C', 'C98', 'TX', 'active');
insert into app.role_grants (center_id, user_id, role_key) values
  (:c1, :ada, 'center_admin'), (:c1, :bo, 'membership_coordinator'), (:c2, :cy, 'membership_coordinator'), (:c3, :dee, 'membership_coordinator');
insert into app.people (id, center_id, first_name, last_name) values ('98000000-0000-4000-8000-0000000005b1', :c1, 'Mira', 'Member98');
insert into app.center_users (center_id, user_id, person_id) values (:c1, :mem, '98000000-0000-4000-8000-0000000005b1');

-- ══ A. Counting ══════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:ada);
select app.assistant_usage_check(:c1) as u1 \gset
select app.assistant_usage_check(:c1, 5) as u2 \gset
select app.assistant_usage_status(:c1) as s1 \gset
select app.assistant_usage_status(:c1) as s2 \gset
reset role;
select pg_temp.assert((:'u1'::jsonb)->>'allowed' = 'true' and (:'u1'::jsonb)->>'used' = '1' and (:'u1'::jsonb)->>'limit' = '300'
                      and ((:'u1'::jsonb)->>'month')::date = date_trunc('month', timezone('utc', now()))::date
                      and not ((:'u1'::jsonb) ? 'reason') and (select count(*) from jsonb_object_keys(:'u1'::jsonb)) = 4,
  'A · the first use is allowed: {allowed, used 1, limit 300, month = the first day of this month}');
select pg_temp.assert((:'u2'::jsonb)->>'allowed' = 'true' and (:'u2'::jsonb)->>'used' = '6', 'A · a use can cost more than one');
select pg_temp.assert(:'s1'::jsonb = :'s2'::jsonb and (:'s1'::jsonb)->>'used' = '6' and (:'s1'::jsonb)->>'limit' = '300'
                      and (select count(*) from jsonb_object_keys(:'s1'::jsonb)) = 3
                      and (select used from app.assistant_usage where center_id = :c1::uuid) = 6,
  'A · the status reads {used, limit, month} and does not count');

-- The counter belongs to the community: another member of its staff adds to it, another community has its own.
set role authenticated;
select pg_temp.claims(:bo);
select app.assistant_usage_check(:c1) as u3 \gset
select pg_temp.claims(:cy);
select app.assistant_usage_check(:c2) as u4 \gset
reset role;
select pg_temp.assert((:'u3'::jsonb)->>'used' = '7' and (:'u4'::jsonb)->>'used' = '1'
                      and (select count(*) = 2 from app.assistant_usage where center_id in (:c1::uuid, :c2::uuid)),
  'A · the count is per community: the whole staff shares it, another community starts at one');

-- ══ B. Who may count ═════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:mem);
select pg_temp.assert_raises($$select app.assistant_usage_check('98000000-0000-4000-8000-0000000000c1')$$, 'have access to this area',
  'B · an ordinary member cannot use up the community''s allowance');
select pg_temp.assert_raises($$select app.assistant_usage_status('98000000-0000-4000-8000-0000000000c1')$$, 'have access to this area',
  'B · nor read it through the status function');
select pg_temp.claims(:plat);
select pg_temp.assert_raises($$select app.assistant_usage_check('98000000-0000-4000-8000-0000000000c1')$$, 'have access to this area',
  'B · a platform admin with no role in the community cannot either');
select pg_temp.claims(:cy);
select pg_temp.assert_raises($$select app.assistant_usage_check('98000000-0000-4000-8000-0000000000c1')$$, 'have access to this area',
  'B · nor staff of another community');
select pg_temp.no_claims();
select pg_temp.assert_raises($$select app.assistant_usage_check('98000000-0000-4000-8000-0000000000c1')$$, 'Sign in', 'B · nor nobody signed in');
select pg_temp.claims(:ada);
select pg_temp.assert_raises($$select app.assistant_usage_check('98000000-0000-4000-8000-0000000000c1', 0)$$, 'between 1 and 100', 'B · an action counts for at least one');
select pg_temp.assert_raises($$select app.assistant_usage_check('98000000-0000-4000-8000-0000000000c1', 101)$$, 'between 1 and 100', 'B · and at most one hundred');
select pg_temp.assert_raises($$select app.assistant_usage_check('98000000-0000-4000-8000-0000000000c1', null)$$, 'between 1 and 100', 'B · and the cost is required');
reset role;
select pg_temp.assert((select used = 7 from app.assistant_usage where center_id = :c1::uuid), 'B · none of the refusals counted');

-- ══ C. The limit is the community's entitlement ══════════════════════════════
-- Community Connect (a platform admin) sets 10 for c1. 7 are used.
set role authenticated;
select pg_temp.claims(:plat);
select app.set_center_entitlement(:c1, 'assistant.monthly_actions', '10', 'test 98: a small allowance');
select pg_temp.claims(:ada);
select app.assistant_usage_check(:c1, 3) as c1a \gset
select app.assistant_usage_check(:c1) as c1b \gset
select app.assistant_usage_status(:c1) as c1s \gset
reset role;
select pg_temp.assert((:'c1a'::jsonb)->>'allowed' = 'true' and (:'c1a'::jsonb)->>'used' = '10' and (:'c1a'::jsonb)->>'limit' = '10',
  'C · a community with an allowance of 10 can use exactly 10 (7 + 3)');
select pg_temp.assert((:'c1b'::jsonb)->>'allowed' = 'false' and (:'c1b'::jsonb)->>'used' = '10' and (:'c1b'::jsonb)->>'limit' = '10'
                      and (:'c1b'::jsonb)->>'reason' like '%used up%10 actions%' and (:'c1b'::jsonb)->>'reason' like '%ask Community Connect to raise the limit%'
                      and (select used = 10 from app.assistant_usage where center_id = :c1::uuid),
  'C · the next use is refused in plain English and is not recorded');
select pg_temp.assert((:'c1s'::jsonb)->>'used' = '10' and (:'c1s'::jsonb)->>'limit' = '10', 'C · the status shows the override');

-- Raised to 12: a use that does not fit is refused whole; one that does fit is allowed.
set role authenticated;
select pg_temp.claims(:plat);
select app.set_center_entitlement(:c1, 'assistant.monthly_actions', '12', 'test 98: a bit more');
select pg_temp.claims(:ada);
select app.assistant_usage_check(:c1, 3) as c1c \gset
select app.assistant_usage_check(:c1, 2) as c1d \gset
select app.assistant_usage_check(:c1) as c1e \gset
select app.assistant_usage_check(:c1, 50) as c1f \gset
reset role;
select pg_temp.assert((:'c1c'::jsonb)->>'allowed' = 'false' and (:'c1c'::jsonb)->>'used' = '10', 'C · 10 + 3 does not fit under 12, so none of it is counted');
select pg_temp.assert((:'c1d'::jsonb)->>'allowed' = 'true' and (:'c1d'::jsonb)->>'used' = '12', 'C · 10 + 2 fits exactly');
select pg_temp.assert((:'c1e'::jsonb)->>'allowed' = 'false' and (:'c1e'::jsonb)->>'used' = '12'
                      and (:'c1f'::jsonb)->>'allowed' = 'false' and (:'c1f'::jsonb)->>'used' = '12' and (:'c1f'::jsonb)->>'limit' = '12'
                      and (select used = 12 from app.assistant_usage where center_id = :c1::uuid),
  'C · at the limit everything is refused, including a use larger than the whole allowance');

-- A community that has not used anything: a refused use does not even create the row.
set role authenticated;
select pg_temp.claims(:plat);
select app.set_center_entitlement(:c3, 'assistant.monthly_actions', '3', 'test 98: three only');
select pg_temp.claims(:dee);
select app.assistant_usage_check(:c3, 5) as c3a \gset
reset role;
select pg_temp.assert((:'c3a'::jsonb)->>'allowed' = 'false' and (:'c3a'::jsonb)->>'used' = '0' and (:'c3a'::jsonb)->>'limit' = '3'
                      and not exists (select 1 from app.assistant_usage where center_id = :c3::uuid),
  'C · a use bigger than the allowance is refused with nothing recorded');
set role authenticated;
select pg_temp.claims(:dee);
select app.assistant_usage_check(:c3, 3) as c3b \gset
select app.assistant_usage_check(:c3) as c3c \gset
reset role;
select pg_temp.assert((:'c3b'::jsonb)->>'allowed' = 'true' and (:'c3b'::jsonb)->>'used' = '3' and (:'c3c'::jsonb)->>'allowed' = 'false'
                      and (:'c3c'::jsonb)->>'used' = '3',
  'C · a first use of exactly the allowance is allowed, the next is not');

-- No limit at all (JSON null), then back to the default.
set role authenticated;
select pg_temp.claims(:plat);
select app.set_center_entitlement(:c1, 'assistant.monthly_actions', 'null'::jsonb, 'test 98: no limit');
select pg_temp.claims(:ada);
select app.assistant_usage_check(:c1, 100) as c1g \gset
select app.assistant_usage_check(:c1, 100) as c1h \gset
select app.assistant_usage_check(:c1, 100) as c1i \gset
select app.assistant_usage_status(:c1) as c1t \gset
reset role;
select pg_temp.assert((:'c1i'::jsonb)->>'allowed' = 'true' and (:'c1i'::jsonb)->>'used' = '312' and (:'c1i'::jsonb)->'limit' = 'null'::jsonb
                      and (:'c1t'::jsonb)->'limit' = 'null'::jsonb and (:'c1g'::jsonb)->>'used' = '112' and (:'c1h'::jsonb)->>'used' = '212',
  'C · an entitlement of JSON null means no limit: 312 uses, limit shown as null');
set role authenticated;
select pg_temp.claims(:plat);
select app.set_center_entitlement(:c1, 'assistant.monthly_actions', null, 'test 98: back to the default');
select pg_temp.claims(:ada);
select app.assistant_usage_check(:c1) as c1k \gset
reset role;
select pg_temp.assert((:'c1k'::jsonb)->>'allowed' = 'false' and (:'c1k'::jsonb)->>'limit' = '300' and (:'c1k'::jsonb)->>'used' = '312',
  'C · removing the override brings back the default 300, and a community already over it is refused');

-- ══ D. A new month starts from zero ══════════════════════════════════════════
-- c2 used up last month (300) and next month's row exists too (a clock set wrong); neither counts today.
insert into app.assistant_usage (center_id, month, used) values
  (:c2, (app._assistant_month() - interval '1 month')::date, 300),
  (:c2, (app._assistant_month() + interval '1 month')::date, 300);
set role authenticated;
select pg_temp.claims(:cy);
select app.assistant_usage_check(:c2) as c2a \gset
reset role;
select pg_temp.assert((:'c2a'::jsonb)->>'allowed' = 'true' and (:'c2a'::jsonb)->>'used' = '2'
                      and (select used = 300 from app.assistant_usage where center_id = :c2::uuid and month = (app._assistant_month() - interval '1 month')::date)
                      and (select used = 300 from app.assistant_usage where center_id = :c2::uuid and month = (app._assistant_month() + interval '1 month')::date),
  'D · the other months'' rows do not count against this month and are left alone');
-- A month with no row yet (the first use after midnight on the 1st): the row is created at the cost of that use.
delete from app.assistant_usage where center_id = :c2::uuid and month = app._assistant_month();
set role authenticated;
select pg_temp.claims(:cy);
select app.assistant_usage_check(:c2, 4) as c2b \gset
reset role;
select pg_temp.assert((:'c2b'::jsonb)->>'allowed' = 'true' and (:'c2b'::jsonb)->>'used' = '4'
                      and (select used = 4 from app.assistant_usage where center_id = :c2::uuid and month = app._assistant_month()),
  'D · a month with no row starts at the cost of its first use');
select pg_temp.assert_raises($$insert into app.assistant_usage (center_id, month, used) values ('98000000-0000-4000-8000-0000000000c2', date '2026-01-15', 1)$$,
  'assistant_usage_month_check', 'D · a month is stored as its first day');

-- ══ E. Who sees the counter, and what is audited ═════════════════════════════
set role authenticated;
select pg_temp.claims(:ada);
select pg_temp.assert((select count(*) = 1 and bool_and(center_id = :c1::uuid) from app.assistant_usage), 'E · ada (staff of c1) reads c1''s counter and no other');
select pg_temp.claims(:bo);
select pg_temp.assert((select count(*) = 1 and bool_and(center_id = :c1::uuid and used = 312) from app.assistant_usage), 'E · so does bo: the counter is the community''s');
select pg_temp.claims(:cy);
select pg_temp.assert((select count(*) = 3 and bool_and(center_id = :c2::uuid) from app.assistant_usage), 'E · cy reads c2''s three rows and nothing of c1''s');
select pg_temp.claims(:mem);
select pg_temp.assert((select count(*) = 0 from app.assistant_usage), 'E · an ordinary member reads none');
select pg_temp.claims(:plat);
select pg_temp.assert((select count(*) = 0 from app.assistant_usage), 'E · a platform admin with no role reads none');
select pg_temp.claims(:ada);
select pg_temp.assert_raises($$insert into app.assistant_usage (center_id, month, used) values ('98000000-0000-4000-8000-0000000000c1', date '2026-01-01', 0)$$,
  'permission denied', 'E · no one writes the counter directly: insert');
select pg_temp.assert_raises($$update app.assistant_usage set used = 0$$, 'permission denied', 'E · update');
select pg_temp.assert_raises($$delete from app.assistant_usage$$, 'permission denied', 'E · delete');
reset role;
select pg_temp.assert(not exists (select 1 from app.audit_log where record_table = 'assistant_usage' and action <> 'assistant_usage.delete'),
  'E · counting up is not audited row by row');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'assistant_usage' and action = 'assistant_usage.delete'
                                 and record_id = '98000000-0000-4000-8000-0000000000c2:' || to_char(app._assistant_month(), 'YYYY-MM-DD')),
  'E · removing a counter row is audited, by community and month');

-- ══ F. Retention ═════════════════════════════════════════════════════════════
\set b1 '''98000000-0000-4000-8000-0000000007b1'''
insert into app.assistant_messages (id, center_id, actor_user_id, thread_id, role, content, created_at) values
  ('98000000-0000-4000-8000-000000000ba1', :c1, :ada, :b1, 'user', 'SECRET-OLD-MESSAGE-98', now() - interval '31 days'),
  ('98000000-0000-4000-8000-000000000ba2', :c1, :ada, :b1, 'user', 'a message from 29 days ago', now() - interval '29 days'),
  ('98000000-0000-4000-8000-000000000ba3', :c1, :ada, :b1, 'user', 'a message from today', now());
insert into app.assistant_proposals (id, center_id, actor_user_id, command_key, input, input_hash, status, expires_at, confirmed_at, finished_at, created_at) values
  ('98000000-0000-4000-8000-0000000008a1', :c1, :ada, 'giving.note', '{"memo":"SECRET-OLD-98"}', repeat('a', 64), 'executed',
     now() - interval '91 days', now() - interval '91 days', now() - interval '91 days', now() - interval '91 days'),
  ('98000000-0000-4000-8000-0000000008a2', :c1, :ada, 'giving.note', '{"memo":"89 days"}', repeat('b', 64), 'executed',
     now() - interval '89 days', now() - interval '89 days', now() - interval '89 days', now() - interval '89 days'),
  ('98000000-0000-4000-8000-0000000008a3', :c1, :ada, 'giving.note', '{"memo":"never answered"}', repeat('c', 64), 'proposed',
     now() - interval '1 minute', null, null, now() - interval '1 hour'),
  ('98000000-0000-4000-8000-0000000008a4', :c1, :ada, 'giving.note', '{"memo":"still fresh"}', repeat('d', 64), 'proposed',
     now() + interval '10 minutes', null, null, now()),
  ('98000000-0000-4000-8000-0000000008a5', :c1, :ada, 'giving.note', '{"memo":"never finished"}', repeat('e', 64), 'confirmed',
     now() - interval '2 hours', now() - interval '2 hours', null, now() - interval '3 hours'),
  ('98000000-0000-4000-8000-0000000008a6', :c1, :ada, 'giving.note', '{"memo":"running now"}', repeat('f', 64), 'confirmed',
     now() + interval '5 minutes', now() - interval '10 minutes', null, now() - interval '12 minutes');

select pg_temp.no_claims();
select pg_temp.assert_raises($$select app.assistant_purge(1000)$$, 'Only the background service', 'F · only the background service runs retention');
set role authenticated;
select pg_temp.claims(:ada);
select pg_temp.assert_raises($$select app.assistant_purge(1000)$$, 'permission denied', 'F · a signed-in person cannot run it at all');
reset role;
select pg_temp.no_claims();

set local role connect_worker;
select app.assistant_purge(1000) as pr1 \gset
reset role;
select pg_temp.assert(:'pr1'::jsonb = '{"expired": 1, "abandoned": 1, "messages_removed": 1, "requests_removed": 1}'::jsonb,
  'F · the sweep reports what it did: 1 expired, 1 abandoned, 1 message and 1 request removed');
select pg_temp.assert((select count(*) = 0 from app.assistant_messages where id = '98000000-0000-4000-8000-000000000ba1')
                      and (select count(*) = 2 from app.assistant_messages where id in ('98000000-0000-4000-8000-000000000ba2', '98000000-0000-4000-8000-000000000ba3')),
  'F · conversation text older than 30 days is removed, newer text stays');
select pg_temp.assert((select count(*) = 0 from app.assistant_proposals where id = '98000000-0000-4000-8000-0000000008a1')
                      and (select count(*) = 1 from app.assistant_proposals where id = '98000000-0000-4000-8000-0000000008a2'),
  'F · requests older than 90 days are removed, newer ones stay');
select pg_temp.assert((select status = 'expired' and finished_at is null from app.assistant_proposals where id = '98000000-0000-4000-8000-0000000008a3')
                      and (select status = 'proposed' from app.assistant_proposals where id = '98000000-0000-4000-8000-0000000008a4'),
  'F · a request nobody answered in time is marked expired; a fresh one is left alone');
select pg_temp.assert((select status = 'failed' and finished_at is not null and result_summary like 'Niva never reported back%'
                         from app.assistant_proposals where id = '98000000-0000-4000-8000-0000000008a5')
                      and (select status = 'confirmed' from app.assistant_proposals where id = '98000000-0000-4000-8000-0000000008a6'),
  'F · a confirmed request that never reported back for an hour is marked failed; one running now is left alone');
select pg_temp.assert((select count(*) = 1 and bool_and(center_id is null and client_app = 'job' and after->>'messages_removed' = '1'
                                                         and after->>'requests_removed' = '1' and record_table = 'assistant_messages')
                         from app.audit_log where action = 'assistant.retention'),
  'F · the sweep writes one summary row, with counts only');
select pg_temp.assert((select bool_and(before->>'input' = '***' and before->>'status' = 'executed')
                         from app.audit_log where record_table = 'assistant_proposals' and action = 'assistant_proposals.delete'
                          and record_id = '98000000-0000-4000-8000-0000000008a1'),
  'F · removing a request is audited like any change to it, with its input masked');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'assistant_proposals' and action = 'assistant_proposals.update'
                                 and record_id = '98000000-0000-4000-8000-0000000008a3' and client_app = 'job' and after->>'status' = 'expired'),
  'F · closing a request is audited as done by a scheduled job');
select pg_temp.assert(not exists (select 1 from app.audit_log where record_table = 'assistant_messages' and action = 'assistant_messages.delete')
                      and not exists (select 1 from app.audit_log where record_table in ('assistant_proposals', 'assistant_messages')
                                         and (coalesce(before::text, '') || coalesce(after::text, '')) like '%SECRET-OLD%'),
  'F · removing conversation text is not audited row by row, and none of it reached the audit log');

-- A second run finds nothing more to do and writes no second summary.
set local role connect_worker;
select app.assistant_purge(1000) as pr2 \gset
reset role;
select pg_temp.assert(:'pr2'::jsonb = '{"expired": 0, "abandoned": 0, "messages_removed": 0, "requests_removed": 0}'::jsonb
                      and (select count(*) = 1 from app.audit_log where action = 'assistant.retention'),
  'F · running it again does nothing and says nothing');

-- The batch size is respected: three old messages, one at a time.
insert into app.assistant_messages (center_id, actor_user_id, thread_id, role, content, created_at)
  select :c1::uuid, :ada::uuid, :b1::uuid, 'user', 'old ' || g, now() - interval '40 days' from generate_series(1, 3) g;
set local role connect_worker;
select app.assistant_purge(1) as pr3 \gset
select app.assistant_purge(1000) as pr4 \gset
reset role;
select pg_temp.assert((:'pr3'::jsonb)->>'messages_removed' = '1' and (:'pr4'::jsonb)->>'messages_removed' = '2',
  'F · a batch of 1 removes one message; the next run removes the other two');

-- It rides on the sweep that already exists: niva.retention calls app.niva_expired_conversations once a day.
insert into app.niva_conversations (id, center_id, user_id, question, answer, created_at) values
  ('98000000-0000-4000-8000-0000000009d1', :c1, :ada, 'An old question', 'An old answer', now() - interval '31 days');
insert into app.assistant_messages (id, center_id, actor_user_id, thread_id, role, content, created_at) values
  ('98000000-0000-4000-8000-000000000bc1', :c1, :ada, :b1, 'user', 'old line removed by the Niva sweep', now() - interval '45 days');
insert into app.assistant_proposals (id, center_id, actor_user_id, command_key, input, input_hash, status, expires_at, created_at) values
  ('98000000-0000-4000-8000-0000000008b1', :c1, :ada, 'giving.note', '{"memo":"swept"}', repeat('9', 64), 'proposed',
     now() - interval '5 minutes', now() - interval '20 minutes');
set local role connect_worker;
select app.niva_expired_conversations(1000) as nn \gset
reset role;
select pg_temp.assert(:nn::int >= 1 and (select count(*) = 0 from app.niva_conversations where id = '98000000-0000-4000-8000-0000000009d1'),
  'F · the Niva sweep still removes old member conversations and returns their count');
select pg_temp.assert((select count(*) = 0 from app.assistant_messages where id = '98000000-0000-4000-8000-000000000bc1')
                      and (select status = 'expired' from app.assistant_proposals where id = '98000000-0000-4000-8000-0000000008b1'),
  'F · and the same sweep cleans up the assistant''s old text and unanswered requests');
select pg_temp.no_claims();
select pg_temp.claims(:ada);
set role authenticated;
select pg_temp.assert_raises($$select app.niva_expired_conversations(10)$$, 'permission denied', 'F · the sweep is still the background service''s alone');
reset role;

select pg_temp.assert(has_function_privilege('connect_worker', 'app.assistant_purge(integer)', 'execute')
                      and not has_function_privilege('authenticated', 'app.assistant_purge(integer)', 'execute')
                      and not has_function_privilege('anon', 'app.assistant_purge(integer)', 'execute')
                      and has_function_privilege('connect_worker', 'app.niva_expired_conversations(integer)', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_expired_conversations(integer)', 'execute'),
  'F · only the background service may run either sweep');
rollback;
