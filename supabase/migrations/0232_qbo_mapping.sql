-- Onboarding (stream o-quickbooks) · 3 of 6: the account mapping and the
-- treasurer's approval (plan §1.7.4 "Map ... The treasurer approves the mapping").
--
-- The mapping keeps the existing tables: app.qbo_account_mappings (purpose ->
-- QuickBooks account) and funds.qbo_class_id (fund -> class). What changes:
--   * an account is always one from the chart pulled from QuickBooks (the
--     treasurer picks it; nobody types an account id) -- enforced by a trigger,
--     which also takes the account's name from the chart;
--   * approval is one act for the whole mapping, app.approve_qbo_mapping
--     (accounting.manage + a fresh 2FA check + a reason), recorded on each row
--     and on the connection (settings.mapping_approved_by / _at); a row cannot
--     be marked approved any other way, and changing an account withdraws the
--     approval (and the test-post approval that depended on it).
--
--   app.qbo_purposes()              the purposes, with the account types each accepts
--   app.qbo_required_purposes(c)    what must be mapped before approval
--   app.set_qbo_mapping(...)        choose the account for one purpose
--   app.set_qbo_fund_class(...)     choose the class for one fund (or none)
--   app.approve_qbo_mapping(...)    approve
set client_min_messages = warning;

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
    "stock_clearing":      ["Other Current Asset","Bank","Other Asset"]
  }'::jsonb
$$;

-- What must be mapped: income, the bank, undeposited funds, card clearing and
-- fees always; pledges receivable on accrual basis; store sales and sales tax
-- when the Store module is on.
create or replace function app.qbo_required_purposes(p_center uuid) returns text[]
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v text[] := array['income.general','bank','undeposited_funds','payment_clearing','merchant_fees'];
begin
  select * into c from app.qbo_connection(p_center);
  if c.settings->>'basis' = 'accrual' then v := v || 'pledges_receivable'::text; end if;
  if app.module_enabled(p_center, 'store') then v := v || array['store.sales','sales_tax_payable']; end if;
  return v;
end $$;

-- ── The guard ────────────────────────────────────────────────────────────────
create or replace function app.qbo_account_mappings_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; a app.qbo_accounts; v_types jsonb;
begin
  if tg_op = 'INSERT' or new.qbo_account_id is distinct from old.qbo_account_id then
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
    new.qbo_account_name := a.name;
    new.approved_by := null;
    new.approved_at := null;
  elsif (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by)
        and new.approved_at is not null
        and coalesce(current_setting('app.qbo_mapping_approval', true), '') <> 'on' then
    raise exception 'The mapping is approved as a whole by the treasurer (Approve mapping, with a fresh 2FA check).' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists qbo_account_mappings_guard on app.qbo_account_mappings;
create trigger qbo_account_mappings_guard before insert or update on app.qbo_account_mappings
  for each row execute function app.qbo_account_mappings_guard();

-- A changed account withdraws the approval of the whole mapping on the connection.
create or replace function app.qbo_account_mappings_changed() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if tg_op = 'INSERT' or new.qbo_account_id is distinct from old.qbo_account_id then
    update app.integration_connections
       set settings = settings - 'mapping_approved_by' - 'mapping_approved_at' - 'test_post_approved_by' - 'test_post_approved_at'
     where center_id = new.center_id and provider in ('quickbooks_online','intuit_sandbox')
       and (settings ? 'mapping_approved_at' or settings ? 'test_post_approved_at');
  end if;
  return null;
end $$;
drop trigger if exists qbo_account_mappings_changed on app.qbo_account_mappings;
create trigger qbo_account_mappings_changed after insert or update on app.qbo_account_mappings
  for each row execute function app.qbo_account_mappings_changed();

