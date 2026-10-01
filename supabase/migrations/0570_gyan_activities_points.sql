-- 0570_gyan_activities_points.sql: interactive Gyan Path activities, points for every successful practice try
-- (with a daily cap), and a once-only bonus when a level is completed.
--
-- Owner request 2026-10-01 (Gamified Gyan Path; the shared spec's "Data contract"):
--   app.gyan_steps
--     kind        gains 'hotspot' (tap the spots on a picture: learn, then practise in order) and 'voice' (listen,
--                 repeat each verse, then say it all; the phone listens)
--     activity    jsonb payload for the non-quiz kinds: read {cards}, hotspot {image, mode, spots}, voice {lang, mode,
--                 pass_ratio, verses}; any kind may carry review / tip / fun_fact. Checked on every write
--                 (app.gyan_activity_problems), so the apps never get a payload they cannot draw.
--     quiz        keeps {questions:[...]}; a question may now carry "type" (choice | truefalse | order | match | fill,
--                 default choice) and "explain". Checked on write (app.gyan_quiz_problems). The older bare list of
--                 questions (0312's demo pack) is still accepted as it was and is not checked.
--     repeat_points  points for EVERY successful practice try, up to the daily cap. The step's `points` stay what
--                 they were: paid once ever, on the first completion (0018's trigger).
--   app.gyan_levels.treasure_points   paid once, when the level is completed.
--   app.gyan_attempts                 one row per try (success or not). Read by the person, the adults of their
--                                     household (parents) and Pathshala teachers; written only by the RPC.
--   app.record_gyan_attempt(center, step, success, score, detail)
--     records the try; a successful try pays repeat_points while the person's successful tries of that step TODAY
--     (the community's local day, centers.time_zone) are below centers.rules.points.gyan_practice_daily_cap
--     (default 10). A success also completes the step (gyan_progress), so the first one pays the step's points.
--   Level completion bonus (trigger on gyan_progress): when a person has completed every step of a level, once:
--     the level's points if the level does NOT need a teacher sign-off (sign-off levels keep paying on approval, 0017)
--     plus treasure_points. Steps of SHARED goals (center_id null) pay into the community of the progress row.
--
-- Points ledger reasons: 'gyan_try' (a practice try) and 'gyan_treasure' (a level's treasure) are new. Step points
-- and level points keep 'level' (ref_id = step / level), so the existing once-only guards, and this migration's,
-- all look at the same rows: a level is never paid twice, whichever way it was completed, and a replay pays nothing.
-- Points are not money; nothing here touches payments.
set client_min_messages = warning;

-- ── Steps: the new kinds, the activity payload, repeat points ────────────────
alter table app.gyan_steps drop constraint if exists gyan_steps_kind_check;
alter table app.gyan_steps add constraint gyan_steps_kind_check
  check (kind in ('read', 'listen', 'recite', 'quiz', 'video', 'practice', 'hotspot', 'voice'));

alter table app.gyan_steps add column if not exists activity jsonb not null default '{}'::jsonb;
alter table app.gyan_steps add column if not exists repeat_points integer not null default 0;
alter table app.gyan_steps drop constraint if exists gyan_steps_activity_object;
alter table app.gyan_steps add constraint gyan_steps_activity_object check (jsonb_typeof(activity) = 'object');
alter table app.gyan_steps drop constraint if exists gyan_steps_repeat_points_range;
alter table app.gyan_steps add constraint gyan_steps_repeat_points_range check (repeat_points between 0 and 1000);

alter table app.gyan_levels add column if not exists treasure_points integer not null default 0;
alter table app.gyan_levels drop constraint if exists gyan_levels_treasure_points_range;
alter table app.gyan_levels add constraint gyan_levels_treasure_points_range check (treasure_points between 0 and 10000);

comment on column app.gyan_steps.kind is
  'read | listen | recite | quiz | video | practice | hotspot (tap the spots on a picture; activity.mode learn or practice) | voice (listen, repeat each verse, say it all; activity.verses).';
comment on column app.gyan_steps.activity is
  'Payload for the non-quiz kinds (0570). read: {cards:[{title, body_md, emoji?, image?}]}; hotspot: {image, mode: learn|practice, intro?, spots:[{key, order, label, x, y, r, say?, why?}]} with x, y, r as fractions of the image; voice: {lang, mode: listen_repeat_say, pass_ratio?, verses:[{text, translit?, meaning?, audio?}]}. Any kind: review ("needs_pathshala_review"), tip, fun_fact. Images and audio: asset:<name>, a content-bucket key or an https address. Checked on write by app.gyan_activity_problems.';
comment on column app.gyan_steps.quiz is
  '{questions:[...]}; each question has an optional type (choice, the default | truefalse | order | match | fill) and explain. choice {question, options, answer: 0-based index}; truefalse {statement, answer: true|false}; order {prompt, items in the right order}; match {prompt, pairs:[[left, right], ...]}; fill {sentence with ___, answer, options}. Checked on write by app.gyan_quiz_problems (a bare list, the older shape, is not checked).';
comment on column app.gyan_steps.points is 'Paid once ever, the first time the person completes the step (0018).';
comment on column app.gyan_steps.repeat_points is
  'Paid for every successful practice try (app.record_gyan_attempt), up to centers.rules.points.gyan_practice_daily_cap successful tries per person per step per community-local day (default 10). 0 = tries earn nothing.';
comment on column app.gyan_levels.treasure_points is
  'Bonus paid once when the person has completed every step of the level (with the level''s own points when it needs no teacher sign-off).';

-- ── Checking the payloads ────────────────────────────────────────────────────
-- Small pure helpers: a non-empty piece of text, a number, a list's length (null when it is not one), and a picture
-- or audio reference (asset:<name> bundled in the app, a content-bucket key, or an https address).
create or replace function app.gyan_is_text(p jsonb, p_max integer default 4000) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(jsonb_typeof(p) = 'string' and btrim(p #>> '{}') <> '' and char_length(p #>> '{}') <= p_max, false)
$$;
create or replace function app.gyan_num(p jsonb) returns numeric
language sql immutable set search_path = app, public, extensions as $$
  select case when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric end
$$;
create or replace function app.gyan_list_len(p jsonb) returns integer
language sql immutable set search_path = app, public, extensions as $$
  select case when jsonb_typeof(p) = 'array' then jsonb_array_length(p) end
$$;
create or replace function app.gyan_media_ref_ok(p jsonb) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select app.gyan_is_text(p, 500)
     and (p #>> '{}') ~ '^(asset:[a-z0-9][a-z0-9_-]{0,63}|https://[^[:space:]]+|[A-Za-z0-9][A-Za-z0-9_./-]*)$'
     and position('..' in (p #>> '{}')) = 0
$$;

-- Plain-English problems with a step's activity payload for its kind; empty = fine.
create or replace function app.gyan_activity_problems(p_kind text, p_activity jsonb) returns text[]
language plpgsql immutable set search_path = app, public, extensions as $$
declare
  a jsonb := coalesce(p_activity, '{}'::jsonb);
  v text[] := '{}';
  e jsonb; k text; i int; n int; x numeric;
  v_keys text[] := '{}'; v_orders numeric[] := '{}';
begin
  if jsonb_typeof(a) <> 'object' then return array['The activity must be a JSON object ({ … }).']; end if;
  foreach k in array array['review', 'tip', 'fun_fact', 'intro'] loop
    if a ? k and jsonb_typeof(a->k) <> 'null' and not app.gyan_is_text(a->k, 2000) then
      v := v || format('"%s" must be text.', k);
    end if;
  end loop;

  if p_kind = 'read' and a ? 'cards' then
    n := app.gyan_list_len(a->'cards');
    if n is null or n not between 1 and 30 then
      v := v || format('A learn step''s "cards" must be a list of 1 to 30 cards.');
    else
      for i in 0 .. n - 1 loop
        e := a->'cards'->i;
        if jsonb_typeof(e) <> 'object' then v := v || format('Card %s must be an object with a title and body_md.', i + 1); continue; end if;
        if not app.gyan_is_text(e->'title', 200) then v := v || format('Card %s needs a title (at most 200 characters).', i + 1); end if;
        if not app.gyan_is_text(e->'body_md', 4000) then v := v || format('Card %s needs its text in body_md (at most 4,000 characters).', i + 1); end if;
        if e ? 'emoji' and jsonb_typeof(e->'emoji') <> 'null' and not app.gyan_is_text(e->'emoji', 16) then
          v := v || format('Card %s: "emoji" must be a short piece of text.', i + 1);
        end if;
        if e ? 'image' and jsonb_typeof(e->'image') <> 'null' and not app.gyan_media_ref_ok(e->'image') then
          v := v || format('Card %s: "image" must be asset:<name>, a content-bucket key or an https address.', i + 1);
        end if;
      end loop;
    end if;
  end if;

  if p_kind = 'hotspot' then
    if not app.gyan_media_ref_ok(a->'image') then
      v := v || format('A hotspot step needs an "image": asset:<name>, a content-bucket key or an https address.');
    end if;
    if coalesce(a->>'mode', '') not in ('learn', 'practice') then
      v := v || format('A hotspot step''s "mode" must be "learn" or "practice".');
    end if;
    n := app.gyan_list_len(a->'spots');
    if n is null or n not between 1 and 30 then
      v := v || format('A hotspot step needs "spots": a list of 1 to 30 places to tap.');
    else
      for i in 0 .. n - 1 loop
        e := a->'spots'->i;
        if jsonb_typeof(e) <> 'object' then v := v || format('Spot %s must be an object.', i + 1); continue; end if;
        if not app.gyan_is_text(e->'key', 40) or (e->>'key') !~ '^[a-z0-9][a-z0-9_-]*$' then
          v := v || format('Spot %s needs a "key" (lower-case letters, digits, - or _).', i + 1);
        elsif (e->>'key') = any (v_keys) then
          v := v || format('Spot %s: the key "%s" is used twice.', i + 1, e->>'key');
        else
          v_keys := v_keys || (e->>'key');
        end if;
        x := app.gyan_num(e->'order');
        if x is null or x <> floor(x) or x < 1 then
          v := v || format('Spot %s needs an "order": a whole number from 1.', i + 1);
        elsif x = any (v_orders) then
          v := v || format('Spot %s: order %s is used twice.', i + 1, x);
        else
          v_orders := v_orders || x;
        end if;
        if not app.gyan_is_text(e->'label', 120) then v := v || format('Spot %s needs a "label".', i + 1); end if;
        x := app.gyan_num(e->'x');
        if x is null or x < 0 or x > 1 then v := v || format('Spot %s: "x" must be a fraction of the picture''s width (0 to 1).', i + 1); end if;
        x := app.gyan_num(e->'y');
        if x is null or x < 0 or x > 1 then v := v || format('Spot %s: "y" must be a fraction of the picture''s height (0 to 1).', i + 1); end if;
        x := app.gyan_num(e->'r');
        if x is null or x <= 0 or x > 0.5 then v := v || format('Spot %s: "r" (the tap radius) must be above 0 and at most 0.5.', i + 1); end if;
        foreach k in array array['say', 'why'] loop
          if e ? k and jsonb_typeof(e->k) <> 'null' and not app.gyan_is_text(e->k, 1000) then
            v := v || format('Spot %s: "%s" must be text.', i + 1, k);
          end if;
        end loop;
      end loop;
    end if;
  end if;

  if p_kind = 'voice' then
    if not app.gyan_is_text(a->'lang', 20) or (a->>'lang') !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' then
      v := v || format('A voice step needs a "lang" such as "hi-IN" or "en-US".');
    end if;
    if coalesce(a->>'mode', '') <> 'listen_repeat_say' then
      v := v || format('A voice step''s "mode" must be "listen_repeat_say".');
    end if;
    if a ? 'pass_ratio' then
      x := app.gyan_num(a->'pass_ratio');
      if x is null or x <= 0 or x > 1 then v := v || format('"pass_ratio" must be a number above 0 and at most 1 (for example 0.7).'); end if;
    end if;
    n := app.gyan_list_len(a->'verses');
    if n is null or n not between 1 and 50 then
      v := v || format('A voice step needs "verses": a list of 1 to 50 verses.');
    else
      for i in 0 .. n - 1 loop
        e := a->'verses'->i;
        if jsonb_typeof(e) <> 'object' then v := v || format('Verse %s must be an object.', i + 1); continue; end if;
        if not app.gyan_is_text(e->'text', 500) then v := v || format('Verse %s needs its "text".', i + 1); end if;
        foreach k in array array['translit', 'meaning'] loop
          if e ? k and jsonb_typeof(e->k) <> 'null' and not app.gyan_is_text(e->k, 1000) then
            v := v || format('Verse %s: "%s" must be text.', i + 1, k);
          end if;
        end loop;
        if e ? 'audio' and jsonb_typeof(e->'audio') <> 'null' and not app.gyan_media_ref_ok(e->'audio') then
          v := v || format('Verse %s: "audio" must be asset:<name>, a content-bucket key or an https address.', i + 1);
        end if;
      end loop;
    end if;
  end if;
  return v;
end $$;

-- Plain-English problems with a {questions:[...]} quiz; empty = fine. A bare list (the older shape) is not checked.
create or replace function app.gyan_quiz_problems(p_quiz jsonb) returns text[]
language plpgsql immutable set search_path = app, public, extensions as $$
declare
  v text[] := '{}';
  q jsonb; e jsonb; i int; j int; n int; m int; t text; x numeric;
begin
  if p_quiz is null or jsonb_typeof(p_quiz) in ('null', 'array') then return v; end if;
  if jsonb_typeof(p_quiz) <> 'object' or app.gyan_list_len(p_quiz->'questions') is null then
    return array['A quiz must look like {"questions": [ … ]}.'];
  end if;
  n := jsonb_array_length(p_quiz->'questions');
  if n not between 1 and 30 then return array['A quiz needs 1 to 30 questions.']; end if;
  for i in 0 .. n - 1 loop
    q := p_quiz->'questions'->i;
    if jsonb_typeof(q) <> 'object' then v := v || format('Question %s must be an object.', i + 1); continue; end if;
    t := coalesce(q->>'type', 'choice');
    if q ? 'explain' and jsonb_typeof(q->'explain') <> 'null' and not app.gyan_is_text(q->'explain', 1000) then
      v := v || format('Question %s: "explain" must be text.', i + 1);
    end if;
    if t = 'choice' then
      if not app.gyan_is_text(q->'question', 500) then v := v || format('Question %s needs its "question".', i + 1); end if;
      m := app.gyan_list_len(q->'options');
      if m is null or m not between 2 and 8 then
        v := v || format('Question %s needs 2 to 8 "options".', i + 1);
      else
        if exists (select 1 from jsonb_array_elements(q->'options') o where not app.gyan_is_text(o, 200)) then
          v := v || format('Question %s: every option must be text.', i + 1);
        end if;
        x := app.gyan_num(q->'answer');
        if x is null or x <> floor(x) or x < 0 or x >= m then
          v := v || format('Question %s: "answer" must be the number of the right option, counting from 0.', i + 1);
        end if;
      end if;
    elsif t = 'truefalse' then
      if not app.gyan_is_text(q->'statement', 500) then v := v || format('Question %s needs its "statement".', i + 1); end if;
      if jsonb_typeof(q->'answer') is distinct from 'boolean' then v := v || format('Question %s: "answer" must be true or false.', i + 1); end if;
    elsif t = 'order' then
      if not app.gyan_is_text(q->'prompt', 500) then v := v || format('Question %s needs its "prompt".', i + 1); end if;
      m := app.gyan_list_len(q->'items');
      if m is null or m not between 2 and 10 then
        v := v || format('Question %s needs 2 to 10 "items", in the right order.', i + 1);
      elsif exists (select 1 from jsonb_array_elements(q->'items') o where not app.gyan_is_text(o, 200)) then
        v := v || format('Question %s: every item must be text.', i + 1);
      elsif (select count(distinct o) from jsonb_array_elements_text(q->'items') o) < m then
        v := v || format('Question %s: the items must all be different.', i + 1);
      end if;
    elsif t = 'match' then
      if not app.gyan_is_text(q->'prompt', 500) then v := v || format('Question %s needs its "prompt".', i + 1); end if;
      m := app.gyan_list_len(q->'pairs');
      if m is null or m not between 2 and 8 then
        v := v || format('Question %s needs 2 to 8 "pairs".', i + 1);
      else
        for j in 0 .. m - 1 loop
          e := q->'pairs'->j;
          if app.gyan_list_len(e) is distinct from 2 or not app.gyan_is_text(e->0, 200) or not app.gyan_is_text(e->1, 200) then
            v := v || format('Question %s: pair %s must be ["left", "right"].', i + 1, j + 1);
          end if;
        end loop;
        if not exists (select 1 from unnest(v) p where p like format('Question %s: pair%%', i + 1)) and (
             (select count(distinct p->>0) from jsonb_array_elements(q->'pairs') p) < m
          or (select count(distinct p->>1) from jsonb_array_elements(q->'pairs') p) < m) then
          v := v || format('Question %s: each left and each right side must be different.', i + 1);
        end if;
      end if;
    elsif t = 'fill' then
      if not app.gyan_is_text(q->'sentence', 500) or position('___' in (q->>'sentence')) = 0 then
        v := v || format('Question %s needs a "sentence" with ___ where the word goes.', i + 1);
      end if;
      if not app.gyan_is_text(q->'answer', 200) then v := v || format('Question %s needs its "answer".', i + 1); end if;
      m := app.gyan_list_len(q->'options');
      if m is null or m not between 2 and 8 then
        v := v || format('Question %s needs 2 to 8 "options" to pick from.', i + 1);
      elsif exists (select 1 from jsonb_array_elements(q->'options') o where not app.gyan_is_text(o, 200)) then
        v := v || format('Question %s: every option must be text.', i + 1);
      elsif not (q->'options' @> jsonb_build_array(q->'answer')) then
        v := v || format('Question %s: the answer must be one of the options.', i + 1);
      end if;
    else
      v := v || format('Question %s: "%s" is not a question type (choice, truefalse, order, match or fill).', i + 1, t);
    end if;
  end loop;
  return v;
end $$;

-- Every write of a step is checked; the error names the step and the first problems, in plain English.
create or replace function app.gyan_steps_check() returns trigger
language plpgsql set search_path = app, public, extensions as $$
declare v text[];
begin
  new.activity := coalesce(new.activity, '{}'::jsonb);
  v := app.gyan_activity_problems(new.kind, new.activity);
  if tg_op = 'INSERT' or new.quiz is distinct from old.quiz then
    v := v || app.gyan_quiz_problems(new.quiz);
  end if;
  if cardinality(v) > 0 then
    raise exception 'The lesson step "%" cannot be saved: %', new.title, array_to_string(v[1:5], ' ')
      using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists gyan_steps_check on app.gyan_steps;
create trigger gyan_steps_check before insert or update of kind, activity, quiz on app.gyan_steps
  for each row execute function app.gyan_steps_check();

-- ── Points ledger: two new reasons ───────────────────────────────────────────
alter table app.points_ledger drop constraint if exists points_ledger_reason_check;
alter table app.points_ledger add constraint points_ledger_reason_check
  check (reason in ('practice','level','anumodana_sent','anumodana_received','support','welcome','volunteer','correction',
                    'challenge','survey','gyan_try','gyan_treasure'));
comment on column app.points_ledger.reason is
  'practice | level (Gyan Path step points, ref_id = step; level points, ref_id = level) | anumodana_sent | anumodana_received | support | welcome | volunteer | correction | challenge | survey | gyan_try (a successful Gyan Path practice try, ref_id = step) | gyan_treasure (a level''s treasure, ref_id = level).';

-- ── Tries ────────────────────────────────────────────────────────────────────
create table if not exists app.gyan_attempts (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references app.centers(id) on delete cascade,
  person_id  uuid not null references app.people(id) on delete cascade,
  step_id    uuid not null references app.gyan_steps(id) on delete cascade,
  success    boolean not null,
  score      integer check (score between 0 and 100),
  detail     jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  points     integer not null default 0 check (points >= 0),
  created_at timestamptz not null default now()
);
create index if not exists gyan_attempts_person_step_idx on app.gyan_attempts (person_id, step_id, created_at desc);
create index if not exists gyan_attempts_center_idx on app.gyan_attempts (center_id, created_at desc);
comment on table app.gyan_attempts is
  'Gyan Path practice tries (0570): one row per try, successful or not, with an optional 0-100 score, what the app wants to remember (detail: e.g. the words to fix) and the repeat points the try earned. Written only by app.record_gyan_attempt; read by the person, the adults of their household and Pathshala teachers.';
comment on column app.gyan_attempts.center_id is 'The community the try was made in (for a shared goal, the person''s community).';
comment on column app.gyan_attempts.points is 'Repeat points this try earned (0 when it failed or the daily cap was reached).';

insert into app.module_tables (table_name, module_key) values ('gyan_attempts', 'gyan_path')
  on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_gyan_attempts on app.gyan_attempts;
create trigger audit_gyan_attempts after insert or update or delete on app.gyan_attempts
  for each row execute function app.audit_row();

alter table app.gyan_attempts enable row level security;
-- The person, and the adults of their household (parents see their children's tries).
drop policy if exists gyan_attempts_own on app.gyan_attempts;
create policy gyan_attempts_own on app.gyan_attempts for select to authenticated
  using (app.can_act_for_person(center_id, person_id));
-- Pathshala teachers: center-wide teach/manage, or the teacher of a class the learner is placed in (as sign-offs, 0010).
drop policy if exists gyan_attempts_teacher on app.gyan_attempts;
create policy gyan_attempts_teacher on app.gyan_attempts for select to authenticated
  using (app.has_permission(center_id, 'pathshala.teach') or app.has_permission(center_id, 'pathshala.manage')
         or exists (select 1 from app.pathshala_enrollments e where e.student_person_id = gyan_attempts.person_id
                      and e.class_id is not null and app.has_scoped_role(e.center_id, e.class_id, 'teacher')));
drop policy if exists module_switch on app.gyan_attempts;
create policy module_switch on app.gyan_attempts as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('gyan_path'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('gyan_path'))::uuid[])));
-- No write policy and no write grant: tries are recorded by app.record_gyan_attempt only.
revoke all on app.gyan_attempts from public, anon, authenticated, connect_worker;
grant select on app.gyan_attempts to authenticated;
grant all on app.gyan_attempts to service_role;

-- ── Completing a level: its points (no sign-off) and its treasure, once ──────
-- Serialised per person and level (the same lock the sign-off award takes below), so two steps finished at the
-- same moment cannot both pay, and the second one to commit still sees the first.
create or replace function app.gyan_award_level_bonus(p_center uuid, p_person uuid, p_level uuid) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare l app.gyan_levels; v_total int; v_done int; v_paid int := 0;
begin
  if p_center is null or p_person is null or p_level is null then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended('app.gyan_level_award:' || p_person::text || ':' || p_level::text, 0));
  select * into l from app.gyan_levels where id = p_level;
  if not found then return 0; end if;
  select count(*), count(gp.completed_at) into v_total, v_done
    from app.gyan_steps st
    left join app.gyan_progress gp on gp.step_id = st.id and gp.person_id = p_person
   where st.level_id = p_level;
  if v_total = 0 or v_done < v_total then return 0; end if;

  if not l.requires_teacher_signoff and coalesce(l.points, 0) > 0
     and not exists (select 1 from app.points_ledger p where p.person_id = p_person and p.reason = 'level' and p.ref_id = p_level) then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id, note)
      values (p_center, p_person, l.points, 'level', p_level, 'Gyan Path level complete: ' || l.name);
    v_paid := v_paid + l.points;
  end if;
  if coalesce(l.treasure_points, 0) > 0
     and not exists (select 1 from app.points_ledger p where p.person_id = p_person and p.reason = 'gyan_treasure' and p.ref_id = p_level) then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id, note)
      values (p_center, p_person, l.treasure_points, 'gyan_treasure', p_level, 'Gyan Path treasure: ' || coalesce(l.treasure, l.name));
    v_paid := v_paid + l.treasure_points;
  end if;
  return v_paid;
end $$;

create or replace function app.gyan_progress_level_bonus() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.completed_at is not null and (tg_op = 'INSERT' or old.completed_at is null) then
    perform app.gyan_award_level_bonus(new.center_id, new.person_id, (select s.level_id from app.gyan_steps s where s.id = new.step_id));
  end if;
  return new;
end $$;
drop trigger if exists gyan_progress_level_bonus on app.gyan_progress;
create trigger gyan_progress_level_bonus after insert or update of completed_at on app.gyan_progress
  for each row execute function app.gyan_progress_level_bonus();

-- 0017's sign-off award, unchanged except that it takes the same per-person-and-level lock.
create or replace function app.award_signoff_points() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform pg_advisory_xact_lock(hashtextextended('app.gyan_level_award:' || new.person_id::text || ':' || new.level_id::text, 0));
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id, note)
    select new.center_id, new.person_id, coalesce(l.points, 0), 'level', new.level_id, 'Teacher sign-off: ' || l.name
      from app.gyan_levels l where l.id = new.level_id and coalesce(l.points, 0) > 0
       and not exists (select 1 from app.points_ledger p where p.person_id = new.person_id and p.reason = 'level' and p.ref_id = new.level_id);
  end if;
  return new;
end $$;

-- The demo pack (0312): levels 1 and 2 of its lessons need no sign-off, so the demo learners who finished them
-- (nine and five of them) now also earn the level's points on completion: 14 more points entries than before.
update app.demo_packs p
   set contents = (select jsonb_agg(case when m->'rows' ? 'points_ledger'
                                         then jsonb_set(m, '{rows,points_ledger}', to_jsonb((m #>> '{rows,points_ledger}')::int + 14))
                                         else m end order by o)
                     from jsonb_array_elements(p.contents) with ordinality x(m, o))
 where p.key = 'community';

-- ── Recording a try ──────────────────────────────────────────────────────────
create or replace function app.record_gyan_attempt(p_center uuid, p_step uuid, p_success boolean,
                                                   p_score integer default null, p_detail jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  c app.centers; s app.gyan_steps; l app.gyan_levels; g app.gyan_goals;
  v_person uuid; v_raw jsonb; v_cap int; v_today date; v_from timestamptz; v_to timestamptz;
  v_tries int; v_try_pts int := 0; v_prev_done timestamptz; v_first boolean := false; v_stars int;
  b_step int; b_level int; b_treasure int; a_step int := 0; a_level int := 0; a_treasure int := 0;
  v_total int; v_done int;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or p_step is null or p_success is null then
    raise exception 'Recording a try needs the community, the lesson step and whether the try succeeded.' using errcode = '22023';
  end if;
  select * into c from app.centers where id = p_center;
  if not found then raise exception 'That community was not found.' using errcode = 'P0002'; end if;
  v_person := app.my_person_id(p_center);
  if v_person is null then
    raise exception 'Only members of this community can practise its Gyan Path lessons.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'gyan_path');

  select * into s from app.gyan_steps where id = p_step;
  if not found then raise exception 'That lesson step was not found. It may have been removed; reload the lesson.' using errcode = 'P0002'; end if;
  select * into l from app.gyan_levels where id = s.level_id;
  select * into g from app.gyan_goals where id = l.goal_id;
  if g.center_id is not null and g.center_id <> p_center then
    raise exception 'That lesson belongs to another community.' using errcode = 'insufficient_privilege';
  end if;
  if p_score is not null and (p_score < 0 or p_score > 100) then
    raise exception 'The score must be between 0 and 100.' using errcode = '22023';
  end if;
  p_detail := coalesce(p_detail, '{}'::jsonb);
  if jsonb_typeof(p_detail) <> 'object' then raise exception 'The try''s details must be a JSON object.' using errcode = '22023'; end if;
  if octet_length(p_detail::text) > 8000 then raise exception 'The try''s details are too large (at most 8 KB).' using errcode = '22023'; end if;

  -- One try at a time per person and step, so two quick taps cannot both slip under the cap.
  perform pg_advisory_xact_lock(hashtextextended('app.record_gyan_attempt:' || v_person::text || ':' || p_step::text, 0));

  -- The cap: successful tries per person per step per community-local day.
  v_raw := c.rules->'points'->'gyan_practice_daily_cap';
  v_cap := case when jsonb_typeof(v_raw) = 'number' then least(greatest(floor((v_raw #>> '{}')::numeric)::int, 0), 1000) else 10 end;
  v_today := (now() at time zone c.time_zone)::date;
  v_from := v_today::timestamp at time zone c.time_zone;
  v_to := (v_today + 1)::timestamp at time zone c.time_zone;
  select count(*) into v_tries from app.gyan_attempts a
   where a.person_id = v_person and a.step_id = p_step and a.success and a.created_at >= v_from and a.created_at < v_to;
  if p_success and v_tries < v_cap and coalesce(s.repeat_points, 0) > 0 then v_try_pts := s.repeat_points; end if;

  perform set_config('app.audit_reason', 'Gyan Path practice try', true);
  insert into app.gyan_attempts (center_id, person_id, step_id, success, score, detail, points)
    values (p_center, v_person, p_step, p_success, p_score, p_detail, v_try_pts);
  if v_try_pts > 0 then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id, note)
      values (p_center, v_person, v_try_pts, 'gyan_try', p_step, 'Gyan Path practice: ' || s.title);
  end if;

  if p_success then
    -- A success completes the step: the first one pays the step's points (0018) and, when it finishes the level,
    -- the level bonus (above). What those once-only awards paid in this call is read back from the ledger.
    select coalesce(sum(p.points) filter (where p.reason = 'level' and p.ref_id = p_step), 0),
           coalesce(sum(p.points) filter (where p.reason = 'level' and p.ref_id = l.id), 0),
           coalesce(sum(p.points) filter (where p.reason = 'gyan_treasure' and p.ref_id = l.id), 0)
      into b_step, b_level, b_treasure
      from app.points_ledger p
     where p.center_id = p_center and p.person_id = v_person and p.ref_id in (p_step, l.id) and p.reason in ('level', 'gyan_treasure');

    select gp.completed_at into v_prev_done from app.gyan_progress gp where gp.person_id = v_person and gp.step_id = p_step for update;
    v_first := v_prev_done is null;
    v_stars := case when p_score is null then 0 when p_score >= 90 then 3 when p_score >= 60 then 2 else 1 end;
    insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at)
      values (p_center, v_person, p_step, v_stars, now())
    on conflict (person_id, step_id) do update
      set stars = greatest(app.gyan_progress.stars, excluded.stars),
          completed_at = coalesce(app.gyan_progress.completed_at, excluded.completed_at);

    select coalesce(sum(p.points) filter (where p.reason = 'level' and p.ref_id = p_step), 0) - b_step,
           coalesce(sum(p.points) filter (where p.reason = 'level' and p.ref_id = l.id), 0) - b_level,
           coalesce(sum(p.points) filter (where p.reason = 'gyan_treasure' and p.ref_id = l.id), 0) - b_treasure
      into a_step, a_level, a_treasure
      from app.points_ledger p
     where p.center_id = p_center and p.person_id = v_person and p.ref_id in (p_step, l.id) and p.reason in ('level', 'gyan_treasure');
  end if;

  select count(*), count(gp.completed_at) into v_total, v_done
    from app.gyan_steps st left join app.gyan_progress gp on gp.step_id = st.id and gp.person_id = v_person
   where st.level_id = l.id;

  return jsonb_build_object(
    'points_awarded', v_try_pts + a_step + a_level + a_treasure,
    'tries_today', v_tries + case when p_success then 1 else 0 end,
    'cap', v_cap,
    'first_time', v_first,
    'try_points', v_try_pts,
    'step_points', a_step,
    'level_points', a_level,
    'treasure_points', a_treasure,
    'level_complete', v_total > 0 and v_done = v_total);
end $$;

comment on function app.record_gyan_attempt(uuid, uuid, boolean, integer, jsonb) is
  'Member (of p_center, Gyan Path on): record one try of a lesson step for yourself. A success earns the step''s repeat_points while your successful tries of that step today (community-local day) are below rules.points.gyan_practice_daily_cap (default 10), and completes the step (first time: the step''s points; last step of a level: the level bonus). Returns {points_awarded, tries_today, cap, first_time, try_points, step_points, level_points, treasure_points, level_complete}; points_awarded is everything this call paid.';
comment on function app.gyan_award_level_bonus(uuid, uuid, uuid) is
  'Internal: once every step of the level is complete for the person, pay the level''s points (only when it needs no teacher sign-off) and its treasure_points, each once ever. Returns what it paid now.';
comment on function app.gyan_activity_problems(text, jsonb) is
  'Plain-English problems with a Gyan Path step''s activity payload for its kind (empty = fine). Used on every write of app.gyan_steps.';
comment on function app.gyan_quiz_problems(jsonb) is
  'Plain-English problems with a {questions:[...]} quiz: choice, truefalse, order, match and fill questions (empty = fine). Used on every write of app.gyan_steps.quiz.';

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app.record_gyan_attempt(uuid, uuid, boolean, integer, jsonb) from public, anon;
grant execute on function app.record_gyan_attempt(uuid, uuid, boolean, integer, jsonb) to authenticated;
revoke execute on function app.gyan_award_level_bonus(uuid, uuid, uuid), app.gyan_progress_level_bonus(), app.gyan_steps_check()
  from public, anon, authenticated;
revoke execute on function app.gyan_activity_problems(text, jsonb), app.gyan_quiz_problems(jsonb), app.gyan_is_text(jsonb, integer),
  app.gyan_num(jsonb), app.gyan_list_len(jsonb), app.gyan_media_ref_ok(jsonb) from public, anon;
grant execute on function app.gyan_activity_problems(text, jsonb), app.gyan_quiz_problems(jsonb), app.gyan_is_text(jsonb, integer),
  app.gyan_num(jsonb), app.gyan_list_len(jsonb), app.gyan_media_ref_ok(jsonb) to authenticated;
grant execute on function app.record_gyan_attempt(uuid, uuid, boolean, integer, jsonb), app.gyan_activity_problems(text, jsonb), app.gyan_quiz_problems(jsonb) to service_role;
