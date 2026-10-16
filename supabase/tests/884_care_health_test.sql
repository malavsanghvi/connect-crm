-- 0884-0885 (DonorDelight slice 4, docs/DONORDELIGHT.md sections 6 and 12): the facts a household's health is worked out from, and the
-- organization's own numbers.
--   A. The facts: gifts in the last 12 months and the 12 before, first and last gift, taking part (check-ins and shifts, adults only), messages
--      opened, the touches that went well (asks and no-ask), unthanked gifts; months of history; no amount anywhere.
--   B. Who may ask: care.view all households, care.own only the households they own (asking for another is refused for the whole call), at most
--      100 at a time, nobody else, platform admins included.
--   C. The dashboard: donors, kept, last year but not this, some year but not this, retention, first-year retention, the touches, key households
--      with an owner who still holds a care key; care.view only; thank-you speed once the rules are saved.
--   D. Every read is logged without names.
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
-- One household's row of a facts answer.
create or replace function pg_temp.fact(j jsonb, p_household uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(j -> 'rows') e where e ->> 'household_id' = p_household::text
$$;

\set c1 '''88400000-0000-4000-8000-0000000000c1'''
\set owner '''88400000-0000-4000-8000-000000000001'''
\set plat '''88400000-0000-4000-8000-000000000002'''
\set lead '''88400000-0000-4000-8000-000000000003'''
\set rel '''88400000-0000-4000-8000-000000000004'''
\set clerk '''88400000-0000-4000-8000-000000000005'''
\set ha '''88400000-0000-4000-8000-0000000000b1'''
\set hb '''88400000-0000-4000-8000-0000000000b2'''
\set hc '''88400000-0000-4000-8000-0000000000b3'''
\set hd '''88400000-0000-4000-8000-0000000000b4'''
\set he '''88400000-0000-4000-8000-0000000000b5'''
\set hf '''88400000-0000-4000-8000-0000000000b6'''
\set pa1 '''88400000-0000-4000-8000-0000000000a1'''
\set pa2 '''88400000-0000-4000-8000-0000000000a2'''
\set pak '''88400000-0000-4000-8000-0000000000a3'''
\set pb '''88400000-0000-4000-8000-0000000000a4'''
\set pc '''88400000-0000-4000-8000-0000000000a5'''
\set pd '''88400000-0000-4000-8000-0000000000a6'''
\set pe '''88400000-0000-4000-8000-0000000000a7'''
\set pf '''88400000-0000-4000-8000-0000000000a8'''
\set ev '''88400000-0000-4000-8000-0000000000e1'''
\set rs '''88400000-0000-4000-8000-0000000000e2'''
\set rsf '''88400000-0000-4000-8000-0000000000e3'''
\set sh '''88400000-0000-4000-8000-0000000000e4'''
\set cc '''88400000-0000-4000-8000-0000000000d1'''

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:owner, 'owner884@c1.test'), (:plat, 'plat884@weaver.test'), (:lead, 'lead884@c1.test'), (:rel, 'rel884@c1.test'), (:clerk, 'clerk884@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'care884', 'Grace Church 884', 'G884', 'TX', 'active', 'America/Chicago', 'church', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'care', true, 'Test 884: DonorDelight');
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('people_viewer_884', 'center', 'People viewer 884', 'center', 'Test 884', '["people.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 884: the platform owner role (holds "*")'),
  (:c1, :lead, 'care_lead', 'center', 'Test 884'), (:c1, :rel, 'relationship_owner', 'center', 'Test 884'),
  (:c1, :clerk, 'people_viewer_884', 'center', 'Test 884');
insert into app.households (id, center_id, display_name) values
  (:ha, :c1, 'Alpha884, Ama'), (:hb, :c1, 'Bravo884, Bo'), (:hc, :c1, 'Charlie884, Cy'), (:hd, :c1, 'Delta884, Di'), (:he, :c1, 'Echo884, Ed'), (:hf, :c1, 'Fox884, Fay');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pa1, :c1, 'Ama', 'Alpha884', date '1980-01-01'), (:pa2, :c1, 'Abe', 'Alpha884', date '1979-01-01'), (:pak, :c1, 'Ana', 'Alpha884', (current_date - interval '9 years')::date),
  (:pb, :c1, 'Bo', 'Bravo884', date '1975-02-02'), (:pc, :c1, 'Cy', 'Charlie884', date '1976-03-03'), (:pd, :c1, 'Di', 'Delta884', date '1970-04-04'),
  (:pe, :c1, 'Ed', 'Echo884', date '1971-05-05'), (:pf, :c1, 'Fay', 'Fox884', date '1972-06-06');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:ha, :pa1, :c1, 'primary', true), (:ha, :pa2, :c1, 'spouse', false), (:ha, :pak, :c1, 'child', false),
  (:hb, :pb, :c1, 'primary', true), (:hc, :pc, :c1, 'primary', true), (:hd, :pd, :c1, 'primary', true), (:he, :pe, :c1, 'primary', true), (:hf, :pf, :c1, 'primary', true);
