-- 0740 · Platform grants for every non-core module (docs/GIVING_REDESIGN.md section 11.2, slice M1).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Until now a community's administrator (settings.manage) could switch any module the community's kind offers on or off.
--   From now on Weaver (a platform admin) decides which modules a community has, and the community decides only whether to
--   use them for now:
--
--     a module is ON  =  the kind offers it
--                        AND it is granted (a row in app.center_module_grants; without a row, the kind's default_on counts
--                            as granted and default_off waits for a grant)
--                        AND the community has not paused it (app.center_modules, its own switch, unchanged)
--                        AND every module it depends on is on, worked out the same way (dependencies are EVALUATED, no
--                            longer enforced at the switch, so Giving can be paused in one step and its add-ons come back
--                            as they were when it is switched on again).
--
--   app.center_module_grants                  Weaver's decision per community and module (granted, reason, by, at).
--                                             Read: platform admins and the community's settings managers. No one writes
--                                             it directly; app.set_module_grant does.
--   app.set_module_grant(center, key, granted, reason)
--                                             platform admins only, a reason, a fresh 2FA check ('platform.module_grant'),
--                                             audited (audit_row on the table). Core modules and modules the kind does not
--                                             offer are refused; so is a change that changes nothing.
--   app.module_enabled / module_off_centers / assert_module_enabled / set_module_enabled / module_states
--                                             learn the grant and the evaluated dependencies (latest bodies: 0594).
--   app.category_change_preview               says when a module would wait for Weaver (latest body: 0594).
--   app.demo_clear_tables                     a sandbox reset keeps the grants (latest body: 0586).
--   app.promotion_config_tables               promotion copies the grants (latest body: 0203).
--   app.my_modules                            NOT redefined: it calls module_enabled, so it follows; same columns for the
--                                             installed member apps.
--
-- GRANDFATHERED: before the functions change, every existing community gets a granted row for every non-core module that is
-- on today, or that the community switched itself (on or paused), so nothing anyone sees changes. A community created later
-- has no rows: the kind's default_on set counts as granted, which covers every way a community is made (a sandbox from a
-- request or from the console, a promotion, a demo community) without touching those functions.
--
-- module_off_centers runs inside every restrictive module_switch policy as an InitPlan ((select ...)), so it stays ONE SQL set
-- query: the module's chain of non-core dependencies (three rows at most) times the communities, joined on primary keys of the
-- kind's row, the grant and the switch. No function is called per row.

-- ── The grants ───────────────────────────────────────────────────────────────
create table if not exists app.center_module_grants (
  center_id  uuid not null references app.centers(id) on delete cascade,
  module_key text not null references app.modules(key),
  granted    boolean not null,
  reason     text not null,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (center_id, module_key)
);
create index if not exists center_module_grants_module_idx on app.center_module_grants (module_key, center_id);
comment on table app.center_module_grants is
  'Weaver''s decision about one module for one community (0740). No row: the kind''s availability decides (default_on = granted, default_off waits for a grant). Written only by app.set_module_grant.';

-- Grandfathering: with the 0594 functions still in place, so "on today" means what it meant.
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at)
select c.id, m.key, true,
       'Enabled when platform grants began (0740): it was on for this community, or the community had switched it itself.',
       null, now()
  from app.centers c
  cross join app.modules m
 where not m.core
   and app.module_availability(c.id, m.key) <> 'not_available'
   and (app.module_enabled(c.id, m.key)
        or exists (select 1 from app.center_modules x where x.center_id = c.id and x.module_key = m.key))
on conflict (center_id, module_key) do nothing;

-- Module map, audit (after the grandfathering, which this migration itself records), access.
insert into app.module_tables (table_name, module_key) values ('center_module_grants', null)
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_center_module_grants on app.center_module_grants;
create trigger audit_center_module_grants after insert or update or delete on app.center_module_grants
  for each row execute function app.audit_row('center_id', 'module_key');

alter table app.center_module_grants enable row level security;
drop policy if exists center_module_grants_read on app.center_module_grants;
create policy center_module_grants_read on app.center_module_grants for select to authenticated
  using (app.is_platform_admin() or app.has_permission(center_id, 'settings.manage'));
revoke all on app.center_module_grants from public, anon, authenticated;
grant select on app.center_module_grants to authenticated;
grant all on app.center_module_grants to service_role;

-- ── Private helpers ──────────────────────────────────────────────────────────

