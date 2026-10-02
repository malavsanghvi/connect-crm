-- 0574: Niva's live schedule. Only the background service can read it; it holds the community's local date and
-- time (in its own time zone), contact details, regular and daily timings (today + 7 days) and the upcoming events
-- every member can see (not confidential, not draft, cancelled or completed, not for life members or Pathshala
-- families only, within the window); no RSVP, giving or people data ever appears in it; the module switches hide
-- events and timings; a question asked on an earlier day also gets that day's week; and a regenerate keeps an answer
-- while a live item it cited is still current, judged by the same tests the facts use.
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
create or replace function pg_temp.sign_in(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant connect_worker to postgres;

-- The facts, read as the background service.
create or replace function pg_temp.facts(p_center uuid, p_days int default null, p_from date default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  if p_days is null and p_from is null then r := app.niva_worker_center_facts(p_center);
  else r := app.niva_worker_center_facts(p_center, coalesce(p_days, 14), p_from); end if;
  reset role;
  return r;
end $$;
-- The dates of the daily timings in the facts, in order.
create or replace function pg_temp.timing_dates(r jsonb) returns text[] language sql as $$
  select coalesce(array_agg(d->>'on_date' order by n), '{}') from jsonb_array_elements(r->'daily_timings') with ordinality as x(d, n)
$$;
-- The event ids in the facts, in order.
create or replace function pg_temp.event_ids(r jsonb) returns text[] language sql as $$
  select coalesce(array_agg(e->>'id' order by n), '{}') from jsonb_array_elements(r->'events') with ordinality as x(e, n)
$$;
create or replace function pg_temp.event(r jsonb, p_id text) returns jsonb language sql as $$
  select e from jsonb_array_elements(r->'events') e where e->>'id' = p_id
$$;
-- Every key anywhere in a jsonb value (objects inside arrays included).
create or replace function pg_temp.all_keys(j jsonb) returns text[] language sql as $$
  with recursive walk(v) as (
    select j
    union all
    select x.v from walk w
     cross join lateral (select value as v from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end)
                         union all
                         select value from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end)) x
  )
  select coalesce(array_agg(distinct k order by k), '{}')
    from walk w cross join lateral jsonb_object_keys(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) k
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
\set c '''61000000-0000-4000-8000-0000000000c1'''
\set c2 '''61000000-0000-4000-8000-0000000000c2'''
\set c3 '''61000000-0000-4000-8000-0000000000c3'''
\set c4 '''61000000-0000-4000-8000-0000000000c4'''
\set c5 '''61000000-0000-4000-8000-0000000000c5'''
\set c6 '''61000000-0000-4000-8000-0000000000c6'''
\set member '''61000000-0000-4000-8000-000000000002'''
\set admin '''61000000-0000-4000-8000-000000000001'''
insert into auth.users (id, email) values (:admin, 'admin61@example.com'), (:member, 'member61@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, branding, rules) values
  (:c, 'orbit61', 'Sixty-One Sangh', 'SOS', 'TX', 'active', 'America/Chicago',
   '{"place_name":"Sixty-One Derasar","address":"3905 Arc St, Houston, TX 77063","address_note":"","phone":"+1 (713) 555-0161",
     "website":"https://example.org/sixty-one","logo_path":"61/logo-SECRET-LOGO.png","colors":{"primary":"#123456"},
     "links":[{"label":"YouTube","url":"https://youtube.example/61"}]}',
   '{"version":3,"timings":{"derasar_hours":"7:30 AM – 6:00 PM daily","aarti":"12:30 PM and 4:30 PM","snatra_puja":""},"lunch":{"slot_minutes":15}}'),
  (:c2, 'orbit61b', 'Kiritimati Sangh', 'KS', 'TX', 'active', 'Pacific/Kiritimati', '{}', '{}'),
  (:c3, 'orbit61c', 'Pago Pago Sangh', 'PPS', 'TX', 'active', 'Pacific/Pago_Pago', '{"address":"   ","website":"javascript:alert(61)"}', '{"timings":"not an object"}'),
  (:c4, 'orbit61d', 'Modules Off Sangh', 'MOS', 'TX', 'active', 'America/Chicago', '{}', '{}'),
  (:c5, 'orbit61e', 'Note Only Sangh', 'NOS', 'TX', 'active', 'America/Chicago', '{"address_note":"Use the side gate on Arc St"}', '{}'),
  (:c6, 'orbit61f', 'Website Only Sangh', 'WOS', 'TX', 'active', 'America/Chicago', '{"website":"https://example.org/sixty-one-f"}', '{}');
