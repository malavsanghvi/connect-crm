-- Wave E · stream e-money · 2 of 5: QuickBooks refunds and credit memos come in
-- as historical refunds (owner decision 2026-09-25 #11; backlog B3 closed).
--
-- Donor matching brings an approved QuickBooks customer's CreditMemo and
-- RefundReceipt history in as HISTORICAL REFUNDS that reduce the matching
-- historical payment brought in from the same customer (app.payment_refunds,
-- source 'qbo_history'). They are already in QuickBooks, so nothing is ever
-- posted back (no ledger posting is queued for a refund). The matching payment:
--   1. a SalesReceipt / Payment the refund itself links to in QuickBooks, else
--   2. the latest payment of exactly that amount (nothing refunded yet) dated on
--      or before the refund, else
--   3. the one payment dated on or before the refund with enough left on it.
-- Anything else stays in Needs review with the reason: no payment found, more
-- than one equally likely payment, or a credit memo that was APPLIED to an
-- invoice in QuickBooks (it lowered a pledge; no money went back, so the refund
-- rule does not cover it).
--
-- A refund brought in from the books has no two approvers in Community Connect:
-- the treasurer approved the donor match, and the refund already happened in
-- QuickBooks. The 0016 two-person trigger lets exactly that through — a
-- historical payment, written by the background service (no signed-in user),
-- inside app.qbo_bring_in_refund (which sets app.historical_refund). Every other
-- refund still needs two different people.
set client_min_messages = warning;

create or replace function app.enforce_two_person() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'payments' then
    if new.refunded_cents > coalesce(old.refunded_cents, 0) then
      if new.is_historical and auth.uid() is null and coalesce(current_setting('app.historical_refund', true), '') = 'on' then
        null;   -- a past refund brought in from QuickBooks history (0411)
      elsif new.refund_approved_by is null or new.refund_second_approver is null
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

-- Historical payments brought in from the refund's customer, dated on or before
-- it, with at least the refund's amount left on them.
create or replace function app.qbo_refund_candidates(p_center uuid, t app.qbo_transactions) returns setof app.payments
language sql stable security definer set search_path = app, public, extensions as $$
  select pa.* from app.payments pa
   where pa.id in (select x.cc_payment_id from app.qbo_transactions x
                    where x.center_id = p_center and x.customer_qbo_id = t.customer_qbo_id
                      and x.qbo_type in ('SalesReceipt','Payment') and x.cc_payment_id is not null)
     and pa.is_historical and pa.received_on <= t.txn_date and pa.amount_cents - pa.refunded_cents >= t.total_cents
$$;

-- One CreditMemo / RefundReceipt of an approved customer → {status, detail, payment_id}.
create or replace function app.qbo_bring_in_refund(p_center uuid, t app.qbo_transactions) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_ext text := 'qbo:' || t.qbo_type || ':' || t.qbo_id; r app.payment_refunds; p app.payments; l jsonb; n int;
  v_what text := format('QuickBooks %s %s', app.qbo_type_label(t.qbo_type), coalesce('#' || t.doc_number, t.qbo_id));
  v_amt text := to_char(t.total_cents / 100.0, 'FM$999,999,990.00');
  v_on text := to_char(t.txn_date, 'FMMonth FMDD, YYYY'); v_latest date;
begin
  select * into r from app.payment_refunds where center_id = p_center and provider = 'quickbooks' and provider_ref = v_ext;
  if r.id is not null then
    return jsonb_build_object('status', 'brought_in', 'already', true, 'payment_id', r.payment_id,
                              'detail', 'Brought in as a refund of a payment from QuickBooks history.');
  end if;
  if t.total_cents <= 0 then
    return jsonb_build_object('status', 'skipped', 'detail', format('A %s of $0 has nothing to bring in.', app.qbo_type_label(t.qbo_type)));
  end if;
  if t.qbo_type = 'CreditMemo' and exists (select 1 from jsonb_array_elements(t.linked) x where x->>'type' in ('Payment','Invoice')) then
    return jsonb_build_object('status', 'needs_review', 'detail',
      'This credit memo was applied to an invoice in QuickBooks: it lowered what was owed on a pledge and no money went back, so the refund rule (a refund reduces the payment it refunds) does not cover it.');
  end if;

  -- 1. The payment the refund names in QuickBooks.
  for l in select * from jsonb_array_elements(t.linked) loop
    continue when l->>'type' not in ('SalesReceipt','Payment');
    select pa.* into p from app.qbo_transactions x join app.payments pa on pa.id = x.cc_payment_id
     where x.center_id = p_center and x.qbo_type = l->>'type' and x.qbo_id = l->>'id';
    if p.id is null then
      return jsonb_build_object('status', 'needs_review', 'detail', format(
        'It refunds QuickBooks %s %s, which is not on a household yet. Bring that one in first, then Try again.',
        app.qbo_type_label(l->>'type'), l->>'id'));
    end if;
    exit;
  end loop;

  -- 2 and 3. A payment brought in from the same customer, dated on or before the refund.
  if p.id is null then
    select max(pa.received_on) into v_latest
      from app.qbo_refund_candidates(p_center, t) pa where pa.amount_cents = t.total_cents and pa.refunded_cents = 0;
    if v_latest is not null then
      select count(*) into n from app.qbo_refund_candidates(p_center, t) pa
       where pa.amount_cents = t.total_cents and pa.refunded_cents = 0 and pa.received_on = v_latest;
      if n > 1 then
        return jsonb_build_object('status', 'needs_review', 'detail', format(
          '%s payments of %s from this customer on %s could each be the one refunded. Record which one by hand.',
          n, v_amt, to_char(v_latest, 'FMMonth FMDD, YYYY')));
      end if;
      select pa.* into p from app.qbo_refund_candidates(p_center, t) pa
       where pa.amount_cents = t.total_cents and pa.refunded_cents = 0 and pa.received_on = v_latest;
    else
      select count(*) into n from app.qbo_refund_candidates(p_center, t);
      if n = 1 then
        select pa.* into p from app.qbo_refund_candidates(p_center, t) pa;
      elsif n > 1 then
        return jsonb_build_object('status', 'needs_review', 'detail', format(
          '%s payments from this customer on or before %s could each cover the %s refund, and none is exactly that amount. Record which one by hand.',
          n, v_on, v_amt));
      end if;
    end if;
  end if;
  if p.id is null then
    return jsonb_build_object('status', 'needs_review', 'detail', format(
      'No payment brought in from this QuickBooks customer, dated on or before %s, has %s left to refund. If the payment is older than the history window or still waits here, bring it in first, then Try again.',
      v_on, v_amt));
  end if;
  if p.amount_cents - p.refunded_cents < t.total_cents then
    return jsonb_build_object('status', 'needs_review', 'detail', format(
      'The payment it refunds (%s) has only %s left to refund.', coalesce(p.receipt_number, p.crm_external_id),
      to_char((p.amount_cents - p.refunded_cents) / 100.0, 'FM$999,999,990.00')));
  end if;

  perform set_config('app.historical_refund', 'on', true);
  perform app._apply_refund_to_payment(p.id, t.total_cents, null, null, v_what || coalesce(' · ' || t.memo, ''));
  perform set_config('app.historical_refund', 'off', true);
  insert into app.payment_refunds (center_id, payment_id, source, provider, amount_cents, refunded_on, provider_ref, reason, status,
                                   applied_at, detail)
  values (p_center, p.id, 'qbo_history', 'quickbooks', t.total_cents, t.txn_date, v_ext, left(coalesce(t.memo, v_what), 1000), 'applied', now(),
          left(v_what || ' brought in from QuickBooks history as a refund of ' || coalesce(p.receipt_number, p.crm_external_id, 'the payment')
               || '. It is already in QuickBooks, so it is never posted back.', 1000));
  return jsonb_build_object('status', 'brought_in', 'already', false, 'payment_id', p.id,
                            'detail', format('Brought in as a %s refund of payment %s (%s).', v_amt,
                                             coalesce(p.receipt_number, p.crm_external_id), to_char(p.received_on, 'FMMonth FMDD, YYYY')));
exception when others then
  perform set_config('app.historical_refund', 'off', true);
  raise;
end $$;

create or replace function app.qbo_bring_in_customer(p_center uuid, p_qbo text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  m app.qbo_customer_matches; c app.qbo_customers; t app.qbo_transactions; h app.households;
  v_payer uuid; v_fund record; v_ext text; v_pay uuid; v_pledge uuid; v_linked bigint; v_paid bigint; v_link jsonb;
  v_inv app.qbo_transactions; v_alloc bigint; v_detail text; v_method app.payment_method; v_memo text;
  n_in int := 0; n_review int := 0; n_skip int := 0; n_already int := 0; v_approver text; v_refund jsonb;
begin
  select * into m from app.qbo_customer_matches where center_id = p_center and qbo_customer_id = p_qbo and status = 'approved';
  if m.id is null then return jsonb_build_object('status', 'not_mapped'); end if;
  select * into c from app.qbo_customers where center_id = p_center and qbo_id = p_qbo;
  select * into h from app.households where id = m.household_id;
  if not app.module_enabled(p_center, 'giving') then
    raise exception 'Pledges & donations is switched off, so QuickBooks history cannot be brought in.';
  end if;
  select coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), 'the treasury') into v_approver
    from app.center_users cu join app.people p on p.id = cu.person_id where cu.center_id = p_center and cu.user_id = m.decided_by;
  perform app.set_audit_context(format('QuickBooks history · %s → %s · match approved by %s: %s',
                                       c.display_name, h.display_name, coalesce(v_approver, 'the treasury'), coalesce(m.reason, 'approved')),
                                gen_random_uuid());
  v_payer := coalesce(m.person_id, app.qbo_primary_member(m.household_id));
  if v_payer is null then
    update app.qbo_transactions set cc_status = 'needs_review', cc_at = now(),
           cc_detail = format('Choose the primary member of %s: a family-level QuickBooks account is recorded against the primary member.', h.display_name)
     where center_id = p_center and customer_qbo_id = p_qbo and cc_status in ('pending','needs_review');
    get diagnostics n_review = row_count;
    return jsonb_build_object('status', 'needs_primary', 'needs_review', n_review);
  end if;

  for t in select * from app.qbo_transactions
            where center_id = p_center and customer_qbo_id = p_qbo and cc_status in ('pending','needs_review')
            order by case qbo_type when 'Invoice' then 1 when 'SalesReceipt' then 2 when 'Payment' then 3 else 4 end, txn_date, qbo_id loop
    v_ext := 'qbo:' || t.qbo_type || ':' || t.qbo_id;
    begin
      if t.qbo_type in ('JournalEntry', 'Deposit') then
        perform app.qbo_mark(p_center, t, 'skipped', 'Not a donor''s transaction; it stays in QuickBooks only.');
        n_skip := n_skip + 1; continue;
      end if;
      if t.qbo_type in ('CreditMemo', 'RefundReceipt') then
        -- Owner decision 2026-09-25 #11: a historical refund reducing the payment it refunds (0411).
        v_refund := app.qbo_bring_in_refund(p_center, t);
        perform app.qbo_mark(p_center, t, v_refund->>'status', v_refund->>'detail', (v_refund->>'payment_id')::uuid);
        if v_refund->>'status' = 'brought_in' then
          if (v_refund->>'already')::boolean then n_already := n_already + 1; else n_in := n_in + 1; end if;
        elsif v_refund->>'status' = 'skipped' then n_skip := n_skip + 1;
        else n_review := n_review + 1; end if;
        continue;
      end if;
      if t.total_cents <= 0 then
        perform app.qbo_mark(p_center, t, 'skipped', format('A %s of $0 has nothing to bring in.', app.qbo_type_label(t.qbo_type)));
        n_skip := n_skip + 1; continue;
      end if;
      select * into v_fund from app.qbo_txn_fund(p_center, t);

      if t.qbo_type = 'Invoice' then
        select id into v_pledge from app.pledges where center_id = p_center and crm_external_id = v_ext;
        if v_pledge is not null then
          perform app.qbo_mark(p_center, t, 'brought_in', v_fund.note, null, v_pledge, v_fund.fund_id);
          n_already := n_already + 1; continue;
        end if;
        -- Payments pulled from QuickBooks that paid this invoice must add up to what QuickBooks says was paid.
        select coalesce(sum((l->>'amount_cents')::bigint), 0) into v_linked
          from app.qbo_transactions p cross join lateral jsonb_array_elements(p.linked) l
         where p.center_id = p_center and p.qbo_type = 'Payment' and l->>'type' = 'Invoice' and l->>'id' = t.qbo_id;
        v_paid := t.total_cents - t.open_balance_cents;
        if v_linked <> v_paid then
          perform app.qbo_mark(p_center, t, 'needs_review', format(
            'QuickBooks shows $%s paid on invoice %s, but the payments pulled from QuickBooks for it add up to $%s (a credit applied, or a payment outside the history window). It was not brought in, so no balance is wrong.',
            to_char(v_paid / 100.0, 'FM999,999,990.00'), coalesce(t.doc_number, t.qbo_id), to_char(v_linked / 100.0, 'FM999,999,990.00')));
          n_review := n_review + 1; continue;
        end if;
        insert into app.pledges (center_id, household_id, pledged_by_person_id, fund_id, source, amount_cents, paid_cents, status,
                                 pledged_at, due_on, crm_external_id, created_by)
        values (p_center, m.household_id, v_payer, v_fund.fund_id, 'general', t.total_cents, 0, 'open',
                t.txn_date::timestamptz, (t.raw->>'DueDate')::date, v_ext, m.decided_by)
        returning id into v_pledge;
        perform app.qbo_mark(p_center, t, 'brought_in', v_fund.note, null, v_pledge, v_fund.fund_id);
        n_in := n_in + 1; continue;
      end if;

      -- SalesReceipt / Payment → a historical payment.
      select id into v_pay from app.payments where center_id = p_center and crm_external_id = v_ext;
      if v_pay is not null then
        perform app.qbo_mark(p_center, t, 'brought_in', v_fund.note, v_pay, null, v_fund.fund_id);
        n_already := n_already + 1; continue;
      end if;
      -- A payment that paid invoices waits until each of them is on the household.
      v_detail := null;
      for v_link in select * from jsonb_array_elements(t.linked) loop
        continue when v_link->>'type' <> 'Invoice';
        select * into v_inv from app.qbo_transactions where center_id = p_center and qbo_type = 'Invoice' and qbo_id = v_link->>'id';
        if v_inv.cc_pledge_id is null then
          v_detail := format('It paid invoice %s, which is not on a household yet%s.', coalesce(v_inv.doc_number, v_link->>'id'),
                             case when v_inv.cc_detail is not null then ' (' || v_inv.cc_detail || ')' else '' end);
          exit;
        elsif (select household_id from app.pledges where id = v_inv.cc_pledge_id) is distinct from m.household_id then
          v_detail := format('It paid invoice %s, which is on a different household.', coalesce(v_inv.doc_number, v_link->>'id'));
          exit;
        end if;
      end loop;
      if v_detail is not null then
        perform app.qbo_mark(p_center, t, 'needs_review', v_detail);
        n_review := n_review + 1; continue;
      end if;
      select coalesce(sum((l->>'amount_cents')::bigint), 0) into v_alloc from jsonb_array_elements(t.linked) l where l->>'type' = 'Invoice';
      if v_alloc > t.total_cents then
        perform app.qbo_mark(p_center, t, 'needs_review', 'The invoices it paid add up to more than the payment itself.');
        n_review := n_review + 1; continue;
      end if;
      -- A payment's fund is the fund of the invoice (pledge) it paid; only an unapplied one falls back.
      if t.qbo_type = 'Payment' and v_alloc > 0 then
        select f.id as fund_id, f.name as fund_name, null::text as note into v_fund
          from jsonb_array_elements(t.linked) l
          join app.qbo_transactions i on i.center_id = p_center and i.qbo_type = 'Invoice' and i.qbo_id = l->>'id'
          join app.pledges pl on pl.id = i.cc_pledge_id
          left join app.funds f on f.id = pl.fund_id
         where l->>'type' = 'Invoice' order by (l->>'amount_cents')::bigint desc limit 1;
      end if;
      v_method := app.qbo_payment_method(t.payment_method);
      v_memo := concat_ws(' · ', format('QuickBooks %s %s', app.qbo_type_label(t.qbo_type), coalesce('#' || t.doc_number, t.qbo_id)),
                          case when v_fund.fund_name is not null then 'Fund: ' || v_fund.fund_name end, t.memo);
      insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, provider_ref,
                                check_number, received_on, recorded_by, memo, is_historical, crm_external_id)
      values (p_center, m.household_id, v_payer, t.total_cents, v_method, 'settled', 'quickbooks', t.qbo_type || ':' || t.qbo_id,
              case when v_method = 'check' then t.reference_number end, t.txn_date, m.decided_by, left(v_memo, 500), true, v_ext)
      returning id into v_pay;
      -- Allocations exactly as QuickBooks applied them; the recompute trigger moves the pledge balance.
      insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents)
      select p_center, v_pay, i.cc_pledge_id, sum((l->>'amount_cents')::bigint)
        from jsonb_array_elements(t.linked) l
        join app.qbo_transactions i on i.center_id = p_center and i.qbo_type = 'Invoice' and i.qbo_id = l->>'id'
       where l->>'type' = 'Invoice' and (l->>'amount_cents')::bigint > 0
       group by i.cc_pledge_id;
      perform app.qbo_mark(p_center, t, 'brought_in', v_fund.note, v_pay, null, v_fund.fund_id);
      n_in := n_in + 1;
    exception when others then
      -- One transaction failing never stops the rest; it waits with the reason.
      perform app.qbo_mark(p_center, t, 'needs_review', 'Could not be brought in: ' || sqlerrm);
      n_review := n_review + 1;
    end;
  end loop;
  -- A remap after bring-in: anything already here follows the current match.
  perform app.qbo_repoint_history(p_center, p_qbo, m.household_id, v_payer);
  return jsonb_build_object('status', 'done', 'brought_in', n_in, 'already', n_already, 'needs_review', n_review, 'skipped', n_skip);
end $$;


revoke execute on function app.qbo_bring_in_refund(uuid, app.qbo_transactions), app.qbo_refund_candidates(uuid, app.qbo_transactions),
  app.qbo_bring_in_customer(uuid, text)
  from public, anon, authenticated;
grant execute on function app.qbo_bring_in_refund(uuid, app.qbo_transactions), app.qbo_refund_candidates(uuid, app.qbo_transactions)
  to service_role;
