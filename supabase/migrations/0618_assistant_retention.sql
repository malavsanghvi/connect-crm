-- 0618: Niva for admins, step A1 · retention (docs/ADMIN_REDESIGN.md; MASTER_PLAN section 4).
--
--   * conversation text (app.assistant_messages) is removed after 30 days, like Niva's member conversations (0530);
--   * prepared requests (app.assistant_proposals) are removed after 90 days;
--   * a request nobody answered in 15 minutes is marked 'expired', and one that was confirmed but never reported back
--     for an hour is marked 'failed' ("check whether it happened"), so nothing stays open for ever.
--
-- It runs in the daily sweep that already exists: the worker's niva.retention job calls app.niva_expired_conversations
-- (0530) once a day; that function now also calls app.assistant_purge, so no worker change is needed. The count it
-- returns is still the Niva conversations removed (the worker loops while it is a full batch).
--
-- Audit: removing messages is not audited row by row (see 0617); one summary row ('assistant.retention', counts only) is
-- written when a sweep removed anything. Removing a proposal is audited like any change to that table, with its input
-- and preview masked. Usage counters (one small row per community per month) are kept.
set client_min_messages = warning;

create or replace function app.assistant_purge(p_limit integer default 5000) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_limit integer; v_expired integer; v_abandoned integer; v_messages integer; v_proposals integer;
begin
  perform app.assert_worker();
  v_limit := least(greatest(coalesce(p_limit, 5000), 1), 20000);
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Niva assistant retention (0618)');

  -- Unanswered requests: the 15 minutes are up.
  with due as (
    select id from app.assistant_proposals where status = 'proposed' and expires_at <= now() order by expires_at limit v_limit
  )
  update app.assistant_proposals q set status = 'expired' from due where q.id = due.id;
  get diagnostics v_expired = row_count;

  -- Confirmed, but the command layer never said how it went (a crash, a closed tab): do not leave it open.
  with due as (
    select id from app.assistant_proposals
     where status = 'confirmed' and confirmed_at < now() - interval '1 hour' order by confirmed_at limit v_limit
  )
  update app.assistant_proposals q
     set status = 'failed', finished_at = now(),
         result_summary = 'Niva never reported back, so check whether it was done before asking again.'
    from due where q.id = due.id;
  get diagnostics v_abandoned = row_count;

  -- Conversation text: 30 days.
  with due as (
    select id from app.assistant_messages where created_at < now() - interval '30 days' order by created_at limit v_limit
  )
  delete from app.assistant_messages m using due where m.id = due.id;
  get diagnostics v_messages = row_count;

  -- Prepared requests: 90 days.
  with due as (
    select id from app.assistant_proposals where created_at < now() - interval '90 days' order by created_at limit v_limit
  )
  delete from app.assistant_proposals q using due where q.id = due.id;
  get diagnostics v_proposals = row_count;

  if v_messages + v_proposals > 0 then
    perform app.log_audit(null, 'assistant.retention', 'assistant_messages', 'sweep', null,
      jsonb_build_object('messages_removed', v_messages, 'requests_removed', v_proposals),
      'Niva assistant conversation text older than 30 days and requests older than 90 days were removed');
  end if;
  return jsonb_build_object('expired', v_expired, 'abandoned', v_abandoned,
                            'messages_removed', v_messages, 'requests_removed', v_proposals);
end $$;

-- 0530's function, unchanged except for the last step.
create or replace function app.niva_expired_conversations(p_limit int default 1000)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare v_n int; v_limit int := least(greatest(coalesce(p_limit, 1000), 1), 10000);
begin
  perform app.assert_worker();
  with due as (
    select id from app.niva_conversations where created_at < now() - interval '30 days' limit v_limit
  )
  delete from app.niva_conversations c using due where c.id = due.id;
  get diagnostics v_n = row_count;
  perform app.assistant_purge(v_limit);   -- 0618: the admin assistant's conversation text and requests
  return v_n;
end $$;

revoke execute on function app.assistant_purge(integer) from public, anon, authenticated, service_role;
grant execute on function app.assistant_purge(integer) to connect_worker;
-- Same grants as 0530 (create or replace keeps them; stated so this file is the whole story).
revoke execute on function app.niva_expired_conversations(int) from public, anon, authenticated, service_role;
grant execute on function app.niva_expired_conversations(int) to connect_worker;

comment on function app.assistant_purge(integer) is
  'Niva for admins (0618): worker-only. Closes requests that were never answered or never finished, removes conversation text older than 30 days and requests older than 90 days. Called by app.niva_expired_conversations (the daily niva.retention job). Returns the counts.';