insert into app.role_grants (center_id, user_id, role_key) values (:c, :admin, 'center_admin');
insert into app.people (id, center_id, first_name, last_name) values
  ('61000000-0000-4000-8000-0000000000a1', :c, 'Zubin', 'Hiddenname61');
insert into app.center_users (center_id, user_id, person_id) values (:c, :member, '61000000-0000-4000-8000-0000000000a1');
insert into app.households (id, center_id, display_name) values ('61000000-0000-4000-8000-0000000000b1', :c, 'Hiddenname61 family');

-- Today in Houston, and the start of that day.
select (now() at time zone 'America/Chicago')::date as today,
       ((now() at time zone 'America/Chicago')::date)::timestamp at time zone 'America/Chicago' as day_start \gset

-- Daily timings from yesterday to nine days ahead (only today .. today + 7 come back).
insert into app.daily_timings (center_id, on_date, sunrise, sunset, navkarsi, chauvihar, aarti, temple_open, temple_close)
select :c, :'today'::date + g, '07:14', '19:08', '08:02', '19:08', case when g = 0 then '12:30'::time end, '07:30', '18:00'
  from generate_series(-1, 9) g;
insert into app.daily_timings (center_id, on_date, sunrise, sunset) values (:c4, :'today'::date, '07:14', '19:08');

insert into app.events (id, center_id, name, description, venue, starts_at, ends_at, status, audience, confidential,
                        rsvp_opens_at, rsvp_closes_at, member_price_cents, guest_price_cents, eligibility, owner_person_id) values
  -- shown
  ('61000000-0000-4000-8000-000000000e01', :c, 'Tapasvi Bahuman', 'SECRET-DESC-61: the committee''s private notes', 'Main hall',
   now() + interval '2 days', now() + interval '2 days 3 hours', 'published', 'members_only', false,
   null, now() + interval '1 day', 424242, 515151, '{"rule":"ELIG-61"}', '61000000-0000-4000-8000-0000000000a1'),
  ('61000000-0000-4000-8000-000000000e02', :c, 'Mahavir Jayanti', null, '  ', now() + interval '5 days', null, 'published', 'public', false,
   now() + interval '1 day', null, null, null, '{}', null),
  ('61000000-0000-4000-8000-000000000e03', :c, 'Pathshala annual day', null, 'Hall B', now() + interval '3 days', now() + interval '4 days',
   'rsvp_closed', 'members_and_guests', false, null, null, null, null, '{}', null),
  -- (never before today's start, so it always sorts after 'Earlier today')
  ('61000000-0000-4000-8000-000000000e04', :c, 'Snatra puja (live)', null, 'Derasar',
   greatest(:'day_start'::timestamptz + interval '2 minutes', now() - interval '1 hour'), now() + interval '2 hours',
   'live', 'members_and_guests', false, null, now() - interval '2 days', null, null, '{}', null),
  ('61000000-0000-4000-8000-000000000e05', :c, 'Earlier today', null, null, greatest(:'day_start'::timestamptz, now() - interval '7 hours'),
   greatest(:'day_start'::timestamptz, now() - interval '7 hours') + interval '1 minute', 'published', 'members_only', false, null, null, null, null, '{}', null),
  -- not shown
  ('61000000-0000-4000-8000-000000000e10', :c, 'Draft event', null, null, now() + interval '2 days', null, 'draft', 'members_only', false, null, null, null, null, '{}', null),
  ('61000000-0000-4000-8000-000000000e11', :c, 'Cancelled event', null, null, now() + interval '2 days', null, 'cancelled', 'members_only', false, null, null, null, null, '{}', null),
  ('61000000-0000-4000-8000-000000000e12', :c, 'Completed event', null, null, now() + interval '1 hour', null, 'completed', 'members_only', false, null, null, null, null, '{}', null),
  ('61000000-0000-4000-8000-000000000e13', :c, 'Board retreat', null, null, now() + interval '2 days', null, 'published', 'members_only', true, null, null, null, null, '{}', null),
  ('61000000-0000-4000-8000-000000000e14', :c, 'Life members dinner', null, null, now() + interval '2 days', null, 'published', 'life_members_only', false, null, null, null, null, '{}', null),
  ('61000000-0000-4000-8000-000000000e15', :c, 'Pathshala parents meeting', null, null, now() + interval '2 days', null, 'published', 'pathshala_families', false, null, null, null, null, '{}', null),
  ('61000000-0000-4000-8000-000000000e16', :c, 'Diwali', null, null, now() + interval '20 days', null, 'published', 'members_only', false, null, null, null, null, '{}', null),
  ('61000000-0000-4000-8000-000000000e17', :c, 'Yesterday''s puja', null, null, now() - interval '2 days', now() - interval '1 day', 'published', 'members_only', false, null, null, null, null, '{}', null),
  ('61000000-0000-4000-8000-000000000e18', :c2, 'Another community''s event', null, null, now() + interval '2 days', null, 'published', 'public', false, null, null, null, null, '{}', null),
  ('61000000-0000-4000-8000-000000000e19', :c4, 'Event while Events is off', null, null, now() + interval '2 days', null, 'published', 'public', false, null, null, null, null, '{}', null),
  -- yesterday, 10 to 11 AM in Houston: only when the member asked on an earlier day
  ('61000000-0000-4000-8000-000000000e20', :c, 'Puja the day before', null, 'Derasar',
   ((:'today'::date - 1)::timestamp + time '10:00') at time zone 'America/Chicago',
   ((:'today'::date - 1)::timestamp + time '11:00') at time zone 'America/Chicago', 'published', 'members_only', false, null, null, null, null, '{}', null);
-- Thirty more events at another community: at most 25 come back.
insert into app.events (center_id, name, starts_at, status, audience)
select :c2, 'Daily puja ' || g, now() + make_interval(hours => g), 'published', 'members_and_guests' from generate_series(1, 30) g;
-- An RSVP with a guest's name: never read.
insert into app.rsvps (center_id, event_id, household_id, guest_name, status)
values (:c, '61000000-0000-4000-8000-000000000e01', '61000000-0000-4000-8000-0000000000b1', 'RSVP-GUEST-61', 'rsvpd');
-- Events and My Jain Way off at :c4.
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c4, 'events', false, 'test 61'), (:c4, 'jain_way', false, 'test 61');

