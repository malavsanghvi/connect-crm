-- Wave E · stream e-money · 3 of 5: a pledge write-off is synced to QuickBooks
-- (owner decision 2026-09-25, "pledge write-off synced to QuickBooks").
--
-- The write-off itself is unchanged: two different people (0016 trigger), a fresh
-- 2FA check (0154), then "Complete write-off". When a pledge becomes written_off,
-- ONE ledger posting is queued (txn_type 'pledge_writeoff', idempotency key
-- 'writeoff:<pledge>') for the written-off balance (amount - paid). What it becomes:
--
--   * the pledge came from a QuickBooks invoice (donor matching, crm_external_id
--     'qbo:Invoice:<id>')  -> a CreditMemo for the written-off balance, to the
--     invoice's customer, through the item that posts to the "Pledge write-offs"
--     account, APPLIED to that invoice (the poster then links the two with a $0
--     Payment, as QuickBooks applies credits);
--   * pledges are receivables in QuickBooks (accrual basis)
--     -> a JournalEntry: debit "Pledge write-offs", credit "Pledges receivable"
--     (with the donor as the receivable line's customer). Accrual posting as a
--     whole is still gated by app.qbo_post_ready ("not built yet"), so this entry
--     waits in the queue with that reason until accrual posting is switched on;
--   * neither (cash basis, the pledge never was in QuickBooks)
--     -> nothing to post: the posting is recorded as 'skipped' with that reason.
--
-- Like every posting it is idempotent (one per pledge; QuickBooks requestid = the
-- posting id), never posts before the QuickBooks go-live date (dated the day of
-- the write-off) and never into a month closed in Community Connect. A pledge
-- imported as already written off (0413) is history: it is inserted, not updated,
-- so it never queues anything.
--
-- New mapping purpose "pledge_writeoffs" (Pledge write-offs: an expense such as
-- bad debt, or a contra-income account). It is not required for the mapping to
-- be approved; a write-off that needs it and finds it unmapped fails with a plain
-- reason on the QuickBooks sync screen, like any other posting.
set client_min_messages = warning;

alter table app.ledger_postings drop constraint if exists ledger_postings_txn_type_check;
alter table app.ledger_postings add constraint ledger_postings_txn_type_check check (txn_type in (
  'donation_card','recurring_charge','boli_payment','store_sale','refund','processor_fee','payout_deposit',
  'offline_receipt','bank_receipt','stock_gift','pledge_receivable','membership_fee','adjustment','pledge_writeoff'));

create or replace function app.qbo_purposes() returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select '{
    "income.general":      ["Income","Other Income"],
    "income.boli":         ["Income","Other Income"],
    "income.sponsorship":  ["Income","Other Income"],
    "income.construction": ["Income","Other Income"],
    "income.pathshala":    ["Income","Other Income"],
    "income.jeevdaya":     ["Income","Other Income"],
    "income.event":        ["Income","Other Income"],
    "income.membership":   ["Income","Other Income"],
    "income.store":        ["Income","Other Income"],
    "income.other":        ["Income","Other Income"],
    "store.sales":         ["Income","Other Income"],
    "store.gift_packing":  ["Income","Other Income"],
    "sales_tax_payable":   ["Other Current Liability"],
    "merchant_fees":       ["Expense","Other Expense","Cost of Goods Sold"],
    "payment_clearing":    ["Bank","Other Current Asset"],
    "bank":                ["Bank"],
    "undeposited_funds":   ["Other Current Asset","Bank"],
    "pledges_receivable":  ["Accounts Receivable","Other Current Asset"],
    "stock_clearing":      ["Other Current Asset","Bank","Other Asset"],
    "pledge_writeoffs":    ["Expense","Other Expense","Income","Other Income"]
  }'::jsonb
$$;

-- The day a pledge was written off, in the community's own time zone.
create or replace function app.pledge_writeoff_date(p_pledge uuid) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select (coalesce(p.closed_at, now()) at time zone coalesce(c.time_zone, 'America/Chicago'))::date
    from app.pledges p join app.centers c on c.id = p.center_id where p.id = p_pledge
$$;

-- The QuickBooks invoice a pledge was brought in from (donor matching), if any.
create or replace function app.pledge_qbo_invoice(p_pledge uuid) returns app.qbo_transactions
language sql stable security definer set search_path = app, public, extensions as $$
  select t.* from app.pledges p
    join app.qbo_transactions t on t.center_id = p.center_id and t.qbo_type = 'Invoice' and t.qbo_id = split_part(p.crm_external_id, ':', 3)
   where p.id = p_pledge and p.crm_external_id like 'qbo:Invoice:%'
$$;

