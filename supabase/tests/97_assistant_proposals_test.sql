-- 0616 + 0617 (Niva for admins, step A1): the audit value 'assistant', and the propose / confirm / finish record.
--   A. audit_clean_app accepts 'assistant' and still cleans everything else   B. The limit exists as an entitlement
--   C. Propose: who may, what is stored, what is refused                        D. Confirm: once, only the proposer, only fresh,
--   only with the hash   E. Finish and reject   F. Expiry, tampering, the open-request cap, no edits   G. Who sees what (two
--   communities, several people)   H. Conversation text   I. The audit log: masked input, no message rows, the shape of
--   the mask   J. Who may call what
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

\set c1 '''97000000-0000-4000-8000-0000000000c1'''
\set c2 '''97000000-0000-4000-8000-0000000000c2'''
\set ada '''97000000-0000-4000-8000-000000000a01'''
\set bo '''97000000-0000-4000-8000-000000000b01'''
\set cy '''97000000-0000-4000-8000-000000000c01'''
\set mem '''97000000-0000-4000-8000-000000000d01'''
\set plat '''97000000-0000-4000-8000-000000000e01'''
\set ex '''97000000-0000-4000-8000-000000000f01'''
\set nobody '''97000000-0000-4000-8000-000000000a02'''
\set t1 '''97000000-0000-4000-8000-0000000007a1'''
\set t2 '''97000000-0000-4000-8000-0000000007a2'''
\set tcap '''97000000-0000-4000-8000-0000000007a3'''
\set h1 '''97000000-0000-4000-8000-0000000005a1'''
\set in1 '{"household_id":"97000000-0000-4000-8000-0000000005a1","amount_cents":5000,"memo":"SECRET-MEMO-97"}'
\set pv1 '{"title":"Record a payment of 50.00 dollars","household_card":{"name":"SECRET-HOUSEHOLD-97"}}'
\set corr1 '97000000-0000-4000-8000-0000000009c1'

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- ada: staff of both communities. bo: staff of c1. cy: staff of c2. ex: staff of c1 until the grant is revoked below.
-- mem: an ordinary member of c1. plat: a platform admin with no role in either community. nobody: signed in, linked to nothing.
select pg_temp.no_claims();
insert into auth.users (id, email) values
  (:ada, 'ada97@asst.test'), (:bo, 'bo97@asst.test'), (:cy, 'cy97@asst.test'), (:mem, 'mem97@asst.test'),
  (:plat, 'plat97@asst.test'), (:ex, 'ex97@asst.test'), (:nobody, 'nobody97@asst.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:c1, 'asst97a', 'Assistant 97 A', 'A97', 'TX', 'active'),
  (:c2, 'asst97b', 'Assistant 97 B', 'B97', 'TX', 'active');
insert into app.role_grants (center_id, user_id, role_key) values
  (:c1, :ada, 'center_admin'), (:c2, :ada, 'membership_coordinator'), (:c1, :bo, 'treasurer'),
  (:c2, :cy, 'membership_coordinator'), (:c1, :ex, 'membership_coordinator');
insert into app.people (id, center_id, first_name, last_name) values ('97000000-0000-4000-8000-0000000005b1', :c1, 'Mira', 'Member97');
insert into app.center_users (center_id, user_id, person_id) values (:c1, :mem, '97000000-0000-4000-8000-0000000005b1');
insert into app.households (id, center_id, display_name) values (:h1, :c1, 'Household 97');

-- ══ A. The audit value ═══════════════════════════════════════════════════════
select pg_temp.assert(app.audit_clean_app('assistant') = 'assistant' and app.audit_clean_app('  Assistant ') = 'assistant',
  'A · assistant is accepted as a client app, in any case and trimmed');
select pg_temp.assert((select array_agg(app.audit_clean_app(v) order by v) from unnest(array['portal', 'member', 'kiosk', 'job', 'import']) v)
                      = array['import', 'job', 'kiosk', 'member', 'portal'],
  'A · portal, member, kiosk, job and import are still accepted');
select pg_temp.assert(app.audit_clean_app('niva') is null and app.audit_clean_app('hacker') is null and app.audit_clean_app('') is null
                      and app.audit_clean_app(null) is null and app.audit_clean_app('assistants') is null,
  'A · anything else is still dropped');
-- The header path: a write made with x-client-app: assistant is recorded as such.
select pg_temp.claims(:ada);
select set_config('request.headers', '{"x-client-app":"assistant"}', true);
update app.households set city = 'Sugar Land' where id = :h1;
select pg_temp.assert((select client_app = 'assistant' and actor_user_id = :ada::uuid and center_id = :c1::uuid
                         from app.audit_log where action = 'households.update' and record_id = :'h1' order by id desc limit 1),
  'A · a change made with the assistant header is audited with client_app assistant, for the signed-in person');
select pg_temp.no_claims();

-- ══ B. The limit is an entitlement ═══════════════════════════════════════════
select pg_temp.assert(app.entitlement(:c1, 'assistant.monthly_actions') = '300'::jsonb
                      and (select count(*) from app.entitlement_defaults where key = 'assistant.monthly_actions' and value = '300'::jsonb) = 2,
  'B · assistant.monthly_actions is 300 by default in both environments');

-- ══ C. Propose ═══════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:ada);
select app.assistant_propose(:c1, 'giving.record_payment', :'in1'::jsonb, :'pv1'::jsonb, :t1) as r1 \gset
select (:'r1'::jsonb)->>'proposal_id' as p1, (:'r1'::jsonb)->>'input_hash' as h1x \gset
reset role;
select pg_temp.assert((:'r1'::jsonb) ? 'proposal_id' and (:'r1'::jsonb) ? 'input_hash' and (:'r1'::jsonb) ? 'expires_at'
                      and (select count(*) from jsonb_object_keys(:'r1'::jsonb)) = 3,
  'C · propose returns exactly proposal_id, input_hash and expires_at');
