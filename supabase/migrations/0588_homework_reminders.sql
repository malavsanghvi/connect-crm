-- 0588_homework_reminders.sql: a reminder before homework is due, to the learners who have not handed it in.
--
-- Owner request 2026-10-06: "Set up a reminder to the user if the homework has not been completed. Send it prior, with
-- the number of hours the teacher has set up." (docs/LEARNING_ASSIGNMENTS_PLAN.md H5, §2.6 and §7; BACKLOG B46.)
--
--   app.gyan_assignments.remind_hours_before  whoever sets the homework chooses it: 1-720 hours before it is due, or null
--                                             (no reminder: the default). Only for homework with a due date
--   app.gyan_assignments.remind_set_at        when that number last changed (the guard sets it)
--   app.gyan_homework_reminders               one row per homework, learner and due date that was reminded: the sweep's
--                                             once-only key (once something of it went out, changing the hours never
--                                             reminds anyone again for that due date; moving the due date can). Read by
--                                             the learner's family and by the people who may change the homework;
--                                             written only by the sweep (and a row of which nothing went out is deleted
--                                             when its reminder is cancelled, so the learner can be reminded again)
--   app.worker_homework_reminders_sweep       every 15 minutes (worker job homework.reminders_sweep, the worker role
--                                             only, in batches of 100): tells each learner whose reminder time has come,
--                                             and the household adults of a child, with template homework.due_soon
--   app._gyan_homework_cancel_due_soon        cancels the homework.due_soon messages of a homework (or of one learner)
--                                             that are still queued; called by a hand-in, by archiving or unpublishing,
--                                             by a change of the due date, the hours or the class, and by the sweep for a
--                                             community that switched reminders or Gyan Path off
--   app.hand_in_gyan_submission, app.set_gyan_assignment_status, app.gyan_assignments_guard, app.save_gyan_assignment,
--   app.gyan_assignment_json, app.my_gyan_homework
--                                             0587's bodies with the reminder (additive JSON keys remind_hours_before and
--                                             remind_set_at)
--
-- When. The due moment is the END of the due day in the community's time zone (homework due on October 16 is due until
-- midnight that night, centers.time_zone). The reminder is due remind_hours_before hours earlier, and is sent from then
-- until the due moment, once per learner and due date, only while the homework is published, the Gyan Path module is
-- on and the community has not switched the reminder off (Settings › Notifications:
-- rules.notifications.triggers.homework_reminder = false; the first notification switch the database itself reads).
-- Hours set or raised after the homework was first published, or a reminder added then, send at the next run if the
-- reminder time has already passed (owner decision 2026-10-07); only a reminder whose time came before the FIRST publish
-- while the hours were also set before it is skipped (the publish notice told them). Quiet hours
-- (rules.notifications.quiet_start_hour / quiet_end_hour): while they last, the whole reminder (push and email) waits for
-- the first run after they end, unless they end only after the due moment; then the email goes at once and the push,
-- which app.enqueue_message would hold until quiet hours end, is not sent (owner decision 2026-10-07). A community whose
-- time zone is not a known zone name (pg_timezone_names) gets no reminder; the sweep says so in the audit log each run.
--
-- Who. The learners the publish notice tells (as app._gyan_homework_publish_recipients counts them: the students placed or
-- active in the homework's class while its term is open, or, for homework for everyone, the members who have completed a
-- step of its level; never a person recorded as deceased) who have not handed it in: no answer, a draft, or an answer
-- sent back (by a parent or the teacher) is reminded; an answer waiting for a parent, with the teacher or accepted is
-- not. The learner's logins (push) and email, and, for a learner under 18, every adult of each household the learner is
-- in (push and email), through 0587's family notifier; it never raises (a refusal is audited as
-- gyan_homework.notice_failed). No note travels in it: the template has the homework's title, level, the learner's first
-- name and the due date (absolute, "Friday, October 16"), nothing else.
--
-- ACCESS CHANGES (for the pull request): (1) the new table app.gyan_homework_reminders is readable by the learner and the
-- adults of their household (app.gyan_can_act_for) and by the people who may change the homework
-- (app.gyan_homework_editor); nobody writes it over the API; (2) the new function app.worker_homework_reminders_sweep is
-- the worker role's alone. No existing rule changes.
set client_min_messages = warning;

-- ── Locks first ──────────────────────────────────────────────────────────────
-- A deploy applies this file as ONE transaction and it alters app.gyan_assignments, which the member app reads all the
-- time. Take the lock before anything else and wait at most 10 seconds, so a busy moment fails the deploy cleanly (run it
-- again) instead of queueing members behind it. Inside a DO block because LOCK TABLE needs a transaction (run_local.sh
-- applies statement by statement).
do $$
begin
  set local lock_timeout = '10s';
  lock table app.gyan_assignments in access exclusive mode;
end $$;

-- ── The reminder on the homework ─────────────────────────────────────────────
alter table app.gyan_assignments add column if not exists remind_hours_before integer;
alter table app.gyan_assignments add column if not exists remind_set_at timestamptz;
alter table app.gyan_assignments drop constraint if exists gyan_assignments_remind_hours_before_check;
alter table app.gyan_assignments add constraint gyan_assignments_remind_hours_before_check
  check (remind_hours_before is null or remind_hours_before between 1 and 720);
alter table app.gyan_assignments drop constraint if exists gyan_assignments_remind_needs_due_check;
alter table app.gyan_assignments add constraint gyan_assignments_remind_needs_due_check
  check (remind_hours_before is null or due_rule->>'kind' in ('on', 'days_after_start'));
comment on column app.gyan_assignments.remind_hours_before is
  '0588: remind this many hours (1-720) before the homework is due (the end of the due day in the community''s time zone) the learners it applies to who have not handed it in (no answer, a draft or an answer sent back), and the household adults of a child (template homework.due_soon, push + email, app.worker_homework_reminders_sweep). Null = no reminder (the default). Only for homework with a due date. Set by whoever sets the homework (app.save_gyan_assignment).';
comment on column app.gyan_assignments.remind_set_at is
  '0588: when remind_hours_before last changed (set by app.gyan_assignments_guard). A reminder whose time came before the homework was first published is sent only when the hours were set (or raised) after that publish; then it goes at the next run (owner decision 2026-10-07). Once something of a reminder went out, changing the hours never reminds anyone again for the same due date (app.gyan_homework_reminders).';

