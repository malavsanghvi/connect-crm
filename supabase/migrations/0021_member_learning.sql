-- 0021_member_learning.sql
-- Prototype parity: My Jain Way and Gyan Path (member app).
--   1. practices.default_time (time of day shown in My Jain Way; null = anytime)
--   2. app.unlog_practice: undo a day's practice and the points it awarded
--   3. Gyan Path presentation fields (goal tint/mark/recommended, level chapter)
--      and the member's daily learning minutes
--   4. app.saathi_feed: the family circle's recent milestones and who needs support
--   5. app.my_practice_standing: private "top X%" per practice category
-- Additive only. No permission keys added, no existing policy changed.

-- ---------------------------------------------------------------------------
-- 1. Default time of day for a practice
-- ---------------------------------------------------------------------------
alter table app.practices add column default_time time;
comment on column app.practices.default_time is
  'Time of day shown in My Jain Way (center local time). Null = anytime, or relative to sunrise/sunset (e.g. Navkarsi).';

-- Hosted databases already carry the shared catalog from seed.sql; fill it in
-- there (no-op on a fresh database, where seed.sql sets the same values).
update app.practices p set default_time = v.t
  from (values ('navkar_waking', time '06:45'), ('darshan', time '08:30'), ('ashtaprakari', time '09:00'),
               ('samayik', time '18:00'), ('swadhyay', time '18:30'), ('pratikraman', time '19:45'),
               ('navkarvali', time '21:30'), ('gyan_path', time '20:30')) as v(key, t)
 where p.center_id is null and p.key = v.key and p.default_time is null;

-- ---------------------------------------------------------------------------
-- 2. log_practice now stamps the day on its day-complete bonus, so an undo can
--    find and reverse exactly that day's bonus. Otherwise unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.log_practice(p_center uuid, p_practice uuid, p_on date default current_date)
returns table (points_awarded int, day_complete boolean, streak_days int)
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_person uuid := app.my_person_id(p_center); v_pts int; v_selected int; v_done int; s app.streaks; v_bonus int := 0;
begin
  if v_person is null then raise exception 'not a member of this center'; end if;
  if p_on > current_date then raise exception 'cannot log a future day'; end if;
  insert into app.practice_logs (center_id, person_id, practice_id, logged_on)
    values (p_center, v_person, p_practice, p_on) on conflict do nothing;
  if not found then
    return query select 0, false, coalesce((select current_days from app.streaks where person_id = v_person and center_id = p_center), 0);
    return;
  end if;
  select points into v_pts from app.practices where id = p_practice;
  insert into app.points_ledger (center_id, person_id, points, reason, ref_id) values (p_center, v_person, v_pts, 'practice', p_practice);
  select count(*) into v_selected from app.practice_selections where person_id = v_person and center_id = p_center;
  select count(*) into v_done from app.practice_logs l join app.practice_selections ps on ps.practice_id = l.practice_id and ps.person_id = l.person_id
   where l.person_id = v_person and l.logged_on = p_on;
  insert into app.streaks (center_id, person_id) values (p_center, v_person) on conflict do nothing;
  select * into s from app.streaks where center_id = p_center and person_id = v_person for update;
  if v_selected > 0 and v_done >= v_selected and s.last_logged_on is distinct from p_on then
    v_bonus := coalesce((select (rules->'points'->>'day_complete_bonus')::int from app.centers where id = p_center), 20);
    insert into app.points_ledger (center_id, person_id, points, reason, note)
      values (p_center, v_person, v_bonus, 'practice', 'day complete bonus: ' || p_on);
    update app.streaks set
      current_days = case when s.last_logged_on = p_on - 1 then s.current_days + 1 else 1 end,
      longest_days = greatest(s.longest_days, case when s.last_logged_on = p_on - 1 then s.current_days + 1 else 1 end),
      last_logged_on = p_on
    where center_id = p_center and person_id = v_person
    returning * into s;
  end if;
  return query select v_pts + v_bonus, v_bonus > 0, s.current_days;
end $$;

