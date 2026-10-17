-- 0920 (CatchTheMatch Phase 1, piece 0, docs/CATCH_THE_MATCH.md section 13): ask the adults of donor families for their employer.
--   A. Structure: the asks are private and only the function writes; the helpers are not callable; the topic and the wording exist.
--   B. The audience: adults of households with a gift in the last 24 months, with no employer record; the child, the person with an
--      employer on file, the one who withdrew, the household with only an old gift, an opening balance or a history import are left
--      out; the household as its card; no address and no amount in the answer; how each person can be reached.
--   C. The ask: who may; the sandbox's verified-recipient rule is honoured and said in words; a queued ask is on the messaging
--      queue with the owner's wording and the member app link, and no amount; the ask is recorded; a person asked is not asked again
--      within 90 days; the cap; two calls never ask a person twice; people of another community are ignored.
--   D. Reads are logged; the module off, or no access, is "You don't have access to this area".
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
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Chicago')::date $$;
-- The message outbox, read as the test (staff without a communications role cannot read it directly).
create or replace function pg_temp.ask_msgs() returns setof app.messages language sql security definer as $$ select * from app.messages $$;
create or replace function pg_temp.row_of(j jsonb, p_person uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(j -> 'rows') e where e -> 'person' ->> 'id' = p_person::text
$$;

\set c1 '''92000000-0000-4000-8000-0000000000c1'''
\set c2 '''92000000-0000-4000-8000-0000000000c2'''
\set owner '''92000000-0000-4000-8000-000000000001'''
\set plat '''92000000-0000-4000-8000-000000000002'''
\set lead '''92000000-0000-4000-8000-000000000003'''
\set viewer '''92000000-0000-4000-8000-000000000004'''
\set clerk '''92000000-0000-4000-8000-000000000006'''
\set ufay '''92000000-0000-4000-8000-000000000007'''
\set ha '''92000000-0000-4000-8000-0000000000b1'''
\set hb '''92000000-0000-4000-8000-0000000000b2'''
\set hc '''92000000-0000-4000-8000-0000000000b3'''
\set hd '''92000000-0000-4000-8000-0000000000b4'''
\set he '''92000000-0000-4000-8000-0000000000b5'''
\set hf '''92000000-0000-4000-8000-0000000000b6'''
\set hg '''92000000-0000-4000-8000-0000000000b7'''
\set hh '''92000000-0000-4000-8000-0000000000b8'''
\set hi '''92000000-0000-4000-8000-0000000000b9'''
\set hj '''92000000-0000-4000-8000-0000000000ba'''
\set h2 '''92000000-0000-4000-8000-0000000000bb'''
\set pa '''92000000-0000-4000-8000-0000000000a1'''
\set pk '''92000000-0000-4000-8000-0000000000a2'''
\set pb '''92000000-0000-4000-8000-0000000000a3'''
\set pbs '''92000000-0000-4000-8000-0000000000a4'''
\set pc '''92000000-0000-4000-8000-0000000000a5'''
\set pd '''92000000-0000-4000-8000-0000000000a6'''
\set pe '''92000000-0000-4000-8000-0000000000a7'''
\set pf '''92000000-0000-4000-8000-0000000000a8'''
\set pg '''92000000-0000-4000-8000-0000000000a9'''
\set ph '''92000000-0000-4000-8000-0000000000aa'''
\set pi '''92000000-0000-4000-8000-0000000000ab'''
\set pj '''92000000-0000-4000-8000-0000000000ac'''
\set p2 '''92000000-0000-4000-8000-0000000000ad'''

-- ══ A. Structure ═════════════════════════════════════════════════════════════
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'app.match_employer_asks'::regclass)
                      and not has_table_privilege('authenticated', 'app.match_employer_asks', 'insert')
                      and not has_table_privilege('authenticated', 'app.match_employer_asks', 'update')
                      and not has_table_privilege('authenticated', 'app.match_employer_asks', 'delete')
                      and not has_table_privilege('anon', 'app.match_employer_asks', 'select'),
  'A · the asks are private and nobody but the function writes to them');
