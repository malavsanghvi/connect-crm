-- Wave E · stream e-money · 6: a recorded refund is never sent or recorded twice.
--
-- Recording a refund (through the provider, by hand for email-only PayPal, or a
-- flagged dashboard refund approved by two people) leaves both approvers on the
-- payment, because the 0016 two-person trigger checks them there. Without a guard
-- the same approved request could then be sent to Stripe/PayPal (or recorded by
-- hand) a second time. Owner decision 2026-09-25 #8 is "one refund request per
-- payment for now" (backlog B8), so once a refund is recorded on a payment,
-- request_provider_refund and record_manual_paypal_refund refuse with a plain
-- message; a refund the provider already reported (flagged) is approved, never
-- sent again. Nothing else about refunds changes.
set client_min_messages = warning;

create or replace function app.request_provider_refund(p_payment uuid, p_reason text)
returns bigint language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.payments; v_job bigint;
begin
  select * into p from app.payments where id = p_payment;
  if p.id is null then raise exception 'That payment was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(p.center_id, 'giving');
  if not app.has_permission(p.center_id, 'giving.manage') then
    raise exception 'Refunding a payment needs giving.manage.' using errcode = '42501';
  end if;
  if coalesce(p.provider, '') not in ('stripe','paypal') then
    raise exception 'This payment was not taken online; record its refund by hand instead.' using errcode = '22023';
  end if;
  if p.refund_approved_by is null or p.refund_second_approver is null or p.refund_approved_by = p.refund_second_approver then
    raise exception 'A refund needs two different approvers: request it, then a second person with giving.approve approves it.'
      using errcode = '22023';
  end if;
  if p.refunded_cents > 0 then
    raise exception 'A refund is already recorded on this payment (%). One refund request per payment for now, so it is not sent again.',
      to_char(p.refunded_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
  end if;
  if exists (select 1 from app.payment_refunds where payment_id = p.id and status = 'flagged') then
    raise exception '% already reported a refund on this payment; approve that flagged refund instead of sending another.', initcap(p.provider)
      using errcode = '22023';
  end if;
  if coalesce(p.refund_requested_cents, 0) <= 0 or p.refund_requested_cents > p.amount_cents - p.refunded_cents then
    raise exception 'The requested refund is more than what is left on this payment.' using errcode = '22023';
  end if;
  if exists (select 1 from app.jobs where kind = 'payments.refund' and status in ('queued','running') and payload->>'payment_id' = p.id::text) then
    raise exception 'A refund of this payment is already on its way to %.', initcap(p.provider) using errcode = '22023';
  end if;
  perform app.assert_step_up('giving.refund');
  perform app.payments_require_reason(coalesce(nullif(btrim(p_reason), ''), p.refund_reason), 'refund through ' || initcap(p.provider));
  v_job := app.enqueue_job(p.center_id, 'payments.refund',
                           jsonb_build_object('payment_id', p.id, 'amount_cents', p.refund_requested_cents,
                                              'refunded_before', p.refunded_cents, 'provider', p.provider), now(), 5);
  return v_job;
end $$;

create or replace function app.record_manual_paypal_refund(p_payment uuid, p_amount_cents bigint, p_refunded_on date,
                                                           p_paypal_txn text, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.payments; v_txn text := upper(btrim(coalesce(p_paypal_txn, ''))); v_total bigint; v_id uuid; c app.centers;
begin
  select * into p from app.payments where id = p_payment for update;
  if p.id is null then raise exception 'That payment was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(p.center_id, 'giving');
  if not app.has_permission(p.center_id, 'giving.manage') then
    raise exception 'Recording a refund needs giving.manage.' using errcode = '42501';
  end if;
  if coalesce(p.provider, '') <> 'paypal' then
    raise exception 'Only a PayPal payment is recorded this way.' using errcode = '22023';
  end if;
  if not app.paypal_email_only(p.center_id) then
    raise exception 'This PayPal account is connected with permission to refund: use "Refund through PayPal" instead.' using errcode = '22023';
  end if;
  if p.refund_approved_by is null or p.refund_second_approver is null or p.refund_approved_by = p.refund_second_approver then
    raise exception 'A refund needs two different approvers: request it, then a second person with giving.approve approves it.'
      using errcode = '22023';
  end if;
  if p.refunded_cents > 0 then
    raise exception 'A refund is already recorded on this payment (%). One refund request per payment for now.',
      to_char(p.refunded_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
  end if;
  if exists (select 1 from app.payment_refunds where payment_id = p.id and status = 'flagged') then
    raise exception 'PayPal already reported a refund on this payment; approve that flagged refund instead of recording it again.'
      using errcode = '22023';
  end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Enter the amount refunded in PayPal.' using errcode = '22023'; end if;
  if v_txn !~ '^[A-Z0-9]{10,30}$' then
    raise exception 'Enter the PayPal transaction id of the refund (letters and digits, e.g. 1AB23456CD789012E).' using errcode = '22023';
  end if;
  select * into c from app.centers where id = p.center_id;
  if p_refunded_on is null or p_refunded_on < p.received_on
     or p_refunded_on > (now() at time zone coalesce(c.time_zone, 'America/Chicago'))::date then
    raise exception 'Enter the date PayPal made the refund: on or after the payment (%), and not in the future.',
      to_char(p.received_on, 'FMMonth FMDD, YYYY') using errcode = '22023';
  end if;
  if exists (select 1 from app.payment_refunds where center_id = p.center_id and provider = 'paypal' and provider_ref = v_txn) then
    raise exception 'PayPal transaction % is already recorded as a refund.', v_txn using errcode = '22023';
  end if;
  perform app.assert_step_up('giving.refund');
  perform app.payments_require_reason(coalesce(nullif(btrim(p_reason), ''), p.refund_reason), 'record the refund made in PayPal');
  v_total := app._apply_refund_to_payment(p.id, p_amount_cents, p.refund_approved_by, p.refund_second_approver, p.refund_reason);
  insert into app.payment_refunds (center_id, payment_id, source, provider, amount_cents, refunded_on, provider_ref, reason, status,
                                   first_approver, first_approved_at, second_approver, second_approved_at, applied_at, detail)
  values (p.center_id, p.id, 'manual_paypal', 'paypal', p_amount_cents, p_refunded_on, v_txn,
          left(coalesce(nullif(btrim(p_reason), ''), p.refund_reason), 1000),
          'applied', p.refund_approved_by, null, p.refund_second_approver, null, now(),
          format('Recorded by %s from PayPal (the account is connected by email only).', app.refund_person_name(p.center_id, auth.uid())))
  returning id into v_id;
  insert into app.sync_log (center_id, provider, direction, operation, record_table, record_id, external_ref, status, detail)
  values (p.center_id, 'paypal', 'inbound', 'refund_recorded_by_hand', 'payments', p.id, v_txn, 'ok',
          jsonb_build_object('amount_cents', p_amount_cents, 'refunded_on', p_refunded_on, 'refund_id', v_id));
  return jsonb_build_object('refund_id', v_id, 'refunded_cents', v_total);
end $$;
