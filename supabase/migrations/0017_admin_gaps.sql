-- 0017_admin_gaps.sql
-- Fixes for gaps the connect-admin build hit against the schema.

-- 1. Single-instance scopes are center-wide: a principal granted with scope
--    'pathshala' or a store lead with scope 'store' gets their permissions;
--    the platform owner's '*' means every permission.
create or replace function app.has_permission(p_center uuid, p_perm text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_platform_admin()
      or exists (
        select 1 from app.role_grants g
        join app.roles r on r.key = g.role_key
        where g.center_id = p_center and g.user_id = auth.uid()
          and g.scope_kind in ('center','platform','pathshala','store')
          and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
          and (r.permissions ? p_perm or r.permissions ? '*'))
$$;

-- 2. create_event_from_template re-checks rights; start date optional
--    (undated events when a Pathshala year is created).
create or replace function app.create_event_from_template(p_template uuid, p_name text, p_starts_at timestamptz default null, p_program_year text default null)
returns uuid language plpgsql security definer set search_path = app, public as $$
declare v_event uuid; v_center uuid; t record;
begin
  select center_id into v_center from app.event_templates where id = p_template;
  if v_center is null then raise exception 'template not found'; end if;
  -- auth.uid() is null only for service-role workers.
  if auth.uid() is not null and not app.has_permission(v_center, 'events.manage') then raise exception 'not allowed to create events'; end if;
  insert into app.events (center_id, template_id, name, description, starts_at, program_year, owner_person_id, confidential, created_by)
  select center_id, id, p_name, description, p_starts_at, p_program_year, default_owner_person_id, confidential, auth.uid()
  from app.event_templates where id = p_template returning id into v_event;
  for t in select * from app.event_template_items where template_id = p_template order by phase, sort_order loop
    insert into app.actions (center_id, event_id, phase, template_item_id, name, description, priority, action_type, confidential, due_on, created_by)
    values (v_center, v_event, t.phase, t.id, t.name, t.description, t.priority, t.action_type, t.confidential,
            case when t.offset_days is not null and p_starts_at is not null then (p_starts_at::date + t.offset_days) end, auth.uid());
  end loop;
  return v_event;
end $$;

-- 3. ensure_lunch_slots is callable by the event's staff (re-checked inside).
create or replace function app.ensure_lunch_slots(p_event uuid) returns integer
language plpgsql security definer set search_path = app, public as $$
declare e app.events; n int := 0; t timestamptz;
begin
  select * into e from app.events where id = p_event;
  if e.id is null then raise exception 'event not found'; end if;
  if auth.uid() is not null and not (app.has_permission(e.center_id, 'events.manage')
       or app.has_scoped_role(e.center_id, e.id, 'event_lead', 'checkin_volunteer', 'kitchen_lead')) then
    raise exception 'not allowed to set up lunch for this event';
  end if;
  if not e.lunch_enabled or e.lunch_starts_at is null then return 0; end if;
  if exists (select 1 from app.lunch_slots where event_id = p_event) then return 0; end if;
  t := e.lunch_starts_at;
  while t < coalesce(e.ends_at, e.lunch_starts_at + interval '2 hours') loop
    insert into app.lunch_slots (center_id, event_id, starts_at, ends_at, seats)
      values (e.center_id, p_event, t, t + make_interval(mins => e.lunch_slot_minutes), coalesce(e.lunch_seats_per_slot, 1000000));
    t := t + make_interval(mins => e.lunch_slot_minutes); n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function app.ensure_lunch_slots(uuid) to authenticated;

-- lunch_slots.served follows attendees.served_food_at.
create or replace function app.sync_lunch_served() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.lunch_slot_id is not null and new.served_food_at is distinct from old.served_food_at then
    update app.lunch_slots s set served = (select count(*) from app.attendees x where x.lunch_slot_id = s.id and x.served_food_at is not null)
     where s.id = new.lunch_slot_id;
  end if;
  return new;
end $$;
create trigger attendees_lunch_served after update of served_food_at on app.attendees
  for each row execute function app.sync_lunch_served();

-- 4. Check-in returns the household id (walk-in from a member card links to it);
--    station 'lookup' only reads (confirm-who-is-here step).
drop function app.check_in(uuid, text, text, uuid[], text, boolean);
create function app.check_in(p_event uuid, p_token text, p_station text default 'entry',
                             p_attendee_ids uuid[] default null, p_device text default null, p_offline boolean default false)
returns table (result text, rsvp_id uuid, household_id uuid, household_name text, attendees jsonb)
language plpgsql security definer set search_path = app, public as $$
#variable_conflict use_column
declare e app.events; a app.attendees; v_rsvp uuid; v_result text := 'ok'; v_via text := 'ticket';
        v_person uuid; v_cands int; v_household uuid;
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
        select hm.household_id into v_household from app.household_members hm
         where hm.person_id = v_person and hm.left_at is null order by hm.is_primary desc limit 1;
      end if;
    end if;
  end if;
  if v_rsvp is not null then select r.household_id into v_household from app.rsvps r where r.id = v_rsvp; end if;

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
    -- 'lookup': read only
  end if;

  if p_station <> 'lookup' then
    insert into app.scan_log (center_id, event_id, attendee_id, token, station, result, scanned_by, device_id, offline_queued, matched_via)
      values (e.center_id, p_event, a.id, p_token, p_station, v_result, auth.uid(), p_device, p_offline, v_via);
  end if;

  return query
    select v_result, v_rsvp, v_household,
           coalesce((select h.display_name from app.households h where h.id = v_household),
                    (select r.guest_name from app.rsvps r where r.id = v_rsvp)),
           coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.display_name, 'checked_in', x.checked_in_at is not null,
                      'senior', x.is_senior, 'child_under_12', x.is_child_under_12, 'assistance', x.needs_assistance,
                      'lunch', (select s.starts_at from app.lunch_slots s where s.id = x.lunch_slot_id)) order by x.display_name)
                     from app.attendees x where x.rsvp_id = v_rsvp), '[]'::jsonb);
