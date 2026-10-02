-- 0572_niva_outcomes_retry.sql (backlog B14/B22: Niva answering, phase 1 of the Niva fix plan, PR A)
--
-- Until now a Niva question had only "answered" or "unanswered": staff could not tell "still
-- thinking" from "no approved source mentions it", "the model was unsure", "the AI service hit its
-- spending limit" or "the job failed", because those outcomes lived only in app.jobs, which content
-- staff cannot read. Nothing ever tried a stuck question again. This migration:
--
--   (1) app.niva_conversations gains answer_status (pending, answered, no_source, unsure, refused,
--       paused, failed), outcome_detail (plain English, never a secret), model, answered_at and
--       attempted_at. Existing rows are filled in from their latest niva.answer job
--       (app.niva_outcome_backfill, run once below).
--   (2) niva_ask saves a question as 'pending' (same signature and the same 0531 monthly cap);
--       niva_regenerate sets 'pending' and does not queue a second job while one is queued or
--       running; niva_worker_store_answer records 'answered', the model and answered_at.
--   (3) app.niva_worker_set_outcome(id, status, detail, clear_answer, retry_at)   connect_worker only
--       Records why a question was not answered. clear_answer removes a stale answer only when none
--       of the sources it cited is still published. retry_at (with 'paused') queues the question
--       again at that time, once; the new job carries the running job's payload with "deferrals" + 1.
--       A conversation that still shows an answer keeps answer_status 'answered' (what the member
--       sees decides the status); the attempt's detail and time are still recorded.
--   (4) app.niva_retry_unanswered(center, since, limit)                           content.manage
--       Queues every unanswered question again (not pending, or pending for over 5 minutes, and no
--       job queued or running), 2 seconds apart. It adds no question, so it never counts against
--       niva.monthly_questions. It also picks up questions inserted directly (the niva_insert policy,
--       left in place) that never had a job.
--   (5) app.niva_health(center)                                     content.draft or content.manage
--       Owner-approved 2026-10-01: content staff may see Niva's job health and its last error
--       (scrubbed), which until now only settings or integrations staff could see. Returns
--         { state, last_beat_at, age_seconds,            -- same rule as background_service_status (0171)
--           module_on,
--           handler,                                    -- latest heartbeat's info.handlers."niva.answer"
--           jobs: { queued, running, failed_24h, done_24h, next_run_after,
--                   last_error, last_error_at, last_error_status },   -- niva.answer jobs of this center
--           month: { used, limit },                     -- questions this month vs niva.monthly_questions (null = no limit)
--           outcomes_7d: { pending, answered, no_source, unsure, refused, paused, failed } }
--   (6) niva_worker_get_conversation also returns created_at, answer_status, has_answer, center_name,
--       time_zone, local_now (center-local 'YYYY-MM-DDTHH:MI:SS'), local_today ('Thursday, 1 October
--       2026') and recent: the same member's last 2 answered questions in this center from the 15
--       minutes before this one, oldest first ([{question, answer, created_at}]).
--   (7) niva_content_evidence (0300) fingerprints published sources only, so importing or editing
--       drafts no longer flips go-live check 12 to "changed". The fingerprint changes once with
--       this migration, so an existing 'Niva content' approval reads "changed" once and is
--       approved again.
--   (8) 'approved' is a dead status for a niva_source (Niva answers from 'published' only): the demo
--       pack's own rows become 'published' (sample data) and the demo pack now writes 'published';
--       any other 'approved' niva_source goes to 'in_review', so a person approves it in the queue.
--
-- The applied migrations (0300, 0312, 0530, 0531, 0540, 0541) are untouched; their functions are
-- replaced here with create or replace (same signatures, so their grants stay). The niva_insert
-- policy (0010) stays, by owner decision.

set client_min_messages = warning;

-- ── (1) The outcome of each question ─────────────────────────────────────────
alter table app.niva_conversations
  add column if not exists answer_status  text not null default 'pending',
  add column if not exists outcome_detail text,
  add column if not exists model          text,
  add column if not exists answered_at    timestamptz,
  add column if not exists attempted_at   timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'app.niva_conversations'::regclass
                   and conname = 'niva_conversations_answer_status_check') then
    alter table app.niva_conversations add constraint niva_conversations_answer_status_check
      check (answer_status in ('pending','answered','no_source','unsure','refused','paused','failed'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'app.niva_conversations'::regclass
                   and conname = 'niva_conversations_outcome_detail_length') then
    alter table app.niva_conversations add constraint niva_conversations_outcome_detail_length
      check (outcome_detail is null or char_length(outcome_detail) <= 1000);
  end if;
end $$;

comment on column app.niva_conversations.answer_status is
  'Why the question has or has not got an answer: pending (waiting for Niva), answered, no_source (no approved source mentions it), unsure (sources found, none clearly answers it), refused (Niva declined), paused (the AI service is paused; a retry is queued), failed. Written by niva_ask, niva_regenerate, niva_retry_unanswered and the worker (0572).';
comment on column app.niva_conversations.outcome_detail is
  'Plain-English detail of the latest attempt (for example when a paused question is tried again). Never a secret.';
comment on column app.niva_conversations.model is 'The model that wrote the answer (niva_worker_store_answer).';

-- Unanswered questions per center (Try again, Niva health), and "is a job already on its way for
-- this question?" (regenerate, retry, set_outcome, the backfill).
create index if not exists niva_conversations_unanswered_idx on app.niva_conversations (center_id, created_at) where answer is null;
create index if not exists jobs_niva_answer_conversation_idx on app.jobs ((payload->>'conversation_id')) where kind = 'niva.answer';

-- ── Helper: strip anything that could carry a secret out of an error text ────
-- The worker already scrubs last_error (worker/src/log.ts scrubText); this is a second guard for
-- text that is shown to content staff or stored on a member's conversation.
create or replace function app.niva_scrub_text(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(p,
           '(postgres(ql)?://[^:/[:space:]@]+):[^@[:space:]]+@', '\1:[redacted]@', 'gi'),
           '(https?://[^[:space:]?#]+)\?[^[:space:]]*', '\1?[redacted]', 'gi'),
           '\m(sk|rk|pk|whsec)[-_][A-Za-z0-9_-]{8,}', '[redacted]', 'g'),
           '\m(bearer|x-api-key:?)[[:space:]]+[A-Za-z0-9._~+/=-]{8,}', '\1 [redacted]', 'gi')
