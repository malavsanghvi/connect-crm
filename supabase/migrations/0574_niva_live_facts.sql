-- 0574_niva_live_facts.sql: Niva answers "is the derasar open today?", "when is navkarsi tomorrow?", "where is the
-- temple?" and "what is on this weekend?" from the community's live schedule (Niva fix plan, PR G).
--
-- Until now Niva could only answer from approved sources (content_items, and since 0573 Guide sections and FAQ), so
-- every question about today's timings, the address or an upcoming event ended unanswered unless someone had typed
-- the schedule into a source. Owner decision 2026-10-01: Niva may read the live schedule — published events, daily
-- timings and the address only; never RSVPs, pledges, payments or people. Giving items (campaigns, opportunities,
-- bolis) stay out: they are a separate owner decision and would have to say "pledge", never "bid".
--
--   1. app.niva_worker_center_facts(center, days default 14, from default null)       connect_worker only
--      What a member of the community can already see in the app, in the community's own time zone:
--        { center_name, time_zone, local_now 'YYYY-MM-DDTHH:MI:SS', local_today 'YYYY-MM-DD',
--          today_label 'Friday, 2 October 2026', time_label '10:05 AM', days,
--          contact:         { place_name, address, address_note, phone, website } from centers.branding (0567), or null
--                           (the guide's own fields; the website only when it is an http(s) address);
--          regular_timings: { derasar_hours, aarti, snatra_puja } from centers.rules.timings, or null;
--          daily_timings:   [{ on_date, day_label, sunrise, sunset, navkarsi, chauvihar, aarti, temple_open,
--                              temple_close }] from today to today + 7 (times as '7:14 AM'; a missing time is left out),
--                           and from 'from' to from + 7 as well when that is set;
--          events:          [{ id, name, venue, starts_local, ends_local, starts_label, ends_label, happening_now, ended,
--                              rsvp ('open' | 'closed' | 'not_open_yet'), rsvp_opens_label, rsvp_closes_label }] }
--                           (an event is over once it ended, or six hours after its start when it has no end, as the
--                           member app counts it; its RSVP then reads closed)
--      Events: at most 25, in start order, that are not confidential, have status published, rsvp_closed or live,
--      audience members_only, members_and_guests or public, and start before now + days (and have not ended, or
--      started today, or start in the week from 'from'). These are the member read policy's own predicates (0010
--      events_member_read), narrowed to the audiences every member is in, so Niva never mentions an event a member
--      could not see or is not invited to.
--      Daily timings only while the community has My Jain Way on, events only while it has Events on (the module
--      switches of 0101/0103 hide those tables from members otherwise).
--      'from' is the day the member asked, which the worker passes when that was before today (a question paused by
--      the AI service's spending limit, or staff's Try again): the prompt tells the model to read "today", "tomorrow"
--      or "this weekend" from that day, so that day's week is offered too. Ignored unless it is before today and at
--      most 31 days back (questions are kept 30 days).
--      Nothing else is read: no RSVPs, attendees, pledges, payments, people, households, prices, descriptions,
--      eligibility rules or event owners. The worker offers these as "live" sources (event:<id>, timings:<date>,
--      center:address, center:hours) next to the approved ones, and stores a cited one as {kind, id, title}.
--   2. niva_worker_set_outcome (0572) keeps an answer on a regenerate that ends without one while a live item it
--      cited is still current (an event still on the schedule and not over, a day's timings for today or later that
--      are still offered, the address or regular timings still set: each by the same test the facts use), exactly as
--      it already does for a published source. Same signature and grants; only the "is a cited source still
--      current?" test changed (app.niva_live_ref_current, internal).
--
-- 0572 is applied and untouched; niva_worker_set_outcome is replaced with create or replace.

set client_min_messages = warning;

-- ── 1. The live schedule ─────────────────────────────────────────────────────
create or replace function app.niva_worker_center_facts(p_center uuid, p_days int default 14, p_from date default null)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_days int := least(greatest(coalesce(p_days, 14), 1), 60);
  v_now timestamptz := now();
  v_name text;
  v_tz text;
  v_branding jsonb;
  v_rules jsonb;
  v_local timestamp;
  v_today date;
  v_day_start timestamptz;
  v_from date;
  v_contact jsonb;
  v_hours jsonb;
  v_timings jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb;