-- 0587's guard, with the reminder: the hours are a whole number from 1 to 720 and need a due date, and remind_set_at
-- follows every change of the hours (any other write leaves it as it is).
create or replace function app.gyan_assignments_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_goal_center uuid; v_problem text;
begin
  new.title := btrim(coalesce(new.title, ''));
  new.instructions_md := nullif(btrim(coalesce(new.instructions_md, '')), '');
  new.allowed_kinds := (select coalesce(array_agg(distinct k order by k), '{}') from unnest(new.allowed_kinds) k where k is not null);
  if new.class_id is not null and not exists (select 1 from app.pathshala_classes c where c.id = new.class_id and c.center_id = new.center_id) then
    raise exception 'That Pathshala class is not one of this community''s classes.' using errcode = '22023';
  end if;
  if new.class_id is not null and new.reviewer = 'content' then
    raise exception 'Homework for a class is always reviewed by the class teacher.' using errcode = '22023';
  end if;
  select g.center_id into v_goal_center from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where l.id = new.level_id;
  if not found then raise exception 'That lesson level was not found.' using errcode = 'P0002'; end if;
  if v_goal_center is not null and v_goal_center <> new.center_id then
    raise exception 'That lesson belongs to another community.' using errcode = 'insufficient_privilege';
  end if;
  v_problem := app.gyan_due_rule_problem(new.due_rule);
  if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
  new.due_rule := case new.due_rule->>'kind'
    when 'days_after_start' then jsonb_build_object('kind', 'days_after_start', 'days', ((new.due_rule->>'days')::numeric)::int)
    when 'on' then jsonb_build_object('kind', 'on', 'date', to_char((new.due_rule->>'date')::date, 'YYYY-MM-DD'))
    else '{"kind":"none"}'::jsonb end;
  -- 0588: the reminder.
  if new.remind_hours_before is not null and new.remind_hours_before not between 1 and 720 then
    raise exception 'The reminder must be a whole number of hours from 1 to 720 (30 days) before the homework is due, or empty for no reminder.' using errcode = '22023';
  end if;
  if new.remind_hours_before is not null and new.due_rule->>'kind' = 'none' then
    raise exception 'A reminder needs a due date: choose when the homework is due, or leave the reminder empty.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.remind_set_at := case when new.remind_hours_before is not null then now() end;
  elsif new.remind_hours_before is distinct from old.remind_hours_before then
    new.remind_set_at := now();
  end if;
  return new;
end $$;

