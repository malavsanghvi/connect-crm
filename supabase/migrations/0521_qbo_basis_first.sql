-- Wave F · stream f-money · 2 of 3: the QuickBooks accounting basis is the
-- first choice after connecting (owner decision 2026-09-25, second batch:
-- "QuickBooks posts on cash basis only until an accrual customer needs it; the
-- basis (cash or accrual) is chosen at first QuickBooks setup").
--
--   app.set_qbo_basis(center, basis, reason)
--       The first choice (no basis yet): accounting.manage (the treasurer, or
--       the owner) and a reason. Changing it later: accounting.manage, a reason
--       and a fresh 2FA check; the mapping (and the test post that depended on
--       it) must then be approved again, as before (0230), because the basis
--       decides which accounts are needed (pledges receivable on accrual).
--       Stored in integration_connections.settings: basis, basis_chosen_by /
--       _at (first choice), basis_changed_by / _at (last change).
--   app.set_qbo_settings(...)   same signature; the basis must already be
--       chosen, or is chosen here as the first choice; a different basis goes
--       through the change rules above (fresh 2FA check).
--   The mapping guard            no account is mapped, and no mapping approved,
--       before the basis is chosen.
--   Posting stays cash-only (0235): with accrual chosen app.qbo_post_ready,
--       readiness check 7 and the setup screen say plainly that accrual posting
--       isn't available yet and postings wait in the queue. Nothing is posted,
--       skipped or failed because of it: the postings stay queued.
--   Existing connections that already have a mapping but no basis keep what
--   the poster already assumed for them (cash), recorded as such.
set client_min_messages = warning;

-- ── Existing connections: the poster treated "no basis" as cash (0235) ──────
update app.integration_connections c
   set settings = c.settings || jsonb_build_object('basis', 'cash',
         'basis_note', 'Set to cash by migration 0521: the account mapping existed before the basis became the first choice, and cash is what the poster already used.')
 where c.provider in ('quickbooks_online','intuit_sandbox')
   and coalesce(c.settings->>'basis', '') not in ('cash','accrual')
   and (c.settings ? 'mapping_approved_at' or exists (select 1 from app.qbo_account_mappings m where m.center_id = c.center_id));

-- ── Choosing and changing the basis ──────────────────────────────────────────
-- Internal: the caller has checked who, the module, the reason and the audit
-- context. Returns {basis, first, changed}.
create or replace function app._qbo_apply_basis(p_connection uuid, p_basis text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_old text;
begin
  if p_basis is null or p_basis not in ('cash','accrual') then raise exception 'Choose cash or accrual basis.'; end if;
  select * into c from app.integration_connections where id = p_connection for update;
  v_old := nullif(c.settings->>'basis', '');
  if v_old is null then
    update app.integration_connections
       set settings = settings - 'basis_note' || jsonb_build_object('basis', p_basis, 'basis_chosen_by', auth.uid(), 'basis_chosen_at', now())
     where id = c.id;
    return jsonb_build_object('basis', p_basis, 'first', true, 'changed', true);
  end if;
  if v_old = p_basis then return jsonb_build_object('basis', p_basis, 'first', false, 'changed', false); end if;
  perform app.assert_step_up('qbo.change_basis');
  if c.settings ? 'mapping_approved_at' or c.settings ? 'test_post_approved_at' then
    perform set_config('app.qbo_mapping_approval', 'on', true);
    update app.qbo_account_mappings set approved_by = null, approved_at = null where center_id = c.center_id and approved_at is not null;
    perform set_config('app.qbo_mapping_approval', '', true);
  end if;
  update app.integration_connections
     set settings = settings - 'mapping_approved_by' - 'mapping_approved_at' - 'test_post_approved_by' - 'test_post_approved_at' - 'basis_note'
                    || jsonb_build_object('basis', p_basis, 'basis_changed_by', auth.uid(), 'basis_changed_at', now(), 'basis_changed_from', v_old)
   where id = c.id;
  return jsonb_build_object('basis', p_basis, 'first', false, 'changed', true, 'from', v_old);
end $$;

create or replace function app.set_qbo_basis(p_center uuid, p_basis text, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v jsonb;
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not app.has_permission(p_center, 'accounting.manage') then
    raise exception 'Choosing the QuickBooks accounting basis needs the treasurer (accounting.manage) or the organization owner.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_basis is null or p_basis not in ('cash','accrual') then raise exception 'Choose cash or accrual basis.'; end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why this accounting basis is chosen.'; end if;
  select * into c from app.qbo_connection(p_center);
  if c.id is null or c.status = 'disconnected' then raise exception 'Connect QuickBooks first.'; end if;
  perform app.set_audit_context(p_reason);
  v := app._qbo_apply_basis(c.id, p_basis);
  if to_regprocedure('app.qbo_sync_setup_steps(uuid)') is not null then perform app.qbo_sync_setup_steps(p_center); end if;
  return v;
end $$;

-- Same as 0230, except the basis: kept when the same, chosen here when not yet
-- chosen, and changed only under the change rules (fresh 2FA check).
create or replace function app.set_qbo_settings(p_center uuid, p_basis text, p_posting text, p_go_live_date date, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_new jsonb; v_basis text;
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not app.has_permission(p_center, 'accounting.manage') then
    raise exception 'Choosing the QuickBooks basis, posting and go-live date needs accounting.manage.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from app.qbo_connection(p_center);
  if c.id is null then raise exception 'Connect QuickBooks first.'; end if;
  v_basis := coalesce(nullif(btrim(p_basis), ''), nullif(c.settings->>'basis', ''));
  if v_basis is null then raise exception 'Choose the accounting basis (cash or accrual) first.'; end if;
  if v_basis not in ('cash','accrual') then raise exception 'Choose cash or accrual basis.'; end if;
  if p_posting is null or p_posting not in ('per_txn','daily_summary') then
    raise exception 'Choose to post each transaction, or a daily summary.';
  end if;
  if p_go_live_date is null then raise exception 'Choose the QuickBooks go-live date.'; end if;
  if p_go_live_date < date '2000-01-01' or p_go_live_date > current_date + 366 then
    raise exception 'The go-live date must be within the next year.';
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why these QuickBooks choices are being made.'; end if;
  perform app.set_audit_context(p_reason);
  perform app._qbo_apply_basis(c.id, v_basis);
  v_new := jsonb_build_object('posting', p_posting, 'go_live_date', to_char(p_go_live_date, 'YYYY-MM-DD'));
  update app.integration_connections set settings = settings || v_new where id = c.id;
  return v_new || jsonb_build_object('basis', v_basis);
end $$;

-- ── The mapping guard (0232) + the basis comes first ─────────────────────────
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
    if coalesce(c.settings->>'basis', '') not in ('cash','accrual') then
      raise exception 'Choose the accounting basis (cash or accrual) first: it decides which accounts the mapping needs.' using errcode = '23514';
    end if;
    new.qbo_account_name := a.name;
    new.approved_by := null;
    new.approved_at := null;
  elsif (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by)
        and new.approved_at is not null
        and coalesce(current_setting('app.qbo_mapping_approval', true), '') <> 'on' then
    raise exception 'The mapping is approved as a whole by the treasurer (Approve mapping, with a fresh 2FA check).' using errcode = '23514';
  elsif new.approved_at is not null and old.approved_at is null then
    select * into c from app.qbo_connection(new.center_id);
    if coalesce(c.settings->>'basis', '') not in ('cash','accrual') then
      raise exception 'Choose the accounting basis (cash or accrual) before approving the mapping.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- ── What the basis means for posting ─────────────────────────────────────────
create or replace function app.qbo_accrual_waiting_text() returns text
language sql immutable set search_path = app, public, extensions as $$
  select 'Accrual-basis posting isn''t available yet: Community Connect posts on cash basis only. Postings wait in the queue and nothing is posted until accrual posting is available or the basis is changed to cash.'::text
$$;

-- Same as 0235 with the basis rules first-class.
create or replace function app.qbo_post_ready(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_env text; v_errors text;
begin
  if not app.module_enabled(p_center, 'accounting') then
    return jsonb_build_object('ok', false, 'reason', 'The Accounting module is switched off.');
  end if;
  select * into c from app.qbo_connection(p_center);
  select environment into v_env from app.centers where id = p_center;
  if c.id is null or c.status = 'disconnected' then return jsonb_build_object('ok', false, 'reason', 'QuickBooks is not connected.'); end if;
  if c.status = 'error' then
    return jsonb_build_object('ok', false, 'reason', 'QuickBooks needs to be connected again: ' || coalesce(c.last_error, 'the connection failed') );
  end if;
  if coalesce((c.settings->>'read_only')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'The real company is connected read-only (sandbox), so nothing is posted.');
  end if;
  if v_env = 'sandbox' and c.provider <> 'intuit_sandbox' then
    return jsonb_build_object('ok', false, 'reason', 'A sandbox posts only to an Intuit sandbox company.');
  end if;
  if coalesce(c.settings->>'basis', '') not in ('cash','accrual') then
    return jsonb_build_object('ok', false, 'reason', 'The accounting basis (cash or accrual) is not chosen yet.');
  end if;
  if c.settings->>'basis' = 'accrual' then
    return jsonb_build_object('ok', false, 'reason', app.qbo_accrual_waiting_text(), 'accrual_waiting', true);
  end if;
  if app.qbo_go_live_date(p_center) is null then return jsonb_build_object('ok', false, 'reason', 'The QuickBooks go-live date is not set.'); end if;
  if c.settings->>'mapping_approved_at' is null then return jsonb_build_object('ok', false, 'reason', 'The account mapping is not approved.'); end if;
  if c.settings->>'test_post_approved_at' is null then return jsonb_build_object('ok', false, 'reason', 'The test post is not approved.'); end if;
  select string_agg(w->>'text', ' ') into v_errors from jsonb_array_elements(app.qbo_mapping_warnings(p_center)) w where w->>'level' = 'error';
  if v_errors is not null then return jsonb_build_object('ok', false, 'reason', v_errors); end if;
  return jsonb_build_object('ok', true, 'connection_id', c.id, 'posting', coalesce(c.settings->>'posting', 'per_txn'));
end $$;

-- Readiness check 7 (0236) + the basis: not chosen is "still to do"; accrual
-- says plainly that postings wait (not ready: nothing would reach QuickBooks).
create or replace function app.check_quickbooks_ready(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_missing text[] := '{}'; v_errors text;
begin
  select * into c from app.qbo_connection(p_center);
  if not app.module_enabled(p_center, 'accounting') then
    return jsonb_build_object('ok', true, 'detail', 'QuickBooks not used (the Accounting module is switched off).');
  end if;
  if c.id is null or c.status = 'disconnected' then
    return jsonb_build_object('ok', false, 'detail',
      'QuickBooks is not connected. Connect it in Accounting › QuickBooks setup, or switch the Accounting module off if QuickBooks is not used.');
  end if;
  if c.status = 'error' then v_missing := v_missing || ('connect again (' || coalesce(c.last_error, 'the connection failed') || ')'); end if;
  if coalesce(c.settings->>'basis', '') not in ('cash','accrual') then v_missing := v_missing || 'choose the accounting basis (cash or accrual)'::text; end if;
  if c.settings->>'mapping_approved_at' is null then v_missing := v_missing || 'approve the account mapping'::text; end if;
  if c.settings->>'test_post_approved_at' is null then v_missing := v_missing || 'approve a test post'::text; end if;
  if app.qbo_go_live_date(p_center) is null then v_missing := v_missing || 'set the QuickBooks go-live date'::text; end if;
  select string_agg(w->>'text', ' ') into v_errors from jsonb_array_elements(app.qbo_mapping_warnings(p_center)) w where w->>'level' = 'error';
  if v_errors is not null then v_missing := v_missing || v_errors; end if;
  if c.settings->>'basis' = 'accrual' then
    return jsonb_build_object('ok', false, 'accrual_waiting', true, 'detail', 'Connected to ' || coalesce(c.display_name, 'QuickBooks')
      || ' on accrual basis. ' || app.qbo_accrual_waiting_text()
      || case when cardinality(v_missing) > 0 then ' Also still to do: ' || array_to_string(v_missing, '; ') || '.' else '' end);
  end if;
  if cardinality(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'detail', 'Connected to ' || coalesce(c.display_name, 'QuickBooks') || '; still to do: '
                                                     || array_to_string(v_missing, '; ') || '.');
  end if;
  return jsonb_build_object('ok', true, 'detail',
    'Connected to ' || coalesce(c.display_name, 'QuickBooks')
    || case when coalesce((c.settings->>'read_only')::boolean, false) then ' (read-only)' when c.provider = 'intuit_sandbox' then ' (Intuit sandbox company)' else '' end
    || '; cash basis'
    || '; mapping approved ' || to_char((c.settings->>'mapping_approved_at')::timestamptz at time zone 'UTC', 'FMMonth FMDD, YYYY')
    || '; test post approved ' || to_char((c.settings->>'test_post_approved_at')::timestamptz at time zone 'UTC', 'FMMonth FMDD, YYYY')
    || '; go-live ' || to_char(app.qbo_go_live_date(p_center), 'FMMonth FMDD, YYYY') || '.');
end $$;

-- ── What the screen shows (0236) + the basis's own facts ─────────────────────
create or replace function app.qbo_status(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; o app.integration_connections; v_env text; v_run app.qbo_pull_runs; v_test app.qbo_test_posts;
        v_counts jsonb; v_jobs jsonb; v_missing text[]; v_name jsonb; v_suggested text; v_waiting int;
begin
  if not app.qbo_can_view(p_center) then
    raise exception 'Seeing QuickBooks setup needs accounting.manage, giving.view or integrations.view.' using errcode = 'insufficient_privilege';
  end if;
  select environment, rules->'accounting'->>'basis' into v_env, v_suggested from app.centers where id = p_center;
  select * into c from app.qbo_connection(p_center);
  select * into o from app.integration_connections
   where center_id = p_center and provider in ('quickbooks_online','intuit_sandbox') and id is distinct from c.id;
  select * into v_run from app.qbo_pull_runs where connection_id = c.id order by finished_at desc limit 1;
  select * into v_test from app.qbo_test_posts where connection_id = c.id order by requested_at desc limit 1;
  select jsonb_build_object(
    'accounts', (select count(*) from app.qbo_accounts where connection_id = c.id),
    'classes', (select count(*) from app.qbo_classes where connection_id = c.id),
    'locations', (select count(*) from app.qbo_locations where connection_id = c.id),
    'items', (select count(*) from app.qbo_items where connection_id = c.id),
    'tax_codes', (select count(*) from app.qbo_tax_codes where connection_id = c.id),
    'payment_methods', (select count(*) from app.qbo_payment_methods where connection_id = c.id)) into v_counts;
  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'kind', j.kind, 'status', j.status, 'last_error', j.last_error,
                                               'created_at', j.created_at, 'finished_at', j.finished_at, 'result', j.result) order by j.id desc), '[]')
    into v_jobs
    from (select * from app.jobs where center_id = p_center and (kind like 'qbo.%' or (kind = 'oauth.exchange' and payload->>'provider' = 'intuit'))
           order by id desc limit 8) j;
  select coalesce(array_agg(p order by p), '{}') into v_missing
    from unnest(app.qbo_required_purposes(p_center)) p
   where not exists (select 1 from app.qbo_account_mappings m where m.center_id = p_center and m.purpose = p);
  select count(*) into v_waiting from app.ledger_postings where center_id = p_center and status = 'queued';
  select coalesce(jsonb_object_agg(u.id, coalesce(nullif(pe.preferred_name, ''), pe.first_name) || ' ' || pe.last_name), '{}') into v_name
    from auth.users u
    join app.center_users cu on cu.user_id = u.id and cu.center_id = p_center
    join app.people pe on pe.id = cu.person_id
   where u.id::text in (c.connected_by::text, c.settings->>'mapping_approved_by', c.settings->>'test_post_approved_by',
                        c.settings->>'basis_chosen_by', c.settings->>'basis_changed_by',
                        v_test.requested_by::text, v_test.approved_by::text);
  return jsonb_build_object(
    'environment', v_env,
    'entitlement', app.entitlement(p_center, 'qbo.mode'),
    'module_on', app.module_enabled(p_center, 'accounting'),
    'can_connect', app.qbo_can_connect(p_center),
    'can_manage', app.has_permission(p_center, 'accounting.manage'),
    'connection', case when c.id is null then null else jsonb_build_object(
      'id', c.id, 'provider', c.provider, 'status', c.status, 'display_name', c.display_name, 'realm_id', c.external_account_id,
      'company', coalesce(c.settings->>'company', case when c.provider = 'intuit_sandbox' then 'sandbox' else 'real' end),
      'read_only', coalesce((c.settings->>'read_only')::boolean, false), 'mode', c.settings->>'mode',
      'connected_at', c.connected_at, 'connected_by', v_name->>(c.connected_by::text), 'token_expires_at', c.token_expires_at,
      'access_expires_at', c.settings->>'access_expires_at', 'last_refresh_at', c.settings->>'last_refresh_at',
      'connect_state', c.settings->>'connect_state', 'last_error', c.last_error,
      'alert', case when c.settings ? 'alert_subject' then jsonb_build_object('subject', c.settings->>'alert_subject', 'detail', c.settings->>'alert_detail',
                                                                            'at', c.settings->>'alert_at', 'outcome', c.settings->>'alert_outcome') end) end,
    'other_connection', case when o.id is null then null else jsonb_build_object('provider', o.provider, 'status', o.status, 'display_name', o.display_name) end,
    'settings', jsonb_build_object(
      'basis', c.settings->>'basis', 'posting', c.settings->>'posting', 'go_live_date', c.settings->>'go_live_date',
      'basis_chosen_at', c.settings->>'basis_chosen_at', 'basis_chosen_by', v_name->>(c.settings->>'basis_chosen_by'),
      'basis_changed_at', c.settings->>'basis_changed_at', 'basis_changed_by', v_name->>(c.settings->>'basis_changed_by'),
      'basis_changed_from', c.settings->>'basis_changed_from', 'basis_note', c.settings->>'basis_note',
      'mapping_approved_at', c.settings->>'mapping_approved_at', 'mapping_approved_by', v_name->>(c.settings->>'mapping_approved_by'),
      'test_post_approved_at', c.settings->>'test_post_approved_at', 'test_post_approved_by', v_name->>(c.settings->>'test_post_approved_by')),
    'suggested_basis', case when v_suggested in ('cash','accrual') then v_suggested end,
    'accrual_waiting', c.settings->>'basis' = 'accrual',
    'postings_waiting', v_waiting,
    'lists', v_counts,
    'last_pull', case when v_run.id is null then null else jsonb_build_object('status', v_run.status, 'finished_at', v_run.finished_at,
                                                                               'error', v_run.error, 'counts', v_run.counts, 'changed', v_run.changed) end,
    'warnings', app.qbo_mapping_warnings(p_center),
    'required_purposes', to_jsonb(app.qbo_required_purposes(p_center)),
    'missing_purposes', to_jsonb(v_missing),
    'test_post', case when v_test.id is null then null else jsonb_build_object(
      'id', v_test.id, 'mode', v_test.mode, 'status', v_test.status, 'results', v_test.results, 'error', v_test.error,
      'requested_at', v_test.requested_at, 'requested_by', v_name->>(v_test.requested_by::text), 'finished_at', v_test.finished_at,
      'approved_at', v_test.approved_at, 'approved_by', v_name->>(v_test.approved_by::text)) end,
    'post_ready', app.qbo_post_ready(p_center),
    'readiness', app.check_quickbooks_ready(p_center),
    'jobs', v_jobs);
end $$;

revoke execute on function app._qbo_apply_basis(uuid, text), app.set_qbo_basis(uuid, text, text), app.set_qbo_settings(uuid, text, text, date, text),
  app.qbo_account_mappings_guard(), app.qbo_post_ready(uuid), app.check_quickbooks_ready(uuid), app.qbo_status(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.set_qbo_basis(uuid, text, text), app.set_qbo_settings(uuid, text, text, date, text), app.qbo_status(uuid),
  app.qbo_accrual_waiting_text() to authenticated;
