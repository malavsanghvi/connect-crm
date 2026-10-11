-- 0672 (BACKLOG B90 phase 4, B83): the Reports summary reads. The Reports page used to add these figures up in page code from up to
-- 50,000 rows at a time; now the database adds them up. This test holds the figures the old page code would have produced for the
-- same small community (counted by hand, and re-added row by row below) and checks the functions answer exactly the same.
--   A. People: households, new this year, on the app, by zone, renewals due        B. Memberships: tier by status, changes, applications
--   C. Money received by method, month, year, fund and campaign (net of refunds; failed, voided and authorized left out)
--   D. Pledges by campaign (the day a pledge was made is the community's own day), what is open now
--   E. Event check-ins (the community's own day)    F. Store sales    G. One period's headline figures
--   H. The same figures added up row by row, the way the old page did    I. Row-level security decides (security invoker)
--   J. They read, never write; nobody signed out can call them; a bad grouping is refused with a plain sentence
-- Everything runs in its own community (G128) in one transaction that is rolled back. Dates are fixed ("today" is passed in).
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
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/reports"}', true);
end $$;

\set c '''12800000-0000-4000-8000-0000000000c1'''
\set d '''12800000-0000-4000-8000-0000000000d1'''
\set owen '''12800000-0000-4000-8000-0000000000a1'''
\set vera '''12800000-0000-4000-8000-0000000000a2'''
\set zed '''12800000-0000-4000-8000-0000000000a3'''
\set ana '''12800000-0000-4000-8000-0000000000a4'''
\set bea '''12800000-0000-4000-8000-0000000000a5'''
\set cal '''12800000-0000-4000-8000-0000000000a6'''
\set p1 '''12800000-0000-4000-8000-000000000101'''
\set p2 '''12800000-0000-4000-8000-000000000102'''
\set p3 '''12800000-0000-4000-8000-000000000103'''
\set p4 '''12800000-0000-4000-8000-000000000104'''
\set p5 '''12800000-0000-4000-8000-000000000105'''
\set po '''12800000-0000-4000-8000-000000000106'''
\set pv '''12800000-0000-4000-8000-000000000107'''
\set pz '''12800000-0000-4000-8000-000000000108'''
\set h1 '''12800000-0000-4000-8000-000000000201'''
\set h2 '''12800000-0000-4000-8000-000000000202'''
\set h3 '''12800000-0000-4000-8000-000000000203'''
\set h4 '''12800000-0000-4000-8000-000000000204'''
\set h5 '''12800000-0000-4000-8000-000000000205'''
\set hz '''12800000-0000-4000-8000-000000000206'''
\set z1 '''12800000-0000-4000-8000-000000000301'''
\set z2 '''12800000-0000-4000-8000-000000000302'''
\set mty '''12800000-0000-4000-8000-000000000401'''
\set mtl '''12800000-0000-4000-8000-000000000402'''
\set mtc '''12800000-0000-4000-8000-000000000403'''
\set f1 '''12800000-0000-4000-8000-000000000501'''
\set f2 '''12800000-0000-4000-8000-000000000502'''
\set ca '''12800000-0000-4000-8000-000000000601'''
\set cb '''12800000-0000-4000-8000-000000000602'''
\set pl1 '''12800000-0000-4000-8000-000000000701'''
\set pl2 '''12800000-0000-4000-8000-000000000702'''
\set pa1 '''12800000-0000-4000-8000-000000000801'''
\set pa2 '''12800000-0000-4000-8000-000000000802'''
\set pa3 '''12800000-0000-4000-8000-000000000803'''
\set e1 '''12800000-0000-4000-8000-000000000901'''
\set e2 '''12800000-0000-4000-8000-000000000902'''
\set r1 '''12800000-0000-4000-8000-000000000911'''
\set r2 '''12800000-0000-4000-8000-000000000912'''
\set ia '''12800000-0000-4000-8000-000000000a01'''
\set ib '''12800000-0000-4000-8000-000000000a02'''
\set o1 '''12800000-0000-4000-8000-000000000b01'''
\set o2 '''12800000-0000-4000-8000-000000000b02'''
\set o3 '''12800000-0000-4000-8000-000000000b03'''
\set o4 '''12800000-0000-4000-8000-000000000b04'''
\set o5 '''12800000-0000-4000-8000-000000000b05'''

begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into app.centers (id, slug, name, short_name, time_zone) values
  (:c, 'g128-temple', 'G128 Jain Temple', 'G128', 'America/Chicago'),
  (:d, 'g128-other', 'G128 Other Temple', 'G128B', 'America/Chicago');
insert into auth.users (id, email) values
  (:owen, 'owen@g128.test'), (:vera, 'vera@g128.test'), (:zed, 'zed@g128.test'),
  (:ana, 'ana@g128.test'), (:bea, 'bea@g128.test'), (:cal, 'cal@g128.test');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  (:p1, :c, 'Ana', 'Shah', 'ana@g128.test', '1980-04-02'),
  (:p2, :c, 'Ravi', 'Shah', null, '1978-06-11'),
  (:p3, :c, 'Bea', 'Mehta', 'bea@g128.test', '1970-01-01'),
  (:p4, :c, 'Cal', 'Doshi', 'cal@g128.test', '1975-05-05'),
  (:p5, :c, 'Esha', 'Parekh', null, '1985-08-08'),
  (:po, :c, 'Owen', 'Owner', 'owen@g128.test', '1960-01-01'),
  (:pv, :c, 'Vera', 'Volunteer', 'vera@g128.test', '1990-01-01'),
  (:pz, :d, 'Zed', 'Other', 'zed@g128.test', '1975-01-01');
insert into app.zones (id, center_id, name) values (:z1, :c, 'North'), (:z2, :c, 'South');
-- Four households (H5 was merged into H1 and is not counted). H1 and H2 are in the North, H4 in the South, H3 has no zone.
insert into app.households (id, center_id, display_name, zone_id, created_at) values
  (:h1, :c, 'Shah family', :z1, timestamptz '2026-02-01 12:00:00+00'),
  (:h2, :c, 'Mehta family', :z1, timestamptz '2025-11-01 12:00:00+00'),
  (:h3, :c, 'Doshi family', null, timestamptz '2026-06-15 12:00:00+00'),
  (:h4, :c, 'Parekh family', :z2, timestamptz '2026-03-03 12:00:00+00'),
  (:h5, :c, 'Shah family (old)', :z1, timestamptz '2026-04-01 12:00:00+00'),
  (:hz, :d, 'Other family', null, timestamptz '2026-01-01 12:00:00+00');
update app.households set merged_into_id = :h1 where id = :h5;
insert into app.household_members (household_id, person_id, center_id, role, is_primary, left_at) values
  (:h1, :p1, :c, 'primary', true, null),
  (:h1, :p2, :c, 'spouse', false, null),
  (:h2, :p3, :c, 'primary', true, timestamptz '2026-05-01 12:00:00+00'),
  (:h3, :p4, :c, 'primary', true, null),
  (:h4, :p5, :c, 'primary', true, null);
-- Signed-in people: Ana (H1) and Cal (H3) belong to a household now, Bea left hers. So two households are "on the app".
insert into app.center_users (center_id, user_id, person_id, is_default) values
  (:c, :ana, :p1, false), (:c, :bea, :p3, false), (:c, :cal, :p4, false), (:c, :owen, :po, false), (:c, :vera, :pv, false),
  (:d, :zed, :pz, false);
insert into app.center_owners (center_id, user_id) values (:c, :owen), (:d, :zed);

insert into app.membership_types (id, center_id, key, name, tier) values
  (:mty, :c, 'yearly', 'Yearly', 'yearly'), (:mtl, :c, 'life', 'Life', 'life'), (:mtc, :c, 'community', 'Community', 'community');
insert into app.memberships (center_id, household_id, membership_type_id, tier, status, starts_on, ends_on) values
  (:c, :h1, :mty, 'yearly', 'active', date '2025-11-21', date '2026-11-20'),
  (:c, :h2, :mty, 'yearly', 'active', date '2026-06-02', date '2027-06-01'),
  (:c, :h3, :mtl, 'life', 'active', date '2026-06-20', null),
  (:c, :h4, :mtc, 'community', 'lapsed', date '2025-09-02', date '2026-09-01'),
  (:c, :h1, :mtc, 'community', 'pending', date '2026-10-01', null),
  (:c, :h2, :mty, 'yearly', 'ended', date '2025-08-16', date '2026-08-15');
insert into app.membership_applications (center_id, applicant_person_id, household_id, membership_type_id, tier, status, created_at) values
  (:c, :p1, :h1, :mty, 'yearly', 'awaiting_center', timestamptz '2026-06-10 15:00:00+00'),
  (:c, :p5, :h4, :mty, 'yearly', 'awaiting_center', timestamptz '2026-09-15 15:00:00+00'),
  (:c, :p4, :h3, :mtl, 'life', 'withdrawn', timestamptz '2026-01-05 15:00:00+00');

insert into app.funds (id, center_id, key, name, restricted) values
  (:f1, :c, 'g128-building', 'G128 Building', true), (:f2, :c, 'g128-food', 'G128 Food', false);
insert into app.campaigns (id, center_id, fund_id, name, kind, status) values
  (:ca, :c, :f2, 'G128 Paryushan', 'general', 'draft'), (:cb, :c, null, 'G128 Diwali', 'general', 'draft');

-- Pledges. pl1 and pl2 get their paid amount from the payments applied below. pl4 was written off with $20.00 paid.
-- pl5 is cancelled. pl6 was made at 22:00 on December 31, 2025 in Chicago (04:00 UTC on January 1): it is a 2025 pledge.
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, pledged_at, status, fund_id, campaign_id) values
  (:pl1, :c, :h1, :p1, 'general', 50000, timestamptz '2026-01-10 12:00:00+00', 'open', null, :ca),
  (:pl2, :c, :h2, :p3, 'general', 20000, timestamptz '2026-03-05 12:00:00+00', 'open', null, :cb),
  ('12800000-0000-4000-8000-000000000703', :c, :h1, :p1, 'general', 6000, timestamptz '2026-11-20 12:00:00+00', 'open', :f1, null),
  ('12800000-0000-4000-8000-000000000706', :c, :h4, :p5, 'general', 4000, timestamptz '2026-01-01 04:00:00+00', 'open', null, :cb),
  ('12800000-0000-4000-8000-000000000707', :d, :hz, null, 'general', 99999, timestamptz '2026-02-02 12:00:00+00', 'open', null, null);
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, paid_cents, pledged_at, status, campaign_id) values
  ('12800000-0000-4000-8000-000000000704', :c, :h3, :p4, 'general', 8000, 2000, timestamptz '2026-04-01 12:00:00+00', 'written_off', :ca);
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, pledged_at, status, campaign_id) values
  ('12800000-0000-4000-8000-000000000705', :c, :h3, :p4, 'general', 5000, timestamptz '2026-02-01 12:00:00+00', 'cancelled', :ca);

