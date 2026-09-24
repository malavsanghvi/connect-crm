-- Onboarding (stream o-quickbooks) · 7 of 7: readiness check 7, the Setup
-- steps, the screen's status and the background service's daily round.
--
--   app.check_quickbooks_ready(c)  readiness 7 (plan §4 Step 8): QuickBooks not used
--                                  (Accounting off) passes; otherwise connected +
--                                  mapping approved + test post approved + go-live set
--   app.qbo_sync_setup_steps(c)    data.chart_of_accounts done once a pull succeeded;
--                                  svc.quickbooks in progress once connected, done
--                                  when check 7 passes (only ever moves forward)
--   app.qbo_status(c)              everything the QuickBooks setup screen shows
--   app.qbo_worker_due()           the hourly round: which connections need their
--                                  sign-in renewed, a daily pull, or the poster
set client_min_messages = warning;

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
  if c.settings->>'mapping_approved_at' is null then v_missing := v_missing || 'approve the account mapping'::text; end if;
  if c.settings->>'test_post_approved_at' is null then v_missing := v_missing || 'approve a test post'::text; end if;
  if app.qbo_go_live_date(p_center) is null then v_missing := v_missing || 'set the QuickBooks go-live date'::text; end if;
  select string_agg(w->>'text', ' ') into v_errors from jsonb_array_elements(app.qbo_mapping_warnings(p_center)) w where w->>'level' = 'error';
  if v_errors is not null then v_missing := v_missing || v_errors; end if;
  if cardinality(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'detail', 'Connected to ' || coalesce(c.display_name, 'QuickBooks') || '; still to do: '
                                                     || array_to_string(v_missing, '; ') || '.');
  end if;
  return jsonb_build_object('ok', true, 'detail',
    'Connected to ' || coalesce(c.display_name, 'QuickBooks')
    || case when coalesce((c.settings->>'read_only')::boolean, false) then ' (read-only)' when c.provider = 'intuit_sandbox' then ' (Intuit sandbox company)' else '' end
    || '; mapping approved ' || to_char((c.settings->>'mapping_approved_at')::timestamptz at time zone 'UTC', 'FMMonth FMDD, YYYY')
    || '; test post approved ' || to_char((c.settings->>'test_post_approved_at')::timestamptz at time zone 'UTC', 'FMMonth FMDD, YYYY')
    || '; go-live ' || to_char(app.qbo_go_live_date(p_center), 'FMMonth FMDD, YYYY') || '.');
end $$;

insert into app.readiness_checks (key, title, sort, check_fn)
values ('quickbooks_ready', 'QuickBooks connected, mapping and test post approved, go-live date set', 7, 'app.check_quickbooks_ready'::regproc)
on conflict (key) do update set title = excluded.title, sort = excluded.sort, check_fn = excluded.check_fn;