-- Undo a practice for a day (a mis-tap, or a parent correcting a child's log).
-- The points ledger is append-only, so the reversal is a 'correction' entry:
--   * minus the practice's points (never more than it actually earned), and
--   * minus that day's day-complete bonus when the day is no longer complete;
--     the streak steps back one day when that day was its latest.
create or replace function app.unlog_practice(p_person uuid, p_practice uuid, p_on date default current_date)
returns table (points_reversed int, day_complete boolean, streak_days int)
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_pts int; v_net int; v_bonus int := 0; v_selected int; v_done int; s app.streaks; v_rev int := 0;
begin
  select center_id into v_center from app.people where id = p_person;
  if v_center is null or not app.can_act_for_person(v_center, p_person) then
    raise exception 'you can only change your own practices or your child''s';
  end if;
  delete from app.practice_logs where person_id = p_person and practice_id = p_practice and logged_on = p_on;
  if not found then
    return query select 0, false, coalesce((select st.current_days from app.streaks st where st.person_id = p_person and st.center_id = v_center), 0);
    return;
  end if;

  -- The practice's own points, capped at what this practice has net earned.
  select points into v_pts from app.practices where id = p_practice;
  select coalesce(sum(points), 0) into v_net from app.points_ledger
   where person_id = p_person and ref_id = p_practice and reason in ('practice', 'correction');
  v_pts := least(coalesce(v_pts, 0), greatest(v_net, 0));
  if v_pts > 0 then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id, note)
      values (v_center, p_person, -v_pts, 'correction', p_practice, 'practice unlogged: ' || p_on);
    v_rev := v_pts;
  end if;

  -- Is the day still complete?
  select count(*) into v_selected from app.practice_selections where person_id = p_person and center_id = v_center;
  select count(*) into v_done from app.practice_logs l join app.practice_selections ps on ps.practice_id = l.practice_id and ps.person_id = l.person_id
   where l.person_id = p_person and l.logged_on = p_on;
  select * into s from app.streaks where center_id = v_center and person_id = p_person for update;

  if not (v_selected > 0 and v_done >= v_selected) then
    -- Net bonus still standing for that day (bonus rows are stamped with the day).
    select coalesce(sum(points), 0) into v_bonus from app.points_ledger
     where person_id = p_person and reason in ('practice', 'correction')
       and note in ('day complete bonus: ' || p_on, 'day complete bonus reversed: ' || p_on);
    -- Bonuses logged before the day was stamped: trust the streak's latest day.
    if v_bonus = 0 and s.last_logged_on = p_on and not exists (
         select 1 from app.points_ledger where person_id = p_person and note = 'day complete bonus reversed: ' || p_on) then
      v_bonus := coalesce((select (rules->'points'->>'day_complete_bonus')::int from app.centers where id = v_center), 20);
    end if;
    if v_bonus > 0 then
      insert into app.points_ledger (center_id, person_id, points, reason, note)
        values (v_center, p_person, -v_bonus, 'correction', 'day complete bonus reversed: ' || p_on);
      v_rev := v_rev + v_bonus;
    end if;
    if s.last_logged_on = p_on then
      update app.streaks set
        longest_days = case when s.longest_days = s.current_days then greatest(s.longest_days - 1, 0) else s.longest_days end,
        current_days = greatest(s.current_days - 1, 0),
        last_logged_on = case when s.current_days > 1 then p_on - 1 end
      where center_id = v_center and person_id = p_person
      returning * into s;
    end if;
  end if;
  return query select v_rev, (v_selected > 0 and v_done >= v_selected), coalesce(s.current_days, 0);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Gyan Path presentation fields
-- ---------------------------------------------------------------------------
alter table app.gyan_goals add column recommended boolean not null default false;
alter table app.gyan_goals add column tint text check (tint ~ '^#[0-9A-Fa-f]{6}$');
alter table app.gyan_goals add column mark text check (char_length(mark) between 1 and 2);
-- (gyan_goals.description already exists since 0007.)
alter table app.gyan_levels add column chapter text;
alter table app.people add column gyan_daily_minutes integer check (gyan_daily_minutes in (5, 10, 15));
comment on column app.people.gyan_daily_minutes is 'Gyan Path daily goal chosen by the member (5, 10 or 15 minutes); null = not chosen.';

