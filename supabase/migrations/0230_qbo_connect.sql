-- Onboarding (stream o-quickbooks) · 1 of 6: connecting QuickBooks Online
-- (docs/ONBOARDING_PLAN.md §4 Step 1.7, "Connect"; ONBOARDING_WAVE_B.md
-- "QuickBooks (o-quickbooks)").
--
--   provider 'intuit_sandbox'     an Intuit sandbox company (o-payments owns the
--                                 0210 change of the provider check; added here
--                                 only when it is missing, so this branch runs alone)
--   app.qbo_connection(center)    the QuickBooks connection in use: 'quickbooks_online'
--                                 (the real company) or 'intuit_sandbox'
--   app.qbo_oauth_states          one row per "Connect QuickBooks" click: the hash of a
--                                 random single-use nonce, bound to the center, the
--                                 connection and the person, valid 15 minutes
--   app.start_qbo_connect(...)    step-up + reason; sandbox vs real read-only per the
--                                 entitlement qbo.mode; returns the nonce (the portal
--                                 signs it into the OAuth state)
--   app.complete_qbo_connect(...) the callback: single use, same person; the code goes to
--                                 the vault as "oauth.code" and an oauth.exchange job is
--                                 queued (the code never enters a job payload)
--   app.fail_qbo_connect(...)     Intuit sent the person back without a code
--   app.disconnect_qbo(...)       step-up + reason
--   app.set_qbo_settings(...)     basis, posting, go-live date (accounting.manage)
--   worker side (connect_worker): qbo_worker_connection, qbo_worker_connected,
--                                 qbo_worker_tokens_refreshed, qbo_worker_connection_problem
--
-- Connection settings keys (contract): mode (test|live), read_only, company
-- (sandbox|real), basis (cash|accrual), posting (per_txn|daily_summary),
-- go_live_date, mapping_approved_by/at, test_post_approved_by/at, plus
-- access_expires_at, refresh_expires_at, last_refresh_at, connect_state,
-- last_pull_at, last_pull_ok, alert_* kept by the background service.
--
-- Who may connect: the owner, integrations.manage, or accounting.manage (the
-- treasurer connects QuickBooks, plan §1.7) through a grant in THAT center; like
-- the vault, there is no platform-admin shortcut for credentials.
set client_min_messages = warning;

-- ── The provider list must allow 'intuit_sandbox' ────────────────────────────
do $$
declare v_def text; v_list text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'app.integration_connections'::regclass and conname = 'integration_connections_provider_check';
  if v_def is null or v_def like '%intuit_sandbox%' then return; end if;
  select array_agg(m[1]) into v_list from regexp_matches(v_def, '''([a-z_]+)''', 'g') as m;
  alter table app.integration_connections drop constraint integration_connections_provider_check;
  execute format('alter table app.integration_connections add constraint integration_connections_provider_check check (provider = any (%L::text[]))',
                 v_list || array['intuit_sandbox']);
end $$;

-- ── Which connection is in use ───────────────────────────────────────────────
-- A center has at most one QuickBooks connection in use: the real company
-- (quickbooks_online) or an Intuit sandbox company (intuit_sandbox). A
-- disconnected row only counts when there is no other.
create or replace function app.qbo_connection(p_center uuid) returns app.integration_connections
language sql stable security definer set search_path = app, public, extensions as $$
  select c.* from app.integration_connections c
   where c.center_id = p_center and c.provider in ('quickbooks_online','intuit_sandbox')
   order by (c.status <> 'disconnected') desc, c.connected_at desc nulls last, (c.provider = 'quickbooks_online') desc
   limit 1
$$;

-- o-import's go-live rule (0191) reads the connection in use, so an Intuit
-- sandbox company's go-live date counts too. Same rule otherwise.
create or replace function app.qbo_go_live_date(p_center uuid) returns date
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v text;
begin
  select c.settings->>'go_live_date' into v from app.qbo_connection(p_center) c;
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return v::date;
exception when others then
  return null;   -- a malformed date in settings is "not set"; the QuickBooks setup screen shows it
end $$;

