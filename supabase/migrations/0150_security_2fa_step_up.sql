-- 0150 (stream o-security) · 2FA and step-up, checked by the database.
--
-- ONBOARDING_CONTRACT "Security": a staff session proves a second factor with an
-- authenticator app (Supabase Auth MFA, TOTP). The session's assurance level
-- (`aal`) and the times of its sign-in methods (`amr`) travel in the JWT, so the
-- database can refuse a sensitive change that was not preceded by a fresh 2FA
-- check, whatever app sent it.
--
--   app.is_aal2()                      the session finished 2FA (aal2)
--   app.has_recent_step_up(minutes=5)  the JWT's amr has a `totp` entry that recent
--   app.assert_step_up(action)         raises SQLSTATE CCSTP "This needs a fresh 2FA check."
--
-- When assert_step_up asks for a check (the rules, in order):
--   1. No signed-in user (service role, workers, migrations): never.
--   2. A totp check in the last 5 minutes: passes.
--   3. The user has a verified authenticator app: asks (they can always answer).
--   4. The user is staff of a community whose `security.require_2fa_for_staff`
--      rule is on (the default for new communities): asks; the hint sends them to
--      set up an authenticator app first.
--   5. Otherwise (staff of a community that has not switched the rule on yet —
--      JSH until its staff have enrolled): passes, exactly as before.
-- So the change only ever tightens: nobody who could act before is let through
-- more easily, and everyone who has set up 2FA must use it for these actions.

-- ── The community rule ───────────────────────────────────────────────────────

-- security.require_2fa_for_staff: true unless the community set it to false.
create or replace function app.require_2fa_for_staff(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select case when jsonb_typeof(c.rules #> '{security,require_2fa_for_staff}') = 'boolean'
                               then (c.rules #>> '{security,require_2fa_for_staff}')::boolean end
                     from app.centers c where c.id = p_center), true)
$$;

-- Communities that exist today keep working as they do until their staff have
-- enrolled: the rule is recorded as off. New communities get the default (on).
update app.centers
   set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{security}',
                         coalesce(rules->'security', '{}'::jsonb) || '{"require_2fa_for_staff": false}'::jsonb)
 where rules #> '{security,require_2fa_for_staff}' is null;

