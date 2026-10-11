-- 0653: two read-only answers for the Events workspace (B90 phase 4), the numbers Niva and the screens need without reading
-- thousands of rows into page code ("Summary reads" in docs/ADMIN_REDESIGN.md).
--
--   app.event_summary(p_event)
--       One event in numbers: RSVPs by status (households), people (RSVP'd, confirmed, waitlisted, walk-ins, checked in, served),
--       the counts of children under 12, seniors and people needing help (counts only, never a name), capacity, lunch slots and
--       seats, volunteer shifts and who is assigned, checklist actions. The definitions are the Report tab's (eventReport in
--       src/lib/events/report.ts): a cancelled RSVP's people are left out, a walk-in is counted apart, a waitlisted person is not
--       "RSVP'd". Returns null when the caller cannot see the event.
--   app.event_reminder_audience(p_event, p_statuses)
--       Who a reminder to this event's RSVPs would reach, by channel, as counts only: the households that RSVP'd with one of the
--       statuses, the adults in them (18 or over by birth date, or with none on file a head, spouse or parent: the same rule as the
--       child filter, D2), and how many of those adults have opted in to email, text and WhatsApp (their latest choice). Guests who
--       RSVP'd without a household are counted apart: nobody messages them (no consent is recorded for a guest). Push is NOT
--       counted: a member's phone registration is private to that member, and a count across members would need a definer function.
--
-- Both are SECURITY INVOKER: they read as the signed-in person, so row-level security decides what is counted. Where a role cannot
-- see a thing (people, contact choices, volunteer assignments) the answer says so (people_visible, channels_visible, visible) and
-- leaves that number null rather than a misleading 0. No policy, grant of data or permission changes.
set client_min_messages = warning;

create or replace function app.event_summary(p_event uuid) returns jsonb
language plpgsql stable security invoker set search_path = app, public, extensions as $$
declare
  e app.events%rowtype;
  v_tz text;
  v_today date;
  v_rsvps jsonb;
  v_people jsonb;
  v_lunch jsonb;
  v_vol jsonb;
  v_check jsonb;
  v_vol_ok boolean;
begin
  select * into e from app.events where id = p_event;
  if not found then return null; end if;
  v_tz := coalesce((select c.time_zone from app.centers c where c.id = e.center_id), 'UTC');
  v_today := (now() at time zone v_tz)::date;

  select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) into v_rsvps
    from (select r.status::text as status, count(*) as n from app.rsvps r where r.event_id = p_event group by r.status) s;

  select jsonb_build_object(
           'households_total',  (select count(*) from app.rsvps r where r.event_id = p_event),
           'walk_in_households', (select count(*) from app.rsvps r where r.event_id = p_event and r.source = 'walk_in' and r.status <> 'cancelled'),
           'people_rsvpd',      count(*) filter (where not x.cancelled and x.source is distinct from 'walk_in' and x.r_status is distinct from 'waitlisted'),
           'people_confirmed',  count(*) filter (where not x.cancelled and x.source is distinct from 'walk_in' and x.r_status is distinct from 'waitlisted'
                                                   and (x.confirmed_at is not null or x.r_status in ('confirmed', 'attended'))),
           'people_waitlisted', count(*) filter (where not x.cancelled and x.source is distinct from 'walk_in' and x.r_status = 'waitlisted'),
           'walk_in_people',    count(*) filter (where not x.cancelled and x.source = 'walk_in'),
           'not_arrived',       count(*) filter (where not x.cancelled and x.source is distinct from 'walk_in' and x.r_status is distinct from 'waitlisted' and x.checked_in_at is null),
           'checked_in',        count(*) filter (where x.checked_in_at is not null),
           'served',            count(*) filter (where x.served_food_at is not null),
           'gifts_given',       count(*) filter (where x.gift_given_at is not null),
           'children_under_12', count(*) filter (where not x.cancelled and x.is_child_under_12),
           'seniors',           count(*) filter (where not x.cancelled and x.is_senior),
           'needs_assistance',  count(*) filter (where not x.cancelled and x.needs_assistance)
         ) into v_people
    from (select a.checked_in_at, a.served_food_at, a.gift_given_at, a.is_child_under_12, a.is_senior, a.needs_assistance,
                 r.status as r_status, r.source, r.confirmed_at,
                 (coalesce(r.status = 'cancelled', false) or a.status = 'cancelled') as cancelled
            from app.attendees a
            left join app.rsvps r on r.id = a.rsvp_id
           where a.event_id = p_event) x;

  select jsonb_build_object(
           'enabled',         e.lunch_enabled,
           'slots',           count(*),
           'slots_done',      count(*) filter (where l.status = 'done'),
           'seats',           coalesce(sum(l.seats) filter (where l.seats < 1000000), 0),
           'unlimited_slots', count(*) filter (where l.seats >= 1000000),
           'assigned',        (select count(*) from app.attendees t where t.event_id = p_event and t.lunch_slot_id is not null),
           'served',          (select count(*) from app.attendees t where t.event_id = p_event and t.lunch_slot_id is not null and t.served_food_at is not null)
         ) into v_lunch
    from app.lunch_slots l
   where l.event_id = p_event;

  -- Shifts are visible to members, assignments only to volunteer staff and this event's lead: without that, say so.
  v_vol_ok := app.has_permission(e.center_id, 'volunteers.view') or app.has_permission(e.center_id, 'volunteers.manage')
              or app.has_scoped_role(e.center_id, p_event, 'event_lead');
  select jsonb_build_object(
           'visible',      v_vol_ok,
           'shifts',       count(*),
           'spots_needed', coalesce(sum(s.capacity), 0),
           'assigned',     case when v_vol_ok then coalesce(sum(c.n), 0) end,
           'shifts_empty', case when v_vol_ok then count(*) filter (where coalesce(c.n, 0) = 0) end,
           'shifts_open',  case when v_vol_ok then count(*) filter (where s.capacity is not null and coalesce(c.n, 0) < s.capacity) end
         ) into v_vol
    from app.volunteer_shifts s
    left join lateral (select count(*) as n from app.volunteer_assignments va
                        where va.shift_id = s.id and va.status in ('assigned', 'confirmed', 'completed')) c on true
   where s.event_id = p_event;

  select jsonb_build_object(
           'total',       count(*) filter (where a.state <> 'removed'),
           'done',        count(*) filter (where a.state = 'completed'),
           'in_progress', count(*) filter (where a.state = 'in_progress'),
           'not_started', count(*) filter (where a.state = 'not_started'),
           'overdue',     count(*) filter (where a.state in ('not_started', 'in_progress') and a.due_on is not null and a.due_on < v_today)
         ) into v_check
    from app.actions a
   where a.event_id = p_event;

  return jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'name', e.name, 'status', e.status, 'starts_at', e.starts_at, 'capacity', e.capacity,
                                'waitlist_enabled', e.waitlist_enabled, 'lunch_enabled', e.lunch_enabled, 'is_paid', e.is_paid),
    'households', v_rsvps,
    'people', v_people,
    'lunch', v_lunch,
    'volunteers', v_vol,
    'checklist', v_check
  );
