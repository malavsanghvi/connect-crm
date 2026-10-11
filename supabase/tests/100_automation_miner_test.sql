-- 0622 + 0623 (backlog B91): the miner that turns repeated sequences into automation ideas, who sees them, and retention.
--   A. The tables, grants and functions   B. Mining: a planted A>B>C repeated 6 times by 3 people across sessions is found, noise
--   and near misses are not   C. Idempotent re-runs, and decisions survive them   D. Who sees and changes the ideas
--   E. The worker's daily run skips communities with recording off   F. The cross-community backlog (keys and counts)
--   G. The administrators' usage totals   H. Retention (400 days)   I. The audit log
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', label, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '', true);
  set local role authenticated;
end $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- A pseudonym (64 hex characters) for a test actor.
create or replace function pg_temp.h(t text) returns text language sql immutable as $$ select md5(t) || md5(t || '!') $$;
-- One run of steps by one actor: key i at start + (i-1) * step; step number p_err (if any) fails; the last step took p_dur_last ms.
create or replace function pg_temp.seq(p_center uuid, p_actor text, p_roles text[], p_keys text[], p_start timestamptz,
                                       p_step interval default interval '20 seconds', p_err integer default 0,
                                       p_dur_last integer default null, p_surface text default 'portal') returns void language plpgsql as $$
declare i integer;
begin
  for i in 1 .. array_length(p_keys, 1) loop
    insert into app.activity_events (center_id, occurred_at, surface, actor_hash, role_keys, key, kind, outcome, duration_ms, via)
    values (p_center, p_start + (i - 1) * p_step, p_surface, pg_temp.h(p_actor), p_roles, p_keys[i], 'action',
            case when i = p_err then 'error' else 'ok' end,
            case when i = array_length(p_keys, 1) then p_dur_last end,
            case when p_surface = 'member' then 'app' else 'screen' end);
  end loop;
end $$;
-- A day offset from now.
create or replace function pg_temp.ago(d integer) returns timestamptz language sql stable as $$ select now() - make_interval(days => d) $$;

\set m100 '''10000000-0000-4000-8000-0000000000a1'''
\set n100 '''10000000-0000-4000-8000-0000000000b1'''
\set o100 '''10000000-0000-4000-8000-0000000000c1'''
\set adm100 '''10000000-0000-4000-8000-000000000001'''
\set lead100 '''10000000-0000-4000-8000-000000000002'''
\set admn100 '''10000000-0000-4000-8000-000000000003'''
\set plat100 '''10000000-0000-4000-8000-000000000004'''

select pg_temp.as_none();
grant connect_worker to postgres;   -- the tests switch to connect_worker; a hosted postgres holds ADMIN on it but not SET
insert into auth.users (id, email) values
  (:adm100, 'adm100@mine.test'), (:lead100, 'lead100@mine.test'), (:admn100, 'admn100@mine.test'), (:plat100, 'plat100@mine.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat100, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
-- M and O record; N has recording off (nothing set).
insert into app.centers (id, slug, name, short_name, state_region, status, rules) values
  (:m100, 'mine100m', 'Mine 100 M', 'M100', 'TX', 'active', '{"activity": {"enabled": true}}'::jsonb),
  (:n100, 'mine100n', 'Mine 100 N', 'N100', 'CA', 'active', '{}'::jsonb),
  (:o100, 'mine100o', 'Mine 100 O', 'O100', 'NY', 'active', '{"activity": {"enabled": true}}'::jsonb);
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:m100, :adm100, 'center_admin', 'center', 'test 100'), (:m100, :lead100, 'event_lead', 'center', 'test 100'),
  (:n100, :admn100, 'center_admin', 'center', 'test 100');
-- Two steps of the content pair already have commands in the command layer.
select app.activity_register('content.save_item', 'action', 'portal', 'Save a content item', 'content_item', 'content.save_item');
select app.activity_register('content.decide_content', 'action', 'portal', 'Decide on a piece of content', 'content_item', 'content.decide_content');