-- Staff = any active role grant in the community (center-wide or scoped; family
-- roles are derived, never granted).
create or replace function app.is_staff_of(p_center uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.role_grants g join app.roles r on r.key = g.role_key
                  where g.center_id = p_center and g.user_id = p_user and r.tier <> 'family'
                    and g.status = 'active' and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
$$;

-- Communities where this user is staff and 2FA is required.
create or replace function app.staff_2fa_required(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.role_grants g join app.roles r on r.key = g.role_key
                  where g.user_id = p_user and r.tier <> 'family' and g.status = 'active'
                    and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
                    and app.require_2fa_for_staff(g.center_id))
$$;

-- A verified authenticator app (Supabase Auth keeps factors in auth.mfa_factors).
create or replace function app.has_verified_totp(p_user uuid default auth.uid()) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if p_user is null then return false; end if;
  return exists (select 1 from auth.mfa_factors f
                  where f.user_id = p_user and f.factor_type::text = 'totp' and f.status::text = 'verified');
end $$;

-- ── The session ──────────────────────────────────────────────────────────────

create or replace function app.is_aal2() returns boolean
language sql stable set search_path = app, public, extensions as $$
  select coalesce(auth.jwt()->>'aal', '') = 'aal2'
$$;

-- The JWT's amr is [{"method":"totp","timestamp":<unix seconds>}, …]; GoTrue
-- refreshes the totp timestamp each time the user passes a new challenge.
create or replace function app.has_recent_step_up(p_minutes int default 5) returns boolean
language sql stable set search_path = app, public, extensions as $$
  select app.is_aal2() and exists (
    select 1
      from jsonb_array_elements(case when jsonb_typeof(auth.jwt()->'amr') = 'array' then auth.jwt()->'amr' else '[]'::jsonb end) a
     where jsonb_typeof(a) = 'object' and a->>'method' = 'totp'
       and coalesce(a->>'timestamp', '') ~ '^[0-9]+(\.[0-9]+)?$'
       and (a->>'timestamp')::numeric >= extract(epoch from now()) - greatest(coalesce(p_minutes, 5), 0) * 60
       -- a little clock skew between the sign-in service and the database is fine
       and (a->>'timestamp')::numeric <= extract(epoch from now()) + 120)
$$;

create or replace function app.assert_step_up(p_action text) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_user uuid := auth.uid(); v_has boolean;
begin
  if v_user is null then return; end if;
  if app.has_recent_step_up(5) then return; end if;
  v_has := app.has_verified_totp(v_user);
  if v_has or app.staff_2fa_required(v_user) then
    raise exception using
      errcode = 'CCSTP',
      message = 'This needs a fresh 2FA check.',
      detail  = coalesce(nullif(btrim(p_action), ''), 'sensitive action'),
      hint    = case when v_has then 'Enter the 6-digit code from your authenticator app, then try again.'
                     else 'Set up an authenticator app in Account › Security, then try again.' end;
  end if;
end $$;

-- ── What the portal needs to route a session ─────────────────────────────────

-- Only the caller's own state; nothing about anyone else.
create or replace function app.my_security_status(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_user uuid := auth.uid(); u record; v_staff boolean;
begin
  if v_user is null then return null; end if;
  select email, phone, phone_confirmed_at into u from auth.users where id = v_user;
  v_staff := app.is_staff_of(p_center, v_user);
  return jsonb_build_object(
    'aal', coalesce(auth.jwt()->>'aal', 'aal1'),
    'has_totp', app.has_verified_totp(v_user),
    'totp_factors', (select count(*) from auth.mfa_factors f where f.user_id = v_user and f.factor_type::text = 'totp' and f.status::text = 'verified'),
    'phone', u.phone,
    'phone_verified', u.phone is not null and u.phone <> '' and u.phone_confirmed_at is not null,
    'is_staff', v_staff,
    'is_platform_admin', app.is_platform_admin(),
    'policy_requires_2fa', app.require_2fa_for_staff(p_center),
    'required', v_staff and app.require_2fa_for_staff(p_center),
    'step_up_fresh', app.has_recent_step_up(5));
end $$;

-- ── Lost phone: the second administrator, or the platform team ──────────────
--
-- Removes every authenticator app of a staff member and signs them out
-- everywhere; they sign in again with an emailed code and set up a new app.
-- The caller must be a different person, hold roles.manage AND an active
-- center_admin grant in the community (the "second admin"), or be a platform
-- admin; they need a fresh 2FA check themselves, and a reason. Audited as
-- security.reset_2fa (the factor count only; no secrets).
create or replace function app.reset_staff_2fa(p_center uuid, p_user uuid, p_reason text)
returns integer language plpgsql security definer set search_path = app, public, extensions as $$
declare v_n integer; v_platform boolean := app.is_platform_admin();
begin
  if auth.uid() is null then raise exception 'Sign in to reset someone''s 2FA.' using errcode = 'insufficient_privilege'; end if;
  if p_user is null or p_center is null then raise exception 'Choose the person whose 2FA should be reset.'; end if;
  if p_user = auth.uid() then
    raise exception 'You cannot reset your own 2FA. Ask another administrator, or the Community Connect team.'
      using errcode = 'insufficient_privilege';
  end if;
  if not v_platform and not (app.has_permission(p_center, 'roles.manage') and exists (
      select 1 from app.role_grants g where g.center_id = p_center and g.user_id = auth.uid() and g.role_key = 'center_admin'
         and g.status = 'active' and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))) then
    raise exception 'Only another administrator of this community, or the Community Connect team, can reset 2FA.'
      using errcode = 'insufficient_privilege';
  end if;
  if not v_platform and not app.is_staff_of(p_center, p_user) then
    raise exception 'That person is not on this community''s staff.';
  end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Give a reason for the reset (for example "lost phone, identity checked in person"). It goes in the audit log.';
  end if;
  perform app.assert_step_up('security.reset_2fa');

  select count(*) into v_n from auth.mfa_factors where user_id = p_user;
  delete from auth.mfa_factors where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
  perform app.set_audit_context(p_reason);
  perform app.log_audit(p_center, 'security.reset_2fa', 'mfa_factors', p_user::text,
                        jsonb_build_object('factors', v_n), jsonb_build_object('factors', 0, 'signed_out', true), p_reason);
  return v_n;
end $$;

-- ── Access ───────────────────────────────────────────────────────────────────
revoke execute on function app.require_2fa_for_staff(uuid), app.is_staff_of(uuid, uuid), app.staff_2fa_required(uuid),
  app.has_verified_totp(uuid), app.is_aal2(), app.has_recent_step_up(int), app.assert_step_up(text),
  app.my_security_status(uuid), app.reset_staff_2fa(uuid, uuid, text) from public, anon;
grant execute on function app.require_2fa_for_staff(uuid), app.is_aal2(), app.has_recent_step_up(int), app.assert_step_up(text),
  app.my_security_status(uuid), app.reset_staff_2fa(uuid, uuid, text) to authenticated;
-- Internal helpers (they take any user id): not callable from the apps.
revoke execute on function app.is_staff_of(uuid, uuid), app.staff_2fa_required(uuid), app.has_verified_totp(uuid) from authenticated;
grant execute on all functions in schema app to service_role;
