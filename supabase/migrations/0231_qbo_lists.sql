-- Onboarding (stream o-quickbooks) · 2 of 6: read-only copies of the
-- QuickBooks chart of accounts and lists (plan §1.7.2, Appendix A1 "Accounting:
-- Chart of accounts, classes, locations, items, tax codes, payment methods —
-- QuickBooks, read-only, never uploaded").
--
--   app.qbo_accounts, qbo_classes, qbo_locations, qbo_items, qbo_tax_codes,
--   qbo_payment_methods      written only by the background service
--                            (app.qbo_worker_store_list), never by people
--   app.qbo_pull_runs        one row per pull: counts, warnings, error
--   app.request_qbo_pull     "Pull now" (daily pulls are queued by the service)
--   app.qbo_mapping_warnings a mapped account renamed / made inactive / gone;
--                            a fund's class made inactive / gone
--
-- Each copy row belongs to the connection it was pulled from (connection_id),
-- so an Intuit sandbox company and the real company never mix and nothing has
-- to be deleted when a sandbox switches companies. synced_at is when the row
-- last changed in a pull (the pull run says when the last pull finished), so a
-- daily pull that changes nothing adds no audit entries.
set client_min_messages = warning;

create table if not exists app.qbo_accounts (
  center_id            uuid not null references app.centers(id) on delete cascade,
  connection_id        uuid not null references app.integration_connections(id) on delete cascade,
  qbo_id               text not null,
  name                 text not null,
  fully_qualified_name text,
  account_type         text,
  account_sub_type     text,
  classification       text,
  active               boolean not null default true,
  currency             text,
  raw                  jsonb not null default '{}'::jsonb,
  synced_at            timestamptz not null default now(),
  primary key (connection_id, qbo_id)
);
create index if not exists qbo_accounts_center_idx on app.qbo_accounts (center_id, connection_id, account_type);

do $$
declare t text;
begin
  foreach t in array array['qbo_classes','qbo_locations','qbo_items','qbo_tax_codes','qbo_payment_methods'] loop
    execute format($f$
      create table if not exists app.%I (
        center_id     uuid not null references app.centers(id) on delete cascade,
        connection_id uuid not null references app.integration_connections(id) on delete cascade,
        qbo_id        text not null,
        name          text not null,
        active        boolean not null default true,
        raw           jsonb not null default '{}'::jsonb,
        synced_at     timestamptz not null default now(),
        primary key (connection_id, qbo_id)
      )$f$, t);
    execute format('create index if not exists %I on app.%I (center_id, connection_id)', t || '_center_idx', t);
  end loop;
end $$;

create table if not exists app.qbo_pull_runs (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  connection_id uuid not null references app.integration_connections(id) on delete cascade,
  job_id        bigint,
  status        text not null check (status in ('succeeded','failed')),
  counts        jsonb not null default '{}'::jsonb,     -- {accounts: n, classes: n, ...}
  changed       jsonb not null default '{}'::jsonb,     -- rows added or changed, per list
  warnings      jsonb not null default '[]'::jsonb,     -- app.qbo_mapping_warnings after the pull
  error         text,
  finished_at   timestamptz not null default now()
);
create index if not exists qbo_pull_runs_center_idx on app.qbo_pull_runs (center_id, finished_at desc);

insert into app.module_tables (table_name, module_key) values
  ('qbo_accounts', 'accounting'), ('qbo_classes', 'accounting'), ('qbo_locations', 'accounting'), ('qbo_items', 'accounting'),
  ('qbo_tax_codes', 'accounting'), ('qbo_payment_methods', 'accounting'), ('qbo_pull_runs', 'accounting')
on conflict (table_name) do update set module_key = excluded.module_key;

do $$
declare t text;
begin
  foreach t in array array['qbo_accounts','qbo_classes','qbo_locations','qbo_items','qbo_tax_codes','qbo_payment_methods'] loop
    execute format('drop trigger if exists %I on app.%I', 'audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on app.%I for each row execute function app.audit_row(%L, %L)',
                   'audit_' || t, t, 'connection_id', 'qbo_id');
  end loop;
  foreach t in array array['qbo_accounts','qbo_classes','qbo_locations','qbo_items','qbo_tax_codes','qbo_payment_methods','qbo_pull_runs'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('drop policy if exists %I on app.%I', t || '_read', t);
    execute format('create policy %I on app.%I for select to authenticated using (app.qbo_can_view(center_id))', t || '_read', t);
    perform app._qbo_module_switch(t);
    execute format('revoke all on app.%I from public, anon, authenticated, service_role, connect_worker', t);
    execute format('grant select on app.%I to authenticated', t);
    execute format('grant all on app.%I to service_role', t);
  end loop;
end $$;
drop trigger if exists audit_qbo_pull_runs on app.qbo_pull_runs;
create trigger audit_qbo_pull_runs after insert or update or delete on app.qbo_pull_runs
  for each row execute function app.audit_row();

-- ── Written by the background service only ───────────────────────────────────
-- p_list: accounts | classes | locations | items | tax_codes | payment_methods.
-- p_rows: [{qbo_id, name, active, raw, (accounts:) fully_qualified_name,
-- account_type, account_sub_type, classification, currency}]. Upsert only:
-- nothing is ever deleted (QuickBooks itself only makes lists inactive).
-- Returns how many rows were added or changed.
create or replace function app.qbo_worker_store_list(p_connection uuid, p_list text, p_rows jsonb)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_n int; v_table text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Background service: QuickBooks lists pulled');
  select * into c from app.integration_connections where id = p_connection and provider in ('quickbooks_online','intuit_sandbox');
  if c.id is null then raise exception 'QuickBooks connection % was not found.', p_connection; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'The rows must be a JSON array.'; end if;
  if p_list = 'accounts' then
    insert into app.qbo_accounts as a (center_id, connection_id, qbo_id, name, fully_qualified_name, account_type, account_sub_type,
                                       classification, active, currency, raw, synced_at)
    select c.center_id, c.id, r->>'qbo_id', left(coalesce(nullif(r->>'name', ''), '(no name)'), 300), r->>'fully_qualified_name',
           r->>'account_type', r->>'account_sub_type', r->>'classification', coalesce((r->>'active')::boolean, true), r->>'currency',
           coalesce(r->'raw', '{}'::jsonb), now()
      from jsonb_array_elements(p_rows) r
     where nullif(r->>'qbo_id', '') is not null
    on conflict (connection_id, qbo_id) do update
      set name = excluded.name, fully_qualified_name = excluded.fully_qualified_name, account_type = excluded.account_type,
          account_sub_type = excluded.account_sub_type, classification = excluded.classification, active = excluded.active,
          currency = excluded.currency, raw = excluded.raw, synced_at = now()
      where (a.name, a.fully_qualified_name, a.account_type, a.account_sub_type, a.classification, a.active, a.currency, a.raw)
            is distinct from (excluded.name, excluded.fully_qualified_name, excluded.account_type, excluded.account_sub_type,
                              excluded.classification, excluded.active, excluded.currency, excluded.raw);
    get diagnostics v_n = row_count;
    return v_n;
  end if;
  v_table := case p_list when 'classes' then 'qbo_classes' when 'locations' then 'qbo_locations' when 'items' then 'qbo_items'
                         when 'tax_codes' then 'qbo_tax_codes' when 'payment_methods' then 'qbo_payment_methods' end;
  if v_table is null then raise exception 'Unknown QuickBooks list "%".', p_list; end if;
  execute format($f$
    insert into app.%1$I as t (center_id, connection_id, qbo_id, name, active, raw, synced_at)
    select $1, $2, r->>'qbo_id', left(coalesce(nullif(r->>'name', ''), '(no name)'), 300), coalesce((r->>'active')::boolean, true),
           coalesce(r->'raw', '{}'::jsonb), now()
      from jsonb_array_elements($3) r
     where nullif(r->>'qbo_id', '') is not null
    on conflict (connection_id, qbo_id) do update
      set name = excluded.name, active = excluded.active, raw = excluded.raw, synced_at = now()
      where (t.name, t.active, t.raw) is distinct from (excluded.name, excluded.active, excluded.raw)$f$, v_table)
    using c.center_id, c.id, p_rows;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── Warnings for the mapping ─────────────────────────────────────────────────
-- [{level: 'error'|'warning', purpose|fund_id, text}] against the chart pulled
-- from the connection in use. 'error' blocks approval and posting; a rename is
-- a 'warning' (approving again takes the new name).
create or replace function app.qbo_mapping_warnings(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v jsonb := '[]'; r record;
begin
  select * into c from app.qbo_connection(p_center);
  if c.id is null or not exists (select 1 from app.qbo_pull_runs where connection_id = c.id and status = 'succeeded') then
    return v;
  end if;
  for r in
    select m.purpose, m.qbo_account_id, m.qbo_account_name, a.name, a.active, a.qbo_id is not null as found
      from app.qbo_account_mappings m
      left join app.qbo_accounts a on a.connection_id = c.id and a.qbo_id = m.qbo_account_id
     where m.center_id = p_center
     order by m.purpose
  loop
    if not r.found then
      v := v || jsonb_build_array(jsonb_build_object('level', 'error', 'purpose', r.purpose,
        'text', format('The account mapped for %s (%s) is no longer in QuickBooks. Choose another account.', r.purpose, coalesce(r.qbo_account_name, 'id ' || r.qbo_account_id))));
    elsif not r.active then
      v := v || jsonb_build_array(jsonb_build_object('level', 'error', 'purpose', r.purpose,
        'text', format('"%s", mapped for %s, is inactive in QuickBooks. Make it active there or choose another account.', r.name, r.purpose)));
    elsif r.qbo_account_name is distinct from r.name then
      v := v || jsonb_build_array(jsonb_build_object('level', 'warning', 'purpose', r.purpose,
        'text', format('The account mapped for %s was renamed in QuickBooks from "%s" to "%s". Check it is still right, then approve the mapping again.',
                       r.purpose, coalesce(r.qbo_account_name, '?'), r.name)));
    end if;
  end loop;
  for r in
    select f.id, f.name as fund, f.qbo_class_id, k.name, k.active, k.qbo_id is not null as found
      from app.funds f
      left join app.qbo_classes k on k.connection_id = c.id and k.qbo_id = f.qbo_class_id
     where f.center_id = p_center and f.active and f.qbo_class_id is not null
     order by f.name
  loop
    if not r.found then
      v := v || jsonb_build_array(jsonb_build_object('level', 'error', 'fund_id', r.id,
        'text', format('The QuickBooks class of the fund "%s" is no longer in QuickBooks. Choose another class.', r.fund)));
    elsif not r.active then
      v := v || jsonb_build_array(jsonb_build_object('level', 'error', 'fund_id', r.id,
        'text', format('The class "%s" of the fund "%s" is inactive in QuickBooks.', r.name, r.fund)));
    end if;
  end loop;
  return v;
end $$;

-- The pull finished (or failed). Records the run, refreshes the warnings, and
-- raises an alert when a mapped account went inactive or disappeared.
create or replace function app.qbo_worker_pull_done(p_connection uuid, p_job bigint, p_ok boolean, p_counts jsonb, p_changed jsonb, p_error text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_warn jsonb; v_id uuid; v_errors int;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context(case when p_ok then 'Background service: QuickBooks lists pulled' else 'Background service: QuickBooks pull failed' end);
  select * into c from app.integration_connections where id = p_connection;
  if c.id is null then raise exception 'QuickBooks connection % was not found.', p_connection; end if;
  insert into app.qbo_pull_runs (center_id, connection_id, job_id, status, counts, changed, error)
  values (c.center_id, c.id, p_job, case when p_ok then 'succeeded' else 'failed' end, coalesce(p_counts, '{}'), coalesce(p_changed, '{}'),
          case when p_ok then null else left(coalesce(p_error, 'The pull failed.'), 2000) end)
  returning id into v_id;
  v_warn := app.qbo_mapping_warnings(c.center_id);
  update app.qbo_pull_runs set warnings = v_warn where id = v_id;
  update app.integration_connections
     set settings = settings || jsonb_build_object('last_pull_at', now(), 'last_pull_ok', p_ok)
   where id = c.id;
  select count(*) into v_errors from jsonb_array_elements(v_warn) w where w->>'level' = 'error';
  if p_ok and v_errors > 0 and exists (select 1 from app.qbo_account_mappings where center_id = c.center_id and approved_at is not null) then
    perform app.qbo_alert(c.id, 'A mapped QuickBooks account changed',
      (select string_agg(w->>'text', ' ') from jsonb_array_elements(v_warn) w where w->>'level' = 'error'));
  end if;
  if to_regprocedure('app.qbo_sync_setup_steps(uuid)') is not null then
    execute 'select app.qbo_sync_setup_steps($1)' using c.center_id;
  end if;
  return jsonb_build_object('run_id', v_id, 'warnings', v_warn);
end $$;

-- "Pull now": accounting.manage, integrations.manage or the owner.
create or replace function app.request_qbo_pull(p_center uuid) returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_job bigint;
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not (app.has_permission(p_center, 'accounting.manage') or app.has_permission(p_center, 'integrations.manage') or app.is_center_owner(p_center)) then
    raise exception 'Pulling the QuickBooks lists needs accounting.manage or integrations.manage.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from app.qbo_connection(p_center);
  if c.id is null or c.status not in ('connected','expiring') then
    raise exception 'Connect QuickBooks first; the lists are pulled from the connected company.';
  end if;
  select id into v_job from app.jobs where center_id = p_center and kind = 'qbo.pull_lists' and status in ('queued','running')
   order by id desc limit 1;
  if v_job is not null then return v_job; end if;
  return app.enqueue_job(p_center, 'qbo.pull_lists', jsonb_build_object('connection_id', c.id, 'why', 'requested'), now(), 3);
end $$;

revoke execute on function app.qbo_worker_store_list(uuid, text, jsonb), app.qbo_mapping_warnings(uuid),
  app.qbo_worker_pull_done(uuid, bigint, boolean, jsonb, jsonb, text), app.request_qbo_pull(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.request_qbo_pull(uuid) to authenticated;
grant execute on function app.qbo_worker_store_list(uuid, text, jsonb), app.qbo_worker_pull_done(uuid, bigint, boolean, jsonb, jsonb, text)
  to connect_worker;
