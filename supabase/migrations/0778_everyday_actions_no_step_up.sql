-- 0778 · No fresh 2FA code for everyday role actions; admin actions keep it.
--
-- OWNER RULE (2026-10-13)
--   "We need 2FA only for login. Everyone except for ADMIN (Platform/customer org level admins) level actions for the user
--   based on their role are allowed without 2FA." 2FA at sign-in stays (the staff sign-in gate, require_2fa_for_staff).
--   The two-person rule is not 2FA and stays everywhere. Nothing else changes: permissions, reasons, audit and money rules
--   are exactly as before.
--
-- NO LONGER ASKS FOR A FRESH CODE (each function copies its LATEST body; only the step-up line is removed)
--   1. Write-off request/approve/complete     trigger pledges_step_up              (0154)  dropped with app.step_up_pledges
--   2. Refunds, every route                   trigger payments_step_up             (0154)  dropped with app.step_up_payments
--                                             app.request_provider_refund          (0415)
--                                             app.approve_flagged_refund           (0410, both stages)
--                                             app.record_manual_paypal_refund      (0415)
--   3. Lock / unlock a month                  trigger accounting_periods_step_up   (0154)  dropped with app.step_up_accounting_periods
--   4. Merge people / households              triggers people_step_up_merge, households_step_up_merge (0154)
--                                                                                          dropped with app.step_up_merge
--   5+6. People/household list export and event feedback export
--                                             app.record_export                    (0154; its only callers are those two routes)
--   7. Giving export                          app.giving_export_check              (0747: the authenticator, fresh-code and
--                                             reused-code block; data.export, the list's read permission and the modules stay;
--                                             app.record_giving_export is untouched: its lock and audit row stay)
--   8. Undo an import                         app.import_undo                      (0402; app.import_step_up stays, unused)
--   9. QuickBooks approve mapping / approve test post / change basis
--                                             app.approve_qbo_mapping (0232), app.approve_qbo_test_post (0234),
--                                             app._qbo_apply_basis (0521)
--
-- KEEPS ITS FRESH CODE (not touched): role grants and invites, 2FA reset, ownership transfer, module switches and grants,
--   require_2fa_for_staff, access levels, activity consent, demo and sandbox, integration secrets, payment processor
--   connect/live/disconnect, QuickBooks connect/disconnect, support access, promote/go-live, plugin pause, kind change,
--   platform settings, demo sign-in, payee changes, the PayPal payee email, Zelle reporting settings.
--   Test 178.

-- ── 1-4. The four trigger functions only asked for the code: drop their five triggers and the functions ─────────────
drop trigger if exists pledges_step_up on app.pledges;
drop trigger if exists payments_step_up on app.payments;
drop trigger if exists accounting_periods_step_up on app.accounting_periods;
drop trigger if exists people_step_up_merge on app.people;
drop trigger if exists households_step_up_merge on app.households;
drop function if exists app.step_up_pledges();
drop function if exists app.step_up_payments();
drop function if exists app.step_up_accounting_periods();
drop function if exists app.step_up_merge();