-- ── Choosing accounts and classes ────────────────────────────────────────────
create or replace function app.set_qbo_mapping(p_center uuid, p_purpose text, p_qbo_account_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.qbo_account_mappings;
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not app.has_permission(p_center, 'accounting.manage') then
    raise exception 'Mapping QuickBooks accounts needs accounting.manage.' using errcode = 'insufficient_privilege';
  end if;
  if p_purpose is null or not (app.qbo_purposes() ? p_purpose) then raise exception 'Unknown mapping purpose "%".', p_purpose; end if;
  if nullif(btrim(p_qbo_account_id), '') is null then raise exception 'Choose a QuickBooks account.'; end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why this account is being mapped.'; end if;
  perform app.set_audit_context(p_reason);
  insert into app.qbo_account_mappings (center_id, purpose, qbo_account_id)
  values (p_center, p_purpose, btrim(p_qbo_account_id))
  on conflict (center_id, purpose) do update set qbo_account_id = excluded.qbo_account_id
  returning * into m;
  return jsonb_build_object('purpose', m.purpose, 'qbo_account_id', m.qbo_account_id, 'qbo_account_name', m.qbo_account_name);
end $$;

-- p_qbo_class_id null: the fund has no class.
create or replace function app.set_qbo_fund_class(p_center uuid, p_fund uuid, p_qbo_class_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; k app.qbo_classes; f app.funds;
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not app.has_permission(p_center, 'accounting.manage') then
    raise exception 'Choosing a fund''s QuickBooks class needs accounting.manage.' using errcode = 'insufficient_privilege';
  end if;
  select * into f from app.funds where id = p_fund and center_id = p_center;
  if f.id is null then raise exception 'That fund was not found.'; end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why the fund''s class is being changed.'; end if;
  if nullif(btrim(p_qbo_class_id), '') is not null then
    select * into c from app.qbo_connection(p_center);
    select * into k from app.qbo_classes where connection_id = c.id and qbo_id = btrim(p_qbo_class_id);
    if k.qbo_id is null then
      raise exception 'Choose the class from the classes pulled from QuickBooks (class "%" is not in them).', p_qbo_class_id;
    end if;
    if not k.active then raise exception 'The class "%" is inactive in QuickBooks.', k.name; end if;
  end if;
  if f.qbo_class_id is not distinct from nullif(btrim(p_qbo_class_id), '') then
    return jsonb_build_object('fund_id', f.id, 'qbo_class_id', f.qbo_class_id, 'changed', false);
  end if;
  perform app.set_audit_context(p_reason);
  update app.funds set qbo_class_id = nullif(btrim(p_qbo_class_id), '') where id = f.id;
  update app.integration_connections
     set settings = settings - 'mapping_approved_by' - 'mapping_approved_at' - 'test_post_approved_by' - 'test_post_approved_at'
   where center_id = p_center and provider in ('quickbooks_online','intuit_sandbox') and settings ? 'mapping_approved_at';
  perform set_config('app.qbo_mapping_approval', 'on', true);
  update app.qbo_account_mappings set approved_by = null, approved_at = null where center_id = p_center and approved_at is not null;
  perform set_config('app.qbo_mapping_approval', '', true);
  return jsonb_build_object('fund_id', f.id, 'qbo_class_id', nullif(btrim(p_qbo_class_id), ''), 'class_name', k.name, 'changed', true);
end $$;

-- ── Approval ─────────────────────────────────────────────────────────────────
create or replace function app.approve_qbo_mapping(p_center uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_missing text[]; v_warn jsonb; v_errors text; v_n int;
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not app.has_permission(p_center, 'accounting.manage') then
    raise exception 'Approving the QuickBooks mapping needs accounting.manage (the treasurer).' using errcode = 'insufficient_privilege';
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why the mapping is approved.'; end if;
  select * into c from app.qbo_connection(p_center);
  if c.id is null or c.status = 'disconnected' then raise exception 'Connect QuickBooks first.'; end if;
  if not exists (select 1 from app.qbo_pull_runs where connection_id = c.id and status = 'succeeded') then
    raise exception 'Pull the chart of accounts from QuickBooks first.';
  end if;
  select coalesce(array_agg(p order by p), '{}') into v_missing
    from unnest(app.qbo_required_purposes(p_center)) p
   where not exists (select 1 from app.qbo_account_mappings m where m.center_id = p_center and m.purpose = p);
  if cardinality(v_missing) > 0 then
    raise exception 'Map these first: %.', array_to_string(v_missing, ', ');
  end if;
  v_warn := app.qbo_mapping_warnings(p_center);
  select string_agg(w->>'text', ' ') into v_errors from jsonb_array_elements(v_warn) w where w->>'level' = 'error';
  if v_errors is not null then raise exception '%', v_errors; end if;
  perform app.assert_step_up('qbo.approve_mapping');
  perform app.set_audit_context(p_reason);
  perform set_config('app.qbo_mapping_approval', 'on', true);
  -- Approving takes the current names from the chart (a renamed account is accepted as renamed).
  update app.qbo_account_mappings m
     set approved_by = auth.uid(), approved_at = now(),
         qbo_account_name = coalesce((select a.name from app.qbo_accounts a where a.connection_id = c.id and a.qbo_id = m.qbo_account_id), m.qbo_account_name)
   where m.center_id = p_center;
  get diagnostics v_n = row_count;
  perform set_config('app.qbo_mapping_approval', '', true);
  update app.integration_connections
     set settings = settings - 'test_post_approved_by' - 'test_post_approved_at'
                    || jsonb_build_object('mapping_approved_by', auth.uid(), 'mapping_approved_at', now())
   where id = c.id;
  if to_regprocedure('app.qbo_sync_setup_steps(uuid)') is not null then
    execute 'select app.qbo_sync_setup_steps($1)' using p_center;
  end if;
  return jsonb_build_object('approved', v_n, 'approved_at', now());
end $$;

revoke execute on function app.qbo_account_mappings_guard(), app.qbo_account_mappings_changed(), app.qbo_required_purposes(uuid),
  app.set_qbo_mapping(uuid, text, text, text), app.set_qbo_fund_class(uuid, uuid, text, text), app.approve_qbo_mapping(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function app.qbo_purposes(), app.qbo_required_purposes(uuid), app.set_qbo_mapping(uuid, text, text, text),
  app.set_qbo_fund_class(uuid, uuid, text, text), app.approve_qbo_mapping(uuid, text) to authenticated;
