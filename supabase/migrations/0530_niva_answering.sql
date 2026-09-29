-- Niva answering (backlog B14): a member's question is answered by retrieval
-- over the center's approved app.content_items (kind = 'niva_source', status
-- = 'published' — what the admin screen calls "Included") plus one Anthropic
-- call, run by the background worker (worker/src/handlers/niva.answer.ts).
-- No individual member data (eligibility, RSVPs, payment status) is ever
-- read into the prompt — the system prompt tells the model it has none, so
-- "only the asking member's own data, never another household's" holds
-- structurally rather than by trusting the model. See docs/architecture
-- notes in worker/src/handlers/niva.answer.ts for the full contract.
--
--   app.niva_ask(center, question) → app.niva_conversations
--       Replaces the old plain insert from connect-mobile: checks the
--       caller is a member of the center and the niva module is on, saves
--       the question (unanswered), and enqueues niva.answer. Not an insert
--       policy any more — app.jobs.enqueue_job is only callable from inside
--       another RPC that has checked its caller (0171).
--   app.niva_worker_get_conversation / _search_sources / _store_answer
--       connect_worker only — the answering job's three reads/writes.
--   app.niva_regenerate(id) — content.manage: re-run the job after a
--       source was edited or approved (the content/niva screen's action).
--   app.niva_expired_conversations(limit) — connect_worker only, the daily
--       niva.retention job: enforces the "kept 30 days" promise already
--       stated on the content/niva screen and in niva.footer.
--
-- niva_insert (0010_rls.sql) is left in place as a defensive fallback but is
-- no longer the path connect-mobile uses (askNiva now calls niva_ask, which
-- runs the same checks itself before it can also enqueue the job).

set client_min_messages = warning;

-- ── Member: ask a question ──────────────────────────────────────────────────
create or replace function app.niva_ask(p_center uuid, p_question text)
returns app.niva_conversations
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_q text; v_row app.niva_conversations;
begin
  if auth.uid() is null then raise exception 'Sign in to ask Niva.' using errcode = 'insufficient_privilege'; end if;
  if not app.is_member_of(p_center) then
    raise exception 'You are not a member of this community.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'niva');
  v_q := nullif(btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g')), '');
  if v_q is null then raise exception 'Type a question first.'; end if;
  v_q := left(v_q, 1000);

  insert into app.niva_conversations (center_id, user_id, question, unanswered)
  values (p_center, auth.uid(), v_q, true)
  returning * into v_row;

  perform app.enqueue_job(p_center, 'niva.answer', jsonb_build_object('conversation_id', v_row.id), now(), 3);
  return v_row;
end $$;

-- ── Worker: read one conversation ───────────────────────────────────────────
create or replace function app.niva_worker_get_conversation(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v app.niva_conversations;
begin
  perform app.assert_worker();
  select * into v from app.niva_conversations where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object('id', v.id, 'center_id', v.center_id, 'user_id', v.user_id, 'question', v.question, 'unanswered', v.unanswered);
end $$;

-- ── Worker: retrieval over approved sources ─────────────────────────────────
-- Ranked full-text match over this center's own niva_source content plus the
-- shared platform pack (center_id null), published only ("Included" on the
-- content/niva screen). body_md is trimmed to keep the prompt bounded — the
-- worker asks for a handful of candidates, not the whole corpus.
create or replace function app.niva_worker_search_sources(p_center uuid, p_query text, p_limit int default 6)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_tsq tsquery; v_limit int := least(greatest(coalesce(p_limit, 6), 1), 20); v_out jsonb;
begin
  perform app.assert_worker();
  begin
    v_tsq := websearch_to_tsquery('english', coalesce(p_query, ''));
  exception when others then
    v_tsq := plainto_tsquery('english', coalesce(p_query, ''));
  end;
  if v_tsq is null or v_tsq = ''::tsquery then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'body_md', body, 'rank', rank) order by rank desc), '[]'::jsonb)
    into v_out
  from (
    select c.id, c.title, left(coalesce(c.body_md, ''), 4000) as body,
           ts_rank(to_tsvector('english', coalesce(c.title, '') || ' ' || coalesce(c.body_md, '')), v_tsq) as rank
    from app.content_items c
    where c.kind = 'niva_source' and c.status = 'published'
      and (c.center_id = p_center or c.center_id is null)
      and to_tsvector('english', coalesce(c.title, '') || ' ' || coalesce(c.body_md, '')) @@ v_tsq
    order by rank desc
    limit v_limit
  ) s;
  return v_out;
end $$;

-- ── Worker: write the answer back ───────────────────────────────────────────
-- p_sources: jsonb array of {content_item_id, title} — only sources the
-- model actually cited, verified by the caller against what it was offered.
create or replace function app.niva_worker_store_answer(p_id uuid, p_answer text, p_sources jsonb, p_model text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  if nullif(btrim(coalesce(p_answer, '')), '') is null then
    raise exception 'niva_worker_store_answer needs a non-empty answer; leave the conversation unanswered instead of calling this.';
  end if;
  update app.niva_conversations
     set answer = left(btrim(p_answer), 4000), sources = coalesce(p_sources, '[]'::jsonb), unanswered = false
   where id = p_id;
  if not found then raise exception 'Niva conversation % was not found (it may have been deleted by the 30-day retention job).', p_id; end if;
end $$;

-- ── Staff: regenerate an answer ─────────────────────────────────────────────
-- content/niva "Regenerate" action: after a source is edited or newly
-- approved, re-run the answering job for a past question. The existing
-- answer (if any) stays visible to the member until the job finishes.
create or replace function app.niva_regenerate(p_id uuid)
returns app.niva_conversations
language plpgsql security definer set search_path = app, public, extensions as $$
declare v app.niva_conversations;
begin
  select * into v from app.niva_conversations where id = p_id;
  if not found then raise exception 'That Niva question was not found.'; end if;
  if not app.has_permission(v.center_id, 'content.manage') then
    raise exception 'Regenerating a Niva answer needs content.manage.' using errcode = 'insufficient_privilege';
  end if;
  perform app.enqueue_job(v.center_id, 'niva.answer', jsonb_build_object('conversation_id', v.id, 'regenerate', true), now(), 3);
  return v;
end $$;

-- ── Worker: 30-day retention ─────────────────────────────────────────────────
-- niva_conversations has always carried "retention 30 days" as a comment
-- (0007); this is what actually enforces it, run daily by niva.answer's
-- sibling handler niva.retention (worker/src/handlers/niva.retention.ts).
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
  return v_n;
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app.niva_ask(uuid, text), app.niva_worker_get_conversation(uuid),
  app.niva_worker_search_sources(uuid, text, int), app.niva_worker_store_answer(uuid, text, jsonb, text),
  app.niva_regenerate(uuid), app.niva_expired_conversations(int)
  from public, anon, authenticated, service_role;
grant execute on function app.niva_ask(uuid, text), app.niva_regenerate(uuid) to authenticated;
grant execute on function app.niva_worker_get_conversation(uuid), app.niva_worker_search_sources(uuid, text, int),
  app.niva_worker_store_answer(uuid, text, jsonb, text), app.niva_expired_conversations(int) to connect_worker;
