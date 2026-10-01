-- 0567: JSH's address and daily timings in the member app.
--
-- The member Home card "Today at JSH" reads app.daily_timings (sunrise, navkarsi, chauvihar) for today, and the guide's
-- Timings and visiting screen reads the community's address from centers.branding. Neither had ever been entered for
-- JSH, so Home said "Today's timings haven't been published yet" and the guide said the center had not added its address.
--
-- 1. app.sun_times(date, lat, lng): sunrise and sunset from the NOAA general solar position equations (about ±1 minute
--    at Houston's latitude; checked against published Houston times in test 58). Pure arithmetic; no polar handling
--    beyond returning no row when the sun does not rise or set that day.
-- 2. app.fill_daily_sun_timings(center, lat, lng, from, to, temple_open, temple_close): adds a row for each day that has
--    none — sunrise and sunset to the nearest minute, navkarsi = sunrise + 48 minutes rounded UP, chauvihar = sunset
--    rounded DOWN (both rounded the safe way for the pachchakhan), and the derasar hours when given. A day the office
--    has already entered (portal › Content › Today & darshan › Timings by day) is never changed. Staff tooling and
--    jobs only: not callable by members.
-- 3. app.seed_jsh_contact_and_timings(), for JSH (the community seed.sql creates) and only if it exists: the address, phone and website from
--    jainsocietyhouston.org (2026-10-01) where branding has none; the derasar hours and aarti from the same page where
--    rules.timings has none; and sunrise-based timings from yesterday for about fifteen months, for ZIP 77063
--    (29.734, -95.522). A yearly refill is BACKLOG work.

create or replace function app.sun_times(p_date date, p_lat double precision, p_lng double precision,
                                         out sunrise timestamptz, out sunset timestamptz)
language plpgsql stable set search_path = app, public, extensions as $$
declare
  v_year int := extract(year from p_date)::int;
  v_days double precision := case when (v_year % 4 = 0 and v_year % 100 <> 0) or v_year % 400 = 0 then 366 else 365 end;
  g double precision := 2 * pi() / v_days * (extract(doy from p_date)::double precision - 1);
  eqt double precision := 229.18 * (0.000075 + 0.001868 * cos(g) - 0.032077 * sin(g) - 0.014615 * cos(2 * g) - 0.040849 * sin(2 * g));
  decl double precision := 0.006918 - 0.399912 * cos(g) + 0.070257 * sin(g) - 0.006758 * cos(2 * g) + 0.000907 * sin(2 * g)
                           - 0.002697 * cos(3 * g) + 0.00148 * sin(3 * g);
  c double precision;
  ha double precision;
begin
  if p_date is null or p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then return; end if;
  c := cos(radians(90.833)) / (cos(radians(p_lat)) * cos(decl)) - tan(radians(p_lat)) * tan(decl);
  if c < -1 or c > 1 then return; end if;  -- the sun does not rise or does not set that day
  ha := degrees(acos(c));
  -- minutes after 00:00 UTC on p_date
  sunrise := (p_date::timestamp + make_interval(secs => (720 - 4 * (p_lng + ha) - eqt) * 60)) at time zone 'UTC';
  sunset  := (p_date::timestamp + make_interval(secs => (720 - 4 * (p_lng - ha) - eqt) * 60)) at time zone 'UTC';
end $$;
comment on function app.sun_times(date, double precision, double precision) is
  'Sunrise and sunset (timestamptz) for a date and place, NOAA general solar position equations, about ±1 minute.';

create or replace function app.fill_daily_sun_timings(p_center uuid, p_lat double precision, p_lng double precision,
                                                      p_from date, p_to date,
                                                      p_temple_open time default null, p_temple_close time default null)
returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_tz text; v_n integer;
begin
  select time_zone into v_tz from app.centers where id = p_center;
  if v_tz is null then raise exception 'That community was not found.' using errcode = 'P0002'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then
    raise exception 'Choose a date range of at most 800 days.' using errcode = '22023';
  end if;
  insert into app.daily_timings (center_id, on_date, sunrise, sunset, navkarsi, chauvihar, temple_open, temple_close)
  select p_center, d.on_date,
         date_trunc('minute', (s.sunrise + interval '30 seconds') at time zone v_tz)::time,
         date_trunc('minute', (s.sunset + interval '30 seconds') at time zone v_tz)::time,
         date_trunc('minute', (s.sunrise + interval '48 minutes 59.999 seconds') at time zone v_tz)::time,
         date_trunc('minute', s.sunset at time zone v_tz)::time,
         p_temple_open, p_temple_close
    from (select g::date as on_date from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g) d
    cross join lateral app.sun_times(d.on_date, p_lat, p_lng) s
   where s.sunrise is not null and s.sunset is not null
  on conflict (center_id, on_date) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function app.fill_daily_sun_timings(uuid, double precision, double precision, date, date, time, time) is
  'Adds sunrise-based daily timings for days that have none; never changes a day already entered. Staff tooling and jobs only.';
revoke all on function app.fill_daily_sun_timings(uuid, double precision, double precision, date, date, time, time) from public, anon, authenticated;
grant execute on function app.fill_daily_sun_timings(uuid, double precision, double precision, date, date, time, time) to service_role;

-- A brand-new database applies the migrations before seed.sql creates JSH, so there this does nothing; seed.sql does
-- not call it either (test databases keep JSH as the bare baseline fixture), and test 58 runs it explicitly.
create or replace function app.seed_jsh_contact_and_timings() returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_jsh constant uuid := '00000000-0000-4000-8000-000000000001';
  v_today date;
  v_days integer;
begin
  select (now() at time zone time_zone)::date into v_today from app.centers where id = v_jsh;
  if v_today is null then return jsonb_build_object('skipped', 'no JSH community yet'); end if;

  -- Address and contact, only where the office has not entered its own.
  update app.centers
     set branding = jsonb_build_object('address', '3905 Arc St, Houston, TX 77063',
                                       'phone', '+1 (713) 789-2338',
                                       'website', 'https://www.jainsocietyhouston.org')
                    || coalesce(branding, '{}'::jsonb)
   where id = v_jsh;

  -- Derasar hours and aarti, only where Content › Today & darshan has none.
  update app.centers
     set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{timings}',
                           jsonb_build_object('derasar_hours', '7:30 AM – 6:00 PM daily', 'aarti', '12:30 PM and 4:30 PM')
                           || case when jsonb_typeof(rules -> 'timings') = 'object' then rules -> 'timings' else '{}'::jsonb end)
   where id = v_jsh;

  v_days := app.fill_daily_sun_timings(v_jsh, 29.734, -95.522, v_today - 1, v_today + 456, time '07:30', time '18:00');
  return jsonb_build_object('days_added', v_days);
end $$;
revoke all on function app.seed_jsh_contact_and_timings() from public, anon, authenticated;
grant execute on function app.seed_jsh_contact_and_timings() to service_role;

select app.seed_jsh_contact_and_timings();