-- ── The JSON the apps get (0587's bodies, two keys more) ─────────────────────
create or replace function app.gyan_assignment_json(p_assignment uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
           'id', a.id, 'center_id', a.center_id, 'level_id', a.level_id, 'class_id', a.class_id, 'title', a.title,
           'instructions_md', a.instructions_md, 'allowed_kinds', to_jsonb(a.allowed_kinds), 'max_files', a.max_files,
           'required_for_level', a.required_for_level, 'points', a.points, 'due_rule', a.due_rule,
           'parent_check', a.parent_check, 'reviewer', a.reviewer, 'status', a.status, 'sort_order', a.sort_order,
           'created_at', a.created_at, 'updated_at', a.updated_at,
           'remind_hours_before', a.remind_hours_before, 'remind_set_at', a.remind_set_at)
    from app.gyan_assignments a where a.id = p_assignment
$$;

-- Insert (no "id") or update. Validates every field in plain English (a value of the wrong JSON type is refused with
-- a sentence, never coerced and never a raw database error); the status is set with app.set_gyan_assignment_status (a
-- new row starts as a draft). 0587's body; 0588 adds "remind_hours_before" (a whole number of hours from 1 to 720, or
-- null for no reminder; left out = unchanged, or no reminder for new homework), allowed only with a due date.
create or replace function app.save_gyan_assignment(p_center uuid, p_assignment jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  a app.gyan_assignments; v_id uuid; v_level uuid; v_class uuid; v_title text; v_instr text; v_kinds text[];
  v_max int; v_required boolean; v_points int; v_due jsonb; v_parent text; v_reviewer text; v_sort int; v_problem text;
  v_level_name text; v_goal_center uuid; j jsonb := coalesce(p_assignment, '{}'::jsonb); k text; v_has_answers boolean;
  v_remind int;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.' using errcode = 'P0002';
  end if;
  perform app.assert_module_enabled(p_center, 'gyan_path');
  if jsonb_typeof(j) <> 'object' then raise exception 'The homework must be a JSON object.' using errcode = '22023'; end if;

  -- The row being changed, if any.
  if coalesce(jsonb_typeof(j->'id'), 'null') <> 'null' then
    if jsonb_typeof(j->'id') <> 'string' or (j->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'The homework''s "id" must be a UUID.' using errcode = '22023';
    end if;
    v_id := (j->>'id')::uuid;
    select * into a from app.gyan_assignments where id = v_id for update;
    if a.id is null or a.center_id <> p_center then
      raise exception 'That homework was not found. It may have been removed; reload the page.' using errcode = 'P0002';
    end if;
    if app.gyan_homework_editor(p_center, a.class_id) is not true then
      raise exception 'Changing this homework needs content.manage or pathshala.manage, or the Teacher role for its class.' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Level.
  if jsonb_typeof(j->'level_id') = 'string' and (j->>'level_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_level := (j->>'level_id')::uuid;
  elsif a.id is not null and coalesce(jsonb_typeof(j->'level_id'), 'null') = 'null' then
    v_level := a.level_id;
  else
    raise exception 'Choose the lesson level the homework belongs to.' using errcode = '22023';
  end if;
  select l.name, g.center_id into v_level_name, v_goal_center from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where l.id = v_level;
  if not found then raise exception 'That lesson level was not found. It may have been removed; reload the page.' using errcode = 'P0002'; end if;
  if v_goal_center is not null and v_goal_center <> p_center then
    raise exception 'That lesson belongs to another community.' using errcode = 'insufficient_privilege';
  end if;

  -- Class (null = everyone doing the level).
  if coalesce(jsonb_typeof(j->'class_id'), 'null') = 'null' then
    v_class := case when a.id is not null and not (j ? 'class_id') then a.class_id end;
  elsif jsonb_typeof(j->'class_id') = 'string' and (j->>'class_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_class := (j->>'class_id')::uuid;
    if not exists (select 1 from app.pathshala_classes c where c.id = v_class and c.center_id = p_center) then
      raise exception 'That Pathshala class is not one of this community''s classes.' using errcode = '22023';
    end if;
  else
    raise exception 'The class must be one of this community''s Pathshala classes, or left empty for everyone.' using errcode = '22023';
  end if;

  -- Who may: content.manage or pathshala.manage; a class Teacher only for their own class (H2).
  if app.gyan_homework_editor(p_center, v_class) is not true then
    if v_class is null and app.has_role(p_center, 'teacher') then
      raise exception 'Teachers can set homework for their own class only: choose the class.' using errcode = 'insufficient_privilege';
    end if;
    raise exception 'Setting homework needs content.manage or pathshala.manage, or the Teacher role for the class it is for.' using errcode = 'insufficient_privilege';
  end if;

  -- Title and instructions.
  if coalesce(jsonb_typeof(j->'title'), 'null') not in ('string', 'null') then
    raise exception 'The title must be text.' using errcode = '22023';
  end if;
  v_title := btrim(coalesce(j->>'title', a.title, ''));
  if v_title = '' then raise exception 'Give the homework a title.' using errcode = '22023'; end if;
  if char_length(v_title) > 120 then raise exception 'The title can be at most 120 characters.' using errcode = '22023'; end if;
  if coalesce(jsonb_typeof(j->'instructions_md'), 'null') not in ('string', 'null') then
    raise exception 'The instructions must be text.' using errcode = '22023';
  end if;
  v_instr := case when j ? 'instructions_md' then nullif(btrim(coalesce(j->>'instructions_md', '')), '') else a.instructions_md end;
  if char_length(v_instr) > 4000 then raise exception 'The instructions can be at most 4,000 characters.' using errcode = '22023'; end if;

  -- How the learner may answer.
  if j ? 'allowed_kinds' then
    if coalesce(jsonb_typeof(j->'allowed_kinds'), 'null') <> 'array' then
      raise exception 'Choose at least one way to answer: photo, file, voice or text.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(j->'allowed_kinds') e where jsonb_typeof(e) <> 'string') then
      raise exception 'Each way to answer must be one of the words photo, file, voice or text.' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct x order by x), '{}') into v_kinds from jsonb_array_elements_text(j->'allowed_kinds') x;
    if cardinality(v_kinds) = 0 then raise exception 'Choose at least one way to answer: photo, file, voice or text.' using errcode = '22023'; end if;
    foreach k in array v_kinds loop
      if k not in ('photo', 'file', 'voice', 'text') then
        raise exception '"%" is not a way to answer homework (photo, file, voice or text).', k using errcode = '22023';
      end if;
    end loop;
  else
    v_kinds := coalesce(a.allowed_kinds, '{photo,voice,text}');
  end if;
  if j ? 'max_files' then
    if jsonb_typeof(j->'max_files') <> 'number' or (j->>'max_files')::numeric <> floor((j->>'max_files')::numeric)
       or (j->>'max_files')::numeric not between 1 and 10 then
      raise exception 'The number of files allowed must be a whole number from 1 to 10.' using errcode = '22023';
    end if;
    v_max := ((j->>'max_files')::numeric)::int;
  else
    v_max := coalesce(a.max_files, 3);
  end if;
  if j ? 'required_for_level' then
    if jsonb_typeof(j->'required_for_level') <> 'boolean' then raise exception '"required_for_level" must be true or false.' using errcode = '22023'; end if;
    v_required := (j->>'required_for_level')::boolean;
  else
    v_required := coalesce(a.required_for_level, false);
  end if;
  if j ? 'points' then
    if jsonb_typeof(j->'points') <> 'number' or (j->>'points')::numeric <> floor((j->>'points')::numeric)
       or (j->>'points')::numeric not between 0 and 1000 then
      raise exception 'Points must be a whole number from 0 to 1,000.' using errcode = '22023';
    end if;
    v_points := ((j->>'points')::numeric)::int;
  else
    v_points := coalesce(a.points, 10);
  end if;
  -- A class Teacher gives up to 100 points for a piece of homework; more is for the office (a teacher accepts the
  -- homework and so mints the points, so the size of the prize is not theirs to set without limit).
  if v_points > 100 and (a.id is null or v_points is distinct from a.points)
     and not (app.has_permission(p_center, 'content.manage') or app.has_permission(p_center, 'pathshala.manage')) then
    raise exception 'A class Teacher can give up to 100 points for a piece of homework; more needs content.manage or pathshala.manage.' using errcode = 'insufficient_privilege';
  end if;
  v_due := case when j ? 'due_rule' then j->'due_rule' else coalesce(a.due_rule, '{"kind":"none"}'::jsonb) end;
  v_problem := app.gyan_due_rule_problem(v_due);
  if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
  -- 0588: the reminder, hours before the end of the due day; null = no reminder. Left out: unchanged (none for new homework).
  if j ? 'remind_hours_before' then
    if jsonb_typeof(j->'remind_hours_before') = 'null' then
      v_remind := null;
    elsif jsonb_typeof(j->'remind_hours_before') <> 'number'
          or (j->>'remind_hours_before')::numeric <> floor((j->>'remind_hours_before')::numeric)
          or (j->>'remind_hours_before')::numeric not between 1 and 720 then
      raise exception 'The reminder must be a whole number of hours from 1 to 720 (30 days) before the homework is due, or empty for no reminder.' using errcode = '22023';
    else
      v_remind := ((j->>'remind_hours_before')::numeric)::int;
    end if;
  else
    v_remind := a.remind_hours_before;
  end if;
  if v_remind is not null and v_due->>'kind' = 'none' then
    raise exception 'A reminder needs a due date: choose when the homework is due, or leave the reminder empty.' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(j->'parent_check'), 'null') not in ('string', 'null') then
    raise exception 'The parent check must be "never", "children" or "always".' using errcode = '22023';
  end if;
  v_parent := coalesce(j->>'parent_check', a.parent_check, 'children');
  if v_parent not in ('never', 'children', 'always') then
    raise exception 'The parent check must be "never", "children" or "always".' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(j->'reviewer'), 'null') not in ('string', 'null') then
    raise exception 'The reviewer must be "teacher" or "content".' using errcode = '22023';
  end if;
  v_reviewer := coalesce(j->>'reviewer', a.reviewer, 'teacher');
  if v_reviewer not in ('teacher', 'content') then
    raise exception 'The reviewer must be "teacher" or "content".' using errcode = '22023';
  end if;
  if v_reviewer = 'content' and v_class is not null then
    raise exception 'Homework for a class is always reviewed by the class teacher.' using errcode = '22023';
  end if;
  if j ? 'sort_order' then
    if jsonb_typeof(j->'sort_order') <> 'number' then raise exception '"sort_order" must be a number.' using errcode = '22023'; end if;
    v_sort := least(greatest(floor((j->>'sort_order')::numeric), -1000000), 1000000)::int;
  else
    v_sort := coalesce(a.sort_order, 0);
  end if;
  if a.id is null and coalesce(j->>'status', 'draft') <> 'draft' then
    raise exception 'New homework starts as a draft; save it, then publish it.' using errcode = '22023';
  end if;

  if a.id is not null then
    -- Once there are answers, the homework stays on its lesson and with its class, and who reviews it and its parent
    -- check are fixed: changing them would change who reads and decides on answers already given.
    v_has_answers := exists (select 1 from app.gyan_submissions s where s.assignment_id = a.id);
    if v_has_answers and (v_level <> a.level_id or v_class is distinct from a.class_id) then
      raise exception 'This homework already has answers, so its lesson level and class cannot change. Archive it and make a new one.' using errcode = '22023';
    end if;
    if v_has_answers and (v_reviewer is distinct from a.reviewer or v_parent is distinct from a.parent_check) then
      raise exception 'This homework already has answers, so who reviews it and its parent check cannot change. Archive it and make a new one.' using errcode = '22023';
    end if;
    -- A class Teacher may not move it to a class that is not theirs, nor open it to everyone.
    if v_class is distinct from a.class_id and app.gyan_homework_editor(p_center, v_class) is not true then
      raise exception 'Teachers can set homework for their own class only.' using errcode = 'insufficient_privilege';
    end if;
    perform app.set_audit_context('Changed homework "' || v_title || '" (' || v_level_name || ')');
    begin
      update app.gyan_assignments
         set level_id = v_level, class_id = v_class, title = v_title, instructions_md = v_instr, allowed_kinds = v_kinds,
             max_files = v_max, required_for_level = v_required, points = v_points, due_rule = v_due,
             parent_check = v_parent, reviewer = v_reviewer, sort_order = v_sort, remind_hours_before = v_remind
       where id = a.id;
    exception when unique_violation then
      raise exception 'There is already homework called "%" on this lesson level.', v_title using errcode = '23505';
    end;
    -- Published homework that was holding its level's bonus and no longer does: pay what it was holding.
    if a.status = 'published' and a.required_for_level and (not v_required or v_level <> a.level_id) then
      perform app._gyan_homework_release_level_bonus(p_center, a.level_id);
    end if;
    -- 0588: a reminder still waiting to go out was made for the old due date, hours or class (the row as stored, after
    -- the guard): it is cancelled, and one of which nothing went out is forgotten, so the next run reminds by the new rule.
    if exists (select 1 from app.gyan_assignments ga
                where ga.id = a.id and (ga.due_rule is distinct from a.due_rule or ga.remind_hours_before is distinct from a.remind_hours_before
                                        or ga.class_id is distinct from a.class_id)) then
      perform app._gyan_homework_cancel_due_soon(p_center, a.id, null,
        'Not sent: the homework''s due date, reminder or class changed before the reminder went out.');
    end if;
    return app.gyan_assignment_json(a.id);
  end if;

  perform app.set_audit_context('Created homework "' || v_title || '" (' || v_level_name || ')');
  begin
    insert into app.gyan_assignments (center_id, level_id, class_id, title, instructions_md, allowed_kinds, max_files, required_for_level,
                                      points, due_rule, parent_check, reviewer, status, sort_order, created_by, remind_hours_before)
    values (p_center, v_level, v_class, v_title, v_instr, v_kinds, v_max, v_required, v_points, v_due, v_parent, v_reviewer, 'draft', v_sort, auth.uid(), v_remind)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'There is already homework called "%" on this lesson level.', v_title using errcode = '23505';
  end;
  return app.gyan_assignment_json(v_id);
