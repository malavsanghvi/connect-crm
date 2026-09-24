-- Onboarding (stream o-quickbooks) · 4 of 6: what each posting becomes in
-- QuickBooks. The database decides the accounts, items, classes, customer and
-- amounts; the background service only turns this "document" into QuickBooks
-- JSON (worker/src/qbo/documents.ts) and sends it.
--
-- A document: {entity: SalesReceipt|RefundReceipt|Deposit|JournalEntry,
--   txn_date, doc_number, private_note, customer_ref, customer_status,
--   deposit_account, lines: [{amount_cents, description, item_id, account_id,
--   class_id, posting (Debit|Credit, journal entries)}]}
--
-- Which money becomes what (cash basis):
--   payments (card, recurring, boli, membership, offline, bank, stock)
--        -> SalesReceipt: one line per income account + class, through the
--           QuickBooks item that posts to that income account; deposited to
--           payment clearing (card), undeposited funds (offline checks/cash),
--           the bank (Zelle / ACH / wire straight in) or stock clearing
--   refund            -> RefundReceipt, paid from where the money was deposited
--   processor_fee     -> JournalEntry: debit merchant fees, credit payment clearing
--   payout_deposit    -> Deposit to the bank (the bank account's own QuickBooks
--                        account when it has one) from undeposited funds
--   store_sale        -> SalesReceipt: store sales, gift packing, sales tax
-- Income account of a gift: the campaign's own income account when it has one,
-- else the mapping for its kind (income.<kind>), else income.general. Class:
-- the fund's QuickBooks class. CustomerRef: app.qbo_customer_for(household,
-- person) from the donor matching stream (o-qbo-match); until it exists the
-- document says customer_status "not_built" and posts without a customer.
set client_min_messages = warning;

-- The account mapped for a purpose (only an approved mapping counts).
create or replace function app._qbo_account(p_center uuid, p_purpose text) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select qbo_account_id from app.qbo_account_mappings where center_id = p_center and purpose = p_purpose and approved_at is not null
$$;

-- The QuickBooks item a sales line uses to reach an income account.
create or replace function app._qbo_item_for(p_connection uuid, p_account text) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select i.qbo_id from app.qbo_items i
   where i.connection_id = p_connection and i.active and i.raw #>> '{IncomeAccountRef,value}' = p_account
     and coalesce(i.raw->>'Type', 'Service') in ('Service','NonInventory','Other')
   order by (i.raw->>'Type' = 'Service') desc nulls last, i.name, i.qbo_id
   limit 1
$$;

-- The QuickBooks customer of a household / person, from the donor matching stream.
create or replace function app._qbo_customer_ref(p_household uuid, p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v text;
begin
  if p_household is null then return jsonb_build_object('ref', null, 'status', 'none'); end if;
  if to_regprocedure('app.qbo_customer_for(uuid,uuid)') is null then
    return jsonb_build_object('ref', null, 'status', 'not_built');
  end if;
  execute 'select app.qbo_customer_for($1, $2)' into v using p_household, p_person;
  return jsonb_build_object('ref', v, 'status', case when v is null then 'unmatched' else 'matched' end);
exception when others then
  return jsonb_build_object('ref', null, 'status', 'error', 'error', sqlerrm);
end $$;

-- Every account, item and class of a document must be active in the chart
-- pulled from the connection in use. Returns the first problem, or null.
create or replace function app._qbo_doc_problem(p_connection uuid, p_doc jsonb) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare l jsonb; a app.qbo_accounts; k app.qbo_classes; i app.qbo_items;
begin
  if p_doc->>'deposit_account' is null and p_doc->>'entity' in ('SalesReceipt','RefundReceipt','Deposit') then
    return 'The account the money is deposited to is not mapped and approved.';
  end if;
  if jsonb_array_length(coalesce(p_doc->'lines', '[]')) = 0 then return 'The entry has no lines.'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_doc->'lines', '[]')) loop
    if (l->>'amount_cents')::bigint <= 0 then return 'A line has no amount.'; end if;
    if coalesce(l->>'account_id', l->>'item_id') is null then
      return 'An account this entry needs is not mapped and approved (' || coalesce(l->>'description', 'a line') || ').';
    end if;
    if l->>'item_id' is not null then
      select * into i from app.qbo_items where connection_id = p_connection and qbo_id = l->>'item_id';
      if i.qbo_id is null or not i.active then return format('The QuickBooks item %s is missing or inactive.', coalesce(i.name, l->>'item_id')); end if;
    end if;
    if l->>'account_id' is not null then
      select * into a from app.qbo_accounts where connection_id = p_connection and qbo_id = l->>'account_id';
      if a.qbo_id is null or not a.active then
        return format('The QuickBooks account %s is missing or inactive; pull the lists and fix the mapping.', coalesce('"' || a.name || '"', l->>'account_id'));
      end if;
    end if;
    if l->>'class_id' is not null then
      select * into k from app.qbo_classes where connection_id = p_connection and qbo_id = l->>'class_id';
      if k.qbo_id is null or not k.active then
        return format('The QuickBooks class %s is missing or inactive.', coalesce('"' || k.name || '"', l->>'class_id'));
      end if;
    end if;
  end loop;
  if p_doc->>'deposit_account' is not null then
    select * into a from app.qbo_accounts where connection_id = p_connection and qbo_id = p_doc->>'deposit_account';
    if a.qbo_id is null or not a.active then return 'The account the money is deposited to is missing or inactive in QuickBooks.'; end if;
  end if;
  return null;
