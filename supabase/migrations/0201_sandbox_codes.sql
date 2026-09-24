-- Onboarding · stream o-platform · 2 of 4: sandbox codes and redeeming them (ONBOARDING_PLAN §3).
--
--   app.sandbox_codes             one row per issued code: hashed (sha-256 of CC-SBX-XXXX-XXXX), the
--                                 last 4 characters for the console, bound to the contact's email,
--                                 valid 14 days, used once; revoked or re-issued with a reason.
--   app.issue_sandbox_code(req, reason)   platform admins: returns the plain code ONCE and emails it
--                                 (template sandbox_code); re-issuing revokes the request's open code.
--   app.revoke_sandbox_code(id, reason)   platform admins.
--   app.check_sandbox_code(code, ip)      anon, rate-limited: 'valid' | 'expired' | 'used' | 'invalid'.
--   app.sandbox_start_status(code)        the signed-in redeemer's progress through /start.
--   app.accept_sandbox_terms(code, doc, ip, ua)  records the sandbox-terms acceptance on the code
--                                 (the organization does not exist yet); copied to org_agreements on redeem.
--   app.redeem_sandbox_code(code, slug)   authenticated; the email must match, the session must be aal2,
--                                 the phone verified and the sandbox terms accepted. Creates the
--                                 <slug>-sandbox center (environment sandbox, status onboarding) with
--                                 the redeemer as its first administrator and owner.
set client_min_messages = warning;

