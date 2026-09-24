-- 0022_giving_parity.sql
-- Prototype parity: Giving.
--   6. Opportunity kinds (fixed / tier / multi / amount / open) with their
--      options, the option a pledge chose, and app.opportunity_availability
--   7. Labh on a family special day: app.commit_labh
--   8. Recurring gift schedule (start, end rule) and app.create_recurring_gift
--   9. Receipt templates (signed by, personal note) per center and kind
-- Money rules (allocation, write-off, refunds) are unchanged.

-- ---------------------------------------------------------------------------
-- 6. Opportunity kinds and options
-- ---------------------------------------------------------------------------
alter table app.opportunities add column kind text not null default 'amount'
  check (kind in ('fixed','tier','multi','amount','open'));
alter table app.opportunities add column options jsonb not null default '[]'::jsonb
  check (jsonb_typeof(options) = 'array');
alter table app.opportunities add column subtitle text;
comment on column app.opportunities.options is
  'tier: [{key,label,amount_cents,recognition}] · multi: [{key,label,amount_cents,note,fixed}] (each key taken by one family) · amount: [{amount_cents}] presets. fixed/open: [].';

alter table app.pledges add column opportunity_option text;
comment on column app.pledges.opportunity_option is 'Key of the opportunity option chosen (tier or multi item). One pledge per multi item.';
create index on app.pledges (opportunity_id, opportunity_option);

-- The chosen option must exist on the opportunity; a multi item is taken by one family.
create or replace function app.check_opportunity_option() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare o app.opportunities;
begin
  if new.opportunity_option is null then return new; end if;
  if new.opportunity_id is null then
    raise exception 'an opportunity option needs an opportunity' using errcode = 'check_violation';
  end if;
  select * into o from app.opportunities where id = new.opportunity_id for update;   -- serialises takers of one opportunity
  if not exists (select 1 from jsonb_array_elements(o.options) x where x->>'key' = new.opportunity_option) then
    raise exception 'that option is not offered on this opportunity' using errcode = 'check_violation';
  end if;
  if o.kind = 'multi' and new.status not in ('cancelled','written_off') and exists (
       select 1 from app.pledges p where p.opportunity_id = new.opportunity_id and p.opportunity_option = new.opportunity_option
         and p.status not in ('cancelled','written_off') and p.id <> new.id) then
    raise exception 'this option is already taken' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger pledges_opportunity_option before insert or update of opportunity_option, opportunity_id on app.pledges
  for each row execute function app.check_opportunity_option();

