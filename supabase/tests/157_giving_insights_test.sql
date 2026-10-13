-- 0749 (Giving redesign slice 10, B98 slice 1): app.giving_insights, a year of the community's giving as aggregates only.
-- The community is a chamber of commerce (not a faith community) that keeps its books in Canadian dollars with a financial
-- year starting on April 1. Every figure below was counted by hand from the fixtures.
--   A. Donations: net of refunds; failed payments and opening balances left out; fees (membership, store) split out
--   B. The financial-year boundary: March 31 is last year, April 1 is this year
--   C. Average and median gift (an even count), giving households, participation, the same point last year
--   D. Retention: kept, lost, new (first gift ever), regained (gave before last year, not last year)
--   E. Concentration: fewer than 10 giving households shows nothing; with 10 the top tenth's share is given
--   F. By fund, campaign and opportunity; recurring share; months
--   G. Pledges: made this year (fulfilment, written off), ageing of open pledges, pipeline by due month; campaign goals
--   H. Only aggregates come back (no household id, no name); another community's money never counts
--   I. Who: giving.view or giving.manage; a finance volunteer and a signed-out caller are refused; the module switch; bad windows
-- Everything runs in one transaction that is rolled back. "Today" is passed in.
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
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60)))::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;

\set c '''15700000-0000-4000-8000-0000000000c1'''
\set d '''15700000-0000-4000-8000-0000000000c2'''
\set tres '''15700000-0000-4000-8000-0000000000a1'''
\set vol '''15700000-0000-4000-8000-0000000000a2'''
\set other '''15700000-0000-4000-8000-0000000000a3'''
\set h1 '''15700000-0000-4000-8000-000000000101'''
\set h2 '''15700000-0000-4000-8000-000000000102'''
\set h3 '''15700000-0000-4000-8000-000000000103'''
\set h4 '''15700000-0000-4000-8000-000000000104'''
\set h5 '''15700000-0000-4000-8000-000000000105'''
\set h6 '''15700000-0000-4000-8000-000000000106'''
\set h7 '''15700000-0000-4000-8000-000000000107'''
\set h8 '''15700000-0000-4000-8000-000000000108'''
\set h9 '''15700000-0000-4000-8000-000000000109'''
\set h10 '''15700000-0000-4000-8000-000000000110'''
\set h11 '''15700000-0000-4000-8000-000000000111'''
\set h12 '''15700000-0000-4000-8000-000000000112'''
\set h13 '''15700000-0000-4000-8000-000000000113'''
\set h14 '''15700000-0000-4000-8000-000000000114'''
\set hm '''15700000-0000-4000-8000-000000000199'''
\set hd '''15700000-0000-4000-8000-000000000201'''
\set f1 '''15700000-0000-4000-8000-000000000301'''
\set c1 '''15700000-0000-4000-8000-000000000401'''
\set c2 '''15700000-0000-4000-8000-000000000402'''
\set c3 '''15700000-0000-4000-8000-000000000403'''
\set o1 '''15700000-0000-4000-8000-000000000501'''
\set plf0 '''15700000-0000-4000-8000-000000000600'''
\set plf1 '''15700000-0000-4000-8000-000000000601'''
\set plc1 '''15700000-0000-4000-8000-000000000602'''
\set plr '''15700000-0000-4000-8000-000000000603'''
\set plw '''15700000-0000-4000-8000-000000000604'''
\set plo '''15700000-0000-4000-8000-000000000605'''
\set plx '''15700000-0000-4000-8000-000000000606'''
\set plm '''15700000-0000-4000-8000-000000000607'''
\set pls '''15700000-0000-4000-8000-000000000608'''
\set pold '''15700000-0000-4000-8000-000000000609'''
\set pa0 '''15700000-0000-4000-8000-000000000700'''
\set pa1 '''15700000-0000-4000-8000-000000000701'''
\set pa4 '''15700000-0000-4000-8000-000000000704'''
\set pa5 '''15700000-0000-4000-8000-000000000705'''
\set pa7 '''15700000-0000-4000-8000-000000000707'''
\set pa8 '''15700000-0000-4000-8000-000000000708'''
\set rg '''15700000-0000-4000-8000-000000000801'''

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values (:tres, 'treasurer157@chamber.test'), (:vol, 'volunteer157@chamber.test'), (:other, 'other157@elsewhere.test');
insert into app.centers (id, slug, name, short_name, category_key, time_zone, currency) values
  (:c, 'chamber157', 'Lakeside Chamber 157', 'LC157', 'chamber_of_commerce', 'America/Toronto', 'CAD'),
  (:d, 'elsewhere157', 'Elsewhere Club 157', 'EC157', 'nonprofit_secular', 'America/Toronto', 'CAD');