-- Payments. Counted in 2026: pa1..pa4 and the opening balance pa8 (the page has always counted it). Left out: failed, voided, authorized.
insert into app.payments (id, center_id, household_id, amount_cents, method, status, provider, received_on, recorded_by, refunded_cents, is_historical, is_opening_balance) values
  (:pa1, :c, :h1, 10000, 'check', 'captured', 'offline', date '2026-03-10', :owen, 0, false, false),
  (:pa2, :c, :h1, 5000, 'zelle', 'captured', 'offline', date '2026-06-01', :owen, 0, false, false),
  (:pa3, :c, :h2, 3000, 'ach', 'partially_refunded', 'offline', date '2026-09-15', :owen, 1000, false, false),
  ('12800000-0000-4000-8000-000000000804', :c, :h3, 7000, 'cash', 'captured', 'offline', date '2026-10-02', :owen, 0, false, false),
  ('12800000-0000-4000-8000-000000000805', :c, :h3, 9999, 'check', 'failed', 'offline', date '2026-09-01', :owen, 0, false, false),
  ('12800000-0000-4000-8000-000000000806', :c, :h4, 2500, 'zelle', 'voided', 'offline', date '2026-05-05', :owen, 0, false, false),
  ('12800000-0000-4000-8000-000000000807', :c, :h4, 4000, 'cash', 'authorized', 'offline', date '2026-10-01', :owen, 0, false, false),
  ('12800000-0000-4000-8000-000000000808', :c, :h1, 77700, 'other', 'captured', 'offline', date '2026-01-01', :owen, 0, true, true),
  ('12800000-0000-4000-8000-000000000811', :c, :h1, 6000, 'check', 'captured', 'offline', date '2025-12-20', :owen, 0, false, false),
  ('12800000-0000-4000-8000-000000000812', :c, :h2, 4000, 'zelle', 'captured', 'offline', date '2025-10-05', :owen, 0, false, false),
  ('12800000-0000-4000-8000-000000000813', :c, :h2, 8000, 'check', 'captured', 'offline', date '2025-10-20', :owen, 0, false, false);