end $$;
grant execute on function app.check_in(uuid, text, text, uuid[], text, boolean) to authenticated;

-- Walk-in phone lookup for check-in staff: masked names (the NamoCRM pattern),
-- household id, and whether they already RSVP'd. Never full contact details.
create or replace function app.checkin_lookup_phone(p_event uuid, p_phone text)
returns table (household_id uuid, household_label text, members_masked text, rsvp_id uuid, rsvp_status text)
language plpgsql stable security definer set search_path = app, public as $$
declare e app.events; v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  select * into e from app.events where id = p_event;
  if not (app.has_scoped_role(e.center_id, e.id, 'event_lead', 'checkin_volunteer') or app.has_permission(e.center_id, 'events.manage')) then
    raise exception 'not allowed to look up families for this event';
  end if;
  if length(v_digits) < 10 then raise exception 'enter the full mobile number'; end if;
  return query
    select h.id,
           h.household_number,
           (select string_agg(left(p2.first_name, 1) || repeat('•', greatest(length(p2.first_name) - 1, 1)) || ' '
                              || left(p2.last_name, 1) || '.', ', ' order by hm2.is_primary desc)
              from app.household_members hm2 join app.people p2 on p2.id = hm2.person_id
             where hm2.household_id = h.id and hm2.left_at is null),
           r.id, r.status::text
      from app.people p
      join app.household_members hm on hm.person_id = p.id and hm.left_at is null
      join app.households h on h.id = hm.household_id
      left join app.rsvps r on r.household_id = h.id and r.event_id = p_event and r.status <> 'cancelled'
     where p.center_id = e.center_id and right(regexp_replace(coalesce(p.phone_e164, ''), '[^0-9]', '', 'g'), 10) = right(v_digits, 10)
     group by h.id, h.household_number, r.id, r.status;
end $$;
grant execute on function app.checkin_lookup_phone(uuid, text) to authenticated;

