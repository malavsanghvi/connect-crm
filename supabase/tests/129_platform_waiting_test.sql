-- 0673 and 0674 (BACKLOG B90 phase 4, B83): the Platform console reads and the Reports and Platform commands in the activity allowlist.
--   A. The team's inbox across communities: go-live requests waiting for an approval, approved ones waiting to be moved to production,
--      nonprofit papers to review, new requests for access, sandboxes whose go-live checks fail, and each community's consent states
--   B. One community's summary: kind, size, setup, go-live checks, go-live request, verification, consent states
--   C. Nobody outside the Weaver team can read them: a community's owner, a member, a signed-out visitor
--   D. They read, never write; no SECURITY DEFINER code was added; who may call them
--   E. 0674: the 8 Reports and 15 Platform commands are in the activity allowlist; running the migration again changes nothing
-- Everything runs in its own communities (G129) in one transaction that is rolled back. Other tests may leave communities behind, so
-- every check looks for this test's own communities by address.
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', label, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', json_build_array(json_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/platform"}', true);
end $$;

\set live '''12900000-0000-4000-8000-0000000000c1'''
\set sa '''12900000-0000-4000-8000-0000000000c2'''
\set sb '''12900000-0000-4000-8000-0000000000c3'''
\set cc1 '''12900000-0000-4000-8000-0000000000a1'''
\set cc2 '''12900000-0000-4000-8000-0000000000a2'''
\set ora '''12900000-0000-4000-8000-0000000000a3'''
\set ada '''12900000-0000-4000-8000-0000000000a4'''
\set sam '''12900000-0000-4000-8000-0000000000a5'''
\set nobody '''12900000-0000-4000-8000-0000000009ff'''

begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  (:cc1, 'cc1@g129.test'), (:cc2, 'cc2@g129.test'), (:ora, 'ora@g129.test'), (:ada, 'ada@g129.test'), (:sam, 'sam@g129.test');
insert into app.accounts (user_id, is_platform_admin) values (:cc1, true), (:cc2, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
-- A live community whose administrator agreed to record how the portal is used (not shared with Weaver),
-- and two sandboxes: A asked to go live (nobody has approved yet), B was approved by two people.
insert into app.centers (id, slug, name, status, environment, rules) values
  (:live, 'g129-live', 'G129 Live Sangh', 'active', 'production',
   '{"activity":{"enabled":true,"share_with_weaver":false,"consent":{"at":"2026-09-01T10:00:00Z"}}}'::jsonb),
  (:sa, 'g129-sandbox-a', 'G129 Sandbox A', 'onboarding', 'sandbox', '{}'::jsonb),
  (:sb, 'g129-sandbox-b', 'G129 Sandbox B', 'onboarding', 'sandbox', '{}'::jsonb);
insert into app.center_owners (center_id, user_id) values (:live, :ora), (:sa, :ada);
insert into app.people (id, center_id, first_name, last_name, email) values
  ('12900000-0000-4000-8000-000000000101', :live, 'Sam', 'Member', 'sam@g129.test'),
  ('12900000-0000-4000-8000-000000000102', :live, 'Ora', 'Owner', 'ora@g129.test');
insert into app.center_users (center_id, user_id, person_id, is_default) values
  (:live, :sam, '12900000-0000-4000-8000-000000000101', false), (:live, :ora, '12900000-0000-4000-8000-000000000102', false);
insert into app.golive_requests (center_id, requested_by, requested_at, status, first_approver) values
  (:sa, :ada, now() - interval '5 days', 'requested', null);
insert into app.golive_requests (center_id, requested_by, requested_at, status, first_approver, first_approved_at, second_approver, second_approved_at) values
  (:sb, :ada, now() - interval '9 days', 'approved', :cc1, now() - interval '8 days', :cc2, now() - interval '2 days');
insert into app.org_profiles (center_id, verification_status, submitted_at) values (:sa, 'submitted', now() - interval '3 days');
insert into app.access_requests (org_legal_name, org_type, city, state, contact_name, contact_email, status) values
  ('G129 Fremont Jain Sangh', 'temple', 'Fremont', 'CA', 'Pat Quiet', 'pat.quiet@g129.test', 'new'),
  ('G129 Waiting On Them Sangh', 'temple', 'Reno', 'NV', 'Quinn Quiet', 'quinn.quiet@g129.test', 'more_info'),
  ('G129 Already Approved Sangh', 'temple', 'Austin', 'TX', 'Rae Quiet', 'rae.quiet@g129.test', 'approved');
-- The owner of sandbox A opened support access for the team for two days.
insert into app.support_grants (center_id, grantee_user_id, granted_by, expires_at, reason) values
  (:sa, :cc1, :ada, now() + interval '2 days', 'Help with setup');
-- Something to count in the live community.
insert into app.households (id, center_id, display_name) values ('12900000-0000-4000-8000-000000000201', :live, 'G129 family');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('12900000-0000-4000-8000-000000000201', '12900000-0000-4000-8000-000000000101', :live, 'primary', true);

-- ═══════════════════════════════════════════════════════════════════════════
-- What each person gets
-- ═══════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:cc1);
select app.platform_waiting(500)::text as waiting \gset
select app.platform_waiting(1)::text as waiting1 \gset
select app.platform_community_summary(:sa)::text as sum_a \gset
select app.platform_community_summary(:sb)::text as sum_b \gset
select app.platform_community_summary(:live)::text as sum_live \gset
select coalesce(app.platform_community_summary(:nobody)::text, 'null') as sum_nobody \gset
reset role;

-- ═══════════════════════════════════════════════════════════════════════════
-- A. The inbox
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert(exists (select 1 from jsonb_array_elements((:'waiting'::jsonb)->'items') i
                               where i->>'kind' = 'golive' and i->>'slug' = 'g129-sandbox-a'
                                 and i->>'detail' = 'Asked to go live. It needs a first approval.'),
  'A: sandbox A asked to go live and needs a first approval');
select pg_temp.assert(exists (select 1 from jsonb_array_elements((:'waiting'::jsonb)->'items') i
                               where i->>'kind' = 'promote' and i->>'slug' = 'g129-sandbox-b'),
  'A: sandbox B was approved and waits to be moved to production');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements((:'waiting'::jsonb)->'items') i
                                   where i->>'kind' = 'golive' and i->>'slug' = 'g129-sandbox-b'),
  'A: ... and is not also waiting for an approval');