-- ── Only the background service ─────────────────────────────────────────────
select pg_temp.assert(has_function_privilege('connect_worker', 'app.niva_worker_center_facts(uuid,int,date)', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_worker_center_facts(uuid,int,date)', 'execute')
                      and not has_function_privilege('anon', 'app.niva_worker_center_facts(uuid,int,date)', 'execute')
                      and not has_function_privilege('service_role', 'app.niva_worker_center_facts(uuid,int,date)', 'execute'),
  'the live schedule is granted to connect_worker only');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_worker_center_facts($$ || quote_literal(:c) || $$::uuid)$$, 'permission denied', 'a member cannot read it');
commit;
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.niva_worker_center_facts($$ || quote_literal(:c) || $$::uuid)$$, 'permission denied', 'nor a center admin');
commit;
select pg_temp.assert_raises($$select app.niva_worker_center_facts($$ || quote_literal(:c) || $$::uuid)$$, 'Only the background service',
  'any other role is turned away by assert_worker');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.niva_live_ref_current(uuid,text,text)', 'execute')
                      and not has_function_privilege('connect_worker', 'app.niva_live_ref_current(uuid,text,text)', 'execute'),
  'the "still current" helper is internal');
select pg_temp.assert(pg_temp.facts('61000000-0000-4000-8000-0000000000ff') is null, 'an unknown community has no facts');

-- ── Date, time and contact details ──────────────────────────────────────────
select pg_temp.facts(:c) as f \gset
select pg_temp.assert((:'f'::jsonb->>'local_today') = to_char(:'today'::date, 'YYYY-MM-DD')
                      and (:'f'::jsonb->>'time_zone') = 'America/Chicago'
                      and (:'f'::jsonb->>'today_label') = to_char(:'today'::date, 'FMDay, FMDD FMMonth YYYY')
                      and (:'f'::jsonb->>'center_name') = 'Sixty-One Sangh'
                      and (:'f'::jsonb->>'days') = '14'
                      and (:'f'::jsonb->>'time_label') ~ '^[0-9]{1,2}:[0-9]{2} (AM|PM)$'
                      and left(:'f'::jsonb->>'local_now', 10) = to_char(:'today'::date, 'YYYY-MM-DD'),
  'the local date and time are in the community''s time zone');
