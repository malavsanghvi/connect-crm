-- 0881-0883 (DonorDelight slice 3, docs/DONORDELIGHT.md sections 5.4 and 12): the thank-you rules and the thank-you tracker.
--   A. The rules: defaults, saving, the first-save-only "include the last 30 days", who may save (a manager, support with the care.settings area).
--   B. Which gifts open a step: donations that went through, never fees, opening balances, history imports, a child's payment, a failed,
--      clearing or fully refunded one, a repeat of a standing recurring gift; due days; first gift and amount threshold make it personal.
--   C. Closing, read live: a receipt closes an ordinary step, a thank-you touch (done, not voided) closes any, only a call, visit, card or
--      video closes a personal one; voiding the touch opens it again.
--   D. Setting a step aside with a reason, and undoing it.
--   E. Who sees which: care.view all, care.own only their households, amounts only with giving.view; nobody else, platform admins included.
--   F. The summary, the Care card's list, states (not set up, Giving off), every read logged without names, a merge carries the step.
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
-- The ids of a queue answer, in order, and the step of one gift.
create or replace function pg_temp.ids(j jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((e->>'id')::uuid order by i), '{}') from jsonb_array_elements(j->'rows') with ordinality as x(e, i)
$$;
create or replace function pg_temp.step(p_payment uuid) returns uuid language sql as $$ select id from app.care_thanks where payment_id = p_payment $$;
create or replace function pg_temp.has_step(p_payment uuid) returns boolean language sql as $$ select exists (select 1 from app.care_thanks where payment_id = p_payment) $$;

\set c1 '''88100000-0000-4000-8000-0000000000c1'''
\set owner '''88100000-0000-4000-8000-000000000001'''
\set plat '''88100000-0000-4000-8000-000000000002'''
\set lead '''88100000-0000-4000-8000-000000000003'''
\set fin '''88100000-0000-4000-8000-000000000004'''
\set rel '''88100000-0000-4000-8000-000000000005'''
\set viewer '''88100000-0000-4000-8000-000000000006'''
\set clerk '''88100000-0000-4000-8000-000000000007'''
\set sup '''88100000-0000-4000-8000-000000000008'''
\set h1 '''88100000-0000-4000-8000-0000000000b1'''
\set h2 '''88100000-0000-4000-8000-0000000000b2'''
\set h3 '''88100000-0000-4000-8000-0000000000b3'''
\set pa '''88100000-0000-4000-8000-0000000000a1'''
\set pb '''88100000-0000-4000-8000-0000000000a2'''
\set pk '''88100000-0000-4000-8000-0000000000a3'''
\set pc '''88100000-0000-4000-8000-0000000000a4'''
\set pd '''88100000-0000-4000-8000-0000000000a5'''
\set pl '''88100000-0000-4000-8000-0000000000d1'''
-- Payments (the p-names say what each is for).
\set g1 '''88100000-0000-4000-8000-0000000000f1'''
\set g2 '''88100000-0000-4000-8000-0000000000f2'''
\set g3 '''88100000-0000-4000-8000-0000000000f3'''
\set gfee '''88100000-0000-4000-8000-0000000000f4'''
\set gopen '''88100000-0000-4000-8000-0000000000f5'''
\set ghist '''88100000-0000-4000-8000-0000000000f6'''
\set gkid '''88100000-0000-4000-8000-0000000000f7'''
\set gfail '''88100000-0000-4000-8000-0000000000f8'''
\set gclear '''88100000-0000-4000-8000-0000000000f9'''
\set gref '''88100000-0000-4000-8000-0000000000fa'''
\set gold '''88100000-0000-4000-8000-0000000000fb'''
\set r1 '''88100000-0000-4000-8000-0000000000fc'''
\set r2 '''88100000-0000-4000-8000-0000000000fd'''
\set gbig '''88100000-0000-4000-8000-0000000000fe'''

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:owner, 'owner881@c1.test'), (:plat, 'plat881@weaver.test'), (:lead, 'lead881@c1.test'), (:fin, 'fin881@c1.test'),
  (:rel, 'rel881@c1.test'), (:viewer, 'viewer881@c1.test'), (:clerk, 'clerk881@c1.test'), (:sup, 'sup881@weaver.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'care881', 'Grace Church 881', 'G881', 'TX', 'active', 'America/Chicago', 'church', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'care', true, 'Test 881: DonorDelight');
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('care_viewer_881', 'center', 'Care viewer 881', 'center', 'Test 881', '["care.view"]'),
  ('people_viewer_881', 'center', 'People viewer 881', 'center', 'Test 881', '["people.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 881: the platform owner role (holds "*")'),
  (:c1, :lead, 'care_lead', 'center', 'Test 881'),
  (:c1, :fin, 'care_lead', 'center', 'Test 881'), (:c1, :fin, 'treasurer', 'center', 'Test 881: giving.view'),
  (:c1, :rel, 'relationship_owner', 'center', 'Test 881'),
  (:c1, :viewer, 'care_viewer_881', 'center', 'Test 881'), (:c1, :clerk, 'people_viewer_881', 'center', 'Test 881');
insert into app.support_grants (center_id, grantee_user_id, granted_by, expires_at, reason, areas) values
  (:c1, :sup, :owner, now() + interval '2 days', 'Test 881: DonorDelight settings', array['care.settings']);
insert into app.households (id, center_id, display_name) values
  (:h1, :c1, 'Mensah881, Ama'), (:h2, :c1, 'Lee881, Jo'), (:h3, :c1, 'Okafor881, Chidi');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pa, :c1, 'Ama', 'Mensah881', date '1981-01-01'), (:pb, :c1, 'Kofi', 'Mensah881', date '1978-02-02'),
  (:pk, :c1, 'Esi', 'Mensah881', ((now() at time zone 'America/Chicago')::date - interval '8 years')::date), (:pc, :c1, 'Jo', 'Lee881', date '1970-03-03'),
  (:pd, :c1, 'Chidi', 'Okafor881', date '1975-04-04');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :pa, :c1, 'primary', true), (:h1, :pb, :c1, 'spouse', false), (:h1, :pk, :c1, 'child', false),
  (:h2, :pc, :c1, 'primary', true), (:h3, :pd, :c1, 'primary', true);
