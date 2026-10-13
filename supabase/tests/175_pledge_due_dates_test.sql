-- 0775 (GV-U slice A; NEEDS OWNER OK): every pledge has a due date.
--   A. A pledge made without a due date gets the community's default: the day it was made (community time zone) + 30 days
--   B. The community's rule rules.giving.pledge_due_days (a non-faith community in another time zone); a rule that is not a whole
--      number from 0 to 3650 means 30
--   C. A pledge made with a due date keeps it; the member app's own insert (row level security) gets the default
--   D. due_on is required: no pledge without one, and it cannot be emptied
--   E. app.record_manual_pledge: the default when none is given, a replay without a due date is the same pledge (the 0745 check would
--      have refused it), a replay with a different due date is refused; the answer carries due_on and pledged_on
--   F. The core's day it was pledged: an earlier day reads as that day, the default counts from it, a future day and a due date before
--      it are refused, a replay with a different day is refused; nobody may run the core directly
--   G. app.set_pledge_due_on: a treasurer changes it with a reason (the audit entry's); the refusals; the same date changes nothing
--   H. Grants and the activity catalog
--   J. The backfill: pledges without a due date get pledged + 30, each with an audit entry carrying the reason; updated_at is kept
-- The whole test is one transaction that is rolled back at the end, so nothing it creates is seen by the tests that run after it.
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
create or replace function pg_temp.claims(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', json_build_array(json_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/giving/pledges"}', true);
end $$;
create or replace function pg_temp.rec(p_user uuid, p_key text, p_center uuid, p_household uuid, p_amount bigint,
                                       p_due date default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  r := app.record_manual_pledge(p_key, p_center, p_household, p_amount, 'Pledged in person', null, null, null, null, p_due, null, null);
  reset role;
  return r;
exception when others then
  reset role;
  raise;
end $$;
-- The core with a day it was pledged, as the upload (0776) calls it: from inside a function, as the person.
create or replace function pg_temp.core(p_user uuid, p_key text, p_center uuid, p_household uuid, p_amount bigint,
                                        p_due date, p_pledged_on date) returns jsonb language plpgsql as $$
begin
  perform pg_temp.claims(p_user);
  return app._record_manual_pledge_core(p_key, p_center, p_household, p_amount, 'Pledge card', null, null, null, null, p_due, null, null,
                                        p_pledged_on);
end $$;
create or replace function pg_temp.due(p_user uuid, p_center uuid, p_pledge uuid, p_due date, p_reason text default 'Asked for more time')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  r := app.set_pledge_due_on(p_center, p_pledge, p_due, p_reason);
  reset role;
  return r;
exception when others then
  reset role;
  raise;
end $$;

\set c '''17500000-0000-4000-8000-0000000000c1'''
\set d '''17500000-0000-4000-8000-0000000000d1'''
\set np '''17500000-0000-4000-8000-0000000000e1'''
\set tara '''17500000-0000-4000-8000-0000000000a1'''
\set vina '''17500000-0000-4000-8000-0000000000a2'''
\set mira '''17500000-0000-4000-8000-0000000000a4'''
\set zed '''17500000-0000-4000-8000-0000000000a5'''
\set nora '''17500000-0000-4000-8000-0000000000a6'''
\set h1 '''17500000-0000-4000-8000-000000000201'''
\set h2 '''17500000-0000-4000-8000-000000000202'''
\set hd '''17500000-0000-4000-8000-000000000203'''
\set hn '''17500000-0000-4000-8000-000000000204'''
\set rahul '''17500000-0000-4000-8000-000000000101'''
\set mirap '''17500000-0000-4000-8000-000000000102'''
\set kiran '''17500000-0000-4000-8000-000000000106'''
\set noor '''17500000-0000-4000-8000-000000000107'''
\set p1 '''17500000-0000-4000-8000-000000000301'''
\set p2 '''17500000-0000-4000-8000-000000000302'''
\set p3 '''17500000-0000-4000-8000-000000000303'''
\set p4 '''17500000-0000-4000-8000-000000000304'''
\set pn '''17500000-0000-4000-8000-000000000305'''
\set pd '''17500000-0000-4000-8000-000000000306'''
\set p5 '''17500000-0000-4000-8000-000000000307'''
\set b1 '''17500000-0000-4000-8000-000000000308'''
\set b2 '''17500000-0000-4000-8000-000000000309'''

begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into app.centers (id, slug, name, short_name, time_zone) values
  (:c, 'g175-temple', 'G175 Temple', 'G175', 'America/Chicago'),
  (:d, 'g175-other', 'G175 Other Temple', 'G175B', 'America/Chicago');
-- A secular non-profit in another time zone (that category is still a sandbox preview, as in tests 151 and 154).
insert into app.centers (id, slug, name, short_name, environment, category_key, status, time_zone, rules)
  values (:np, 'g175-food-bank-sandbox', 'G175 Food Bank', 'G175F', 'sandbox', 'nonprofit_secular', 'onboarding', 'Europe/London',
          '{"giving":{"pledge_due_days":14}}'::jsonb);
insert into auth.users (id, email) values (:tara, 'tara@g175.test'), (:vina, 'vina@g175.test'), (:mira, 'mira@g175.test'),
  (:zed, 'zed@g175.test'), (:nora, 'nora@g175.test');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  (:rahul, :c, 'Rahul', 'Shah', null, '1980-04-02'),
  (:mirap, :c, 'Mira', 'Shah', 'mira@g175.test', '1982-06-11'),
  (:kiran, :c, 'Kiran', 'Mehta', null, null),
  (:noor, :np, 'Noor', 'Haddad', null, '1985-03-03');
insert into app.households (id, center_id, display_name) values
  (:h1, :c, 'Shah family'), (:h2, :c, 'Mehta family'), (:hd, :d, 'Other family'), (:hn, :np, 'Haddad household');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :rahul, :c, 'primary', true), (:h1, :mirap, :c, 'spouse', false), (:h2, :kiran, :c, 'primary', true),
  (:hn, :noor, :np, 'primary', true);
insert into app.center_users (center_id, user_id, person_id, is_default) values (:c, :mira, :mirap, false);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :tara, 'treasurer'), (:c, :vina, 'finance_volunteer'), (:d, :zed, 'treasurer'), (:np, :nora, 'treasurer');
select (now() at time zone 'America/Chicago')::date as today \gset
select (now() at time zone 'Europe/London')::date as today_np \gset