insert into app.org_profiles (center_id, fiscal_year_start_month) values (:c, 4) on conflict (center_id) do update set fiscal_year_start_month = 4;
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:c, :tres, 'treasurer', 'giving insights test 157'), (:c, :vol, 'finance_volunteer', 'giving insights test 157'),
  (:d, :other, 'treasurer', 'giving insights test 157');
-- Eleven member businesses (the twelfth was merged into the first), and three more used only in E.
insert into app.households (id, center_id, display_name) values
  (:h1, :c, 'Member 1'), (:h2, :c, 'Member 2'), (:h3, :c, 'Member 3'), (:h4, :c, 'Member 4'), (:h5, :c, 'Member 5'),
  (:h6, :c, 'Member 6'), (:h7, :c, 'Member 7'), (:h8, :c, 'Member 8'), (:h9, :c, 'Member 9'), (:h10, :c, 'Member 10'),
  (:h11, :c, 'Member 11'), (:hm, :c, 'Member 1 (old)'), (:hd, :d, 'Elsewhere member');
update app.households set merged_into_id = :h1 where id = :hm;

insert into app.funds (id, center_id, key, name, restricted) values (:f1, :c, 'c157-scholarship', 'Scholarship fund 157', true);
insert into app.campaigns (id, center_id, name, kind, status, goal_cents, starts_on, ends_on) values
  (:c1, :c, 'Main Street lights 157', 'general', 'published', 100000, date '2026-04-01', date '2026-12-31'),
  (:c2, :c, 'No goal 157', 'general', 'published', null, null, null),
  (:c3, :c, 'Archived 157', 'general', 'archived', 50000, date '2026-01-01', date '2026-12-31');
insert into app.opportunities (id, center_id, campaign_id, name, amount_cents, status) values (:o1, :c, :c1, 'Monthly sponsor 157', 3000, 'open');
insert into app.recurring_gifts (id, center_id, household_id, campaign_id, amount_cents, frequency, status, starts_on, next_charge_on, end_kind)
values (:rg, :c, :h5, :c1, 3000, 'monthly', 'active', date '2026-07-01', date '2026-11-01', 'until_stopped');

-- Pledges (noon UTC; the community's own day is the same). Fees: plm (membership), pls (store).
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at, due_on, status, fund_id, campaign_id, opportunity_id) values
  (:plf0, :c, :h1, 'general', 4000, timestamptz '2025-04-20 12:00:00+00', null, 'open', :f1, null, null),
  (:plf1, :c, :h1, 'general', 12000, timestamptz '2026-04-15 12:00:00+00', null, 'open', :f1, null, null),
  (:plc1, :c, :h4, 'general', 50000, timestamptz '2026-05-20 12:00:00+00', date '2026-08-01', 'open', null, :c1, null),
  (:plr, :c, :h5, 'recurring', 3000, timestamptz '2026-07-01 12:00:00+00', null, 'open', null, null, :o1),
  (:plo, :c, :h3, 'general', 2500, timestamptz '2026-09-20 12:00:00+00', null, 'open', null, null, null),
  (:plx, :c, :h6, 'general', 9999, timestamptz '2026-06-01 12:00:00+00', null, 'cancelled', null, null, null),
  (:plm, :c, :h7, 'membership_fee', 6000, timestamptz '2026-05-15 12:00:00+00', null, 'open', null, null, null),
  (:pls, :c, :h8, 'store', 3000, timestamptz '2026-09-01 12:00:00+00', null, 'open', null, null, null),
  (:pold, :c, :h2, 'general', 4000, timestamptz '2025-01-10 12:00:00+00', date '2025-06-01', 'open', null, null, null);
insert into app.pledges (id, center_id, household_id, source, amount_cents, paid_cents, pledged_at, status) values
  (:plw, :c, :h2, 'general', 5000, 0, timestamptz '2026-05-05 12:00:00+00', 'written_off');

