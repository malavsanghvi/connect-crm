-- Wave E · stream e-money · 1 of 5: the owner's decisions of 2026-09-25 on fees
-- and refunds (docs/DECISIONS.md, row "Owner decisions batch (2026-09-25)").
--
--   #5  No donor-covers-fee charge for now. No fee is ever added to a gift; the
--       setting stays as a column (center_payment_processors.donor_covers_fee_allowed)
--       but can no longer be switched on (check constraint + set_payment_processor
--       refuses it). Backlog B7 keeps the rule to write when it is offered.
--   #6  A refund made in the Stripe or PayPal dashboard (reported by the provider's
--       webhook) is recorded as a FLAGGED refund in app.payment_refunds. It changes
--       nothing on the payment or its allocations until a person with the refund
--       permission (giving.manage) and a different second approver (giving.approve)
--       approve it after the fact (app.approve_flagged_refund, fresh 2FA check and a
--       reason each). The second approval records it exactly as any refund is
--       recorded (refunded_cents, refunded / partially_refunded; the two-person
--       trigger of 0016 still checks both names). Nothing is lost or hidden: the
--       flagged row is listed on Giving › Payments, counted on the home tasks and
--       month-end close, and named in readiness check 6.
--   #7  A PayPal account connected by its Business email only gives Community Connect
--       no permission to refund through it. Its refunds are made in PayPal and then
--       recorded here by hand (amount, date, PayPal transaction id, reason) after the
--       EXISTING two-person approval (request → approve_as_second → record):
--       app.record_manual_paypal_refund.
--
-- app.payment_refunds keeps every refund that did not start as a Community Connect
-- refund request: the flagged dashboard refunds (#6), the hand-recorded PayPal
-- refunds (#7) and the refunds brought in from QuickBooks history (#11, 0411).
-- One row per provider reference, so a replayed webhook or a double click never
-- records a refund twice.
set client_min_messages = warning;

-- ── #5 Donor covers the fee: not offered ─────────────────────────────────────
do $$ begin
  if exists (select 1 from app.center_payment_processors where donor_covers_fee_allowed) then
    perform app.set_audit_context('Owner decision 2026-09-25 (#5): donors covering the fee is not offered yet');
    update app.center_payment_processors set donor_covers_fee_allowed = false where donor_covers_fee_allowed;
  end if;
end $$;
alter table app.center_payment_processors drop constraint if exists center_payment_processors_no_donor_fee;
alter table app.center_payment_processors add constraint center_payment_processors_no_donor_fee check (not donor_covers_fee_allowed);
comment on column app.center_payment_processors.donor_covers_fee_allowed is
  'Not offered yet (owner decision 2026-09-25 #5, backlog B7): always false; no fee is ever added to a gift.';

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

-- ── Refunds that did not start as a Community Connect request ────────────────
create table if not exists app.payment_refunds (
  id                 uuid primary key default gen_random_uuid(),
  center_id          uuid not null references app.centers(id) on delete cascade,
  payment_id         uuid not null references app.payments(id) on delete cascade,
  source             text not null check (source in ('provider_dashboard','manual_paypal','qbo_history')),
  provider           text not null check (provider in ('stripe','paypal','quickbooks')),
  amount_cents       bigint not null check (amount_cents > 0),
  refunded_on        date,
  provider_ref       text not null check (char_length(provider_ref) between 1 and 200),
  reason             text check (reason is null or char_length(reason) <= 1000),
  status             text not null default 'flagged' check (status in ('flagged','applied')),
  first_approver     uuid references auth.users(id),
  first_approved_at  timestamptz,
  second_approver    uuid references auth.users(id),
  second_approved_at timestamptz,
  applied_at         timestamptz,
  detail             text check (detail is null or char_length(detail) <= 1000),
  created_at         timestamptz not null default now(),
  unique (center_id, provider, provider_ref),
  -- Only history brought in from the books is recorded without two different people.
  constraint payment_refunds_two_people check (
    status <> 'applied' or source = 'qbo_history'
    or (first_approver is not null and second_approver is not null and first_approver <> second_approver))
);
comment on table app.payment_refunds is
  'Refunds that did not start as a Community Connect refund request: made in the Stripe/PayPal dashboard (flagged until two people approve), recorded by hand for email-only PayPal accounts, or brought in from QuickBooks history (owner decisions 2026-09-25 #6, #7, #11).';
create index if not exists payment_refunds_payment_idx on app.payment_refunds (payment_id);
create index if not exists payment_refunds_flagged_idx on app.payment_refunds (center_id) where status = 'flagged';

insert into app.module_tables (table_name, module_key) values ('payment_refunds', 'giving')
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_payment_refunds on app.payment_refunds;
create trigger audit_payment_refunds after insert or update or delete on app.payment_refunds
  for each row execute function app.audit_row();

alter table app.payment_refunds enable row level security;
drop policy if exists payment_refunds_read on app.payment_refunds;
create policy payment_refunds_read on app.payment_refunds for select to authenticated
  using (app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.manage')
         or app.has_permission(center_id, 'giving.approve'));
drop policy if exists module_switch on app.payment_refunds;
create policy module_switch on app.payment_refunds as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])));
revoke all on app.payment_refunds from public, anon, authenticated, connect_worker;
grant select on app.payment_refunds to authenticated;
grant all on app.payment_refunds to service_role;