end $$;

-- The caller's own homework and, when the caller is an adult, every current member of their households'; the published
-- homework that applies to each person, and archived homework the person has an answer to (read-only: assignment.archived,
-- so a sent-back note does not vanish with the archive; needs_parent and can_parent_decide are false for archived homework).
-- 0587's body; the assignment also carries remind_hours_before and remind_set_at (0588).
create or replace function app.my_gyan_homework(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_me uuid; v_people uuid[]; v_adult boolean;
begin
  if auth.uid() is null then raise exception 'Sign in to see your homework.' using errcode = 'insufficient_privilege'; end if;
  perform app.assert_module_enabled(p_center, 'gyan_path');
  v_me := app.my_person_id(p_center);
  if v_me is null then raise exception 'Only members of this community can see its homework.' using errcode = 'insufficient_privilege'; end if;
  v_adult := app.gyan_i_am_adult(p_center);
  select array[v_me] || coalesce(array_agg(x.person_id order by x.date_of_birth desc nulls last, x.first_name), '{}') into v_people
    from (select distinct p.id as person_id, p.date_of_birth, p.first_name
            from app.household_members hm join app.people p on p.id = hm.person_id
           where v_adult and hm.center_id = p_center and hm.left_at is null and hm.person_id <> v_me
             and hm.household_id in (select app.my_household_ids(p_center)) and not coalesce(p.is_deceased, false)) x;
  return jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('person_id', p.id,
                                          'name', coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name,
                                          'is_child', app.person_is_minor(p.id)) order by o.ord)
        from unnest(v_people) with ordinality o(id, ord) join app.people p on p.id = o.id), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'assignment', jsonb_build_object(
                 'id', a.id, 'level_id', a.level_id, 'goal_id', l.goal_id, 'title', a.title, 'instructions_md', a.instructions_md,
                 'allowed_kinds', to_jsonb(a.allowed_kinds), 'max_files', a.max_files, 'points', a.points,
                 'required_for_level', a.required_for_level, 'due_on', app.gyan_assignment_due_on(a.id, o.id),
                 'parent_check', a.parent_check, 'class_id', a.class_id, 'archived', a.status = 'archived',
                 'remind_hours_before', a.remind_hours_before, 'remind_set_at', a.remind_set_at),
               'person_id', o.id,
               'submission', case when s.id is null then null else app.gyan_submission_json(s.id) end,
               'needs_parent', a.status = 'published' and app._gyan_homework_parent_check(p_center, a.id, o.id) = 'waits',
               'can_parent_decide', s.id is not null and s.status = 'awaiting_parent' and a.status = 'published' and v_adult and o.id <> v_me)
             order by o.ord, l.sort_order, a.sort_order, a.title)
        from unnest(v_people) with ordinality o(id, ord)
        join app.gyan_assignments a on a.center_id = p_center
         and (case when a.status = 'published' then app.gyan_assignment_applies(a.id, o.id)
                   when a.status = 'archived' then exists (select 1 from app.gyan_submissions s0 where s0.assignment_id = a.id and s0.person_id = o.id)
                   else false end)
        join app.gyan_levels l on l.id = a.level_id
        left join app.gyan_submissions s on s.assignment_id = a.id and s.person_id = o.id), '[]'::jsonb));
end $$;

-- ── Who was reminded ─────────────────────────────────────────────────────────
create table if not exists app.gyan_homework_reminders (
  assignment_id uuid not null references app.gyan_assignments(id) on delete cascade,
  person_id     uuid not null references app.people(id) on delete cascade,
  center_id     uuid not null references app.centers(id) on delete cascade,
  due_on        date not null,
  remind_hours  integer not null check (remind_hours between 1 and 720),
  remind_at     timestamptz not null,
  sent_at       timestamptz not null default now(),
  messages      integer not null default 0 check (messages >= 0),
  primary key (assignment_id, person_id, due_on)
);
create index if not exists gyan_homework_reminders_person_idx on app.gyan_homework_reminders (person_id);
create index if not exists gyan_homework_reminders_center_idx on app.gyan_homework_reminders (center_id, sent_at);
comment on table app.gyan_homework_reminders is
  'One row per homework, learner and due date that app.worker_homework_reminders_sweep reminded (0588): the once-only key, so once something of a reminder went out, changing the hours never reminds anyone again for that due date (moving the due date can). remind_hours and remind_at are what the reminder was sent for; sent_at is when it was queued (its messages have that created_at); messages is how many messages were queued to go out (pushes and emails, the household adults of a child included; not those suppressed, nor pushes dropped because quiet hours last past the due moment; 0 = nobody could be reached). When a reminder is cancelled before anything of it went out (a hand-in, the homework archived, unpublished or changed, reminders switched off), its row is deleted (app._gyan_homework_cancel_due_soon), so the learner can be reminded again. Read by the learner and the adults of their household and by the people who may change the homework; written only by the sweep.';

insert into app.module_tables (table_name, module_key) values ('gyan_homework_reminders', 'gyan_path')
on conflict (table_name) do update set module_key = excluded.module_key;

-- No id column: the entry is keyed by the primary key, "<assignment>:<person>:<due date>" (0102's convention).
drop trigger if exists audit_gyan_homework_reminders on app.gyan_homework_reminders;
create trigger audit_gyan_homework_reminders after insert or update or delete on app.gyan_homework_reminders
  for each row execute function app.audit_row('assignment_id', 'person_id', 'due_on');

alter table app.gyan_homework_reminders enable row level security;
-- The learner and the adults of their household (as for the answers), and the people who may change the homework
-- (app.gyan_homework_editor: content.manage, pathshala.manage, the class's Teacher for homework for a class).
drop policy if exists gyan_homework_reminders_read on app.gyan_homework_reminders;
create policy gyan_homework_reminders_read on app.gyan_homework_reminders for select to authenticated
  using (app.gyan_can_act_for(center_id, person_id)
         or exists (select 1 from app.gyan_assignments a where a.id = assignment_id and app.gyan_homework_editor(a.center_id, a.class_id)));
drop policy if exists module_switch on app.gyan_homework_reminders;
create policy module_switch on app.gyan_homework_reminders as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('gyan_path'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('gyan_path'))::uuid[])));
-- No write policy and no write grant: the sweep is the only way in.
revoke all on app.gyan_homework_reminders from public, anon, authenticated, connect_worker;
grant select on app.gyan_homework_reminders to authenticated;
grant all on app.gyan_homework_reminders to service_role;

