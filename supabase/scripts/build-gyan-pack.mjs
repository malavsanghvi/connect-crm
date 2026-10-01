#!/usr/bin/env node
// Builds supabase/migrations/0571_gyan_content_pack.sql from the content pack JSON (the content workstream's
// verified file, kept at supabase/content/gyan_pack_0571.json with its sources and review notes). No hand-escaping:
// the pack's goals go into the migration as one dollar-quoted jsonb literal; `sources` and `notes` are documentation
// and stay in the JSON file only.
//   node supabase/scripts/build-gyan-pack.mjs supabase/content/gyan_pack_0571.json [out.sql]
//
// Pack shape: { goals: [ { goal_key, goal_name, new, tradition, description?, sort_order?, tint?, mark?, recommended?,
//   levels: [ { level_key, level_name, chapter?, points?, treasure?, treasure_points?, requires_teacher_signoff?,
//   steps: [ { kind, title, points, repeat_points, activity, quiz? } ] } ] } ], sources?, notes? }
//
// Points must follow the shared spec's table (SPEC_POINTS below); a step that differs stops the build, so a change
// the owner decides is made here on purpose, not slipped in through the file:
//   read 5 · quiz 10 · practice 10 · hotspot learn 10 · hotspot practice 10 + 3 a try · voice 15 + 3 a try.
// Every step must be marked as needing Pathshala review (activity.review = "needs_pathshala_review").
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , input, outArg] = process.argv;
if (!input) {
  console.error('usage: node supabase/scripts/build-gyan-pack.mjs <pack.json> [out.sql]');
  process.exit(2);
}
const out = outArg ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0571_gyan_content_pack.sql');
const pack = JSON.parse(readFileSync(input, 'utf8'));

const KINDS = new Set(['read', 'listen', 'recite', 'quiz', 'video', 'practice', 'hotspot', 'voice']);
const TRADITIONS = new Set(['shvetambar_murtipujak', 'sthanakvasi', 'terapanthi', 'digambar', 'other']);
const problems = [];
const fail = (msg) => problems.push(msg);

// [points, repeat_points] by kind (and a hotspot's mode).
const SPEC_POINTS = { read: [5, 0], quiz: [10, 0], practice: [10, 0], 'hotspot:learn': [10, 0], 'hotspot:practice': [10, 3], voice: [15, 3] };
function specPoints(step) {
  const key = step.kind === 'hotspot' ? `hotspot:${step.activity?.mode}` : step.kind;
  return SPEC_POINTS[key] ?? [step.points ?? 0, step.repeat_points ?? 0];
}