-- ── The planted history of community M ──────────────────────────────────────
-- 1. A>B>C (record a pledge, record the payment, send the receipt) by event leads x, y, z: 6 runs on 6 different days, 6
--    sessions, with a screen in the middle of each run (screens do not break a run); in one run B fails.
select pg_temp.seq(:m100, v.a, array['event_lead'], array['giving.record_pledge', 'giving.record_payment', 'comms.send'],
                   pg_temp.ago(v.d), interval '20 seconds', case when v.a = 'x' and v.d = 17 then 2 else 0 end, 2000)
  from (values ('x', 10), ('x', 17), ('y', 11), ('y', 18), ('z', 12), ('z', 19)) v(a, d);
insert into app.activity_events (center_id, occurred_at, surface, actor_hash, role_keys, key, kind, outcome, via)
select :m100, pg_temp.ago(v.d) + interval '10 seconds', 'portal', pg_temp.h(v.a), array['event_lead'], 'screen:/giving/pledges', 'screen', 'ok', 'screen'
  from (values ('x', 10), ('x', 17), ('y', 11), ('y', 18), ('z', 12), ('z', 19)) v(a, d);
-- 2. Noise: the same three steps but 40 minutes apart (separate sessions, never a run), six days; and 40 single events,
--    45 minutes apart, of 8 different keys.
select pg_temp.seq(:m100, 'q', array['event_lead'], array['giving.record_pledge', 'giving.record_payment', 'comms.send'],
                   pg_temp.ago(d) + interval '1 hour', interval '40 minutes')
  from generate_series(1, 6) d;
insert into app.activity_events (center_id, occurred_at, surface, actor_hash, role_keys, key, kind, outcome, via)
select :m100, pg_temp.ago(3) + (i * interval '45 minutes'), 'portal', pg_temp.h('n1'), array['event_lead'],
       (array['people.merge_people', 'people.merge_households', 'events.save', 'events.set_status', 'bolis.import_upload',
              'store.record_movement', 'pathshala.mark_attendance', 'accounting.lock_month'])[1 + i % 8], 'action', 'ok', 'screen'
  from generate_series(1, 40) i;
-- 3. A pair done 6 times, but all in ONE session (alternating, 5 seconds apart).
select pg_temp.seq(:m100, 'r', array['event_lead'], array['store.save_item', 'store.move_order', 'store.save_item', 'store.move_order', 'store.save_item', 'store.move_order',
                                                       'store.save_item', 'store.move_order', 'store.save_item', 'store.move_order', 'store.save_item', 'store.move_order'],
                   pg_temp.ago(4), interval '5 seconds');
-- 4. One action four times in a row, on three days: not a sequence.
select pg_temp.seq(:m100, 'r2', array['event_lead'], array['people.add_person', 'people.add_person', 'people.add_person', 'people.add_person'], pg_temp.ago(d), interval '5 seconds')
  from generate_series(1, 3) d;
-- 5. A second role: center admins do bolis.save then bolis.close five times (3 + 2 runs, 5 days). Event leads do it only 4 times.
select pg_temp.seq(:m100, v.a, array['center_admin'], array['bolis.save', 'bolis.close'], pg_temp.ago(v.d))
  from (values ('w1', 3), ('w1', 4), ('w1', 5), ('w2', 6), ('w2', 7)) v(a, d);
select pg_temp.seq(:m100, v.a, array['event_lead'], array['bolis.save', 'bolis.close'], pg_temp.ago(v.d))
  from (values ('e1', 3), ('e1', 4), ('e2', 6), ('e2', 7)) v(a, d);
-- 6. One person with two roles adds a person and then edits them, five times: it counts for each of the two roles ("default").
select pg_temp.seq(:m100, 'v', array['event_lead', 'treasurer'], array['people.add_person', 'people.update_person'], pg_temp.ago(d))
  from unnest(array[2, 3, 4, 5, 8]) d;
-- 7. A very regular pair: every day for nine days ("scheduled_job").
select pg_temp.seq(:m100, 't', array['finance_volunteer'], array['giving.import_bank_lines', 'giving.confirm_bank_match'], pg_temp.ago(d))
  from generate_series(1, 9) d;