select pg_temp.assert(exists (select 1 from jsonb_array_elements((:'waiting'::jsonb)->'items') i
                               where i->>'kind' = 'verification' and i->>'slug' = 'g129-sandbox-a'),
  'A: sandbox A sent its nonprofit papers for review');
select pg_temp.assert(exists (select 1 from jsonb_array_elements((:'waiting'::jsonb)->'items') i
                               where i->>'kind' = 'access_request' and i->>'community' = 'G129 Fremont Jain Sangh' and i->>'slug' is null and i->>'center_id' is null)
                      and not exists (select 1 from jsonb_array_elements((:'waiting'::jsonb)->'items') i where i->>'community' = 'G129 Already Approved Sangh')
                      and not exists (select 1 from jsonb_array_elements((:'waiting'::jsonb)->'items') i where i->>'community' = 'G129 Waiting On Them Sangh'),
  'A: a new request for access waits for the team; an approved one and one waiting on the organization do not');
select pg_temp.assert(((:'waiting'::jsonb)->'counts'->>'access_requests_waiting_on_them')::int >= 1 and ((:'waiting'::jsonb)->'counts'->>'access_requests')::int >= 1
                      and ((:'waiting'::jsonb)->'counts'->>'golive')::int >= 1 and ((:'waiting'::jsonb)->'counts'->>'promote')::int >= 1
                      and ((:'waiting'::jsonb)->'counts'->>'verification')::int >= 1,
  'A: the counts');
select pg_temp.assert((select count(*) from jsonb_array_elements((:'waiting'::jsonb)->'items') i where i->>'kind' = 'readiness' and i->>'slug' in ('g129-sandbox-a', 'g129-sandbox-b')) = 2
                      and not exists (select 1 from jsonb_array_elements((:'waiting'::jsonb)->'items') i where i->>'kind' = 'readiness' and i->>'slug' = 'g129-live')
                      and not exists (select 1 from jsonb_array_elements((:'waiting'::jsonb)->'items') i where i->>'kind' = 'readiness' and jsonb_array_length(i->'more') > 3),
  'A: both sandboxes have go-live checks that do not pass (at most three are listed); the live community is not in the onboarding list');