-- Only moves a step forward (not started -> in progress -> done); a status a
-- person set is left alone unless the step is now done.
create or replace function app.qbo_sync_setup_steps(p_center uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_coa text; v_svc text; v_rank constant jsonb := '{"not_started":0,"in_progress":1,"done":2}';
begin
  select * into c from app.qbo_connection(p_center);
  if c.id is null then return; end if;
  v_coa := case when exists (select 1 from app.qbo_pull_runs where connection_id = c.id and status = 'succeeded') then 'done'
                when c.status <> 'disconnected' then 'in_progress' end;
  v_svc := case when (app.check_quickbooks_ready(p_center)->>'ok')::boolean and app.module_enabled(p_center, 'accounting') then 'done'
                when c.status <> 'disconnected' then 'in_progress' end;
  if v_coa is not null and exists (select 1 from app.setup_steps where key = 'data.chart_of_accounts') then
    insert into app.center_setup_steps (center_id, step_key, status) values (p_center, 'data.chart_of_accounts', v_coa)
    on conflict (center_id, step_key) do update set status = excluded.status
     where coalesce((v_rank->>app.center_setup_steps.status)::int, 1) < (v_rank->>excluded.status)::int
        or (excluded.status = 'done' and app.center_setup_steps.status <> 'done');
  end if;
  if v_svc is not null and exists (select 1 from app.setup_steps where key = 'svc.quickbooks') then
    insert into app.center_setup_steps (center_id, step_key, status) values (p_center, 'svc.quickbooks', v_svc)
    on conflict (center_id, step_key) do update set status = excluded.status
     where coalesce((v_rank->>app.center_setup_steps.status)::int, 1) < (v_rank->>excluded.status)::int
        or (excluded.status = 'done' and app.center_setup_steps.status <> 'done');
  end if;
end $$;

-- ── What the screen shows ────────────────────────────────────────────────────
create or replace function app.qbo_status(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; o app.integration_connections; v_env text; v_run app.qbo_pull_runs; v_test app.qbo_test_posts;
        v_counts jsonb; v_jobs jsonb; v_missing text[]; v_name jsonb;
begin
  if not app.qbo_can_view(p_center) then
    raise exception 'Seeing QuickBooks setup needs accounting.manage, giving.view or integrations.view.' using errcode = 'insufficient_privilege';
  end if;
  select environment into v_env from app.centers where id = p_center;
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
  select coalesce(jsonb_object_agg(u.id, coalesce(nullif(pe.preferred_name, ''), pe.first_name) || ' ' || pe.last_name), '{}') into v_name
    from auth.users u
    join app.center_users cu on cu.user_id = u.id and cu.center_id = p_center
    join app.people pe on pe.id = cu.person_id
   where u.id::text in (c.connected_by::text, c.settings->>'mapping_approved_by', c.settings->>'test_post_approved_by',
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
      'mapping_approved_at', c.settings->>'mapping_approved_at', 'mapping_approved_by', v_name->>(c.settings->>'mapping_approved_by'),
      'test_post_approved_at', c.settings->>'test_post_approved_at', 'test_post_approved_by', v_name->>(c.settings->>'test_post_approved_by')),
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

-- ── The hourly round (qbo.refresh_token without a connection) ────────────────
-- Renew a sign-in that was last renewed over 20 hours ago or expires within 15
-- minutes; pull lists that were last pulled over 24 hours ago; run the poster
-- where postings wait and it is ready.
create or replace function app.qbo_worker_due() returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'connection_id', c.id, 'center_id', c.center_id,
      'refresh', coalesce((c.settings->>'last_refresh_at')::timestamptz, 'epoch') < now() - interval '20 hours'
                 or coalesce((c.settings->>'access_expires_at')::timestamptz, 'epoch') < now() + interval '15 minutes',
      'pull', not exists (select 1 from app.qbo_pull_runs r where r.connection_id = c.id and r.status = 'succeeded'
                                                             and r.finished_at > now() - interval '24 hours')
              and not exists (select 1 from app.jobs j where j.center_id = c.center_id and j.kind = 'qbo.pull_lists'
                                                         and (j.status in ('queued','running') or j.created_at > now() - interval '1 hour')),
      'post', exists (select 1 from app.ledger_postings lp where lp.center_id = c.center_id and lp.status = 'queued')
              and (app.qbo_post_ready(c.center_id)->>'ok')::boolean
              and not exists (select 1 from app.jobs j where j.center_id = c.center_id and j.kind = 'qbo.post' and j.status in ('queued','running'))))
      from app.integration_connections c
     where c.provider in ('quickbooks_online','intuit_sandbox') and c.status in ('connected','expiring')
       and app.module_enabled(c.center_id, 'accounting')), '[]'::jsonb);
end $$;

revoke execute on function app.check_quickbooks_ready(uuid), app.qbo_sync_setup_steps(uuid), app.qbo_status(uuid), app.qbo_worker_due()
  from public, anon, authenticated, service_role;
grant execute on function app.qbo_status(uuid) to authenticated;
grant execute on function app.qbo_worker_due() to connect_worker;
grant execute on function app.enqueue_job(uuid, text, jsonb, timestamptz, int) to connect_worker;
