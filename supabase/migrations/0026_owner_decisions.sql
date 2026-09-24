-- 0026 — owner decisions (2026-09-24).
-- 1. Recurring gifts set up in the app before a payment method exists get their own status,
--    'pending_payment_method', instead of 'paused' with no provider reference.
-- 2. Email sends count only people who have explicitly opted in to email: no opt-in record
--    now means "not opted in" (was: opted in).

alter table app.recurring_gifts drop constraint if exists recurring_gifts_status_check;
alter table app.recurring_gifts add constraint recurring_gifts_status_check
  check (status in ('active','paused','cancelled','failed','pending_payment_method'));
comment on column app.recurring_gifts.status is
  'active | paused | cancelled | failed | pending_payment_method (set up in the app, waiting for a card or bank account; never charged)';

-- Gifts created by the new-gift and labh flows before this migration were stored as paused
-- with no provider reference; only those created through the app flows are moved.
update app.recurring_gifts set status = 'pending_payment_method'
 where status = 'paused' and provider_ref is null and starts_on is not null;

create or replace function app.create_recurring_gift(
  p_household uuid, p_fund uuid, p_campaign uuid, p_amount_cents integer, p_frequency text,
  p_starts_on date default current_date, p_end_kind text default 'until_stopped', p_end_count integer default null,
  p_end_on date default null, p_special_day uuid default null)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_id uuid; v_start date := coalesce(p_starts_on, current_date);
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null or not app.adult_of_household(v_center, p_household) then
    raise exception 'only an adult of the household can set up a recurring gift';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'enter an amount greater than zero'; end if;
  if p_frequency not in ('weekly','monthly','quarterly','yearly','special_day') then raise exception 'choose how often to give'; end if;
  if v_start < current_date then raise exception 'the first gift cannot be in the past'; end if;
  if coalesce(p_end_kind, 'until_stopped') not in ('until_stopped','count','until_date') then raise exception 'choose when the gift ends'; end if;
  if p_end_kind = 'count' and coalesce(p_end_count, 0) <= 0 then raise exception 'enter how many gifts to make'; end if;
  if p_end_kind = 'until_date' and (p_end_on is null or p_end_on < v_start) then raise exception 'the end date must be after the first gift'; end if;
  if p_fund is not null and not exists (select 1 from app.funds where id = p_fund and center_id = v_center and active) then
    raise exception 'that fund is not available';
  end if;
  if p_campaign is not null and not exists (select 1 from app.campaigns where id = p_campaign and center_id = v_center and status = 'published') then
    raise exception 'that campaign is not open for giving';
  end if;
  if p_special_day is not null and not exists (select 1 from app.special_days where id = p_special_day and household_id = p_household) then
    raise exception 'that special day belongs to another family';
  end if;
  insert into app.recurring_gifts (center_id, household_id, person_id, campaign_id, fund_id, amount_cents, frequency,
                                   special_day_id, status, starts_on, next_charge_on, end_kind, end_count, end_on)
    values (v_center, p_household, app.my_person_id(v_center), p_campaign, p_fund, p_amount_cents, p_frequency,
            p_special_day, 'pending_payment_method', v_start, v_start, coalesce(p_end_kind, 'until_stopped'),
            case when p_end_kind = 'count' then p_end_count end, case when p_end_kind = 'until_date' then p_end_on end)
    returning id into v_id;
  return v_id;
end $$;

create or replace function app.commit_labh(p_special_day uuid, p_option_ids uuid[], p_dedication text default null,
                                           p_repeat_yearly boolean default false)