select pg_temp.assert((select status = 'proposed' and level = 3 and actor_user_id = :ada::uuid and center_id = :c1::uuid and thread_id = :t1::uuid
                              and command_key = 'giving.record_payment' and input = :'in1'::jsonb and preview = :'pv1'::jsonb
                              and input_hash = :'h1x' and expires_at = now() + interval '15 minutes'
                              and confirmed_at is null and finished_at is null and result_summary is null
                         from app.assistant_proposals where id = :'p1'::uuid),
  'C · the proposal is stored for the signed-in person: command, input, preview, level 3, 15 minutes');
select pg_temp.assert(:'h1x' = encode(extensions.digest((:'in1'::jsonb)::text, 'sha256'), 'hex') and :'h1x' ~ '^[0-9a-f]{64}$',
  'C · the hash is the sha256 (hex) of the input text');

-- Who may propose: staff of that community, as themselves.
set role authenticated;
select pg_temp.claims(:mem);
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'giving.note', '{}'::jsonb, '{}'::jsonb)$$,
  'have access to this area', 'C · an ordinary member cannot prepare an action');
select pg_temp.claims(:plat);
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'giving.note', '{}'::jsonb, '{}'::jsonb)$$,
  'have access to this area', 'C · a platform admin without a role in the community cannot prepare an action');
select pg_temp.claims(:nobody);
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'giving.note', '{}'::jsonb, '{}'::jsonb)$$,
  'have access to this area', 'C · a signed-in person linked to nothing cannot prepare an action');
select pg_temp.claims(:cy);
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'giving.note', '{}'::jsonb, '{}'::jsonb)$$,
  'have access to this area', 'C · staff of another community cannot prepare an action here');
select pg_temp.no_claims();
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'giving.note', '{}'::jsonb, '{}'::jsonb)$$,
  'Sign in', 'C · nobody signed in cannot prepare an action');

-- What is refused.
select pg_temp.claims(:ada);
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'Giving Note!', '{}'::jsonb, '{}'::jsonb)$$,
  'name of the action is not valid', 'C · a command name must be a plain key');
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', null, '{}'::jsonb, '{}'::jsonb)$$,
  'name of the action is not valid', 'C · a command name is required');
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'giving.note', '[1]'::jsonb, '{}'::jsonb)$$,
  'details of the action are missing', 'C · the input must be an object');
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'giving.note', null, '{}'::jsonb)$$,
  'details of the action are missing', 'C · the input is required');
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'giving.note', '{}'::jsonb, '[1]'::jsonb)$$,
  'summary of the action is not valid', 'C · the preview must be an object');
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'giving.note', jsonb_build_object('k', repeat('x', 70000)), '{}'::jsonb)$$,
  'too large', 'C · an oversized input is refused');
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c2', 'giving.note', '{}'::jsonb, '{}'::jsonb, '97000000-0000-4000-8000-0000000007a1')$$,
  'belongs to someone else', 'C · a conversation started in one community cannot be used in another');
select pg_temp.claims(:bo);
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'giving.note', '{}'::jsonb, '{}'::jsonb, '97000000-0000-4000-8000-0000000007a1')$$,
  'belongs to someone else', 'C · nor can another person use it');
-- A null preview is an empty one.
select app.assistant_propose(:c1, 'giving.note', '{"n":1}'::jsonb, null) as rb1 \gset
select (:'rb1'::jsonb)->>'proposal_id' as pb1 \gset
select pg_temp.claims(:cy);
select app.assistant_propose(:c2, 'people.note', '{"n":1}'::jsonb, '{}'::jsonb) as rcy1 \gset
select (:'rcy1'::jsonb)->>'proposal_id' as pcy1 \gset
select pg_temp.claims(:ada);
select app.assistant_propose(:c2, 'people.note', '{"n":1}'::jsonb, '{}'::jsonb) as rc2 \gset
select (:'rc2'::jsonb)->>'proposal_id' as pc2 \gset
select pg_temp.claims(:ex);
select app.assistant_propose(:c1, 'people.note', '{"n":1}'::jsonb, '{}'::jsonb) as rex \gset
select (:'rex'::jsonb)->>'proposal_id' as pex \gset
reset role;
select pg_temp.assert((select preview = '{}'::jsonb and actor_user_id = :bo::uuid from app.assistant_proposals where id = :'pb1'::uuid),
  'C · a missing preview is stored as an empty one');

