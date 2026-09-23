-- 0013_chase_and_org_ids.sql
-- JSH specifics generalized as per-center configuration:
--   * Org member IDs are short numbers with significant leading zeros (JSH: 4
--     digits, "0417"). "417" and "0417" are the same ID.
--   * The bank is Chase. Chase's CSV export carries a transaction Type
--     (QUICKPAY_CREDIT = incoming Zelle, ACH_CREDIT, CHECK_DEPOSIT, ...) and a
--     "Check or Slip #". Check and cash deposits are BATCHES: one bank line
--     covers several checks already recorded one by one, so they match a set of
--     payments, not a household.
--   * Money from donor-advised funds and matching-gift platforms arrives by ACH
--     from the platform, not the donor; payouts from card processors are not gifts.

-- ---------------------------------------------------------------------------
-- Bank accounts / transactions: Chase fields
-- ---------------------------------------------------------------------------
alter table app.bank_accounts
  add column statement_format text not null default 'generic_csv'
    check (statement_format in ('generic_csv','chase_csv','ofx'));

alter table app.bank_transactions
  add column bank_type text,               -- Chase "Type": QUICKPAY_CREDIT, ACH_CREDIT, CHECK_DEPOSIT, DEPOSIT, ...
  add column bank_details text,            -- Chase "Details": CREDIT, DEBIT, CHECK, DSLIP
  add column check_or_slip text,           -- Chase "Check or Slip #"
  add column raw jsonb,                    -- the original statement row
  add column is_batch_deposit boolean not null default false,
  add column originator_kind text check (originator_kind in ('daf','matching_gift','payment_processor','payroll_giving'));

alter table app.payments
  add column deposit_bank_transaction_id uuid references app.bank_transactions(id);
create index on app.payments (center_id, deposit_bank_transaction_id);