-- Applied to pledges: pa1 and pa2 to pl1 ($150.00 of $500.00), pa3 to pl2 ($30.00 of $200.00). pa4 and the opening balance are applied to nothing.
insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents) values
  (:c, :pa1, :pl1, 10000), (:c, :pa2, :pl1, 5000), (:c, :pa3, :pl2, 3000);

-- Events. Four check-ins at the Diwali dinner in 2026 (the fourth at 01:00 on January 1 in Chicago, 07:00 UTC), one not checked in.
-- The picnic of 2025 has two (the second at 23:30 on December 31, 2025 in Chicago, 05:30 UTC on January 1: a 2025 check-in).
insert into app.events (id, center_id, name, starts_at, ends_at, status) values
  (:e1, :c, 'G128 Diwali dinner', timestamptz '2026-09-20 23:00:00+00', timestamptz '2026-09-21 03:00:00+00', 'published'),
  (:e2, :c, 'G128 Picnic', timestamptz '2025-09-14 16:00:00+00', timestamptz '2025-09-14 21:00:00+00', 'published');
insert into app.rsvps (id, center_id, event_id, household_id, status, confirmed_at, source) values
  (:r1, :c, :e1, :h1, 'confirmed', now(), 'app'), (:r2, :c, :e2, :h1, 'confirmed', now(), 'app');