insert into app.care_owners (household_id, center_id, owner_user_id, assigned_by) values (:ha, :c1, :rel, :lead), (:hb, :c1, :rel, :lead);

-- Gifts (each recorded the day it was received; 'check', offline).
create or replace function pg_temp.gift(p_h uuid, p_person uuid, p_days int, p_n int) returns void language sql as $$
  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at, receipt_number)
  values ('88400000-0000-4000-8000-0000000000c1', p_h, p_person, 10000 + p_n, 'check', 'captured', 'offline', current_date - p_days, now() - make_interval(days => p_days), 'R-884-' || p_n)
$$;
select pg_temp.gift(:ha, :pa1, 20, 1), pg_temp.gift(:ha, :pa1, 120, 2), pg_temp.gift(:ha, :pa1, 250, 3), pg_temp.gift(:ha, :pa1, 400, 4), pg_temp.gift(:ha, :pa1, 500, 5),
       pg_temp.gift(:hb, :pb, 420, 6), pg_temp.gift(:hb, :pb, 600, 7),
       pg_temp.gift(:hc, :pc, 30, 8), pg_temp.gift(:hc, :pc, 400, 9), pg_temp.gift(:hc, :pc, 500, 10), pg_temp.gift(:hc, :pc, 600, 11),
       pg_temp.gift(:hd, :pd, 800, 12);

-- Taking part: Ama's household has a check-in 10 days ago and a completed shift 15 days ago; Fay's a check-in 5 days ago; a child's check-in never counts.
insert into app.events (id, center_id, name, starts_at, ends_at, status) values
  (:ev, :c1, 'Harvest supper 884', now() - interval '10 days', now() - interval '10 days' + interval '3 hours', 'published');
insert into app.rsvps (id, center_id, event_id, household_id, status) values (:rs, :c1, :ev, :ha, 'rsvpd'), (:rsf, :c1, :ev, :hf, 'rsvpd');
insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, is_child_under_12, status, checked_in_at) values
  (:c1, :ev, :rs, :pa1, 'Ama Alpha884', false, 'confirmed', now() - interval '10 days'),
  (:c1, :ev, :rs, :pak, 'Ana Alpha884', true, 'confirmed', now() - interval '10 days'),
  (:c1, :ev, :rsf, :pf, 'Fay Fox884', false, 'confirmed', now() - interval '5 days');
insert into app.volunteer_shifts (id, center_id, event_id, station, starts_at, ends_at) values
  (:sh, :c1, :ev, 'kitchen', now() - interval '15 days', now() - interval '15 days' + interval '2 hours');