-- Known ACH originators (platform list + per-center additions).
create table app.known_originators (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid references app.centers(id) on delete cascade,   -- null = platform-wide
  pattern    text not null,                                        -- case-insensitive regex on the payer name
  kind       text not null check (kind in ('daf','matching_gift','payment_processor','payroll_giving')),
  label      text not null
);
alter table app.known_originators enable row level security;
create policy known_originators_read on app.known_originators for select to authenticated
  using (center_id is null or app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.record_offline'));
create policy known_originators_write on app.known_originators for all to authenticated
  using (center_id is not null and app.has_permission(center_id, 'accounting.manage'))
  with check (center_id is not null and app.has_permission(center_id, 'accounting.manage'));

insert into app.known_originators (center_id, pattern, kind, label) values
  (null, 'fidelity\s+charitable|fidelity\s+invest.*charit', 'daf', 'Fidelity Charitable'),
  (null, 'schwab\s+charitable', 'daf', 'Schwab Charitable'),
  (null, 'vanguard\s+charitable', 'daf', 'Vanguard Charitable'),
  (null, 'national\s+philanthropic', 'daf', 'National Philanthropic Trust'),
  (null, 'daffy', 'daf', 'Daffy'),
  (null, 'american\s+endowment|renaissance\s+charit', 'daf', 'Donor-advised fund'),
  (null, 'benevity', 'matching_gift', 'Benevity'),
  (null, 'yourcause|blackbaud\s+giving', 'matching_gift', 'YourCause / Blackbaud Giving Fund'),
  (null, 'cybergrants', 'matching_gift', 'CyberGrants'),
  (null, 'bright\s*funds', 'matching_gift', 'Bright Funds'),
  (null, 'network\s+for\s+good', 'matching_gift', 'Network for Good'),
  (null, 'paypal\s+giving|pp\s*giving\s*fund', 'matching_gift', 'PayPal Giving Fund'),
  (null, 'america.?s\s+charities', 'payroll_giving', 'America''s Charities'),
  (null, '^stripe|stripe\s+transfer', 'payment_processor', 'Stripe payout'),
  (null, '^square|sq\s*\*|square\s+inc', 'payment_processor', 'Square payout'),
  (null, '^paypal(?!\s+giving)', 'payment_processor', 'PayPal payout');

-- ---------------------------------------------------------------------------
-- Parsing: Chase formats first, generic fallbacks after
-- ---------------------------------------------------------------------------
drop trigger bank_transactions_prepare on app.bank_transactions;
drop function app.parse_bank_description(text, jsonb);

create or replace function app.parse_bank_description(p_desc text, p_rules jsonb default '[]'::jsonb, p_bank_type text default null)
returns table (channel text, payer_name text, reference text, is_batch boolean)
language plpgsql immutable as $$
declare m text[]; r jsonb; v_rest text; v_type text := upper(coalesce(p_bank_type, ''));
begin
  is_batch := false;
  for r in select * from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) loop
    m := regexp_match(p_desc, r->>'pattern', 'i');
    if m is not null then
      channel := r->>'channel'; payer_name := trim(m[1]); reference := case when array_length(m, 1) > 1 then m[2] end;
      return next; return;
    end if;
  end loop;

  -- Other banks: "ZELLE FROM PRIYA S SHAH ON 09/14 REF # PP0ABC123"
  m := regexp_match(p_desc, 'zelle\s+(?:payment\s+)?from\s+(.+?)\s+(?:on\s+\d{1,2}/\d{1,2}(?:/\d{2,4})?\s+)?(?:ref|conf(?:irmation)?)\s*#?\s*:?\s*(\S+)', 'i');
  if m is not null then
    channel := 'zelle';
    payer_name := trim(regexp_replace(m[1], '\s+on\s+\d{1,2}/\d{1,2}(/\d{2,4})?\s*$', '', 'i'));
    reference := m[2]; return next; return;
  end if;
  -- Chase: "Zelle Payment From Rahul Shah Jpm99bxk2q1v" — the confirmation is the
  -- last token; its prefix depends on the sender's bank (JPM, BAC, WFCT, H0, ...).
  m := regexp_match(p_desc, '^\s*zelle\s+(?:payment\s+)?from\s+(.+?)\s+(\S+)\s*$', 'i');
  if m is not null and m[2] ~ '[0-9]' and length(m[2]) >= 8 then
    channel := 'zelle'; payer_name := trim(m[1]); reference := m[2]; return next; return;
  end if;
  if v_type = 'QUICKPAY_CREDIT' or p_desc ~* '^\s*zelle\s+(?:payment\s+)?from\s+' then
    m := regexp_match(p_desc, 'from\s+(.+)$', 'i');
    channel := 'zelle'; payer_name := trim(m[1]); reference := null; return next; return;
  end if;

  -- ACH (Chase): "ORIG CO NAME:FIDELITY CHARITABLE ORIG ID:1234567890 DESC DATE:... CO ENTRY DESCR:... IND NAME:..."
  -- (Postgres regex greediness follows the first quantifier, so take the rest of
  -- the line and cut it at the first known field label instead of a lazy match.)
  v_rest := substring(p_desc from '(?i)orig\s+co\s+name\s*:\s*(.*)$');
  if v_rest is not null then
    channel := 'ach';
    payer_name := trim(regexp_replace(v_rest, '\s+(orig\s+id|desc\s+date|co\s+entry|sec\s*:|trace|ind\s+id|ind\s+name|eed)\y.*$', '', 'i'));
    reference := (regexp_match(p_desc, 'trace\s*#?\s*:?\s*(\d+)', 'i'))[1];
    return next; return;
  end if;

  -- Deposits: batches of checks / cash.
  if v_type in ('CHECK_DEPOSIT','DEPOSIT','ATM_DEPOSIT')
     or p_desc ~* '(remote\s+online\s+deposit|^\s*deposit\y|branch\s+deposit|atm\s+(check\s+)?deposit|mobile\s+deposit)' then
    channel := case when v_type = 'ATM_DEPOSIT' and p_desc !~* 'check' then 'cash_deposit' else 'check' end;
    payer_name := null;
    reference := coalesce((regexp_match(p_desc, '(?:#|id\s+number|slip)\s*:?\s*(\d+)', 'i'))[1], null);
    is_batch := true;
    return next; return;
  end if;
  m := regexp_match(p_desc, '^(?:deposited\s+)?check\s*#?\s*(\d+)', 'i');
  if m is not null then channel := 'check'; payer_name := null; reference := m[1]; return next; return; end if;

  if v_type = 'WIRE_INCOMING' or p_desc ~* '(incoming\s+wire|wire\s+(?:transfer\s+)?(?:in|credit)|fedwire\s+credit)' then
    channel := 'wire';
    payer_name := trim(regexp_replace(substring(p_desc from '(?i)(?:b/o|by\s+order\s+of|orig(?:inator)?)\s*:?\s*(.*)$'), '\s+(ref|imad|omad|trn)\y.*$', '', 'i'));
    reference := (regexp_match(p_desc, '(?:imad|trn|ref)\s*:?\s*(\S+)', 'i'))[1];
    return next; return;
  end if;
  if p_desc ~* '(stripe|square|paypal)\s+(transfer|payout)' then
    channel := 'card_payout'; payer_name := null; reference := null; return next; return;
  end if;
  if v_type = 'ACH_CREDIT' then channel := 'ach'; payer_name := null; reference := null; return next; return; end if;
  channel := 'other'; payer_name := null; reference := null; return next;
