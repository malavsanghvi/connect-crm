-- Onboarding Wave D · stream o-golive · 2 of 3: the 13 readiness checks in the plan's
-- order, and two of them made honest (ONBOARDING_PLAN §4 Step 8).
--
--  * Sort: every check at its plan number (1–13); the extra "Background service running"
--    check follows as 14 (go-live needs the background service, so it stays registered).
--  * Check 6 payments: a sandbox can never charge in live mode (payments.mode = test), so
--    as registered it could only pass with "offline only". In a sandbox it now passes when
--    the DEFAULT processor passed a TEST-mode $1 charge and refund, and it says in words that
--    live mode is connected in production after promotion. Production is unchanged: live
--    mode with a passing LIVE $1 test, or offline only, or Giving switched off.
--  * Check 10 records: passed with no import at all once the redeemer's own household
--    existed (1 household, 100% "coverage"). It now also needs at least one reconciled
--    (signed-off) import of households or people — the plan's "imported and reconciled".
--
-- The other checks were reviewed and are honest as registered (see docs/ADMIN_SETUP_AUDIT.md).
set client_min_messages = warning;

update app.readiness_checks set sort = v.sort
  from (values ('nonprofit_verified', 1), ('agreements_accepted', 2), ('owner_and_second_admin_2fa', 3),
               ('email_domain_verified', 4), ('texting_registered', 5), ('payments_live', 6), ('quickbooks_ready', 7),
               ('statement_templates_approved', 8), ('setup_data_complete', 9), ('records_imported_reconciled', 10),
               ('member_legal_documents_published', 11), ('niva_evaluated', 12), ('staff_trained_pilot_done', 13),
               ('background_service', 14)) as v(key, sort)
 where app.readiness_checks.key = v.key;

-- ── Check 6 ──────────────────────────────────────────────────────────────────
-- o-payments' function is kept (renamed) for production; the sandbox branch is new.
do $$ begin
  if to_regprocedure('app._check_payments_live_production(uuid)') is null then
    alter function app.check_payments_live(uuid) rename to _check_payments_live_production;
  end if;
end $$;

create or replace function app.check_payments_live(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; cp app.center_payment_processors; t app.payment_processor_tests; v_n int;
begin
  select * into c from app.centers where id = p_center;
  if c.id is null then return jsonb_build_object('ok', false, 'detail', 'Community not found.'); end if;
  if c.environment <> 'sandbox' or not app.module_enabled(p_center, 'giving')
     or coalesce((c.rules #>> '{payments,offline_only}')::boolean, false) then
    return app._check_payments_live_production(p_center);
  end if;
  select * into cp from app.center_payment_processors where center_id = p_center and is_default;
  if cp.center_id is null then
    return jsonb_build_object('ok', false, 'detail',
      'No default online processor. Connect Stripe or PayPal in test mode and make it the default, or choose "offline only" (Settings › Payments).');
  end if;
  if cp.status not in ('test', 'live') then
    return jsonb_build_object('ok', false, 'detail', initcap(cp.processor) || ' is the default but is ' ||
      case cp.status when 'pending_verification' then 'still being verified by ' || initcap(cp.processor) else replace(cp.status, '_', ' ') end || '.');
  end if;
  select * into t from app.payment_processor_tests
   where center_id = p_center and processor = cp.processor and mode = 'test' order by ran_at desc limit 1;
  if t.id is null then
    return jsonb_build_object('ok', false, 'detail', initcap(cp.processor) || ' is connected in test mode; run the $1 test charge and refund (Settings › Payments).');
  end if;
  if not t.ok then
    return jsonb_build_object('ok', false, 'detail', 'The last $1 test of ' || initcap(cp.processor) || ' failed: ' || coalesce(t.detail, 'no detail'));
  end if;
  select count(*) into v_n from app.center_payment_methods where center_id = p_center and accepted;
  return jsonb_build_object('ok', true, 'detail',
    'Sandbox: ' || initcap(cp.processor) || ' passed the TEST-mode $1 charge ' || coalesce(t.charge_ref, '') || ' and refund ' || coalesce(t.refund_ref, '')
    || ' on ' || to_char(t.ran_at at time zone coalesce(c.time_zone, 'UTC'), 'FMMonth FMDD, YYYY')
    || '. A sandbox cannot charge real money: live mode is connected, and its live $1 test run, in production after promotion.');
end $$;

update app.readiness_checks
   set title = 'Payments connected with a $1 charge and refund (live mode in production, test mode in a sandbox), or "offline only" chosen'
 where key = 'payments_live';

-- ── Check 10 ─────────────────────────────────────────────────────────────────
do $$ begin
  if to_regprocedure('app._check_records_imported_counts(uuid)') is null then
    alter function app.check_records_imported(uuid) rename to _check_records_imported_counts;
  end if;
end $$;

create or replace function app.check_records_imported(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb := app._check_records_imported_counts(p_center); r app.import_runs;
begin
  select * into r from app.import_runs
   where center_id = p_center and entity in ('households', 'people') and status = 'reconciled' and signed_off_at is not null
   order by signed_off_at desc limit 1;
  if r.id is null then
    return jsonb_build_object('ok', false, 'detail',
      'No household or people import has been reconciled and signed off yet (Settings › Data import).'
      || case when (v->>'ok')::boolean then '' else ' Also: ' || (v->>'detail') end);
  end if;
  if not (v->>'ok')::boolean then return v; end if;
  return jsonb_build_object('ok', true, 'detail', (v->>'detail') || ' Last sign-off: import #' || r.run_number || ' on '
    || to_char(r.signed_off_at at time zone 'UTC', 'FMMonth FMDD, YYYY') || '.');
end $$;

-- check_fn is a regproc (an OID): renaming the old functions left the registry pointing at
-- them, so point it at the new ones.
update app.readiness_checks set check_fn = 'app.check_payments_live'::regproc where key = 'payments_live';
update app.readiness_checks set check_fn = 'app.check_records_imported'::regproc where key = 'records_imported_reconciled';

revoke execute on function app._check_payments_live_production(uuid), app._check_records_imported_counts(uuid)
  from public, anon, authenticated;
revoke execute on function app.check_payments_live(uuid), app.check_records_imported(uuid) from public, anon;
grant execute on function app.check_payments_live(uuid), app.check_records_imported(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