end $$;

-- Sales lines (item + class) for an amount per income account.
create or replace function app._qbo_sales_line(p_connection uuid, p_account text, p_class text, p_amount bigint, p_description text)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_item text; v_name text;
begin
  if p_account is null then
    raise exception 'The QuickBooks account for "%" is not mapped and approved.', coalesce(p_description, 'a line');
  end if;
  v_item := app._qbo_item_for(p_connection, p_account);
  if v_item is null then
    select name into v_name from app.qbo_accounts where connection_id = p_connection and qbo_id = p_account;
    raise exception 'No QuickBooks item posts to the income account "%". In QuickBooks, create a Service item that uses that account, then pull the lists again.',
      coalesce(v_name, p_account) using errcode = 'P0001', hint = 'qbo_item_missing';
  end if;
  return jsonb_build_object('amount_cents', p_amount, 'description', left(p_description, 200), 'item_id', v_item,
                            'account_id', p_account, 'class_id', p_class);
end $$;

-- The income lines of a payment: allocations grouped by income account + class,
-- the unallocated rest to general income (the general fund's class).
create or replace function app._qbo_payment_lines(p_connection uuid, p_payment app.payments, p_amount bigint)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_gen text := app._qbo_account(p_payment.center_id, 'income.general'); v_gen_class text; v jsonb := '[]'; r record;
        v_alloc bigint; v_scale boolean;
begin
  if v_gen is null then raise exception 'The General donations income account is not mapped and approved.'; end if;
  select qbo_class_id into v_gen_class from app.funds where center_id = p_payment.center_id and key = 'general';
  select coalesce(sum(amount_cents), 0) into v_alloc from app.payment_allocations where payment_id = p_payment.id;
  -- A partial refund posts to general income (its split across funds is a person's call).
  v_scale := p_amount <> p_payment.amount_cents;
  if v_scale then
    return jsonb_build_array(app._qbo_sales_line(p_connection, v_gen, v_gen_class, p_amount, 'Refund'));
  end if;
  for r in
    with lines as (
      select a.amount_cents,
             coalesce(cp.qbo_income_account_id, app._qbo_account(p_payment.center_id, 'income.' || cp.kind), v_gen) as account,
             f.qbo_class_id as class_id, coalesce(cp.name, f.name, 'Gift') as what
        from app.payment_allocations a
        join app.pledges pl on pl.id = a.pledge_id
        left join app.campaigns cp on cp.id = pl.campaign_id
        left join app.funds f on f.id = coalesce(pl.fund_id, cp.fund_id)
       where a.payment_id = p_payment.id
      union all
      select p_payment.amount_cents - v_alloc, v_gen, v_gen_class, 'Donation'
       where p_payment.amount_cents - v_alloc > 0)
    select account, class_id, sum(amount_cents)::bigint as amount, string_agg(distinct what, ', ') as what
      from lines group by account, class_id order by 3 desc
  loop
    v := v || jsonb_build_array(app._qbo_sales_line(p_connection, r.account, r.class_id, r.amount, r.what));
  end loop;
  return v;
end $$;

-- The document for one ledger posting: {ok, doc} or {ok: false, error}.
create or replace function app.qbo_posting_doc(p_posting uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare lp app.ledger_postings; c app.integration_connections; p app.payments; t app.bank_transactions; o app.store_orders;
        v_doc jsonb; v_dep text; v_cust jsonb; v_bank text; v_problem text; v_lines jsonb := '[]';
begin
  select * into lp from app.ledger_postings where id = p_posting;
  if lp.id is null then return jsonb_build_object('ok', false, 'error', 'The posting was not found.'); end if;
  select * into c from app.qbo_connection(lp.center_id);

  if lp.source_table = 'payments' and lp.txn_type in ('donation_card','recurring_charge','boli_payment','membership_fee','offline_receipt',
                                                       'bank_receipt','stock_gift','refund') then
    select * into p from app.payments where id = lp.source_id;
    if p.id is null then return jsonb_build_object('ok', false, 'error', 'The payment behind this posting was not found.'); end if;
    v_dep := app._qbo_account(lp.center_id, case
      when p.provider = 'bank' then 'bank'
      when p.method = 'stock' then 'stock_clearing'
      when p.provider = 'offline' then 'undeposited_funds'
      else 'payment_clearing' end);
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
        jsonb_build_object('amount_cents', lp.amount_cents, 'posting', 'Debit', 'account_id', app._qbo_account(lp.center_id, 'merchant_fees'),
                           'description', 'Card processing fee'),
        jsonb_build_object('amount_cents', lp.amount_cents, 'posting', 'Credit', 'account_id', app._qbo_account(lp.center_id, 'payment_clearing'),
                           'description', 'Card processing fee')));
  elsif lp.txn_type = 'payout_deposit' and lp.source_table = 'bank_transactions' then
    select * into t from app.bank_transactions where id = lp.source_id;
    if t.id is null then return jsonb_build_object('ok', false, 'error', 'The bank line behind this deposit was not found.'); end if;
    select b.qbo_account_id into v_bank from app.bank_accounts b
     where b.id = t.bank_account_id
       and exists (select 1 from app.qbo_accounts a where a.connection_id = c.id and a.qbo_id = b.qbo_account_id and a.active);
    v_doc := jsonb_build_object('entity', 'Deposit', 'txn_date', to_char(t.posted_on, 'YYYY-MM-DD'), 'doc_number', null,
      'private_note', 'Community Connect deposit · ' || left(coalesce(t.description, ''), 60) || ' · posting ' || lp.id,
      'customer_ref', null, 'customer_status', 'none',
      'deposit_account', coalesce(v_bank, app._qbo_account(lp.center_id, 'bank')),
      'lines', jsonb_build_array(jsonb_build_object('amount_cents', lp.amount_cents, 'account_id', app._qbo_account(lp.center_id, 'undeposited_funds'),
                                                    'description', 'Checks and cash deposited')));
  elsif lp.txn_type = 'store_sale' and lp.source_table = 'store_orders' then
    select * into o from app.store_orders where id = lp.source_id;
    if o.id is null then return jsonb_build_object('ok', false, 'error', 'The store order behind this posting was not found.'); end if;
    v_cust := app._qbo_customer_ref(o.household_id, o.person_id);
    if o.subtotal_cents > 0 then
      v_lines := v_lines || jsonb_build_array(app._qbo_sales_line(c.id, app._qbo_account(lp.center_id, 'store.sales'), null, o.subtotal_cents, 'Store sales'));
    end if;
    if o.gift_packing_cents > 0 then
      v_lines := v_lines || jsonb_build_array(app._qbo_sales_line(c.id, coalesce(app._qbo_account(lp.center_id, 'store.gift_packing'),
                                                                               app._qbo_account(lp.center_id, 'store.sales')), null, o.gift_packing_cents, 'Gift packing'));
    end if;
    if o.tax_cents > 0 then
      v_lines := v_lines || jsonb_build_array(app._qbo_sales_line(c.id, app._qbo_account(lp.center_id, 'sales_tax_payable'), null, o.tax_cents, 'Sales tax'));
    end if;
    v_doc := jsonb_build_object('entity', 'SalesReceipt', 'txn_date', to_char(coalesce(o.picked_up_at, o.placed_at, o.created_at), 'YYYY-MM-DD'),
      'doc_number', left(o.order_number, 21), 'private_note', 'Community Connect store order ' || o.order_number || ' · posting ' || lp.id,
      'customer_ref', v_cust->>'ref', 'customer_status', v_cust->>'status',
      'deposit_account', app._qbo_account(lp.center_id, 'payment_clearing'), 'lines', v_lines);
  else
    return jsonb_build_object('ok', false, 'error',
      format('Posting "%s" entries to QuickBooks is not built yet; a person records this one in QuickBooks.', replace(lp.txn_type, '_', ' ')));
  end if;

  v_problem := app._qbo_doc_problem(c.id, v_doc);
  if v_problem is not null then return jsonb_build_object('ok', false, 'error', v_problem); end if;
  return jsonb_build_object('ok', true, 'doc', v_doc);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

revoke execute on function app._qbo_account(uuid, text), app._qbo_item_for(uuid, text), app._qbo_customer_ref(uuid, uuid),
  app._qbo_doc_problem(uuid, jsonb), app._qbo_sales_line(uuid, text, text, bigint, text),
  app._qbo_payment_lines(uuid, app.payments, bigint), app.qbo_posting_doc(uuid)
  from public, anon, authenticated, service_role;
