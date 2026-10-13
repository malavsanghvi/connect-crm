-- 0755 · The iWeaver gate (docs/MARKETPLACE_PACKS.md section 2, B104): every AI feature needs the `ai` module, except AI used
-- in onboarding.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Weaver pays for every AI call on its own keys, so AI is a product of its own, iWeaver (module key `ai`, added with the
--   catalog in 0750-0754, off for every kind until Weaver grants it; Niva depends on it there). While `ai` is off for a
--   community, nothing it asks for reaches an AI provider, and whoever asked is told in one plain sentence:
--
--     "AI features are part of iWeaver, which is not on for your community."
--
--   Where the check is, for each way AI is asked for today:
--     app.assert_module_enabled         every Niva function (niva_ask from the member app, niva_test_ask, niva_retry_unanswered,
--                                       and every read guarded by the `niva` module) says the sentence instead of "Niva is off
--                                       because iWeaver is off" when the module needs `ai`. Platform admins still pass, as in RLS.
--     app.enqueue_job                   refuses the AI job kinds (app.ai_job_kinds: niva.answer, events.generate_flyer) for a
--                                       community without `ai`, whoever asks, a platform admin too. Every request function, the
--                                       worker's own re-queue of a paused question and any later AI job go through it.
--     app.niva_regenerate               (0572) checked no module at all; it now needs `ai` and `niva`, also when it only brings
--                                       an already queued job forward.
--     app.flyer_art_over_limit          (0585) gives the sentence first, so app.events_request_flyer_art (0703) and
--                                       app.events_request_flyer (0585) answer {status: 'unavailable', reason} and queue nothing.
--     app.flyer_art_status              (0585) says {state: 'ai_off', reason} first, for the flyer panels.
--     app.assistant_usage_check         (0617) runs before every model call of Niva for admins (the portal calls the provider
--                                       itself): it answers {allowed: false, reason} without counting. A new three-argument form
--                                       takes what the call is for ('chat' or 'onboarding'); 'onboarding' is allowed without
--                                       `ai` only while the community's own status is 'onboarding' (app.centers.status, which
--                                       Weaver sets and going live changes), never on the caller's word alone. The monthly
--                                       limit (assistant.monthly_actions) counts both. The two-argument form is 'chat'.
--     app.worker_job_blocked            new, for the background service only: before an AI job runs, why it may not (the
--                                       sentence, or "<module> is switched off for your community."), or null. A job queued
--                                       before `ai` or Niva went off ends with that message and is not tried again.
--
--   Not gated, on purpose: import column-mapping suggestions (import.suggest_mapping) and QuickBooks donor-match suggestions
--   (qbo.match_suggest_ai) are used in onboarding and stay core; the provider Test buttons are platform-only.
--
--   A NULL community (a platform-wide job) is never refused. An unknown module key reads as on (0740), so before the catalog
--   has an `ai` row nothing here refuses anything. No table, policy or grant changes, except the new worker-only function.
--   Test 162.

-- ── The sentence and the list ────────────────────────────────────────────────

create or replace function app.ai_off_message() returns text
language sql immutable set search_path = app, public, extensions as $$
  select 'AI features are part of iWeaver, which is not on for your community.'::text
$$;
comment on function app.ai_off_message() is
  'iWeaver (0755): the one sentence said wherever AI is refused because the `ai` module is off. The portal has the same words (src/lib/ai-gate.ts, AI_OFF).';

-- The job kinds that call an AI provider and are part of iWeaver. The background service has the same list
-- (worker/src/ai-kinds.ts, the kinds with `ai` among their modules); test 162 and the worker's tests each check it.
create or replace function app.ai_job_kinds() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['events.generate_flyer', 'niva.answer']::text[]
$$;

-- Raises the sentence when `ai` is off for the community. No platform-admin pass: it guards work that costs money per use.
create or replace function app.assert_ai_enabled(p_center uuid) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if app.module_enabled(p_center, 'ai') then return true; end if;
  raise exception '%', app.ai_off_message()
    using errcode = 'insufficient_privilege', hint = 'An administrator can ask for iWeaver in Settings › Marketplace.';
end $$;

-- Asking Niva for admins during onboarding stays core: while the community's own status is 'onboarding'.
create or replace function app.ai_onboarding_exempt(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.centers c where c.id = p_center and c.status = 'onboarding')
$$;

