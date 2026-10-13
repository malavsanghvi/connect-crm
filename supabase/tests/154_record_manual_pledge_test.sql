-- 0745 (docs/GIVING_REDESIGN.md slice 7; NEEDS OWNER OK): recording a pledge by hand from the portal.
--   A. A pledge is recorded: source manual, numbered, the reason in its audit entry, nothing posted to the books
--   B. The same key twice records once; the same key for a different pledge is refused
--   C. Who may: giving.manage yes; record_offline, approve, a member and another community's treasurer no
--   D. Giving switched off; Opportunities switched off when an opportunity is named
--   E. Which community: the household, fund, campaign and opportunity must be the caller's community's own
--   F. Who pledged: an adult of the household; a child, a child with no birth date, a former member and someone else are refused
--   G. What it refuses (each refusal records nothing): amount, reason, key, due date, dedication, campaign kinds, archived, fund
--   H. Campaigns, funds and opportunities: the campaign's fund comes with it; an opportunity brings its campaign; a taken one is refused
--   I. A community that is not a faith community records the same way
--   J. The function's grants
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
-- One call as a person, with the usual arguments; the rest are named where a check needs them.
create or replace function pg_temp.rec(p_user uuid, p_key text, p_center uuid, p_household uuid, p_amount bigint,
                                       p_reason text default 'Pledged in person', p_fund uuid default null, p_campaign uuid default null,
                                       p_opportunity uuid default null, p_due date default null, p_person uuid default null,
                                       p_dedication text default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  r := app.record_manual_pledge(p_key, p_center, p_household, p_amount, p_reason, p_fund, p_campaign, p_opportunity, null, p_due,
                                p_person, p_dedication);
  reset role;
  return r;
exception when others then
  reset role;
  raise;
end $$;

\set c '''15400000-0000-4000-8000-0000000000c1'''
\set d '''15400000-0000-4000-8000-0000000000d1'''
\set np '''15400000-0000-4000-8000-0000000000e1'''
\set tara '''15400000-0000-4000-8000-0000000000a1'''
\set vina '''15400000-0000-4000-8000-0000000000a2'''
\set apu '''15400000-0000-4000-8000-0000000000a3'''
\set mira '''15400000-0000-4000-8000-0000000000a4'''
\set zed '''15400000-0000-4000-8000-0000000000a5'''
\set nora '''15400000-0000-4000-8000-0000000000a6'''
\set h1 '''15400000-0000-4000-8000-000000000201'''
\set h2 '''15400000-0000-4000-8000-000000000202'''
\set h3 '''15400000-0000-4000-8000-000000000203'''
\set hn '''15400000-0000-4000-8000-000000000204'''
\set rahul '''15400000-0000-4000-8000-000000000101'''
\set mirap '''15400000-0000-4000-8000-000000000102'''
\set kid '''15400000-0000-4000-8000-000000000103'''
\set nodob '''15400000-0000-4000-8000-000000000104'''
\set gone '''15400000-0000-4000-8000-000000000105'''
\set kiran '''15400000-0000-4000-8000-000000000106'''
\set noor '''15400000-0000-4000-8000-000000000107'''
\set f1 '''15400000-0000-4000-8000-000000000401'''
\set f2 '''15400000-0000-4000-8000-000000000402'''
\set f3 '''15400000-0000-4000-8000-000000000403'''
\set fd '''15400000-0000-4000-8000-000000000404'''
\set camp '''15400000-0000-4000-8000-000000000501'''
\set auct '''15400000-0000-4000-8000-000000000502'''
\set arch '''15400000-0000-4000-8000-000000000503'''
\set campd '''15400000-0000-4000-8000-000000000504'''
\set opp '''15400000-0000-4000-8000-000000000601'''

begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into app.centers (id, slug, name, short_name, time_zone) values
  (:c, 'g154-temple', 'G154 Temple', 'G154', 'America/Chicago'),
  (:d, 'g154-other', 'G154 Other Temple', 'G154B', 'America/Chicago');
insert into app.centers (id, slug, name, short_name, category_key, status, time_zone)
  values (:np, 'g154-food-bank', 'G154 Food Bank', 'G154F', 'nonprofit_secular', 'active', 'Europe/London');
insert into auth.users (id, email) values (:tara, 'tara@g154.test'), (:vina, 'vina@g154.test'), (:apu, 'apu@g154.test'),
  (:mira, 'mira@g154.test'), (:zed, 'zed@g154.test'), (:nora, 'nora@g154.test');
insert into app.roles (key, tier, name, permissions) values ('approver_only154', 'center', 'Approver only 154', '["giving.view","giving.approve"]');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  (:rahul, :c, 'Rahul', 'Shah', null, '1980-04-02'),
  (:mirap, :c, 'Mira', 'Shah', 'mira@g154.test', '1982-06-11'),
  (:kid, :c, 'Kavi', 'Shah', null, (now() - interval '10 years')::date),
  (:nodob, :c, 'Nila', 'Shah', null, null),
  (:gone, :c, 'Ravi', 'Shah', null, '1960-01-01'),
  (:kiran, :c, 'Kiran', 'Mehta', null, null),
  (:noor, :np, 'Noor', 'Haddad', null, '1985-03-03');
insert into app.households (id, center_id, display_name) values
  (:h1, :c, 'Shah family'), (:h2, :c, 'Mehta family'), (:h3, :d, 'Other family'), (:hn, :np, 'Haddad household');
insert into app.household_members (household_id, person_id, center_id, role, is_primary, left_at) values
  (:h1, :rahul, :c, 'primary', true, null),
  (:h1, :mirap, :c, 'spouse', false, null),
  (:h1, :kid, :c, 'child', false, null),
  (:h1, :nodob, :c, 'child', false, null),
  (:h1, :gone, :c, 'other', false, now() - interval '1 year'),
  (:h2, :kiran, :c, 'primary', true, null),
  (:hn, :noor, :np, 'primary', true, null);
insert into app.center_users (center_id, user_id, person_id, is_default) values (:c, :mira, :mirap, false);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :tara, 'treasurer'), (:c, :vina, 'finance_volunteer'), (:c, :apu, 'approver_only154'), (:d, :zed, 'treasurer'), (:np, :nora, 'treasurer');
insert into app.funds (id, center_id, key, name, active) values
  (:f1, :c, 'building', 'Building fund', true), (:f2, :c, 'general', 'General fund', true), (:f3, :c, 'old', 'Old fund', false),
  (:fd, :d, 'building', 'Other building fund', true);
