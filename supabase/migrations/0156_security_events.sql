-- 0156 (stream o-security) · 2FA and phone changes in the app audit log.
--
-- Supabase Auth records factor and phone changes in its own log
-- (auth.audit_log_entries), which the portal's audit screens do not read. The
-- portal calls app.record_security_event after each change so the community's
-- audit log shows it too. The event is checked against the real state before
-- it is written (a caller cannot log an enrolment that did not happen), and
-- nothing secret is recorded.
--
--   mfa.enrolled       the caller now has a verified authenticator app
--   mfa.removed        the caller removed one (count after)
--   phone.verified     the caller's phone was confirmed in the last 15 minutes
--   sessions.revoked   the caller signed out everywhere

create or replace function app.record_security_event(p_center uuid, p_event text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_user uuid := auth.uid(); u record; v_n int;
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if not (app.is_member_of(p_center) or app.is_staff_of(p_center, v_user)) then
    raise exception 'You are not part of this community.' using errcode = 'insufficient_privilege';
  end if;
  select count(*) into v_n from auth.mfa_factors f where f.user_id = v_user and f.factor_type::text = 'totp' and f.status::text = 'verified';
  select phone, phone_confirmed_at into u from auth.users where id = v_user;
  case p_event
    when 'mfa.enrolled' then
      if v_n = 0 then raise exception 'No authenticator app is set up, so there is nothing to record.'; end if;
    when 'mfa.removed', 'sessions.revoked' then
      null;
    when 'phone.verified' then
      if u.phone_confirmed_at is null or u.phone_confirmed_at < now() - interval '15 minutes' then
        raise exception 'The phone number has not been verified just now, so there is nothing to record.';
      end if;
    else
      raise exception 'Unknown security event "%".', p_event;
  end case;
  perform app.log_audit(p_center, 'security.' || p_event, 'users', v_user::text, null,
    jsonb_build_object('authenticator_apps', v_n,
                       'phone', case when p_event = 'phone.verified' then left(u.phone, 1) || '•••' || right(u.phone, 4) end),
    null);
end $$;

revoke execute on function app.record_security_event(uuid, text) from public, anon;
grant execute on function app.record_security_event(uuid, text) to authenticated;
grant execute on all functions in schema app to service_role;