-- ═══════════════════════════════════════════════════════════════════════════
-- A. The default: the day it was made + 30 days
-- ═══════════════════════════════════════════════════════════════════════════
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at) values
  -- 03:00 UTC on 10 January is still 9 January in Chicago: the community's own day counts.
  (:p1, :c, :h1, 'general', 10000, '2026-01-10 03:00:00+00'),
  (:p2, :c, :h2, 'general', 20000, now());
select pg_temp.assert((select due_on = date '2026-02-08' from app.pledges where id = :p1),
  'A: a pledge made without a due date is due 30 days after the day it was made, in the community''s own time zone');
select pg_temp.assert((select due_on = :'today'::date + 30 from app.pledges where id = :p2),
  'A: a pledge made today without a due date is due in 30 days');
select pg_temp.assert(app.pledge_default_due_on(:c, '2026-01-10 03:00:00+00') = date '2026-02-08',
  'A: app.pledge_default_due_on says the same date');

-- ═══════════════════════════════════════════════════════════════════════════
-- B. The community's rule
-- ═══════════════════════════════════════════════════════════════════════════
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at) values
  -- 23:30 UTC on 1 June is 2 June in London (summer time): 2 June + 14.
  (:pn, :np, :hn, 'general', 5000, '2026-06-01 23:30:00+00');
select pg_temp.assert((select due_on = date '2026-06-16' from app.pledges where id = :pn),
  'B: a community whose pledges are due 14 days after they are made (a food bank in London) gets 14 days');
update app.centers set rules = '{"giving":{"pledge_due_days":0}}'::jsonb where id = :np;
select pg_temp.assert(app.pledge_default_due_on(:np, '2026-06-01 23:30:00+00') = date '2026-06-02', 'B: 0 days means due the day it was made');
update app.centers set rules = '{"giving":{"pledge_due_days":"soon"}}'::jsonb where id = :np;
select pg_temp.assert(app.pledge_default_due_on(:np, '2026-06-01 23:30:00+00') = date '2026-07-02', 'B: a rule that is not a number means 30 days');
update app.centers set rules = '{"giving":{"pledge_due_days":5000}}'::jsonb where id = :np;
select pg_temp.assert(app.pledge_default_due_on(:np, '2026-06-01 23:30:00+00') = date '2026-07-02', 'B: more than 3650 days means 30 days');
update app.centers set rules = '{"giving":{"pledge_due_days":-3}}'::jsonb where id = :np;
select pg_temp.assert(app.pledge_default_due_on(:np, '2026-06-01 23:30:00+00') = date '2026-07-02', 'B: a negative number means 30 days');
update app.centers set rules = '{"giving":{"pledge_due_days":14}}'::jsonb where id = :np;

