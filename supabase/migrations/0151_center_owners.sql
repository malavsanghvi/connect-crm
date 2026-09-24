-- 0151 (stream o-security) · the organization owner.
--
-- ONBOARDING_CONTRACT "Owner": one owner per community, on top of center_admin.
-- The owner accepts the agreements, transfers ownership and (later) requests
-- go-live and promotion. Ownership can be transferred, never just removed.
--
--   app.center_owners(center_id pk, user_id, since, transferred_from)
--   app.is_center_owner(p_center)
--   app.transfer_ownership(p_center, p_to_user, p_reason)   needs a fresh 2FA check
--
-- Seeding: a community without an owner gets its first administrator — the
-- earliest active center_admin grant — as owner, now (for JSH) and whenever its
-- first center_admin grant becomes active later (a new community). A community
-- with no administrator stays without an owner; the readiness check
-- `owner_admins_2fa` says so until one exists.

create table if not exists app.center_owners (
  center_id        uuid primary key references app.centers(id) on delete cascade,
  user_id          uuid not null references auth.users(id),
  since            timestamptz not null default now(),
  transferred_from uuid references auth.users(id)
);
create index if not exists center_owners_user_idx on app.center_owners (user_id);

alter table app.center_owners enable row level security;
-- Members of the community see who its owner is; platform admins see all.
drop policy if exists center_owners_read on app.center_owners;
create policy center_owners_read on app.center_owners for select to authenticated
  using (user_id = auth.uid() or app.is_member_of(center_id) or app.has_permission(center_id, 'settings.manage'));
-- No write policies: written only by transfer_ownership and the seeding below.
revoke insert, update, delete, truncate on app.center_owners from anon, authenticated;
grant select on app.center_owners to authenticated;
grant all on app.center_owners to service_role;

drop trigger if exists audit_center_owners on app.center_owners;
create trigger audit_center_owners after insert or update or delete on app.center_owners
  for each row execute function app.audit_row('center_id');
insert into app.module_tables (table_name, module_key) values ('center_owners', null) on conflict (table_name) do nothing;

create or replace function app.is_center_owner(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and exists (select 1 from app.center_owners o where o.center_id = p_center and o.user_id = auth.uid())
$$;

-- An active center-wide center_admin grant.
create or replace function app.is_center_admin_user(p_center uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.role_grants g
                  where g.center_id = p_center and g.user_id = p_user and g.role_key = 'center_admin'
                    and g.scope_kind = 'center' and g.status = 'active'
                    and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
$$;

-- The earliest active center_admin becomes owner when there is none. Idempotent.
create or replace function app.ensure_center_owner(p_center uuid) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_user uuid;
begin
  select user_id into v_user from app.center_owners where center_id = p_center;
  if v_user is not null then return v_user; end if;
  select g.user_id into v_user from app.role_grants g
   where g.center_id = p_center and g.role_key = 'center_admin' and g.scope_kind = 'center' and g.status = 'active'
     and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
   order by g.starts_at, g.created_at, g.id limit 1;
  if v_user is null then return null; end if;
  insert into app.center_owners (center_id, user_id) values (p_center, v_user) on conflict (center_id) do nothing;
  return (select user_id from app.center_owners where center_id = p_center);
end $$;

select app.ensure_center_owner(id) from app.centers;

create or replace function app.center_owner_on_admin_grant() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.role_key = 'center_admin' and new.status = 'active' and new.starts_at <= now()
     and not exists (select 1 from app.center_owners where center_id = new.center_id) then
    perform app.ensure_center_owner(new.center_id);
  end if;
  return null;
end $$;
drop trigger if exists role_grants_zz_owner on app.role_grants;
create trigger role_grants_zz_owner after insert or update of status, starts_at on app.role_grants
  for each row execute function app.center_owner_on_admin_grant();

-- Transfer: by the owner (or a platform admin), to an active center_admin of
-- the same community, with a reason and a fresh 2FA check.
create or replace function app.transfer_ownership(p_center uuid, p_to_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare o app.center_owners;
begin
  if auth.uid() is null then raise exception 'Sign in to transfer ownership.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then raise exception 'That community was not found.'; end if;
  select * into o from app.center_owners where center_id = p_center for update;
  if not (app.is_platform_admin() or (o.user_id is not null and o.user_id = auth.uid())) then
    raise exception 'Only the owner of this community can transfer ownership.' using errcode = 'insufficient_privilege';
  end if;
  if p_to_user is null then raise exception 'Choose who becomes the owner.'; end if;
  if o.user_id = p_to_user then raise exception 'That person is already the owner.'; end if;
  if not app.is_center_admin_user(p_center, p_to_user) then
    raise exception 'The new owner must be an active administrator (center_admin) of this community. Grant the role first; it needs a second approver.';
  end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Give a reason for the transfer. It goes in the audit log.';
  end if;
  perform app.assert_step_up('ownership.transfer');
  perform app.set_audit_context(p_reason);
  if o.center_id is null then
    insert into app.center_owners (center_id, user_id) values (p_center, p_to_user);
  else
    update app.center_owners set user_id = p_to_user, since = now(), transferred_from = o.user_id where center_id = p_center;
  end if;
end $$;

-- Staff and their security state, for Settings › Team and the readiness check.
-- Readable by people who manage roles or settings in the community, and platform admins.
create or replace function app.team_security(p_center uuid)
returns table (user_id uuid, person_id uuid, name text, email text, roles text[], has_totp boolean,
               phone_verified boolean, is_owner boolean, is_admin boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not (app.has_permission(p_center, 'roles.manage') or app.has_permission(p_center, 'settings.manage') or app.is_platform_admin()) then
    raise exception 'Seeing the team''s 2FA status needs roles.manage or settings.manage.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select g.user_id, cu.person_id,
           coalesce(nullif(btrim(coalesce(nullif(p.preferred_name, ''), p.first_name) || ' ' || p.last_name), ''), u.email::text, 'Unknown person'),
           u.email::text,
           array_agg(distinct g.role_key order by g.role_key),
           app.has_verified_totp(g.user_id),
           (u.phone is not null and u.phone <> '' and u.phone_confirmed_at is not null),
           exists (select 1 from app.center_owners o where o.center_id = p_center and o.user_id = g.user_id),
           bool_or(g.role_key = 'center_admin' and g.scope_kind = 'center')
      from app.role_grants g
      join app.roles r on r.key = g.role_key and r.tier <> 'family'
      join auth.users u on u.id = g.user_id
      left join app.center_users cu on cu.center_id = g.center_id and cu.user_id = g.user_id
      left join app.people p on p.id = cu.person_id
     where g.center_id = p_center and g.status = 'active' and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
     group by g.user_id, cu.person_id, p.preferred_name, p.first_name, p.last_name, u.email, u.phone, u.phone_confirmed_at
     order by 3;
end $$;

revoke execute on function app.is_center_owner(uuid), app.is_center_admin_user(uuid, uuid), app.ensure_center_owner(uuid),
  app.center_owner_on_admin_grant(), app.transfer_ownership(uuid, uuid, text), app.team_security(uuid) from public, anon;
grant execute on function app.is_center_owner(uuid), app.transfer_ownership(uuid, uuid, text), app.team_security(uuid) to authenticated;
revoke execute on function app.is_center_admin_user(uuid, uuid), app.ensure_center_owner(uuid), app.center_owner_on_admin_grant() from authenticated;
grant execute on all functions in schema app to service_role;
