-- Onboarding (stream o-quickbooks) · 5 of 6: the test post (plan §1.7.5 "Post
-- one of each type ... and approve the result").
--
--   app.qbo_test_posts             one row per test: mode, status, what QuickBooks
--                                  answered per document, approval
--   app.request_qbo_test_post      after the mapping is approved; queues qbo.test_post
--   app.approve_qbo_test_post      accounting.manage + a fresh 2FA check + a reason
--   worker: qbo_worker_test_post_plan / qbo_worker_test_post_done
--
-- Modes:
--   post     a $1.00 SalesReceipt, RefundReceipt, Deposit and JournalEntry, each
--            marked "Community Connect test post", are created in the connected
--            company: always so for an Intuit sandbox company; for a live
--            community's real company only when the person confirms it (they
--            void the four entries in QuickBooks afterwards);
--   dry_run  the real company connected read-only (a sandbox community): nothing
--            is written; the service reads every account, item and class the
--            four documents use back from QuickBooks and shows the documents.
set client_min_messages = warning;

create table if not exists app.qbo_test_posts (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  connection_id uuid not null references app.integration_connections(id) on delete cascade,
  job_id        bigint,
  mode          text not null check (mode in ('post','dry_run')),
  status        text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  results       jsonb not null default '[]'::jsonb,   -- [{entity, ok, qbo_id?, doc_number?, total?, error?, checked?}]
  error         text,
  requested_by  uuid references auth.users(id),
  requested_at  timestamptz not null default now(),
  finished_at   timestamptz,
  approved_by   uuid references auth.users(id),
  approved_at   timestamptz
);
create index if not exists qbo_test_posts_center_idx on app.qbo_test_posts (center_id, requested_at desc);

insert into app.module_tables (table_name, module_key) values ('qbo_test_posts', 'accounting')
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_qbo_test_posts on app.qbo_test_posts;
create trigger audit_qbo_test_posts after insert or update or delete on app.qbo_test_posts
  for each row execute function app.audit_row();
alter table app.qbo_test_posts enable row level security;
drop policy if exists qbo_test_posts_read on app.qbo_test_posts;
create policy qbo_test_posts_read on app.qbo_test_posts for select to authenticated using (app.qbo_can_view(center_id));
do $$ begin perform app._qbo_module_switch('qbo_test_posts'); end $$;
revoke all on app.qbo_test_posts from public, anon, authenticated, service_role, connect_worker;
grant select on app.qbo_test_posts to authenticated;
grant all on app.qbo_test_posts to service_role;

