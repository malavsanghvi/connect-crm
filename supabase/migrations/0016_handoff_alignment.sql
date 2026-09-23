-- 0016_handoff_alignment.sql
-- Items from the claude.ai handoff kit (docs/handoff/project-memory.md and the
-- admin prototype's mock API) that the schema did not yet enforce:
--   1. Two-person rule (the prototype's 409): refunds, pledge write-offs,
--      voting-eligibility overrides and sends to all members need a second,
--      different authorized person.
--   2. Check-in during the transition: volunteers will scan the family QR codes
--      members already carry (JSH Connect, tied to Neon member IDs), old NamoCRM
--      RSVP tickets (plain "contact_id_<number>"), and new Connect member cards
--      (member number), as well as Connect tickets. All resolve through the
--      identifier registry to the person's household RSVP for the event.

-- ---------------------------------------------------------------------------
-- 1. Two-person rule
-- ---------------------------------------------------------------------------
create or replace function app.enforce_two_person() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'payments' then
    if new.refunded_cents > coalesce(old.refunded_cents, 0) then
      if new.refund_approved_by is null or new.refund_second_approver is null
         or new.refund_approved_by = new.refund_second_approver then
        raise exception 'a refund needs two different approvers' using errcode = 'check_violation';
      end if;
    end if;
  elsif tg_table_name = 'pledges' then
    if new.status = 'written_off' and old.status is distinct from 'written_off' then
      if new.written_off_by is null or new.written_off_second_approver is null
         or new.written_off_by = new.written_off_second_approver then
        raise exception 'a pledge write-off needs two different approvers' using errcode = 'check_violation';
      end if;
    end if;
  elsif tg_table_name = 'eligibility_snapshots' then
    if new.override_can_vote is not null then
      if new.override_by is null or new.override_second_approver is null
         or new.override_by = new.override_second_approver or coalesce(new.override_reason, '') = '' then
        raise exception 'a voting-eligibility override needs a reason and two different approvers' using errcode = 'check_violation';
      end if;
    end if;
  elsif tg_table_name = 'comms_campaigns' then
    if new.status in ('scheduled','sending','sent') and old.status is distinct from new.status
       and (new.requires_second_approver or coalesce((new.audience->>'all_members')::boolean, false)) then
      if new.approved_by is null or new.second_approver is null or new.approved_by = new.second_approver then
        raise exception 'a send to all members needs two different approvers' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger two_person_payments before update on app.payments for each row execute function app.enforce_two_person();
create trigger two_person_pledges before update on app.pledges for each row execute function app.enforce_two_person();
create trigger two_person_eligibility before insert or update on app.eligibility_snapshots for each row execute function app.enforce_two_person();
create trigger two_person_comms before update on app.comms_campaigns for each row execute function app.enforce_two_person();

-- The second approver must be a real, different person with the right permission.
create or replace function app.approve_as_second(p_table text, p_id uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_center uuid; v_perm text;
begin
  v_perm := case p_table when 'payments' then 'giving.approve' when 'pledges' then 'giving.approve'
                         when 'eligibility_snapshots' then 'people.approve' when 'comms_campaigns' then 'comms.approve' end;
  if v_perm is null then raise exception 'unsupported approval target'; end if;
  execute format('select center_id from app.%I where id = $1', p_table) into v_center using p_id;
  if v_center is null or not app.has_permission(v_center, v_perm) then raise exception 'not allowed to approve this'; end if;
  if p_table = 'payments' then
    update app.payments set refund_second_approver = auth.uid() where id = p_id and refund_approved_by is distinct from auth.uid();
  elsif p_table = 'pledges' then
    update app.pledges set written_off_second_approver = auth.uid() where id = p_id and written_off_by is distinct from auth.uid();
  elsif p_table = 'eligibility_snapshots' then
    update app.eligibility_snapshots set override_second_approver = auth.uid() where id = p_id and override_by is distinct from auth.uid();
  else
    update app.comms_campaigns set second_approver = auth.uid() where id = p_id and approved_by is distinct from auth.uid();
  end if;
  if not found then raise exception 'the second approver must be a different person'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Check-in accepts tickets, Connect member cards and legacy QR payloads
-- ---------------------------------------------------------------------------
alter table app.scan_log drop constraint scan_log_result_check;
alter table app.scan_log add constraint scan_log_result_check
  check (result in ('ok','duplicate','invalid','revoked','wrong_event','no_rsvp','ambiguous'));
alter table app.scan_log add column matched_via text;   -- ticket | connect_member | legacy_namocrm | legacy_neon | org_member

-- Resolve a scanned payload to a person (security definer: volunteers have no people.view).
create or replace function app.person_from_scan(p_center uuid, p_payload text, out person_id uuid, out matched_via text, out candidates int)
language plpgsql stable security definer set search_path = app, public as $$
declare v_n text := app.normalize_identifier(p_payload); v_legacy text;
begin
  candidates := 0;
  -- Old NamoCRM RSVP tickets: plain text "contact_id_<number>"
  v_legacy := (regexp_match(p_payload, '^\s*contact_id_(\d+)\s*$', 'i'))[1];
  if v_legacy is not null then
    select count(*), min(e.person_id::text)::uuid into candidates, person_id from app.external_ids e
     where e.center_id = p_center and e.kind = 'crm' and e.system = 'namocrm' and e.person_id is not null
       and e.normalized = app.normalize_identifier(v_legacy) and e.valid_to is null;
    matched_via := 'legacy_namocrm'; return;
  end if;
  -- Connect member card: member number
  select count(*), min(p.id::text)::uuid into candidates, person_id from app.people p
   where p.center_id = p_center and app.normalize_identifier(p.member_number) = v_n;
  if candidates > 0 then matched_via := 'connect_member'; return; end if;
  -- JSH Connect family QR (Neon member IDs) during the transition
  select count(*), min(e.person_id::text)::uuid into candidates, person_id from app.external_ids e
   where e.center_id = p_center and e.kind = 'crm' and e.system = 'neon' and e.person_id is not null
     and e.normalized = v_n and e.valid_to is null;
  if candidates > 0 then matched_via := 'legacy_neon'; return; end if;
  -- Org person ID typed or scanned
  select count(*), min(e.person_id::text)::uuid into candidates, person_id from app.external_ids e
   where e.center_id = p_center and e.kind = 'org_member' and e.valid_to is null
     and e.normalized = app.canonical_org_id(p_center, 'org_member', p_payload);
  if candidates > 0 then matched_via := 'org_member'; return; end if;
  person_id := null; matched_via := null;
end $$;

create or replace function app.check_in(p_event uuid, p_token text, p_station text default 'entry',
                                        p_attendee_ids uuid[] default null, p_device text default null, p_offline boolean default false)
returns table (result text, rsvp_id uuid, household_name text, attendees jsonb)
language plpgsql security definer set search_path = app, public as $$
#variable_conflict use_column
declare e app.events; a app.attendees; v_rsvp uuid; v_result text := 'ok'; v_via text := 'ticket';
        v_person uuid; v_cands int; v_household_name text;
begin
  select * into e from app.events where id = p_event;
  if not (app.has_scoped_role(e.center_id, e.id, 'event_lead', 'checkin_volunteer') or app.has_permission(e.center_id, 'events.manage')) then
    raise exception 'not allowed to check in for this event';
  end if;

  select * into a from app.attendees where ticket_token = p_token;
  if a.id is not null then
    if a.event_id <> p_event then v_result := 'wrong_event';
    elsif a.ticket_revoked then v_result := 'revoked';
    else v_rsvp := a.rsvp_id; end if;
  else
    -- Not a ticket: a member card or legacy QR -> the person's household RSVP for this event.
    select s.person_id, s.matched_via, s.candidates into v_person, v_via, v_cands from app.person_from_scan(e.center_id, p_token) s;
    if v_person is null then v_result := 'invalid'; v_via := null;
    elsif v_cands > 1 then v_result := 'ambiguous';
    else
      select r.id into v_rsvp from app.rsvps r
        join app.household_members hm on hm.household_id = r.household_id and hm.left_at is null
       where r.event_id = p_event and hm.person_id = v_person and r.status <> 'cancelled'
       order by hm.is_primary desc, r.created_at limit 1;
      if v_rsvp is null then
        v_result := 'no_rsvp';
        select h.display_name into v_household_name from app.household_members hm join app.households h on h.id = hm.household_id
         where hm.person_id = v_person and hm.left_at is null order by hm.is_primary desc limit 1;
      end if;
    end if;
  end if;

  if v_result = 'ok' then
    if p_station = 'entry' then
      if p_attendee_ids is null and exists (select 1 from app.attendees x where x.rsvp_id = v_rsvp and x.checked_in_at is not null) then
        v_result := 'duplicate';
      end if;
      update app.attendees set checked_in_at = coalesce(checked_in_at, now()), checked_in_station = p_station,
             checked_in_by = auth.uid(), status = 'attended'
       where rsvp_id = v_rsvp and (p_attendee_ids is null or id = any(p_attendee_ids));
      update app.rsvps set status = 'attended' where id = v_rsvp;
      perform app.assign_lunch_for_rsvp(v_rsvp);
    elsif p_station = 'food' then
      update app.attendees set served_food_at = coalesce(served_food_at, now())
       where rsvp_id = v_rsvp and (p_attendee_ids is null or id = any(p_attendee_ids));
    elsif p_station = 'gifts' then
      update app.attendees set gift_given_at = coalesce(gift_given_at, now())
       where rsvp_id = v_rsvp and (p_attendee_ids is null or id = any(p_attendee_ids));
    end if;
  end if;

  insert into app.scan_log (center_id, event_id, attendee_id, token, station, result, scanned_by, device_id, offline_queued, matched_via)
    values (e.center_id, p_event, a.id, p_token, p_station, v_result, auth.uid(), p_device, p_offline, v_via);

  return query
    select v_result, v_rsvp,
           coalesce((select h.display_name from app.rsvps r join app.households h on h.id = r.household_id where r.id = v_rsvp),
                    (select r.guest_name from app.rsvps r where r.id = v_rsvp), v_household_name),
           coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.display_name, 'checked_in', x.checked_in_at is not null,
                      'senior', x.is_senior, 'child_under_12', x.is_child_under_12, 'assistance', x.needs_assistance,
                      'lunch', (select s.starts_at from app.lunch_slots s where s.id = x.lunch_slot_id)) order by x.display_name)
                     from app.attendees x where x.rsvp_id = v_rsvp), '[]'::jsonb);
