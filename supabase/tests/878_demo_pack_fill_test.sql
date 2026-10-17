-- 0878 + 0879 (owner request 2026-10-16: "the community member persona: fill up all spots that we can fill with test data"): the two demo communities
-- give their community member (Tarun Patni in the faith demo, Kwame Osei in the club) a full, lived-in member app.
--   A. The packs: faith version 6 (0878), club version 3 (0879); nothing real in what they say (links, phones)
--   B. The faith demo's family: its money history (one paid pledge, one part-paid, receipts), the open pledges untouched, the giving choices, a monthly gift
--      that is never charged, orders, the events (a meal, donation choices, tomorrow's gathering waiting for "Still coming?", an attended one), the calendar,
--      photo albums, surveys, the guide pages, an answered question, special days, the Learning Center (class days, attendance, reports, announcements,
--      a learning path, a place to teach), the library
--   C. What the community member really reads with row level security on: every one of those tables has rows for him
--   D. The club demo's family: the same in a neighborhood club's words, and the shop and the assistant switched on by the pack
--   E. A reset gives the same community again, row for row
-- Everything runs in one transaction that is rolled back, so no demo community is left behind for the tests that follow.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
end $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- Sign in as the demo person of a role in the community of t.center: their own token, the `authenticated` role, so row level security applies.
create or replace function pg_temp.as_role(p_role text) returns void language plpgsql as $$
declare v_user uuid;
begin
  reset role;
  select a.user_id into v_user from app.demo_personas d join app.demo_auth_users a on a.email = d.email
   where d.center_id = current_setting('t.center')::uuid and d.role_key = p_role;
  if v_user is null then raise exception 'FAIL: the demo person of role % has no sign-in', p_role; end if;
  perform pg_temp.claims(v_user::text, false);
  perform set_config('request.headers', '', true);
  set local role authenticated;
end $$;
-- The rows a community has in each table the community member's app reads, as one JSON object (for the before and after of a reset).
create or replace function pg_temp.counts(p_center uuid) returns jsonb language plpgsql as $$
declare t text; n bigint; v jsonb := '{}'::jsonb;
begin
  foreach t in array array['pledges', 'payments', 'payment_allocations', 'recurring_gifts', 'opportunities', 'store_orders', 'events', 'rsvps', 'lunch_slots',
                           'calendar_layers', 'calendar_entries', 'photo_albums', 'surveys', 'survey_responses', 'guide_sections', 'threads', 'thread_messages',
                           'role_roster', 'special_days', 'household_change_requests', 'person_profile_details', 'external_ids', 'eligibility_snapshots',
                           'pathshala_sessions', 'pathshala_attendance', 'pathshala_progress_reports', 'class_announcements', 'gyan_goals', 'gyan_progress',
                           'teacher_positions', 'content_items']
  loop
    execute format('select count(*) from app.%I where center_id = $1', t) into n using p_center;
    v := v || jsonb_build_object(t, n);
  end loop;
  return v;
end $$;
-- The tables the community member's app reads that have no row for the caller (empty text = every one has rows). Run as the member, so row level security applies.
create or replace function pg_temp.empty_for_member(p_center uuid, p_with_school boolean) returns text language plpgsql as $$
declare t text; n bigint; bad text := '';
begin
  foreach t in array array['pledges', 'payments', 'payment_allocations', 'recurring_gifts', 'opportunities', 'store_orders', 'events', 'rsvps', 'lunch_slots',
                           'calendar_layers', 'calendar_entries', 'photo_albums', 'surveys', 'guide_sections', 'threads', 'thread_messages',
                           'role_roster', 'special_days', 'household_change_requests', 'person_profile_details', 'external_ids', 'eligibility_snapshots', 'content_items']
        || case when p_with_school then array['pathshala_attendance', 'pathshala_progress_reports', 'class_announcements', 'gyan_goals', 'gyan_progress'] else '{}'::text[] end
  loop
    execute format('select count(*) from app.%I where center_id = $1', t) into n using p_center;
    if n = 0 then bad := bad || t || ' '; end if;
  end loop;
  return bad;
end $$;
-- What a family's pledges look like, as one text (for the before and after of a reset).
create or replace function pg_temp.pledge_signature(p_hh uuid) returns text language sql stable as $$
  select string_agg(p.status || ':' || p.amount_cents || ':' || p.paid_cents || ':' || p.source, ', ' order by p.pledged_at, p.amount_cents, p.id) from app.pledges p where p.household_id = p_hh
$$;

\set admin '''87800000-0000-4000-8000-0000000000a1'''
select pg_temp.as_none();
insert into auth.users (id, email) values (:admin, 'admin878@platform.test');
insert into app.accounts (user_id, is_platform_admin) values (:admin, true) on conflict (user_id) do update set is_platform_admin = true;

-- ══ A. The packs ═════════════════════════════════════════════════════════════
select pg_temp.assert((select version = 6 and not active from app.demo_packs where key = 'demo_faith_jain_v1')
                      and (select version = 3 and not active from app.demo_packs where key = 'demo_neutral_club_v1'),
  'A · the faith pack is at version 6 (0878) and the club pack at version 3 (0879), neither offered on Setup > Demo');
-- Nothing real: a link is a placeholder address (example.com or example.org), a phone is a 555-01xx number.
select pg_temp.assert(not exists (select 1 from app.demo_packs p, jsonb_path_query(p.content, 'strict $.**') s
                                   where p.key in ('demo_faith_jain_v1', 'demo_neutral_club_v1') and jsonb_typeof(s) = 'string'
                                     and (s #>> '{}') ~* 'https?://' and (s #>> '{}') !~* 'https?://([a-z0-9-]+\.)*example\.(com|org)(/|$|[^a-z0-9.-])'),
  'A · every link in the packs is a placeholder address on example.com or example.org: no real site, no stream, no video');
select pg_temp.assert(not exists (select 1 from app.demo_packs p, jsonb_path_query(p.content, 'strict $.**') s
                                   where p.key in ('demo_faith_jain_v1', 'demo_neutral_club_v1') and jsonb_typeof(s) = 'string'
                                     and (s #>> '{}') ~ '^\+1[0-9]{10}$' and (s #>> '{}') !~ '^\+1[0-9]{3}5550[0-9]{3}$'),
  'A · every phone number in the packs is a 555-01xx number');
select pg_temp.assert((select count(*) >= 2 from app.demo_packs p, jsonb_path_query(p.content, 'strict $.**') s
                        where p.key = 'demo_faith_jain_v1' and jsonb_typeof(s) = 'string' and (s #>> '{}') ~ '^\+1312555019[0-9]$')
                      and (select count(*) >= 1 from app.demo_packs p, jsonb_path_query(p.content, 'strict $.**') s
                            where p.key = 'demo_faith_jain_v1' and jsonb_typeof(s) = 'string' and (s #>> '{}') ~ '^https://photos\.example\.com/'),
  'A · and the two checks above do find the new links and phone numbers (they are not asleep)');

-- ══ B. The faith demo's community member: Tarun Patni ═══════════════════════════
select pg_temp.claims(:admin, true);
select (app.create_demo_community('faith'))->>'center_id' as fc \gset
select (app.create_demo_community('neutral'))->>'center_id' as nc \gset
-- The demo people get their sign-ins (the way 0678 and 0679 do), so the member can be asked the app's questions with row level security on.
select app.demo_signin_setup('Set up the demo sign-ins for the fill test') as setup \gset
select app.set_demo_signin(true, 'Switch the demo on for the fill test') as sw \gset
select pg_temp.as_none();
select h.id as hh from app.households h where h.center_id = :'fc' and h.display_name = 'Patni family' \gset
select pg_temp.assert((select state.version = 6 and state.status = 'loaded' from app.center_demo_state state where state.center_id = :'fc'),
  'B · the faith demo loaded version 6');

-- Money: one paid pledge, one partly paid, three payments of three kinds, each with a receipt.
select pg_temp.assert((select status = 'paid' and paid_cents = 10000 and amount_cents = 10000 from app.pledges where id = app.demo_id(:'fc', 'pledge:p1'))
                      and (select status = 'partially_paid' and paid_cents = 30000 and amount_cents = 50000 and opportunity_option = 'row' and opportunity_id is not null
                             from app.pledges where id = app.demo_id(:'fc', 'pledge:p2'))
                      and (select count(*) = 3 and count(distinct method) = 3 and bool_and(receipt_number is not null) and bool_and(status = 'settled') and sum(amount_cents) = 40000
                             from app.payments where household_id = :'hh')
                      and (select method = 'card' and provider = 'stripe' and provider_ref like 'pi\_test\_%' from app.payments where id = app.demo_id(:'fc', 'pay:p2b'))
                      and (select bool_and(is_historical) from app.payments where household_id = :'hh'),
  'B · the family has one paid and one part-paid pledge ($100.00 and $300.00 of $500.00) and three payments by check, Zelle and card, each with a receipt number; the card one is a test-mode payment');
-- Their open pledges are what they were: the $51.00 pledge has nothing against it, the three fee pledges are open.
select pg_temp.assert((select count(*) = 1 and bool_and(status = 'open' and paid_cents = 0) from app.pledges where household_id = :'hh' and amount_cents = 5100 and source = 'general')
                      and not exists (select 1 from app.payment_allocations a join app.pledges p on p.id = a.pledge_id where p.household_id = :'hh' and p.amount_cents = 5100)
                      and (select count(*) = 3 and sum(amount_cents) = 40000 and bool_and(status = 'open') from app.pledges where household_id = :'hh' and source = 'pathshala_fee'),
  'B · the $51.00 general pledge is still open with no payment against it, and so are the three Learning Center fee pledges ($400.00)');
-- The waiting payment confirmation (0877) hangs on the family''s oldest open pledge, never on the new part-paid one.
select pg_temp.assert((select count(*) = 1 from app.payment_proofs where household_id = :'hh')
                      and (select pl.id <> app.demo_id(:'fc', 'pledge:p2')
                                  and pl.pledged_at = (select min(x.pledged_at) from app.pledges x where x.household_id = :'hh' and x.status in ('open', 'partially_paid'))
                             from app.soft_credits sc join app.pledges pl on pl.id = sc.pledge_id where sc.center_id = :'fc'),
  'B · the payment confirmation waiting for the treasury team still hangs on the family''s oldest open pledge, not on the new part-paid one');
select pg_temp.assert((select count(*) = 1 and bool_and(status = 'pending_payment_method' and amount_cents = 2500 and frequency = 'monthly' and method = 'card')
                         from app.recurring_gifts where household_id = :'hh')
                      and not exists (select 1 from app.recurring_gifts where center_id = :'fc' and status = 'active'),
  'B · a monthly gift of $25.00 waits for a card, and no gift of the community is active: nothing is ever charged');
select pg_temp.assert((select count(*) = 5 and bool_and(status = 'open') from app.opportunities where center_id = :'fc')
                      and (select jsonb_array_length(options) = 3 and kind = 'tier' and quantity_taken = 1 from app.opportunities where id = app.demo_id(:'fc', 'opp:bricks'))
                      and (select bool_and(campaign_id in (select id from app.campaigns where center_id = :'fc' and status = 'published')) from app.opportunities where center_id = :'fc'),
  'B · five things to give to, all open under published campaigns; the tier has three choices and the family''s pledge took one');

-- The store: two orders, and the low-stock list is the one it was.
select pg_temp.assert((select count(*) = 2 and count(*) filter (where status = 'picked_up') = 1 and count(*) filter (where status = 'placed') = 1 from app.store_orders where household_id = :'hh')
                      and (select count(*) = 2 from app.store_items where center_id = :'fc' and status = 'active' and track_inventory and stock_on_hand <= low_stock_threshold),
  'B · the family has one order picked up and one waiting for the next pickup, and the same 2 items are under their reorder level');

-- Events: a meal and donation choices on the dinner, tomorrow''s gathering waiting for "Still coming?", an attended one.
select pg_temp.assert((select lunch_enabled and commitment_options -> 'per_person' = '[1500, 2500, 3500]'::jsonb and (select count(*) = 6 from app.lunch_slots l where l.event_id = e.id)
                         from app.events e where e.id = app.demo_id(:'fc', 'ev:dinner'))
                      and (select count(*) = 24 from app.attendees where event_id = app.demo_id(:'fc', 'ev:dinner') and status in ('rsvpd', 'confirmed', 'attended')),
  'B · the dinner has its meal in six lunch times and donation choices on the RSVP, and the same 24 people coming');
select pg_temp.assert((select e.status = 'published' and e.confirmation_hours_before = 36 and e.starts_at > now() and e.starts_at < now() + interval '36 hours' and e.lunch_enabled
                              and (select count(*) = 4 from app.lunch_slots l where l.event_id = e.id)
                         from app.events e where e.id = app.demo_id(:'fc', 'ev:weekly2'))
                      and (select status = 'rsvpd' from app.rsvps where event_id = app.demo_id(:'fc', 'ev:weekly2') and household_id = :'hh')
                      and (select r.status = 'confirmed' and (select count(*) = 5 and bool_and(a.status = 'attended') from app.attendees a where a.rsvp_id = r.id)
                             from app.rsvps r where r.event_id = app.demo_id(:'fc', 'ev:weekly') and r.household_id = :'hh'),
  'B · tomorrow''s gathering is less than 36 hours away with a lunch, the family''s RSVP waits for "Still coming?", and all five of them attended the last one');

-- The calendar, the photo albums and the surveys.
select pg_temp.assert((select count(*) = 2 and count(*) filter (where kind = 'events') = 1 and count(*) filter (where kind = 'pathshala') = 1 from app.calendar_layers where center_id = :'fc')
                      and (select count(*) = 8 and count(*) filter (where event_id is not null) = 4 from app.calendar_entries where center_id = :'fc')
                      and (select count(*) = 2 and bool_and(external_url like 'https://photos.example.com/%') and bool_and(visibility = 'members') from app.photo_albums where center_id = :'fc'),
  'B · the calendar has an events layer and a Learning Center layer (4 entries for the events, 4 for the class days), and two photo albums link to a placeholder address');
select pg_temp.assert((select count(*) = 1 and bool_and(status = 'open' and event_id = app.demo_id(:'fc', 'ev:weekly') and closes_at > now()) from app.surveys where center_id = :'fc' and kind = 'event_feedback')
                      and (select count(*) = 1 and bool_and(status = 'open' and event_id is null and closes_at > now()) from app.surveys where center_id = :'fc' and kind = 'poll')
                      and (select count(*) = 7 from app.survey_responses where center_id = :'fc')
                      and not exists (select 1 from app.survey_responses r join app.people p on p.id = r.person_id where r.center_id = :'fc' and p.last_name = 'Patni'),
  'B · the last gathering has an open feedback form and there is an open poll, with 7 answers from others and none from the Patni family yet');

-- The guide: the pages the Life tiles open, the times as a table, an answered question, the committees.
select pg_temp.assert((select count(*) = 3 from app.guide_sections where center_id = :'fc' and slug in ('timings', 'links', 'membership'))
                      and (select count(*) >= 5 from app.guide_sections g, regexp_split_to_table(g.body_md, E'\n') l
                            where g.center_id = :'fc' and g.slug = 'timings' and l ~ '^\|[^|]+\|[^|]+\|$' and l !~ '^\|\s*-' and l !~ '^\|\s*What')
                      and (select count(*) = 1 from app.guide_sections g where g.center_id = :'fc' and g.slug = 'timings' and g.public and g.body_md like '| What | When |%'),
  'B · the guide has Times and visiting (a | What | When | table with at least five rows, public), Links and Membership');
select pg_temp.assert((select count(*) = 1 from app.threads t where t.center_id = :'fc' and t.status = 'closed' and t.first_response_at is not null
                                and t.from_person_id = (select p.id from app.people p where p.center_id = :'fc' and p.first_name = 'Tarun' and p.last_name = 'Patni')
                                and (select count(*) = 2 and count(*) filter (where m.from_role) = 1 from app.thread_messages m where m.thread_id = t.id))
                      and (select count(*) = 5 from app.threads where center_id = :'fc' and status = 'open' and assignee_user is null),
  'B · the family has a question the front office answered and closed (the answer under the question), and the 5 questions nobody has taken are still 5');
select pg_temp.assert((select count(*) = 7 and count(distinct body) = 2 from app.role_roster where center_id = :'fc')
                      and (select count(*) = 4 from app.special_days where household_id = :'hh')
                      and (select count(*) = 1 and bool_and(status = 'open' and kind = 'add_member') from app.household_change_requests where household_id = :'hh')
                      and (select count(*) = 2 and bool_and(emergency_contact_phone ~ '^\+1312555019[0-9]$') from app.person_profile_details where center_id = :'fc')
                      and (select count(*) = 6 and count(*) filter (where kind = 'org_household') = 1 from app.external_ids where household_id = :'hh' or person_id in (select person_id from app.household_members where household_id = :'hh'))
                      and (select count(*) = 2 and not bool_or(can_vote) from app.eligibility_snapshots where center_id = :'fc'),
  'B · two committee lists, four special days, a request to add a grandparent, profile details with an emergency contact, six member numbers and the two adults'' voting answers (not yet)');

-- The Learning Center: class days, attendance, reports, announcements, a learning path, a place to teach.
select pg_temp.assert((select count(*) = 4 and max(held_on) <= app.demo_today(:'fc') - 14 from app.pathshala_sessions where class_id = app.demo_id(:'fc', 'class:l2'))
                      and (select count(*) = 20 from app.pathshala_attendance where center_id = :'fc')
                      and (select count(*) = 2 and bool_and(published_at is not null) from app.pathshala_progress_reports where center_id = :'fc')
                      and not exists (select 1 from app.pathshala_progress_reports r
                                       where r.attendance_total <> (select count(*) from app.pathshala_attendance a where a.enrollment_id = r.enrollment_id)
                                          or r.attendance_present <> (select count(*) from app.pathshala_attendance a where a.enrollment_id = r.enrollment_id and a.status in ('present', 'late'))
                                          or r.attendance_late <> (select count(*) from app.pathshala_attendance a where a.enrollment_id = r.enrollment_id and a.status = 'late'))
                      and (select count(*) = 3 and bool_and(published_at is not null and class_id = app.demo_id(:'fc', 'class:l2')) from app.class_announcements where center_id = :'fc')
                      and (select count(*) = 1 and bool_and(status = 'open') from app.teacher_positions where center_id = :'fc'),
  'B · four class days (the latest week is left for the teacher to take), 20 attendance marks, two published progress reports that add up to the marks, three class announcements and an open place to teach');
select pg_temp.assert((select count(*) = 1 and bool_and(tradition is null and recommended) from app.gyan_goals where center_id = :'fc')
                      and (select count(*) = 2 from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id = :'fc')
                      and (select count(*) = 6 and count(*) filter (where kind = 'quiz') = 2 and count(*) filter (where kind = 'read') = 2 and count(*) filter (where kind = 'practice') = 2
                            from app.gyan_steps s join app.gyan_levels l on l.id = s.level_id join app.gyan_goals g on g.id = l.goal_id where g.center_id = :'fc')
                      and (select count(*) = 7 and not bool_or(p.last_name <> 'Patni') from app.gyan_progress gp join app.people p on p.id = gp.person_id where gp.center_id = :'fc'),
  'B · a learning path of the community''s own (no tradition): one goal, two levels of three steps, and the Patni children''s progress on it');
select pg_temp.assert((select count(*) = 2 and bool_and(status = 'published') from app.content_items where center_id = :'fc' and kind in ('faq', 'explainer') and slug in ('how-to-join-demo', 'weekly-gathering-demo'))
                      and (select count(*) = 4 and bool_and(status = 'approved' and approved_by is not null) from app.content_items where center_id = :'fc' and kind = 'niva_source')
                      and (select count(*) = 3 from app.content_items where center_id = :'fc' and status in ('draft', 'in_review')),
  'B · the library has two published texts and four approved ones for the assistant to answer from, next to the three waiting for the staff');

-- ══ C. What the community member reads, with row level security on ════════════
select set_config('t.center', :'fc', false);
select pg_temp.as_role('primary_adult');
select pg_temp.assert(pg_temp.empty_for_member(:'fc', true) = '', 'C · Tarun reads rows in every table above (empty: ' || pg_temp.empty_for_member(:'fc', true) || ')');
select pg_temp.assert((select count(*) = 6 from app.pledges where center_id = :'fc') and (select count(*) = 3 from app.payments where center_id = :'fc')
                      and (select count(*) = 1 from app.recurring_gifts where center_id = :'fc') and (select count(*) = 2 from app.store_orders where center_id = :'fc')
                      and (select count(*) = 2 from app.threads where center_id = :'fc') and (select count(*) = 4 from app.special_days where center_id = :'fc')
                      and (select count(*) = 3 from app.class_announcements where center_id = :'fc')
                      and (select count(*) = 2 from app.pathshala_progress_reports where center_id = :'fc') and (select count(*) = 8 from app.pathshala_attendance where center_id = :'fc'),
  'C · and they are his family''s: 6 pledges, 3 payments, 1 monthly gift, 2 orders, 2 conversations, 4 special days, 3 announcements, 2 reports and 8 attendance marks of his own children');
select pg_temp.as_none();

-- ══ D. The club demo''s community member: Kwame Osei ══════════════════════════════
select h.id as hhc from app.households h where h.center_id = :'nc' and h.display_name = 'Osei family' \gset
select pg_temp.assert((select state.version = 3 and state.status = 'loaded' from app.center_demo_state state where state.center_id = :'nc')
                      and app.module_enabled(:'nc', 'store') and app.module_enabled(:'nc', 'niva')
                      and (select count(*) = 2 from app.center_module_grants g where g.center_id = :'nc' and g.module_key in ('store', 'niva') and g.granted and g.granted_by is null and g.reason like 'Demo community:%')
                      and not app.module_enabled(:'nc', 'pathshala') and not app.module_enabled(:'nc', 'gyan_path'),
  'D · the club loaded version 3 with its shop and its assistant on (the pack''s grant) and no school');
select pg_temp.assert((select status = 'paid' and paid_cents = 15000 from app.pledges where id = app.demo_id(:'nc', 'pledge:oa1'))
                      and (select status = 'partially_paid' and paid_cents = 15000 and amount_cents = 30000 and opportunity_id = app.demo_id(:'nc', 'opp:bed') from app.pledges where id = app.demo_id(:'nc', 'pledge:ob1'))
                      and (select count(*) = 3 and count(distinct method) = 3 and bool_and(receipt_number is not null) and sum(amount_cents) = 30000 from app.payments where household_id = :'hhc')
                      and (select provider = 'stripe' and provider_ref like 'pi\_test\_%' from app.payments where id = app.demo_id(:'nc', 'pay:oa1'))
                      and (select status = 'open' and paid_cents = 0 and amount_cents = 12500 from app.pledges where id = app.demo_id(:'nc', 'pledge:g3'))
                      and not exists (select 1 from app.payment_allocations where pledge_id = app.demo_id(:'nc', 'pledge:g3'))
                      and (select pl.id = app.demo_id(:'nc', 'pledge:g3') from app.soft_credits sc join app.pledges pl on pl.id = sc.pledge_id where sc.center_id = :'nc'),
  'D · the Osei family has one paid and one part-paid pledge ($150.00 and $150.00 of $300.00), three payments by card, Zelle and check with receipts, and its $125.00 garden pledge is still open with nothing against it (the waiting confirmation hangs on it)');
select pg_temp.assert((select count(*) = 1 and bool_and(status = 'pending_payment_method' and amount_cents = 2000) from app.recurring_gifts where household_id = :'hhc')
                      and not exists (select 1 from app.recurring_gifts where center_id = :'nc' and status = 'active')
                      and (select count(*) = 5 and bool_and(status = 'open') from app.opportunities where center_id = :'nc')
                      and (select count(*) = 2 and count(*) filter (where status = 'picked_up') = 1 and count(*) filter (where status = 'placed') = 1 from app.store_orders where household_id = :'hhc')
                      and (select count(*) = 3 from app.store_orders where center_id = :'nc' and status in ('placed', 'preparing', 'ready'))
                      and (select count(*) = 2 from app.store_items where center_id = :'nc' and status = 'active' and track_inventory and stock_on_hand <= low_stock_threshold),
  'D · a monthly gift of $20.00 that is never charged, five things to give to, two orders of the family (3 orders now wait for the store team) and the same 2 low-stock items');
select pg_temp.assert((select e.lunch_enabled and commitment_options -> 'lump_sum' = '[2500, 5000]'::jsonb and (select count(*) = 4 from app.lunch_slots l where l.event_id = e.id)
                         from app.events e where e.id = app.demo_id(:'nc', 'ev:cleanup'))
                      and (select e.status = 'published' and e.confirmation_hours_before = 36 and e.starts_at > now() and e.starts_at < now() + interval '36 hours'
                         from app.events e where e.id = app.demo_id(:'nc', 'ev:gardenam'))
                      and (select status = 'rsvpd' from app.rsvps where event_id = app.demo_id(:'nc', 'ev:gardenam') and household_id = :'hhc')
                      and (select r.status = 'confirmed' and (select count(*) = 3 and bool_and(a.status = 'attended') from app.attendees a where a.rsvp_id = r.id)
                             from app.rsvps r where r.event_id = app.demo_id(:'nc', 'ev:potluck') and r.household_id = :'hhc')
                      and (select count(*) = 19 from app.attendees where event_id = app.demo_id(:'nc', 'ev:cleanup') and status in ('rsvpd', 'confirmed', 'attended')),
  'D · the clean-up day has lunch in four times and a contribution to choose, tomorrow''s garden morning waits for "Still coming?", the family attended the last potluck, and the clean-up day has the people it had');
select pg_temp.assert((select count(*) = 2 and count(*) filter (where kind = 'events') = 1 from app.calendar_layers where center_id = :'nc')
                      and (select count(*) = 7 and count(*) filter (where event_id is not null) = 4 from app.calendar_entries where center_id = :'nc')
                      and (select count(*) = 2 and bool_and(external_url like 'https://photos.example.com/%') from app.photo_albums where center_id = :'nc')
                      and (select count(*) = 1 and bool_and(status = 'open' and event_id = app.demo_id(:'nc', 'ev:potluck')) from app.surveys where center_id = :'nc' and kind = 'event_feedback')
                      and (select count(*) = 1 and bool_and(status = 'open') from app.surveys where center_id = :'nc' and kind = 'poll')
                      and (select count(*) = 3 from app.guide_sections where center_id = :'nc' and slug in ('timings', 'links', 'membership'))
                      and (select count(*) >= 5 from app.guide_sections g, regexp_split_to_table(g.body_md, E'\n') l
                            where g.center_id = :'nc' and g.slug = 'timings' and l ~ '^\|[^|]+\|[^|]+\|$' and l !~ '^\|\s*-' and l !~ '^\|\s*What'),
  'D · the club has its calendar, two photo albums, a feedback form and a poll, and the three guide pages (the times as a table)');
select pg_temp.assert((select count(*) = 1 from app.threads t where t.center_id = :'nc' and t.status = 'closed' and (select count(*) = 2 from app.thread_messages m where m.thread_id = t.id))
                      and (select count(*) = 7 and count(distinct body) = 2 from app.role_roster where center_id = :'nc')
                      and (select count(*) = 3 from app.special_days where household_id = :'hhc')
                      and (select count(*) = 2 from app.person_profile_details where center_id = :'nc')
                      and (select count(*) = 4 from app.external_ids where center_id = :'nc' and (household_id = :'hhc' or person_id in (select person_id from app.household_members where household_id = :'hhc')))
                      and (select count(*) = 2 and bool_and(can_vote) from app.eligibility_snapshots where center_id = :'nc')
                      and (select count(*) = 2 and bool_and(status = 'published') from app.content_items where center_id = :'nc' and slug in ('how-to-join-the-club-demo', 'clean-up-day-demo'))
                      and (select count(*) = 4 and bool_and(status = 'approved') from app.content_items where center_id = :'nc' and kind = 'niva_source')
                      and (select count(*) = 1 from app.household_change_requests where household_id = :'hhc' and status = 'open'),
  'D · an answered question, two committee lists, three special days, profile details, four member numbers, both adults may vote, the library texts and the family''s open request are there');
select pg_temp.assert((select count(*) = 0 from app.gyan_goals where center_id = :'nc') and (select count(*) = 0 from app.pathshala_sessions where center_id = :'nc')
                      and (select count(*) = 0 from app.class_announcements where center_id = :'nc') and (select count(*) = 0 from app.teacher_positions where center_id = :'nc'),
  'D · the club has no school, so it has no class days, announcements or learning path');
select set_config('t.center', :'nc', false);
select pg_temp.as_role('primary_adult');
select pg_temp.assert(pg_temp.empty_for_member(:'nc', false) = '', 'D · Kwame reads rows in every table (empty: ' || pg_temp.empty_for_member(:'nc', false) || ')');
select pg_temp.as_none();
select pg_temp.as_role('store_lead');
select pg_temp.assert((select count(*) >= 3 from app.store_orders where center_id = :'nc' and status in ('placed', 'preparing', 'ready')),
  'D · and the club''s store lead sees the orders waiting (the shop is on from the first load)');
select pg_temp.as_none();

-- ══ E. A reset gives the same community again ═════════════════════════════════
select pg_temp.counts(:'fc') as fc_before, pg_temp.counts(:'nc') as nc_before, pg_temp.pledge_signature(:'hh') as sig_f, pg_temp.pledge_signature(:'hhc') as sig_c \gset
select pg_temp.claims(:admin, true);
select app.reset_demo_community(:'fc') as rf \gset
select app.reset_demo_community(:'nc') as rn \gset
select pg_temp.as_none();
select pg_temp.assert(pg_temp.counts(:'fc') = :'fc_before'::jsonb and pg_temp.counts(:'nc') = :'nc_before'::jsonb,
  'E · a reset gives the same rows in every table, for both communities');
select pg_temp.assert(pg_temp.pledge_signature(:'hh') = :'sig_f' and pg_temp.pledge_signature(:'hhc') = :'sig_c'
                      and app.module_enabled(:'nc', 'store') and app.module_enabled(:'nc', 'niva'),
  'E · and both families'' pledges are in the same state, and the club still has its shop');
rollback;
\echo 'PASS: the community member of each demo finds a full app'