returns text[] language plpgsql security definer set search_path = app, public, extensions as $$
declare d app.special_days; o record; v_numbers text[] := '{}'; v_number text; v_me uuid; v_next date;
begin
  select * into d from app.special_days where id = p_special_day;
  if d.id is null then raise exception 'special day not found'; end if;
  if not app.adult_of_household(d.center_id, d.household_id) then
    raise exception 'only an adult of the family can take a labh';
  end if;
  if coalesce(array_length(p_option_ids, 1), 0) = 0 then raise exception 'choose at least one labh'; end if;
  if exists (select 1 from unnest(p_option_ids) i where not exists (
       select 1 from app.labh_options lo where lo.id = i and lo.center_id = d.center_id and lo.active)) then
    raise exception 'one of the chosen labh options is no longer offered';
  end if;
  v_me := app.my_person_id(d.center_id);
  v_next := app.next_special_day_on(d.id, current_date);
  for o in
    select lo.*, array_position(p_option_ids, lo.id) as pos from app.labh_options lo
     where lo.id = any(p_option_ids) order by array_position(p_option_ids, lo.id)
  loop
    insert into app.pledges (center_id, household_id, pledged_by_person_id, campaign_id, fund_id, source, source_ref_id,
                             amount_cents, dedication, due_on, created_by)
      values (d.center_id, d.household_id, v_me, o.campaign_id, o.fund_id, 'labh', d.id,
              o.amount_cents, nullif(trim(p_dedication), ''), v_next, auth.uid())
      returning pledge_number into v_number;
    v_numbers := v_numbers || v_number;
    if coalesce(p_repeat_yearly, false) then
      insert into app.recurring_gifts (center_id, household_id, person_id, campaign_id, fund_id, amount_cents, frequency,
                                       special_day_id, status, starts_on, next_charge_on, end_kind)
        values (d.center_id, d.household_id, v_me, o.campaign_id, o.fund_id, o.amount_cents, 'yearly',
                d.id, 'pending_payment_method', (v_next + interval '1 year')::date, (v_next + interval '1 year')::date, 'until_stopped');
    end if;
  end loop;
  return v_numbers;
end $$;

create or replace function app.segment_recipient_count(p_center uuid, p_audience jsonb) returns integer
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_n int; a jsonb := coalesce(p_audience, '{}'::jsonb);
begin
  if not app.has_permission(p_center, 'comms.send') then raise exception 'not allowed to preview recipients'; end if;
  select count(distinct h.id) into v_n
    from app.households h
   where h.center_id = p_center and h.merged_into_id is null
     and (
       (coalesce((a->>'all_members')::boolean, false) and exists (
          select 1 from app.memberships m where m.household_id = h.id and m.status = 'active'))
       or (a ? 'zone_ids' and h.zone_id::text in (select jsonb_array_elements_text(a->'zone_ids')))
       or (a ? 'pathshala_class_ids' and exists (
          select 1 from app.pathshala_enrollments e where e.household_id = h.id and e.status in ('placed','active','waitlisted')
            and e.class_id::text in (select jsonb_array_elements_text(a->'pathshala_class_ids'))))
       or (a ? 'event_id' and exists (
          select 1 from app.rsvps r where r.household_id = h.id and r.event_id = (a->>'event_id')::uuid
            and (not a ? 'rsvp_statuses' or r.status::text in (select jsonb_array_elements_text(a->'rsvp_statuses')))))
       or (a ? 'membership_tiers' and exists (
          select 1 from app.memberships m where m.household_id = h.id and m.status = 'active'
            and m.tier::text in (select jsonb_array_elements_text(a->'membership_tiers'))))
     )
     and exists (
       select 1 from app.household_members hm join app.people p on p.id = hm.person_id
        where hm.household_id = h.id and hm.left_at is null
          and not p.is_deceased and p.merged_into_id is null
          and coalesce(p.email::text, '') <> ''
          and (p.date_of_birth is null or p.date_of_birth <= current_date - interval '18 years')
          and coalesce((select o.opted_in from app.channel_optins o where o.person_id = p.id and o.channel = 'email'
                         order by o.recorded_at desc limit 1), false)
          and coalesce((select cs.granted from app.consents cs where cs.person_id = p.id and cs.kind = 'marketing_email'
                         order by cs.recorded_at desc limit 1), true));
  return v_n;
end $$;