-- 8. A pair whose two steps both have commands ("niva_command"), five irregular days.
select pg_temp.seq(:m100, 'c', array['content_editor'], array['content.save_item', 'content.decide_content'], pg_temp.ago(d))
  from unnest(array[1, 3, 6, 10, 15]) d;
-- 9. The member app: RSVP started, then completed, five times (no roles; the member surface).
select pg_temp.seq(:m100, v.a, '{}'::text[], array['rsvp_started', 'rsvp_completed'], pg_temp.ago(v.d), interval '30 seconds', 0, null, 'member')
  from (values ('m1', 2), ('m1', 4), ('m2', 3), ('m2', 5), ('m3', 6)) v(a, d);
-- 10. A cancelled step in the middle of a run breaks nothing and counts for nothing: lone cancelled events.
insert into app.activity_events (center_id, occurred_at, surface, actor_hash, role_keys, key, kind, outcome, via)
select :m100, pg_temp.ago(2), 'portal', pg_temp.h('cx'), array['event_lead'], 'events.save', 'action', 'cancelled', 'screen' from generate_series(1, 10);
-- Community N (recording off) has the same A>B>C history; O (on) has too little.
select pg_temp.seq(:n100, v.a, array['event_lead'], array['giving.record_pledge', 'giving.record_payment', 'comms.send'], pg_temp.ago(v.d))
  from (values ('x', 10), ('x', 17), ('y', 11), ('y', 18), ('z', 12), ('z', 19)) v(a, d);

-- ══ A. The tables, grants and functions ══════════════════════════════════════
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'app.automation_candidates'::regclass)
                      and (select module_key is null from app.module_tables where table_name = 'automation_candidates')
                      and exists (select 1 from pg_trigger where tgrelid = 'app.automation_candidates'::regclass and tgname = 'audit_automation_candidates'
                                    and tgfoid = 'app.audit_row'::regproc and not tgisinternal),
  'A · automation_candidates has row level security, is a core platform table and is audited');
select pg_temp.assert(has_table_privilege('authenticated', 'app.automation_candidates', 'select')
                      and not has_table_privilege('authenticated', 'app.automation_candidates', 'insert')
                      and not has_table_privilege('authenticated', 'app.automation_candidates', 'delete')
                      and has_column_privilege('authenticated', 'app.automation_candidates', 'status', 'update')
                      and has_column_privilege('authenticated', 'app.automation_candidates', 'decided_by', 'update')
                      and has_column_privilege('authenticated', 'app.automation_candidates', 'decided_at', 'update')
                      and not has_column_privilege('authenticated', 'app.automation_candidates', 'support', 'update')
                      and not has_column_privilege('authenticated', 'app.automation_candidates', 'pattern', 'update')
                      and not has_table_privilege('anon', 'app.automation_candidates', 'select')
                      and not has_table_privilege('service_role', 'app.automation_candidates', 'insert')
                      and not has_table_privilege('connect_worker', 'app.automation_candidates', 'select'),
  'A · people can read ideas and change only status, decided_by and decided_at; nobody else writes them over the API');