-- What a write-off becomes in QuickBooks: {path: 'credit_memo' | 'journal_entry' | 'none', reason}.
create or replace function app.pledge_writeoff_path(p_pledge uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare p app.pledges; c app.integration_connections; inv app.qbo_transactions;
begin
  select * into p from app.pledges where id = p_pledge;
  if p.id is null then return jsonb_build_object('path', 'none', 'reason', 'The pledge was not found.'); end if;
  inv := app.pledge_qbo_invoice(p.id);
  if inv.qbo_id is not null then
    return jsonb_build_object('path', 'credit_memo', 'invoice', inv.qbo_id, 'invoice_number', inv.doc_number,
      'reason', format('The pledge came from QuickBooks invoice %s: a credit memo for the written-off balance is applied to it.',
                       coalesce('#' || inv.doc_number, inv.qbo_id)));
  end if;
  select * into c from app.qbo_connection(p.center_id);
  if c.id is not null and c.status <> 'disconnected' and app.module_enabled(p.center_id, 'accounting')
     and c.settings->>'basis' = 'accrual' then
    return jsonb_build_object('path', 'journal_entry',
      'reason', 'Pledges are receivables in QuickBooks (accrual basis): a journal entry moves the balance from Pledges receivable to Pledge write-offs.');
  end if;
  if c.id is null or c.status = 'disconnected' or not app.module_enabled(p.center_id, 'accounting') then
    return jsonb_build_object('path', 'none',
      'reason', 'Nothing to post: QuickBooks is not in use here and the pledge never was in QuickBooks.');
  end if;
  return jsonb_build_object('path', 'none',
    'reason', 'Nothing to post: the books are on cash basis and the pledge never was in QuickBooks (it did not come from a QuickBooks invoice), so there is no receivable to reverse.');
end $$;

-- Queue the write-off's posting (or record it as skipped, with the reason). Idempotent.
create or replace function app.enqueue_pledge_writeoff_posting(p_pledge uuid) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.pledges; v_path jsonb; v_amount bigint; v uuid; v_status text; v_why text; v_day date;
begin
  select * into p from app.pledges where id = p_pledge;
  if p.id is null or p.status <> 'written_off' then return null; end if;
  v_amount := p.amount_cents - p.paid_cents;
  v_path := app.pledge_writeoff_path(p.id);
  v_day := app.pledge_writeoff_date(p.id);
  if v_amount <= 0 then
    v_status := 'skipped'; v_why := 'Nothing was left to write off, so nothing is posted.';
  elsif v_path->>'path' = 'none' then
    v_status := 'skipped'; v_why := v_path->>'reason';
  else
    v_status := 'queued'; v_why := null;
  end if;
  insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, fund_id, period_month,
                                   status, last_error, triggered_by)
  values (p.center_id, 'writeoff:' || p.id, 'pledges', p.id, 'pledge_writeoff', greatest(v_amount, 0), p.fund_id,
          date_trunc('month', v_day)::date, v_status, v_why, coalesce(auth.uid(), p.written_off_second_approver))
  on conflict (center_id, idempotency_key) do nothing
  returning id into v;
  return v;
end $$;

create or replace function app.on_pledge_written_off() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.status = 'written_off' and old.status is distinct from 'written_off' then
    perform app.enqueue_pledge_writeoff_posting(new.id);
  end if;
  return null;
end $$;
drop trigger if exists pledges_writeoff_posting on app.pledges;
create trigger pledges_writeoff_posting after update of status on app.pledges
  for each row execute function app.on_pledge_written_off();

-- The posting's own date: a write-off is dated the day it was written off.
create or replace function app._qbo_posting_date(lp app.ledger_postings) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(
    case when lp.source_table = 'payments' then (select received_on from app.payments where id = lp.source_id) end,
    case when lp.source_table = 'bank_transactions' then (select posted_on from app.bank_transactions where id = lp.source_id) end,
    case when lp.source_table = 'store_orders' then (select coalesce(picked_up_at, placed_at, created_at)::date from app.store_orders where id = lp.source_id) end,
    case when lp.source_table = 'pledges' then app.pledge_writeoff_date(lp.source_id) end,
    lp.period_month)
$$;

-- The document of a write-off posting; every other posting is built as before (0233).
do $$ begin
  if to_regprocedure('app._qbo_posting_doc_before_0412(uuid)') is null then
    alter function app.qbo_posting_doc(uuid) rename to _qbo_posting_doc_before_0412;
  end if;