select pg_temp.assert(not has_function_privilege('authenticated', 'app._match_ask_base(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._match_ask_reason(text)', 'execute')
                      and has_function_privilege('authenticated', 'app.match_employer_ask_list(uuid, int, int)', 'execute')
                      and has_function_privilege('authenticated', 'app.ask_match_employers(uuid, uuid[], int)', 'execute')
                      and not has_function_privilege('anon', 'app.ask_match_employers(uuid, uuid[], int)', 'execute'),
  'A · the helpers are not callable by a signed-in person; the list and the ask are, and not by anyone signed out');
select pg_temp.assert((select module_key from app.module_tables where table_name = 'match_employer_asks') = 'matching',
  'A · the asks belong to CatchTheMatch');
select pg_temp.assert((select marketing and default_on and has_sender from app.notification_topics where key = 'matching')
                      and (select count(*) from app.message_templates where center_id is null and key = 'match_employer_ask' and language = 'en') = 2
                      and (select body from app.message_templates where center_id is null and key = 'match_employer_ask' and channel = 'email')
                          like '%You may be eligible to double the donation from your employer if you provide your employer information.%'
                      and (select body from app.message_templates where center_id is null and key = 'match_employer_ask' and channel = 'push')
                          = 'You may be eligible to double the donation from your employer if you provide your employer information.',
  'A · the topic (on by default, a marketing topic) and the owner''s wording, by email and push');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:owner, 'owner920@c1.test'), (:plat, 'plat920@weaver.test'), (:lead, 'lead920@c1.test'), (:viewer, 'viewer920@c1.test'),
  (:clerk, 'clerk920@c1.test'), (:ufay, 'fay920@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'ctm920a', 'Grace Church 920', 'G920', 'TX', 'active', 'America/Chicago', 'church', 'sandbox'),
  (:c2, 'ctm920b', 'Second Church 920', 'S920', 'TX', 'active', 'America/Chicago', 'church', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values
  (:c1, 'matching', true, 'Test 920: CatchTheMatch'), (:c2, 'matching', true, 'Test 920: CatchTheMatch');
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('matching_viewer920', 'center', 'Matching viewer 920', 'center', 'Test 920: matching.view only', '["matching.view"]'),
  ('people_viewer920', 'center', 'People viewer 920', 'center', 'Test 920', '["people.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 920: the platform owner role (holds "*")'),
  (:c1, :lead, 'matching_lead', 'center', 'Test 920'), (:c1, :viewer, 'matching_viewer920', 'center', 'Test 920'),
  (:c1, :clerk, 'people_viewer920', 'center', 'Test 920');

insert into app.households (id, center_id, display_name) values
  (:ha, :c1, 'Alpha920, Ana'), (:hb, :c1, 'Bravo920, Bo'), (:hc, :c1, 'Charlie920, Cy'), (:hd, :c1, 'Delta920, Di'),
  (:he, :c1, 'Echo920, Ed'), (:hf, :c1, 'Foxtrot920, Fay'), (:hg, :c1, 'Golf920, Gus'), (:hh, :c1, 'Hotel920, Hal'),
  (:hi, :c1, 'India920, Ivy'), (:hj, :c1, 'Juliet920, Jo'), (:h2, :c2, 'Other920, Oz');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:pa, :c1, 'Ana', 'Alpha920', date '1980-01-01', 'ana920@c1.test'),
  (:pk, :c1, 'Kit', 'Alpha920', (pg_temp.today() - interval '10 years')::date, 'kit920@c1.test'),
  (:pb, :c1, 'Bo', 'Bravo920', date '1975-02-02', 'bo920@c1.test'),
  (:pbs, :c1, 'Bea', 'Bravo920', date '1976-02-02', 'bea920@c1.test'),
  (:pc, :c1, 'Cy', 'Charlie920', date '1976-03-03', 'cy920@c1.test'),
  (:pd, :c1, 'Di', 'Delta920', date '1970-04-04', 'di920@c1.test'),
  (:pe, :c1, 'Ed', 'Echo920', date '1971-05-05', 'ed920@c1.test'),
  (:pf, :c1, 'Fay', 'Foxtrot920', date '1972-06-06', null),
  (:pg, :c1, 'Gus', 'Golf920', date '1973-07-07', 'gus920@c1.test'),
  (:ph, :c1, 'Hal', 'Hotel920', date '1974-08-08', 'hal920@c1.test'),
  (:pi, :c1, 'Ivy', 'India920', date '1979-09-09', 'ivy920@c1.test'),
  (:pj, :c1, 'Jo', 'Juliet920', date '1978-10-10', 'jo920@c1.test'),
  (:p2, :c2, 'Oz', 'Other920', date '1980-01-01', 'oz920@c2.test');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:ha, :pa, :c1, 'primary', true), (:ha, :pk, :c1, 'child', false), (:hb, :pb, :c1, 'primary', true), (:hb, :pbs, :c1, 'spouse', false),
  (:hc, :pc, :c1, 'primary', true), (:hd, :pd, :c1, 'primary', true), (:he, :pe, :c1, 'primary', true), (:hf, :pf, :c1, 'primary', true),
  (:hg, :pg, :c1, 'primary', true), (:hh, :ph, :c1, 'primary', true), (:hi, :pi, :c1, 'primary', true), (:hj, :pj, :c1, 'primary', true),
  (:h2, :p2, :c2, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c1, :ufay, :pf);