-- ══ D. Confirm ═══════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:ada);
select app.assistant_confirm(:'p1'::uuid, repeat('0', 64)) as d1 \gset
select app.assistant_confirm(:'p1'::uuid, null) as d2 \gset
reset role;
select pg_temp.assert((:'d1'::jsonb)->>'ok' = 'false' and (:'d1'::jsonb)->>'reason' like '%not what was prepared%'
                      and (:'d1'::jsonb)->>'error' = (:'d1'::jsonb)->>'reason' and not ((:'d1'::jsonb) ? 'command')
                      and (:'d2'::jsonb)->>'ok' = 'false'
                      and (select status = 'proposed' and confirmed_at is null from app.assistant_proposals where id = :'p1'::uuid),
  'D · a different hash, or none, is refused in plain English and nothing changes');

set role authenticated;
select pg_temp.claims(:bo);
select app.assistant_confirm(:'p1'::uuid, :'h1x') as d3 \gset
select pg_temp.claims(:cy);
select app.assistant_confirm(:'p1'::uuid, :'h1x') as d4 \gset
select pg_temp.claims(:plat);
select app.assistant_confirm(:'p1'::uuid, :'h1x') as d5 \gset
select pg_temp.claims(:mem);
select app.assistant_confirm(:'p1'::uuid, :'h1x') as d6 \gset
reset role;
select pg_temp.assert((:'d3'::jsonb)->>'ok' = 'false' and (:'d3'::jsonb)->>'reason' like '%not prepared for you%'
                      and (:'d4'::jsonb)->>'ok' = 'false' and (:'d5'::jsonb)->>'ok' = 'false' and (:'d6'::jsonb)->>'ok' = 'false'
                      and (select status = 'proposed' and confirmed_at is null from app.assistant_proposals where id = :'p1'::uuid),
  'D · another staff member, staff of another community, a platform admin and a member cannot confirm it, even with the right hash');
select pg_temp.assert((:'d3'::jsonb)->>'reason' = (select (app.assistant_confirm('97000000-0000-4000-8000-000000000000'::uuid, 'x'))->>'reason' from (select 1) z),
  'D · an unknown request gets the same answer as someone else''s');

set role authenticated;
select pg_temp.claims(:ada);
select app.assistant_confirm(:'p1'::uuid, :'h1x') as d7 \gset
select app.assistant_confirm(:'p1'::uuid, :'h1x') as d8 \gset
reset role;
select pg_temp.assert((:'d7'::jsonb)->>'ok' = 'true' and (:'d7'::jsonb)->>'command' = 'giving.record_payment'
                      and (:'d7'::jsonb)->'input' = :'in1'::jsonb and (:'d7'::jsonb)->>'center_id' = '97000000-0000-4000-8000-0000000000c1'
                      and (select count(*) from jsonb_object_keys(:'d7'::jsonb)) = 4,
  'D · the proposer with the right hash gets {ok, command, input, center_id}');
select pg_temp.assert((select status = 'confirmed' and confirmed_at is not null and finished_at is null from app.assistant_proposals where id = :'p1'::uuid),
  'D · the request is now confirmed');
select pg_temp.assert((:'d8'::jsonb)->>'ok' = 'false' and (:'d8'::jsonb)->>'reason' like '%already confirmed%'
                      and (select status = 'confirmed' from app.assistant_proposals where id = :'p1'::uuid),
  'D · a second confirm is refused, so the command cannot run twice');

-- The hash may arrive in capitals or with spaces.
set role authenticated;
select pg_temp.claims(:ada);
select app.assistant_propose(:c1, 'giving.note', '{"n":2}'::jsonb, '{}'::jsonb) as r2 \gset
select (:'r2'::jsonb)->>'proposal_id' as p2, (:'r2'::jsonb)->>'input_hash' as h2 \gset
select app.assistant_confirm(:'p2'::uuid, ' ' || upper(:'h2') || ' ') as d9 \gset
reset role;
select pg_temp.assert((:'d9'::jsonb)->>'ok' = 'true', 'D · the hash is compared without regard to case or surrounding spaces');

-- ══ E. Finish and reject ═════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:ada);
select app.assistant_propose(:c1, 'giving.note', '{"n":3}'::jsonb, '{}'::jsonb) as r3 \gset
select (:'r3'::jsonb)->>'proposal_id' as p3, (:'r3'::jsonb)->>'input_hash' as h3 \gset
select pg_temp.assert_raises(format('select app.assistant_finish(%L::uuid, true, %L)', :'p3', 'x'),
  'cannot be marked finished', 'E · a request still waiting for the OK cannot be marked finished');
select app.assistant_confirm(:'p3'::uuid, :'h3') as d10 \gset
select pg_temp.claims(:bo);
select pg_temp.assert_raises(format('select app.assistant_finish(%L::uuid, true, %L)', :'p3', 'x'),
  'was not found', 'E · another person cannot mark it finished');
select pg_temp.claims(:ada);
select pg_temp.assert_raises(format('select app.assistant_finish(%L::uuid, null, %L)', :'p3', 'x'),
  'Say whether', 'E · finishing needs a yes or a no');
select app.assistant_finish(:'p1'::uuid, true, '  Recorded a payment of 50.00 dollars.  ', :'corr1'::uuid);
select pg_temp.assert_raises(format('select app.assistant_finish(%L::uuid, true, %L)', :'p1', 'again'),
  'already done', 'E · finishing twice is refused');