end $$;

create or replace function app.bank_transactions_prepare() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare p record; v_rules jsonb; o record;
begin
  select parse_rules into v_rules from app.bank_accounts where id = new.bank_account_id;
  select * into p from app.parse_bank_description(new.description, v_rules, new.bank_type);
  new.channel := coalesce(new.channel, p.channel);
  new.payer_name := coalesce(new.payer_name, p.payer_name);
  new.reference := coalesce(new.reference, p.reference, nullif(new.check_or_slip, ''));
  new.is_batch_deposit := new.is_batch_deposit or coalesce(p.is_batch, false);
  new.payer_normalized := app.normalize_identifier(new.payer_name);
  -- Donor-advised funds, matching-gift platforms, card-processor payouts.
  if new.payer_name is not null or new.channel = 'card_payout' then
    select k.kind, k.label into o from app.known_originators k
     where (k.center_id is null or k.center_id = new.center_id)
       and (coalesce(new.payer_name, '') ~* k.pattern or new.description ~* k.pattern)
     order by k.center_id nulls last limit 1;
    if o.kind is not null then
      new.originator_kind := o.kind;
      if o.kind = 'payment_processor' then new.channel := 'card_payout'; end if;
    end if;
  end if;
  if new.fingerprint is null then
    new.fingerprint := encode(digest(new.bank_account_id::text || '|' || new.posted_on || '|' || new.amount_cents || '|' ||
                              coalesce(new.reference, '') || '|' || coalesce(new.check_or_slip, '') || '|' ||
                              coalesce(app.normalize_identifier(new.description), ''), 'sha256'), 'hex');
  end if;
  if new.status = 'unmatched' and (new.channel = 'card_payout' or new.originator_kind = 'payment_processor') then
    new.status := 'payout';
  end if;
  return new;
end $$;
create trigger bank_transactions_prepare before insert on app.bank_transactions
  for each row execute function app.bank_transactions_prepare();

-- ---------------------------------------------------------------------------
-- Org member IDs: numeric IDs padded to the center's width ("417" = "0417")
-- Rule: centers.rules.identifiers = {"org_member_digits": 4, "org_member_label": "JSH member ID", "org_member_system": "jsh_register"}
-- ---------------------------------------------------------------------------
create or replace function app.canonical_org_member(p_center uuid, p_value text) returns text
language sql stable security definer set search_path = app, public as $$
  select case
    when app.normalize_identifier(p_value) ~ '^[0-9]+$'
         and (select (rules->'identifiers'->>'org_member_digits')::int from app.centers where id = p_center) is not null
    then lpad(coalesce(nullif(ltrim(app.normalize_identifier(p_value), '0'), ''), '0'),
              (select (rules->'identifiers'->>'org_member_digits')::int from app.centers where id = p_center), '0')
    else app.normalize_identifier(p_value)
  end
$$;

create or replace function app.external_ids_normalize() returns trigger
language plpgsql as $$
begin
  new.normalized := coalesce(case when new.kind = 'org_member' then app.canonical_org_member(new.center_id, new.value)
                                  else app.normalize_identifier(new.value) end, '');
  if new.normalized = '' then raise exception 'identifier value is empty'; end if;
  if new.household_id is null and new.person_id is not null then
    select hm.household_id into new.household_id from app.household_members hm
     where hm.person_id = new.person_id and hm.left_at is null order by hm.is_primary desc limit 1;
  end if;
  return new;
end $$;