insert into app.care_owners (household_id, center_id, owner_user_id, assigned_by) values (:h1, :c1, :rel, :lead);

-- The gifts. created_at says when each was recorded: five days ago for the oldest, so its thank-you is overdue.
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at, receipt_number) values
  (:g1,   :c1, :h1, :pa, 12000, 'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - 5, now() - interval '5 days', 'R-881-1'),
  (:g3,   :c1, :h2, :pc, 5000,  'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - 1, now() - interval '1 day',  'R-881-3'),
  (:gbig, :c1, :h2, :pc, 90000, 'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - 1, now() - interval '1 day' + interval '1 minute', 'R-881-14'),
  (:r1,   :c1, :h3, :pd, 2000,  'card',  'captured', 'offline', (now() at time zone 'America/Chicago')::date - 20, now() - interval '20 days', 'R-881-12'),
  (:r2,   :c1, :h3, :pd, 2000,  'card',  'captured', 'offline', (now() at time zone 'America/Chicago')::date - 1, now() - interval '1 day', 'R-881-13');
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at, receipt_number, receipt_sent_at) values
  (:g2,   :c1, :h1, :pb, 3000,  'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - 2, now() - interval '2 days', 'R-881-2', now() - interval '2 days' + interval '1 hour');
-- Never a step: a membership fee, an opening balance, a history import, a child's payment, a failed one, one still clearing,
-- one refunded in full, one from before the rules began.
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at, receipt_number, is_opening_balance, is_historical, refunded_cents) values
  (:gfee,  :c1, :h2, :pc, 4000, 'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - 3, now() - interval '3 days', 'R-881-4', false, false, 0),
  (:gopen, :c1, :h2, :pc, 4100, 'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - 3, now() - interval '3 days', 'R-881-5', true, true, 0),
  (:ghist, :c1, :h2, :pc, 4200, 'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - 3, now() - interval '3 days', 'R-881-6', false, true, 0),
  (:gkid,  :c1, :h1, :pk, 300,  'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - 3, now() - interval '3 days', 'R-881-7', false, false, 0),
  (:gfail, :c1, :h2, :pc, 4400, 'check', 'failed',   'offline', (now() at time zone 'America/Chicago')::date - 3, now() - interval '3 days', 'R-881-8', false, false, 0),
  (:gclear,:c1, :h2, :pc, 4500, 'check', 'pending_clearing', 'offline', (now() at time zone 'America/Chicago')::date - 3, now() - interval '3 days', 'R-881-9', false, false, 0),
  (:gref,  :c1, :h2, :pc, 4600, 'check', 'partially_refunded', 'offline', (now() at time zone 'America/Chicago')::date - 3, now() - interval '3 days', 'R-881-10', false, false, 4600),
  (:gold,  :c1, :h2, :pc, 4700, 'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - 90, now() - interval '90 days', 'R-881-11', false, false, 0);
insert into app.pledges (id, center_id, household_id, source, amount_cents) values (:pl, :c1, :h2, 'membership_fee', 4000);
insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents) values (:c1, :gfee, :pl, 4000);
-- Ordinary households with a recurring gift: the second gift of the same amount is a repeat.
insert into app.recurring_gifts (center_id, household_id, person_id, amount_cents, frequency, method, status) values
  (:c1, :h3, :pd, 2000, 'monthly', 'card', 'active');
select pg_temp.assert(app.module_enabled(:c1, 'care') and app.module_enabled(:c1, 'giving') and app._care_today(:c1) = (now() at time zone 'America/Chicago')::date,
  'Fixtures · DonorDelight and Giving are on, and the community''s day is today');

-- ══ A. The rules ═════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert((app.care_settings_get(:c1) ->> 'saved')::boolean = false and (app.care_settings_get(:c1) ->> 'thank_window_days')::int = 2
                      and (app.care_settings_get(:c1) ->> 'first_gift_personal')::boolean and (app.care_settings_get(:c1) ->> 'count_fees')::boolean = false
                      and (app.care_settings_get(:c1) ->> 'thanks_from') is null,
  'A · before anything is saved the defaults show: 2 days, a first gift is personal, fees are not thanked, no first day');
select pg_temp.assert(app.care_thanks_queue(:c1) ->> 'state' = 'not_set_up' and (app.care_thanks_queue(:c1) ->> 'can_manage')::boolean
                      and app.care_thanks_summary(:c1) ->> 'state' = 'not_set_up'
                      and app.care_household_thanks(:h1) ->> 'state' = 'not_set_up',
  'A · nothing is thanked, and the screens are told so, until the rules are saved');
select pg_temp.assert((select count(*) from app.care_thanks) = 0, 'A · no step is opened before the rules are saved');
select pg_temp.assert_raises($$select app.save_care_settings('88100000-0000-4000-8000-0000000000c1', '{"thank_window_days": 45}')$$,
  'within 1 to 30 days', 'A · a window outside 1 to 30 days is refused');
select pg_temp.assert_raises($$select app.save_care_settings('88100000-0000-4000-8000-0000000000c1', '{"colour": "blue"}')$$,
  'no field "colour"', 'A · an unknown field is refused');
select pg_temp.assert_raises($$select app.save_care_settings('88100000-0000-4000-8000-0000000000c1', '{"personal_from_cents": 12.5}')$$,
  'whole number of cents', 'A · a fractional amount is refused');
select pg_temp.assert_raises($$select app.save_care_settings('88100000-0000-4000-8000-0000000000c1', '{"personal_from_cents": 0}')$$,
  'more than zero', 'A · a zero amount is refused');
select pg_temp.assert((app.save_care_settings(:c1, '{"personal_from_cents": 50000}', true) ->> 'thanks_from')::date = (now() at time zone 'America/Chicago')::date - 30
                      and (app.care_settings_get(:c1) ->> 'saved')::boolean and (app.care_settings_get(:c1) ->> 'personal_from_cents')::bigint = 50000
                      and (app.care_settings_get(:c1) ->> 'thank_window_days')::int = 2,
  'A · the first save with the last 30 days starts 30 days back; what was left out keeps its default');
select pg_temp.assert_raises($$select app.save_care_settings('88100000-0000-4000-8000-0000000000c1', '{}', true)$$,
  'only when the rules are first saved', 'A · including the last 30 days is for the first save only');
select pg_temp.assert((app.save_care_settings(:c1, '{"thank_window_days": 3}') ->> 'thanks_from')::date = (now() at time zone 'America/Chicago')::date - 30
                      and (app.care_settings_get(:c1) ->> 'thank_window_days')::int = 3
                      and (app.care_settings_get(:c1) ->> 'personal_from_cents')::bigint = 50000,
  'A · a later save changes only what it names and keeps the first day');
select app.save_care_settings(:c1, '{"thank_window_days": 2}');
reset role;
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'care_settings' and module = 'care') >= 2
                      and not exists (select 1 from app.audit_log where record_table = 'care_settings' and (after::text like '%care881%')),
  'A · every change to the rules is audited under DonorDelight, with no free text');

set role authenticated;
select pg_temp.claims(:rel);
select pg_temp.assert_raises($$select app.save_care_settings('88100000-0000-4000-8000-0000000000c1', '{"thank_window_days": 5}')$$,
  'don''t have access', 'A · a relationship owner (care.own) cannot save the rules');
select pg_temp.assert((app.care_settings_get(:c1) ->> 'can_manage')::boolean = false and (app.care_settings_get(:c1) ->> 'thank_window_days')::int = 2,
  'A · but reads them, without the right to change them');
select pg_temp.claims(:viewer);
select pg_temp.assert_raises($$select app.save_care_settings('88100000-0000-4000-8000-0000000000c1', '{"thank_window_days": 5}')$$,
  'don''t have access', 'A · nor can care.view alone');
select pg_temp.claims(:sup);
select pg_temp.assert((app.save_care_settings(:c1, '{"thank_window_days": 2}') ->> 'saved')::boolean and (app.care_settings_get(:c1) ->> 'can_manage')::boolean,
  'A · Weaver support, while the owner''s support grant names care.settings, may save the settings (W8)');
select pg_temp.assert_raises($$select app.care_thanks_queue('88100000-0000-4000-8000-0000000000c1')$$,
  'don''t have access', 'A · and still reads no thank-you list');

-- ══ B. Which gifts open a step ═══════════════════════════════════════════════
select pg_temp.claims(:lead);
select app.care_thanks_queue(:c1, 'open', 100) as q \gset
reset role;
select pg_temp.assert(pg_temp.has_step(:g1) and pg_temp.has_step(:g2) and pg_temp.has_step(:g3) and pg_temp.has_step(:gbig) and pg_temp.has_step(:r1),
  'B · the real gifts open a step: a check, a check from a spouse, a first gift, a large gift, a first recurring gift');
select pg_temp.assert(not pg_temp.has_step(:gfee) and not pg_temp.has_step(:gopen) and not pg_temp.has_step(:ghist) and not pg_temp.has_step(:gkid)
                      and not pg_temp.has_step(:gfail) and not pg_temp.has_step(:gclear) and not pg_temp.has_step(:gref) and not pg_temp.has_step(:gold),
  'B · never a fee, an opening balance, a history import, a child''s payment, a failed, clearing or fully refunded one, or one from before the rules');
select pg_temp.assert(not pg_temp.has_step(:r2), 'B · a repeat of a standing recurring gift is not thanked again');
select pg_temp.assert((select due_on from app.care_thanks where payment_id = :g1) = (now() at time zone 'America/Chicago')::date - 5 + 2
                      and (select due_on from app.care_thanks where payment_id = :g3) = (now() at time zone 'America/Chicago')::date - 1 + 2,
  'B · each step is due the window after the gift (recorded late: after the day it was recorded)');
select pg_temp.assert((select needs_personal from app.care_thanks where payment_id = :g1)
                      and not (select needs_personal from app.care_thanks where payment_id = :g2)
                      and not (select needs_personal from app.care_thanks where payment_id = :g3)
                      and (select needs_personal from app.care_thanks where payment_id = :gbig)
                      and (select needs_personal from app.care_thanks where payment_id = :r1),
  'B · a household''s first gift is personal, a later one is not (a gift before the rules began still counts as the first), and a gift from the amount the rules name is personal');
select pg_temp.assert((select count(*) from app.care_thanks) = 5, 'B · exactly five steps');
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert(app.care_thanks_queue(:c1, 'open', 100) = (app.care_thanks_queue(:c1, 'open', 100)) and (select count(*) from app.care_thanks) = 5,
  'B · asking again opens nothing more (idempotent)');

-- ══ C. Closing, read live ════════════════════════════════════════════════════
select pg_temp.assert(pg_temp.ids(app.care_thanks_queue(:c1, 'open', 100)) = array[pg_temp.step(:r1), pg_temp.step(:g1), pg_temp.step(:g3), pg_temp.step(:gbig)]
                      and (app.care_thanks_queue(:c1) -> 'counts' ->> 'open')::int = 4,
  'C · the open list is oldest due day first; the gift whose receipt was sent is not in it');
select pg_temp.assert(pg_temp.ids(app.care_thanks_queue(:c1, 'done', 100)) = array[pg_temp.step(:g2)]
                      and (app.care_thanks_queue(:c1, 'done') -> 'rows' -> 0 ->> 'how') = 'receipt',
  'C · an ordinary step closes with the receipt sent');
select pg_temp.assert(pg_temp.ids(app.care_thanks_queue(:c1, 'overdue', 100)) = array[pg_temp.step(:r1), pg_temp.step(:g1)]
                      and (app.care_thanks_queue(:c1, 'overdue', 100) -> 'rows' -> 1 ->> 'days_overdue')::int = 3,
  'C · overdue is open and past its due day, with the days late');
-- The receipt does not close a personal step. An email thank-you does not either; neither does a call nobody answered.
select app.log_care_touch(:h1, '{"kind":"thank_you","channel":"email"}') as t_email \gset
select app.log_care_touch(:h1, '{"kind":"thank_you","channel":"phone","outcome":"no_answer"}') as t_noans \gset
select app.log_care_touch(:h1, '{"kind":"check_in","channel":"phone"}') as t_other \gset
select pg_temp.assert(pg_temp.step(:g1) = any (pg_temp.ids(app.care_thanks_queue(:c1, 'open', 100))),
  'C · a personal step stays open for an email thank-you, an unanswered call and a touch that was not a thank-you');
select pg_temp.assert(not (pg_temp.step(:g1) = any (pg_temp.ids(app.care_thanks_queue(:c1, 'done', 100)))), 'C · and is not done');
select app.log_care_touch(:h1, jsonb_build_object('kind', 'thank_you', 'channel', 'phone')) as t_call \gset
select pg_temp.assert(pg_temp.step(:g1) = any (pg_temp.ids(app.care_thanks_queue(:c1, 'done', 100)))
                      and (select (e ->> 'how') = 'touch' from jsonb_array_elements(app.care_thanks_queue(:c1, 'done', 100) -> 'rows') e where e ->> 'id' = pg_temp.step(:g1)::text),
  'C · a call that went well closes the personal step');
select app.void_care_touch(:'t_call', 'Logged by mistake');
select pg_temp.assert(pg_temp.step(:g1) = any (pg_temp.ids(app.care_thanks_queue(:c1, 'open', 100))),
  'C · voiding that touch opens the step again');
-- A card closes the first gift of the other household; an email would have closed an ordinary one.
select app.log_care_touch(:h2, jsonb_build_object('kind', 'thank_you', 'channel', 'post')) as t_card \gset
select pg_temp.assert(pg_temp.step(:g3) = any (pg_temp.ids(app.care_thanks_queue(:c1, 'done', 100)))
                      and pg_temp.step(:gbig) = any (pg_temp.ids(app.care_thanks_queue(:c1, 'done', 100))),
  'C · one card thanks every gift of that household that came before it');

-- ══ D. Set aside ═════════════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select app.set_aside_care_thank(%L, '  ')$$, pg_temp.step(:g1)), 'say why', 'D · a reason is required');
select app.set_aside_care_thank(pg_temp.step(:g1), 'A test gift the treasurer entered');
select pg_temp.assert(pg_temp.ids(app.care_thanks_queue(:c1, 'set_aside', 100)) = array[pg_temp.step(:g1)]
                      and not (pg_temp.step(:g1) = any (pg_temp.ids(app.care_thanks_queue(:c1, 'open', 100))))
                      and (app.care_thanks_queue(:c1, 'set_aside') -> 'rows' -> 0 ->> 'set_aside_reason') = 'A test gift the treasurer entered',
  'D · a step set aside leaves the open list, with its reason');
select app.reopen_care_thank(pg_temp.step(:g1));
select pg_temp.assert(pg_temp.step(:g1) = any (pg_temp.ids(app.care_thanks_queue(:c1, 'open', 100))), 'D · and comes back when reopened');
-- ══ E. Who sees which ════════════════════════════════════════════════════════
reset role;
select pg_temp.step(:g1) as s_g1, pg_temp.step(:g2) as s_g2, pg_temp.step(:g3) as s_g3, pg_temp.step(:gbig) as s_gbig, pg_temp.step(:r1) as s_r1 \gset
set role authenticated;
select pg_temp.claims(:rel);
select pg_temp.assert(pg_temp.ids(app.care_thanks_queue(:c1, 'open', 100)) = array[:'s_g1'::uuid]
                      and pg_temp.ids(app.care_thanks_queue(:c1, 'done', 100)) = array[:'s_g2'::uuid]
                      and (app.care_thanks_queue(:c1) -> 'counts' ->> 'open')::int = 1,
  'E · a relationship owner (care.own) sees the steps of the households they own, and the counts are theirs only');
select pg_temp.assert((app.care_thanks_queue(:c1, 'open', 100) ->> 'amounts')::boolean = false
                      and (app.care_thanks_queue(:c1, 'open', 100) -> 'rows' -> 0 -> 'amount_cents') = 'null'::jsonb,
  'E · without giving.view the amount is null: "Thank them warmly"');
select pg_temp.assert(jsonb_array_length(app.care_household_thanks(:h1) -> 'open') = 1,
  'E · the Care card list for their own household');
select pg_temp.assert_raises(format($$select app.care_household_thanks(%L)$$, '88100000-0000-4000-8000-0000000000b2'), 'don''t have access',
  'E · but not for a household they do not own');
select pg_temp.assert_raises(format($$select app.set_aside_care_thank(%L, 'not mine')$$, :'s_g3'::uuid), 'don''t have access',
  'E · nor can they set aside a step of one');
select pg_temp.claims(:viewer);
select pg_temp.assert(pg_temp.ids(app.care_thanks_queue(:c1, 'open', 100)) = array[:'s_r1'::uuid, :'s_g1'::uuid]
                      and (app.care_thanks_queue(:c1, 'open', 100) ->> 'amounts')::boolean = false,
  'E · care.view sees every household''s steps, still without amounts');
select pg_temp.claims(:fin);
select pg_temp.assert((app.care_thanks_queue(:c1, 'open', 100) ->> 'amounts')::boolean
                      and (select (e ->> 'amount_cents')::bigint from jsonb_array_elements(app.care_thanks_queue(:c1, 'open', 100) -> 'rows') e where e ->> 'id' = :'s_g1'::uuid::text) = 12000
                      and (select (e ->> 'amount_cents')::bigint from jsonb_array_elements(app.care_thanks_queue(:c1, 'done', 100) -> 'rows') e where e ->> 'id' = :'s_gbig'::uuid::text) = 90000,
  'E · with giving.view as well, the amounts show');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises($$select app.care_thanks_queue('88100000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'E · people.view alone sees nothing');
select pg_temp.assert_raises($$select app.care_thanks_summary('88100000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'E · nor the summary');
select pg_temp.claims(:plat);
select pg_temp.assert_raises($$select app.care_thanks_queue('88100000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'E · a platform admin sees nothing of it');
select pg_temp.assert_raises($$select app.save_care_settings('88100000-0000-4000-8000-0000000000c1', '{}')$$, 'don''t have access', 'E · nor changes the rules without a support grant');
select set_config('request.jwt.claims', '', true);
select pg_temp.assert_raises($$select app.care_thanks_queue('88100000-0000-4000-8000-0000000000c1')$$, 'sign in first', 'E · nobody signed in sees nothing');
reset role;
select pg_temp.assert(not exists (select 1 from information_schema.columns where table_schema = 'app' and table_name = 'care_thanks'
                                   and column_name in ('amount_cents', 'household_id', 'donation_cents')),
  'E · the step table keeps no amount and no household: both are read from the payment');
select pg_temp.assert(not has_table_privilege('authenticated', 'app.care_thanks', 'insert') and not has_table_privilege('authenticated', 'app.care_settings', 'update'),
  'E · nobody writes the tables directly');

-- ══ F. The summary, the Care card, states, logging, a merge ══════════════════
set role authenticated;
select pg_temp.claims(:lead);
select app.care_thanks_summary(:c1) as sm \gset
select pg_temp.assert((:'sm'::jsonb ->> 'gifts')::int = 5 and (:'sm'::jsonb ->> 'thanked')::int = 3 and (:'sm'::jsonb ->> 'open')::int = 2
                      and (:'sm'::jsonb ->> 'overdue')::int = 2 and (:'sm'::jsonb ->> 'on_time_share')::numeric = 0.6
                      and (:'sm'::jsonb ->> 'median_hours')::numeric >= 0,
  'F · the summary: five gifts, three thanked, two open and both overdue, three of five on time');
select pg_temp.assert((app.care_thanks_counts(:c1) ->> 'state') = 'ok' and (app.care_thanks_counts(:c1) ->> 'open')::int = 2
                      and (app.care_thanks_counts(:c1) ->> 'overdue')::int = 2 and (app.care_thanks_counts(:c1) ->> 'personal_open')::int = 2,
  'F · Home''s counts: two to thank, both overdue, both personal');
select pg_temp.claims(:rel);
select pg_temp.assert((app.care_thanks_counts(:c1) ->> 'open')::int = 1, 'F · a relationship owner''s Home counts only their own households');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises($$select app.care_thanks_counts('88100000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'F · and nobody without a care key gets them');
select pg_temp.claims(:lead);
select pg_temp.assert(jsonb_array_length(app.care_household_thanks(:h3) -> 'open') = 1
                      and (app.care_household_thanks(:h3) -> 'open' -> 0 ->> 'overdue')::boolean
                      and (app.care_household_thanks(:h3) -> 'open' -> 0 ->> 'needs_personal')::boolean
                      and jsonb_array_length(app.care_household_thanks(:h2) -> 'open') = 0,
  'F · the Care card list: a household''s open steps, with whether each is overdue and personal');
select pg_temp.assert(not (app.care_thanks_queue(:c1, 'open', 100)::text like '%Esi%'), 'F · a child is named nowhere in the list');
select pg_temp.assert(jsonb_array_length(app.care_thanks_queue(:c1, 'open', 1) -> 'rows') = 1 and (app.care_thanks_queue(:c1, 'open', 1) ->> 'total')::int = 2
                      and jsonb_array_length(app.care_thanks_queue(:c1, 'open', 1, 1) -> 'rows') = 1,
  'F · paging: a page of one, the total of two, the next page the other');
select pg_temp.assert_raises($$select app.care_thanks_queue('88100000-0000-4000-8000-0000000000c1', 'everything')$$, 'open, overdue, done or set-aside', 'F · an unknown filter is refused');
reset role;
select pg_temp.assert((select count(*) from app.audit_log where action = 'care.read' and (after ->> 'what') = 'thanks_queue') > 0
                      and (select count(*) from app.audit_log where action = 'care.read' and (after ->> 'what') = 'thanks_summary') > 0
                      and (select count(*) from app.audit_log where action = 'care.read' and (after ->> 'what') = 'household_thanks') > 0
                      and not exists (select 1 from app.audit_log where action = 'care.read' and (after::text like '%Mensah881%' or after::text like '%Lee881%')),
  'F · every read is logged (who, when, what, how many) and names no one');
select pg_temp.assert(not exists (select 1 from app.audit_log where action = 'care.read' and (after ->> 'what') = 'thanks_counts'),
  'F · Home''s three numbers are not logged as a read of a care record (no list, no names)');
-- Giving off: there are no gifts to thank.
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'giving', false, 'Test 881: Giving off')
  on conflict (center_id, module_key) do update set granted = false;
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert(app.care_thanks_queue(:c1) ->> 'state' = 'giving_off' and app.care_thanks_summary(:c1) ->> 'state' = 'giving_off'
                      and app.care_household_thanks(:h1) ->> 'state' = 'giving_off',
  'F · with Giving off the screens say so instead of listing nothing');
reset role;
update app.center_module_grants set granted = true where center_id = :c1 and module_key = 'giving';
-- A merge: payments move to the surviving household, and the step goes with its gift.
update app.payments set household_id = :h1 where id = :gbig;
set role authenticated;
select pg_temp.claims(:rel);
select pg_temp.assert(:'s_gbig'::uuid = any (pg_temp.ids(app.care_thanks_queue(:c1, 'open', 100))),
  'F · when the payment moves to another household the step moves with it (and a card to the old household no longer closes it)');
reset role;
rollback;