select app.assistant_finish(:'p2'::uuid, false, 'It did not work.');
reset role;
select pg_temp.assert((select status = 'executed' and finished_at is not null and confirmed_at is not null
                              and result_summary = 'Recorded a payment of 50.00 dollars.' and correlation_id = :'corr1'::uuid
                         from app.assistant_proposals where id = :'p1'::uuid),
  'E · finish records executed, when, a trimmed summary and the correlation id');
select pg_temp.assert((select status = 'failed' and finished_at is not null and result_summary = 'It did not work.' and correlation_id is null
                         from app.assistant_proposals where id = :'p2'::uuid),
  'E · finish with false records failed');
select pg_temp.assert((select status = 'confirmed' from app.assistant_proposals where id = :'p3'::uuid),
  'E · a request that was only confirmed stays confirmed');

set role authenticated;
select pg_temp.claims(:ada);
select app.assistant_propose(:c1, 'giving.note', '{"n":4}'::jsonb, '{}'::jsonb) as r4 \gset
select (:'r4'::jsonb)->>'proposal_id' as p4, (:'r4'::jsonb)->>'input_hash' as h4 \gset
select pg_temp.claims(:bo);
select pg_temp.assert_raises(format('select app.assistant_reject(%L::uuid)', :'p4'), 'was not found', 'E · another person cannot cancel it');
select pg_temp.claims(:ada);
select app.assistant_reject(:'p4'::uuid);
select app.assistant_reject(:'p4'::uuid);
select app.assistant_confirm(:'p4'::uuid, :'h4') as d11 \gset
select pg_temp.assert_raises(format('select app.assistant_reject(%L::uuid)', :'p1'), 'already done', 'E · a request that was carried out cannot be cancelled');
select pg_temp.assert_raises(format('select app.assistant_reject(%L::uuid)', :'p3'), 'already confirmed', 'E · nor one that was confirmed');
reset role;
select pg_temp.assert((select status = 'rejected' and confirmed_at is null from app.assistant_proposals where id = :'p4'::uuid),
  'E · cancelling works, and cancelling twice is fine');
select pg_temp.assert((:'d11'::jsonb)->>'ok' = 'false' and (:'d11'::jsonb)->>'reason' like '%cancelled%'
                      and (select status = 'rejected' from app.assistant_proposals where id = :'p4'::uuid),
  'E · a cancelled request cannot be confirmed');

-- ══ F. Expiry, tampering, the cap, no edits ══════════════════════════════════
set role authenticated;
select pg_temp.claims(:ada);
select app.assistant_propose(:c1, 'giving.note', '{"n":5}'::jsonb, '{}'::jsonb) as r5 \gset
select (:'r5'::jsonb)->>'proposal_id' as p5, (:'r5'::jsonb)->>'input_hash' as h5 \gset
select app.assistant_propose(:c1, 'giving.note', '{"n":6}'::jsonb, '{}'::jsonb) as r6 \gset
select (:'r6'::jsonb)->>'proposal_id' as p6 \gset
select app.assistant_propose(:c1, 'giving.note', '{"n":7}'::jsonb, '{}'::jsonb) as r7 \gset
select (:'r7'::jsonb)->>'proposal_id' as p7, (:'r7'::jsonb)->>'input_hash' as h7 \gset
reset role;
-- Age two of them and change the stored input of the third (triggers off: the table refuses both otherwise).
set local session_replication_role = replica;
update app.assistant_proposals set expires_at = now() - interval '1 minute' where id in (:'p5'::uuid, :'p6'::uuid);
update app.assistant_proposals set input = '{"n":7000}'::jsonb where id = :'p7'::uuid;
set local session_replication_role = origin;
set role authenticated;
select pg_temp.claims(:ada);
select app.assistant_confirm(:'p5'::uuid, :'h5') as d12 \gset
select app.assistant_confirm(:'p5'::uuid, :'h5') as d13 \gset
select app.assistant_confirm(:'p7'::uuid, :'h7') as d14 \gset
reset role;
select pg_temp.assert((:'d12'::jsonb)->>'ok' = 'false' and (:'d12'::jsonb)->>'reason' like '%ran out of time%'
                      and (select status = 'expired' and confirmed_at is null from app.assistant_proposals where id = :'p5'::uuid),
  'F · a request older than 15 minutes cannot be confirmed and is marked expired');
select pg_temp.assert((:'d13'::jsonb)->>'ok' = 'false' and (:'d13'::jsonb)->>'reason' like '%ran out of time%',
  'F · and stays refused afterwards');
select pg_temp.assert((:'d14'::jsonb)->>'ok' = 'false' and (:'d14'::jsonb)->>'reason' like '%changed after it was prepared%'
                      and (select status = 'proposed' from app.assistant_proposals where id = :'p7'::uuid),
  'F · a stored input that no longer matches its hash is refused even with the right hash');
select pg_temp.assert((select status = 'proposed' from app.assistant_proposals where id = :'p6'::uuid),
  'F · an aged request nobody touched is still open until something closes it');
