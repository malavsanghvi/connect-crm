-- Onboarding Wave B · stream o-payments · 4 of 4: the Setup steps and go-live
-- readiness check 6 (ONBOARDING_PLAN §4 Step 8).
--
--   svc.payments          done when a processor is connected with a passing $1 test in the mode it
--                         charges in (test in a sandbox), or "offline only" is chosen; waiting on the
--                         provider while Stripe/PayPal verify the account.
--   data.payment_methods  done when at least one offline method is accepted (with its instructions).
--   payments_live (6)     a DEFAULT processor in LIVE mode with a passing LIVE $1 test, or
--                         "offline only" chosen (O13), or Giving switched off.
--
-- app.setup_auto_status is o-setup's; it is wrapped here (renamed, then called)
-- instead of rewritten, so another stream can wrap it the same way.

create or replace function app.payments_setup_status(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; v_offline boolean; v_svc jsonb; v_methods jsonb; v_n int; v_list text; r record; v_ready text[] := '{}';
        v_pending text[] := '{}'; v_untested text[] := '{}';
begin
  select * into c from app.centers where id = p_center;
  if c.id is null then return '{}'::jsonb; end if;
  v_offline := coalesce((c.rules #>> '{payments,offline_only}')::boolean, false);
  for r in select cp.processor, cp.status, app.payment_api_mode(p_center, cp.processor) as api_mode
             from app.center_payment_processors cp where cp.center_id = p_center order by cp.processor loop
    if r.status = 'pending_verification' then
      v_pending := v_pending || initcap(r.processor);
    elsif r.status in ('test','live') then
      if exists (select 1 from app.payment_processor_tests t where t.center_id = p_center and t.processor = r.processor
                   and t.mode = r.api_mode and t.ok) then
        v_ready := v_ready || (initcap(r.processor) || ' (' || r.api_mode || ' test passed)');
      else
        v_untested := v_untested || initcap(r.processor);
      end if;
    end if;
  end loop;
  v_svc := case
    when cardinality(v_ready) > 0 then jsonb_build_object('status', 'done', 'detail', array_to_string(v_ready, ', '))
    when v_offline then jsonb_build_object('status', 'done', 'detail', 'Offline payments only')
    when cardinality(v_untested) > 0 then jsonb_build_object('status', 'in_progress',
      'detail', array_to_string(v_untested, ', ') || ' connected; run the $1 test')
    when cardinality(v_pending) > 0 then jsonb_build_object('status', 'waiting_on_provider',
      'detail', array_to_string(v_pending, ', ') || ' is verifying the account')
    else jsonb_build_object('status', 'not_started', 'detail', null) end;

  select count(*), string_agg(replace(method::text, '_', ' '), ', ' order by sort, method)
    into v_n, v_list from app.center_payment_methods where center_id = p_center and accepted;
  v_methods := case when v_n > 0 then jsonb_build_object('status', 'done', 'detail', 'Accepted: ' || v_list)
                    else jsonb_build_object('status', 'not_started', 'detail', 'No offline method accepted yet') end;
  return jsonb_build_object('svc.payments', v_svc, 'data.payment_methods', v_methods);
end $$;

do $$ begin
  if to_regprocedure('app._setup_auto_status_before_0213(uuid,boolean)') is null then
    alter function app.setup_auto_status(uuid, boolean) rename to _setup_auto_status_before_0213;
  end if;
end $$;
create or replace function app.setup_auto_status(p_center uuid, p_with_readiness boolean default true) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select app._setup_auto_status_before_0213(p_center, p_with_readiness) || app.payments_setup_status(p_center)
$$;

-- ── Readiness check 6 ────────────────────────────────────────────────────────
create or replace function app.check_payments_live(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; cp app.center_payment_processors; t app.payment_processor_tests; v_n int;
begin
  select * into c from app.centers where id = p_center;
  if c.id is null then return jsonb_build_object('ok', false, 'detail', 'Community not found.'); end if;
  if not app.module_enabled(p_center, 'giving') then
    return jsonb_build_object('ok', true, 'detail', 'Giving is switched off, so no payments are taken.');
  end if;
  if coalesce((c.rules #>> '{payments,offline_only}')::boolean, false) then
    select count(*) into v_n from app.center_payment_methods where center_id = p_center and accepted;
    return jsonb_build_object('ok', true, 'detail', 'Offline payments only (card payments can be added later) · '
                              || v_n || ' offline method' || case when v_n = 1 then '' else 's' end || ' with instructions.');
  end if;
  select * into cp from app.center_payment_processors where center_id = p_center and is_default;
  if cp.center_id is null then
    return jsonb_build_object('ok', false, 'detail',
      'No default online processor. Connect Stripe or PayPal and make it the default, or choose "offline only" (Settings › Payments).');
  end if;
  if cp.status <> 'live' then
    return jsonb_build_object('ok', false, 'detail', initcap(cp.processor) || ' is the default but is ' ||
      case cp.status when 'test' then 'still in test mode' when 'pending_verification' then 'still being verified by ' || initcap(cp.processor)
                     else replace(cp.status, '_', ' ') end || '. Switch it to live in production.');
  end if;
  select * into t from app.payment_processor_tests
   where center_id = p_center and processor = cp.processor and mode = 'live' order by ran_at desc limit 1;
  if t.id is null then
    return jsonb_build_object('ok', false, 'detail', initcap(cp.processor) || ' is live; run the live $1 charge and refund.');
  end if;
  if not t.ok then
    return jsonb_build_object('ok', false, 'detail', 'The last live $1 test of ' || initcap(cp.processor) || ' failed: ' || coalesce(t.detail, 'no detail'));
  end if;
  return jsonb_build_object('ok', true, 'detail', initcap(cp.processor) || ' is live; the $1 charge ' || coalesce(t.charge_ref, '')
                            || ' was refunded (' || coalesce(t.refund_ref, '') || ') on '
                            || to_char(t.ran_at at time zone coalesce(c.time_zone, 'UTC'), 'FMMonth FMDD, YYYY') || '.');
end $$;

insert into app.readiness_checks (key, title, sort, check_fn)
values ('payments_live', 'Payments connected in live mode with a $1 charge and refund, or "offline only" chosen', 6,
        'app.check_payments_live'::regproc)
on conflict (key) do update set title = excluded.title, sort = excluded.sort, check_fn = excluded.check_fn;

revoke execute on function app.payments_setup_status(uuid), app.setup_auto_status(uuid, boolean) from public, anon, authenticated;
revoke execute on function app.check_payments_live(uuid) from public, anon;
grant execute on function app.check_payments_live(uuid) to authenticated;