-- ── Module guard (0740's body; the `ai` branch is new) ───────────────────────

create or replace function app.assert_module_enabled(p_center uuid, p_module text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_dep text;
begin
  if app.module_enabled(p_center, p_module) or app.is_platform_admin() then return true; end if;
  -- 0755: a module that needs iWeaver (itself, or a module it depends on) while iWeaver is off: the one sentence.
  if 'ai' = any (app._module_chain(p_module)) and not app.module_enabled(p_center, 'ai') then
    raise exception '%', app.ai_off_message()
      using errcode = 'insufficient_privilege', hint = 'An administrator can ask for iWeaver in Settings › Marketplace.';
  end if;
  if app.module_availability(p_center, p_module) = 'not_available' then
    raise exception '% is not part of a % organization.',
      coalesce((select cm.label from app.category_modules cm where cm.category_key = app.center_category(p_center) and cm.module_key = p_module),
               (select label from app.modules where key = p_module), p_module),
      coalesce((select k.label from app.organization_categories k where k.key = app.center_category(p_center)), 'this')
      using errcode = 'insufficient_privilege', hint = 'Community Connect can change an organization''s category.';
  end if;
  if not app._module_granted(p_center, p_module) then
    raise exception 'Weaver has not enabled % for this community.', app._module_label(p_center, p_module)
      using errcode = 'insufficient_privilege', hint = 'Ask Weaver to enable it.';
  end if;
  if app._module_self_on(p_center, p_module, app.module_availability(p_center, p_module)) then
    -- Its own switch is on: a module it needs is off.
    select app._module_label(p_center, ch.k) into v_dep
      from unnest(app._module_chain(p_module)) with ordinality as ch(k, n)
     where ch.k <> p_module and not app._module_self_on(p_center, ch.k, app.module_availability(p_center, ch.k))
     order by ch.n limit 1;
    raise exception '% is off because % is off for this community.', app._module_label(p_center, p_module), coalesce(v_dep, 'a module it needs')
      using errcode = 'insufficient_privilege', hint = 'Settings › Modules shows why.';
  end if;
  raise exception 'The % module is switched off for this community.',
    coalesce((select label from app.modules where key = p_module), p_module)
    using errcode = 'insufficient_privilege', hint = 'An administrator can switch it on in Settings › Modules.';
end $$;

-- ── The queue (0171's body; the AI check is new) ─────────────────────────────

create or replace function app.enqueue_job(p_center uuid, p_kind text, p_payload jsonb, p_run_after timestamptz default now(),
                                           p_max_attempts int default 5)
returns bigint language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id bigint;
begin
  if p_kind is null or p_kind !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' then
    raise exception 'A job kind looks like "area.action", for example demo.ping (got "%").', p_kind;
  end if;
  -- 0755: AI work for a community without iWeaver is not queued, whoever asks.
  if p_center is not null and p_kind = any (app.ai_job_kinds()) and not app.module_enabled(p_center, 'ai') then
    raise exception '%', app.ai_off_message()
      using errcode = 'insufficient_privilege', hint = 'An administrator can ask for iWeaver in Settings › Marketplace.';
  end if;
  insert into app.jobs (center_id, kind, payload, run_after, max_attempts, created_by)
  values (p_center, p_kind, coalesce(p_payload, '{}'::jsonb), coalesce(p_run_after, now()),
          least(greatest(coalesce(p_max_attempts, 5), 1), 25), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ── Niva: regenerate one answer (0572's body; the two checks are new) ────────

create or replace function app.niva_regenerate(p_id uuid)
returns app.niva_conversations
language plpgsql security definer set search_path = app, public, extensions as $$
declare v app.niva_conversations; v_job bigint; v_run_after timestamptz;
begin
  select * into v from app.niva_conversations where id = p_id;
  if not found then raise exception 'That Niva question was not found.'; end if;
  if not app.has_permission(v.center_id, 'content.manage') then
    raise exception 'Regenerating a Niva answer needs content.manage.' using errcode = 'insufficient_privilege';
  end if;
  -- 0755: an answer is made by AI, and only while Niva is on (bringing a queued job forward included).
  perform app.assert_ai_enabled(v.center_id);
  perform app.assert_module_enabled(v.center_id, 'niva');
  -- Lock the question first, so two presses at once cannot both queue it.
  select * into v from app.niva_conversations where id = p_id for update;
  if exists (select 1 from app.jobs j where j.kind = 'niva.answer' and j.status = 'running'
               and j.payload->>'conversation_id' = p_id::text) then
    return v;
  end if;
  select j.id, j.run_after into v_job, v_run_after
    from app.jobs j
   where j.kind = 'niva.answer' and j.status = 'queued' and j.payload->>'conversation_id' = p_id::text
   order by j.id desc
   limit 1;
  if v_job is not null then
    if v_run_after <= now() then return v; end if;
    update app.jobs set run_after = now(), payload = payload || '{"regenerate": true}'::jsonb
     where id = v_job and status = 'queued';
    if not found then return v; end if;     -- the worker took it in the meantime: it is running now
  else
    perform app.enqueue_job(v.center_id, 'niva.answer', jsonb_build_object('conversation_id', v.id, 'regenerate', true), now(), 3);
  end if;
  update app.niva_conversations
     set answer_status = case when answer is null then 'pending' else 'answered' end, outcome_detail = null
   where id = p_id
  returning * into v;
  return v;
end $$;

-- ── AI flyer art (0585's bodies; the iWeaver answer comes first) ─────────────

-- Why AI art cannot be asked for now (iWeaver off, or the daily limit reached), or null.
create or replace function app.flyer_art_over_limit(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case when not app.module_enabled(p_center, 'ai') then app.ai_off_message()
              when count(*) >= app.flyer_art_daily_limit()
              then 'This community has asked for ' || app.flyer_art_daily_limit() || ' AI pictures in the last 24 hours, the most allowed in a day. '
                   || 'Reuse one already made, use the drawn art, or try again tomorrow.'
         end
    from app.jobs
   where center_id = p_center and kind = 'events.generate_flyer' and created_at > now() - interval '24 hours'
$$;

--   ai_off         iWeaver is not on for this community (0755)
--   ready          a live worker has a Gemini key (and says which model)
--   no_key         live workers, none with a key
--   update_needed  live workers, none of them knows Gemini yet (an older deploy)
--   no_service     no worker has reported in the last few minutes
create or replace function app.flyer_art_status(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_live int; v_h jsonb;
begin
  if not (app.is_member_of(p_center) or app.is_platform_admin()) then
    raise exception 'you can''t see this community''s flyer settings.' using errcode = 'insufficient_privilege';
  end if;
  if not app.module_enabled(p_center, 'ai') then
    return jsonb_build_object('state', 'ai_off', 'reason', app.ai_off_message());
  end if;
  select count(*) into v_live from app.worker_heartbeats
   where stopped_at is null and beat_at >= now() - app.worker_stale_after();
  if v_live = 0 then return jsonb_build_object('state', 'no_service'); end if;
  select h.info -> 'handlers' -> 'events.generate_flyer' into v_h
    from app.worker_heartbeats h
   where h.stopped_at is null and h.beat_at >= now() - app.worker_stale_after()
     and h.info -> 'handlers' -> 'events.generate_flyer' ->> 'provider' = 'gemini'
   order by (h.info -> 'handlers' -> 'events.generate_flyer' ->> 'configured') = 'true' desc, h.beat_at desc
   limit 1;
  if v_h is null then return jsonb_build_object('state', 'update_needed'); end if;
  if v_h ->> 'configured' = 'true' then
    return jsonb_build_object('state', 'ready', 'model', left(coalesce(v_h ->> 'model', ''), 80));
  end if;
  return jsonb_build_object('state', 'no_key');
end $$;

-- ── Niva for admins: the model call's count (0617's body; the purpose and the iWeaver answer are new) ──

create or replace function app.assistant_usage_check(p_center uuid, p_cost integer, p_purpose text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_user uuid; v_limit integer; v_month date := app._assistant_month(); v_used integer; v_why text;
begin
  v_user := app._assistant_actor(p_center);
  -- Refused, not clamped: a direct call cannot burn the community's month in one go, and nobody is told a bigger use
  -- was counted as a smaller one.
  if p_cost is null or p_cost < 1 or p_cost > 5 then
    raise exception 'An action must count for between 1 and 5.';
  end if;
  if p_purpose is null or p_purpose not in ('chat', 'onboarding') then
    raise exception 'Say what the action is for: chat or onboarding.';
  end if;
  v_limit := app._assistant_limit(p_center);
  -- 0755: the model call is part of iWeaver; asking during onboarding stays core while the community is onboarding.
  if not app.module_enabled(p_center, 'ai') and not (p_purpose = 'onboarding' and app.ai_onboarding_exempt(p_center)) then
    select coalesce((select u.used from app.assistant_usage u where u.center_id = p_center and u.month = v_month), 0) into v_used;
    return jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit, 'month', v_month, 'reason', app.ai_off_message());
  end if;
  if v_limit is null or p_cost <= v_limit then
    insert into app.assistant_usage as u (center_id, month, used) values (p_center, v_month, p_cost)
    on conflict (center_id, month) do update set used = u.used + excluded.used, updated_at = now()
      where v_limit is null or u.used + excluded.used <= v_limit
    returning u.used into v_used;
  end if;
  if v_used is not null then
    return jsonb_build_object('allowed', true, 'used', v_used, 'limit', v_limit, 'month', v_month);
  end if;
  select coalesce((select u.used from app.assistant_usage u where u.center_id = p_center and u.month = v_month), 0) into v_used;
  v_why := format('Niva has used up this community''s %s actions for the month. It starts again on the 1st, or ask Community Connect to raise the limit.',
                  to_char(v_limit, 'FM999,999,999,990'));
  return jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit, 'month', v_month, 'reason', v_why);
end $$;

-- The two-argument form (0617's signature, which installed portals call): a chat message.
create or replace function app.assistant_usage_check(p_center uuid, p_cost integer default 1) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  return app.assistant_usage_check(p_center, p_cost, 'chat'::text);
end $$;

-- ── The background service: may this AI job run? ─────────────────────────────

-- p_modules: the modules the job's kind needs (worker/src/ai-kinds.ts), `ai` first. Null when every one is on.
create or replace function app.worker_job_blocked(p_center uuid, p_modules text[]) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_key text;
begin
  perform app.assert_worker();
  if p_center is null then return null; end if;
  if 'ai' = any (coalesce(p_modules, '{}')) and not app.module_enabled(p_center, 'ai') then
    return app.ai_off_message();
  end if;
  select x.m into v_key
    from unnest(coalesce(p_modules, '{}')) with ordinality as x(m, n)
   where not app.module_enabled(p_center, x.m)
   order by x.n
   limit 1;
  if v_key is null then return null; end if;
  return app._module_label(p_center, v_key) || ' is switched off for your community.';
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE keeps a function's privileges; the lines for the redefined ones are repeated so the file is complete.
revoke execute on function app.ai_off_message(), app.ai_job_kinds(), app.assert_ai_enabled(uuid), app.ai_onboarding_exempt(uuid),
  app.worker_job_blocked(uuid, text[]) from public, anon, authenticated;
grant execute on function app.ai_off_message(), app.ai_job_kinds(), app.assert_ai_enabled(uuid), app.ai_onboarding_exempt(uuid)
  to service_role;
revoke execute on function app.worker_job_blocked(uuid, text[]) from service_role;
grant execute on function app.worker_job_blocked(uuid, text[]) to connect_worker;

grant execute on function app.assert_module_enabled(uuid, text) to authenticated;
revoke execute on function app.flyer_art_over_limit(uuid) from public, anon, authenticated;
revoke execute on function app.flyer_art_status(uuid) from public, anon;
grant execute on function app.flyer_art_status(uuid) to authenticated, service_role;

revoke execute on function app.assistant_usage_check(uuid, integer, text), app.assistant_usage_check(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function app.assistant_usage_check(uuid, integer, text), app.assistant_usage_check(uuid, integer) to authenticated;

comment on function app.assistant_usage_check(uuid, integer, text) is
  'Niva for admins (0617, 0755): count p_cost actions (1 to 5) against the community''s month (entitlement assistant.monthly_actions) for p_purpose (''chat'' or ''onboarding''). Without iWeaver (`ai`) only ''onboarding'' is allowed, and only while the community''s status is ''onboarding''. Returns {allowed, used, limit, month, reason?}.';
comment on function app.assistant_usage_check(uuid, integer) is
  'Niva for admins (0617): app.assistant_usage_check(p_center, p_cost, ''chat'').';
comment on function app.worker_job_blocked(uuid, text[]) is
  'iWeaver (0755), background service only: why an AI job of this community may not run (iWeaver or a module it needs is off), or null.';