select pg_temp.assert(has_function_privilege('connect_worker', 'app.worker_mine_activity()', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_mine_activity()', 'execute')
                      and not has_function_privilege('anon', 'app.worker_mine_activity()', 'execute')
                      and has_function_privilege('connect_worker', 'app.activity_mine(uuid, integer)', 'execute')
                      and has_function_privilege('authenticated', 'app.activity_mine(uuid, integer)', 'execute')
                      and not has_function_privilege('anon', 'app.activity_mine(uuid, integer)', 'execute')
                      and has_function_privilege('connect_worker', 'app.activity_purge(integer)', 'execute')
                      and not has_function_privilege('authenticated', 'app.activity_purge(integer)', 'execute')
                      and has_function_privilege('authenticated', 'app.activity_usage(uuid, integer)', 'execute')
                      and not has_function_privilege('anon', 'app.activity_usage(uuid, integer)', 'execute')
                      and has_table_privilege('authenticated', 'app.automation_backlog', 'select')
                      and not has_table_privilege('anon', 'app.automation_backlog', 'select'),
  'A · the worker runs the daily jobs; a signed-in person may ask for the miner (it checks they are a platform admin) and the usage totals');
select pg_temp.assert((select count(*) = 5 and bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                         from pg_proc p where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('activity_mine', 'worker_mine_activity', 'activity_purge', 'activity_usage', 'automation_candidates_decide')),
  'A · the five functions are security definer with the pinned search path');

-- ══ B. Mining ════════════════════════════════════════════════════════════════
select pg_temp.as_user(:lead100);
select pg_temp.assert_raises($q$select app.activity_mine('10000000-0000-4000-8000-0000000000a1')$q$, 'background service',
  'B · an event lead cannot run the miner');
select pg_temp.as_user(:adm100);
select pg_temp.assert_raises($q$select app.activity_mine('10000000-0000-4000-8000-0000000000a1')$q$, 'background service',
  'B · nor can the community''s own administrator');
select pg_temp.as_none();
select pg_temp.assert_raises($q$select app.activity_mine('10000000-0000-4000-8000-0000000000a1')$q$, 'background service',
  'B · nor a session with no worker role and no platform admin');
select pg_temp.assert((select count(*) = 0 from app.automation_candidates), 'B · before the miner runs there are no ideas');

select pg_temp.as_user(:plat100);
select app.activity_mine(:m100) as n_mined \gset
select pg_temp.as_none();
select pg_temp.assert(:n_mined = 7, 'B · the miner writes 7 ideas for community M');
select pg_temp.assert((select count(*) = 7 from app.automation_candidates where center_id = :m100)
                      and (select count(*) = 0 from app.automation_candidates where center_id <> :m100),
  'B · exactly those 7, none for any other community');

select pg_temp.assert((select c.support = 6 and c.distinct_actors = 3 and c.sessions = 6 and c.median_seconds = 42
                              and c.error_rate = 0.1667 and c.suggested_kind = 'playbook' and c.status = 'new' and c.decided_by is null and c.decided_at is null
                              and c.first_seen = pg_temp.ago(19) and c.last_seen = pg_temp.ago(10)
                         from app.automation_candidates c
                        where c.center_id = :m100 and c.role_key = 'event_lead'
                          and c.pattern = array['giving.record_pledge', 'giving.record_payment', 'comms.send']),
  'B · A>B>C: 6 times by 3 people in 6 sessions, a run takes 42 seconds (40 plus the last step''s 2), one run in six failed, three people so a playbook; a screen in the middle of a run does not break it');
select pg_temp.assert((select c.minutes_per_month between 6.0 and 7.5 and c.regularity between 0.52 and 0.54 and c.score between 2.0 and 3.0
                         from app.automation_candidates c
                        where c.center_id = :m100 and c.role_key = 'event_lead' and c.pattern[1] = 'giving.record_pledge'),
  'B · about 6.6 minutes a month, regularity about 0.53 (gaps of 1, 1, 5, 1, 1 days), score about 2.4 = minutes x (regularity - error rate)');
select pg_temp.assert((select count(*) = 2 from app.automation_candidates where center_id = :m100 and role_key = 'event_lead')
                      and not exists (select 1 from app.automation_candidates where center_id = :m100
                                         and pattern in (array['giving.record_pledge', 'giving.record_payment'], array['giving.record_payment', 'comms.send'])),
  'B · A>B and B>C, which only ever happen inside A>B>C, are not reported separately; the event lead''s other idea is the add-then-edit pair');
select pg_temp.assert(not exists (select 1 from app.automation_candidates where center_id = :m100
                                     and (pattern && array['people.merge_people', 'people.merge_households', 'store.save_item', 'store.move_order', 'events.save']
                                          or pattern = array['people.add_person', 'people.add_person'])),
  'B · noise finds nothing: steps 40 or 45 minutes apart, one pair repeated inside a single session, one action repeated, cancelled steps');
select pg_temp.assert((select c.support = 5 and c.distinct_actors = 2 and c.sessions = 5 and c.suggested_kind = 'routine' and c.median_seconds = 20
                         from app.automation_candidates c
                        where c.center_id = :m100 and c.role_key = 'center_admin' and c.pattern = array['bolis.save', 'bolis.close'])
                      and not exists (select 1 from app.automation_candidates where center_id = :m100 and role_key = 'event_lead' and pattern = array['bolis.save', 'bolis.close']),
  'B · per role: five runs by center admins is an idea (two people, a routine step, 20 seconds a run: the 20-second gap, and a floor of 10 seconds a step); four runs by event leads is not');
select pg_temp.assert((select count(*) = 2 and bool_and(c.suggested_kind = 'default') and bool_and(c.support = 5)
                         from app.automation_candidates c
                        where c.center_id = :m100 and c.pattern = array['people.add_person', 'people.update_person']
                          and c.role_key in ('event_lead', 'treasurer')),
  'B · one person holding two roles counts for each; add-then-edit suggests a default value');
select pg_temp.assert((select c.suggested_kind = 'scheduled_job' and c.support = 9 and c.regularity = 1 and c.distinct_actors = 1
                         from app.automation_candidates c where c.center_id = :m100 and c.role_key = 'finance_volunteer'),
  'B · a pair done every day for nine days is regular enough to be a scheduled job');
select pg_temp.assert((select c.suggested_kind = 'niva_command' from app.automation_candidates c
                        where c.center_id = :m100 and c.role_key = 'content_editor'),
  'B · a pair whose every step has a command is suggested as a Niva command');
select pg_temp.assert((select c.support = 5 and c.sessions = 5 and c.distinct_actors = 3 and c.suggested_kind = 'playbook'
                         from app.automation_candidates c
                        where c.center_id = :m100 and c.role_key = 'member' and c.pattern = array['rsvp_started', 'rsvp_completed']),
  'B · member-app events are mined under the role "member"');
select pg_temp.assert(not exists (select 1 from app.automation_candidates c
                                   where to_jsonb(c)::text ~ (pg_temp.h('x') || '|' || pg_temp.h('y') || '|' || pg_temp.h('z') || '|' || pg_temp.h('w1') || '|' || pg_temp.h('v') || '|' || pg_temp.h('m1')))
                      and (select bool_and(attname not in ('actor_hash', 'user_id', 'person_id', 'session_id')) from pg_attribute
                            where attrelid = 'app.automation_candidates'::regclass and attnum > 0 and not attisdropped),
  'B · an idea holds no actor: no pseudonym appears in it and it has no column for one');
select pg_temp.assert((select count(*) = 0 from app.automation_candidates where center_id = :n100), 'B · and none for community N, which has the same history but recording off (nobody ran it for N)');

-- ══ C. Idempotent re-runs; decisions survive ═══════════════════════════════
select string_agg(id::text || ':' || support::text || ':' || first_seen::text, ',' order by id) as snap_before, count(*) as n_before from app.automation_candidates \gset
select pg_temp.as_user(:plat100);
select app.activity_mine(:m100) as n_mined2 \gset
select pg_temp.as_none();
select pg_temp.assert(:n_mined2 = 7 and (select count(*) = :n_before from app.automation_candidates)
                      and (select string_agg(id::text || ':' || support::text || ':' || first_seen::text, ',' order by id) = :'snap_before' from app.automation_candidates),
  'C · running it again changes nothing: the same 7 ideas, the same ids, counts and first-seen times');

-- A staff member with settings.manage accepts one idea; the database stamps who and when.
select pg_temp.as_user(:adm100);
update app.automation_candidates set status = 'accepted', decided_by = '10000000-0000-4000-8000-0000000000ff'
 where center_id = :m100 and role_key = 'content_editor';
update app.automation_candidates set status = 'dismissed' where center_id = :m100 and role_key = 'finance_volunteer';
select pg_temp.as_none();
select pg_temp.assert((select status = 'accepted' and decided_by = :adm100 and decided_at is not null from app.automation_candidates where center_id = :m100 and role_key = 'content_editor')
                      and (select status = 'dismissed' and decided_by = :adm100 from app.automation_candidates where center_id = :m100 and role_key = 'finance_volunteer'),
  'C · accepting or dismissing stamps the person who did it and the time, whatever decided_by says');
select pg_temp.as_user(:adm100);
update app.automation_candidates set decided_by = null, decided_at = null where center_id = :m100 and role_key = 'content_editor';
select pg_temp.as_none();
select pg_temp.assert((select decided_by = :adm100 and decided_at is not null from app.automation_candidates where center_id = :m100 and role_key = 'content_editor'),
  'C · the stamp cannot be cleared without changing the status');
-- More history arrives; the next run updates the counts and leaves the decisions alone.
select pg_temp.seq(:m100, 'x', array['event_lead'], array['giving.record_pledge', 'giving.record_payment', 'comms.send'], pg_temp.ago(5), interval '20 seconds', 0, 2000);
select pg_temp.seq(:m100, 'u', array['finance_volunteer'], array['giving.import_bank_lines', 'giving.confirm_bank_match'], pg_temp.ago(10));
select pg_temp.as_user(:plat100);
select app.activity_mine(:m100) as n_mined3 \gset
select pg_temp.as_none();
select pg_temp.assert((select c.support = 7 and c.sessions = 7 and c.last_seen = pg_temp.ago(5) and c.first_seen = pg_temp.ago(19)
                         from app.automation_candidates c where c.center_id = :m100 and c.role_key = 'event_lead' and c.pattern[1] = 'giving.record_pledge')
                      and (select c.support = 10 and c.status = 'dismissed' and c.decided_by = :adm100 from app.automation_candidates c where c.center_id = :m100 and c.role_key = 'finance_volunteer')
                      and (select c.status = 'accepted' and c.decided_by = :adm100 from app.automation_candidates c where c.center_id = :m100 and c.role_key = 'content_editor')
                      and (select count(*) = 7 from app.automation_candidates where center_id = :m100),
  'C · new history raises the counts (7 runs, 10 days), the first-seen time stays, and an accepted or dismissed idea keeps its decision');
select pg_temp.as_user(:adm100);
update app.automation_candidates set status = 'new' where center_id = :m100 and role_key = 'content_editor';
select pg_temp.as_none();
select pg_temp.assert((select status = 'new' and decided_by is null and decided_at is null from app.automation_candidates where center_id = :m100 and role_key = 'content_editor'),
  'C · putting an idea back to new clears the decision');

-- ══ D. Who sees and changes the ideas ═════════════════════════════════════
select pg_temp.as_user(:adm100);
select count(*) as seen_admin from app.automation_candidates \gset
select pg_temp.assert_raises($q$update app.automation_candidates set support = 1$q$, 'permission denied', 'D · the administrator cannot change the counts');
select pg_temp.assert_raises($q$delete from app.automation_candidates$q$, 'permission denied', 'D · nor delete an idea');
select pg_temp.as_user(:lead100);
select count(*) as seen_lead from app.automation_candidates \gset
with u as (update app.automation_candidates set status = 'dismissed' returning 1) select count(*) as lead_updates from u \gset
select pg_temp.as_user(:admn100);
select count(*) as seen_other_admin from app.automation_candidates \gset
with u as (update app.automation_candidates set status = 'dismissed' returning 1) select count(*) as other_updates from u \gset
select pg_temp.as_user(:plat100);
select count(*) as seen_plat from app.automation_candidates \gset
select pg_temp.as_none();
select pg_temp.assert(:seen_admin = 7 and :seen_lead = 0 and :seen_other_admin = 0 and :seen_plat = 7,
  'D · the community''s administrators see its 7 ideas; an event lead and another community''s administrator see none; a platform admin sees all');
select pg_temp.assert(:lead_updates = 0 and :other_updates = 0
                      and (select count(*) = 1 from app.automation_candidates where status = 'dismissed'),
  'D · and they cannot change them (no row matches for them)');
set role anon;
select pg_temp.assert_raises($q$select count(*) from app.automation_candidates$q$, 'permission denied', 'D · a guest reads nothing');
reset role;

-- ══ E. The daily job ══════════════════════════════════════════════════════
select count(*) as n_cand_before from app.automation_candidates \gset
set local role connect_worker;
select app.worker_mine_activity()::text as wres \gset
reset role;
select pg_temp.assert((:'wres'::jsonb ->> 'communities')::integer >= 2 and (:'wres'::jsonb ->> 'failed')::integer = 0
                      and (:'wres'::jsonb ->> 'candidates')::integer >= 7,
  'E · the worker''s run mines every community with recording on (M and O at least), none failed');
select pg_temp.assert((select count(*) = 0 from app.automation_candidates where center_id in (:n100, :o100))
                      and (select count(*) = 7 from app.automation_candidates where center_id = :m100),
  'E · community N (recording off) and community O (too little history) have no ideas; M still has its 7');
select pg_temp.as_none();
select pg_temp.assert_raises($q$select app.worker_mine_activity()$q$, 'background service', 'E · only the worker can run the daily job');
select pg_temp.as_user(:plat100);
select pg_temp.assert_raises($q$select app.worker_mine_activity()$q$, 'permission denied', 'E · not even a platform admin through the API');
select pg_temp.as_none();

-- ══ F. The cross-community backlog ═══════════════════════════════════════
-- Community O gets an idea with comms.send in it, and N one too (N has recording off, so it does not count).
insert into app.automation_candidates (center_id, role_key, pattern, pattern_hash, support, distinct_actors, sessions, median_seconds,
                                       minutes_per_month, error_rate, regularity, score, suggested_kind, first_seen, last_seen) values
  (:o100, 'treasurer', array['giving.record_payment', 'comms.send'], md5('o'), 12, 2, 6, 60, 12.0, 0, 0.5, 6, 'routine', now() - interval '10 days', now()),
  (:n100, 'treasurer', array['giving.record_payment', 'comms.send'], md5('n'), 12, 2, 6, 60, 12.0, 0, 0.5, 6, 'routine', now() - interval '10 days', now());
select pg_temp.as_user(:plat100);
select count(*) as bl_rows from app.automation_backlog \gset
select b.communities as bl_comms_send, b.ideas as bl_ideas_send from app.automation_backlog b where b.item_key = 'comms.send' \gset
select b.label as bl_label, b.surface as bl_surface from app.automation_backlog b where b.item_key = 'giving.record_payment' \gset
select pg_temp.as_none();
select pg_temp.assert(:bl_rows > 5 and :bl_comms_send = 2 and :bl_ideas_send = 2 and :'bl_label' = 'Record a payment' and :'bl_surface' = 'portal',
  'F · a platform admin sees, per key, the communities with recording on that have it in an idea (M and O, not N) and in how many ideas');
select pg_temp.as_user(:adm100);
select count(*) as bl_admin from app.automation_backlog \gset
select pg_temp.as_none();
select pg_temp.assert(:bl_admin = 0, 'F · a community''s own administrator sees nothing of it');
update app.automation_candidates set status = 'dismissed' where center_id = :o100;
select pg_temp.as_user(:plat100);
select b.communities as bl_comms_send2 from app.automation_backlog b where b.item_key = 'comms.send' \gset
select pg_temp.as_none();
select pg_temp.assert(:bl_comms_send2 = 1, 'F · a dismissed idea is left out');
select pg_temp.assert((select array_agg(attname::text order by attnum) = array['item_key', 'label', 'surface', 'communities', 'ideas', 'times', 'minutes_per_month', 'last_seen']
                         from pg_attribute where attrelid = 'app.automation_backlog'::regclass and attnum > 0 and not attisdropped),
  'F · the view has keys and counts only: no community, role, person or event');

-- ══ G. The administrators'' usage totals ═══════════════════════════════════
select pg_temp.as_user(:adm100);
select count(*) as use_rows, sum(events) as use_events, max(events) filter (where item_key = 'comms.send') as use_send,
       sum(people) filter (where item_key = 'comms.send') as use_send_people
  from app.activity_usage(:m100, 30) \gset
select pg_temp.as_user(:lead100);
select pg_temp.assert_raises($q$select * from app.activity_usage('10000000-0000-4000-8000-0000000000a1', 30)$q$, 'don''t have access to this area',
  'G · a person without settings.manage is told they have no access, not shown an empty table');
select pg_temp.as_user(:admn100);
select pg_temp.assert_raises($q$select * from app.activity_usage('10000000-0000-4000-8000-0000000000a1', 30)$q$, 'don''t have access to this area',
  'G · neither is another community''s administrator');
select pg_temp.as_none();
select pg_temp.assert(:use_rows > 10 and :use_events = (select count(*) from app.activity_events where center_id = :m100 and occurred_at >= now() - interval '30 days')
                      and :use_send = 13 and :use_send_people = 4,
  'G · the totals add up to the events of the last 30 days (comms.send: 13 events, 7 in the planted runs and 6 in the spread-out ones, by 4 people)');
select pg_temp.assert((select p.proargnames from pg_proc p where p.oid = 'app.activity_usage(uuid, integer)'::regprocedure)
                        = array['p_center', 'p_days', 'item_key', 'item_kind', 'surface', 'platform', 'app_version', 'events', 'people', 'errors', 'median_ms'],
  'G · the totals have a key, surface, platform, app version and counts: never a person, a role or an event');

-- ══ H. Retention ═════════════════════════════════════════════════════════
insert into app.activity_events (center_id, occurred_at, surface, actor_hash, key, kind, outcome, via)
select :m100, now() - interval '402 days' + (i * interval '1 minute'), 'portal', pg_temp.h('old'), 'screen:/', 'screen', 'ok', 'screen' from generate_series(1, 3) i;
insert into app.activity_events (center_id, occurred_at, surface, actor_hash, key, kind, outcome, via)
values (:m100, now() - interval '399 days', 'portal', pg_temp.h('edge'), 'screen:/', 'screen', 'ok', 'screen');
insert into app.automation_candidates (center_id, role_key, pattern, pattern_hash, support, first_seen, last_seen, status) values
  (:m100, 'old_new', array['a.b', 'c.d'], md5('old_new'), 5, now() - interval '500 days', now() - interval '401 days', 'new'),
  (:m100, 'old_acc', array['a.b', 'c.d'], md5('old_acc'), 5, now() - interval '500 days', now() - interval '401 days', 'accepted');
select count(*) as ev_before from app.activity_events \gset
select pg_temp.assert_raises($q$select app.activity_purge(10)$q$, 'background service', 'H · only the worker can purge');
set local role connect_worker;
select app.activity_purge(2) as purged1 \gset
select app.activity_purge(2) as purged2 \gset
select app.activity_purge(2) as purged3 \gset
reset role;
select pg_temp.assert(:purged1 = 2 and :purged2 = 1 and :purged3 = 0 and (select count(*) = :ev_before - 3 from app.activity_events)
                      and (select count(*) = 1 from app.activity_events where actor_hash = pg_temp.h('edge'))
                      and (select count(*) = 0 from app.activity_events where occurred_at < now() - interval '400 days'),
  'H · the purge removes events older than 400 days, a few at a time, and keeps the ones at 399 days and newer');
select pg_temp.assert((select count(*) = 0 from app.automation_candidates where role_key = 'old_new')
                      and (select count(*) = 1 from app.automation_candidates where role_key = 'old_acc'),
  'H · and ideas nobody acted on that have not been seen for 400 days, but not one that was accepted');

-- ══ I. The audit log ═════════════════════════════════════════════════════
select pg_temp.assert((select count(*) >= 7 from app.audit_log where record_table = 'automation_candidates' and action = 'automation_candidates.insert' and center_id = :m100)
                      and (select count(*) = 3 from app.audit_log where record_table = 'automation_candidates' and action = 'automation_candidates.update' and center_id = :m100),
  'I · ideas are audited when they are created and when they are decided (accepted, dismissed, put back to new: 3); the miner''s re-runs rewriting the counts are not');
select pg_temp.assert((select count(*) = 0 from app.audit_log where record_table in ('activity_events', 'activity_optouts', 'activity_salts')),
  'I · and the events still leave no audit rows');

rollback;
