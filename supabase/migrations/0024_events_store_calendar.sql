-- 0024_events_store_calendar.sql
-- Prototype parity: bolis, store, calendar, surveys and live event stats.
--   11. bolis.hall_display / closed_reason; close_boli(p_boli, p_reason)
--   12. store_items.gift_pack
--   13. calendar_layers.owner_label
--   14. surveys.send_at / reminder_after_days / template_key
--   15. app.event_live_stats and app.event_recent_checkins for event staff

-- ---------------------------------------------------------------------------
-- 11. Bolis
-- ---------------------------------------------------------------------------
alter table app.bolis add column hall_display boolean not null default false;
alter table app.bolis add column closed_reason text;
comment on column app.bolis.hall_display is 'Show this boli on the hall screen (projector view) while it is open.';

-- Same winner rule as before (highest amount, first recorded wins ties; the
-- winner becomes a pledge). The optional reason is stored and audited.
drop function app.close_boli(uuid);
create function app.close_boli(p_boli uuid, p_reason text default null) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare b app.bolis; w app.boli_entries; v_pledge uuid;
begin
  select * into b from app.bolis where id = p_boli for update;
  if b.id is null then raise exception 'boli not found'; end if;
  if not app.has_permission(b.center_id, 'bolis.manage') then raise exception 'not allowed'; end if;
  if b.status in ('closed','settled') then raise exception 'this boli is already closed'; end if;
  select * into w from app.boli_entries where boli_id = p_boli order by amount_cents desc, entered_at asc limit 1;
  if w.id is not null then
    insert into app.pledges (center_id, household_id, pledged_by_person_id, campaign_id, source, source_ref_id, amount_cents, anonymous, created_by)
      values (b.center_id, w.household_id, w.person_id, b.campaign_id, 'boli', b.id, w.amount_cents, w.anonymous, auth.uid())
      returning id into v_pledge;
    update app.boli_entries set pledge_id = v_pledge where id = w.id;
  end if;
  update app.bolis set status = 'closed', winner_entry_id = w.id, winner_pledge_id = v_pledge,
         closed_reason = nullif(trim(p_reason), '')
   where id = p_boli;
  perform app.log_audit(b.center_id, 'boli.close', 'bolis', p_boli::text, null,
                        jsonb_build_object('winner_entry_id', w.id, 'winner_pledge_id', v_pledge), nullif(trim(p_reason), ''));
  return v_pledge;
end $$;
grant execute on function app.close_boli(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 12–14. Store, calendar, surveys
-- ---------------------------------------------------------------------------
alter table app.store_items add column gift_pack boolean not null default true;
comment on column app.store_items.gift_pack is 'Can be gift-packed at checkout (store rule gift_pack_cents).';

alter table app.calendar_layers add column owner_label text;
comment on column app.calendar_layers.owner_label is 'Who maintains this layer, shown in the calendar legend (e.g. "Religious coordinator").';

-- (surveys.event_id and surveys.kind exist since 0016.)
alter table app.surveys add column send_at timestamptz;
alter table app.surveys add column reminder_after_days integer check (reminder_after_days > 0);
alter table app.surveys add column template_key text;

-- ---------------------------------------------------------------------------
-- 15. Live event stats (event lead, check-in volunteers, kitchen lead, events staff)
-- ---------------------------------------------------------------------------
create or replace function app.can_see_event_ops(p_center uuid, p_event uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.has_scoped_role(p_center, p_event, 'event_lead', 'checkin_volunteer', 'kitchen_lead')
      or app.has_permission(p_center, 'events.view') or app.has_permission(p_center, 'events.manage')
$$;

-- People counts (attendees, not households):
--   checked_in  = checked in at entry
--   confirmed   = on an RSVP the household confirmed (or already attended)
--   rsvp_people = on any RSVP that is not cancelled or waitlisted (walk-ins excluded)
--   walk_ins    = on a walk-in RSVP
--   waitlist    = on a waitlisted RSVP
--   median_checkin_seconds = median gap between consecutive successful entry
--                            scans by the same volunteer (gaps over 10 min ignored)
create or replace function app.event_live_stats(p_event uuid)
returns table (checked_in int, confirmed int, rsvp_people int, walk_ins int, waitlist int, median_checkin_seconds int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare e app.events;
begin
  select * into e from app.events where id = p_event;
  if e.id is null or not app.can_see_event_ops(e.center_id, e.id) then raise exception 'not allowed to see this event''s live numbers'; end if;
  return query
  select
    (select count(*)::int from app.attendees a where a.event_id = p_event and a.checked_in_at is not null),
    (select count(*)::int from app.attendees a join app.rsvps r on r.id = a.rsvp_id
      where a.event_id = p_event and a.status <> 'cancelled' and (r.confirmed_at is not null or r.status in ('confirmed','attended'))),
    (select count(*)::int from app.attendees a join app.rsvps r on r.id = a.rsvp_id
      where a.event_id = p_event and a.status <> 'cancelled' and r.status not in ('cancelled','waitlisted') and r.source <> 'walk_in'),
    (select count(*)::int from app.attendees a join app.rsvps r on r.id = a.rsvp_id
      where a.event_id = p_event and a.status <> 'cancelled' and r.source = 'walk_in'),
    (select count(*)::int from app.attendees a join app.rsvps r on r.id = a.rsvp_id
      where a.event_id = p_event and r.status = 'waitlisted'),
    (select round(percentile_cont(0.5) within group (order by g.gap))::int from (
       select extract(epoch from (sl.scanned_at - lag(sl.scanned_at) over (partition by sl.scanned_by order by sl.scanned_at))) as gap
         from app.scan_log sl where sl.event_id = p_event and sl.station = 'entry' and sl.result = 'ok') g
      where g.gap is not null and g.gap <= 600);
end $$;

-- The latest families checked in: time, household (name, or the guest's name),
-- and their lunch time. Newest first; at most 100.
create or replace function app.event_recent_checkins(p_event uuid, p_limit integer default 10)
returns table (checked_in_at timestamptz, household_label text, lunch_slot_label text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare e app.events; v_tz text;
begin
  select * into e from app.events where id = p_event;
  if e.id is null or not app.can_see_event_ops(e.center_id, e.id) then raise exception 'not allowed to see this event''s check-ins'; end if;
  select time_zone into v_tz from app.centers where id = e.center_id;
  return query
  select max(a.checked_in_at),
         coalesce(h.display_name, r.guest_name, 'Guest'),
         to_char(min(ls.starts_at) at time zone v_tz, 'FMHH12:MI AM')
    from app.attendees a
    join app.rsvps r on r.id = a.rsvp_id
    left join app.households h on h.id = r.household_id
    left join app.lunch_slots ls on ls.id = a.lunch_slot_id
   where a.event_id = p_event and a.checked_in_at is not null
   group by r.id, h.display_name, r.guest_name
   order by 1 desc
   limit least(greatest(coalesce(p_limit, 10), 1), 100);
end $$;

revoke execute on function app.can_see_event_ops(uuid, uuid) from public, anon;
revoke execute on function app.event_live_stats(uuid), app.event_recent_checkins(uuid, integer) from public, anon;
grant execute on function app.can_see_event_ops(uuid, uuid), app.event_live_stats(uuid), app.event_recent_checkins(uuid, integer) to authenticated;
grant execute on all functions in schema app to service_role;