begin
  perform app.assert_worker();
  select c.name, c.time_zone, c.branding, c.rules into v_name, v_tz, v_branding, v_rules
    from app.centers c where c.id = p_center;
  if not found then return null; end if;

  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
  begin
    v_local := v_now at time zone v_tz;
  exception when others then                -- a time zone Postgres does not know: fall back to UTC (as 0572 does)
    v_tz := 'UTC';
    v_local := v_now at time zone 'UTC';
  end;
  v_today := v_local::date;
  v_day_start := v_today::timestamp at time zone v_tz;
  -- The day the member asked, when that was before today (and at most 31 days back): that day's week is offered too.
  v_from := case when p_from < v_today and p_from >= v_today - 31 then p_from else v_today end;

  -- Contact details: the keys the member app's guide shows (connect-mobile readCenterContact), text only; the
  -- website only when it is a web address, as the guide requires.
  select jsonb_object_agg(k.key, left(btrim(b.val ->> k.key), 300) order by k.n)
    into v_contact
    from unnest(array['place_name', 'address', 'address_note', 'phone', 'website']) with ordinality as k(key, n)
   cross join (select case when jsonb_typeof(v_branding) = 'object' then v_branding else '{}'::jsonb end as val) b
   where jsonb_typeof(b.val -> k.key) = 'string' and btrim(b.val ->> k.key) <> ''
     and (k.key <> 'website' or btrim(b.val ->> k.key) ~* '^https?://');

  -- Regular timings (Content › Today & darshan), text only.
  select jsonb_object_agg(k.key, left(btrim(t.val ->> k.key), 200) order by k.n)
    into v_hours
    from unnest(array['derasar_hours', 'aarti', 'snatra_puja']) with ordinality as k(key, n)
   cross join (select case when jsonb_typeof(v_rules -> 'timings') = 'object' then v_rules -> 'timings' else '{}'::jsonb end as val) t
   where jsonb_typeof(t.val -> k.key) = 'string' and btrim(t.val ->> k.key) <> '';

  -- Today and the next seven days (and the week from the day the member asked, when that was earlier).
  if app.module_enabled(p_center, 'jain_way') then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'on_date',      to_char(d.on_date, 'YYYY-MM-DD'),
             'day_label',    to_char(d.on_date, 'FMDay, FMDD FMMonth YYYY'),
             'sunrise',      to_char(date '2000-01-01' + d.sunrise, 'FMHH12:MI AM'),
             'sunset',       to_char(date '2000-01-01' + d.sunset, 'FMHH12:MI AM'),
             'navkarsi',     to_char(date '2000-01-01' + d.navkarsi, 'FMHH12:MI AM'),
             'chauvihar',    to_char(date '2000-01-01' + d.chauvihar, 'FMHH12:MI AM'),
             'aarti',        to_char(date '2000-01-01' + d.aarti, 'FMHH12:MI AM'),
             'temple_open',  to_char(date '2000-01-01' + d.temple_open, 'FMHH12:MI AM'),
             'temple_close', to_char(date '2000-01-01' + d.temple_close, 'FMHH12:MI AM')))
           order by d.on_date), '[]'::jsonb)
      into v_timings
      from app.daily_timings d
     where d.center_id = p_center
       and (d.on_date between v_today and v_today + 7 or d.on_date between v_from and v_from + 7);
  end if;

  -- Upcoming events every member can see (and those of the week the member asked in, when that was earlier).
  if app.module_enabled(p_center, 'events') then
    select coalesce(jsonb_agg(x.j order by x.starts_at, x.id), '[]'::jsonb)
      into v_events
      from (
        select e.id, e.starts_at,
               jsonb_strip_nulls(jsonb_build_object(
                 'id',            e.id,
                 'name',          left(btrim(e.name), 200),
                 'venue',         left(nullif(btrim(e.venue), ''), 200),
                 'starts_local',  to_char(e.starts_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI'),
                 'ends_local',    to_char(e.ends_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI'),
                 'starts_label',  to_char(e.starts_at at time zone v_tz, 'FMDay, FMDD FMMonth YYYY, FMHH12:MI AM'),
                 'ends_label',    case when e.ends_at is null then null
                                       when (e.ends_at at time zone v_tz)::date = (e.starts_at at time zone v_tz)::date
                                         then to_char(e.ends_at at time zone v_tz, 'FMHH12:MI AM')
                                       else to_char(e.ends_at at time zone v_tz, 'FMDay, FMDD FMMonth YYYY, FMHH12:MI AM') end,
                 'happening_now', case when not s.ended and (e.status = 'live' or e.starts_at <= v_now) then true end,
                 'ended',         case when s.ended then true end,
                 'rsvp',          s.rsvp,
                 'rsvp_opens_label',  case when s.rsvp = 'not_open_yet'
                                           then to_char(e.rsvp_opens_at at time zone v_tz, 'FMDay, FMDD FMMonth YYYY, FMHH12:MI AM') end,
                 'rsvp_closes_label', case when s.rsvp = 'open' and e.rsvp_closes_at is not null
                                           then to_char(e.rsvp_closes_at at time zone v_tz, 'FMDay, FMDD FMMonth YYYY, FMHH12:MI AM') end
               )) as j
          from app.events e
         -- Over (ended, or started more than six hours ago with no end), and RSVP open or closed: the member app's own
         -- rule (connect-mobile rsvpBlockReason), so Niva never invites anyone to RSVP for an event that is over.
         cross join lateral (select coalesce(e.ends_at, e.starts_at + interval '6 hours') < v_now as ended) o
         cross join lateral (select o.ended,
                                    case when e.status = 'rsvp_closed' or o.ended then 'closed'
                                         when e.rsvp_opens_at > v_now then 'not_open_yet'
                                         when e.rsvp_closes_at < v_now then 'closed'
                                         else 'open' end as rsvp) s
         where e.center_id = p_center
           and not e.confidential
           and e.status in ('published', 'rsvp_closed', 'live')
           and e.audience in ('members_only', 'members_and_guests', 'public')
           and e.starts_at is not null
           and e.starts_at < v_now + make_interval(days => v_days)
           and (e.starts_at >= v_day_start or coalesce(e.ends_at, e.starts_at + interval '6 hours') >= v_now
                or (e.starts_at at time zone v_tz)::date between v_from and v_from + 7)
         order by e.starts_at, e.id
         limit 25) x;
  end if;

  return jsonb_build_object(
    'center_name', v_name,
    'time_zone', v_tz,
    'local_now', to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'local_today', to_char(v_today, 'YYYY-MM-DD'),
    'today_label', to_char(v_today, 'FMDay, FMDD FMMonth YYYY'),
    'time_label', to_char(v_local, 'FMHH12:MI AM'),
    'days', v_days,
    'contact', v_contact,
    'regular_timings', v_hours,
    'daily_timings', v_timings,
    'events', v_events);
end $$;
comment on function app.niva_worker_center_facts(uuid, int, date) is
  'Worker only (0574). The live schedule Niva may answer from: the community''s local date and time, contact details, regular and daily timings (today + 7 days, and the week from p_from when the member asked on an earlier day) and up to 25 events every member can see. Never RSVPs, giving, payments or people.';

-- ── 2. Is a live item an answer cited still current? ─────────────────────────
-- p_kind/p_id as the worker stores a cited live item: event/<uuid>, timings/<YYYY-MM-DD>, center/address, center/hours.
create or replace function app.niva_live_ref_current(p_center uuid, p_kind text, p_id text)
returns boolean language plpgsql stable set search_path = app, public, extensions as $$
declare v_tz text; v_branding jsonb; v_rules jsonb; v_today date; v_day date;
begin
  if p_center is null or p_kind is null or p_id is null then return false; end if;
  select coalesce(nullif(btrim(c.time_zone), ''), 'UTC'), c.branding, c.rules into v_tz, v_branding, v_rules
    from app.centers c where c.id = p_center;
  if not found then return false; end if;

  if p_kind = 'event' then
    if p_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
    return app.module_enabled(p_center, 'events') and exists (
      select 1 from app.events e
       where e.id = p_id::uuid and e.center_id = p_center and not e.confidential
         and e.status in ('published', 'rsvp_closed', 'live')
         and e.audience in ('members_only', 'members_and_guests', 'public')
         and coalesce(e.ends_at, e.starts_at + interval '6 hours') >= now());
  elsif p_kind = 'timings' then
    if p_id !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;   -- not 'today' or 'infinity'
    begin
      v_day := p_id::date;
    exception when others then               -- not a real date (2026-13-45)
      return false;
    end;
    begin
      v_today := (now() at time zone v_tz)::date;
    exception when others then               -- a time zone Postgres does not know: UTC, as the facts use
      v_today := (now() at time zone 'UTC')::date;
    end;
    -- Offered only while My Jain Way is on and that day's row exists, as in the facts.
    return v_day >= v_today and app.module_enabled(p_center, 'jain_way')
       and exists (select 1 from app.daily_timings d where d.center_id = p_center and d.on_date = v_day);
  elsif p_kind = 'center' and p_id = 'address' then
    -- The five keys the facts offer (the website only when it is a web address).
    return coalesce(jsonb_typeof(v_branding) = 'object'
       and exists (select 1 from unnest(array['place_name', 'address', 'address_note', 'phone', 'website']) k
                    where jsonb_typeof(v_branding -> k) = 'string' and btrim(v_branding ->> k) <> ''
                      and (k <> 'website' or btrim(v_branding ->> k) ~* '^https?://')), false);
  elsif p_kind = 'center' and p_id = 'hours' then
    return coalesce(jsonb_typeof(v_rules -> 'timings') = 'object'
       and exists (select 1 from unnest(array['derasar_hours', 'aarti', 'snatra_puja']) k
                    where jsonb_typeof(v_rules -> 'timings' -> k) = 'string' and btrim(v_rules -> 'timings' ->> k) <> ''), false);
  end if;
  return false;
end $$;
comment on function app.niva_live_ref_current(uuid, text, text) is
  'Internal (0574): whether a live item a Niva answer cited (event, a day''s timings, the address or regular timings) is still current.';

-- ── 2. Worker: record why a question was not answered (0572, live items counted as current) ──
-- Unchanged from 0572 except the "still current" test: a cited {kind: event|timings|center, id} live item counts
-- like a cited source that is still published. Anyone who changes app.niva_worker_set_outcome again must start from
-- THIS definition.
create or replace function app.niva_worker_set_outcome(p_id uuid, p_status text, p_detail text,
                                                       p_clear_answer boolean default false, p_retry_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v app.niva_conversations;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_detail text := left(nullif(btrim(app.niva_scrub_text(coalesce(p_detail, ''))), ''), 500);
  v_clear boolean := false;
  v_final text;
  v_payload jsonb;
  v_deferrals int;
  v_retry bigint;
begin
  perform app.assert_worker();
  if v_status = 'answered' then
    raise exception 'niva_worker_set_outcome does not record answers; call niva_worker_store_answer instead.';
  end if;
  if v_status not in ('no_source','unsure','refused','paused','failed') then
    raise exception 'niva_worker_set_outcome: "%" is not an outcome (use no_source, unsure, refused, paused or failed).', p_status;
  end if;
  if p_retry_at is not null and v_status <> 'paused' then
    raise exception 'niva_worker_set_outcome: a retry time goes only with the paused outcome (got %).', v_status;
  end if;

  select * into v from app.niva_conversations where id = p_id for update;
  if not found then raise exception 'Niva conversation % was not found (it may have been deleted by the 30-day retention job).', p_id; end if;

  if coalesce(p_clear_answer, false) and v.answer is not null then
    v_clear := not exists (
      select 1
        from jsonb_array_elements(case when jsonb_typeof(v.sources) = 'array' then v.sources else '[]'::jsonb end) s(src)
        cross join lateral (
          select coalesce(s.src->>'content_item_id', s.src->>'id') as ref,
                 case when s.src->>'content_item_id' is null and s.src->>'kind' in ('event', 'timings', 'center')
                      then s.src->>'kind' end as live_kind,
                 substring(coalesce(s.src->>'content_item_id', s.src->>'id')
                           from '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$') as ref_id) r
       where case when r.live_kind is not null
                  then app.niva_live_ref_current(v.center_id, r.live_kind, s.src->>'id')
                  when r.ref_id is null then false
                  when r.ref like 'guide_section:%'
                  then exists (select 1 from app.guide_sections g where g.id = r.ref_id::uuid and g.public)
                  else exists (select 1 from app.content_items c where c.id = r.ref_id::uuid and c.status = 'published')
             end);
  end if;

  update app.niva_conversations
     set answer = case when v_clear then null else answer end,
         sources = case when v_clear then '[]'::jsonb else sources end,
         unanswered = case when v_clear then true else unanswered end,
         answer_status = case when not v_clear and answer is not null then 'answered' else v_status end,
         outcome_detail = v_detail,
         attempted_at = now()
   where id = p_id
  returning answer_status into v_final;

  if p_retry_at is not null
     and not exists (select 1 from app.jobs j where j.kind = 'niva.answer' and j.status = 'queued'
                       and j.payload->>'conversation_id' = p_id::text) then
    select j.payload into v_payload
      from app.jobs j
     where j.kind = 'niva.answer' and j.status = 'running' and j.payload->>'conversation_id' = p_id::text
     order by j.id desc
     limit 1;
    v_deferrals := case when coalesce(v_payload->>'deferrals', '') ~ '^[0-9]{1,6}$' then (v_payload->>'deferrals')::int else 0 end + 1;
    v_payload := coalesce(v_payload, '{}'::jsonb) || jsonb_build_object('conversation_id', p_id, 'deferrals', v_deferrals);
    v_retry := app.enqueue_job(v.center_id, 'niva.answer', v_payload, greatest(p_retry_at, now()), 3);
  end if;

  return jsonb_build_object('status', v_final, 'cleared', v_clear, 'retry_job_id', v_retry);
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- niva_worker_set_outcome keeps its 0572 grants (same signature).
revoke execute on function app.niva_worker_center_facts(uuid, int, date), app.niva_live_ref_current(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function app.niva_worker_center_facts(uuid, int, date) to connect_worker;
