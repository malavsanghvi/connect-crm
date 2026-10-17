-- 0921 (CatchTheMatch Phase 1, piece 1, docs/CATCH_THE_MATCH.md section 13): "Send to the member" through the messaging queue.
--   A. Structure: the helpers are not callable; the preview and the send are, by signed-in people only; the wording and the columns exist.
--   B. The preview: the exact text built in the database from the library (the steps, the gift's day and the last day to ask, the
--      registered name and tax ID; no amount, no address); who it can reach; why it cannot go, in words; who may read it.
--   C. The send: a sandbox queues nothing for an unverified address and records nothing; with a verified recipient the message is queued
--      as the preview said, each claim records that it was asked by message, and the same member is not messaged again for 14 days.
--   D. The app: a member with the app is reached by push.
--   E. The claims list shows when a member was asked by message; reads are logged; the module off, or no access, is refused.
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
create or replace function pg_temp.ask_msgs() returns setof app.messages language sql security definer as $$ select * from app.messages $$;
create or replace function pg_temp.day(d date) returns text language sql as $$ select to_char(d, 'FMDD FMMonth YYYY') $$;

\set c1 '''92100000-0000-4000-8000-0000000000c1'''
\set owner '''92100000-0000-4000-8000-000000000001'''
\set plat '''92100000-0000-4000-8000-000000000002'''
\set lead '''92100000-0000-4000-8000-000000000003'''
\set viewer '''92100000-0000-4000-8000-000000000004'''
\set clerk '''92100000-0000-4000-8000-000000000006'''
\set ufay '''92100000-0000-4000-8000-000000000007'''
\set ha '''92100000-0000-4000-8000-0000000000b1'''
\set hb '''92100000-0000-4000-8000-0000000000b2'''
\set hc '''92100000-0000-4000-8000-0000000000b3'''
\set hd '''92100000-0000-4000-8000-0000000000b4'''
\set hf '''92100000-0000-4000-8000-0000000000b5'''
\set he '''92100000-0000-4000-8000-0000000000b6'''
\set pa '''92100000-0000-4000-8000-0000000000a1'''
\set pb '''92100000-0000-4000-8000-0000000000a2'''
\set pc '''92100000-0000-4000-8000-0000000000a3'''
\set pd '''92100000-0000-4000-8000-0000000000a4'''
\set pf '''92100000-0000-4000-8000-0000000000a5'''
\set pe '''92100000-0000-4000-8000-0000000000a6'''
\set pk '''92100000-0000-4000-8000-0000000000a7'''
\set ga1 '''92100000-0000-4000-8000-00000000f001'''
\set ga2 '''92100000-0000-4000-8000-00000000f002'''
\set gb1 '''92100000-0000-4000-8000-00000000f003'''
\set gc1 '''92100000-0000-4000-8000-00000000f004'''
\set gd1 '''92100000-0000-4000-8000-00000000f005'''
\set gf1 '''92100000-0000-4000-8000-00000000f006'''
\set ge1 '''92100000-0000-4000-8000-00000000f007'''

-- ══ A. Structure ═════════════════════════════════════════════════════════════
select pg_temp.assert(not has_function_privilege('authenticated', 'app._match_claim_prepare(uuid, uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._match_claim_message_text(uuid, uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._match_claim_gifts(uuid, uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._match_reach(uuid, uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.match_claim_message_preview(uuid, uuid, uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.send_match_claim_message(uuid, uuid, uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.send_match_claim_message(uuid, uuid, uuid)', 'execute'),
  'A · the helpers are not callable by a signed-in person; the preview and the send are, and not by anyone signed out');
select pg_temp.assert((select count(*) from app.message_templates where center_id is null and key = 'match_claim_ask' and language = 'en') = 2
                      and (select count(*) from information_schema.columns where table_schema = 'app' and table_name = 'match_claims'
                              and column_name in ('asked_by_message_at', 'asked_message_id')) = 2,
  'A · the wording (email and push) and the two columns that record the message exist');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:owner, 'owner921@c1.test'), (:plat, 'plat921@weaver.test'), (:lead, 'lead921@c1.test'), (:viewer, 'viewer921@c1.test'),
  (:clerk, 'clerk921@c1.test'), (:ufay, 'fay921@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'ctm921a', 'Grace Church 921', 'G921', 'TX', 'active', 'America/Chicago', 'church', 'sandbox');
insert into app.org_profiles (center_id, legal_name, ein) values (:c1, 'Grace Church of Austin 921, Inc.', '12-3456789')
  on conflict (center_id) do update set legal_name = excluded.legal_name, ein = excluded.ein;
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'matching', true, 'Test 921: CatchTheMatch');
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('matching_viewer921', 'center', 'Matching viewer 921', 'center', 'Test 921: matching.view only', '["matching.view"]'),
  ('people_viewer921', 'center', 'People viewer 921', 'center', 'Test 921', '["people.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 921: the platform owner role (holds "*")'),
  (:c1, :lead, 'matching_lead', 'center', 'Test 921'), (:c1, :viewer, 'matching_viewer921', 'center', 'Test 921'),
  (:c1, :clerk, 'people_viewer921', 'center', 'Test 921');