select pg_temp.assert(exists (select 1 from jsonb_array_elements((:'waiting'::jsonb)->'consent') k
                               where k->>'slug' = 'g129-live' and k->>'activity_recording' = 'on' and (k->>'shares_with_weaver')::boolean = false and k->>'support_access_until' is null)
                      and exists (select 1 from jsonb_array_elements((:'waiting'::jsonb)->'consent') k
                                   where k->>'slug' = 'g129-sandbox-a' and k->>'activity_recording' = 'not_agreed' and k->>'support_access_until' is not null)
                      and exists (select 1 from jsonb_array_elements((:'waiting'::jsonb)->'consent') k
                                   where k->>'slug' = 'g129-sandbox-b' and k->>'activity_recording' = 'not_agreed' and k->>'support_access_until' is null),
  'A: consent states: the live community agreed and does not share; sandbox A has not agreed but opened support access; sandbox B has neither');
select pg_temp.assert(jsonb_array_length((:'waiting1'::jsonb)->'items') = 1,
  'A: the limit keeps only the first thing (the counts still say how many there are)');
select pg_temp.assert(position('pat.quiet@g129.test' in :'waiting') = 0 and position('Pat Quiet' in :'waiting') = 0 and position('Sam Member' in :'waiting') = 0
                      and position('ada@g129.test' in :'waiting') = 0,
  'A: no email, no applicant, no member is named in the answer');

-- ═══════════════════════════════════════════════════════════════════════════
-- B. One community
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert((:'sum_a'::jsonb)->'community'->>'slug' = 'g129-sandbox-a' and (:'sum_a'::jsonb)->'community'->>'environment' = 'sandbox'
                      and (:'sum_a'::jsonb)->'community'->>'status' = 'onboarding',
  'B: sandbox A: who it is');
select pg_temp.assert((:'sum_a'::jsonb)->'go_live'->>'status' = 'requested' and ((:'sum_a'::jsonb)->'go_live'->>'first_approved')::boolean = false
                      and (:'sum_b'::jsonb)->'go_live'->>'status' = 'approved' and ((:'sum_b'::jsonb)->'go_live'->>'second_approved')::boolean = true,
  'B: where each go-live request stands');
select pg_temp.assert((:'sum_a'::jsonb)->'verification'->>'status' = 'submitted' and (:'sum_a'::jsonb)->'verification'->>'submitted_at' is not null,
  'B: nonprofit papers sent');
select pg_temp.assert((:'sum_a'::jsonb)->'consent'->>'support_access_until' is not null and (:'sum_a'::jsonb)->'consent'->>'activity_recording' = 'not_agreed'
                      and (:'sum_live'::jsonb)->'consent'->>'activity_recording' = 'on',
  'B: consent states');
select pg_temp.assert(jsonb_typeof((:'sum_a'::jsonb)->'readiness') = 'object' and ((:'sum_a'::jsonb)->'readiness'->>'total')::int > 0
                      and jsonb_typeof((:'sum_a'::jsonb)->'readiness'->'failing') = 'array'
                      and ((:'sum_a'::jsonb)->'readiness'->>'passing')::int + jsonb_array_length((:'sum_a'::jsonb)->'readiness'->'failing') = ((:'sum_a'::jsonb)->'readiness'->>'total')::int,
  'B: the go-live checks: how many pass, and which do not');
select pg_temp.assert(((:'sum_live'::jsonb)->'size'->>'households')::int = 1 and ((:'sum_live'::jsonb)->'size'->>'people')::int = 2
                      and ((:'sum_live'::jsonb)->'size'->>'signed_in_accounts')::int = 2 and (:'sum_live'::jsonb)->'go_live' = 'null'::jsonb,
  'B: size counts (one household, two people, two signed-in accounts); a live community has no go-live request');
select pg_temp.assert(:'sum_nobody' = 'null', 'B: a community that does not exist gives null');
select pg_temp.assert(position('Sam Member' in :'sum_live') = 0 and position('sam@g129.test' in :'sum_live') = 0 and position('G129 family' in :'sum_live') = 0,
  'B: no member or household is named in the summary');

