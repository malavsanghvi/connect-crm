-- 0625 (backlog B91): the portal side of the automation pipeline. The allowlist gets the command layer's eight commands, the
-- two portal actions that had no key and the two new screens; the community's agreement and Weaver's switch stay as 0621 has them.
--   A. The registrations   B. Running the migration again changes nothing   C. The new keys are recorded (and a wrong surface
--   or an unknown key still is not)   D. A pattern made only of commands is proposed as a Niva command
--   E. What the portal does to answer an idea   F. The agreement and Weaver's switch (0625 must not weaken them)
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
-- Record a batch as a user and sign out again; returns what record_activity returned.
create or replace function pg_temp.act(p_user uuid, p_center uuid, p_events jsonb) returns integer language plpgsql as $$
declare n integer;
begin
  perform pg_temp.as_user(p_user);
  n := app.record_activity(p_center, p_events);
  perform pg_temp.as_none();
  return n;
end $$;
-- A pseudonym (64 hex characters) for a test actor.
create or replace function pg_temp.h(t text) returns text language sql immutable as $$ select md5(t) || md5(t || '!') $$;
create or replace function pg_temp.ago(d integer) returns timestamptz language sql stable as $$ select now() - make_interval(days => d) $$;

\set a102 '''10200000-0000-4000-8000-0000000000a1'''
\set b102 '''10200000-0000-4000-8000-0000000000b1'''
\set staff102 '''10200000-0000-4000-8000-000000000001'''
\set adm102 '''10200000-0000-4000-8000-000000000002'''
\set plat102 '''10200000-0000-4000-8000-000000000003'''
\set member102 '''10200000-0000-4000-8000-000000000004'''
\set e102 '10200000-0000-4000-8000-0000000000e1'
\set f102 '10200000-0000-4000-8000-0000000000e2'

select pg_temp.as_none();
insert into auth.users (id, email) values
  (:staff102, 'staff102@ideas.test'), (:adm102, 'adm102@ideas.test'), (:plat102, 'plat102@ideas.test'), (:member102, 'member102@ideas.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat102, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
-- A has agreed to recording and to sharing counts with Weaver (as the agreement functions of 0621 leave the rules). B has other
-- rules and has not agreed.
insert into app.centers (id, slug, name, short_name, state_region, status, rules) values
  (:a102, 'ideas102a', 'Ideas 102 A', 'I102A', 'TX', 'active',
   '{"activity": {"enabled": true, "share_with_weaver": true, "consent": {"at": "2026-10-11T00:00:00Z", "version": "1"}}}'::jsonb),
  (:b102, 'ideas102b', 'Ideas 102 B', 'I102B', 'CA', 'active', '{"store": {"gift_pack_cents": 299}}'::jsonb);
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  ('10200000-0000-4000-8000-000000000101', :a102, 'Sam', 'Staff102', date '1975-03-01'),
  ('10200000-0000-4000-8000-000000000102', :a102, 'Ada', 'Admin102', date '1970-06-06'),
  ('10200000-0000-4000-8000-000000000103', :a102, 'Pat', 'Platform102', date '1979-07-07'),
  ('10200000-0000-4000-8000-000000000104', :a102, 'Mia', 'Member102', date '1980-04-02');
insert into app.center_users (center_id, user_id, person_id) values
  (:a102, :staff102, '10200000-0000-4000-8000-000000000101'), (:a102, :adm102, '10200000-0000-4000-8000-000000000102'),
  (:a102, :plat102, '10200000-0000-4000-8000-000000000103'), (:a102, :member102, '10200000-0000-4000-8000-000000000104');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:a102, :staff102, 'treasurer', 'center', 'test 102'), (:a102, :adm102, 'center_admin', 'center', 'test 102');
insert into app.center_owners (center_id, user_id) values (:a102, :adm102)
  on conflict (center_id) do update set user_id = excluded.user_id;

-- ══ A. The registrations ═════════════════════════════════════════════════════
select pg_temp.assert((select count(*) = 8 and bool_and(c.kind = 'action' and c.surface = 'portal' and c.commandable_key is not null
                                                          and char_length(c.label) between 1 and 120 and c.entity_kind is null)
                         from app.activity_catalog c
                        where c.key in ('assistant.people_search', 'assistant.tasks_mine', 'assistant.events_upcoming', 'assistant.giving_pledges_behind',
                                        'assistant.accounting_month_close_blockers', 'assistant.messages_draft_reminder', 'assistant.events_draft_change',
                                        'assistant.events_set_field')),
  'A · the eight commands of the command layer are in the allowlist as portal actions, each with its command and a label');