-- 5. Pathshala attendance QR: the class shows connect:pathshala-attendance?session=<id>&token=<t>;
--    a student (or their parent) scans it in the member app.
create or replace function app.redeem_attendance_qr(p_session uuid, p_token text, p_person uuid default null)
returns text language plpgsql security definer set search_path = app, public as $$
declare s app.pathshala_sessions; v_person uuid; v_enrollment uuid; v_status text; c app.pathshala_classes;
begin
  select * into s from app.pathshala_sessions where id = p_session;
  if s.id is null or s.attendance_token is null or s.attendance_token <> p_token then raise exception 'this class code is not valid'; end if;
  if s.token_expires_at is not null and s.token_expires_at < now() then raise exception 'this class code has expired — ask the teacher to show a new one'; end if;
  v_person := coalesce(p_person, app.my_person_id(s.center_id));
  if v_person is null or not app.can_act_for_person(s.center_id, v_person) then raise exception 'you can only mark your own attendance or your child''s'; end if;
  select e.id into v_enrollment from app.pathshala_enrollments e
   where e.class_id = s.class_id and e.student_person_id = v_person and e.status in ('placed','active');
  if v_enrollment is null then raise exception 'not enrolled in this class'; end if;
  select * into c from app.pathshala_classes where id = s.class_id;
  v_status := case when c.starts_time is not null
                        and (now() at time zone (select time_zone from app.centers where id = s.center_id))::time > c.starts_time + interval '10 minutes'
                   then 'late' else 'present' end;
  insert into app.pathshala_attendance (center_id, session_id, enrollment_id, status, marked_by, marked_via)
    values (s.center_id, s.id, v_enrollment, v_status, auth.uid(), 'qr')
  on conflict (session_id, enrollment_id) do nothing;
  return v_status;
end $$;
grant execute on function app.redeem_attendance_qr(uuid, text, uuid) to authenticated;

-- 6. Approving a Gyan Path sign-off awards the level's points once.
create or replace function app.award_signoff_points() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id, note)
    select new.center_id, new.person_id, coalesce(l.points, 0), 'level', new.level_id, 'Teacher sign-off: ' || l.name
      from app.gyan_levels l where l.id = new.level_id and coalesce(l.points, 0) > 0
       and not exists (select 1 from app.points_ledger p where p.person_id = new.person_id and p.reason = 'level' and p.ref_id = new.level_id);
  end if;
  return new;
end $$;
create trigger gyan_signoff_points after update of status on app.gyan_signoffs
  for each row execute function app.award_signoff_points();

-- 7. Stock follows inventory movements.
create or replace function app.apply_inventory_movement() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  update app.store_items set stock_on_hand = stock_on_hand + new.delta where id = new.item_id;
  return new;
end $$;
create trigger inventory_apply after insert on app.inventory_movements
  for each row execute function app.apply_inventory_movement();

-- 8. Kitchen and pickup volunteers see every pickup window (not only open ones).
create policy pickup_windows_kitchen on app.pickup_windows for select to authenticated
  using (app.has_permission(center_id, 'kitchen.view') or app.has_permission(center_id, 'store.pickup'));

-- 9. Committee members may log concerns.
create policy concerns_committee_insert on app.concerns for insert to authenticated
  with check (app.has_permission(center_id, 'governance.vote') and status = 'reported');

-- 10. Principal sees the households of enrolled students.
create policy households_pathshala on app.households for select to authenticated
  using (app.has_permission(center_id, 'pathshala.manage') and exists (
    select 1 from app.pathshala_enrollments e where e.household_id = households.id));