insert into app.volunteer_assignments (center_id, shift_id, person_id, status) values (:c1, :sh, :pa2, 'completed'), (:c1, :sh, :pak, 'completed');
-- Messages: a newsletter Ama opened (counts) and a receipt she opened (never).
insert into app.comms_campaigns (id, center_id, kind, title, status) values (:cc, :c1, 'newsletter', 'Spring newsletter 884', 'sent');
insert into app.messages (center_id, campaign_id, purpose, person_id, channel, to_address, subject, body, status, scheduled_at, sent_at, opened_at, topic_key, template_key) values
  (:c1, :cc, 'campaign', :pa1, 'email', 'ama@example.org', 'News', 'Body', 'sent', now() - interval '3 days', now() - interval '3 days', now() - interval '2 days', null, null),
  (:c1, null, 'receipt', :pa1, 'email', 'ama@example.org', 'Receipt', 'Body', 'sent', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days', 'giving', 'receipt');
-- Touches that went well: three with no ask and one ask for Ama's household; a voided one and one nobody answered never count.
insert into app.care_touches (center_id, household_id, kind, channel, outcome, is_ask, touched_at, by_user_id, voided_at, voided_by, void_reason) values
  (:c1, :ha, 'thank_you', 'phone', 'done', false, now() - interval '40 days', :lead, null, null, null),
  (:c1, :ha, 'check_in', 'in_person', 'done', false, now() - interval '25 days', :lead, null, null, null),
  (:c1, :ha, 'greeting', 'post', 'done', false, now() - interval '8 days', :lead, null, null, null),
  (:c1, :ha, 'other', 'phone', 'done', true, now() - interval '60 days', :lead, null, null, null),
  (:c1, :ha, 'check_in', 'phone', 'done', false, now() - interval '5 days', :lead, now() - interval '4 days', :lead, 'Logged by mistake'),
  (:c1, :ha, 'check_in', 'phone', 'no_answer', false, now() - interval '3 days', :lead, null, null, null),
  (:c1, :hb, 'thank_you', 'phone', 'done', false, now() - interval '400 days', :lead, null, null, null);
select pg_temp.assert(app.module_enabled(:c1, 'care') and app.module_enabled(:c1, 'giving') and app.module_enabled(:c1, 'events'),
  'Fixtures · DonorDelight, Giving and Events are on');

-- ══ A. The facts ═════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select app.care_health_facts(:c1, array[:ha, :hb, :hc, :hd, :he, :hf]::uuid[]) as f \gset
select pg_temp.assert((:'f'::jsonb ->> 'history_months')::int >= 24 and (:'f'::jsonb ->> 'giving')::boolean and (:'f'::jsonb ->> 'today')::date = current_date,
  'A · the community''s history is counted from its earliest gift, in months');
select pg_temp.assert((pg_temp.fact(:'f'::jsonb, :ha) ->> 'gifts_12')::int = 3 and (pg_temp.fact(:'f'::jsonb, :ha) ->> 'gifts_prev_12')::int = 2
                      and (pg_temp.fact(:'f'::jsonb, :ha) ->> 'last_gift_on')::date = current_date - 20 and (pg_temp.fact(:'f'::jsonb, :ha) ->> 'first_gift_on')::date = current_date - 500,
  'A · Alpha: three gifts in the last year, two the year before, with the first and the last day');
select pg_temp.assert((pg_temp.fact(:'f'::jsonb, :hb) ->> 'gifts_12')::int = 0 and (pg_temp.fact(:'f'::jsonb, :hb) ->> 'gifts_prev_12')::int = 2
                      and (pg_temp.fact(:'f'::jsonb, :hc) ->> 'gifts_12')::int = 1 and (pg_temp.fact(:'f'::jsonb, :hc) ->> 'gifts_prev_12')::int = 3
                      and (pg_temp.fact(:'f'::jsonb, :hd) ->> 'gifts_12')::int = 0 and (pg_temp.fact(:'f'::jsonb, :hd) ->> 'gifts_prev_12')::int = 0
                      and (pg_temp.fact(:'f'::jsonb, :hd) ->> 'last_gift_on')::date = current_date - 800,
  'A · Bravo gave only the year before, Charlie gave less, Delta gave long ago');
select pg_temp.assert((pg_temp.fact(:'f'::jsonb, :he) ->> 'gifts_12')::int = 0 and (pg_temp.fact(:'f'::jsonb, :he) -> 'last_gift_on') = 'null'::jsonb
                      and (pg_temp.fact(:'f'::jsonb, :he) ->> 'part_12')::int = 0 and (pg_temp.fact(:'f'::jsonb, :he) -> 'last_part_on') = 'null'::jsonb
                      and (pg_temp.fact(:'f'::jsonb, :he) ->> 'touches_12')::int = 0,
  'A · Echo has nothing on record, and says null, not zero days ago');
select pg_temp.assert((pg_temp.fact(:'f'::jsonb, :ha) ->> 'part_12')::int = 2 and (pg_temp.fact(:'f'::jsonb, :ha) ->> 'last_part_on')::date = current_date - 10
                      and (pg_temp.fact(:'f'::jsonb, :hf) ->> 'part_12')::int = 1 and (pg_temp.fact(:'f'::jsonb, :hf) ->> 'gifts_12')::int = 0,
  'A · taking part counts an adult''s check-in and shift, never a child''s; a household that never gave can still take part');
select pg_temp.assert((pg_temp.fact(:'f'::jsonb, :ha) ->> 'opened_12')::int = 1, 'A · a newsletter an adult opened counts; a receipt never does');
select pg_temp.assert((pg_temp.fact(:'f'::jsonb, :ha) ->> 'touches_12')::int = 4 and (pg_temp.fact(:'f'::jsonb, :ha) ->> 'asks_12')::int = 1
                      and (pg_temp.fact(:'f'::jsonb, :ha) ->> 'no_ask_12')::int = 3
                      and (pg_temp.fact(:'f'::jsonb, :ha) ->> 'last_touch_at')::timestamptz > now() - interval '9 days',
  'A · touches count only those that went well: three with no ask, one ask; a voided one and an unanswered call do not');
select pg_temp.assert((pg_temp.fact(:'f'::jsonb, :hb) ->> 'touches_12')::int = 0 and (pg_temp.fact(:'f'::jsonb, :hb) ->> 'last_touch_at') is not null,
  'A · an old touch is the last one but not one of the last 12 months');
select pg_temp.assert((pg_temp.fact(:'f'::jsonb, :ha) -> 'unthanked') = 'null'::jsonb, 'A · unthanked is null until the thank-you rules are saved');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(:'f'::jsonb -> 'rows') e, jsonb_object_keys(e) k where k ~* 'amount|cents|total|sum'),
  'A · no amount anywhere in a household''s facts');