-- Hosted databases: fill the shared goals from the prototype catalog (no-op on a fresh database).
update app.gyan_goals g set tint = v.tint, mark = v.mark, recommended = v.rec
  from (values ('samayik', '#1B2C5C', 'S', true), ('navkar', '#C9731C', 'N', false),
               ('logassa', '#5B4B8A', 'L', false), ('pratikraman', '#7A2E1F', 'P', false)) as v(key, tint, mark, rec)
 where g.center_id is null and g.key = v.key and g.tint is null;
update app.gyan_levels l set chapter = v.chapter
  from app.gyan_goals g, (values
    ('samayik', 1, 4, 'Chapter 1 · Foundations'), ('samayik', 5, 9, 'Chapter 2 · Sutras of Samayik'), ('samayik', 10, 99, 'Chapter 3 · Perform Samayik'),
    ('navkar', 1, 5, 'Chapter 1 · Five Parameshthis'), ('navkar', 6, 99, 'Chapter 2 · The Chulika'),
    ('logassa', 1, 6, 'Chapter 1 · The 24 Tirthankars'), ('logassa', 7, 99, 'Chapter 2 · Recite Logassa'),
    ('pratikraman', 1, 5, 'Chapter 1 · Why Pratikraman'), ('pratikraman', 6, 11, 'Chapter 2 · The six Avashyaks'), ('pratikraman', 12, 99, 'Chapter 3 · Perform')
  ) as v(goal, lo, hi, chapter)
 where g.id = l.goal_id and g.center_id is null and g.key = v.goal and l.sort_order between v.lo and v.hi and l.chapter is null;