create table if not exists app.sandbox_codes (
  id                 uuid primary key default gen_random_uuid(),
  request_id         uuid not null references app.access_requests(id),
  code_hash          text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  code_last4         text not null check (code_last4 ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$'),
  email              text not null check (email = lower(email)),
  expires_at         timestamptz not null,
  issued_by          uuid not null references auth.users(id),
  issued_at          timestamptz not null default now(),
  issue_reason       text,
  redeemed_by        uuid references auth.users(id),
  redeemed_at        timestamptz,
  revoked_at         timestamptz,
  revoked_by         uuid references auth.users(id),
  revoke_reason      text,
  center_id          uuid references app.centers(id) on delete set null,
  -- Sandbox terms accepted during /start, before the organization exists.
  terms_document_id  uuid references app.legal_documents(id),
  terms_accepted_by  uuid references auth.users(id),
  terms_accepted_at  timestamptz,
  terms_ip           inet,
  terms_user_agent   text,
  -- queued | not_set_up | failed: <why>
  email_status       text,
  email_message_id   uuid,
  constraint sandbox_codes_redeemed check ((redeemed_at is null) = (redeemed_by is null)),
  constraint sandbox_codes_revoked check ((revoked_at is null) = (revoked_by is null))
);
comment on table app.sandbox_codes is
  'Sandbox codes (ONBOARDING_PLAN §3): hashed, one use, bound to the contact email, 14 days. Written only by the o-platform RPCs.';
create index if not exists sandbox_codes_request_idx on app.sandbox_codes (request_id, issued_at desc);
create index if not exists sandbox_codes_email_idx on app.sandbox_codes (email);

alter table app.sandbox_codes enable row level security;
drop policy if exists sandbox_codes_platform_read on app.sandbox_codes;
create policy sandbox_codes_platform_read on app.sandbox_codes for select to authenticated
  using (app.is_platform_admin());
revoke all on app.sandbox_codes from anon;
revoke insert, update, delete, truncate on app.sandbox_codes from authenticated;
grant select on app.sandbox_codes to authenticated;
grant all on app.sandbox_codes to service_role;
drop trigger if exists audit_sandbox_codes on app.sandbox_codes;
create trigger audit_sandbox_codes after insert or update or delete on app.sandbox_codes
  for each row execute function app.audit_row();
insert into app.module_tables (table_name, module_key) values ('sandbox_codes', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- ── The code itself ──────────────────────────────────────────────────────────
create or replace function app.sandbox_code_alphabet() returns text
language sql immutable set search_path = app, public, extensions as $$ select '23456789ABCDEFGHJKMNPQRSTUVWXYZ'::text $$;

-- CC-SBX-XXXX-XXXX from 31 characters without look-alikes (no 0/O, 1/I/L).
-- Rejection sampling keeps every character equally likely.
create or replace function app.new_sandbox_code() returns text
language plpgsql volatile set search_path = app, public, extensions as $$
declare v_a text := app.sandbox_code_alphabet(); v text := ''; b bytea; i int;
begin
  while length(v) < 8 loop
    b := extensions.gen_random_bytes(16);
    for i in 0 .. 15 loop
      exit when length(v) = 8;
      if get_byte(b, i) < 248 then v := v || substr(v_a, (get_byte(b, i) % 31) + 1, 1); end if;
    end loop;
  end loop;
  return 'CC-SBX-' || substr(v, 1, 4) || '-' || substr(v, 5, 4);
end $$;

-- Accepts any spacing, case and dashes; returns the canonical form or null.
create or replace function app.normalize_sandbox_code(p text) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare v text := upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if v like 'CCSBX%' then v := substr(v, 6); end if;
  if length(v) <> 8 or v !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$' then return null; end if;
  return 'CC-SBX-' || substr(v, 1, 4) || '-' || substr(v, 5, 4);
end $$;

create or replace function app.sandbox_code_hash(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case when app.normalize_sandbox_code(p) is null then null
              else encode(extensions.digest(app.normalize_sandbox_code(p), 'sha256'), 'hex') end
$$;

create or replace function app.sandbox_code_state(c app.sandbox_codes) returns text
language sql stable set search_path = app, public, extensions as $$
  select case when c.id is null then 'invalid'
              when c.redeemed_at is not null then 'used'
              when c.revoked_at is not null then 'revoked'
              when c.expires_at <= now() then 'expired'
              else 'valid' end
$$;

-- ── Issue / revoke (platform admins) ─────────────────────────────────────────
create or replace function app.issue_sandbox_code(p_request uuid, p_reason text)
returns table (code_id uuid, code text, expires_at timestamptz, email_status text)
language plpgsql security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare r app.access_requests; v_code text; v_id uuid; v_exp timestamptz := now() + interval '14 days'; v_mail jsonb;
        v_reason text := coalesce(app.audit_clean_reason(p_reason), 'Sandbox code issued');
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Community Connect team issues sandbox codes.' using errcode = 'insufficient_privilege';
  end if;
  select * into r from app.access_requests where id = p_request for update;
  if r.id is null then raise exception 'That access request was not found.'; end if;
  if r.status <> 'approved' then raise exception 'Approve the request before issuing a sandbox code.'; end if;
  if exists (select 1 from app.sandbox_codes s where s.request_id = p_request and s.redeemed_at is not null) then
    raise exception 'This request''s code was already redeemed, so its sandbox exists. Nothing to re-issue.';
  end if;
  perform app.set_audit_context(v_reason);
  -- Re-issuing: the request's open code stops working.
  update app.sandbox_codes s set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'Re-issued: ' || v_reason
   where s.request_id = p_request and s.redeemed_at is null and s.revoked_at is null and s.expires_at > now();
  loop
    v_code := app.new_sandbox_code();
    exit when not exists (select 1 from app.sandbox_codes s where s.code_hash = app.sandbox_code_hash(v_code));
  end loop;
  v_mail := app.platform_send_message(r.contact_email, 'sandbox_code',
              jsonb_build_object('code', v_code, 'contact_name', r.contact_name, 'org_name', r.org_legal_name,
                                 'expires_at', v_exp, 'start_path', '/start'),
              'sandbox_code');
  insert into app.sandbox_codes (request_id, code_hash, code_last4, email, expires_at, issued_by, issue_reason, email_status, email_message_id)
  values (p_request, app.sandbox_code_hash(v_code), right(v_code, 4), r.contact_email, v_exp, auth.uid(), v_reason,
          app.message_status_text(v_mail), (v_mail->>'message_id')::uuid)
  returning id into v_id;
  return query select v_id, v_code, v_exp, app.message_status_text(v_mail);
end $$;

create or replace function app.revoke_sandbox_code(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.sandbox_codes;
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Community Connect team revokes sandbox codes.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from app.sandbox_codes where id = p_id for update;
  if c.id is null then raise exception 'That sandbox code was not found.'; end if;
  if c.redeemed_at is not null then raise exception 'That code was already redeemed; its sandbox exists. Revoking it now would change nothing.'; end if;
  if c.revoked_at is not null then raise exception 'That code is already revoked.'; end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Give a reason for revoking the code. It goes in the audit log.'; end if;
  perform app.set_audit_context(p_reason);
  update app.sandbox_codes set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = app.audit_clean_reason(p_reason) where id = p_id;
end $$;

-- ── Check (anonymous, rate-limited) ──────────────────────────────────────────
-- Says only whether the code can be used; never whose it is.
create or replace function app.check_sandbox_code(p_code text, p_ip text default null) returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_ip text := coalesce(host(app.caller_ip(p_ip)), 'unknown'); c app.sandbox_codes; v text;
begin
  if app.rate_limited('sandbox_code.all', 'all', interval '1 hour', 500)
     or app.rate_limited('sandbox_code.ip', v_ip, interval '1 hour', 20) then
    raise exception 'Too many codes were tried from this connection. Wait an hour, then try again.' using errcode = 'CCRTE';
  end if;
  perform app.rate_note('sandbox_code.all', 'all');
  perform app.rate_note('sandbox_code.ip', v_ip);
  select * into c from app.sandbox_codes where code_hash = app.sandbox_code_hash(p_code);
  v := app.sandbox_code_state(c);
  -- A revoked code reads as not valid (the contract's three answers plus "invalid").
  return case when v = 'revoked' then 'invalid' else v end;
end $$;

-- ── The redeemer's progress (/start) ─────────────────────────────────────────
create or replace function app.sandbox_start_status(p_code text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.sandbox_codes; r app.access_requests; u record; d app.legal_documents; v_state text; v_slug text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into c from app.sandbox_codes where code_hash = app.sandbox_code_hash(p_code);
  v_state := app.sandbox_code_state(c);
  if v_state = 'revoked' then v_state := 'invalid'; end if;
  if v_state = 'invalid' then return jsonb_build_object('code_status', 'invalid'); end if;
  select lower(email) as email, phone, phone_confirmed_at into u from auth.users where id = auth.uid();
  if coalesce(u.email, '') <> c.email then
    return jsonb_build_object('code_status', v_state, 'email_matches', false, 'code_email', app.mask_contact(c.email, null));
  end if;
  if v_state = 'used' then
    return jsonb_build_object('code_status', 'used', 'email_matches', true,
      'center_slug', (select x.slug::text from app.centers x where x.id = c.center_id and c.redeemed_by = auth.uid()));
  end if;
  select * into r from app.access_requests where id = c.request_id;
  select * into d from app.legal_documents x where x.center_id is null and x.kind = 'sandbox_terms' and x.published_at is not null
   order by x.published_at desc limit 1;
  v_slug := trim(both '-' from left(regexp_replace(lower(r.org_legal_name), '[^a-z0-9]+', '-', 'g'), 40));
  return jsonb_build_object(
    'code_status', v_state, 'email_matches', true, 'org_name', r.org_legal_name, 'expires_at', c.expires_at,
    'phone_verified', u.phone is not null and u.phone <> '' and u.phone_confirmed_at is not null,
    'phone', u.phone,
    'has_totp', app.has_verified_totp(auth.uid()),
    'aal', coalesce(auth.jwt()->>'aal', 'aal1'),
    'terms_published', d.id is not null,
    'terms', case when d.id is null then null else jsonb_build_object('id', d.id, 'title', d.title, 'version', d.version, 'body_md', d.body_md) end,
    'terms_accepted', d.id is not null and c.terms_document_id = d.id and c.terms_accepted_by = auth.uid(),
    'suggested_slug', nullif(v_slug, ''));
end $$;

-- The redeemer must be signed in with the code's email and have finished 2FA.
create or replace function app.sandbox_code_for_redeemer(p_code text) returns app.sandbox_codes
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.sandbox_codes; v_state text; v_email text;
begin
  if auth.uid() is null then raise exception 'Sign in with the email the code was sent to first.' using errcode = 'insufficient_privilege'; end if;
  select * into c from app.sandbox_codes where code_hash = app.sandbox_code_hash(p_code) for update;
  v_state := app.sandbox_code_state(c);
  if v_state in ('invalid','revoked') then raise exception 'That sandbox code is not valid. Check it, or ask Community Connect for a new one.'; end if;
  if v_state = 'used' then raise exception 'That sandbox code has already been used.'; end if;
  if v_state = 'expired' then raise exception 'That sandbox code has expired. Ask Community Connect to re-issue it.'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if coalesce(v_email, '') <> c.email then
    raise exception 'This code was sent to %. Sign out and sign in with that email to use it.', app.mask_contact(c.email, null)
      using errcode = 'insufficient_privilege';
  end if;
  return c;
end $$;

create or replace function app.accept_sandbox_terms(p_code text, p_document uuid, p_ip text default null, p_user_agent text default null)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.sandbox_codes; d app.legal_documents; v_ip inet;
begin
  c := app.sandbox_code_for_redeemer(p_code);
  select * into d from app.legal_documents where id = p_document;
  if d.id is null or d.center_id is not null or d.kind <> 'sandbox_terms' then raise exception 'That is not the Community Connect sandbox terms.'; end if;
  if d.published_at is null then raise exception 'The sandbox terms have not been published yet, so they cannot be accepted.'; end if;
  if exists (select 1 from app.legal_documents n where n.center_id is null and n.kind = 'sandbox_terms'
               and n.published_at is not null and n.published_at > d.published_at) then
    raise exception 'A newer version of the sandbox terms has been published. Reload the page and accept the current version.';
  end if;
  v_ip := app.caller_ip(p_ip);
  perform app.set_audit_context('Accepted ' || d.title || ' (' || d.version || ')');
  update app.sandbox_codes
     set terms_document_id = d.id, terms_accepted_by = auth.uid(), terms_accepted_at = now(), terms_ip = v_ip,
         terms_user_agent = left(coalesce(nullif(btrim(p_user_agent), ''), (select x.user_agent from app.audit_context() x)), 500)
   where id = c.id;
end $$;

-- ── Redeem ───────────────────────────────────────────────────────────────────
create or replace function app.redeem_sandbox_code(p_code text, p_org_slug text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.sandbox_codes; r app.access_requests; u record; d app.legal_documents;
        v_slug text := lower(btrim(coalesce(p_org_slug, ''))); v_center uuid; v_person uuid; v_household uuid;
        v_first text; v_last text; v_claims text; v_claim_sub text; v_reason text; v_user uuid := auth.uid();
begin
  c := app.sandbox_code_for_redeemer(p_code);
  select * into r from app.access_requests where id = c.request_id;
  select email, phone, phone_confirmed_at into u from auth.users where id = auth.uid();
  if not app.is_aal2() or not app.has_verified_totp(auth.uid()) then
    raise exception 'Set up your authenticator app (2FA) before creating the sandbox.' using errcode = 'insufficient_privilege';
  end if;
  if u.phone is null or u.phone = '' or u.phone_confirmed_at is null then
    raise exception 'Verify your mobile number before creating the sandbox.' using errcode = 'insufficient_privilege';
  end if;
  select * into d from app.legal_documents where id = c.terms_document_id;
  if c.terms_accepted_by is distinct from auth.uid() or d.id is null then
    raise exception 'Accept the Community Connect sandbox terms before creating the sandbox.';
  end if;
  if exists (select 1 from app.legal_documents n where n.center_id is null and n.kind = 'sandbox_terms'
               and n.published_at is not null and n.published_at > d.published_at) then
    raise exception 'A newer version of the sandbox terms has been published. Accept the current version, then try again.';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$' or v_slug like '%--%' then
    raise exception 'Choose a web name of 2 to 40 lowercase letters, numbers and single dashes, for example "jain-center-dallas".';
  end if;
  if v_slug ~ '-sandbox$' then raise exception 'Choose the name without "-sandbox"; it is added for you.'; end if;
  if exists (select 1 from app.centers x where lower(x.slug::text) in (v_slug, v_slug || '-sandbox')) then
    raise exception 'The web name "%" is already taken. Choose another.', v_slug;
  end if;

  v_reason := 'Sandbox code …' || c.code_last4 || ' redeemed';
  perform app.set_audit_context(v_reason);
  insert into app.centers (slug, name, state_region, status, environment, rules)
  values (v_slug || '-sandbox', r.org_legal_name, r.state, 'onboarding', 'sandbox',
          jsonb_build_object('security', jsonb_build_object('require_2fa_for_staff', true),
                             'onboarding', jsonb_build_object('source', 'sandbox_code', 'request_id', r.id,
                                                              'production_slug', v_slug,
                                                              'modules_interested', to_jsonb(r.modules_interested))))
  returning id into v_center;

  -- The redeemer: a household and person in the sandbox, linked to their login.
  v_first := split_part(btrim(r.contact_name), ' ', 1);
  v_last := nullif(btrim(substr(btrim(r.contact_name), length(v_first) + 1)), '');
  insert into app.households (center_id, display_name) values (v_center, btrim(r.contact_name) || ' household')
  returning id into v_household;
  insert into app.people (center_id, first_name, last_name, email, phone_e164)
  values (v_center, v_first, coalesce(v_last, ''), lower(u.email), '+' || ltrim(u.phone, '+'))
  returning id into v_person;
  insert into app.household_members (household_id, person_id, center_id, role, is_primary)
  values (v_household, v_person, v_center, 'primary', true);
  insert into app.accounts (user_id) values (auth.uid()) on conflict do nothing;
  insert into app.center_users (center_id, user_id, person_id) values (v_center, auth.uid(), v_person);

  -- First administrator. app.enforce_role_grant refuses a grant to oneself, and
  -- makes a center_admin grant wait for a second approver; here the second
  -- person is the Community Connect admin who issued the code, so the grant is
  -- written as theirs, outside the signed-in session (restored straight after).
  v_claims := current_setting('request.jwt.claims', true);
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', '', true);
  if nullif(v_claim_sub, '') is not null then perform set_config('request.jwt.claim.sub', '', true); end if;
  insert into app.role_grants (center_id, user_id, role_key, scope_kind, granted_by, reason)
  values (v_center, v_user, 'center_admin', 'center', c.issued_by, v_reason);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  if nullif(v_claim_sub, '') is not null then perform set_config('request.jwt.claim.sub', v_claim_sub, true); end if;
  if auth.uid() is distinct from v_user then
    raise exception 'The sandbox could not be created: the session could not be restored. Nothing was saved; try again.';
  end if;
  perform app.ensure_center_owner(v_center);
  if not app.is_center_owner(v_center) then
    raise exception 'The sandbox was not set up correctly: you did not become its owner. Nothing was saved; contact Community Connect.';
  end if;

  insert into app.org_agreements (center_id, kind, version, legal_document_id, accepted_by, accepted_at, ip, user_agent)
  values (v_center, 'sandbox_terms', d.version, d.id, auth.uid(), c.terms_accepted_at, c.terms_ip, c.terms_user_agent);
  insert into app.org_profiles (center_id, legal_name, website) values (v_center, r.org_legal_name, r.website)
  on conflict (center_id) do nothing;
  insert into app.center_setup_steps (center_id, step_key, status, notes, completed_by, completed_at)
  values (v_center, 'org.security', 'done', 'Email, mobile and authenticator app verified when the sandbox was created.', auth.uid(), now())
  on conflict (center_id, step_key) do nothing;

  update app.sandbox_codes set redeemed_by = auth.uid(), redeemed_at = now(), center_id = v_center where id = c.id;
  return jsonb_build_object('center_id', v_center, 'slug', v_slug || '-sandbox');
end $$;

-- ── Access ───────────────────────────────────────────────────────────────────
revoke execute on function app.sandbox_code_alphabet(), app.new_sandbox_code(), app.sandbox_code_hash(text),
  app.sandbox_code_state(app.sandbox_codes), app.sandbox_code_for_redeemer(text) from public, anon, authenticated;
revoke execute on function app.normalize_sandbox_code(text), app.issue_sandbox_code(uuid, text), app.revoke_sandbox_code(uuid, text),
  app.check_sandbox_code(text, text), app.sandbox_start_status(text), app.accept_sandbox_terms(text, uuid, text, text),
  app.redeem_sandbox_code(text, text) from public;
grant execute on function app.normalize_sandbox_code(text), app.check_sandbox_code(text, text) to anon, authenticated;
grant execute on function app.issue_sandbox_code(uuid, text), app.revoke_sandbox_code(uuid, text), app.sandbox_start_status(text),
  app.accept_sandbox_terms(text, uuid, text, text), app.redeem_sandbox_code(text, text) to authenticated;
grant execute on all functions in schema app to service_role;