insert into app.households (id, center_id, display_name) values
  (:ha, :c1, 'Alpha921, Ana'), (:hb, :c1, 'Bravo921, Bo'), (:hc, :c1, 'Charlie921, Cy'), (:hd, :c1, 'Delta921, Di'),
  (:hf, :c1, 'Foxtrot921, Fay'), (:he, :c1, 'Echo921, Ed');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:pa, :c1, 'Ana', 'Alpha921', date '1980-01-01', 'ana921@c1.test'), (:pb, :c1, 'Bo', 'Bravo921', date '1975-02-02', 'bo921@c1.test'),
  (:pc, :c1, 'Cy', 'Charlie921', date '1976-03-03', null), (:pd, :c1, 'Di', 'Delta921', date '1970-04-04', 'di921@c1.test'),
  (:pf, :c1, 'Fay', 'Foxtrot921', date '1972-06-06', null), (:pe, :c1, 'Ed', 'Echo921', date '1971-05-05', 'ed921@c1.test'),
  (:pk, :c1, 'Kit', 'Alpha921', (pg_temp.today() - interval '10 years')::date, null);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:ha, :pa, :c1, 'primary', true), (:ha, :pk, :c1, 'child', false), (:hb, :pb, :c1, 'primary', true), (:hc, :pc, :c1, 'primary', true),
  (:hd, :pd, :c1, 'primary', true), (:hf, :pf, :c1, 'primary', true), (:he, :pe, :c1, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c1, :ufay, :pf);
insert into app.push_devices (user_id, center_id, platform, token) values (:ufay, :c1, 'android', 'ExponentPushToken[921fay-token-0001]');
create or replace function pg_temp.gift(p_id uuid, p_h uuid, p_person uuid, p_cents int, p_days int) returns void language sql as $$
  insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at,
                            receipt_number, is_opening_balance, is_historical, refunded_cents)
  values (p_id, '92100000-0000-4000-8000-0000000000c1', p_h, p_person, p_cents, 'check', 'captured', 'offline', pg_temp.today() - p_days,
          now() - make_interval(days => p_days), 'R-921-' || right(p_id::text, 4), false, false, 0)
$$;
select pg_temp.gift(:ga1, :ha, :pa, 10000, 60), pg_temp.gift(:ga2, :ha, :pa, 5000, 20), pg_temp.gift(:gb1, :hb, :pb, 20000, 10),
       pg_temp.gift(:gc1, :hc, :pc, 15000, 15), pg_temp.gift(:gd1, :hd, :pd, 12000, 5), pg_temp.gift(:gf1, :hf, :pf, 9000, 30),
       pg_temp.gift(:ge1, :he, :pe, 8000, 30);
insert into app.message_suppressions (center_id, channel, address, reason, detail) values (:c1, 'email', 'di921@c1.test', 'bounce', 'Test 921');

set role authenticated;
select pg_temp.claims(:plat);
select app.save_match_program(null,
  '{"company_name": "Acme921", "names": ["Acme921 Corp"], "country": "US", "match_ratio_bp": 10000, "min_gift_cents": 2500,
    "portal": "benevity", "portal_url": "https://acme921.benevity.example/match", "deadline_kind": "months_after_gift", "deadline_months": 6,
    "source": "employer_site"}'::jsonb, 'Test 921: Acme') as acme \gset
select app.save_match_program(null, '{"company_name": "Zeta921", "country": "US", "match_ratio_bp": 10000, "source": "other"}'::jsonb, 'Test 921: Zeta') as zeta \gset
select app.save_match_process(:'acme',
  '{"summary": "The member requests the match in Benevity; staff verify it.", "who_submits": "either",
    "steps": ["Sign in to Benevity with your work email", "Find the organization by its legal name and tax ID", "Enter {{amount}} and the gift date"],
    "documents": ["The receipt or bank line of the gift"], "typical_days": 45, "tips": "Request it within 30 days of the gift."}'::jsonb,
  'Test 921: steps') as v1 \gset
