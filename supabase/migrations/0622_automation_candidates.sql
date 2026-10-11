-- 0622 · Automation ideas (backlog B91): the miner that turns repeated sequences into candidates.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Every day, for each community whose recording is on, app.activity_mine reads the last 60 days of ACTION events and
--   looks for the same short sequence of actions done again and again by people in the same role:
--     * an event stream per person and role is cut into SESSIONS wherever 30 minutes pass with nothing done, and into
--       runs wherever 10 minutes pass (a sequence is steps done one after the other, not a morning's work);
--     * a sequence is 2 to 5 actions in a row with at least two different actions (one action repeated is not a sequence);
--       screens do not count, cancelled steps do not count;
--     * it is a candidate when it happened at least 5 times, in at least 2 different sessions;
--     * a shorter sequence that only ever happens inside a longer one with the same count is left out (A>B>C is reported,
--       not also A>B and B>C);
--     * score = (times per month) x (minutes one run takes) x (how regular it is MINUS its error rate). So it is minutes a
--       month, discounted when it is bursty or often fails. Each step is taken to need at least 10 seconds. How regular:
--       1 / (1 + the spread of the gaps between the days it happened), 0.3 when there are fewer than three such days.
--   and proposes what to build (a first guess a person confirms): scheduled_job (very regular), niva_command (every step
--   already has a command), default (create, then adjust: a default value would do), playbook (three or more people do
--   it), routine (a routine step).
--
--   NO ACTOR IDS: a candidate holds the role, the keys, counts and times. How many people (distinct_actors) is a count.
--
--   THE MINER RECOMPUTES, IT DOES NOT ONLY ADD. Each run rebuilds the list from the events that are left:
--     * a NEW idea that is no longer found (fewer than 5 times, or in fewer than 2 sessions, because events were
--       deleted: an opt-out, the sweep of someone no longer allowed, retention) is deleted;
--     * a NEW idea that was shown (from 3 or more people) and now comes from fewer is deleted; one that was never shown
--       stays stored but hidden;
--     * an idea somebody ACCEPTED, DISMISSED or marked BUILT keeps that decision, its keys and its role, but its numbers
--       are set to zero once it is no longer found or comes from fewer than 3 people;
--     * opting out (and the sweep) marks the ideas of the communities concerned STALE: hidden from administrators until
--       the next run has recomputed them.
--
--   WHO SEES IT
--     automation_candidates: people with settings.manage in that community see an idea only if it is not stale and comes
--     from at least app.activity_min_actors() (3) people (or has been decided, which can only have happened after it was
--     shown); platform admins see all. They can change only status (new | accepted | dismissed | built), and the
--     database stamps who decided and when. The miner never overwrites a decision.
--   app.activity_mine(center, days)       platform admin ("run now") or the background service
--   app.worker_activity_centers()         connect_worker only: the communities whose recording is on
--   app.worker_mine_activity(center)      connect_worker only: mine one community (the worker calls it once per community,
--                                         so one slow or failing community stops nobody else)

create table if not exists app.automation_candidates (
  id                uuid primary key default gen_random_uuid(),
  center_id         uuid not null references app.centers(id) on delete cascade,
  role_key          text not null check (char_length(role_key) between 1 and 60),
  pattern           text[] not null check (cardinality(pattern) between 2 and 5),
  pattern_hash      text not null,
  support           integer not null check (support >= 0),
  distinct_actors   integer not null default 0 check (distinct_actors >= 0),
  sessions          integer not null default 0 check (sessions >= 0),
  median_seconds    integer not null default 0 check (median_seconds >= 0),
  minutes_per_month numeric(10, 1) not null default 0,
  error_rate        numeric(5, 4) not null default 0 check (error_rate between 0 and 1),
  regularity        numeric(5, 4) not null default 0 check (regularity between 0 and 1),
  score             numeric(12, 2) not null default 0,
  suggested_kind    text not null default 'routine' check (suggested_kind in ('routine', 'niva_command', 'playbook', 'scheduled_job', 'default')),
  status            text not null default 'new' check (status in ('new', 'accepted', 'dismissed', 'built')),
  stale             boolean not null default false,
  decided_by        uuid references auth.users(id) on delete set null,
  decided_at        timestamptz,
  first_seen        timestamptz not null,
  last_seen         timestamptz not null,
  created_at        timestamptz not null default now(),
  unique (center_id, role_key, pattern_hash)
);
create index if not exists automation_candidates_center_idx on app.automation_candidates (center_id, status, score desc);
comment on table app.automation_candidates is
  'Repeated sequences of actions found by app.activity_mine (0622): per community and role, 2 to 5 action keys, how often, by how many people, how long, how reliable, a score in minutes a month and a suggested way to automate it. No actor ids. Recomputed every run. Shown to administrators only from 3 people and when not stale. People with settings.manage change only status (the database stamps decided_by and decided_at).';
comment on column app.automation_candidates.pattern_hash is 'md5 of the keys joined with ">" (the unique key with the community and the role).';
comment on column app.automation_candidates.sessions is 'In how many different work sessions (30 minutes idle apart) it happened.';
comment on column app.automation_candidates.median_seconds is 'The middle time one run takes, first step to the end of the last, at least 10 seconds a step.';
comment on column app.automation_candidates.stale is 'Events behind this idea were deleted (an opt-out, the sweep) and the miner has not run since: hidden from administrators until it has recomputed the list.';

insert into app.module_tables (table_name, module_key) values ('automation_candidates', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- Audited like every other table, but only when it is CREATED, DECIDED or deleted: the miner rewrites the counts every day,
-- and a row for each rewrite would bury the decisions.
drop trigger if exists audit_automation_candidates on app.automation_candidates;
create trigger audit_automation_candidates after insert or delete or update of status, decided_by, decided_at on app.automation_candidates
  for each row execute function app.audit_row();

-- The database stamps the decision: who and when, whatever the caller sends. A status put back to 'new' clears it.
create or replace function app.automation_candidates_decide() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then return new; end if;   -- the miner and the database owner
  if new.status is distinct from old.status then
    if new.status = 'new' then
      new.decided_by := null; new.decided_at := null;
    else
      new.decided_by := auth.uid(); new.decided_at := now();
    end if;
  else
    new.decided_by := old.decided_by; new.decided_at := old.decided_at;
  end if;
  return new;
end $$;
drop trigger if exists automation_candidates_decide on app.automation_candidates;
create trigger automation_candidates_decide before update on app.automation_candidates
  for each row execute function app.automation_candidates_decide();

alter table app.automation_candidates enable row level security;
drop policy if exists automation_candidates_read on app.automation_candidates;
create policy automation_candidates_read on app.automation_candidates for select to authenticated
  using (app.is_platform_admin()
         or (app.has_permission(center_id, 'settings.manage') and not stale
             and (distinct_actors >= app.activity_min_actors() or status <> 'new')));
drop policy if exists automation_candidates_decide on app.automation_candidates;
create policy automation_candidates_decide on app.automation_candidates for update to authenticated
  using (app.is_platform_admin()
         or (app.has_permission(center_id, 'settings.manage') and not stale
             and (distinct_actors >= app.activity_min_actors() or status <> 'new')))
  with check (app.has_permission(center_id, 'settings.manage') or app.is_platform_admin());
revoke all on app.automation_candidates from public, anon, authenticated, service_role, connect_worker;
grant select on app.automation_candidates to authenticated;
grant update (status, decided_by, decided_at) on app.automation_candidates to authenticated;

-- ── The miner ────────────────────────────────────────────────────────────────
create or replace function app.activity_mine(p_center uuid, p_days integer default 60) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 60), 7), 400);
  v_worker boolean := coalesce(nullif(current_setting('role', true), 'none'), session_user::text) = 'connect_worker';
  v_floor integer := app.activity_min_actors();
  v_first timestamptz;
  v_obs numeric;
  v_n integer := 0;
