-- 0623 · Activity: retention, the daily sweep, the cross-community backlog and the administrators' usage totals (backlog B91).
--
--   app.activity_purge(limit, sweep)  connect_worker only, daily (the worker's activity.mine job, after the miner).
--     1. Deletes activity events older than 400 days, at most `limit` per call (the worker repeats while a call deletes a
--        full batch), and the ideas nobody acted on (status new or dismissed) that have not been seen for 400 days.
--     2. The SWEEP (when `sweep` is true: the worker asks for it on the first call of a run only): deletes the stored events
--        of anyone who no longer passes the rule that let them in. The pseudonyms are worked out from the per-community
--        salt, for the people of each community that has one; there is no trigger on people.
--          member surface  anyone linked to the community whose birth date is not recorded or is under 18 (a date of
--                          birth removed or changed since; a person who registered herself with none)
--          portal surface  anyone whose birth date shows under 18
--          both surfaces   platform admins, and people who opted out (a backstop for a call that raced the opt-out)
--        The ideas of every community where something was deleted are marked stale (see 0622) until the next mining run.
--        A staff member whose role has ended keeps the events from when they were staff (retention removes them at 400 days).
--     Returns {expired, swept}.
--   app.automation_backlog          Weaver (platform admins) only: for each action key, in how many communities that have
--                                   recording on it appears in an automation idea, in how many ideas, and the minutes a
--                                   month those ideas add up to. KEYS AND COUNTS ONLY: no community, role, person or
--                                   event. Only ideas from at least app.activity_min_actors() people that are not stale
--                                   and were not dismissed. (Owner decision pending: whether Weaver staff may see
--                                   cross-community counts at all.)
--   app.activity_usage(center, days) the community's own administrators (settings.manage): totals by key, surface,
--                                   platform and app version over the last `days` days: how many times, by how many
--                                   people, how many failed, the middle duration. Never a person, a role or an event.
--                                   A row from fewer than app.activity_min_actors() people is shown to a platform admin
--                                   only. Answers the usage questions of B77.

create or replace function app.activity_purge(p_limit integer default 5000, p_sweep boolean default true) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 5000), 1), 100000); v_expired integer; v_swept integer := 0;
begin
  perform app.assert_worker();

  delete from app.activity_events
   where id in (select e.id from app.activity_events e where e.occurred_at < now() - interval '400 days' limit v_limit);
  get diagnostics v_expired = row_count;
  delete from app.automation_candidates
   where status in ('new', 'dismissed') and last_seen < now() - interval '400 days';

  if coalesce(p_sweep, true) then
    with failing as (
      select s.center_id, app.activity_hash(cu.user_id, s.salt) as h, 'member'::text as surface
        from app.activity_salts s
        join app.center_users cu on cu.center_id = s.center_id
        join app.people p on p.id = cu.person_id
       where not (p.date_of_birth is not null and p.date_of_birth <= current_date - interval '18 years')
      union all
      select s.center_id, app.activity_hash(cu.user_id, s.salt), 'portal'
        from app.activity_salts s
        join app.center_users cu on cu.center_id = s.center_id
        join app.people p on p.id = cu.person_id
       where p.date_of_birth is not null and p.date_of_birth > current_date - interval '18 years'
      union all
      select s.center_id, app.activity_hash(u.user_id, s.salt), x.surface
        from app.activity_salts s
        cross join (select a.user_id from app.accounts a where a.is_platform_admin
                    union
                    select o.user_id from app.activity_optouts o) u
        cross join (values ('member'), ('portal')) as x(surface)
    ), del as (
      delete from app.activity_events e
        using failing f
       where e.center_id = f.center_id and e.actor_hash = f.h and e.surface = f.surface
      returning e.center_id
    ), hit as (
      select d.center_id, count(*) as n from del d group by d.center_id
    ), mark as (
      update app.automation_candidates c set stale = true from hit where c.center_id = hit.center_id and not c.stale
      returning 1
    )
    select coalesce(sum(hit.n), 0)::integer into v_swept from hit;
  end if;

  return jsonb_build_object('expired', v_expired, 'swept', v_swept);
end $$;
comment on function app.activity_purge(integer, boolean) is 'connect_worker (daily): delete activity events older than 400 days, at most p_limit per call, and stale unactioned automation ideas; with p_sweep, also delete the stored events of anyone who no longer passes the recording rules (under 18, no birth date on the member surface, platform admin, opted out) and mark the ideas of those communities stale. Returns {expired, swept} (0623).';

-- Keys and counts across the communities that have recording on. The where clause is the access rule (a view runs with
-- its owner's rights); the security barrier keeps a caller's own conditions from being evaluated before it.
create or replace view app.automation_backlog with (security_barrier = true) as
select k.item_key,
       (select c.label from app.activity_catalog c where c.key = k.item_key order by c.surface limit 1) as label,
       (select c.surface from app.activity_catalog c where c.key = k.item_key order by c.surface limit 1) as surface,
       count(distinct a.center_id)::integer as communities,
       count(*)::integer as ideas,
       sum(a.support)::integer as times,
       round(sum(a.minutes_per_month), 1) as minutes_per_month,
       max(a.last_seen) as last_seen
  from app.automation_candidates a
  join app.centers ce on ce.id = a.center_id and (ce.rules -> 'activity' ->> 'enabled') = 'true'
  cross join lateral (select distinct x.item_key from unnest(a.pattern) as x(item_key)) k
 where app.is_platform_admin() and a.status <> 'dismissed' and not a.stale
   and a.distinct_actors >= app.activity_min_actors()
 group by k.item_key;
comment on view app.automation_backlog is 'For Weaver platform admins only (0623): per action key, how many communities with recording on have it in an automation idea (from 3 or more people, not stale, not dismissed), in how many ideas, how often and how many minutes a month. Keys and counts only.';
revoke all on app.automation_backlog from public, anon, authenticated, service_role, connect_worker;
grant select on app.automation_backlog to authenticated;

create or replace function app.activity_usage(p_center uuid, p_days integer default 30)
returns table (item_key text, item_kind text, surface text, platform text, app_version text,
               events bigint, people bigint, errors bigint, median_ms integer)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_days integer := least(greatest(coalesce(p_days, 30), 1), 400); v_admin boolean := coalesce(app.is_platform_admin(), false);
begin
  if p_center is null or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'You don''t have access to this area.' using errcode = '42501';
  end if;
  return query
    select e.key, e.kind, e.surface, e.platform, e.app_version,
           count(*), count(distinct e.actor_hash), count(*) filter (where e.outcome = 'error'),
           (percentile_cont(0.5) within group (order by e.duration_ms::double precision))::integer
      from app.activity_events e
     where e.center_id = p_center and e.occurred_at >= now() - make_interval(days => v_days)
     group by e.key, e.kind, e.surface, e.platform, e.app_version
    having v_admin or count(distinct e.actor_hash) >= app.activity_min_actors()
     order by count(*) desc, e.key;
end $$;
comment on function app.activity_usage(uuid, integer) is 'For people with settings.manage in the community (0623): activity totals by key, surface, platform and app version over the last p_days days (1 to 400), only rows from at least 3 different people (a platform admin sees all). Counts only: never a person, a role or an event.';

revoke execute on function app.activity_purge(integer, boolean), app.activity_usage(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function app.activity_purge(integer, boolean) to connect_worker;
grant execute on function app.activity_usage(uuid, integer) to authenticated;