select pg_temp.claims(:lead);
select app.record_match_employer(:c1, :pa, 'Acme921 Corp');
select app.record_match_employer(:c1, :pb, 'Acme921 Corp');
select app.record_match_employer(:c1, :pc, 'Acme921 Corp');
select app.record_match_employer(:c1, :pd, 'Acme921 Corp');
select app.record_match_employer(:c1, :pf, 'Acme921 Corp');
select app.record_match_employer(:c1, :pe, 'Zeta921');
select app.link_match_program(:c1, :pa, :'acme');
select app.link_match_program(:c1, :pb, :'acme');
select app.link_match_program(:c1, :pc, :'acme');
select app.link_match_program(:c1, :pd, :'acme');
select app.link_match_program(:c1, :pf, :'acme');
select app.link_match_program(:c1, :pe, :'zeta');
select app.record_match_claim(:c1, :pa, :ga1, 'received', null, 'Benevity paid in the spring');
reset role;
-- Fay's phone is a verified push test recipient; nobody else is.
select set_config('app.messaging_recipient_verified', 'on', true);
insert into app.sandbox_test_recipients (center_id, channel, address, verified_at) values (:c1, 'push', 'fay921@c1.test', now());
select set_config('app.messaging_recipient_verified', '', true);

-- ══ B. The preview ═══════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select app.match_claim_message_preview(:c1, :pb, :'acme') as pv \gset
select pg_temp.assert((:'pv'::jsonb ->> 'problem') is null and (:'pv'::jsonb ->> 'email') = 'true' and (:'pv'::jsonb ->> 'app') = 'false'
                      and jsonb_array_length(:'pv'::jsonb -> 'gifts') = 1 and (:'pv'::jsonb ->> 'employer') = 'Acme921 Corp'
                      and (:'pv'::jsonb -> 'program' ->> 'company_name') = 'Acme921',
  'B · the preview says who, which employer, the gift, and that the person can be reached by email and not by the app');
select pg_temp.assert((:'pv'::jsonb ->> 'body') like E'Hello Bo,\n\nThank you for your gift to Grace Church 921. Acme921 Corp may match it: other members who work there have had a match paid to us, and yours can be claimed too.\n\n%'
                      and (:'pv'::jsonb ->> 'body') like ('%Your gift of ' || pg_temp.day(pg_temp.today() - 10) || ' (ask by ' || pg_temp.day((pg_temp.today() - 10 + interval '6 months')::date) || E')\n%')
                      and (:'pv'::jsonb ->> 'body') like E'%Either the member or the organization can make the request. The member requests the match in Benevity; staff verify it.\n\nHow:\n1. Sign in to Benevity with your work email\n2. Find the organization by its legal name and tax ID\n3. Enter { {amount}} and the gift date\n%'
                      and (:'pv'::jsonb ->> 'body') like E'%\nHave ready: The receipt or bank line of the gift.\n\nIt usually takes about 45 days.\n\nRequest it within 30 days of the gift.\n\nWhere to ask: https://acme921.benevity.example/match\n\nPlease use our registered name and tax ID: Grace Church of Austin 921, Inc., tax ID 12-3456789.\n\nIf anything is unclear, reply and we will help.\n\nThank you,\nGrace Church 921',
  'B · the text is built from the library: the steps in order, the gift''s day and the last day to ask, the registered name and tax ID; a template token in library text stays text');
select pg_temp.assert(position('$' in (:'pv'::jsonb ->> 'body')) = 0 and not ((:'pv'::jsonb ->> 'body') ~ '(20000|200\.00)')
                      and not (:'pv'::jsonb::text like '%bo921@%') and not (:'pv'::jsonb ? 'email_to') and not (:'pv'::jsonb ? 'user_id')
                      and (:'pv'::jsonb ->> 'subject') = 'How to ask Acme921 Corp to match your gift to Grace Church 921',
  'B · no amount, no address and no internal id in the answer; the subject names the employer');
select app.match_claim_message_preview(:c1, :pa, :'acme') as pva \gset
select pg_temp.assert(jsonb_array_length(:'pva'::jsonb -> 'gifts') = 1
                      and (:'pva'::jsonb ->> 'body') like ('%Your gift of ' || pg_temp.day(pg_temp.today() - 20) || '%')
                      and not ((:'pva'::jsonb ->> 'body') like ('%' || pg_temp.day(pg_temp.today() - 60) || '%')),
  'B · only the gifts that can still be claimed are in the text: not the one the employer already matched');