-- 11. Names staff need to run operations (action owners, voters, RSVP households,
--     boli recorders' household search): a narrow, permission-gated directory.
create or replace function app.staff_person_names(p_center uuid, p_ids uuid[])
returns table (person_id uuid, name text, household_id uuid, household_name text)
language sql stable security definer set search_path = app, public as $$
  select p.id, coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name, h.id, h.display_name
    from app.people p
    left join app.household_members hm on hm.person_id = p.id and hm.left_at is null and hm.is_primary
    left join app.households h on h.id = hm.household_id
   where p.center_id = p_center and p.id = any(p_ids)
     and app.is_center_staff(p_center)
$$;
grant execute on function app.staff_person_names(uuid, uuid[]) to authenticated;

create or replace function app.staff_household_search(p_center uuid, p_query text)
returns table (household_id uuid, household_name text, household_number text, org_household_id text, members text, city text)
language sql stable security definer set search_path = app, public as $$
  select c.household_id, c.household_name, c.household_number, c.org_household_id, c.members, c.city
    from app.households h
    cross join lateral (
      select h.id as household_id, h.display_name as household_name, h.household_number,
             (select e.value from app.external_ids e where e.household_id = h.id and e.kind = 'org_household' and e.valid_to is null limit 1) as org_household_id,
             (select string_agg(p.first_name, ', ') from app.household_members hm join app.people p on p.id = hm.person_id
               where hm.household_id = h.id and hm.left_at is null) as members,
             h.city) c
   where h.center_id = p_center and h.merged_into_id is null
     and (app.has_permission(p_center, 'bolis.record') or app.has_permission(p_center, 'bolis.manage')
          or app.has_permission(p_center, 'events.manage') or app.has_permission(p_center, 'people.view')
          or exists (select 1 from app.role_grants g where g.center_id = p_center and g.user_id = auth.uid()
                       and g.role_key in ('boli_recorder','event_lead') and (g.ends_at is null or g.ends_at > now())))
     and length(trim(coalesce(p_query, ''))) >= 2
     and (h.display_name ilike '%' || p_query || '%' or h.household_number ilike '%' || p_query || '%'
          or exists (select 1 from app.household_members hm join app.people p on p.id = hm.person_id
                      where hm.household_id = h.id and (p.first_name || ' ' || p.last_name) ilike '%' || p_query || '%')
          or exists (select 1 from app.external_ids e where e.household_id = h.id and e.kind in ('org_household','org_member')
                      and e.normalized = app.canonical_org_id(p_center, e.kind::text, p_query)))
   limit 25
$$;
grant execute on function app.staff_household_search(uuid, text) to authenticated;

revoke execute on function app.sync_lunch_served(), app.award_signoff_points(), app.apply_inventory_movement() from public, anon, authenticated;
grant execute on all functions in schema app to service_role;

-- ===========================================================================
-- Gaps reported by the connect-crm build
-- ===========================================================================

-- 12. Finance volunteers: record + allocate an offline payment in one step.
create or replace function app.record_offline_payment(
  p_household uuid, p_amount_cents bigint, p_method app.payment_method, p_received_on date default current_date,
  p_pledge_ids uuid[] default null, p_check_number text default null, p_envelope_number text default null,
  p_memo text default null, p_payer_person uuid default null, p_receipt_name text default null, p_joint boolean default false)
returns uuid language plpgsql security definer set search_path = app, public as $$
declare v_center uuid; v_payment uuid;
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null then raise exception 'household not found'; end if;
  if not (app.has_permission(v_center, 'giving.record_offline') or app.has_permission(v_center, 'giving.manage')) then
    raise exception 'not allowed to record payments';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'enter an amount greater than zero'; end if;
  if p_method not in ('check','cash','ach','zelle','stock','daf','matching_gift','other') then
    raise exception 'card payments are taken through the payment provider, not recorded by hand';
  end if;
  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, provider, status, check_number,
                            envelope_number, received_on, recorded_by, memo, receipt_name, joint_receipt)
    values (v_center, p_household, p_payer_person, p_amount_cents, p_method, 'offline', 'captured', p_check_number,
            p_envelope_number, p_received_on, auth.uid(), p_memo, p_receipt_name, coalesce(p_joint, false))
    returning id into v_payment;
  perform app.allocate_payment(v_payment, p_pledge_ids, true);
  return v_payment;
end $$;
grant execute on function app.record_offline_payment(uuid, bigint, app.payment_method, date, uuid[], text, text, text, uuid, text, boolean) to authenticated;

-- Allocation preview for staff (read-only).
create or replace function app.preview_allocation(p_household uuid, p_amount_cents bigint, p_pledge_ids uuid[] default null)
returns table (pledge_id uuid, pledge_number text, amount_cents bigint, closes boolean)
language sql stable security definer set search_path = app, public as $$
  with h as (select center_id from app.households where id = p_household
             and (app.has_permission(center_id, 'giving.record_offline') or app.has_permission(center_id, 'giving.view')
                  or app.adult_of_household(center_id, id))),
  open as (
    select p.id, p.pledge_number, p.amount_cents - p.paid_cents as open_cents,
           coalesce(array_position(p_pledge_ids, p.id), 0) as pick, p.pledged_at
      from app.pledges p, h
     where p.household_id = p_household and p.status in ('open','partially_paid')
       and (p_pledge_ids is null or p.id = any(p_pledge_ids))
  ),
  ordered as (
    select *, sum(open_cents) over (order by pick, pledged_at rows between unbounded preceding and current row) as running
      from open
  )
  select id, pledge_number,
         least(open_cents, greatest(0, p_amount_cents - (running - open_cents))),
         p_amount_cents >= running
    from ordered
   where running - open_cents < p_amount_cents
   order by pick, pledged_at
$$;
grant execute on function app.preview_allocation(uuid, bigint, uuid[]) to authenticated;