insert into app.attendees (center_id, event_id, rsvp_id, display_name, is_child_under_12, status, checked_in_at) values
  (:c, :e1, :r1, 'Guest Alpha', false, 'confirmed', timestamptz '2026-09-20 18:00:00+00'),
  (:c, :e1, :r1, 'Guest Bravo', true, 'confirmed', timestamptz '2026-09-20 18:05:00+00'),
  (:c, :e1, :r1, 'Guest Charlie', false, 'confirmed', timestamptz '2026-09-21 02:00:00+00'),
  (:c, :e1, :r1, 'Guest Delta', false, 'confirmed', timestamptz '2026-01-01 07:00:00+00'),
  (:c, :e1, :r1, 'Guest Echo', false, 'confirmed', null),
  (:c, :e2, :r2, 'Guest Foxtrot', false, 'confirmed', timestamptz '2025-09-14 17:00:00+00'),
  (:c, :e2, :r2, 'Guest Golf', false, 'confirmed', timestamptz '2026-01-01 05:30:00+00');

-- Store: o1 (Sept 20) $30.00, o2 (Oct 2, picked up) $10.00, o5 (22:00 on Sept 30 in Chicago) $5.00 count; o3 is still a cart; o4 was cancelled.
insert into app.store_items (id, center_id, name, price_cents) values (:ia, :c, 'G128 Kaju katli', 1000), (:ib, :c, 'G128 Chakli', 250);
insert into app.store_orders (id, center_id, order_number, status, placed_at) values
  (:o1, :c, null, 'cart', timestamptz '2026-09-20 18:00:00+00'),
  (:o2, :c, null, 'cart', timestamptz '2026-10-02 15:00:00+00'),
  (:o3, :c, null, 'cart', null),
  (:o4, :c, null, 'cart', timestamptz '2026-08-30 15:00:00+00'),
  (:o5, :c, null, 'cart', timestamptz '2026-10-01 03:00:00+00');
insert into app.store_order_lines (center_id, order_id, item_id, quantity, unit_price_cents, is_gift, line_total_cents) values
  (:c, :o1, :ia, 2, 1000, false, 0), (:c, :o1, :ib, 4, 250, false, 0),
  (:c, :o2, :ia, 1, 1000, false, 0),
  (:c, :o3, :ib, 1, 250, false, 0),
  (:c, :o4, :ia, 1, 1000, false, 0),
  (:c, :o5, :ib, 2, 250, false, 0);
update app.store_orders set status = 'placed' where id in (:o1, :o4, :o5);
update app.store_orders set status = 'picked_up' where id = :o2;
update app.store_orders set status = 'cancelled' where id = :o4;

-- ═══════════════════════════════════════════════════════════════════════════
-- What each person gets (kept in psql variables, then checked below)
-- ═══════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:owen);
select app.reports_people_overview(:c, 2026, date '2026-10-10')::text as people \gset
select app.reports_membership_matrix(:c)::text as matrix \gset
select app.reports_membership_changes(:c, date '2026-06-01', date '2026-10-10', date '2026-10-10')::text as changes \gset
select app.reports_payments_summary(:c, date '2026-01-01', date '2026-12-31', 'method')::text as pay_method \gset
select app.reports_payments_summary(:c, date '2026-01-01', date '2026-12-31', 'month')::text as pay_month \gset
select app.reports_payments_summary(:c, date '2025-01-01', date '2026-12-31', 'year')::text as pay_year \gset
select app.reports_payments_summary(:c, date '2025-01-01', date '2025-10-10', 'none')::text as pay_prev \gset
select app.reports_payments_summary(:c, date '2026-01-01', date '2026-12-31', 'fund')::text as pay_fund \gset
select app.reports_payments_summary(:c, date '2026-01-01', date '2026-12-31', 'campaign')::text as pay_campaign \gset
select app.reports_pledges_summary(:c, date '2026-01-01', date '2026-12-31')::text as plg26 \gset
select app.reports_pledges_summary(:c, date '2025-01-01', date '2025-12-31')::text as plg25 \gset
select app.reports_attendance(:c, date '2026-01-01', date '2026-12-31', 10)::text as att26 \gset
select app.reports_attendance(:c, date '2025-01-01', date '2025-12-31', 10)::text as att25 \gset
select app.reports_attendance(:c, date '2025-01-01', date '2025-10-10', 10)::text as att_prev \gset
select app.reports_store_sales(:c, date '2026-01-01', date '2026-10-10', 10)::text as shop \gset
select app.reports_period_figures(:c, date '2026-09-01', date '2026-09-30')::text as fig_sep \gset
select app.reports_period_figures(:c, date '2026-10-01', date '2026-10-10')::text as fig_oct \gset
reset role;

