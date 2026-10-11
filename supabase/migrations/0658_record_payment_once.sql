-- 0658: record a payment ONCE, all or nothing, exactly as shown (BACKLOG B90 phase 4; docs/ADMIN_REDESIGN.md "Make multi-step
-- writes all-or-nothing": "the payment has no idempotency key"). NEEDS OWNER OK: it changes how a payment is recorded.
--
-- What is added, and only this:
--   app.payments.idempotency_key              a text key, unique per community when present. Every payment recorded before this
--                                             migration, and every payment recorded by the Record payment screen, has none.
--   app.record_offline_payment_once(...)      records an offline payment AND applies it to the pledges named on the confirmed
--                                             card in ONE database call, so it is one transaction: either the payment and its
--                                             allocations all exist, or none does. The same key twice returns the payment already
--                                             recorded (replayed = true) instead of recording a second one; the same key for a
--                                             DIFFERENT payment is refused.
--   app.giving_payment_confirm_guard(...)     read only: has a payment like this one just been confirmed or recorded by a
--                                             confirmation? (see below)
--
-- What does NOT change: the Record payment screen still inserts the payment and then the allocations as it does today; nothing calls
-- the new function until the owner switches the Giving commands on. app.record_offline_payment (0017) and app.allocate_payment
-- (0104) are left exactly as they are.
--
-- The rules it applies are the screen's own (src/lib/payments/offline-payment.ts), enforced here as well:
--   * where: the household must belong to the community the caller says they are working in (p_center), whoever the caller is
--     (a platform admin included); otherwise nothing is recorded
--   * who: giving.record_offline or giving.manage in that community; the Giving module must be on
--   * what: check, cash, ACH, Zelle or stock; an amount above zero in whole cents; a received date that is not in the future
--     (in the community's own time zone)
--   * applying to pledges is giving.manage only (as on the screen): a recorder without it gets the payment recorded and left
--     unapplied, with a sentence saying so (never an error, never half done)
--
-- How it applies a payment (the difference from app.allocate_payment, which only the screen's path uses):
--   * it allocates EXACTLY the pledges and amounts it is given (p_allocations), which are the ones the person saw on the card
--     and confirmed. It never works the order out again, so two pledges made at the same moment cannot be swapped between the
--     card and the database;
--   * it locks those pledges (FOR UPDATE, in id order) before it reads what is paid, so two payments at once cannot both fill
--     the same pledge, and it refuses a pledge that is no longer as the card showed it (its amount or what is paid changed), or
--     that cannot take the amount (never above what is open), or amounts that add up to more than the payment.
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
  p_center uuid,
  p_household uuid,
  p_amount_cents bigint,
  p_method app.payment_method,
  p_received_on date,
  p_allocations jsonb default '[]'::jsonb,
  p_chosen boolean default false,
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
  v_alloc jsonb := coalesce(p_allocations, '[]'::jsonb);
  v_ids uuid[];
  v_sum bigint;
  v_pay app.payments;
  v_replayed boolean := false;
  v_skipped text;
  l record;
  v_pl app.pledges;
  v_take bigint;
begin
  select h.center_id into v_center from app.households h where h.id = p_household and h.merged_into_id is null;
  if v_center is null then
    raise exception 'That household was not found.' using errcode = 'P0002';
  end if;
  -- The community the person is working in must be the household's own. A platform admin is held to the same rule.
  if p_center is null or p_center <> v_center then
    raise exception 'That household belongs to a different community than the one you are working in. Nothing was recorded.' using errcode = '42501';
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
  if jsonb_typeof(v_alloc) <> 'array' then
    raise exception 'The pledges to apply the payment to must be a list.' using errcode = '22023';
  end if;

  select * into v_pay from app.payments p where p.center_id = v_center and p.idempotency_key = v_key;
  if not found then
    insert into app.payments (center_id, household_id, amount_cents, method, status, provider, received_on, recorded_by,
                              check_number, envelope_number, memo, idempotency_key)
      values (v_center, p_household, p_amount_cents, p_method, 'captured', 'offline', p_received_on, auth.uid(),
              p_check_number, p_envelope_number, p_memo, v_key)
      on conflict (center_id, idempotency_key) where idempotency_key is not null do nothing
      returning * into v_pay;
    if not found then
      -- Two confirmations of the same key arrived together and the other one won (the database waited for it to finish): this one
      -- is a repeat. Nothing was inserted, so there is nothing to undo.
      select * into v_pay from app.payments p where p.center_id = v_center and p.idempotency_key = v_key;
      if not found then
        raise exception 'That payment could not be recorded just now. Nothing was recorded; try again.' using errcode = '40001';
      end if;
      v_replayed := true;
    end if;
  else
    v_replayed := true;
  end if;

  if v_pay.household_id <> p_household or v_pay.amount_cents <> p_amount_cents or v_pay.method <> p_method or v_pay.received_on <> p_received_on then
    raise exception 'This confirmation was already used for a different payment (receipt %). Nothing was recorded.', coalesce(v_pay.receipt_number, 'not numbered yet')
      using errcode = '23505';
  end if;

  if not v_replayed and jsonb_array_length(v_alloc) > 0 then
    if not app.has_permission(v_center, 'giving.manage') then
      v_skipped := 'The payment was recorded but not applied to pledges: applying needs the giving.manage permission, so a treasurer can apply it.';
    else
      select coalesce(array_agg((e->>'pledge_id')::uuid), '{}'::uuid[]), coalesce(sum((e->>'amount_cents')::bigint), 0)
        into v_ids, v_sum from jsonb_array_elements(v_alloc) e;
      if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
        raise exception 'The same pledge is on the card twice, so nothing was recorded. Look at the household again.' using errcode = '23514';
      end if;
      if v_sum > p_amount_cents then
        raise exception 'The pledges on the card add up to more than the payment, so nothing was recorded. Look at the household again.' using errcode = '23514';
      end if;
      -- Lock the pledges first (in id order, so two payments cannot wait on each other), then read what is paid.
      perform 1 from app.pledges pl where pl.id = any(v_ids) and pl.center_id = v_center and pl.household_id = p_household order by pl.id for update;
      if (select count(*) from app.pledges pl where pl.id = any(v_ids) and pl.center_id = v_center and pl.household_id = p_household) <> cardinality(v_ids) then
        raise exception 'A pledge on the card is no longer one of this household''s, so nothing was recorded. Look at the household again.' using errcode = '23514';
      end if;
      for l in select t.e, t.ord from jsonb_array_elements(v_alloc) with ordinality as t(e, ord) order by t.ord loop
        select * into v_pl from app.pledges pl where pl.id = (l.e->>'pledge_id')::uuid;
        v_take := (l.e->>'amount_cents')::bigint;
        if v_pl.status not in ('open', 'partially_paid')
           or v_pl.amount_cents <> (l.e->>'pledge_amount_cents')::bigint
           or v_pl.paid_cents <> (l.e->>'pledge_paid_cents')::bigint then
          raise exception 'Pledge % changed since you saw the card, so nothing was recorded. Look at the household again.', coalesce(v_pl.pledge_number, '')
            using errcode = '23514';
        end if;
        if v_take is null or v_take <= 0 or v_take > v_pl.amount_cents - v_pl.paid_cents then
          raise exception 'Pledge % cannot take that amount (it has less than that still open), so nothing was recorded. Look at the household again.', coalesce(v_pl.pledge_number, '')
            using errcode = '23514';
        end if;
        insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents, chosen_by_donor)
          values (v_center, v_pay.id, v_pl.id, v_take, coalesce(p_chosen, false));
      end loop;
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

-- ── Has a payment like this one just been confirmed? ─────────────────────────
-- A confirmation is single use, so the same confirmation cannot record twice. What it cannot catch is a payment that DID commit
-- while the answer was lost: the person asks again, a new confirmation is made with a new key, and a second payment would follow.
-- So, before a new confirmation is made, the command asks here: is there a confirmation of this command for this household and
-- this amount in the last few minutes that never finished (unfinished), or a payment recorded by such a confirmation (recorded)?
-- Security invoker: you see your own confirmations and the payments row-level security shows you.
create or replace function app.giving_payment_confirm_guard(p_household uuid, p_amount_cents bigint, p_minutes integer default 30)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'unfinished', (
      select count(*) from app.assistant_proposals a
       where a.command_key = 'giving.record_payment' and a.status = 'confirmed'
         and a.confirmed_at > now() - make_interval(mins => greatest(coalesce(p_minutes, 30), 1))
         and a.input->>'household_id' = p_household::text and a.input->>'amount_cents' = p_amount_cents::text)::integer,
    'recorded', (
      select count(*) from app.payments p
       where p.household_id = p_household and p.amount_cents = p_amount_cents and p.idempotency_key like 'proposal:%'
         and p.created_at > now() - make_interval(mins => greatest(coalesce(p_minutes, 30), 1)))::integer)
$$;

revoke execute on function app.record_offline_payment_once(text, uuid, uuid, bigint, app.payment_method, date, jsonb, boolean, text, text, text) from public, anon;
grant execute on function app.record_offline_payment_once(text, uuid, uuid, bigint, app.payment_method, date, jsonb, boolean, text, text, text) to authenticated;
revoke execute on function app.giving_payment_confirm_guard(uuid, bigint, integer) from public, anon;
grant execute on function app.giving_payment_confirm_guard(uuid, bigint, integer) to authenticated;
comment on function app.record_offline_payment_once(text, uuid, uuid, bigint, app.payment_method, date, jsonb, boolean, text, text, text) is
  'Records an offline payment and applies it to exactly the pledges given, in one transaction. The same idempotency key twice returns the same payment (replayed) and never records a second one.';
comment on function app.giving_payment_confirm_guard(uuid, bigint, integer) is
  'Confirmations of giving.record_payment for this household and amount in the last minutes that never finished, and payments recorded by such a confirmation. Security invoker. Read only.';

-- ── The three Giving money commands, in the activity catalog ─────────────────
-- Listed like every command (0625) so that their runs can be recorded; they stay off until an owner switches each one on.
select app.activity_register(v.k, 'action', 'portal', v.l, null, v.c)
  from (values
    ('assistant.giving_record_payment',              'Record a payment',                    'giving.record_payment'),
    ('assistant.giving_confirm_exact_zelle_matches', 'Confirm the exact Zelle matches',     'giving.confirm_exact_zelle_matches'),
    ('assistant.giving_match_deposit',               'Match a deposit to recorded checks',  'giving.match_deposit')
  ) as v(k, l, c);