$$;

-- ── Backfill: each existing question's outcome, from its latest niva.answer job ──
-- Only rows still 'pending' are touched, so running it again never overwrites a recorded outcome.
-- p_center null = every center. Internal: run once by this migration (and by the DB test).
create or replace function app.niva_outcome_backfill(p_center uuid default null) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_n int;
begin
  with latest as (
    select c.id, c.answer, c.created_at, j.status as job_status, j.result as job_result,
           j.last_error as job_error, j.finished_at as job_finished
      from app.niva_conversations c
      left join lateral (
        select jj.status, jj.result, jj.last_error, jj.finished_at
          from app.jobs jj
         where jj.kind = 'niva.answer' and jj.payload->>'conversation_id' = c.id::text
         order by jj.id desc
         limit 1) j on true
     where c.answer_status = 'pending' and (p_center is null or c.center_id = p_center)
  ), mapped as (
    select l.*,
           case when l.answer is not null then 'answered'
                when l.job_result->>'reason' = 'no_matching_source' then 'no_source'
                when l.job_result->>'reason' = 'model_unsure' then 'unsure'
                when l.job_result->>'reason' = 'model_refused' then 'refused'
                when l.job_status = 'failed' then 'failed'
                else 'pending' end as new_status
      from latest l
  )
  update app.niva_conversations c
     set answer_status = m.new_status,
         answered_at = case when m.new_status = 'answered'
                            then coalesce(c.answered_at, case when m.job_result->>'answered' = 'true' then m.job_finished end, c.created_at)
                            else c.answered_at end,
         model = case when m.new_status = 'answered' and m.job_result->>'answered' = 'true'
                      then coalesce(c.model, left(nullif(m.job_result->>'model', ''), 200)) else c.model end,
         attempted_at = coalesce(c.attempted_at, m.job_finished),
         outcome_detail = case when m.new_status <> 'failed' then c.outcome_detail
                               when m.job_error ~* '(usage|spend(ing)?) limit|credit balance'
                                 then 'The AI service''s spending limit was reached.'
                               when m.job_error ~* 'not configured on the background service|key on the background service was refused'
                                 then 'The AI service is not set up on the background service, or its key was refused.'
                               else 'The background service gave up after an error.' end
    from mapped m
   where c.id = m.id and m.new_status <> 'pending';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── (2) Member: ask a question ───────────────────────────────────────────────
-- Same as 0531 (membership, module, cap), and the question is saved as 'pending'.
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

  insert into app.niva_conversations (center_id, user_id, question, unanswered, answer_status)
  values (p_center, auth.uid(), v_q, true, 'pending')
  returning * into v_row;

  perform app.enqueue_job(p_center, 'niva.answer', jsonb_build_object('conversation_id', v_row.id), now(), 3);
  return v_row;
end $$;