-- ═══════════════════════════════════════════════════════════════════════════
-- C. A due date given is kept; the member app's insert gets the default
-- ═══════════════════════════════════════════════════════════════════════════
insert into app.pledges (id, center_id, household_id, source, amount_cents, due_on) values (:p3, :c, :h2, 'general', 3000, '2027-03-31');
select pg_temp.assert((select due_on = date '2027-03-31' from app.pledges where id = :p3), 'C: a pledge made with a due date keeps it');
select pg_temp.claims(:mira);
set local role authenticated;
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, created_by)
  values (:p4, :c, :h1, :mirap, 'general', 2500, :mira);
reset role;
select pg_temp.assert((select due_on = :'today'::date + 30 and source = 'general' from app.pledges where id = :p4),
  'C: a pledge from the member app (no due date in its insert) gets the community''s default');

-- ═══════════════════════════════════════════════════════════════════════════
-- D. Required
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert(exists (select 1 from pg_constraint where conrelid = 'app.pledges'::regclass and conname = 'pledges_due_on_required'
                                and contype = 'c' and convalidated),
  'D: app.pledges.due_on is required (the check pledges_due_on_required, validated against every row)');
select pg_temp.assert(not exists (select 1 from app.pledges where due_on is null), 'D: no pledge is without a due date (the backfill)');
select pg_temp.assert_raises(format($$update app.pledges set due_on = null where id = %L$$, :p2), 'pledges_due_on_required',
  'D: a due date cannot be emptied');

-- ═══════════════════════════════════════════════════════════════════════════
-- E. Recording a pledge by hand
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.rec(:tara, 'key-175-e-0001', :c, :h2, 50000)::text as e1 \gset
select pg_temp.assert(((:'e1'::jsonb)->>'due_on')::date = :'today'::date + 30
                      and ((:'e1'::jsonb)->>'pledged_on')::date = :'today'::date
                      and (select due_on = :'today'::date + 30 from app.pledges where id = ((:'e1'::jsonb)->>'pledge_id')::uuid),
  'E: a pledge recorded without a due date gets the default, and the answer says so (due_on, pledged_on)');
select pg_temp.rec(:tara, 'key-175-e-0001', :c, :h2, 50000)::text as e1b \gset
select pg_temp.assert(((:'e1b'::jsonb)->>'replayed')::boolean and (:'e1b'::jsonb)->>'pledge_id' = (:'e1'::jsonb)->>'pledge_id',
  'E: the same confirmation again without a due date is the same pledge, not "a different pledge"');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-175-e-0001', %L, %L, 50000, %L)$$, :tara, :c, :h2, :'today'::date + 5),
  'different pledge', 'E: the same confirmation with a different due date is refused');
select pg_temp.rec(:tara, 'key-175-e-0002', :c, :h2, 7000, (:'today'::date + 60))::text as e2 \gset
select pg_temp.assert(((:'e2'::jsonb)->>'due_on')::date = :'today'::date + 60, 'E: a due date given is kept');
select pg_temp.rec(:tara, 'key-175-e-0002', :c, :h2, 7000, (:'today'::date + 60))::text as e2b \gset
select pg_temp.assert(((:'e2b'::jsonb)->>'replayed')::boolean, 'E: a replay with the same due date is the same pledge');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'upl:175-e-0004:2', %L, %L, 1000)$$, :tara, :c, :h2),
  'kept for uploads', 'E: a key starting upl: is the uploads'' own: recording one pledge by hand refuses it');
select pg_temp.rec(:nora, 'key-175-e-0003', :np, :hn, 12000)::text as en \gset
select pg_temp.assert(((:'en'::jsonb)->>'due_on')::date = :'today_np'::date + 14,
  'E: in the food bank (14 days, London) a pledge recorded by hand is due in 14 days');

-- ═══════════════════════════════════════════════════════════════════════════
-- F. The day it was pledged
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.core(:tara, 'key-175-f-0001', :c, :h1, 15000, null, (:'today'::date - 10))::text as f1 \gset
select pg_temp.assert(((:'f1'::jsonb)->>'pledged_on')::date = :'today'::date - 10
                      and ((:'f1'::jsonb)->>'due_on')::date = :'today'::date + 20
                      and (select (pledged_at at time zone 'America/Chicago')::date = :'today'::date - 10 and source = 'manual'
                             from app.pledges where id = ((:'f1'::jsonb)->>'pledge_id')::uuid),
  'F: a pledge card from ten days ago reads as that day, and is due 30 days after it');
