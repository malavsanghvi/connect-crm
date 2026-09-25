-- Wave E · stream e-money · 5 of 5: the live QuickBooks test post, explained
-- before it runs (owner decision 2026-09-25 #10; backlog B9 keeps the "void
-- them automatically" idea).
--
-- A test post to a REAL QuickBooks company creates four real $1.00 entries
-- (a sales receipt, a refund receipt, a deposit and a journal entry, each marked
-- "Community Connect test post"). The treasurer voids them in QuickBooks
-- afterwards. That is now said in three places before it happens, and once after:
--   * the Setup checklist step svc.quickbooks (what and how, stage 1);
--   * Accounting › QuickBooks › Setup, step 5, before the button (portal);
--   * the confirmation the database asks for (request_qbo_test_post refuses
--     without it, with the same explanation); and the success message after it
--     is queued repeats how to void them.
-- One sentence, app.qbo_test_post_explained(), so every place says the same.
set client_min_messages = warning;

create or replace function app.qbo_test_post_explained() returns text
language sql immutable set search_path = app, public, extensions as $$
  select 'The live test post creates four real $1.00 entries in your QuickBooks company — a sales receipt, a refund receipt, a deposit '
      || 'and a journal entry, each marked "Community Connect test post". Afterwards the treasurer voids them in QuickBooks: search '
      || 'for "Community Connect test post", open each entry and choose More › Void (a deposit or journal entry that has no Void '
      || 'is deleted with More › Delete). Nothing else is posted until the test is approved.'
$$;

update app.setup_steps
   set description = 'Connect the company, pull the chart of accounts, choose the basis and the go-live date, map the accounts, then run '
                     || 'the test post and approve it.',
       help = 'In the sandbox, connect an Intuit sandbox company or the real company read-only (nothing is posted). '
              || app.qbo_test_post_explained()
 where key = 'svc.quickbooks';

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
    raise exception '%', app.qbo_test_post_explained() || ' Tick the confirmation to go ahead.';
  end if;
  perform app.set_audit_context(p_reason);
  insert into app.qbo_test_posts (center_id, connection_id, mode, requested_by)
  values (p_center, c.id, v_mode, auth.uid()) returning id into v_id;
  v_job := app.enqueue_job(p_center, 'qbo.test_post', jsonb_build_object('test_id', v_id, 'connection_id', c.id), now(), 3);
  update app.qbo_test_posts set job_id = v_job where id = v_id;
  return v_id;
end $$;

revoke execute on function app.request_qbo_test_post(uuid, boolean, text) from public, anon;
grant execute on function app.request_qbo_test_post(uuid, boolean, text) to authenticated;
grant execute on function app.qbo_test_post_explained() to authenticated, service_role;