-- ── (6) Worker: read one conversation, with the center's date and the member's recent turns ──
-- recent: the same member's answered questions in this center from the 15 minutes before this
-- one (at most 2, oldest first), so a follow-up ("and on Sunday?") can be understood. Never
-- another member's rows.
create or replace function app.niva_worker_get_conversation(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v app.niva_conversations; v_name text; v_tz text; v_local timestamp; v_recent jsonb;
begin
  perform app.assert_worker();
  select * into v from app.niva_conversations where id = p_id;
  if not found then return null; end if;

  select c.name, c.time_zone into v_name, v_tz from app.centers c where c.id = v.center_id;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
  begin
    v_local := now() at time zone v_tz;
  exception when others then                -- a time zone Postgres does not know: fall back to UTC
    v_tz := 'UTC';
    v_local := now() at time zone 'UTC';
  end;

  select coalesce(jsonb_agg(jsonb_build_object('question', r.question, 'answer', r.answer, 'created_at', r.created_at)
                            order by r.created_at), '[]'::jsonb)
    into v_recent
    from (select x.question, x.answer, x.created_at
            from app.niva_conversations x
           where v.user_id is not null and x.user_id = v.user_id and x.center_id = v.center_id and x.id <> v.id
             and x.answer is not null
             and x.created_at < v.created_at and x.created_at >= v.created_at - interval '15 minutes'
           order by x.created_at desc
           limit 2) r;

  return jsonb_build_object(
    'id', v.id, 'center_id', v.center_id, 'user_id', v.user_id, 'question', v.question, 'unanswered', v.unanswered,
    'created_at', v.created_at, 'answer_status', v.answer_status, 'has_answer', v.answer is not null,
    'center_name', v_name, 'time_zone', v_tz,
    'local_now', to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'local_today', to_char(v_local, 'FMDay, FMDD FMMonth YYYY'),
    'recent', v_recent);
end $$;

-- ── (2) Worker: write the answer back ────────────────────────────────────────
-- p_sources: jsonb array of {content_item_id, title, ...} — only sources the model actually cited,
-- verified by the caller against what it was offered. p_model is now kept.
create or replace function app.niva_worker_store_answer(p_id uuid, p_answer text, p_sources jsonb, p_model text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  if nullif(btrim(coalesce(p_answer, '')), '') is null then
    raise exception 'niva_worker_store_answer needs a non-empty answer; leave the conversation unanswered instead of calling this.';
  end if;
  update app.niva_conversations
     set answer = left(btrim(p_answer), 4000), sources = coalesce(p_sources, '[]'::jsonb), unanswered = false,
         answer_status = 'answered', outcome_detail = null, model = left(nullif(btrim(coalesce(p_model, '')), ''), 200),
         answered_at = now(), attempted_at = now()
   where id = p_id;
  if not found then raise exception 'Niva conversation % was not found (it may have been deleted by the 30-day retention job).', p_id; end if;
end $$;

-- ── (3) Worker: record why a question was not answered ───────────────────────
-- p_status: no_source | unsure | refused | paused | failed ('answered' is niva_worker_store_answer's).
-- p_clear_answer: a regenerate that found no answer removes the old one, but only when none of the
--   sources it cited is still published (a plain content item id, or a 'guide_section:<id>' ref
--   whose section is still public).
-- p_retry_at (with 'paused' only): queue niva.answer again at that time, unless one is already
--   queued. The new job keeps the running job's payload (so a regenerate stays a regenerate) with
--   "deferrals" counted up, so the worker can stop deferring after a while.
-- Returns {status, cleared, retry_job_id}.
create or replace function app.niva_worker_set_outcome(p_id uuid, p_status text, p_detail text,
                                                       p_clear_answer boolean default false, p_retry_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v app.niva_conversations;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_detail text := left(nullif(btrim(app.niva_scrub_text(coalesce(p_detail, ''))), ''), 500);
  v_clear boolean := false;
  v_final text;
  v_payload jsonb;
  v_deferrals int;
  v_retry bigint;
begin
  perform app.assert_worker();
  if v_status = 'answered' then
    raise exception 'niva_worker_set_outcome does not record answers; call niva_worker_store_answer instead.';
  end if;
  if v_status not in ('no_source','unsure','refused','paused','failed') then
    raise exception 'niva_worker_set_outcome: "%" is not an outcome (use no_source, unsure, refused, paused or failed).', p_status;
  end if;
  if p_retry_at is not null and v_status <> 'paused' then
    raise exception 'niva_worker_set_outcome: a retry time goes only with the paused outcome (got %).', v_status;
  end if;

  select * into v from app.niva_conversations where id = p_id for update;
  if not found then raise exception 'Niva conversation % was not found (it may have been deleted by the 30-day retention job).', p_id; end if;

  if coalesce(p_clear_answer, false) and v.answer is not null then
    v_clear := not exists (
      select 1
        from jsonb_array_elements(case when jsonb_typeof(v.sources) = 'array' then v.sources else '[]'::jsonb end) s(src)
        cross join lateral (
          select coalesce(s.src->>'content_item_id', s.src->>'id') as ref,
                 substring(coalesce(s.src->>'content_item_id', s.src->>'id')
                           from '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$') as ref_id) r
       where r.ref_id is not null
         and case when r.ref like 'guide_section:%'
                  then exists (select 1 from app.guide_sections g where g.id = r.ref_id::uuid and g.public)
                  else exists (select 1 from app.content_items c where c.id = r.ref_id::uuid and c.status = 'published')
             end);
  end if;

  update app.niva_conversations
     set answer = case when v_clear then null else answer end,
         sources = case when v_clear then '[]'::jsonb else sources end,
         unanswered = case when v_clear then true else unanswered end,
         answer_status = case when not v_clear and answer is not null then 'answered' else v_status end,
         outcome_detail = v_detail,
         attempted_at = now()
   where id = p_id
  returning answer_status into v_final;

  if p_retry_at is not null
     and not exists (select 1 from app.jobs j where j.kind = 'niva.answer' and j.status = 'queued'
                       and j.payload->>'conversation_id' = p_id::text) then
    select j.payload into v_payload
      from app.jobs j
     where j.kind = 'niva.answer' and j.status = 'running' and j.payload->>'conversation_id' = p_id::text
     order by j.id desc
     limit 1;
    v_deferrals := case when coalesce(v_payload->>'deferrals', '') ~ '^[0-9]{1,6}$' then (v_payload->>'deferrals')::int else 0 end + 1;
    v_payload := coalesce(v_payload, '{}'::jsonb) || jsonb_build_object('conversation_id', p_id, 'deferrals', v_deferrals);
    v_retry := app.enqueue_job(v.center_id, 'niva.answer', v_payload, greatest(p_retry_at, now()), 3);
  end if;

  return jsonb_build_object('status', v_final, 'cleared', v_clear, 'retry_job_id', v_retry);
end $$;

-- ── (2) Staff: regenerate an answer ──────────────────────────────────────────
-- content/niva "Regenerate" / "Try again" on one question. The existing answer (if any) stays
-- visible to the member until the job finishes. When a niva.answer job for this question is already
-- queued or running, nothing more is queued.
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
  -- Lock the question first, so two presses at once cannot both queue it.
  select * into v from app.niva_conversations where id = p_id for update;
  if exists (select 1 from app.jobs j where j.kind = 'niva.answer' and j.status in ('queued','running')
               and j.payload->>'conversation_id' = p_id::text) then
    return v;
  end if;
  update app.niva_conversations set answer_status = 'pending', outcome_detail = null where id = p_id
  returning * into v;
  perform app.enqueue_job(v.center_id, 'niva.answer', jsonb_build_object('conversation_id', v.id, 'regenerate', true), now(), 3);
  return v;
end $$;

-- ── (4) Staff: try every unanswered question again ───────────────────────────
-- For Content › Niva "Try all unanswered questions again". Picks this center's questions from the
-- last p_since that have no answer, are not waiting for a first try (pending for under 5 minutes),
-- and have no niva.answer job queued or running. They go back to 'pending' and are queued 2 seconds
-- apart. No question is added, so this never counts toward niva.monthly_questions. Returns how many
-- were queued.
create or replace function app.niva_retry_unanswered(p_center uuid, p_since interval default interval '30 days', p_limit int default 100)
returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_since interval := coalesce(p_since, interval '30 days');
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_id uuid;
  v_n int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'content.manage') then
    raise exception 'Trying Niva questions again needs content.manage.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'niva');
  if v_since <= interval '0' then
    raise exception 'Choose a period that goes back in time, for example the last 30 days.';
  end if;

  -- One run per center at a time, so two people pressing it together do not queue a question twice.
  perform pg_advisory_xact_lock(hashtextextended('app.niva_retry_unanswered:' || p_center::text, 0));

  for v_id in
    select c.id
      from app.niva_conversations c
     where c.center_id = p_center and c.answer is null
       and c.created_at >= now() - v_since
       and (c.answer_status <> 'pending' or c.created_at < now() - interval '5 minutes')
       and not exists (select 1 from app.jobs j where j.kind = 'niva.answer' and j.status in ('queued','running')
                         and j.payload->>'conversation_id' = c.id::text)
     order by c.created_at, c.id
     limit v_limit
     for update of c skip locked              -- a question being regenerated right now is left to that
  loop
    -- Checked again now that the row is locked: a regenerate may have queued it in the meantime.
    continue when exists (select 1 from app.jobs j where j.kind = 'niva.answer' and j.status in ('queued','running')
                            and j.payload->>'conversation_id' = v_id::text);
    update app.niva_conversations set answer_status = 'pending', outcome_detail = null where id = v_id;
    perform app.enqueue_job(p_center, 'niva.answer', jsonb_build_object('conversation_id', v_id, 'retry', true),
                            now() + (v_n * interval '2 seconds'), 3);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ── (5) Staff: how Niva is doing ─────────────────────────────────────────────
-- Owner-approved 2026-10-01 for content.draft and content.manage (see the shape in the header).
create or replace function app.niva_health(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_last timestamptz; v_live int; v_state text; v_handler jsonb; v_jobs jsonb;
  v_err text; v_err_at timestamptz; v_err_status text;
  v_used bigint; v_limit jsonb; v_by jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not (app.has_permission(p_center, 'content.draft') or app.has_permission(p_center, 'content.manage')) then
    raise exception 'Seeing how Niva is doing needs content.draft or content.manage.' using errcode = 'insufficient_privilege';
  end if;

  -- The background service, by the same rule as app.background_service_status (0171).
  select max(beat_at), count(*) filter (where stopped_at is null and beat_at >= now() - app.worker_stale_after())
    into v_last, v_live
    from app.worker_heartbeats;
  v_state := case when v_last is null then 'not_configured'
                  when v_live > 0 then 'running'
                  else 'stopped' end;
  select h.info->'handlers'->'niva.answer' into v_handler
    from app.worker_heartbeats h
   order by h.beat_at desc
   limit 1;

  -- This center's niva.answer jobs.
  select jsonb_build_object(
           'queued',         count(*) filter (where status = 'queued'),
           'running',        count(*) filter (where status = 'running'),
           'failed_24h',     count(*) filter (where status = 'failed' and finished_at > now() - interval '24 hours'),
           'done_24h',       count(*) filter (where status = 'done' and finished_at > now() - interval '24 hours'),
           'next_run_after', min(run_after) filter (where status = 'queued'))
    into v_jobs
    from app.jobs
   where center_id = p_center and kind = 'niva.answer'
     and (status in ('queued','running') or finished_at > now() - interval '24 hours');

  -- The latest error in the last 7 days (a job that will retry, or one that failed), scrubbed.
  select left(app.niva_scrub_text(j.last_error), 500), coalesce(j.finished_at, j.created_at), j.status
    into v_err, v_err_at, v_err_status
    from app.jobs j
   where j.center_id = p_center and j.kind = 'niva.answer' and j.last_error is not null
     and j.created_at > now() - interval '7 days'
   order by j.created_at desc, j.id desc
   limit 1;

  -- Questions this month, counted the way niva_ask counts them against niva.monthly_questions.
  select count(*) into v_used
    from app.niva_conversations
   where center_id = p_center and created_at >= date_trunc('month', current_date)::timestamptz;
  v_limit := app.entitlement(p_center, 'niva.monthly_questions');
  if v_limit is not null and jsonb_typeof(v_limit) <> 'number' then v_limit := null; end if;

  -- Questions of the last 7 days by outcome (every status present, 0 when none).
  select jsonb_object_agg(s.k, coalesce(n.cnt, 0))
    into v_by
    from unnest(array['pending','answered','no_source','unsure','refused','paused','failed']) as s(k)
    left join (select answer_status, count(*) as cnt
                 from app.niva_conversations
                where center_id = p_center and created_at >= now() - interval '7 days'
                group by answer_status) n on n.answer_status = s.k;

  return jsonb_build_object(
    'state', v_state,
    'last_beat_at', v_last,
    'age_seconds', case when v_last is null then null else extract(epoch from now() - v_last)::int end,
    'module_on', app.module_enabled(p_center, 'niva'),
    'handler', v_handler,
    'jobs', v_jobs || jsonb_build_object('last_error', v_err, 'last_error_at', v_err_at, 'last_error_status', v_err_status),
    'month', jsonb_build_object('used', v_used, 'limit', v_limit),
    'outcomes_7d', v_by);
end $$;

-- ── (7) Go-live check 12 fingerprints what Niva can answer from: published sources only ──
create or replace function app.niva_content_evidence(p_center uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('sources', coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'title', c.title, 'shared', c.center_id is null, 'status', c.status, 'version', c.version,
           'updated_at', c.updated_at) order by c.title, c.id), '[]'::jsonb))
    from app.content_items c
   where c.kind = 'niva_source' and (c.center_id = p_center or c.center_id is null) and c.status = 'published'
$$;

-- ── (8) 'approved' niva_source rows ──────────────────────────────────────────
-- The demo pack's own rows are sample data: they become 'published', as the demo pack now writes
-- them (below). Any other 'approved' niva_source goes to the approval queue, so a person decides.
do $$
begin
  perform app.set_audit_context('Niva answers from published sources only; "approved" sources become published (demo pack) or wait in the approval queue (0572)');
  update app.content_items c
     set status = 'published', published_at = coalesce(c.published_at, now())
   where c.kind = 'niva_source' and c.status = 'approved' and c.slug like 'demo-%'
     and c.center_id in (select d.center_id from app.center_demo_state d where d.pack_key is not null);
  update app.content_items c
     set status = 'in_review'
   where c.kind = 'niva_source' and c.status = 'approved';
end $$;

-- The demo pack's step 9 (0312), unchanged except: its niva_source is written 'published', and
-- its sample questions carry their answer_status.
create or replace function app.demo_community_community(p_center uuid, p_seed uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare s text := app.demo_short(p_center); v_news uuid := app.demo_id(p_seed, 'comms:newsletter'); v_ann uuid := app.demo_id(p_seed, 'comms:announce');
        r record; v_t uuid; v_survey uuid; m text; i int := 0;
begin
  -- Campaigns: two sent (with their deliveries), one waiting for approval, one draft
  insert into app.comms_campaigns (id, center_id, kind, name, title, body_md, channels, audience, sent_at, status, approved_by, recipients_count, opened_count, created_by, created_at) values
    (v_news, p_center, 'newsletter', 'Monthly newsletter', s || ' newsletter · ' || to_char(app.demo_today(p_center) - 20, 'FMMonth YYYY'),
     '## This month\n\n- Paryushan: thank you to every tapasvi\n- Pathshala term is under way\n- Temple construction update\n\n(Demo newsletter.)',
     '{email}', '{"all_members": true}', now() - interval '20 days', 'sent', p_actor, null, null, p_actor, now() - interval '22 days'),
    (v_ann, p_center, 'event', 'Tapasvi Bahuman invitation', 'You''re invited: Tapasvi Bahuman & Swamivatsalya',
     'Join us to honor this year''s tapasvis. RSVP in the app. (Demo.)', '{push,email}', '{"all_members": true}', now() - interval '5 days', 'sent', p_actor, null, null, p_actor, now() - interval '6 days'),
    (app.demo_id(p_seed, 'comms:appeal'), p_center, 'appeal', 'Construction appeal', 'Help us finish the new derasar',
     'We are 60% of the way there. (Demo appeal.)', '{email,push}', '{"all_members": true}', null, 'pending_approval', null, null, null, p_actor, now() - interval '1 day'),
    (app.demo_id(p_seed, 'comms:pathshala'), p_center, 'pathshala_update', 'Pathshala annual day', 'Save the date: Pathshala annual day',
     'Students will perform; families bring potluck. (Demo draft.)', '{push}', '{"pathshala_families": true}', null, 'draft', null, null, null, p_actor, now());
  insert into app.messages (center_id, campaign_id, person_id, to_address, channel, topic_key, subject, body, scheduled_at, sent_at, delivered_at, opened_at,
                            status, purpose, sandbox, provider)
  select p_center, x.cid, p.id, p.email, 'email', 'newsletter', x.subject, 'Demo message', x.at, x.at, x.at + interval '1 minute',
         case when abs(hashtext(p.email::text)) % 3 <> 0 then x.at + interval '3 hours' end, 'delivered', 'campaign', true, 'demo'
    from app.people p join app.channel_optins o on o.person_id = p.id and o.channel = 'email' and o.opted_in
    cross join (values (v_news, s || ' newsletter', now() - interval '20 days'), (v_ann, 'Tapasvi Bahuman invitation', now() - interval '5 days')) x(cid, subject, at)
   where p.center_id = p_center;
  update app.comms_campaigns c set recipients_count = (select count(*) from app.messages m2 where m2.campaign_id = c.id),
         opened_count = (select count(*) from app.messages m2 where m2.campaign_id = c.id and m2.opened_at is not null)
   where c.id in (v_news, v_ann);
  insert into app.alerts (center_id, severity, title, body, starts_at, ends_at, created_by) values
    (p_center, 'important', 'Parking for the Tapasvi Bahuman', 'Use the overflow lot; volunteers will guide you. (Demo alert.)', now() - interval '1 day', app.demo_at(p_center, 10, '00:00'), p_actor),
    (p_center, 'info', 'Derasar closes early on Friday', 'For maintenance. (Demo alert.)', now() - interval '40 days', now() - interval '35 days', p_actor);
  -- Inbox threads: members write in, staff answer
  for r in select * from (values
      ('t1', 'membership', 'h01.priya', 'Update our address', 'closed', 'We moved to 101 Lotus Lane. Please update our family record.', 'Updated. Thank you, Priyaben!'),
      ('t2', 'donations',  'h14.ashok', 'Receipt for last year', 'open', 'Could you send the year-end receipt for our donor-advised fund grant?', null),
      ('t3', 'pathshala',  'h05.mansi', 'Can Kiara move to the later class?', 'waiting', 'Kiara has swim class at 10. Is there a later Jainism 1 class?', 'Not this term, but we will note it for next term. Would a mid-term check-in help?'),
      ('t4', 'events',     'h04.hemant','Wheelchair access at the Tapasvi Bahuman', 'assigned', 'Kusumben uses a wheelchair. Is the east door open?', 'Yes, the east door will be open with a volunteer.'),
      ('t5', 'office',     'h24.rahul', 'How do we become members?', 'open', 'We are new to the area and would like to join.', null)) x(k, inbox, p, subj, st, q, a)
  loop
    v_t := app.demo_id(p_seed, 'thread:' || r.k);
    insert into app.threads (id, center_id, inbox_id, from_person_id, subject, status, assignee_user, first_response_at, closed_at, created_at)
    values (v_t, p_center, app.demo_id(p_seed, 'inbox:' || r.inbox), app.demo_p(p_seed, r.p), r.subj, r.st,
            case when r.st in ('assigned','waiting','closed') then p_actor end, case when r.a is not null then now() - interval '1 day' end,
            case when r.st = 'closed' then now() - interval '12 hours' end, now() - interval '3 days');
    insert into app.thread_messages (center_id, thread_id, author_user, from_role, body, created_at) values (p_center, v_t, null, false, r.q, now() - interval '3 days');
    if r.a is not null then
      insert into app.thread_messages (center_id, thread_id, author_user, from_role, body, created_at) values (p_center, v_t, p_actor, true, r.a, now() - interval '1 day');
    end if;
  end loop;
  insert into app.whatsapp_join_requests (center_id, group_id, person_id, phone_e164, status, created_at)
  select p_center, app.demo_id(p_seed, 'wa:' || x.g), p.id, p.phone_e164, 'pending', now() - interval '2 days'
    from (values ('announce', 'h07.vikram'), ('pathshala', 'h19.ritu'), ('volunteers', 'h21.rohan')) x(g, pk)
    join app.people p on p.id = app.demo_p(p_seed, x.pk);
  -- Surveys: event feedback (closed, answered), a poll (open), a draft
  v_survey := app.demo_id(p_seed, 'survey:feedback');
  insert into app.surveys (id, center_id, title, description, questions, audience, status, kind, event_id, opens_at, closes_at, created_by) values
    (v_survey, p_center, 'How was the Samvatsari pratikraman?', 'Two quick questions (demo).',
     '[{"id":"q1","type":"rating","label":"How was the evening?","required":true},{"id":"q2","type":"text","label":"What should we change?","required":false}]',
     '{"all_members": true}', 'closed', 'event_feedback', app.demo_id(p_seed, 'ev:paryushan'), now() - interval '33 days', now() - interval '20 days', p_actor),
    (app.demo_id(p_seed, 'survey:poll'), p_center, 'Pathshala start time', 'Would a 9:30 AM start work for your family? (Demo poll.)',
     '[{"id":"q1","type":"single","label":"A 9:30 AM start works for us","options":["Yes","No","Not sure"],"required":true}]',
     '{"all_members": true}', 'open', 'poll', null, now() - interval '4 days', now() + interval '10 days', p_actor),
    (app.demo_id(p_seed, 'survey:seva'), p_center, 'Seva interests', 'Tell us how you would like to help (demo draft).',
     '[{"id":"q1","type":"multi","label":"Where would you like to help?","options":["Kitchen","Pathshala","Events","Parking"],"required":true}]',
     '{"all_members": true}', 'draft', 'general', null, null, null, p_actor);
  for r in select p.id, (row_number() over (order by p.email))::int as n from app.people p
            where p.center_id = p_center and p.email is not null order by p.email limit 12 loop
    insert into app.survey_responses (center_id, survey_id, person_id, answers, submitted_at)
    values (p_center, v_survey, r.id, jsonb_build_object('q1', 3 + (r.n % 3), 'q2', case when r.n % 3 = 0 then 'More seating near the front' when r.n % 4 = 0 then 'Start 15 minutes earlier' else '' end),
            now() - interval '30 days' + make_interval(hours => r.n::int));
    if r.n <= 8 then
      insert into app.survey_responses (center_id, survey_id, person_id, answers, submitted_at)
      values (p_center, app.demo_id(p_seed, 'survey:poll'), r.id, jsonb_build_object('q1', (array['Yes','No','Not sure'])[1 + r.n % 3]), now() - make_interval(hours => r.n::int));
    end if;
  end loop;
  -- Volunteer interests
  insert into app.volunteer_interests (center_id, person_id, group_id, status)
  select p_center, app.demo_p(p_seed, x.p), app.demo_id(p_seed, 'vg:' || x.g), x.st
    from (values ('h02.arjun', 'events', 'active'), ('h13.karan', 'parking', 'active'), ('h17.avni', 'youth', 'interested'),
                 ('h06.rupal', 'kitchen', 'active'), ('h11.krupa', 'kitchen', 'active'), ('h15.falguni', 'kitchen', 'interested'),
                 ('h21.rohan', 'parking', 'active'), ('h02.neha', 'teaching', 'active'), ('h17.rekha', 'teaching', 'active'),
                 ('h03.sonal', 'teaching', 'active'), ('h12.khushi', 'teaching', 'interested'), ('h09.jay', 'events', 'active'),
                 ('h07.anjali', 'youth', 'interested'), ('h20.shweta', 'events', 'interested'), ('h24.mira', 'kitchen', 'interested')) x(p, g, st);
  -- Governance: the Pathshala committee's resolutions and concerns raised
  insert into app.resolutions (center_id, body, title, description, rationale, comment_status, comment_period, voting_status, voting_period, quorum, outcome_note, created_by, created_at) values
    (p_center, 'pathshala_committee', 'Adopt the Pathshala code of conduct', 'A one-page code for students, parents and teachers.', 'Clear expectations for everyone.',
     'started', daterange(app.demo_today(p_center) - 3, app.demo_today(p_center) + 11), 'not_started', null, 4, null, p_actor, now() - interval '3 days'),
    (p_center, 'pathshala_committee', 'Approve the annual day budget', 'Up to $1,500 for the annual day.', 'Stage, sound and certificates.',
     'completed', daterange(app.demo_today(p_center) - 40, app.demo_today(p_center) - 26), 'completed', daterange(app.demo_today(p_center) - 25, app.demo_today(p_center) - 18),
     4, 'Approved 5–0 (demo).', p_actor, now() - interval '40 days'),
    (p_center, 'pathshala_committee', 'Add a Gujarati 2 class', 'Open Gujarati 2 next term if eight students register.', null,
     'not_started', null, 'not_started', null, 4, null, p_actor, now() - interval '1 day');
  insert into app.concerns (center_id, source, submitter_name, submitter_person_id, class_id, title, description, suggestions, status, status_updates, created_at) values
    (p_center, 'parent', 'Mansi Parikh', app.demo_p(p_seed, 'h05.mansi'), app.demo_id(p_seed, 'class:j1'), 'Room A is cold in the morning',
     'The children are wearing jackets in class.', 'Turn the heating on at 9:30.', 'in_progress', '[{"at":"demo","note":"Asked facilities to adjust the schedule"}]', now() - interval '9 days'),
    (p_center, 'teacher', 'Rekha Nagda', app.demo_p(p_seed, 'h17.rekha'), app.demo_id(p_seed, 'class:j3'), 'Need more copies of the sutra book',
     'Six students share books.', null, 'reported', '[]', now() - interval '2 days'),
    (p_center, 'member', 'Hemant Doshi', app.demo_p(p_seed, 'h04.hemant'), null, 'Pickup line blocks the driveway',
     'Cars wait in the driveway at 11:30.', 'A volunteer at the gate.', 'closed', '[{"at":"demo","note":"Parking volunteers added"}]', now() - interval '30 days');
  -- Content: library items in different states, and a few questions members asked Niva
  insert into app.content_items (center_id, tradition, kind, slug, title, body_md, status, published_at, approved_by, created_by, metadata) values
    (p_center, null, 'explainer', 'demo-what-is-paryushan', 'What is Paryushan?', 'Eight days of reflection, fasting and forgiveness, ending with Samvatsari. (Demo text.)', 'published', now() - interval '60 days', p_actor, p_actor, '{}'),
    (p_center, null, 'faq', 'demo-pathshala-registration', 'How do I register for Pathshala?', 'Open the app, go to Learn, and choose Register. Membership is required. (Demo text.)', 'published', now() - interval '90 days', p_actor, p_actor, '{}'),
    (p_center, null, 'sutra', 'demo-uvasaggaharam', 'Uvasaggaharam Stotra', 'Five verses in praise of Parshvanath. (Demo lesson text.)', 'published', now() - interval '30 days', p_actor, p_actor, '{"verses":5}'),
    (p_center, null, 'audio_lesson', 'demo-navkar-audio', 'Navkar Mantra, slowly', 'Audio lesson for young children. (Demo.)', 'in_review', null, null, p_actor, '{"minutes":4}'),
    (p_center, null, 'guide_page', 'demo-visiting-the-derasar', 'Visiting the derasar', 'What to wear, what to bring, and how to do darshan. (Demo draft.)', 'draft', null, null, p_actor, '{}'),
    (p_center, null, 'niva_source', 'demo-bylaws-summary', 'Bylaws summary', 'Membership tiers, voting and elections in brief. (Demo.)', 'published', now() - interval '45 days', p_actor, p_actor, '{}');
  update app.gyan_steps set content_item_id = (select id from app.content_items where center_id = p_center and slug = 'demo-uvasaggaharam')
   where id = app.demo_id(p_seed, 'gyan:step1.1');
  insert into app.niva_conversations (center_id, user_id, question, answer, sources, unanswered, answer_status, created_at) values
    (p_center, null, 'What time does the derasar open on Sunday?', 'The derasar opens at 7:30 AM every day. (Demo answer.)', '[{"title":"Timings and visiting"}]', false, 'answered', now() - interval '6 days'),
    (p_center, null, 'How do I register my son for Pathshala?', 'Open Learn in the app and choose Register; membership is required. (Demo answer.)', '[{"title":"How do I register for Pathshala?"}]', false, 'answered', now() - interval '4 days'),
    (p_center, null, 'Can I pay my pledge with Zelle?', null, '[]', true, 'no_source', now() - interval '2 days'),
    (p_center, null, 'When is the next Tapasvi Bahuman?', 'On ' || to_char(app.demo_today(p_center) + 9, 'FMMonth FMDD') || ' at 10:00 AM in the main hall. (Demo answer.)', '[{"title":"Events"}]', false, 'answered', now() - interval '1 day');
end $$;

-- ── Fill in the outcome of the questions asked so far ────────────────────────
select app.niva_outcome_backfill();

-- ── Grants ───────────────────────────────────────────────────────────────────
-- niva_ask, niva_regenerate, niva_worker_get_conversation, niva_worker_store_answer,
-- niva_content_evidence and demo_community_community keep their grants (same signatures).
revoke execute on function app.niva_scrub_text(text), app.niva_outcome_backfill(uuid),
  app.niva_worker_set_outcome(uuid, text, text, boolean, timestamptz),
  app.niva_retry_unanswered(uuid, interval, int), app.niva_health(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.niva_worker_set_outcome(uuid, text, text, boolean, timestamptz) to connect_worker;
grant execute on function app.niva_retry_unanswered(uuid, interval, int), app.niva_health(uuid) to authenticated;
