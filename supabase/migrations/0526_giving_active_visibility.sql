-- 0526 (Giving taxonomy rebuild, B16 · 2 of the priority list in docs/giving_taxonomy_plan.md)
-- Active/inactive split from `status`, and scheduled visibility, for both campaigns and
-- opportunities (docs/giving_taxonomy_plan.md gaps #7/#8 — the plan's open question "should
-- campaigns get the same treatment as opportunities" is answered yes here: a campaign is exactly
-- as visible-schedulable as the opportunities inside it, and a member should never see an
-- opportunity whose own campaign is hidden).
--
--   active            admin kill switch, independent of the open/taken/closed (or
--                     draft/published/closed/archived) lifecycle. Defaults true so nothing
--                     existing disappears.
--   visible_from      null = visible as soon as status allows it (unchanged default behavior)
--   visible_until     null = no end to visibility
--
-- Staff (giving.view / giving.manage) continue to see everything regardless of active/visibility
-- — those are exactly the people who need to see a hidden-but-scheduled row to manage it. Only
-- the member-facing and anonymous-public read paths, and app.opportunity_availability (which
-- runs its own explicit check instead of RLS, 0022), gain the filter.
set client_min_messages = warning;

alter table app.campaigns add column active boolean not null default true;
alter table app.campaigns add column visible_from timestamptz;
alter table app.campaigns add column visible_until timestamptz;
alter table app.campaigns add constraint campaigns_visible_window check (visible_until is null or visible_from is null or visible_until > visible_from);
comment on column app.campaigns.active is 'Admin kill switch, independent of status (0526). A published campaign that is not active is hidden from members even though its status says published.';
comment on column app.campaigns.visible_from is 'Members cannot see this campaign before this time even if it is published and active (0526). Null = visible as soon as status/active allow it.';
comment on column app.campaigns.visible_until is 'Members stop seeing this campaign after this time (0526). Null = no scheduled end.';

alter table app.opportunities add column active boolean not null default true;
alter table app.opportunities add column visible_from timestamptz;
alter table app.opportunities add column visible_until timestamptz;
alter table app.opportunities add constraint opportunities_visible_window check (visible_until is null or visible_from is null or visible_until > visible_from);
comment on column app.opportunities.active is 'Admin kill switch, independent of status (0526). An open opportunity that is not active is hidden from members even though its status says open.';
comment on column app.opportunities.visible_from is 'Members cannot see this opportunity before this time even if it is open and active (0526). Null = visible as soon as status/active allow it.';
comment on column app.opportunities.visible_until is 'Members stop seeing this opportunity after this time (0526). Null = no scheduled end.';

-- A single predicate both RLS policies and opportunity_availability share, so "what makes
-- something visible to a member right now" is defined in exactly one place.
create or replace function app.giving_row_visible(p_active boolean, p_visible_from timestamptz, p_visible_until timestamptz) returns boolean
language sql immutable as $$
  select p_active and (p_visible_from is null or p_visible_from <= now()) and (p_visible_until is null or p_visible_until > now())
$$;

drop policy if exists campaigns_member_read on app.campaigns;
create policy campaigns_member_read on app.campaigns for select to authenticated
  using (app.is_member_of(center_id) and status in ('published','closed') and app.giving_row_visible(active, visible_from, visible_until));
drop policy if exists campaigns_public_read on app.campaigns;
create policy campaigns_public_read on app.campaigns for select to anon
  using (status = 'published' and app.giving_row_visible(active, visible_from, visible_until));

drop policy if exists opportunities_member_read on app.opportunities;
create policy opportunities_member_read on app.opportunities for select to authenticated
  using (app.is_member_of(center_id) and status in ('open','taken','closed') and app.giving_row_visible(active, visible_from, visible_until));
drop policy if exists opportunities_public_read on app.opportunities;
create policy opportunities_public_read on app.opportunities for select to anon
  using (status = 'open' and app.giving_row_visible(active, visible_from, visible_until));