end $$;
create or replace function app.qbo_posting_doc(p_posting uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare lp app.ledger_postings; c app.integration_connections; p app.pledges; inv app.qbo_transactions; v_path jsonb;
        v_wo text; v_ar text; v_class text; v_cust jsonb; v_doc jsonb; v_problem text; v_day text; v_num text;
begin
  select * into lp from app.ledger_postings where id = p_posting;
  if lp.id is null or lp.txn_type <> 'pledge_writeoff' then return app._qbo_posting_doc_before_0412(p_posting); end if;
  select * into c from app.qbo_connection(lp.center_id);
  select * into p from app.pledges where id = lp.source_id;
  if p.id is null then return jsonb_build_object('ok', false, 'error', 'The pledge behind this write-off was not found.'); end if;
  if p.status <> 'written_off' then
    return jsonb_build_object('ok', false, 'error', 'The pledge is no longer written off, so the write-off is not posted.');
  end if;
  v_path := app.pledge_writeoff_path(p.id);
  v_wo := app._qbo_account(lp.center_id, 'pledge_writeoffs');
  if v_path->>'path' <> 'none' and v_wo is null then
    return jsonb_build_object('ok', false, 'error',
      'The Pledge write-offs account is not mapped and approved. Map it in Accounting › QuickBooks › Setup (step 4), approve the mapping, then retry.');
  end if;
  select f.qbo_class_id into v_class from app.funds f
   where f.id = coalesce(p.fund_id, (select cp.fund_id from app.campaigns cp where cp.id = p.campaign_id));
  v_day := to_char(app.pledge_writeoff_date(p.id), 'YYYY-MM-DD');
  v_num := left('WO-' || coalesce(p.pledge_number, left(p.id::text, 8)), 21);

  if v_path->>'path' = 'credit_memo' then
    inv := app.pledge_qbo_invoice(p.id);
    if inv.customer_qbo_id is null then
      return jsonb_build_object('ok', false, 'error', format('QuickBooks invoice %s has no customer, so the credit memo cannot be applied to it.',
                                                             coalesce('#' || inv.doc_number, inv.qbo_id)));
    end if;
    v_doc := jsonb_build_object('entity', 'CreditMemo', 'txn_date', v_day, 'doc_number', v_num,
      'private_note', left(format('Community Connect pledge write-off %s · QuickBooks invoice %s · %s · posting %s',
                                  coalesce(p.pledge_number, left(p.id::text, 8)), coalesce('#' || inv.doc_number, inv.qbo_id),
                                  coalesce(p.write_off_reason, 'written off'), lp.id), 4000),
      'customer_ref', inv.customer_qbo_id, 'customer_status', 'matched', 'deposit_account', null,
      'apply_to_invoice', inv.qbo_id,
      'lines', jsonb_build_array(app._qbo_sales_line(c.id, v_wo, v_class, lp.amount_cents, 'Pledge write-off')));
  elsif v_path->>'path' = 'journal_entry' then
    v_ar := app._qbo_account(lp.center_id, 'pledges_receivable');
    v_cust := app._qbo_customer_ref(p.household_id, p.pledged_by_person_id);
    if v_cust->>'ref' is null then
      return jsonb_build_object('ok', false, 'error',
        'QuickBooks needs the donor on a receivable line: approve this household''s donor match (Accounting › QuickBooks › Donor matching), then retry.');
    end if;
    v_doc := jsonb_build_object('entity', 'JournalEntry', 'txn_date', v_day, 'doc_number', v_num,
      'private_note', left(format('Community Connect pledge write-off %s · %s · posting %s', coalesce(p.pledge_number, left(p.id::text, 8)),
                                  coalesce(p.write_off_reason, 'written off'), lp.id), 4000),
      'customer_ref', v_cust->>'ref', 'customer_status', v_cust->>'status', 'deposit_account', null,
      'lines', jsonb_build_array(
        jsonb_build_object('amount_cents', lp.amount_cents, 'posting', 'Debit', 'account_id', v_wo, 'class_id', v_class,
                           'description', 'Pledge write-off'),
        jsonb_build_object('amount_cents', lp.amount_cents, 'posting', 'Credit', 'account_id', v_ar, 'class_id', v_class,
                           'description', 'Pledge write-off', 'customer_ref', v_cust->>'ref')));
  else
    return jsonb_build_object('ok', false, 'error', v_path->>'reason');
  end if;
  v_problem := app._qbo_doc_problem(c.id, v_doc);
  if v_problem is not null then return jsonb_build_object('ok', false, 'error', v_problem); end if;
  return jsonb_build_object('ok', true, 'doc', v_doc);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- What the pledge screens show: the write-off's QuickBooks posting, if any.
create or replace function app.pledge_writeoff_postings(p_pledges uuid[]) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(jsonb_object_agg(l.source_id::text, jsonb_build_object(
           'id', l.id, 'status', l.status, 'qbo_entity', l.qbo_entity, 'qbo_ref', l.qbo_ref, 'amount_cents', l.amount_cents,
           'last_error', l.last_error, 'posted_at', l.posted_at)), '{}'::jsonb)
    from app.ledger_postings l
   where l.source_table = 'pledges' and l.txn_type = 'pledge_writeoff' and l.source_id = any (coalesce(p_pledges, '{}'))
     and (app.has_permission(l.center_id, 'giving.view') or app.has_permission(l.center_id, 'giving.manage')
          or app.has_permission(l.center_id, 'accounting.manage'))
$$;

revoke execute on function app.pledge_writeoff_date(uuid), app.pledge_qbo_invoice(uuid), app.pledge_writeoff_path(uuid),
  app.enqueue_pledge_writeoff_posting(uuid), app.on_pledge_written_off(), app._qbo_posting_date(app.ledger_postings),
  app._qbo_posting_doc_before_0412(uuid), app.qbo_posting_doc(uuid), app.pledge_writeoff_postings(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function app.pledge_writeoff_postings(uuid[]) to authenticated, service_role;