set local role authenticated;
select pg_temp.as_user(:vera);
select app.reports_payments_summary(:c, date '2026-01-01', date '2026-12-31', 'method')::text as v_pay \gset
select app.reports_pledges_summary(:c, date '2026-01-01', date '2026-12-31')::text as v_plg \gset
select app.reports_membership_matrix(:c)::text as v_matrix \gset
select app.reports_attendance(:c, date '2026-01-01', date '2026-12-31', 10)::text as v_att \gset
select app.reports_store_sales(:c, date '2026-01-01', date '2026-10-10', 10)::text as v_shop \gset
reset role;

set local role authenticated;
select pg_temp.as_user(:zed);
select app.reports_people_overview(:c, 2026, date '2026-10-10')::text as z_people \gset
select app.reports_payments_summary(:c, date '2026-01-01', date '2026-12-31', 'method')::text as z_pay \gset
select app.reports_pledges_summary(:c, date '2026-01-01', date '2026-12-31')::text as z_plg \gset
select app.reports_membership_matrix(:c)::text as z_matrix \gset
select app.reports_attendance(:c, date '2026-01-01', date '2026-12-31', 10)::text as z_att \gset
select app.reports_store_sales(:c, date '2026-01-01', date '2026-10-10', 10)::text as z_shop \gset
select app.reports_pledges_summary(:d, date '2026-01-01', date '2026-12-31')::text as z_own \gset
reset role;

-- ═══════════════════════════════════════════════════════════════════════════
-- A. People
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert(((:'people'::jsonb)->>'households')::int = 4 and ((:'people'::jsonb)->>'new_in_year')::int = 3
                      and ((:'people'::jsonb)->>'households_on_app')::int = 2 and ((:'people'::jsonb)->>'renewals_due')::int = 1
                      and ((:'people'::jsonb)->>'year')::int = 2026 and ((:'people'::jsonb)->>'as_of') = '2026-10-10',
  'A: four households (the merged one is not counted), three new in 2026, two on the app, one renewal due in 60 days');
select pg_temp.assert((:'people'::jsonb)->'zones' = '[{"zone":"North","households":2},{"zone":"No zone","households":1},{"zone":"South","households":1}]'::jsonb,
  'A: households by zone, the largest first, with "No zone" for a household that has none');
select pg_temp.assert(round(100.0 * ((:'people'::jsonb)->>'households_on_app')::int / ((:'people'::jsonb)->>'households')::int) = 50,
  'A: on the app is 50 percent of households');

-- ═══════════════════════════════════════════════════════════════════════════
-- B. Memberships
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert((:'matrix'::jsonb)->'cells' = '[{"tier":"community","status":"lapsed","memberships":1},{"tier":"community","status":"pending","memberships":1},
                         {"tier":"life","status":"active","memberships":1},{"tier":"yearly","status":"active","memberships":2},{"tier":"yearly","status":"ended","memberships":1}]'::jsonb,
  'B: memberships by tier and status');
select pg_temp.assert((:'matrix'::jsonb)->'active_households' = '[{"tier":"life","households":1},{"tier":"yearly","households":2}]'::jsonb,
  'B: households with an active membership, counted once per tier');
select pg_temp.assert((:'matrix'::jsonb)->'applications' = '[{"status":"awaiting_center","applications":2},{"status":"withdrawn","applications":1}]'::jsonb,
  'B: applications by status, all time');
select pg_temp.assert(((:'changes'::jsonb)->>'started_total')::int = 2 and (:'changes'::jsonb)->'started' = '[{"tier":"life","memberships":1},{"tier":"yearly","memberships":1}]'::jsonb,
  'B: two memberships started between June 1 and October 10 (the one still pending is not counted)');
select pg_temp.assert(((:'changes'::jsonb)->>'ended_total')::int = 2 and (:'changes'::jsonb)->'ended' = '[{"status":"ended","memberships":1},{"status":"lapsed","memberships":1}]'::jsonb,
  'B: one lapsed and one ended in the range');
select pg_temp.assert(((:'changes'::jsonb)->>'applications_total')::int = 2 and ((:'changes'::jsonb)->>'active_now')::int = 3
                      and ((:'changes'::jsonb)->>'renewals_due_60_days')::int = 1,
  'B: two applications came in, three memberships are active, one renewal is due');