select pg_temp.facts(:c2) as f2 \gset
select pg_temp.facts(:c3) as f3 \gset
select pg_temp.assert((:'f2'::jsonb->>'local_today') = to_char((now() at time zone 'Pacific/Kiritimati')::date, 'YYYY-MM-DD')
                      and (:'f3'::jsonb->>'local_today') = to_char((now() at time zone 'Pacific/Pago_Pago')::date, 'YYYY-MM-DD')
                      and (:'f2'::jsonb->>'local_today') <> (:'f3'::jsonb->>'local_today'),
  'local_today follows centers.time_zone (Kiritimati and Pago Pago are always a day apart)');
select pg_temp.assert((:'f'::jsonb->'contact') = '{"place_name":"Sixty-One Derasar","address":"3905 Arc St, Houston, TX 77063",
                        "phone":"+1 (713) 555-0161","website":"https://example.org/sixty-one"}'::jsonb,
  'contact details are the guide''s fields only (no logo, colours or links; an empty note is left out)');
select pg_temp.assert((:'f'::jsonb->'regular_timings') = '{"derasar_hours":"7:30 AM – 6:00 PM daily","aarti":"12:30 PM and 4:30 PM"}'::jsonb,
  'regular timings come from rules.timings (an empty one is left out)');
select pg_temp.assert((:'f3'::jsonb->'contact') = 'null'::jsonb and (:'f3'::jsonb->'regular_timings') = 'null'::jsonb
                      and (:'f3'::jsonb->'daily_timings') = '[]'::jsonb and (:'f3'::jsonb->'events') = '[]'::jsonb,
  'a community with nothing set (a blank address, a website that is not a web address) has no contact, timings or events');

-- ── Daily timings: today and the next seven days ─────────────────────────────
select pg_temp.assert(jsonb_array_length(:'f'::jsonb->'daily_timings') = 8
                      and (:'f'::jsonb->'daily_timings'->0->>'on_date') = to_char(:'today'::date, 'YYYY-MM-DD')
                      and (:'f'::jsonb->'daily_timings'->7->>'on_date') = to_char(:'today'::date + 7, 'YYYY-MM-DD'),
  'daily timings run from today to today + 7');
select pg_temp.assert((:'f'::jsonb->'daily_timings'->0) = jsonb_build_object(
                         'on_date', to_char(:'today'::date, 'YYYY-MM-DD'), 'day_label', to_char(:'today'::date, 'FMDay, FMDD FMMonth YYYY'),
                         'sunrise', '7:14 AM', 'sunset', '7:08 PM', 'navkarsi', '8:02 AM', 'chauvihar', '7:08 PM', 'aarti', '12:30 PM',
                         'temple_open', '7:30 AM', 'temple_close', '6:00 PM')
                      and not (:'f'::jsonb->'daily_timings'->1 ? 'aarti'),
  'each day reads as clock times, and a time that is not set is left out');

-- ── Events ──────────────────────────────────────────────────────────────────
select pg_temp.assert(pg_temp.event_ids(:'f'::jsonb) = array[
                        '61000000-0000-4000-8000-000000000e05', '61000000-0000-4000-8000-000000000e04',
                        '61000000-0000-4000-8000-000000000e01', '61000000-0000-4000-8000-000000000e03',
                        '61000000-0000-4000-8000-000000000e02'],
  'published, rsvp_closed and live events for every member, in start order (one earlier today included)');
select pg_temp.assert(not (pg_temp.event_ids(:'f'::jsonb) && array[
                        '61000000-0000-4000-8000-000000000e10', '61000000-0000-4000-8000-000000000e11', '61000000-0000-4000-8000-000000000e12',
                        '61000000-0000-4000-8000-000000000e13', '61000000-0000-4000-8000-000000000e14', '61000000-0000-4000-8000-000000000e15',
                        '61000000-0000-4000-8000-000000000e16', '61000000-0000-4000-8000-000000000e17', '61000000-0000-4000-8000-000000000e18',
                        '61000000-0000-4000-8000-000000000e20']),
  'draft, cancelled, completed, confidential, life-member-only, Pathshala-family-only, too-far-off, past and other communities'' events are left out');
