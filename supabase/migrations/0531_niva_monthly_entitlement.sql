-- Niva: enforce the monthly-questions entitlement on app.niva_ask
--
-- migration 0160 already defines niva.monthly_questions (sandbox: 300/month,
-- production: unlimited) with a ready plain-English refusal in
-- app.entitlement_message, but app.niva_ask (0530) never checked it — a
-- sandbox could ask Niva an unlimited number of questions. This is a
-- running-count-this-month check, same shape as the people/households cap
-- in 0160 (app.assert_entitlement(center, key, count_so_far + 1)), just
-- evaluated inline in niva_ask rather than via an after-insert trigger,
-- since the question is only one row and the RPC already does its own
-- pre-insert checks (module-on, membership) before inserting.

set client_min_messages = warning;

create or replace function app.niva_ask(p_center uuid, p_question text)
returns app.niva_conversations
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_q text; v_row app.niva_conversations; v_count bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to ask Niva.' using errcode = 'insufficient_privilege'; end if;
  if not app.is_member_of(p_center) then
    raise exception 'You are not a member of this community.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'niva');
  v_q := nullif(btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g')), '');
  if v_q is null then raise exception 'Type a question first.'; end if;
  v_q := left(v_q, 1000);

  -- One writer per center at a time, so two parallel asks near the boundary
  -- cannot both slip in under the cap (same pattern as enforce_people_cap).
  perform pg_advisory_xact_lock(hashtextextended('app.niva_conversations.cap:' || p_center::text, 0));
  select count(*) into v_count from app.niva_conversations
   where center_id = p_center and created_at >= date_trunc('month', current_date)::timestamptz;
  perform app.assert_entitlement(p_center, 'niva.monthly_questions', to_jsonb(v_count + 1));

  insert into app.niva_conversations (center_id, user_id, question, unanswered)
  values (p_center, auth.uid(), v_q, true)
  returning * into v_row;

  perform app.enqueue_job(p_center, 'niva.answer', jsonb_build_object('conversation_id', v_row.id), now(), 3);
  return v_row;
end $$;
