-- Wave E (stream e-access) · 1 of 2: the organization owner can do every task, and
-- Community Connect's approval of an organization's first second administrator is named
-- in the audit. Owner decisions batch 2026-09-25, items (1) and (2) (docs/DECISIONS.md).
--
-- (2) app.has_permission(center, key) is true for the center's owner (app.is_center_owner)
--     for EVERY permission key, giving / accounting / privacy included. Center admins keep
--     exactly the permissions of their roles (no giving.manage, no accounting.*, no
--     privacy.manage). The two-person rules are untouched: they compare the two people
--     (enforce_two_person, approve_as_second, approve_role_grant), never their permissions,
--     so the owner still cannot approve their own refund, write-off, override or grant.
--     Because the owner now holds every permission, the owner also counts as staff for the
--     2FA rules (is_staff_of, staff_2fa_required): holding more rights never means fewer checks.
--
-- (1) When a platform admin (Community Connect) approves a pending center_admin grant and the
--     organization has no other active administrator besides the owner (the first second
--     admin), the audit row of the approval carries the platform admin as actor and the reason
--     "Community Connect approval (two-person rule, first second admin)". Until B5 replaces
--     this with an explicit grant that names both approvers.

create or replace function app.has_permission(p_center uuid, p_perm text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.is_platform_admin()
      or app.is_center_owner(p_center)
      or exists (
        select 1 from app.role_grants g
        join app.roles r on r.key = g.role_key
        where g.center_id = p_center and g.user_id = auth.uid()
          and g.scope_kind in ('center','platform','pathshala','store')
          and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
          and (r.permissions ? p_perm or r.permissions ? '*'))
$$;

-- Staff for the 2FA rules: any active role grant in the community, or its owner.
create or replace function app.is_staff_of(p_center uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.role_grants g join app.roles r on r.key = g.role_key
                  where g.center_id = p_center and g.user_id = p_user and r.tier <> 'family'
                    and g.status = 'active' and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
      or exists (select 1 from app.center_owners o where o.center_id = p_center and o.user_id = p_user)
$$;

create or replace function app.staff_2fa_required(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.role_grants g join app.roles r on r.key = g.role_key
                  where g.user_id = p_user and r.tier <> 'family' and g.status = 'active'
                    and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
                    and app.require_2fa_for_staff(g.center_id))
      or exists (select 1 from app.center_owners o where o.user_id = p_user and app.require_2fa_for_staff(o.center_id))
$$;

-- The reason Community Connect's approval of the first second administrator is recorded with.
create or replace function app.cc_first_admin_reason() returns text
language sql immutable set search_path = app, public, extensions as $$
  select 'Community Connect approval (two-person rule, first second admin)'::text
$$;

-- True when approving this grant would give the organization its first administrator besides
-- the owner: a center_admin grant, and no other active center_admin who is not the owner.
create or replace function app.is_first_second_admin_grant(p_grant uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (
    select 1 from app.role_grants g
     where g.id = p_grant and g.role_key = 'center_admin'
       and not exists (
         select 1 from app.role_grants o
          where o.center_id = g.center_id and o.role_key = 'center_admin' and o.status = 'active'
            and o.starts_at <= now() and (o.ends_at is null or o.ends_at > now())
            and o.user_id <> g.user_id
            and o.user_id is distinct from (select w.user_id from app.center_owners w where w.center_id = g.center_id)))
$$;

-- Two-person rule for role grants (0017), unchanged, plus the named approval for (1).
create or replace function app.approve_role_grant(p_grant uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.role_grants;
begin
  select * into g from app.role_grants where id = p_grant for update;
  if g.id is null or g.status <> 'pending' then raise exception 'no pending grant to approve'; end if;
  if not app.has_permission(g.center_id, 'roles.manage') then raise exception 'not allowed to approve role grants'; end if;
  if g.granted_by = auth.uid() or g.user_id = auth.uid() then raise exception 'a second, different person must approve this grant'; end if;
  if app.is_platform_admin() and app.is_first_second_admin_grant(p_grant) then
    -- Wins over the request's x-audit-reason for the rest of this transaction (0100).
    perform set_config('app.audit_reason', app.cc_first_admin_reason(), true);
  end if;
  update app.role_grants set status = 'active', second_approver = auth.uid(), starts_at = now() where id = p_grant;
end $$;

revoke execute on function app.is_first_second_admin_grant(uuid) from public, anon;
grant execute on function app.cc_first_admin_reason(), app.is_first_second_admin_grant(uuid) to authenticated;
grant execute on function app.approve_role_grant(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