insert into app.campaigns (id, center_id, fund_id, name, kind, status) values
  (:camp, :c, :f1, 'New hall', 'construction', 'published'),
  (:auct, :c, null, 'Festival auction', 'boli', 'published'),
  (:arch, :c, null, 'Old appeal', 'general', 'archived'),
  (:campd, :d, null, 'Other appeal', 'general', 'published');
insert into app.opportunities (id, center_id, campaign_id, name, amount_cents, quantity_available, status)
  values (:opp, :c, :camp, 'Name a classroom', 250000, 1, 'open');
select (now() at time zone 'America/Chicago')::date as today \gset

-- ═════════════════════════════════════════════════════════════════════════════
-- A. A pledge is recorded
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.rec(:tara, 'key-154-0001', :c, :h1, 50000, 'Pledged in person at the hall meeting', :f1, null, null,
                   :'today'::date + 90, :rahul, 'In memory of Ba')::text as r1 \gset
select (:'r1'::jsonb)->>'pledge_id' as p1 \gset

select pg_temp.assert(((:'r1'::jsonb)->>'replayed')::boolean = false and ((:'r1'::jsonb)->>'amount_cents')::bigint = 50000
                      and ((:'r1'::jsonb)->>'pledge_number') like 'G154-PL-%' and ((:'r1'::jsonb)->>'household_id')::uuid = :h1,
  'A: the answer has the pledge, its number from the numbering trigger, the amount and the household; not a replay');
select pg_temp.assert((select source::text = 'manual' and status = 'open' and paid_cents = 0 and amount_cents = 50000 and fund_id = :f1
                              and campaign_id is null and pledged_by_person_id = :rahul and due_on = :'today'::date + 90
                              and dedication = 'In memory of Ba' and created_by = :tara::uuid and idempotency_key = 'key-154-0001'
                         from app.pledges where id = :'p1'::uuid),
  'A: the pledge row: source manual, open, nothing paid, the fund, the adult who pledged, due date, dedication, who recorded it, the key');
