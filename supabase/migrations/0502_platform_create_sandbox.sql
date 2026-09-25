-- Wave F (stream f-sandbox) · 3 of 4: Community Connect's super admin creates a sandbox directly.
-- Owner decisions (2026-09-25, second batch): "Community Connect's super admin can create
-- further sandboxes directly."
--
--   app._create_sandbox_center(...)   the center-creation part of app.redeem_sandbox_code
--                                     (0201), now shared: web name rules, the <slug>-sandbox
--                                     center (environment sandbox, status onboarding, staff 2FA
--                                     on), its organization profile. The join code comes from
--                                     the centers trigger (0161); modules start all on; the
--                                     Setup checklist is computed from the data (0181/0302).
--   app.redeem_sandbox_code(...)      unchanged behaviour, now calling the shared part.
--   app.staff_invitations.makes_owner an invitation that makes the person who accepts it the
--                                     organization's owner (only when it has none). Only
--                                     app.platform_create_sandbox writes it.
--   app.accept_invitation(token)      0152 plus the owner designation; returns "owner".
--   app.platform_create_sandbox(...)  platform admin + fresh 2FA check + reason: creates the
--                                     sandbox, invites its owner (center_admin; the grant waits
--                                     for a second person as every administrator grant does —
--                                     the owner already holds every permission as owner, 0400)
--                                     and emails the link through messaging when it is set up;
--                                     the console always shows the link to send by hand. Audited.
set client_min_messages = warning;

-- ── Shared center creation ───────────────────────────────────────────────────
create or replace function app._create_sandbox_center(p_base_slug text, p_name text, p_state text, p_city text,
                                                      p_website text, p_onboarding jsonb) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_slug text := lower(btrim(coalesce(p_base_slug, ''))); v_center uuid;
begin
  if v_slug !~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$' or v_slug like '%--%' then
    raise exception 'Choose a web name of 2 to 40 lowercase letters, numbers and single dashes, for example "jain-center-dallas".';
  end if;
  if v_slug ~ '-sandbox$' then raise exception 'Choose the name without "-sandbox"; it is added for you.'; end if;
  if exists (select 1 from app.centers x where lower(x.slug::text) in (v_slug, v_slug || '-sandbox')) then
    raise exception 'The web name "%" is already taken. Choose another.', v_slug;
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Enter the organization''s name.'; end if;
  insert into app.centers (slug, name, state_region, status, environment, rules)
  values (v_slug || '-sandbox', btrim(p_name), nullif(btrim(coalesce(p_state, '')), ''), 'onboarding', 'sandbox',
          jsonb_build_object('security', jsonb_build_object('require_2fa_for_staff', true),
                             'onboarding', jsonb_build_object('production_slug', v_slug) || coalesce(p_onboarding, '{}'::jsonb)))
  returning id into v_center;
  insert into app.org_profiles (center_id, legal_name, website, registered_address)
  values (v_center, btrim(p_name), nullif(btrim(coalesce(p_website, '')), ''),
          case when nullif(btrim(coalesce(p_city, '')), '') is null then null
               else jsonb_build_object('city', btrim(p_city), 'state', nullif(btrim(coalesce(p_state, '')), '')) end)
  on conflict (center_id) do nothing;
  return v_center;
end $$;

-- ── Redeem (0201), creating the center through the shared part ───────────────
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

  v_reason := 'Sandbox code …' || c.code_last4 || ' redeemed';
  perform app.set_audit_context(v_reason);
  v_center := app._create_sandbox_center(v_slug, r.org_legal_name, r.state, null, r.website,
                jsonb_build_object('source', 'sandbox_code', 'request_id', r.id,
                                   'modules_interested', to_jsonb(r.modules_interested)));

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
  insert into app.center_setup_steps (center_id, step_key, status, notes, completed_by, completed_at)
  values (v_center, 'org.security', 'done', 'Email, mobile and authenticator app verified when the sandbox was created.', auth.uid(), now())
  on conflict (center_id, step_key) do nothing;

  update app.sandbox_codes set redeemed_by = auth.uid(), redeemed_at = now(), center_id = v_center where id = c.id;
  return jsonb_build_object('center_id', v_center, 'slug', v_slug || '-sandbox');
end $$;