insert into app.push_devices (user_id, center_id, platform, token) values
  (:ufay, :c1, 'android', 'ExponentPushToken[920fay-token-0001]');

create or replace function pg_temp.gift(p_id uuid, p_center uuid, p_h uuid, p_person uuid, p_cents int, p_days int, p_opening boolean default false,
                                        p_history boolean default false) returns void language sql as $$
  insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at,
                            receipt_number, is_opening_balance, is_historical, refunded_cents)
  values (p_id, p_center, p_h, p_person, p_cents, 'check', 'captured', 'offline', pg_temp.today() - p_days, now() - make_interval(days => p_days),
          'R-920-' || right(p_id::text, 4), p_opening, p_opening or p_history, 0)
$$;
select pg_temp.gift('92000000-0000-4000-8000-00000000f001', :c1, :ha, :pa, 10000, 60),
       pg_temp.gift('92000000-0000-4000-8000-00000000f002', :c1, :hb, :pb, 20000, 10),
       pg_temp.gift('92000000-0000-4000-8000-00000000f003', :c1, :hc, :pc, 15000, 800),             -- older than 24 months
       pg_temp.gift('92000000-0000-4000-8000-00000000f004', :c1, :hd, :pd, 12000, 5),
       pg_temp.gift('92000000-0000-4000-8000-00000000f005', :c1, :he, :pe, 11000, 12),
       pg_temp.gift('92000000-0000-4000-8000-00000000f006', :c1, :hf, :pf, 9000, 30),
       pg_temp.gift('92000000-0000-4000-8000-00000000f007', :c1, :hg, :pg, 8000, 30),
       pg_temp.gift('92000000-0000-4000-8000-00000000f008', :c1, :hh, :ph, 7000, 30),
       pg_temp.gift('92000000-0000-4000-8000-00000000f009', :c1, :hi, :pi, 6000, 5, true),          -- an opening balance
       pg_temp.gift('92000000-0000-4000-8000-00000000f00a', :c1, :hj, :pj, 5000, 5, false, true),   -- a history import
       pg_temp.gift('92000000-0000-4000-8000-00000000f00b', :c2, :h2, :p2, 30000, 30);

-- The office records Bea's employer (from a paper form) and Di's, who then withdraws it.
set role authenticated;
select pg_temp.claims(:lead);
select app.record_match_employer(:c1, :pbs, 'Acme920 Corp');
select app.record_match_employer(:c1, :pd, 'Acme920 Corp');
select app.withdraw_match_employer(:c1, :pd, 'By phone on the day of the test');
reset role;
-- Ed's address is suppressed (a bounce); Gus opted out of email; Hal withdrew his marketing consent.
insert into app.message_suppressions (center_id, channel, address, reason, detail) values (:c1, 'email', 'ed920@c1.test', 'bounce', 'Test 920');
insert into app.channel_optins (center_id, person_id, channel, address, opted_in, source) values (:c1, :pg, 'email', 'gus920@c1.test', false, 'admin');
insert into app.consents (center_id, person_id, kind, granted, source) values (:c1, :ph, 'marketing_email', false, 'admin');