set role authenticated;
select pg_temp.claims(:ada);
select app.assistant_propose(:c1, 'giving.note', '{"n":8}'::jsonb, '{}'::jsonb) as r8 \gset
reset role;
select pg_temp.assert((select status = 'expired' from app.assistant_proposals where id = :'p6'::uuid),
  'F · preparing a new request closes the person''s own aged ones');

-- No edits to a prepared request, even for a superuser.
select pg_temp.assert_raises(format('update app.assistant_proposals set input = %L::jsonb where id = %L::uuid', '{"n":9}', :'p2'),
  'cannot be changed', 'F · the input cannot be edited');
select pg_temp.assert_raises(format('update app.assistant_proposals set expires_at = now() + interval %L where id = %L::uuid', '1 day', :'p2'),
  'cannot be changed', 'F · the expiry cannot be edited');
select pg_temp.assert_raises(format('update app.assistant_proposals set actor_user_id = %L::uuid where id = %L::uuid', '97000000-0000-4000-8000-000000000b01', :'p2'),
  'cannot be changed', 'F · the person cannot be edited');
select pg_temp.assert_raises(format('update app.assistant_proposals set status = %L, finished_at = null where id = %L::uuid', 'proposed', :'p1'),
  'cannot go from', 'F · a finished request cannot be reopened');
select pg_temp.assert_raises(format('update app.assistant_proposals set status = %L, finished_at = now() where id = %L::uuid', 'executed', :'pb1'),
  'cannot go from', 'F · a request cannot be marked executed without being confirmed');

-- The table itself: no direct writes for a signed-in person.
set role authenticated;
select pg_temp.claims(:ada);
select pg_temp.assert_raises($$insert into app.assistant_proposals (center_id, actor_user_id, command_key, input, input_hash, expires_at)
  values ('97000000-0000-4000-8000-0000000000c1', '97000000-0000-4000-8000-000000000a01', 'giving.note', '{}'::jsonb, repeat('0', 64), now() + interval '1 hour')$$,
  'permission denied', 'F · a signed-in person cannot insert a proposal directly');
select pg_temp.assert_raises($$update app.assistant_proposals set status = 'rejected'$$, 'permission denied', 'F · nor update one');
select pg_temp.assert_raises($$delete from app.assistant_proposals$$, 'permission denied', 'F · nor delete one');
select pg_temp.assert_raises($$insert into app.assistant_messages (center_id, actor_user_id, thread_id, role, content)
  values ('97000000-0000-4000-8000-0000000000c1', '97000000-0000-4000-8000-000000000a01', '97000000-0000-4000-8000-0000000007a1', 'user', 'hi')$$,
  'permission denied', 'F · nor a message');
select pg_temp.assert_raises($$update app.assistant_messages set content = 'x'$$, 'permission denied', 'F · nor change one');
select pg_temp.assert_raises($$delete from app.assistant_messages$$, 'permission denied', 'F · nor delete one');
reset role;

-- The open-request cap: 20 at a time (undone afterwards).
savepoint cap;
set role authenticated;
select pg_temp.claims(:ada);
do $$
declare n integer;
begin
  loop
    select count(*) into n from app.assistant_proposals
     where actor_user_id = '97000000-0000-4000-8000-000000000a01' and center_id = '97000000-0000-4000-8000-0000000000c1' and status = 'proposed';
    exit when n >= 20;
    perform app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'giving.note', '{"n":99}'::jsonb, '{}'::jsonb);
  end loop;
end $$;
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'giving.note', '{"n":100}'::jsonb, '{}'::jsonb)$$,
  'already have 20', 'F · twenty open requests is the limit');
select pg_temp.assert((select count(*) = 1 from (select app.assistant_propose('97000000-0000-4000-8000-0000000000c2', 'giving.note', '{"n":101}'::jsonb, '{}'::jsonb)) x),
  'F · the limit is per community: the same person can still prepare one in another');
reset role;
rollback to savepoint cap;

-- ══ G. Who sees what ═════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) > 0 from app.assistant_proposals where actor_user_id = :ada::uuid and center_id = :c1::uuid)
                      and (select count(*) > 0 from app.assistant_proposals where actor_user_id = :ada::uuid and center_id = :c2::uuid)
                      and (select count(*) = 1 from app.assistant_proposals where actor_user_id = :bo::uuid)
                      and (select count(*) = 1 from app.assistant_proposals where actor_user_id = :cy::uuid)
                      and (select count(*) = 1 from app.assistant_proposals where actor_user_id = :ex::uuid),
  'G · set-up: ada has requests in both communities, bo, cy and ex one each');
select count(*) as n_ada from app.assistant_proposals where actor_user_id = :ada::uuid \gset
set role authenticated;
select pg_temp.claims(:ada);
select pg_temp.assert((select count(*) = :n_ada::int and bool_and(actor_user_id = :ada::uuid) from app.assistant_proposals),
  'G · ada sees all of her own requests, in both communities, and nobody else''s');
select pg_temp.assert((select count(*) = 1 and bool_and(id = :'pc2'::uuid) from app.assistant_proposals where center_id = :c2::uuid),
  'G · in the community she shares with cy she sees only hers');