-- ── Cancelling a reminder that has not gone out ──────────────────────────────
-- The homework.due_soon messages of one homework (and of one learner, or of all its learners) that are still queued:
-- held by quiet hours, or not sent yet. They are cancelled with the reason given (the messaging job skips a message that
-- is no longer queued: app.worker_message_to_send). A reminder of which nothing went out (every message cancelled or
-- suppressed, at least one cancelled now) is forgotten too: its log row is deleted, so the learner is reminded again when
-- a reminder is due again (an answer sent back, new hours, a new due date or class, reminders switched on again). A
-- reminder of which something went out stays logged: nobody is reminded twice for the same due date. A reminder's
-- messages are the ones the sweep queued with it (created at the log row's sent_at). Returns how many were cancelled.
create or replace function app._gyan_homework_cancel_due_soon(p_center uuid, p_assignment uuid, p_person uuid default null, p_reason text default null)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare n int;
begin
  if p_center is null or p_assignment is null then return 0; end if;
  update app.messages m
     set status = 'cancelled', failure_reason = coalesce(p_reason, 'Not sent: the homework changed before the reminder went out.')
   where m.center_id = p_center and m.status = 'queued' and m.template_key = 'homework.due_soon'
     and m.payload->>'assignment_id' = p_assignment::text
     and (p_person is null or m.payload->>'learner_id' = p_person::text);
  get diagnostics n = row_count;
  if n > 0 then
    delete from app.gyan_homework_reminders r
     where r.assignment_id = p_assignment and r.center_id = p_center and (p_person is null or r.person_id = p_person)
       and exists (select 1 from app.messages m
                    where m.center_id = r.center_id and m.template_key = 'homework.due_soon' and m.created_at = r.sent_at
                      and m.payload->>'assignment_id' = r.assignment_id::text and m.payload->>'learner_id' = r.person_id::text
                      and m.status = 'cancelled')
       and not exists (select 1 from app.messages m
                        where m.center_id = r.center_id and m.template_key = 'homework.due_soon' and m.created_at = r.sent_at
                          and m.payload->>'assignment_id' = r.assignment_id::text and m.payload->>'learner_id' = r.person_id::text
                          and m.status not in ('cancelled', 'suppressed'));
  end if;
  return n;
end $$;

-- ── The sweep (worker job homework.reminders_sweep, every 15 minutes) ────────
-- The learners whose reminder is due now: one row per published homework with a reminder, learner and due date, while
-- now is between the reminder time and the due moment (the end of the due day in the community's time zone), the
-- reminder time came after the homework was first published or the hours were set after that publish (owner decision
-- 2026-10-07), the learner has not handed it in (awaiting_parent, submitted or accepted), and nobody was reminded for
-- that due date yet. quiet_until: the end of the community's quiet hours when they are on now
-- (app.messaging_quiet_until). due_rule and class_id are the homework's, for the sweep's check of the newest row.
-- Set-based, as app._gyan_homework_publish_recipients and app.gyan_assignment_due_on count them (test 73 compares):
-- the learners are the students placed or active in the homework's class while its term is open, or, for homework for
-- everyone, the members of its community who have completed a step of its level, never a person recorded as deceased;
-- a "days after start" date counts from the later of the learner's first completed step of the level and the first
-- publish, and only learners due within the hours ahead (plus a day) are looked at further. A fixed date is the same for
-- everyone, so only homework whose window is open now has its learners listed. A community whose time zone is not a
-- known zone name is left out (the sweep audits it), so one wrong setting never stops everyone's reminders.
create or replace function app._gyan_homework_reminders_due()
returns table (assignment_id uuid, center_id uuid, person_id uuid, due_on date, due_at timestamptz, remind_hours int,
               remind_at timestamptz, quiet_until timestamptz, due_rule jsonb, class_id uuid)
language sql stable security definer set search_path = app, public, extensions as $$
  with zones as (
    select lower(z.name) as name from pg_timezone_names z
  ), hw as materialized (
    select ga.id, ga.center_id, ga.level_id, ga.class_id, ga.due_rule, ga.remind_hours_before as hours, ga.published_at,
           coalesce(ga.remind_set_at, ga.published_at) as set_at, c.time_zone as tz,
           (now() at time zone c.time_zone)::date as today, app.messaging_quiet_until(ga.center_id, now()) as quiet_until
      from app.gyan_assignments ga join app.centers c on c.id = ga.center_id
     where ga.status = 'published' and ga.remind_hours_before is not null and ga.published_at is not null
       and ga.due_rule->>'kind' in ('on', 'days_after_start')
       and app.module_enabled(ga.center_id, 'gyan_path')
       and coalesce(c.rules #>> '{notifications,triggers,homework_reminder}', 'true') <> 'false'
       and lower(c.time_zone) in (select zones.name from zones)
  ), open_hw as (
    select hw.* from hw
     where hw.due_rule->>'kind' = 'days_after_start'
        or (now() < (((hw.due_rule->>'date')::date + 1)::timestamp at time zone hw.tz)
            and (((hw.due_rule->>'date')::date + 1)::timestamp at time zone hw.tz) - make_interval(hours => hw.hours) <= now())
  ), firsts as (
    select gp.person_id, st.level_id, min(gp.completed_at) as first_done
      from app.gyan_progress gp join app.gyan_steps st on st.id = gp.step_id
     where gp.completed_at is not null and st.level_id in (select open_hw.level_id from open_hw)
     group by gp.person_id, st.level_id
  ), placed as (
    select distinct e.student_person_id as person_id, e.class_id
      from app.pathshala_enrollments e join app.pathshala_terms t on t.id = e.term_id
     where e.class_id in (select open_hw.class_id from open_hw where open_hw.class_id is not null)
       and e.status in ('placed', 'active') and t.status in ('registration', 'active')
  ), learners as (
    select h.*, f.person_id as learner_id, f.first_done
      from open_hw h join firsts f on f.level_id = h.level_id
     where h.class_id is null
    union all
    select h.*, pl.person_id, f.first_done
      from open_hw h join placed pl on pl.class_id = h.class_id
      left join firsts f on f.person_id = pl.person_id and f.level_id = h.level_id
     where h.class_id is not null
  ), dated as (
    select l.*, case when l.due_rule->>'kind' = 'on' then (l.due_rule->>'date')::date
                     else (greatest(l.first_done, l.published_at) at time zone l.tz)::date + (l.due_rule->>'days')::int end as learner_due_on
      from learners l
      join app.people p on p.id = l.learner_id and p.center_id = l.center_id and not coalesce(p.is_deceased, false)
  ), timed as (
    select d.*, ((d.learner_due_on + 1)::timestamp at time zone d.tz) as learner_due_at
      from dated d
     where d.learner_due_on between d.today - 1 and d.today + ceil(d.hours / 24.0)::int + 1
  )
  select t.id, t.center_id, t.learner_id, t.learner_due_on, t.learner_due_at, t.hours,
         t.learner_due_at - make_interval(hours => t.hours), t.quiet_until, t.due_rule, t.class_id
    from timed t
   where t.learner_due_at - make_interval(hours => t.hours) <= now() and now() < t.learner_due_at
     and (t.learner_due_at - make_interval(hours => t.hours) > t.published_at or t.set_at > t.published_at)
     and not exists (select 1 from app.gyan_submissions s
                      where s.assignment_id = t.id and s.person_id = t.learner_id and s.status in ('awaiting_parent', 'submitted', 'accepted'))
     and not exists (select 1 from app.gyan_homework_reminders r
                      where r.assignment_id = t.id and r.person_id = t.learner_id and r.due_on = t.learner_due_on)
$$;

-- One batch of the run: at most p_limit learners (100 by default, 1-500), the earliest reminder time first; the worker
-- calls again while a batch comes back full ("more"), with p_first_batch false after the first, so the housekeeping
-- below happens once a run. The due list is worked out once a call. A homework a teacher is saving right now is left
-- for the next batch or run (for no key update ... skip locked: never blocking a learner's first answer, whose foreign
-- key check takes a key-share lock on the homework), and the newest version of the homework row must still match the
-- list (status, hours, due rule, class). A learner who is handing in right now is left too (the advisory lock
-- app.hand_in_gyan_submission takes as well: the hand-in waits for this batch and then cancels what it queued). The log
-- row is written first (on conflict do nothing) and only a new row tells anyone, so no learner is reminded twice for one
-- due date. During quiet hours the whole reminder waits for the first run after they end, unless they end only after
-- the due moment: then it goes now, and its pushes, which app.enqueue_message holds until quiet hours end, are cancelled
-- (they would arrive after the homework was due; the email goes). The 0587 family notifier tells the learner (push to
-- every login, email) and, for a learner under 18, every adult of each household they are in; "due" is the due date in
-- words ("Friday, October 16"). It never raises: a refusal is audited (gyan_homework.notice_failed).
-- Housekeeping (first batch): the reminders still queued in a community that switched them (or Gyan Path) off are
-- cancelled, and each community whose time zone is not a known zone name is named in the audit log.
-- Returns {reminded, messages (queued to go out), suppressed, dropped_pushes, unreached (reminded, nothing queued),
-- held_for_quiet_hours, busy, cancelled, skipped_time_zone, limit, more}.
create or replace function app.worker_homework_reminders_sweep(p_limit int default 100, p_first_batch boolean default true) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  r record; v_limit int; v_due jsonb; v_n int; v_s int; v_d int; v_q int; v_seen int := 0; v_reminded int := 0; v_messages int := 0;
  v_suppressed int := 0; v_dropped int := 0; v_unreached int := 0; v_quiet int := 0; v_busy int := 0; v_cancelled int := 0;
  v_bad_zone int := 0;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Homework due soon: the learners who have not handed it in are reminded');
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 500);

  if coalesce(p_first_batch, true) then
    -- Reminders still waiting to go out in a community that switched them, or Gyan Path, off: not sent.
    for r in
      select distinct m.center_id, (m.payload->>'assignment_id')::uuid as assignment_id, app.module_enabled(ce.id, 'gyan_path') as module_on
        from app.centers ce join app.messages m on m.center_id = ce.id
       where (not app.module_enabled(ce.id, 'gyan_path') or coalesce(ce.rules #>> '{notifications,triggers,homework_reminder}', 'true') = 'false')
         and m.status = 'queued' and m.template_key = 'homework.due_soon'
    loop
      v_cancelled := v_cancelled + app._gyan_homework_cancel_due_soon(r.center_id, r.assignment_id, null,
        case when r.module_on then 'Not sent: homework reminders were switched off for this community (Settings › Notifications).'
             else 'Not sent: Gyan Path was switched off for this community.' end);
    end loop;
    -- A community whose time zone is not a known zone name gets no reminder: said once a run, in its audit log.
    for r in
      select c.id, c.time_zone
        from app.centers c
       where lower(c.time_zone) not in (select lower(z.name) from pg_timezone_names z)
         and exists (select 1 from app.gyan_assignments ga where ga.center_id = c.id and ga.status = 'published' and ga.remind_hours_before is not null)
    loop
      v_bad_zone := v_bad_zone + 1;
      perform app.log_audit(r.id, 'gyan_homework.reminders_skipped', 'centers', r.id::text, null,
                            jsonb_build_object('time_zone', r.time_zone),
                            'Homework reminders not sent: the community''s time zone "' || coalesce(r.time_zone, '') || '" is not a known time zone (Settings › Organization)');
    end loop;
  end if;

  -- The due list, once.
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_due from app._gyan_homework_reminders_due() d;
  select count(*) into v_quiet
    from jsonb_to_recordset(v_due) as d(due_at timestamptz, quiet_until timestamptz)
   where d.quiet_until is not null and d.quiet_until < d.due_at;

  for r in
    select d.assignment_id, d.center_id, d.person_id, d.due_on, d.due_at, d.remind_hours, d.remind_at
      from jsonb_to_recordset(v_due) as d(assignment_id uuid, center_id uuid, person_id uuid, due_on date, due_at timestamptz, remind_hours int,
                                          remind_at timestamptz, quiet_until timestamptz, due_rule jsonb, class_id uuid)
      join app.gyan_assignments a on a.id = d.assignment_id
     where (d.quiet_until is null or d.quiet_until >= d.due_at)
       and a.status = 'published' and a.remind_hours_before = d.remind_hours and a.due_rule = d.due_rule
       and a.class_id is not distinct from d.class_id
     order by d.remind_at, d.assignment_id, d.person_id
     limit v_limit
       for no key update of a skip locked
  loop
    v_seen := v_seen + 1;
    if not pg_try_advisory_xact_lock(hashtextextended('app.gyan_homework_reminder:' || r.assignment_id::text || ':' || r.person_id::text, 0)) then
      v_busy := v_busy + 1;
      continue;
    end if;
    -- Read again now that the learner is ours: an answer handed in since the list was read is not reminded.
    if exists (select 1 from app.gyan_submissions s
                where s.assignment_id = r.assignment_id and s.person_id = r.person_id and s.status in ('awaiting_parent', 'submitted', 'accepted')) then
      continue;
    end if;
    insert into app.gyan_homework_reminders (assignment_id, person_id, center_id, due_on, remind_hours, remind_at)
    values (r.assignment_id, r.person_id, r.center_id, r.due_on, r.remind_hours, r.remind_at)
    on conflict (assignment_id, person_id, due_on) do nothing;
    if not found then continue; end if;
    v_n := coalesce(app._gyan_homework_notify_family(r.center_id, 'homework.due_soon', r.assignment_id, r.person_id, null, true, false, false,
                                                     jsonb_build_object('due', to_char(r.due_on, 'FMDay, FMMonth FMDD'))), 0);
    -- A push that quiet hours hold until the due moment or later would arrive when the homework is already due: not sent.
    update app.messages m
       set status = 'cancelled', failure_reason = 'Not sent: the community''s quiet hours last until after the homework is due.'
     where m.center_id = r.center_id and m.status = 'queued' and m.scheduled_at >= r.due_at and m.channel = 'push'
       and m.template_key = 'homework.due_soon' and m.created_at = now()
       and m.payload->>'assignment_id' = r.assignment_id::text and m.payload->>'learner_id' = r.person_id::text;
    get diagnostics v_d = row_count;
    -- Refused at once (a suppressed address, an opt-out, a deceased recipient): counted apart, never "sent".
    select count(*) into v_s
      from app.messages m
     where m.center_id = r.center_id and m.status = 'suppressed' and m.scheduled_at = now() and m.template_key = 'homework.due_soon'
       and m.payload->>'assignment_id' = r.assignment_id::text and m.payload->>'learner_id' = r.person_id::text;
    v_q := greatest(v_n - v_s - v_d, 0);
    if v_q > 0 then
      update app.gyan_homework_reminders set messages = v_q
       where assignment_id = r.assignment_id and person_id = r.person_id and due_on = r.due_on;
    else
      v_unreached := v_unreached + 1;
    end if;
    v_reminded := v_reminded + 1;
    v_messages := v_messages + v_q;
    v_suppressed := v_suppressed + v_s;
    v_dropped := v_dropped + v_d;
  end loop;
  return jsonb_build_object('reminded', v_reminded, 'messages', v_messages, 'suppressed', v_suppressed, 'dropped_pushes', v_dropped,
                            'unreached', v_unreached, 'held_for_quiet_hours', v_quiet, 'busy', v_busy, 'cancelled', v_cancelled,
                            'skipped_time_zone', v_bad_zone, 'limit', v_limit, 'more', v_seen >= v_limit);
end $$;

-- ── Handing in cancels a reminder that has not gone out ──────────────────────
-- Hand in: a child's own hand-in waits for a household adult when the homework asks for it (parent_check always, or
-- children and the learner is under 18) and a household adult who can sign in can be asked; when none of them can, it
-- goes straight to the teacher and they are emailed (homework.heads_up). A household adult handing in for someone else
-- in the family goes straight to the teacher and is recorded as the parent (they are the parent). Needs at least one
-- part. A late hand-in is marked, never refused (H5). The parent's note of an earlier round is cleared.
-- 0587's body; 0588: it takes the learner's reminder lock (so it never crosses the sweep), and the learner's reminder
-- messages for this homework that are still queued (held by quiet hours, or not sent yet) are cancelled: the messaging
-- job skips a message that is no longer queued (app.worker_message_to_send). A message already sent stays as it is.
create or replace function app.hand_in_gyan_submission(p_submission uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.gyan_submissions; a app.gyan_assignments; v_name text; v_me uuid; v_check text; v_due date; v_late boolean; v_child boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into s from app.gyan_submissions where id = p_submission for update;
  if s.id is null then raise exception 'That homework answer was not found.' using errcode = 'P0002'; end if;
  select * into a from app.gyan_assignments where id = s.assignment_id;
  perform app.assert_module_enabled(s.center_id, 'gyan_path');
  if app.gyan_can_act_for(s.center_id, s.person_id) is not true then
    raise exception 'You can only hand in homework for yourself or for someone in your family.' using errcode = 'insufficient_privilege';
  end if;
  v_name := coalesce(app.gyan_learner_name(s.person_id), 'the learner');
  if a.status = 'draft' then
    raise exception 'This homework is not published yet and cannot be handed in.' using errcode = '22023';
  elsif a.status = 'archived' then
    raise exception 'This homework has been archived, so it can only be read now: it cannot be changed or handed in.' using errcode = '22023';
  end if;
  if s.status = 'awaiting_parent' then
    raise exception 'This homework is already handed in and waiting for a parent''s OK.' using errcode = '22023';
  elsif s.status = 'submitted' then
    raise exception 'This homework is already with the teacher.' using errcode = '22023';
  elsif s.status = 'accepted' then
    raise exception 'This homework was already accepted.' using errcode = '22023';
  elsif s.status = 'needs_work' then
    raise exception 'The teacher sent this homework back: change it and save it first, then hand it in again.' using errcode = '22023';
  end if;
  if s.text_answer is null and not exists (select 1 from app.gyan_submission_files f where f.submission_id = s.id and f.storage_path is not null) then
    raise exception 'Add a photo, a file, a voice note or a written answer before handing in.' using errcode = '22023';
  end if;
  -- 0588: never at the same moment as the reminder sweep looks at this learner (it takes the same lock and skips a
  -- learner who holds it); a reminder it queued just before is cancelled below.
  perform pg_advisory_xact_lock(hashtextextended('app.gyan_homework_reminder:' || a.id::text || ':' || s.person_id::text, 0));
  v_me := app.my_person_id(s.center_id);
  v_child := app.person_is_minor(s.person_id);
  v_check := app._gyan_homework_parent_check(s.center_id, a.id, s.person_id);
  v_due := app.gyan_assignment_due_on(a.id, s.person_id);
  v_late := v_due is not null and v_due < app.gyan_center_today(s.center_id);
  if v_check = 'waits' then
    perform app.set_audit_context('Handed in homework "' || a.title || '" for ' || v_name || case when v_child then ' (child)' else '' end || ', awaiting a parent');
    update app.gyan_submissions
       set status = 'awaiting_parent', submitted_by = auth.uid(), submitted_at = now(), late = v_late,
           parent_user = null, parent_decided_at = null, parent_note = null
     where id = s.id;
    -- The household adults who can sign in are asked (an adult learner's too: "always" waits for the other adult); their
    -- push opens the family screen: its type says so.
    perform app._gyan_homework_notify_family(s.center_id, 'homework.parent_check', a.id, s.person_id, s.id, false, true, true);
  else
    perform app.set_audit_context('Handed in homework "' || a.title || '" for ' || v_name || case when v_child then ' (child)' else '' end
                                  || case when v_me is distinct from s.person_id then ' by a household adult'
                                          when v_check = 'no_login' then ', straight to the teacher: no parent can sign in (a heads-up email goes to the household''s adults)'
                                          else '' end);
    update app.gyan_submissions
       set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), late = v_late,
           parent_user = case when v_me is distinct from s.person_id then auth.uid() end,
           parent_decided_at = case when v_me is distinct from s.person_id then now() end,
           parent_note = null
     where id = s.id;
    perform app._gyan_homework_notify_reviewers(s.center_id, a.id, s.person_id, s.id);
    -- Nobody in the household can sign in to check it: they are told by email that it went to the teacher.
    if v_check = 'no_login' then
      perform app._gyan_homework_notify_family(s.center_id, 'homework.heads_up', a.id, s.person_id, s.id, false, true, false,
        jsonb_build_object('what_happened', 'It went straight to the teacher, because nobody in the household has signed in to the app, so nobody could check it first.'));
    end if;
  end if;
  -- 0588: handed in, so the reminder (to the learner and to the household adults) that has not gone out yet never does;
  -- if nothing of it went out, it is forgotten, so an answer sent back later is reminded again.
  perform app._gyan_homework_cancel_due_soon(s.center_id, a.id, s.person_id, 'Not sent: the homework was handed in before the reminder went out.');
  return app.gyan_submission_json(s.id);
end $$;

-- ── Archiving or unpublishing cancels the reminders that have not gone out ───
-- 0587's body (draft → published → archived; published → draft only while nobody has started an answer; every publish
-- queues homework.publish_notify; archiving, unpublishing or un-requiring required homework pays the level bonus it
-- held). 0588: homework that leaves "published" cancels its reminders that are still queued (held by quiet hours, or
-- not sent yet), and forgets those of which nothing went out.
create or replace function app.set_gyan_assignment_status(p_assignment uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.gyan_assignments; l app.gyan_levels;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into a from app.gyan_assignments where id = p_assignment for update;
  if a.id is null then raise exception 'That homework was not found. It may have been removed; reload the page.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(a.center_id, 'gyan_path');
  if app.gyan_homework_editor(a.center_id, a.class_id) is not true then
    raise exception 'Changing this homework needs content.manage or pathshala.manage, or the Teacher role for its class.' using errcode = 'insufficient_privilege';
  end if;
  if p_status is null or p_status not in ('draft', 'published', 'archived') then
    raise exception 'The status must be "draft", "published" or "archived".' using errcode = '22023';
  end if;
  if p_status = a.status then return app.gyan_assignment_json(a.id); end if;
  select * into l from app.gyan_levels where id = a.level_id;
  if a.status = 'draft' and p_status = 'published' then
    perform app.set_audit_context('Published homework "' || a.title || '" (' || l.name || ')');
    update app.gyan_assignments set status = 'published', published_at = coalesce(published_at, now()) where id = a.id;
    perform app.enqueue_job(a.center_id, 'homework.publish_notify', jsonb_build_object('assignment_id', a.id), now(), 5);
  elsif a.status = 'published' and p_status = 'archived' then
    perform app.set_audit_context('Archived homework "' || a.title || '" (' || l.name || ')');
    update app.gyan_assignments set status = 'archived' where id = a.id;
    if a.required_for_level then perform app._gyan_homework_release_level_bonus(a.center_id, a.level_id); end if;
    perform app._gyan_homework_cancel_due_soon(a.center_id, a.id, null, 'Not sent: the homework was archived before the reminder went out.');
  elsif a.status = 'published' and p_status = 'draft' then
    if exists (select 1 from app.gyan_submissions s where s.assignment_id = a.id) then
      raise exception 'Someone has already started this homework, so it cannot go back to a draft. Archive it instead.' using errcode = '22023';
    end if;
    perform app.set_audit_context('Unpublished homework "' || a.title || '" (' || l.name || ')');
    update app.gyan_assignments set status = 'draft' where id = a.id;
    if a.required_for_level then perform app._gyan_homework_release_level_bonus(a.center_id, a.level_id); end if;
    perform app._gyan_homework_cancel_due_soon(a.center_id, a.id, null, 'Not sent: the homework was unpublished before the reminder went out.');
  elsif a.status = 'archived' then
    raise exception 'Archived homework stays archived; make new homework instead.' using errcode = '22023';
  else
    raise exception 'Homework goes from draft to published, then to archived (a draft cannot be archived).' using errcode = '22023';
  end if;
  return app.gyan_assignment_json(a.id);
end $$;

-- ── The template (a platform default; a community may override it) ──────────
-- One text for the learner and for the household adults of a child, as every 0587 template that goes to both: the
-- learner's wording, and a sentence that names the learner. Variables: 0587's (title, level, learner, due, deep_link,
-- type; center_short_name and center_name from the renderer), with "due" the due date in words ("Friday, October 16":
-- the sweep passes it; never "in 24 hours"). No note variable, ever.
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('homework.due_soon', 'push', 'Homework reminder for {{learner}}',
   'Reminder: "{{title}}" ({{level}}) is due {{due}}. {{learner}} has not handed it in yet.'),
  ('homework.due_soon', 'email', 'Reminder: {{learner}}''s homework "{{title}}" is due {{due}}',
   E'Reminder: "{{title}}" ({{level}}) at {{center_short_name}} is due {{due}}. {{learner}} has not handed it in yet.\n\nOpen the Community Connect app, go to the lesson and tap the homework to finish it and hand it in.')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- ── Comments ─────────────────────────────────────────────────────────────────
comment on function app.save_gyan_assignment(uuid, jsonb) is
  'content.manage or pathshala.manage, or a class Teacher for homework that names their class (H2): insert (no "id") or update homework on a Gyan Path level of this community or the shared library. Keys: id, level_id, class_id, title (1-120), instructions_md (<= 4000), allowed_kinds (photo | file | voice | text), max_files (1-10), required_for_level, points (0-1000; a class Teacher up to 100), due_rule, remind_hours_before (0588: 1-720 hours before the end of the due day, or null for no reminder; only with a due date), parent_check (never | children | always), reviewer (teacher | content; homework for a class is always teacher-reviewed), sort_order. A value of the wrong type is refused with a sentence. Once the homework has an answer its level, class, reviewer and parent check cannot change. New homework starts as a draft; app.set_gyan_assignment_status publishes it. Returns the row as JSON.';
comment on function app.my_gyan_homework(uuid) is
  'Member: {people: [{person_id, name, is_child}], items: [{assignment (with archived, remind_hours_before and remind_set_at), person_id, submission | null, needs_parent, can_parent_decide}]} for yourself and, when you are an adult, every current member of your households; published homework that applies to each person, and archived homework the person has an answer to (read-only: needs_parent and can_parent_decide are false for it).';
comment on function app.hand_in_gyan_submission(uuid) is
  'The learner or a household adult: draft → awaiting_parent (a child''s own hand-in when the homework asks for a parent''s check and a household adult who can sign in can be asked) or → submitted (an adult; a household adult handing in for someone in the family, recorded as parent_user; or a learner whose household has no adult who can sign in, whose adults are emailed homework.heads_up). Needs at least one part. Marks late, never refuses for it. Refused for archived homework. Tells the household adults (homework.parent_check) or the reviewers (homework.submitted). Cancels the learner''s homework.due_soon messages for this homework that are still queued, and forgets a reminder of which nothing went out (0588).';
comment on function app.set_gyan_assignment_status(uuid, text) is
  'Same callers as save_gyan_assignment: draft → published → archived (published → draft only while nobody has started an answer). EVERY publish queues a job, homework.publish_notify: the worker tells the learners it applies to (the class''s students, or the members who completed a step of the level) with homework.assigned (push + email), and the household adults of each child, in batches, skipping everyone already told: publishing again tells only those not told yet, never anyone twice. Archiving, unpublishing or un-requiring required homework pays the level bonus it was holding. Homework that leaves published cancels its homework.due_soon reminders that are still queued (0588).';
comment on function app.worker_homework_reminders_sweep(int, boolean) is
  'The worker role only (job homework.reminders_sweep, every 15 minutes, 0588): one batch of at most p_limit learners (100; the worker calls again while "more"): reminds the learners whose homework reminder time has come and who have not handed it in, and every adult of each household of a learner under 18, with homework.due_soon (push + email), once per learner and due date (app.gyan_homework_reminders). Quiet hours hold the whole reminder until they end, unless they end after the due moment: then the email goes and the push is not sent. p_first_batch: cancel the reminders still queued in communities that switched reminders or Gyan Path off, and audit communities whose time zone is unknown (they get no reminder). Returns {reminded, messages, suppressed, dropped_pushes, unreached, held_for_quiet_hours, busy, cancelled, skipped_time_zone, limit, more}.';
comment on function app._gyan_homework_reminders_due() is
  'Internal (0588): the learners whose homework reminder is due now and not yet sent, with the due date, the due moment (the end of the due day in the community''s time zone), the reminder time, the end of the community''s quiet hours when they are on, and the homework''s due rule and class. Set-based; communities with an unknown time zone are left out.';
comment on function app._gyan_homework_cancel_due_soon(uuid, uuid, uuid, text) is
  'Internal (0588): cancels the homework.due_soon messages of a homework (or of one learner) that are still queued, with the reason given, and deletes the log row of a reminder of which nothing went out. Returns how many messages it cancelled.';

-- ── Grants ───────────────────────────────────────────────────────────────────
-- The list of who is due and the cancelling are internal (they name, or act on, learners of any community); the sweep is
-- the worker role's alone (it asserts that itself too).
revoke execute on function app._gyan_homework_reminders_due(), app._gyan_homework_cancel_due_soon(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function app._gyan_homework_reminders_due(), app._gyan_homework_cancel_due_soon(uuid, uuid, uuid, text) to service_role;
revoke execute on function app.worker_homework_reminders_sweep(int, boolean) from public, anon, authenticated, service_role;
grant execute on function app.worker_homework_reminders_sweep(int, boolean) to connect_worker;