-- ---------------------------------------------------------------------------
-- 4. Saathi feed: the caller's family circle (their household, for now).
--    kind: goal_completed | daily_goal_met | behind. Last 14 days. People who
--    turned Saathi off, or chose not to share with family, are left out.
--    anumodana_count = cheers the person received since the item happened;
--    i_sent = the caller is one of them.
-- ---------------------------------------------------------------------------
create or replace function app.saathi_feed(p_household uuid)
returns table (kind text, person_id uuid, person_name text, title text, detail text, occurred_at timestamptz,
               anumodana_count int, i_sent boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_center uuid; v_me uuid; v_behind int;
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null or not app.in_my_household(v_center, p_household) then
    raise exception 'Saathi works within your family circle';
  end if;
  v_me := app.my_person_id(v_center);
  v_behind := coalesce((select (rules->'points'->>'behind_after_days')::int from app.centers where id = v_center), 3);
  return query
  with circle as (
    select p.id, coalesce(p.preferred_name, p.first_name) as name
      from app.household_members hm join app.people p on p.id = hm.person_id
     where hm.household_id = p_household and hm.left_at is null and p.id is distinct from v_me
       and not p.is_deceased and p.merged_into_id is null
       and coalesce((select ss.opted_in and ss.share_with_family from app.saathi_settings ss
                      where ss.center_id = v_center and ss.person_id = p.id), true)
  ),
  goals_done as (   -- every step of every level of a goal completed; finished in the window
    select c.id as pid, c.name, g.name as goal_name, max(gp.completed_at) as at, count(distinct l.id)::int as levels
      from circle c
      join app.gyan_progress gp on gp.person_id = c.id and gp.completed_at is not null
      join app.gyan_steps st on st.id = gp.step_id
      join app.gyan_levels l on l.id = st.level_id
      join app.gyan_goals g on g.id = l.goal_id
     group by c.id, c.name, g.id, g.name
    having count(distinct gp.step_id) = (select count(*) from app.gyan_steps s2 join app.gyan_levels l2 on l2.id = s2.level_id where l2.goal_id = g.id)
       and max(gp.completed_at) >= now() - interval '14 days'
  ),
  days_met as (     -- every selected practice logged that day
    select c.id as pid, c.name, l.logged_on, max(l.created_at) as at, count(*)::int as n
      from circle c
      join app.practice_logs l on l.person_id = c.id and l.logged_on >= current_date - 13
      join app.practice_selections ps on ps.person_id = l.person_id and ps.practice_id = l.practice_id
     group by c.id, c.name, l.logged_on
    having count(*) >= (select count(*) from app.practice_selections ps2 where ps2.person_id = c.id)
  ),
  behind as (       -- practising members with no log for >= behind_after_days
    select c.id as pid, c.name,
           (select max(l.logged_on) from app.practice_logs l where l.person_id = c.id) as last_on,
           (select min(ps.selected_at) from app.practice_selections ps where ps.person_id = c.id) as since
      from circle c
     where exists (select 1 from app.practice_selections ps where ps.person_id = c.id)
  ),
  items as (
    select 'goal_completed'::text as kind, pid, name, 'Completed ' || goal_name as title,
           levels || ' levels' as detail, at
      from goals_done
    union all
    select 'daily_goal_met', pid, name, 'Completed today''s practices',
           n || case when n = 1 then ' practice' else ' practices' end
             || coalesce(' · ' || (select st.current_days from app.streaks st where st.person_id = pid and st.last_logged_on = logged_on
                                    and st.current_days > 1) || '-day streak', ''),
           at
      from days_met
    union all
    select 'behind', pid, name, 'Could use some encouragement',
           'No practice logged for ' || (current_date - coalesce(last_on, since::date)) || ' days',
           coalesce((last_on + 1)::timestamptz, since)
      from behind
     where current_date - coalesce(last_on, since::date) >= v_behind
  )
  select i.kind, i.pid, i.name, i.title, i.detail, i.at,
         (select count(*)::int from app.anumodana a where a.to_person_id = i.pid and a.created_at >= i.at),
         exists (select 1 from app.anumodana a where a.to_person_id = i.pid and a.from_person_id = v_me and a.created_at >= i.at)
    from items i
   order by i.at desc;
end $$;

-- ---------------------------------------------------------------------------
-- 5. My practice standing (private to the person and their parents).
--    Per category, this month: the person's rank by practice points among the
--    center's people who logged anything in that category, as "top X%".
--    Suppressed (null) when fewer than 10 people are in the category, or when
--    the person has no points there yet.
-- ---------------------------------------------------------------------------
create or replace function app.my_practice_standing(p_person uuid)
returns table (category text, top_percent int, practices_count int, done_today int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_center uuid; v_from date := date_trunc('month', current_date)::date;
begin
  select center_id into v_center from app.people where id = p_person;
  if v_center is null or not app.can_act_for_person(v_center, p_person) then
    raise exception 'your standing is private to you';
  end if;
  return query
  with totals as (
    select pr.category, l.person_id, sum(pr.points)::int as pts
      from app.practice_logs l join app.practices pr on pr.id = l.practice_id
     where l.center_id = v_center and l.logged_on between v_from and current_date
     group by pr.category, l.person_id
  ),
  cats as (
    select pr.category from app.practice_selections ps join app.practices pr on pr.id = ps.practice_id where ps.person_id = p_person
    union
    select t.category from totals t where t.person_id = p_person
  )
  select c.category,
         case when (select count(*) from totals t where t.category = c.category) < 10 then null
              when coalesce((select t.pts from totals t where t.category = c.category and t.person_id = p_person), 0) <= 0 then null
              else greatest(1, ceil(100.0 * (1 + (select count(*) from totals t where t.category = c.category
                                                      and t.pts > (select t2.pts from totals t2 where t2.category = c.category and t2.person_id = p_person)))
                                    / (select count(*) from totals t where t.category = c.category)))::int
         end,
         (select count(*)::int from app.practice_selections ps join app.practices pr on pr.id = ps.practice_id
           where ps.person_id = p_person and pr.category = c.category),
         (select count(*)::int from app.practice_logs l join app.practices pr on pr.id = l.practice_id
           where l.person_id = p_person and l.logged_on = current_date and pr.category = c.category)
    from cats c
   order by c.category;
end $$;

revoke execute on function app.unlog_practice(uuid, uuid, date), app.saathi_feed(uuid), app.my_practice_standing(uuid) from public, anon;
grant execute on function app.unlog_practice(uuid, uuid, date), app.saathi_feed(uuid), app.my_practice_standing(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