-- Availability for the giving screens. One row per option (tier / multi), or a
-- single row with option_key null for the other kinds. Opportunity-level columns
-- repeat on each row:
--   slots_taken / slots_total: multi = options taken / options offered;
--                              otherwise active pledges / quantity_available (null = unlimited)
--   goal_percent: multi = options taken share; otherwise % of the campaign goal
--                 pledged (active pledges), else % of slots; null when neither is known.
create or replace function app.opportunity_availability(p_opportunity uuid)
returns table (option_key text, taken boolean, taken_count int, slots_taken int, slots_total int, goal_percent int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare o app.opportunities; v_slots_taken int; v_slots_total int; v_goal int; v_camp_goal bigint; v_camp_pledged bigint;
begin
  select * into o from app.opportunities where id = p_opportunity;
  if o.id is null then raise exception 'opportunity not found'; end if;
  if not ((app.is_member_of(o.center_id) and o.status in ('open','taken','closed'))
          or app.has_permission(o.center_id, 'giving.view') or app.has_permission(o.center_id, 'giving.manage')
          or (auth.uid() is null and o.status = 'open')) then
    raise exception 'this opportunity is not available';
  end if;
  if o.kind = 'multi' then
    v_slots_total := jsonb_array_length(o.options);
    select count(distinct p.opportunity_option)::int into v_slots_taken from app.pledges p
     where p.opportunity_id = o.id and p.opportunity_option is not null and p.status not in ('cancelled','written_off');
    v_goal := case when v_slots_total > 0 then round(100.0 * v_slots_taken / v_slots_total)::int end;
  else
    v_slots_total := o.quantity_available;
    select count(*)::int into v_slots_taken from app.pledges p
     where p.opportunity_id = o.id and p.status not in ('cancelled','written_off');
    select c.goal_cents into v_camp_goal from app.campaigns c where c.id = o.campaign_id;
    if coalesce(v_camp_goal, 0) > 0 then
      select coalesce(sum(p.amount_cents), 0) into v_camp_pledged from app.pledges p
       where p.campaign_id = o.campaign_id and p.status not in ('cancelled','written_off');
      v_goal := least(100, round(100.0 * v_camp_pledged / v_camp_goal))::int;
    elsif coalesce(v_slots_total, 0) > 0 then
      v_goal := least(100, round(100.0 * v_slots_taken / v_slots_total))::int;
    end if;
  end if;

  if o.kind in ('tier','multi') and jsonb_array_length(o.options) > 0 then
    return query
      select x->>'key',
             (o.kind = 'multi' and cnt > 0),
             cnt, v_slots_taken, v_slots_total, v_goal
        from jsonb_array_elements(o.options) with ordinality as e(x, ord)
        cross join lateral (select count(*)::int as cnt from app.pledges p
                             where p.opportunity_id = o.id and p.opportunity_option = e.x->>'key'
                               and p.status not in ('cancelled','written_off')) k
       order by e.ord;
  else
    return query select null::text, (o.status = 'taken'), v_slots_taken, v_slots_taken, v_slots_total, v_goal;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Labh on a special day
-- ---------------------------------------------------------------------------
-- (labh_options.sort_order exists since 0007; members of the center already
--  read active options through labh_options_member_read in 0010.)
alter table app.labh_options add column campaign_id uuid references app.campaigns(id) on delete set null;

-- Recurring gift schedule (item 8) is needed by commit_labh, so it comes first.
alter table app.recurring_gifts add column starts_on date;
alter table app.recurring_gifts add column end_kind text not null default 'until_stopped'
  check (end_kind in ('until_stopped','count','until_date'));
alter table app.recurring_gifts add column end_count integer check (end_count > 0);
alter table app.recurring_gifts add column end_on date;
alter table app.recurring_gifts add constraint recurring_end_rule check (
  (end_kind <> 'count' or end_count is not null) and (end_kind <> 'until_date' or end_on is not null));
comment on column app.recurring_gifts.status is
  'active | paused | cancelled | failed. A gift created in the app before a payment method is attached is stored as '
  'paused with provider_ref null ("waiting for a payment method"); the payment worker activates it.';

-- Next yearly occurrence (on or after p_from) of a special day's calendar date; null for tithi-only days.
create or replace function app.next_special_day_on(p_special_day uuid, p_from date default current_date) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select case when d is null then null
              when make_date(extract(year from p_from)::int, extract(month from d)::int,
                             least(extract(day from d)::int, case when extract(month from d) = 2 then 28 else 31 end)) >= p_from
                then make_date(extract(year from p_from)::int, extract(month from d)::int,
                               least(extract(day from d)::int, case when extract(month from d) = 2 then 28 else 31 end))
              else make_date(extract(year from p_from)::int + 1, extract(month from d)::int,
                             least(extract(day from d)::int, case when extract(month from d) = 2 then 28 else 31 end))
         end
    from (select calendar_date as d from app.special_days where id = p_special_day) s
$$;

-- One pledge per chosen labh option on the household that owns the special day
-- (source 'labh', source_ref_id = the special day), with the dedication. When
-- p_repeat_yearly, each option also gets a yearly recurring gift linked to the
-- special day, starting next year and waiting for a payment method.
-- Returns the new pledge numbers in option order.
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
                d.id, 'paused', (v_next + interval '1 year')::date, (v_next + interval '1 year')::date, 'until_stopped');
    end if;
  end loop;
  return v_numbers;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Create a recurring gift (adults of the household only)
-- ---------------------------------------------------------------------------
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
            p_special_day, 'paused', v_start, v_start, coalesce(p_end_kind, 'until_stopped'),
            case when p_end_kind = 'count' then p_end_count end, case when p_end_kind = 'until_date' then p_end_on end)
    returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Receipt templates
-- ---------------------------------------------------------------------------
create table app.receipt_templates (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  kind          text not null check (kind in ('donation_receipt','pledge_confirmation','year_end_statement')),
  signed_by     text,
  personal_note text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) default auth.uid(),
  unique (center_id, kind)
);
create or replace function app.stamp_updated_by() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create trigger stamp_receipt_templates before insert or update on app.receipt_templates
  for each row execute function app.stamp_updated_by();
create trigger audit_receipt_templates after insert or update or delete on app.receipt_templates
  for each row execute function app.audit_row();
alter table app.receipt_templates enable row level security;
create policy receipt_templates_staff_read on app.receipt_templates for select to authenticated
  using (app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.manage'));
create policy receipt_templates_staff_write on app.receipt_templates for all to authenticated
  using (app.has_permission(center_id, 'giving.manage')) with check (app.has_permission(center_id, 'giving.manage'));
grant select, insert, update, delete on app.receipt_templates to authenticated;

-- next_special_day_on is internal: special days are private to the household.
revoke execute on function app.check_opportunity_option(), app.stamp_updated_by(), app.next_special_day_on(uuid, date)
  from public, anon, authenticated;
revoke execute on function app.commit_labh(uuid, uuid[], text, boolean),
  app.create_recurring_gift(uuid, uuid, uuid, integer, text, date, text, integer, date, uuid) from public, anon;
grant execute on function app.commit_labh(uuid, uuid[], text, boolean),
  app.create_recurring_gift(uuid, uuid, uuid, integer, text, date, text, integer, date, uuid) to authenticated;
grant execute on function app.opportunity_availability(uuid) to anon, authenticated;
grant execute on all functions in schema app to service_role;
