-- Payments plan PR 2 (docs/PAYMENTS_PLAN.md §2, owner decisions 2026-10-02): payment methods
-- as plugins. A platform catalog of the twelve ways to pay, one enablement row per organization
-- and plugin, and the functions Settings › Payments uses to switch them on and off.
--
--   app.payment_plugins            the catalog (platform-owned, readable by every signed-in user)
--   app.center_payment_plugins     per organization and plugin: enabled, mode, status (derived and
--                                  stored), the name members see and the order
--   app.payment_plugin_settings    what Settings › Payments shows (staff with payments_can_view)
--   app.set_payment_plugin         turn a plugin on or off, rename it, reorder it, with a reason
--   app.payment_plugin_config_problem   the one validation rule, mirrored in TypeScript
--
-- LAYER, DO NOT REWRITE. Nothing moves: the Stripe and PayPal settings stay in
-- app.center_payment_processors (and the connection row), the offline methods and Zelle stay in
-- app.center_payment_methods. A plugin's "enabled" is DERIVED from those rows, and every switch
-- writes through the existing functions (app.set_payment_processor, app.set_payment_method), so
-- their rules apply unchanged and today's behaviour is unchanged by construction. The plugin rows
-- are kept in step by triggers on the legacy tables; the triggers only ever write
-- center_payment_plugins (never back to a legacy table), and only when a value changed.
--
-- No money rule changes here: checkouts, webhooks, recording, allocation, refunds and QuickBooks
-- are untouched; live mode is still switched only by app.set_payment_mode. ACH bank debit
-- (bank_debit) stays off unless the organization turns it on (owner decision Q12).
set client_min_messages = warning;

-- ── The catalog ──────────────────────────────────────────────────────────────
create table if not exists app.payment_plugins (
  key              text primary key check (key ~ '^[a-z_]{2,30}$'),
  label            text not null check (char_length(label) between 1 and 40),
  family           text not null check (family in ('provider_checkout','reported_transfer','instructions')),
  provider         text check (provider in ('stripe','paypal')),
  processor_method text,
  legacy_method    text check (legacy_method in ('check','cash','zelle','ach','stock','daf','matching_gift')),
  records_as       text[] not null,
  depends_on       text[] not null default '{}',
  config_fields    jsonb not null default '[]'::jsonb check (jsonb_typeof(config_fields) = 'array'),
  sandbox_behavior text not null check (sandbox_behavior in ('test_mode','rehearsal','none')),
  status           text not null default 'available' check (status in ('available','beta','suspended')),
  sort             int not null,
  check ((family = 'provider_checkout') = (provider is not null)),
  check ((provider is null) = (processor_method is null)),
  check (processor_method is null or processor_method = any (app.processor_methods(provider))),
  check ((family = 'provider_checkout') = (legacy_method is null))
);
comment on table app.payment_plugins is
  'The ways to pay Community Connect offers (docs/PAYMENTS_PLAN.md §2.2). Same keys as src/lib/payments/plugins/catalog.ts (a unit test compares them). Platform-owned.';

