-- ROLLBACK of 0863 and 0862 (run FIRST; then the rollback of 0861). Not a migration: it is not in supabase/migrations, so the
-- deploy never applies it. It puts the schema back exactly as it was before 0862: the same functions word for word, the same
-- grants, the lock of 0410 on fee-cover, and none of the new columns and tables.
--
-- WHAT IT DESTROYS: the covered fee, the Chip In, the application fee and the amount charged recorded on payments and checkouts
-- (those columns are dropped), and the rate table. Money rules go back to "a payment is its amount". It REFUSES to run while any
-- payment or checkout carries a covered fee or a Chip In, unless you say you accept that (set app.rollback_force = 'on' for the
-- session) after taking a backup. The safe way to stop everything without a rollback is the switches: an organization turns
-- fee-cover off, a platform admin turns Chip In asking off (app.platform_set_chip_in(..., false, ...)).
begin;
set client_min_messages = warning;

do $$ begin
  if coalesce(current_setting('app.rollback_force', true), '') <> 'on'
     and (exists (select 1 from app.payments where donor_covered_fee_cents <> 0 or chip_in_cents <> 0 or application_fee_cents <> 0 or charged_cents is not null)
          or exists (select 1 from app.payment_checkouts where covered_fee_cents <> 0 or chip_in_cents <> 0)) then
    raise exception 'Some payments or checkouts carry a covered fee or a Chip In. Back them up first, then set app.rollback_force = ''on'' to drop those columns anyway.';
  end if;
end $$;

-- 0863
drop function if exists app._chip_in_seed_for(text);

-- Triggers added by 0862
drop trigger if exists payments_addons_guard on app.payments;
drop trigger if exists payment_allocation_gift_guard on app.payment_allocations;
drop trigger if exists payment_fee_rates_insert_only on app.payment_fee_rates;

-- Functions replaced by 0862, back to what they were (0104, 0543, 0672, 0591, 0410, 0211, 0212)
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

create or replace function app.household_credit(p_household uuid) returns bigint
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_credit bigint;
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null then return 0; end if;
  if not app.adult_of_household(v_center, p_household) then raise exception 'only an adult of the household can see its credit'; end if;
  select coalesce(sum(greatest(p.amount_cents - p.refunded_cents - coalesce(a.alloc, 0), 0)), 0) into v_credit
    from app.payments p
    left join lateral (select sum(amount_cents) as alloc from app.payment_allocations where payment_id = p.id) a on true
   where p.household_id = p_household and p.status in ('captured', 'settled', 'pending_clearing', 'partially_refunded');
  return v_credit;
end $$;