-- opportunity_availability (0022) runs its own explicit check instead of relying on RLS (it is
-- security definer and reads app.pledges, which members cannot select directly) — extend that
-- check the same way for the member/anon branches; staff (giving.view/giving.manage) still see it.
create or replace function app.opportunity_availability(p_opportunity uuid)
returns table (option_key text, taken boolean, taken_count int, slots_taken int, slots_total int, goal_percent int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare o app.opportunities; v_slots_taken int; v_slots_total int; v_goal int; v_camp_goal bigint; v_camp_pledged bigint; v_visible boolean;
begin
  select * into o from app.opportunities where id = p_opportunity;
  if o.id is null then raise exception 'opportunity not found'; end if;
  v_visible := app.giving_row_visible(o.active, o.visible_from, o.visible_until);
  if not ((app.is_member_of(o.center_id) and o.status in ('open','taken','closed') and v_visible)
          or app.has_permission(o.center_id, 'giving.view') or app.has_permission(o.center_id, 'giving.manage')
          or (auth.uid() is null and o.status = 'open' and v_visible)) then
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

-- A recurring gift cannot be started against an opportunity that is currently hidden from
-- members (an admin previewing a not-yet-visible opportunity uses giving.manage, not this RPC).
create or replace function app.create_recurring_gift(
  p_household uuid, p_fund uuid, p_campaign uuid, p_amount_cents integer, p_frequency text,
  p_starts_on date default current_date, p_end_kind text default 'until_stopped', p_end_count integer default null,
  p_end_on date default null, p_special_day uuid default null, p_opportunity uuid default null)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_id uuid; v_start date := coalesce(p_starts_on, current_date); o app.opportunities;
  v_campaign uuid := p_campaign; v_fund uuid := p_fund;
begin
  select center_id into v_center from app.households where id = p_household;
  perform app.assert_module_enabled(v_center, 'giving');
  if v_center is null or not app.adult_of_household(v_center, p_household) then
    raise exception 'only an adult of the household can set up a recurring gift';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'enter an amount greater than zero'; end if;
  if p_frequency not in ('weekly','monthly','quarterly','yearly','special_day') then raise exception 'choose how often to give'; end if;
  if v_start < current_date then raise exception 'the first gift cannot be in the past'; end if;
  if coalesce(p_end_kind, 'until_stopped') not in ('until_stopped','count','until_date') then raise exception 'choose when the gift ends'; end if;
  if p_end_kind = 'count' and coalesce(p_end_count, 0) <= 0 then raise exception 'enter how many gifts to make'; end if;
  if p_end_kind = 'until_date' and (p_end_on is null or p_end_on < v_start) then raise exception 'the end date must be after the first gift'; end if;
  if p_opportunity is not null then
    select * into o from app.opportunities where id = p_opportunity and center_id = v_center;
    if o.id is null then raise exception 'that opportunity was not found'; end if;
    if not o.allow_recurring then raise exception 'this opportunity cannot be made recurring'; end if;
    if not app.giving_row_visible(o.active, o.visible_from, o.visible_until) then raise exception 'this opportunity is not currently available'; end if;
    if not (p_frequency = any(o.recurring_frequencies)) then raise exception 'that frequency is not offered for this opportunity'; end if;
    v_campaign := o.campaign_id;
  end if;
  if v_fund is not null and not exists (select 1 from app.funds where id = v_fund and center_id = v_center and active) then
    raise exception 'that fund is not available';
  end if;
  if v_campaign is not null and not exists (select 1 from app.campaigns where id = v_campaign and center_id = v_center and status = 'published') then
    raise exception 'that campaign is not open for giving';
  end if;
  if v_fund is null and v_campaign is not null then select fund_id into v_fund from app.campaigns where id = v_campaign; end if;
  if p_special_day is not null and not exists (select 1 from app.special_days where id = p_special_day and household_id = p_household) then
    raise exception 'that special day belongs to another family';
  end if;
  insert into app.recurring_gifts (center_id, household_id, person_id, campaign_id, fund_id, opportunity_id, amount_cents, frequency,
                                   special_day_id, status, starts_on, next_charge_on, end_kind, end_count, end_on)
    values (v_center, p_household, app.my_person_id(v_center), v_campaign, v_fund, p_opportunity, p_amount_cents, p_frequency,
            p_special_day, 'pending_payment_method', v_start, v_start, coalesce(p_end_kind, 'until_stopped'),
            case when p_end_kind = 'count' then p_end_count end, case when p_end_kind = 'until_date' then p_end_on end)
    returning id into v_id;
  return v_id;
end $$;

grant execute on function app.giving_row_visible(boolean, timestamptz, timestamptz) to anon, authenticated, service_role;
grant execute on function app.opportunity_availability(uuid) to anon, authenticated;
grant execute on all functions in schema app to service_role;