select pg_temp.claims(:bo);
select pg_temp.assert((select count(*) = 1 and bool_and(id = :'pb1'::uuid) from app.assistant_proposals), 'G · bo sees only his own request');
select pg_temp.claims(:cy);
select pg_temp.assert((select count(*) = 1 and bool_and(id = :'pcy1'::uuid) from app.assistant_proposals), 'G · cy sees only his own request');
select pg_temp.claims(:mem);
select pg_temp.assert((select count(*) = 0 from app.assistant_proposals), 'G · an ordinary member sees none');
select pg_temp.claims(:plat);
select pg_temp.assert((select count(*) = 0 from app.assistant_proposals), 'G · a platform admin sees none (support access is a role in the community)');
select pg_temp.claims(:nobody);
select pg_temp.assert((select count(*) = 0 from app.assistant_proposals), 'G · a signed-in person linked to nothing sees none');
select pg_temp.no_claims();
select pg_temp.assert((select count(*) = 0 from app.assistant_proposals), 'G · nobody signed in sees none');
reset role;

-- A person whose role ended loses the request they prepared, and cannot confirm it.
select pg_temp.assert((select count(*) = 1 from app.assistant_proposals where actor_user_id = :ex::uuid), 'G · ex prepared a request while staff');
select (:'rex'::jsonb)->>'input_hash' as hex \gset
update app.role_grants set status = 'revoked' where center_id = :c1 and user_id = :ex;
set role authenticated;
select pg_temp.claims(:ex);
select pg_temp.assert((select count(*) = 0 from app.assistant_proposals), 'G · once the role is revoked the person sees nothing');
select app.assistant_confirm(:'pex'::uuid, :'hex') as d15 \gset
select pg_temp.assert((:'d15'::jsonb)->>'ok' = 'false' and (:'d15'::jsonb)->>'reason' like '%have access to this area%',
  'G · and cannot confirm it');
select pg_temp.assert_raises($$select app.assistant_propose('97000000-0000-4000-8000-0000000000c1', 'giving.note', '{}'::jsonb, '{}'::jsonb)$$,
  'have access to this area', 'G · nor prepare another');
reset role;
select pg_temp.assert((select status = 'proposed' from app.assistant_proposals where id = :'pex'::uuid), 'G · the refused confirm changed nothing');

-- ══ H. Conversation text ═════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:ada);
select app.assistant_log_message(:c1, :t1, 'user', '  Who is behind on pledges? SECRET-TEXT-97 ') as m1 \gset
select app.assistant_log_message(:c1, :t1, 'assistant', 'Three households. Shall I draft a reminder?') as m2 \gset
select app.assistant_log_message(:c1, :t1, 'tool', 'pledges.behind: 3 rows', 'pledges.behind') as m3 \gset
select pg_temp.assert(:'m1' ~ '^[0-9a-f-]{36}$', 'H · logging a line returns its id');
select pg_temp.assert((select string_agg(role, ',' order by created_at, id) = 'user,assistant,tool'
                              and bool_and(actor_user_id = :ada::uuid and center_id = :c1::uuid and thread_id = :t1::uuid)
                         from app.assistant_messages where thread_id = :t1::uuid),
  'H · the lines come back in the order they were written, for ada in her community');
select pg_temp.assert((select content = 'Who is behind on pledges? SECRET-TEXT-97' from app.assistant_messages where id = :'m1'::uuid)
                      and (select command_key = 'pledges.behind' from app.assistant_messages where id = :'m3'::uuid),
  'H · the text is trimmed and a command key is kept');
select pg_temp.assert_raises($$select app.assistant_log_message('97000000-0000-4000-8000-0000000000c1', '97000000-0000-4000-8000-0000000007a1', 'robot', 'hi')$$,
  'from you, from Niva or from a tool', 'H · the line must be from you, Niva or a tool');
select pg_temp.assert_raises($$select app.assistant_log_message('97000000-0000-4000-8000-0000000000c1', '97000000-0000-4000-8000-0000000007a1', 'user', '   ')$$,
  'nothing to add', 'H · an empty line is refused');
select pg_temp.assert_raises($$select app.assistant_log_message('97000000-0000-4000-8000-0000000000c1', null, 'user', 'hi')$$,
  'no conversation', 'H · a line needs a conversation');
select pg_temp.assert_raises($$select app.assistant_log_message('97000000-0000-4000-8000-0000000000c1', '97000000-0000-4000-8000-0000000007a1', 'tool', 'hi', 'Not A Key')$$,
  'name of the action is not valid', 'H · a command key must be a plain key');
select pg_temp.assert_raises($$select app.assistant_log_message('97000000-0000-4000-8000-0000000000c2', '97000000-0000-4000-8000-0000000007a1', 'user', 'hi')$$,
  'belongs to someone else', 'H · a conversation cannot move to another community');
select pg_temp.claims(:bo);
select pg_temp.assert_raises($$select app.assistant_log_message('97000000-0000-4000-8000-0000000000c1', '97000000-0000-4000-8000-0000000007a1', 'user', 'hi')$$,
  'belongs to someone else', 'H · nor can another person write into it');
select app.assistant_log_message(:c1, :t2, 'user', 'bo asks something') as m4 \gset
select pg_temp.claims(:mem);
select pg_temp.assert_raises($$select app.assistant_log_message('97000000-0000-4000-8000-0000000000c1', '97000000-0000-4000-8000-0000000007a2', 'user', 'hi')$$,
  'have access to this area', 'H · an ordinary member cannot use the assistant');
