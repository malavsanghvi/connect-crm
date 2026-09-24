-- Onboarding · o-qbo-match · 4 of 4: pulling QuickBooks history, the AI
-- remainder, and bringing an approved customer's history into Community Connect.
--
-- Worker side (connect_worker only; each asserts app.assert_worker()):
--   app.qbo_worker_connection(p_center)                  realm, mode, history window, last pull
--   app.qbo_worker_store_customers(p_center, p_rows)     upsert the customer copies
--   app.qbo_worker_store_transactions(p_center, p_rows)  upsert the history copies
--   app.qbo_worker_finish_pull(p_center, p_stats)        re-suggest, queue bring-ins for approved customers
--   app.qbo_worker_daily_pulls()                         the daily pull for every connected center
--   app.qbo_worker_ai_input(p_center, p_limit)           the ambiguous remainder, masked
--   app.qbo_worker_store_ai(p_center, p_rows, p_model)   AI proposals (method ai, confidence ≤ 0.85)
--   app.qbo_worker_bring_in(p_center, p_qbo_customer)    bring one approved customer's history in
-- Portal side (accounting.manage):
--   app.qbo_request_pull(p_center), app.qbo_request_ai(p_center),
--   app.qbo_retry_bring_in(p_center, p_qbo_customer default null), app.qbo_match_overview(p_center)
--
-- Bringing history in follows the money-history rules of the import engine
-- (0191/0192) exactly; no allocation, write-off or refund rule changes:
--   SalesReceipt, Payment → app.payments, is_historical = true, provider 'quickbooks',
--                           crm_external_id 'qbo:<type>:<id>'. Never queued for posting
--                           (history; and only provider 'offline' is ever auto-queued).
--   Invoice               → app.pledges (source general, crm_external_id 'qbo:Invoice:<id>').
--                           Its linked payments are allocated to it AS GIVEN in QuickBooks,
--                           and the existing recompute trigger keeps the balance. When the
--                           pulled payments do not account for what QuickBooks says was paid,
--                           the invoice waits in Needs review instead (the balance would be wrong).
--   CreditMemo, RefundReceipt → Needs review: no refund-import path exists, so this is an owner decision.
--   JournalEntry, Deposit → skipped (not a donor's transaction).
-- Family-level match: payer / pledged-by = the household's primary member; no
-- primary → everything waits in Needs review "Choose the primary member of …".
-- Idempotent on (center, type, id): a re-run links to the record already there.

-- ── Worker: connection ──────────────────────────────────────────────────────
create or replace function app.qbo_worker_connection(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.integration_connections;
begin
  perform app.assert_worker();
  select * into c from app.integration_connections
   where center_id = p_center and provider in ('quickbooks_online', 'intuit_sandbox')
   order by (provider = 'quickbooks_online') desc limit 1;
  if c.id is null then return null; end if;
  return jsonb_build_object(
    'connection_id', c.id, 'provider', c.provider, 'status', c.status, 'realm_id', c.external_account_id,
    'mode', case when c.provider = 'intuit_sandbox' or c.settings->>'mode' = 'test' then 'test' else 'live' end,
    'history_years', case when (c.settings->>'history_years') ~ '^\d{1,2}$' then (c.settings->>'history_years')::int else 7 end,
    'last_pull_at', c.settings->>'customers_pulled_at',
    'accounting_on', app.module_enabled(p_center, 'accounting'));
end $$;

-- ── Worker: store copies ────────────────────────────────────────────────────
create or replace function app.qbo_worker_store_customers(p_center uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare n int;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('QuickBooks customer pull');
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'qbo_worker_store_customers: rows must be an array.'; end if;
  insert into app.qbo_customers as t (center_id, qbo_id, display_name, given_name, family_name, company_name, emails, phones, address,
                                      parent_qbo_id, is_sub_customer, active, open_balance_cents, raw, synced_at)
  select p_center, r->>'qbo_id', coalesce(nullif(btrim(r->>'display_name'), ''), 'QuickBooks customer ' || (r->>'qbo_id')),
         nullif(btrim(r->>'given_name'), ''), nullif(btrim(r->>'family_name'), ''), nullif(btrim(r->>'company_name'), ''),
         coalesce((select array_agg(distinct lower(btrim(e))) from jsonb_array_elements_text(coalesce(r->'emails', '[]')) e where btrim(e) <> ''), '{}'),
         coalesce((select array_agg(distinct btrim(ph)) from jsonb_array_elements_text(coalesce(r->'phones', '[]')) ph where btrim(ph) ~ '^\+[1-9][0-9]{6,14}$'), '{}'),
         coalesce(r->'address', '{}'::jsonb), nullif(r->>'parent_qbo_id', ''), coalesce((r->>'is_sub_customer')::boolean, false),
         coalesce((r->>'active')::boolean, true), coalesce((r->>'open_balance_cents')::bigint, 0), coalesce(r->'raw', '{}'::jsonb), now()
    from jsonb_array_elements(p_rows) r
   where coalesce(r->>'qbo_id', '') <> ''
  on conflict (center_id, qbo_id) do update
    set display_name = excluded.display_name, given_name = excluded.given_name, family_name = excluded.family_name,
        company_name = excluded.company_name, emails = excluded.emails, phones = excluded.phones, address = excluded.address,
        parent_qbo_id = excluded.parent_qbo_id, is_sub_customer = excluded.is_sub_customer, active = excluded.active,
        open_balance_cents = excluded.open_balance_cents, raw = excluded.raw, synced_at = excluded.synced_at,
        -- A changed customer is looked at again by the AI.
        ai_checked_at = case when (t.display_name, t.given_name, t.family_name, t.company_name, t.emails, t.address)
                                  is distinct from (excluded.display_name, excluded.given_name, excluded.family_name,
                                                    excluded.company_name, excluded.emails, excluded.address)
                             then null else t.ai_checked_at end
    where (t.display_name, t.given_name, t.family_name, t.company_name, t.emails, t.phones, t.address, t.parent_qbo_id,
           t.is_sub_customer, t.active, t.open_balance_cents, t.raw)
          is distinct from
          (excluded.display_name, excluded.given_name, excluded.family_name, excluded.company_name, excluded.emails, excluded.phones,
           excluded.address, excluded.parent_qbo_id, excluded.is_sub_customer, excluded.active, excluded.open_balance_cents, excluded.raw);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function app.qbo_worker_store_transactions(p_center uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare n int;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('QuickBooks history pull');
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'qbo_worker_store_transactions: rows must be an array.'; end if;
  insert into app.qbo_transactions as t (center_id, qbo_type, qbo_id, customer_qbo_id, txn_date, doc_number, total_cents, open_balance_cents,
                                         memo, lines, linked, payment_method, reference_number, raw, synced_at)
  select p_center, r->>'qbo_type', r->>'qbo_id', nullif(r->>'customer_qbo_id', ''), (r->>'txn_date')::date, nullif(r->>'doc_number', ''),
         coalesce((r->>'total_cents')::bigint, 0), coalesce((r->>'open_balance_cents')::bigint, 0), nullif(r->>'memo', ''),
         coalesce(r->'lines', '[]'::jsonb), coalesce(r->'linked', '[]'::jsonb), nullif(r->>'payment_method', ''),
         nullif(r->>'reference_number', ''), coalesce(r->'raw', '{}'::jsonb), now()
    from jsonb_array_elements(p_rows) r
   where coalesce(r->>'qbo_id', '') <> '' and r->>'txn_date' ~ '^\d{4}-\d{2}-\d{2}'
  on conflict (center_id, qbo_type, qbo_id) do update
    set customer_qbo_id = excluded.customer_qbo_id, txn_date = excluded.txn_date, doc_number = excluded.doc_number,
        total_cents = excluded.total_cents, open_balance_cents = excluded.open_balance_cents, memo = excluded.memo,
        lines = excluded.lines, linked = excluded.linked, payment_method = excluded.payment_method,
        reference_number = excluded.reference_number, raw = excluded.raw, synced_at = excluded.synced_at,
        -- Waiting ones are tried again with the new data; brought-in ones stay as they are.
        cc_status = case when t.cc_status = 'needs_review' then 'pending' else t.cc_status end
    where (t.customer_qbo_id, t.txn_date, t.doc_number, t.total_cents, t.open_balance_cents, t.memo, t.lines, t.linked,
           t.payment_method, t.reference_number, t.raw)
          is distinct from
          (excluded.customer_qbo_id, excluded.txn_date, excluded.doc_number, excluded.total_cents, excluded.open_balance_cents,
           excluded.memo, excluded.lines, excluded.linked, excluded.payment_method, excluded.reference_number, excluded.raw);
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Queue helpers ───────────────────────────────────────────────────────────
create or replace function app.qbo_queue_job(p_center uuid, p_kind text, p_payload jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
declare v bigint;
begin
  if to_regprocedure('app.enqueue_job(uuid,text,jsonb,timestamp with time zone,integer)') is null then return null; end if;
  select id into v from app.jobs where center_id = p_center and kind = p_kind and status in ('queued','running')
     and payload = coalesce(p_payload, '{}'::jsonb) limit 1;
  if v is not null then return v; end if;
  return app.enqueue_job(p_center, p_kind, coalesce(p_payload, '{}'::jsonb), now(), 5);
end $$;

-- Approved customers whose history still has something to bring in.
create or replace function app.qbo_queue_pending_bring_ins(p_center uuid) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; n int := 0;
begin
  for r in select distinct m.qbo_customer_id from app.qbo_customer_matches m
            where m.center_id = p_center and m.status = 'approved'
              and exists (select 1 from app.qbo_transactions t where t.center_id = p_center and t.customer_qbo_id = m.qbo_customer_id
                            and t.cc_status = 'pending') loop
    if app.qbo_queue_bring_in(p_center, r.qbo_customer_id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function app.qbo_worker_finish_pull(p_center uuid, p_stats jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_suggest jsonb; v_bring int;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('QuickBooks customer pull');
  update app.integration_connections
     set settings = settings || jsonb_build_object('customers_pulled_at', now(), 'customers_pull_stats', coalesce(p_stats, '{}'::jsonb))
   where center_id = p_center and provider in ('quickbooks_online', 'intuit_sandbox');
  v_suggest := app.qbo_refresh_suggestions(p_center, null);
  v_bring := app.qbo_queue_pending_bring_ins(p_center);
  return v_suggest || jsonb_build_object('bring_in_queued', v_bring);
end $$;

-- The daily pull: one job per center that has QuickBooks connected and Accounting on.
create or replace function app.qbo_worker_daily_pulls() returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; n int := 0;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  for r in select distinct c.center_id from app.integration_connections c
            where c.provider in ('quickbooks_online', 'intuit_sandbox') and c.status in ('connected', 'expiring')
              and app.module_enabled(c.center_id, 'accounting') loop
    if app.qbo_queue_job(r.center_id, 'qbo.pull_customers_history') is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ── Worker: the AI remainder ────────────────────────────────────────────────
-- Customers without an approved match whose best suggestion is under 0.6, or
-- whose top two are within 0.1, and that the AI has not looked at since they
-- changed. Only names, city/ZIP, household members' first names and email
-- DOMAINS leave the database — never a full email, phone, amount or note.
create or replace function app.qbo_worker_ai_input(p_center uuid, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb;
begin
  perform app.assert_worker();
  with amb as (
    select c.* from app.qbo_customers c
      left join lateral (select max(m.confidence) as top, (array_agg(m.confidence order by m.confidence desc))[2] as second
                           from app.qbo_customer_matches m where m.center_id = p_center and m.qbo_customer_id = c.qbo_id and m.status = 'suggested') a on true
     where c.center_id = p_center and c.active and c.ai_checked_at is null
       and not exists (select 1 from app.qbo_customer_matches m where m.center_id = p_center and m.qbo_customer_id = c.qbo_id and m.status = 'approved')
       and (a.top is null or a.top < 0.6 or a.top - coalesce(a.second, 0) <= 0.1)
     order by c.qbo_id
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ),
  cand as (
    select a.qbo_id, h.id as household_id
      from amb a
      cross join lateral (
        select m.household_id as id from app.qbo_customer_matches m
         where m.center_id = p_center and m.qbo_customer_id = a.qbo_id and m.status = 'suggested'
        union
        select hm.household_id from app.household_members hm join app.people p on p.id = hm.person_id
         where hm.center_id = p_center and hm.left_at is null and p.merged_into_id is null
           and app.qbo_norm(p.last_name) = coalesce(nullif(app.qbo_norm(a.family_name), ''),
                                                    (app.qbo_core_tokens(a.display_name))[cardinality(app.qbo_core_tokens(a.display_name))])
        limit 8) h
     where not exists (select 1 from app.qbo_customer_matches r where r.center_id = p_center and r.qbo_customer_id = a.qbo_id
                         and r.household_id = h.id and r.status = 'rejected')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'qbo_id', a.qbo_id, 'display_name', a.display_name, 'given_name', a.given_name, 'family_name', a.family_name,
           'company_name', a.company_name, 'city', a.address->>'city', 'zip', app.qbo_zip5(a.address->>'zip'),
           'email_domains', (select coalesce(jsonb_agg(distinct split_part(e, '@', 2)), '[]'::jsonb) from unnest(a.emails) e where e like '%@%'),
           'candidates', (select coalesce(jsonb_agg(jsonb_build_object(
                             'household_id', h.id, 'name', h.display_name, 'city', h.city, 'zip', app.qbo_zip5(h.postal_code),
                             'member_first_names', (select coalesce(jsonb_agg(coalesce(nullif(p.preferred_name, ''), p.first_name) order by hm.is_primary desc, p.first_name), '[]'::jsonb)
                                                      from app.household_members hm join app.people p on p.id = hm.person_id
                                                     where hm.household_id = h.id and hm.left_at is null),
                             'email_domains', (select coalesce(jsonb_agg(distinct split_part(p.email::text, '@', 2)), '[]'::jsonb)
                                                 from app.household_members hm join app.people p on p.id = hm.person_id
                                                where hm.household_id = h.id and hm.left_at is null and p.email is not null)
                           )), '[]'::jsonb)
                            from cand x join app.households h on h.id = x.household_id where x.qbo_id = a.qbo_id))), '[]'::jsonb)
    into v
    from amb a;
  return v;
end $$;

-- The model's proposals. Only households that were offered, method ai, confidence capped at 0.85.
create or replace function app.qbo_worker_store_ai(p_center uuid, p_rows jsonb, p_model text, p_checked text[]) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare r jsonb; n int := 0; v_conf numeric; v_hh uuid;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('QuickBooks donor matching · AI suggestions');
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    continue when coalesce(r->>'household_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    v_hh := (r->>'household_id')::uuid;
    continue when not exists (select 1 from app.households h where h.id = v_hh and h.center_id = p_center and h.merged_into_id is null);
    continue when not exists (select 1 from app.qbo_customers c where c.center_id = p_center and c.qbo_id = r->>'qbo_id');
    continue when exists (select 1 from app.qbo_customer_matches m where m.center_id = p_center and m.qbo_customer_id = r->>'qbo_id'
                            and (m.status = 'approved' or (m.status = 'rejected' and m.household_id = v_hh)));
    v_conf := least(0.85, greatest(0, coalesce((r->>'confidence')::numeric, 0)))::numeric(4,3);
    continue when v_conf < 0.3;
    insert into app.qbo_customer_matches (center_id, qbo_customer_id, household_id, person_id, status, confidence, method, evidence)
    select p_center, c.qbo_id, v_hh, null, 'suggested', v_conf, 'ai',
           jsonb_build_object(
             'signals', jsonb_build_array(jsonb_build_object('kind', 'ai', 'label', 'AI suggestion (' || coalesce(p_model, 'model') || ')',
                                                             'qb', c.display_name, 'cc', h.display_name,
                                                             'reason', left(coalesce(r->>'reason', ''), 300))),
             'qb', jsonb_build_object('display_name', c.display_name, 'company', c.company_name, 'emails', to_jsonb(c.emails),
                                      'phones', to_jsonb(c.phones), 'address', c.address),
             'cc', jsonb_build_object('household', h.display_name, 'household_number', h.household_number, 'city', h.city, 'zip', h.postal_code))
      from app.qbo_customers c, app.households h
     where c.center_id = p_center and c.qbo_id = r->>'qbo_id' and h.id = v_hh
    on conflict (center_id, qbo_customer_id, household_id) where status = 'suggested'
      do update set confidence = greatest(app.qbo_customer_matches.confidence, excluded.confidence), method = 'ai',
                    evidence = app.qbo_customer_matches.evidence || jsonb_build_object('signals',
                                 coalesce(app.qbo_customer_matches.evidence->'signals', '[]'::jsonb) || (excluded.evidence->'signals'));
    n := n + 1;
  end loop;
  update app.qbo_customers set ai_checked_at = now()
   where center_id = p_center and qbo_id = any (coalesce(p_checked, '{}'));
  return n;
end $$;

-- ── Bringing history in ─────────────────────────────────────────────────────
create or replace function app.qbo_payment_method(p text) returns app.payment_method
language sql immutable set search_path = app, public, extensions as $$
  select (case
    when p ~* 'che(ck|que)' then 'check'
    when p ~* 'cash' then 'cash'
    when p ~* 'zelle' then 'zelle'
    when p ~* 'stock|securit' then 'stock'
    when p ~* '\mdaf\M|donor.advised' then 'daf'
    when p ~* 'match' then 'matching_gift'
    when p ~* '\mach\M|bank|transfer|\meft\M|wire|direct' then 'ach'
    when p ~* 'card|visa|master|amex|american express|discover|credit|debit' then 'card'
    else 'other' end)::app.payment_method
$$;

-- The fund for a transaction: its first line's class → funds.qbo_class_id; else the general fund.
create or replace function app.qbo_txn_fund(p_center uuid, t app.qbo_transactions, out fund_id uuid, out fund_name text, out note text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_class text; v_class_name text;
begin
  select l->>'class_id', l->>'class_name' into v_class, v_class_name
    from jsonb_array_elements(t.lines) l where coalesce(l->>'class_id', '') <> '' limit 1;
  if v_class is not null then
    select f.id, f.name into fund_id, fund_name from app.funds f where f.center_id = p_center and f.qbo_class_id = v_class and f.active limit 1;
  end if;
  if fund_id is null then
    select f.id, f.name into fund_id, fund_name from app.funds f where f.center_id = p_center and f.key = 'general' limit 1;
    if v_class is not null then
      note := format('QuickBooks class "%s" is not linked to a fund, so it was recorded under %s. Link the class to a fund on the Funds screen if that is wrong.',
                     coalesce(v_class_name, v_class), coalesce(fund_name, 'no fund'));
    end if;
  end if;
end $$;

create or replace function app.qbo_type_label(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p when 'SalesReceipt' then 'sales receipt' when 'Payment' then 'payment' when 'Invoice' then 'invoice'
                when 'CreditMemo' then 'credit memo' when 'RefundReceipt' then 'refund receipt' when 'JournalEntry' then 'journal entry'
                when 'Deposit' then 'deposit' else lower(coalesce(p, 'transaction')) end
$$;

create or replace function app.qbo_mark(p_center uuid, t app.qbo_transactions, p_status text, p_detail text,
                                        p_payment uuid default null, p_pledge uuid default null, p_fund uuid default null) returns void
language sql security definer set search_path = app, public, extensions as $$
  update app.qbo_transactions
     set cc_status = p_status, cc_detail = p_detail, cc_payment_id = coalesce(p_payment, cc_payment_id),
         cc_pledge_id = coalesce(p_pledge, cc_pledge_id), cc_fund_id = coalesce(p_fund, cc_fund_id), cc_at = now()
   where center_id = p_center and qbo_type = t.qbo_type and qbo_id = t.qbo_id
$$;

-- One approved customer's history. Returns counts per outcome. Not an API: the
-- worker calls it through qbo_worker_bring_in; the tests call it as the worker.
create or replace function app.qbo_bring_in_customer(p_center uuid, p_qbo text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  m app.qbo_customer_matches; c app.qbo_customers; t app.qbo_transactions; h app.households;
  v_payer uuid; v_fund record; v_ext text; v_pay uuid; v_pledge uuid; v_linked bigint; v_paid bigint; v_link jsonb;
  v_inv app.qbo_transactions; v_alloc bigint; v_detail text; v_method app.payment_method; v_memo text;
  n_in int := 0; n_review int := 0; n_skip int := 0; n_already int := 0; v_approver text;
begin
  select * into m from app.qbo_customer_matches where center_id = p_center and qbo_customer_id = p_qbo and status = 'approved';
  if m.id is null then return jsonb_build_object('status', 'not_mapped'); end if;
  select * into c from app.qbo_customers where center_id = p_center and qbo_id = p_qbo;
  select * into h from app.households where id = m.household_id;
  if not app.module_enabled(p_center, 'giving') then
    raise exception 'Pledges & donations is switched off, so QuickBooks history cannot be brought in.';
  end if;
  select coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), 'the treasury') into v_approver
    from app.center_users cu join app.people p on p.id = cu.person_id where cu.center_id = p_center and cu.user_id = m.decided_by;
  perform app.set_audit_context(format('QuickBooks history · %s → %s · match approved by %s: %s',
                                       c.display_name, h.display_name, coalesce(v_approver, 'the treasury'), coalesce(m.reason, 'approved')),
                                gen_random_uuid());
  v_payer := coalesce(m.person_id, app.qbo_primary_member(m.household_id));
  if v_payer is null then
    update app.qbo_transactions set cc_status = 'needs_review', cc_at = now(),
           cc_detail = format('Choose the primary member of %s: a family-level QuickBooks account is recorded against the primary member.', h.display_name)
     where center_id = p_center and customer_qbo_id = p_qbo and cc_status in ('pending','needs_review');
    get diagnostics n_review = row_count;
    return jsonb_build_object('status', 'needs_primary', 'needs_review', n_review);
  end if;

  for t in select * from app.qbo_transactions
            where center_id = p_center and customer_qbo_id = p_qbo and cc_status in ('pending','needs_review')
            order by case qbo_type when 'Invoice' then 1 when 'SalesReceipt' then 2 when 'Payment' then 3 else 4 end, txn_date, qbo_id loop
    v_ext := 'qbo:' || t.qbo_type || ':' || t.qbo_id;
    begin
      if t.qbo_type in ('JournalEntry', 'Deposit') then
        perform app.qbo_mark(p_center, t, 'skipped', 'Not a donor''s transaction; it stays in QuickBooks only.');
        n_skip := n_skip + 1; continue;
      end if;
      if t.qbo_type in ('CreditMemo', 'RefundReceipt') then
        perform app.qbo_mark(p_center, t, 'needs_review',
          'Refunds from QuickBooks need an owner decision: Community Connect has no rule yet for bringing a past refund or credit in.');
        n_review := n_review + 1; continue;
      end if;
      if t.total_cents <= 0 then
        perform app.qbo_mark(p_center, t, 'skipped', format('A %s of $0 has nothing to bring in.', app.qbo_type_label(t.qbo_type)));
        n_skip := n_skip + 1; continue;
      end if;
      select * into v_fund from app.qbo_txn_fund(p_center, t);

      if t.qbo_type = 'Invoice' then
        select id into v_pledge from app.pledges where center_id = p_center and crm_external_id = v_ext;
        if v_pledge is not null then
          perform app.qbo_mark(p_center, t, 'brought_in', v_fund.note, null, v_pledge, v_fund.fund_id);
          n_already := n_already + 1; continue;
        end if;
        -- Payments pulled from QuickBooks that paid this invoice must add up to what QuickBooks says was paid.
        select coalesce(sum((l->>'amount_cents')::bigint), 0) into v_linked
          from app.qbo_transactions p cross join lateral jsonb_array_elements(p.linked) l
         where p.center_id = p_center and p.qbo_type = 'Payment' and l->>'type' = 'Invoice' and l->>'id' = t.qbo_id;
        v_paid := t.total_cents - t.open_balance_cents;
        if v_linked <> v_paid then
          perform app.qbo_mark(p_center, t, 'needs_review', format(
            'QuickBooks shows $%s paid on invoice %s, but the payments pulled from QuickBooks for it add up to $%s (a credit applied, or a payment outside the history window). It was not brought in, so no balance is wrong.',
            to_char(v_paid / 100.0, 'FM999,999,990.00'), coalesce(t.doc_number, t.qbo_id), to_char(v_linked / 100.0, 'FM999,999,990.00')));
          n_review := n_review + 1; continue;
        end if;
        insert into app.pledges (center_id, household_id, pledged_by_person_id, fund_id, source, amount_cents, paid_cents, status,
                                 pledged_at, due_on, crm_external_id, created_by)
        values (p_center, m.household_id, v_payer, v_fund.fund_id, 'general', t.total_cents, 0, 'open',
                t.txn_date::timestamptz, (t.raw->>'DueDate')::date, v_ext, m.decided_by)
        returning id into v_pledge;
        perform app.qbo_mark(p_center, t, 'brought_in', v_fund.note, null, v_pledge, v_fund.fund_id);
        n_in := n_in + 1; continue;
      end if;

      -- SalesReceipt / Payment → a historical payment.
      select id into v_pay from app.payments where center_id = p_center and crm_external_id = v_ext;
      if v_pay is not null then
        perform app.qbo_mark(p_center, t, 'brought_in', v_fund.note, v_pay, null, v_fund.fund_id);
        n_already := n_already + 1; continue;
      end if;
      -- A payment that paid invoices waits until each of them is on the household.
      v_detail := null;
      for v_link in select * from jsonb_array_elements(t.linked) loop
        continue when v_link->>'type' <> 'Invoice';
        select * into v_inv from app.qbo_transactions where center_id = p_center and qbo_type = 'Invoice' and qbo_id = v_link->>'id';
        if v_inv.cc_pledge_id is null then
          v_detail := format('It paid invoice %s, which is not on a household yet%s.', coalesce(v_inv.doc_number, v_link->>'id'),
                             case when v_inv.cc_detail is not null then ' (' || v_inv.cc_detail || ')' else '' end);
          exit;
        elsif (select household_id from app.pledges where id = v_inv.cc_pledge_id) is distinct from m.household_id then
          v_detail := format('It paid invoice %s, which is on a different household.', coalesce(v_inv.doc_number, v_link->>'id'));
          exit;
        end if;
      end loop;
      if v_detail is not null then
        perform app.qbo_mark(p_center, t, 'needs_review', v_detail);
        n_review := n_review + 1; continue;
      end if;
      select coalesce(sum((l->>'amount_cents')::bigint), 0) into v_alloc from jsonb_array_elements(t.linked) l where l->>'type' = 'Invoice';
      if v_alloc > t.total_cents then
        perform app.qbo_mark(p_center, t, 'needs_review', 'The invoices it paid add up to more than the payment itself.');
        n_review := n_review + 1; continue;
      end if;
      v_method := app.qbo_payment_method(t.payment_method);
      v_memo := concat_ws(' · ', format('QuickBooks %s %s', app.qbo_type_label(t.qbo_type), coalesce('#' || t.doc_number, t.qbo_id)),
                          case when v_fund.fund_name is not null then 'Fund: ' || v_fund.fund_name end, t.memo);
      insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, provider_ref,
                                check_number, received_on, recorded_by, memo, is_historical, crm_external_id)
      values (p_center, m.household_id, v_payer, t.total_cents, v_method, 'settled', 'quickbooks', t.qbo_type || ':' || t.qbo_id,
              case when v_method = 'check' then t.reference_number end, t.txn_date, m.decided_by, left(v_memo, 500), true, v_ext)
      returning id into v_pay;
      -- Allocations exactly as QuickBooks applied them; the recompute trigger moves the pledge balance.
      insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents)
      select p_center, v_pay, i.cc_pledge_id, sum((l->>'amount_cents')::bigint)
        from jsonb_array_elements(t.linked) l
        join app.qbo_transactions i on i.center_id = p_center and i.qbo_type = 'Invoice' and i.qbo_id = l->>'id'
       where l->>'type' = 'Invoice' and (l->>'amount_cents')::bigint > 0
       group by i.cc_pledge_id;
      perform app.qbo_mark(p_center, t, 'brought_in', v_fund.note, v_pay, null, v_fund.fund_id);
      n_in := n_in + 1;
    exception when others then
      -- One transaction failing never stops the rest; it waits with the reason.
      perform app.qbo_mark(p_center, t, 'needs_review', 'Could not be brought in: ' || sqlerrm);
      n_review := n_review + 1;
    end;
  end loop;
  -- A remap after bring-in: anything already here follows the current match.
  perform app.qbo_repoint_history(p_center, p_qbo, m.household_id, v_payer);
  return jsonb_build_object('status', 'done', 'brought_in', n_in, 'already', n_already, 'needs_review', n_review, 'skipped', n_skip);
end $$;

create or replace function app.qbo_worker_bring_in(p_center uuid, p_qbo text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  return app.qbo_bring_in_customer(p_center, p_qbo);
end $$;

-- ── Portal side ─────────────────────────────────────────────────────────────
create or replace function app.qbo_request_pull(p_center uuid) returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections;
begin
  perform app.qbo_match_assert(p_center, 'Pulling QuickBooks customers');
  select * into c from app.integration_connections where center_id = p_center and provider in ('quickbooks_online', 'intuit_sandbox')
   order by (provider = 'quickbooks_online') desc limit 1;
  if c.id is null or c.status not in ('connected', 'expiring') then
    raise exception 'Connect QuickBooks first (Accounting › QuickBooks).';
  end if;
  if to_regprocedure('app.enqueue_job(uuid,text,jsonb,timestamp with time zone,integer)') is null then
    raise exception 'The background service is not set up yet, so QuickBooks cannot be pulled.';
  end if;
  perform app.set_audit_context('Pull QuickBooks customers and history');
  return app.qbo_queue_job(p_center, 'qbo.pull_customers_history');
end $$;

create or replace function app.qbo_request_ai(p_center uuid) returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.qbo_match_assert(p_center, 'Asking for AI match suggestions');
  if to_regprocedure('app.enqueue_job(uuid,text,jsonb,timestamp with time zone,integer)') is null then
    raise exception 'The background service is not set up yet, so AI suggestions cannot run.';
  end if;
  perform app.set_audit_context('Ask AI for QuickBooks donor matches');
  return app.qbo_queue_job(p_center, 'qbo.match_suggest_ai');
end $$;

-- "Try again" on Needs review: every waiting transaction of the customer (or of all approved customers).
create or replace function app.qbo_retry_bring_in(p_center uuid, p_qbo_customer text default null) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.qbo_match_assert(p_center, 'Retrying the QuickBooks history');
  perform app.set_audit_context('Try QuickBooks history again');
  update app.qbo_transactions t set cc_status = 'pending'
   where t.center_id = p_center and t.cc_status = 'needs_review' and (p_qbo_customer is null or t.customer_qbo_id = p_qbo_customer)
     and exists (select 1 from app.qbo_customer_matches m where m.center_id = p_center and m.qbo_customer_id = t.customer_qbo_id and m.status = 'approved');
  return app.qbo_queue_pending_bring_ins(p_center);
end $$;

-- Everything the Donor matching screen's header needs, in one call.
create or replace function app.qbo_match_overview(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v jsonb; v_ai jsonb; v_family int; v_total int; v_level text;
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not (app.has_permission(p_center, 'accounting.manage') or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'QuickBooks donor matching needs accounting.manage or giving.manage.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from app.integration_connections where center_id = p_center and provider in ('quickbooks_online', 'intuit_sandbox')
   order by (provider = 'quickbooks_online') desc limit 1;
  select count(*), count(*) filter (where app.qbo_looks_family(display_name, given_name, family_name))
    into v_total, v_family from app.qbo_customers where center_id = p_center and active;
  v_level := case when v_total = 0 then null when v_family * 10 >= v_total * 8 then 'family'
                  when v_family * 10 <= v_total * 2 then 'person' else 'mixed' end;
  -- Whether the AI handler is configured on a live worker (never a secret: configured or not, and why).
  if to_regclass('app.worker_heartbeats') is not null then
    execute $q$select jsonb_build_object('live', count(*) > 0,
                  'configured', coalesce(bool_or((info->'handlers'->'qbo.match_suggest_ai'->>'configured')::boolean), false),
                  'reason', max(info->'handlers'->'qbo.match_suggest_ai'->>'reason'))
                from app.worker_heartbeats where stopped_at is null and beat_at >= now() - interval '3 minutes'$q$ into v_ai;
  end if;
  select jsonb_build_object(
    'customers', count(*) filter (where cu.active),
    'approved', count(*) filter (where cu.active and ma.id is not null),
    'suggested', count(*) filter (where cu.active and ma.id is null and exists (select 1 from app.qbo_customer_matches s
                                    where s.center_id = p_center and s.qbo_customer_id = cu.qbo_id and s.status = 'suggested')),
    'not_mapped', count(*) filter (where cu.active and ma.id is null),
    'open_mapped_cents', coalesce(sum(cu.open_balance_cents) filter (where cu.active and ma.id is not null), 0),
    'open_unmapped_cents', coalesce(sum(cu.open_balance_cents) filter (where cu.active and ma.id is null), 0))
    into v
    from app.qbo_customers cu
    left join app.qbo_customer_matches ma on ma.center_id = p_center and ma.qbo_customer_id = cu.qbo_id and ma.status = 'approved'
   where cu.center_id = p_center;
  return v || jsonb_build_object(
    'connection', case when c.id is null then null else jsonb_build_object('status', c.status, 'display_name', c.display_name,
                    'realm_id', c.external_account_id, 'pulled_at', c.settings->>'customers_pulled_at',
                    'level', c.settings->>'qbo_customer_level',
                    'history_years', coalesce(c.settings->>'history_years', '7')) end,
    'suggested_level', v_level, 'family_like', v_family,
    'transactions', (select jsonb_build_object(
        'brought_in', count(*) filter (where cc_status = 'brought_in'),
        'needs_review', count(*) filter (where cc_status = 'needs_review'),
        'pending', count(*) filter (where cc_status = 'pending'),
        'skipped', count(*) filter (where cc_status = 'skipped'))
      from app.qbo_transactions where center_id = p_center),
    'ai', coalesce(v_ai, jsonb_build_object('live', false, 'configured', false)),
    'jobs', case when to_regclass('app.jobs') is null then null else (
      select coalesce(jsonb_object_agg(k.kind, (select jsonb_build_object('status', j.status, 'error', j.last_error, 'finished_at', j.finished_at,
                                                                           'created_at', j.created_at, 'result', j.result)
                                                  from app.jobs j where j.center_id = p_center and j.kind = k.kind order by j.id desc limit 1)), '{}'::jsonb)
        from unnest(array['qbo.pull_customers_history','qbo.match_suggest_ai','qbo.bring_in_history']) as k(kind)) end,
    'bring_in_waiting', case when to_regclass('app.jobs') is null then 0 else
      (select count(*) from app.jobs where center_id = p_center and kind = 'qbo.bring_in_history' and status in ('queued','running')) end);
end $$;

-- ── After QuickBooks connects, pull its customers ───────────────────────────
create or replace function app.qbo_on_connected() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.provider in ('quickbooks_online', 'intuit_sandbox') and new.status = 'connected'
     and (tg_op = 'INSERT' or old.status is distinct from 'connected')
     and app.module_enabled(new.center_id, 'accounting') then
    perform app.qbo_queue_job(new.center_id, 'qbo.pull_customers_history');
  end if;
  return new;
end $$;
drop trigger if exists qbo_pull_on_connect on app.integration_connections;
create trigger qbo_pull_on_connect after insert or update of status on app.integration_connections
  for each row execute function app.qbo_on_connected();

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke execute on function app.qbo_worker_connection(uuid), app.qbo_worker_store_customers(uuid, jsonb),
  app.qbo_worker_store_transactions(uuid, jsonb), app.qbo_worker_finish_pull(uuid, jsonb), app.qbo_worker_daily_pulls(),
  app.qbo_worker_ai_input(uuid, int), app.qbo_worker_store_ai(uuid, jsonb, text, text[]), app.qbo_worker_bring_in(uuid, text),
  app.qbo_bring_in_customer(uuid, text), app.qbo_queue_job(uuid, text, jsonb), app.qbo_queue_pending_bring_ins(uuid),
  app.qbo_txn_fund(uuid, app.qbo_transactions), app.qbo_mark(uuid, app.qbo_transactions, text, text, uuid, uuid, uuid),
  app.qbo_on_connected()
  from public, anon, authenticated;
grant execute on function app.qbo_request_pull(uuid), app.qbo_request_ai(uuid), app.qbo_retry_bring_in(uuid, text),
  app.qbo_match_overview(uuid), app.qbo_payment_method(text), app.qbo_type_label(text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'connect_worker') then
    grant execute on function app.qbo_worker_connection(uuid), app.qbo_worker_store_customers(uuid, jsonb),
      app.qbo_worker_store_transactions(uuid, jsonb), app.qbo_worker_finish_pull(uuid, jsonb), app.qbo_worker_daily_pulls(),
      app.qbo_worker_ai_input(uuid, int), app.qbo_worker_store_ai(uuid, jsonb, text, text[]), app.qbo_worker_bring_in(uuid, text)
      to connect_worker;
  end if;
end $$;
grant execute on all functions in schema app to service_role;