select pg_temp.assert((select bool_and(c.key = 'assistant.' || replace(c.commandable_key, '.', '_')) from app.activity_catalog c
                        where c.key like 'assistant.%' and c.commandable_key is not null)
                      and (select c.commandable_key from app.activity_catalog c where c.key = 'assistant.people_search' and c.surface = 'portal') = 'people.search'
                      and (select c.commandable_key from app.activity_catalog c where c.key = 'assistant.accounting_month_close_blockers' and c.surface = 'portal') = 'accounting.month_close_blockers'
                      and (select c.commandable_key from app.activity_catalog c where c.key = 'assistant.events_set_field' and c.surface = 'portal') = 'events.set_field',
  'A · the key is "assistant." plus the command with its dot written as an underscore, and commandable_key is the command');
select pg_temp.assert((select count(*) = 2 and bool_and(c.kind = 'action' and c.surface = 'portal' and c.commandable_key is null) from app.activity_catalog c
                        where c.key in ('comms.approve_campaign', 'bolis.record_pledge'))
                      and (select c.entity_kind from app.activity_catalog c where c.key = 'comms.approve_campaign') = 'message'
                      and (select c.entity_kind from app.activity_catalog c where c.key = 'bolis.record_pledge') = 'boli',
  'A · approving a newsletter and recording an in-person pledge have keys, about a message and a boli');
select pg_temp.assert((select count(*) = 2 and bool_and(c.kind = 'screen' and c.surface = 'portal' and char_length(c.label) > 0) from app.activity_catalog c
                        where c.key in ('screen:/settings/automation', 'screen:/platform/automation')),
  'A · Settings › Automation ideas and Platform › Automation backlog are listed screens');
select pg_temp.assert((select count(*) = 1 from app.activity_catalog c where c.key = 'giving.record_payment' and c.surface = 'portal' and c.label = 'Record a payment'),
  'A · the keys 0620 seeded are untouched');

-- ══ B. Running the migration again changes nothing ═══════════════════════════
select count(*) as n_cat_before, md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) as h_cat_before
  from app.activity_catalog c \gset
\i migrations/0625_activity_ideas_catalog.sql
select pg_temp.assert((select count(*) = :n_cat_before
                              and md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) = :'h_cat_before'
                         from app.activity_catalog c),
  'B · running 0625 again leaves the allowlist exactly as it was');

