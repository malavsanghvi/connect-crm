-- Wave 2 (stream s-core) · 4 of 5: a switched-off module is off in the database.
--
-- Every table of a switchable (non-core) module gets ONE restrictive policy,
-- `module_switch`, generated from app.module_tables. Restrictive policies are
-- AND-ed with the existing permissive ones, so they can only take access away;
-- every existing policy is left exactly as it was. With no center_modules row
-- (the default) the policy passes, so nothing changes until an admin switches
-- a module off.
--
-- The check is the contract's
--     app.module_enabled(center_id, '<key>') or app.is_platform_admin()
-- written as InitPlans: `(select app.module_off_centers('<key>'))` and
-- `(select app.is_platform_admin())` run once per query, not once per row, and
-- the per-row work is an array test against a list that is normally empty.
-- A NULL center_id (a global row) is never switched off, as in module_enabled().
--
-- Tables without center_id: gyan_levels and gyan_steps resolve their center
-- through gyan_goals. notification_topics is a global catalog (no center), so
-- it has nothing to switch; the comms tables that use it do.
-- Core tables (module_key NULL) and the core `people` module get no policy.

do $$
declare t record; v_qual text;
begin
  for t in
    select mt.table_name, mt.module_key
      from app.module_tables mt
      join app.modules m on m.key = mt.module_key and not m.core
      join pg_class c on c.relname = mt.table_name and c.relkind in ('r','p')
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'app'
     where exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'center_id' and not a.attisdropped)
  loop
    v_qual := format('(select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers(%L))::uuid[]))',
                     t.module_key);
    if exists (select 1 from pg_policy where polname = 'module_switch' and polrelid = ('app.' || quote_ident(t.table_name))::regclass) then
      execute format('drop policy module_switch on app.%I', t.table_name);
    end if;
    execute format('create policy module_switch on app.%I as restrictive for all to public using (%s) with check (%s)',
                   t.table_name, v_qual, v_qual);
  end loop;
end $$;

-- Resolved in security-definer helpers: a subquery inside a policy runs under
-- the caller's RLS, and once gyan_path is off the caller can no longer see the
-- parent rows it would need to check.
create or replace function app.gyan_off_goal_ids() returns uuid[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(g.id), '{}') from app.gyan_goals g
   where g.center_id = any (app.module_off_centers('gyan_path'))
$$;
create or replace function app.gyan_off_level_ids() returns uuid[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(l.id), '{}') from app.gyan_levels l
   where l.goal_id = any (app.gyan_off_goal_ids())
$$;
grant execute on function app.gyan_off_goal_ids(), app.gyan_off_level_ids() to anon, authenticated, service_role;

drop policy if exists module_switch on app.gyan_levels;
create policy module_switch on app.gyan_levels as restrictive for all to public
  using ((select app.is_platform_admin()) or not (goal_id = any ((select app.gyan_off_goal_ids())::uuid[])))
  with check ((select app.is_platform_admin()) or not (goal_id = any ((select app.gyan_off_goal_ids())::uuid[])));

drop policy if exists module_switch on app.gyan_steps;
create policy module_switch on app.gyan_steps as restrictive for all to public
  using ((select app.is_platform_admin()) or not (level_id = any ((select app.gyan_off_level_ids())::uuid[])))
  with check ((select app.is_platform_admin()) or not (level_id = any ((select app.gyan_off_level_ids())::uuid[])));