-- ── Owner invitations ────────────────────────────────────────────────────────
alter table app.staff_invitations add column if not exists makes_owner boolean not null default false;
comment on column app.staff_invitations.makes_owner is
  'The person who accepts becomes the organization''s owner (when it has none). Only app.platform_create_sandbox sets it.';

-- 0152 plus: an owner invitation designates the owner on acceptance.
create or replace function app.accept_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare i app.staff_invitations; u record; v_person uuid; v_linked uuid; v_scope record; r text;
        v_active text[] := '{}'; v_pending text[] := '{}'; v_status text; v_owner boolean := false;
begin
  if auth.uid() is null then raise exception 'Sign in first, then open the invitation link again.' using errcode = 'insufficient_privilege'; end if;
  select * into i from app.staff_invitations where token_hash = app.invitation_token_hash(p_token) for update;
  if i.id is null or length(coalesce(p_token, '')) < 16 then raise exception 'This invitation link is not valid. Check that you copied all of it.'; end if;
  if i.revoked_at is not null then raise exception 'This invitation was withdrawn. Ask the person who invited you for a new one.'; end if;
  if i.accepted_at is not null then
    if i.accepted_by = auth.uid() then raise exception 'You have already accepted this invitation.'; end if;
    raise exception 'This invitation has already been used.';
  end if;
  if i.expires_at <= now() then raise exception 'This invitation has expired. Ask the person who invited you to send it again.'; end if;
  if i.invited_by = auth.uid() then raise exception 'You cannot accept an invitation you sent.'; end if;

  select lower(email) as email, phone, phone_confirmed_at into u from auth.users where id = auth.uid();
  if i.email is not null and coalesce(u.email, '') <> lower(i.email) then
    raise exception 'This invitation was sent to %. Sign in with that email to accept it.', app.mask_contact(i.email, null);
  end if;
  if i.email is null and (u.phone is null or u.phone_confirmed_at is null or '+' || ltrim(u.phone, '+') <> i.phone_e164) then
    raise exception 'This invitation was sent to %. Sign in with that mobile number to accept it.', app.mask_contact(null, i.phone_e164);
  end if;

  select person_id into v_linked from app.center_users where center_id = i.center_id and user_id = auth.uid();
  v_person := coalesce(v_linked, i.person_id);
  if v_person is null and i.email is not null then
    select (array_agg(p.id))[1] into v_person from app.people p
     where p.center_id = i.center_id and lower(p.email::text) = lower(i.email) and p.merged_into_id is null
       and not exists (select 1 from app.center_users cu where cu.center_id = i.center_id and cu.person_id = p.id)
    having count(*) = 1;
  end if;
  if v_person is null then
    insert into app.people (center_id, first_name, last_name, email, phone_e164)
    values (i.center_id, coalesce(i.first_name, initcap(split_part(coalesce(i.email, 'New'), '@', 1))),
            coalesce(i.last_name, ''), i.email, i.phone_e164)
    returning id into v_person;
  end if;
  if v_linked is null then
    if exists (select 1 from app.center_users cu where cu.center_id = i.center_id and cu.person_id = v_person) then
      raise exception 'The person record on this invitation is already linked to another login. Ask the person who invited you to check it.';
    end if;
    insert into app.accounts (user_id) values (auth.uid()) on conflict do nothing;
    insert into app.center_users (center_id, user_id, person_id) values (i.center_id, auth.uid(), v_person);
  end if;

  perform app.set_audit_context(case when i.makes_owner then 'Owner invitation accepted' else 'Staff invitation accepted' end);
  update app.staff_invitations set accepted_by = auth.uid(), accepted_at = now() where id = i.id;

  -- The owner: only when the organization has none yet (never replaces one; that is a transfer).
  if i.makes_owner then
    insert into app.center_owners (center_id, user_id) values (i.center_id, auth.uid()) on conflict (center_id) do nothing;
    v_owner := exists (select 1 from app.center_owners o where o.center_id = i.center_id and o.user_id = auth.uid());
  end if;

  select * into v_scope from app.invitation_scope(i.scope);
  foreach r in array i.role_keys loop
    if exists (select 1 from app.role_grants g where g.center_id = i.center_id and g.user_id = auth.uid() and g.role_key = r
                  and g.scope_kind = v_scope.kind and g.scope_id is not distinct from v_scope.id
                  and g.status in ('active', 'pending') and (g.ends_at is null or g.ends_at > now())) then
      continue;
    end if;
    insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id, reason)
    values (i.center_id, auth.uid(), r, v_scope.kind, v_scope.id,
            case when i.makes_owner then 'Owner invitation accepted' else 'Staff invitation accepted' end)
    returning status into v_status;
    if v_status = 'pending' then v_pending := v_pending || r; else v_active := v_active || r; end if;
  end loop;

  return jsonb_build_object('center_id', i.center_id, 'person_id', v_person, 'active_roles', to_jsonb(v_active),
                            'pending_roles', to_jsonb(v_pending), 'requires_2fa', app.require_2fa_for_staff(i.center_id),
                            'owner', v_owner);