select pg_temp.core(:tara, 'key-175-f-0001', :c, :h1, 15000, null, (:'today'::date - 10))::text as f1b \gset
select pg_temp.assert(((:'f1b'::jsonb)->>'replayed')::boolean, 'F: the same card again is the same pledge');
select pg_temp.assert_raises(format($$select pg_temp.core(%L, 'key-175-f-0001', %L, %L, 15000, null, %L)$$, :tara, :c, :h1, :'today'::date - 11),
  'different pledge', 'F: the same confirmation with a different day is refused');
select pg_temp.assert_raises(format($$select pg_temp.core(%L, 'key-175-f-0002', %L, %L, 15000, null, %L)$$, :tara, :c, :h1, :'today'::date + 1),
  'today or earlier', 'F: a day in the future is refused');
select pg_temp.assert_raises(format($$select pg_temp.core(%L, 'key-175-f-0003', %L, %L, 15000, %L, %L)$$, :tara, :c, :h1,
                                    :'today'::date - 20, :'today'::date - 10),
  'before the day it was pledged', 'F: a due date before the day it was pledged is refused');
select pg_temp.assert_raises(format($$select pg_temp.core(%L, 'key-175-f-0004', %L, %L, 15000, null, %L)$$, :vina, :c, :h1, :'today'::date - 3),
  'giving.manage', 'F: the core keeps the permission check (a finance volunteer is refused)');
select pg_temp.core(:tara, 'key-175-f-0005', :c, :h1, 9000, null, :'today'::date)::text as f5 \gset
select pg_temp.assert((select pledged_at > now() - interval '1 minute' from app.pledges where id = ((:'f5'::jsonb)->>'pledge_id')::uuid),
  'F: today''s date is now');

-- ═══════════════════════════════════════════════════════════════════════════
-- G. Changing a due date
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.due(:tara, :c, :p2, (:'today'::date + 90), 'Asked for more time at the meeting')::text as g1 \gset
select pg_temp.assert(((:'g1'::jsonb)->>'changed')::boolean and ((:'g1'::jsonb)->>'was')::date = :'today'::date + 30
                      and (select due_on = :'today'::date + 90 from app.pledges where id = :p2),
  'G: a treasurer moves a due date');
select pg_temp.assert((select count(*) = 1 and bool_and(reason = 'Asked for more time at the meeting')
                         from app.audit_log where record_table = 'pledges' and record_id = :p2 and action = 'pledges.update'),
  'G: the audit entry carries the reason (the family''s History shows it)');
select pg_temp.due(:tara, :c, :p2, (:'today'::date + 90))::text as g2 \gset
select pg_temp.assert(not ((:'g2'::jsonb)->>'changed')::boolean, 'G: the same date again changes nothing');
select pg_temp.assert_raises(format($$select pg_temp.due(%L, %L, %L, %L)$$, :vina, :c, :p2, :'today'::date + 5),
  'giving.manage', 'G: a finance volunteer cannot change a due date');
select pg_temp.assert_raises(format($$select pg_temp.due(%L, %L, %L, %L)$$, :zed, :d, :p2, :'today'::date + 5),
  'different community', 'G: another community''s treasurer cannot change it');
select pg_temp.assert_raises(format($$select pg_temp.due(%L, %L, %L, %L, %L)$$, :tara, :c, :p2, :'today'::date + 5, ' '),
  'say why', 'G: a reason is required');
select pg_temp.assert_raises(format($$select pg_temp.due(%L, %L, %L, null)$$, :tara, :c, :p2), 'choose the new due date',
  'G: a date is required');
select pg_temp.assert_raises(format($$select pg_temp.due(%L, %L, %L, %L)$$, :tara, :c, :p2, :'today'::date + 4000),
  'ten years', 'G: more than ten years ahead is refused');
select pg_temp.assert_raises(format($$select pg_temp.due(%L, %L, %L, %L)$$, :tara, :c, :p1, '2026-01-01'),
  'before the day it was pledged', 'G: a due date before the day it was pledged is refused');
-- A write-off waiting for its second approver: the due date stays as it is.
insert into app.pledges (id, center_id, household_id, source, amount_cents, written_off_by, write_off_reason)
  values (:p5, :c, :h2, 'general', 4000, :tara, 'Moved away');