-- ═══════════════════════════════════════════════════════════════════════════
-- C. Only the Weaver team
-- ═══════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:ora);
select pg_temp.assert_raises($$select app.platform_waiting(10)$$, 'for the Community Connect team', 'C: a community''s owner cannot read the waiting list');
select pg_temp.assert_raises($$select app.platform_community_summary('12900000-0000-4000-8000-0000000000c1')$$, 'for the Community Connect team',
  'C: ... nor a summary, not even of their own community');
select pg_temp.as_user(:sam);
select pg_temp.assert_raises($$select app.platform_waiting(10)$$, 'for the Community Connect team', 'C: a member cannot read the waiting list');
reset role;
set local role anon;
select pg_temp.assert_raises($$select app.platform_waiting(10)$$, 'permission denied', 'C: a signed-out visitor cannot call it');
reset role;

-- ═══════════════════════════════════════════════════════════════════════════
-- D. They read, never write; who may call them
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) = 2 and bool_and(p.provolatile in ('s', 'i') and not p.prosecdef)
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('platform_waiting', 'platform_community_summary')),
  'D: both are stable and security invoker (this migration adds no SECURITY DEFINER code)');
select pg_temp.assert((select count(*) = 2 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('platform_waiting', 'platform_community_summary')
                          and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=app, public, extensions%')),
  'D: each pins the search path to app, public, extensions');
select pg_temp.assert(not has_function_privilege('anon', 'app.platform_waiting(integer)', 'execute')
                      and not has_function_privilege('anon', 'app.platform_community_summary(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.platform_waiting(integer)', 'execute'),
  'D: signed-out visitors cannot call them; signed-in people can (and the function itself refuses everyone but the team)');
select pg_temp.assert((select count(*) from app.golive_requests where center_id in (:sa, :sb)) = 2 and (select count(*) from app.access_requests where org_legal_name like 'G129%') = 3,
  'D: reading changed nothing');

-- ═══════════════════════════════════════════════════════════════════════════
-- E. 0674: the allowlist
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) = 23 from app.activity_catalog c
                        where c.surface = 'portal' and c.kind = 'action'
                          and c.commandable_key in ('reports.overview', 'reports.giving_totals', 'reports.campaign_progress', 'reports.membership_counts', 'reports.event_attendance',
                                                    'reports.store_sales', 'reports.compare_months', 'reports.publish_kpi',
                                                    'platform.waiting', 'platform.community_summary', 'platform.preview_kind_change', 'platform.change_kind',
                                                    'platform.decide_access_request', 'platform.decide_go_live', 'platform.decide_verification',
                                                    'platform.set_limits_and_addresses', 'platform.set_community_switches', 'platform.pause_ways_to_pay',
                                                    'platform.create_sandbox', 'platform.manage_sandbox_codes', 'platform.end_support_access',
                                                    'platform.publish_agreement', 'platform.run_platform_setup')
                          and c.key = 'assistant.' || replace(c.commandable_key, '.', '_')),
  'E: every Reports and Platform command is a portal action under assistant.<area>_<verb>, with its command');
select pg_temp.assert((select bool_and(char_length(c.label) between 6 and 120 and c.label !~ '[._]') from app.activity_catalog c
                        where c.surface = 'portal' and (c.key like 'assistant.reports\_%' or c.key like 'assistant.platform\_%')),
  'E: the labels are plain verb phrases');
select pg_temp.assert((select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.people_search' and c.commandable_key = 'people.search')
                      and (select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.settings_setup_status' and c.commandable_key = 'settings.setup_status')
                      and (select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.messages_inbox_triage' and c.commandable_key = 'messages.inbox_triage'),
  'E: the commands of the earlier migrations are untouched');

select count(*) as n_before,
       md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) as h_before
  from app.activity_catalog c \gset
\i migrations/0674_activity_reports_platform_commands.sql
select pg_temp.assert((select count(*) = :n_before
                              and md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) = :'h_before'
                         from app.activity_catalog c),
  'E: running 0674 again leaves the allowlist exactly as it was');

rollback;
\echo 'PASS: platform waiting tests'