-- ══ B. The audience ══════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select app.match_employer_ask_list(:c1) as l0 \gset
select pg_temp.assert((:'l0'::jsonb -> 'counts' ->> 'people') = '8' and (:'l0'::jsonb -> 'counts' ->> 'to_ask') = '6'
                      and (:'l0'::jsonb -> 'counts' ->> 'on_file') = '1' and (:'l0'::jsonb -> 'counts' ->> 'withdrew') = '1'
                      and (:'l0'::jsonb -> 'counts' ->> 'recent') = '0',
  'B · the adults of households with a gift in the last 24 months: 8 (Ana, Bo, Bea, Di, Ed, Fay, Gus, Hal); 6 to ask, 1 with an employer on file, 1 who withdrew');
select pg_temp.assert(pg_temp.row_of(:'l0'::jsonb, :pa) is not null and pg_temp.row_of(:'l0'::jsonb, :pb) is not null
                      and pg_temp.row_of(:'l0'::jsonb, :pk) is null and pg_temp.row_of(:'l0'::jsonb, :pbs) is null
                      and pg_temp.row_of(:'l0'::jsonb, :pd) is null and pg_temp.row_of(:'l0'::jsonb, :pc) is null
                      and pg_temp.row_of(:'l0'::jsonb, :pi) is null and pg_temp.row_of(:'l0'::jsonb, :pj) is null
                      and pg_temp.row_of(:'l0'::jsonb, :p2) is null,
  'B · never a child, the person with an employer on file, the one who withdrew, a household whose only gift is old, an opening balance or a history import, or another community');
select pg_temp.assert((:'l0'::jsonb -> 'counts' ->> 'email') = '2' and (:'l0'::jsonb -> 'counts' ->> 'app') = '1'
                      and (:'l0'::jsonb -> 'counts' ->> 'nobody') = '3'
                      and (pg_temp.row_of(:'l0'::jsonb, :pa) ->> 'email') = 'true' and (pg_temp.row_of(:'l0'::jsonb, :pf) ->> 'app') = 'true'
                      and (pg_temp.row_of(:'l0'::jsonb, :pf) ->> 'email') = 'false'
                      and (pg_temp.row_of(:'l0'::jsonb, :pe) ->> 'email') = 'false' and (pg_temp.row_of(:'l0'::jsonb, :pg) ->> 'email') = 'false'
                      and (pg_temp.row_of(:'l0'::jsonb, :ph) ->> 'email') = 'false',
  'B · how each can be reached: a good address, the member app on a phone; not a suppressed address, an opt-out or a withdrawn marketing consent');
select pg_temp.assert((pg_temp.row_of(:'l0'::jsonb, :pa) -> 'household' ->> 'name') = 'Alpha920, Ana'
                      and (pg_temp.row_of(:'l0'::jsonb, :pa) -> 'household') ? 'number'
                      and not (:'l0'::jsonb::text like '%@%')
                      and not (:'l0'::jsonb::text ~ '(amount|Kit |kit920)'),
  'B · the household as its card (never a name alone); no address, no amount, no gift and no child in the answer');
select pg_temp.claims(:viewer);
select pg_temp.assert_raises(format('select app.match_employer_ask_list(%L)', :c1), 'don''t have access', 'B · a CatchTheMatch viewer cannot read the audience (matching.manage)');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises(format('select app.match_employer_ask_list(%L)', :c1), 'don''t have access', 'B · nor can someone without CatchTheMatch');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format('select app.match_employer_ask_list(%L)', :c1), 'don''t have access', 'B · nor Weaver''s team: no platform-admin branch');
select pg_temp.claims(:owner);
select pg_temp.assert((app.match_employer_ask_list(:c1) -> 'counts' ->> 'to_ask') = '6', 'B · the organization''s owner reads it');
reset role;

