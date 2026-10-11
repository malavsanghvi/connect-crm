-- 0657: Giving review reads (BACKLOG B90 phase 4, B83). Three more read-only SQL functions, same rules as 0656 (security
-- invoker so row-level security applies, integer cents, nothing written):
--
--   app.giving_second_approver_queue(center)    what is waiting for a SECOND, different person: refunds and write-offs that one
--                                               person asked for, and refunds made in Stripe or PayPal (two approvals needed)
--   app.giving_fund_mapping_status(center)      which QuickBooks accounts are chosen and approved for each purpose, and which
--                                               funds still have no QuickBooks class
--   app.giving_draft_context(household, ...)    what a prepared "record a payment" needs to look at: the household's open pledges
--                                               (the allocation order), whether the month is locked, and payments that look
--                                               like the same one already recorded
--
-- They carry the evidence a person needs to decide, never a decision: approving, recording and mapping stay where they were.
set client_min_messages = warning;

-- ── Waiting for a second approver ────────────────────────────────────────────
-- Refunds and write-offs have two steps by two different people (the first asks, the second approves). Only the ones still
-- waiting for the second person are listed. Refunds made outside Weaver come from app.flagged_refunds (its own permission
-- check applies). Each list is capped at 25, newest request last, with the true count beside it.
create or replace function app.giving_second_approver_queue(p_center uuid)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with rf as (
    select p.id, p.receipt_number, p.household_id, p.method, p.provider, p.status, p.received_on,
           p.amount_cents, p.refunded_cents,
           coalesce(p.refund_requested_cents, p.amount_cents - p.refunded_cents) as requested_cents,
           p.refund_reason, p.refund_approved_by, p.updated_at,
           (p.deposit_bank_transaction_id is not null) as matched_to_deposit
      from app.payments p
     where p.center_id = p_center
       and p.refund_approved_by is not null
       and p.refund_second_approver is null
       and p.refunded_cents = 0
  ),
  wo as (
    select pl.id, pl.pledge_number, pl.household_id, pl.source, pl.amount_cents, pl.paid_cents,
           pl.amount_cents - pl.paid_cents as open_cents, pl.due_on, pl.write_off_reason, pl.written_off_by, pl.updated_at,
           f.name as fund
      from app.pledges pl
      left join app.funds f on f.id = pl.fund_id
     where pl.center_id = p_center
       and pl.written_off_by is not null
       and pl.written_off_second_approver is null
       and pl.status in ('open', 'partially_paid')
  ),
  fl as (
    select coalesce(app.flagged_refunds(p_center), '[]'::jsonb) as j
  )
  select jsonb_build_object(
    'refund_count', (select count(*) from rf)::integer,
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'payment_id', x.id, 'receipt_number', x.receipt_number, 'household_id', x.household_id,
               'method', x.method, 'provider', x.provider, 'status', x.status, 'received_on', x.received_on,
               'payment_amount_cents', x.amount_cents, 'refunded_cents', x.refunded_cents,
               'requested_cents', x.requested_cents, 'reason', x.refund_reason,
               'requested_by', x.refund_approved_by, 'last_changed_at', x.updated_at,
               'matched_to_deposit', x.matched_to_deposit)
               order by x.updated_at, x.id)
        from (select * from rf order by updated_at, id limit 25) x), '[]'::jsonb),
    'write_off_count', (select count(*) from wo)::integer,
    'write_offs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'pledge_id', y.id, 'pledge_number', y.pledge_number, 'household_id', y.household_id,
               'source', y.source, 'fund', y.fund, 'amount_cents', y.amount_cents, 'paid_cents', y.paid_cents,
               'open_cents', y.open_cents, 'due_on', y.due_on, 'reason', y.write_off_reason,
               'requested_by', y.written_off_by, 'last_changed_at', y.updated_at)
               order by y.updated_at, y.id)
        from (select * from wo order by updated_at, id limit 25) y), '[]'::jsonb),
    'provider_refund_count', (select jsonb_array_length(j) from fl)::integer,
    'provider_refunds', (select j from fl)
  )
$$;

-- ── Funds and QuickBooks accounts ────────────────────────────────────────────
-- "Mapped" = a QuickBooks account is chosen for the purpose; "approved" = a treasurer approved the whole mapping (0232). The
-- required purposes depend on the basis (cash or accrual) and the Store module, exactly as the QuickBooks setup screen counts
-- them. A fund "has a class" when a QuickBooks class is chosen for it.
create or replace function app.giving_fund_mapping_status(p_center uuid)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with req as (
    select coalesce(app.qbo_required_purposes(p_center), '{}'::text[]) as purposes
  ),
  mapped as (
    select m.purpose, m.qbo_account_name, m.approved_at
      from app.qbo_account_mappings m
     where m.center_id = p_center
  ),
  fn as (
    select f.id, f.key, f.name, f.restricted, (f.qbo_class_id is not null) as has_class
      from app.funds f
     where f.center_id = p_center and f.active
  )
  select jsonb_build_object(
    'required_purposes', to_jsonb((select purposes from req)),
    'missing_purposes', coalesce((
      select jsonb_agg(p order by p)
        from unnest((select purposes from req)) p
       where not exists (select 1 from mapped m where m.purpose = p)), '[]'::jsonb),
    'mapped_count', (select count(*) from mapped)::integer,
    'approved_count', (select count(*) from mapped where approved_at is not null)::integer,
    'mappings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'purpose', m.purpose, 'account', m.qbo_account_name, 'approved', m.approved_at is not null,
               'approved_at', m.approved_at)
               order by m.purpose)
        from mapped m), '[]'::jsonb),
    'funds_count', (select count(*) from fn)::integer,
    'funds_without_class', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'key', n.key, 'name', n.name, 'restricted', n.restricted) order by n.name)
        from fn n where not n.has_class), '[]'::jsonb),
    'funds', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'restricted', n.restricted, 'has_class', n.has_class) order by n.name)
        from fn n), '[]'::jsonb)
  )