-- Payments. This year runs from April 1, 2026; "today" is October 13, 2026.
insert into app.payments (id, center_id, household_id, amount_cents, method, status, provider, received_on, refunded_cents, is_historical, is_opening_balance) values
  -- before last year
  ('15700000-0000-4000-8000-000000000710', :c, :h1, 1000, 'check', 'captured', 'offline', date '2024-06-01', 0, false, false),
  ('15700000-0000-4000-8000-000000000711', :c, :h4, 2500, 'check', 'captured', 'offline', date '2024-12-01', 0, false, false),
  -- last year (April 1, 2025 to March 31, 2026)
  (:pa0, :c, :h1, 4000, 'check', 'captured', 'offline', date '2025-05-01', 0, false, false),
  ('15700000-0000-4000-8000-000000000712', :c, :h2, 9000, 'ach', 'captured', 'offline', date '2025-06-10', 0, false, false),
  ('15700000-0000-4000-8000-000000000713', :c, :h5, 1500, 'cash', 'captured', 'offline', date '2026-03-31', 0, false, false),
  -- this year
  (:pa1, :c, :h1, 10000, 'check', 'captured', 'offline', date '2026-05-01', 0, false, false),
  ('15700000-0000-4000-8000-000000000714', :c, :h1, 2000, 'cash', 'captured', 'offline', date '2026-09-20', 0, false, false),
  ('15700000-0000-4000-8000-000000000715', :c, :h3, 5000, 'zelle', 'captured', 'offline', date '2026-04-01', 0, false, false),
  (:pa4, :c, :h4, 20000, 'check', 'captured', 'offline', date '2026-06-01', 0, false, false),
  (:pa5, :c, :h5, 3000, 'ach', 'captured', 'offline', date '2026-07-01', 0, false, false),
  ('15700000-0000-4000-8000-000000000716', :c, :h6, 4000, 'ach', 'captured', 'offline', date '2026-08-01', 0, false, false),
  (:pa7, :c, :h7, 6000, 'check', 'captured', 'offline', date '2026-05-15', 0, false, false),
  (:pa8, :c, :h8, 10000, 'check', 'captured', 'offline', date '2026-09-01', 0, false, false),
  ('15700000-0000-4000-8000-000000000717', :c, :h11, 8000, 'check', 'partially_refunded', 'offline', date '2026-09-15', 2000, false, false),
  -- left out: failed, fully refunded, an opening balance with a made-up date, another community's gift
  ('15700000-0000-4000-8000-000000000718', :c, :h9, 7777, 'check', 'failed', 'offline', date '2026-06-15', 0, false, false),
  ('15700000-0000-4000-8000-000000000719', :c, :h10, 5000, 'check', 'refunded', 'offline', date '2026-06-20', 5000, false, false),
  ('15700000-0000-4000-8000-000000000720', :c, :h6, 88800, 'other', 'captured', 'offline', date '2025-05-05', 0, true, true),
  ('15700000-0000-4000-8000-000000000721', :d, :hd, 99900, 'check', 'captured', 'offline', date '2026-06-01', 0, false, false);
insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents) values
  (:c, :pa0, :plf0, 4000), (:c, :pa1, :plf1, 10000), (:c, :pa4, :plc1, 20000), (:c, :pa5, :plr, 3000),
  (:c, :pa7, :plm, 6000), (:c, :pa8, :pls, 3000);

-- ══ The treasurer asks ═══════════════════════════════════════════════════════
create temp table r (j jsonb);
grant select, insert on r to authenticated;
set role authenticated;
select pg_temp.claims(:tres);
insert into r select app.giving_insights(:c, date '2026-04-01', date '2026-10-13', date '2026-10-13');

-- A, B, C
select pg_temp.assert((select (j->'donations'->>'this_cents')::bigint from r) = 57000,
  'A · donations this year: 570.00 (net of a 20.00 refund; the 30.00 store part and the membership fee left out; failed, refunded, opening balance and another community left out)');
select pg_temp.assert((select j->'fees' from r) = '{"this_cents": 9000, "membership_cents": 6000, "school_cents": 0, "store_cents": 3000}'::jsonb,
  'A · fees are their own line: 60.00 membership, 30.00 store');
select pg_temp.assert((select (j->'donations'->>'last_year_cents')::bigint from r) = 14500
                      and (select (j->'donations'->>'same_point_last_cents')::bigint from r) = 13000,
  'B · last year (April 1, 2025 to March 31, 2026, the March 31 gift included): 145.00; to the same day last year: 130.00');
