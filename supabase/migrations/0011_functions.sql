-- 0011_functions.sql
-- Business rules that must hold no matter which app calls them. Everything
-- here is SECURITY DEFINER and re-checks the caller's rights explicitly,
-- because it runs with RLS bypassed.

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
-- Fields masked in audit before/after images (sensitive class).
create or replace function app.audit_mask(j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null then null else
    j - 'date_of_birth' - 'provider_ref' - 'fee_authorization_ref' - 'secret_ref'
      || case when j ? 'date_of_birth' then jsonb_build_object('date_of_birth', '***') else '{}'::jsonb end
  end
$$;

create or replace function app.log_audit(p_center uuid, p_action text, p_table text, p_record text,
                                         p_before jsonb default null, p_after jsonb default null, p_reason text default null)
returns void language plpgsql security definer set search_path = app, public as $$
begin
  insert into app.audit_log (center_id, actor_user_id, action, record_table, record_id, before, after, reason)
  values (p_center, auth.uid(), p_action, p_table, p_record, app.audit_mask(p_before), app.audit_mask(p_after), p_reason);
end $$;

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare v_center uuid; v_id text; v_before jsonb; v_after jsonb;
begin
  v_before := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_after  := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_center := coalesce((v_after->>'center_id')::uuid, (v_before->>'center_id')::uuid);
  v_id     := coalesce(v_after->>'id', v_before->>'id');
  if tg_op = 'UPDATE' and v_before = v_after then return new; end if;
  insert into app.audit_log (center_id, actor_user_id, action, record_table, record_id, before, after)
  values (v_center, auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, v_id,
          app.audit_mask(v_before), app.audit_mask(v_after));
  return coalesce(new, old);
end $$;

-- Always-audited tables (docs/GOVERNANCE.md "What is always audited").
do $$
declare t text;
begin
  foreach t in array array[
    'households','people','household_members','memberships','membership_applications','eligibility_snapshots',
    'role_grants','pledges','payments','payment_allocations','recurring_gifts','bolis','boli_entries',
    'counting_sessions','valuables_register','store_items','store_orders','ledger_postings','accounting_periods',
    'qbo_account_mappings','integration_connections','content_items','comms_campaigns','legal_documents',
    'background_checks','pathshala_enrollments','gyan_signoffs','data_requests','centers'
  ] loop
    execute format('create trigger audit_%1$s after insert or update or delete on app.%1$I
                    for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Account linking ("Is this your family?")
-- Matches the signed-in user's verified email/phone to people in a center.
-- Returns candidate households; never links automatically when ambiguous.
-- ---------------------------------------------------------------------------
create or replace function app.find_my_family(p_center uuid)
returns table (person_id uuid, household_id uuid, household_name text, tier app.membership_tier, member_names text[])
language plpgsql stable security definer set search_path = app, public as $$
declare v_email text; v_phone text;
begin
  select u.email, u.phone into v_email, v_phone from auth.users u where u.id = auth.uid();
  if v_email is null and v_phone is null then return; end if;
  return query
    select p.id, h.id, h.display_name,
           (select m.tier from app.memberships m where m.household_id = h.id and m.status = 'active' order by m.starts_on desc limit 1),
           array(select p2.first_name || ' ' || p2.last_name from app.household_members hm2
                   join app.people p2 on p2.id = hm2.person_id
                  where hm2.household_id = h.id and hm2.left_at is null order by hm2.is_primary desc, p2.date_of_birth nulls last)
    from app.people p
    join app.household_members hm on hm.person_id = p.id and hm.left_at is null
    join app.households h on h.id = hm.household_id
    where p.center_id = p_center and p.merged_into_id is null
      and ((v_email is not null and p.email = v_email::citext)
        or (v_phone is not null and p.phone_e164 = '+' || ltrim(v_phone, '+')));
end $$;

-- Confirm a match (the person must be one returned by find_my_family).
create or replace function app.link_account(p_center uuid, p_person uuid) returns uuid
language plpgsql security definer set search_path = app, public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from app.find_my_family(p_center) f where f.person_id = p_person) then
    raise exception 'this person does not match your verified email or phone';
  end if;
  if exists (select 1 from app.center_users where center_id = p_center and person_id = p_person and user_id <> auth.uid()) then
    raise exception 'this person is already linked to another login';
  end if;
  insert into app.accounts (user_id) values (auth.uid()) on conflict do nothing;
  insert into app.center_users (center_id, user_id, person_id) values (p_center, auth.uid(), p_person)
    on conflict (center_id, user_id) do update set person_id = excluded.person_id;
  perform app.log_audit(p_center, 'account.link', 'people', p_person::text);
  return p_person;
end $$;

-- "This isn't my family": start a new community-member household.
create or replace function app.create_my_household(p_center uuid, p_first text, p_last text) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare v_person uuid; v_household uuid; v_email text; v_phone text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from app.center_users where center_id = p_center and user_id = auth.uid()) then
    raise exception 'already linked to a household at this center';
  end if;
  select email, phone into v_email, v_phone from auth.users where id = auth.uid();
  insert into app.people (center_id, first_name, last_name, email, phone_e164)
    values (p_center, p_first, p_last, v_email, case when v_phone is not null then '+' || ltrim(v_phone,'+') end)
    returning id into v_person;
  insert into app.households (center_id, display_name) values (p_center, p_last || ' family') returning id into v_household;
  insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (v_household, v_person, p_center, 'primary', true);
  insert into app.accounts (user_id) values (auth.uid()) on conflict do nothing;
  insert into app.center_users (center_id, user_id, person_id) values (p_center, auth.uid(), v_person);
  insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status)
    select p_center, v_household, v_person, mt.id, 'community', 'active'
    from app.membership_types mt where mt.center_id = p_center and mt.tier = 'community' limit 1;
  -- Flag for the membership coordinator's "new household" review queue.
  insert into app.merge_candidates (center_id, kind, left_id, right_id, score, status)
    select p_center, 'person', v_person, p.id, 0.5, 'open'
    from app.people p where p.center_id = p_center and p.id <> v_person
      and lower(p.last_name) = lower(p_last) and lower(p.first_name) = lower(p_first);
  return v_household;