$$;

-- ── What a prepared payment needs to look at ─────────────────────────────────
-- Null when the household is not visible to the caller. open_pledges are in the allocation order (earliest first). month_closed
-- is null (unknown) when the caller may not read the month-end close, never false by accident. duplicates are payments of THIS
-- household with the same amount within three days, or the same check number; check_number_elsewhere only counts the same
-- check number on another household's payment (no details of other households are returned).
create or replace function app.giving_draft_context(
  p_household uuid,
  p_amount_cents bigint default null,
  p_method text default null,
  p_check_number text default null,
  p_received_on date default null)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with h as (
    select hh.id, hh.center_id from app.households hh where hh.id = p_household and hh.merged_into_id is null
  ),
  plg as (
    select pl.id, pl.pledge_number, pl.source, pl.amount_cents, pl.paid_cents, pl.status, pl.pledged_at, pl.due_on,
           f.name as fund, c.name as campaign
      from app.pledges pl
      join h on pl.household_id = h.id and pl.center_id = h.center_id
      left join app.funds f on f.id = pl.fund_id
      left join app.campaigns c on c.id = pl.campaign_id
     where pl.status in ('open', 'partially_paid')
     order by pl.pledged_at, pl.id
     limit 200
  ),
  dup as (
    select p.id, p.receipt_number, p.received_on, p.amount_cents, p.method, p.check_number,
           coalesce(p_method = 'check' and p_check_number is not null and p.check_number = p_check_number, false) as same_check_number
      from app.payments p
      join h on p.household_id = h.id and p.center_id = h.center_id
     where p.status not in ('failed', 'voided', 'authorized')
       and ((p_method = 'check' and p_check_number is not null and p.check_number = p_check_number)
            or (p_amount_cents is not null and p_received_on is not null and p.amount_cents = p_amount_cents
                and p.received_on between p_received_on - 3 and p_received_on + 3))
     order by p.received_on desc, p.id
     limit 5
  )
  select jsonb_build_object(
    'household_id', h.id,
    'open_pledges', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'pledge_number', g.pledge_number, 'source', g.source, 'amount_cents', g.amount_cents,
               'paid_cents', g.paid_cents, 'status', g.status, 'pledged_at', g.pledged_at, 'due_on', g.due_on,
               'fund', g.fund, 'campaign', g.campaign)
               order by g.pledged_at, g.id)
        from plg g), '[]'::jsonb),
    'month_closed', case
      when p_received_on is null then null
      when app.has_permission(h.center_id, 'giving.view') or app.has_permission(h.center_id, 'giving.manage')
           or app.has_permission(h.center_id, 'accounting.close')
        then exists (select 1 from app.accounting_periods ap
                      where ap.center_id = h.center_id and ap.period_month = date_trunc('month', p_received_on)::date
                        and ap.status = 'closed')
      else null end,
    'duplicates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'payment_id', d.id, 'receipt_number', d.receipt_number, 'received_on', d.received_on,
               'amount_cents', d.amount_cents, 'method', d.method, 'check_number', d.check_number,
               'same_check_number', d.same_check_number)
               order by d.received_on desc, d.id)
        from dup d), '[]'::jsonb),
    'check_number_elsewhere', case
      when p_method = 'check' and p_check_number is not null
        then (select count(*)::integer from app.payments p2
               where p2.center_id = h.center_id and p2.household_id <> h.id and p2.check_number = p_check_number
                 and p2.status not in ('failed', 'voided', 'authorized'))
      else 0 end
  )
  from h
$$;

revoke execute on function app.giving_second_approver_queue(uuid),
  app.giving_fund_mapping_status(uuid),
  app.giving_draft_context(uuid, bigint, text, text, date) from public, anon;
grant execute on function app.giving_second_approver_queue(uuid),
  app.giving_fund_mapping_status(uuid),
  app.giving_draft_context(uuid, bigint, text, text, date) to authenticated;

comment on function app.giving_second_approver_queue(uuid) is
  'Refunds, write-offs and provider refunds still waiting for a second, different approver, with the evidence they need. Security invoker. Read only.';
comment on function app.giving_fund_mapping_status(uuid) is
  'QuickBooks account mapping per purpose (mapped, approved, missing) and funds without a QuickBooks class. Security invoker. Read only.';
comment on function app.giving_draft_context(uuid, bigint, text, text, date) is
  'What a prepared payment looks at: open pledges in allocation order, month lock, likely duplicates. Null when the household is not visible. Security invoker. Read only.';