-- A person's name for messages (falls back to the login email).
create or replace function app.refund_person_name(p_center uuid, p_user uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(
    (select coalesce(nullif(pe.preferred_name, ''), pe.first_name) || ' ' || pe.last_name
       from app.center_users cu join app.people pe on pe.id = cu.person_id
      where cu.center_id = p_center and cu.user_id = p_user limit 1),
    (select email::text from auth.users where id = p_user),
    'someone')
$$;

-- Record a refund on the payment the way every refund is recorded. Only these
-- functions call it; the 0016 trigger still requires two different approvers
-- (history brought in from QuickBooks sets app.historical_refund, 0411).
create or replace function app._apply_refund_to_payment(p_payment uuid, p_amount bigint, p_first uuid, p_second uuid, p_reason text)
returns bigint language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.payments; v_total bigint;
begin
  select * into p from app.payments where id = p_payment for update;
  if p.id is null then raise exception 'That payment was not found.' using errcode = '22023'; end if;
  v_total := p.refunded_cents + p_amount;
  if p_amount <= 0 or v_total > p.amount_cents then
    raise exception 'A refund of % on a % payment (% already refunded) is more than what is left on it.',
      to_char(p_amount / 100.0, 'FM$999,999,990.00'), to_char(p.amount_cents / 100.0, 'FM$999,999,990.00'),
      to_char(p.refunded_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
  end if;
  update app.payments
     set refund_approved_by = coalesce(p_first, refund_approved_by), refund_second_approver = coalesce(p_second, refund_second_approver),
         refund_reason = left(coalesce(nullif(btrim(p_reason), ''), refund_reason), 1000), refund_requested_cents = p_amount,
         refunded_cents = v_total,
         status = (case when v_total = amount_cents then 'refunded' else 'partially_refunded' end)::app.payment_status
   where id = p.id;
  return v_total;
end $$;

-- ── #6 The provider says money was refunded that Community Connect did not record ──
-- Called by the webhook handlers (connect_worker). p_total_refunded is the
-- provider's running total for the charge / capture. The difference from what is
-- recorded (and already flagged) becomes ONE flagged refund; a replay of the same
-- event, or a later event with the same total, finds nothing left to flag.
-- Refunds Community Connect itself sent (payments.refund) are already in
-- refunded_cents once recorded; while one is still on its way the event is tried
-- again later (the job fails with a plain message and the queue retries it).
create or replace function app.worker_flag_provider_refund(p_provider text, p_payment_ref text, p_total_refunded bigint,
                                                           p_refund_ref text, p_refunded_on date, p_event_type text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.payments; v_pending bigint; v_diff bigint; v_id uuid; v_ref text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if p_provider not in ('stripe','paypal') then raise exception 'Unknown payment provider "%".', p_provider; end if;
  select * into p from app.payments where provider = p_provider and provider_ref = btrim(coalesce(p_payment_ref, '')) limit 1;
  if p.id is null then return jsonb_build_object('outcome', 'not_ours'); end if;
  perform 1 from app.payments where id = p.id for update;
  if exists (select 1 from app.jobs where kind = 'payments.refund' and status in ('queued','running') and payload->>'payment_id' = p.id::text) then
    raise exception 'A refund Community Connect sent to % for this payment is still being recorded; this event is checked again shortly.',
      initcap(p_provider);
  end if;
  select coalesce(sum(amount_cents), 0) into v_pending from app.payment_refunds where payment_id = p.id and status = 'flagged';
  v_diff := coalesce(p_total_refunded, 0) - p.refunded_cents - v_pending;
  if v_diff <= 0 then
    return jsonb_build_object('outcome', 'already_recorded', 'payment_id', p.id, 'refunded_cents', p.refunded_cents, 'flagged_cents', v_pending);
  end if;
  if v_diff > p.amount_cents - p.refunded_cents - v_pending then
    v_diff := p.amount_cents - p.refunded_cents - v_pending;
    if v_diff <= 0 then return jsonb_build_object('outcome', 'already_recorded', 'payment_id', p.id); end if;
  end if;
  v_ref := coalesce(nullif(btrim(p_refund_ref), ''), p_provider || ':' || p.provider_ref || ':total:' || p_total_refunded);
  perform app.set_audit_context(left('Refund made in the ' || initcap(p_provider) || ' dashboard · ' || v_ref
                                     || ' · flagged: needs two approvals before it is recorded', 500));
  insert into app.payment_refunds (center_id, payment_id, source, provider, amount_cents, refunded_on, provider_ref, status, detail)
  values (p.center_id, p.id, 'provider_dashboard', p_provider, v_diff, coalesce(p_refunded_on, current_date), v_ref, 'flagged',
          left(format('%s reported %s refunded in total (%s event); Community Connect had recorded %s.', initcap(p_provider),
                      to_char(p_total_refunded / 100.0, 'FM$999,999,990.00'), coalesce(p_event_type, 'refund'),
                      to_char(p.refunded_cents / 100.0, 'FM$999,999,990.00')), 1000))
  on conflict (center_id, provider, provider_ref) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('outcome', 'already_flagged', 'payment_id', p.id);
  end if;
  insert into app.sync_log (center_id, provider, direction, operation, record_table, record_id, external_ref, status, detail)
  values (p.center_id, p_provider, 'inbound', 'refund_flagged', 'payment_refunds', v_id, v_ref, 'ok',
          jsonb_build_object('payment_id', p.id, 'amount_cents', v_diff, 'provider_total_cents', p_total_refunded));
  return jsonb_build_object('outcome', 'flagged', 'refund_id', v_id, 'payment_id', p.id, 'amount_cents', v_diff, 'center_id', p.center_id);
end $$;

-- Two people approve a flagged refund after the fact. The first needs the refund
-- permission (giving.manage); the second a DIFFERENT person with giving.approve.
-- Each gives a reason and passes a fresh 2FA check. The second approval records it.
create or replace function app.approve_flagged_refund(p_refund uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.payment_refunds; v_total bigint;
begin
  select * into r from app.payment_refunds where id = p_refund for update;
  if r.id is null then raise exception 'That refund was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(r.center_id, 'giving');
  if r.status <> 'flagged' then raise exception 'This refund is already recorded.' using errcode = '22023'; end if;
  if r.first_approver is null then
    if not app.has_permission(r.center_id, 'giving.manage') then
      raise exception 'The first approval of a refund needs giving.manage.' using errcode = '42501';
    end if;
    perform app.assert_step_up('giving.refund');
    perform app.payments_require_reason(p_reason, 'approve the refund made in ' || initcap(r.provider));
    update app.payment_refunds set first_approver = auth.uid(), first_approved_at = now(),
                                   reason = left(btrim(p_reason), 1000)
     where id = r.id;
    return jsonb_build_object('stage', 'first', 'refund_id', r.id);
  end if;
  if not app.has_permission(r.center_id, 'giving.approve') then
    raise exception 'The second approval of a refund needs giving.approve.' using errcode = '42501';
  end if;
  if r.first_approver = auth.uid() then
    raise exception 'The second approver must be a different person from the first (%).', app.refund_person_name(r.center_id, r.first_approver)
      using errcode = '22023';
  end if;
  perform app.assert_step_up('giving.refund');
  perform app.payments_require_reason(p_reason, 'approve the refund made in ' || initcap(r.provider));
  v_total := app._apply_refund_to_payment(r.payment_id, r.amount_cents, r.first_approver, auth.uid(),
                                          coalesce(r.reason, p_reason) || ' · refunded in the ' || initcap(r.provider) || ' dashboard (' || r.provider_ref || ')');
  update app.payment_refunds set second_approver = auth.uid(), second_approved_at = now(), status = 'applied', applied_at = now()
   where id = r.id;
  return jsonb_build_object('stage', 'applied', 'refund_id', r.id, 'refunded_cents', v_total);
end $$;

-- ── #7 PayPal connected by email only: the refund is recorded by hand ────────
create or replace function app.paypal_email_only(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select ic.settings->>'connect_method' = 'email'
                     from app.center_payment_processors cp join app.integration_connections ic on ic.id = cp.connection_id
                    where cp.center_id = p_center and cp.processor = 'paypal'), false)
$$;

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

-- ── What the screens and alerts read ─────────────────────────────────────────
-- Flagged refunds waiting for approval, with the payment and who approved first.
create or replace function app.flagged_refunds(p_center uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'payment_id', r.payment_id, 'provider', r.provider, 'amount_cents', r.amount_cents, 'refunded_on', r.refunded_on,
           'provider_ref', r.provider_ref, 'detail', r.detail, 'reason', r.reason, 'created_at', r.created_at,
           'first_approver', r.first_approver,
           'first_approver_name', case when r.first_approver is not null then app.refund_person_name(r.center_id, r.first_approver) end,
           'receipt_number', p.receipt_number, 'household_id', p.household_id, 'payment_amount_cents', p.amount_cents,
           'refunded_cents', p.refunded_cents, 'received_on', p.received_on) order by r.created_at), '[]'::jsonb)
    from app.payment_refunds r join app.payments p on p.id = r.payment_id
   where r.center_id = p_center and r.status = 'flagged'
     and (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.manage') or app.has_permission(p_center, 'giving.approve'))
$$;

create or replace function app.flagged_refund_count(p_center uuid) returns int
language sql stable security definer set search_path = app, public, extensions as $$
  select count(*)::int from app.payment_refunds where center_id = p_center and status = 'flagged'
$$;

-- Readiness check 6 names flagged refunds (it does not fail on them: payments stay live).
do $$ begin
  if to_regprocedure('app._check_payments_live_before_0410(uuid)') is null then
    alter function app.check_payments_live(uuid) rename to _check_payments_live_before_0410;
  end if;
end $$;
create or replace function app.check_payments_live(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb := app._check_payments_live_before_0410(p_center); n int := app.flagged_refund_count(p_center);
begin
  if n > 0 then
    v := jsonb_set(v, '{detail}', to_jsonb(coalesce(v->>'detail', '') || ' · ' || n || ' refund' || case when n = 1 then '' else 's' end
         || ' made in the Stripe/PayPal dashboard ' || case when n = 1 then 'waits' else 'wait' end || ' for two approvals (Giving › Payments).'));
    v := v || jsonb_build_object('flagged_refunds', n);
  end if;
  return v;
end $$;
update app.readiness_checks set check_fn = 'app.check_payments_live'::regproc where key = 'payments_live';

revoke execute on function app.refund_person_name(uuid, uuid), app._apply_refund_to_payment(uuid, bigint, uuid, uuid, text),
  app.worker_flag_provider_refund(text, text, bigint, text, date, text), app.approve_flagged_refund(uuid, text),
  app.paypal_email_only(uuid), app.record_manual_paypal_refund(uuid, bigint, date, text, text), app.flagged_refunds(uuid),
  app.flagged_refund_count(uuid), app._check_payments_live_before_0410(uuid), app.check_payments_live(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.worker_flag_provider_refund(text, text, bigint, text, date, text) to connect_worker;
grant execute on function app.approve_flagged_refund(uuid, text), app.paypal_email_only(uuid),
  app.record_manual_paypal_refund(uuid, bigint, date, text, text), app.flagged_refunds(uuid), app.flagged_refund_count(uuid),
  app.check_payments_live(uuid) to authenticated;
grant execute on function app.approve_flagged_refund(uuid, text), app.record_manual_paypal_refund(uuid, bigint, date, text, text),
  app.flagged_refunds(uuid), app.flagged_refund_count(uuid), app.check_payments_live(uuid), app.paypal_email_only(uuid) to service_role;