select pg_temp.assert(pg_temp.event_ids(pg_temp.facts(:c, 30)) @> array['61000000-0000-4000-8000-000000000e16']
                      and (pg_temp.facts(:c, 30)->>'days') = '30' and (pg_temp.facts(:c, 1000)->>'days') = '60',
  'a longer window brings in a later event (at most 60 days)');
select pg_temp.assert(jsonb_array_length(:'f2'::jsonb->'events') = 25
                      and (:'f2'::jsonb->'events'->0->>'name') = 'Daily puja 1' and (:'f2'::jsonb->'events'->24->>'name') = 'Daily puja 25',
  'at most 25 events, the soonest first');

select pg_temp.event(:'f'::jsonb, '61000000-0000-4000-8000-000000000e01') as e1 \gset
select pg_temp.assert((:'e1'::jsonb->>'name') = 'Tapasvi Bahuman' and (:'e1'::jsonb->>'venue') = 'Main hall'
                      and (:'e1'::jsonb->>'rsvp') = 'open' and (:'e1'::jsonb ? 'rsvp_closes_label') and not (:'e1'::jsonb ? 'happening_now')
                      and (:'e1'::jsonb->>'starts_local') = to_char((now() + interval '2 days') at time zone 'America/Chicago', 'YYYY-MM-DD"T"HH24:MI')
                      and (:'e1'::jsonb->>'starts_label') = to_char((now() + interval '2 days') at time zone 'America/Chicago', 'FMDay, FMDD FMMonth YYYY, FMHH12:MI AM'),
  'an event has its name, venue, local start and whether RSVPs are open (and until when)');
select pg_temp.assert((pg_temp.event(:'f'::jsonb, '61000000-0000-4000-8000-000000000e02')->>'rsvp') = 'not_open_yet'
                      and (pg_temp.event(:'f'::jsonb, '61000000-0000-4000-8000-000000000e02') ? 'rsvp_opens_label')
                      and not (pg_temp.event(:'f'::jsonb, '61000000-0000-4000-8000-000000000e02') ? 'venue')
                      and not (pg_temp.event(:'f'::jsonb, '61000000-0000-4000-8000-000000000e02') ? 'ends_label'),
  'RSVPs that open later say so; a blank venue and a missing end are left out');
select pg_temp.assert((pg_temp.event(:'f'::jsonb, '61000000-0000-4000-8000-000000000e03')->>'rsvp') = 'closed'
                      and (pg_temp.event(:'f'::jsonb, '61000000-0000-4000-8000-000000000e03')->>'ends_label') ~ ', ',
  'rsvp_closed reads closed; an event ending on another day gives the full end date');
select pg_temp.assert((pg_temp.event(:'f'::jsonb, '61000000-0000-4000-8000-000000000e04')->>'happening_now') = 'true'
                      and (pg_temp.event(:'f'::jsonb, '61000000-0000-4000-8000-000000000e04')->>'rsvp') = 'closed',
  'a live event is happening now (and RSVPs that closed say closed)');
select pg_temp.event(:'f'::jsonb, '61000000-0000-4000-8000-000000000e05') as e5 \gset
select pg_temp.assert((select ((:'e5'::jsonb->>'ended') = 'true') = (e.ends_at < now())
                                and ((:'e5'::jsonb->>'rsvp') = 'closed') = (e.ends_at < now())
                                and not (:'e5'::jsonb ? 'rsvp_closes_label')
                                and ((:'e5'::jsonb ? 'happening_now') = (e.ends_at >= now()))
                           from app.events e where e.id = '61000000-0000-4000-8000-000000000e05')
                      and not (pg_temp.event(:'f'::jsonb, '61000000-0000-4000-8000-000000000e01') ? 'ended'),
  'an event that ended earlier today is over: its RSVP reads closed and it is not happening now, as in the member app');