select pg_temp.assert((select (j->'donations'->>'gifts')::int from r) = 8
                      and (select (j->'donations'->>'average_gift_cents')::bigint from r) = 7125
                      and (select (j->'donations'->>'median_gift_cents')::bigint from r) = 5500,
  'C · 8 gifts, average 71.25, median 55.00 (the middle of an even count)');
select pg_temp.assert((select (j->'donations'->>'households')::int from r) = 7
                      and (select (j->'donations'->>'households_same_point_last')::int from r) = 2
                      and (select (j->'donations'->>'median_household_cents')::bigint from r) = 6000
                      and (select (j->'donations'->>'member_households')::int from r) = 11,
  'C · 7 giving businesses of 11 members (the merged one not counted), 2 at the same point last year, typical yearly giving 60.00');

-- D
select pg_temp.assert((select j->'retention' from r) = '{"kept": 2, "lost": 1, "new": 4, "regained": 1}'::jsonb,
  'D · kept 2 (one gave on March 31, the last day of last year), lost 1, new 4 (an opening balance is not a first gift), regained 1');

-- E
select pg_temp.assert((select j->'concentration' from r) = '{"households": 7, "top_households": null, "top_cents": null}'::jsonb,
  'E · 7 giving businesses: fewer than 10, so the top tenth''s share is not computed');
savepoint ten;
reset role;
insert into app.households (id, center_id, display_name) values (:h12, :c, 'Member 12'), (:h13, :c, 'Member 13'), (:h14, :c, 'Member 14');
insert into app.payments (center_id, household_id, amount_cents, method, status, provider, received_on, refunded_cents, is_historical, is_opening_balance) values
  (:c, :h12, 1000, 'cash', 'captured', 'offline', date '2026-10-01', 0, false, false),
  (:c, :h13, 1000, 'cash', 'captured', 'offline', date '2026-10-02', 0, false, false),
  (:c, :h14, 1000, 'cash', 'captured', 'offline', date '2026-10-03', 0, false, false);
set role authenticated;
select pg_temp.claims(:tres);
select pg_temp.assert(app.giving_insights(:c, date '2026-04-01', date '2026-10-13', date '2026-10-13')->'concentration'
                        = '{"households": 10, "top_households": 1, "top_cents": 20000}'::jsonb,
  'E · 10 giving businesses: the top tenth (1) gave 200.00');
rollback to savepoint ten;
set role authenticated;
select pg_temp.claims(:tres);

-- F
select pg_temp.assert((select j->'categories'->'fund' from r) = jsonb_build_array(jsonb_build_object('key', :f1::uuid, 'label', 'Scholarship fund 157', 'this_cents', 10000, 'last_cents', 4000))
                      and (select j->'categories'->'campaign' from r) = jsonb_build_array(jsonb_build_object('key', :c1::uuid, 'label', 'Main Street lights 157', 'this_cents', 20000, 'last_cents', 0))
                      and (select j->'categories'->'opportunity' from r) = jsonb_build_array(jsonb_build_object('key', :o1::uuid, 'label', 'Monthly sponsor 157', 'this_cents', 3000, 'last_cents', 0))
                      and (select (j->'categories'->>'applied_this_cents')::bigint from r) = 33000
                      and (select (j->'categories'->>'applied_last_cents')::bigint from r) = 4000,
  'F · by fund, campaign and opportunity, this year against the same point last year; 330.00 applied this year (the store part is not)');
select pg_temp.assert((select j->'recurring' from r) = '{"this_cents": 3000, "active_gifts": 1}'::jsonb,
  'F · 30.00 came through a recurring gift; one recurring gift is active');
select pg_temp.assert((select jsonb_agg(jsonb_build_array(m->>'month', (m->>'this_cents')::bigint, (m->>'last_cents')::bigint) order by m->>'month')
                         from r, jsonb_array_elements(j->'months') m)
                      = '[["2026-04",5000,0],["2026-05",10000,4000],["2026-06",20000,9000],["2026-07",3000,0],["2026-08",4000,0],["2026-09",15000,0],
                          ["2026-10",0,0],["2026-11",0,0],["2026-12",0,0],["2027-01",0,0],["2027-02",0,0],["2027-03",0,1500]]'::jsonb,
  'F · twelve months from April, each against the same month last year');