-- Finance volunteers find households (card-level details only).
create or replace function app.staff_household_search(p_center uuid, p_query text)
returns table (household_id uuid, household_name text, household_number text, org_household_id text, members text, city text)
language sql stable security definer set search_path = app, public as $$
  select c.household_id, c.household_name, c.household_number, c.org_household_id, c.members, c.city
    from app.households h
    cross join lateral (
      select h.id as household_id, h.display_name as household_name, h.household_number,
             (select e.value from app.external_ids e where e.household_id = h.id and e.kind = 'org_household' and e.valid_to is null limit 1) as org_household_id,
             (select string_agg(p.first_name, ', ') from app.household_members hm join app.people p on p.id = hm.person_id
               where hm.household_id = h.id and hm.left_at is null) as members,
             h.city) c
   where h.center_id = p_center and h.merged_into_id is null
     and (app.has_permission(p_center, 'bolis.record') or app.has_permission(p_center, 'bolis.manage')
          or app.has_permission(p_center, 'events.manage') or app.has_permission(p_center, 'people.view')
          or app.has_permission(p_center, 'giving.record_offline') or app.has_permission(p_center, 'giving.view')
          or exists (select 1 from app.role_grants g where g.center_id = p_center and g.user_id = auth.uid()
                       and g.role_key in ('boli_recorder','event_lead') and (g.ends_at is null or g.ends_at > now())))
     and length(trim(coalesce(p_query, ''))) >= 2
     and (h.display_name ilike '%' || p_query || '%' or h.household_number ilike '%' || p_query || '%'
          or exists (select 1 from app.household_members hm join app.people p on p.id = hm.person_id
                      where hm.household_id = h.id and (p.first_name || ' ' || p.last_name) ilike '%' || p_query || '%')
          or exists (select 1 from app.external_ids e where e.household_id = h.id and e.kind in ('org_household','org_member')
                      and e.normalized = app.canonical_org_id(p_center, e.kind::text, p_query)))
   limit 25
$$;

-- 13. Life membership needs an Executive Committee decision by a different person.
create or replace function app.enforce_membership_approval() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if new.center_decided_by is null then raise exception 'the membership coordinator must review first' using errcode = 'check_violation'; end if;
    if new.tier = 'life' or exists (select 1 from app.membership_types t where t.id = new.membership_type_id and t.ec_approval_required) then
      if new.ec_decided_by is null or new.ec_decided_by = new.center_decided_by then
        raise exception 'life membership needs an Executive Committee approval by a different person' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from app.role_grants g where g.center_id = new.center_id and g.user_id = new.ec_decided_by
                       and g.role_key = 'executive_committee' and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())) then
        raise exception 'the EC approver must hold the Executive Committee role' using errcode = 'check_violation';
      end if;
    end if;
    if new.reference_decision is distinct from 'approved'
       and coalesce((select mt.reference_required from app.membership_types mt where mt.id = new.membership_type_id), true) then
      raise exception 'the named reference has not approved this application' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger membership_applications_approval before update on app.membership_applications
  for each row execute function app.enforce_membership_approval();

-- 14. Role grants: nobody grants roles to themselves; platform roles only by
--     the platform team; finance and admin roles need two people.
alter table app.role_grants add column second_approver uuid references auth.users(id);
alter table app.role_grants add column status text not null default 'active' check (status in ('pending','active','revoked'));
create or replace function app.enforce_role_grant() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare v_tier text;
begin
  if auth.uid() is null or app.is_platform_admin() then return new; end if;   -- service role / platform team
  select tier into v_tier from app.roles where key = new.role_key;
  if v_tier = 'platform' then raise exception 'platform roles are granted by the platform team only' using errcode = 'check_violation'; end if;
  if tg_op = 'INSERT' then
    if new.user_id = auth.uid() then raise exception 'you cannot grant a role to yourself' using errcode = 'check_violation'; end if;
    new.granted_by := auth.uid();
    if new.role_key in ('center_admin','treasurer','finance_volunteer','executive_committee','privacy_officer') then
      new.status := 'pending';           -- activates when a second person approves
      new.starts_at := 'infinity';
    end if;
  end if;
  return new;
end $$;
create trigger role_grants_rules before insert on app.role_grants for each row execute function app.enforce_role_grant();