-- ── A question asked on an earlier day (paused, or staff's Try again) ────────
select pg_temp.facts(:c, null, :'today'::date - 1) as fy \gset
select pg_temp.assert(pg_temp.timing_dates(:'fy'::jsonb) = array(select to_char(:'today'::date + g, 'YYYY-MM-DD') from generate_series(-1, 7) g)
                      and (:'fy'::jsonb->>'local_today') = to_char(:'today'::date, 'YYYY-MM-DD'),
  'asked yesterday: the timings start at that day (and still run to today + 7)');
select pg_temp.assert(pg_temp.event_ids(:'fy'::jsonb) = array[
                        '61000000-0000-4000-8000-000000000e20', '61000000-0000-4000-8000-000000000e05', '61000000-0000-4000-8000-000000000e04',
                        '61000000-0000-4000-8000-000000000e01', '61000000-0000-4000-8000-000000000e03', '61000000-0000-4000-8000-000000000e02']
                      and (pg_temp.event(:'fy'::jsonb, '61000000-0000-4000-8000-000000000e20')->>'ended') = 'true'
                      and (pg_temp.event(:'fy'::jsonb, '61000000-0000-4000-8000-000000000e20')->>'rsvp') = 'closed'
                      and not (pg_temp.event_ids(:'fy'::jsonb) && array['61000000-0000-4000-8000-000000000e13', '61000000-0000-4000-8000-000000000e14']),
  'asked yesterday: that day''s event is offered too, read as over, and the same events stay left out');
select pg_temp.assert(pg_temp.timing_dates(pg_temp.facts(:c, null, :'today'::date)) = pg_temp.timing_dates(:'f'::jsonb)
                      and pg_temp.event_ids(pg_temp.facts(:c, null, :'today'::date + 3)) = pg_temp.event_ids(:'f'::jsonb)
                      and pg_temp.timing_dates(pg_temp.facts(:c, null, :'today'::date - 40)) = pg_temp.timing_dates(:'f'::jsonb)
                      and pg_temp.event_ids(pg_temp.facts(:c, null, :'today'::date - 40)) = pg_temp.event_ids(:'f'::jsonb),
  'a day that is today, later, or more than 31 days back changes nothing');
select pg_temp.assert((pg_temp.facts(:c4, null, :'today'::date - 1)->'daily_timings') = '[]'::jsonb,
  'an earlier day still has no timings while My Jain Way is off');

-- ── Never RSVPs, giving or people ───────────────────────────────────────────
select pg_temp.assert(pg_temp.all_keys(:'f'::jsonb) <@ array[
                        'center_name', 'time_zone', 'local_now', 'local_today', 'today_label', 'time_label', 'days',
                        'contact', 'place_name', 'address', 'address_note', 'phone', 'website',
                        'regular_timings', 'derasar_hours', 'aarti', 'snatra_puja',
                        'daily_timings', 'on_date', 'day_label', 'sunrise', 'sunset', 'navkarsi', 'chauvihar', 'temple_open', 'temple_close',
                        'events', 'id', 'name', 'venue', 'starts_local', 'ends_local', 'starts_label', 'ends_label', 'happening_now',
                        'ended', 'rsvp', 'rsvp_opens_label', 'rsvp_closes_label'],
  'the facts carry only schedule, timing and contact fields');
select pg_temp.assert(position('Hiddenname61' in :'f') = 0 and position('RSVP-GUEST-61' in :'f') = 0
                      and position('SECRET-DESC-61' in :'f') = 0 and position('ELIG-61' in :'f') = 0
                      and position('424242' in :'f') = 0 and position('515151' in :'f') = 0
                      and position('SECRET-LOGO' in :'f') = 0 and position('Board retreat' in :'f') = 0,
  'no person, household, RSVP, description, eligibility, price, logo or confidential event reaches the output');
select pg_temp.assert((select p.prosrc !~* '\m(rsvps|attendees|pledges|payments|payment_allocations|people|households|household_members|campaigns|opportunities|bolis|boli_entries|giving_row_visible)\M'
                         from pg_proc p where p.oid = 'app.niva_worker_center_facts(uuid,int,date)'::regprocedure),
  'the function never mentions an RSVP, giving or people table');

-- ── Module switches ─────────────────────────────────────────────────────────
select pg_temp.facts(:c4) as f4 \gset
select pg_temp.assert((:'f4'::jsonb->'events') = '[]'::jsonb and (:'f4'::jsonb->'daily_timings') = '[]'::jsonb,
  'with Events and My Jain Way off, no events and no daily timings');

-- ── The worker's call ───────────────────────────────────────────────────────
select to_char(:'today'::date - 1, 'YYYY-MM-DD') as yday \gset
begin;
set local role connect_worker;
-- Exactly what worker/src/niva/facts.ts sends (untyped parameters; the asked day null, or a 'YYYY-MM-DD' string).
prepare niva61_worker_call as select app.niva_worker_center_facts($1, $2, $3::date) as r;
execute niva61_worker_call('61000000-0000-4000-8000-0000000000c1', 14, null) \gset w_
execute niva61_worker_call('61000000-0000-4000-8000-0000000000c1', 14, :'yday') \gset wy_
deallocate niva61_worker_call;
commit;
select pg_temp.assert(jsonb_array_length(:'w_r'::jsonb->'events') = 5 and jsonb_array_length(:'wy_r'::jsonb->'events') = 6,
  'the worker''s call works with untyped parameters, with and without the day the member asked');

-- ── A regenerate keeps an answer while a cited live item is still current ────
insert into app.niva_conversations (id, center_id, user_id, question, answer, sources, unanswered, answer_status) values
  ('61000000-0000-4000-8000-0000000000d1', :c, :member, 'When is the Tapasvi Bahuman?', 'In two days, in the main hall.',
   '[{"kind":"event","id":"61000000-0000-4000-8000-000000000e01","title":"Tapasvi Bahuman"}]', false, 'answered'),
  ('61000000-0000-4000-8000-0000000000d2', :c, :member, 'When is navkarsi today?', 'At 8:02 AM.',
   jsonb_build_array(jsonb_build_object('kind', 'timings', 'id', to_char(:'today'::date, 'YYYY-MM-DD'), 'title', 'Timings for today')), false, 'answered'),
  ('61000000-0000-4000-8000-0000000000d3', :c, :member, 'When was navkarsi on Monday?', 'At 8:02 AM.',
   jsonb_build_array(jsonb_build_object('kind', 'timings', 'id', to_char(:'today'::date - 1, 'YYYY-MM-DD'), 'title', 'Timings for yesterday')), false, 'answered'),
  ('61000000-0000-4000-8000-0000000000d4', :c, :member, 'Where is the derasar?', 'At 3905 Arc St.',
   '[{"kind":"center","id":"address","title":"Address and contact"}]', false, 'answered'),
  ('61000000-0000-4000-8000-0000000000d5', :c3, null, 'Where is the derasar?', 'Somewhere.',
   '[{"kind":"center","id":"address","title":"Address and contact"},{"kind":"center","id":"hours","title":"Regular timings"},{"kind":"timings","id":"2026-13-45","title":"Bad date"},{"kind":"timings","id":"infinity","title":"Forever"},{"kind":"event","id":"not-a-uuid","title":"Bad"}]', false, 'answered'),
  -- today's timings where My Jain Way is off (its row exists), and where that day has no row: neither is offered
  ('61000000-0000-4000-8000-0000000000d7', :c4, null, 'When is sunrise today?', 'At 7:14 AM.',
   jsonb_build_array(jsonb_build_object('kind', 'timings', 'id', to_char(:'today'::date, 'YYYY-MM-DD'), 'title', 'Timings for today')), false, 'answered'),
  ('61000000-0000-4000-8000-0000000000d8', :c5, null, 'When is sunrise today?', 'At 7:14 AM.',
   jsonb_build_array(jsonb_build_object('kind', 'timings', 'id', to_char(:'today'::date, 'YYYY-MM-DD'), 'title', 'Timings for today')), false, 'answered'),
  -- the address item built from the note alone, or from the website alone: both are offered
  ('61000000-0000-4000-8000-0000000000d9', :c5, null, 'How do I get in?', 'Use the side gate on Arc St.',
   '[{"kind":"center","id":"address","title":"Address and contact"}]', false, 'answered'),
  ('61000000-0000-4000-8000-0000000000da', :c6, null, 'Do you have a website?', 'Yes.',
   '[{"kind":"center","id":"address","title":"Address and contact"}]', false, 'answered');
begin;
set local role connect_worker;
select app.niva_worker_set_outcome('61000000-0000-4000-8000-0000000000d1', 'unsure', 'Niva found sources, but none of them clearly answers the question.', true) as k1 \gset
select app.niva_worker_set_outcome('61000000-0000-4000-8000-0000000000d2', 'unsure', 'x', true) as k2 \gset
select app.niva_worker_set_outcome('61000000-0000-4000-8000-0000000000d3', 'unsure', 'x', true) as k3 \gset
select app.niva_worker_set_outcome('61000000-0000-4000-8000-0000000000d4', 'unsure', 'x', true) as k4 \gset
select app.niva_worker_set_outcome('61000000-0000-4000-8000-0000000000d5', 'no_source', 'x', true) as k5 \gset
select app.niva_worker_set_outcome('61000000-0000-4000-8000-0000000000d7', 'unsure', 'x', true) as k7 \gset
select app.niva_worker_set_outcome('61000000-0000-4000-8000-0000000000d8', 'unsure', 'x', true) as k8 \gset
select app.niva_worker_set_outcome('61000000-0000-4000-8000-0000000000d9', 'unsure', 'x', true) as k9 \gset
select app.niva_worker_set_outcome('61000000-0000-4000-8000-0000000000da', 'unsure', 'x', true) as k10 \gset
commit;
select pg_temp.assert((:'k1'::jsonb->>'cleared') = 'false' and (:'k1'::jsonb->>'status') = 'answered'
                      and (select answer is not null from app.niva_conversations where id = '61000000-0000-4000-8000-0000000000d1'),
  'an answer citing an event still on the schedule is kept');
select pg_temp.assert((:'k2'::jsonb->>'cleared') = 'false' and (:'k3'::jsonb->>'cleared') = 'true',
  'an answer citing today''s timings is kept; one citing a past day''s is removed');
select pg_temp.assert((:'k4'::jsonb->>'cleared') = 'false' and (:'k5'::jsonb->>'cleared') = 'true'
                      and (select answer is null and answer_status = 'no_source' and unanswered
                             from app.niva_conversations where id = '61000000-0000-4000-8000-0000000000d5'),
  'the address counts while it is set; a blank address, unset hours and malformed ids do not');
select pg_temp.assert((:'k7'::jsonb->>'cleared') = 'true' and (:'k8'::jsonb->>'cleared') = 'true',
  'a day''s timings count only while they are offered: not with My Jain Way off, nor once that day''s row is gone');
select pg_temp.assert((:'k9'::jsonb->>'cleared') = 'false' and (:'k10'::jsonb->>'cleared') = 'false'
                      and (pg_temp.facts(:c5)->'contact') = '{"address_note":"Use the side gate on Arc St"}'::jsonb
                      and (pg_temp.facts(:c6)->'contact') = '{"website":"https://example.org/sixty-one-f"}'::jsonb,
  'the address counts by the same five fields the facts offer (a note alone, or a web address alone)');
update app.events set status = 'cancelled' where id = '61000000-0000-4000-8000-000000000e01';
begin;
set local role connect_worker;
select app.niva_worker_set_outcome('61000000-0000-4000-8000-0000000000d1', 'unsure', 'x', true) as k6 \gset
commit;
select pg_temp.assert((:'k6'::jsonb->>'cleared') = 'true'
                      and (select answer is null and sources = '[]'::jsonb and answer_status = 'unsure'
                             from app.niva_conversations where id = '61000000-0000-4000-8000-0000000000d1'),
  'once the event is cancelled, the answer that cited it is removed');

-- ── Search path ─────────────────────────────────────────────────────────────
select pg_temp.assert((select bool_and(exists (select 1 from unnest(p.proconfig) as g(setting)
                                                where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p where p.oid in ('app.niva_worker_center_facts(uuid,int,date)'::regprocedure,
                                                       'app.niva_live_ref_current(uuid,text,text)'::regprocedure,
                                                       'app.niva_worker_set_outcome(uuid,text,text,boolean,timestamptz)'::regprocedure))
                      and (select prosecdef from pg_proc where oid = 'app.niva_worker_center_facts(uuid,int,date)'::regprocedure),
  'the new functions pin search_path = app, public, extensions');
