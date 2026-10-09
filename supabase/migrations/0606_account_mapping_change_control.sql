-- Funds to QuickBooks accounts, with change control (owner priority 3a; docs/FUND_ACCOUNT_MAPPING_GAPS.md has the gaps
-- this closes, one row each). The pattern is 0597's: a change is a REQUEST that takes effect only when a SECOND,
-- DIFFERENT person with giving.approve confirms it; each of the two gives a reason and passes a fresh 2FA check
-- (app.assert_step_up, the conditional rule of 0150); everything is audited.
--
--   app.account_roles                    the catalog of account roles: the ten funds (income.*) and every other account
--                                        (payment clearing, merchant fees, bank, store sales, refunds, store cost ...),
--                                        the account types each accepts, and the aliases other money streams use
--                                        (processor_clearing, processor_fees, store_sales_income, store_cost)
--   app.account_for_role(center, role)   THE place that resolves an account. Each returns the QuickBooks id for this
--   app.account_for_fund(center, fund)   organization's connected company, or raises SQLSTATE CCMAP with a plain-English
--   app.account_for_bank_account(c, b)   reason that names what is missing (DETAIL '<subject>:<key>', e.g.
--   app.class_for_fund(center, fund)     'role:income.boli'). Never a silent default.
--   app.pledge_fund_key(source, kind)    which fund a pledge's money belongs to: its campaign's kind, else its source
--   app.account_mapping_changes          a request (who, when, old, new, reason) and its decision; the first-time choices
--                                        of setup are kept here too, so the history is complete
--   app.request_account_mapping_change / app.decide_account_mapping_change / app.cancel_account_mapping_change
--   app.account_mapping_overview         what Accounting › Account mapping shows; app.account_mapping_waiting: Home
--
-- What changes:
--   * Setup is unchanged: until the mapping has been approved once, the treasurer (accounting.manage) chooses accounts
--     and classes alone and approves the whole mapping with a fresh 2FA check, as before. Once it has been approved
--     ("in use"), an account, a fund's class or a bank account's QuickBooks account changes only through a confirmed
--     request. Guards on the three tables refuse every other signed-in route, a platform admin's included; sessions
--     with no signed-in person (the service role, the background service, migrations, seeds) are not asked (0597).
--   * A confirmed change affects postings sent after it. Entries already posted keep their accounts and are never
--     re-posted (re-posting is a later backlog item); each posting now keeps the document it was sent with (qbo_doc).
--     Over the API a signed-in person can only put a failed posting back in the queue (Retry).
--   * No silent defaults: a fund without an account no longer posts to general income (nor gift packing to store
--     sales, nor a deposit with an unusable bank account to the main bank account). The posting waits in the exception
--     queue with a plain reason (needs_mapping says for what) and goes back in the queue by itself once confirmed.
--     A campaign's own income account (campaigns.qbo_income_account_id, never settable from a screen and never
--     approved) is no longer used.
--   * Every choice records the QuickBooks company (realm) it was made in. A choice of another company counts as
--     unmapped; when the connected company changes, its old pulled lists are marked inactive until the new ones are
--     pulled, and waiting requests are withdrawn.
set client_min_messages = warning;