create or replace function app.approve_role_grant(p_grant uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare g app.role_grants;
begin
  select * into g from app.role_grants where id = p_grant for update;
  if g.id is null or g.status <> 'pending' then raise exception 'no pending grant to approve'; end if;
  if not app.has_permission(g.center_id, 'roles.manage') then raise exception 'not allowed to approve role grants'; end if;
  if g.granted_by = auth.uid() or g.user_id = auth.uid() then raise exception 'a second, different person must approve this grant'; end if;
  update app.role_grants set status = 'active', second_approver = auth.uid(), starts_at = now() where id = p_grant;
end $$;
grant execute on function app.approve_role_grant(uuid) to authenticated;

-- 15. Bank imports: update policy for counts; audit status changes; identical
--     lines within one statement stay distinct (occurrence number).
create policy bank_imports_update on app.bank_statement_imports for update to authenticated
  using (imported_by = auth.uid()) with check (imported_by = auth.uid());
create trigger audit_bank_transactions after update on app.bank_transactions
  for each row execute function app.audit_row();
alter table app.bank_transactions add column occurrence integer not null default 1;

create or replace function app.bank_transactions_fingerprint() returns trigger
language plpgsql as $$
begin
  if new.fingerprint is null or new.fingerprint = '' then
    new.fingerprint := encode(digest(new.bank_account_id::text || '|' || new.posted_on || '|' || new.amount_cents || '|' ||
                              coalesce(new.reference, '') || '|' || coalesce(new.check_or_slip, '') || '|' ||
                              coalesce(app.normalize_identifier(new.description), '') || '|' || new.occurrence, 'sha256'), 'hex');
  end if;
  return new;
end $$;
-- runs after the prepare trigger (triggers fire in name order)
create trigger bank_transactions_z_fingerprint before insert on app.bank_transactions
  for each row execute function app.bank_transactions_fingerprint();
-- prepare no longer sets the fingerprint itself
create or replace function app.bank_transactions_prepare() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare p record; v_rules jsonb; o record;
begin
  select parse_rules into v_rules from app.bank_accounts where id = new.bank_account_id;
  select * into p from app.parse_bank_description(new.description, v_rules, new.bank_type);
  new.channel := coalesce(new.channel, p.channel);
  new.payer_name := coalesce(new.payer_name, p.payer_name);
  new.reference := coalesce(new.reference, p.reference, nullif(new.check_or_slip, ''));
  new.is_batch_deposit := new.is_batch_deposit or coalesce(p.is_batch, false);
  new.payer_normalized := app.normalize_identifier(new.payer_name);
  if new.payer_name is not null or new.channel = 'card_payout' then
    select k.kind, k.label into o from app.known_originators k
     where (k.center_id is null or k.center_id = new.center_id)
       and (coalesce(new.payer_name, '') ~* k.pattern or new.description ~* k.pattern)
     order by k.center_id nulls last limit 1;
    if o.kind is not null then
      new.originator_kind := o.kind;
      if o.kind = 'payment_processor' then new.channel := 'card_payout'; end if;
    end if;
  end if;
  if new.status = 'unmatched' and (new.channel = 'card_payout' or new.originator_kind = 'payment_processor') then
    new.status := 'payout';
  end if;
  return new;
end $$;
alter table app.bank_transactions alter column fingerprint set default '';
alter table app.external_ids alter column normalized set default '';
alter table app.store_orders alter column order_number set default '';
create or replace function app.assign_numbers() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if tg_table_name = 'people' then
    if coalesce(new.member_number, '') = '' then new.member_number := app.next_number(new.center_id, 'member'); end if;
  elsif tg_table_name = 'households' then
    if coalesce(new.household_number, '') = '' then new.household_number := app.next_number(new.center_id, 'household'); end if;
  elsif tg_table_name = 'pledges' then
    if coalesce(new.pledge_number, '') = '' then new.pledge_number := app.next_number(new.center_id, 'pledge'); end if;
  elsif tg_table_name = 'store_orders' then
    if coalesce(new.order_number, '') = '' then new.order_number := app.next_number(new.center_id, 'order'); end if;
  elsif tg_table_name = 'payments' then
    if coalesce(new.receipt_number, '') = '' then new.receipt_number := app.next_number(new.center_id, 'receipt'); end if;
  end if;
  return new;
end $$;

-- 16. Refund requests carry the amount; eligibility overrides carry the intended value.
alter table app.payments add column refund_requested_cents bigint check (refund_requested_cents > 0);
alter table app.payments add column refund_reason text;
alter table app.eligibility_snapshots add column override_requested_value boolean;

-- 17. Bank suggestions show the primary member's org ID.
drop function app.suggest_bank_matches(uuid);
create function app.suggest_bank_matches(p_txn uuid)
returns table (household_id uuid, household_name text, household_number text, org_household_id text,
               members text, primary_member text, primary_org_member_id text, zone text, city text, last_gift_on date,
               score numeric, reason text, ambiguous boolean, open_pledge_cents bigint)
language sql stable security definer set search_path = app, public as $$
  with t as (select * from app.bank_transactions where id = p_txn
             and not is_batch_deposit and status <> 'payout'
             and (app.has_permission(center_id, 'giving.record_offline') or app.has_permission(center_id, 'giving.view'))),
  payer as (
    select e.household_id, e.value, count(*) over () as n
      from app.external_ids e, t
     where e.center_id = t.center_id and e.kind = 'bank_payer' and e.normalized = t.payer_normalized
  ),
  byname as (
    select distinct hm.household_id, p.first_name || ' ' || p.last_name as who
      from app.people p join app.household_members hm on hm.person_id = p.id and hm.left_at is null, t
     where p.center_id = t.center_id and t.payer_normalized is not null and p.merged_into_id is null
       and (app.normalize_identifier(p.first_name || ' ' || p.last_name) = t.payer_normalized
         or app.normalize_identifier(p.last_name || ' ' || p.first_name) = t.payer_normalized
         or regexp_replace(t.payer_normalized, ' [A-Z] ', ' ') = app.normalize_identifier(p.first_name || ' ' || p.last_name))
  ),
  byname_n as (select count(distinct household_id) as n from byname),
  cands as (
    select household_id, case when n = 1 then 0.95 else 0.60 end::numeric as score,
           'Known bank payer name "' || value || '"' || case when n > 1 then ' — also used by ' || (n - 1) || ' other household(s)' else '' end as reason,
           n > 1 as ambiguous
      from payer
    union all
    select b.household_id, case when (select n from byname_n) = 1 then 0.70 else 0.45 end,
           'Payer name matches member ' || b.who ||
             case when (select n from byname_n) > 1 then ' — ' || (select n from byname_n) || ' households have a member with this name' else '' end,
           (select n from byname_n) > 1
      from byname b
    union all
    select r.household_id, 0.90, 'Statement mentions ' || r.value, false
      from t, lateral regexp_matches(t.description, '([A-Z]{2,6}-(?:H-)?\d{4,6})', 'g') as x(m),
           lateral app.resolve_identifier(t.center_id, x.m[1]) r
     where r.kind in ('connect_member', 'connect_household')
    union all
    select r.household_id, 0.90, 'Statement mentions member ID ' || r.value, false
      from t, lateral regexp_matches(t.description, '(?:member|mem|mbr)\s*(?:id|no|#)?\s*[:#]?\s*(\d{2,6})\y', 'gi') as x(m),
           lateral app.resolve_identifier(t.center_id, x.m[1]) r
     where r.kind = 'org_member'
    union all
    select r.household_id, 0.90, 'Statement mentions household ID ' || r.value, false
      from t, lateral regexp_matches(t.description, '(?:household|hh|family|fam)\s*(?:id|no|#)?\s*[:#]?\s*(\d{2,6})\y', 'gi') as x(m),
           lateral app.resolve_identifier(t.center_id, x.m[1]) r
     where r.kind = 'org_household'
  ),
  ranked as (
    select c.household_id, max(c.score) as score, string_agg(distinct c.reason, '; ') as reason, bool_and(c.ambiguous) as ambiguous
      from cands c where c.household_id is not null group by c.household_id
  )
  select r.household_id, c.household_name, c.household_number, c.org_household_id, c.members, c.primary_member,
         c.primary_org_member_id, c.zone, c.city, c.last_gift_on,
         least(1, r.score + case when exists (select 1 from app.pledges pl, t where pl.household_id = r.household_id
                                  and pl.status in ('open','partially_paid') and pl.amount_cents - pl.paid_cents = t.amount_cents)
                            then 0.04 else 0 end),
         r.reason || coalesce((select case t.originator_kind when 'daf' then ' · via donor-advised fund'
                                                             when 'matching_gift' then ' · via matching-gift platform' end from t), ''),
         r.ambiguous, c.open_pledge_cents
    from ranked r cross join lateral app.household_card(r.household_id) c
   order by 11 desc, c.household_name
$$;
grant execute on function app.suggest_bank_matches(uuid) to authenticated;

revoke execute on function app.enforce_membership_approval(), app.enforce_role_grant(), app.bank_transactions_fingerprint()
  from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