end $$;

-- Directory: opted-in, verified members; name + zone + expertise only.
create or replace view app.directory with (security_barrier = true) as
  select p.center_id, p.id as person_id, coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as name,
         z.name as zone, p.expertise_opt_in, p.expertise_tags, p.expertise_headline, p.new_member_contact_opt_in
  from app.people p
  left join app.household_members hm on hm.person_id = p.id and hm.is_primary and hm.left_at is null
  left join app.households h on h.id = hm.household_id
  left join app.zones z on z.id = h.zone_id
  where p.is_verified and p.merged_into_id is null and not p.is_deceased
    and (h.directory_opt_in or p.expertise_opt_in or p.new_member_contact_opt_in)
    and app.is_member_of(p.center_id);

-- ---------------------------------------------------------------------------
-- Membership references
-- ---------------------------------------------------------------------------
create or replace function app.my_reference_requests()
returns table (application_id uuid, applicant_name text, household_name text, tier app.membership_tier, note text, requested_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = app, public as $$
  select a.id, p.first_name || ' ' || p.last_name, h.display_name, a.tier, a.reference_note, a.reference_requested_at, a.reference_expires_at
  from app.membership_applications a
  join app.people p on p.id = a.applicant_person_id
  join app.households h on h.id = a.household_id
  join app.center_users cu on cu.person_id = a.reference_person_id and cu.center_id = a.center_id
  where cu.user_id = auth.uid() and a.status = 'awaiting_reference'
$$;

create or replace function app.decide_reference(p_application uuid, p_decision text, p_reason text default null) returns void
language plpgsql security definer set search_path = app, public as $$
declare a app.membership_applications;
begin
  select * into a from app.membership_applications where id = p_application for update;
  if a.id is null or a.status <> 'awaiting_reference' then raise exception 'application is not awaiting a reference'; end if;
  if app.my_person_id(a.center_id) is distinct from a.reference_person_id then raise exception 'you are not the named reference'; end if;
  if p_decision not in ('approved','declined','unknown') then raise exception 'invalid decision'; end if;
  update app.membership_applications set
    reference_decision = p_decision, reference_reason = p_reason, reference_decided_at = now(),
    status = case when p_decision = 'approved'
                  then (case when a.tier = 'life' then 'awaiting_center' else 'awaiting_center' end)::app.application_status
                  else 'reference_declined' end
  where id = p_application;
end $$;

-- ---------------------------------------------------------------------------
-- Digital bolis
-- ---------------------------------------------------------------------------
create or replace function app.boli_minimum(p_boli uuid) returns bigint
language sql stable security definer set search_path = app, public as $$
  select case when max(e.amount_cents) is null then b.floor_cents else max(e.amount_cents) + b.step_cents end
  from app.bolis b left join app.boli_entries e on e.boli_id = b.id
  where b.id = p_boli group by b.floor_cents, b.step_cents
$$;

-- Public summary for members (top amount + count, never who).
create or replace function app.boli_summary(p_boli uuid)
returns table (top_cents bigint, entries integer, minimum_cents bigint, closes_at timestamptz, mine_cents bigint)
language sql stable security definer set search_path = app, public as $$
  select max(e.amount_cents), count(e.id)::int, app.boli_minimum(b.id), coalesce(b.extended_until, b.closes_at),
         max(e.amount_cents) filter (where e.household_id in (select app.my_household_ids(b.center_id)))
  from app.bolis b left join app.boli_entries e on e.boli_id = b.id
  where b.id = p_boli and app.is_member_of(b.center_id) and b.status <> 'draft'
  group by b.id
$$;

create or replace function app.place_boli_entry(p_boli uuid, p_household uuid, p_amount_cents bigint, p_anonymous boolean default false)
returns uuid language plpgsql security definer set search_path = app, public as $$
declare b app.bolis; v_min bigint; v_entry uuid; v_close timestamptz;
begin
  select * into b from app.bolis where id = p_boli for update;
  if b.id is null or b.kind <> 'digital' then raise exception 'not a digital boli'; end if;
  if not app.adult_of_household(b.center_id, p_household) then raise exception 'only adults of the household can pledge'; end if;
  v_close := coalesce(b.extended_until, b.closes_at);
  if b.status <> 'open' or (b.opens_at is not null and now() < b.opens_at) or (v_close is not null and now() >= v_close) then
    raise exception 'this boli is not open for pledges';
  end if;
  v_min := app.boli_minimum(p_boli);
  if p_amount_cents < v_min then raise exception 'pledge must be at least %', v_min; end if;
  insert into app.boli_entries (center_id, boli_id, household_id, person_id, amount_cents, entered_by, anonymous)
    values (b.center_id, p_boli, p_household, app.my_person_id(b.center_id), p_amount_cents, auth.uid(), p_anonymous)
    returning id into v_entry;
  -- Anti-sniping: a pledge inside the soft-close window extends the cutoff.
  if b.soft_close_minutes > 0 and v_close is not null and v_close - now() < make_interval(mins => b.soft_close_minutes) then
    update app.bolis set extended_until = now() + make_interval(mins => b.soft_close_minutes) where id = p_boli;
  end if;
  -- Outbid notice to the previous top household (delivered by the notification worker).
  insert into app.messages (center_id, person_id, channel, topic_key, template_key, body, payload)
  select b.center_id, e.person_id, 'push', 'giving', 'boli_outbid', 'Another family pledged more for ' || b.name,
         jsonb_build_object('boli_id', b.id)
  from app.boli_entries e
  where e.boli_id = p_boli and e.id <> v_entry and e.household_id <> p_household
  order by e.amount_cents desc, e.entered_at limit 1;
  return v_entry;
end $$;

-- Close a boli: winner = highest amount, first recorded wins ties; winner becomes a pledge.
create or replace function app.close_boli(p_boli uuid) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare b app.bolis; w app.boli_entries; v_pledge uuid;
begin
  select * into b from app.bolis where id = p_boli for update;
  if not app.has_permission(b.center_id, 'bolis.manage') then raise exception 'not allowed'; end if;
  select * into w from app.boli_entries where boli_id = p_boli order by amount_cents desc, entered_at asc limit 1;
  if w.id is not null then
    insert into app.pledges (center_id, household_id, pledged_by_person_id, campaign_id, source, source_ref_id, amount_cents, anonymous, created_by)
      values (b.center_id, w.household_id, w.person_id, b.campaign_id, 'boli', b.id, w.amount_cents, w.anonymous, auth.uid())
      returning id into v_pledge;
    update app.boli_entries set pledge_id = v_pledge where id = w.id;
  end if;
  update app.bolis set status = 'closed', winner_entry_id = w.id, winner_pledge_id = v_pledge where id = p_boli;
  return v_pledge;
end $$;

-- ---------------------------------------------------------------------------
-- Check-in and lunch slots
-- Rule (decision log): a family with a child under 12 or a senior eats
-- together at lunch start; others by arrival, then RSVP order. Slot
-- calculation lives here, not in any app.
-- ---------------------------------------------------------------------------
create or replace function app.ensure_lunch_slots(p_event uuid) returns integer
language plpgsql security definer set search_path = app, public as $$
declare e app.events; n int := 0; t timestamptz;
begin
  select * into e from app.events where id = p_event;
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

create or replace function app.assign_lunch_for_rsvp(p_rsvp uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare r app.rsvps; e app.events; v_group_first boolean; v_slot uuid; v_need int; a record;
begin
  select * into r from app.rsvps where id = p_rsvp;
  select * into e from app.events where id = r.event_id;
  if not e.lunch_enabled then return; end if;
  perform app.ensure_lunch_slots(e.id);
  v_group_first := coalesce((e.lunch_priority_rules->>'family_with_child_under_12_at_start')::boolean, true)
    and exists (select 1 from app.attendees where rsvp_id = p_rsvp and checked_in_at is not null and is_child_under_12);
  -- Whole family at the first slot if there is a child under 12.
  if v_group_first then
    select id into v_slot from app.lunch_slots where event_id = e.id order by starts_at limit 1;
    update app.attendees set lunch_slot_id = v_slot where rsvp_id = p_rsvp and checked_in_at is not null and lunch_slot_id is null;
  else
    -- Seniors at the first slot.
    if coalesce((e.lunch_priority_rules->>'senior_at_start')::boolean, true) then
      select id into v_slot from app.lunch_slots where event_id = e.id order by starts_at limit 1;
      update app.attendees set lunch_slot_id = v_slot where rsvp_id = p_rsvp and checked_in_at is not null and is_senior and lunch_slot_id is null;
    end if;
    -- Everyone else: earliest slot with room, in arrival order (they arrive now, so the next open slot).
    for a in select id from app.attendees where rsvp_id = p_rsvp and checked_in_at is not null and lunch_slot_id is null loop
      select s.id into v_slot from app.lunch_slots s where s.event_id = e.id
        and s.seats > (select count(*) from app.attendees x where x.lunch_slot_id = s.id)
        order by s.starts_at limit 1;
      update app.attendees set lunch_slot_id = v_slot where id = a.id;
    end loop;
  end if;
  update app.lunch_slots s set assigned = (select count(*) from app.attendees x where x.lunch_slot_id = s.id) where s.event_id = e.id;
  -- 5-minute reminders.
  insert into app.messages (center_id, person_id, channel, topic_key, template_key, body, payload, scheduled_at)
  select e.center_id, at.person_id, 'push', 'events', 'lunch_reminder',
         'Lunch in 5 minutes · ' || to_char(s.starts_at at time zone c.time_zone, 'HH12:MI AM'),
         jsonb_build_object('event_id', e.id, 'slot_id', s.id), s.starts_at - interval '5 minutes'
  from app.attendees at join app.lunch_slots s on s.id = at.lunch_slot_id join app.centers c on c.id = e.center_id
  where at.rsvp_id = p_rsvp and at.person_id is not null
    and not exists (select 1 from app.messages m where m.template_key = 'lunch_reminder' and m.person_id = at.person_id
                      and m.payload->>'event_id' = e.id::text);
end $$;

-- Scan a ticket token (or a member QR resolved to a token by the ops app).
create or replace function app.check_in(p_event uuid, p_token text, p_station text default 'entry',
                                        p_attendee_ids uuid[] default null, p_device text default null, p_offline boolean default false)
returns table (result text, rsvp_id uuid, household_name text, attendees jsonb)
language plpgsql security definer set search_path = app, public as $$
#variable_conflict use_column
declare e app.events; a app.attendees; v_rsvp uuid; v_result text := 'ok';
begin
  select * into e from app.events where id = p_event;
  if not (app.has_scoped_role(e.center_id, e.id, 'event_lead', 'checkin_volunteer') or app.has_permission(e.center_id, 'events.manage')) then
    raise exception 'not allowed to check in for this event';
  end if;
  select * into a from app.attendees where ticket_token = p_token;
  if a.id is null then v_result := 'invalid';
  elsif a.event_id <> p_event then v_result := 'wrong_event';
  elsif a.ticket_revoked then v_result := 'revoked';
  end if;
  if v_result = 'ok' then
    v_rsvp := a.rsvp_id;
    if p_station = 'entry' then
      if exists (select 1 from app.attendees where rsvp_id = v_rsvp and checked_in_at is not null
                   and (p_attendee_ids is null or id = any(p_attendee_ids))) and p_attendee_ids is null then
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
  insert into app.scan_log (center_id, event_id, attendee_id, token, station, result, scanned_by, device_id, offline_queued)
    values (e.center_id, p_event, a.id, p_token, p_station, v_result, auth.uid(), p_device, p_offline);
  return query
    select v_result, v_rsvp,
           coalesce((select h.display_name from app.rsvps r join app.households h on h.id = r.household_id where r.id = v_rsvp),
                    (select r.guest_name from app.rsvps r where r.id = v_rsvp)),
           coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.display_name, 'checked_in', x.checked_in_at is not null,
                      'senior', x.is_senior, 'child_under_12', x.is_child_under_12, 'assistance', x.needs_assistance,
                      'lunch', (select s.starts_at from app.lunch_slots s where s.id = x.lunch_slot_id)) order by x.display_name)
                     from app.attendees x where x.rsvp_id = v_rsvp), '[]'::jsonb);