-- Also match the padded org-member form of whatever was typed.
create or replace function app.resolve_identifier(p_center uuid, p_value text)
returns table (kind text, system text, value text, person_id uuid, household_id uuid, display_name text)
language sql stable security definer set search_path = app, public as $$
  with q as (select app.normalize_identifier(p_value) as n, app.canonical_org_member(p_center, p_value) as org_n
             where app.has_permission(p_center, 'people.view') or app.has_permission(p_center, 'giving.view')
                or app.has_permission(p_center, 'giving.record_offline'))
  select 'connect_member', 'connect', p.member_number, p.id,
         (select hm.household_id from app.household_members hm where hm.person_id = p.id and hm.left_at is null order by hm.is_primary desc limit 1),
         p.first_name || ' ' || p.last_name
    from app.people p, q where p.center_id = p_center and app.normalize_identifier(p.member_number) = q.n
  union all
  select 'connect_household', 'connect', h.household_number, null, h.id, h.display_name
    from app.households h, q where h.center_id = p_center and app.normalize_identifier(h.household_number) = q.n
  union all
  select e.kind::text, e.system, e.value, e.person_id, e.household_id,
         coalesce((select p.first_name || ' ' || p.last_name from app.people p where p.id = e.person_id),
                  (select h.display_name from app.households h where h.id = e.household_id))
    from app.external_ids e, q
   where e.center_id = p_center and (e.valid_to is null or e.valid_to >= current_date)
     and (e.normalized = q.n or (e.kind = 'org_member' and e.normalized = q.org_n))
$$;

-- ---------------------------------------------------------------------------
-- Household suggestions: skip batch deposits and processor payouts; recognize
-- "member 0417" / "#0417" in memos; flag DAF / matching-gift lines.
-- ---------------------------------------------------------------------------
create or replace function app.suggest_bank_matches(p_txn uuid)
returns table (household_id uuid, household_name text, household_number text, score numeric, reason text, open_pledge_cents bigint)
language sql stable security definer set search_path = app, public as $$
  with t as (select * from app.bank_transactions where id = p_txn
             and not is_batch_deposit and status <> 'payout'
             and (app.has_permission(center_id, 'giving.record_offline') or app.has_permission(center_id, 'giving.view'))),
  cands as (
    select e.household_id, 0.95::numeric as score, 'Known bank payer name "' || e.value || '"' as reason
      from app.external_ids e, t
     where e.center_id = t.center_id and e.kind = 'bank_payer' and e.normalized = t.payer_normalized
    union all
    select hm.household_id, 0.70, 'Payer name matches member ' || p.first_name || ' ' || p.last_name
      from app.people p join app.household_members hm on hm.person_id = p.id and hm.left_at is null, t
     where p.center_id = t.center_id and t.payer_normalized is not null
       and (app.normalize_identifier(p.first_name || ' ' || p.last_name) = t.payer_normalized
         or app.normalize_identifier(p.last_name || ' ' || p.first_name) = t.payer_normalized
         or regexp_replace(t.payer_normalized, ' [A-Z] ', ' ') = app.normalize_identifier(p.first_name || ' ' || p.last_name))
    union all
    select coalesce(r.household_id, (select hm.household_id from app.household_members hm where hm.person_id = r.person_id limit 1)),
           0.90, 'Statement mentions ' || r.value
      from t, lateral regexp_matches(t.description, '([A-Z]{2,6}-(?:H-)?\d{4,6})', 'g') as x(m),
           lateral app.resolve_identifier(t.center_id, x.m[1]) r
    union all
    select coalesce(r.household_id, (select hm.household_id from app.household_members hm where hm.person_id = r.person_id limit 1)),
           0.90, 'Statement mentions member ID ' || r.value
      from t, lateral regexp_matches(t.description, '(?:member|mem|mbr|id)\s*(?:id|no|#)?\s*[:#]?\s*(\d{2,6})\y', 'gi') as x(m),
           lateral app.resolve_identifier(t.center_id, x.m[1]) r
     where r.kind = 'org_member'
  ),
  ranked as (
    select c.household_id, max(c.score) as score, string_agg(distinct c.reason, '; ') as reason
      from cands c where c.household_id is not null group by c.household_id
  )
  select r.household_id, h.display_name, h.household_number,
         least(1, r.score + case when exists (select 1 from app.pledges pl, t where pl.household_id = r.household_id
                                  and pl.status in ('open','partially_paid') and pl.amount_cents - pl.paid_cents = t.amount_cents)
                            then 0.04 else 0 end),
         r.reason || coalesce((select case t.originator_kind when 'daf' then ' · via donor-advised fund'
                                                             when 'matching_gift' then ' · via matching-gift platform' end from t), ''),
         (select coalesce(sum(pl.amount_cents - pl.paid_cents), 0) from app.pledges pl
           where pl.household_id = r.household_id and pl.status in ('open','partially_paid'))
    from ranked r join app.households h on h.id = r.household_id
   order by 4 desc
