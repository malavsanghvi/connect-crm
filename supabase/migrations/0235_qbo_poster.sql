-- Onboarding (stream o-quickbooks) · 6 of 7: the poster (plan §1.7 "the
-- platform posts every money event exactly once"): app.ledger_postings ->
-- QuickBooks, run by the qbo.post job.
--
--   app.qbo_post_ready(center)        whether anything may post, and if not why
--   app.qbo_worker_claim(center, n)   hands the service work units and marks
--                                     their postings 'posting'
--   app.qbo_worker_posting_done / _failed
--   app.request_qbo_post(center)      "Post now"
--   a trigger on ledger_postings      a queued posting queues one qbo.post job
--
-- Rules, checked again when a posting is claimed (not only when it was queued):
--   * a historical payment never posts (payments.is_historical, o-import) -> 'skipped'
--   * nothing dated before the QuickBooks go-live date posts -> 'skipped'
--   * a month closed in Community Connect (accounting_periods.status 'closed')
--     does not take new entries -> 'failed' with a plain reason, for a person
--   * nothing posts to a company connected read-only, or from a sandbox
--     community to anything but an Intuit sandbox company
--   * nothing posts until the mapping and the test post are approved and the
--     go-live date is set; accrual basis is not built yet (cash only)
--   * idempotent: QuickBooks gets requestid = the posting id (or, for a daily
--     summary, a hash of its posting ids), so a retry after a lost answer
--     returns the first result instead of posting twice; a posting stuck in
--     'posting' for 15 minutes goes back to the queue under the same requestid.
set client_min_messages = warning;

alter table app.ledger_postings add column if not exists claimed_at timestamptz;
alter table app.ledger_postings add column if not exists request_id text;

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
  if app.qbo_go_live_date(p_center) is null then return jsonb_build_object('ok', false, 'reason', 'The QuickBooks go-live date is not set.'); end if;
  if coalesce(c.settings->>'basis', 'cash') <> 'cash' then
    return jsonb_build_object('ok', false, 'reason', 'Accrual-basis posting (pledges receivable) is not built yet; nothing posts on accrual basis.');
  end if;
  if c.settings->>'mapping_approved_at' is null then return jsonb_build_object('ok', false, 'reason', 'The account mapping is not approved.'); end if;
  if c.settings->>'test_post_approved_at' is null then return jsonb_build_object('ok', false, 'reason', 'The test post is not approved.'); end if;
  select string_agg(w->>'text', ' ') into v_errors from jsonb_array_elements(app.qbo_mapping_warnings(p_center)) w where w->>'level' = 'error';
  if v_errors is not null then return jsonb_build_object('ok', false, 'reason', v_errors); end if;
  return jsonb_build_object('ok', true, 'connection_id', c.id, 'posting', coalesce(c.settings->>'posting', 'per_txn'));
end $$;

-- The posting's own date: when the money moved.
create or replace function app._qbo_posting_date(lp app.ledger_postings) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(
    case when lp.source_table = 'payments' then (select received_on from app.payments where id = lp.source_id) end,
    case when lp.source_table = 'bank_transactions' then (select posted_on from app.bank_transactions where id = lp.source_id) end,
    case when lp.source_table = 'store_orders' then (select coalesce(picked_up_at, placed_at, created_at)::date from app.store_orders where id = lp.source_id) end,
    lp.period_month)
$$;

create or replace function app.qbo_worker_claim(p_center uuid, p_limit int default 25) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_ready jsonb; v_go date; lp app.ledger_postings; v_doc jsonb; v_units jsonb := '[]'; v_skipped int := 0; v_failed int := 0;
        v_summary boolean; v_day date; p app.payments; g record; v_ids uuid[]; v_lines jsonb; v_first jsonb; v_uid text;
        v_groups jsonb := '{}'; v_key text; v_period text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Background service: QuickBooks poster');
  -- Postings whose worker vanished go back to the queue (same requestid).
  update app.ledger_postings set status = 'queued', claimed_at = null
   where center_id = p_center and status = 'posting' and claimed_at < now() - interval '15 minutes';

  v_ready := app.qbo_post_ready(p_center);
  if not (v_ready->>'ok')::boolean then
    return jsonb_build_object('ready', false, 'reason', v_ready->>'reason', 'units', '[]'::jsonb);
  end if;
  v_go := app.qbo_go_live_date(p_center);
  v_summary := v_ready->>'posting' = 'daily_summary';

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
         set status = 'failed', attempts = attempts + 1,
             last_error = to_char(lp.period_month, 'FMMonth YYYY') || ' is closed in Community Connect (month-end close), so this was not posted. A person decides whether to post it as an adjustment in an open month.'
       where id = lp.id;
      v_failed := v_failed + 1; continue;
    end if;

    v_doc := app.qbo_posting_doc(lp.id);
    if not (v_doc->>'ok')::boolean then
      update app.ledger_postings set status = 'failed', attempts = attempts + 1, last_error = left(v_doc->>'error', 1000) where id = lp.id;
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

    update app.ledger_postings set status = 'posting', attempts = attempts + 1, claimed_at = now(), request_id = lp.id::text,
                                   qbo_entity = v_doc #>> '{doc,entity}'
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
    update app.ledger_postings set status = 'posting', attempts = attempts + 1, claimed_at = now(), request_id = v_uid, qbo_entity = 'SalesReceipt'
     where id = any (v_ids);
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

create or replace function app.qbo_worker_posting_done(p_postings uuid[], p_entity text, p_ref text, p_job bigint)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare v_n int;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Background service: posted to QuickBooks');
  if nullif(btrim(p_ref), '') is null then raise exception 'QuickBooks did not return an id for the posted entry.'; end if;
  update app.ledger_postings
     set status = 'posted', qbo_entity = p_entity, qbo_ref = p_ref, posted_at = now(), last_error = null, claimed_at = null
   where id = any (p_postings) and status = 'posting';
  get diagnostics v_n = row_count;
  insert into app.sync_log (center_id, provider, direction, operation, record_table, record_id, external_ref, status, detail)
  select center_id, 'quickbooks_online', 'outbound', 'create ' || p_entity, 'ledger_postings', id, p_ref, 'ok',
         jsonb_build_object('job_id', p_job, 'request_id', request_id)
    from app.ledger_postings where id = any (p_postings);
  return v_n;
end $$;

-- p_retry: the failure may pass (network, QuickBooks busy) -> back to the queue
-- until 5 attempts; otherwise it is an exception for a person.
create or replace function app.qbo_worker_posting_failed(p_postings uuid[], p_error text, p_retry boolean, p_job bigint)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare v_n int;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Background service: QuickBooks posting failed');
  update app.ledger_postings
     set status = case when p_retry and attempts < 5 then 'queued' else 'failed' end,
         last_error = left(coalesce(nullif(btrim(p_error), ''), 'QuickBooks refused the entry.'), 1000), claimed_at = null
   where id = any (p_postings) and status = 'posting';
  get diagnostics v_n = row_count;
  insert into app.sync_log (center_id, provider, direction, operation, record_table, record_id, status, detail)
  select center_id, 'quickbooks_online', 'outbound', 'create ' || coalesce(qbo_entity, 'entry'), 'ledger_postings', id,
         case when p_retry then 'retry' else 'failed' end, jsonb_build_object('job_id', p_job, 'error', left(p_error, 500))
    from app.ledger_postings where id = any (p_postings);
  return v_n;
end $$;

-- A queued posting (new, or put back by "Retry") asks for one qbo.post job,
-- when QuickBooks is ready to take it.
create or replace function app.ledger_postings_enqueue_poster() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.status = 'queued' and (tg_op = 'INSERT' or old.status is distinct from 'queued')
     and not exists (select 1 from app.jobs where center_id = new.center_id and kind = 'qbo.post' and status = 'queued')
     and (app.qbo_post_ready(new.center_id)->>'ok')::boolean then
    perform app.enqueue_job(new.center_id, 'qbo.post', jsonb_build_object('why', 'queued'), now() + interval '5 seconds', 5);
  end if;
  return null;
end $$;
drop trigger if exists ledger_postings_enqueue_poster on app.ledger_postings;
create trigger ledger_postings_enqueue_poster after insert or update of status on app.ledger_postings
  for each row execute function app.ledger_postings_enqueue_poster();

-- "Post now".
create or replace function app.request_qbo_post(p_center uuid) returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_ready jsonb; v_job bigint;
begin
  perform app.assert_module_enabled(p_center, 'accounting');
  if not app.has_permission(p_center, 'accounting.manage') then
    raise exception 'Posting to QuickBooks now needs accounting.manage.' using errcode = 'insufficient_privilege';
  end if;
  v_ready := app.qbo_post_ready(p_center);
  if not (v_ready->>'ok')::boolean then raise exception 'Nothing can post yet: %', v_ready->>'reason'; end if;
  select id into v_job from app.jobs where center_id = p_center and kind = 'qbo.post' and status = 'queued' order by id desc limit 1;
  if v_job is not null then return v_job; end if;
  return app.enqueue_job(p_center, 'qbo.post', jsonb_build_object('why', 'requested'), now(), 5);
end $$;

revoke execute on function app.qbo_post_ready(uuid), app._qbo_posting_date(app.ledger_postings), app.qbo_worker_claim(uuid, int),
  app.qbo_worker_posting_done(uuid[], text, text, bigint), app.qbo_worker_posting_failed(uuid[], text, boolean, bigint),
  app.ledger_postings_enqueue_poster(), app.request_qbo_post(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.request_qbo_post(uuid) to authenticated;
grant execute on function app.qbo_worker_claim(uuid, int), app.qbo_worker_posting_done(uuid[], text, text, bigint),
  app.qbo_worker_posting_failed(uuid[], text, boolean, bigint) to connect_worker;