begin
  if not (v_worker or app.is_platform_admin()) then
    raise exception 'Only the background service or the Weaver team can do this.' using errcode = 'insufficient_privilege';
  end if;
  if p_center is null then return 0; end if;

  -- The days of history there really are (at least 7, at most the window), so a community that started recording last
  -- week is not rated as if it had 60 days. With no events at all the list below is simply recomputed to nothing.
  select min(e.occurred_at) into v_first from app.activity_events e
   where e.center_id = p_center and e.kind = 'action' and e.occurred_at >= now() - make_interval(days => v_days);
  v_obs := case when v_first is null then 7
                else greatest(7, least(v_days, ceil(extract(epoch from (now() - v_first)) / 86400.0))) end;

  -- What the events say now.
  drop table if exists pg_temp.activity_mine_found;
  create temporary table activity_mine_found (
    role_key text not null, pattern text[] not null, pattern_hash text not null, support integer not null,
    actors integer not null, sessions integer not null, median_seconds integer not null, mpm numeric not null,
    err_rate numeric not null, regularity numeric not null, score numeric not null, suggested_kind text not null,
    first_seen timestamptz not null, last_seen timestamptz not null
  ) on commit drop;

  with ev as (
    select e.actor_hash, e.occurred_at, e.id, e.key, e.outcome, e.duration_ms,
           case when e.surface = 'member' then array['member']::text[]
                when cardinality(e.role_keys) = 0 then array['staff']::text[]
                else e.role_keys end as roles
      from app.activity_events e
     where e.center_id = p_center and e.kind = 'action' and e.outcome <> 'cancelled'
       and e.occurred_at >= now() - make_interval(days => v_days)
  ), per_role as (
    select ev.actor_hash, ev.occurred_at, ev.id, ev.key, ev.outcome, ev.duration_ms, r.role_key
      from ev cross join lateral unnest(ev.roles) as r(role_key)
  ), gaps as (
    select pr.*, lag(pr.occurred_at) over w as prev_at
      from per_role pr
    window w as (partition by pr.role_key, pr.actor_hash order by pr.occurred_at, pr.id)
  ), numbered as (
    select g.*,
           sum(case when g.prev_at is null or g.occurred_at - g.prev_at > interval '30 minutes' then 1 else 0 end)
             over (partition by g.role_key, g.actor_hash order by g.occurred_at, g.id) as sess,
           sum(case when g.prev_at is null or g.occurred_at - g.prev_at > interval '10 minutes' then 1 else 0 end)
             over (partition by g.role_key, g.actor_hash order by g.occurred_at, g.id) as run
      from gaps g
  ), seqs as (
    select n.role_key, n.actor_hash, n.sess, n.occurred_at, n.key, n.outcome,
           lead(n.key, 1) over w2 as k2, lead(n.key, 2) over w2 as k3, lead(n.key, 3) over w2 as k4, lead(n.key, 4) over w2 as k5,
           lead(n.outcome, 1) over w2 as o2, lead(n.outcome, 2) over w2 as o3, lead(n.outcome, 3) over w2 as o4, lead(n.outcome, 4) over w2 as o5,
           lead(n.occurred_at, 1) over w2 as t2, lead(n.occurred_at, 2) over w2 as t3, lead(n.occurred_at, 3) over w2 as t4, lead(n.occurred_at, 4) over w2 as t5,
           lead(n.duration_ms, 1) over w2 as d2, lead(n.duration_ms, 2) over w2 as d3, lead(n.duration_ms, 3) over w2 as d4, lead(n.duration_ms, 4) over w2 as d5
      from numbered n
    window w2 as (partition by n.role_key, n.actor_hash, n.run order by n.occurred_at, n.id)
  ), grams as (
    select s.role_key, s.actor_hash, s.sess, s.occurred_at as t_start, g.len,
           case g.len when 2 then array[s.key, s.k2]
                      when 3 then array[s.key, s.k2, s.k3]
                      when 4 then array[s.key, s.k2, s.k3, s.k4]
                      else array[s.key, s.k2, s.k3, s.k4, s.k5] end as pattern,
           case g.len when 2 then s.t2 when 3 then s.t3 when 4 then s.t4 else s.t5 end as t_end,
           case g.len when 2 then s.d2 when 3 then s.d3 when 4 then s.d4 else s.d5 end as d_last,
           (s.outcome = 'error' or s.o2 = 'error' or (g.len >= 3 and s.o3 = 'error')
            or (g.len >= 4 and s.o4 = 'error') or (g.len >= 5 and s.o5 = 'error')) as has_error
      from seqs s cross join (values (2), (3), (4), (5)) as g(len)
     where case g.len when 2 then s.k2 when 3 then s.k3 when 4 then s.k4 else s.k5 end is not null
  ), occ as (
    select gr.role_key, gr.pattern, gr.len, gr.actor_hash, gr.sess, gr.t_start, gr.has_error,
           greatest(extract(epoch from (gr.t_end - gr.t_start)) + coalesce(gr.d_last, 0) / 1000.0, 10.0 * gr.len) as secs
      from grams gr
     where (select count(distinct x.k) from unnest(gr.pattern) as x(k)) >= 2
  ), agg as (
    select o.role_key, o.pattern, o.len,
           count(*) as support,
           count(distinct o.actor_hash || ':' || o.sess::text) as sessions,
           count(distinct o.actor_hash) as actors,
           (percentile_cont(0.5) within group (order by o.secs::double precision))::numeric as med_secs,
           avg(case when o.has_error then 1.0 else 0.0 end) as err_rate,
           min(o.t_start) as first_seen, max(o.t_start) as last_seen
      from occ o
     group by o.role_key, o.pattern, o.len
    having count(*) >= 5 and count(distinct o.actor_hash || ':' || o.sess::text) >= 2
  ), kept as (
    -- Drop a sequence that only ever happens inside a longer one reported with the same count.
    select a.* from agg a
     where not exists (select 1 from agg b
                        where b.role_key = a.role_key and b.len = a.len + 1 and b.support = a.support
                          and (b.pattern[1:a.len] = a.pattern or b.pattern[2:b.len] = a.pattern))
  ), active_days as (
    select distinct o.role_key, o.pattern, (o.t_start at time zone 'UTC')::date as d
      from occ o join kept k on k.role_key = o.role_key and k.pattern = o.pattern
  ), day_gaps as (
    select ad.role_key, ad.pattern,
           ad.d - lag(ad.d) over (partition by ad.role_key, ad.pattern order by ad.d) as gap
      from active_days ad
  ), reg as (
    select dg.role_key, dg.pattern,
           case when count(dg.gap) < 2 then 0.3
                else greatest(0.1, least(1.0, 1.0 / (1.0 + coalesce(stddev_pop(dg.gap::numeric) / nullif(avg(dg.gap::numeric), 0), 0)))) end as regularity
      from day_gaps dg
     group by dg.role_key, dg.pattern
  ), scored as (
    select k.role_key, k.pattern, k.support, k.sessions, k.actors, k.first_seen, k.last_seen, k.len,
           round(k.med_secs)::integer as median_seconds,
           k.err_rate, r.regularity,
           (k.support * 30.0 / v_obs) * (k.med_secs / 60.0) as mpm,
           (select coalesce(bool_and(c.commandable_key is not null), false)
              from unnest(k.pattern) as x(key) left join app.activity_catalog c on c.key = x.key) as all_commands
      from kept k join reg r on r.role_key = k.role_key and r.pattern = k.pattern
  )
  insert into pg_temp.activity_mine_found (role_key, pattern, pattern_hash, support, actors, sessions, median_seconds, mpm,
                                           err_rate, regularity, score, suggested_kind, first_seen, last_seen)
  select sc.role_key, sc.pattern, md5(array_to_string(sc.pattern, '>')), sc.support, sc.actors, sc.sessions,
         sc.median_seconds, round(sc.mpm::numeric, 1), round(sc.err_rate, 4), round(sc.regularity, 4),
         round(sc.mpm::numeric * greatest(sc.regularity - sc.err_rate, 0), 2),
         case when sc.regularity >= 0.8 and sc.support >= 8 then 'scheduled_job'
              when sc.all_commands then 'niva_command'
              when sc.len = 2 and sc.pattern[1] ~ '(add|create|new|record)' and sc.pattern[2] ~ '(update|set_|edit|save)' then 'default'
              when sc.actors >= 3 then 'playbook'
              else 'routine' end,
         sc.first_seen, sc.last_seen
    from scored sc;

  -- Recompute: a NEW idea that is no longer found, or that was shown and now comes from too few people, is deleted.
  delete from app.automation_candidates c
   where c.center_id = p_center and c.status = 'new'
     and (not exists (select 1 from pg_temp.activity_mine_found f where f.role_key = c.role_key and f.pattern_hash = c.pattern_hash)
          or (c.distinct_actors >= v_floor
              and exists (select 1 from pg_temp.activity_mine_found f
                           where f.role_key = c.role_key and f.pattern_hash = c.pattern_hash and f.actors < v_floor)));

  -- Write what is found. A decision (status, decided_by, decided_at) is never touched.
  insert into app.automation_candidates as ac (center_id, role_key, pattern, pattern_hash, support, distinct_actors, sessions,
                                               median_seconds, minutes_per_month, error_rate, regularity, score, suggested_kind,
                                               first_seen, last_seen)
  select p_center, f.role_key, f.pattern, f.pattern_hash, f.support, f.actors, f.sessions, f.median_seconds, f.mpm,
         f.err_rate, f.regularity, f.score, f.suggested_kind, f.first_seen, f.last_seen
    from pg_temp.activity_mine_found f
  on conflict (center_id, role_key, pattern_hash) do update
    set support = excluded.support, distinct_actors = excluded.distinct_actors, sessions = excluded.sessions,
        median_seconds = excluded.median_seconds, minutes_per_month = excluded.minutes_per_month,
        error_rate = excluded.error_rate, regularity = excluded.regularity, score = excluded.score,
        suggested_kind = excluded.suggested_kind, stale = false,
        first_seen = least(ac.first_seen, excluded.first_seen),
        last_seen = excluded.last_seen;
  get diagnostics v_n = row_count;

  -- A decided idea keeps its decision, its role and its keys; its numbers go to zero once it is no longer found or comes
  -- from fewer than 3 people (so a small group is never described by it).
  update app.automation_candidates c
     set support = 0, distinct_actors = 0, sessions = 0, median_seconds = 0, minutes_per_month = 0, error_rate = 0,
         regularity = 0, score = 0, stale = false
   where c.center_id = p_center and c.status <> 'new' and (c.support > 0 or c.stale)
     and (c.distinct_actors < v_floor
          or not exists (select 1 from pg_temp.activity_mine_found f where f.role_key = c.role_key and f.pattern_hash = c.pattern_hash));

  drop table pg_temp.activity_mine_found;
  return v_n;
