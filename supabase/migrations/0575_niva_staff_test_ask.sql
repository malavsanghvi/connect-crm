-- 0575_niva_staff_test_ask.sql (Niva fix plan, PR H: G17, G20, G6)
--
-- Content staff could not try Niva: the only way to ask was app.niva_ask, which needs a membership
-- (center_users) in the community, counts against the members' monthly question limit
-- (niva.monthly_questions), puts the test into the members' Unanswered and Recent lists, and only
-- ever searches published sources, so a section could not be tried before it was approved.
-- Owner decision 2026-10-01 (approved): content staff may test Niva and preview its answers,
-- including from sources waiting for approval; tests are kept out of the monthly limit.
--
--   (1) app.niva_conversations.is_test (default false): a staff test. A trigger lets only content
--       staff (content.draft or content.manage) save a question marked as a test, so a member cannot
--       use the direct-insert policy (niva_insert, left in place by owner decision) to fill the
--       community's test allowance or hide questions from staff. The policy itself is unchanged.
--   (2) app.niva_test_ask(center, question, include_in_review default false)
--                                                             content.draft or content.manage
--       Skips the membership check and the monthly limit, and has its own: 100 tests per community
--       per day (the community's own day, in its time zone). Needs the Niva module on. Saves the
--       question as a test (user_id = the tester) and queues niva.answer with
--       {conversation_id, include_in_review}; the worker already searches published and
--       in-review sources when include_in_review is true (worker/src/handlers/niva.answer.ts).
--       Returns {id, question, created_at, include_in_review, tests_today, daily_limit}.
--   (3) app.niva_test_result(id)        the tester (still content staff), or content.manage
--       One test as the portal's test box shows it while it polls:
--         {id, question, answer, answer_status, outcome_detail, created_at, answered_at, attempted_at,
--          model, include_in_review, job: {status, attempts, max_attempts, run_after} | null,
--          sources: [{id, title, url, kind, status}]}
--       where a cited source's status is its current one: a content item's status (published,
--       in_review, ...), 'published' or 'hidden' for a Guide section, 'missing' when it is gone.
--   (4) Tests stay out of the members' numbers:
--         niva_ask           the monthly count leaves tests out (otherwise as 0572);
--         niva_health        month.used and outcomes_7d leave tests out, and tests_today
--                            {used, limit} is added (otherwise as 0572);
--         niva_retry_unanswered  never picks a test (its job would lose include_in_review; a tester
--                            asks again instead) (otherwise as 0572);
--         niva_worker_get_conversation  "recent" (the follow-up context) holds only turns of the
--                            same kind: a member's real question never reads a staff test as
--                            context, nor a test a member's question; it also returns is_test.
--
-- 0572 is applied and untouched; its functions are replaced here with create or replace (same
-- signatures, so their grants stay).

set client_min_messages = warning;

-- ── (1) Which questions are staff tests ──────────────────────────────────────
alter table app.niva_conversations add column if not exists is_test boolean not null default false;
comment on column app.niva_conversations.is_test is
  'A staff test from Content › Niva (app.niva_test_ask, 0575): not a member''s question, so it is left out of niva.monthly_questions, the members'' Unanswered and Recent lists, Try all unanswered questions again and Niva health''s question counts.';

create index if not exists niva_conversations_tests_idx on app.niva_conversations (center_id, created_at desc) where is_test;

-- Only content staff save a question marked as a test. A signed-out session (migrations, seeds, the
-- background service) is not checked.
create or replace function app.niva_conversations_guard_test() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.is_test and auth.uid() is not null
     and not (app.has_permission(new.center_id, 'content.draft') or app.has_permission(new.center_id, 'content.manage')) then
    raise exception 'Only content staff (content.draft or content.manage) can save a Niva staff test.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists niva_conversations_guard_test on app.niva_conversations;
create trigger niva_conversations_guard_test before insert or update of is_test on app.niva_conversations
  for each row when (new.is_test) execute function app.niva_conversations_guard_test();

-- ── Helpers: the community's day, and its tests so far today ─────────────────
-- Staff tests allowed per community per day.
create or replace function app.niva_test_daily_limit() returns integer
language sql immutable set search_path = app, public, extensions as $$ select 100 $$;

-- Midnight today in the community's time zone (UTC when it has none, or one Postgres does not know).
create or replace function app.niva_center_day_start(p_center uuid) returns timestamptz
language plpgsql stable set search_path = app, public, extensions as $$
declare v_tz text;
begin
  select nullif(btrim(c.time_zone), '') into v_tz from app.centers c where c.id = p_center;
  v_tz := coalesce(v_tz, 'UTC');
  begin
    return date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  exception when others then
    return date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  end;
end $$;

create or replace function app.niva_tests_today(p_center uuid) returns integer
language sql stable set search_path = app, public, extensions as $$
  select count(*)::int from app.niva_conversations
   where center_id = p_center and is_test and created_at >= app.niva_center_day_start(p_center)
$$;

-- ── (2) Staff: test Niva ─────────────────────────────────────────────────────
create or replace function app.niva_test_ask(p_center uuid, p_question text, p_include_in_review boolean default false)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_q text;
  v_row app.niva_conversations;
  v_limit int := app.niva_test_daily_limit();
  v_used int;
  v_review boolean := coalesce(p_include_in_review, false);
begin
  if auth.uid() is null then raise exception 'Sign in to test Niva.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not (app.has_permission(p_center, 'content.draft') or app.has_permission(p_center, 'content.manage')) then
    raise exception 'Testing Niva needs content.draft or content.manage.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'niva');
  v_q := nullif(btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g')), '');
  if v_q is null then raise exception 'Type a question first.'; end if;
  v_q := left(v_q, 1000);

  -- One tester per community at a time, so two tests at once cannot both slip in under the limit.
  perform pg_advisory_xact_lock(hashtextextended('app.niva_conversations.test_cap:' || p_center::text, 0));
  v_used := app.niva_tests_today(p_center);
  if v_used >= v_limit then
    raise exception 'Staff can test Niva % times a day in this community, and today''s tests are used up. Try again tomorrow; members can still ask Niva as usual.', v_limit;
  end if;

  insert into app.niva_conversations (center_id, user_id, question, unanswered, answer_status, is_test)
  values (p_center, auth.uid(), v_q, true, 'pending', true)
  returning * into v_row;

  perform app.enqueue_job(p_center, 'niva.answer',
                          jsonb_build_object('conversation_id', v_row.id, 'include_in_review', v_review), now(), 3);

  return jsonb_build_object('id', v_row.id, 'question', v_row.question, 'created_at', v_row.created_at,
                            'include_in_review', v_review, 'tests_today', v_used + 1, 'daily_limit', v_limit);
end $$;
comment on function app.niva_test_ask(uuid, text, boolean) is
  'content.draft or content.manage (0575): ask Niva as a staff test. No membership needed and not counted in niva.monthly_questions; at most app.niva_test_daily_limit() tests per community per day. include_in_review: also answer from sources waiting for approval.';

-- ── (3) Staff: one test's result, for the test box ───────────────────────────
create or replace function app.niva_test_result(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v app.niva_conversations;
  v_job jsonb;
  v_review boolean;
  v_sources jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into v from app.niva_conversations where id = p_id and is_test;
  -- The same answer for "no such test" and "not yours to see", so an id says nothing about other tests.
  if not found
     or not (app.has_permission(v.center_id, 'content.manage')
             or (v.user_id = auth.uid() and app.has_permission(v.center_id, 'content.draft'))) then
    raise exception 'That Niva test was not found. Tests are kept for 30 days; ask the question again.' using errcode = 'P0002';
  end if;

  select jsonb_build_object('status', j.status, 'attempts', j.attempts, 'max_attempts', j.max_attempts, 'run_after', j.run_after),
         coalesce(j.payload->'include_in_review' = 'true'::jsonb, false)
    into v_job, v_review
    from app.jobs j
   where j.kind = 'niva.answer' and j.payload->>'conversation_id' = p_id::text
   order by j.id desc
   limit 1;

  -- Each cited source with its status now: a test may cite a source that is still waiting for approval.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.ref, 'title', coalesce(nullif(s.src->>'title', ''), g.title, c.title), 'url', s.src->>'url',
           'kind', case when r.ref like 'guide_section:%' then 'guide_section' else c.kind end,
           'status', case when r.ref like 'guide_section:%'
                          then case when g.id is null then 'missing' when g.public then 'published' else 'hidden' end
                          else coalesce(c.status, 'missing') end)
           order by s.n), '[]'::jsonb)
    into v_sources
    from jsonb_array_elements(case when jsonb_typeof(v.sources) = 'array' then v.sources else '[]'::jsonb end)
         with ordinality as s(src, n)
    cross join lateral (
      select coalesce(s.src->>'content_item_id', s.src->>'id') as ref,
             substring(coalesce(s.src->>'content_item_id', s.src->>'id')
                       from '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$') as ref_id) r
    left join app.guide_sections g on r.ref like 'guide_section:%' and g.id = r.ref_id::uuid
    left join app.content_items c on r.ref not like 'guide_section:%' and c.id = r.ref_id::uuid;

  return jsonb_build_object(
    'id', v.id, 'question', v.question, 'answer', v.answer, 'answer_status', v.answer_status,
    'outcome_detail', v.outcome_detail, 'created_at', v.created_at, 'answered_at', v.answered_at,
    'attempted_at', v.attempted_at, 'model', v.model, 'include_in_review', coalesce(v_review, false),
    'job', v_job, 'sources', v_sources);