select pg_temp.assert((select count(*) = 1 and bool_and(reason = 'Pledged in person at the hall meeting')
                         from app.audit_log where record_table = 'pledges' and record_id = :'p1' and action = 'pledges.insert'),
  'A: the audit entry of the new pledge carries the reason given (the family''s History shows it)');
select pg_temp.assert(not exists (select 1 from app.ledger_postings lp where lp.center_id = :c),
  'A: a pledge is not cash: nothing is posted to the books');

-- ═════════════════════════════════════════════════════════════════════════════
-- B. The same key twice records once
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.rec(:tara, 'key-154-0001', :c, :h1, 50000, 'Pledged in person at the hall meeting', :f1, null, null,
                   :'today'::date + 90, :rahul, 'In memory of Ba')::text as r1b \gset
select pg_temp.assert(((:'r1b'::jsonb)->>'replayed')::boolean and (:'r1b'::jsonb)->>'pledge_id' = :'p1'
                      and (select count(*) from app.pledges where center_id = :c and source::text = 'manual') = 1,
  'B: the same confirmation again returns the same pledge (replayed) and records nothing more');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-0001', %L, %L, 60000)$$, :tara, :c, :h1),
  'already used for a different pledge', 'B: the same key for a different amount is refused');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-0001', %L, %L, 50000, 'x reason', %L, null, null, %L::date, %L)$$,
                                    :tara, :c, :h2, :f1, :'today'::date + 90, :rahul),
  'already used for a different pledge', 'B: the same key for a different household is refused');
select pg_temp.assert((select count(*) from app.pledges where center_id = :c and source::text = 'manual') = 1,
  'B: the refusals recorded nothing');
-- The key is the community's own: another community may use the same text.
select pg_temp.rec(:zed, 'key-154-0001', :d, :h3, 1000)::text as rd \gset
select pg_temp.assert(((:'rd'::jsonb)->>'replayed')::boolean = false, 'B: keys are per community');

-- ═════════════════════════════════════════════════════════════════════════════
-- C. Who may
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-c-vina', %L, %L, 1000)$$, :vina, :c, :h2),
  'permission to record pledges', 'C: a finance volunteer (giving.record_offline) may not record a pledge');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-c-apu1', %L, %L, 1000)$$, :apu, :c, :h2),
  'permission to record pledges', 'C: a second approver (giving.approve) may not record a pledge');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-c-mira', %L, %L, 1000)$$, :mira, :c, :h1),
  'permission to record pledges', 'C: a member may not record a pledge, not even for her own household');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-c-zed1', %L, %L, 1000)$$, :zed, :c, :h2),
  'permission to record pledges', 'C: another community''s treasurer may not record one here');
select pg_temp.assert(not exists (select 1 from app.pledges where idempotency_key like 'key-154-c-%'), 'C: nothing was recorded');

-- ═════════════════════════════════════════════════════════════════════════════
-- D. Modules
-- ═════════════════════════════════════════════════════════════════════════════
savepoint giving_off;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving', false, 'Test 154: giving paused');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-d-off1', %L, %L, 1000)$$, :tara, :c, :h2),
  'switched off', 'D: with Giving switched off nothing is recorded');
rollback to savepoint giving_off;
savepoint opp_off;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving_opportunities', false, 'Test 154: no opportunities');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-d-off2', %L, %L, 1000, 'x reason', null, null, %L)$$, :tara, :c, :h2, :opp),
  'switched off', 'D: with Opportunities switched off a pledge to an opportunity is refused');
select pg_temp.rec(:tara, 'key-154-d-off3', :c, :h2, 1000, 'By phone', :f2)::text as roff \gset
select pg_temp.assert(((:'roff'::jsonb)->>'replayed')::boolean = false, 'D: with Opportunities off a pledge to a fund is still recorded');
rollback to savepoint opp_off;