end $$;

comment on function app.event_summary(uuid) is
  '0653: one event in numbers (RSVPs, people, lunch, volunteers, checklist), counts only. Security invoker: row-level security decides what is counted; null when the event cannot be seen.';

create or replace function app.event_reminder_audience(p_event uuid, p_statuses text[] default array['rsvpd', 'confirmed']) returns jsonb
language plpgsql stable security invoker set search_path = app, public, extensions as $$
declare
  e app.events%rowtype;
  v_people_ok boolean;
  v_channels_ok boolean;
  v_households integer;
  v_guests integer;
  v_adults integer := 0;
  v_email integer := 0;
  v_sms integer := 0;
  v_wa integer := 0;
  v_none integer := 0;
begin
  select * into e from app.events where id = p_event;
  if not found then return null; end if;
  v_people_ok := app.has_permission(e.center_id, 'people.view') or app.has_permission(e.center_id, 'people.manage');
  v_channels_ok := app.has_permission(e.center_id, 'comms.view') or app.has_permission(e.center_id, 'comms.send');

  select count(distinct r.household_id) filter (where r.household_id is not null),
         count(*) filter (where r.household_id is null)
    into v_households, v_guests
    from app.rsvps r
   where r.event_id = p_event and r.status::text = any (p_statuses);

  if v_people_ok then
    with hh as (
      select distinct r.household_id
        from app.rsvps r
       where r.event_id = p_event and r.status::text = any (p_statuses) and r.household_id is not null
    ), adults as (
      select distinct p.id as person_id
        from hh
        join app.household_members hm on hm.household_id = hh.household_id and hm.left_at is null
        join app.people p on p.id = hm.person_id
       where not p.is_deceased and p.merged_into_id is null
         and ((p.date_of_birth is not null and p.date_of_birth <= current_date - interval '18 years')
              or (p.date_of_birth is null and hm.role in ('primary', 'spouse', 'parent')))
    ), latest as (
      select distinct on (o.person_id, o.channel) o.person_id, o.channel::text as channel, o.opted_in, o.address
        from app.channel_optins o
       where o.person_id in (select person_id from adults)
       order by o.person_id, o.channel, o.recorded_at desc
    )
    select (select count(*) from adults),
           count(*) filter (where l.channel = 'email' and l.opted_in and coalesce(l.address, '') <> ''),
           count(*) filter (where l.channel = 'sms' and l.opted_in and coalesce(l.address, '') <> ''),
           count(*) filter (where l.channel = 'whatsapp' and l.opted_in and coalesce(l.address, '') <> ''),
           (select count(*) from adults a
             where not exists (select 1 from latest l2 where l2.person_id = a.person_id and l2.opted_in and coalesce(l2.address, '') <> ''
                                  and l2.channel in ('email', 'sms', 'whatsapp')))
      into v_adults, v_email, v_sms, v_wa, v_none
      from latest l;
  end if;

  return jsonb_build_object(
    'event_id',         e.id,
    'statuses',         to_jsonb(p_statuses),
    'households',       v_households,
    'guest_rsvps',      v_guests,
    'people_visible',   v_people_ok,
    'channels_visible', v_channels_ok,
    'adults',           case when v_people_ok then v_adults end,
    'email',            case when v_people_ok and v_channels_ok then v_email end,
    'sms',              case when v_people_ok and v_channels_ok then v_sms end,
    'whatsapp',         case when v_people_ok and v_channels_ok then v_wa end,
    'no_channel',       case when v_people_ok and v_channels_ok then v_none end
  );
end $$;

comment on function app.event_reminder_audience(uuid, text[]) is
  '0653: who a reminder to an event''s RSVPs would reach by channel (email, text, WhatsApp), counts only. Adults only (D2). Push is not counted. Security invoker: a role that cannot see people or contact choices gets null, not 0.';

revoke execute on function app.event_summary(uuid), app.event_reminder_audience(uuid, text[]) from public, anon;
grant execute on function app.event_summary(uuid), app.event_reminder_audience(uuid, text[]) to authenticated, service_role;
