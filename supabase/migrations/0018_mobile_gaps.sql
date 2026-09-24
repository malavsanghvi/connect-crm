-- 0018_mobile_gaps.sql
-- Gaps reported by the connect-mobile build. Additive only (new functions and
-- columns) so the shipped app keeps working while it adopts them.

-- 1. Atomic RSVP: household + attendees + optional commitment pledge in one call.
--    p_attendees: [{"person_id": uuid|null, "name": text, "child_under_12": bool,
--                   "senior": bool, "assistance": bool, "assistance_note": text}]
create or replace function app.submit_rsvp(p_event uuid, p_household uuid, p_attendees jsonb,
                                           p_commitment_cents bigint default null, p_commitment_mode text default 'none')
returns uuid language plpgsql security definer set search_path = app, public as $$
declare e app.events; v_rsvp uuid; v_pledge uuid; a jsonb; v_count int;
begin
  select * into e from app.events where id = p_event;
  if e.id is null or e.status not in ('published','live') then raise exception 'this event is not open for RSVPs'; end if;
  if not app.adult_of_household(e.center_id, p_household) then raise exception 'only an adult of the household can RSVP'; end if;
  if e.rsvp_opens_at is not null and now() < e.rsvp_opens_at then raise exception 'RSVPs for this event have not opened yet'; end if;
  if e.rsvp_closes_at is not null and now() > e.rsvp_closes_at then raise exception 'RSVPs for this event have closed'; end if;
  v_count := jsonb_array_length(coalesce(p_attendees, '[]'::jsonb));
  if v_count = 0 then raise exception 'choose who is coming'; end if;
  -- Eligibility (docs: life members only, Pathshala families)
  if e.audience = 'life_members_only' and not exists (
       select 1 from app.memberships m where m.household_id = p_household and m.tier = 'life' and m.status = 'active') then
    raise exception 'this event is for life members';
  end if;
  if e.audience = 'pathshala_families' and not exists (
       select 1 from app.pathshala_enrollments pe where pe.household_id = p_household and pe.status in ('placed','active')) then
    raise exception 'this event is for Pathshala families';
  end if;
  if e.audience = 'members_only' and not exists (
       select 1 from app.memberships m where m.household_id = p_household and m.tier in ('yearly','life') and m.status = 'active') then
    raise exception 'this event is for members';
  end if;
  if exists (select 1 from app.rsvps where event_id = p_event and household_id = p_household and status <> 'cancelled') then
    raise exception 'your household already has an RSVP for this event — change it instead';
  end if;
  insert into app.rsvps (center_id, event_id, household_id, submitted_by_person_id, commitment_mode,
                         status)
    values (e.center_id, p_event, p_household, app.my_person_id(e.center_id), coalesce(p_commitment_mode, 'none'),
            (case when e.capacity is not null and e.waitlist_enabled
                      and (select count(*) from app.attendees x join app.rsvps r on r.id = x.rsvp_id
                            where r.event_id = p_event and r.status not in ('cancelled','waitlisted')) + v_count > e.capacity
                 then 'waitlisted' else 'rsvpd' end)::app.rsvp_status)
    returning id into v_rsvp;
  if e.capacity is not null and not e.waitlist_enabled
     and (select count(*) from app.attendees x join app.rsvps r on r.id = x.rsvp_id
           where r.event_id = p_event and r.status not in ('cancelled','waitlisted')) + v_count > e.capacity then
    raise exception 'this event is full';
  end if;
  for a in select * from jsonb_array_elements(p_attendees) loop
    if (a->>'person_id') is not null and not app.same_household_person(e.center_id, (a->>'person_id')::uuid) then
      raise exception 'you can only RSVP for your own household (and named guests)';
    end if;
    insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, is_child_under_12, is_senior, needs_assistance, assistance_note)
      values (e.center_id, p_event, v_rsvp, nullif(a->>'person_id', '')::uuid, coalesce(a->>'name', 'Guest'),
              coalesce((a->>'child_under_12')::boolean, false), coalesce((a->>'senior')::boolean, false),
              coalesce((a->>'assistance')::boolean, false), a->>'assistance_note');
  end loop;
  if coalesce(p_commitment_cents, 0) > 0 then
    insert into app.pledges (center_id, household_id, pledged_by_person_id, source, source_ref_id, amount_cents, created_by,
                             campaign_id)
      values (e.center_id, p_household, app.my_person_id(e.center_id), 'rsvp_commitment', v_rsvp, p_commitment_cents, auth.uid(),
              (select o.campaign_id from app.opportunities o where o.event_id = p_event order by o.sort_order limit 1))
      returning id into v_pledge;
    update app.rsvps set commitment_pledge_id = v_pledge where id = v_rsvp;
  end if;
  return v_rsvp;