select pg_temp.claims(:owner);
select app.save_care_settings(:c1, '{}'::jsonb);
select pg_temp.claims(:lead);
select pg_temp.assert((pg_temp.fact(app.care_health_facts(:c1, array[:ha]::uuid[]), :ha) ->> 'unthanked')::int = 0,
  'A · once the rules are saved, a household whose gifts all pre-date them has no gift waiting');

-- ══ B. Who may ask ═══════════════════════════════════════════════════════════
select pg_temp.claims(:rel);
select pg_temp.assert(jsonb_array_length(app.care_health_facts(:c1, array[:ha, :hb]::uuid[]) -> 'rows') = 2, 'B · a relationship owner reads the facts of the households they own');
select pg_temp.assert_raises(format($$select app.care_health_facts(%L, array[%L, %L]::uuid[])$$, '88400000-0000-4000-8000-0000000000c1', '88400000-0000-4000-8000-0000000000b1', '88400000-0000-4000-8000-0000000000b3'),
  'don''t have access', 'B · asking for one they do not own refuses the whole call');
select pg_temp.assert(jsonb_array_length(app.care_health_facts(:c1, '{}'::uuid[]) -> 'rows') = 0, 'B · asking for no household answers an empty list');
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format($$select app.care_health_facts(%L, (select array_agg(gen_random_uuid()) from generate_series(1, 101)))$$, '88400000-0000-4000-8000-0000000000c1'),
  'at most 100', 'B · at most 100 households at a time');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises(format($$select app.care_health_facts(%L, array[%L]::uuid[])$$, '88400000-0000-4000-8000-0000000000c1', '88400000-0000-4000-8000-0000000000b1'),
  'don''t have access', 'B · people.view alone sees nothing');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format($$select app.care_health_facts(%L, array[%L]::uuid[])$$, '88400000-0000-4000-8000-0000000000c1', '88400000-0000-4000-8000-0000000000b1'),
  'don''t have access', 'B · a platform admin sees nothing');
