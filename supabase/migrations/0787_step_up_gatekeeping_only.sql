-- 0787 · A fresh 2FA code is asked for only on four gatekeeping actions (owner, 2026-10-14).
--
-- OWNER RULE (2026-10-14, in the owner's words: "switch off 2FA need for all actions once the person has logged in. ONLY action
-- would possibly should have 2FA is when we are creating new sandbox / approving go-live and approving any market place feature
-- addition for an organization"). This replaces the narrower rule of 2026-10-13 (docs/DECISIONS.md), which left some 31 admin
-- actions asking for a code.
--
-- 2FA at SIGN-IN is not touched: the staff sign-in gate (require_2fa_for_staff, app.staff_2fa_required), the authenticator
-- enrolment and the person's own security page all stay. What goes is the second code in the middle of a session.
--
-- THE FOUR ACTIONS THAT STILL ASK FOR A FRESH CODE (app.step_up_required)
--   platform.create_sandbox   a platform admin creates a new sandbox community
--   golive.approve            a platform admin approves a go-live request (the two Community Connect approvals)
--   platform.promote          the owner's promotion of the approved sandbox to production (the last step of go-live)
--   platform.module_grant     a platform admin turns a module on or off for one organization: how a marketplace feature is
--                             added to an organization (app.marketplace_set_product ends here)
--
-- HOW
--   Every fresh-code check in the database goes through app.assert_step_up (a customer organization's actions) or
--   app.assert_platform_step_up (the platform's own), each called with the name of the action. Both now return at once unless
--   app.step_up_required says that action is one of the four. So no call site is edited: a new action added later asks for no
--   code unless it is added to that one list (a new migration). The one check that did not go through them, the Giving export's
--   authenticator / fresh-code / reused-code block (0747), is taken out of app.giving_export_check (its permission, module and
--   data.export checks stay).
--
-- WHAT DOES NOT CHANGE: permissions and roles, the two-person rule (refunds, write-offs, payee changes, the account mapping),
-- reasons where a function asks for one, the audit log, and every money rule. The step-up check is also not the same as the
-- sign-in's authenticator gate: someone who is required to use an authenticator at sign-in still is.
set client_min_messages = warning;

-- ── The one list ─────────────────────────────────────────────────────────────
create or replace function app.step_up_required(p_action text) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(p_action, '') = any (array['platform.create_sandbox', 'golive.approve', 'platform.promote', 'platform.module_grant'])
$$;
comment on function app.step_up_required(text) is
  'Does this action still ask for a fresh 2FA code? Only creating a sandbox, approving go-live, promoting to production and granting a module (a marketplace feature) to an organization do (0787, owner 2026-10-14). The only list of such actions.';

-- ── The two checks: 0150's and 0320's bodies, each with one line added at the top ───────────────────────────
create or replace function app.assert_step_up(p_action text) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_user uuid := auth.uid(); v_has boolean;
begin
  if not app.step_up_required(p_action) then return; end if;   -- 0787: every other action runs without a fresh code
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

create or replace function app.assert_platform_step_up(p_action text) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not app.step_up_required(p_action) then return; end if;   -- 0787: every other platform action runs without a fresh code
  if app.has_recent_step_up(5) then return; end if;
  raise exception using
    errcode = 'CCSTP',
    message = 'This needs a fresh 2FA check.',
    detail  = coalesce(nullif(btrim(p_action), ''), 'platform setup'),
    hint    = case when app.has_verified_totp(auth.uid()) then 'Enter the 6-digit code from your authenticator app, then try again.'
                   else 'Set up an authenticator app in Account › Security, then try again.' end;
end $$;

-- ── The Giving export: 0747's check without its authenticator / fresh-code / reused-code block ──────────────────────
create or replace function app.giving_export_check(p_center uuid, p_list text) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_user uuid := auth.uid(); v_list text := lower(btrim(coalesce(p_list, '')));
begin
  if v_user is null then raise exception 'Sign in to export.' using errcode = 'insufficient_privilege'; end if;
  if v_list not in ('payments', 'pledges', 'bank_lines', 'year_end_totals') then
    raise exception 'Unknown Giving export "%".', p_list using errcode = '22023';
  end if;
  if p_center is null or not exists (select 1 from app.centers c where c.id = p_center) then
    raise exception 'That community was not found.' using errcode = '22023';
  end if;
  perform app.assert_module_enabled(p_center, 'giving');
  if v_list = 'bank_lines' then perform app.assert_module_enabled(p_center, 'giving_bank'); end if;
  if v_list = 'year_end_totals' then perform app.assert_module_enabled(p_center, 'giving_statements'); end if;
  if not app.has_permission(p_center, 'data.export') then
    raise exception 'Exporting needs the data-export permission (data.export).' using errcode = '42501';
  end if;
  if not (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.manage')
          or (v_list = 'bank_lines' and app.has_permission(p_center, 'giving.record_offline'))) then
    raise exception 'Exporting this list needs permission to see it.' using errcode = '42501';
  end if;
end $$;
comment on function app.giving_export_check(uuid, text) is
  'Can the caller export this Giving list now (data.export + the list''s read permission, modules)? No fresh 2FA code since 0787 (owner 2026-10-14). Writes nothing (0747).';

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app.step_up_required(text) from public, anon, authenticated;