$$;

-- confirm_bank_match: DAF / matching-gift lines record the right method; batch
-- deposits and payouts are refused (use match_deposit / payouts).
create or replace function app.confirm_bank_match(p_txn uuid, p_household uuid, p_pledge_ids uuid[] default null,
                                                  p_learn_payer boolean default true, p_payer_person uuid default null)
returns uuid language plpgsql security definer set search_path = app, public as $$
declare t app.bank_transactions; v_payment uuid; v_method app.payment_method;
begin
  select * into t from app.bank_transactions where id = p_txn for update;
  if t.id is null then raise exception 'bank line not found'; end if;
  if not (app.has_permission(t.center_id, 'giving.record_offline') or app.has_permission(t.center_id, 'giving.manage')) then
    raise exception 'not allowed to reconcile bank lines';
  end if;
  if t.status = 'matched' then raise exception 'bank line already matched'; end if;
  if t.is_batch_deposit then raise exception 'this is a deposit of several checks — match it to the recorded payments instead'; end if;
  if t.status = 'payout' then raise exception 'this is a card-processor payout, not a gift'; end if;
  if t.amount_cents <= 0 then raise exception 'only incoming money can be matched to a household'; end if;
  if not exists (select 1 from app.households where id = p_household and center_id = t.center_id) then
    raise exception 'household not in this center';
  end if;
  v_method := case
    when t.originator_kind = 'daf' then 'daf'
    when t.originator_kind in ('matching_gift','payroll_giving') then 'matching_gift'
    when t.channel = 'zelle' then 'zelle' when t.channel = 'check' then 'check' when t.channel = 'ach' then 'ach'
    else 'other' end;
  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, provider_ref,
                            check_number, received_on, recorded_by, memo, deposit_bank_transaction_id)
    values (t.center_id, p_household, p_payer_person, t.amount_cents, v_method, 'settled', 'bank',
            coalesce(t.reference, t.fingerprint), case when t.channel = 'check' then t.reference end, t.posted_on, auth.uid(),
            'Bank: ' || t.description, t.id)
    returning id into v_payment;
  perform app.allocate_payment(v_payment, p_pledge_ids, true);
  perform app.enqueue_payment_posting(v_payment);
  update app.bank_transactions set status = 'matched', matched_household_id = p_household, payment_id = v_payment,
         matched_by = auth.uid(), matched_at = now() where id = p_txn;
  -- Learn the payer name — but never a DAF / platform name (it is not the donor).
  if p_learn_payer and t.payer_name is not null and t.originator_kind is null then
    insert into app.external_ids (center_id, household_id, person_id, kind, system, value, label, source, confidence, created_by,
                                  times_matched, last_matched_at)
      values (t.center_id, p_household, p_payer_person, 'bank_payer',
              coalesce((select lower(institution) from app.bank_accounts where id = t.bank_account_id), 'bank'),
              t.payer_name, initcap(coalesce(t.channel, 'bank')) || ' payer name', 'learned', 0.9, auth.uid(), 1, now())
    on conflict (center_id, household_id, system, normalized) where kind = 'bank_payer'
      do update set times_matched = app.external_ids.times_matched + 1, last_matched_at = now(),
                    confidence = least(1, coalesce(app.external_ids.confidence, 0.9) + 0.02);
  end if;
  return v_payment;
end $$;

-- ---------------------------------------------------------------------------
-- Batch deposits: one bank line = several recorded check / cash payments
-- ---------------------------------------------------------------------------
create or replace function app.suggest_deposit_payments(p_txn uuid)
returns table (payment_id uuid, household_name text, receipt_number text, method app.payment_method, amount_cents bigint,
               received_on date, check_number text, envelope_number text, exact_total boolean)
language sql stable security definer set search_path = app, public as $$
  with t as (select * from app.bank_transactions where id = p_txn and is_batch_deposit
             and (app.has_permission(center_id, 'giving.record_offline') or app.has_permission(center_id, 'giving.view'))),
  c as (
    select p.* from app.payments p, t
     where p.center_id = t.center_id and p.provider = 'offline' and p.deposit_bank_transaction_id is null
       and p.method in ('check','cash','stock','other') and p.status in ('captured','pending_clearing')
       and p.received_on between t.posted_on - 21 and t.posted_on
       and (t.channel <> 'cash_deposit' or p.method = 'cash')
  )
  select c.id, h.display_name, c.receipt_number, c.method, c.amount_cents, c.received_on, c.check_number, c.envelope_number,
         (select sum(amount_cents) from c) = (select amount_cents from t)
    from c join app.households h on h.id = c.household_id
   order by c.received_on, c.envelope_number nulls last, c.created_at
