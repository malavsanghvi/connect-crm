-- 0659: what "match this deposit to my checks" needs to look at (BACKLOG B90 phase 4). One read-only function, security invoker
-- (row-level security applies), integer cents, nothing written:
--
--   app.giving_deposit_context(bank_line, payment_ids)   the bank line, the payments chosen for it, whether they add up to the
--                                                        deposit to the cent, and which of them cannot be matched (not found
--                                                        or not visible, already deposited, not recorded by hand)
--
-- It repeats the checks app.match_deposit makes (0104) so that a person is told BEFORE confirming, not after. The match itself is
-- still app.match_deposit, unchanged.
set client_min_messages = warning;

create or replace function app.giving_deposit_context(p_txn uuid, p_payment_ids uuid[])
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with t as (
    select b.id, b.center_id, b.posted_on, b.amount_cents, b.description, b.status, b.is_batch_deposit
      from app.bank_transactions b
     where b.id = p_txn
  ),
  want as (
    select distinct u as id from unnest(coalesce(p_payment_ids, '{}'::uuid[])) u
  ),
  pay as (
    select p.id, p.receipt_number, p.household_id, p.amount_cents, p.method, p.provider, p.check_number, p.envelope_number,
           p.received_on, p.deposit_bank_transaction_id,
           (p.provider = 'offline' and p.deposit_bank_transaction_id is null) as can_match
      from app.payments p
      join t on p.center_id = t.center_id
     where p.id in (select id from want)
  )
  select jsonb_build_object(
    'bank_line', (select jsonb_build_object(
                    'id', t.id, 'posted_on', t.posted_on, 'amount_cents', t.amount_cents, 'description', left(t.description, 200),
                    'status', t.status, 'is_batch_deposit', t.is_batch_deposit) from t),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'receipt_number', p.receipt_number, 'household_id', p.household_id, 'amount_cents', p.amount_cents,
               'method', p.method, 'check_number', p.check_number, 'envelope_number', p.envelope_number,
               'received_on', p.received_on, 'can_match', p.can_match,
               'already_deposited', p.deposit_bank_transaction_id is not null)
               order by p.received_on, p.id)
        from pay p), '[]'::jsonb),
    'missing_ids', coalesce((select jsonb_agg(w.id order by w.id) from want w where not exists (select 1 from pay p where p.id = w.id)), '[]'::jsonb),
    'total_cents', coalesce((select sum(p.amount_cents) from pay p), 0)::bigint,
    'difference_cents', (select t.amount_cents from t) - coalesce((select sum(p.amount_cents) from pay p), 0)::bigint
  )
  where exists (select 1 from t)
$$;

revoke execute on function app.giving_deposit_context(uuid, uuid[]) from public, anon;
grant execute on function app.giving_deposit_context(uuid, uuid[]) to authenticated;
comment on function app.giving_deposit_context(uuid, uuid[]) is
  'The bank line and the chosen payments for a deposit match: total, difference and which payments cannot be matched. Null when the bank line is not visible. Security invoker. Read only.';