-- The module and every non-core module it needs, directly or through another, in catalog order. A core module (People)
-- is never off, so it is left out; an unknown key gives an empty chain (and is therefore never off, as before).
create or replace function app._module_chain(p_module text) returns text[]
language sql stable security definer set search_path = app, public, extensions as $$
  with recursive need(key) as (
    select p_module
    union
    select d.dep from need n join app.modules m on m.key = n.key cross join lateral unnest(m.depends_on) as d(dep)
  )
  select coalesce(array_agg(m.key order by m.sort, m.key), '{}') from need n join app.modules m on m.key = n.key and not m.core
$$;

-- Has Weaver granted the module to the community? Core: always. Not offered by the kind: never. Otherwise Weaver's row,
-- else the kind's default (default_on = granted).
create or replace function app._module_granted(p_center uuid, p_module text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select m.core from app.modules m where m.key = p_module), false)
      or (app.module_availability(p_center, p_module) <> 'not_available'
          and coalesce((select g.granted from app.center_module_grants g where g.center_id = p_center and g.module_key = p_module),
                       app.module_availability(p_center, p_module) = 'default_on'))
$$;

-- Is the module itself on, its dependencies aside: offered, granted and not paused. The kind's availability is passed in,
-- so the preview of a change of kind can ask about the next kind.
create or replace function app._module_self_on(p_center uuid, p_module text, p_availability text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(p_availability, 'default_on') <> 'not_available'
     and coalesce((select g.granted from app.center_module_grants g where g.center_id = p_center and g.module_key = p_module),
                  coalesce(p_availability, 'default_on') = 'default_on')
     and not exists (select 1 from app.center_modules x where x.center_id = p_center and x.module_key = p_module and not x.enabled)
$$;

-- The module's name in the community's kind (a chamber's "Dues & payments"), else the catalog's.
create or replace function app._module_label(p_center uuid, p_module text) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select cm.label from app.category_modules cm
                    where cm.category_key = app.center_category(p_center) and cm.module_key = p_module),
                  (select m.label from app.modules m where m.key = p_module), p_module)
$$;

-- ── Reads ────────────────────────────────────────────────────────────────────

