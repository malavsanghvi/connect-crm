-- 0658: record a payment ONCE, all or nothing (BACKLOG B90 phase 4; docs/ADMIN_REDESIGN.md "Make multi-step writes
-- all-or-nothing": "the payment has no idempotency key"). NEEDS OWNER OK: it changes how a payment is recorded.
--
-- What is added, and only this:
--   app.payments.idempotency_key          a text key, unique per community when present. Every payment recorded before this
--                                         migration, and every payment recorded by the Record payment screen, has none.
--   app.record_offline_payment_once(...)  records an offline payment AND applies it to pledges in ONE database call, so it is
--                                         one transaction: either the payment and its allocations all exist, or none does.
--                                         The same key twice returns the payment already recorded (replayed = true) instead of
--                                         recording a second one; the same key for a DIFFERENT payment is refused.
--
-- What does NOT change: the Record payment screen still inserts the payment and then the allocations as it does today; nothing
-- calls the new function until the owner switches the Giving commands on. app.record_offline_payment (0017) is left as it is.
--
-- The rules it applies are the screen's own (src/lib/payments/offline-payment.ts), enforced here as well:
--   * who: giving.record_offline or giving.manage in the household's community; the Giving module must be on
--   * what: check, cash, ACH, Zelle or stock; an amount above zero in whole cents; a received date that is not in the future
--     (in the community's own time zone)
--   * applying to pledges is giving.manage only (as on the screen): a recorder without it gets the payment recorded and left
--     unapplied, and the answer says so (allocation_skipped); it is never an error and never half done
--   * named pledges are used in the order named and ONLY those; otherwise the earliest open pledge first, an overpayment rolling
--     to the next, a partial payment leaving the pledge open (app.allocate_payment, unchanged)
set client_min_messages = warning;

alter table app.payments add column if not exists idempotency_key text;
alter table app.payments drop constraint if exists payments_idempotency_key_len;
alter table app.payments add constraint payments_idempotency_key_len
  check (idempotency_key is null or char_length(idempotency_key) between 8 and 120);
create unique index if not exists payments_idempotency_key_uniq on app.payments (center_id, idempotency_key)
  where idempotency_key is not null;
comment on column app.payments.idempotency_key is
  'Set only by app.record_offline_payment_once: the confirmation that recorded this payment. A second call with the same key returns this payment instead of recording another.';

create or replace function app.record_offline_payment_once(
  p_idempotency_key text,
  p_household uuid,
  p_amount_cents bigint,
  p_method app.payment_method,
  p_received_on date,
  p_pledge_ids uuid[] default null,
  p_apply boolean default true,
  p_check_number text default null,
  p_envelope_number text default null,
  p_memo text default null)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_center uuid;
  v_tz text;
  v_today date;
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_pay app.payments;
  v_replayed boolean := false;
  v_skipped text;
begin
  select h.center_id into v_center from app.households h where h.id = p_household and h.merged_into_id is null;
  if v_center is null then
    raise exception 'That household was not found.' using errcode = 'P0002';
  end if;
  perform app.assert_module_enabled(v_center, 'giving');
  if not (app.has_permission(v_center, 'giving.record_offline') or app.has_permission(v_center, 'giving.manage')) then
    raise exception 'You do not have permission to record payments.' using errcode = '42501';
  end if;
  if v_key is null or char_length(v_key) < 8 or char_length(v_key) > 120 then
    raise exception 'A payment needs a confirmation key of 8 to 120 characters, so that recording it twice cannot count it twice.' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = '22023';
  end if;
  if p_method is null or p_method::text not in ('check', 'cash', 'ach', 'zelle', 'stock') then
    raise exception 'Choose check, cash, ACH, Zelle or stock. Card gifts are taken through the payment provider.' using errcode = '22023';
  end if;
  select coalesce(nullif(c.time_zone, ''), 'UTC') into v_tz from app.centers c where c.id = v_center;
  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;
  if p_received_on is null or p_received_on > v_today then
    raise exception 'The received date must be a real date, not in the future.' using errcode = '22023';
  end if;

  select * into v_pay from app.payments p where p.center_id = v_center and p.idempotency_key = v_key;
  if not found then
    begin
      insert into app.payments (center_id, household_id, amount_cents, method, status, provider, received_on, recorded_by,
                                check_number, envelope_number, memo, idempotency_key)
        values (v_center, p_household, p_amount_cents, p_method, 'captured', 'offline', p_received_on, auth.uid(),
                p_check_number, p_envelope_number, p_memo, v_key)
        returning * into v_pay;
    exception when unique_violation then
      -- Two confirmations of the same key arrived together and the other one won: this one is a repeat.
      select * into v_pay from app.payments p where p.center_id = v_center and p.idempotency_key = v_key;
      if not found then raise; end if;
      v_replayed := true;
    end;
  else
    v_replayed := true;
  end if;

  if v_pay.household_id <> p_household or v_pay.amount_cents <> p_amount_cents or v_pay.method <> p_method or v_pay.received_on <> p_received_on then
    raise exception 'This confirmation was already used for a different payment (receipt %). Nothing was recorded.', coalesce(v_pay.receipt_number, 'not numbered yet')
      using errcode = '23505';
  end if;

  if not v_replayed and p_apply then
    if app.has_permission(v_center, 'giving.manage') then
      perform app.allocate_payment(v_pay.id, p_pledge_ids, true);
    else
      v_skipped := 'The payment was recorded but not applied to pledges: applying needs the giving.manage permission, so a treasurer can apply it.';
    end if;
  end if;

  select * into v_pay from app.payments p where p.id = v_pay.id;
  return jsonb_build_object(
    'payment_id', v_pay.id,
    'receipt_number', v_pay.receipt_number,
    'amount_cents', v_pay.amount_cents,
    'replayed', v_replayed,
    'applied', coalesce((
      select jsonb_agg(jsonb_build_object(
               'pledge_id', a.pledge_id, 'pledge_number', pl.pledge_number, 'amount_cents', a.amount_cents,
               'closed', pl.status = 'paid')
               order by pl.pledged_at, a.id)
        from app.payment_allocations a join app.pledges pl on pl.id = a.pledge_id
       where a.payment_id = v_pay.id), '[]'::jsonb),
    'unallocated_cents', v_pay.amount_cents - coalesce((select sum(a.amount_cents) from app.payment_allocations a where a.payment_id = v_pay.id), 0),
    'allocation_skipped', v_skipped);
end $$;

revoke execute on function app.record_offline_payment_once(text, uuid, bigint, app.payment_method, date, uuid[], boolean, text, text, text) from public, anon;
grant execute on function app.record_offline_payment_once(text, uuid, bigint, app.payment_method, date, uuid[], boolean, text, text, text) to authenticated;
comment on function app.record_offline_payment_once(text, uuid, bigint, app.payment_method, date, uuid[], boolean, text, text, text) is
  'Records an offline payment and applies it to pledges in one transaction. The same idempotency key twice returns the same payment (replayed) and never records a second one.';

-- ── The three Giving money commands, in the activity catalog ─────────────────
-- Listed like every command (0625) so that their runs can be recorded; they stay off until an owner switches each one on.
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.giving_record_payment',              'Record a payment',                    'giving.record_payment'),
    ('assistant.giving_confirm_exact_zelle_matches', 'Confirm the exact Zelle matches',     'giving.confirm_exact_zelle_matches'),
    ('assistant.giving_match_deposit',               'Match a deposit to recorded checks',  'giving.match_deposit')
  ) as v(k, l, c);