-- ═══════════════════════════════════════════════════════════════════════════
-- C. Money received
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert(((:'pay_method'::jsonb)->'totals') = '{"payments":5,"received_cents":102700,"refunded_cents":1000,"net_cents":101700}'::jsonb,
  'C: 2026 totals: five payments, $1,027.00 received, $10.00 refunded, $1,017.00 net (failed, voided and authorized left out)');
select pg_temp.assert((select jsonb_agg(g->>'key' order by ord) from jsonb_array_elements((:'pay_method'::jsonb)->'groups') with ordinality as t(g, ord))
                        = '["other","check","cash","zelle","ach"]'::jsonb
                      and ((:'pay_method'::jsonb)->'groups'->4) = '{"key":"ach","label":"ach","payments":1,"received_cents":3000,"refunded_cents":1000,"net_cents":2000}'::jsonb,
  'C: by method, the largest net first; the refunded payment shows $30.00 received, $10.00 refunded, $20.00 net');
select pg_temp.assert((select jsonb_agg(g->>'key' order by ord) from jsonb_array_elements((:'pay_month'::jsonb)->'groups') with ordinality as t(g, ord))
                        = '["2026-01","2026-03","2026-06","2026-09","2026-10"]'::jsonb
                      and (select sum((g->>'net_cents')::bigint) from jsonb_array_elements((:'pay_month'::jsonb)->'groups') g) = 101700,
  'C: by month in date order, and the months add up to the net total');
select pg_temp.assert((:'pay_year'::jsonb)->'totals' = '{"payments":8,"received_cents":120700,"refunded_cents":1000,"net_cents":119700}'::jsonb
                      and (:'pay_year'::jsonb)->'groups'->0->>'key' = '2025' and ((:'pay_year'::jsonb)->'groups'->0->>'received_cents')::bigint = 18000
                      and (:'pay_year'::jsonb)->'groups'->1->>'key' = '2026',
  'C: by year');
select pg_temp.assert((:'pay_prev'::jsonb)->'totals' = '{"payments":1,"received_cents":4000,"refunded_cents":0,"net_cents":4000}'::jsonb
                      and (:'pay_prev'::jsonb)->'groups' = '[]'::jsonb,
  'C: last year to the same day (January 1 to October 10, 2025) is one payment of $40.00, and no groups when none are asked for');
select pg_temp.assert((:'pay_fund'::jsonb)->'groups' = '[{"key":"unallocated","label":"Not applied to a pledge","payments":2,"received_cents":84700,"refunded_cents":null,"net_cents":null},
                        {"key":"12800000-0000-4000-8000-000000000502","label":"G128 Food","payments":2,"received_cents":15000,"refunded_cents":null,"net_cents":null},
                        {"key":"none","label":"No fund","payments":1,"received_cents":3000,"refunded_cents":null,"net_cents":null}]'::jsonb
                      and (:'pay_fund'::jsonb)->'totals' = (:'pay_method'::jsonb)->'totals',
  'C: by fund (a pledge with no fund takes its campaign''s fund); money applied to no pledge is its own line; the lines add up to what was received');
select pg_temp.assert((:'pay_campaign'::jsonb)->'groups' = '[{"key":"unallocated","label":"Not applied to a pledge","payments":2,"received_cents":84700,"refunded_cents":null,"net_cents":null},
                        {"key":"12800000-0000-4000-8000-000000000601","label":"G128 Paryushan","payments":2,"received_cents":15000,"refunded_cents":null,"net_cents":null},
                        {"key":"12800000-0000-4000-8000-000000000602","label":"G128 Diwali","payments":1,"received_cents":3000,"refunded_cents":null,"net_cents":null}]'::jsonb,
  'C: by campaign');

-- ═══════════════════════════════════════════════════════════════════════════
-- D. Pledges
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert((:'plg26'::jsonb)->'totals' = '{"pledges":4,"pledged_cents":84000,"paid_cents":20000,"written_off_cents":6000}'::jsonb,
  'D: 2026 pledges: four made, $840.00 pledged, $200.00 paid, $60.00 written off (the cancelled one and the other community''s are left out)');
select pg_temp.assert((:'plg26'::jsonb)->'campaigns' = '[
    {"campaign_id":"12800000-0000-4000-8000-000000000601","campaign":"G128 Paryushan","pledges":2,"pledged_cents":58000,"paid_cents":17000,"written_off_cents":6000},
    {"campaign_id":"12800000-0000-4000-8000-000000000602","campaign":"G128 Diwali","pledges":1,"pledged_cents":20000,"paid_cents":3000,"written_off_cents":0},
    {"campaign_id":null,"campaign":null,"pledges":1,"pledged_cents":6000,"paid_cents":0,"written_off_cents":0}]'::jsonb,
  'D: by campaign, the largest pledged first; a pledge with no campaign is its own line');
