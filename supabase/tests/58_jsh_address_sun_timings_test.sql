-- 0567: sunrise and sunset come out close to published Houston times (timeanddate.com: 2026-10-01 sunrise 7:13 AM,
-- sunset 7:09 PM; 2026-10-31 sunrise 7:33 AM, sunset 6:36 PM — downtown, 29.7604, -95.3698), across the daylight-saving
-- change; the fill adds only missing days, rounds navkarsi up and chauvihar down, never touches a day the office
-- entered, and is not callable by members; JSH gets its address, derasar hours and fifteen months of timings without
-- overwriting what the office already set.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.local(t timestamptz) returns time language sql as $$
  select (t at time zone 'America/Chicago')::time
$$;
\set jsh '''00000000-0000-4000-8000-000000000001'''

-- ── Sun times against published values (within two minutes) ─────────────────
select pg_temp.assert((select pg_temp.local(sunrise) between '07:12' and '07:15' and pg_temp.local(sunset) between '19:07' and '19:10'
                         from app.sun_times('2026-10-01', 29.7604, -95.3698)),
  'Houston 2026-10-01: sunrise about 7:13 AM, sunset about 7:09 PM (CDT)');
select pg_temp.assert((select pg_temp.local(sunrise) between '07:32' and '07:35' and pg_temp.local(sunset) between '18:35' and '18:38'
                         from app.sun_times('2026-10-31', 29.7604, -95.3698)),
  'Houston 2026-10-31: sunrise about 7:33 AM, sunset about 6:36 PM (CDT)');
select pg_temp.assert((select pg_temp.local(sunrise) between '06:31' and '06:36'
                         from app.sun_times('2026-11-02', 29.7604, -95.3698)),
  'the day after daylight saving ends, sunrise moves an hour earlier on the clock (about 6:34 AM CST)');
select pg_temp.assert((select sunrise is null and sunset is null from app.sun_times('2026-06-21', 78.2, 15.6)),
  'no sunrise or sunset where the sun does not set (Svalbard in June)');

-- ── Who may fill ─────────────────────────────────────────────────────────────
select pg_temp.assert(not has_function_privilege('authenticated', 'app.fill_daily_sun_timings(uuid, double precision, double precision, date, date, time, time)', 'execute')
                      and not has_function_privilege('anon', 'app.fill_daily_sun_timings(uuid, double precision, double precision, date, date, time, time)', 'execute')
                      and not has_function_privilege('authenticated', 'app.seed_jsh_contact_and_timings()', 'execute')
                      and has_function_privilege('service_role', 'app.fill_daily_sun_timings(uuid, double precision, double precision, date, date, time, time)', 'execute'),
  'members cannot fill timings or run the JSH set-up; the service role can');

-- ── The fill ────────────────────────────────────────────────────────────────
begin;
insert into app.daily_timings (center_id, on_date, sunrise, sunset, navkarsi, chauvihar)
  values (:jsh, '2026-10-02', '06:00', '20:00', '06:48', '20:00');
select pg_temp.assert(app.fill_daily_sun_timings(:jsh, 29.734, -95.522, '2026-10-01', '2026-10-03', '07:30', '18:00') = 2,
  'three days asked, one already entered: two rows added');
select pg_temp.assert((select sunrise = '06:00' and navkarsi = '06:48' and temple_open is null from app.daily_timings
                        where center_id = :jsh and on_date = '2026-10-02'),
  'the day the office entered is left exactly as it was');
select pg_temp.assert((select navkarsi = sunrise + interval '48 minutes' or navkarsi = sunrise + interval '49 minutes'
                         from app.daily_timings where center_id = :jsh and on_date = '2026-10-01'),
  'navkarsi is sunrise + 48 minutes, rounded up to the minute');
select pg_temp.assert((select chauvihar <= sunset and chauvihar >= sunset - interval '1 minute' and temple_open = '07:30' and temple_close = '18:00'
                         from app.daily_timings where center_id = :jsh and on_date = '2026-10-03'),
  'chauvihar is sunset rounded down; the derasar hours are filled in');
select pg_temp.assert(app.fill_daily_sun_timings(:jsh, 29.734, -95.522, '2026-10-01', '2026-10-03') = 0,
  'running it again adds nothing');
rollback;

do $$ begin
  perform app.fill_daily_sun_timings('00000000-0000-4000-8000-000000000001', 29.7, -95.5, '2026-01-01', '2028-12-31');
  raise exception 'FAIL: a range over 800 days was accepted';
exception when sqlstate '22023' then raise notice 'PASS: a range over 800 days is refused in plain English';
end $$;

-- ── JSH set-up ──────────────────────────────────────────────────────────────
begin;
update app.centers set branding = coalesce(branding, '{}'::jsonb) || '{"phone": "office phone kept"}',
                       rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{timings}', '{"aarti": "7:00 PM"}')
 where id = :jsh;
select pg_temp.assert((select (app.seed_jsh_contact_and_timings() ->> 'days_added')::int > 400),
  'JSH gets about fifteen months of daily timings');
select pg_temp.assert((select branding ->> 'address' = '3905 Arc St, Houston, TX 77063'
                          and branding ->> 'website' = 'https://www.jainsocietyhouston.org'
                          and branding ->> 'phone' = 'office phone kept'
                          and branding ->> 'primary' = '#1B2C5C'
                         from app.centers where id = :jsh),
  'the address and website are added; a phone the office entered is kept');
select pg_temp.assert((select rules #>> '{timings,derasar_hours}' = '7:30 AM – 6:00 PM daily' and rules #>> '{timings,aarti}' = '7:00 PM'
                         from app.centers where id = :jsh),
  'the derasar hours are added; an aarti time the office entered is kept');
select pg_temp.assert((select count(*) from app.daily_timings
                        where center_id = :jsh and on_date = (now() at time zone 'America/Chicago')::date and navkarsi is not null) = 1,
  'today has its sunrise, navkarsi and chauvihar for the Home card');
select pg_temp.assert((select (app.seed_jsh_contact_and_timings() ->> 'days_added')::int) = 0,
  'running the JSH set-up again changes nothing');
rollback;
