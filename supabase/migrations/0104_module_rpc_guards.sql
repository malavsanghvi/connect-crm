-- Wave 2 (stream s-core) · 5 of 5: module RPCs refuse when their module is off,
-- and reason-taking RPCs put their reason on every row they change.
--
-- Each function below is its current definition (0001–0080) with ONLY these
-- additions; every permission check, message and money rule is unchanged:
--   * `perform app.assert_module_enabled(<center>, '<module>')` as the first
--     step once the center is known (SQL functions: the same call in their
--     WHERE clause). It raises "The {label} module is switched off for this
--     community." Platform admins pass, as in the RLS policies.
--   * `perform app.set_audit_context(p_reason)` in close_boli, decide_reference
--     and change_household_tier, so the reason lands on every audited row.
--   * merge_people / merge_households record a default reason ("Merged duplicate
--     … into …") unless the request already carries one (x-audit-reason).
--   * enqueue_payment_posting / recompute_pledge_status check only when called
--     directly (pg_trigger_depth() = 0); from the Giving triggers they are part
--     of a write the module switch has already admitted, and a card payment that
--     settles after Giving is switched off must still post.
--   * my_reference_requests lists across centers, so it filters instead of raising.
--   * merge_people refuses while Membership is off: it is an invoker function,
--     so the restrictive RLS would hide the duplicate's memberships from it and
--     they would be left behind on the merged-away record.
--
-- Not guarded, on purpose: RLS helpers (has_permission, is_member_of,
-- can_see_event_ops, in_survey_audience, …) because a raise inside a policy
-- would break unrelated reads; core-platform and People RPCs (people is core);
-- trigger functions (their tables are gated by RLS and by the RPCs that write
-- them). docs/MODULES.md lists every RPC and its module.

-- Like set_audit_context, but only when neither the request (x-audit-reason) nor
-- an earlier call already gave a reason: a staff-typed reason always wins.
create or replace function app.set_audit_default_reason(p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if (select c.reason from app.audit_context() c) is null then
    perform app.set_audit_context(p_reason);
  end if;
end $$;
grant execute on function app.set_audit_default_reason(text) to authenticated, service_role;

-- giving
create or replace function app.allocate_payment(p_payment uuid, p_pledge_ids uuid[] DEFAULT NULL::uuid[], p_apply boolean DEFAULT false)
 RETURNS TABLE(pledge_id uuid, amount_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
#variable_conflict use_column
declare v_center uuid; v_household uuid; v_remaining bigint; r record; v_take bigint;
begin
  select center_id, household_id, amount_cents - coalesce((select sum(a.amount_cents) from app.payment_allocations a where a.payment_id = p_payment),0)
    into v_center, v_household, v_remaining from app.payments where id = p_payment;
  perform app.assert_module_enabled(v_center, 'giving');
  if v_remaining is null or v_remaining <= 0 then return; end if;
  for r in
    select p.id, p.amount_cents - p.paid_cents as open_cents
    from app.pledges p
    where p.center_id = v_center and p.household_id = v_household
      and p.status in ('open','partially_paid')
      and (p_pledge_ids is null or p.id = any(p_pledge_ids))
    order by case when p_pledge_ids is not null then array_position(p_pledge_ids, p.id) end, p.pledged_at
  loop
    exit when v_remaining <= 0;
    v_take := least(r.open_cents, v_remaining);
    if v_take > 0 then
      pledge_id := r.id; amount_cents := v_take;
      if p_apply then
        insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents, chosen_by_donor)
        values (v_center, p_payment, r.id, v_take, p_pledge_ids is not null);
      end if;
      return next;
      v_remaining := v_remaining - v_take;
    end if;
  end loop;
end $function$;

-- giving
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

-- giving
create or replace function app.confirm_bank_match(p_txn uuid, p_household uuid, p_pledge_ids uuid[] DEFAULT NULL::uuid[], p_learn_payer boolean DEFAULT true, p_payer_person uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare t app.bank_transactions; v_payment uuid; v_method app.payment_method;
begin
  select * into t from app.bank_transactions where id = p_txn for update;
  perform app.assert_module_enabled(t.center_id, 'giving');
  if t.id is null then raise exception 'bank line not found'; end if;
  if not (app.has_permission(t.center_id, 'giving.record_offline') or app.has_permission(t.center_id, 'giving.manage')) then
    raise exception 'not allowed to reconcile bank lines';
  end if;
  if t.status = 'matched' then raise exception 'bank line already matched'; end if;
  if t.is_batch_deposit then raise exception 'this is a deposit of several checks — match it to the recorded payments instead'; end if;
  if t.status = 'payout' then raise exception 'this is a card-processor payout, not a gift'; end if;
  if t.amount_cents <= 0 then raise exception 'only incoming money can be matched to a household'; end if;
  if not exists (select 1 from app.households where id = p_household and center_id = t.center_id) then
    raise exception 'household not in this center';
  end if;
  v_method := case
    when t.originator_kind = 'daf' then 'daf'
    when t.originator_kind in ('matching_gift','payroll_giving') then 'matching_gift'
    when t.channel = 'zelle' then 'zelle' when t.channel = 'check' then 'check' when t.channel = 'ach' then 'ach'
    else 'other' end;
  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, provider_ref,
                            check_number, received_on, recorded_by, memo, deposit_bank_transaction_id)
    values (t.center_id, p_household, p_payer_person, t.amount_cents, v_method, 'settled', 'bank',
            coalesce(t.reference, t.fingerprint), case when t.channel = 'check' then t.reference end, t.posted_on, auth.uid(),
            'Bank: ' || t.description, t.id)
    returning id into v_payment;
  perform app.allocate_payment(v_payment, p_pledge_ids, true);
  perform app.enqueue_payment_posting(v_payment);
  update app.bank_transactions set status = 'matched', matched_household_id = p_household, payment_id = v_payment,
         matched_by = auth.uid(), matched_at = now() where id = p_txn;
  -- Learn the payer name — but never a DAF / platform name (it is not the donor).
  if p_learn_payer and t.payer_name is not null and t.originator_kind is null then
    insert into app.external_ids (center_id, household_id, person_id, kind, system, value, label, source, confidence, created_by,
                                  times_matched, last_matched_at)
      values (t.center_id, p_household, p_payer_person, 'bank_payer',
              coalesce((select lower(institution) from app.bank_accounts where id = t.bank_account_id), 'bank'),
              t.payer_name, initcap(coalesce(t.channel, 'bank')) || ' payer name', 'learned', 0.9, auth.uid(), 1, now())
    on conflict (center_id, household_id, system, normalized) where kind = 'bank_payer'
      do update set times_matched = app.external_ids.times_matched + 1, last_matched_at = now(),
                    confidence = least(1, coalesce(app.external_ids.confidence, 0.9) + 0.02);
  end if;
  return v_payment;
end $function$;

-- giving
create or replace function app.create_recurring_gift(p_household uuid, p_fund uuid, p_campaign uuid, p_amount_cents integer, p_frequency text, p_starts_on date DEFAULT CURRENT_DATE, p_end_kind text DEFAULT 'until_stopped'::text, p_end_count integer DEFAULT NULL::integer, p_end_on date DEFAULT NULL::date, p_special_day uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_center uuid; v_id uuid; v_start date := coalesce(p_starts_on, current_date);
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
end $function$;

-- giving
create or replace function app.enqueue_payment_posting(p_payment uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v uuid; p record; v_type text;
begin
  select * into p from app.payments where id = p_payment;
  -- Called directly it is a Giving RPC; from the payments trigger it is part of a write
  -- that Giving's own RLS and RPC guards already admitted.
  if pg_trigger_depth() = 0 then perform app.assert_module_enabled(p.center_id, 'giving'); end if;
  v_type := case
    when p.provider = 'bank' then 'bank_receipt'
    when p.method = 'stock' then 'stock_gift'
    when p.provider = 'offline' then 'offline_receipt'
    else 'donation_card' end;
  insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month, triggered_by)
  values (p.center_id, 'payment:' || p.id, 'payments', p.id, v_type, p.amount_cents, date_trunc('month', p.received_on)::date, p.recorded_by)
  on conflict (center_id, idempotency_key) do nothing
  returning id into v;
  if p.fee_cents > 0 then
    insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month)
    values (p.center_id, 'fee:' || p.id, 'payments', p.id, 'processor_fee', p.fee_cents, date_trunc('month', p.received_on)::date)
    on conflict do nothing;
  end if;
  return v;
end $function$;

-- giving
create or replace function app.match_deposit(p_txn uuid, p_payment_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare t app.bank_transactions; v_sum bigint; v_n int;
begin
  select * into t from app.bank_transactions where id = p_txn for update;
  perform app.assert_module_enabled(t.center_id, 'giving');
  if t.id is null then raise exception 'bank line not found'; end if;
  if not (app.has_permission(t.center_id, 'giving.record_offline') or app.has_permission(t.center_id, 'giving.manage')) then
    raise exception 'not allowed to reconcile bank lines';
  end if;
  if t.status = 'matched' then raise exception 'bank line already matched'; end if;
  if coalesce(array_length(p_payment_ids, 1), 0) = 0 then raise exception 'choose the payments in this deposit'; end if;
  select coalesce(sum(amount_cents), 0), count(*) into v_sum, v_n from app.payments
   where id = any(p_payment_ids) and center_id = t.center_id and provider = 'offline' and deposit_bank_transaction_id is null;
  if v_n <> array_length(p_payment_ids, 1) then raise exception 'some payments are already deposited or not offline payments'; end if;
  if v_sum <> t.amount_cents then
    raise exception 'the chosen payments total % but the deposit is %', v_sum, t.amount_cents;
  end if;
  update app.payments set deposit_bank_transaction_id = t.id, status = 'settled' where id = any(p_payment_ids);
  update app.bank_transactions set status = 'matched', is_batch_deposit = true, matched_by = auth.uid(), matched_at = now()
   where id = p_txn;
  -- One QuickBooks Deposit groups the receipts (undeposited funds -> bank).
  insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month, triggered_by)
  values (t.center_id, 'deposit:' || t.id, 'bank_transactions', t.id, 'payout_deposit', t.amount_cents,
          date_trunc('month', t.posted_on)::date, auth.uid())
  on conflict (center_id, idempotency_key) do nothing;
  return v_n;
end $function$;

-- giving
create or replace function app.opportunity_availability(p_opportunity uuid)
 RETURNS TABLE(option_key text, taken boolean, taken_count integer, slots_taken integer, slots_total integer, goal_percent integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
#variable_conflict use_column
declare o app.opportunities; v_slots_taken int; v_slots_total int; v_goal int; v_camp_goal bigint; v_camp_pledged bigint;
begin
  select * into o from app.opportunities where id = p_opportunity;
  perform app.assert_module_enabled(o.center_id, 'giving');
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
end $function$;

-- giving
create or replace function app.preview_allocation(p_household uuid, p_amount_cents bigint, p_pledge_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(pledge_id uuid, pledge_number text, amount_cents bigint, closes boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  with h as (select center_id from app.households where id = p_household
             and app.assert_module_enabled(center_id, 'giving')
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
$function$;

-- giving
create or replace function app.recompute_pledge_status(p_pledge uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_paid bigint; v_amount bigint; v_status app.pledge_status;
begin
  if pg_trigger_depth() = 0 then
    perform app.assert_module_enabled((select center_id from app.pledges where id = p_pledge), 'giving');
  end if;
  select coalesce(sum(amount_cents),0) into v_paid from app.payment_allocations where pledge_id = p_pledge;
  select amount_cents, status into v_amount, v_status from app.pledges where id = p_pledge;
  if v_status in ('written_off','cancelled') then return; end if;
  update app.pledges set paid_cents = v_paid,
    status = (case when v_paid >= v_amount then 'paid' when v_paid > 0 then 'partially_paid' else 'open' end)::app.pledge_status,
    closed_at = case when v_paid >= v_amount then coalesce(closed_at, now()) else null end
  where id = p_pledge;
end $function$;

-- giving
create or replace function app.record_offline_payment(p_household uuid, p_amount_cents bigint, p_method app.payment_method, p_received_on date DEFAULT CURRENT_DATE, p_pledge_ids uuid[] DEFAULT NULL::uuid[], p_check_number text DEFAULT NULL::text, p_envelope_number text DEFAULT NULL::text, p_memo text DEFAULT NULL::text, p_payer_person uuid DEFAULT NULL::uuid, p_receipt_name text DEFAULT NULL::text, p_joint boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_center uuid; v_payment uuid;
begin
  select center_id into v_center from app.households where id = p_household;
  perform app.assert_module_enabled(v_center, 'giving');
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
end $function$;

-- giving
create or replace function app.suggest_bank_matches(p_txn uuid)
 RETURNS TABLE(household_id uuid, household_name text, household_number text, org_household_id text, members text, primary_member text, primary_org_member_id text, zone text, city text, last_gift_on date, score numeric, reason text, ambiguous boolean, open_pledge_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  with t as (select * from app.bank_transactions where id = p_txn
             and app.assert_module_enabled(center_id, 'giving')
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
$function$;

-- giving
create or replace function app.suggest_deposit_payments(p_txn uuid)
 RETURNS TABLE(payment_id uuid, household_name text, receipt_number text, method app.payment_method, amount_cents bigint, received_on date, check_number text, envelope_number text, exact_total boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  with t as (select * from app.bank_transactions where id = p_txn and is_batch_deposit
             and app.assert_module_enabled(center_id, 'giving')
             and (app.has_permission(center_id, 'giving.record_offline') or app.has_permission(center_id, 'giving.view'))),
  c as (
    select p.* from app.payments p, t
     where p.center_id = t.center_id and p.provider = 'offline' and p.deposit_bank_transaction_id is null
       and p.method in ('check','cash','stock','other') and p.status in ('captured','pending_clearing')
       and p.received_on between t.posted_on - 21 and t.posted_on
       and (t.channel <> 'cash_deposit' or p.method = 'cash')
  )
  select c.id, h.display_name, c.receipt_number, c.method, c.amount_cents, c.received_on, c.check_number, c.envelope_number,
         (select sum(amount_cents) from c) = (select amount_cents from t)
    from c join app.households h on h.id = c.household_id
   order by c.received_on, c.envelope_number nulls last, c.created_at
$function$;

-- giving / membership / comms
create or replace function app.approve_as_second(p_table text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_center uuid; v_perm text;
begin
  v_perm := case p_table when 'payments' then 'giving.approve' when 'pledges' then 'giving.approve'
                         when 'eligibility_snapshots' then 'people.approve' when 'comms_campaigns' then 'comms.approve' end;
  if v_perm is null then raise exception 'unsupported approval target'; end if;
  execute format('select center_id from app.%I where id = $1', p_table) into v_center using p_id;
  perform app.assert_module_enabled(v_center, case p_table when 'eligibility_snapshots' then 'membership'
                                                    when 'comms_campaigns' then 'comms' else 'giving' end);
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
end $function$;

-- bolis
create or replace function app.boli_minimum(p_boli uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  select case when max(e.amount_cents) is null then b.floor_cents else max(e.amount_cents) + b.step_cents end
  from app.bolis b left join app.boli_entries e on e.boli_id = b.id
  where b.id = p_boli and app.assert_module_enabled(b.center_id, 'bolis') group by b.floor_cents, b.step_cents
$function$;

-- bolis
create or replace function app.boli_summary(p_boli uuid)
 RETURNS TABLE(top_cents bigint, entries integer, minimum_cents bigint, closes_at timestamp with time zone, mine_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  select max(e.amount_cents), count(e.id)::int, app.boli_minimum(b.id), coalesce(b.extended_until, b.closes_at),
         max(e.amount_cents) filter (where e.household_id in (select app.my_household_ids(b.center_id)))
  from app.bolis b left join app.boli_entries e on e.boli_id = b.id
  where b.id = p_boli and app.assert_module_enabled(b.center_id, 'bolis') and app.is_member_of(b.center_id) and b.status <> 'draft'
  group by b.id
$function$;

-- bolis
create or replace function app.close_boli(p_boli uuid, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare b app.bolis; w app.boli_entries; v_pledge uuid;
begin
  select * into b from app.bolis where id = p_boli for update;
  perform app.assert_module_enabled(b.center_id, 'bolis');
  if b.id is null then raise exception 'boli not found'; end if;
  if not app.has_permission(b.center_id, 'bolis.manage') then raise exception 'not allowed'; end if;
  if b.status in ('closed','settled') then raise exception 'this boli is already closed'; end if;
  perform app.set_audit_context(p_reason);
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
end $function$;

-- bolis
create or replace function app.place_boli_entry(p_boli uuid, p_household uuid, p_amount_cents bigint, p_anonymous boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare b app.bolis; v_min bigint; v_entry uuid; v_close timestamptz;
begin
  select * into b from app.bolis where id = p_boli for update;
  perform app.assert_module_enabled(b.center_id, 'bolis');
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
end $function$;

-- events
create or replace function app.assign_lunch_for_rsvp(p_rsvp uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare r app.rsvps; e app.events; v_group_first boolean; v_slot uuid; v_need int; a record;
begin
  select * into r from app.rsvps where id = p_rsvp;
  select * into e from app.events where id = r.event_id;
  perform app.assert_module_enabled(e.center_id, 'events');
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
end $function$;

-- events
create or replace function app.cancel_rsvp(p_rsvp uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare r app.rsvps;
begin
  select * into r from app.rsvps where id = p_rsvp for update;
  perform app.assert_module_enabled(r.center_id, 'events');
  if r.id is null then raise exception 'RSVP not found'; end if;
  if not app.adult_of_household(r.center_id, r.household_id) then raise exception 'only an adult of the household can cancel'; end if;
  update app.rsvps set status = 'cancelled', cancelled_at = now() where id = p_rsvp;
  update app.attendees set status = 'cancelled' where rsvp_id = p_rsvp and checked_in_at is null;
  update app.pledges set status = 'cancelled', closed_at = now()
   where id = r.commitment_pledge_id and paid_cents = 0 and status = 'open';
end $function$;

-- events
create or replace function app.check_in(p_event uuid, p_token text, p_station text DEFAULT 'entry'::text, p_attendee_ids uuid[] DEFAULT NULL::uuid[], p_device text DEFAULT NULL::text, p_offline boolean DEFAULT false)
 RETURNS TABLE(result text, rsvp_id uuid, household_id uuid, household_name text, attendees jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
#variable_conflict use_column
declare e app.events; a app.attendees; v_rsvp uuid; v_result text := 'ok'; v_via text := 'ticket';
        v_person uuid; v_cands int; v_household uuid;
begin
  select * into e from app.events where id = p_event;
  perform app.assert_module_enabled(e.center_id, 'events');
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
end $function$;

-- events
create or replace function app.checkin_lookup_phone(p_event uuid, p_phone text)
 RETURNS TABLE(household_id uuid, household_label text, members_masked text, rsvp_id uuid, rsvp_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare e app.events; v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  select * into e from app.events where id = p_event;
  perform app.assert_module_enabled(e.center_id, 'events');
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
end $function$;

-- events
create or replace function app.create_event_from_template(p_template uuid, p_name text, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_program_year text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_event uuid; v_center uuid; t record;
begin
  select center_id into v_center from app.event_templates where id = p_template;
  perform app.assert_module_enabled(v_center, 'events');
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
end $function$;

-- events
create or replace function app.ensure_lunch_slots(p_event uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare e app.events; n int := 0; t timestamptz;
begin
  select * into e from app.events where id = p_event;
  perform app.assert_module_enabled(e.center_id, 'events');
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
end $function$;

-- events
create or replace function app.event_live_stats(p_event uuid)
 RETURNS TABLE(checked_in integer, confirmed integer, rsvp_people integer, walk_ins integer, waitlist integer, median_checkin_seconds integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare e app.events;
begin
  select * into e from app.events where id = p_event;
  perform app.assert_module_enabled(e.center_id, 'events');
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
end $function$;

-- events
create or replace function app.event_recent_checkins(p_event uuid, p_limit integer DEFAULT 10)
 RETURNS TABLE(checked_in_at timestamp with time zone, household_label text, lunch_slot_label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare e app.events; v_tz text;
begin
  select * into e from app.events where id = p_event;
  perform app.assert_module_enabled(e.center_id, 'events');
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
end $function$;

-- events
create or replace function app.move_lunch_slot(p_attendee_ids uuid[], p_slot uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare s app.lunch_slots; v_n int; v_rsvp uuid; v_household uuid; v_current timestamptz;
begin
  select * into s from app.lunch_slots where id = p_slot for update;
  perform app.assert_module_enabled(s.center_id, 'events');
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
end $function$;

-- events (+ giving for a commitment)
create or replace function app.submit_rsvp(p_event uuid, p_household uuid, p_attendees jsonb, p_commitment_cents bigint DEFAULT NULL::bigint, p_commitment_mode text DEFAULT 'none'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare e app.events; v_rsvp uuid; v_pledge uuid; a jsonb; v_count int;
begin
  select * into e from app.events where id = p_event;
  perform app.assert_module_enabled(e.center_id, 'events');
  -- A money commitment is a pledge, so it also needs Giving.
  if coalesce(p_commitment_cents, 0) > 0 then perform app.assert_module_enabled(e.center_id, 'giving'); end if;
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
end $function$;

-- membership
create or replace function app.decide_reference(p_application uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare a app.membership_applications;
begin
  select * into a from app.membership_applications where id = p_application for update;
  perform app.assert_module_enabled(a.center_id, 'membership');
  if a.id is null or a.status <> 'awaiting_reference' then raise exception 'application is not awaiting a reference'; end if;
  if app.my_person_id(a.center_id) is distinct from a.reference_person_id then raise exception 'you are not the named reference'; end if;
  if p_decision not in ('approved','declined','unknown') then raise exception 'invalid decision'; end if;
  perform app.set_audit_context(p_reason);
  update app.membership_applications set
    reference_decision = p_decision, reference_reason = p_reason, reference_decided_at = now(),
    status = case when p_decision = 'approved'
                  then (case when a.tier = 'life' then 'awaiting_center' else 'awaiting_center' end)::app.application_status
                  else 'reference_declined' end
  where id = p_application;
end $function$;

-- membership
create or replace function app.my_reference_requests()
 RETURNS TABLE(application_id uuid, applicant_name text, household_name text, tier app.membership_tier, note text, requested_at timestamp with time zone, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  select a.id, p.first_name || ' ' || p.last_name, h.display_name, a.tier, a.reference_note, a.reference_requested_at, a.reference_expires_at
  from app.membership_applications a
  join app.people p on p.id = a.applicant_person_id
  join app.households h on h.id = a.household_id
  join app.center_users cu on cu.person_id = a.reference_person_id and cu.center_id = a.center_id
  where cu.user_id = auth.uid() and a.status = 'awaiting_reference'
    and app.module_enabled(a.center_id, 'membership')
$function$;

-- membership
create or replace function app.change_household_tier(p_household uuid, p_tier app.membership_tier, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare h app.households; v_current app.membership_tier; v_type uuid; v_primary uuid; v_id uuid;
begin
  select * into h from app.households where id = p_household;
  perform app.assert_module_enabled(h.center_id, 'membership');
  if h.id is null or h.merged_into_id is not null then raise exception 'That household was not found, or it was merged'; end if;
  if not app.has_permission(h.center_id, 'people.approve') or not app.has_permission(h.center_id, 'people.manage') then
    raise exception 'Changing a membership tier needs the people.approve and people.manage permissions';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the tier change (it goes in the audit log)'; end if;
  perform app.set_audit_context(p_reason);
  select tier into v_current from app.memberships
    where household_id = p_household and status = 'active' order by starts_on desc limit 1;
  if v_current = p_tier then raise exception 'The household already holds an active % membership', p_tier; end if;
  select id into v_type from app.membership_types where center_id = h.center_id and tier = p_tier order by active desc, key limit 1;
  if v_type is null then raise exception 'No % membership type is set up for this center', p_tier; end if;
  select person_id into v_primary from app.household_members
    where household_id = p_household and is_primary and left_at is null limit 1;
  update app.memberships set status = 'ended', ends_on = current_date
    where household_id = p_household and status = 'active';
  insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on, granted_by, notes)
    values (h.center_id, p_household, v_primary, v_type, p_tier, 'active', current_date, auth.uid(),
            'Tier changed by staff: ' || trim(p_reason))
    returning id into v_id;
  return v_id;
end $function$;

-- pathshala
create or replace function app.pathshala_term_stats(p_term uuid)
 RETURNS TABLE(students integer, waitlisted integer, teachers integer, background_checks_expiring integer, attendance_percent integer, signoffs_waiting integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare t app.pathshala_terms;
begin
  select * into t from app.pathshala_terms where id = p_term;
  perform app.assert_module_enabled(t.center_id, 'pathshala');
  if t.id is null then raise exception 'term not found'; end if;
  if not (app.has_permission(t.center_id, 'pathshala.view') or app.has_permission(t.center_id, 'pathshala.manage')) then
    raise exception 'not allowed to see Pathshala numbers';
  end if;
  return query
  with tt as (
    select distinct pt.person_id from app.pathshala_teachers pt join app.pathshala_classes c on c.id = pt.class_id where c.term_id = p_term
  )
  select
    (select count(*)::int from app.pathshala_enrollments e where e.term_id = p_term and e.status in ('placed','active')),
    (select count(*)::int from app.pathshala_enrollments e where e.term_id = p_term and e.status = 'waitlisted'),
    (select count(*)::int from tt),
    (select count(*)::int from tt where coalesce(
        (select bc.expires_on from app.background_checks bc where bc.person_id = tt.person_id and bc.status = 'clear'
          order by bc.cleared_on desc nulls last, bc.created_at desc limit 1), current_date) < current_date + 60),
    (select case when count(*) = 0 then null
                 else round(100.0 * count(*) filter (where pa.status in ('present','late')) / count(*))::int end
       from app.pathshala_attendance pa join app.pathshala_sessions s on s.id = pa.session_id
       join app.pathshala_classes c on c.id = s.class_id where c.term_id = p_term),
    (select count(*)::int from app.gyan_signoffs g where g.status = 'requested' and exists (
        select 1 from app.pathshala_enrollments e where e.term_id = p_term and e.student_person_id = g.person_id
          and e.status in ('placed','active')));
end $function$;

-- pathshala
create or replace function app.redeem_attendance_qr(p_session uuid, p_token text, p_person uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare s app.pathshala_sessions; v_person uuid; v_enrollment uuid; v_status text; c app.pathshala_classes;
begin
  select * into s from app.pathshala_sessions where id = p_session;
  perform app.assert_module_enabled(s.center_id, 'pathshala');
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
end $function$;

-- jain_way
create or replace function app.log_practice(p_center uuid, p_practice uuid, p_on date DEFAULT CURRENT_DATE)
 RETURNS TABLE(points_awarded integer, day_complete boolean, streak_days integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_person uuid := app.my_person_id(p_center); v_pts int; v_selected int; v_done int; s app.streaks; v_bonus int := 0;
begin
  perform app.assert_module_enabled(p_center, 'jain_way');
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
    v_bonus := coalesce((select (rules->'points'->>'day_complete_bonus')::int from app.centers where id = p_center), 20);
    insert into app.points_ledger (center_id, person_id, points, reason, note)
      values (p_center, v_person, v_bonus, 'practice', 'day complete bonus: ' || p_on);
    update app.streaks set
      current_days = case when s.last_logged_on = p_on - 1 then s.current_days + 1 else 1 end,
      longest_days = greatest(s.longest_days, case when s.last_logged_on = p_on - 1 then s.current_days + 1 else 1 end),
      last_logged_on = p_on
    where center_id = p_center and person_id = v_person
    returning * into s;
  end if;
  return query select v_pts + v_bonus, v_bonus > 0, s.current_days;
end $function$;

-- jain_way
create or replace function app.unlog_practice(p_person uuid, p_practice uuid, p_on date DEFAULT CURRENT_DATE)
 RETURNS TABLE(points_reversed integer, day_complete boolean, streak_days integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_center uuid; v_pts int; v_net int; v_bonus int := 0; v_selected int; v_done int; s app.streaks; v_rev int := 0;
begin
  select center_id into v_center from app.people where id = p_person;
  perform app.assert_module_enabled(v_center, 'jain_way');
  if v_center is null or not app.can_act_for_person(v_center, p_person) then
    raise exception 'you can only change your own practices or your child''s';
  end if;
  delete from app.practice_logs where person_id = p_person and practice_id = p_practice and logged_on = p_on;
  if not found then
    return query select 0, false, coalesce((select st.current_days from app.streaks st where st.person_id = p_person and st.center_id = v_center), 0);
    return;
  end if;

  -- The practice's own points, capped at what this practice has net earned.
  select points into v_pts from app.practices where id = p_practice;
  select coalesce(sum(points), 0) into v_net from app.points_ledger
   where person_id = p_person and ref_id = p_practice and reason in ('practice', 'correction');
  v_pts := least(coalesce(v_pts, 0), greatest(v_net, 0));
  if v_pts > 0 then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id, note)
      values (v_center, p_person, -v_pts, 'correction', p_practice, 'practice unlogged: ' || p_on);
    v_rev := v_pts;
  end if;

  -- Is the day still complete?
  select count(*) into v_selected from app.practice_selections where person_id = p_person and center_id = v_center;
  select count(*) into v_done from app.practice_logs l join app.practice_selections ps on ps.practice_id = l.practice_id and ps.person_id = l.person_id
   where l.person_id = p_person and l.logged_on = p_on;
  select * into s from app.streaks where center_id = v_center and person_id = p_person for update;

  if not (v_selected > 0 and v_done >= v_selected) then
    -- Net bonus still standing for that day (bonus rows are stamped with the day).
    select coalesce(sum(points), 0) into v_bonus from app.points_ledger
     where person_id = p_person and reason in ('practice', 'correction')
       and note in ('day complete bonus: ' || p_on, 'day complete bonus reversed: ' || p_on);
    -- Bonuses logged before the day was stamped: trust the streak's latest day.
    if v_bonus = 0 and s.last_logged_on = p_on and not exists (
         select 1 from app.points_ledger where person_id = p_person and note = 'day complete bonus reversed: ' || p_on) then
      v_bonus := coalesce((select (rules->'points'->>'day_complete_bonus')::int from app.centers where id = v_center), 20);
    end if;
    if v_bonus > 0 then
      insert into app.points_ledger (center_id, person_id, points, reason, note)
        values (v_center, p_person, -v_bonus, 'correction', 'day complete bonus reversed: ' || p_on);
      v_rev := v_rev + v_bonus;
    end if;
    if s.last_logged_on = p_on then
      update app.streaks set
        longest_days = case when s.longest_days = s.current_days then greatest(s.longest_days - 1, 0) else s.longest_days end,
        current_days = greatest(s.current_days - 1, 0),
        last_logged_on = case when s.current_days > 1 then p_on - 1 end
      where center_id = v_center and person_id = p_person
      returning * into s;
    end if;
  end if;
  return query select v_rev, (v_selected > 0 and v_done >= v_selected), coalesce(s.current_days, 0);
end $function$;

-- jain_way
create or replace function app.my_practice_standing(p_person uuid)
 RETURNS TABLE(category text, top_percent integer, practices_count integer, done_today integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
#variable_conflict use_column
declare v_center uuid; v_from date := date_trunc('month', current_date)::date;
begin
  select center_id into v_center from app.people where id = p_person;
  perform app.assert_module_enabled(v_center, 'jain_way');
  if v_center is null or not app.can_act_for_person(v_center, p_person) then
    raise exception 'your standing is private to you';
  end if;
  return query
  with totals as (
    select pr.category, l.person_id, sum(pr.points)::int as pts
      from app.practice_logs l join app.practices pr on pr.id = l.practice_id
     where l.center_id = v_center and l.logged_on between v_from and current_date
     group by pr.category, l.person_id
  ),
  cats as (
    select pr.category from app.practice_selections ps join app.practices pr on pr.id = ps.practice_id where ps.person_id = p_person
    union
    select t.category from totals t where t.person_id = p_person
  )
  select c.category,
         case when (select count(*) from totals t where t.category = c.category) < 10 then null
              when coalesce((select t.pts from totals t where t.category = c.category and t.person_id = p_person), 0) <= 0 then null
              else greatest(1, ceil(100.0 * (1 + (select count(*) from totals t where t.category = c.category
                                                      and t.pts > (select t2.pts from totals t2 where t2.category = c.category and t2.person_id = p_person)))
                                    / (select count(*) from totals t where t.category = c.category)))::int
         end,
         (select count(*)::int from app.practice_selections ps join app.practices pr on pr.id = ps.practice_id
           where ps.person_id = p_person and pr.category = c.category),
         (select count(*)::int from app.practice_logs l join app.practices pr on pr.id = l.practice_id
           where l.person_id = p_person and l.logged_on = current_date and pr.category = c.category)
    from cats c
   order by c.category;
end $function$;

-- jain_way
create or replace function app.saathi_feed(p_household uuid)
 RETURNS TABLE(kind text, person_id uuid, person_name text, title text, detail text, occurred_at timestamp with time zone, anumodana_count integer, i_sent boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
#variable_conflict use_column
declare v_center uuid; v_me uuid; v_behind int;
begin
  select center_id into v_center from app.households where id = p_household;
  perform app.assert_module_enabled(v_center, 'jain_way');
  if v_center is null or not app.in_my_household(v_center, p_household) then
    raise exception 'Saathi works within your family circle';
  end if;
  v_me := app.my_person_id(v_center);
  v_behind := coalesce((select (rules->'points'->>'behind_after_days')::int from app.centers where id = v_center), 3);
  return query
  with circle as (
    select p.id, coalesce(p.preferred_name, p.first_name) as name
      from app.household_members hm join app.people p on p.id = hm.person_id
     where hm.household_id = p_household and hm.left_at is null and p.id is distinct from v_me
       and not p.is_deceased and p.merged_into_id is null
       and coalesce((select ss.opted_in and ss.share_with_family from app.saathi_settings ss
                      where ss.center_id = v_center and ss.person_id = p.id), true)
  ),
  goals_done as (   -- every step of every level of a goal completed; finished in the window
    select c.id as pid, c.name, g.name as goal_name, max(gp.completed_at) as at, count(distinct l.id)::int as levels
      from circle c
      join app.gyan_progress gp on gp.person_id = c.id and gp.completed_at is not null
      join app.gyan_steps st on st.id = gp.step_id
      join app.gyan_levels l on l.id = st.level_id
      join app.gyan_goals g on g.id = l.goal_id
     group by c.id, c.name, g.id, g.name
    having count(distinct gp.step_id) = (select count(*) from app.gyan_steps s2 join app.gyan_levels l2 on l2.id = s2.level_id where l2.goal_id = g.id)
       and max(gp.completed_at) >= now() - interval '14 days'
  ),
  days_met as (     -- every selected practice logged that day
    select c.id as pid, c.name, l.logged_on, max(l.created_at) as at, count(*)::int as n
      from circle c
      join app.practice_logs l on l.person_id = c.id and l.logged_on >= current_date - 13
      join app.practice_selections ps on ps.person_id = l.person_id and ps.practice_id = l.practice_id
     group by c.id, c.name, l.logged_on
    having count(*) >= (select count(*) from app.practice_selections ps2 where ps2.person_id = c.id)
  ),
  behind as (       -- practising members with no log for >= behind_after_days
    select c.id as pid, c.name,
           (select max(l.logged_on) from app.practice_logs l where l.person_id = c.id) as last_on,
           (select min(ps.selected_at) from app.practice_selections ps where ps.person_id = c.id) as since
      from circle c
     where exists (select 1 from app.practice_selections ps where ps.person_id = c.id)
  ),
  items as (
    select 'goal_completed'::text as kind, pid, name, 'Completed ' || goal_name as title,
           levels || ' levels' as detail, at
      from goals_done
    union all
    select 'daily_goal_met', pid, name, 'Completed today''s practices',
           n || case when n = 1 then ' practice' else ' practices' end
             || coalesce(' · ' || (select st.current_days from app.streaks st where st.person_id = pid and st.last_logged_on = logged_on
                                    and st.current_days > 1) || '-day streak', ''),
           at
      from days_met
    union all
    select 'behind', pid, name, 'Could use some encouragement',
           'No practice logged for ' || (current_date - coalesce(last_on, since::date)) || ' days',
           coalesce((last_on + 1)::timestamptz, since)
      from behind
     where current_date - coalesce(last_on, since::date) >= v_behind
  )
  select i.kind, i.pid, i.name, i.title, i.detail, i.at,
         (select count(*)::int from app.anumodana a where a.to_person_id = i.pid and a.created_at >= i.at),
         exists (select 1 from app.anumodana a where a.to_person_id = i.pid and a.from_person_id = v_me and a.created_at >= i.at)
    from items i
   order by i.at desc;
end $function$;

-- jain_way
create or replace function app.send_anumodana(p_center uuid, p_to uuid, p_kind text DEFAULT 'celebrate'::text, p_message text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_from uuid := app.my_person_id(p_center); v_cap int; v_today int; v_pts int;
begin
  perform app.assert_module_enabled(p_center, 'jain_way');
  if not app.same_household_person(p_center, p_to) then raise exception 'Saathi works within your family circle'; end if;
  insert into app.anumodana (center_id, from_person_id, to_person_id, kind, message) values (p_center, v_from, p_to, p_kind, p_message);
  v_cap := coalesce((select (rules->'points'->>'anumodana_daily_cap')::int from app.centers where id = p_center), 5);
  select count(*) into v_today from app.points_ledger where person_id = v_from and reason = 'anumodana_sent' and occurred_at::date = current_date;
  v_pts := case when v_today >= v_cap then 0 when p_kind = 'support' then 3 else 5 end;
  if v_pts > 0 then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id) values (p_center, v_from, v_pts, 'anumodana_sent', p_to);
  end if;
  return v_pts;
end $function$;

-- comms
create or replace function app.segment_recipient_count(p_center uuid, p_audience jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_n int; a jsonb := coalesce(p_audience, '{}'::jsonb);
begin
  perform app.assert_module_enabled(p_center, 'comms');
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
end $function$;

-- reports
create or replace function app.kpi_flows(p_center uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  select jsonb_build_object(
    'events_held', (select count(*) from app.events e where e.center_id = p_center and e.status in ('live','completed')
                      and (e.starts_at at time zone c.time_zone)::date between p_from and p_to),
    'attendance', (select count(*) from app.attendees a where a.center_id = p_center
                     and (a.checked_in_at at time zone c.time_zone)::date between p_from and p_to)
                + (select count(*) from app.pathshala_attendance pa join app.pathshala_sessions s on s.id = pa.session_id
                    where pa.center_id = p_center and pa.status in ('present','late') and s.held_on between p_from and p_to),
    'volunteer_hours', (select round(sum(extract(epoch from (sh.ends_at - sh.starts_at))) / 3600)::bigint
                          from app.volunteer_assignments va join app.volunteer_shifts sh on sh.id = va.shift_id
                         where va.center_id = p_center and va.status = 'completed' and sh.ends_at > sh.starts_at
                           and (sh.starts_at at time zone c.time_zone)::date between p_from and p_to),
    'volunteers', (select count(distinct va.person_id) from app.volunteer_assignments va join app.volunteer_shifts sh on sh.id = va.shift_id
                    where va.center_id = p_center and va.status = 'completed'
                      and (sh.starts_at at time zone c.time_zone)::date between p_from and p_to),
    'samayik', (select count(*) from app.practice_logs l join app.practices pr on pr.id = l.practice_id
                 where l.center_id = p_center and pr.key = 'samayik' and l.logged_on between p_from and p_to),
    'pratikraman', (select count(*) from app.practice_logs l join app.practices pr on pr.id = l.practice_id
                     where l.center_id = p_center and pr.key = 'pratikraman' and l.logged_on between p_from and p_to),
    'navkar_malas', (select count(*) from app.practice_logs l join app.practices pr on pr.id = l.practice_id
                      where l.center_id = p_center and pr.key = 'navkarvali' and l.logged_on between p_from and p_to),
    'gyan_levels', (select count(*) from app.gyan_signoffs g where g.center_id = p_center and g.status = 'approved'
                     and (g.decided_at at time zone c.time_zone)::date between p_from and p_to),
    'gyan_steps', (select count(*) from app.gyan_progress g where g.center_id = p_center
                    and (g.completed_at at time zone c.time_zone)::date between p_from and p_to),
    'anumodana', (select count(*) from app.anumodana a where a.center_id = p_center
                   and (a.created_at at time zone c.time_zone)::date between p_from and p_to),
    'store_orders', (select count(*) from app.store_orders o where o.center_id = p_center
                      and o.status in ('placed','preparing','ready','picked_up')
                      and (o.placed_at at time zone c.time_zone)::date between p_from and p_to),
    'class_sessions_marked', (select count(*) from app.pathshala_attendance pa join app.pathshala_sessions s on s.id = pa.session_id
                               where pa.center_id = p_center and s.held_on between p_from and p_to),
    'class_present', (select count(*) from app.pathshala_attendance pa join app.pathshala_sessions s on s.id = pa.session_id
                       where pa.center_id = p_center and pa.status in ('present','late') and s.held_on between p_from and p_to))
  from app.centers c where c.id = p_center and app.assert_module_enabled(p_center, 'reports')
$function$;

-- reports
create or replace function app.public_kpi_catalog(p_center uuid)
 RETURNS TABLE(kpi_key text, label text, section text, visibility text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  select k.key, k.label, k.section, coalesce(s.visibility, 'members')
    from (values
      ('member_families', 'Member families', 'summary', 1), ('community_people', 'Community members', 'summary', 2),
      ('events_held', 'Events held', 'summary', 3), ('attendance', 'Check-ins', 'summary', 4),
      ('volunteer_hours', 'Volunteer hours', 'summary', 5), ('app_adoption', 'Families on the app', 'summary', 6),
      ('samayik', 'Samayiks completed', 'practice', 7), ('pratikraman', 'Pratikramans', 'practice', 8),
      ('navkar_malas', 'Navkar malas', 'practice', 9), ('gyan_levels', 'Gyan Path levels completed', 'practice', 10),
      ('gyan_steps', 'Gyan Path steps completed', 'practice', 11), ('anumodana', 'Anumodanas sent', 'practice', 12),
      ('pathshala_students', 'Pathshala students', 'learning', 13), ('volunteer_teachers', 'Volunteer teachers', 'learning', 14),
      ('class_attendance_rate', 'Class attendance rate', 'learning', 15), ('store_orders', 'Satvik Store orders', 'seva', 16),
      ('attendance_by_month', 'Attendance by month', 'charts', 17), ('families_by_zone', 'Families by zone', 'charts', 18),
      ('campaign', 'Campaign progress', 'charts', 19)
    ) as k(key, label, section, ord)
    left join app.public_kpi_settings s on s.center_id = p_center and s.kpi_key = k.key
   where app.assert_module_enabled(p_center, 'reports')
     and (app.has_permission(p_center, 'reports.view') or app.has_permission(p_center, 'settings.manage'))
   order by k.ord
$function$;

-- reports
create or replace function app.public_kpis(p_slug text, p_from date DEFAULT (date_trunc('year'::text, (CURRENT_DATE)::timestamp with time zone))::date, p_to date DEFAULT CURRENT_DATE, p_campaign text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare
  v_center uuid; v_tz text; v_member boolean; v_len int; v_pfrom date; v_pto date;
  cur jsonb; prev jsonb; m jsonb := '{}'; d jsonb := '{}'; k text; v_out jsonb; v_public text[];
  v_families bigint; v_people bigint; v_on_app bigint; v_new_fam bigint; v_new_people bigint;
  v_students bigint; v_teachers bigint; v_start date; v_months jsonb; v_zones jsonb; v_camp jsonb;
  c record; v_donors bigint;
begin
  select id, time_zone into v_center, v_tz from app.centers where slug = p_slug and status = 'active';
  if v_center is null then return null; end if;
  perform app.assert_module_enabled(v_center, 'reports');
  if p_from is null or p_to is null or p_from > p_to then raise exception 'choose a valid period'; end if;
  v_member := app.is_member_of(v_center);
  select coalesce(array_agg(kpi_key), '{}') into v_public from app.public_kpi_settings
   where center_id = v_center and visibility = 'public';

  v_len := p_to - p_from + 1;
  v_pto := p_from - 1; v_pfrom := p_from - v_len;
  cur := app.kpi_flows(v_center, p_from, p_to);
  prev := app.kpi_flows(v_center, v_pfrom, v_pto);

  -- Stocks (point in time) and their "new this period".
  select count(distinct mb.household_id) into v_families from app.memberships mb
   where mb.center_id = v_center and mb.status = 'active' and mb.tier <> 'community';
  select count(*) into v_new_fam from (
    select mb.household_id from app.memberships mb
     where mb.center_id = v_center and mb.status = 'active' and mb.tier <> 'community'
     group by mb.household_id having min(mb.starts_on) between p_from and p_to) x;
  select count(*) into v_people from app.people p where p.center_id = v_center and p.merged_into_id is null and not p.is_deceased;
  select count(*) into v_new_people from app.people p where p.center_id = v_center and p.merged_into_id is null and not p.is_deceased
     and (p.created_at at time zone v_tz)::date between p_from and p_to;
  select count(distinct mb.household_id) into v_on_app from app.memberships mb
   where mb.center_id = v_center and mb.status = 'active' and mb.tier <> 'community'
     and exists (select 1 from app.household_members hm join app.center_users cu on cu.person_id = hm.person_id
                  where hm.household_id = mb.household_id and hm.left_at is null);
  select count(distinct e.student_person_id) into v_students from app.pathshala_enrollments e
    join app.pathshala_terms t on t.id = e.term_id
   where e.center_id = v_center and e.status in ('placed','active') and t.status in ('registration','active');
  select count(distinct pt.person_id) into v_teachers from app.pathshala_teachers pt
    join app.pathshala_classes cl on cl.id = pt.class_id join app.pathshala_terms t on t.id = cl.term_id
   where pt.center_id = v_center and t.status in ('registration','active');

  m := jsonb_build_object(
    'member_families', v_families, 'community_people', v_people,
    'events_held', cur->'events_held', 'attendance', cur->'attendance',
    'volunteer_hours', case when (cur->>'volunteers')::bigint >= 10 then cur->'volunteer_hours' end,
    'app_adoption', case when v_families >= 10 then round(100.0 * v_on_app / v_families)::int end,
    'samayik', cur->'samayik', 'pratikraman', cur->'pratikraman', 'navkar_malas', cur->'navkar_malas',
    'gyan_levels', cur->'gyan_levels', 'gyan_steps', cur->'gyan_steps', 'anumodana', cur->'anumodana',
    'pathshala_students', v_students, 'volunteer_teachers', v_teachers,
    'class_attendance_rate', case when (cur->>'class_sessions_marked')::bigint >= 10
                                  then round(100.0 * (cur->>'class_present')::bigint / (cur->>'class_sessions_marked')::bigint)::int end,
    'store_orders', cur->'store_orders');
  -- Suppress counts under 10 (percentages were gated on their denominators above).
  for k in select jsonb_object_keys(m) loop
    if k not in ('app_adoption','class_attendance_rate') and jsonb_typeof(m->k) = 'number' and (m->>k)::numeric < 10 then
      m := jsonb_set(m, array[k], 'null');
    end if;
  end loop;

  -- Deltas: flows vs the previous period of equal length; stocks = new this period.
  for k in select unnest(array['events_held','attendance','volunteer_hours','samayik','pratikraman','navkar_malas',
                               'gyan_levels','gyan_steps','anumodana','store_orders']) loop
    d := d || jsonb_build_object(k, case
      when m->>k is null or coalesce((prev->>k)::numeric, 0) < 10
           or (k = 'volunteer_hours' and coalesce((prev->>'volunteers')::bigint, 0) < 10)
        then jsonb_build_object('previous', null, 'change', null, 'change_pct', null)
      else jsonb_build_object('previous', prev->k, 'change', (m->>k)::numeric - (prev->>k)::numeric,
                              'change_pct', round(100.0 * ((m->>k)::numeric - (prev->>k)::numeric) / (prev->>k)::numeric)::int)
      end);
  end loop;
  d := d || jsonb_build_object(
    'member_families', jsonb_build_object('new_in_period', case when v_new_fam >= 10 then v_new_fam end),
    'community_people', jsonb_build_object('new_in_period', case when v_new_people >= 10 then v_new_people end),
    'volunteer_hours_volunteers', jsonb_build_object('volunteers', case when (cur->>'volunteers')::bigint >= 10 then cur->'volunteers' end));

  -- Attendance by month: 12 buckets from the period's first month (or the 12
  -- months ending at p_to for longer periods); months after p_to are partial.
  v_start := date_trunc('month', greatest(p_from, (p_to - interval '11 months')::date))::date;
  select jsonb_agg(jsonb_build_object(
           'month', b.m, 'label', to_char(b.m, 'Mon'),
           'value', case when b.m > p_to then null
                         else nullif(greatest(
                           (select count(*) from app.attendees a where a.center_id = v_center
                              and date_trunc('month', a.checked_in_at at time zone v_tz)::date = b.m)
                         + (select count(*) from app.pathshala_attendance pa join app.pathshala_sessions s on s.id = pa.session_id
                             where pa.center_id = v_center and pa.status in ('present','late') and date_trunc('month', s.held_on)::date = b.m), 0), 0) end,
           'partial', b.m > p_to or b.m + interval '1 month' > p_to + 1) order by b.m)
    into v_months
    from (select (v_start + make_interval(months => i))::date as m from generate_series(0, 11) i) b;
  select jsonb_agg(case when (x->>'value')::bigint < 10 then x || '{"value":null}' else x end) into v_months
    from jsonb_array_elements(v_months) x;

  -- Families by zone (member families, largest first); zones under 10 hidden.
  select coalesce(jsonb_agg(jsonb_build_object('zone', z.name, 'families', case when z.n >= 10 then z.n end) order by z.n desc, z.name), '[]')
    into v_zones
    from (select zo.name, count(distinct mb.household_id) as n from app.zones zo
            left join app.households h on h.zone_id = zo.id and h.merged_into_id is null
            left join app.memberships mb on mb.household_id = h.id and mb.status = 'active' and mb.tier <> 'community'
           where zo.center_id = v_center group by zo.name) z;

  -- One campaign: by name (case-insensitive) or, by default, the largest published construction campaign.
  select cp.* into c from app.campaigns cp
   where cp.center_id = v_center and cp.status in ('published','closed')
     and (case when p_campaign is null then cp.kind = 'construction' else lower(cp.name) = lower(trim(p_campaign)) end)
   order by cp.goal_cents desc nulls last, cp.created_at limit 1;
  if c.id is not null then
    select count(distinct p.household_id) into v_donors from app.pledges p
     where p.campaign_id = c.id and p.status not in ('cancelled','written_off');
    v_camp := jsonb_build_object('name', c.name, 'goal_cents', c.goal_cents,
      'pledged_cents', case when v_donors >= 10 then (select coalesce(sum(p.amount_cents), 0) from app.pledges p
                                                       where p.campaign_id = c.id and p.status not in ('cancelled','written_off')) end,
      'paid_cents', case when v_donors >= 10 then (select coalesce(sum(p.paid_cents), 0) from app.pledges p
                                                    where p.campaign_id = c.id and p.status not in ('cancelled','written_off')) end,
      'donor_families', case when v_donors >= 10 then v_donors end,
      'participation_percent', case when v_donors >= 10 and v_families >= 10 then round(100.0 * v_donors / v_families)::int end);
    v_camp := v_camp || jsonb_build_object('percent', case when coalesce(c.goal_cents, 0) > 0 and v_camp->>'pledged_cents' is not null
                                                        then least(100, round(100.0 * (v_camp->>'pledged_cents')::bigint / c.goal_cents))::int end);
  end if;

  -- Visibility: members of the center see everything; everyone else only 'public' keys.
  if not v_member then
    m := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(m) where key = any(v_public));
    d := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(d)
           where key = any(v_public) or (key = 'volunteer_hours_volunteers' and 'volunteer_hours' = any(v_public)));
  end if;

  v_out := jsonb_build_object(
    'center', p_slug, 'from', p_from, 'to', p_to, 'as_of', now(), 'suppressed_below', 10,
    'previous', jsonb_build_object('from', v_pfrom, 'to', v_pto),
    'audience', case when v_member then 'members' else 'public' end,
    'metrics', m, 'deltas', d);
  if v_member or 'attendance_by_month' = any(v_public) then v_out := v_out || jsonb_build_object('attendance_by_month', v_months); end if;
  if v_member or 'families_by_zone' = any(v_public) then v_out := v_out || jsonb_build_object('families_by_zone', v_zones); end if;
  if (v_member or 'campaign' = any(v_public)) and v_camp is not null then v_out := v_out || jsonb_build_object('campaign', v_camp); end if;
  return v_out;
end $function$;

-- people (core) - needs membership on
create or replace function app.merge_people(p_keep uuid, p_drop uuid, p_take text[] DEFAULT '{}'::text[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare k app.people; d app.people; f text; l app.household_members;
  v_allowed text[] := array['first_name','last_name','preferred_name','date_of_birth','gender','email','phone_e164','profession','employer'];
begin
  if p_keep = p_drop then raise exception 'Choose two different records to merge'; end if;
  select * into k from app.people where id = p_keep;
  select * into d from app.people where id = p_drop;
  if k.id is null or d.id is null then raise exception 'One of the two records was not found'; end if;
  if k.center_id <> d.center_id then raise exception 'The two records belong to different centers'; end if;
  if not app.has_permission(k.center_id, 'people.manage') then raise exception 'Merging records needs the people.manage permission'; end if;
  if k.merged_into_id is not null or d.merged_into_id is not null then raise exception 'One of the two records was already merged'; end if;
  -- Memberships move to the kept record. With Membership switched off they are
  -- hidden from this (invoker) function and would be left behind, so refuse.
  if not (app.module_enabled(k.center_id, 'membership') or app.is_platform_admin()) then
    raise exception 'Merging records needs the Membership module switched on, because the duplicate''s memberships move to the kept record.';
  end if;
  perform app.set_audit_default_reason('Merged duplicate person ' || coalesce(d.member_number, p_drop::text)
                                 || ' into ' || coalesce(k.member_number, p_keep::text));
  if exists (select 1 from app.center_users where person_id = p_drop) then
    if exists (select 1 from app.center_users where person_id = p_keep) then
      raise exception 'Both records sign in to the app, so they cannot be merged here. Ask the platform team to merge the two sign-ins first';
    end if;
    raise exception 'The duplicate signs in to the app. Keep that record instead (swap which record is kept)';
  end if;

  foreach f in array coalesce(p_take, '{}') loop
    if not f = any(v_allowed) then raise exception 'The field "%" cannot be copied in a merge', f; end if;
    execute format('update app.people set %1$I = (select %1$I from app.people where id = $1) where id = $2', f) using p_drop, p_keep;
  end loop;

  for l in select * from app.household_members where person_id = p_drop and left_at is null loop
    insert into app.household_members (household_id, person_id, center_id, role, is_primary, joined_at)
      values (l.household_id, p_keep, l.center_id, l.role, l.is_primary, coalesce(l.joined_at, current_date))
      on conflict (household_id, person_id) do update
        set left_at = null, is_primary = app.household_members.is_primary or excluded.is_primary;
    update app.household_members set left_at = current_date, is_primary = false
      where household_id = l.household_id and person_id = p_drop;
  end loop;

  update app.external_ids set person_id = p_keep where person_id = p_drop;
  update app.memberships set person_id = p_keep where person_id = p_drop;
  update app.people set merged_into_id = p_keep where id = p_drop;
  update app.merge_candidates set status = 'merged', resolved_by = auth.uid(), resolved_at = now()
    where kind = 'person' and status = 'open'
      and ((left_id = p_keep and right_id = p_drop) or (left_id = p_drop and right_id = p_keep));
end $function$;

-- people (core)
create or replace function app.merge_households(p_keep uuid, p_drop uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare k app.households; d app.households; l app.household_members; v_keep_has_primary boolean;
begin
  if p_keep = p_drop then raise exception 'Choose two different households to merge'; end if;
  select * into k from app.households where id = p_keep;
  select * into d from app.households where id = p_drop;
  if k.id is null or d.id is null then raise exception 'One of the two households was not found'; end if;
  if k.center_id <> d.center_id then raise exception 'The two households belong to different centers'; end if;
  if not app.has_permission(k.center_id, 'people.manage') then raise exception 'Merging households needs the people.manage permission'; end if;
  if k.merged_into_id is not null or d.merged_into_id is not null then raise exception 'One of the two households was already merged'; end if;
  perform app.set_audit_default_reason('Merged duplicate household ' || coalesce(d.household_number, p_drop::text)
                                 || ' into ' || coalesce(k.household_number, p_keep::text));

  select exists (select 1 from app.household_members where household_id = p_keep and is_primary and left_at is null)
    into v_keep_has_primary;
  for l in select * from app.household_members where household_id = p_drop and left_at is null loop
    insert into app.household_members (household_id, person_id, center_id, role, is_primary, joined_at)
      values (p_keep, l.person_id, l.center_id,
              case when l.role = 'primary' and v_keep_has_primary then 'other'::app.person_role_in_household else l.role end,
              l.is_primary and not v_keep_has_primary, coalesce(l.joined_at, current_date))
      on conflict (household_id, person_id) do update set left_at = null;
    update app.household_members set left_at = current_date, is_primary = false
      where household_id = p_drop and person_id = l.person_id;
  end loop;

  update app.households set merged_into_id = p_keep where id = p_drop;
  update app.merge_candidates set status = 'merged', resolved_by = auth.uid(), resolved_at = now()
    where kind = 'household' and status = 'open'
      and ((left_id = p_keep and right_id = p_drop) or (left_id = p_drop and right_id = p_keep));
end $function$;