-- The four test documents, built exactly like real postings.
create or replace function app._qbo_test_docs(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_gen text := app._qbo_account(p_center, 'income.general'); v_class text; v_line jsonb;
        v_note text := 'Community Connect test post — safe to void'; v_day text := to_char(current_date, 'YYYY-MM-DD');
begin
  select * into c from app.qbo_connection(p_center);
  select qbo_class_id into v_class from app.funds where center_id = p_center and key = 'general';
  v_line := app._qbo_sales_line(c.id, v_gen, v_class, 100, 'Community Connect test post');
  return jsonb_build_array(
    jsonb_build_object('entity', 'SalesReceipt', 'txn_date', v_day, 'doc_number', 'CCTEST-SR', 'private_note', v_note,
                       'customer_ref', null, 'customer_status', 'none', 'deposit_account', app._qbo_account(p_center, 'undeposited_funds'),
                       'lines', jsonb_build_array(v_line)),
    jsonb_build_object('entity', 'RefundReceipt', 'txn_date', v_day, 'doc_number', 'CCTEST-RR', 'private_note', v_note,
                       'customer_ref', null, 'customer_status', 'none', 'deposit_account', app._qbo_account(p_center, 'bank'),
                       'lines', jsonb_build_array(v_line)),
    jsonb_build_object('entity', 'Deposit', 'txn_date', v_day, 'doc_number', null, 'private_note', v_note,
                       'customer_ref', null, 'customer_status', 'none', 'deposit_account', app._qbo_account(p_center, 'bank'),
                       'lines', jsonb_build_array(jsonb_build_object('amount_cents', 100, 'description', 'Community Connect test post',
                                                                     'account_id', app._qbo_account(p_center, 'undeposited_funds')))),
    jsonb_build_object('entity', 'JournalEntry', 'txn_date', v_day, 'doc_number', 'CCTEST-JE', 'private_note', v_note,
                       'customer_ref', null, 'customer_status', 'none', 'deposit_account', null,
                       'lines', jsonb_build_array(
                         jsonb_build_object('amount_cents', 100, 'posting', 'Debit', 'description', 'Community Connect test post',
                                            'account_id', app._qbo_account(p_center, 'merchant_fees')),
                         jsonb_build_object('amount_cents', 100, 'posting', 'Credit', 'description', 'Community Connect test post',
                                            'account_id', app._qbo_account(p_center, 'payment_clearing')))));
end $$;

create or replace function app.request_qbo_test_post(p_center uuid, p_confirm_real boolean, p_reason text)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.integration_connections; v_env text; v_mode text; v_id uuid; v_job bigint; v_read_only boolean;
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not app.has_permission(p_center, 'accounting.manage') then
    raise exception 'Running the QuickBooks test post needs accounting.manage.' using errcode = 'insufficient_privilege';
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why the test post is being run.'; end if;
  select * into c from app.qbo_connection(p_center);
  if c.id is null or c.status not in ('connected','expiring') then raise exception 'Connect QuickBooks first.'; end if;
  if c.settings->>'mapping_approved_at' is null then raise exception 'Approve the account mapping first; the test post uses it.'; end if;
  if exists (select 1 from app.qbo_test_posts where connection_id = c.id and status in ('queued','running')) then
    raise exception 'A test post is already running. Wait for its result.';
  end if;
  select environment into v_env from app.centers where id = p_center;
  v_read_only := coalesce((c.settings->>'read_only')::boolean, false) or (v_env = 'sandbox' and c.provider <> 'intuit_sandbox');
  v_mode := case when v_read_only then 'dry_run' else 'post' end;
  if v_mode = 'post' and c.provider = 'quickbooks_online' and not coalesce(p_confirm_real, false) then
    raise exception 'This creates four $1.00 entries marked "Community Connect test post" in your real QuickBooks company (void them there afterwards). Confirm to go ahead.';
  end if;
  perform app.set_audit_context(p_reason);
  insert into app.qbo_test_posts (center_id, connection_id, mode, requested_by)
  values (p_center, c.id, v_mode, auth.uid()) returning id into v_id;
  v_job := app.enqueue_job(p_center, 'qbo.test_post', jsonb_build_object('test_id', v_id, 'connection_id', c.id), now(), 3);
  update app.qbo_test_posts set job_id = v_job where id = v_id;
  return v_id;
end $$;

create or replace function app.qbo_worker_test_post_plan(p_test uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.qbo_test_posts; c app.integration_connections; v_docs jsonb; v_problem text; d jsonb;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Background service: QuickBooks test post');
  select * into t from app.qbo_test_posts where id = p_test for update;
  if t.id is null then raise exception 'Test post % was not found.', p_test; end if;
  select * into c from app.qbo_connection(t.center_id);
  if c.id is distinct from t.connection_id then
    update app.qbo_test_posts set status = 'failed', error = 'A different QuickBooks company is connected now; run the test again.', finished_at = now()
     where id = t.id;
    return jsonb_build_object('ok', false, 'error', 'A different QuickBooks company is connected now; run the test again.');
  end if;
  begin
    v_docs := app._qbo_test_docs(t.center_id);
  exception when others then
    update app.qbo_test_posts set status = 'failed', error = sqlerrm, finished_at = now() where id = t.id;
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  for d in select * from jsonb_array_elements(v_docs) loop
    v_problem := app._qbo_doc_problem(c.id, d);
    if v_problem is not null then
      update app.qbo_test_posts set status = 'failed', error = (d->>'entity') || ': ' || v_problem, finished_at = now() where id = t.id;
      return jsonb_build_object('ok', false, 'error', (d->>'entity') || ': ' || v_problem);
    end if;
  end loop;
  update app.qbo_test_posts set status = 'running' where id = t.id;
  return jsonb_build_object('ok', true, 'mode', t.mode, 'connection_id', c.id, 'docs', v_docs);
end $$;

create or replace function app.qbo_worker_test_post_done(p_test uuid, p_ok boolean, p_results jsonb, p_error text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Background service: QuickBooks test post');
  update app.qbo_test_posts
     set status = case when p_ok then 'succeeded' else 'failed' end, results = coalesce(p_results, '[]'),
         error = case when p_ok then null else left(coalesce(p_error, 'The test post failed.'), 2000) end, finished_at = now()
   where id = p_test and status in ('queued','running');
  if not found then raise exception 'Test post % is not running.', p_test; end if;
end $$;

create or replace function app.approve_qbo_test_post(p_test uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.qbo_test_posts; c app.integration_connections;
begin
  select * into t from app.qbo_test_posts where id = p_test;
  if t.id is null then raise exception 'That test post was not found.'; end if;
  perform app.assert_module_enabled(t.center_id, 'accounting');
  if not app.has_permission(t.center_id, 'accounting.manage') then
    raise exception 'Approving the QuickBooks test post needs accounting.manage (the treasurer).' using errcode = 'insufficient_privilege';
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why the test post result is approved.'; end if;
  if t.status <> 'succeeded' then raise exception 'Only a test post that succeeded can be approved.'; end if;
  select * into c from app.qbo_connection(t.center_id);
  if c.id is distinct from t.connection_id then raise exception 'This test ran against a different QuickBooks company; run it again.'; end if;
  if c.settings->>'mapping_approved_at' is null or t.requested_at < (c.settings->>'mapping_approved_at')::timestamptz then
    raise exception 'The mapping changed after this test; approve the mapping and run the test again.';
  end if;
  perform app.assert_step_up('qbo.approve_test_post');
  perform app.set_audit_context(p_reason);
  update app.qbo_test_posts set approved_by = auth.uid(), approved_at = now() where id = t.id;
  update app.integration_connections
     set settings = settings || jsonb_build_object('test_post_approved_by', auth.uid(), 'test_post_approved_at', now(), 'test_post_id', t.id)
   where id = c.id;
  if to_regprocedure('app.qbo_sync_setup_steps(uuid)') is not null then
    execute 'select app.qbo_sync_setup_steps($1)' using t.center_id;
  end if;
  return jsonb_build_object('approved_at', now());
end $$;

revoke execute on function app._qbo_test_docs(uuid), app.request_qbo_test_post(uuid, boolean, text),
  app.qbo_worker_test_post_plan(uuid), app.qbo_worker_test_post_done(uuid, boolean, jsonb, text), app.approve_qbo_test_post(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function app.request_qbo_test_post(uuid, boolean, text), app.approve_qbo_test_post(uuid, text) to authenticated;
grant execute on function app.qbo_worker_test_post_plan(uuid), app.qbo_worker_test_post_done(uuid, boolean, jsonb, text) to connect_worker;