$$;

create or replace function app.match_deposit(p_txn uuid, p_payment_ids uuid[]) returns integer
language plpgsql security definer set search_path = app, public as $$
declare t app.bank_transactions; v_sum bigint; v_n int;
begin
  select * into t from app.bank_transactions where id = p_txn for update;
  if t.id is null then raise exception 'bank line not found'; end if;
  if not (app.has_permission(t.center_id, 'giving.record_offline') or app.has_permission(t.center_id, 'giving.manage')) then
    raise exception 'not allowed to reconcile bank lines';
  end if;
  if t.status = 'matched' then raise exception 'bank line already matched'; end if;
  if coalesce(array_length(p_payment_ids, 1), 0) = 0 then raise exception 'choose the payments in this deposit'; end if;
  select coalesce(sum(amount_cents), 0), count(*) into v_sum, v_n from app.payments
   where id = any(p_payment_ids) and center_id = t.center_id and provider = 'offline' and deposit_bank_transaction_id is null;
  if v_n <> array_length(p_payment_ids, 1) then raise exception 'some payments are already deposited or not offline payments'; end if;
  if v_sum <> t.amount_cents then
    raise exception 'the chosen payments total % but the deposit is %', v_sum, t.amount_cents;
  end if;
  update app.payments set deposit_bank_transaction_id = t.id, status = 'settled' where id = any(p_payment_ids);
  update app.bank_transactions set status = 'matched', is_batch_deposit = true, matched_by = auth.uid(), matched_at = now()
   where id = p_txn;
  -- One QuickBooks Deposit groups the receipts (undeposited funds -> bank).
  insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month, triggered_by)
  values (t.center_id, 'deposit:' || t.id, 'bank_transactions', t.id, 'payout_deposit', t.amount_cents,
          date_trunc('month', t.posted_on)::date, auth.uid())
  on conflict (center_id, idempotency_key) do nothing;
  return v_n;
end $$;

-- Payments landed straight in the bank (Zelle / ACH / DAF) post as a receipt to
-- the bank account; offline checks and cash post to undeposited funds and are
-- grouped by match_deposit into a Deposit.
alter table app.ledger_postings drop constraint ledger_postings_txn_type_check;
alter table app.ledger_postings add constraint ledger_postings_txn_type_check check (txn_type in (
  'donation_card','recurring_charge','boli_payment','store_sale','refund','processor_fee','payout_deposit',
  'offline_receipt','bank_receipt','stock_gift','pledge_receivable','membership_fee','adjustment'));

create or replace function app.enqueue_payment_posting(p_payment uuid) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare v uuid; p record; v_type text;
begin
  select * into p from app.payments where id = p_payment;
  v_type := case
    when p.provider = 'bank' then 'bank_receipt'
    when p.method = 'stock' then 'stock_gift'
    when p.provider = 'offline' then 'offline_receipt'
    else 'donation_card' end;
  insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month, triggered_by)
  values (p.center_id, 'payment:' || p.id, 'payments', p.id, v_type, p.amount_cents, date_trunc('month', p.received_on)::date, p.recorded_by)
  on conflict (center_id, idempotency_key) do nothing
  returning id into v;
  if p.fee_cents > 0 then
    insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month)
    values (p.center_id, 'fee:' || p.id, 'payments', p.id, 'processor_fee', p.fee_cents, date_trunc('month', p.received_on)::date)
    on conflict do nothing;
  end if;
  return v;
end $$;

-- Offline payments recorded by volunteers also queue their posting.
create or replace function app.on_offline_payment() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.provider = 'offline' then perform app.enqueue_payment_posting(new.id); end if;
  return new;
end $$;
create trigger payments_offline_posting after insert on app.payments
  for each row execute function app.on_offline_payment();

grant execute on function app.parse_bank_description(text, jsonb, text), app.suggest_deposit_payments(uuid),
  app.match_deposit(uuid, uuid[]), app.canonical_org_member(uuid, text) to authenticated;
revoke execute on function app.on_offline_payment(), app.bank_transactions_prepare(), app.external_ids_normalize()
  from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