-- ═════════════════════════════════════════════════════════════════════════════
-- The catalog of account roles
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists app.account_roles (
  key            text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$'),
  kind           text not null check (kind in ('fund','role')),
  label          text not null check (char_length(label) between 1 and 80),
  hint           text,
  account_types  text[] not null check (cardinality(account_types) > 0),
  aliases        text[] not null default '{}',
  needs_item     boolean not null default false,
  required_when  text not null default 'never' check (required_when in ('always','store','accrual','never')),
  sort           integer not null default 100,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
comment on table app.account_roles is
  'Account roles a QuickBooks account is chosen for (docs/FUND_ACCOUNT_MAPPING_GAPS.md): kind fund = the income account of a fund (income.<fund>); kind role = any other account. account_types = the QuickBooks account types it accepts; needs_item = money is recorded through a QuickBooks item that must post to the account; aliases = other names app.account_for_role accepts. Platform catalog: a later migration adds a role with one row; organizations choose accounts through app.request_account_mapping_change.';

insert into app.module_tables (table_name, module_key) values ('account_roles', null)
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_account_roles on app.account_roles;
create trigger audit_account_roles after insert or update or delete on app.account_roles
  for each row execute function app.audit_row('key');
alter table app.account_roles enable row level security;
drop policy if exists account_roles_read on app.account_roles;
create policy account_roles_read on app.account_roles for select to authenticated using (true);
revoke all on app.account_roles from public, anon, authenticated, connect_worker;
grant select on app.account_roles to authenticated;
grant all on app.account_roles to service_role;

-- The purposes of 0232 and 0412, under the same keys and labels (src/lib/labels.ts QBO_PURPOSES mirrors them), plus
-- the four funds the setup screen never listed (events, membership dues, store giving, other: B59 #5) and two roles for
-- the streams being built next (refunds, store cost of goods).
insert into app.account_roles (key, kind, label, hint, account_types, aliases, needs_item, required_when, sort) values
  ('income.general',      'fund', 'General donations income', 'Unrestricted gifts, and money not tied to a pledge', array['Income','Other Income'], '{}', true, 'always', 10),
  ('income.boli',         'fund', 'Boli income', 'Boli pledges once paid', array['Income','Other Income'], '{}', true, 'never', 20),
  ('income.sponsorship',  'fund', 'Sponsorship income', 'Event and pujan sponsorships, labh', array['Income','Other Income'], '{}', true, 'never', 30),
  ('income.construction', 'fund', 'Construction fund income', 'Restricted: temple construction', array['Income','Other Income'], '{}', true, 'never', 40),
  ('income.pathshala',    'fund', 'Pathshala income', 'Pathshala fees and gifts', array['Income','Other Income'], '{}', true, 'never', 50),
  ('income.jeevdaya',     'fund', 'Jeevdaya income', 'Restricted: jeevdaya', array['Income','Other Income'], '{}', true, 'never', 60),
  ('income.event',        'fund', 'Event income', 'Event commitments and event campaigns', array['Income','Other Income'], array['events'], true, 'never', 70),
  ('income.membership',   'fund', 'Membership dues income', 'Membership fees (dues)', array['Income','Other Income'], array['dues'], true, 'never', 80),
  ('income.store',        'fund', 'Store giving income', 'Gifts to campaigns of kind "store" (store sales have their own account)', array['Income','Other Income'], '{}', true, 'never', 90),
  ('income.other',        'fund', 'Other income', 'Campaigns of kind "other"', array['Income','Other Income'], '{}', true, 'never', 100),
  ('store.sales',         'role', 'Store sales', 'Satvik Store — sales, not donations', array['Income','Other Income'], array['store_sales_income'], true, 'store', 200),
  ('store.gift_packing',  'role', 'Store gift packing', 'Gift-pack charges', array['Income','Other Income'], array['store_gift_packing'], true, 'never', 210),
  ('store.cost',          'role', 'Store cost of goods', 'What sold store items cost (cost of goods sold)', array['Cost of Goods Sold','Expense'], array['store_cost'], false, 'never', 215),
  ('sales_tax_payable',   'role', 'Sales tax payable', 'Tax collected on store sales', array['Other Current Liability'], '{}', false, 'store', 220),
  ('merchant_fees',       'role', 'Merchant fees', 'Card-processor fees (expense)', array['Expense','Other Expense','Cost of Goods Sold'], array['processor_fees'], false, 'always', 300),
  ('payment_clearing',    'role', 'Payment clearing', 'Card money before the payout lands', array['Bank','Other Current Asset'], array['processor_clearing'], false, 'always', 310),
  ('bank',                'role', 'Bank account', 'Operating account deposits land in', array['Bank'], '{}', false, 'always', 320),
  ('undeposited_funds',   'role', 'Undeposited funds', 'Checks and cash until the deposit', array['Other Current Asset','Bank'], '{}', false, 'always', 330),
  ('pledges_receivable',  'role', 'Pledges receivable', 'Only used on accrual basis', array['Accounts Receivable','Other Current Asset'], '{}', false, 'accrual', 340),
  ('stock_clearing',      'role', 'Stock clearing', 'Stock gifts until sold', array['Other Current Asset','Bank','Other Asset'], '{}', false, 'never', 350),
  ('pledge_writeoffs',    'role', 'Pledge write-offs', 'Written-off pledge balances (bad debt expense, or a contra-income account); a QuickBooks item must post to it', array['Expense','Other Expense','Income','Other Income'], '{}', false, 'never', 360),
  ('refunds',             'role', 'Refunds', 'Money given back, when your books keep refunds in an account of their own', array['Income','Other Income','Expense','Other Expense'], '{}', false, 'never', 370)
on conflict (key) do update
  set kind = excluded.kind, label = excluded.label, hint = excluded.hint, account_types = excluded.account_types,
      aliases = excluded.aliases, needs_item = excluded.needs_item, required_when = excluded.required_when, sort = excluded.sort;

-- The purposes and their account types now come from the catalog (same answer as 0412's list, plus the new roles).
create or replace function app.qbo_purposes() returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(jsonb_object_agg(r.key, to_jsonb(r.account_types)), '{}'::jsonb) from app.account_roles r where r.active
$$;

-- What must be mapped before the mapping is approved: the same set as 0232 (always: general income, bank, undeposited
-- funds, payment clearing, merchant fees; on accrual basis: pledges receivable; with the Store module: store sales and
-- sales tax), now read from the catalog.
create or replace function app.qbo_required_purposes(p_center uuid) returns text[]
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.integration_connections;
begin
  select * into c from app.qbo_connection(p_center);
  return coalesce((
    select array_agg(r.key order by r.sort, r.key) from app.account_roles r
     where r.active
       and (r.required_when = 'always'
            or (r.required_when = 'accrual' and c.settings->>'basis' = 'accrual')
            or (r.required_when = 'store' and app.module_enabled(p_center, 'store')))), '{}');
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- What each choice records
-- ═════════════════════════════════════════════════════════════════════════════
alter table app.qbo_account_mappings
  add column if not exists realm_id text,
  add column if not exists first_approved_at timestamptz;
comment on column app.qbo_account_mappings.realm_id is
  'The QuickBooks company (realm) the account was chosen in. A mapping of another company counts as unmapped (0606). Kept by the database.';
comment on column app.qbo_account_mappings.first_approved_at is
  'When this account was first approved. Once any row of an organization has it, the mapping is "in use" and every change needs a second person (0606). Never cleared.';
alter table app.funds add column if not exists qbo_class_realm text;
comment on column app.funds.qbo_class_realm is 'The QuickBooks company (realm) the class was chosen in (0606). Kept by the database.';
alter table app.bank_accounts add column if not exists qbo_account_realm text;
comment on column app.bank_accounts.qbo_account_realm is 'The QuickBooks company (realm) the account was chosen in (0606). Kept by the database.';
alter table app.ledger_postings
  add column if not exists qbo_doc jsonb,
  add column if not exists qbo_realm text,
  add column if not exists needs_mapping text;
comment on column app.ledger_postings.qbo_doc is
  'The document as sent to QuickBooks (accounts, items, classes, amounts), kept once the posting is claimed. An entry already posted keeps it: a later mapping change never touches it (0606).';
comment on column app.ledger_postings.qbo_realm is 'The QuickBooks company (realm) qbo_doc was built for.';
comment on column app.ledger_postings.needs_mapping is
  'A failed posting waiting for a mapping: ''role:<key>'', ''fund_class:<fund id>'' or ''bank_account:<id>''. Confirming that mapping puts it back in the queue (0606).';
comment on column app.campaigns.qbo_income_account_id is
  'Not used for posting since 0606: no screen ever set it and nobody approved it. A fund''s account is chosen in Accounting › Account mapping.';

-- Existing choices belong to the company connected now; an approved row is in use from when it was approved.
do $$ begin
  perform app.set_audit_context('Account mapping change control (0606): each choice records the QuickBooks company it was made in');
end $$;
update app.qbo_account_mappings m
   set realm_id = (select c.external_account_id from app.qbo_connection(m.center_id) c),
       first_approved_at = coalesce(m.first_approved_at, m.approved_at);
update app.funds f
   set qbo_class_realm = (select c.external_account_id from app.qbo_connection(f.center_id) c)
 where f.qbo_class_id is not null and f.qbo_class_realm is null;
update app.bank_accounts b
   set qbo_account_realm = (select c.external_account_id from app.qbo_connection(b.center_id) c)
 where b.qbo_account_id is not null and b.qbo_account_realm is null;

-- ═════════════════════════════════════════════════════════════════════════════
-- Requests (and the setup choices)
-- ═════════════════════════════════════════════════════════════════════════════
-- subject role: target_key = the role key; fund_class: the fund's id; bank_account: the bank account's id.
-- from_*/to_* are the QuickBooks ids and names when asked (to_ref null = no class / use the main bank account).
-- mode setup: chosen before the mapping was ever approved (one person, as before), recorded for the history.
-- A row is never edited after it is written except by the functions below, so the second person confirms exactly what
-- they were shown.
create table if not exists app.account_mapping_changes (
  id                uuid primary key default gen_random_uuid(),
  center_id         uuid not null references app.centers(id) on delete cascade,
  subject           text not null check (subject in ('role','fund_class','bank_account')),
  target_key        text not null check (char_length(target_key) between 1 and 80),
  target_label      text not null check (char_length(target_label) between 1 and 200),
  connection_id     uuid references app.integration_connections(id) on delete set null,
  realm_id          text,
  from_ref          text,
  from_name         text,
  to_ref            text,
  to_name           text,
  to_type           text,
  mode              text not null default 'request' check (mode in ('setup','request')),
  status            text not null default 'pending'
                    check (status in ('pending','applied','rejected','cancelled','superseded','expired')),
  requested_by      uuid not null references auth.users(id),
  requested_at      timestamptz not null default now(),
  request_reason    text not null check (char_length(request_reason) between 1 and 500),
  expires_at        timestamptz,
  decided_by        uuid references auth.users(id),
  decided_at        timestamptz,
  decision_reason   text check (decision_reason is null or char_length(decision_reason) between 1 and 500),
  cancelled_by      uuid references auth.users(id),
  applied_at        timestamptz,
  queued_postings   integer,
  requeued_postings integer,
  created_at        timestamptz not null default now(),
  constraint account_mapping_changes_role_to check (subject <> 'role' or to_ref is not null),
  constraint account_mapping_changes_request check (mode = 'setup' or expires_at is not null),
  constraint account_mapping_changes_setup check (mode = 'request' or (status = 'applied' and decided_by is null and applied_at is not null)),
  constraint account_mapping_changes_two_people check (status <> 'applied' or mode = 'setup'
                                                       or (decided_by is not null and decided_by <> requested_by and applied_at is not null)),
  constraint account_mapping_changes_decided check (mode = 'setup' or ((status in ('applied','rejected')) = (decided_by is not null)))
);
comment on table app.account_mapping_changes is
  'Changes to which QuickBooks account (or class) each fund, role and bank account posts to (0606, docs/FUND_ACCOUNT_MAPPING_GAPS.md). Once the mapping is in use a change takes effect only when a different person with giving.approve confirms it with a fresh 2FA check and a reason; mode setup rows are the first-time choices of one person, kept for the history.';
create index if not exists account_mapping_changes_center_created on app.account_mapping_changes (center_id, created_at desc);
create unique index if not exists account_mapping_changes_one_waiting
  on app.account_mapping_changes (center_id, subject, target_key) where status = 'pending';

insert into app.module_tables (table_name, module_key) values ('account_mapping_changes', 'accounting')
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_account_mapping_changes on app.account_mapping_changes;
create trigger audit_account_mapping_changes after insert or update or delete on app.account_mapping_changes
  for each row execute function app.audit_row();

-- ── Who may ──────────────────────────────────────────────────────────────────
-- 0597's rule (the vault's): the owner, or an active role grant with the permission; a platform admin's blanket
-- permissions do NOT count. The first person: accounting.manage (the treasurer, who maps today). The second:
-- giving.approve (the treasurer; the owner counts), never the person who asked.
create or replace function app.account_map_can_request(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.payee_has_permission(p_center, 'accounting.manage')
$$;

create or replace function app.account_map_can_approve(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.payee_has_permission(p_center, 'giving.approve')
$$;

-- In use: some account of this organization has been approved at least once.
create or replace function app.account_mapping_in_use(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.qbo_account_mappings m where m.center_id = p_center and m.first_approved_at is not null)
$$;

-- The canonical role key for a key or an alias (null when unknown).
create or replace function app.account_role_key(p_role text) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select r.key from app.account_roles r
   where r.active and (r.key = btrim(p_role) or btrim(p_role) = any (r.aliases))
   order by (r.key = btrim(p_role)) desc, r.key
   limit 1
$$;

-- The QuickBooks company (realm) of the connection in use.
create or replace function app._qbo_realm(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select c.external_account_id from app.qbo_connection(p_center) c
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table app.account_mapping_changes enable row level security;
drop policy if exists account_mapping_changes_read on app.account_mapping_changes;
create policy account_mapping_changes_read on app.account_mapping_changes for select to authenticated
  using (app.qbo_can_view(center_id) or app.account_map_can_approve(center_id));
do $$ begin perform app._qbo_module_switch('account_mapping_changes'); end $$;
revoke all on app.account_mapping_changes from public, anon, authenticated, connect_worker;
grant select on app.account_mapping_changes to authenticated;
grant all on app.account_mapping_changes to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- Resolving an account: the one place
-- ═════════════════════════════════════════════════════════════════════════════
-- Internal: {key, label, kind, account_id (only when it can be posted to), mapped_account_id, account_name, account_type,
-- approved, problem}. problem: plain English, what is wrong and where to fix it; null when the account can be used.
create or replace function app._account_for_role(p_center uuid, p_role text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_key text := app.account_role_key(p_role); r app.account_roles; c app.integration_connections;
        m app.qbo_account_mappings; a app.qbo_accounts; v_problem text;
        v_where constant text := 'Accounting › Account mapping';
begin
  if v_key is null then
    return jsonb_build_object('key', p_role, 'label', p_role, 'unknown', true,
                              'problem', format('Weaver does not know the account role "%s".', coalesce(p_role, '')));
  end if;
  select * into r from app.account_roles where key = v_key;
  select * into c from app.qbo_connection(p_center);
  select * into m from app.qbo_account_mappings where center_id = p_center and purpose = v_key;
  if c.id is null then
    v_problem := format('QuickBooks is not connected, so %s has no QuickBooks account.', r.label);
  elsif m.purpose is null then
    v_problem := format('%s has no QuickBooks account yet. Choose one in %s.', r.label, v_where);
  elsif m.realm_id is distinct from c.external_account_id then
    v_problem := format('The account for %s ("%s") was chosen in another QuickBooks company. Choose an account of the company connected now in %s.',
                        r.label, coalesce(m.qbo_account_name, m.qbo_account_id), v_where);
  elsif m.approved_at is null then
    v_problem := format('The QuickBooks account for %s ("%s") is not approved yet. The treasurer approves the mapping in Accounting › QuickBooks setup.',
                        r.label, coalesce(m.qbo_account_name, m.qbo_account_id));
  else
    select * into a from app.qbo_accounts where connection_id = c.id and qbo_id = m.qbo_account_id;
    if a.qbo_id is null then
      v_problem := format('The account for %s ("%s") is no longer in QuickBooks. Choose another account in %s.',
                          r.label, coalesce(m.qbo_account_name, m.qbo_account_id), v_where);
    elsif not a.active then
      v_problem := format('"%s", the account for %s, is inactive in QuickBooks. Make it active there, or choose another account in %s.', a.name, r.label, v_where);
    elsif a.account_type is not null and not (a.account_type = any (r.account_types)) then
      v_problem := format('"%s", the account for %s, is a %s account in QuickBooks now; %s needs one of: %s. Choose another account in %s.',
                          a.name, r.label, a.account_type, r.label, array_to_string(r.account_types, ', '), v_where);
    end if;
  end if;
  return jsonb_build_object('key', v_key, 'label', r.label, 'kind', r.kind,
                            'account_id', case when v_problem is null then m.qbo_account_id end,
                            'mapped_account_id', m.qbo_account_id, 'account_name', coalesce(a.name, m.qbo_account_name),
                            'account_type', a.account_type, 'approved', m.approved_at is not null, 'problem', v_problem);
end $$;

-- The QuickBooks account of a role (a key or an alias). Raises CCMAP (DETAIL 'role:<key>') when it cannot be posted to.
create or replace function app.account_for_role(p_center uuid, p_role text) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb := app._account_for_role(p_center, p_role);
begin
  if v ? 'unknown' then raise exception '%', v->>'problem' using errcode = '22023'; end if;
  if v->>'problem' is not null then
    raise exception '%', v->>'problem'
      using errcode = 'CCMAP', detail = 'role:' || (v->>'key'),
            hint = 'The entry waits in the exception queue and goes back in the queue by itself once the account is confirmed.';
  end if;
  return v->>'account_id';
end $$;

-- The income account of a fund: 'general', 'boli', 'sponsorship', 'construction', 'pathshala', 'jeevdaya', 'event',
-- 'membership' (alias 'dues'), 'store', 'other'; 'income.<fund>' is accepted too.
create or replace function app.account_for_fund(p_center uuid, p_fund_key text) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_key text := app.account_role_key(p_fund_key);
begin
  if v_key is null or (select r.kind from app.account_roles r where r.key = v_key) <> 'fund' then
    v_key := app.account_role_key('income.' || btrim(coalesce(p_fund_key, '')));
  end if;
  if v_key is null or (select r.kind from app.account_roles r where r.key = v_key) <> 'fund' then
    raise exception 'Weaver does not know the fund "%". The funds are: %.', coalesce(p_fund_key, ''),
      (select string_agg(substr(r.key, 8), ', ' order by r.sort) from app.account_roles r where r.kind = 'fund' and r.active)
      using errcode = '22023';
  end if;
  return app.account_for_role(p_center, v_key);
end $$;

-- Which fund a pledge's money belongs to: its campaign's kind, else its source (a pledge with no campaign is no longer
-- general income by default: dues are dues, a Pathshala fee is Pathshala, an event commitment is events).
create or replace function app.pledge_fund_key(p_source text, p_campaign_kind text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(nullif(btrim(p_campaign_kind), ''),
                  case p_source
                    when 'boli' then 'boli'
                    when 'sponsorship' then 'sponsorship'
                    when 'pujan' then 'sponsorship'
                    when 'labh' then 'sponsorship'
                    when 'construction' then 'construction'
                    when 'membership_fee' then 'membership'
                    when 'pathshala_fee' then 'pathshala'
                    when 'rsvp_commitment' then 'event'
                    when 'store' then 'store'
                    when 'other' then 'other'
                    else 'general' end)
$$;

-- Internal: a fund's class {found, class_id (only when usable; null = no class), mapped_class_id, class_name, problem}.
create or replace function app._fund_class_state(p_center uuid, p_fund uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare f app.funds; c app.integration_connections; k app.qbo_classes; v_problem text;
        v_where constant text := 'Accounting › Account mapping';
begin
  select * into f from app.funds where id = p_fund and center_id = p_center;
  if f.id is null then return jsonb_build_object('found', false); end if;
  if f.qbo_class_id is null then
    return jsonb_build_object('found', true, 'class_id', null, 'mapped_class_id', null, 'class_name', null, 'problem', null);
  end if;
  select * into c from app.qbo_connection(p_center);
  select * into k from app.qbo_classes where connection_id = c.id and qbo_id = f.qbo_class_id;
  if c.id is null then
    v_problem := format('QuickBooks is not connected, so the class of the fund "%s" cannot be used.', f.name);
  elsif f.qbo_class_realm is distinct from c.external_account_id then
    v_problem := format('The QuickBooks class of the fund "%s" was chosen in another QuickBooks company. Choose a class of the company connected now in %s.', f.name, v_where);
  elsif k.qbo_id is null then
    v_problem := format('The QuickBooks class of the fund "%s" (id %s) is no longer in QuickBooks. Choose another class in %s.', f.name, f.qbo_class_id, v_where);
  elsif not k.active then
    v_problem := format('The QuickBooks class of the fund "%s" ("%s") is inactive in QuickBooks. Make it active there, or choose another class in %s.', f.name, k.name, v_where);
  end if;
  return jsonb_build_object('found', true, 'class_id', case when v_problem is null then f.qbo_class_id end,
                            'mapped_class_id', f.qbo_class_id, 'class_name', k.name, 'problem', v_problem);
end $$;

-- A fund's QuickBooks class, or null when it has none. Raises CCMAP (DETAIL 'fund_class:<id>') when it cannot be used.
create or replace function app.class_for_fund(p_center uuid, p_fund uuid) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb;
begin
  if p_fund is null then return null; end if;
  v := app._fund_class_state(p_center, p_fund);
  if not (v->>'found')::boolean then raise exception 'That fund was not found in this organization.' using errcode = '22023'; end if;
  if v->>'problem' is not null then
    raise exception '%', v->>'problem'
      using errcode = 'CCMAP', detail = 'fund_class:' || p_fund,
            hint = 'The entry waits in the exception queue and goes back in the queue by itself once the class is confirmed.';
  end if;
  return v->>'class_id';
end $$;

-- Internal: a bank account's QuickBooks account {found, account_id, mapped_account_id, account_name, uses_main_bank, problem}.
-- With no account of its own it uses the main "Bank account" role, but only when it is the organization's only active
-- bank account: with several, Weaver cannot tell which register the money lands in.
create or replace function app._bank_account_state(p_center uuid, p_bank_account uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare b app.bank_accounts; c app.integration_connections; a app.qbo_accounts; v_types text[]; v_problem text; v_n int;
        v_where constant text := 'Accounting › Account mapping';
begin
  select * into b from app.bank_accounts where id = p_bank_account and center_id = p_center;
  if b.id is null then return jsonb_build_object('found', false); end if;
  if b.qbo_account_id is null then
    select count(*) into v_n from app.bank_accounts x where x.center_id = p_center and x.active;
    if v_n > 1 then
      v_problem := format('The bank account "%s" has no QuickBooks account of its own, and this organization has more than one bank account, so Weaver cannot tell which QuickBooks bank account its money lands in. Choose it in %s.', b.name, v_where);
    end if;
    return jsonb_build_object('found', true, 'account_id', null, 'mapped_account_id', null, 'account_name', null,
                              'uses_main_bank', v_problem is null, 'problem', v_problem);
  end if;
  select * into c from app.qbo_connection(p_center);
  select r.account_types into v_types from app.account_roles r where r.key = 'bank';
  select * into a from app.qbo_accounts where connection_id = c.id and qbo_id = b.qbo_account_id;
  if c.id is null then
    v_problem := format('QuickBooks is not connected, so the bank account "%s" has no QuickBooks account.', b.name);
  elsif b.qbo_account_realm is distinct from c.external_account_id then
    v_problem := format('The QuickBooks account of the bank account "%s" was chosen in another QuickBooks company. Choose an account of the company connected now in %s.', b.name, v_where);
  elsif a.qbo_id is null then
    v_problem := format('The QuickBooks account of the bank account "%s" (id %s) is no longer in QuickBooks. Choose another account in %s.', b.name, b.qbo_account_id, v_where);
  elsif not a.active then
    v_problem := format('"%s", the QuickBooks account of the bank account "%s", is inactive in QuickBooks. Make it active there, or choose another account in %s.', a.name, b.name, v_where);
  elsif a.account_type is not null and not (a.account_type = any (v_types)) then
    v_problem := format('"%s", the QuickBooks account of the bank account "%s", is a %s account, not a bank account. Choose another account in %s.', a.name, b.name, a.account_type, v_where);
  end if;
  return jsonb_build_object('found', true, 'account_id', case when v_problem is null then b.qbo_account_id end,
                            'mapped_account_id', b.qbo_account_id, 'account_name', a.name, 'uses_main_bank', false, 'problem', v_problem);
end $$;

-- The QuickBooks bank account a bank account's money lands in. Raises CCMAP (DETAIL 'bank_account:<id>').
create or replace function app.account_for_bank_account(p_center uuid, p_bank_account uuid) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb := app._bank_account_state(p_center, p_bank_account);
begin
  if not (v->>'found')::boolean then raise exception 'That bank account was not found in this organization.' using errcode = '22023'; end if;
  if v->>'problem' is not null then
    raise exception '%', v->>'problem'
      using errcode = 'CCMAP', detail = 'bank_account:' || p_bank_account,
            hint = 'The entry waits in the exception queue and goes back in the queue by itself once the account is confirmed.';
  end if;
  if (v->>'uses_main_bank')::boolean then return app.account_for_role(p_center, 'bank'); end if;
  return v->>'account_id';
end $$;

-- 0233's lookup, now only for the company connected now (the write-off and test-post documents use it).
create or replace function app._qbo_account(p_center uuid, p_purpose text) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select m.qbo_account_id from app.qbo_account_mappings m
   where m.center_id = p_center and m.purpose = p_purpose and m.approved_at is not null
     and m.realm_id is not distinct from app._qbo_realm(p_center)
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- The guards
-- ═════════════════════════════════════════════════════════════════════════════
-- app.account_map_apply (transaction-local) is set only by the functions below: 'setup' while one person chooses before
-- the mapping is in use, 'confirmed' while a request confirmed by a second person is applied.

-- 0521's guard on qbo_account_mappings, plus: the realm, the first approval and the account's name are kept by the
-- database; a row never moves to another organization; changing its role (purpose) is a change like changing its
-- account; once the mapping is in use no signed-in route changes either except a confirmed request; approvals are set
-- or withdrawn only by the functions that do so (never directly: withdrawing one would stop posting); the purpose must
-- be a catalog role.
create or replace function app.qbo_account_mappings_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; a app.qbo_accounts; v_types jsonb; v_label text;
        v_flag text := coalesce(current_setting('app.account_map_apply', true), '');
        v_approval boolean := coalesce(current_setting('app.qbo_mapping_approval', true), '') = 'on';
begin
  if tg_op = 'UPDATE' then
    if new.center_id is distinct from old.center_id then
      raise exception 'A mapping belongs to one organization; it cannot be moved to another.' using errcode = '23514';
    end if;
    new.realm_id := old.realm_id;
    new.first_approved_at := old.first_approved_at;
  else
    new.realm_id := null;
    new.first_approved_at := null;
  end if;
  if tg_op = 'INSERT' or new.qbo_account_id is distinct from old.qbo_account_id or new.purpose is distinct from old.purpose
     or v_flag in ('setup','confirmed') then
    v_label := coalesce((select r.label from app.account_roles r where r.key = new.purpose), new.purpose);
    -- In use: only a confirmed request. Sessions without a signed-in person (service role, background service,
    -- migrations, seeds) are not asked, as app.assert_step_up never asks them.
    if auth.uid() is not null and v_flag <> 'confirmed' and app.account_mapping_in_use(new.center_id) then
      raise exception 'The account mapping is in use, so changing the account for % needs a second person. Ask for the change in Accounting › Account mapping; a different person with giving.approve then confirms it.', v_label
        using errcode = '22023';
    end if;
    if not exists (select 1 from app.account_roles r where r.key = new.purpose and r.active) then
      raise exception 'Unknown mapping purpose "%".', new.purpose using errcode = '23514';
    end if;
    select * into c from app.qbo_connection(new.center_id);
    select * into a from app.qbo_accounts where connection_id = c.id and qbo_id = new.qbo_account_id;
    if a.qbo_id is null then
      raise exception 'Choose the account from the chart of accounts pulled from QuickBooks (account "%" is not in it). Pull the lists first if the chart is empty.',
        new.qbo_account_id using errcode = '23514';
    end if;
    if not a.active then
      raise exception '"%" is inactive in QuickBooks, so nothing can post to it. Choose an active account.', a.name using errcode = '23514';
    end if;
    v_types := app.qbo_purposes()->new.purpose;
    if v_types is not null and a.account_type is not null and not (v_types ? a.account_type) then
      raise exception '"%" is a % account; % needs one of: %.', a.name, a.account_type, new.purpose,
        (select string_agg(x, ', ') from jsonb_array_elements_text(v_types) x) using errcode = '23514';
    end if;
    if coalesce(c.settings->>'basis', '') not in ('cash','accrual') then
      raise exception 'Choose the accounting basis (cash or accrual) first: it decides which accounts the mapping needs.' using errcode = '23514';
    end if;
    new.qbo_account_name := a.name;
    new.realm_id := c.external_account_id;
    if v_flag = 'confirmed' then
      -- The second person's confirmation is the approval of this account.
      new.approved_by := auth.uid();
      new.approved_at := now();
    else
      new.approved_by := null;
      new.approved_at := null;
    end if;
  elsif (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) and not v_approval then
    raise exception 'The mapping is approved as a whole by the treasurer (Approve mapping, with a fresh 2FA check).' using errcode = '23514';
  elsif new.approved_at is not null and old.approved_at is null then
    select * into c from app.qbo_connection(new.center_id);
    if coalesce(c.settings->>'basis', '') not in ('cash','accrual') then
      raise exception 'Choose the accounting basis (cash or accrual) before approving the mapping.' using errcode = '23514';
    end if;
  end if;
  -- The account's name comes from the chart: when the account is chosen, or when the whole mapping is approved.
  if tg_op = 'UPDATE' and new.qbo_account_id is not distinct from old.qbo_account_id and new.purpose is not distinct from old.purpose
     and v_flag not in ('setup','confirmed') and not v_approval then
    new.qbo_account_name := old.qbo_account_name;
  end if;
  if new.approved_at is not null and new.first_approved_at is null then
    new.first_approved_at := new.approved_at;
  end if;
  return new;
end $$;

-- 0232's trigger: a changed account withdraws the approval of the whole mapping, except when a second person confirmed
-- the change (that confirmation approves the new account; the rest of the mapping and the test post stay approved, so
-- posting goes on with the new account).
create or replace function app.qbo_account_mappings_changed() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if coalesce(current_setting('app.account_map_apply', true), '') = 'confirmed' then return null; end if;
  if tg_op = 'INSERT' or new.qbo_account_id is distinct from old.qbo_account_id then
    update app.integration_connections
       set settings = settings - 'mapping_approved_by' - 'mapping_approved_at' - 'test_post_approved_by' - 'test_post_approved_at'
     where center_id = new.center_id and provider in ('quickbooks_online','intuit_sandbox')
       and (settings ? 'mapping_approved_at' or settings ? 'test_post_approved_at');
  end if;
  return null;
end $$;

-- An account in use is never removed by a signed-in route ("remove it, then add another" is no way round).
create or replace function app.qbo_account_mappings_delete_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is not null and app.account_mapping_in_use(old.center_id) then
    raise exception 'The account mapping is in use, so an account cannot be removed from it. Ask for a change in Accounting › Account mapping instead; a different person with giving.approve confirms it.'
      using errcode = '22023';
  end if;
  return old;
end $$;
drop trigger if exists qbo_account_mappings_delete_guard on app.qbo_account_mappings;
create trigger qbo_account_mappings_delete_guard before delete on app.qbo_account_mappings
  for each row execute function app.qbo_account_mappings_delete_guard();

-- A fund's class: once the mapping is in use, only a confirmed request. The realm is kept by the database.
create or replace function app.funds_qbo_class_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_flag text := coalesce(current_setting('app.account_map_apply', true), '');
begin
  if tg_op = 'UPDATE' and new.qbo_class_id is not distinct from old.qbo_class_id and v_flag not in ('setup','confirmed') then
    new.qbo_class_realm := old.qbo_class_realm;
    return new;
  end if;
  if tg_op = 'INSERT' and new.qbo_class_id is null then
    new.qbo_class_realm := null;
    return new;
  end if;
  if auth.uid() is not null and v_flag <> 'confirmed' and app.account_mapping_in_use(new.center_id) then
    raise exception 'The account mapping is in use, so changing the QuickBooks class of the fund "%" needs a second person. Ask for the change in Accounting › Account mapping; a different person with giving.approve then confirms it.', new.name
      using errcode = '22023';
  end if;
  new.qbo_class_realm := case when new.qbo_class_id is null then null else app._qbo_realm(new.center_id) end;
  return new;
end $$;
drop trigger if exists funds_qbo_class_guard on app.funds;
create trigger funds_qbo_class_guard before insert or update on app.funds
  for each row execute function app.funds_qbo_class_guard();

-- A bank account's QuickBooks account: chosen from the pulled chart (an active Bank account) by a person; once the
-- mapping is in use, only through a confirmed request. The realm is kept by the database.
create or replace function app.bank_accounts_qbo_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_flag text := coalesce(current_setting('app.account_map_apply', true), ''); c app.integration_connections;
        a app.qbo_accounts; v_types text[];
begin
  if tg_op = 'UPDATE' and new.qbo_account_id is not distinct from old.qbo_account_id and v_flag not in ('setup','confirmed') then
    new.qbo_account_realm := old.qbo_account_realm;
    return new;
  end if;
  if tg_op = 'INSERT' and new.qbo_account_id is null then
    new.qbo_account_realm := null;
    return new;
  end if;
  if auth.uid() is not null and v_flag <> 'confirmed' and app.account_mapping_in_use(new.center_id) then
    raise exception 'The account mapping is in use, so changing the QuickBooks account of the bank account "%" needs a second person. Ask for the change in Accounting › Account mapping; a different person with giving.approve then confirms it.', new.name
      using errcode = '22023';
  end if;
  if new.qbo_account_id is not null and auth.uid() is not null then
    select * into c from app.qbo_connection(new.center_id);
    select * into a from app.qbo_accounts where connection_id = c.id and qbo_id = new.qbo_account_id;
    select r.account_types into v_types from app.account_roles r where r.key = 'bank';
    if a.qbo_id is null or not a.active or (a.account_type is not null and not (a.account_type = any (v_types))) then
      raise exception 'Choose the QuickBooks account of the bank account "%" from the chart pulled from QuickBooks: an active Bank account (account "%" is not one).',
        new.name, new.qbo_account_id using errcode = '23514';
    end if;
  end if;
  new.qbo_account_realm := case when new.qbo_account_id is null then null else app._qbo_realm(new.center_id) end;
  return new;
end $$;
drop trigger if exists bank_accounts_qbo_guard on app.bank_accounts;
create trigger bank_accounts_qbo_guard before insert or update on app.bank_accounts
  for each row execute function app.bank_accounts_qbo_guard();

-- Ledger postings over the API. The table grant of 0001 and the staff policy let accounting.manage write them directly:
-- set a posted entry back to "queued" (it would post again), overwrite its QuickBooks reference, add or delete one.
-- Deliberately SECURITY INVOKER: current_user is 'authenticated' only for a write sent straight over the API; the
-- functions that queue, claim and record postings run as their owner and are not asked. What is left to a person:
-- Retry, a failed posting back to the queue (it is then built again from the mapping in force).
create or replace function app.ledger_postings_api_guard() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  if current_user <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and old.status = 'failed' and new.status = 'queued'
     and (to_jsonb(new) - array['status','last_error','needs_mapping','qbo_doc','qbo_realm']::text[])
         = (to_jsonb(old) - array['status','last_error','needs_mapping','qbo_doc','qbo_realm']::text[]) then
    new.qbo_doc := null;
    new.qbo_realm := null;
    new.needs_mapping := null;
    return new;
  end if;
  raise exception 'Ledger postings are written by the QuickBooks poster only. A failed posting can be put back in the queue (Retry); a posted one never changes and is never sent again.'
    using errcode = '42501';
end $$;
drop trigger if exists ledger_postings_api_guard on app.ledger_postings;
create trigger ledger_postings_api_guard before insert or update or delete on app.ledger_postings
  for each row execute function app.ledger_postings_api_guard();

-- QuickBooks connection rows over the API. The table grant of 0001 and the staff policy let integrations.manage write
-- them directly, which would go round every check of Accounting › QuickBooks setup: switch the company (realm), write
-- "mapping approved" or "test post approved" into the settings, move the go-live date or the basis. They are written by
-- the connect flow, the settings and approval functions and the background service (all of them run as their owner),
-- never straight over the API. SECURITY INVOKER for the same reason as the ledger guard.
create or replace function app.qbo_connection_api_guard() returns trigger
language plpgsql set search_path = app, public, extensions as $$
declare v_qbo boolean;
begin
  if current_user <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_qbo := coalesce(tg_op <> 'INSERT' and old.provider in ('quickbooks_online','intuit_sandbox'), false)
        or coalesce(tg_op <> 'DELETE' and new.provider in ('quickbooks_online','intuit_sandbox'), false);
  if not v_qbo then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'The QuickBooks connection is changed only in Accounting › QuickBooks setup (connecting, the choices and the approvals each have their own checks).'
    using errcode = '42501';
end $$;
drop trigger if exists qbo_connection_api_guard on app.integration_connections;
create trigger qbo_connection_api_guard before insert or update or delete on app.integration_connections
  for each row execute function app.qbo_connection_api_guard();

-- Another QuickBooks company was connected on the same connection. Its old pulled lists stay under this connection
-- until the new company's lists are pulled, and QuickBooks numbers accounts per company ("7" there is usually a
-- different account), so they are marked inactive: nothing can be chosen, confirmed or posted against them. The next
-- pull brings back what the new company has. Waiting requests were asked against the old company: withdrawn.
create or replace function app.qbo_company_switched() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.qbo_accounts set active = false where connection_id = new.id and active;
  update app.qbo_classes set active = false where connection_id = new.id and active;
  update app.qbo_items set active = false where connection_id = new.id and active;
  update app.qbo_locations set active = false where connection_id = new.id and active;
  update app.qbo_tax_codes set active = false where connection_id = new.id and active;
  update app.qbo_payment_methods set active = false where connection_id = new.id and active;
  update app.account_mapping_changes
     set status = 'cancelled', decided_at = now(),
         decision_reason = 'The QuickBooks company changed, so this request was withdrawn. Ask again for an account of the company connected now.'
   where center_id = new.center_id and status = 'pending';
  return null;
end $$;
drop trigger if exists qbo_company_switched on app.integration_connections;
create trigger qbo_company_switched after update of external_account_id on app.integration_connections
  for each row when (old.provider in ('quickbooks_online','intuit_sandbox') and old.external_account_id is not null
                     and new.external_account_id is distinct from old.external_account_id)
  execute function app.qbo_company_switched();

-- ═════════════════════════════════════════════════════════════════════════════
-- Asking, confirming, withdrawing
-- ═════════════════════════════════════════════════════════════════════════════
-- Internal: write a choice. p_mode 'setup' (one person, before the mapping is in use; as set_qbo_mapping /
-- set_qbo_fund_class did) or 'confirmed' (a request confirmed by a second person).
create or replace function app._apply_account_mapping(p_center uuid, p_subject text, p_key text, p_to text, p_mode text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if p_mode is null or p_mode not in ('setup','confirmed') then raise exception 'Unknown way of applying a mapping change.'; end if;
  -- The flag covers exactly the one write of the choice itself.
  perform set_config('app.account_map_apply', p_mode, true);
  if p_subject = 'role' then
    insert into app.qbo_account_mappings (center_id, purpose, qbo_account_id) values (p_center, p_key, p_to)
    on conflict (center_id, purpose) do update set qbo_account_id = excluded.qbo_account_id;
  elsif p_subject = 'fund_class' then
    update app.funds set qbo_class_id = p_to where id = p_key::uuid and center_id = p_center;
  elsif p_subject = 'bank_account' then
    update app.bank_accounts set qbo_account_id = p_to where id = p_key::uuid and center_id = p_center;
  end if;
  perform set_config('app.account_map_apply', '', true);
  if p_subject = 'fund_class' and p_mode = 'setup' then
    -- As app.set_qbo_fund_class: a class chosen during setup asks for the mapping to be approved (again).
    update app.integration_connections
       set settings = settings - 'mapping_approved_by' - 'mapping_approved_at' - 'test_post_approved_by' - 'test_post_approved_at'
     where center_id = p_center and provider in ('quickbooks_online','intuit_sandbox') and settings ? 'mapping_approved_at';
    perform set_config('app.qbo_mapping_approval', 'on', true);
    update app.qbo_account_mappings set approved_by = null, approved_at = null where center_id = p_center and approved_at is not null;
    perform set_config('app.qbo_mapping_approval', '', true);
  end if;
end $$;

-- Internal: postings that failed waiting for this mapping go back in the queue (they are built again from it).
create or replace function app._requeue_waiting_postings(p_center uuid, p_subject text, p_key text) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_n integer;
begin
  update app.ledger_postings
     set status = 'queued', needs_mapping = null, last_error = null, qbo_doc = null, qbo_realm = null
   where center_id = p_center and status = 'failed' and needs_mapping = p_subject || ':' || p_key;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Choose, or ask to change, the account of a role (p_subject 'role', p_target = the role key or an alias), the class of
-- a fund ('fund_class', p_target = the fund's id; p_to null = no class) or the QuickBooks account of a bank account
-- ('bank_account', p_target = its id; p_to null = use the main bank account). Before the mapping is in use the choice
-- is saved at once (one person, as before: {status 'applied', mode 'setup'}); once it is in use it waits for a second
-- person ({status 'pending', mode 'request'}).
create or replace function app.request_account_mapping_change(p_center uuid, p_subject text, p_target text, p_to text, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; r app.account_roles; m app.qbo_account_mappings; f app.funds; b app.bank_accounts;
        a app.qbo_accounts; k app.qbo_classes; v_key text; v_label text; v_from text; v_from_name text; v_from_realm text;
        v_to text := nullif(btrim(coalesce(p_to, '')), ''); v_to_name text; v_to_type text; v_types text[]; v_what text;
        v_id uuid; v_expires timestamptz; v_requeued int;
        v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not app.account_map_can_request(p_center) then
    raise exception 'Choosing or changing the QuickBooks accounts needs the organization owner or accounting.manage (the treasurer).' using errcode = '42501';
  end if;
  if p_subject is null or p_subject not in ('role','fund_class','bank_account') then
    raise exception 'Say what to change: the account of a fund or role, the class of a fund, or the QuickBooks account of a bank account.' using errcode = '22023';
  end if;
  select * into c from app.qbo_connection(p_center);
  if c.id is null or c.status = 'disconnected' then
    raise exception 'Connect QuickBooks first: accounts and classes are chosen from the company''s own lists.' using errcode = '22023';
  end if;
  if coalesce(c.settings->>'basis', '') not in ('cash','accrual') then
    raise exception 'Choose the accounting basis (cash or accrual) first: it decides which accounts the mapping needs.' using errcode = '22023';
  end if;

  -- What is changed, and what it is now.
  if p_subject = 'role' then
    v_key := app.account_role_key(p_target);
    if v_key is null then raise exception 'Weaver does not know the account role "%".', coalesce(p_target, '') using errcode = '22023'; end if;
    select * into r from app.account_roles where key = v_key;
    v_label := r.label; v_what := 'the account for ' || r.label; v_types := r.account_types;
    if v_to is null then raise exception 'Choose the QuickBooks account for %.', r.label using errcode = '22023'; end if;
    select * into m from app.qbo_account_mappings where center_id = p_center and purpose = v_key;
    v_from := m.qbo_account_id; v_from_name := m.qbo_account_name; v_from_realm := m.realm_id;
  elsif p_subject = 'fund_class' then
    if coalesce(p_target, '') !~ v_uuid then raise exception 'That fund was not found.' using errcode = '22023'; end if;
    select * into f from app.funds where id = p_target::uuid and center_id = p_center;
    if f.id is null then raise exception 'That fund was not found in this organization.' using errcode = '22023'; end if;
    v_key := f.id::text; v_label := 'Class of the fund "' || f.name || '"'; v_what := 'the class of the fund "' || f.name || '"';
    v_from := f.qbo_class_id; v_from_realm := f.qbo_class_realm;
    select k2.name into v_from_name from app.qbo_classes k2 where k2.connection_id = c.id and k2.qbo_id = f.qbo_class_id;
  else
    if coalesce(p_target, '') !~ v_uuid then raise exception 'That bank account was not found.' using errcode = '22023'; end if;
    select * into b from app.bank_accounts where id = p_target::uuid and center_id = p_center;
    if b.id is null or not b.active then
      raise exception 'Choose one of this organization''s active bank accounts.' using errcode = '22023';
    end if;
    v_key := b.id::text; v_label := 'Bank account "' || b.name || coalesce(' ····' || b.last4, '') || '"';
    v_what := 'the QuickBooks account of the bank account "' || b.name || '"';
    v_from := b.qbo_account_id; v_from_realm := b.qbo_account_realm;
    select a2.name into v_from_name from app.qbo_accounts a2 where a2.connection_id = c.id and a2.qbo_id = b.qbo_account_id;
    select ro.account_types into v_types from app.account_roles ro where ro.key = 'bank';
  end if;
  if v_from is not null and v_from_realm is distinct from c.external_account_id then
    v_from_name := coalesce(v_from_name, 'id ' || v_from) || ' (another QuickBooks company)';
  end if;

  -- The new value must be usable, so the second person is never asked to confirm something broken.
  if v_to is not null then
    if p_subject = 'fund_class' then
      select * into k from app.qbo_classes where connection_id = c.id and qbo_id = v_to;
      if k.qbo_id is null then
        raise exception 'Choose the class from the classes pulled from QuickBooks (class "%" is not in them). Pull the lists first if they are empty.', v_to using errcode = '22023';
      end if;
      if not k.active then raise exception 'The class "%" is inactive in QuickBooks.', k.name using errcode = '22023'; end if;
      v_to_name := k.name;
    else
      select * into a from app.qbo_accounts where connection_id = c.id and qbo_id = v_to;
      if a.qbo_id is null then
        raise exception 'Choose the account from the chart of accounts pulled from QuickBooks (account "%" is not in it). Pull the lists first if the chart is empty.', v_to using errcode = '22023';
      end if;
      if not a.active then
        raise exception '"%" is inactive in QuickBooks, so nothing can post to it. Choose an active account.', a.name using errcode = '22023';
      end if;
      if a.account_type is not null and not (a.account_type = any (v_types)) then
        raise exception '"%" is a % account; % needs one of: %.', a.name, a.account_type, v_what, array_to_string(v_types, ', ') using errcode = '22023';
      end if;
      if p_subject = 'role' and r.needs_item and app._qbo_item_for(c.id, v_to) is null then
        raise exception 'No QuickBooks item posts to "%", so money cannot be recorded against it. In QuickBooks, create a Service item that uses that account, pull the lists again, then choose it.', a.name
          using errcode = '22023';
      end if;
      v_to_name := a.name; v_to_type := a.account_type;
    end if;
  end if;
  if v_to is not distinct from v_from and (v_from is null or v_from_realm is not distinct from c.external_account_id) then
    raise exception 'Nothing to change: % is already %.', v_what,
      case when v_to is null then 'empty' else '"' || coalesce(v_to_name, v_to) || '"' end using errcode = '22023';
  end if;

  if not app.account_mapping_in_use(p_center) then
    -- Setup: the mapping has never been approved, so nothing posts with it yet. Saved at once, recorded for the history.
    perform app.payments_require_reason(p_reason, 'choose ' || v_what);
    perform app._apply_account_mapping(p_center, p_subject, v_key, v_to, 'setup');
    v_requeued := app._requeue_waiting_postings(p_center, p_subject, v_key);
    insert into app.account_mapping_changes (center_id, subject, target_key, target_label, connection_id, realm_id, from_ref, from_name,
                                             to_ref, to_name, to_type, mode, status, requested_by, request_reason, applied_at, requeued_postings)
    values (p_center, p_subject, v_key, v_label, c.id, c.external_account_id, v_from, v_from_name, v_to, v_to_name, v_to_type,
            'setup', 'applied', auth.uid(), left(btrim(p_reason), 500), now(), v_requeued)
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'status', 'applied', 'mode', 'setup', 'to_name', v_to_name,
      'message', 'Saved. The treasurer approves the whole mapping before anything posts with it.');
  end if;

  perform app.assert_step_up('accounting.mapping');
  perform app.payments_require_reason(p_reason, 'ask to change ' || v_what);
  -- A newer request for the same thing replaces a waiting one; a lapsed one is marked lapsed.
  update app.account_mapping_changes x
     set status = case when x.expires_at <= now() then 'expired' else 'superseded' end
   where x.center_id = p_center and x.subject = p_subject and x.target_key = v_key and x.status = 'pending';
  insert into app.account_mapping_changes (center_id, subject, target_key, target_label, connection_id, realm_id, from_ref, from_name,
                                           to_ref, to_name, to_type, mode, status, requested_by, request_reason, expires_at)
  values (p_center, p_subject, v_key, v_label, c.id, c.external_account_id, v_from, v_from_name, v_to, v_to_name, v_to_type,
          'request', 'pending', auth.uid(), left(btrim(p_reason), 500), now() + interval '14 days')
  returning id, expires_at into v_id, v_expires;
  return jsonb_build_object('id', v_id, 'status', 'pending', 'mode', 'request', 'expires_at', v_expires, 'to_name', v_to_name,
    'message', 'Waiting for a second person. A different person with giving.approve confirms it; until then postings keep using the current account.');
end $$;

create or replace function app._account_mapping_status_label(p_status text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p_status when 'applied' then 'confirmed' when 'rejected' then 'turned down' when 'cancelled' then 'withdrawn'
                       when 'superseded' then 'replaced by a newer request' when 'expired' then 'out of date' else p_status end
$$;

-- The second person confirms (it takes effect for postings sent from now on) or turns it down. Never the person who asked.
create or replace function app.decide_account_mapping_change(p_request uuid, p_approve boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare x app.account_mapping_changes; c app.integration_connections; r app.account_roles; a app.qbo_accounts; k app.qbo_classes;
        v_cur text; v_types text[]; v_requeued int; v_queued int; v_ok boolean;
begin
  select * into x from app.account_mapping_changes where id = p_request for update;
  if x.id is null then raise exception 'That request was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(x.center_id, 'accounting');
  if not app.account_map_can_approve(x.center_id) then
    raise exception 'Confirming a change to the QuickBooks accounts needs giving.approve (the treasurer), and a different person from the one who asked.' using errcode = '42501';
  end if;
  if x.status <> 'pending' then
    raise exception 'This request is already %.', app._account_mapping_status_label(x.status) using errcode = '22023';
  end if;
  if x.requested_by = auth.uid() then
    raise exception 'The second approver must be a different person from the first (%).', app.refund_person_name(x.center_id, x.requested_by)
      using errcode = '22023';
  end if;
  if x.expires_at <= now() then
    raise exception 'This request lapsed on %. Ask for the change again.', to_char(x.expires_at, 'FMMonth FMDD, YYYY') using errcode = '22023';
  end if;
  if p_approve and not app.payee_user_has_permission(x.center_id, x.requested_by, 'accounting.manage') then
    raise exception 'The person who asked (%) no longer holds a role that may ask for this. Ask for the change again.', app.refund_person_name(x.center_id, x.requested_by)
      using errcode = '22023';
  end if;
  perform app.assert_step_up('accounting.mapping');
  perform app.payments_require_reason(p_reason, case when p_approve then 'confirm this change' else 'turn this change down' end);

  if not p_approve then
    update app.account_mapping_changes
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = left(btrim(p_reason), 500)
     where id = x.id;
    return jsonb_build_object('id', x.id, 'status', 'rejected');
  end if;

  -- What it was asked against must still hold: the same QuickBooks company, the same current value, a usable new value.
  select * into c from app.qbo_connection(x.center_id);
  if c.id is null or c.status = 'disconnected' or c.external_account_id is distinct from x.realm_id then
    raise exception 'The QuickBooks company changed, or was disconnected, after this request was made. Ask for the change again.' using errcode = '22023';
  end if;
  if x.subject = 'role' then
    select * into r from app.account_roles where key = x.target_key;
    v_types := r.account_types;
    select m.qbo_account_id into v_cur from app.qbo_account_mappings m where m.center_id = x.center_id and m.purpose = x.target_key for update;
  elsif x.subject = 'fund_class' then
    select f.qbo_class_id into v_cur from app.funds f where f.id = x.target_key::uuid and f.center_id = x.center_id for update;
    if not found then raise exception 'The fund no longer exists. Nothing was changed.' using errcode = '22023'; end if;
  else
    select b.qbo_account_id into v_cur from app.bank_accounts b where b.id = x.target_key::uuid and b.center_id = x.center_id and b.active for update;
    if not found then raise exception 'The bank account is no longer an active account of this organization. Nothing was changed.' using errcode = '22023'; end if;
    select ro.account_types into v_types from app.account_roles ro where ro.key = 'bank';
  end if;
  if v_cur is distinct from x.from_ref then
    raise exception 'The current value of % changed after this request was made. Ask for the change again.', x.target_label using errcode = '22023';
  end if;
  if x.to_ref is not null then
    if x.subject = 'fund_class' then
      select * into k from app.qbo_classes where connection_id = c.id and qbo_id = x.to_ref;
      if k.qbo_id is null or not k.active then
        raise exception 'The class "%" is no longer an active class in QuickBooks. Ask for the change again.', coalesce(x.to_name, x.to_ref) using errcode = '22023';
      end if;
    else
      select * into a from app.qbo_accounts where connection_id = c.id and qbo_id = x.to_ref;
      v_ok := a.qbo_id is not null and a.active and (a.account_type is null or a.account_type = any (v_types))
              and (x.subject <> 'role' or not r.needs_item or app._qbo_item_for(c.id, x.to_ref) is not null);
      if not v_ok then
        raise exception '"%" can no longer be used for % (it is gone, inactive, of another type, or no QuickBooks item posts to it). Ask for the change again.',
          coalesce(x.to_name, x.to_ref), x.target_label using errcode = '22023';
      end if;
    end if;
  end if;

  perform app.set_audit_context('Account mapping change confirmed by a second person: ' || left(btrim(p_reason), 440));
  perform app._apply_account_mapping(x.center_id, x.subject, x.target_key, x.to_ref, 'confirmed');
  v_requeued := app._requeue_waiting_postings(x.center_id, x.subject, x.target_key);
  select count(*) into v_queued from app.ledger_postings where center_id = x.center_id and status = 'queued';
  update app.account_mapping_changes
     set status = 'applied', decided_by = auth.uid(), decided_at = now(), decision_reason = left(btrim(p_reason), 500), applied_at = now(),
         requeued_postings = v_requeued, queued_postings = v_queued
   where id = x.id;
  return jsonb_build_object('id', x.id, 'status', 'applied', 'requeued', v_requeued, 'queued', v_queued);
end $$;

-- Withdraw a request that is still waiting: the person who asked, or anyone who may ask or confirm.
create or replace function app.cancel_account_mapping_change(p_request uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare x app.account_mapping_changes;
begin
  select * into x from app.account_mapping_changes where id = p_request for update;
  if x.id is null then raise exception 'That request was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(x.center_id, 'accounting');
  if not (app.account_map_can_request(x.center_id) or app.account_map_can_approve(x.center_id)
          or (x.requested_by = auth.uid() and app.qbo_can_view(x.center_id))) then
    raise exception 'Withdrawing a request to change the QuickBooks accounts needs the owner, accounting.manage or giving.approve.' using errcode = '42501';
  end if;
  if x.status <> 'pending' then
    raise exception 'This request is already %, so it cannot be withdrawn.', app._account_mapping_status_label(x.status) using errcode = '22023';
  end if;
  perform app.payments_require_reason(p_reason, 'withdraw this request');
  update app.account_mapping_changes
     set status = 'cancelled', cancelled_by = auth.uid(), decided_at = now(), decision_reason = left(btrim(p_reason), 500)
   where id = x.id;
  return jsonb_build_object('id', x.id, 'status', 'cancelled');
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- What the screens show
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function app._account_mapping_request_json(x app.account_mapping_changes) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'id', x.id, 'subject', x.subject, 'target_key', x.target_key, 'target_label', x.target_label,
    'from_ref', x.from_ref, 'from_name', x.from_name, 'to_ref', x.to_ref, 'to_name', x.to_name, 'to_type', x.to_type,
    'mode', x.mode, 'status', x.status, 'expired', (x.status = 'pending' and x.expires_at <= now()),
    'requested_by', x.requested_by, 'requested_by_name', app.refund_person_name(x.center_id, x.requested_by),
    'requested_at', x.requested_at, 'request_reason', x.request_reason, 'expires_at', x.expires_at,
    'decided_by_name', case when x.decided_by is not null then app.refund_person_name(x.center_id, x.decided_by) end,
    'cancelled_by_name', case when x.cancelled_by is not null then app.refund_person_name(x.center_id, x.cancelled_by) end,
    'decided_at', x.decided_at, 'decision_reason', x.decision_reason, 'applied_at', x.applied_at,
    'queued_postings', x.queued_postings, 'requeued_postings', x.requeued_postings,
    'mine', (x.requested_by = auth.uid()))
$$;

-- Accounting › Account mapping: what each fund, role and bank account posts to now, what waits for a second person,
-- and the history (setup choices and requests, newest first).
create or replace function app.account_mapping_overview(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_used jsonb; v_waiting jsonb; v_required text[]; v_name text;
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not (app.qbo_can_view(p_center) or app.account_map_can_approve(p_center)) then
    raise exception 'Seeing the account mapping needs accounting.manage, giving.view, giving.approve or integrations.view.' using errcode = '42501';
  end if;
  select * into c from app.qbo_connection(p_center);
  v_required := app.qbo_required_purposes(p_center);
  -- Which funds are in use: open pledges and published campaigns, by the fund their money belongs to.
  select coalesce(jsonb_object_agg(u.k, u.n), '{}'::jsonb) into v_used
    from (select k, sum(n)::int as n
            from (select app.pledge_fund_key(p.source::text, cp.kind) as k, count(*) as n
                    from app.pledges p left join app.campaigns cp on cp.id = p.campaign_id
                   where p.center_id = p_center and p.status in ('open','partially_paid')
                   group by 1
                  union all
                  select cp.kind, count(*) from app.campaigns cp where cp.center_id = p_center and cp.status = 'published' group by 1) s
           group by k) u;
  -- Postings waiting in the exception queue for a mapping.
  select coalesce(jsonb_object_agg(w.needs_mapping, w.n), '{}'::jsonb) into v_waiting
    from (select l.needs_mapping, count(*)::int as n from app.ledger_postings l
           where l.center_id = p_center and l.status = 'failed' and l.needs_mapping is not null group by 1) w;
  if c.settings ? 'mapping_approved_by' then
    v_name := app.refund_person_name(p_center, (c.settings->>'mapping_approved_by')::uuid);
  end if;
  return jsonb_build_object(
    'in_use', app.account_mapping_in_use(p_center),
    'can_request', app.account_map_can_request(p_center),
    'can_approve', app.account_map_can_approve(p_center),
    'connection', case when c.id is null then null else jsonb_build_object(
      'id', c.id, 'provider', c.provider, 'status', c.status, 'realm_id', c.external_account_id, 'display_name', c.display_name,
      'read_only', coalesce((c.settings->>'read_only')::boolean, false), 'basis', c.settings->>'basis') end,
    'mapping_approved_at', c.settings->>'mapping_approved_at', 'mapping_approved_by_name', v_name,
    'roles', coalesce((
      select jsonb_agg(app._account_for_role(p_center, r.key)
                       || jsonb_build_object('hint', r.hint, 'account_types', to_jsonb(r.account_types), 'needs_item', r.needs_item,
                                             'required', r.key = any (v_required), 'sort', r.sort,
                                             'used', case when r.kind = 'fund' then coalesce((v_used->>substr(r.key, 8))::int, 0) end,
                                             'waiting_postings', coalesce((v_waiting->>('role:' || r.key))::int, 0))
                       order by r.sort, r.key)
        from app.account_roles r where r.active), '[]'::jsonb),
    'funds', coalesce((
      select jsonb_agg(app._fund_class_state(p_center, f.id)
                       || jsonb_build_object('id', f.id, 'key', f.key, 'name', f.name, 'restricted', f.restricted,
                                             'waiting_postings', coalesce((v_waiting->>('fund_class:' || f.id))::int, 0))
                       order by f.name)
        from app.funds f where f.center_id = p_center and (f.active or f.qbo_class_id is not null)), '[]'::jsonb),
    'bank_accounts', coalesce((
      select jsonb_agg(app._bank_account_state(p_center, b.id)
                       || jsonb_build_object('id', b.id, 'name', b.name, 'last4', b.last4,
                                             'waiting_postings', coalesce((v_waiting->>('bank_account:' || b.id))::int, 0))
                       order by b.name)
        from app.bank_accounts b where b.center_id = p_center and b.active), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(q.j order by q.ord, q.requested_at desc)
        from (select case when x.status = 'pending' then 0 else 1 end as ord, x.requested_at, app._account_mapping_request_json(x) as j
                from app.account_mapping_changes x
               where x.center_id = p_center
               order by case when x.status = 'pending' then 0 else 1 end, x.requested_at desc
               limit 200) q), '[]'::jsonb));
end $$;

-- Home: the changes waiting for a second person (the Home task of giving.approve holders).
create or replace function app.account_mapping_waiting(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not (app.qbo_can_view(p_center) or app.account_map_can_approve(p_center)) then
    raise exception 'Seeing the account mapping needs accounting.manage, giving.view, giving.approve or integrations.view.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_approve', app.account_map_can_approve(p_center),
    'requests', coalesce((
      select jsonb_agg(app._account_mapping_request_json(x) order by x.requested_at)
        from app.account_mapping_changes x
       where x.center_id = p_center and x.status = 'pending' and x.expires_at > now()), '[]'::jsonb));
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Warnings: 0231's, plus the company of each choice, the account type, bank accounts and restricted funds
-- ═════════════════════════════════════════════════════════════════════════════
-- [{level, purpose|fund_id|bank_account_id, text}]. 'error' blocks approving the mapping and all posting (as before);
-- 'warning' does not. The 0231 entries come first, with the same words.
create or replace function app.qbo_mapping_warnings(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v jsonb := '[]'; r record; s jsonb;
begin
  select * into c from app.qbo_connection(p_center);
  if c.id is null or not exists (select 1 from app.qbo_pull_runs where connection_id = c.id and status = 'succeeded') then
    return v;
  end if;
  for r in
    select m.purpose, m.qbo_account_id, m.qbo_account_name, m.realm_id, a.name, a.active, a.account_type, a.qbo_id is not null as found,
           ro.label, ro.account_types
      from app.qbo_account_mappings m
      left join app.qbo_accounts a on a.connection_id = c.id and a.qbo_id = m.qbo_account_id
      left join app.account_roles ro on ro.key = m.purpose
     where m.center_id = p_center
     order by m.purpose
  loop
    if r.realm_id is distinct from c.external_account_id then
      v := v || jsonb_build_array(jsonb_build_object('level', 'error', 'purpose', r.purpose,
        'text', format('The account mapped for %s (%s) was chosen in another QuickBooks company. Choose an account of the company connected now (Accounting › Account mapping).',
                       coalesce(r.label, r.purpose), coalesce(r.qbo_account_name, 'id ' || r.qbo_account_id))));
    elsif not r.found then
      v := v || jsonb_build_array(jsonb_build_object('level', 'error', 'purpose', r.purpose,
        'text', format('The account mapped for %s (%s) is no longer in QuickBooks. Choose another account.', r.purpose, coalesce(r.qbo_account_name, 'id ' || r.qbo_account_id))));
    elsif not r.active then
      v := v || jsonb_build_array(jsonb_build_object('level', 'error', 'purpose', r.purpose,
        'text', format('"%s", mapped for %s, is inactive in QuickBooks. Make it active there or choose another account.', r.name, r.purpose)));
    elsif r.account_types is not null and r.account_type is not null and not (r.account_type = any (r.account_types)) then
      v := v || jsonb_build_array(jsonb_build_object('level', 'error', 'purpose', r.purpose,
        'text', format('"%s", mapped for %s, is a %s account in QuickBooks now; %s needs one of: %s.', r.name, coalesce(r.label, r.purpose), r.account_type,
                       coalesce(r.label, r.purpose), array_to_string(r.account_types, ', '))));
    elsif r.qbo_account_name is distinct from r.name then
      v := v || jsonb_build_array(jsonb_build_object('level', 'warning', 'purpose', r.purpose,
        'text', format('The account mapped for %s was renamed in QuickBooks from "%s" to "%s". Check it is still right, then approve the mapping again.',
                       r.purpose, coalesce(r.qbo_account_name, '?'), r.name)));
    end if;
  end loop;
  -- A fund's class (0231 checked it was found and active; now also its company).
  for r in select f.id from app.funds f where f.center_id = p_center and f.active and f.qbo_class_id is not null order by f.name loop
    s := app._fund_class_state(p_center, r.id);
    if s->>'problem' is not null then
      v := v || jsonb_build_array(jsonb_build_object('level', 'error', 'fund_id', r.id, 'text', s->>'problem'));
    end if;
  end loop;
  -- A restricted fund with no class: its money is not kept apart by class (a warning; owner question 2 of the gaps doc).
  for r in select f.id, f.name from app.funds f where f.center_id = p_center and f.active and f.restricted and f.qbo_class_id is null order by f.name loop
    v := v || jsonb_build_array(jsonb_build_object('level', 'warning', 'fund_id', r.id,
      'text', format('The restricted fund "%s" has no QuickBooks class, so its money is not kept apart by class in QuickBooks. Choose its class in Accounting › Account mapping.', r.name)));
  end loop;
  -- Bank accounts: a QuickBooks account of their own that cannot be used is an error; none, with several bank accounts, a warning.
  for r in select b.id, b.qbo_account_id from app.bank_accounts b where b.center_id = p_center and b.active order by b.name loop
    s := app._bank_account_state(p_center, r.id);
    if s->>'problem' is not null then
      v := v || jsonb_build_array(jsonb_build_object('level', case when r.qbo_account_id is null then 'warning' else 'error' end,
                                                     'bank_account_id', r.id, 'text', s->>'problem'));
    end if;
  end loop;
  return v;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Posting: every account through the resolvers, no silent defaults
-- ═════════════════════════════════════════════════════════════════════════════
-- 0233's income lines of a payment: allocations grouped by income account + class; the unallocated rest is a general
-- donation (the General fund's own account and class, by rule). The account of an allocation is its fund's: the
-- campaign's kind, else the pledge's source (app.pledge_fund_key). A campaign's own income account is no longer used.
create or replace function app._qbo_payment_lines(p_connection uuid, p_payment app.payments, p_amount bigint)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb := '[]'; r record; v_alloc bigint; v_general uuid;
begin
  select id into v_general from app.funds where center_id = p_payment.center_id and key = 'general';
  -- A partial refund posts to general income (its split across funds is a person's call).
  if p_amount <> p_payment.amount_cents then
    return jsonb_build_array(app._qbo_sales_line(p_connection, app.account_for_fund(p_payment.center_id, 'general'),
                                                 app.class_for_fund(p_payment.center_id, v_general), p_amount, 'Refund'));
  end if;
  select coalesce(sum(amount_cents), 0) into v_alloc from app.payment_allocations where payment_id = p_payment.id;
  for r in
    with lines as (
      select a.amount_cents,
             app.account_for_fund(p_payment.center_id, app.pledge_fund_key(pl.source::text, cp.kind)) as account,
             app.class_for_fund(p_payment.center_id, coalesce(pl.fund_id, cp.fund_id)) as class_id,
             coalesce(cp.name, f.name, 'Gift') as what
        from app.payment_allocations a
        join app.pledges pl on pl.id = a.pledge_id
        left join app.campaigns cp on cp.id = pl.campaign_id
        left join app.funds f on f.id = coalesce(pl.fund_id, cp.fund_id)
       where a.payment_id = p_payment.id
      union all
      select p_payment.amount_cents - v_alloc, app.account_for_fund(p_payment.center_id, 'general'),
             app.class_for_fund(p_payment.center_id, v_general), 'Donation'
       where p_payment.amount_cents - v_alloc > 0)
    select account, class_id, sum(amount_cents)::bigint as amount, string_agg(distinct what, ', ') as what
      from lines group by account, class_id order by 3 desc
  loop
    v := v || jsonb_build_array(app._qbo_sales_line(p_connection, r.account, r.class_id, r.amount, r.what));
  end loop;
  return v;
end $$;

-- 0233's document for one posting (0412 renamed it; app.qbo_posting_doc still adds write-offs on top). The same
-- documents, with every account from the resolvers: a missing one is {ok: false, error: <plain reason>,
-- needs_mapping: '<subject>:<key>'}, never a default. Changes: gift packing has its own account (no fallback to store
-- sales); a deposit, and a Zelle/ACH line recorded from the bank, land in their bank account's own QuickBooks account
-- (the main bank account only when there is one bank account).
create or replace function app._qbo_posting_doc_before_0412(p_posting uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare lp app.ledger_postings; c app.integration_connections; p app.payments; t app.bank_transactions; o app.store_orders;
        v_doc jsonb; v_dep text; v_cust jsonb; v_problem text; v_lines jsonb := '[]'; v_bank_account uuid;
        v_msg text; v_detail text;
begin
  select * into lp from app.ledger_postings where id = p_posting;
  if lp.id is null then return jsonb_build_object('ok', false, 'error', 'The posting was not found.'); end if;
  select * into c from app.qbo_connection(lp.center_id);

  if lp.source_table = 'payments' and lp.txn_type in ('donation_card','recurring_charge','boli_payment','membership_fee','offline_receipt',
                                                       'bank_receipt','stock_gift','refund') then
    select * into p from app.payments where id = lp.source_id;
    if p.id is null then return jsonb_build_object('ok', false, 'error', 'The payment behind this posting was not found.'); end if;
    if p.provider = 'bank' then
      select bt.bank_account_id into v_bank_account from app.bank_transactions bt where bt.payment_id = p.id order by bt.posted_on desc limit 1;
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
    v_doc := jsonb_build_object('entity', 'Deposit', 'txn_date', to_char(t.posted_on, 'YYYY-MM-DD'), 'doc_number', null,
      'private_note', 'Community Connect deposit · ' || left(coalesce(t.description, ''), 60) || ' · posting ' || lp.id,
      'customer_ref', null, 'customer_status', 'none',
      'deposit_account', app.account_for_bank_account(lp.center_id, t.bank_account_id),
      'lines', jsonb_build_array(jsonb_build_object('amount_cents', lp.amount_cents, 'account_id', app.account_for_role(lp.center_id, 'undeposited_funds'),
                                                    'description', 'Checks and cash deposited')));
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

-- 0235's poster, with three changes: (1) the document a posting is sent with is kept on it (qbo_doc, qbo_realm), so an
-- entry already posted keeps its accounts whatever the mapping becomes; (2) an entry sent before whose answer was lost
-- (its worker vanished, or QuickBooks asked to try again) is sent again exactly as it was, under the same requestid;
-- (3) a posting that waits for a mapping says which (needs_mapping), so confirming it puts the posting back.
create or replace function app.qbo_worker_claim(p_center uuid, p_limit int default 25) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_ready jsonb; v_go date; lp app.ledger_postings; v_doc jsonb; v_units jsonb := '[]'; v_skipped int := 0; v_failed int := 0;
        v_summary boolean; v_day date; p app.payments; g record; v_ids uuid[]; v_lines jsonb; v_first jsonb; v_uid text;
        v_groups jsonb := '{}'; v_key text; v_period text; v_realm text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Background service: QuickBooks poster');
  -- Postings whose worker vanished go back to the queue (same requestid, same document).
  update app.ledger_postings set status = 'queued', claimed_at = null
   where center_id = p_center and status = 'posting' and claimed_at < now() - interval '15 minutes';

  v_ready := app.qbo_post_ready(p_center);
  if not (v_ready->>'ok')::boolean then
    return jsonb_build_object('ready', false, 'reason', v_ready->>'reason', 'units', '[]'::jsonb);
  end if;
  v_go := app.qbo_go_live_date(p_center);
  v_summary := v_ready->>'posting' = 'daily_summary';
  select ic.external_account_id into v_realm from app.integration_connections ic where ic.id = (v_ready->>'connection_id')::uuid;

  for lp in
    select * from app.ledger_postings
     where center_id = p_center and status = 'queued'
     order by created_at, id
     limit least(greatest(coalesce(p_limit, 25), 1), 200)
     for update skip locked
  loop
    -- Money history and anything before go-live never post.
    if lp.source_table = 'payments' then
      select * into p from app.payments where id = lp.source_id;
      if p.is_historical then
        update app.ledger_postings set status = 'skipped', last_error = 'Historical payment: it is already in QuickBooks, so it never posts.'
         where id = lp.id;
        v_skipped := v_skipped + 1; continue;
      end if;
    end if;
    v_day := app._qbo_posting_date(lp);
    if v_day < v_go then
      update app.ledger_postings
         set status = 'skipped', last_error = 'Dated ' || to_char(v_day, 'FMMonth FMDD, YYYY') || ', before the QuickBooks go-live date (' || to_char(v_go, 'FMMonth FMDD, YYYY') || ').'
       where id = lp.id;
      v_skipped := v_skipped + 1; continue;
    end if;
    select status into v_period from app.accounting_periods where center_id = p_center and period_month = lp.period_month;
    if v_period = 'closed' then
      update app.ledger_postings
         set status = 'failed', attempts = attempts + 1, needs_mapping = null,
             last_error = to_char(lp.period_month, 'FMMonth YYYY') || ' is closed in Community Connect (month-end close), so this was not posted. A person decides whether to post it as an adjustment in an open month.'
       where id = lp.id;
      v_failed := v_failed + 1; continue;
    end if;

    if lp.qbo_doc is not null and lp.qbo_realm is not distinct from v_realm then
      v_doc := jsonb_build_object('ok', true, 'doc', lp.qbo_doc);
    else
      v_doc := app.qbo_posting_doc(lp.id);
    end if;
    if not (v_doc->>'ok')::boolean then
      update app.ledger_postings
         set status = 'failed', attempts = attempts + 1, last_error = left(v_doc->>'error', 1000),
             needs_mapping = v_doc->>'needs_mapping', qbo_doc = null, qbo_realm = null
       where id = lp.id;
      v_failed := v_failed + 1; continue;
    end if;

    if v_summary and lp.source_table = 'payments' and v_doc #>> '{doc,entity}' = 'SalesReceipt' and v_day < current_date then
      -- Daily summary: one receipt per day and deposit account, no customer.
      v_key := to_char(v_day, 'YYYY-MM-DD') || '|' || (v_doc #>> '{doc,deposit_account}');
      v_groups := jsonb_set(v_groups, array[v_key], coalesce(v_groups->v_key, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('id', lp.id, 'doc', v_doc->'doc')));
      continue;
    elsif v_summary and lp.source_table = 'payments' and v_doc #>> '{doc,entity}' = 'SalesReceipt' then
      continue;   -- today's receipts wait for tomorrow's summary
    end if;

    update app.ledger_postings
       set status = 'posting', attempts = attempts + 1, claimed_at = now(), request_id = lp.id::text,
           qbo_entity = v_doc #>> '{doc,entity}', qbo_doc = v_doc->'doc', qbo_realm = v_realm, needs_mapping = null
     where id = lp.id;
    v_units := v_units || jsonb_build_array(jsonb_build_object('unit_id', lp.id::text, 'posting_ids', jsonb_build_array(lp.id),
                                                               'doc', v_doc->'doc'));
  end loop;

  for g in select key, value from jsonb_each(v_groups) order by key loop
    select array_agg((x->>'id')::uuid order by x->>'id') into v_ids from jsonb_array_elements(g.value) x;
    select jsonb_agg(jsonb_build_object('amount_cents', s.amount, 'description', s.what, 'item_id', s.item_id,
                                        'account_id', s.account_id, 'class_id', s.class_id) order by s.amount desc)
      into v_lines
      from (select l->>'item_id' as item_id, l->>'account_id' as account_id, l->>'class_id' as class_id,
                   sum((l->>'amount_cents')::bigint) as amount, string_agg(distinct l->>'description', ', ') as what
              from jsonb_array_elements(g.value) x, jsonb_array_elements(x->'doc'->'lines') l
             group by 1, 2, 3) s;
    v_first := g.value->0->'doc';
    v_uid := encode(extensions.digest(array_to_string(v_ids, ','), 'sha256'), 'hex');
    update app.ledger_postings l
       set status = 'posting', attempts = attempts + 1, claimed_at = now(), request_id = v_uid, qbo_entity = 'SalesReceipt',
           qbo_doc = x.doc, qbo_realm = v_realm, needs_mapping = null
      from (select (e->>'id')::uuid as id, e->'doc' as doc from jsonb_array_elements(g.value) e) x
     where l.id = x.id;
    v_units := v_units || jsonb_build_array(jsonb_build_object(
      'unit_id', v_uid, 'posting_ids', to_jsonb(v_ids),
      'doc', jsonb_build_object('entity', 'SalesReceipt', 'txn_date', split_part(g.key, '|', 1),
                                'doc_number', left('CC-' || replace(split_part(g.key, '|', 1), '-', ''), 21),
                                'private_note', 'Community Connect daily summary · ' || cardinality(v_ids) || ' receipts',
                                'customer_ref', null, 'customer_status', 'summary', 'deposit_account', v_first->>'deposit_account',
                                'lines', v_lines)));
  end loop;

  return jsonb_build_object('ready', true, 'realm_connection', v_ready->>'connection_id', 'units', v_units,
                            'skipped', v_skipped, 'failed', v_failed);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Grants
-- ═════════════════════════════════════════════════════════════════════════════
revoke execute on function app.account_map_can_request(uuid), app.account_map_can_approve(uuid), app.account_mapping_in_use(uuid),
  app.account_role_key(text), app._qbo_realm(uuid), app._account_for_role(uuid, text), app.account_for_role(uuid, text),
  app.account_for_fund(uuid, text), app.pledge_fund_key(text, text), app._fund_class_state(uuid, uuid), app.class_for_fund(uuid, uuid),
  app._bank_account_state(uuid, uuid), app.account_for_bank_account(uuid, uuid),
  app.qbo_account_mappings_delete_guard(), app.funds_qbo_class_guard(), app.bank_accounts_qbo_guard(), app.ledger_postings_api_guard(),
  app.qbo_connection_api_guard(), app.qbo_company_switched(), app._apply_account_mapping(uuid, text, text, text, text), app._requeue_waiting_postings(uuid, text, text),
  app.request_account_mapping_change(uuid, text, text, text, text), app._account_mapping_status_label(text),
  app.decide_account_mapping_change(uuid, boolean, text), app.cancel_account_mapping_change(uuid, text),
  app._account_mapping_request_json(app.account_mapping_changes), app.account_mapping_overview(uuid), app.account_mapping_waiting(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function app.qbo_purposes(), app.qbo_required_purposes(uuid) from public, anon;
grant execute on function app.qbo_purposes(), app.qbo_required_purposes(uuid) to authenticated, service_role;
grant execute on function app.account_map_can_request(uuid), app.account_map_can_approve(uuid), app.account_mapping_in_use(uuid),
  app.request_account_mapping_change(uuid, text, text, text, text), app.decide_account_mapping_change(uuid, boolean, text),
  app.cancel_account_mapping_change(uuid, text), app.account_mapping_overview(uuid), app.account_mapping_waiting(uuid)
  to authenticated, service_role;
-- The resolvers are for the database's own functions (posting, and the streams built on them); the service role may
-- call them to check an organization's mapping.
grant execute on function app.account_role_key(text), app.account_for_role(uuid, text), app.account_for_fund(uuid, text),
  app.pledge_fund_key(text, text), app.class_for_fund(uuid, uuid), app.account_for_bank_account(uuid, uuid)
  to service_role;