end $$;
comment on function app.activity_mine(uuid, integer) is
  'Recompute the repeated sequences (2 to 5 actions, at least 5 times in at least 2 sessions) per role in the last p_days days (7 to 400, default 60) of one community''s activity: new ideas no longer found are deleted, found ones updated, decided ones keep their decision (numbers zeroed when the pattern is gone or comes from fewer than 3 people). Idempotent. Platform admin or the background service. Returns the ideas written (0622).';

create or replace function app.worker_activity_centers() returns table (center_id uuid)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return query select c.id from app.centers c where (c.rules -> 'activity' ->> 'enabled') = 'true' order by c.id;
end $$;
comment on function app.worker_activity_centers() is 'connect_worker: the communities whose activity recording is on (the worker mines each in its own call, 0622).';

create or replace function app.worker_mine_activity(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_n integer;
begin
  perform app.assert_worker();
  if p_center is null or not app.activity_enabled(p_center) then
    return jsonb_build_object('candidates', 0, 'skipped', true);
  end if;
  v_n := app.activity_mine(p_center);
  return jsonb_build_object('candidates', v_n, 'skipped', false);
end $$;
comment on function app.worker_mine_activity(uuid) is 'connect_worker (daily, activity.mine, once per community): recompute one community''s automation ideas; nothing if its recording is off (0622).';

revoke execute on function app.activity_mine(uuid, integer), app.worker_activity_centers(), app.worker_mine_activity(uuid),
  app.automation_candidates_decide()
  from public, anon, authenticated, service_role;
grant execute on function app.activity_mine(uuid, integer) to authenticated, connect_worker;
grant execute on function app.worker_activity_centers(), app.worker_mine_activity(uuid) to connect_worker;
