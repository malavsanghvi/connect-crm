-- 0743 · Guards for Opportunities, Recurring gifts, Labh and Statements, and the import list (docs/GIVING_REDESIGN.md
-- section 11.1, slice M2, part 3 of 3).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   giving_opportunities  opportunity_availability refuses; a person cannot pledge to an opportunity (trigger
--                         pledges_opportunity_available) nor link a recurring gift to one; the website draft leaves
--                         opportunities out. Pledges that already exist keep their numbers and amounts.
--   giving_recurring      no new recurring gift (create_recurring_gift), no cycle (run_recurring_gift_cycle), an opportunity
--                         cannot turn recurring on (trigger opportunities_recurring_template), and a labh cannot be repeated
--                         every year (commit_labh says so in plain words).
--   labh                  commit_labh refuses ("Special-day offerings ..."), and the special-day labh notice is not sent.
--                         For a kind without Labh the sentence is 0594's "... is not part of a ... organization."
--   giving_statements     year_end_statement refuses; it also gains the Giving check it never had. statement_counted_status
--                         is unchanged: it is a pure rule about payment statuses with no community to check.
--   Imports               bank accounts, opportunities, Labh options and recurring gifts are imported under their add-on, so
--                         the import engine refuses them while it is off (the seed below is generated from
--                         src/lib/import/registry.ts).
--
-- The two triggers refuse a person's request only (auth.uid() is set): a payment provider's webhook or the worker writing
-- without a person is never refused here, so money that has arrived is always recorded.
--
-- Each body is copied from the migration named in its heading (the latest definition); the only changes are the guard lines
-- (and, for check_opportunity_available, the search path now includes extensions, as every function's must).

-- ── app.opportunity_availability (latest body: 0526) ────────────────────────────────────────
create or replace function app.opportunity_availability(p_opportunity uuid)
returns table (option_key text, taken boolean, taken_count int, slots_taken int, slots_total int, goal_percent int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare o app.opportunities; v_slots_taken int; v_slots_total int; v_goal int; v_camp_goal bigint; v_camp_pledged bigint; v_visible boolean;
begin
  select * into o from app.opportunities where id = p_opportunity;
  if o.id is null then raise exception 'opportunity not found'; end if;
  perform app.assert_module_enabled(o.center_id, 'giving_opportunities');
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

-- ── app.check_opportunity_available (latest body: 0018) ─────────────────────────────────────
create or replace function app.check_opportunity_available() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  -- 0743: a person (staff or member) cannot pledge to an opportunity while Opportunities is off. Writes without a person
  -- (a payment provider's webhook settling a checkout started earlier, the worker) are never refused here.
  if new.opportunity_id is not null and auth.uid() is not null then
    perform app.assert_module_enabled(new.center_id, 'giving_opportunities');
  end if;
  if new.opportunity_id is not null and exists (
       select 1 from app.opportunities o where o.id = new.opportunity_id
         and (o.status in ('taken','closed','draft')
              or (o.quantity_available is not null and o.quantity_taken >= o.quantity_available))) then
    raise exception 'this opportunity is already taken' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ── app.check_opportunity_recurring_template (latest body: 0525) ────────────────────────────
create or replace function app.check_opportunity_recurring_template() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  -- 0743: turning recurring on for an opportunity needs Recurring gifts (a person's request; system writes pass).
  if new.allow_recurring and auth.uid() is not null then
    if tg_op = 'INSERT' then
      perform app.assert_module_enabled(new.center_id, 'giving_recurring');
    elsif not old.allow_recurring then
      perform app.assert_module_enabled(new.center_id, 'giving_recurring');
    end if;
  end if;
  if not new.allow_recurring or new.notification_template_key is null then return new; end if;
  if not exists (
    select 1 from app.message_templates m
     where m.key = new.notification_template_key and m.channel = 'email'
       and (m.center_id = new.center_id or m.center_id is null)
  ) then
    raise exception 'Choose a confirmation email template that exists before turning recurring on for this opportunity.';
  end if;
  return new;
end $$;

-- ── app.create_recurring_gift (latest body: 0526) ───────────────────────────────────────────
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
  perform app.assert_module_enabled(v_center, 'giving_recurring');
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
    perform app.assert_module_enabled(v_center, 'giving_opportunities');
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

-- ── app.run_recurring_gift_cycle (latest body: 0525) ────────────────────────────────────────
create or replace function app.run_recurring_gift_cycle(p_recurring_gift uuid) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  g app.recurring_gifts; o app.opportunities; v_pledge uuid; v_next date; v_end_count integer;
  v_next_status text; v_to text; v_tpl app.message_templates;
begin
  select * into g from app.recurring_gifts where id = p_recurring_gift for update;
  if g.id is null then raise exception 'recurring gift not found'; end if;
  perform app.assert_module_enabled(g.center_id, 'giving');
  perform app.assert_module_enabled(g.center_id, 'giving_recurring');
  if g.status <> 'active' then raise exception 'this recurring gift is % — only an active gift can run a cycle', g.status; end if;
  if g.next_charge_on is null or g.next_charge_on > current_date then raise exception 'this recurring gift is not due yet'; end if;

  insert into app.pledges (center_id, household_id, pledged_by_person_id, campaign_id, opportunity_id, fund_id, source, source_ref_id, amount_cents, due_on)
    values (g.center_id, g.household_id, g.person_id, g.campaign_id, g.opportunity_id, g.fund_id, 'recurring', g.id, g.amount_cents, g.next_charge_on)
    returning id into v_pledge;

  v_next := case g.frequency
    when 'weekly'    then (g.next_charge_on + interval '7 days')::date
    when 'monthly'   then (g.next_charge_on + interval '1 month')::date
    when 'quarterly' then (g.next_charge_on + interval '3 months')::date
    when 'yearly'    then (g.next_charge_on + interval '1 year')::date
    when 'special_day' then app.next_special_day_on(g.special_day_id, g.next_charge_on + 1)
  end;
  v_end_count := case when g.end_kind = 'count' then coalesce(g.end_count, 1) - 1 else g.end_count end;
  v_next_status := case
    when v_next is null then 'cancelled'
    when g.end_kind = 'until_date' and g.end_on is not null and v_next > g.end_on then 'cancelled'
    when g.end_kind = 'count' and v_end_count <= 0 then 'cancelled'
    else g.status
  end;
  update app.recurring_gifts
     set next_charge_on = case when v_next_status = 'cancelled' then null else v_next end,
         -- end_count > 0 is enforced even once cancelled, so a count-ended gift keeps its last
         -- positive remaining-count rather than being zeroed out — "cancelled" + next_charge_on
         -- null is what says it is done; end_count is only ever informational once that happens.
         end_count = case when g.end_kind = 'count' and v_end_count > 0 then v_end_count else g.end_count end,
         status = v_next_status
   where id = g.id;

  if g.opportunity_id is not null then
    select * into o from app.opportunities where id = g.opportunity_id;
    if o.notification_template_key is not null then
      select * into v_tpl from app.message_templates m
       where m.key = o.notification_template_key and m.channel = 'email' and (m.center_id = g.center_id or m.center_id is null)
       order by m.center_id nulls last, m.version desc limit 1;
      if v_tpl.id is not null then
        select coalesce(gp.email, hp.email) into v_to
          from app.recurring_gifts rg
          left join app.people gp on gp.id = rg.person_id
          left join app.household_members hm on hm.household_id = rg.household_id and hm.is_primary
          left join app.people hp on hp.id = hm.person_id
         where rg.id = g.id;
        if v_to is not null then
          perform app.enqueue_message(g.center_id, 'email', v_to, o.notification_template_key,
            jsonb_build_object('amount', to_char(g.amount_cents / 100.0, 'FM999,999,990.00'),
                                'frequency', g.frequency, 'next_date', coalesce(v_next::text, ''), 'opportunity_name', o.name),
            'notification');
        else
          raise warning 'run_recurring_gift_cycle: no email on file for household % — confirmation for opportunity % (pledge %) not sent', g.household_id, o.name, v_pledge;
        end if;
      else
        raise warning 'run_recurring_gift_cycle: template % not found for center % — confirmation for pledge % not sent', o.notification_template_key, g.center_id, v_pledge;
      end if;
    end if;
  end if;

  return v_pledge;
end $$;

-- ── app.commit_labh (latest body: 0104) ─────────────────────────────────────────────────────
create or replace function app.commit_labh(p_special_day uuid, p_option_ids uuid[], p_dedication text DEFAULT NULL::text, p_repeat_yearly boolean DEFAULT false)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare d app.special_days; o record; v_numbers text[] := '{}'; v_number text; v_pledge uuid; v_me uuid; v_next date;
begin
  select * into d from app.special_days where id = p_special_day;
  perform app.assert_module_enabled(d.center_id, 'giving');
  perform app.assert_module_enabled(d.center_id, 'labh');
  if coalesce(p_repeat_yearly, false) and not app.module_enabled(d.center_id, 'giving_recurring') then
    raise exception 'Repeating this every year needs Recurring gifts, which is switched off for this community. Take it without repeating.'
      using errcode = 'insufficient_privilege';
  end if;
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
      returning id, pledge_number into v_pledge, v_number;
    v_numbers := v_numbers || v_number;
    -- Fulfillment starts "to schedule" and remembers which labh was chosen (0060).
    insert into app.labh_fulfillments (pledge_id, center_id, labh_option_id, occasion)
      values (v_pledge, d.center_id, o.id, coalesce(nullif(trim(d.label), ''), initcap(d.kind)));
    if coalesce(p_repeat_yearly, false) then
      insert into app.recurring_gifts (center_id, household_id, person_id, campaign_id, fund_id, amount_cents, frequency,
                                       special_day_id, status, starts_on, next_charge_on, end_kind)
        values (d.center_id, d.household_id, v_me, o.campaign_id, o.fund_id, o.amount_cents, 'yearly',
                d.id, 'pending_payment_method', (v_next + interval '1 year')::date, (v_next + interval '1 year')::date, 'until_stopped');
    end if;
  end loop;
  return v_numbers;
end $function$;

-- ── app._special_day_labh_sweep (latest body: 0598) ─────────────────────────────────────────
create or replace function app._special_day_labh_sweep(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare sd record; v_res jsonb; v_left int := greatest(coalesce(p_limit, 200), 1); v_pushed int := 0; v_refused int := 0;
        v_counts jsonb; v_err text; v_more boolean := false; v_days int; v_expires timestamptz; v_zones text[];
        v_ids uuid[]; v_occ date[]; v_n int; v_first text; i int;
begin
  select coalesce(array_agg(lower(z.name)), '{}') into v_zones from pg_timezone_names z;
  for sd in
    select y.center_id, y.person_id, y.time_zone, y.today,
           array_agg(y.id order by y.occurs_on, y.id) as day_ids, array_agg(y.occurs_on order by y.occurs_on, y.id) as occurs
      from (
        select s.id, s.center_id, c.time_zone, h.person_id, s.reminder_days_before as lead_days,
               (now() at time zone c.time_zone)::date as today,
               app.next_special_day_on(s.id, (now() at time zone c.time_zone)::date) as occurs_on
          from app.special_days s
          join app.centers c on c.id = s.center_id
          cross join lateral app._notice_household_adults(s.household_id) h(person_id)
         where s.calendar_date is not null and s.labh_prompt_enabled and s.kind <> 'punyatithi'
           and coalesce(c.rules #>> '{notifications,triggers,special_day_labh}', '') <> 'false'
           and lower(c.time_zone) = any (v_zones)
           and app.module_enabled(s.center_id, 'giving')
           and app.module_enabled(s.center_id, 'labh')
           and exists (select 1 from app.labh_options o where o.center_id = s.center_id and o.active)
      ) y
      join app.center_users cu on cu.center_id = y.center_id and cu.person_id = y.person_id
     where y.occurs_on is not null and y.occurs_on - greatest(y.lead_days, 0) <= y.today
       and exists (select 1 from app.push_devices d where d.user_id = cu.user_id and d.invalid_at is null)
       and app._notice_topic_on(y.person_id, 'giving', 'push')
       and not exists (select 1 from app.notice_log l
                        where l.kind = 'special_day_labh' and l.ref_id = y.id and l.period = y.occurs_on::text and l.person_id = y.person_id)
     group by y.center_id, y.person_id, y.time_zone, y.today
     order by min(y.occurs_on), y.person_id
     limit v_left
  loop
    v_ids := sd.day_ids; v_occ := sd.occurs; v_n := cardinality(v_ids);
    v_days := v_occ[1] - sd.today;
    v_first := case when v_days <= 0 then 'today' when v_days = 1 then 'tomorrow' else 'in ' || v_days || ' days' end;
    v_expires := (v_occ[1] + 1)::timestamp at time zone sd.time_zone;
    v_res := app._member_push(sd.center_id, sd.person_id, 'special_day_labh', 'giving', 'special_day_labh',
               jsonb_build_object('when', case when v_n > 1 then v_n || ' special days coming up, the first ' || v_first
                                               when v_days <= 0 then 'Today' when v_days = 1 then 'Tomorrow' else 'In ' || v_days || ' days' end),
               jsonb_build_object('type', 'special_day', 'deep_link', '/labh/' || v_ids[1]::text, 'special_day_id', v_ids[1]::text),
               now(), v_expires);
    if coalesce(v_res->>'reason', '') not in ('no_person', 'no_login', 'no_phone', 'switched_off') then
      for i in 1 .. v_n loop
        insert into app.notice_log (kind, ref_id, period, person_id, center_id, outcome, reason)
        values ('special_day_labh', v_ids[i], v_occ[i]::text, sd.person_id, sd.center_id,
                case when v_res ? 'id' then 'pushed' else 'refused' end, v_res->>'reason')
        on conflict do nothing;
      end loop;
    end if;
    v_left := v_left - 1;
    if v_res ? 'id' then
      v_pushed := v_pushed + 1;
    else
      v_refused := v_refused + 1;
      v_counts := app._add_counts('{}'::jsonb, jsonb_build_object(coalesce(v_res->>'reason', 'error'), 1));
      perform app._member_notice_not_sent(sd.center_id, 'special_days', v_ids[1]::text, 'special_day_labh', v_counts, v_res->>'error');
    end if;
  end loop;
  return jsonb_build_object('pushed', v_pushed, 'refused', v_refused, 'more', v_more or v_left <= 0);
end $$;

-- ── app.year_end_statement (latest body: 0522) ──────────────────────────────────────────────
create or replace function app.year_end_statement(p_household uuid, p_year int)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_lines jsonb; v_total bigint; v_n int; v_ob_total bigint; v_ob_n int;
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null then raise exception 'That household was not found.'; end if;
  perform app.assert_module_enabled(v_center, 'giving');
  perform app.assert_module_enabled(v_center, 'giving_statements');
  if not (app.adult_of_household(v_center, p_household)
          or app.has_permission(v_center, 'giving.view') or app.has_permission(v_center, 'giving.manage')) then
    raise exception 'Seeing this household''s year-end statement needs an adult of the household, giving.view or giving.manage.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_year is null or p_year < 1990 or p_year > 2200 then raise exception 'Choose a tax year.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', p.id, 'receipt_number', p.receipt_number, 'received_on', p.received_on, 'method', p.method,
           'amount_cents', p.amount_cents, 'refunded_cents', p.refunded_cents, 'given_cents', p.amount_cents - p.refunded_cents,
           'receipt_name', p.receipt_name, 'joint_receipt', p.joint_receipt)
         order by p.received_on, p.receipt_number), '[]'::jsonb),
         coalesce(sum(p.amount_cents - p.refunded_cents), 0), count(*)
    into v_lines, v_total, v_n
    from app.payments p
   where p.household_id = p_household and p.center_id = v_center
     and p.received_on between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
     and app.statement_counted_status(p.status)
     and not p.is_opening_balance;

  select coalesce(sum(p.amount_cents - p.refunded_cents), 0), count(*) into v_ob_total, v_ob_n
    from app.payments p
   where p.household_id = p_household and p.center_id = v_center
     and p.received_on between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
     and app.statement_counted_status(p.status)
     and p.is_opening_balance;

  return jsonb_build_object(
    'household_id', p_household, 'tax_year', p_year,
    'lines', v_lines, 'gift_count', v_n, 'total_cents', v_total,
    'left_out', jsonb_build_object(
      'opening_balance_count', v_ob_n, 'opening_balance_cents', v_ob_total,
      'reason', case when v_ob_n > 0 then
        'Opening-balance lines are left out: they record what was paid on a pledge before the imported payment history begins, not gifts received in ' || p_year || '. They still show in the household''s giving history.'
      end));
end $$;

-- ── app.site_draft_data (latest body: 0643) ─────────────────────────────────────────────────
create or replace function app.site_draft_data(p_center uuid)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_center app.centers;
  v_prof app.org_profiles;
  v_addr jsonb;
  v_address text;
  v_tz text;
  v_events_on boolean;
  v_giving_on boolean;
  v_store_on boolean;
  v_school_on boolean;
  v_events jsonb := '[]'::jsonb;
  v_campaigns jsonb := '[]'::jsonb;
  v_leaders jsonb;
  v_today jsonb;
  v_albums jsonb;
  v_store_items jsonb := '[]'::jsonb;
  v_levels jsonb := '[]'::jsonb;
  v_term jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Drafting the website from Weaver''s records needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_center from app.centers where id = p_center;
  if not found then raise exception 'That community was not found.'; end if;
  select * into v_prof from app.org_profiles where center_id = p_center;
  v_tz := coalesce(nullif(btrim(v_center.time_zone), ''), 'UTC');

  v_addr := v_prof.registered_address;
  if v_addr is not null and jsonb_typeof(v_addr) = 'object' then
    v_address := nullif(concat_ws(', ',
        nullif(btrim(coalesce(v_addr ->> 'line1', '')), ''),
        nullif(btrim(coalesce(v_addr ->> 'line2', '')), ''),
        nullif(btrim(coalesce(v_addr ->> 'city', '')), ''),
        nullif(btrim(concat_ws(' ', nullif(btrim(coalesce(v_addr ->> 'state', '')), ''), nullif(btrim(coalesce(v_addr ->> 'postal_code', '')), ''))), '')), '');
  end if;

  v_events_on := app.module_enabled(p_center, 'events');
  v_giving_on := app.module_enabled(p_center, 'giving');
  v_store_on := app.module_enabled(p_center, 'store');
  v_school_on := app.module_enabled(p_center, 'pathshala');

  -- Upcoming events open to the public or to guests.
  if v_events_on then
    select coalesce(jsonb_agg(jsonb_build_object('title', e.name, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'venue', e.venue,
                                                 'description', left(e.description, 400)) order by e.starts_at), '[]'::jsonb)
      into v_events
      from (select ev.name, ev.starts_at, ev.ends_at, ev.venue, ev.description
              from app.events ev
             where ev.center_id = p_center
               and ev.status in ('published', 'rsvp_closed', 'live')
               and ev.audience in ('public', 'members_and_guests')
               and not coalesce(ev.confidential, false)
               and coalesce(ev.ends_at, ev.starts_at) >= now()
             order by ev.starts_at
             limit 12) e;
  end if;

  -- Published campaigns visible now, with their open opportunities.
  if v_giving_on then
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', c.name, 'kind', c.kind, 'description', left(c.description, 500),
             'items', coalesce((select jsonb_agg(jsonb_build_object('name', o.name, 'description', left(o.description, 300)) order by o.sort_order, o.name)
                                  from (select op.name, op.description, op.sort_order
                                          from app.opportunities op
                                         where op.campaign_id = c.id and op.status = 'open'
                                           and app.module_enabled(p_center, 'giving_opportunities')
                                           and app.giving_row_visible(op.active, op.visible_from, op.visible_until)
                                         order by op.sort_order, op.name
                                         limit 10) o), '[]'::jsonb)) order by c.starts_on nulls last, c.name), '[]'::jsonb)
      into v_campaigns
      from (select ca.id, ca.name, ca.kind, ca.description, ca.starts_on
              from app.campaigns ca
             where ca.center_id = p_center and ca.status = 'published'
               and app.giving_row_visible(ca.active, ca.visible_from, ca.visible_until)
               and (ca.ends_on is null or ca.ends_on >= current_date)
             order by ca.starts_on nulls last, ca.name
             limit 8) c;
  end if;

  -- The leaders the organization chose to show publicly: name and title, nothing else.
  select coalesce(jsonb_agg(jsonb_build_object('name', l.full_name, 'title', l.title) order by l.sort, l.full_name), '[]'::jsonb)
    into v_leaders
    from (select ol.full_name, ol.title, ol.sort from app.org_leaders ol
           where ol.center_id = p_center and ol.show_publicly
           order by ol.sort, ol.full_name limit 40) l;

  -- Today's opening and closing time (daily timings are kept by organizations that keep a tradition).
  select jsonb_build_object('date', t.on_date, 'open', left(t.temple_open::text, 5), 'close', left(t.temple_close::text, 5))
    into v_today
    from app.daily_timings t
   where t.center_id = p_center and t.on_date = (now() at time zone v_tz)::date;

  -- Public albums, with the number of approved photos that do not show children (plus the count of a linked album).
  select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'photos', a.n) order by a.created_at desc), '[]'::jsonb)
    into v_albums
    from (select pa.title, pa.created_at,
                 (select count(*) from app.photos ph where ph.album_id = pa.id and ph.status = 'approved' and not ph.contains_children)
                   + coalesce(pa.external_photo_count, 0) as n
            from app.photo_albums pa
           where pa.center_id = p_center and pa.visibility = 'public'
           order by pa.created_at desc limit 12) a;

  if v_store_on then
    select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb) into v_store_items
      from (select si.name from app.store_items si where si.center_id = p_center and si.status = 'active' order by si.name limit 8) s;
  end if;

  if v_school_on then
    select coalesce(jsonb_agg(lv.name order by lv.sort_order, lv.name), '[]'::jsonb) into v_levels
      from (select pl.name, pl.sort_order from app.pathshala_levels pl where pl.center_id = p_center and pl.active order by pl.sort_order, pl.name limit 12) lv;
    select jsonb_build_object('name', pt.name, 'starts_on', pt.starts_on, 'ends_on', pt.ends_on, 'status', pt.status)
      into v_term
      from app.pathshala_terms pt
     where pt.center_id = p_center and pt.status in ('registration', 'active')
     order by pt.starts_on desc limit 1;
  end if;

  return jsonb_build_object(
    'center', jsonb_build_object('name', v_center.name, 'short_name', v_center.short_name, 'time_zone', v_center.time_zone),
    'profile', jsonb_build_object(
        'mission', v_prof.mission, 'about', v_prof.about, 'public_email', v_prof.public_email::text, 'public_phone', v_prof.public_phone,
        'office_hours', v_prof.office_hours, 'address', v_address, 'latitude', v_prof.latitude, 'longitude', v_prof.longitude,
        'social', coalesce(v_prof.social, '{}'::jsonb)),
    'leaders', v_leaders,
    'events', jsonb_build_object('on', v_events_on, 'items', v_events),
    'giving', jsonb_build_object('on', v_giving_on, 'campaigns', v_campaigns),
    'today', v_today,
    'albums', v_albums,
    'store', jsonb_build_object('on', v_store_on, 'items', v_store_items),
    'school', jsonb_build_object('on', v_school_on and (jsonb_array_length(v_levels) > 0 or v_term is not null), 'levels', v_levels, 'term', v_term));