-- ── 2. Refunds: app.request_provider_refund (latest 0415) ─────────────────────────────────────────────────────
create or replace function app.request_provider_refund(p_payment uuid, p_reason text)
returns bigint language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.payments; v_job bigint;
begin
  select * into p from app.payments where id = p_payment;
  if p.id is null then raise exception 'That payment was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(p.center_id, 'giving');
  if not app.has_permission(p.center_id, 'giving.manage') then
    raise exception 'Refunding a payment needs giving.manage.' using errcode = '42501';
  end if;
  if coalesce(p.provider, '') not in ('stripe','paypal') then
    raise exception 'This payment was not taken online; record its refund by hand instead.' using errcode = '22023';
  end if;
  if p.refund_approved_by is null or p.refund_second_approver is null or p.refund_approved_by = p.refund_second_approver then
    raise exception 'A refund needs two different approvers: request it, then a second person with giving.approve approves it.'
      using errcode = '22023';
  end if;
  if p.refunded_cents > 0 then
    raise exception 'A refund is already recorded on this payment (%). One refund request per payment for now, so it is not sent again.',
      to_char(p.refunded_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
  end if;
  if exists (select 1 from app.payment_refunds where payment_id = p.id and status = 'flagged') then
    raise exception '% already reported a refund on this payment; approve that flagged refund instead of sending another.', initcap(p.provider)
      using errcode = '22023';
  end if;
  if coalesce(p.refund_requested_cents, 0) <= 0 or p.refund_requested_cents > p.amount_cents - p.refunded_cents then
    raise exception 'The requested refund is more than what is left on this payment.' using errcode = '22023';
  end if;
  if exists (select 1 from app.jobs where kind = 'payments.refund' and status in ('queued','running') and payload->>'payment_id' = p.id::text) then
    raise exception 'A refund of this payment is already on its way to %.', initcap(p.provider) using errcode = '22023';
  end if;
  perform app.payments_require_reason(coalesce(nullif(btrim(p_reason), ''), p.refund_reason), 'refund through ' || initcap(p.provider));
  v_job := app.enqueue_job(p.center_id, 'payments.refund',
                           jsonb_build_object('payment_id', p.id, 'amount_cents', p.refund_requested_cents,
                                              'refunded_before', p.refunded_cents, 'provider', p.provider), now(), 5);
  return v_job;
end $$;

-- ── 2. Refunds: app.approve_flagged_refund (latest 0410; both stages) ─────────────────────────────────────────
create or replace function app.approve_flagged_refund(p_refund uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.payment_refunds; v_total bigint;
begin
  select * into r from app.payment_refunds where id = p_refund for update;
  if r.id is null then raise exception 'That refund was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(r.center_id, 'giving');
  if r.status <> 'flagged' then raise exception 'This refund is already recorded.' using errcode = '22023'; end if;
  if r.first_approver is null then
    if not app.has_permission(r.center_id, 'giving.manage') then
      raise exception 'The first approval of a refund needs giving.manage.' using errcode = '42501';
    end if;
    perform app.payments_require_reason(p_reason, 'approve the refund made in ' || initcap(r.provider));
    update app.payment_refunds set first_approver = auth.uid(), first_approved_at = now(),
                                   reason = left(btrim(p_reason), 1000)
     where id = r.id;
    return jsonb_build_object('stage', 'first', 'refund_id', r.id);
  end if;
  if not app.has_permission(r.center_id, 'giving.approve') then
    raise exception 'The second approval of a refund needs giving.approve.' using errcode = '42501';
  end if;
  if r.first_approver = auth.uid() then
    raise exception 'The second approver must be a different person from the first (%).', app.refund_person_name(r.center_id, r.first_approver)
      using errcode = '22023';
  end if;
  perform app.payments_require_reason(p_reason, 'approve the refund made in ' || initcap(r.provider));
  v_total := app._apply_refund_to_payment(r.payment_id, r.amount_cents, r.first_approver, auth.uid(),
                                          coalesce(r.reason, p_reason) || ' · refunded in the ' || initcap(r.provider) || ' dashboard (' || r.provider_ref || ')');
  update app.payment_refunds set second_approver = auth.uid(), second_approved_at = now(), status = 'applied', applied_at = now()
   where id = r.id;
  return jsonb_build_object('stage', 'applied', 'refund_id', r.id, 'refunded_cents', v_total);
end $$;

-- ── 2. Refunds: app.record_manual_paypal_refund (latest 0415) ─────────────────────────────────────────────────
create or replace function app.record_manual_paypal_refund(p_payment uuid, p_amount_cents bigint, p_refunded_on date,
                                                           p_paypal_txn text, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.payments; v_txn text := upper(btrim(coalesce(p_paypal_txn, ''))); v_total bigint; v_id uuid; c app.centers;
begin
  select * into p from app.payments where id = p_payment for update;
  if p.id is null then raise exception 'That payment was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(p.center_id, 'giving');
  if not app.has_permission(p.center_id, 'giving.manage') then
    raise exception 'Recording a refund needs giving.manage.' using errcode = '42501';
  end if;
  if coalesce(p.provider, '') <> 'paypal' then
    raise exception 'Only a PayPal payment is recorded this way.' using errcode = '22023';
  end if;
  if not app.paypal_email_only(p.center_id) then
    raise exception 'This PayPal account is connected with permission to refund: use "Refund through PayPal" instead.' using errcode = '22023';
  end if;
  if p.refund_approved_by is null or p.refund_second_approver is null or p.refund_approved_by = p.refund_second_approver then
    raise exception 'A refund needs two different approvers: request it, then a second person with giving.approve approves it.'
      using errcode = '22023';
  end if;
  if p.refunded_cents > 0 then
    raise exception 'A refund is already recorded on this payment (%). One refund request per payment for now.',
      to_char(p.refunded_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
  end if;
  if exists (select 1 from app.payment_refunds where payment_id = p.id and status = 'flagged') then
    raise exception 'PayPal already reported a refund on this payment; approve that flagged refund instead of recording it again.'
      using errcode = '22023';
  end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Enter the amount refunded in PayPal.' using errcode = '22023'; end if;
  if v_txn !~ '^[A-Z0-9]{10,30}$' then
    raise exception 'Enter the PayPal transaction id of the refund (letters and digits, e.g. 1AB23456CD789012E).' using errcode = '22023';
  end if;
  select * into c from app.centers where id = p.center_id;
  if p_refunded_on is null or p_refunded_on < p.received_on
     or p_refunded_on > (now() at time zone coalesce(c.time_zone, 'America/Chicago'))::date then
    raise exception 'Enter the date PayPal made the refund: on or after the payment (%), and not in the future.',
      to_char(p.received_on, 'FMMonth FMDD, YYYY') using errcode = '22023';
  end if;
  if exists (select 1 from app.payment_refunds where center_id = p.center_id and provider = 'paypal' and provider_ref = v_txn) then
    raise exception 'PayPal transaction % is already recorded as a refund.', v_txn using errcode = '22023';
  end if;
  perform app.payments_require_reason(coalesce(nullif(btrim(p_reason), ''), p.refund_reason), 'record the refund made in PayPal');
  v_total := app._apply_refund_to_payment(p.id, p_amount_cents, p.refund_approved_by, p.refund_second_approver, p.refund_reason);
  insert into app.payment_refunds (center_id, payment_id, source, provider, amount_cents, refunded_on, provider_ref, reason, status,
                                   first_approver, first_approved_at, second_approver, second_approved_at, applied_at, detail)
  values (p.center_id, p.id, 'manual_paypal', 'paypal', p_amount_cents, p_refunded_on, v_txn,
          left(coalesce(nullif(btrim(p_reason), ''), p.refund_reason), 1000),
          'applied', p.refund_approved_by, null, p.refund_second_approver, null, now(),
          format('Recorded by %s from PayPal (the account is connected by email only).', app.refund_person_name(p.center_id, auth.uid())))
  returning id into v_id;
  insert into app.sync_log (center_id, provider, direction, operation, record_table, record_id, external_ref, status, detail)
  values (p.center_id, 'paypal', 'inbound', 'refund_recorded_by_hand', 'payments', p.id, v_txn, 'ok',
          jsonb_build_object('amount_cents', p_amount_cents, 'refunded_on', p_refunded_on, 'refund_id', v_id));
  return jsonb_build_object('refund_id', v_id, 'refunded_cents', v_total);
end $$;

-- ── 5+6. Exports: app.record_export (latest 0154) ──────────────────────────────────────────────────────────────
create or replace function app.record_export(p_center uuid, p_kind text, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_kind text := lower(btrim(coalesce(p_kind, '')));
begin
  if auth.uid() is null then raise exception 'Sign in to export.' using errcode = 'insufficient_privilege'; end if;
  if v_kind !~ '^[a-z][a-z0-9_.]{1,60}$' then raise exception 'Unknown export "%".', p_kind; end if;
  if not (app.is_staff_of(p_center) or app.is_platform_admin()) then
    raise exception 'Exports are for this community''s staff.' using errcode = 'insufficient_privilege';
  end if;
  perform app.log_audit(p_center, 'export.' || v_kind, null, null, null, coalesce(p_detail, '{}'::jsonb), null);
end $$;

-- ── 7. Giving export: app.giving_export_check (latest 0747), without the authenticator / fresh-code / reused-code block ─
create or replace function app.giving_export_check(p_center uuid, p_list text) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_user uuid := auth.uid(); v_list text := lower(btrim(coalesce(p_list, '')));
begin
  if v_user is null then raise exception 'Sign in to export.' using errcode = 'insufficient_privilege'; end if;
  if v_list not in ('payments', 'pledges', 'bank_lines', 'year_end_totals') then
    raise exception 'Unknown Giving export "%".', p_list using errcode = '22023';
  end if;
  if p_center is null or not exists (select 1 from app.centers c where c.id = p_center) then
    raise exception 'That community was not found.' using errcode = '22023';
  end if;
  perform app.assert_module_enabled(p_center, 'giving');
  if v_list = 'bank_lines' then perform app.assert_module_enabled(p_center, 'giving_bank'); end if;
  if v_list = 'year_end_totals' then perform app.assert_module_enabled(p_center, 'giving_statements'); end if;
  if not app.has_permission(p_center, 'data.export') then
    raise exception 'Exporting needs the data-export permission (data.export).' using errcode = '42501';
  end if;
  if not (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.manage')
          or (v_list = 'bank_lines' and app.has_permission(p_center, 'giving.record_offline'))) then
    raise exception 'Exporting this list needs permission to see it.' using errcode = '42501';
  end if;
end $$;

comment on function app.giving_export_check(uuid, text) is
  'Can the caller export this Giving list now (data.export + the list''s read permission, modules)? No fresh 2FA code since 0778 (owner rule 2026-10-13). Writes nothing (0747).';

-- ── 8. Undo an import: app.import_undo (latest 0402) ───────────────────────────────────────────────────────────
create or replace function app.import_undo(p_run uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; ch app.import_changes; v_before jsonb; v_cur jsonb; v_restore jsonb; k text; v_val jsonb;
        v_removed int := 0; v_restored int := 0; v_kept jsonb := '[]'::jsonb; v_later text; v_balances app.import_changes[] := '{}';
begin
  r := app.import_assert_run(p_run);
  if r.status not in ('committed','reconciled') then raise exception 'Import #% is %; only a finished import can be undone.', r.run_number, r.status; end if;
  if r.committed_at < now() - interval '30 days' then
    raise exception 'Import #% finished more than 30 days ago, so it can no longer be undone.', r.run_number;
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why this import is being undone. It goes in the audit log.'; end if;
  perform app.set_audit_context(format('Undo import #%s · %s — %s', r.run_number, coalesce(r.file_name, r.entity), btrim(p_reason)), r.request_id);
  perform set_config('app.client_app', 'import', true);
  begin
    for ch in select * from app.import_changes where run_id = r.id and undone_at is null order by id desc loop
      -- A pledge balance moved by an allocation goes back after the allocations are gone.
      if ch.op = 'update' and ch.table_name = 'pledges' and ch.before ? 'paid_cents' and ch.after ? 'paid_cents' and not ch.after ? 'amount_cents' then
        v_balances := v_balances || ch;
        continue;
      end if;
      if ch.op = 'insert' then
        if app.import_delete(ch.table_name, ch.record_id) then v_removed := v_removed + 1; end if;
      else
        v_cur := app.import_current(ch.table_name, ch.record_id);
        if v_cur is null then continue; end if;
        select a.before into v_before from app.audit_log a
         where a.correlation_id = r.request_id and a.record_table = ch.table_name and a.record_id = ch.record_id
           and a.action = ch.table_name || '.update' and a.occurred_at >= ch.created_at - interval '1 minute'
         order by a.id limit 1;
        v_restore := '{}'::jsonb;
        for k in select jsonb_object_keys(coalesce(ch.before, '{}'::jsonb)) loop
          if (v_cur -> k) is distinct from (ch.after -> k) then
            v_kept := v_kept || jsonb_build_array(jsonb_build_object('table', ch.table_name, 'id', ch.record_id, 'column', k));
            continue;
          end if;
          -- The audit log's before-value, unless the log masks that field (birth dates, processor references).
          -- Custom values: the import's own record (0402), which includes the staff-only values kept apart
          -- from the row (0401); the row's audit entry never saw those.
          v_val := case when k <> 'custom' and v_before ? k and v_before ->> k is distinct from '***' then v_before -> k else ch.before -> k end;
          v_restore := v_restore || jsonb_build_object(k, v_val);
        end loop;
        if v_restore <> '{}'::jsonb then
          perform app.import_set(ch.table_name, ch.record_id, v_restore);
          v_restored := v_restored + 1;
        end if;
      end if;
      update app.import_changes set undone_at = now() where id = ch.id;
    end loop;
    foreach ch in array v_balances loop   -- newest first, so the oldest "before" is applied last
      if exists (select 1 from app.pledges where id = ch.record_id::uuid) then
        perform app.import_set('pledges', ch.record_id, ch.before);
        v_restored := v_restored + 1;
      end if;
      update app.import_changes set undone_at = now() where id = ch.id;
    end loop;
  exception when foreign_key_violation then
    select string_agg('#' || run_number, ', ' order by run_number) into v_later from app.import_runs
     where center_id = r.center_id and run_number > r.run_number and status in ('committed','reconciled','committing');
    raise exception 'Import #% cannot be undone: records it added are now used by other records%. Nothing was changed.', r.run_number,
      case when v_later is not null then ' (undo the later imports first: ' || v_later || ')' else ' (payments, pledges or memberships added since)' end;
  end;
  delete from app.import_keys k2 where k2.center_id = r.center_id and k2.run_id = r.id
     and not exists (select 1 from app.import_rows x where x.run_id = r.id and x.target_id = k2.record_id and x.status in ('updated','unchanged'));
  update app.import_rows set status = 'undone' where run_id = r.id and status = 'created';
  update app.import_runs set status = 'undone', undone_by = auth.uid(), undone_at = now(), undo_reason = btrim(p_reason) where id = r.id;
  return jsonb_build_object('removed', v_removed, 'restored', v_restored, 'kept', v_kept);
end $$;

-- ── 9. QuickBooks: app.approve_qbo_mapping (latest 0232) ──────────────────────────────────────────────────────
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

-- ── 9. QuickBooks: app.approve_qbo_test_post (latest 0234) ────────────────────────────────────────────────────
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

-- ── 9. QuickBooks: app._qbo_apply_basis (latest 0521; set_qbo_basis and set_qbo_settings call it) ─────────────
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