end $$;

-- ── The console action ───────────────────────────────────────────────────────
create or replace function app.platform_create_sandbox(
  p_name text, p_slug text, p_org_type text, p_city text, p_state text,
  p_owner_first_name text, p_owner_last_name text, p_owner_email text, p_reason text, p_link_base text default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_base text := regexp_replace(lower(btrim(coalesce(p_slug, ''))), '-sandbox$', '');
        v_email text := lower(nullif(btrim(p_owner_email), '')); v_first text := nullif(btrim(p_owner_first_name), '');
        v_last text := nullif(btrim(p_owner_last_name), ''); v_reason text := app.audit_clean_reason(p_reason);
        v_center uuid; v_token text; v_inv uuid; v_exp timestamptz; v_link text; v_mail jsonb; v_slug text;
        v_base_url text := nullif(regexp_replace(btrim(coalesce(p_link_base, '')), '/+$', ''), '');
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can create a sandbox directly.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_org_type, '') not in ('temple','community_center','other_nonprofit') then
    raise exception 'Choose the kind of organization: temple, community center or other non-profit.';
  end if;
  if length(btrim(coalesce(p_city, ''))) < 1 or length(btrim(coalesce(p_state, ''))) < 2 then raise exception 'Enter the city and state.'; end if;
  if v_first is null then raise exception 'Enter the owner''s first name.'; end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter the owner''s email address.'; end if;
  if v_reason is null then raise exception 'Give a reason for creating this sandbox. It goes in the audit log.'; end if;
  if v_base_url is not null and v_base_url !~ '^https?://[A-Za-z0-9.:\-\[\]]+$' then
    raise exception 'The portal address for the invitation link is not valid (%).', p_link_base;
  end if;
  if (select lower(email) from auth.users where id = auth.uid()) = v_email then
    raise exception 'Invite the organization''s owner, not yourself: the owner must be a different person from the Community Connect admin who creates the sandbox.';
  end if;
  perform app.assert_step_up('platform.create_sandbox');
  perform app.set_audit_context(v_reason);

  v_center := app._create_sandbox_center(v_base, p_name, upper(btrim(p_state)), p_city, null,
                jsonb_build_object('source', 'platform_admin', 'created_by', auth.uid(), 'org_type', p_org_type,
                                   'owner_email', v_email));
  v_slug := v_base || '-sandbox';

  v_token := app.new_invitation_token();
  v_exp := now() + interval '14 days';
  insert into app.staff_invitations (center_id, email, first_name, last_name, role_keys, invited_by, token_hash, expires_at, makes_owner)
  values (v_center, v_email, v_first, v_last, array['center_admin'], auth.uid(), app.invitation_token_hash(v_token), v_exp, true)
  returning id into v_inv;
  v_link := coalesce(v_base_url, '') || '/invite/' || v_token;
  v_mail := app.platform_send_message(v_email, 'staff_invitation',
              jsonb_build_object('inviter', 'Community Connect', 'center_name', btrim(p_name),
                                 'roles', 'owner and administrator', 'link', v_link, 'invite_path', '/invite/' || v_token,
                                 'expires_on', to_char(v_exp at time zone 'UTC', 'FMMonth FMDD, YYYY')),
              'notification');
  return jsonb_build_object('center_id', v_center, 'slug', v_slug, 'invitation_id', v_inv, 'token', v_token,
                            'expires_at', v_exp, 'email_status', app.message_status_text(v_mail));
end $$;

revoke execute on function app._create_sandbox_center(text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function app.platform_create_sandbox(text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function app.platform_create_sandbox(text, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function app.accept_invitation(text) to authenticated;
grant execute on all functions in schema app to service_role;