-- One row per line, each beginning with ('<key>', (tests/payment-plugins.test.ts reads these lines).
insert into app.payment_plugins (key, label, family, provider, processor_method, legacy_method, records_as, depends_on, config_fields, sandbox_behavior, status, sort) values
('card', 'Card', 'provider_checkout', 'stripe', 'card', null, '{card}', '{}', '[{"key":"statement_descriptor","label":"Statement descriptor","kind":"setting","member_visible":false,"sensitive":false}]', 'test_mode', 'available', 10),
('apple_pay', 'Apple Pay', 'provider_checkout', 'stripe', 'apple_pay', null, '{apple_pay}', '{card}', '[]', 'test_mode', 'available', 11),
('google_pay', 'Google Pay', 'provider_checkout', 'stripe', 'google_pay', null, '{google_pay}', '{card}', '[]', 'test_mode', 'available', 12),
('bank_debit', 'Bank account (ACH)', 'provider_checkout', 'stripe', 'ach', null, '{ach}', '{card}', '[]', 'test_mode', 'available', 13),
('paypal', 'PayPal', 'provider_checkout', 'paypal', 'paypal', null, '{paypal,venmo,card}', '{}', '[{"key":"statement_descriptor","label":"Statement descriptor","kind":"setting","member_visible":false,"sensitive":false}]', 'test_mode', 'available', 20),
('zelle', 'Zelle', 'reported_transfer', null, null, 'zelle', '{zelle}', '{}', '[{"key":"recipient","label":"Zelle email or phone","kind":"setting","member_visible":true,"sensitive":true},{"key":"name","label":"Name shown in Zelle","kind":"setting","member_visible":true,"sensitive":true},{"key":"memo_hint","label":"What to write in the memo","kind":"setting","member_visible":true,"sensitive":false}]', 'rehearsal', 'available', 30),
('check', 'Check', 'instructions', null, null, 'check', '{check}', '{}', '[{"key":"payee","label":"Make checks payable to","kind":"setting","member_visible":true,"sensitive":false},{"key":"address","label":"Mailing address","kind":"setting","member_visible":true,"sensitive":false},{"key":"memo_hint","label":"What to write in the memo","kind":"setting","member_visible":true,"sensitive":false}]', 'none', 'available', 40),
('cash', 'Cash (bhandar)', 'instructions', null, null, 'cash', '{cash}', '{}', '[{"key":"where","label":"Where to give cash","kind":"setting","member_visible":true,"sensitive":false},{"key":"note","label":"Anything else","kind":"setting","member_visible":true,"sensitive":false}]', 'none', 'available', 50),
('ach_wire', 'ACH and wire', 'instructions', null, null, 'ach', '{ach}', '{}', '[{"key":"details","label":"Bank, routing and account details","kind":"setting","member_visible":true,"sensitive":false},{"key":"note","label":"Anything else","kind":"setting","member_visible":true,"sensitive":false}]', 'none', 'available', 60),
('stock', 'Stock', 'instructions', null, null, 'stock', '{stock}', '{}', '[{"key":"details","label":"Broker, DTC number and account","kind":"setting","member_visible":true,"sensitive":false},{"key":"contact","label":"Who to tell when you transfer","kind":"setting","member_visible":true,"sensitive":false}]', 'none', 'available', 70),
('daf', 'Donor-advised fund', 'instructions', null, null, 'daf', '{daf}', '{}', '[{"key":"legal_name","label":"Legal name","kind":"setting","member_visible":true,"sensitive":false},{"key":"ein","label":"EIN","kind":"setting","member_visible":true,"sensitive":false},{"key":"address","label":"Mailing address","kind":"setting","member_visible":true,"sensitive":false}]', 'none', 'available', 80),
('matching_gift', 'Matching gift', 'instructions', null, null, 'matching_gift', '{matching_gift}', '{}', '[{"key":"legal_name","label":"Legal name","kind":"setting","member_visible":true,"sensitive":false},{"key":"ein","label":"EIN","kind":"setting","member_visible":true,"sensitive":false},{"key":"note","label":"Anything else","kind":"setting","member_visible":true,"sensitive":false}]', 'none', 'available', 90)
on conflict (key) do update set label = excluded.label, family = excluded.family, provider = excluded.provider,
  processor_method = excluded.processor_method, legacy_method = excluded.legacy_method, records_as = excluded.records_as,
  depends_on = excluded.depends_on, config_fields = excluded.config_fields, sandbox_behavior = excluded.sandbox_behavior, sort = excluded.sort;

-- ── Per organization ─────────────────────────────────────────────────────────
create table if not exists app.center_payment_plugins (
  center_id        uuid not null references app.centers(id) on delete cascade,
  plugin_key       text not null references app.payment_plugins(key),
  enabled          boolean not null default false,
  mode             text not null default 'test' check (mode in ('test','live')),
  status           text not null default 'off' check (status in ('off','needs_setup','ready','test_passed','live','suspended')),
  config           jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  label_override   text check (label_override is null or char_length(label_override) between 1 and 40),
  sort             int,
  changed_by       uuid references auth.users(id) on delete set null,
  changed_at       timestamptz,
  live_approved_by uuid,
  live_approved_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (center_id, plugin_key)
);
comment on table app.center_payment_plugins is
  'Each organization''s payment plugins. enabled/mode/status are derived from center_payment_processors, center_payment_methods and the connection (kept in step by app.payment_plugins_sync); label_override and sort are the organization''s own. Writes only through app.set_payment_plugin.';
comment on column app.center_payment_plugins.config is
  'Reserved for plugin settings that have no legacy home. Today every plugin''s settings live in the legacy rows (processor descriptor, method instructions), so this stays {}.';

drop trigger if exists touch_center_payment_plugins on app.center_payment_plugins;
create trigger touch_center_payment_plugins before update on app.center_payment_plugins for each row execute function app.touch_updated_at();

insert into app.module_tables (table_name, module_key) values ('payment_plugins', null), ('center_payment_plugins', 'giving')
on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_payment_plugins on app.payment_plugins;
create trigger audit_payment_plugins after insert or update or delete on app.payment_plugins
  for each row execute function app.audit_row('key');
drop trigger if exists audit_center_payment_plugins on app.center_payment_plugins;
create trigger audit_center_payment_plugins after insert or update or delete on app.center_payment_plugins
  for each row execute function app.audit_row('center_id', 'plugin_key');

-- RLS: read-only over the API; every write goes through the functions below.
alter table app.payment_plugins enable row level security;
alter table app.center_payment_plugins enable row level security;
drop policy if exists payment_plugins_read on app.payment_plugins;
create policy payment_plugins_read on app.payment_plugins for select to authenticated using (true);
drop policy if exists center_payment_plugins_read on app.center_payment_plugins;
create policy center_payment_plugins_read on app.center_payment_plugins for select to authenticated
  using (app.payments_can_view(center_id));
do $$
declare v_qual text := '(select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers(''giving''))::uuid[]))';
begin
  execute 'drop policy if exists module_switch on app.center_payment_plugins';
  execute format('create policy module_switch on app.center_payment_plugins as restrictive for all to public using (%s) with check (%s)', v_qual, v_qual);
end $$;
revoke all on app.payment_plugins, app.center_payment_plugins from public, anon, authenticated;
grant select on app.payment_plugins, app.center_payment_plugins to authenticated;

-- ── Derived state ────────────────────────────────────────────────────────────
-- Is the plugin on? Read from the legacy rows, never stored first: a Stripe or PayPal plugin is on
-- when its processor row lists the plugin's method (the wallets and ACH also need Card on); Zelle
-- and the offline methods are on when center_payment_methods accepts them.
create or replace function app.payment_plugin_enabled(p_center uuid, p_key text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare pl app.payment_plugins; v_methods text[]; v_dep text;
begin
  select * into pl from app.payment_plugins where key = p_key;
  if pl.key is null then return false; end if;
  if pl.family = 'provider_checkout' then
    select methods into v_methods from app.center_payment_processors where center_id = p_center and processor = pl.provider;
    if v_methods is null or not (pl.processor_method = any (v_methods)) then return false; end if;
    foreach v_dep in array pl.depends_on loop
      if not app.payment_plugin_enabled(p_center, v_dep) then return false; end if;
    end loop;
    return true;
  end if;
  return coalesce((select m.accepted from app.center_payment_methods m
                    where m.center_id = p_center and m.method = pl.legacy_method::app.payment_method), false);
end $$;

-- test or live: a provider plugin charges in its processor's API mode (a sandbox, or an organization
-- held to test, is always test: app.payment_api_mode); the others are test in a sandbox, live in production.
create or replace function app.payment_plugin_mode(p_center uuid, p_key text) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case when pl.provider is not null then coalesce(app.payment_api_mode(p_center, pl.provider), 'test')
              when (select environment from app.centers where id = p_center) = 'production' then 'live'
              else 'test' end
    from app.payment_plugins pl where pl.key = p_key
$$;

-- off, needs_setup, ready (to test), test_passed, live, suspended. A sandbox never reports live.
create or replace function app.payment_plugin_status(p_center uuid, p_key text) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare pl app.payment_plugins; v_env text; cp app.center_payment_processors; v_conn text; v_mode text; v_card text;
        v_instr jsonb; v_matched boolean;
begin
  select * into pl from app.payment_plugins where key = p_key;
  if pl.key is null then return null; end if;
  if pl.status = 'suspended' then return 'suspended'; end if;
  if not app.payment_plugin_enabled(p_center, p_key) then return 'off'; end if;
  select environment into v_env from app.centers where id = p_center;

  if pl.family = 'provider_checkout' then
    -- Apple Pay, Google Pay and ACH ride on Card: they cannot be ready while Card is not (a paused
    -- Card leaves them needing setup; payment_plugin_problem then says Card is paused).
    if 'card' = any (pl.depends_on) then
      v_card := app.payment_plugin_status(p_center, 'card');
      if v_card in ('needs_setup','suspended') then return 'needs_setup'; end if;
    end if;
    select * into cp from app.center_payment_processors where center_id = p_center and processor = pl.provider;
    select ic.status into v_conn from app.integration_connections ic where ic.id = cp.connection_id;
    if cp.center_id is null or cp.status not in ('test','live') or v_conn is distinct from 'connected' then
      return 'needs_setup';
    end if;
    v_mode := app.payment_api_mode(p_center, pl.provider);
    if cp.status = 'live' and v_mode = 'live' then return 'live'; end if;
    if exists (select 1 from app.payment_processor_tests t
                where t.center_id = p_center and t.processor = pl.provider and t.mode = v_mode and t.ok) then
      return 'test_passed';
    end if;
    return 'ready';
  end if;

  select m.instructions into v_instr from app.center_payment_methods m
   where m.center_id = p_center and m.method = pl.legacy_method::app.payment_method;
  v_instr := coalesce(v_instr, '{}'::jsonb);
  if pl.key = 'zelle' then
    if app.payment_method_instructions_problem('zelle', v_instr) is not null
       or (v_env = 'production' and nullif(btrim(coalesce(v_instr->>'name', '')), '') is null) then
      return 'needs_setup';
    end if;
    if v_env = 'production' then return 'live'; end if;
    -- A rehearsal report matched end to end (the Zelle reports table arrives with plan PR 3).
    if to_regclass('app.payment_reports') is not null
       and (select count(*) from pg_attribute a
             where a.attrelid = to_regclass('app.payment_reports') and a.attnum > 0 and not a.attisdropped
               and a.attname in ('center_id','status','is_test')) = 3 then
      execute 'select exists (select 1 from app.payment_reports where center_id = $1 and is_test and status = ''matched'')'
        into v_matched using p_center;
      if v_matched then return 'test_passed'; end if;
    end if;
    return 'ready';
  end if;

  if app.payment_method_instructions_problem(pl.legacy_method::app.payment_method, v_instr) is not null then return 'needs_setup'; end if;
  return case when v_env = 'production' then 'live' else 'ready' end;
end $$;

-- The next step, in plain English, or null when there is nothing to do.
create or replace function app.payment_plugin_problem(p_center uuid, p_key text) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare pl app.payment_plugins; v_status text; v_dep text; cp app.center_payment_processors; v_conn text; v_who text;
        v_instr jsonb; v_problem text; v_env text; v_forced boolean;
begin
  select * into pl from app.payment_plugins where key = p_key;
  if pl.key is null then return null; end if;
  v_status := app.payment_plugin_status(p_center, p_key);
  select environment, environment = 'sandbox' or app.entitlement(id, 'payments.mode') = '"test"'::jsonb
    into v_env, v_forced from app.centers where id = p_center;
  if v_status = 'suspended' then
    return format('Community Connect has paused %s for now.', pl.label);
  end if;
  if v_status = 'off' then
    foreach v_dep in array pl.depends_on loop
      if not app.payment_plugin_enabled(p_center, v_dep) then
        return format('Turn %s on first.', (select label from app.payment_plugins where key = v_dep));
      end if;
    end loop;
    return null;
  end if;

  if pl.family = 'provider_checkout' then
    v_who := case pl.provider when 'paypal' then 'PayPal' else 'Stripe' end;
    if v_status = 'needs_setup' then
      if 'card' = any (pl.depends_on) and app.payment_plugin_status(p_center, 'card') = 'suspended' then
        return 'Community Connect has paused Card for now.';
      end if;
      select * into cp from app.center_payment_processors where center_id = p_center and processor = pl.provider;
      select ic.status into v_conn from app.integration_connections ic where ic.id = cp.connection_id;
      if cp.center_id is null or cp.status in ('not_connected','disabled') then
        return format('Connect %s first (%s › Connect).', v_who, case pl.provider when 'paypal' then 'PayPal' else 'Card' end);
      end if;
      if cp.status = 'pending_verification' then
        return format('%s is still verifying the organization. Finish the steps in the %s dashboard.', v_who, v_who);
      end if;
      return format('%s is not connected right now. Reconnect it (%s › Reconnect).', v_who, case pl.provider when 'paypal' then 'PayPal' else 'Card' end);
    end if;
    if v_status = 'ready' and pl.key in ('card','paypal') then
      return format('Run the $1 test (%s › Run the $1 test) to check it end to end.', case pl.provider when 'paypal' then 'PayPal' else 'Card' end);
    end if;
    if v_status in ('ready','test_passed') and v_env = 'production' and not v_forced and pl.key in ('card','paypal') then
      return format('Members cannot pay with %s until %s is switched to live.', pl.label, v_who);
    end if;
    return null;
  end if;

  if v_status = 'needs_setup' then
    select m.instructions into v_instr from app.center_payment_methods m
     where m.center_id = p_center and m.method = pl.legacy_method::app.payment_method;
    v_instr := coalesce(v_instr, '{}'::jsonb);
    if pl.key = 'zelle' then
      if nullif(btrim(coalesce(v_instr->>'recipient', '')), '') is null then return 'Fill in the Zelle email or phone.'; end if;
      v_problem := app.payment_method_instructions_problem('zelle', v_instr);
      if v_problem is not null then return v_problem; end if;
      return 'Add the name shown in Zelle so members can check they are paying the right account.';
    end if;
    return app.payment_method_instructions_problem(pl.legacy_method::app.payment_method, v_instr);
  end if;
  return null;
end $$;

-- ── Keeping the plugin rows in step ──────────────────────────────────────────
-- One row per catalog key; enabled, mode and status recomputed from the legacy rows. A row is
-- only updated when one of the three changed (no audit noise); the organization's own name and
-- order, config and changed_* are never touched here.
create or replace function app.payment_plugins_refresh(p_center uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  -- A center being deleted (its rows cascade away) has nothing to keep in step.
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then return; end if;
  insert into app.center_payment_plugins as cpp (center_id, plugin_key, enabled, mode, status)
  select p_center, pl.key, app.payment_plugin_enabled(p_center, pl.key), app.payment_plugin_mode(p_center, pl.key),
         app.payment_plugin_status(p_center, pl.key)
    from app.payment_plugins pl
  on conflict (center_id, plugin_key) do update
     set enabled = excluded.enabled, mode = excluded.mode, status = excluded.status
   where (cpp.enabled, cpp.mode, cpp.status) is distinct from (excluded.enabled, excluded.mode, excluded.status);
end $$;

-- Trigger: a processor, an offline method, a $1 test, a Stripe/PayPal connection or a center's
-- environment changed. Security definer because the background service (connect_worker) and the
-- demo pack write those rows too.
create or replace function app.payment_plugins_sync() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if tg_table_name = 'centers' then
    perform app.payment_plugins_refresh(new.id);
  elsif tg_op = 'DELETE' then
    perform app.payment_plugins_refresh(old.center_id);
  else
    perform app.payment_plugins_refresh(new.center_id);
    if tg_op = 'UPDATE' then
      if old.center_id is distinct from new.center_id then perform app.payment_plugins_refresh(old.center_id); end if;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists payment_plugins_sync on app.center_payment_processors;
create trigger payment_plugins_sync after insert or update or delete on app.center_payment_processors
  for each row execute function app.payment_plugins_sync();
drop trigger if exists payment_plugins_sync on app.center_payment_methods;
create trigger payment_plugins_sync after insert or update or delete on app.center_payment_methods
  for each row execute function app.payment_plugins_sync();
drop trigger if exists payment_plugins_sync on app.payment_processor_tests;
create trigger payment_plugins_sync after insert on app.payment_processor_tests
  for each row execute function app.payment_plugins_sync();
drop trigger if exists payment_plugins_sync on app.integration_connections;
create trigger payment_plugins_sync after insert or update on app.integration_connections
  for each row when (new.provider in ('stripe','paypal')) execute function app.payment_plugins_sync();
drop trigger if exists payment_plugins_sync on app.centers;
create trigger payment_plugins_sync after update of environment on app.centers
  for each row execute function app.payment_plugins_sync();

-- ── Validation (mirrored by paymentPluginConfigProblem in src/lib/payments/plugins/config.ts) ──
-- Zelle and the offline methods: their instructions (app.payment_method_instructions_problem), and
-- in live mode Zelle also needs the name shown in Zelle. Card and PayPal: only the statement
-- descriptor. The rest have no settings of their own.
create or replace function app.payment_plugin_config_problem(p_key text, p_config jsonb, p_mode text) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare v jsonb := coalesce(p_config, '{}'::jsonb); v_label text; v_method text; v_problem text; k text; x jsonb;
begin
  v_label := case p_key when 'card' then 'Card' when 'apple_pay' then 'Apple Pay' when 'google_pay' then 'Google Pay'
                        when 'bank_debit' then 'Bank account (ACH)' when 'paypal' then 'PayPal' when 'zelle' then 'Zelle'
                        when 'check' then 'Check' when 'cash' then 'Cash (bhandar)' when 'ach_wire' then 'ACH and wire'
                        when 'stock' then 'Stock' when 'daf' then 'Donor-advised fund' when 'matching_gift' then 'Matching gift' end;
  if v_label is null then return 'That is not a payment method Community Connect offers.'; end if;
  if jsonb_typeof(v) <> 'object' then return 'The settings must be a set of fields.'; end if;
  v_method := case p_key when 'zelle' then 'zelle' when 'check' then 'check' when 'cash' then 'cash' when 'ach_wire' then 'ach'
                         when 'stock' then 'stock' when 'daf' then 'daf' when 'matching_gift' then 'matching_gift' end;
  if v_method is not null then
    v_problem := app.payment_method_instructions_problem(v_method::app.payment_method, v);
    if v_problem is not null then return v_problem; end if;
    if p_key = 'zelle' and p_mode = 'live' and nullif(btrim(coalesce(v->>'name', '')), '') is null then
      return 'Add the name shown in Zelle so members can check they are paying the right account.';
    end if;
    return null;
  end if;
  if p_key in ('card','paypal') then
    for k, x in select * from jsonb_each(v) loop
      if k <> 'statement_descriptor' then
        return format('"%s" is not a %s setting; the only one is the statement descriptor.', k, v_label);
      end if;
      if jsonb_typeof(x) not in ('string','null') then return 'The statement descriptor must be text.'; end if;
    end loop;
    return app.statement_descriptor_problem(v->>'statement_descriptor');
  end if;
  if v <> '{}'::jsonb then return format('%s has no settings of its own.', v_label); end if;
  return null;
end $$;

-- ── What Settings › Payments shows ───────────────────────────────────────────
-- One plugin, as payment_plugin_settings lists it. Staff only (the caller checks): it carries the
-- real Zelle address and the offline instructions.
create or replace function app.payment_plugin_entry(p_center uuid, p_key text) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'key', pl.key, 'label', pl.label, 'label_override', cpp.label_override, 'family', pl.family, 'provider', pl.provider,
    'depends_on', to_jsonb(pl.depends_on), 'sandbox_behavior', pl.sandbox_behavior, 'catalog_status', pl.status,
    'enabled', app.payment_plugin_enabled(p_center, pl.key), 'mode', app.payment_plugin_mode(p_center, pl.key),
    'status', app.payment_plugin_status(p_center, pl.key), 'problem', app.payment_plugin_problem(p_center, pl.key),
    'sort', coalesce(cpp.sort, pl.sort),
    'config', case when pl.family in ('reported_transfer','instructions') then coalesce(pm.instructions, '{}'::jsonb)
                   when pl.key in ('card','paypal') then jsonb_build_object('statement_descriptor', cp.statement_descriptor)
                   else '{}'::jsonb end,
    'config_fields', pl.config_fields, 'changed_at', cpp.changed_at)
    from app.payment_plugins pl
    left join app.center_payment_plugins cpp on cpp.center_id = p_center and cpp.plugin_key = pl.key
    left join app.center_payment_methods pm on pm.center_id = p_center and pm.method::text = pl.legacy_method
    left join app.center_payment_processors cp on cp.center_id = p_center and cp.processor = pl.provider
   where pl.key = p_key
$$;

create or replace function app.payment_plugin_settings(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; v_plugins jsonb;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_view(p_center) then
    raise exception 'Seeing the payment settings needs integrations.view, giving.view or the organization owner.' using errcode = '42501';
  end if;
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(app.payment_plugin_entry(p_center, pl.key) order by coalesce(cpp.sort, pl.sort), pl.sort, pl.key), '[]'::jsonb)
    into v_plugins
    from app.payment_plugins pl
    left join app.center_payment_plugins cpp on cpp.center_id = p_center and cpp.plugin_key = pl.key;
  return jsonb_build_object(
    'environment', c.environment,
    'forced_test', c.environment = 'sandbox' or app.entitlement(p_center, 'payments.mode') = '"test"'::jsonb,
    'offline_only', coalesce((c.rules #>> '{payments,offline_only}')::boolean, false),
    'can_configure', app.payments_can_configure(p_center),
    'can_connect', app.payments_can_connect(p_center),
    'plugins', v_plugins);
end $$;

-- ── Turning a plugin on or off, renaming it, reordering it ───────────────────
-- Writes through the existing functions so their rules apply unchanged:
--   Zelle and the offline methods  app.set_payment_method (instructions validated, required when on)
--   Card, wallets, ACH, PayPal      the processor's method list through app.set_payment_processor
-- A connected processor keeps at least one way to pay (disconnecting is the way to stop: fresh 2FA,
-- owner or integrations.manage); turning Card off takes Apple Pay, Google Pay and ACH with it.
-- Live mode is not switched here (app.set_payment_mode).
create or replace function app.set_payment_plugin(p_center uuid, p_key text, p_enabled boolean, p_config jsonb, p_label_override text,
                                                  p_sort int, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare pl app.payment_plugins; c app.centers; cp app.center_payment_processors; pm app.center_payment_methods;
        v_now_on boolean; v_on boolean; v_dep text; v_problem text; v_mode text; v_cfg jsonb;
        v_label text := nullif(btrim(coalesce(p_label_override, '')), '');
        v_drop text[]; v_new text[]; v_old text[]; v_desc text; v_who text; v_doing text;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_configure(p_center) then
    raise exception 'Changing the ways members can pay needs the owner, integrations.manage or giving.manage.' using errcode = '42501';
  end if;
  select * into pl from app.payment_plugins where key = p_key;
  if pl.key is null then raise exception 'That is not a payment method Community Connect offers.' using errcode = '22023'; end if;
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.' using errcode = '22023'; end if;
  v_now_on := app.payment_plugin_enabled(p_center, p_key);
  v_on := coalesce(p_enabled, v_now_on);
  -- A paused plugin cannot be turned on; turning it off, renaming or reordering it still works.
  if v_on and not v_now_on and pl.status = 'suspended' then
    raise exception 'Community Connect has paused % for now.', pl.label using errcode = '22023';
  end if;
  if v_label is not null and char_length(v_label) > 40 then
    raise exception 'The name members see can be at most 40 characters.' using errcode = '22023';
  end if;
  if p_sort is not null and (p_sort < 0 or p_sort > 999) then
    raise exception 'The order is a whole number from 0 to 999.' using errcode = '22023';
  end if;
  if p_config is not null and jsonb_typeof(p_config) <> 'object' then
    raise exception 'The settings must be a set of fields.' using errcode = '22023';
  end if;

  -- The settings are checked when they change, and when a plugin is turned on (a missing required
  -- field, or Zelle's name in production, only matters then, as in app.set_payment_method).
  if pl.family <> 'provider_checkout' then
    select * into pm from app.center_payment_methods where center_id = p_center and method = pl.legacy_method::app.payment_method;
    v_cfg := coalesce(p_config, pm.instructions, '{}'::jsonb);
  else
    v_cfg := coalesce(p_config, '{}'::jsonb);
  end if;
  if p_config is not null or (v_on and not v_now_on) then
    v_mode := case when v_on then app.payment_plugin_mode(p_center, p_key) else 'test' end;
    v_problem := app.payment_plugin_config_problem(p_key, v_cfg, v_mode);
    if v_problem is not null and (v_on or v_problem !~ '^Fill in') then
      raise exception '%', v_problem using errcode = '22023';
    end if;
  end if;

  if v_on and not v_now_on then
    foreach v_dep in array pl.depends_on loop
      if not app.payment_plugin_enabled(p_center, v_dep) then
        raise exception 'Turn % on first.', (select label from app.payment_plugins where key = v_dep) using errcode = '22023';
      end if;
    end loop;
  end if;

  v_doing := case when v_on and not v_now_on then 'turn on ' || pl.label
                  when v_now_on and not v_on then 'turn off ' || pl.label
                  else 'change ' || pl.label end;
  perform app.payments_require_reason(p_reason, v_doing);

  if pl.family = 'provider_checkout' then
    v_who := case pl.provider when 'paypal' then 'PayPal' else 'Stripe' end;
    select * into cp from app.center_payment_processors where center_id = p_center and processor = pl.provider;
    if cp.center_id is null and v_on then
      perform app.payment_processor_ensure(p_center, pl.provider);
      select * into cp from app.center_payment_processors where center_id = p_center and processor = pl.provider;
    end if;
    if cp.center_id is not null then
      v_old := coalesce((select array_agg(distinct m order by m) from unnest(cp.methods) m), '{}');
      if v_on then
        v_new := (select array_agg(distinct m order by m) from unnest(cp.methods || pl.processor_method) m);
      else
        -- Off: the plugin's own method(s), and everything that rides on it (Card → wallets and ACH).
        v_drop := case when pl.key = 'paypal' then pl.records_as else array[pl.processor_method] end
                  || coalesce((select array_agg(d.processor_method) from app.payment_plugins d
                                where pl.key = any (d.depends_on) and d.provider = pl.provider), '{}');
        v_new := coalesce((select array_agg(distinct m order by m) from unnest(cp.methods) m where m <> all (v_drop)), '{}');
      end if;
      if v_now_on and not v_on and cp.status in ('pending_verification','test','live')
         and (cardinality(v_new) = 0 or pl.key = 'paypal') then
        raise exception '% is connected, so it needs at least one way to pay. To stop taking % payments, disconnect % in the % card.',
          v_who, case pl.key when 'paypal' then 'PayPal' else 'card' end, v_who, case pl.key when 'paypal' then 'PayPal' else 'Card' end
          using errcode = '22023';
      end if;
      v_desc := coalesce(case when p_config ? 'statement_descriptor' then p_config->>'statement_descriptor' end, cp.statement_descriptor);
      if v_new is distinct from v_old or nullif(btrim(coalesce(v_desc, '')), '') is distinct from cp.statement_descriptor then
        if cardinality(v_new) = 0 then
          -- Not connected and nothing left: app.set_payment_processor needs at least one method, so
          -- the empty list is written here (the row stays; nothing is offered to members).
          v_problem := app.statement_descriptor_problem(v_desc);
          if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
          update app.center_payment_processors
             set methods = '{}', statement_descriptor = nullif(btrim(coalesce(v_desc, '')), ''), updated_by = auth.uid()
           where center_id = p_center and processor = pl.provider;
        else
          perform app.set_payment_processor(p_center, pl.provider, v_new, v_desc, false, p_reason);
        end if;
      end if;
    end if;
  else
    if pm.center_id is not null or v_on then
      if v_on is distinct from coalesce(pm.accepted, false) or (p_config is not null and p_config is distinct from pm.instructions)
         or (p_sort is not null and p_sort is distinct from pm.sort) then
        -- A method row made here for the first time takes the place Settings › Payments always gave
        -- it (payment_settings' order: check 1 … matching gift 7), so installed apps list it as before.
        perform app.set_payment_method(p_center, pl.legacy_method::app.payment_method, v_on, v_cfg,
          coalesce(p_sort, pm.sort, array_position(array['check','cash','zelle','ach','stock','daf','matching_gift'], pl.legacy_method)),
          p_reason);
      end if;
    end if;
  end if;

  perform app.payment_plugins_refresh(p_center);
  update app.center_payment_plugins
     set label_override = v_label, sort = p_sort, changed_by = auth.uid(), changed_at = now()
   where center_id = p_center and plugin_key = p_key;
  return app.payment_plugin_entry(p_center, p_key);
end $$;

-- ── Backfill: one row per center and plugin, from today's settings ───────────
do $$ begin
  perform app.set_audit_context('Payment plugins (0580): rows made from the existing payment settings; nothing changed');
  perform app.payment_plugins_refresh(c.id) from app.centers c;
end $$;

-- ── A sandbox reset keeps the plugin rows ────────────────────────────────────
-- They are configuration, kept with center_payment_processors (o-demo, 0310). Same list as 0546,
-- plus center_payment_plugins.
create or replace function app.demo_keep_tables() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    -- the organization, its people in charge and its agreements
    'centers','center_owners','role_grants','org_agreements','org_profiles','org_leaders','org_documents',
    'center_entitlements','center_modules','number_sequences','support_grants',
    -- onboarding progress and go-live
    'center_setup_steps','center_attestations','golive_requests','golive_approvals','sandbox_codes','sandbox_expiry_notices','center_demo_state',
    -- connections, secrets and what the providers returned
    'integration_connections','integration_secrets','secret_access_log','oauth_states','webhook_events',
    'center_payment_processors','payment_processor_tests','paypal_email_verifications','center_payment_plugins',
    'email_domains','email_senders','messaging_settings','message_suppressions','texting_registrations',
    'whatsapp_accounts','whatsapp_template_submissions','sandbox_test_recipients','recipient_verifications',
    'center_domains','member_join_codes',
    'qbo_oauth_states','qbo_pull_runs','qbo_test_posts','qbo_accounts','qbo_classes','qbo_locations','qbo_items',
    'qbo_tax_codes','qbo_payment_methods','qbo_customers','qbo_transactions',
    -- templates and documents (Setup stage 2), saved import mappings and the organization's own pick-lists
    'legal_documents','message_templates','receipt_templates','import_mappings','dietary_options',
    -- history that is never deleted
    'audit_log','jobs'
  ]::text[]
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app.payment_plugin_enabled(uuid, text), app.payment_plugin_mode(uuid, text),
  app.payment_plugin_status(uuid, text), app.payment_plugin_problem(uuid, text), app.payment_plugins_refresh(uuid),
  app.payment_plugins_sync(), app.payment_plugin_config_problem(text, jsonb, text), app.payment_plugin_entry(uuid, text),
  app.payment_plugin_settings(uuid), app.set_payment_plugin(uuid, text, boolean, jsonb, text, int, text)
  from public, anon;
revoke execute on function app.payment_plugin_enabled(uuid, text), app.payment_plugin_mode(uuid, text),
  app.payment_plugin_status(uuid, text), app.payment_plugin_problem(uuid, text), app.payment_plugins_refresh(uuid),
  app.payment_plugins_sync(), app.payment_plugin_entry(uuid, text)
  from authenticated;
grant execute on function app.payment_plugin_settings(uuid), app.set_payment_plugin(uuid, text, boolean, jsonb, text, int, text),
  app.payment_plugin_config_problem(text, jsonb, text)
  to authenticated;