select pg_temp.claims(:plat);
select pg_temp.assert_raises($$select app.assistant_log_message('97000000-0000-4000-8000-0000000000c1', '97000000-0000-4000-8000-0000000007a2', 'user', 'hi')$$,
  'have access to this area', 'H · nor a platform admin with no role there');
select pg_temp.claims(:ada);
-- 9,000 characters is cut to fit 8,000 and says so.
select app.assistant_log_message(:c1, :t1, 'tool', repeat('long ', 1800)) as m5 \gset
reset role;
select pg_temp.assert((select char_length(content) <= 8000 and content like '%(shortened)' and char_length(content) > 7900
                         from app.assistant_messages where id = :'m5'::uuid),
  'H · a very long line is shortened to fit 8,000 characters and says so');

-- A conversation holds at most 500 lines.
insert into app.assistant_messages (center_id, actor_user_id, thread_id, role, content)
  select :c1::uuid, :ada::uuid, :tcap::uuid, 'user', 'line ' || g from generate_series(1, 500) g;
set role authenticated;
select pg_temp.claims(:ada);
select pg_temp.assert_raises($$select app.assistant_log_message('97000000-0000-4000-8000-0000000000c1', '97000000-0000-4000-8000-0000000007a3', 'user', 'one more')$$,
  'getting long', 'H · the 501st line of a conversation is refused');
reset role;

-- Who sees the text: only its own person, and only while staff.
select count(*) as n_msg_ada from app.assistant_messages where actor_user_id = :ada::uuid \gset
select pg_temp.assert(:n_msg_ada::int >= 504 and (select count(*) = 1 from app.assistant_messages where actor_user_id = :bo::uuid),
  'H · set-up: ada has her lines, bo one of his');
set role authenticated;
select pg_temp.claims(:ada);
select pg_temp.assert((select count(*) = :n_msg_ada::int and bool_and(actor_user_id = :ada::uuid) from app.assistant_messages),
  'H · ada sees all of her own lines and none of bo''s');
select pg_temp.claims(:bo);
select pg_temp.assert((select count(*) = 1 and bool_and(id = :'m4'::uuid) from app.assistant_messages), 'H · bo sees only his own line');
select pg_temp.claims(:cy);
select pg_temp.assert((select count(*) = 0 from app.assistant_messages), 'H · staff of another community see none');
select pg_temp.claims(:mem);
select pg_temp.assert((select count(*) = 0 from app.assistant_messages), 'H · an ordinary member sees none');
select pg_temp.claims(:plat);
select pg_temp.assert((select count(*) = 0 from app.assistant_messages), 'H · a platform admin sees none');
select pg_temp.claims(:ex);
select pg_temp.assert((select count(*) = 0 from app.assistant_messages), 'H · a person whose role ended sees none');
select pg_temp.no_claims();
select pg_temp.assert((select count(*) = 0 from app.assistant_messages), 'H · nobody signed in sees none');
reset role;

-- ══ I. The audit log ═════════════════════════════════════════════════════════
select pg_temp.assert((select a.after->>'input' = '***' and a.after->>'preview' = '***' and a.after->>'command_key' = 'giving.record_payment'
                              and a.after->>'status' = 'proposed' and a.after->>'input_hash' = :'h1x'
                              and a.client_app = 'assistant' and a.actor_user_id = :ada::uuid and a.center_id = :c1::uuid
                              and a.reason like 'Niva prepared giving.record_payment%'
                         from app.audit_log a
                        where a.record_table = 'assistant_proposals' and a.record_id = :'p1' and a.action = 'assistant_proposals.insert'),
  'I · the proposal is audited as by the assistant for ada, with its input and preview masked');
select pg_temp.assert((select count(*) = 3 from app.audit_log where record_table = 'assistant_proposals' and record_id = :'p1'),
  'I · it is audited when prepared, confirmed and finished');
select pg_temp.assert((select a.correlation_id = :'corr1'::uuid and a.client_app = 'assistant' and a.after->>'status' = 'executed'
                              and a.after->>'input' = '***' and a.before->>'input' = '***'
                              and a.after->>'result_summary' = 'Recorded a payment of 50.00 dollars.'
                              and a.reason like 'Niva: giving.record_payment was carried out%'
                         from app.audit_log a
                        where a.record_table = 'assistant_proposals' and a.record_id = :'p1' and a.action = 'assistant_proposals.update'
                        order by a.id desc limit 1),
  'I · finishing is audited with the correlation id of the command that ran, and the summary stays readable');
select pg_temp.assert(not exists (select 1 from app.audit_log
                                   where record_table in ('assistant_proposals', 'assistant_messages')
                                     and (coalesce(before::text, '') || coalesce(after::text, '')) like '%SECRET-%'),
  'I · none of the input, preview or message text reached the audit log');
select pg_temp.assert(not exists (select 1 from app.audit_log where record_table = 'assistant_messages' and action = 'assistant_messages.insert'),
  'I · writing a line of conversation is not audited (hundreds of rows were written above)');
