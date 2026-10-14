-- 0783's real-deposit document, with its table aliases renamed. 0783 (already applied) wrote the payout_deposit branch with
-- the aliases "p" and "o", which are also the names of this function's record variables (p app.payments, o app.store_orders):
-- PostgreSQL answers "column reference is ambiguous" the first time such a deposit is built, and the function's catch-all turned
-- that into a failed posting. Caught by Database test 179 (the first run of 0783's SQL); no organization had a live QuickBooks
-- company, so no real deposit was affected. Nothing else changes: the same function as 0783, aliases "pay" and "oth".

-- 0779's document for one posting; only the payout_deposit branch (and its variables) change.
create or replace function app._qbo_posting_doc_before_0412(p_posting uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare lp app.ledger_postings; c app.integration_connections; p app.payments; t app.bank_transactions; o app.store_orders;
        v_doc jsonb; v_dep text; v_cust jsonb; v_problem text; v_lines jsonb := '[]'; v_bank_account uuid;
        v_msg text; v_detail text; v_undeposited text; v_sum bigint; v_partial int; v_n_pay int; v_n_posted int;
begin
  select * into lp from app.ledger_postings where id = p_posting;
  if lp.id is null then return jsonb_build_object('ok', false, 'error', 'The posting was not found.'); end if;
  select * into c from app.qbo_connection(lp.center_id);

  if lp.source_table = 'payments' and lp.txn_type in ('donation_card','recurring_charge','boli_payment','membership_fee','offline_receipt',
                                                       'bank_receipt','stock_gift','refund') then
    select * into p from app.payments where id = lp.source_id;
    if p.id is null then return jsonb_build_object('ok', false, 'error', 'The payment behind this posting was not found.'); end if;
    if p.provider = 'bank' then
      -- The register of the bank line the money arrived on: the payment's own deposit line first, then a line matched to it.
      -- With no line and more than one bank account, Weaver cannot tell which register: the posting waits (no main-bank default).
      select bt.bank_account_id into v_bank_account from app.bank_transactions bt where bt.id = p.deposit_bank_transaction_id;
      if v_bank_account is null then
        select bt.bank_account_id into v_bank_account from app.bank_transactions bt where bt.payment_id = p.id order by bt.posted_on desc limit 1;
      end if;
      if v_bank_account is null then
        select case when count(*) = 1 then (array_agg(b.id))[1] end into v_bank_account
          from app.bank_accounts b where b.center_id = lp.center_id and b.active;
        if v_bank_account is null and exists (select 1 from app.bank_accounts b where b.center_id = lp.center_id and b.active) then
          raise exception 'This bank payment is not linked to the bank line it arrived on, and this organization has more than one bank account, so Weaver cannot tell which QuickBooks bank account it landed in. Match it to its bank line in Giving › Bank, then Retry.'
            using errcode = 'CCMAP';
        end if;
      end if;
      v_dep := case when v_bank_account is not null then app.account_for_bank_account(lp.center_id, v_bank_account)
                    else app.account_for_role(lp.center_id, 'bank') end;
    elsif p.method = 'stock' then
      v_dep := app.account_for_role(lp.center_id, 'stock_clearing');
    elsif p.provider = 'offline' then
      v_dep := app.account_for_role(lp.center_id, 'undeposited_funds');
    else
      v_dep := app.account_for_role(lp.center_id, 'payment_clearing');
    end if;
    v_cust := app._qbo_customer_ref(p.household_id, p.payer_person_id);
    v_doc := jsonb_build_object(
      'entity', case when lp.txn_type = 'refund' then 'RefundReceipt' else 'SalesReceipt' end,
      'txn_date', to_char(p.received_on, 'YYYY-MM-DD'),
      'doc_number', left(coalesce(p.receipt_number, 'CC-' || left(p.id::text, 8)) || case when lp.txn_type = 'refund' then '-R' else '' end, 21),
      'private_note', 'Community Connect ' || case when lp.txn_type = 'refund' then 'refund of ' else '' end || 'receipt '
                      || coalesce(p.receipt_number, left(p.id::text, 8)) || ' · posting ' || lp.id,
      'customer_ref', v_cust->>'ref', 'customer_status', v_cust->>'status',
      'deposit_account', v_dep,
      'lines', app._qbo_payment_lines(c.id, p, lp.amount_cents));
  elsif lp.txn_type = 'processor_fee' then
    select * into p from app.payments where id = lp.source_id;
    v_doc := jsonb_build_object('entity', 'JournalEntry', 'txn_date', to_char(coalesce(p.received_on, lp.period_month), 'YYYY-MM-DD'),
      'doc_number', left('FEE-' || coalesce(p.receipt_number, left(lp.source_id::text, 8)), 21),
      'private_note', 'Community Connect processor fee · posting ' || lp.id,
      'customer_ref', null, 'customer_status', 'none', 'deposit_account', null,
      'lines', jsonb_build_array(
        jsonb_build_object('amount_cents', lp.amount_cents, 'posting', 'Debit', 'account_id', app.account_for_role(lp.center_id, 'merchant_fees'),
                           'description', 'Card processing fee'),
        jsonb_build_object('amount_cents', lp.amount_cents, 'posting', 'Credit', 'account_id', app.account_for_role(lp.center_id, 'payment_clearing'),
                           'description', 'Card processing fee')));
  elsif lp.txn_type = 'payout_deposit' and lp.source_table = 'bank_transactions' then
    select * into t from app.bank_transactions where id = lp.source_id;
    if t.id is null then return jsonb_build_object('ok', false, 'error', 'The bank line behind this deposit was not found.'); end if;
    -- The bank register first (a bank account with no QuickBooks account of its own still waits for one, as before).
    v_dep := app.account_for_bank_account(lp.center_id, t.bank_account_id);
    v_undeposited := app.account_for_role(lp.center_id, 'undeposited_funds');
    -- QuickBooks refuses a plain deposit line on Undeposited Funds (code 6000, 2026-10-14): the receipts held there leave it by
    -- being linked, so one line per QuickBooks receipt the payments of this deposit were posted as (app.match_deposit has
    -- already checked that the payments total the bank line).
    select count(*), count(*) filter (where exists (select 1 from app.ledger_postings rp
                                                     where rp.center_id = pay.center_id and rp.source_table = 'payments' and rp.source_id = pay.id
                                                       and rp.qbo_entity = 'SalesReceipt' and rp.status = 'posted'))
      into v_n_pay, v_n_posted
      from app.payments pay
     where pay.center_id = lp.center_id and pay.deposit_bank_transaction_id = t.id and pay.provider = 'offline';
    if v_n_pay = 0 then
      return jsonb_build_object('ok', false, 'error',
        'No receipts are linked to this deposit, so there is nothing to move out of Undeposited Funds in QuickBooks. Link the receipts to the bank line in Giving › Bank, then Retry.');
    end if;
    if v_n_posted < v_n_pay then
      return jsonb_build_object('ok', false, 'error', format(
        '%s of the %s receipts in this deposit are not in QuickBooks yet, and QuickBooks moves them out of Undeposited Funds one receipt at a time. Wait for them to post (or fix the ones that failed in Accounting › QuickBooks sync), then Retry.',
        v_n_pay - v_n_posted, v_n_pay));
    end if;
    -- One line per QuickBooks receipt (a daily-summary receipt holds several payments). A receipt that also holds money from
    -- another deposit cannot be deposited in part, so that one is left to a person.
    select coalesce(jsonb_agg(jsonb_build_object('amount_cents', g.amount, 'description', left('Receipts ' || g.what, 200), 'account_id', v_undeposited,
                                                 'linked_txn', jsonb_build_object('type', 'SalesReceipt', 'id', g.qbo_ref))
                              order by g.first_on, g.qbo_ref), '[]'::jsonb),
           coalesce(sum(g.amount), 0), count(*) filter (where not g.whole)
      into v_lines, v_sum, v_partial
      from (select rp.qbo_ref, sum(rp.amount_cents)::bigint as amount, min(pay.received_on) as first_on,
                   string_agg(coalesce(pay.receipt_number, left(pay.id::text, 8)), ', ' order by pay.received_on, pay.id) as what,
                   sum(rp.amount_cents) = (select sum(oth.amount_cents) from app.ledger_postings oth
                                            where oth.center_id = lp.center_id and oth.qbo_entity = 'SalesReceipt' and oth.qbo_ref = rp.qbo_ref
                                              and oth.status = 'posted') as whole
              from app.payments pay
              join app.ledger_postings rp on rp.center_id = pay.center_id and rp.source_table = 'payments' and rp.source_id = pay.id
                                         and rp.qbo_entity = 'SalesReceipt' and rp.status = 'posted'
             where pay.center_id = lp.center_id and pay.deposit_bank_transaction_id = t.id and pay.provider = 'offline'
             group by rp.qbo_ref) g;
    if v_partial > 0 then
      return jsonb_build_object('ok', false, 'error',
        'A QuickBooks receipt in this deposit also holds money from other deposits (a daily summary receipt), and QuickBooks cannot deposit part of a receipt. Record this deposit in QuickBooks by hand.');
    end if;
    if v_sum <> lp.amount_cents then
      return jsonb_build_object('ok', false, 'error', format(
        'The QuickBooks receipts of this deposit total $%s but the deposit is $%s, so Weaver will not send a deposit that does not add up.',
        to_char(v_sum / 100.0, 'FM999,999,990.00'), to_char(lp.amount_cents / 100.0, 'FM999,999,990.00')));
    end if;
    v_doc := jsonb_build_object('entity', 'Deposit', 'txn_date', to_char(t.posted_on, 'YYYY-MM-DD'), 'doc_number', null,
      'private_note', 'Community Connect deposit · ' || left(coalesce(t.description, ''), 60) || ' · posting ' || lp.id,
      'customer_ref', null, 'customer_status', 'none',
      'deposit_account', v_dep,
      'lines', v_lines);
  elsif lp.txn_type = 'store_sale' and lp.source_table = 'store_orders' then
    select * into o from app.store_orders where id = lp.source_id;
    if o.id is null then return jsonb_build_object('ok', false, 'error', 'The store order behind this posting was not found.'); end if;
    v_cust := app._qbo_customer_ref(o.household_id, o.person_id);
    if o.subtotal_cents > 0 then
      v_lines := v_lines || jsonb_build_array(app._qbo_sales_line(c.id, app.account_for_role(lp.center_id, 'store.sales'), null, o.subtotal_cents, 'Store sales'));
    end if;
    if o.gift_packing_cents > 0 then
      v_lines := v_lines || jsonb_build_array(app._qbo_sales_line(c.id, app.account_for_role(lp.center_id, 'store.gift_packing'), null, o.gift_packing_cents, 'Gift packing'));
    end if;
    if o.tax_cents > 0 then
      v_lines := v_lines || jsonb_build_array(app._qbo_sales_line(c.id, app.account_for_role(lp.center_id, 'sales_tax_payable'), null, o.tax_cents, 'Sales tax'));
    end if;
    v_doc := jsonb_build_object('entity', 'SalesReceipt', 'txn_date', to_char(coalesce(o.picked_up_at, o.placed_at, o.created_at), 'YYYY-MM-DD'),
      'doc_number', left(o.order_number, 21), 'private_note', 'Community Connect store order ' || o.order_number || ' · posting ' || lp.id,
      'customer_ref', v_cust->>'ref', 'customer_status', v_cust->>'status',
      'deposit_account', app.account_for_role(lp.center_id, 'payment_clearing'), 'lines', v_lines);
  else
    return jsonb_build_object('ok', false, 'error',
      format('Posting "%s" entries to QuickBooks is not built yet; a person records this one in QuickBooks.', replace(lp.txn_type, '_', ' ')));
  end if;

  v_problem := app._qbo_doc_problem(c.id, v_doc);
  if v_problem is not null then return jsonb_build_object('ok', false, 'error', v_problem); end if;
  return jsonb_build_object('ok', true, 'doc', v_doc);
exception
  when sqlstate 'CCMAP' then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
    return jsonb_build_object('ok', false, 'error', v_msg, 'needs_mapping', nullif(v_detail, ''));
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