-- G
select pg_temp.assert((select j->'pledges' - 'ageing' from r) = '{"made": 5, "pledged_cents": 72500, "paid_cents": 33000, "written_off_cents": 5000}'::jsonb,
  'G · 5 pledges made this year (the cancelled one and the fees left out): 725.00 pledged, 330.00 paid, 50.00 written off');
select pg_temp.assert((select j->'pledges'->'ageing' from r) = '[{"bucket": "not_due", "pledges": 1, "open_cents": 2500}, {"bucket": "1_30", "pledges": 0, "open_cents": 0},
    {"bucket": "31_60", "pledges": 0, "open_cents": 0}, {"bucket": "61_90", "pledges": 1, "open_cents": 30000},
    {"bucket": "over_90", "pledges": 2, "open_cents": 6000}]'::jsonb,
  'G · open pledges by days overdue (no due date: due 30 days after it was made)');
select pg_temp.assert((select (j->'pipeline'->>'overdue_cents')::bigint from r) = 36000
                      and (select (j->'pipeline'->>'overdue_pledges')::int from r) = 3
                      and (select j->'pipeline'->'months'->0 from r) = '{"month": "2026-10", "pledges": 1, "open_cents": 2500}'::jsonb
                      and (select jsonb_array_length(j->'pipeline'->'months') from r) = 12
                      and (select (j->'pipeline'->>'later_cents')::bigint from r) = 0,
  'G · pipeline: 360.00 overdue, 25.00 due in October');
select pg_temp.assert((select j->'goals' from r) = jsonb_build_array(jsonb_build_object('key', :c1::uuid, 'label', 'Main Street lights 157', 'goal_cents', 100000,
                         'starts_on', '2026-04-01', 'ends_on', '2026-12-31', 'pledged_cents', 50000, 'paid_cents', 20000)),
  'G · the one live campaign with a goal (none invented; the archived one left out)');

-- H
select pg_temp.assert((select j::text from r) !~ '15700000-0000-4000-8000-0000000001'
                      and (select j::text from r) not like '%Member%',
  'H · no household id and no household name comes back');
select pg_temp.claims(:other);
select pg_temp.assert((app.giving_insights(:d, date '2026-04-01', date '2026-10-13', date '2026-10-13')->'donations'->>'this_cents')::bigint = 99900,
  'H · another community sees only its own giving');
select pg_temp.assert_raises(format($$select app.giving_insights(%L, date '2026-04-01', date '2026-10-13')$$, :c),
  'giving.view or giving.manage', 'I · a treasurer of another community is refused');

-- I
select pg_temp.claims(:vol);
select pg_temp.assert_raises(format($$select app.giving_insights(%L, date '2026-04-01', date '2026-10-13')$$, :c),
  'giving.view or giving.manage', 'I · a finance volunteer (giving.record_offline) is refused');
select pg_temp.no_claims();
select pg_temp.assert_raises(format($$select app.giving_insights(%L, date '2026-04-01', date '2026-10-13')$$, :c),
  'giving.view or giving.manage', 'I · nobody signed out');
select pg_temp.claims(:tres);
select pg_temp.assert_raises(format($$select app.giving_insights(%L, date '2026-10-13', date '2026-04-01')$$, :c),
  'less than a year apart', 'I · a window that ends before it starts is refused');
select pg_temp.assert_raises(format($$select app.giving_insights(%L, date '2025-04-01', date '2026-04-01')$$, :c),
  'less than a year apart', 'I · a window longer than a year is refused');
reset role;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving_insights', false, 'test 157')
  on conflict (center_id, module_key) do update set enabled = false;
set role authenticated;
select pg_temp.claims(:tres);
select pg_temp.assert_raises(format($$select app.giving_insights(%L, date '2026-04-01', date '2026-10-13')$$, :c),
  'switched off', 'I · Insights switched off: the function refuses with the module sentence');
reset role;
select pg_temp.assert((select p.prosecdef and p.provolatile = 's' and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%'
                         from pg_proc p where p.oid = 'app.giving_insights(uuid, date, date, date)'::regprocedure)
                      and not has_function_privilege('anon', 'app.giving_insights(uuid, date, date, date)', 'execute')
                      and exists (select 1 from app.activity_catalog where key = 'screen:/giving/insights' and surface = 'portal'),
  'I · security definer, stable (read only), pinned search path, not callable signed out; the screen is on the activity allowlist');

rollback;