create or replace function app.reports_payments_summary(p_center uuid, p_from date, p_to date, p_group text default 'method')
returns jsonb
language plpgsql stable security invoker set search_path = app, public, extensions as $$
declare v jsonb;
begin
  if p_group is null or p_group not in ('method', 'month', 'year', 'fund', 'campaign', 'none') then
    raise exception 'Group giving by method, month, year, fund, campaign or none.' using errcode = '22023';
  end if;
  with pay as (
    select p.id, p.method, p.received_on, p.amount_cents, p.refunded_cents
      from app.payments p
     where p.center_id = p_center
       and p.received_on between p_from and p_to
       and p.status not in ('failed', 'voided', 'authorized')
  ),
  tot as (
    select count(*)::integer as payments,
           coalesce(sum(pay.amount_cents), 0)::bigint as received,
           coalesce(sum(pay.refunded_cents), 0)::bigint as refunded
      from pay
  ),
  alloc as (
    select al.payment_id, al.amount_cents, coalesce(pl.fund_id, cp.fund_id) as fund_id, pl.campaign_id
      from app.payment_allocations al
      join pay on pay.id = al.payment_id
      join app.pledges pl on pl.id = al.pledge_id
      left join app.campaigns cp on cp.id = pl.campaign_id
     where al.center_id = p_center
  ),
  loose as (
    select count(*)::integer as n, coalesce(sum(r.rem), 0)::bigint as amount
      from (select pay.id, pay.amount_cents - coalesce((select sum(al.amount_cents) from alloc al where al.payment_id = pay.id), 0) as rem
              from pay) r
     where r.rem <> 0
  ),
  g as (
    select pm.method::text as k, pm.method::text as label, count(*)::integer as n,
           sum(pm.amount_cents)::bigint as received, sum(pm.refunded_cents)::bigint as refunded
      from pay pm where p_group = 'method' group by pm.method
    union all
    select to_char(pm.received_on, 'YYYY-MM'), to_char(pm.received_on, 'YYYY-MM'), count(*)::integer,
           sum(pm.amount_cents)::bigint, sum(pm.refunded_cents)::bigint
      from pay pm where p_group = 'month' group by to_char(pm.received_on, 'YYYY-MM')
    union all
    select extract(year from pm.received_on)::integer::text, extract(year from pm.received_on)::integer::text, count(*)::integer,
           sum(pm.amount_cents)::bigint, sum(pm.refunded_cents)::bigint
      from pay pm where p_group = 'year' group by extract(year from pm.received_on)::integer
    union all
    select coalesce(a.fund_id::text, 'none'), coalesce(f.name, 'No fund'), count(distinct a.payment_id)::integer,
           sum(a.amount_cents)::bigint, null::bigint
      from alloc a left join app.funds f on f.id = a.fund_id
     where p_group = 'fund' group by a.fund_id, f.name
    union all
    select coalesce(a.campaign_id::text, 'none'), coalesce(ca.name, 'No campaign'), count(distinct a.payment_id)::integer,
           sum(a.amount_cents)::bigint, null::bigint
      from alloc a left join app.campaigns ca on ca.id = a.campaign_id
     where p_group = 'campaign' group by a.campaign_id, ca.name
    union all
    select 'unallocated', 'Not applied to a pledge', lo.n, lo.amount, null::bigint
      from loose lo where p_group in ('fund', 'campaign') and lo.n > 0
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'group', p_group,
    'totals', jsonb_build_object(
      'payments', tot.payments,
      'received_cents', tot.received,
      'refunded_cents', tot.refunded,
      'net_cents', tot.received - tot.refunded),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', g.k,
               'label', g.label,
               'payments', g.n,
               'received_cents', g.received,
               'refunded_cents', g.refunded,
               'net_cents', case when g.refunded is null then null else g.received - g.refunded end)
             order by case when p_group in ('month', 'year') then 0 else -(g.received - coalesce(g.refunded, 0)) end, g.k)
        from g), '[]'::jsonb))
    into v
    from tot;
  return v;
end $$;

create or replace function app.pathshala_late_payment_trigger() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_left bigint; p app.pledges;
begin
  if new.status <> 'paid' or old.status = 'paid' or new.payment_id is null or coalesce(cardinality(new.pledge_ids), 0) = 0 then return null; end if;
  select pay.amount_cents - pay.refunded_cents - coalesce((select sum(a.amount_cents) from app.payment_allocations a where a.payment_id = pay.id), 0)
    into v_left from app.payments pay where pay.id = new.payment_id;
  if coalesce(v_left, 0) <= 0 then return null; end if;
  select pl.* into p from app.pledges pl
   where pl.id = any (new.pledge_ids) and pl.source = 'pathshala_fee' and pl.status = 'cancelled'
     and exists (select 1 from app.pathshala_enrollments en where en.id = pl.source_ref_id)
   order by pl.pledged_at limit 1;
  if p.id is null then return null; end if;
  insert into app.rsvp_credit_releases (center_id, household_id, enrollment_id, pledge_id, released_cents, created_by, kind)
  values (new.center_id, p.household_id, p.source_ref_id, p.id, v_left, null, 'pathshala_late_payment');
  return null;
exception
  when query_canceled then
    perform app.log_audit(new.center_id, 'pathshala.late_payment_failed', 'payment_checkouts', new.id::text, null,
                          jsonb_build_object('error', 'the statement timed out'), 'A payment after a released seat could not be put in the credit queue');
    return null;
  when others then
    -- Never stop the payment from being recorded: the money is household credit either way.
    perform app.log_audit(new.center_id, 'pathshala.late_payment_failed', 'payment_checkouts', new.id::text, null,
                          jsonb_build_object('error', sqlerrm), 'A payment after a released seat could not be put in the credit queue');
    return null;
end $$;

