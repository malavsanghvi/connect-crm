-- 0623 · Activity: retention, the cross-community backlog and the administrators' usage totals (backlog B91).
--
--   app.activity_purge(limit)       connect_worker only. Deletes activity events older than 400 days, at most `limit` per
--                                   call (the worker repeats until a call deletes fewer), and the ideas nobody acted on
--                                   (status new or dismissed) that have not been seen for 400 days. Called daily by the
--                                   worker's activity.mine job, after the miner.
--   app.automation_backlog          Weaver (platform admins) only: for each action key, in how many communities that have
--                                   recording on it appears in an automation idea, in how many ideas, and the minutes a
--                                   month those ideas add up to. KEYS AND COUNTS ONLY: no community, role, person or
--                                   event. Ideas that were dismissed are left out. (Owner decision pending: whether
--                                   Weaver staff may see cross-community counts at all.)
--   app.activity_usage(center, days) the community's own administrators (settings.manage): totals by key, surface,
--                                   platform and app version over the last `days` days: how many times, by how many
--                                   people, how many failed, the middle duration. Never a person, a role or an event.
--                                   Answers the usage questions of B77: which screens and steps are used, on which
--                                   platform and app version, and where steps fail.

create or replace function app.activity_purge(p_limit integer default 5000) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 5000), 1), 100000); v_n integer;
begin
  perform app.assert_worker();
  delete from app.activity_events
   where id in (select e.id from app.activity_events e where e.occurred_at < now() - interval '400 days' limit v_limit);
  get diagnostics v_n = row_count;
  delete from app.automation_candidates
   where status in ('new', 'dismissed') and last_seen < now() - interval '400 days';
  return v_n;
end $$;
comment on function app.activity_purge(integer) is 'connect_worker (daily): delete activity events older than 400 days, at most p_limit per call, and stale unactioned automation ideas. Returns the events deleted (0623).';

-- Keys and counts across the communities that have recording on. The where clause is the access rule (a view runs with
-- its owner's rights); the security barrier keeps a caller's own conditions from being evaluated before it.
create or replace view app.automation_backlog with (security_barrier = true) as
select k.item_key,
       (select c.label from app.activity_catalog c where c.key = k.item_key) as label,
       (select c.surface from app.activity_catalog c where c.key = k.item_key) as surface,
       count(distinct a.center_id)::integer as communities,
       count(*)::integer as ideas,
       sum(a.support)::integer as times,
       round(sum(a.minutes_per_month), 1) as minutes_per_month,
       max(a.last_seen) as last_seen
  from app.automation_candidates a
  join app.centers ce on ce.id = a.center_id and (ce.rules -> 'activity' ->> 'enabled') = 'true'
  cross join lateral (select distinct x.item_key from unnest(a.pattern) as x(item_key)) k
 where app.is_platform_admin() and a.status <> 'dismissed'
 group by k.item_key;
comment on view app.automation_backlog is 'For Weaver platform admins only (0623): per action key, how many communities with recording on have it in an automation idea, in how many ideas, how often and how many minutes a month. Keys and counts only.';
revoke all on app.automation_backlog from public, anon, authenticated, service_role, connect_worker;
grant select on app.automation_backlog to authenticated;

create or replace function app.activity_usage(p_center uuid, p_days integer default 30)
returns table (item_key text, item_kind text, surface text, platform text, app_version text,
               events bigint, people bigint, errors bigint, median_ms integer)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_days integer := least(greatest(coalesce(p_days, 30), 1), 400);
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
     order by count(*) desc, e.key;
end $$;
comment on function app.activity_usage(uuid, integer) is 'For people with settings.manage in the community (0623): activity totals by key, surface, platform and app version over the last p_days days (1 to 400). Counts only: never a person, a role or an event.';

revoke execute on function app.activity_purge(integer), app.activity_usage(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function app.activity_purge(integer) to connect_worker;
grant execute on function app.activity_usage(uuid, integer) to authenticated;