-- 0594's function with the grant and the evaluated dependencies. A NULL center (a global row) is never off.
create or replace function app.module_enabled(p_center uuid, p_module text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select not exists (
    select 1
      from unnest(app._module_chain(p_module)) as ch(key)
      left join app.centers c on c.id = p_center
      left join app.category_modules cm on cm.category_key = c.category_key and cm.module_key = ch.key
      left join app.center_module_grants g on g.center_id = p_center and g.module_key = ch.key
      left join app.center_modules x on x.center_id = p_center and x.module_key = ch.key
     where coalesce(cm.availability, 'default_on') = 'not_available'
        or not coalesce(g.granted, coalesce(cm.availability, 'default_on') = 'default_on')
        or x.enabled is false)
$$;

-- Communities where the module is off: the same rule as module_enabled, as one set (the policies call it as an InitPlan,
-- once per statement).
create or replace function app.module_off_centers(p_module text) returns uuid[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(distinct c.id), '{}')
    from unnest(app._module_chain(p_module)) as ch(key)
    cross join app.centers c
    left join app.category_modules cm on cm.category_key = c.category_key and cm.module_key = ch.key
    left join app.center_module_grants g on g.center_id = c.id and g.module_key = ch.key
    left join app.center_modules x on x.center_id = c.id and x.module_key = ch.key
   where coalesce(cm.availability, 'default_on') = 'not_available'
      or not coalesce(g.granted, coalesce(cm.availability, 'default_on') = 'default_on')
      or x.enabled is false
$$;

-- For RPCs: raises in plain English when the module is off, saying why. Platform admins pass, as they do in RLS.
-- 0594's two sentences are kept word for word (a module the kind does not have; a module the community switched off).
create or replace function app.assert_module_enabled(p_center uuid, p_module text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_dep text;
begin
  if app.module_enabled(p_center, p_module) or app.is_platform_admin() then return true; end if;
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

-- Settings › Modules and Platform › Communities › Modules (0594's columns, then the grant and the evaluated state):
--   granted        Weaver's grant (or the kind's default_on); always true for a core module
--   granted_by/at, grant_reason   Weaver's last change (null when the kind's default decides)
--   paused         the community switched it off itself
--   waiting_for    the modules it needs that are off (keys, catalog order); it comes back on when they do
-- Settings managers and platform admins.
drop function if exists app.module_states(uuid);
create function app.module_states(p_center uuid)
returns table (key text, label text, description text, core boolean, depends_on text[], sort int, availability text,
               enabled boolean, switchable boolean, changed_by uuid, changed_at timestamptz, reason text,
               granted boolean, granted_by uuid, granted_at timestamptz, grant_reason text, paused boolean, waiting_for text[])
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not (app.has_permission(p_center, 'settings.manage') or app.is_platform_admin()) then
    raise exception 'You don''t have access to this community''s modules (it needs settings.manage).' using errcode = 'insufficient_privilege';
  end if;
  return query
  select m.key, coalesce(cm.label, m.label), coalesce(cm.description, m.description), m.core, m.depends_on, m.sort,
         coalesce(cm.availability, 'default_on'),
         m.core or app.module_enabled(p_center, m.key),
         (not m.core) and coalesce(cm.availability, 'default_on') <> 'not_available',
         x.changed_by, x.changed_at, x.reason,
         app._module_granted(p_center, m.key),
         g.granted_by, g.granted_at, g.reason,
         (not m.core) and x.enabled is false,
         coalesce((select array_agg(ch.k order by ch.n)
                     from unnest(app._module_chain(m.key)) with ordinality as ch(k, n)
                    where ch.k <> m.key and not app._module_self_on(p_center, ch.k, app.module_availability(p_center, ch.k))),
                  '{}'::text[])
    from app.modules m
    left join app.category_modules cm on cm.category_key = app.center_category(p_center) and cm.module_key = m.key
    left join app.center_modules x on x.center_id = p_center and x.module_key = m.key
    left join app.center_module_grants g on g.center_id = p_center and g.module_key = m.key
   order by m.sort, m.key;
end $$;

-- ── The community's switch: pause and resume what Weaver granted ─────────────
-- 0594's switch, plus: a module Weaver has not granted cannot be switched on (nor "off": it is off already). The
-- dependency checks are gone: a module that needs another is off while that one is off, whatever its own switch says.
create or replace function app.set_module_enabled(p_center uuid, p_module text, p_enabled boolean, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.modules;
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not (app.has_permission(p_center, 'settings.manage') or app.is_platform_admin()) then
    raise exception 'Switching modules on or off needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  select * into m from app.modules where key = p_module;
  if m.key is null then raise exception 'There is no module called "%".', p_module; end if;
  if p_enabled is null then raise exception 'Choose whether to switch the % module on or off.', m.label; end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Give a reason for switching the % module %. It goes in the audit log.', m.label,
      case when p_enabled then 'on' else 'off' end;
  end if;
  if p_enabled and app.module_availability(p_center, p_module) = 'not_available' then
    raise exception '% is not part of a % organization, so it cannot be switched on.',
      coalesce((select cm.label from app.category_modules cm where cm.category_key = app.center_category(p_center) and cm.module_key = p_module), m.label),
      coalesce((select k.label from app.organization_categories k where k.key = app.center_category(p_center)), 'this')
      using errcode = 'insufficient_privilege', hint = 'Community Connect can change an organization''s category.';
  end if;
  if not m.core and not app._module_granted(p_center, p_module) then
    if p_enabled then
      raise exception 'Weaver has not enabled % for this community.', app._module_label(p_center, p_module)
        using errcode = 'insufficient_privilege', hint = 'Ask Weaver to enable it.';
    end if;
    raise exception 'Weaver has not enabled % for this community, so it is off already.', app._module_label(p_center, p_module)
      using errcode = 'insufficient_privilege';
  end if;
  -- One switch at a time per community (the grants take the same lock).
  perform pg_advisory_xact_lock(hashtextextended('app.center_modules:' || p_center::text, 0));

  if not p_enabled and m.core then
    raise exception 'The % module is part of the core platform and cannot be switched off.', m.label;
  end if;

  perform app.set_audit_context(p_reason);
  insert into app.center_modules (center_id, module_key, enabled, changed_by, changed_at, reason)
  values (p_center, p_module, p_enabled, auth.uid(), now(), app.audit_clean_reason(p_reason))
  on conflict (center_id, module_key) do update
    set enabled = excluded.enabled, changed_by = excluded.changed_by, changed_at = excluded.changed_at, reason = excluded.reason;
end $$;

-- ── Weaver's grant ───────────────────────────────────────────────────────────
-- Platform admins only, a reason, a fresh 2FA check; audited by the table's trigger with the reason. Enabling switches the
-- module on at once unless the community had paused it; disabling hides it and its data (nothing is deleted) until it is
-- enabled again. Returns {module, label, granted, paused, enabled}.
create or replace function app.set_module_grant(p_center uuid, p_module text, p_granted boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.modules; v_reason text := app.audit_clean_reason(p_reason); v_label text;
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Weaver team can enable or disable a module for a community.' using errcode = 'insufficient_privilege';
  end if;
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  select * into m from app.modules where key = p_module;
  if m.key is null then raise exception 'There is no module called "%".', p_module; end if;
  v_label := app._module_label(p_center, p_module);
  if m.core then raise exception '% is part of the core platform and is always on.', v_label; end if;
  if p_granted is null then raise exception 'Choose whether to enable or disable %.', v_label; end if;
  if v_reason is null then
    raise exception 'Give a reason for % %. It goes in the audit log.', case when p_granted then 'enabling' else 'disabling' end, v_label;
  end if;
  if p_granted and app.module_availability(p_center, p_module) = 'not_available' then
    raise exception '% is not part of a % organization, so it cannot be enabled. Change the kind of organization first.', v_label,
      coalesce((select k.label from app.organization_categories k where k.key = app.center_category(p_center)), 'this')
      using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('app.center_modules:' || p_center::text, 0));
  if app._module_granted(p_center, p_module) = p_granted then
    raise exception '% is already % for this community. There is nothing to change.', v_label,
      case when p_granted then 'enabled' else 'disabled' end;
  end if;
  perform app.assert_step_up('platform.module_grant');

  perform app.set_audit_context(v_reason);
  insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at)
  values (p_center, p_module, p_granted, v_reason, auth.uid(), now())
  on conflict (center_id, module_key) do update
    set granted = excluded.granted, reason = excluded.reason, granted_by = excluded.granted_by, granted_at = excluded.granted_at;

  return jsonb_build_object(
    'module', p_module, 'label', v_label, 'granted', p_granted,
    'paused', exists (select 1 from app.center_modules x where x.center_id = p_center and x.module_key = p_module and not x.enabled),
    'enabled', app.module_enabled(p_center, p_module));
end $$;

-- ── The preview of a change of kind (0594's body; 0740 changes only the state a module would be in afterwards and its
-- sentence: a module that is not granted under the next kind waits for Weaver) ──────────────────────────────────
create or replace function app.category_change_preview(p_center uuid, p_category text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; cur app.organization_categories; nxt app.organization_categories; m record;
        v_before text; v_after text; v_hidden jsonb := '[]'::jsonb; v_avail jsonb := '[]'::jsonb; v_lines text[] := '{}';
        v_rec jsonb; v_total bigint; v_parts text[]; v_text text; v_unchanged int := 0; v_paths bigint; v_trad text;
        v_granted boolean;
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can preview a change of category.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.'; end if;
  select * into nxt from app.organization_categories where key = p_category;
  if nxt.key is null then raise exception 'Choose one of the organization categories.'; end if;
  select * into cur from app.organization_categories where key = c.category_key;

  for m in
    select mo.key, mo.core, mo.label as base_label, coalesce(cm.availability, 'default_on') as after_avail,
           coalesce(cm.label, mo.label) as after_label, app.module_availability(p_center, mo.key) as before_avail
      from app.modules mo
      left join app.category_modules cm on cm.category_key = nxt.key and cm.module_key = mo.key
     order by mo.sort, mo.key
  loop
    v_before := case when m.before_avail = 'not_available' then 'never'
                     when m.core or app.module_enabled(p_center, m.key) then 'on' else 'off' end;
    -- 0740: under the next kind, the module is on when it is granted (Weaver's row, else that kind's default_on), not paused
    -- and offered; its dependencies are not part of the preview, as before.
    v_granted := m.core or (m.after_avail <> 'not_available'
                 and coalesce((select g.granted from app.center_module_grants g where g.center_id = p_center and g.module_key = m.key),
                              m.after_avail = 'default_on'));
    v_after := case when m.after_avail = 'not_available' then 'never'
                    when m.core or app._module_self_on(p_center, m.key, m.after_avail) then 'on' else 'off' end;
    if cur.key = nxt.key then v_after := v_before; end if;
    if v_before = 'on' and v_after <> 'on' then
      v_rec := app._module_records(p_center, m.key);
      select coalesce(sum(e.value::bigint), 0), coalesce(array_agg(e.value || ' in ' || replace(e.key, '_', ' ') order by e.value::bigint desc, e.key), '{}')
        into v_total, v_parts from jsonb_each_text(v_rec) e;
      v_text := m.base_label || ': ' ||
        case when v_total = 0 then 'nothing is stored yet, so nothing is hidden'
             else v_total || case when v_total = 1 then ' record' else ' records' end || ' will be hidden, not deleted (' || array_to_string(v_parts, ', ') || ')' end ||
        case when v_after = 'off' and v_granted then '; it can be switched on again in Settings › Modules'
             when v_after = 'off' then '; Weaver can enable it again' else '' end || '.';
      v_hidden := v_hidden || jsonb_build_array(jsonb_build_object('module', m.key, 'label', m.base_label, 'becomes', v_after,
                                                                   'records', v_total, 'tables', v_rec, 'text', v_text));
      v_lines := v_lines || v_text;
    elsif v_before <> 'on' and v_after <> 'never' and (v_after = 'on' or v_before = 'never') then
      v_text := m.after_label || ': ' ||
        case when v_after = 'on' then 'will be on'
             when v_granted then 'becomes available and starts off; it can be switched on in Settings › Modules'
             else 'becomes available and waits until Weaver enables it' end || '.';
      v_avail := v_avail || jsonb_build_array(jsonb_build_object('module', m.key, 'label', m.after_label, 'becomes', v_after, 'text', v_text));
      v_lines := v_lines || v_text;
    else
      v_unchanged := v_unchanged + 1;
    end if;
  end loop;

  -- People's paths are section G's column: counted by dynamic SQL, only when the column exists, so sections E and F work
  -- without G (a plpgsql statement that names a missing column fails on first use, not when the function is created).
  v_paths := 0;
  if exists (select 1 from pg_attribute a where a.attrelid = to_regclass('app.person_profile_details')
                and a.attname = 'path_key' and not a.attisdropped) then
    execute 'select count(*) from app.person_profile_details d where d.center_id = $1 and d.path_key is not null'
      into v_paths using p_center;
  end if;
  v_trad := case when not nxt.uses_tradition then 'other'
                 when c.tradition = 'other' then coalesce(app._tradition_to_restore(p_center)::text, 'other')
                 else c.tradition::text end;
  if cur.key <> nxt.key then
    v_lines := v_lines || 'Words, tabs and shared libraries follow the new category on the next app refresh.'::text;
    if v_paths > 0 and not nxt.uses_tradition then
      v_lines := v_lines || (v_paths || case when v_paths = 1 then ' person''s' else ' people''s' end || ' path stays stored and is ignored.');
    end if;
    if v_trad is distinct from c.tradition::text then
      v_lines := v_lines || ('The community''s default tradition becomes "' || v_trad || '".');
    end if;
    v_lines := v_lines || 'Nothing is deleted; changing back restores it.'::text;
  end if;

  return jsonb_build_object(
    'center_id', c.id, 'center_name', c.name,
    'from', jsonb_build_object('key', cur.key, 'label', cur.label),
    'to', jsonb_build_object('key', nxt.key, 'label', nxt.label, 'active', nxt.active),
    'changed', cur.key <> nxt.key,
    'hidden', v_hidden, 'available', v_avail, 'unchanged', v_unchanged,
    'tradition', jsonb_build_object('before', c.tradition, 'after', v_trad),
    'paths_kept', v_paths,
    'summary', to_jsonb(v_lines));
end $$;

-- ── Sandbox reset and promotion carry the grants ─────────────────────────────
-- 0586's clear list, plus the grants: Weaver's decisions are the community's configuration, kept like its own switches.
create or replace function app.demo_clear_tables() returns text[]
language sql stable set search_path = app, public, extensions as $$
  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r'
     and (exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'center_id' and not a.attisdropped)
          or c.relname in ('gyan_levels','gyan_steps'))
     and c.relname <> all (app.demo_keep_tables())
     and c.relname <> all (array['access_levels', 'center_feature_access', 'center_module_grants']::text[])
$$;

-- 0203's copy list, plus the grants (right after the community's own switches).
create or replace function app.promotion_config_tables() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['org_profiles','org_leaders','center_modules','center_module_grants','zones','membership_types','funds','campaigns','labh_options',
               'event_templates','event_template_items','store_categories','pickup_windows','pathshala_tracks',
               'pathshala_levels','gyan_goals','practices','inboxes','guide_sections','message_templates',
               'receipt_templates','legal_documents','custom_field_definitions','import_mappings','public_kpi_settings',
               'calendar_layers','volunteer_groups']
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app._module_chain(text), app._module_granted(uuid, text), app._module_self_on(uuid, text, text),
  app._module_label(uuid, text) from public, anon, authenticated;
revoke execute on function app.module_states(uuid), app.set_module_grant(uuid, text, boolean, text) from public, anon;
grant execute on function app.module_states(uuid), app.set_module_grant(uuid, text, boolean, text) to authenticated, service_role;
grant execute on function app._module_chain(text), app._module_granted(uuid, text), app._module_self_on(uuid, text, text),
  app._module_label(uuid, text) to service_role;