end $$;

-- Issue signed-looking opaque ticket tokens (rotating member QR is handled in the edge function).
create or replace function app.issue_ticket_tokens() returns trigger
language plpgsql as $$
begin
  if new.ticket_token is null then new.ticket_token := encode(gen_random_bytes(16), 'hex'); end if;
  return new;
end $$;
create trigger attendees_ticket before insert on app.attendees for each row execute function app.issue_ticket_tokens();

-- ---------------------------------------------------------------------------
-- My Jain Way: log a practice, award points once, maintain the streak.
-- ---------------------------------------------------------------------------
create or replace function app.log_practice(p_center uuid, p_practice uuid, p_on date default current_date)
returns table (points_awarded int, day_complete boolean, streak_days int)
language plpgsql security definer set search_path = app, public as $$
declare v_person uuid := app.my_person_id(p_center); v_pts int; v_selected int; v_done int; s app.streaks; v_bonus int := 0;
begin
  if v_person is null then raise exception 'not a member of this center'; end if;
  if p_on > current_date then raise exception 'cannot log a future day'; end if;
  insert into app.practice_logs (center_id, person_id, practice_id, logged_on)
    values (p_center, v_person, p_practice, p_on) on conflict do nothing;
  if not found then
    return query select 0, false, coalesce((select current_days from app.streaks where person_id = v_person and center_id = p_center), 0);
    return;
  end if;
  select points into v_pts from app.practices where id = p_practice;
  insert into app.points_ledger (center_id, person_id, points, reason, ref_id) values (p_center, v_person, v_pts, 'practice', p_practice);
  select count(*) into v_selected from app.practice_selections where person_id = v_person and center_id = p_center;
  select count(*) into v_done from app.practice_logs l join app.practice_selections ps on ps.practice_id = l.practice_id and ps.person_id = l.person_id
   where l.person_id = v_person and l.logged_on = p_on;
  insert into app.streaks (center_id, person_id) values (p_center, v_person) on conflict do nothing;
  select * into s from app.streaks where center_id = p_center and person_id = v_person for update;
  if v_selected > 0 and v_done >= v_selected and s.last_logged_on is distinct from p_on then
    v_bonus := 20;
    insert into app.points_ledger (center_id, person_id, points, reason, note) values (p_center, v_person, v_bonus, 'practice', 'day complete bonus');
    update app.streaks set
      current_days = case when s.last_logged_on = p_on - 1 then s.current_days + 1 else 1 end,
      longest_days = greatest(s.longest_days, case when s.last_logged_on = p_on - 1 then s.current_days + 1 else 1 end),
      last_logged_on = p_on
    where center_id = p_center and person_id = v_person
    returning * into s;
  end if;
  return query select v_pts + v_bonus, v_bonus > 0, s.current_days;