update app.assistant_messages set content = content || ' (edited)' where id = :'m1'::uuid;
select pg_temp.assert((select a.before->>'content' ~ '^\*\*\* \([0-9]+ characters\)$' and a.after->>'content' ~ '^\*\*\* \([0-9]+ characters\)$'
                              and a.after->>'role' = 'user'
                         from app.audit_log a where a.record_table = 'assistant_messages' and a.action = 'assistant_messages.update'),
  'I · a change to a line, if one ever happens, is audited with the text masked');

-- The mask itself, so losing the clauses to a later redefinition fails loudly.
select pg_temp.assert(app.audit_mask('{"command_key":"a.b","input_hash":"x","input":{"k":1},"preview":{"k":2},"status":"proposed"}'::jsonb)
                      = '{"command_key":"a.b","input_hash":"x","input":"***","preview":"***","status":"proposed"}'::jsonb,
  'I · audit_mask hides a proposal''s input and preview and keeps the rest');
select pg_temp.assert(app.audit_mask('{"thread_id":"t","role":"user","content":"hello"}'::jsonb)
                      = '{"thread_id":"t","role":"user","content":"*** (5 characters)"}'::jsonb,
  'I · audit_mask hides a message''s text and says how long it was');
select pg_temp.assert(app.audit_mask('{"input":{"k":1},"content":"hello","role":"x"}'::jsonb) = '{"input":{"k":1},"content":"hello","role":"x"}'::jsonb,
  'I · a row of another table with an input or content column is not touched');
select pg_temp.assert(app.audit_mask('{"date_of_birth":"2000-01-01","token":"t","path_key":"k","assistance_note":"abc","text_answer":"ab","niva_tsv":"x","staged_rows":[1]}'::jsonb)
                      = '{"date_of_birth":"***","token":"***","path_key":"***","assistance_note":"*** (3 characters)","text_answer":"*** (2 characters)","staged_rows":"***"}'::jsonb,
  'I · audit_mask still hides everything earlier migrations asked it to (0102 to 0594)');

select pg_temp.assert((select count(*) = 3 from pg_trigger t
                        where not t.tgisinternal and t.tgfoid = 'app.audit_row'::regproc
                          and t.tgname in ('audit_assistant_proposals', 'audit_assistant_messages', 'audit_assistant_usage')),
  'I · all three tables have their audit_<table> trigger on app.audit_row (test 13 requires it)');
select pg_temp.assert((select count(*) = 3 and bool_and(module_key is null) from app.module_tables
                        where table_name in ('assistant_proposals', 'assistant_messages', 'assistant_usage')),
  'I · all three are core platform tables in module_tables');

-- ══ J. Who may call what ═════════════════════════════════════════════════════
select pg_temp.assert((select bool_and(c.relrowsecurity) from pg_class c
                        where c.oid in ('app.assistant_proposals'::regclass, 'app.assistant_messages'::regclass, 'app.assistant_usage'::regclass)),
  'J · row level security is on for all three tables');
select pg_temp.assert(has_table_privilege('authenticated', 'app.assistant_proposals', 'select')
                      and not has_table_privilege('authenticated', 'app.assistant_proposals', 'insert')
                      and not has_table_privilege('authenticated', 'app.assistant_proposals', 'update')
                      and not has_table_privilege('authenticated', 'app.assistant_proposals', 'delete')
                      and has_table_privilege('authenticated', 'app.assistant_messages', 'select')
                      and not has_table_privilege('authenticated', 'app.assistant_messages', 'insert')
                      and not has_table_privilege('authenticated', 'app.assistant_messages', 'update')
                      and not has_table_privilege('authenticated', 'app.assistant_messages', 'delete')
                      and has_table_privilege('authenticated', 'app.assistant_usage', 'select')
                      and not has_table_privilege('authenticated', 'app.assistant_usage', 'insert')
                      and not has_table_privilege('authenticated', 'app.assistant_usage', 'update')
                      and not has_table_privilege('authenticated', 'app.assistant_usage', 'delete')
                      and not has_table_privilege('anon', 'app.assistant_proposals', 'select')
                      and not has_table_privilege('anon', 'app.assistant_messages', 'select')
                      and not has_table_privilege('anon', 'app.assistant_usage', 'select'),
  'J · a signed-in person can only read the three tables; a guest cannot even do that');
select pg_temp.assert((select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'))
                         from unnest(array['app.assistant_propose(uuid,text,jsonb,jsonb,uuid)', 'app.assistant_confirm(uuid,text)',
                                           'app.assistant_finish(uuid,boolean,text,uuid)', 'app.assistant_reject(uuid)',
                                           'app.assistant_usage_check(uuid,integer)', 'app.assistant_usage_status(uuid)',
                                           'app.assistant_log_message(uuid,uuid,text,text,text)', 'app.assistant_is_staff(uuid)']) f),
  'J · the seven assistant functions (and the staff check the policies use) are for signed-in people only');
select pg_temp.assert((select bool_and(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'))
                         from unnest(array['app._assistant_actor(uuid)', 'app._assistant_thread_ok(uuid,uuid,uuid)', 'app._assistant_month()',
                                           'app._assistant_limit(uuid)', 'app.assistant_proposals_guard()']) f),
  'J · the helpers cannot be called from outside');
rollback;