select pg_temp.assert((app.match_claim_message_preview(:c1, :pc, :'acme') ->> 'problem') like 'There is no way to reach this person from Weaver%'
                      and (app.match_claim_message_preview(:c1, :pd, :'acme') ->> 'problem') like 'There is no way to reach this person from Weaver%'
                      and (app.match_claim_message_preview(:c1, :pe, :'acme') ->> 'problem') like '%is not confirmed as Acme921%',
  'B · why it cannot go, in words: no way to reach (no address, or a suppressed one), or the employer is not the one confirmed');
select pg_temp.assert_raises(format('select app.match_claim_message_preview(%L, %L, %L)', :c1, :pk, :'acme'), 'not found', 'B · a child is never shown');
select pg_temp.claims(:viewer);
select pg_temp.assert_raises(format('select app.match_claim_message_preview(%L, %L, %L)', :c1, :pb, :'acme'), 'don''t have access', 'B · a viewer cannot read it (matching.manage)');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises(format('select app.match_claim_message_preview(%L, %L, %L)', :c1, :pb, :'acme'), 'don''t have access', 'B · nor someone without CatchTheMatch');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format('select app.match_claim_message_preview(%L, %L, %L)', :c1, :pb, :'acme'), 'don''t have access', 'B · nor Weaver''s team');
select pg_temp.assert_raises(format('select app.send_match_claim_message(%L, %L, %L)', :c1, :pb, :'acme'), 'don''t have access', 'B · nor send');
reset role;

-- ══ C. The send ══════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:viewer);
select pg_temp.assert_raises(format('select app.send_match_claim_message(%L, %L, %L)', :c1, :pb, :'acme'), 'don''t have access', 'C · a viewer cannot send');
select pg_temp.claims(:lead);
select app.send_match_claim_message(:c1, :pb, :'acme') as s1 \gset
select pg_temp.assert((:'s1'::jsonb ->> 'queued') = 'false'
                      and (:'s1'::jsonb -> 'not_queued') ? 'This community is a sandbox: it messages only verified test recipients (Settings › Limits).'
                      and (select count(*) from pg_temp.ask_msgs() where person_id = :pb and template_key = 'match_claim_ask') = 0
                      and (select count(*) from app.match_claims where person_id = :pb) = 0,
  'C · a sandbox queues nothing for an unverified address, says why in words, and records no claim');
reset role;
insert into app.center_entitlements (center_id, key, value, reason) values (:c1, 'messaging.recipients', '"all"', 'Test 921: this community may message everyone now');
set role authenticated;
select pg_temp.claims(:lead);
select app.send_match_claim_message(:c1, :pb, :'acme') as s2 \gset
select pg_temp.assert((:'s2'::jsonb ->> 'queued') = 'true' and (:'s2'::jsonb ->> 'email') = 'true' and (:'s2'::jsonb ->> 'push') = 'false'
                      and (:'s2'::jsonb ->> 'claims') = '1',
  'C · the message is queued by email; one claim');
select pg_temp.assert((select count(*) from pg_temp.ask_msgs() where person_id = :pb and template_key = 'match_claim_ask' and channel = 'email' and status = 'queued') = 1
                      and (select body from pg_temp.ask_msgs() where person_id = :pb and template_key = 'match_claim_ask') = (:'pv'::jsonb ->> 'body')
                      and (select topic_key from pg_temp.ask_msgs() where person_id = :pb and template_key = 'match_claim_ask') = 'matching'
                      and (select purpose from pg_temp.ask_msgs() where person_id = :pb and template_key = 'match_claim_ask') = 'notification'
                      and (select created_by from pg_temp.ask_msgs() where person_id = :pb and template_key = 'match_claim_ask') = :lead
                      and (select to_address from pg_temp.ask_msgs() where person_id = :pb and template_key = 'match_claim_ask') = 'bo921@c1.test',
  'C · what was queued is the text the preview showed, a notification of the matching topic, sent by the manager, to the address on file');
select pg_temp.assert((select state from app.match_claims where payment_id = :gb1) = 'asked'
                      and (select asked_by_message_at from app.match_claims where payment_id = :gb1) is not null
                      and (select asked_message_id from app.match_claims where payment_id = :gb1) = (select id from pg_temp.ask_msgs() where person_id = :pb and template_key = 'match_claim_ask'),
  'C · the claim is "asked" and records that it was asked by message, and which message');
select pg_temp.assert_raises(format('select app.send_match_claim_message(%L, %L, %L)', :c1, :pb, :'acme'), 'Nothing is left to ask for',
  'C · the same member is not messaged again at once');