-- ══ C. The new keys are recorded ═════════════════════════════════════════════
select pg_temp.act(:staff102, :a102, jsonb_build_array(
  jsonb_build_object('key', 'assistant.people_search', 'kind', 'action', 'outcome', 'ok', 'via', 'palette', 'duration_ms', 120),
  jsonb_build_object('key', 'assistant.events_set_field', 'kind', 'action', 'outcome', 'error', 'error_code', 'no_permission', 'via', 'assistant'),
  jsonb_build_object('key', 'comms.approve_campaign', 'kind', 'action', 'outcome', 'ok', 'via', 'screen', 'entity_id', :'e102'),
  jsonb_build_object('key', 'bolis.record_pledge', 'kind', 'action', 'outcome', 'ok', 'via', 'screen', 'entity_id', :'f102'),
  jsonb_build_object('key', 'screen:/settings/automation', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/platform/automation', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'assistant.not_a_command', 'kind', 'action', 'outcome', 'ok', 'via', 'palette'),
  jsonb_build_object('key', 'assistant.people_search', 'kind', 'action', 'outcome', 'ok', 'via', 'app')
)) as n_c102 \gset
select pg_temp.assert(:n_c102 = 6, 'C · six of the eight events are stored: the unknown key and the member-surface copy of a portal key are dropped');
select pg_temp.as_user(:plat102);
select pg_temp.assert((select count(*) = 6 from app.activity_events where center_id = :a102), 'C · and six rows are what was stored');
select pg_temp.assert((select e.via = 'palette' and e.outcome = 'ok' and e.duration_ms = 120 and e.entity_kind is null and e.entity_id is null and e.role_keys = array['treasurer']
                         from app.activity_events e where e.center_id = :a102 and e.key = 'assistant.people_search'),
  'C · a command run from the palette keeps how it was started, how long it took and the person''s role, and no record');
select pg_temp.assert((select e.via = 'assistant' and e.outcome = 'error' and e.error_code = 'no_permission'
                         from app.activity_events e where e.center_id = :a102 and e.key = 'assistant.events_set_field'),
  'C · a refused command run through Niva is an error with its code');
select pg_temp.assert((select e.entity_kind = 'message' and e.entity_id = :'e102'::uuid from app.activity_events e where e.center_id = :a102 and e.key = 'comms.approve_campaign')
                      and (select e.entity_kind = 'boli' and e.entity_id = :'f102'::uuid from app.activity_events e where e.center_id = :a102 and e.key = 'bolis.record_pledge'),
  'C · the two actions keep the kind of record from the allowlist and the record''s id (neither is about a person)');
select pg_temp.assert((select count(*) = 2 from app.activity_events e where e.center_id = :a102 and e.kind = 'screen' and e.key in ('screen:/settings/automation', 'screen:/platform/automation')),
  'C · the two new screens are recorded');
select pg_temp.as_none();

-- ══ D. A pattern made only of commands is proposed as a Niva command ═════════
-- Three treasurers each look someone up and then draft a reminder, twice, on different days: 6 runs in 6 sessions.
create or replace function pg_temp.pair(p_actor text, p_day integer) returns void language plpgsql as $$
begin
  insert into app.activity_events (center_id, occurred_at, surface, actor_hash, role_keys, key, kind, outcome, duration_ms, via)
  values ('10200000-0000-4000-8000-0000000000a1', pg_temp.ago(p_day), 'portal', pg_temp.h(p_actor), array['clerk'], 'assistant.people_search', 'action', 'ok', 500, 'palette'),
         ('10200000-0000-4000-8000-0000000000a1', pg_temp.ago(p_day) + interval '20 seconds', 'portal', pg_temp.h(p_actor), array['clerk'], 'assistant.messages_draft_reminder', 'action', 'ok', 800, 'assistant');
end $$;
select pg_temp.pair(v.a, v.d) from (values ('p', 3), ('p', 9), ('q', 4), ('q', 11), ('r', 5), ('r', 13)) v(a, d);
select pg_temp.as_user(:plat102);
select app.activity_mine(:a102) as n_mined102 \gset
select pg_temp.as_none();
select pg_temp.assert(:n_mined102 >= 1, 'D · the miner finds the planted pair');
select pg_temp.assert((select c.suggested_kind = 'niva_command' and c.distinct_actors = 3 and c.support = 6 and c.status = 'new'
                         from app.automation_candidates c
                        where c.center_id = :a102 and c.role_key = 'clerk'
                          and c.pattern = array['assistant.people_search', 'assistant.messages_draft_reminder']),
  'D · every step has a command (commandable_key), so the idea is suggested as something Niva could do');

-- ══ E. What the portal does to answer an idea ════════════════════════════════
select c.id as cand102 from app.automation_candidates c
 where c.center_id = :a102 and c.role_key = 'clerk' and c.pattern[1] = 'assistant.people_search' \gset
select pg_temp.as_user(:adm102);
select pg_temp.assert((select count(*) = 1 from app.automation_candidates c where c.id = :'cand102'),
  'E · the community''s administrator sees the idea (three people do it)');
with u as (update app.automation_candidates set status = 'accepted' where id = :'cand102' and center_id = :a102 and status = 'new' returning id)
  select count(*) as first_try from u \gset
with u as (update app.automation_candidates set status = 'dismissed' where id = :'cand102' and center_id = :a102 and status = 'new' returning id)
  select count(*) as second_try from u \gset
select pg_temp.as_none();
select pg_temp.assert(:first_try = 1 and :second_try = 0
                      and (select c.status = 'accepted' and c.decided_by = :adm102 and c.decided_at is not null from app.automation_candidates c where c.id = :'cand102'),
  'E · answering names the status the person saw: the first answer lands and stamps who and when, a second answer to a "new" idea changes nothing');
select pg_temp.as_user(:adm102);
with u as (update app.automation_candidates set status = 'new' where id = :'cand102' and center_id = :a102 and status = 'accepted' returning id)
  select count(*) as undo102 from u \gset
select pg_temp.as_none();
select pg_temp.assert(:undo102 = 1 and (select c.status = 'new' and c.decided_by is null and c.decided_at is null from app.automation_candidates c where c.id = :'cand102'),
  'E · putting an accepted idea back clears who and when');
select pg_temp.as_user(:staff102);
select pg_temp.assert((select count(*) = 0 from app.automation_candidates where center_id = :a102),
  'E · a treasurer without the settings permission sees no ideas at all');
with u as (update app.automation_candidates set status = 'accepted' where id = :'cand102' returning id) select count(*) as treasurer_try from u \gset
select pg_temp.as_none();
select pg_temp.assert(:treasurer_try = 0 and (select status = 'new' from app.automation_candidates where id = :'cand102'),
  'E · and cannot answer one');

-- ══ F. The agreement and Weaver's switch (0625 must not weaken them) ═════════
select pg_temp.assert(has_function_privilege('authenticated', 'app.set_activity_recording(uuid, boolean)', 'execute')
                      and not has_function_privilege('anon', 'app.set_activity_recording(uuid, boolean)', 'execute')
                      and not has_function_privilege('service_role', 'app.set_activity_recording(uuid, boolean)', 'execute')
                      and (select p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%'
                             from pg_proc p where p.oid = 'app.set_activity_recording(uuid, boolean)'::regprocedure),
  'F · set_activity_recording is still callable by signed-in people only, security definer with the pinned search path');
select pg_temp.assert((select not (rules ? 'activity') from app.centers where id = :b102), 'F · B starts with nothing agreed and nothing switched on');

-- Weaver cannot switch recording on for a community whose administrator has not agreed.
select pg_temp.as_user(:plat102);
select pg_temp.assert_raises($q$select app.set_activity_recording('10200000-0000-4000-8000-0000000000b1', true)$q$, 'has not agreed yet',
  'F · Weaver cannot switch recording on before the community''s administrator agrees');
select pg_temp.assert_raises($q$select app.set_activity_recording('10200000-0000-4000-8000-0000000000ff', true)$q$, 'not found',
  'F · a community that does not exist is reported, not ignored');
select pg_temp.as_none();
select pg_temp.assert((select not (rules ? 'activity') from app.centers where id = :b102), 'F · and nothing was changed on B');

-- The community's own administrator cannot use Weaver's switch.
select pg_temp.as_user(:adm102);
select pg_temp.assert_raises($q$select app.set_activity_recording('10200000-0000-4000-8000-0000000000a1', false)$q$, 'Only the Weaver team',
  'F · a community administrator cannot use Weaver''s switch');
-- Editing the rules by hand is refused, and the refusal points to where the agreement is made (0625 corrected the wording).
select pg_temp.assert_raises($q$update app.centers set rules = jsonb_set(rules, '{activity,share_with_weaver}', 'false') where id = '10200000-0000-4000-8000-0000000000a1'$q$, 'Settings > Automation ideas',
  'F · changing the agreement by editing the rules is refused, and the message points to Settings > Automation ideas');
select pg_temp.assert_raises($q$update app.centers set rules = jsonb_set(rules, '{activity,enabled}', 'false') where id = '10200000-0000-4000-8000-0000000000a1'$q$, 'Settings > Automation ideas',
  'F · so is switching recording on or off that way, with the same pointer');
select pg_temp.as_none();
select pg_temp.assert((select p.prosrc not like '%Privacy page%' and p.prosrc like '%Settings > Automation ideas%' and p.prosecdef
                              and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%'
                              and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                         from pg_proc p where p.oid = 'app.centers_activity_guard()'::regprocedure)
                      and exists (select 1 from pg_trigger t where t.tgrelid = 'app.centers'::regclass and t.tgname = 'centers_activity_guard' and not t.tgisinternal),
  'F · the guard no longer names the Privacy page; it is still security definer with the pinned search path, not callable by anyone, and still wired as the trigger');
select pg_temp.as_user(:adm102);
-- What the portal's Settings page reads about the agreement.
select pg_temp.assert((select s ->> 'enabled' = 'true' and s ->> 'consented' = 'true' and s #>> '{consent,version}' = '1'
                              and s #>> '{consent,at}' is not null and s ->> 'share_with_weaver' = 'true'
                         from (select app.activity_status(:a102) as s) x),
  'F · the community''s administrator reads whether it agreed, when, which notice version, and whether counts are shared');
select pg_temp.as_user(:staff102);
select pg_temp.assert((select s ? 'enabled' and not (s ? 'consented') and not (s ? 'share_with_weaver') from (select app.activity_status(:a102) as s) x),
  'F · a treasurer without the settings permission is not told about the agreement or the sharing');

-- Weaver may switch off at any time, and back on while the agreement stands.
select pg_temp.as_user(:plat102);
select app.set_activity_recording(:a102, false);
select pg_temp.assert(not app.activity_shared(:a102), 'F · switched off, the community is no longer shared with Weaver');
select pg_temp.as_none();
select pg_temp.assert((select (rules -> 'activity' ->> 'enabled') = 'false' and (rules #>> '{activity,consent,at}') is not null and (rules #>> '{activity,share_with_weaver}') = 'true'
                         from app.centers where id = :a102),
  'F · switching off keeps the agreement and the sharing choice');
select pg_temp.as_user(:plat102);
select app.set_activity_recording(:a102, true);
select pg_temp.assert(app.activity_shared(:a102) and app.activity_status(:a102) ->> 'enabled' = 'true', 'F · and on again while the agreement stands');
select pg_temp.as_none();

rollback;