end $$;

grant execute on function app.approve_as_second(text, uuid) to authenticated;
revoke execute on function app.enforce_two_person(), app.person_from_scan(uuid, text) from public, anon, authenticated;
grant execute on all functions in schema app to service_role;

-- ---------------------------------------------------------------------------
-- 3. Gaps found while reconciling docs/handoff/project-memory.md line by line
-- ---------------------------------------------------------------------------
-- "Missed slot -> any later slot": a household adult may move their own
-- checked-in attendees to a later lunch slot that still has seats.
create or replace function app.move_lunch_slot(p_attendee_ids uuid[], p_slot uuid) returns integer
language plpgsql security definer set search_path = app, public as $$
declare s app.lunch_slots; v_n int; v_rsvp uuid; v_household uuid; v_current timestamptz;
begin
  select * into s from app.lunch_slots where id = p_slot for update;
  if s.id is null then raise exception 'lunch slot not found'; end if;
  select distinct a.rsvp_id into v_rsvp from app.attendees a where a.id = any(p_attendee_ids) and a.event_id = s.event_id;
  if v_rsvp is null then raise exception 'these people are not on this event'; end if;
  select household_id into v_household from app.rsvps where id = v_rsvp;
  if not (app.adult_of_household(s.center_id, v_household)
          or app.has_scoped_role(s.center_id, s.event_id, 'event_lead', 'checkin_volunteer')) then
    raise exception 'only an adult of the household or an event volunteer can change lunch times';
  end if;
  select min(ls.starts_at) into v_current from app.attendees a join app.lunch_slots ls on ls.id = a.lunch_slot_id
   where a.id = any(p_attendee_ids);
  if v_current is not null and s.starts_at <= v_current then raise exception 'choose a later lunch time'; end if;
  if s.starts_at < now() - make_interval(mins => 5) then raise exception 'that lunch time has passed'; end if;
  v_n := coalesce(array_length(p_attendee_ids, 1), 0);
  if s.seats - (select count(*) from app.attendees x where x.lunch_slot_id = s.id) < v_n then
    raise exception 'that lunch time is full';
  end if;
  update app.attendees set lunch_slot_id = s.id where id = any(p_attendee_ids) and checked_in_at is not null;
  get diagnostics v_n = row_count;
  update app.lunch_slots ls set assigned = (select count(*) from app.attendees x where x.lunch_slot_id = ls.id) where ls.event_id = s.event_id;
  update app.messages set scheduled_at = s.starts_at - interval '5 minutes', payload = payload || jsonb_build_object('slot_id', s.id),
         body = 'Lunch in 5 minutes · ' || to_char(s.starts_at at time zone (select time_zone from app.centers where id = s.center_id), 'HH12:MI AM')
   where template_key = 'lunch_reminder' and status = 'queued' and payload->>'event_id' = s.event_id::text
     and person_id in (select person_id from app.attendees where id = any(p_attendee_ids));
  return v_n;
