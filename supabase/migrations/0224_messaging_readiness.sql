-- Onboarding (stream o-messaging) · 5 of 5: go-live readiness checks 4 and 5
-- (ONBOARDING_PLAN.md Step 8).
--
--   4 email_domain_verified  a verified sending domain, a sign-in or office sender on it, and an
--                            email from it that the provider accepted since then (a test send or a
--                            sign-in code) — "sign-in codes reach any address".
--   5 texting_registered     an approved 10DLC or toll-free registration with its number, or phone
--                            sign-in switched off (centers.rules.security.phone_sign_in = false).
set client_min_messages = warning;

create or replace function app.check_email_domain_verified(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare d app.email_domains; s app.email_senders; v_sent timestamptz; v_pending app.email_domains;
begin
  select * into d from app.email_domains where center_id = p_center and status = 'verified' order by verified_at limit 1;
  if d.id is null then
    select * into v_pending from app.email_domains where center_id = p_center order by created_at desc limit 1;
    if v_pending.id is null then
      return jsonb_build_object('ok', false, 'detail', 'No sending domain yet (Settings › Email).');
    end if;
    return jsonb_build_object('ok', false, 'detail',
      v_pending.domain || ' is ' || case v_pending.status when 'failed' then 'failing its DNS check' else 'waiting for its DNS records' end
      || coalesce(' (last checked ' || to_char(v_pending.last_checked_at at time zone 'UTC', 'FMMonth FMDD, HH24:MI') || ' UTC)', '') || '.');
  end if;
  select * into s from app.email_senders where center_id = p_center and verified and purpose in ('auth','office')
   order by (purpose = 'auth') desc limit 1;
  if s.id is null then
    return jsonb_build_object('ok', false, 'detail', d.domain || ' is verified, but no sign-in or office sender uses it yet (Settings › Email).');
  end if;
  select max(coalesce(delivered_at, sent_at)) into v_sent from app.messages
   where center_id = p_center and channel = 'email' and status in ('sent','delivered') and purpose in ('test','auth_code')
     and coalesce(delivered_at, sent_at) >= d.verified_at;
  if v_sent is null then
    return jsonb_build_object('ok', false, 'detail',
      d.domain || ' is verified and ' || s.from_address || ' is set up. Send a test email (Settings › Email) to prove codes reach any address.');
  end if;
  return jsonb_build_object('ok', true, 'detail',
    d.domain || ' verified; sign-in codes go from ' || s.from_address || '; last delivered ' || to_char(v_sent at time zone 'UTC', 'FMMonth FMDD, YYYY') || '.');
end $$;

create or replace function app.check_texting_registered(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare r app.texting_registrations; v_phone_off boolean;
begin
  select coalesce((rules #>> '{security,phone_sign_in}')::boolean, true) = false into v_phone_off from app.centers where id = p_center;
  select * into r from app.texting_registrations where center_id = p_center and status = 'approved' order by approved_at desc limit 1;
  if r.id is not null then
    return jsonb_build_object('ok', true, 'detail',
      case r.kind when '10dlc' then '10DLC brand and campaign' else 'Toll-free number' end || ' approved'
      || coalesce(' · texts come from ' || (r.detail->>'from_number'), '') || '.');
  end if;
  if v_phone_off then
    return jsonb_build_object('ok', true, 'detail', 'Phone sign-in is switched off, so texting is not needed to go live.');
  end if;
  select * into r from app.texting_registrations where center_id = p_center order by updated_at desc limit 1;
  return jsonb_build_object('ok', false, 'detail', case
    when r.id is null then 'No texting registration yet. Register (Settings › Texting) or switch phone sign-in off.'
    when r.status = 'draft' then 'The texting registration is a draft; submit it (Settings › Texting).'
    when r.status = 'rejected' then 'The texting registration was rejected: ' || coalesce(r.detail->>'reviewer_note', 'see Settings › Texting') || '.'
    else 'Texting registration submitted ' || to_char(r.submitted_at at time zone 'UTC', 'FMMonth FMDD') || '; waiting for the carriers.' end);
end $$;

insert into app.readiness_checks (key, title, sort, check_fn) values
  ('email_domain_verified', 'Email domain verified, and sign-in codes reach any address', 4, 'app.check_email_domain_verified'::regproc),
  ('texting_registered', 'Texting registered, or phone sign-in switched off', 5, 'app.check_texting_registered'::regproc)
on conflict (key) do update set title = excluded.title, sort = excluded.sort, check_fn = excluded.check_fn;

revoke execute on function app.check_email_domain_verified(uuid), app.check_texting_registered(uuid) from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