select pg_temp.assert_raises(format($$select pg_temp.due(%L, %L, %L, %L)$$, :tara, :c, :p5, :'today'::date + 5),
  'waiting for approval', 'G: a pledge with a write-off waiting for approval keeps its due date');
update app.pledges set status = 'paid', paid_cents = amount_cents where id = :p3;
select pg_temp.assert_raises(format($$select pg_temp.due(%L, %L, %L, %L)$$, :tara, :c, :p3, :'today'::date + 5),
  'only an open pledge', 'G: a paid pledge''s due date does not change');
savepoint giving_off;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving', false, 'Test 175: giving paused');
select pg_temp.assert_raises(format($$select pg_temp.due(%L, %L, %L, %L)$$, :tara, :c, :p2, :'today'::date + 7),
  'switched off', 'G: with Giving switched off nothing changes');
rollback to savepoint giving_off;
select pg_temp.due(:nora, :np, :pn, date '2026-09-01')::text as gn \gset
select pg_temp.assert(((:'gn'::jsonb)->>'changed')::boolean, 'G: the food bank''s treasurer changes a due date the same way');

-- ═══════════════════════════════════════════════════════════════════════════
-- H. Grants and the activity catalog
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert(not has_function_privilege('authenticated', 'app._record_manual_pledge_core(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text, date)', 'execute')
                      and not has_function_privilege('anon', 'app._record_manual_pledge_core(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text, date)', 'execute'),
  'H: nobody signed in runs the core directly');
select pg_temp.assert(has_function_privilege('authenticated', 'app.record_manual_pledge(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app.record_manual_pledge(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text)', 'execute'),
  'H: app.record_manual_pledge keeps its grants (signed in yes, anonymous no)');
select pg_temp.assert(has_function_privilege('authenticated', 'app.set_pledge_due_on(uuid, uuid, date, text)', 'execute')
                      and not has_function_privilege('anon', 'app.set_pledge_due_on(uuid, uuid, date, text)', 'execute')
                      and not has_function_privilege('anon', 'app.pledge_default_due_on(uuid, timestamptz)', 'execute')
                      and not has_function_privilege('authenticated', 'app.pledge_default_due_on(uuid, timestamptz)', 'execute')
                      and not has_function_privilege('authenticated', 'app._pledge_due_backfill()', 'execute'),
  'H: set_pledge_due_on is for signed-in people; the default and the backfill run only inside the database');
select pg_temp.assert(exists (select 1 from app.activity_catalog where key = 'giving.change_due_date'),
  'H: the Change due date button is in the activity catalog');

-- ═══════════════════════════════════════════════════════════════════════════
-- J. The backfill, on pledges made as they were before 0775 (no due date)
-- ═══════════════════════════════════════════════════════════════════════════
alter table app.pledges drop constraint pledges_due_on_required;
alter table app.pledges disable trigger pledges_default_due_on;
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at, updated_at) values
  (:b1, :c, :h1, 'general', 6000, '2026-03-10 03:00:00+00', '2026-03-10 03:00:00+00'),
  (:b2, :np, :hn, 'general', 7000, '2026-05-01 12:00:00+00', '2026-05-01 12:00:00+00');
alter table app.pledges enable trigger pledges_default_due_on;
select pg_temp.assert((select count(*) = 2 from app.pledges where due_on is null), 'J: two pledges without a due date, as before 0775');
select app._pledge_due_backfill() as filled \gset
select pg_temp.assert(:filled = 2
                      and (select due_on = date '2026-04-08' from app.pledges where id = :b1)
                      and (select due_on = date '2026-05-31' from app.pledges where id = :b2),
  'J: each gets the day it was made in its community''s time zone + 30 (9 March in Chicago; 1 May in London, whatever the rule says)');
select pg_temp.assert((select count(*) = 2 and bool_and(reason like 'Every pledge has a due date%' and (after->>'due_on') is not null and (before->>'due_on') is null)
                         from app.audit_log where record_table = 'pledges' and action = 'pledges.update' and record_id in (:b1, :b2)),
  'J: each change has an audit entry with the reason, before and after');
select pg_temp.assert((select bool_and(updated_at = pledged_at) from app.pledges where id in (:b1, :b2)),
  'J: updated_at is kept (the write-off queue reads "waiting since" from it)');
select pg_temp.assert((select tgenabled <> 'D' from pg_trigger where tgrelid = 'app.pledges'::regclass and tgname = 'touch_pledges'),
  'J: the updated_at trigger is on again afterwards');
alter table app.pledges add constraint pledges_due_on_required check (due_on is not null);

rollback;