end $$;

-- Anumodana: +5 to the sender, capped per day by center rule (default 5).
create or replace function app.send_anumodana(p_center uuid, p_to uuid, p_kind text default 'celebrate', p_message text default null)
returns int language plpgsql security definer set search_path = app, public as $$
declare v_from uuid := app.my_person_id(p_center); v_cap int; v_today int; v_pts int;
begin
  if not app.same_household_person(p_center, p_to) then raise exception 'Saathi works within your family circle'; end if;
  insert into app.anumodana (center_id, from_person_id, to_person_id, kind, message) values (p_center, v_from, p_to, p_kind, p_message);
  v_cap := coalesce((select (rules->'points'->>'anumodana_daily_cap')::int from app.centers where id = p_center), 5);
  select count(*) into v_today from app.points_ledger where person_id = v_from and reason = 'anumodana_sent' and occurred_at::date = current_date;
  v_pts := case when v_today >= v_cap then 0 when p_kind = 'support' then 3 else 5 end;
  if v_pts > 0 then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id) values (p_center, v_from, v_pts, 'anumodana_sent', p_to);
  end if;
  return v_pts;
end $$;

-- ---------------------------------------------------------------------------
-- Public community dashboard (no sign-in). Aggregates only; groups under
-- 10 are suppressed (k-anonymity rule from the dashboard prototype).
-- ---------------------------------------------------------------------------
create or replace function app.public_kpis(p_slug text, p_from date default date_trunc('year', current_date)::date, p_to date default current_date)
returns jsonb language sql stable security definer set search_path = app, public as $$
  with c as (select id from app.centers where slug = p_slug and status = 'active'),
  k as (
    select
      (select count(distinct m.household_id) from app.memberships m, c where m.center_id = c.id and m.status = 'active' and m.tier <> 'community') as member_families,
      (select count(*) from app.people p, c where p.center_id = c.id and p.merged_into_id is null and not p.is_deceased) as community_people,
      (select count(*) from app.events e, c where e.center_id = c.id and e.status in ('live','completed') and e.starts_at::date between p_from and p_to) as events_held,
      (select count(*) from app.attendees a join app.events e on e.id = a.event_id, c where e.center_id = c.id and a.checked_in_at::date between p_from and p_to)
      + (select count(*) from app.pathshala_attendance pa join app.pathshala_sessions s on s.id = pa.session_id, c
          where pa.center_id = c.id and pa.status in ('present','late') and s.held_on between p_from and p_to) as attendance,
      (select count(*) from app.practice_logs l join app.practices pr on pr.id = l.practice_id, c where l.center_id = c.id and pr.key = 'samayik' and l.logged_on between p_from and p_to) as samayik,
      (select count(*) from app.gyan_progress g, c where g.center_id = c.id and g.completed_at::date between p_from and p_to) as gyan_steps,
      (select count(*) from app.anumodana a, c where a.center_id = c.id and a.created_at::date between p_from and p_to) as anumodana,
      (select count(*) from app.store_orders o, c where o.center_id = c.id and o.status in ('placed','preparing','ready','picked_up') and o.placed_at::date between p_from and p_to) as store_orders
  )
  select jsonb_build_object(
    'center', p_slug, 'from', p_from, 'to', p_to, 'as_of', now(), 'suppressed_below', 10,
    'metrics', (select jsonb_object_agg(key, case when value::bigint < 10 then null else value end)
                from jsonb_each(to_jsonb(k)))
  ) from k
$$;

grant execute on all functions in schema app to authenticated;
grant execute on function app.public_kpis(text, date, date) to anon;
-- Postgres grants EXECUTE to PUBLIC by default; internal helpers must not be callable by clients.
revoke execute on function app.audit_row(), app.audit_immutable(), app.audit_chain(), app.touch_updated_at(),
  app.recompute_pledge_status(uuid), app.on_allocation_change(), app.sync_during_action_due(), app.sync_event_during_dates(),
  app.issue_ticket_tokens(), app.ensure_lunch_slots(uuid), app.assign_lunch_for_rsvp(uuid), app.enqueue_payment_posting(uuid)
  from public, anon, authenticated;
revoke execute on function app.log_audit(uuid, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
-- allocate_payment(apply=true) writes allocations: staff go through confirm flows / edge functions (service role).
revoke execute on function app.allocate_payment(uuid, uuid[], boolean) from public, anon, authenticated;
grant select on app.directory to authenticated;