select pg_temp.assert((:'plg26'::jsonb)->'open_now' = '{"pledges":4,"open_cents":62000}'::jsonb,
  'D: still open now, whenever they were made: $620.00 across four pledges');
select pg_temp.assert((:'plg25'::jsonb)->'totals' = '{"pledges":1,"pledged_cents":4000,"paid_cents":0,"written_off_cents":0}'::jsonb,
  'D: a pledge made at 22:00 on December 31 in Chicago is a 2025 pledge (the community''s own day, not UTC)');

-- ═══════════════════════════════════════════════════════════════════════════
-- E. Check-ins
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert(((:'att26'::jsonb)->>'check_ins')::int = 4 and ((:'att26'::jsonb)->>'events')::int = 1
                      and (:'att26'::jsonb)->'top_events'->0->>'name' = 'G128 Diwali dinner' and ((:'att26'::jsonb)->'top_events'->0->>'check_ins')::int = 4
                      and (:'att26'::jsonb)->'by_month' = '[{"month":"2026-01","check_ins":1},{"month":"2026-09","check_ins":3}]'::jsonb,
  'E: 2026 has four check-ins at one event (the one at 01:00 on January 1 in Chicago counts for 2026; the guest who did not check in does not)');
select pg_temp.assert(((:'att25'::jsonb)->>'check_ins')::int = 2 and ((:'att25'::jsonb)->>'events')::int = 1
                      and (:'att25'::jsonb)->'by_month' = '[{"month":"2025-09","check_ins":1},{"month":"2025-12","check_ins":1}]'::jsonb,
  'E: 2025 has two (the one at 23:30 on December 31 in Chicago is a 2025 check-in)');
select pg_temp.assert(((:'att_prev'::jsonb)->>'check_ins')::int = 1, 'E: last year to the same day has one');
select pg_temp.assert(position('Guest' in :'att26') = 0 and position('Guest' in :'att25') = 0,
  'E: no attendee is named in the answer');

-- ═══════════════════════════════════════════════════════════════════════════
-- F. Store sales
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert(((:'shop'::jsonb)->>'orders')::int = 3 and ((:'shop'::jsonb)->>'sales_cents')::bigint = 4500,
  'F: three orders, $45.00 (the cart and the cancelled order are left out)');
select pg_temp.assert((:'shop'::jsonb)->'by_month' = '[{"month":"2026-09","orders":2,"sales_cents":3500},{"month":"2026-10","orders":1,"sales_cents":1000}]'::jsonb,
  'F: by month (the order placed at 22:00 on September 30 in Chicago is a September order)');
select pg_temp.assert((:'shop'::jsonb)->'top_items' = '[{"item":"G128 Kaju katli","units":3,"sales_cents":3000},{"item":"G128 Chakli","units":6,"sales_cents":1500}]'::jsonb,
  'F: best sellers by sales');

-- ═══════════════════════════════════════════════════════════════════════════
-- G. One period's figures
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert((:'fig_sep'::jsonb)->'giving' = '{"payments":1,"received_cents":3000,"refunded_cents":1000,"net_cents":2000}'::jsonb
                      and ((:'fig_sep'::jsonb)->>'new_households')::int = 0 and ((:'fig_sep'::jsonb)->>'memberships_started')::int = 0
                      and ((:'fig_sep'::jsonb)->>'applications_received')::int = 1 and ((:'fig_sep'::jsonb)->>'check_ins')::int = 3
                      and (:'fig_sep'::jsonb)->'store' = '{"orders":2,"sales_cents":3500}'::jsonb,
  'G: September 2026');
select pg_temp.assert((:'fig_oct'::jsonb)->'giving' = '{"payments":1,"received_cents":7000,"refunded_cents":0,"net_cents":7000}'::jsonb
                      and ((:'fig_oct'::jsonb)->>'applications_received')::int = 0 and ((:'fig_oct'::jsonb)->>'check_ins')::int = 0
                      and (:'fig_oct'::jsonb)->'store' = '{"orders":1,"sales_cents":1000}'::jsonb,
  'G: October 1 to 10, 2026');

-- ═══════════════════════════════════════════════════════════════════════════
-- H. The same figures, added up row by row the way the old page did
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert((select sum(p.amount_cents - p.refunded_cents) from app.payments p
                        where p.center_id = :c and p.received_on between date '2026-01-01' and date '2026-12-31'
                          and p.status not in ('failed', 'voided', 'authorized'))
                      = ((:'pay_method'::jsonb)->'totals'->>'net_cents')::bigint,
  'H: net received equals the sum of amount less refunded over the counted payments');