-- ═════════════════════════════════════════════════════════════════════════════
-- E. Which community
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-e-0001', %L, %L, 1000)$$, :tara, :c, :h3),
  'different community', 'E: a household of another community is refused');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-e-0002', %L, %L, 1000)$$, :tara, :d, :h3),
  'permission to record pledges', 'E: claiming the other community does not help (no giving.manage there)');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-e-0003', %L, %L, 1000, 'x reason', %L)$$, :tara, :c, :h2, :fd),
  'fund was not found', 'E: another community''s fund is refused');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-e-0004', %L, %L, 1000, 'x reason', null, %L)$$, :tara, :c, :h2, :campd),
  'campaign was not found', 'E: another community''s campaign is refused');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-e-0005', %L, %L, 1000)$$, :tara, :c, '15400000-0000-4000-8000-0000000002ff'),
  'household was not found', 'E: a household that does not exist is refused');
select pg_temp.assert(not exists (select 1 from app.pledges where idempotency_key like 'key-154-e-%'), 'E: nothing was recorded');

-- ═════════════════════════════════════════════════════════════════════════════
-- F. Who pledged: an adult of the household, never a child
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-f-0001', %L, %L, 1000, 'x reason', null, null, null, null, %L)$$, :tara, :c, :h1, :kid),
  'must be an adult of this household', 'F: a child (by birth date) is refused as the person who pledged');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-f-0002', %L, %L, 1000, 'x reason', null, null, null, null, %L)$$, :tara, :c, :h1, :nodob),
  'must be an adult of this household', 'F: a child with no birth date on file is refused');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-f-0003', %L, %L, 1000, 'x reason', null, null, null, null, %L)$$, :tara, :c, :h1, :gone),
  'must be an adult of this household', 'F: someone who left the household is refused');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-f-0004', %L, %L, 1000, 'x reason', null, null, null, null, %L)$$, :tara, :c, :h1, :kiran),
  'must be an adult of this household', 'F: an adult of another household is refused');
select pg_temp.assert(not exists (select 1 from app.pledges where idempotency_key like 'key-154-f-%'), 'F: nothing was recorded');
select pg_temp.rec(:tara, 'key-154-f-0005', :c, :h2, 1000, 'By phone', null, null, null, null, :kiran)::text as rf \gset
select pg_temp.assert((select pledged_by_person_id = :kiran from app.pledges where id = ((:'rf'::jsonb)->>'pledge_id')::uuid),
  'F: a head of household with no birth date on file counts as an adult');
select pg_temp.rec(:tara, 'key-154-f-0006', :c, :h2, 1000, 'By phone')::text as rf2 \gset
select pg_temp.assert((select pledged_by_person_id is null from app.pledges where id = ((:'rf2'::jsonb)->>'pledge_id')::uuid),
  'F: naming nobody records the pledge for the household');

-- ═════════════════════════════════════════════════════════════════════════════
-- G. What it refuses
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-g-0001', %L, %L, 0)$$, :tara, :c, :h2), 'greater than zero', 'G: an amount of zero');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-g-0002', %L, %L, -500)$$, :tara, :c, :h2), 'greater than zero', 'G: a negative amount');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-g-0003', %L, %L, 1000, '  ')$$, :tara, :c, :h2), 'say why', 'G: no reason');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-g-0004', %L, %L, 1000, null)$$, :tara, :c, :h2), 'say why', 'G: a null reason');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'short', %L, %L, 1000)$$, :tara, :c, :h2), 'confirmation key', 'G: a key that is too short');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-g-0005', %L, %L, 1000, 'x reason', null, null, null, %L::date)$$, :tara, :c, :h2, :'today'::date + 4000),
  'within ten years', 'G: a due date more than ten years ahead');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-g-0006', %L, %L, 1000, 'x reason', null, null, null, null, null, %L)$$, :tara, :c, :h2, repeat('x', 201)),
  '200 characters', 'G: a dedication over 200 characters');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-g-0007', %L, %L, 1000, 'x reason', null, %L)$$, :tara, :c, :h2, :auct),
  'its own screen', 'G: an auction campaign takes its pledges from its own screen');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-g-0008', %L, %L, 1000, 'x reason', null, %L)$$, :tara, :c, :h2, :arch),
  'archived', 'G: an archived campaign');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-g-0009', %L, %L, 1000, 'x reason', %L)$$, :tara, :c, :h2, :f3),
  'no longer in use', 'G: a fund no longer in use');
