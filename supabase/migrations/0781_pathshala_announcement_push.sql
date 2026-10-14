-- 0781: a class announcement that is PUBLISHED reaches the families it is for in the member app, as a push.
--
-- The gap (PATHSHALA_REGISTRATION_PLAN F8): the portal said "Published to families." but nothing told them and the
-- member app had no screen for class announcements. The screen is in connect-mobile (1.19.0: it reads the table through
-- the existing policy announcements_parents, so no access rule changes here). This migration is the push (decision
-- P31, approved by the owner: to the household's adults, never to a child, quiet hours and opt-outs apply).
--
-- Whoever publishes it, by whatever path (the Pathshala principal or a teacher of that class, in the portal's "Publish
-- now", the Publish button on a draft, or any later tool), the database is the one place that sees the moment it
-- becomes published: a trigger on class_announcements queues ONE background job (pathshala.announcement_notify) when
-- published_at goes from empty to a time (an insert that is already published counts). Unpublishing and publishing
-- again queues another job, and the per-person log below keeps it from telling anyone twice.
--
-- Who is told: the adults (not children, not the deceased) of every household that has a learner PLACED or ACTIVE in
-- the announcement's class, or, for a whole-Pathshala announcement, in its term. Each adult once per announcement
-- (app.notice_log, kind pathshala_announcement), with a push to each of their phones, through app._member_push: quiet
-- hours hold it until they end, the sandbox allow-list, suppressions, the deceased rule and the member's own "Pathshala
-- updates" switch apply when it is sent, exactly as for the other member notices (0596, 0598). A person with no login
-- or no working phone is simply not pushed (they read it in the app when they open it; nothing is logged for them, so
-- publishing again after they install the app still reaches them). A refusal that is not that (quiet hours, sandbox, a
-- template that cannot be written) is logged once per person and audited once per batch.
--
-- The push says the audience (the class's name, or "Pathshala"), the title and the first 120 characters of the message.
-- The announcement is for the class's families, so the words may be on a lock screen; there is nothing private in it
-- (unlike a note about a child). A tap opens the app's announcements screen (type pathshala, deep link
-- /pathshala-announcements).
--
-- What does NOT change: who may publish (actions.ts and the policies are untouched); who may read (0010); nothing about
-- money, permissions or deletion.
set client_min_messages = warning;

-- ── The template (platform default; a community may override it in Communications) ──────────────────────
-- Variables: audience (the class's name, or "Pathshala" for the whole term), title, snippet (the start of the message).
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('pathshala_announcement', 'push', '{{audience}}: {{title}}', '{{snippet}}')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- ── Who is told ─────────────────────────────────────────────────────────────────────────────────────────
-- The adults of the households that have a learner placed or active in the announcement's class (or, with no class, its
-- term), one row per person, in a fixed order (the worker pages through them with offset and limit).
create or replace function app._pathshala_announcement_recipients(p_announcement uuid) returns setof uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select distinct h.person_id
    from app.class_announcements a
    join app.pathshala_enrollments e
      on e.center_id = a.center_id and e.status in ('placed', 'active')
     and ((a.class_id is not null and e.class_id = a.class_id)
          or (a.class_id is null and a.term_id is not null and e.term_id = a.term_id))
   cross join lateral app._notice_household_adults(e.household_id) as h(person_id)
   where a.id = p_announcement
   order by h.person_id
$$;

-- ── The worker's side (job pathshala.announcement_notify) ───────────────────────────────────────────────
-- Pushes one batch (offset, limit) of the announcement's recipients. A person already handled for this announcement (a
-- retried job, a second publish) is skipped. Does nothing for an announcement that is gone or no longer published.
-- Returns {total, offset, limit, people, pushed, skipped, unreachable, refused, done}. Never raises at the publisher: a
-- person's refusal is counted. Only the worker role may call it.
create or replace function app.worker_pathshala_announcement_notify(p_announcement uuid, p_offset int default 0, p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.class_announcements; v_total int; v_off int; v_lim int; r record; v_res jsonb; v_audience text; v_snippet text; v_vars jsonb; v_route jsonb;
        v_people int := 0; v_pushed int := 0; v_skipped int := 0; v_unreachable int := 0; v_refused int := 0; v_counts jsonb := '{}'::jsonb; v_err text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into a from app.class_announcements where id = p_announcement;
  if a.id is null or a.published_at is null or not app.module_enabled(a.center_id, 'pathshala') then
    return jsonb_build_object('total', 0, 'offset', 0, 'limit', 0, 'people', 0, 'pushed', 0, 'skipped', 0, 'unreachable', 0, 'refused', 0, 'done', true,
             'reason', case when a.id is null then 'The announcement no longer exists.'
                            when a.published_at is null then 'The announcement is no longer published.'
                            else 'Pathshala is switched off for this community.' end);
  end if;
  v_off := greatest(coalesce(p_offset, 0), 0);
  v_lim := least(greatest(coalesce(p_limit, 50), 1), 200);
  perform app.set_audit_context('Class announcement published: the families are told');
  select count(*) into v_total from app._pathshala_announcement_recipients(a.id);
  select case when a.class_id is null then 'Pathshala' else coalesce((select c.name from app.pathshala_classes c where c.id = a.class_id), 'Pathshala') end
    into v_audience;
  v_snippet := left(btrim(regexp_replace(a.body_md, '\s+', ' ', 'g')), 120)
               || case when char_length(btrim(regexp_replace(a.body_md, '\s+', ' ', 'g'))) > 120 then '…' else '' end;
  v_vars := jsonb_build_object('audience', v_audience, 'title', a.title, 'snippet', v_snippet);
  v_route := jsonb_build_object('type', 'pathshala', 'deep_link', '/pathshala-announcements', 'announcement_id', a.id::text);
  for r in select x as person_id from app._pathshala_announcement_recipients(a.id) x offset v_off limit v_lim loop
    v_people := v_people + 1;
    if exists (select 1 from app.notice_log l
                where l.kind = 'pathshala_announcement' and l.ref_id = a.id and l.period = '' and l.person_id = r.person_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_res := app._member_push(a.center_id, r.person_id, null, 'pathshala', 'pathshala_announcement', v_vars, v_route, now(), null);
    if coalesce(v_res->>'reason', '') in ('no_person', 'no_login', 'no_phone', 'switched_off') then
      v_unreachable := v_unreachable + 1;
      continue;
    end if;
    insert into app.notice_log (kind, ref_id, period, person_id, center_id, outcome, reason)
    values ('pathshala_announcement', a.id, '', r.person_id, a.center_id,
            case when v_res ? 'id' then 'pushed' else 'refused' end, v_res->>'reason')
    on conflict do nothing;
    if v_res ? 'id' then
      v_pushed := v_pushed + 1;
    else
      v_refused := v_refused + 1;
      v_counts := app._add_counts(v_counts, jsonb_build_object(coalesce(v_res->>'reason', 'error'), 1));
      v_err := coalesce(v_err, v_res->>'error');
    end if;
  end loop;
  perform app._member_notice_not_sent(a.center_id, 'class_announcements', a.id::text, 'pathshala_announcement', v_counts, v_err);
  return jsonb_build_object('total', v_total, 'offset', v_off, 'limit', v_lim, 'people', v_people, 'pushed', v_pushed, 'skipped', v_skipped,
                            'unreachable', v_unreachable, 'refused', v_refused, 'done', v_off + v_lim >= v_total);
end $$;

-- ── The moment it becomes published ─────────────────────────────────────────────────────────────────────
-- Queues the background job. It never blocks the publish: if the job cannot be queued the announcement is still
-- published (families see it in the app) and the failure is audited.
create or replace function app.class_announcement_published() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.published_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.published_at is not null then return new; end if;
  if not app.module_enabled(new.center_id, 'pathshala') then return new; end if;
  begin
    perform app.enqueue_job(new.center_id, 'pathshala.announcement_notify', jsonb_build_object('announcement_id', new.id), now(), 5);
  exception when others then
    perform app.log_audit(new.center_id, 'class_announcements.notify_not_queued', 'class_announcements', new.id::text, null,
                          jsonb_build_object('error', left(sqlerrm, 500)), 'Announcement published, but the families could not be told: ' || left(sqlerrm, 200));
  end;
  return new;
end $$;
drop trigger if exists class_announcements_published on app.class_announcements;
create trigger class_announcements_published after insert or update of published_at on app.class_announcements
  for each row execute function app.class_announcement_published();

comment on function app._pathshala_announcement_recipients(uuid) is
  'The adults of the households with a learner placed or active in the announcement''s class (or, with no class, its term), one row per person in a fixed order (0781).';
comment on function app.worker_pathshala_announcement_notify(uuid, int, int) is
  'The worker role only (job pathshala.announcement_notify): pushes one batch (offset, limit) of the announcement''s recipients with the pathshala_announcement template, each person once per announcement (app.notice_log). Returns {total, offset, limit, people, pushed, skipped, unreachable, refused, done}. 0781.';
comment on function app.class_announcement_published() is
  'Trigger: when a class announcement becomes published (an insert already published, or published_at going from empty to a time) queue one pathshala.announcement_notify job. Never blocks the publish (0781).';
comment on table app.notice_log is
  'Each notice a sweep or trigger handled, once per thing and person (0598, 0781): rsvp_confirmation, boli_closing, special_day_labh, store_order_ready, pathshala_announcement. outcome pushed | refused (reason: quiet_hours, sandbox, template, suppressed, expired, error).';

revoke execute on function app._pathshala_announcement_recipients(uuid) from public, anon, authenticated, service_role;
revoke execute on function app.class_announcement_published() from public, anon, authenticated, service_role;
revoke execute on function app.worker_pathshala_announcement_notify(uuid, int, int) from public, anon, authenticated, service_role;
grant execute on function app.worker_pathshala_announcement_notify(uuid, int, int) to connect_worker;
