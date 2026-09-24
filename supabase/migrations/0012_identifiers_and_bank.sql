-- 0012_identifiers_and_bank.sql
-- Every member and household is known by several identifiers:
--   1. the Connect-issued number (people.member_number, households.household_number)
--   2. the number the organization already assigned (e.g. JSH's membership register)
--   3. the id in the legacy CRM (e.g. Neon account / contact id)
--   4. the id in the accounting system (QuickBooks customer / donor number)
--   5. how they appear on the org's bank statement when they pay by Zelle
--      (payer name as the bank prints it), plus payment-provider customer ids.
-- (1) lives on the row itself; (2)–(5) live in app.external_ids, one row per
-- identifier, with history. Bank payer names are NOT unique (two households can
-- both send as "RAHUL SHAH"), so they are matching hints, never keys.

-- ---------------------------------------------------------------------------
-- Human-readable numbering per center (JSH-10421, JSH-H-2041, JSH-PL-24817, JSH-S-1042)
-- ---------------------------------------------------------------------------
create table app.number_sequences (
  center_id   uuid not null references app.centers(id) on delete cascade,
  kind        text not null check (kind in ('member','household','pledge','order','receipt')),
  prefix      text not null,             -- 'JSH-', 'JSH-H-', 'JSH-PL-' ...
  next_value  bigint not null,
  primary key (center_id, kind)
);

create or replace function app.next_number(p_center uuid, p_kind text) returns text
language plpgsql security definer set search_path = app, public as $$
declare v_short text; v_prefix text; v_start bigint; v_n bigint;
begin
  select upper(coalesce(nullif(short_name, ''), left(regexp_replace(slug, '[^a-zA-Z0-9]', '', 'g'), 6))) into v_short
    from app.centers where id = p_center;
  v_prefix := v_short || case p_kind when 'member' then '-' when 'household' then '-H-' when 'pledge' then '-PL-'
                                     when 'order' then '-S-' when 'receipt' then '-R-' end;
  v_start := case p_kind when 'member' then 10001 when 'household' then 2001 when 'pledge' then 20001
                         when 'order' then 1001 else 100001 end;
  insert into app.number_sequences as s (center_id, kind, prefix, next_value) values (p_center, p_kind, v_prefix, v_start + 1)
    on conflict (center_id, kind) do update set next_value = s.next_value + 1
    returning s.prefix, s.next_value - 1 into v_prefix, v_n;
  return v_prefix || v_n;
end $$;

alter table app.pledges add column pledge_number text;
create unique index pledges_number_idx on app.pledges (center_id, pledge_number);
create unique index payments_receipt_number_idx on app.payments (center_id, receipt_number);

-- Numbers are assigned on insert unless supplied (a center may adopt its
-- existing register numbers as Connect numbers during migration).
create or replace function app.assign_numbers() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  -- Nested IFs: PL/pgSQL resolves every NEW.field in a condition, so each
  -- table's column may only be referenced inside its own branch.
  if tg_table_name = 'people' then
    if new.member_number is null then new.member_number := app.next_number(new.center_id, 'member'); end if;
  elsif tg_table_name = 'households' then
    if new.household_number is null then new.household_number := app.next_number(new.center_id, 'household'); end if;
  elsif tg_table_name = 'pledges' then
    if new.pledge_number is null then new.pledge_number := app.next_number(new.center_id, 'pledge'); end if;
  elsif tg_table_name = 'store_orders' then
    if new.order_number is null then new.order_number := app.next_number(new.center_id, 'order'); end if;
  elsif tg_table_name = 'payments' then
    if new.receipt_number is null then new.receipt_number := app.next_number(new.center_id, 'receipt'); end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['people','households','pledges','store_orders','payments'] loop
    execute format('create trigger number_%1$s before insert on app.%1$I for each row execute function app.assign_numbers()', t);
  end loop;
end $$;

-- Member number never changes once issued.
create or replace function app.freeze_numbers() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'people' then
    if old.member_number is not null and new.member_number is distinct from old.member_number then
      raise exception 'member_number is permanent';
    end if;
  elsif tg_table_name = 'households' then
    if old.household_number is not null and new.household_number is distinct from old.household_number then
      raise exception 'household_number is permanent';
    end if;
  end if;
  return new;
end $$;
create trigger freeze_people_number before update of member_number on app.people for each row execute function app.freeze_numbers();
create trigger freeze_household_number before update of household_number on app.households for each row execute function app.freeze_numbers();

-- ---------------------------------------------------------------------------
-- Identifier registry
-- ---------------------------------------------------------------------------
create type app.identifier_kind as enum (
  'org_member',        -- number the organization already assigned (membership register, old card)
  'crm',               -- legacy CRM id (Neon account id / contact id)
  'accounting',        -- QuickBooks customer id / donor number
  'bank_payer',        -- payer name as it appears on the org's bank statement (Zelle, ACH originator)
  'payment_provider',  -- Stripe customer id, etc.
  'other'
);

-- Uppercase, alphanumerics only, single spaces: "Priya  S. Shah" -> "PRIYA S SHAH".
create or replace function app.normalize_identifier(p text) returns text
language sql immutable as $$
  select nullif(trim(regexp_replace(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')), '')
$$;

create table app.external_ids (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  person_id     uuid references app.people(id) on delete cascade,
  household_id  uuid references app.households(id) on delete cascade,
  kind          app.identifier_kind not null,
  system        text not null,              -- 'jsh_register', 'neon', 'quickbooks', 'chase', 'stripe' ...
  value         text not null,              -- exactly as the other system shows it
  normalized    text not null,              -- set by trigger; used for lookup and matching
  label         text,                       -- e.g. 'Neon account', 'Neon contact', 'Old member card'
  is_primary    boolean not null default true,
  valid_from    date,
  valid_to      date,                       -- retired identifiers stay for history
  source        text not null default 'manual' check (source in ('import','manual','learned','sync')),
  confidence    numeric check (confidence between 0 and 1),   -- for learned bank payer names
  times_matched integer not null default 0,
  last_matched_at timestamptz,
  created_by    uuid references auth.users(id),
  verified_by   uuid references auth.users(id),
  verified_at   timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  check (person_id is not null or household_id is not null)
);
create index on app.external_ids (center_id, normalized);
create index on app.external_ids (center_id, person_id);
create index on app.external_ids (center_id, household_id);
-- A real identifier points at exactly one record. Bank payer names may repeat.
create unique index external_ids_unique_live on app.external_ids (center_id, kind, system, normalized)
  where kind <> 'bank_payer' and valid_to is null;
create unique index external_ids_payer_per_household on app.external_ids (center_id, household_id, system, normalized)
  where kind = 'bank_payer';

create or replace function app.external_ids_normalize() returns trigger
language plpgsql as $$
begin
  new.normalized := coalesce(app.normalize_identifier(new.value), '');
  if new.normalized = '' then raise exception 'identifier value is empty'; end if;
  -- A person's identifier also carries their household when not given.
  if new.household_id is null and new.person_id is not null then
    select hm.household_id into new.household_id from app.household_members hm
     where hm.person_id = new.person_id and hm.left_at is null order by hm.is_primary desc limit 1;
  end if;
  return new;
end $$;
create trigger external_ids_normalize before insert or update of value, person_id on app.external_ids
  for each row execute function app.external_ids_normalize();
create trigger audit_external_ids after insert or update or delete on app.external_ids
  for each row execute function app.audit_row();

-- Look anything up by any identifier (staff search box, imports, reconciliation).
create or replace function app.resolve_identifier(p_center uuid, p_value text)
returns table (kind text, system text, value text, person_id uuid, household_id uuid, display_name text)
language sql stable security definer set search_path = app, public as $$
  with q as (select app.normalize_identifier(p_value) as n
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
    from app.external_ids e, q where e.center_id = p_center and e.normalized = q.n and (e.valid_to is null or e.valid_to >= current_date)
$$;

-- ---------------------------------------------------------------------------
-- Bank statements and reconciliation (Zelle, checks, ACH that land in the bank)
-- ---------------------------------------------------------------------------
create table app.bank_accounts (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  name          text not null,                 -- 'Chase operating ··4608'
  institution   text,
  last4         text,
  qbo_account_id text,
  parse_rules   jsonb not null default '[]'::jsonb,   -- extra regexes per bank: [{channel, pattern}]
  active        boolean not null default true
);

create table app.bank_statement_imports (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  bank_account_id uuid not null references app.bank_accounts(id),
  file_path     text,
  period_start  date,
  period_end    date,
  rows_total    integer,
  rows_new      integer,
  imported_by   uuid references auth.users(id),
  imported_at   timestamptz not null default now()
);

create table app.bank_transactions (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references app.centers(id) on delete cascade,
  bank_account_id uuid not null references app.bank_accounts(id),
  import_id       uuid references app.bank_statement_imports(id) on delete set null,
  posted_on       date not null,
  amount_cents    bigint not null,            -- positive = money in
  description     text not null,              -- raw line from the statement
  channel         text check (channel in ('zelle','check','ach','card_payout','cash_deposit','wire','other')),
  payer_name      text,                       -- parsed ("RAHUL SHAH")
  payer_normalized text,
  reference       text,                       -- Zelle confirmation / check number
  fingerprint     text not null,              -- de-duplicates re-imported statements
  status          text not null default 'unmatched' check (status in ('unmatched','suggested','matched','ignored','payout')),
  matched_household_id uuid references app.households(id),
  payment_id      uuid references app.payments(id),
  payout_id       uuid references app.payouts(id),
  matched_by      uuid references auth.users(id),
  matched_at      timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (center_id, fingerprint)
);
create index on app.bank_transactions (center_id, status, posted_on desc);
create index on app.bank_transactions (center_id, payer_normalized);

-- Best-effort parse of common US bank formats; per-account parse_rules extend it.
create or replace function app.parse_bank_description(p_desc text, p_rules jsonb default '[]'::jsonb)
returns table (channel text, payer_name text, reference text)
language plpgsql immutable as $$
declare m text[]; r jsonb;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) loop
    m := regexp_match(p_desc, r->>'pattern', 'i');
    if m is not null then
      channel := r->>'channel'; payer_name := trim(m[1]); reference := case when array_length(m, 1) > 1 then m[2] end;
      return next; return;
    end if;
  end loop;
  -- "Zelle Payment From Rahul Shah Jpm99bxk2q1v" / "ZELLE FROM RAHUL SHAH ON 09/14 REF # PP0ABC"
  m := regexp_match(p_desc, 'zelle\s+(?:payment\s+)?from\s+(.+?)(?:\s+(?:conf(?:irmation)?\s*#?|ref\s*#?|on\s+\d{1,2}/\d{1,2})\s*:?\s*(\S+).*|\s+((?:jpm|bac|wfc|pp)\w{6,})\s*)?$', 'i');
  if m is not null then
    channel := 'zelle'; payer_name := trim(m[1]); reference := coalesce(m[2], m[3]); return next; return;
  end if;
  m := regexp_match(p_desc, '^(?:deposited\s+)?check\s*#?\s*(\d+)', 'i');
  if m is not null then channel := 'check'; payer_name := null; reference := m[1]; return next; return; end if;
  m := regexp_match(p_desc, '(?:orig\s+co\s+name|originator)\s*:?\s*(.+?)(?:\s+(?:co\s+entry|ind\s+name|trace).*)?$', 'i');
  if m is not null then channel := 'ach'; payer_name := trim(m[1]); reference := null; return next; return; end if;
  if p_desc ~* '(stripe|square|paypal)\s+(transfer|payout)' then channel := 'card_payout'; payer_name := null; reference := null; return next; return; end if;
  channel := 'other'; payer_name := null; reference := null; return next;
end $$;

create or replace function app.bank_transactions_prepare() returns trigger
language plpgsql as $$
declare p record; v_rules jsonb;
begin
  select parse_rules into v_rules from app.bank_accounts where id = new.bank_account_id;
  if new.channel is null or new.payer_name is null then
    select * into p from app.parse_bank_description(new.description, v_rules);
    new.channel := coalesce(new.channel, p.channel);
    new.payer_name := coalesce(new.payer_name, p.payer_name);
    new.reference := coalesce(new.reference, p.reference);
  end if;
  new.payer_normalized := app.normalize_identifier(new.payer_name);
  if new.fingerprint is null then
    new.fingerprint := encode(digest(new.bank_account_id::text || '|' || new.posted_on || '|' || new.amount_cents || '|' ||
                              coalesce(new.reference, app.normalize_identifier(new.description)), 'sha256'), 'hex');
  end if;
  if new.channel = 'card_payout' and new.status = 'unmatched' then new.status := 'payout'; end if;
  return new;
end $$;
create trigger bank_transactions_prepare before insert on app.bank_transactions
  for each row execute function app.bank_transactions_prepare();

-- Ranked household suggestions for one bank line.
create or replace function app.suggest_bank_matches(p_txn uuid)
returns table (household_id uuid, household_name text, household_number text, score numeric, reason text, open_pledge_cents bigint)
language sql stable security definer set search_path = app, public as $$
  with t as (select * from app.bank_transactions where id = p_txn
             and (app.has_permission(center_id, 'giving.record_offline') or app.has_permission(center_id, 'giving.view'))),
  cands as (
    -- 1. a payer name this household has used before
    select e.household_id, 0.95::numeric as score, 'Known bank payer name "' || e.value || '"' as reason
      from app.external_ids e, t
     where e.center_id = t.center_id and e.kind = 'bank_payer' and e.normalized = t.payer_normalized
    union all
    -- 2. the payer name equals a member's name (first last, last first, or with middle initial dropped)
    select hm.household_id, 0.70, 'Payer name matches member ' || p.first_name || ' ' || p.last_name
      from app.people p join app.household_members hm on hm.person_id = p.id and hm.left_at is null, t
     where p.center_id = t.center_id and t.payer_normalized is not null
       and (app.normalize_identifier(p.first_name || ' ' || p.last_name) = t.payer_normalized
         or app.normalize_identifier(p.last_name || ' ' || p.first_name) = t.payer_normalized
         or regexp_replace(t.payer_normalized, ' [A-Z] ', ' ') = app.normalize_identifier(p.first_name || ' ' || p.last_name))
    union all
    -- 3. the description carries a member or household number
    select coalesce(r.household_id, (select hm.household_id from app.household_members hm where hm.person_id = r.person_id limit 1)),
           0.90, 'Statement mentions ' || r.value
      from t, lateral regexp_matches(t.description, '([A-Z]{2,6}-(?:H-)?\d{4,6})', 'g') as x(m),
           lateral app.resolve_identifier(t.center_id, x.m[1]) r
  ),
  ranked as (
    select c.household_id, max(c.score) as score, string_agg(distinct c.reason, '; ') as reason
      from cands c where c.household_id is not null group by c.household_id
  )
  select r.household_id, h.display_name, h.household_number,
         least(1, r.score + case when exists (select 1 from app.pledges pl, t where pl.household_id = r.household_id
                                  and pl.status in ('open','partially_paid') and pl.amount_cents - pl.paid_cents = t.amount_cents)
                            then 0.04 else 0 end),
         r.reason,
         (select coalesce(sum(pl.amount_cents - pl.paid_cents), 0) from app.pledges pl
           where pl.household_id = r.household_id and pl.status in ('open','partially_paid'))
    from ranked r join app.households h on h.id = r.household_id
   order by 4 desc
$$;

-- Treasurer confirms: record the payment, allocate (earliest pledge first unless
-- pledges are named), queue the QuickBooks post, and learn the payer name.
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
  if t.amount_cents <= 0 then raise exception 'only incoming money can be matched to a household'; end if;
  if not exists (select 1 from app.households where id = p_household and center_id = t.center_id) then
    raise exception 'household not in this center';
  end if;
  v_method := case t.channel when 'zelle' then 'zelle' when 'check' then 'check' when 'ach' then 'ach' else 'other' end;
  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, provider_ref,
                            check_number, received_on, recorded_by, memo)
    values (t.center_id, p_household, p_payer_person, t.amount_cents, v_method, 'settled', 'bank',
            coalesce(t.reference, t.fingerprint), case when t.channel = 'check' then t.reference end, t.posted_on, auth.uid(),
            'Bank: ' || t.description)
    returning id into v_payment;
  perform app.allocate_payment(v_payment, p_pledge_ids, true);
  perform app.enqueue_payment_posting(v_payment);
  update app.bank_transactions set status = 'matched', matched_household_id = p_household, payment_id = v_payment,
         matched_by = auth.uid(), matched_at = now() where id = p_txn;
  if p_learn_payer and t.payer_name is not null then
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

-- Offline receipts from the bank are deposited already: post as receipt to the bank, not undeposited funds.
create or replace function app.enqueue_payment_posting(p_payment uuid) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare v uuid; p record; v_type text;
begin
  select * into p from app.payments where id = p_payment;
  v_type := case
    when p.provider = 'bank' then 'offline_receipt'
    when p.method in ('check','cash','ach','zelle','daf','matching_gift') and p.provider = 'offline' then 'offline_receipt'
    when p.method = 'stock' then 'stock_gift'
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

-- ---------------------------------------------------------------------------
-- RLS for the new tables
-- ---------------------------------------------------------------------------
alter table app.number_sequences enable row level security;
alter table app.external_ids enable row level security;
alter table app.bank_accounts enable row level security;
alter table app.bank_statement_imports enable row level security;
alter table app.bank_transactions enable row level security;

create policy number_sequences_admin on app.number_sequences for select to authenticated
  using (app.has_permission(center_id, 'settings.manage'));

-- Members see their own org-assigned numbers; everything else is staff-only.
create policy external_ids_household on app.external_ids for select to authenticated
  using (kind = 'org_member' and household_id is not null and app.in_my_household(center_id, household_id));
create policy external_ids_people_staff_read on app.external_ids for select to authenticated
  using (kind in ('org_member','crm','other') and (app.has_permission(center_id, 'people.view') or app.has_permission(center_id, 'people.manage')));
create policy external_ids_people_staff_write on app.external_ids for all to authenticated
  using (kind in ('org_member','crm','other') and app.has_permission(center_id, 'people.manage'))
  with check (kind in ('org_member','crm','other') and app.has_permission(center_id, 'people.manage'));
create policy external_ids_finance_read on app.external_ids for select to authenticated
  using (app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.record_offline'));
create policy external_ids_finance_write on app.external_ids for all to authenticated
  using (kind in ('accounting','bank_payer','payment_provider') and app.has_permission(center_id, 'giving.manage'))
  with check (kind in ('accounting','bank_payer','payment_provider') and app.has_permission(center_id, 'giving.manage'));

create policy bank_accounts_read on app.bank_accounts for select to authenticated
  using (app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.record_offline'));
create policy bank_accounts_write on app.bank_accounts for all to authenticated
  using (app.has_permission(center_id, 'accounting.manage')) with check (app.has_permission(center_id, 'accounting.manage'));

create policy bank_imports_read on app.bank_statement_imports for select to authenticated
  using (app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.record_offline'));
create policy bank_imports_write on app.bank_statement_imports for insert to authenticated
  with check ((app.has_permission(center_id, 'giving.manage') or app.has_permission(center_id, 'giving.record_offline')) and imported_by = auth.uid());

create policy bank_txn_read on app.bank_transactions for select to authenticated
  using (app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.record_offline'));
create policy bank_txn_import on app.bank_transactions for insert to authenticated
  with check ((app.has_permission(center_id, 'giving.manage') or app.has_permission(center_id, 'giving.record_offline')) and status in ('unmatched','payout'));
create policy bank_txn_update on app.bank_transactions for update to authenticated
  using (app.has_permission(center_id, 'giving.manage')) with check (app.has_permission(center_id, 'giving.manage'));
-- Matching itself goes through app.confirm_bank_match().

grant execute on function app.resolve_identifier(uuid, text), app.suggest_bank_matches(uuid),
  app.confirm_bank_match(uuid, uuid, uuid[], boolean, uuid) to authenticated;
-- Numbers are only ever issued by the insert trigger.
revoke execute on function app.next_number(uuid, text) from public, anon, authenticated;

-- Edge functions and workers run as service_role and may call every helper.
grant execute on all functions in schema app to service_role;