select pg_temp.assert(not exists (select 1 from app.pledges where idempotency_key like 'key-154-g-%' or idempotency_key = 'short'), 'G: nothing was recorded');
select pg_temp.assert_raises(format($$insert into app.pledges (center_id, household_id, source, amount_cents, idempotency_key) values (%L, %L, 'general', 100, 'key-154-g-0010')$$, :c, :h2),
  'pledges_idempotency_key_manual', 'G: a key is only ever set on a manual pledge');

-- ═════════════════════════════════════════════════════════════════════════════
-- H. Campaigns, funds and opportunities
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.rec(:tara, 'key-154-h-0001', :c, :h2, 20000, 'Pledge card', null, :camp)::text as rh1 \gset
select pg_temp.assert((select campaign_id = :camp and fund_id = :f1 from app.pledges where id = ((:'rh1'::jsonb)->>'pledge_id')::uuid),
  'H: a campaign brings its own fund');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-h-0002', %L, %L, 1000, 'x reason', %L, %L)$$, :tara, :c, :h2, :f2, :camp),
  'its own fund', 'H: a different fund than the campaign''s is refused');
select pg_temp.rec(:tara, 'key-154-h-0003', :c, :h2, 250000, 'Pledge card', null, null, :opp)::text as rh3 \gset
select pg_temp.assert((select opportunity_id = :opp and campaign_id = :camp and fund_id = :f1 from app.pledges where id = ((:'rh3'::jsonb)->>'pledge_id')::uuid)
                      and (select quantity_taken from app.opportunities where id = :opp) = 1,
  'H: an opportunity brings its campaign and fund, and counts as taken');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-h-0004', %L, %L, 250000, 'x reason', null, null, %L)$$, :tara, :c, :h1, :opp),
  'already taken', 'H: an opportunity that is taken is refused');
select pg_temp.rec(:tara, 'key-154-h-0003', :c, :h2, 250000, 'Pledge card', null, null, :opp)::text as rh3b \gset
select pg_temp.assert(((:'rh3b'::jsonb)->>'replayed')::boolean and (:'rh3b'::jsonb)->>'pledge_id' = (:'rh3'::jsonb)->>'pledge_id',
  'H: replaying the confirmation of a taken opportunity returns the pledge (it was this one that took it)');

-- ═════════════════════════════════════════════════════════════════════════════
-- I. A community that is not a faith community
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(app.module_enabled(:np, 'giving'), 'I: Giving is on for the food bank');
select pg_temp.rec(:nora, 'key-154-i-0001', :np, :hn, 7500, 'Pledged at the spring appeal', null, null, null, null, :noor)::text as ri \gset
select pg_temp.assert((select source::text = 'manual' and amount_cents = 7500 and pledged_by_person_id = :noor and pledge_number like 'G154F-PL-%'
                         from app.pledges where id = ((:'ri'::jsonb)->>'pledge_id')::uuid),
  'I: the food bank''s treasurer records a pledge the same way, numbered by its own sequence');
select pg_temp.assert_raises(format($$select pg_temp.rec(%L, 'key-154-i-0002', %L, %L, 7500)$$, :tara, :np, :hn),
  'permission to record pledges', 'I: the temple''s treasurer may not record one at the food bank');

-- ═════════════════════════════════════════════════════════════════════════════
-- J. Grants
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(not has_function_privilege('anon', 'app.record_manual_pledge(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.record_manual_pledge(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text)', 'execute'),
  'J: signed-out visitors cannot call it; signed-in people can (it checks who may)');
select pg_temp.assert((select prosecdef from pg_proc where oid = 'app.record_manual_pledge(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text)'::regprocedure)
                      and pg_get_functiondef('app.record_manual_pledge(text, uuid, uuid, bigint, text, uuid, uuid, uuid, text, date, uuid, text)'::regprocedure)
                          like '%search_path TO ''app'', ''public'', ''extensions''%',
  'J: security definer with the pinned search path');
select pg_temp.assert(exists (select 1 from app.activity_catalog where key = 'assistant.giving_record_pledge' and commandable_key = 'giving.record_pledge')
                      and exists (select 1 from app.activity_catalog where key = 'giving.record_pledge'),
  'J: the command and the screen''s button are both in the activity catalog');

rollback;