end $$;
grant execute on function app.submit_rsvp(uuid, uuid, jsonb, bigint, text) to authenticated;

-- 2. Cancel an RSVP: releases seats and cancels an UNPAID commitment pledge.
create or replace function app.cancel_rsvp(p_rsvp uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare r app.rsvps;
begin
  select * into r from app.rsvps where id = p_rsvp for update;
  if r.id is null then raise exception 'RSVP not found'; end if;
  if not app.adult_of_household(r.center_id, r.household_id) then raise exception 'only an adult of the household can cancel'; end if;
  update app.rsvps set status = 'cancelled', cancelled_at = now() where id = p_rsvp;
  update app.attendees set status = 'cancelled' where rsvp_id = p_rsvp and checked_in_at is null;
  update app.pledges set status = 'cancelled', closed_at = now()
   where id = r.commitment_pledge_id and paid_cents = 0 and status = 'open';
end $$;
grant execute on function app.cancel_rsvp(uuid) to authenticated;

-- 3. Opportunity slots follow pledges (e.g. 2 of 8 pujans taken).
create or replace function app.sync_opportunity_taken() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare v_opp uuid := coalesce(new.opportunity_id, old.opportunity_id);
begin
  if v_opp is not null then
    update app.opportunities o set
      quantity_taken = (select count(*) from app.pledges p where p.opportunity_id = o.id and p.status not in ('cancelled','written_off')),
      status = case when o.quantity_available is not null
                     and (select count(*) from app.pledges p where p.opportunity_id = o.id and p.status not in ('cancelled','written_off')) >= o.quantity_available
                    then 'taken' when o.status = 'taken' then 'open' else o.status end
    where o.id = v_opp;
  end if;
  return coalesce(new, old);
end $$;
create trigger pledges_opportunity_taken after insert or update of status, opportunity_id or delete on app.pledges
  for each row execute function app.sync_opportunity_taken();

create or replace function app.check_opportunity_available() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.opportunity_id is not null and exists (
       select 1 from app.opportunities o where o.id = new.opportunity_id
         and (o.status in ('taken','closed','draft')
              or (o.quantity_available is not null and o.quantity_taken >= o.quantity_available))) then
    raise exception 'this opportunity is already taken' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger pledges_opportunity_available before insert on app.pledges
  for each row execute function app.check_opportunity_available();

-- 4. Survey audience enforced: members see open surveys addressed to them.
--    audience keys: all_members | zone_ids[] | pathshala_class_ids[] | event_id (+ rsvp_statuses[])
create or replace function app.in_survey_audience(p_center uuid, p_audience jsonb, p_event uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select coalesce((p_audience->>'all_members')::boolean, false)
      or (p_audience ? 'zone_ids' and exists (
            select 1 from app.households h where h.id in (select app.my_household_ids(p_center))
              and h.zone_id::text in (select jsonb_array_elements_text(p_audience->'zone_ids'))))
      or (p_audience ? 'pathshala_class_ids' and exists (
            select 1 from app.pathshala_enrollments e where e.household_id in (select app.my_household_ids(p_center))
              and e.class_id::text in (select jsonb_array_elements_text(p_audience->'pathshala_class_ids'))))
      or (coalesce(p_event::text, p_audience->>'event_id') is not null and exists (
            select 1 from app.rsvps r where r.event_id = coalesce(p_event, (p_audience->>'event_id')::uuid)
              and r.household_id in (select app.my_household_ids(p_center))
              and (not p_audience ? 'rsvp_statuses' or r.status::text in (select jsonb_array_elements_text(p_audience->'rsvp_statuses')))))
$$;
drop policy surveys_member_read on app.surveys;
create policy surveys_member_read on app.surveys for select to authenticated
  using (app.is_member_of(center_id) and status = 'open' and app.in_survey_audience(center_id, audience, event_id));
drop policy survey_responses_insert on app.survey_responses;
create policy survey_responses_insert on app.survey_responses for insert to authenticated
  with check (app.is_member_of(center_id) and (person_id is null or person_id = app.my_person_id(center_id))
              and exists (select 1 from app.surveys s where s.id = survey_id and s.status = 'open'
                            and app.in_survey_audience(s.center_id, s.audience, s.event_id)));

-- 5. Household change requests (add a member, change a relationship, move out),
--    reviewed by the membership coordinator — members never edit the family tree directly.
create table app.household_change_requests (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  household_id  uuid not null references app.households(id) on delete cascade,
  requested_by  uuid not null references auth.users(id),
  kind          text not null check (kind in ('add_member','change_relationship','remove_member','new_household')),
  details       jsonb not null,             -- {first_name, last_name, dob, relationship, person_id, ...}
  status        text not null default 'open' check (status in ('open','approved','rejected')),
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz,
  reason        text,
  created_at    timestamptz not null default now()
);
create index on app.household_change_requests (center_id, status);
alter table app.household_change_requests enable row level security;
create policy hcr_household on app.household_change_requests for select to authenticated
  using (app.in_my_household(center_id, household_id));
create policy hcr_request on app.household_change_requests for insert to authenticated
  with check (app.adult_of_household(center_id, household_id) and requested_by = auth.uid() and status = 'open');
create policy hcr_staff_read on app.household_change_requests for select to authenticated
  using (app.has_permission(center_id, 'people.view') or app.has_permission(center_id, 'people.manage'));
create policy hcr_staff_write on app.household_change_requests for update to authenticated
  using (app.has_permission(center_id, 'people.manage')) with check (app.has_permission(center_id, 'people.manage'));
create trigger audit_household_change_requests after insert or update on app.household_change_requests
  for each row execute function app.audit_row();

-- 6. Profile fields from onboarding that had no home.
alter table app.people add column interests text[] not null default '{}';
alter table app.people add column best_call_time text check (best_call_time in ('morning','afternoon','evening'));
alter table app.people add column contact_channels text[] not null default '{}';   -- phone_call, sms, whatsapp, email
create table app.person_emails (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references app.centers(id) on delete cascade,
  person_id  uuid not null references app.people(id) on delete cascade,
  email      citext not null,
  label      text not null default 'other' check (label in ('primary','work','other')),
  verified   boolean not null default false,
  created_at timestamptz not null default now(),
  unique (person_id, email)
);
alter table app.person_emails enable row level security;
create policy person_emails_own on app.person_emails for all to authenticated
  using (app.can_act_for_person(center_id, person_id)) with check (app.can_act_for_person(center_id, person_id));
create policy person_emails_staff on app.person_emails for select to authenticated
  using (app.has_permission(center_id, 'people.view'));
-- Paper-or-digital must be an explicit choice: null = not chosen yet.
alter table app.households alter column physical_mail_opt_in drop not null;
alter table app.households alter column physical_mail_opt_in set default null;

-- 7. Completing a Gyan Path step awards the step's share of points once (level
--    points on teacher sign-off stay separate, see 0017).
alter table app.gyan_steps add column points integer not null default 0;
create or replace function app.award_step_points() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare v_pts int;
begin
  if new.completed_at is not null and (tg_op = 'INSERT' or old.completed_at is null) then
    select points into v_pts from app.gyan_steps where id = new.step_id;
    if coalesce(v_pts, 0) > 0 and not exists (select 1 from app.points_ledger where person_id = new.person_id and reason = 'level' and ref_id = new.step_id) then
      insert into app.points_ledger (center_id, person_id, points, reason, ref_id, note) values (new.center_id, new.person_id, v_pts, 'level', new.step_id, 'Gyan Path step');
    end if;
  end if;
  return new;
end $$;
create trigger gyan_progress_points after insert or update of completed_at on app.gyan_progress
  for each row execute function app.award_step_points();

revoke execute on function app.sync_opportunity_taken(), app.check_opportunity_available(), app.award_step_points() from public, anon, authenticated;
grant execute on function app.in_survey_audience(uuid, jsonb, uuid) to authenticated;
grant execute on all functions in schema app to service_role;
grant select, insert, update, delete on app.household_change_requests, app.person_emails to authenticated;