end $$;
comment on function app.niva_test_result(uuid) is
  'The tester (still content staff) or content.manage (0575): one staff test with its latest niva.answer job and the current status of each source it cites.';

-- ── (4) Member: ask a question (0572, with tests left out of the monthly count) ──
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
   where center_id = p_center and not is_test and created_at >= date_trunc('month', current_date)::timestamptz;
  perform app.assert_entitlement(p_center, 'niva.monthly_questions', to_jsonb(v_count + 1));

  insert into app.niva_conversations (center_id, user_id, question, unanswered, answer_status)
  values (p_center, auth.uid(), v_q, true, 'pending')
  returning * into v_row;

  perform app.enqueue_job(p_center, 'niva.answer', jsonb_build_object('conversation_id', v_row.id), now(), 3);
  return v_row;
end $$;

-- ── (4) Worker: read one conversation (0572; recent keeps to the same kind) ──
-- recent: the same person's answered questions in this center from the 15 minutes before this one
-- (at most 2, oldest first), so a follow-up ("and on Sunday?") can be understood. Never another
-- person's rows, and never a staff test as context for a member's question (or the other way).
create or replace function app.niva_worker_get_conversation(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v app.niva_conversations; v_name text; v_tz text; v_local timestamp; v_asked timestamp; v_recent jsonb;
begin
  perform app.assert_worker();
  select * into v from app.niva_conversations where id = p_id;
  if not found then return null; end if;

  select c.name, c.time_zone into v_name, v_tz from app.centers c where c.id = v.center_id;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
  begin
    v_local := now() at time zone v_tz;
    v_asked := v.created_at at time zone v_tz;
  exception when others then                -- a time zone Postgres does not know: fall back to UTC
    v_tz := 'UTC';
    v_local := now() at time zone 'UTC';
    v_asked := v.created_at at time zone 'UTC';
  end;

  select coalesce(jsonb_agg(jsonb_build_object('question', r.question, 'answer', r.answer, 'created_at', r.created_at)
                            order by r.created_at), '[]'::jsonb)
    into v_recent
    from (select x.question, x.answer, x.created_at
            from app.niva_conversations x
           where v.user_id is not null and x.user_id = v.user_id and x.center_id = v.center_id and x.id <> v.id
             and x.is_test = v.is_test
             and x.answer is not null
             and x.created_at < v.created_at and x.created_at >= v.created_at - interval '15 minutes'
           order by x.created_at desc
           limit 2) r;

  return jsonb_build_object(
    'id', v.id, 'center_id', v.center_id, 'user_id', v.user_id, 'question', v.question, 'unanswered', v.unanswered,
    'created_at', v.created_at, 'answer_status', v.answer_status, 'has_answer', v.answer is not null,
    'is_test', v.is_test,
    'center_name', v_name, 'time_zone', v_tz,
    'local_now', to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'local_today', to_char(v_local, 'FMDay, FMDD FMMonth YYYY'),
    'asked_local', to_char(v_asked, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'asked_today', to_char(v_asked, 'FMDay, FMDD FMMonth YYYY'),
    'recent', v_recent);
end $$;

-- ── (4) Staff: try every unanswered question again (0572, members' questions only) ──
-- As 0572 (see the comment there), except that a staff test is never picked: it is not a member's
-- question, and its job would lose include_in_review. A tester asks again from the test box.
create or replace function app.niva_retry_unanswered(p_center uuid, p_since interval default interval '30 days', p_limit int default 100)
returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_since interval := coalesce(p_since, interval '30 days');
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 150);
  v_soon timestamptz := now() + interval '5 minutes';
  v_id uuid;
  v_job bigint;
  v_at timestamptz;
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
     where c.center_id = p_center and c.answer is null and not c.is_test
       and c.created_at >= now() - v_since
       and (c.answer_status <> 'pending' or c.created_at < now() - interval '5 minutes')
       and not exists (select 1 from app.jobs j where j.kind = 'niva.answer' and j.payload->>'conversation_id' = c.id::text
                         and (j.status = 'running' or (j.status = 'queued' and j.run_after <= v_soon)))
     order by c.created_at, c.id
     limit v_limit
     for update of c skip locked              -- a question being regenerated right now is left to that
  loop
    -- Checked again now that the row is locked: a regenerate may have queued it in the meantime.
    continue when exists (select 1 from app.jobs j where j.kind = 'niva.answer' and j.payload->>'conversation_id' = v_id::text
                            and (j.status = 'running' or (j.status = 'queued' and j.run_after <= v_soon)));
    v_at := now() + (v_n * interval '2 seconds');
    select j.id into v_job
      from app.jobs j
     where j.kind = 'niva.answer' and j.status = 'queued' and j.payload->>'conversation_id' = v_id::text
     order by j.id desc
     limit 1;
    if v_job is not null then
      -- A retry queued for later: bring it forward (its payload, deferrals included, is kept).
      update app.jobs set run_after = v_at, payload = payload || '{"retry": true}'::jsonb
       where id = v_job and status = 'queued';
      continue when not found;               -- the worker took it in the meantime: it is on its way
    else
      perform app.enqueue_job(p_center, 'niva.answer', jsonb_build_object('conversation_id', v_id, 'retry', true), v_at, 3);
    end if;
    update app.niva_conversations set answer_status = 'pending', outcome_detail = null where id = v_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ── (4) Staff: how Niva is doing (0572; members' questions, plus today's tests) ──
-- As 0572 (see the shape in its header), except that month.used and outcomes_7d count members'
-- questions only (month.used is what niva_ask counts against niva.monthly_questions), and
-- tests_today {used, limit} says how many staff tests are left today.
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
  -- What niva.answer reports: from the newest live worker that runs it; with none, the newest heartbeat
  -- (a stopped worker, or one that does not run niva.answer, must not hide a live one that does).
  select h.info->'handlers'->'niva.answer' into v_handler
    from app.worker_heartbeats h
   order by (h.stopped_at is null and h.beat_at >= now() - app.worker_stale_after() and 'niva.answer' = any (h.kinds)) desc,
            h.beat_at desc
   limit 1;

  -- This center's niva.answer jobs (tests included: they run on the same service).
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

  -- Members' questions this month, counted the way niva_ask counts them against niva.monthly_questions.
  select count(*) into v_used
    from app.niva_conversations
   where center_id = p_center and not is_test and created_at >= date_trunc('month', current_date)::timestamptz;
  v_limit := app.entitlement(p_center, 'niva.monthly_questions');
  if v_limit is not null and jsonb_typeof(v_limit) <> 'number' then v_limit := null; end if;

  -- Members' questions of the last 7 days by outcome (every status present, 0 when none).
  select jsonb_object_agg(s.k, coalesce(n.cnt, 0))
    into v_by
    from unnest(array['pending','answered','no_source','unsure','refused','paused','failed']) as s(k)
    left join (select answer_status, count(*) as cnt
                 from app.niva_conversations
                where center_id = p_center and not is_test and created_at >= now() - interval '7 days'
                group by answer_status) n on n.answer_status = s.k;

  return jsonb_build_object(
    'state', v_state,
    'last_beat_at', v_last,
    'age_seconds', case when v_last is null then null else extract(epoch from now() - v_last)::int end,
    'module_on', app.module_enabled(p_center, 'niva'),
    'handler', v_handler,
    'jobs', v_jobs || jsonb_build_object('last_error', v_err, 'last_error_at', v_err_at, 'last_error_status', v_err_status),
    'month', jsonb_build_object('used', v_used, 'limit', v_limit),
    'outcomes_7d', v_by,
    'tests_today', jsonb_build_object('used', app.niva_tests_today(p_center), 'limit', app.niva_test_daily_limit()));
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- niva_ask, niva_worker_get_conversation, niva_retry_unanswered and niva_health keep their grants
-- (same signatures).
revoke execute on function app.niva_conversations_guard_test(), app.niva_test_daily_limit(), app.niva_center_day_start(uuid),
  app.niva_tests_today(uuid), app.niva_test_ask(uuid, text, boolean), app.niva_test_result(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.niva_test_ask(uuid, text, boolean), app.niva_test_result(uuid) to authenticated;