-- ══ C. The ask ═══════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:viewer);
select pg_temp.assert_raises(format('select app.ask_match_employers(%L)', :c1), 'don''t have access', 'C · a viewer cannot ask');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format('select app.ask_match_employers(%L)', :c1), 'don''t have access', 'C · nor Weaver''s team');
select pg_temp.claims(:lead);
-- A sandbox messages only verified test recipients: nothing is queued, in words, and the person can be asked later.
select app.ask_match_employers(:c1, array[:pa]::uuid[]) as s1 \gset
select pg_temp.assert((:'s1'::jsonb ->> 'asked') = '0' and (:'s1'::jsonb ->> 'email') = '0'
                      and (:'s1'::jsonb -> 'not_queued') ? 'This community is a sandbox: it messages only verified test recipients (Settings › Limits).'
                      and (select count(*) from pg_temp.ask_msgs() where person_id = :pa and template_key = 'match_employer_ask') = 0
                      and (select count(*) from app.match_employer_asks where person_id = :pa and not queued) = 1
                      and (app.match_employer_ask_list(:c1) -> 'counts' ->> 'to_ask') = '6',
  'C · a sandbox queues nothing for an unverified address, says why in words, and the person stays to be asked');
reset role;
select set_config('app.messaging_recipient_verified', 'on', true);
insert into app.sandbox_test_recipients (center_id, channel, address, verified_at) values (:c1, 'email', 'ana920@c1.test', now()),
  (:c1, 'push', 'fay920@c1.test', now());
select set_config('app.messaging_recipient_verified', '', true);
set role authenticated;
select pg_temp.claims(:lead);
select app.ask_match_employers(:c1, array[:pa, :pk, :p2]::uuid[]) as s2 \gset
select pg_temp.assert((:'s2'::jsonb ->> 'asked') = '1' and (:'s2'::jsonb ->> 'email') = '1' and (:'s2'::jsonb ->> 'not_in_audience') = '2',
  'C · a verified test recipient is asked by email; a child and a person of another community are not in the audience');
select pg_temp.assert((select count(*) from pg_temp.ask_msgs() where person_id = :pa and template_key = 'match_employer_ask' and status = 'queued' and channel = 'email') = 1
                      and (select body from pg_temp.ask_msgs() where person_id = :pa and template_key = 'match_employer_ask') like '%You may be eligible to double the donation from your employer if you provide your employer information.%'
                      and (select body from pg_temp.ask_msgs() where person_id = :pa and template_key = 'match_employer_ask') like '%Hello Ana,%'
                      and (select body from pg_temp.ask_msgs() where person_id = :pa and template_key = 'match_employer_ask') like '%/matching%'
                      and position('$' in (select body from pg_temp.ask_msgs() where person_id = :pa and template_key = 'match_employer_ask')) = 0
                      and (select topic_key from pg_temp.ask_msgs() where person_id = :pa and template_key = 'match_employer_ask') = 'matching'
                      and (select purpose from pg_temp.ask_msgs() where person_id = :pa and template_key = 'match_employer_ask') = 'notification'
                      and (select created_by from pg_temp.ask_msgs() where person_id = :pa and template_key = 'match_employer_ask') = :lead,
  'C · the message is on the messaging queue as a notification of the matching topic, with the owner''s wording, the first name, the member app link, no amount, and who sent it');
select pg_temp.assert((select count(*) from app.match_employer_asks where person_id = :pa and queued and channel = 'email' and asked_by = :lead and message_id is not null) = 1
                      and (app.match_employer_ask_list(:c1) -> 'counts' ->> 'recent') = '1'
                      and (app.match_employer_ask_list(:c1) -> 'counts' ->> 'to_ask') = '5'
                      and pg_temp.row_of(app.match_employer_ask_list(:c1), :pa) is null,
  'C · the ask is recorded; the person is now "asked recently" and leaves the list');
select app.ask_match_employers(:c1, array[:pa]::uuid[]) as s3 \gset
select pg_temp.assert((:'s3'::jsonb ->> 'asked') = '0' and (:'s3'::jsonb ->> 'not_in_audience') = '1'
                      and (select count(*) from pg_temp.ask_msgs() where person_id = :pa and template_key = 'match_employer_ask') = 1,
  'C · a person asked in the last 90 days is not asked again');