reset role;
update app.match_claims set asked_by_message_at = now() - interval '15 days' where payment_id = :gb1;
set role authenticated;
select pg_temp.claims(:lead);
select app.send_match_claim_message(:c1, :pb, :'acme') as s3 \gset
select pg_temp.assert((:'s3'::jsonb ->> 'queued') = 'true' and (:'s3'::jsonb ->> 'claims') = '1'
                      and (select count(*) from pg_temp.ask_msgs() where person_id = :pb and template_key = 'match_claim_ask') = 2
                      and (select count(*) from app.match_claims where payment_id = :gb1) = 1
                      and (select asked_by_message_at from app.match_claims where payment_id = :gb1) > now() - interval '1 minute',
  'C · after 14 days a reminder can go; it is the same claim, asked by message again');
-- Ana: one claim already received (excluded), one gift that can be claimed; no claim exists for it yet.
select app.send_match_claim_message(:c1, :pa, :'acme') as s4 \gset
select pg_temp.assert((:'s4'::jsonb ->> 'claims') = '1' and (select state from app.match_claims where payment_id = :ga2) = 'asked'
                      and (select state from app.match_claims where payment_id = :ga1) = 'received'
                      and (select asked_by_message_at from app.match_claims where payment_id = :ga1) is null,
  'C · a gift with no claim gets one; the claim already received is left alone');
select pg_temp.assert_raises(format('select app.send_match_claim_message(%L, %L, %L)', :c1, :pc, :'acme'), 'There is no way to reach this person',
  'C · a person nobody can reach: refused in words, nothing queued');
select pg_temp.assert((select count(*) from app.match_claims where person_id = :pc) = 0, 'C · and no claim is made for them');
reset role;

-- ══ D. The app ═══════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert((app.match_claim_message_preview(:c1, :pf, :'acme') ->> 'app') = 'true' and (app.match_claim_message_preview(:c1, :pf, :'acme') ->> 'email') = 'false',
  'D · a member with the app and no email is reached by the app');
select app.send_match_claim_message(:c1, :pf, :'acme') as s5 \gset
select pg_temp.assert((:'s5'::jsonb ->> 'queued') = 'true' and (:'s5'::jsonb ->> 'push') = 'true' and (:'s5'::jsonb ->> 'email') = 'false'
                      and (select count(*) from pg_temp.ask_msgs() where person_id = :pf and template_key = 'match_claim_ask' and channel = 'push' and status = 'queued') = 1
                      and (select payload ->> 'type' from pg_temp.ask_msgs() where person_id = :pf and template_key = 'match_claim_ask') = 'match_claim'
                      and (select payload ->> 'deep_link' from pg_temp.ask_msgs() where person_id = :pf and template_key = 'match_claim_ask') = '/matching'
                      and (select body from pg_temp.ask_msgs() where person_id = :pf and template_key = 'match_claim_ask') not like '%$%'
                      and (select asked_by_message_at from app.match_claims where payment_id = :gf1) is not null,
  'D · the push opens the matching screen and carries no amount; the claim records the message');
reset role;

-- ══ E. The list, the logs, the module ════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select app.match_claims_list(:c1, 'open') as cl \gset
select pg_temp.assert((:'cl'::jsonb ->> 'total') = '3'
                      and (select count(*) from jsonb_array_elements(:'cl'::jsonb -> 'rows') e where e ->> 'asked_by_message_at' is not null) = 3
                      and (:'cl'::jsonb -> 'rows' -> 0 -> 'gift' -> 'amount_cents') = 'null'::jsonb,
  'E · the open claims say when each member was asked by message (no amount without giving)');
select app.match_claims_list(:c1, 'ended') as ce \gset
select pg_temp.assert((:'ce'::jsonb ->> 'total') = '1' and (:'ce'::jsonb -> 'rows' -> 0 ->> 'asked_by_message_at') is null,
  'E · a claim the office recorded as received was not asked by message');
reset role;
select pg_temp.assert((select count(*) from app.audit_log where action = 'matching.read' and (after ->> 'what') = 'claim_message_preview') > 0
                      and exists (select 1 from app.audit_log where record_table = 'match_claims' and action like '%update%' and center_id = :c1),
  'E · every preview is a logged read, and the claim changes are audited in the organization');
delete from app.center_module_grants where center_id = :c1 and module_key = 'matching';
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format('select app.match_claim_message_preview(%L, %L, %L)', :c1, :pb, :'acme'), 'don''t have access', 'E · with CatchTheMatch off nobody reads the preview');
select pg_temp.assert_raises(format('select app.send_match_claim_message(%L, %L, %L)', :c1, :pb, :'acme'), 'don''t have access', 'E · nor sends');
reset role;
rollback;