end $$;

-- Event feedback surveys belong to an event (feedback-request notification, per-event aggregation).
alter table app.surveys add column event_id uuid references app.events(id) on delete set null;
alter table app.surveys add column kind text not null default 'general' check (kind in ('general','event_feedback','poll'));
create index on app.surveys (center_id, event_id);

-- Bhandar: two or more counters from different households.
alter table app.counting_sessions add constraint counting_two_counters check (cardinality(counters) >= 2);
create or replace function app.counters_distinct_households() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare v_distinct int;
begin
  -- Each counter's current household (primary membership first); counters
  -- with no household count as their own.
  select count(distinct coalesce(
           (select hm.household_id::text from app.household_members hm
             where hm.person_id = cu.person_id and hm.left_at is null
             order by hm.is_primary desc, hm.joined_at nulls last limit 1),
           u.user_id::text)) into v_distinct
    from unnest(new.counters) u(user_id)
    left join app.center_users cu on cu.user_id = u.user_id and cu.center_id = new.center_id;
  if v_distinct < 2 then
    raise exception 'counting needs at least two counters from different households' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger counting_distinct_households before insert or update of counters on app.counting_sessions
  for each row execute function app.counters_distinct_households();

grant execute on function app.move_lunch_slot(uuid[], uuid) to authenticated;
revoke execute on function app.counters_distinct_households() from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