end $$;
-- ── The import list (app.import_entities): bank accounts, opportunities, Labh options and recurring gifts move to their add-on, so
-- the import engine's module check (0192) refuses them while it is off. Generated from src/lib/import/registry.ts (the whole
-- list, as every re-seed since 0192; only those four rows change).
-- BEGIN import_entities seed (generated from src/lib/import/registry.ts)
insert into app.import_entities (key, label, tier, sort, target_table, write_perms, module_key, columns, extras, natural_key, money_columns, has_center) values
  ('zones', 'Zones and ZIP codes', 'setup', 30, 'zones', array['settings.manage'], 'people',
   array['name','zip_codes'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('inboxes', 'Inboxes', 'setup', 31, 'inboxes', array['settings.manage'], 'comms',
   array['key','name','response_target_hours'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('bank_accounts', 'Bank accounts', 'setup', 32, 'bank_accounts', array['accounting.manage'], 'giving_bank',
   array['active','institution','last4','name','statement_format'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('funds', 'Funds', 'setup', 33, 'funds', array['giving.manage'], 'giving',
   array['active','key','name','qbo_class_id','restricted'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('membership_types', 'Membership types', 'setup', 34, 'membership_types', array['settings.manage'], 'membership',
   array['active','ec_approval_required','fee_cents','includes_spouse','key','name','period_months','reference_required','tier','voting_wait_days'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('store_categories', 'Store categories', 'setup', 35, 'store_categories', array['store.manage'], 'store',
   array['name','sort_order'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('calendar_layers', 'Calendar layers', 'setup', 36, 'calendar_layers', array['content.manage'], 'calendar',
   array['color','default_on','key','kind','name','source_url'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('pathshala_tracks', 'Pathshala tracks', 'setup', 37, 'pathshala_tracks', array['pathshala.manage'], 'pathshala',
   array['key','name'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('pathshala_terms', 'Pathshala terms', 'setup', 38, 'pathshala_terms', array['pathshala.manage'], 'pathshala',
   array['ends_on','membership_required','name','registration_closes_at','registration_opens_at','starts_on'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('practices', 'Practices (My Jain Way)', 'setup', 39, 'practices', array['content.manage'], 'jain_way',
   array['active','category','default_minutes','description','key','name','points','sort_order'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('gyan_goals', 'Gyan Path goals', 'setup', 40, 'gyan_goals', array['content.manage'], 'gyan_path',
   array['description','key','name','recommended','sort_order'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('campaigns', 'Campaigns', 'setup', 50, 'campaigns', array['giving.manage'], 'giving',
   array['description','ends_on','fund_id','goal_cents','kind','name','starts_on','status'],
   '{}'::text[], array['name'], array['goal_cents'], true),
  ('event_templates', 'Event templates', 'setup', 51, 'event_templates', array['events.manage'], 'events',
   array['description','name'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('event_template_items', 'Event template checklist items', 'setup', 52, 'event_template_items', array['events.manage'], 'events',
   array['name','offset_days','phase','priority','sort_order','template_id'],
   '{}'::text[], array['template_id','name'], '{}'::text[], true),
  ('volunteer_groups', 'Volunteer groups', 'setup', 53, 'volunteer_groups', array['volunteers.manage'], 'volunteers',
   array['name','requires_background_check','requires_waiver_kind'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('pathshala_levels', 'Pathshala levels', 'setup', 54, 'pathshala_levels', array['pathshala.manage'], 'pathshala',
   array['key','max_age','min_age','name','sort_order','track_id'],
   '{}'::text[], array['track_id','key'], '{}'::text[], true),
  ('gyan_levels', 'Gyan Path levels', 'setup', 55, 'gyan_levels', array['content.manage'], 'gyan_path',
   array['chapter','goal_id','key','name','points','requires_teacher_signoff','sort_order'],
   '{}'::text[], array['goal_id','key'], '{}'::text[], false),
  ('gyan_steps', 'Gyan Path steps', 'setup', 60, 'gyan_steps', array['content.manage'], 'gyan_path',
   array['kind','level_id','points','sort_order','title'],
   '{}'::text[], array['level_id','title'], '{}'::text[], false),
  ('opportunities', 'Opportunities and sponsorships', 'setup', 70, 'opportunities', array['giving.manage'], 'giving_opportunities',
   array['amount_cents','campaign_id','description','kind','min_amount_cents','name','quantity_available','sort_order','status'],
   '{}'::text[], array['campaign_id','name'], array['amount_cents'], true),
  ('labh_options', 'Labh options', 'setup', 71, 'labh_options', array['giving.manage'], 'labh',
   array['active','amount_cents','campaign_id','fund_id','name','sort_order'],
   '{}'::text[], array['name'], array['amount_cents'], true),
  ('pickup_windows', 'Store pickup windows', 'setup', 72, 'pickup_windows', array['store.manage'], 'store',
   array['capacity','ends_at','location','order_cutoff_at','starts_at'],
   '{}'::text[], array['starts_at'], '{}'::text[], true),
  ('pathshala_classes', 'Pathshala classes', 'setup', 73, 'pathshala_classes', array['pathshala.manage'], 'pathshala',
   array['capacity','ends_time','level_id','meets_on','name','room','starts_time','term_id'],
   '{}'::text[], array['term_id','name'], '{}'::text[], true),
  ('whatsapp_groups', 'WhatsApp groups', 'setup', 74, 'whatsapp_groups', array['comms.send'], 'comms',
   array['active','audience','description','name','zone_id'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('households', 'Households', 'records', 100, 'households', array['people.manage'], 'people',
   array['address_line1','address_line2','city','directory_opt_in','display_name','household_number','notes','physical_mail_opt_in','postal_code','state_region','zone_id'],
   array['crm_id','legacy_id'], '{}'::text[], '{}'::text[], true),
  ('people', 'People', 'records', 101, 'people', array['people.manage'], 'people',
   array['date_of_birth','deceased_on','email','employer','first_name','gender','is_deceased','language','last_name','member_number','phone_e164','preferred_name','profession'],
   array['crm_id','email_opt_in','email_opt_in_date','email_opt_in_source','full_name','household_id','is_primary','legacy_id','other_emails','relationship'], '{}'::text[], '{}'::text[], true),
  ('household_members', 'Household members and relationships', 'records', 110, 'household_members', array['people.manage'], 'people',
   array['household_id','is_primary','joined_at','left_at','person_id','role'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('external_ids', 'Identifiers', 'records', 111, 'external_ids', array['people.manage','giving.manage'], 'people',
   array['household_id','kind','label','person_id','system','value'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('channel_optins', 'Consents, opt-ins and opt-outs', 'records', 112, 'channel_optins', array['comms.send'], 'comms',
   array['address','channel','opted_in','person_id','recorded_at','source'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('special_days', 'Special days', 'records', 120, 'special_days', array['people.manage'], 'people',
   array['calendar_date','household_id','kind','label','person_id','tithi','tithi_month'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('memberships', 'Memberships (current and past)', 'records', 121, 'memberships', array['people.manage'], 'membership',
   array['crm_external_id','ends_on','household_id','membership_type_id','notes','person_id','starts_on','status'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('pathshala_enrollments', 'Pathshala enrollments', 'records', 122, 'pathshala_enrollments', array['pathshala.manage'], 'pathshala',
   array['class_id','household_id','notes','status','student_person_id','term_id'],
   '{}'::text[], array['term_id','student_person_id'], '{}'::text[], true),
  ('pathshala_teachers', 'Pathshala teachers', 'records', 123, 'pathshala_teachers', array['pathshala.manage'], 'pathshala',
   array['class_id','person_id','role'],
   '{}'::text[], array['class_id','person_id'], '{}'::text[], true),
  ('volunteer_interests', 'Volunteer interests', 'records', 124, 'volunteer_interests', array['volunteers.manage'], 'volunteers',
   array['group_id','person_id','status'],
   '{}'::text[], array['person_id','group_id'], '{}'::text[], true),
  ('background_checks', 'Background checks', 'records', 125, 'background_checks', array['safety.manage'], 'volunteers',
   array['cleared_on','expires_on','person_id','provider','status'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('store_items', 'Store items and opening stock', 'records', 130, 'store_items', array['store.manage'], 'store',
   array['category_id','description','low_stock_threshold','name','pack_size','price_cents','qbo_item_id','sku','status','taxable','track_inventory'],
   array['opening_stock'], array['sku'], array['price_cents'], true),
  ('pledges', 'Pledges', 'history', 200, 'pledges', array['giving.manage'], 'giving',
   array['amount_cents','anonymous','campaign_id','closed_at','crm_external_id','dedication','due_on','fund_id','household_id','pledge_number','pledged_at','pledged_by_person_id','source','status','write_off_reason','written_off_by_name'],
   array['paid_so_far'], '{}'::text[], array['amount_cents','paid_so_far'], true),
  ('payments', 'Payments (history)', 'history', 210, 'payments', array['giving.manage'], 'giving',
   array['amount_cents','check_number','crm_external_id','household_id','memo','method','payer_person_id','provider_ref','receipt_number','received_on','status'],
   array['allocate_to','allocation_cents'], '{}'::text[], array['amount_cents'], true),
  ('payment_allocations', 'Payment allocations', 'history', 220, 'payment_allocations', array['giving.manage'], 'giving',
   array['amount_cents','payment_id','pledge_id'],
   '{}'::text[], array['payment_id','pledge_id'], array['amount_cents'], true),
  ('recurring_gifts', 'Recurring gifts', 'history', 230, 'recurring_gifts', array['giving.manage'], 'giving_recurring',
   array['amount_cents','campaign_id','frequency','fund_id','household_id','method','next_charge_on','person_id','starts_on'],
   array['legacy_id'], '{}'::text[], array['amount_cents'], true),
  ('bolis', 'Past bolis', 'history', 240, 'bolis', array['bolis.manage'], 'bolis',
   array['campaign_id','closes_at','event_id','kind','name'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('boli_entries', 'Boli results', 'history', 241, 'boli_entries', array['bolis.manage'], 'bolis',
   array['amount_cents','boli_id','display_name','entered_at','household_id','person_id'],
   array['legacy_id'], '{}'::text[], array['amount_cents'], true),
  ('events', 'Past events', 'history', 242, 'events', array['events.manage'], 'events',
   array['description','ends_at','name','program_year','starts_at','venue'],
   array['legacy_id'], '{}'::text[], '{}'::text[], true),
  ('attendees', 'Event attendance', 'history', 243, 'attendees', array['events.manage'], 'events',
   array['checked_in_at','event_id','person_id'],
   array['household_id'], '{}'::text[], '{}'::text[], true),
  ('pathshala_attendance', 'Pathshala attendance', 'history', 244, 'pathshala_attendance', array['pathshala.manage'], 'pathshala',
   array['note','status'],
   array['class_id','held_on','student_person_id'], '{}'::text[], '{}'::text[], true)
on conflict (key) do update set label = excluded.label, tier = excluded.tier, sort = excluded.sort, target_table = excluded.target_table,
  write_perms = excluded.write_perms, module_key = excluded.module_key, columns = excluded.columns, extras = excluded.extras,
  natural_key = excluded.natural_key, money_columns = excluded.money_columns, has_center = excluded.has_center;
-- END import_entities seed
