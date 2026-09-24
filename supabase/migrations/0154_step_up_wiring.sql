-- 0154 (stream o-security) · the sensitive actions now need a fresh 2FA check.
--
-- ONBOARDING_CONTRACT: every stream calls app.assert_step_up('<action>') for
-- credentials, exports, role grants, refunds and write-offs, the month lock,
-- module switches, deleting data and promotion. This migration wires it into
-- the actions that exist today. It is enforced where the change is WRITTEN
-- (a BEFORE trigger), so it holds whichever route makes the change — the
-- RPC (set_module_enabled, approve_role_grant, approve_as_second, merge_people,
-- merge_households) or a direct table write from a Server Action:
--
--   role_grants        insert / update / delete                 'roles.grant'
--   center_modules     insert / update (set_module_enabled)     'modules.switch'
--   pledges            write-off requested, approved, completed 'giving.write_off'
--   payments           refund requested, approved, recorded     'giving.refund'
--   accounting_periods month locked or unlocked                 'accounting.month_lock'
--   people, households merged_into_id set (a merge)             'people.merge'
--   centers            security.require_2fa_for_staff switched off 'security.policy'
--   exports            app.record_export(center, kind, detail)  'export.<kind>'
--
-- Withdrawing a request, or any change made without a signed-in user (service
-- role, webhooks, workers), is unaffected. The permission checks, the two-person
-- rule and the money rules are unchanged: this only adds a condition.

create or replace function app.step_up_role_grants() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  -- The invitee accepting an invitation: the inviter passed the check when inviting.
  if tg_op = 'INSERT' and new.user_id = auth.uid()
     and app.invitation_grant_in_progress(new.center_id, new.user_id, new.role_key) is not null then
    return new;
  end if;
  perform app.assert_step_up('roles.grant');
  return coalesce(new, old);
end $$;
drop trigger if exists role_grants_step_up on app.role_grants;
create trigger role_grants_step_up before insert or update or delete on app.role_grants
  for each row execute function app.step_up_role_grants();

create or replace function app.step_up_center_modules() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if tg_op = 'INSERT' or new.enabled is distinct from old.enabled then
    perform app.assert_step_up('modules.switch');
  end if;
  return new;
end $$;
drop trigger if exists center_modules_step_up on app.center_modules;
create trigger center_modules_step_up before insert or update on app.center_modules
  for each row execute function app.step_up_center_modules();

create or replace function app.step_up_pledges() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if (new.written_off_by is not null and new.written_off_by is distinct from old.written_off_by)
     or (new.written_off_second_approver is not null and new.written_off_second_approver is distinct from old.written_off_second_approver)
     or (new.status = 'written_off' and old.status is distinct from 'written_off') then
    perform app.assert_step_up('giving.write_off');
  end if;
  return new;
end $$;
drop trigger if exists pledges_step_up on app.pledges;
create trigger pledges_step_up before update on app.pledges
  for each row execute function app.step_up_pledges();

create or replace function app.step_up_payments() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if (new.refund_approved_by is not null and new.refund_approved_by is distinct from old.refund_approved_by)
     or (new.refund_second_approver is not null and new.refund_second_approver is distinct from old.refund_second_approver)
     or new.refunded_cents > coalesce(old.refunded_cents, 0) then
    perform app.assert_step_up('giving.refund');
  end if;
  return new;
end $$;
drop trigger if exists payments_step_up on app.payments;
create trigger payments_step_up before update on app.payments
  for each row execute function app.step_up_payments();

create or replace function app.step_up_accounting_periods() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if (new.status = 'closed' and (tg_op = 'INSERT' or old.status is distinct from 'closed'))
     or (tg_op = 'UPDATE' and old.status = 'closed' and new.status is distinct from 'closed') then
    perform app.assert_step_up('accounting.month_lock');
  end if;
  return new;
end $$;
drop trigger if exists accounting_periods_step_up on app.accounting_periods;
create trigger accounting_periods_step_up before insert or update on app.accounting_periods
  for each row execute function app.step_up_accounting_periods();

create or replace function app.step_up_merge() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.merged_into_id is not null and old.merged_into_id is null then
    perform app.assert_step_up('people.merge');
  end if;
  return new;
end $$;
drop trigger if exists people_step_up_merge on app.people;
create trigger people_step_up_merge before update of merged_into_id on app.people
  for each row execute function app.step_up_merge();
drop trigger if exists households_step_up_merge on app.households;
create trigger households_step_up_merge before update of merged_into_id on app.households
  for each row execute function app.step_up_merge();

-- Switching the staff 2FA rule OFF loosens every staff session: it needs a check.
create or replace function app.step_up_security_policy() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_old boolean; v_new boolean;
begin
  v_old := coalesce(case when jsonb_typeof(old.rules #> '{security,require_2fa_for_staff}') = 'boolean'
                         then (old.rules #>> '{security,require_2fa_for_staff}')::boolean end, true);
  v_new := coalesce(case when jsonb_typeof(new.rules #> '{security,require_2fa_for_staff}') = 'boolean'
                         then (new.rules #>> '{security,require_2fa_for_staff}')::boolean end, true);
  if v_old and not v_new then
    perform app.assert_step_up('security.policy');
  end if;
  return new;
end $$;
drop trigger if exists centers_step_up_security on app.centers;
create trigger centers_step_up_security before update of rules on app.centers
  for each row execute function app.step_up_security_policy();

-- Exports: the Server Action / route that builds a file calls this first. It
-- checks the caller is staff (or platform), asks for a fresh 2FA check and
-- writes an export.<kind> audit entry with the detail (row counts, filters —
-- never the data).
create or replace function app.record_export(p_center uuid, p_kind text, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_kind text := lower(btrim(coalesce(p_kind, '')));
begin
  if auth.uid() is null then raise exception 'Sign in to export.' using errcode = 'insufficient_privilege'; end if;
  if v_kind !~ '^[a-z][a-z0-9_.]{1,60}$' then raise exception 'Unknown export "%".', p_kind; end if;
  if not (app.is_staff_of(p_center) or app.is_platform_admin()) then
    raise exception 'Exports are for this community''s staff.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_step_up('export.' || v_kind);
  perform app.log_audit(p_center, 'export.' || v_kind, null, null, null, coalesce(p_detail, '{}'::jsonb), null);
end $$;

revoke execute on function app.step_up_role_grants(), app.step_up_center_modules(), app.step_up_pledges(), app.step_up_payments(),
  app.step_up_accounting_periods(), app.step_up_merge(), app.step_up_security_policy() from public, anon, authenticated;
revoke execute on function app.record_export(uuid, text, jsonb) from public, anon;
grant execute on function app.record_export(uuid, text, jsonb) to authenticated;
grant execute on all functions in schema app to service_role;