create or replace function app.set_payment_processor(p_center uuid, p_processor text, p_methods text[], p_statement_descriptor text,
                                                     p_donor_covers_fee_allowed boolean, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare v_bad text[]; v_problem text;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_configure(p_center) then
    raise exception 'Changing the payment settings needs the owner, integrations.manage or giving.manage.' using errcode = '42501';
  end if;
  if p_processor not in ('stripe','paypal') then raise exception 'Choose Stripe or PayPal.' using errcode = '22023'; end if;
  if coalesce(p_donor_covers_fee_allowed, false) then
    raise exception 'Donors covering the processing fee is not offered yet, so no fee is ever added to a gift.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_methods), 0) = 0 then raise exception 'Choose at least one online method.' using errcode = '22023'; end if;
  select array_agg(m) into v_bad from unnest(p_methods) m where not (m = any (app.processor_methods(p_processor)));
  if v_bad is not null then
    raise exception '% does not take %.', initcap(p_processor), array_to_string(v_bad, ', ') using errcode = '22023';
  end if;
  v_problem := app.statement_descriptor_problem(p_statement_descriptor);
  if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
  perform app.payments_require_reason(p_reason, 'change the ' || initcap(p_processor) || ' settings');
  perform app.payment_processor_ensure(p_center, p_processor);
  update app.center_payment_processors
     set methods = (select array_agg(distinct m order by m) from unnest(p_methods) m),
         statement_descriptor = nullif(btrim(p_statement_descriptor), ''),
         donor_covers_fee_allowed = false,
         updated_by = auth.uid()
   where center_id = p_center and processor = p_processor;
end $$;

create or replace function app.fail_checkout(p_checkout uuid, p_error text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.payment_checkouts set status = 'failed', error = left(coalesce(p_error, 'The provider refused the checkout.'), 1000)
   where id = p_checkout and created_by = auth.uid() and status in ('created','pending');
end $$;

create or replace function app.checkout_status(p_checkout uuid)
returns jsonb language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('checkout_id', k.id, 'status', k.status, 'processor', k.processor, 'mode', k.mode,
                            'amount_cents', k.amount_cents, 'payment_id', k.payment_id, 'error', k.error, 'paid_at', k.paid_at,
                            'receipt_number', (select receipt_number from app.payments where id = k.payment_id))
    from app.payment_checkouts k
   where k.id = p_checkout
     and (k.created_by = auth.uid() or app.has_permission(k.center_id, 'giving.view') or app.payments_can_view(k.center_id))
$$;

create or replace function app.worker_checkout_json(k app.payment_checkouts) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare ic app.integration_connections;
begin
  select i.* into ic from app.center_payment_processors cp join app.integration_connections i on i.id = cp.connection_id
   where cp.center_id = k.center_id and cp.processor = k.processor;
  return jsonb_build_object('id', k.id, 'center_id', k.center_id, 'household_id', k.household_id, 'person_id', k.person_id,
           'processor', k.processor, 'mode', k.mode, 'context', k.context, 'amount_cents', k.amount_cents, 'currency', k.currency,
           'pledge_ids', to_jsonb(k.pledge_ids), 'status', k.status, 'provider_ref', k.provider_ref,
           'provider_payment_ref', k.provider_payment_ref, 'payment_id', k.payment_id,
           'account_id', ic.external_account_id, 'connect_method', ic.settings->>'connect_method',
           'payee_email', ic.settings->>'paypal_email');
end $$;

create or replace function app.worker_checkout_closed(p_checkout uuid, p_status text, p_error text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if p_status not in ('failed','cancelled','expired') then raise exception 'Unknown checkout outcome "%".', p_status; end if;
  perform app.set_audit_context('Checkout ' || p_status || coalesce(': ' || nullif(btrim(p_error), ''), ''));
  update app.payment_checkouts set status = p_status, error = left(p_error, 1000)
   where id = p_checkout and status in ('created','pending');
end $$;

-- The two functions whose signatures changed: the new form is dropped, the old one comes back with its grants.
drop function if exists app.create_checkout(uuid, uuid, bigint, uuid[], text, text, text, boolean, bigint, text, bigint);
create or replace function app.create_checkout(p_center uuid, p_household uuid, p_amount_cents bigint, p_pledge_ids uuid[],
                                               p_processor text, p_context text, p_for_label text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; cp app.center_payment_processors; ic app.integration_connections; v_id uuid; v_mode text; v_forced boolean;
        v_staff boolean; v_bad int; v_pledges uuid[] := coalesce(p_pledge_ids, '{}');
begin
  if auth.uid() is null then raise exception 'Sign in to pay.' using errcode = '42501'; end if;
  perform app.assert_module_enabled(p_center, 'giving');
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.' using errcode = '22023'; end if;
  if not exists (select 1 from app.households where id = p_household and center_id = p_center) then
    raise exception 'That family was not found in this community.' using errcode = '22023';
  end if;
  v_staff := app.has_permission(p_center, 'giving.manage');
  if not (app.adult_of_household(p_center, p_household) or v_staff) then
    raise exception 'Only an adult of the family can pay for it.' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents < 50 then raise exception 'The amount must be at least $0.50.' using errcode = '22023'; end if;
  if p_amount_cents > 100000000 then raise exception 'Online payments are limited to $1,000,000.' using errcode = '22023'; end if;
  if coalesce(p_context, '') not in ('rsvp','rsvp_later','pledges','opportunity','labh','store','other','portal','pathshala') then
    raise exception 'Unknown checkout context "%".', p_context using errcode = '22023';
  end if;
  if nullif(btrim(p_for_label), '') is null then raise exception 'Say what the payment is for.' using errcode = '22023'; end if;
  select count(*) into v_bad from unnest(v_pledges) x
   where not exists (select 1 from app.pledges pl where pl.id = x and pl.center_id = p_center and pl.household_id = p_household
                        and pl.status in ('open','partially_paid'));
  if v_bad > 0 then raise exception 'One of the pledges is not an open pledge of this family.' using errcode = '22023'; end if;
  if coalesce((c.rules #>> '{payments,offline_only}')::boolean, false) then
    raise exception '% takes offline payments only.', coalesce(c.short_name, c.name) using errcode = '22023';
  end if;

  select * into cp from app.center_payment_processors
   where center_id = p_center and status in ('test','live') and (p_processor is null or processor = p_processor)
   order by is_default desc, (status = 'live') desc, processor limit 1;
  if cp.center_id is null then
    raise exception 'Online payment is not set up for % yet.', coalesce(c.short_name, c.name) using errcode = '22023';
  end if;
  v_forced := c.environment = 'sandbox' or app.entitlement(p_center, 'payments.mode') = '"test"'::jsonb;
  if cp.status = 'test' and not v_forced then
    raise exception 'Online payment for % is still in test mode, so it cannot take real payments yet.', coalesce(c.short_name, c.name)
      using errcode = '22023';
  end if;
  select * into ic from app.integration_connections where id = cp.connection_id;
  if ic.id is null or ic.status <> 'connected' then
    raise exception '% is not connected right now.', initcap(cp.processor) using errcode = '22023';
  end if;
  v_mode := app.payment_api_mode(p_center, cp.processor);
  insert into app.payment_checkouts (center_id, household_id, person_id, processor, mode, context, amount_cents, currency,
                                     pledge_ids, for_label, created_by)
  values (p_center, p_household, app.my_person_id(p_center), cp.processor, v_mode, p_context, p_amount_cents, lower(coalesce(c.currency, 'usd')),
          v_pledges, left(btrim(p_for_label), 200), auth.uid())
  returning id into v_id;
  return jsonb_build_object('checkout_id', v_id, 'processor', cp.processor, 'mode', v_mode, 'amount_cents', p_amount_cents,
                            'currency', lower(coalesce(c.currency, 'usd')), 'account_id', ic.external_account_id,
                            'payee_email', case when ic.settings->>'connect_method' = 'email' then ic.settings->>'paypal_email' end,
                            'statement_descriptor', cp.statement_descriptor, 'methods', to_jsonb(cp.methods),
                            'center_name', c.name, 'for_label', left(btrim(p_for_label), 200));
end $$;
revoke execute on function app.create_checkout(uuid, uuid, bigint, uuid[], text, text, text) from public, anon;
grant execute on function app.create_checkout(uuid, uuid, bigint, uuid[], text, text, text) to authenticated, service_role;

drop function if exists app.worker_record_online_payment(uuid, text, bigint, bigint, text, text, bigint);
create or replace function app.worker_record_online_payment(p_checkout uuid, p_provider_ref text, p_amount_cents bigint,
                                                            p_fee_cents bigint, p_method text, p_detail text default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare k app.payment_checkouts; c app.centers; v_payment uuid; v_existing uuid; v_method app.payment_method; v_job bigint;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if nullif(btrim(p_provider_ref), '') is null then raise exception 'The provider''s payment reference is missing.'; end if;
  select * into k from app.payment_checkouts where id = p_checkout for update;
  if k.id is null then raise exception 'Checkout % was not found.', p_checkout; end if;
  if p_amount_cents is distinct from k.amount_cents then
    -- Never record an amount the checkout did not ask for; someone must look.
    raise exception '% reports % cents for checkout %, which asked for % cents. Not recorded.',
      initcap(k.processor), p_amount_cents, k.id, k.amount_cents;
  end if;
  if k.payment_id is not null or (k.context = 'processor_test' and k.status = 'paid') then
    return jsonb_build_object('duplicate', true, 'payment_id', k.payment_id, 'checkout_id', k.id);
  end if;
  select * into c from app.centers where id = k.center_id;
  perform app.set_audit_context('Paid online · ' || initcap(k.processor) || ' ' || btrim(p_provider_ref)
                                || case when k.mode = 'test' then ' (test mode)' else '' end);

  if k.context = 'processor_test' then
    update app.payment_checkouts set status = 'paid', provider_payment_ref = btrim(p_provider_ref), paid_at = now(), error = null
     where id = k.id;
    v_job := app.enqueue_job(k.center_id, 'payments.test_charge',
                             jsonb_build_object('checkout_id', k.id, 'provider_payment_ref', btrim(p_provider_ref)), now(), 5);
    return jsonb_build_object('test', true, 'checkout_id', k.id, 'refund_job', v_job);
  end if;

  select id into v_existing from app.payments
   where center_id = k.center_id and provider = k.processor and provider_ref = btrim(p_provider_ref);
  if v_existing is not null then
    update app.payment_checkouts set status = 'paid', payment_id = v_existing, provider_payment_ref = btrim(p_provider_ref),
                                     paid_at = coalesce(paid_at, now())
     where id = k.id;
    return jsonb_build_object('duplicate', true, 'payment_id', v_existing, 'checkout_id', k.id);
  end if;

  v_method := case when p_method in ('card','ach','apple_pay','google_pay','paypal','venmo') then p_method::app.payment_method
                   else 'card'::app.payment_method end;
  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, fee_cents, method, status, provider, provider_ref,
                            received_on, memo)
  values (k.center_id, k.household_id, k.person_id, k.amount_cents, greatest(coalesce(p_fee_cents, 0), 0), v_method, 'captured',
          k.processor, btrim(p_provider_ref), (now() at time zone coalesce(c.time_zone, 'America/Chicago'))::date,
          left('Paid online · ' || k.for_label || case when k.mode = 'test' then ' · test mode' else '' end
               || coalesce(' · ' || nullif(btrim(p_detail), ''), ''), 500))
  returning id into v_payment;
  -- The existing rules: the donor's chosen pledges first, else earliest open; overpayment rolls on.
  perform app.allocate_payment(v_payment, case when cardinality(k.pledge_ids) > 0 then k.pledge_ids end, true);
  perform app.enqueue_payment_posting(v_payment);
  update app.payment_checkouts set status = 'paid', payment_id = v_payment, provider_payment_ref = btrim(p_provider_ref),
                                   paid_at = now(), error = null
   where id = k.id;
  insert into app.sync_log (center_id, provider, direction, operation, record_table, record_id, external_ref, status, detail)
  values (k.center_id, k.processor, 'inbound', 'payment', 'payments', v_payment, btrim(p_provider_ref), 'ok',
          jsonb_build_object('checkout_id', k.id, 'mode', k.mode, 'amount_cents', k.amount_cents, 'fee_cents', coalesce(p_fee_cents, 0)));
  return jsonb_build_object('duplicate', false, 'payment_id', v_payment, 'checkout_id', k.id);
end $$;
revoke execute on function app.worker_record_online_payment(uuid, text, bigint, bigint, text, text) from public, anon, authenticated;
grant execute on function app.worker_record_online_payment(uuid, text, bigint, bigint, text, text) to connect_worker, service_role;

-- Functions added by 0862
drop function if exists app.payment_addons_quote(uuid, uuid, bigint, uuid[], text, text, boolean, bigint, text);
drop function if exists app._addons_compute(uuid, uuid, bigint, uuid[], text, text, text, boolean, bigint);
drop function if exists app._checkout_processor(uuid, text);
drop function if exists app.pledge_source_is_gift(text);
drop function if exists app.payment_fee_rates_for(uuid);
drop function if exists app.platform_set_fee_rate(uuid, text, integer, integer, integer, text, text);
drop function if exists app.fee_estimate(uuid, text, bigint);
drop function if exists app._fee_rate(uuid, text);
drop function if exists app._fee_cover(integer, integer, integer, bigint);
drop function if exists app._fee_charge(integer, integer, integer, bigint);
drop function if exists app._fee_class(text);
drop function if exists app.payments_addons_guard();
drop function if exists app.payment_allocation_gift_guard();
drop function if exists app.payment_fee_rates_insert_only();

-- Columns and constraints
alter table app.payment_checkouts drop constraint if exists payment_checkouts_addons_check;
alter table app.payment_checkouts drop constraint if exists payment_checkouts_pay_method_check;
alter table app.payment_checkouts
  drop column if exists gift_cents, drop column if exists total_cents, drop column if exists covered_fee_cents,
  drop column if exists chip_in_cents, drop column if exists application_fee_cents, drop column if exists pay_method,
  drop column if exists fee_rate_id;
comment on column app.payment_checkouts.amount_cents is null;
alter table app.payments drop constraint if exists payments_addons_check;
alter table app.payments drop constraint if exists payments_addons_stripe_only;
alter table app.payments
  drop column if exists gift_cents, drop column if exists chip_in_cents, drop column if exists application_fee_cents,
  drop column if exists charged_cents, drop column if exists provider_refunded_cents, drop column if exists application_fee_refunded_cents;
comment on column app.payments.donor_covered_fee_cents is null;

-- The rate table
drop table if exists app.payment_fee_rates;
delete from app.module_tables where table_name = 'payment_fee_rates';

-- The lock of 0410 on fee-cover (any organization that switched it on is switched off, with a reason in the audit log)
do $$ begin
  if exists (select 1 from app.center_payment_processors where donor_covers_fee_allowed) then
    perform app.set_audit_context('Rollback of 0862: donors covering the fee is not offered');
    update app.center_payment_processors set donor_covers_fee_allowed = false where donor_covers_fee_allowed;
  end if;
end $$;
alter table app.center_payment_processors drop constraint if exists center_payment_processors_fee_cover_stripe_only;
alter table app.center_payment_processors drop constraint if exists center_payment_processors_no_donor_fee;
alter table app.center_payment_processors add constraint center_payment_processors_no_donor_fee check (not donor_covers_fee_allowed);
comment on column app.center_payment_processors.donor_covers_fee_allowed is
  'Not offered yet (owner decision 2026-09-25 #5, backlog B7): always false; no fee is ever added to a gift.';

-- The demo keep list as 0861 left it (without payment_fee_rates)
create or replace function app.demo_keep_tables() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    -- the organization, its people in charge and its agreements
    'centers','center_owners','role_grants','org_agreements','org_profiles','org_leaders','org_documents',
    'center_entitlements','center_modules','number_sequences','support_grants',
    -- onboarding progress and go-live
    'center_setup_steps','center_attestations','golive_requests','golive_approvals','sandbox_codes','sandbox_expiry_notices','center_demo_state',
    -- connections, secrets and what the providers returned
    'integration_connections','integration_secrets','secret_access_log','oauth_states','webhook_events',
    'center_payment_processors','payment_processor_tests','paypal_email_verifications','center_payment_plugins',
    'email_domains','email_senders','messaging_settings','message_suppressions','texting_registrations',
    'whatsapp_accounts','whatsapp_template_submissions','sandbox_test_recipients','recipient_verifications',
    'center_domains','member_join_codes',
    'qbo_oauth_states','qbo_pull_runs','qbo_test_posts','qbo_accounts','qbo_classes','qbo_locations','qbo_items',
    'qbo_tax_codes','qbo_payment_methods','qbo_customers','qbo_transactions',
    -- templates and documents (Setup stage 2), saved import mappings and the organization's own pick-lists
    'legal_documents','message_templates','receipt_templates','import_mappings','dietary_options',
    -- history that is never deleted
    'audit_log','jobs',
    -- 0785: what a demo community's reset puts back
    'demo_qbo_links',
    -- 0861: the Weaver team's Chip In setting for the organization
    'chip_in_settings'
  ]::text[]
$$;

commit;