select pg_temp.assert_raises($$select app.care_dashboard('88400000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'B · nor the dashboard');

-- ══ C. The organization's numbers ════════════════════════════════════════════
select pg_temp.claims(:rel);
select pg_temp.assert_raises($$select app.care_dashboard('88400000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'C · a relationship owner (care.own) does not see the organization''s totals');
select pg_temp.claims(:lead);
select app.care_dashboard(:c1) as d \gset
select pg_temp.assert((:'d'::jsonb ->> 'state') = 'ok' and (:'d'::jsonb ->> 'history_months')::int >= 24, 'C · the dashboard answers, with the months of history');
select pg_temp.assert((:'d'::jsonb -> 'giving' ->> 'donors_last')::int = 2 and (:'d'::jsonb -> 'giving' ->> 'donors_prev')::int = 3
                      and (:'d'::jsonb -> 'giving' ->> 'kept')::int = 2 and (:'d'::jsonb -> 'giving' ->> 'lybunt')::int = 1
                      and (:'d'::jsonb -> 'giving' ->> 'sybunt')::int = 2 and (:'d'::jsonb -> 'giving' ->> 'retention')::numeric = 0.667,
  'C · donors, kept, last year but not this, some year but not this, and retention (two of three)');
select pg_temp.assert((:'d'::jsonb -> 'giving' -> 'first_year' ->> 'cohort')::int = 3 and (:'d'::jsonb -> 'giving' -> 'first_year' ->> 'kept')::int = 2
                      and (:'d'::jsonb -> 'giving' -> 'first_year' ->> 'rate')::numeric = 0.667,
  'C · first-year retention: three households began last year, two gave again');
select pg_temp.assert((:'d'::jsonb -> 'touches' ->> 'asks')::int = 1 and (:'d'::jsonb -> 'touches' ->> 'no_ask')::int = 3 and (:'d'::jsonb -> 'touches' ->> 'per_ask')::numeric = 3.0,
  'C · three no-ask touches for one ask');
select pg_temp.assert((:'d'::jsonb -> 'key' ->> 'households')::int = 3 and (:'d'::jsonb -> 'key' ->> 'with_owner')::int = 2 and (:'d'::jsonb -> 'key' ->> 'share')::numeric = 0.667,
  'C · three key households (a gift in the last two years), two with an owner who holds a care key');
select pg_temp.assert((:'d'::jsonb -> 'thanks') <> 'null'::jsonb and (:'d'::jsonb -> 'thanks' ->> 'gifts')::int = 0,
  'C · the thank-you speed is there once the rules are saved (no gift of the last 90 days was thanked yet)');
select pg_temp.assert(not exists (select 1 from jsonb_path_query(:'d'::jsonb, '$.**') v where jsonb_typeof(v) = 'string' and v #>> '{}' ~ '884'),
  'C · the dashboard names no household');
reset role;
-- An owner who has lost their care role no longer counts as an owner.
update app.role_grants set status = 'revoked' where center_id = :c1 and user_id = :rel and role_key = 'relationship_owner';
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert((app.care_dashboard(:c1) -> 'key' ->> 'with_owner')::int = 0, 'C · an owner who no longer holds a care key does not count');
reset role;
-- Giving off: the giving numbers go, the rest stays.
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'giving', false, 'Test 884: Giving off')
  on conflict (center_id, module_key) do update set granted = false;
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert((app.care_dashboard(:c1) -> 'giving') = 'null'::jsonb and (app.care_dashboard(:c1) -> 'thanks') = 'null'::jsonb
                      and (app.care_dashboard(:c1) -> 'touches' ->> 'asks')::int = 1,
  'C · with Giving off the giving and thank-you numbers are null and the touches still show');

-- ══ D. Logged ════════════════════════════════════════════════════════════════
reset role;
select pg_temp.assert((select count(*) from app.audit_log where action = 'care.read' and (after ->> 'what') = 'health') > 0
                      and (select count(*) from app.audit_log where action = 'care.read' and (after ->> 'what') = 'dashboard') > 0
                      and not exists (select 1 from app.audit_log where action = 'care.read' and after::text ~ '884'),
  'D · every read is logged (who, when, what, how many) and names no one');
rollback;
