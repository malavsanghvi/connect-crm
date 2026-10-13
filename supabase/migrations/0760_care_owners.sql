-- 0760 · WeCare slice 2, part 1: who may see a household's care record, and its relationship owner and backup
-- (docs/WECARE.md sections 3 and 5.2; W2, W6; the slice-2 plan the owner approved 2026-10-13). Builder CARE2.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Every WeCare table and function from here on follows 0757's contract: app.care_can (never app.has_permission, never
--   app.is_platform_admin), amounts only with app.care_amounts_can, audit with app.audit_private_row, reads logged with
--   app.log_private_read. Weaver's platform admins see nothing, whatever role or support grant they hold.
--
--   WHO SEES ONE HOUSEHOLD'S CARE RECORD (app.care_household_can)
--     care.view or care.manage   every household of the community;
--     care.own                   only the households where they are the relationship owner OR the backup (owner decision
--                                2026-10-13: the backup sees the household exactly as the owner does).
--     Whoever sees a household's care record may also write its touches, notes and care profile (owner decision
--     2026-10-13); only care.manage assigns owners.
--     For RLS the same rule is worked out once per statement: app.care_view_centers() (the communities where the caller
--     sees every record) and app.care_my_households() (the households they own or back up, while they still hold a care key).
--
--   RELATIONSHIP OWNERS (app.care_owners, one row per household)
--     owner and backup: two different people, each holding care.own, care.view or care.manage through the organization
--     (0757's app._org_holds: the owner of the community, or a center-wide grant of a non-platform role) when they are set.
--     app.set_care_owner(household, owner, backup, reason)   care.manage only. Both empty clears the household's owners.
--     app.care_holders(center)                               care.manage only: who can be chosen, with their level.
--     "Needs an owner" is worked out when the row is read: no owner, or an owner who no longer holds a care key (their role
--     ended or was taken away). The row and every touch and note stay, so the history hands over intact.
--   Nobody writes the table directly: RLS lets care readers read it, the functions above write it. Audit: who, when and
--   which columns (0758), module 'care', kept from platform admins and from audit.view alone.
set client_min_messages = warning;

-- ── Shared row rules for every WeCare table ─────────────────────────────────

-- A WeCare row belongs to its household's community (center_id is taken from the household, never from the caller), and
-- never moves to another household, except to the household its own was merged into (0762's merge rule moves it there).
create or replace function app.care_row_household() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid;
begin
  select h.center_id into v_center from app.households h where h.id = new.household_id;
  if v_center is null then raise exception 'That household was not found.' using errcode = '23503'; end if;
  if tg_op = 'UPDATE' and new.household_id is distinct from old.household_id
     and not exists (select 1 from app.households d where d.id = old.household_id and d.merged_into_id = new.household_id) then
    raise exception 'A care record belongs to one household and cannot be moved to another.' using errcode = '23514';
  end if;
  new.center_id := v_center;
  return new;
end $$;
revoke execute on function app.care_row_household() from public, anon, authenticated;

-- The person a WeCare row names (the column given as the trigger's argument) is a CURRENT member of that household and an
-- adult (D2: nothing about anyone under 18; app.person_is_minor of 0587, which also counts as a child someone with no birth
-- date who is a child in a household and primary or spouse in none). Empty is fine. Checked when the person is set or
-- changed; a row that only moves with its household (a merge) keeps the person it named.
create or replace function app.care_row_adult() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_person uuid;
begin
  v_person := (to_jsonb(new) ->> tg_argv[0])::uuid;
  if v_person is null then return new; end if;
  if tg_op = 'UPDATE' and v_person is not distinct from (to_jsonb(old) ->> tg_argv[0])::uuid then return new; end if;
  -- INSERT ... ON CONFLICT runs the insert trigger first: a profile's contact already on file is not checked again here.
  if tg_op = 'INSERT' and tg_table_name = 'care_profiles'
     and exists (select 1 from app.care_profiles x where x.household_id = new.household_id and x.contact_person_id = v_person) then
    return new;
  end if;
  if not exists (select 1 from app.household_members hm
                  where hm.household_id = new.household_id and hm.person_id = v_person and hm.left_at is null) then
    raise exception 'That person is not in this household now.' using errcode = '23514';
  end if;
  if app.person_is_minor(v_person) then
    raise exception 'WeCare keeps nothing about anyone under 18. Choose an adult of the household.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function app.care_row_adult() from public, anon, authenticated;

-- ── Relationship owners ──────────────────────────────────────────────────────
create table if not exists app.care_owners (
  -- No cascade: deleting a household never deletes its care records silently (0762 refuses it in plain words). NO ACTION
  -- (checked at the end of the statement), so deleting a whole community still removes everything with it.
  household_id   uuid primary key references app.households(id) on delete no action,
  center_id      uuid not null references app.centers(id) on delete cascade,
  owner_user_id  uuid references auth.users(id) on delete set null,
  backup_user_id uuid references auth.users(id) on delete set null,
  assigned_by    uuid references auth.users(id) on delete set null,
  assigned_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  constraint care_owners_two_people check (backup_user_id is null or owner_user_id is distinct from backup_user_id)
);
create index if not exists care_owners_center_idx on app.care_owners (center_id);
create index if not exists care_owners_owner_idx on app.care_owners (owner_user_id) where owner_user_id is not null;
create index if not exists care_owners_backup_idx on app.care_owners (backup_user_id) where backup_user_id is not null;
comment on table app.care_owners is
  'WeCare (0760): the relationship owner and backup of a household. Written only by app.set_care_owner (care.manage). Read with care.view, or by the owner and backup themselves while they hold a care key. Never by platform admins.';

drop trigger if exists care_owners_household on app.care_owners;
create trigger care_owners_household before insert or update on app.care_owners
  for each row execute function app.care_row_household();
drop trigger if exists audit_care_owners on app.care_owners;
create trigger audit_care_owners after insert or update or delete on app.care_owners
  for each row execute function app.audit_private_row('care', 'household_id');
insert into app.module_tables (table_name, module_key) values ('care_owners', 'care')
  on conflict (table_name) do update set module_key = excluded.module_key;

-- ── Who may see what ─────────────────────────────────────────────────────────

-- Does this user hold any WeCare key in the community through the organization? (For "needs an owner" and the picker.)
create or replace function app._care_holder(p_center uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_user is not null
     and (app._org_holds(p_center, p_user, 'care.own') or app._org_holds(p_center, p_user, 'care.view')
          or app._org_holds(p_center, p_user, 'care.manage'))
$$;

-- The communities where the caller sees every care record (care.view or care.manage, WeCare on), once per statement.
create or replace function app.care_view_centers() returns uuid[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(s.c), '{}'::uuid[])
    from (select o.center_id as c from app.center_owners o where o.user_id = auth.uid()
          union
          select g.center_id from app.role_grants g where g.user_id = auth.uid() and g.status = 'active') s
   where auth.uid() is not null and app.care_can(s.c, 'view')
$$;

-- The households the caller owns or backs up, while they hold a care key there (WeCare on), once per statement.
create or replace function app.care_my_households() returns uuid[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(o.household_id), '{}'::uuid[])
    from app.care_owners o
   where auth.uid() is not null
     and (o.owner_user_id = auth.uid() or o.backup_user_id = auth.uid())
     and app.care_can(o.center_id, 'own')
$$;

-- May the caller see (and write the touches, notes and profile of) this household's care record?
create or replace function app.care_household_can(p_household uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_household is not null and auth.uid() is not null and exists (
    select 1 from app.households h
     where h.id = p_household
       and (app.care_can(h.center_id, 'view')
            or (app.care_can(h.center_id, 'own')
                and exists (select 1 from app.care_owners o
                             where o.household_id = h.id
                               and (o.owner_user_id = auth.uid() or o.backup_user_id = auth.uid())))))
$$;

-- The sentence when the caller may not: WeCare is off (said only to someone linked to the community), else no access.
create or replace function app._care_refuse(p_center uuid) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if p_center is not null and not app._org_private_module_on(p_center, 'care') and app.linked_to_center(p_center) then
    raise exception '% is not on for this community.', app._module_label(p_center, 'care') using errcode = 'insufficient_privilege';
  end if;
  raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
end $$;

-- The household's community, or the refusal. For every WeCare function that takes a household.
create or replace function app._care_household_or_raise(p_household uuid) returns uuid
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_center uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select h.center_id into v_center from app.households h where h.id = p_household;
  if v_center is null then raise exception 'That household was not found.' using errcode = 'P0002'; end if;
  if not app.care_household_can(p_household) then perform app._care_refuse(v_center); end if;
  return v_center;
end $$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table app.care_owners enable row level security;
drop policy if exists care_owners_read on app.care_owners;
create policy care_owners_read on app.care_owners for select to authenticated
  using (center_id = any ((select app.care_view_centers())::uuid[])
         or household_id = any ((select app.care_my_households())::uuid[]));
-- WeCare off for the community: hidden from every direct read (no platform-admin pass).
drop policy if exists module_switch on app.care_owners;
create policy module_switch on app.care_owners as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
revoke all on app.care_owners from public, anon, authenticated;
grant select on app.care_owners to authenticated;
grant all on app.care_owners to service_role;

-- ── Owners: the picker and the change ────────────────────────────────────────

-- The people who can be a relationship owner or backup: the community's owner and everyone with an active center-wide grant
-- of a role holding a WeCare key. care.manage only.
create or replace function app.care_holders(p_center uuid)
returns table (user_id uuid, name text, level text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null or not app.care_can(p_center, 'manage') then perform app._care_refuse(p_center); end if;
  return query
    select u.uid, app._user_label(p_center, u.uid),
           case when app._org_holds(p_center, u.uid, 'care.manage') then 'manage'
                when app._org_holds(p_center, u.uid, 'care.view') then 'view' else 'own' end
      from (select o.user_id as uid from app.center_owners o where o.center_id = p_center
            union
            select g.user_id from app.role_grants g where g.center_id = p_center and g.status = 'active') u
     where app._care_holder(p_center, u.uid)
     order by 2;
end $$;

-- One household's owner and backup: { owner: {user_id, name, holds}, backup: {...}, needs_owner, assigned_at, assigned_by }.
create or replace function app._care_owner_card(p_household uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'owner', case when o.owner_user_id is not null then jsonb_build_object('user_id', o.owner_user_id,
               'name', app._user_label(h.center_id, o.owner_user_id), 'holds', app._care_holder(h.center_id, o.owner_user_id)) end,
    'backup', case when o.backup_user_id is not null then jsonb_build_object('user_id', o.backup_user_id,
               'name', app._user_label(h.center_id, o.backup_user_id), 'holds', app._care_holder(h.center_id, o.backup_user_id)) end,
    'needs_owner', o.owner_user_id is null or not app._care_holder(h.center_id, o.owner_user_id),
    'assigned_at', o.assigned_at,
    'assigned_by', case when o.assigned_by is not null then app._user_label(h.center_id, o.assigned_by) end)
    from app.households h left join app.care_owners o on o.household_id = h.id
   where h.id = p_household
$$;

create or replace function app.set_care_owner(p_household uuid, p_owner uuid default null, p_backup uuid default null, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select h.center_id into v_center from app.households h where h.id = p_household;
  if v_center is null then raise exception 'That household was not found.' using errcode = 'P0002'; end if;
  if not app.care_can(v_center, 'manage') then
    if app.care_household_can(p_household) then
      raise exception 'Only someone who manages % can choose a household''s relationship owner.', app._module_label(v_center, 'care')
        using errcode = 'insufficient_privilege';
    end if;
    perform app._care_refuse(v_center);
  end if;
  if p_owner is null and p_backup is not null then
    raise exception 'Choose the relationship owner first, then a backup.' using errcode = '23514';
  end if;
  if p_owner is not null and p_owner = p_backup then
    raise exception 'The backup has to be a different person from the relationship owner.' using errcode = '23514';
  end if;
  if p_owner is not null and not app._care_holder(v_center, p_owner) then
    raise exception 'That person cannot be a relationship owner: give them a % role first.', app._module_label(v_center, 'care')
      using errcode = '23514';
  end if;
  if p_backup is not null and not app._care_holder(v_center, p_backup) then
    raise exception 'That person cannot be a backup: give them a % role first.', app._module_label(v_center, 'care')
      using errcode = '23514';
  end if;
  perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason),
            case when p_owner is null then 'Relationship owner cleared' else 'Relationship owner chosen' end));
  insert into app.care_owners as o (household_id, center_id, owner_user_id, backup_user_id, assigned_by, assigned_at)
  values (p_household, v_center, p_owner, p_backup, auth.uid(), now())
  on conflict (household_id) do update
    set owner_user_id = excluded.owner_user_id, backup_user_id = excluded.backup_user_id,
        assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at
    where o.owner_user_id is distinct from excluded.owner_user_id or o.backup_user_id is distinct from excluded.backup_user_id;
  return app._care_owner_card(p_household);
end $$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app._care_holder(uuid, uuid), app._care_refuse(uuid), app._care_household_or_raise(uuid),
  app._care_owner_card(uuid) from public, anon, authenticated;
revoke execute on function app.care_view_centers(), app.care_my_households(), app.care_household_can(uuid),
  app.care_holders(uuid), app.set_care_owner(uuid, uuid, uuid, text) from public, anon;
grant execute on function app.care_view_centers(), app.care_my_households(), app.care_household_can(uuid),
  app.care_holders(uuid), app.set_care_owner(uuid, uuid, uuid, text) to authenticated;

comment on function app.care_household_can(uuid) is
  'WeCare (0760): may the caller see and write this household''s care record? care.view / care.manage: every household; care.own: the households they own or back up. Built on app.care_can (0757): no platform-admin branch.';