select pg_temp.assert((select jsonb_object_agg(method::text, net) from (select p.method, sum(p.amount_cents - p.refunded_cents)::bigint as net from app.payments p
                        where p.center_id = :c and p.received_on between date '2026-01-01' and date '2026-12-31' and p.status not in ('failed', 'voided', 'authorized')
                        group by p.method) x)
                      = (select jsonb_object_agg(g->>'key', (g->>'net_cents')::bigint) from jsonb_array_elements((:'pay_method'::jsonb)->'groups') g),
  'H: net by method equals the row-by-row sums');
select pg_temp.assert((select sum(pl.amount_cents - pl.paid_cents) from app.pledges pl where pl.center_id = :c and pl.status in ('open', 'partially_paid'))
                      = ((:'plg26'::jsonb)->'open_now'->>'open_cents')::bigint,
  'H: open pledges equal the sum of amount less paid over the open and partly paid ones');
select pg_temp.assert((select count(*) from app.households h where h.center_id = :c and h.merged_into_id is null) = ((:'people'::jsonb)->>'households')::int
                      and (select count(*) from app.attendees a where a.center_id = :c and a.checked_in_at >= timestamptz '2026-01-01 06:00:00+00' and a.checked_in_at < timestamptz '2027-01-01 06:00:00+00')
                        = ((:'att26'::jsonb)->>'check_ins')::int,
  'H: households and check-ins equal the row counts');

-- ═══════════════════════════════════════════════════════════════════════════
-- I. Row-level security decides (security invoker)
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert(((:'v_pay'::jsonb)->'totals'->>'received_cents')::bigint = 0 and (:'v_pay'::jsonb)->'groups' = '[]'::jsonb,
  'I: a signed-in person with no role sees no payments, so the money figures are zero');
select pg_temp.assert(((:'v_plg'::jsonb)->'totals'->>'pledged_cents')::bigint = 0 and ((:'v_plg'::jsonb)->'open_now'->>'open_cents')::bigint = 0,
  'I: ... and no pledges');
select pg_temp.assert((:'v_matrix'::jsonb)->'cells' = '[]'::jsonb and ((:'v_att'::jsonb)->>'check_ins')::int = 0 and ((:'v_shop'::jsonb)->>'orders')::int = 0,
  'I: ... and no memberships, check-ins or store orders');
select pg_temp.assert(((:'z_people'::jsonb)->>'households')::int = 0 and ((:'z_pay'::jsonb)->'totals'->>'received_cents')::bigint = 0
                      and ((:'z_plg'::jsonb)->'totals'->>'pledged_cents')::bigint = 0 and (:'z_matrix'::jsonb)->'cells' = '[]'::jsonb
                      and ((:'z_att'::jsonb)->>'check_ins')::int = 0 and ((:'z_shop'::jsonb)->>'orders')::int = 0,
  'I: another community''s owner gets nothing from this community''s figures');
select pg_temp.assert(((:'z_own'::jsonb)->'open_now'->>'open_cents')::bigint = 99999 and ((:'z_own'::jsonb)->'open_now'->>'pledges')::int = 1,
  'I: ... and their own community''s numbers, which stay out of ours');

-- ═══════════════════════════════════════════════════════════════════════════
-- J. They read, never write; who may call them
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) = 9 and bool_and(p.provolatile in ('s', 'i') and not p.prosecdef)
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname like 'reports\_%'),
  'J: all nine are stable and security invoker');
select pg_temp.assert((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname like 'reports\_%' and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=app, public, extensions%')) = 9,
  'J: each pins the search path to app, public, extensions');
select pg_temp.assert(not has_function_privilege('anon', 'app.reports_payments_summary(uuid, date, date, text)', 'execute')
                      and not has_function_privilege('anon', 'app.reports_people_overview(uuid, integer, date)', 'execute')
                      and has_function_privilege('authenticated', 'app.reports_payments_summary(uuid, date, date, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.reports_period_figures(uuid, date, date)', 'execute'),
  'J: signed-out visitors cannot call them; signed-in people can (and see only what row-level security lets them)');
select pg_temp.assert_raises($$select app.reports_payments_summary('12800000-0000-4000-8000-0000000000c1', date '2026-01-01', date '2026-12-31', 'bogus')$$,
  'Group giving by', 'J: a grouping that does not exist is refused in plain words');
select pg_temp.assert((select count(*) from app.payments where center_id = :c) = 11 and (select count(*) from app.pledges where center_id = :c) = 6,
  'J: reading changed nothing: no payment or pledge was added');

rollback;
\echo 'PASS: reports reads tests'