-- Owner, or integrations.manage / accounting.manage through a grant in this center.
create or replace function app.qbo_can_connect(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and (
    app.is_center_owner(p_center)
    or exists (
      select 1 from app.role_grants g join app.roles r on r.key = g.role_key
       where g.center_id = p_center and g.user_id = auth.uid()
         and g.scope_kind in ('center','platform')
         and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
         and coalesce(to_jsonb(g)->>'status', 'active') = 'active'
         and (r.permissions ? 'integrations.manage' or r.permissions ? 'accounting.manage' or r.permissions ? '*')))
$$;

-- Who may see QuickBooks setup: the ledger and connection readers (RLS of 0010).
create or replace function app.qbo_can_view(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.has_permission(p_center, 'accounting.manage') or app.has_permission(p_center, 'giving.view')
      or app.has_permission(p_center, 'integrations.view') or app.has_permission(p_center, 'integrations.manage')
      or app.is_center_owner(p_center)
$$;

-- The restrictive module_switch policy of 0103, for a table added later.
create or replace function app._qbo_module_switch(p_table text) returns void
language plpgsql set search_path = app, public, extensions as $$
declare v_qual text := '(select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers(''accounting''))::uuid[]))';
begin
  execute format('drop policy if exists module_switch on app.%I', p_table);
  execute format('create policy module_switch on app.%I as restrictive for all to public using (%s) with check (%s)', p_table, v_qual, v_qual);
end $$;

-- ── OAuth state ──────────────────────────────────────────────────────────────
create table if not exists app.qbo_oauth_states (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  connection_id uuid not null references app.integration_connections(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  nonce_hash    text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  company       text not null check (company in ('sandbox','real')),
  redirect_uri  text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '15 minutes',
  used_at       timestamptz,
  outcome       text check (outcome in ('code_received','refused','expired','wrong_person'))
);
create index if not exists qbo_oauth_states_center_idx on app.qbo_oauth_states (center_id, created_at desc);
comment on table app.qbo_oauth_states is
  'One "Connect QuickBooks" attempt: sha-256 of a single-use nonce bound to center, connection and person (15 minutes). The nonce itself is never stored.';

insert into app.module_tables (table_name, module_key) values ('qbo_oauth_states', 'accounting')
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_qbo_oauth_states on app.qbo_oauth_states;
create trigger audit_qbo_oauth_states after insert or update or delete on app.qbo_oauth_states
  for each row execute function app.audit_row();
alter table app.qbo_oauth_states enable row level security;
drop policy if exists qbo_oauth_states_read on app.qbo_oauth_states;
create policy qbo_oauth_states_read on app.qbo_oauth_states for select to authenticated
  using (app.has_permission(center_id, 'integrations.view') or app.has_permission(center_id, 'integrations.manage')
         or app.has_permission(center_id, 'accounting.manage') or app.is_center_owner(center_id));
do $$ begin perform app._qbo_module_switch('qbo_oauth_states'); end $$;
revoke all on app.qbo_oauth_states from public, anon, authenticated, service_role;
grant select (id, center_id, connection_id, user_id, company, created_at, expires_at, used_at, outcome) on app.qbo_oauth_states to authenticated;
grant all on app.qbo_oauth_states to service_role;

-- A secret written by a definer function on the caller's behalf (the OAuth code).
-- Same storage as app.worker_store_secret (0173); not callable over the API.
create or replace function app._qbo_put_secret(p_connection uuid, p_name text, p_value text, p_label text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_provider text; s app.integration_secrets; v_vault uuid;
begin
  select center_id, provider into v_center, v_provider from app.integration_connections where id = p_connection;
  if v_center is null then raise exception 'That connection was not found.'; end if;
  if p_value is null or char_length(p_value) < 8 or char_length(p_value) > 65536 then
    raise exception 'The % from QuickBooks is empty or not the right length.', p_label;
  end if;
  select * into s from app.integration_secrets where connection_id = p_connection and name = p_name for update;
  if found then
    perform vault.update_secret(s.vault_secret_id, p_value);
    update app.integration_secrets set fingerprint = right(p_value, 4), set_by = auth.uid(), set_at = now(), rotated_at = now()
     where id = s.id;
  else
    v_vault := vault.create_secret(p_value, 'connect/' || p_connection || '/' || p_name,
                                   'Community Connect ' || v_provider || ' secret "' || p_name || '"');
    insert into app.integration_secrets (center_id, connection_id, name, vault_secret_id, fingerprint, set_by)
    values (v_center, p_connection, p_name, v_vault, right(p_value, 4), auth.uid());
  end if;
  return jsonb_build_object('name', p_name, 'fingerprint', right(p_value, 4));
end $$;

-- ── Alerts ───────────────────────────────────────────────────────────────────
-- Tells the people who look after QuickBooks that something needs them: the
-- email goes through o-messaging's app.enqueue_message when it exists (to the
-- person who connected and to the owner); the alert is always kept on the
-- connection (settings.alert_*), where the QuickBooks screens show it.
-- At most one email per connection and subject a day.
create or replace function app.qbo_alert(p_connection uuid, p_subject text, p_detail text)
returns text language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_to text[]; v_addr text; v_sent int := 0; v_outcome text;
begin
  select * into c from app.integration_connections where id = p_connection;
  if c.id is null then return 'no connection'; end if;
  if c.settings->>'alert_subject' = p_subject and (c.settings->>'alert_at')::timestamptz > now() - interval '1 day' then
    return 'already alerted today';
  end if;
  select coalesce(array_agg(distinct u.email) filter (where u.email is not null), '{}') into v_to
    from auth.users u
   where u.id = c.connected_by
      or (to_regclass('app.center_owners') is not null
          and u.id in (select o.user_id from app.center_owners o where o.center_id = c.center_id));
  if to_regprocedure('app.enqueue_message(uuid,text,text,text,jsonb,text)') is null then
    v_outcome := 'email sending is not set up yet; shown on the QuickBooks screens';
  else
    foreach v_addr in array v_to loop
      begin
        execute 'select app.enqueue_message($1, ''email'', $2, ''qbo_connection_alert'', $3, ''notification'')'
          using c.center_id, v_addr, jsonb_build_object('subject', p_subject, 'detail', p_detail, 'company', c.display_name);
        v_sent := v_sent + 1;
      exception when others then
        v_outcome := 'the email could not be queued (' || sqlerrm || ')';
      end;
    end loop;
    v_outcome := coalesce(v_outcome, v_sent || ' email' || case when v_sent = 1 then '' else 's' end || ' queued');
  end if;
  update app.integration_connections
     set settings = settings || jsonb_build_object('alert_subject', p_subject, 'alert_detail', p_detail,
                                                   'alert_at', now(), 'alert_outcome', v_outcome)
   where id = p_connection;
  return v_outcome;
end $$;

-- ── Connect ──────────────────────────────────────────────────────────────────
-- p_company: 'real' (the organization's QuickBooks company) or 'sandbox' (an
-- Intuit sandbox company). In a sandbox community (qbo.mode
-- "sandbox_or_read_only") the real company is read-only and every mode is test;
-- a live community (qbo.mode "live") connects its real company only.
create or replace function app.start_qbo_connect(p_center uuid, p_company text, p_redirect_uri text, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_env text; v_ent text; v_provider text; v_read_only boolean; v_mode text; v_conn app.integration_connections;
        v_other app.integration_connections; v_nonce text; v_carry jsonb := '{}';
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  perform app.assert_module_enabled(p_center, 'accounting');
  if not app.qbo_can_connect(p_center) then
    raise exception 'Connecting QuickBooks needs the organization owner, or the integrations.manage or accounting.manage permission.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_company is null or p_company not in ('sandbox','real') then
    raise exception 'Choose which QuickBooks company to connect: your real company or an Intuit sandbox company.';
  end if;
  if p_redirect_uri is null or p_redirect_uri !~ '^https?://[A-Za-z0-9.:\-\[\]]+/api/oauth/intuit/callback$' then
    raise exception 'The QuickBooks return address is not valid (%).', coalesce(p_redirect_uri, 'none');
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why QuickBooks is being connected.'; end if;

  select environment into v_env from app.centers where id = p_center;
  v_ent := app.entitlement(p_center, 'qbo.mode') #>> '{}';
  if v_env = 'sandbox' then
    if p_company = 'sandbox' then
      v_provider := 'intuit_sandbox'; v_read_only := false; v_mode := 'test';
    else
      v_provider := 'quickbooks_online';
      v_read_only := coalesce(v_ent, '') <> 'live';
      v_mode := case when v_read_only then 'test' else 'live' end;
    end if;
  else
    if p_company = 'sandbox' then
      raise exception 'A live community connects its real QuickBooks company. Intuit sandbox companies are for sandboxes.'
        using errcode = 'CCENT';
    end if;
    perform app.assert_entitlement(p_center, 'qbo.mode', '"live"'::jsonb);
    v_provider := 'quickbooks_online'; v_read_only := false; v_mode := 'live';
  end if;

  select * into v_other from app.integration_connections
   where center_id = p_center and provider in ('quickbooks_online','intuit_sandbox') and provider <> v_provider
     and status <> 'disconnected';
  if v_other.id is not null then
    raise exception 'Another QuickBooks company (%) is connected. Disconnect it first, then connect this one.',
      coalesce(v_other.display_name, case when v_other.provider = 'intuit_sandbox' then 'the Intuit sandbox company' else 'the real company' end);
  end if;

  perform app.assert_step_up('qbo.connect');
  perform app.set_audit_context(p_reason);

  -- Basis, posting and go-live chosen on the other company carry over.
  select coalesce(jsonb_strip_nulls(jsonb_build_object('basis', c.settings->'basis', 'posting', c.settings->'posting',
                                                       'go_live_date', c.settings->'go_live_date')), '{}')
    into v_carry
    from app.integration_connections c
   where c.center_id = p_center and c.provider in ('quickbooks_online','intuit_sandbox') and c.provider <> v_provider;

  insert into app.integration_connections (center_id, provider, status, settings)
  values (p_center, v_provider, 'disconnected',
          coalesce(v_carry, '{}') || jsonb_build_object('mode', v_mode, 'read_only', v_read_only, 'company', p_company,
                                                        'connect_state', 'signing_in'))
  on conflict (center_id, provider) do update
    set settings = coalesce(v_carry, '{}') || app.integration_connections.settings
                   || jsonb_build_object('mode', v_mode, 'read_only', v_read_only, 'company', p_company, 'connect_state', 'signing_in')
  returning * into v_conn;

  v_nonce := encode(extensions.gen_random_bytes(32), 'hex');
  insert into app.qbo_oauth_states (center_id, connection_id, user_id, nonce_hash, company, redirect_uri)
  values (p_center, v_conn.id, auth.uid(), encode(extensions.digest(v_nonce, 'sha256'), 'hex'), p_company, p_redirect_uri);

  return jsonb_build_object('nonce', v_nonce, 'connection_id', v_conn.id, 'provider', v_provider, 'company', p_company,
                            'read_only', v_read_only, 'mode', v_mode, 'environment', v_env);
end $$;

-- The callback. Returns {ok, error?, connection_id, job_id}; a refused state is
-- recorded (used, with the outcome) before answering, so it cannot be replayed.
create or replace function app.complete_qbo_connect(p_nonce text, p_code text, p_realm_id text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.qbo_oauth_states; c app.integration_connections; v_job bigint;
begin
  select * into s from app.qbo_oauth_states
   where nonce_hash = encode(extensions.digest(coalesce(p_nonce, ''), 'sha256'), 'hex') for update;
  if s.id is null then
    return jsonb_build_object('ok', false, 'error', 'This QuickBooks sign-in link is not recognised. Start the connection again from Accounting › QuickBooks setup.');
  end if;
  if s.used_at is not null then
    return jsonb_build_object('ok', false, 'error', 'This QuickBooks sign-in link was already used. Start the connection again.');
  end if;
  if s.user_id is distinct from auth.uid() then
    update app.qbo_oauth_states set used_at = now(), outcome = 'wrong_person' where id = s.id;
    return jsonb_build_object('ok', false, 'error', 'This QuickBooks sign-in was started by someone else. Sign in as that person, or start again.');
  end if;
  if s.expires_at < now() then
    update app.qbo_oauth_states set used_at = now(), outcome = 'expired' where id = s.id;
    return jsonb_build_object('ok', false, 'error', 'The QuickBooks sign-in took longer than 15 minutes. Start the connection again.');
  end if;
  perform app.assert_module_enabled(s.center_id, 'accounting');
  if not app.qbo_can_connect(s.center_id) then
    raise exception 'Connecting QuickBooks needs the organization owner, or the integrations.manage or accounting.manage permission.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_realm_id is null or p_realm_id !~ '^[0-9]{1,30}$' then
    update app.qbo_oauth_states set used_at = now(), outcome = 'refused' where id = s.id;
    return jsonb_build_object('ok', false, 'error', 'QuickBooks did not say which company was chosen. Start the connection again.');
  end if;
  if p_code is null or char_length(p_code) < 8 or char_length(p_code) > 4000 then
    update app.qbo_oauth_states set used_at = now(), outcome = 'refused' where id = s.id;
    return jsonb_build_object('ok', false, 'error', 'QuickBooks did not send a usable sign-in code. Start the connection again.');
  end if;

  perform set_config('app.audit_reason', 'QuickBooks sign-in returned (company ' || p_realm_id || ')', true);
  update app.qbo_oauth_states set used_at = now(), outcome = 'code_received' where id = s.id;
  select * into c from app.integration_connections where id = s.connection_id for update;

  -- A different company than before: the old mapping and test post were for other books.
  if c.external_account_id is not null and c.external_account_id <> p_realm_id then
    perform set_config('app.qbo_mapping_approval', 'on', true);
    update app.qbo_account_mappings set approved_by = null, approved_at = null where center_id = c.center_id and approved_at is not null;
    perform set_config('app.qbo_mapping_approval', '', true);
    c.settings := c.settings - 'mapping_approved_by' - 'mapping_approved_at' - 'test_post_approved_by' - 'test_post_approved_at';
  end if;

  perform app._qbo_put_secret(c.id, 'oauth.code', p_code, 'sign-in code');
  update app.integration_connections
     set external_account_id = p_realm_id, connected_by = auth.uid(), last_error = null,
         settings = c.settings || jsonb_build_object('connect_state', 'exchanging')
   where id = c.id;
  v_job := app.enqueue_job(c.center_id, 'oauth.exchange',
                           jsonb_build_object('provider', 'intuit', 'connection_id', c.id, 'redirect_uri', s.redirect_uri,
                                              'code_secret', 'oauth.code',
                                              'intuit_app', case when c.provider = 'intuit_sandbox' then 'sandbox' else 'production' end),
                           now(), 3);
  return jsonb_build_object('ok', true, 'connection_id', c.id, 'job_id', v_job, 'center_id', c.center_id);
end $$;

-- Intuit sent the person back with an error (they cancelled, or refused access).
create or replace function app.fail_qbo_connect(p_nonce text, p_error text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.qbo_oauth_states; v_msg text;
begin
  select * into s from app.qbo_oauth_states
   where nonce_hash = encode(extensions.digest(coalesce(p_nonce, ''), 'sha256'), 'hex') for update;
  if s.id is null or s.used_at is not null or s.user_id is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'This QuickBooks sign-in link is not recognised or was already used.');
  end if;
  v_msg := case when p_error = 'access_denied' then 'QuickBooks sign-in was cancelled, or access was not allowed. Nothing was connected.'
                else 'QuickBooks refused the sign-in (' || left(regexp_replace(coalesce(p_error, 'unknown'), '[^A-Za-z0-9_ .-]', '', 'g'), 80) || '). Nothing was connected.' end;
  update app.qbo_oauth_states set used_at = now(), outcome = 'refused' where id = s.id;
  update app.integration_connections set last_error = v_msg, settings = settings || '{"connect_state":"refused"}'
   where id = s.connection_id;
  return jsonb_build_object('ok', true, 'message', v_msg);
end $$;

-- Disconnect: nothing posts any more and the tokens are removed from the vault
-- (the same thing Settings › Integrations › Disconnect does, 0170). The
-- company's lists, the mapping and the posting history stay.
create or replace function app.disconnect_qbo(p_center uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_n int;
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not app.qbo_can_connect(p_center) then
    raise exception 'Disconnecting QuickBooks needs the organization owner, or the integrations.manage or accounting.manage permission.'
      using errcode = 'insufficient_privilege';
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why QuickBooks is being disconnected.'; end if;
  select * into c from app.qbo_connection(p_center);
  if c.id is null or c.status = 'disconnected' then raise exception 'QuickBooks is not connected.'; end if;
  perform app.assert_step_up('qbo.disconnect');
  perform app.set_audit_context(p_reason);
  update app.integration_connections
     set status = 'disconnected', token_expires_at = null, last_error = null,
         settings = settings - 'access_expires_at' - 'refresh_expires_at' || jsonb_build_object('connect_state', 'disconnected')
   where id = c.id;
  delete from app.integration_secrets where connection_id = c.id and name in ('access_token','refresh_token','oauth.code');
  get diagnostics v_n = row_count;
  return jsonb_build_object('connection_id', c.id, 'tokens_removed', v_n);
end $$;

-- ── Choices (Step 1.7.3) ─────────────────────────────────────────────────────
-- Basis cash|accrual, posting per_txn|daily_summary, the go-live date (only
-- money received on or after it ever posts). Changing the basis asks for the
-- mapping to be approved again (it changes which accounts are needed).
create or replace function app.set_qbo_settings(p_center uuid, p_basis text, p_posting text, p_go_live_date date, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_new jsonb;
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not app.has_permission(p_center, 'accounting.manage') then
    raise exception 'Choosing the QuickBooks basis, posting and go-live date needs accounting.manage.' using errcode = 'insufficient_privilege';
  end if;
  if p_basis is null or p_basis not in ('cash','accrual') then raise exception 'Choose cash or accrual basis.'; end if;
  if p_posting is null or p_posting not in ('per_txn','daily_summary') then
    raise exception 'Choose to post each transaction, or a daily summary.';
  end if;
  if p_go_live_date is null then raise exception 'Choose the QuickBooks go-live date.'; end if;
  if p_go_live_date < date '2000-01-01' or p_go_live_date > current_date + 366 then
    raise exception 'The go-live date must be within the next year.';
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why these QuickBooks choices are being made.'; end if;
  select * into c from app.qbo_connection(p_center);
  if c.id is null then raise exception 'Connect QuickBooks first.'; end if;
  perform app.set_audit_context(p_reason);
  v_new := jsonb_build_object('basis', p_basis, 'posting', p_posting, 'go_live_date', to_char(p_go_live_date, 'YYYY-MM-DD'));
  if coalesce(c.settings->>'basis', 'cash') <> p_basis and c.settings ? 'mapping_approved_at' then
    perform set_config('app.qbo_mapping_approval', 'on', true);
    update app.qbo_account_mappings set approved_by = null, approved_at = null where center_id = p_center and approved_at is not null;
    perform set_config('app.qbo_mapping_approval', '', true);
    update app.integration_connections
       set settings = settings - 'mapping_approved_by' - 'mapping_approved_at' - 'test_post_approved_by' - 'test_post_approved_at' || v_new
     where id = c.id;
  else
    update app.integration_connections set settings = settings || v_new where id = c.id;
  end if;
  return v_new;
end $$;

-- ── The background service's side ────────────────────────────────────────────
create or replace function app.qbo_worker_connection(p_connection uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_env text;
begin
  perform app.assert_worker();
  select * into c from app.integration_connections where id = p_connection and provider in ('quickbooks_online','intuit_sandbox');
  if c.id is null then raise exception 'QuickBooks connection % was not found.', p_connection; end if;
  select environment into v_env from app.centers where id = c.center_id;
  return jsonb_build_object(
    'id', c.id, 'center_id', c.center_id, 'provider', c.provider, 'status', c.status, 'realm_id', c.external_account_id,
    'display_name', c.display_name, 'environment', v_env, 'settings', c.settings,
    'api', case when c.provider = 'intuit_sandbox' then 'sandbox' else 'production' end,
    'read_only', coalesce((c.settings->>'read_only')::boolean, false) or (v_env = 'sandbox' and c.provider <> 'intuit_sandbox'),
    'module_on', app.module_enabled(c.center_id, 'accounting'));
end $$;

create or replace function app._qbo_token_status(p_refresh_expires timestamptz) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case when p_refresh_expires is not null and p_refresh_expires < now() + interval '14 days' then 'expiring' else 'connected' end
$$;

-- oauth.exchange finished: tokens are in the vault.
create or replace function app.qbo_worker_connected(p_connection uuid, p_access_expires timestamptz, p_refresh_expires timestamptz,
                                                    p_company_name text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_job bigint;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Background service: QuickBooks connected');
  update app.integration_connections
     set status = app._qbo_token_status(p_refresh_expires), token_expires_at = p_refresh_expires, connected_at = now(),
         display_name = coalesce(nullif(btrim(p_company_name), ''), display_name), last_error = null,
         settings = settings - 'alert_subject' - 'alert_detail' - 'alert_at' - 'alert_outcome'
                    || jsonb_build_object('access_expires_at', p_access_expires, 'refresh_expires_at', p_refresh_expires,
                                          'last_refresh_at', now(), 'connect_state', 'connected')
   where id = p_connection and provider in ('quickbooks_online','intuit_sandbox')
  returning * into c;
  if c.id is null then raise exception 'QuickBooks connection % was not found.', p_connection; end if;
  -- First thing after connecting: pull the chart of accounts and lists.
  if not exists (select 1 from app.jobs where center_id = c.center_id and kind = 'qbo.pull_lists' and status in ('queued','running')) then
    v_job := app.enqueue_job(c.center_id, 'qbo.pull_lists', jsonb_build_object('connection_id', c.id, 'why', 'connected'), now(), 3);
  end if;
  if to_regprocedure('app.qbo_sync_setup_steps(uuid)') is not null then
    execute 'select app.qbo_sync_setup_steps($1)' using c.center_id;
  end if;
  return jsonb_build_object('status', c.status, 'pull_job', v_job);
end $$;

create or replace function app.qbo_worker_tokens_refreshed(p_connection uuid, p_access_expires timestamptz, p_refresh_expires timestamptz)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Background service: QuickBooks sign-in renewed');
  update app.integration_connections
     set status = case when status = 'disconnected' then status else app._qbo_token_status(p_refresh_expires) end,
         token_expires_at = p_refresh_expires,
         last_error = case when status = 'disconnected' then last_error end,
         settings = settings || jsonb_build_object('access_expires_at', p_access_expires, 'refresh_expires_at', p_refresh_expires,
                                                   'last_refresh_at', now())
   where id = p_connection
  returning * into c;
  if c.id is null then raise exception 'QuickBooks connection % was not found.', p_connection; end if;
  if c.status = 'expiring' then
    perform app.qbo_alert(c.id, 'QuickBooks needs to be connected again soon',
      'Intuit will stop accepting Community Connect''s sign-in to ' || coalesce(c.display_name, 'your QuickBooks company') || ' on '
      || to_char(p_refresh_expires at time zone 'UTC', 'FMMonth FMDD, YYYY') || '. Connect it again in Accounting › QuickBooks setup before then.');
  end if;
  return jsonb_build_object('status', c.status);
end $$;

-- Something went wrong with the connection. p_needs_reconnect: the tokens are
-- no good any more (Intuit said invalid_grant), so a person must connect again.
create or replace function app.qbo_worker_connection_problem(p_connection uuid, p_problem text, p_needs_reconnect boolean)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_alert text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Background service: QuickBooks connection problem');
  update app.integration_connections
     set last_error = left(coalesce(nullif(btrim(p_problem), ''), 'QuickBooks connection problem'), 1000),
         status = case when p_needs_reconnect and status <> 'disconnected' then 'error' else status end,
         settings = settings || jsonb_build_object('connect_state', case when p_needs_reconnect then 'reconnect_needed' else coalesce(settings->>'connect_state', 'connected') end)
   where id = p_connection
  returning * into c;
  if c.id is null then raise exception 'QuickBooks connection % was not found.', p_connection; end if;
  if p_needs_reconnect then
    v_alert := app.qbo_alert(c.id, 'QuickBooks needs to be connected again', c.last_error);
  end if;
  return jsonb_build_object('status', c.status, 'alert', v_alert);
end $$;

revoke execute on function app.qbo_connection(uuid), app.qbo_can_connect(uuid), app.qbo_can_view(uuid),
  app._qbo_module_switch(text), app._qbo_put_secret(uuid, text, text, text), app.qbo_alert(uuid, text, text),
  app.start_qbo_connect(uuid, text, text, text), app.complete_qbo_connect(text, text, text), app.fail_qbo_connect(text, text),
  app.disconnect_qbo(uuid, text), app.set_qbo_settings(uuid, text, text, date, text),
  app.qbo_worker_connection(uuid), app._qbo_token_status(timestamptz),
  app.qbo_worker_connected(uuid, timestamptz, timestamptz, text), app.qbo_worker_tokens_refreshed(uuid, timestamptz, timestamptz),
  app.qbo_worker_connection_problem(uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function app.qbo_can_connect(uuid), app.qbo_can_view(uuid), app.start_qbo_connect(uuid, text, text, text),
  app.complete_qbo_connect(text, text, text), app.fail_qbo_connect(text, text), app.disconnect_qbo(uuid, text),
  app.set_qbo_settings(uuid, text, text, date, text) to authenticated;
grant execute on function app.qbo_worker_connection(uuid), app.qbo_worker_connected(uuid, timestamptz, timestamptz, text),
  app.qbo_worker_tokens_refreshed(uuid, timestamptz, timestamptz), app.qbo_worker_connection_problem(uuid, text, boolean)
  to connect_worker;