reset role;
-- 91 days later the person is asked again.
update app.match_employer_asks set asked_at = now() - interval '91 days' where person_id = :pa;
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert((app.match_employer_ask_list(:c1) -> 'counts' ->> 'to_ask') = '6'
                      and (pg_temp.row_of(app.match_employer_ask_list(:c1), :pa) ->> 'last_asked') is not null,
  'C · after 90 days the person can be asked again, and the list says when they were asked before');
select app.ask_match_employers(:c1, array[:pf]::uuid[]) as s4 \gset
select pg_temp.assert((:'s4'::jsonb ->> 'asked') = '1' and (:'s4'::jsonb ->> 'push') = '1' and (:'s4'::jsonb ->> 'email') = '0'
                      and (select count(*) from pg_temp.ask_msgs() where person_id = :pf and template_key = 'match_employer_ask' and channel = 'push') = 1
                      and (select payload ->> 'deep_link' from pg_temp.ask_msgs() where person_id = :pf and template_key = 'match_employer_ask') = '/matching',
  'C · a member with the app is reached by push, and the push opens the matching screen');
reset role;

-- The same community allowed to message everyone: the cap, two calls and the people nobody can reach.
insert into app.center_entitlements (center_id, key, value, reason) values (:c1, 'messaging.recipients', '"all"', 'Test 920: this community may message everyone now');
set role authenticated;
select pg_temp.claims(:lead);
select app.ask_match_employers(:c1, null, 1) as s5 \gset
select pg_temp.assert((:'s5'::jsonb ->> 'asked') = '1' and (:'s5'::jsonb ->> 'left') = '1' and (:'s5'::jsonb ->> 'nobody') = '3',
  'C · a cap of one asks one person; the rest are counted as left; the three nobody can reach are counted apart');
select app.ask_match_employers(:c1) as s6 \gset
select pg_temp.assert((:'s6'::jsonb ->> 'asked') = '1' and (:'s6'::jsonb ->> 'left') = '0' and (:'s6'::jsonb ->> 'nobody') = '3'
                      and (select count(*) from app.match_employer_asks where person_id in (:pe, :pg, :ph)) = 0,
  'C · asking everyone asks the one left; people with no way to reach them get no ask recorded');
select app.ask_match_employers(:c1) as s7 \gset
select pg_temp.assert((:'s7'::jsonb ->> 'asked') = '0' and (select count(*) from pg_temp.ask_msgs() where template_key = 'match_employer_ask') = 4,
  'C · asking again asks nobody: four messages in all (Ana twice, Fay and Bo)');
select pg_temp.assert((select count(*) from pg_temp.ask_msgs() where person_id = :pbs and template_key = 'match_employer_ask') = 0
                      and (select count(*) from pg_temp.ask_msgs() where person_id = :pd and template_key = 'match_employer_ask') = 0
                      and (select count(*) from pg_temp.ask_msgs() where person_id = :pk and template_key = 'match_employer_ask') = 0,
  'C · never the person with an employer on file, the one who withdrew or the child');
reset role;

-- ══ D. Logged, audited, and the module ═══════════════════════════════════════
select pg_temp.assert((select count(*) from app.audit_log where action = 'matching.read' and (after ->> 'what') = 'employer_ask_list') > 0
                      and not exists (select 1 from app.audit_log where action = 'matching.read' and after::text ~ '920')
                      and exists (select 1 from app.audit_log where record_table = 'match_employer_asks' and center_id = :c1),
  'D · every read of the audience is logged without names, and the asks are audited in the organization');
delete from app.center_module_grants where center_id = :c1 and module_key = 'matching';
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format('select app.match_employer_ask_list(%L)', :c1), 'don''t have access', 'D · with CatchTheMatch off nobody reads the audience');
select pg_temp.assert_raises(format('select app.ask_match_employers(%L)', :c1), 'don''t have access', 'D · nor asks');
select pg_temp.assert((select count(*) from app.match_employer_asks where center_id = :c1) = 0, 'D · and the asks are hidden from every direct read');
reset role;
rollback;