if (!Array.isArray(pack.goals) || pack.goals.length === 0) fail('the pack has no goals');
const goalKeys = new Set();
let steps = 0;
for (const g of pack.goals ?? []) {
  const gk = g.goal_key;
  if (typeof gk !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(gk)) { fail(`goal key ${JSON.stringify(gk)} is not a lower-case key`); continue; }
  if (goalKeys.has(gk)) fail(`goal ${gk} appears twice`);
  goalKeys.add(gk);
  if (typeof g.goal_name !== 'string' || !g.goal_name.trim()) fail(`goal ${gk} has no name`);
  if (g.tradition != null && !TRADITIONS.has(g.tradition)) fail(`goal ${gk}: unknown tradition ${g.tradition}`);
  if (g.new && g.tint != null && !/^#[0-9A-Fa-f]{6}$/.test(g.tint)) fail(`goal ${gk}: tint must be #RRGGBB`);
  if (g.new && g.mark != null && !(typeof g.mark === 'string' && [...g.mark].length >= 1 && [...g.mark].length <= 2)) fail(`goal ${gk}: mark must be 1 or 2 characters`);
  if (!Array.isArray(g.levels) || g.levels.length === 0) { fail(`goal ${gk} has no levels`); continue; }
  const levelKeys = new Set();
  for (const l of g.levels) {
    const where = `${gk} level ${l.level_key}`;
    if (typeof l.level_key !== 'string' || !l.level_key.trim()) { fail(`${gk}: a level has no key`); continue; }
    if (levelKeys.has(l.level_key)) fail(`${where} appears twice`);
    levelKeys.add(l.level_key);
    if (typeof l.level_name !== 'string' || !l.level_name.trim()) fail(`${where} has no name`);
    for (const k of ['points', 'treasure_points']) {
      if (l[k] != null && !(Number.isInteger(l[k]) && l[k] >= 0 && l[k] <= 10000)) fail(`${where}: ${k} must be a whole number`);
    }
    if (!Array.isArray(l.steps) || l.steps.length === 0) { fail(`${where} has no steps`); continue; }
    l.steps.forEach((s, i) => {
      const at = `${where} step ${i + 1}`;
      if (!KINDS.has(s.kind)) fail(`${at}: unknown kind ${s.kind}`);
      if (typeof s.title !== 'string' || !s.title.trim()) fail(`${at} has no title`);
      if (s.activity == null) s.activity = {};
      if (typeof s.activity !== 'object' || Array.isArray(s.activity)) fail(`${at}: activity must be an object`);
      if (s.activity.review !== 'needs_pathshala_review') fail(`${at}: activity.review must be "needs_pathshala_review"`);
      if (s.kind === 'quiz' && !(s.quiz && Array.isArray(s.quiz.questions) && s.quiz.questions.length)) fail(`${at}: a quiz step needs quiz.questions`);
      if (s.kind !== 'quiz' && s.quiz != null) fail(`${at}: only quiz steps carry a quiz`);
      const [p, r] = specPoints(s);
      if (s.points !== p || (s.repeat_points ?? 0) !== r) {
        fail(`${at} (${s.kind}): points ${s.points ?? '-'} + ${s.repeat_points ?? '-'} a try, the spec says ${p} + ${r} (change SPEC_POINTS if the owner decided otherwise)`);
      }
      s.repeat_points ??= 0;
      steps++;
    });
  }
}
if (problems.length) {
  console.error(`The pack cannot be built:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const TAG = '$gyan_pack_0571$';
const json = JSON.stringify({ goals: pack.goals }, null, 1);
if (json.includes(TAG) || json.includes('$gyan_pack_fn$')) {
  console.error(`The pack contains the dollar-quote tag ${TAG}; pick another tag.`);
  process.exit(1);
}

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const summary = pack.goals.map((g) => `${g.goal_key} (${plural(g.levels.length, 'level')}, ${plural(g.levels.reduce((n, l) => n + l.steps.length, 0), 'step')}${g.new ? ', new' : ''})`).join(', ');
const sql = `-- 0571_gyan_content_pack.sql: the Gyan Path content pack in the SHARED platform library (center_id null).
-- GENERATED by supabase/scripts/build-gyan-pack.mjs from supabase/content/gyan_pack_0571.json (the content workstream's
-- verified pack; its sources and review notes are kept there); do not edit by hand.
-- Contents: ${summary}; ${steps} steps in all.
--
-- What it does (app.apply_gyan_content_pack, idempotent):
--   * goals: an existing shared goal is matched by key (Samayik and Navkar come from seed.sql); a goal marked "new"
--     (the Navang puja of Mahavir Swami) is created when it is missing. Nothing about an existing goal is changed.
--   * levels: matched by key, then by name, as seed.sql made them; a missing level is created. An existing level only
--     gets the pack's treasure_points, and only while it has none (a value someone set is kept).
--   * steps: each pack step has a fixed id (md5 of goal, level and position), inserted with ON CONFLICT DO NOTHING:
--     running it again adds nothing, a pack step someone edited keeps their edit, and steps anyone else created
--     are never touched or deleted.
-- A brand-new database applies the migrations BEFORE seed.sql, so the shared goals do not exist yet here: the call
-- below then adds only what is new (the puja goal) and seed.sql calls the function again at its end.
-- Points follow the shared spec: read 5, quiz 10, practice 10, hotspot learn 10, hotspot practice 10 + 3 a try,
-- voice 15 + 3 a try; levels keep 20; badge levels carry 50 treasure points. Every lesson is marked
-- activity.review = "needs_pathshala_review" (doctrinal care: the Pathshala reviews before it is relied on).
set client_min_messages = warning;

-- The pack's goals, levels and steps exactly as in the JSON file (its sources and notes stay in the file).
create or replace function app.gyan_content_pack() returns jsonb
language sql immutable set search_path = app, public, extensions as $gyan_pack_fn$
select ${TAG}
${json}
${TAG}::jsonb
$gyan_pack_fn$;

-- The fixed id of a pack step.
create or replace function app.gyan_pack_step_id(p_goal text, p_level text, p_position integer) returns uuid
language sql immutable set search_path = app, public, extensions as $$
  select md5('gyan_pack_0571:' || p_goal || ':' || p_level || ':' || p_position)::uuid
$$;

create or replace function app.apply_gyan_content_pack() returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_pack jsonb := app.gyan_content_pack();
  g jsonb; l jsonb; s jsonb; v_lord bigint; v_sord bigint;
  v_goal uuid; v_level uuid; v_tp int;
  n_goals int := 0; n_levels int := 0; n_steps int := 0; n_treasure int := 0; v_missing text[] := '{}';
begin
  perform set_config('app.audit_reason', 'Gyan Path content pack (0571)', true);
  for g in select x from jsonb_array_elements(v_pack->'goals') x loop
    v_goal := null;
    select id into v_goal from app.gyan_goals where center_id is null and key = g->>'goal_key' order by sort_order, id limit 1;
    if v_goal is null then
      if not coalesce((g->>'new')::boolean, false) then
        v_missing := v_missing || (g->>'goal_key');
        continue;
      end if;
      insert into app.gyan_goals (center_id, tradition, key, name, description, sort_order, tint, mark, recommended)
        values (null, (g->>'tradition')::app.tradition, g->>'goal_key', g->>'goal_name', g->>'description',
                coalesce((g->>'sort_order')::int, 0), g->>'tint', g->>'mark', coalesce((g->>'recommended')::boolean, false))
        returning id into v_goal;
      n_goals := n_goals + 1;
    end if;

    for l, v_lord in select x, o from jsonb_array_elements(g->'levels') with ordinality as t(x, o) loop
      v_level := null;
      select id into v_level from app.gyan_levels where goal_id = v_goal and key = l->>'level_key';
      if v_level is null then
        select id into v_level from app.gyan_levels where goal_id = v_goal and lower(btrim(name)) = lower(btrim(l->>'level_name'))
         order by sort_order, id limit 1;
      end if;
      v_tp := coalesce((l->>'treasure_points')::int, 0);
      if v_level is null then
        insert into app.gyan_levels (goal_id, key, name, sort_order, points, chapter, treasure, treasure_points, requires_teacher_signoff)
          values (v_goal, l->>'level_key', l->>'level_name', coalesce((l->>'sort_order')::int, v_lord::int), coalesce((l->>'points')::int, 20),
                  l->>'chapter', l->>'treasure', v_tp, coalesce((l->>'requires_teacher_signoff')::boolean, false))
          returning id into v_level;
        n_levels := n_levels + 1;
      elsif v_tp > 0 then
        update app.gyan_levels set treasure_points = v_tp where id = v_level and treasure_points = 0;
        if found then n_treasure := n_treasure + 1; end if;
      end if;

      for s, v_sord in select x, o from jsonb_array_elements(l->'steps') with ordinality as t(x, o) loop
        insert into app.gyan_steps (id, level_id, kind, title, sort_order, points, repeat_points, activity, quiz)
          values (app.gyan_pack_step_id(g->>'goal_key', l->>'level_key', v_sord::int), v_level, s->>'kind', s->>'title', v_sord::int,
                  coalesce((s->>'points')::int, 0), coalesce((s->>'repeat_points')::int, 0), coalesce(s->'activity', '{}'::jsonb),
                  case when jsonb_typeof(s->'quiz') = 'object' then s->'quiz' end)
          on conflict (id) do nothing;
        if found then n_steps := n_steps + 1; end if;
      end loop;
    end loop;
  end loop;
  return jsonb_build_object('goals_added', n_goals, 'levels_added', n_levels, 'steps_added', n_steps,
                            'treasure_points_set', n_treasure, 'goals_not_here_yet', to_jsonb(v_missing));
end $$;

comment on function app.gyan_content_pack() is
  'The Gyan Path content pack of 0571 (goals, levels, steps) from supabase/content/gyan_pack_0571.json, as built by supabase/scripts/build-gyan-pack.mjs.';
comment on function app.apply_gyan_content_pack() is
  'Platform only: put the 0571 content pack into the shared library. Idempotent; never changes or deletes a step it did not add, never overwrites a level''s treasure points. Returns what it added. seed.sql calls it again on a new database.';

revoke execute on function app.gyan_content_pack(), app.gyan_pack_step_id(text, text, integer), app.apply_gyan_content_pack()
  from public, anon, authenticated;
grant execute on function app.gyan_content_pack(), app.gyan_pack_step_id(text, text, integer), app.apply_gyan_content_pack() to service_role;

select app.apply_gyan_content_pack();
`;
writeFileSync(out, sql);
console.log(`wrote ${out}: ${pack.goals.length} goals, ${steps} steps (${(sql.length / 1024).toFixed(0)} KB)`);

