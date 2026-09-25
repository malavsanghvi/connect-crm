-- Wave F (stream f-sandbox) · 2 of 4: the organization's owner passes role-based checks.
-- Owner decisions (2026-09-25, second batch): "The owner passes role-based checks
-- (Executive Committee, zone lead, …) except resetting another admin's 2FA."
--
-- 0400 gave the owner every PERMISSION. Some checks ask for a ROLE instead; for the
-- owner of that organization they now pass too:
--   app.has_role / app.has_scoped_role   every "holds role X (for this class, event, zone …)"
--                                        check in the access rules: zone lead, teacher, event
--                                        lead, check-in, kitchen, boli recorder …
--   app.enforce_membership_approval      the Executive Committee decision on a life membership:
--                                        the EC approver holds the Executive Committee role OR is
--                                        the owner. It must still be a DIFFERENT person from the
--                                        one who reviewed it first (two-person rule unchanged).
--   app.is_active_treasurer              the treasurer's approval of the receipt and statement
--                                        templates (readiness check 8).
-- Unchanged on purpose: app.reset_staff_2fa still needs an ACTIVE center_admin grant (a separate
-- administrator) or Community Connect; being the owner is not enough. Two-person rules still
-- compare people, never roles, so the owner never approves their own action.
set client_min_messages = warning;

-- The owner of THIS center (the caller). Used only by the role checks below.
create or replace function app.is_owner_for_roles(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and exists (select 1 from app.center_owners o where o.center_id = p_center and o.user_id = auth.uid())
$$;

create or replace function app.has_role(p_center uuid, variadic p_roles text[]) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.is_platform_admin()
      or app.is_owner_for_roles(p_center)
      or exists (
        select 1 from app.role_grants g
        where g.center_id = p_center and g.user_id = auth.uid()
          and g.role_key = any (p_roles)
          and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
$$;

create or replace function app.has_scoped_role(p_center uuid, p_scope_id uuid, variadic p_roles text[]) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.is_platform_admin()
      or app.is_owner_for_roles(p_center)
      or exists (
        select 1 from app.role_grants g
        where g.center_id = p_center and g.user_id = auth.uid()
          and g.role_key = any (p_roles)
          and (g.scope_kind = 'center' or g.scope_id = p_scope_id)
          and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
$$;

-- 0017 #13, with the owner counted as Executive Committee.
create or replace function app.enforce_membership_approval() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if new.center_decided_by is null then raise exception 'the membership coordinator must review first' using errcode = 'check_violation'; end if;
    if new.tier = 'life' or exists (select 1 from app.membership_types t where t.id = new.membership_type_id and t.ec_approval_required) then
      if new.ec_decided_by is null or new.ec_decided_by = new.center_decided_by then
        raise exception 'life membership needs an Executive Committee approval by a different person' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from app.role_grants g where g.center_id = new.center_id and g.user_id = new.ec_decided_by
                       and g.role_key = 'executive_committee' and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
         and not exists (select 1 from app.center_owners o where o.center_id = new.center_id and o.user_id = new.ec_decided_by) then
        raise exception 'the EC approver must hold the Executive Committee role (or be the organization''s owner)' using errcode = 'check_violation';
      end if;
    end if;
    if new.reference_decision is distinct from 'approved'
       and coalesce((select mt.reference_required from app.membership_types mt where mt.id = new.membership_type_id), true) then
      raise exception 'the named reference has not approved this application' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

-- 0300, with the owner counted as treasurer (a platform admin still does not count).
create or replace function app.is_active_treasurer(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and (
    app.is_owner_for_roles(p_center)
    or exists (
      select 1 from app.role_grants g
       where g.center_id = p_center and g.user_id = auth.uid() and g.role_key = 'treasurer' and g.status = 'active'
         and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())))
$$;

revoke execute on function app.enforce_membership_approval() from public, anon, authenticated;
revoke execute on function app.is_owner_for_roles(uuid) from public, anon;
grant execute on function app.is_owner_for_roles(uuid), app.has_role(uuid, text[]), app.has_scoped_role(uuid, uuid, text[]),
  app.is_active_treasurer(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
