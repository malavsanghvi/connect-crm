-- 0152 (stream o-security) · staff invitations for people without a login.
--
-- ONBOARDING_CONTRACT "Staff invitations":
--   app.staff_invitations(id, center_id, email, phone_e164, person_id null, role_keys text[], scope jsonb,
--                         invited_by, token_hash, expires_at, accepted_by, accepted_at, revoked_at)
--   app.invite_staff(...)          roles.manage + a fresh 2FA check; returns the link token ONCE
--   app.accept_invitation(p_token) links the login to the person and grants the roles
--
-- Also: app.resend_invitation (new token, new expiry), app.revoke_invitation,
-- app.invitation_preview (what the invite page shows before sign-in).
--
-- Only a SHA-256 hash of the token is stored. The token is shown to the inviter
-- once (to send while the email/SMS sender, Wave B, is not built yet).
--
-- The two-person rule is kept: accepting runs the role grants through
-- enforce_role_grant exactly as a grant by the inviter would — center_admin,
-- treasurer, finance_volunteer, executive_committee and privacy_officer start
-- `pending` and need a second, different person to approve them
-- (approve_role_grant). The grants are recorded as granted by the inviter.
-- Extra columns beyond the contract: first_name, last_name (for a new person
-- record), revoked_by, created_at, last_sent_at.

create table if not exists app.staff_invitations (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  email        text,
  phone_e164   text,
  person_id    uuid references app.people(id) on delete set null,
  first_name   text,
  last_name    text,
  role_keys    text[] not null,
  scope        jsonb not null default '{"kind":"center"}'::jsonb,
  invited_by   uuid not null references auth.users(id),
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  accepted_by  uuid references auth.users(id),
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid references auth.users(id),
  last_sent_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint staff_invitations_contact check (email is not null or phone_e164 is not null),
  constraint staff_invitations_email check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint staff_invitations_phone check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint staff_invitations_roles check (cardinality(role_keys) > 0)
);
create index if not exists staff_invitations_center_idx on app.staff_invitations (center_id, created_at desc);
create index if not exists staff_invitations_email_idx on app.staff_invitations (center_id, lower(email));

alter table app.staff_invitations enable row level security;
drop policy if exists staff_invitations_read on app.staff_invitations;
create policy staff_invitations_read on app.staff_invitations for select to authenticated
  using (app.has_permission(center_id, 'roles.manage') or invited_by = auth.uid() or accepted_by = auth.uid());
-- No write policies: invite_staff / resend / revoke / accept are the only writers.
revoke insert, update, delete, truncate on app.staff_invitations from anon, authenticated;
grant select on app.staff_invitations to authenticated;
grant all on app.staff_invitations to service_role;

drop trigger if exists audit_staff_invitations on app.staff_invitations;
create trigger audit_staff_invitations after insert or update or delete on app.staff_invitations
  for each row execute function app.audit_row();
insert into app.module_tables (table_name, module_key) values ('staff_invitations', null) on conflict (table_name) do nothing;

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function app.invitation_token_hash(p_token text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function app.new_invitation_token() returns text
language sql volatile set search_path = app, public, extensions as $$
  select translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_')
$$;

-- "s•••@example.com" / "+1 ••• ••• 0142": enough to recognise, not to harvest.
create or replace function app.mask_contact(p_email text, p_phone text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case
    when p_email is not null then left(split_part(p_email, '@', 1), 1) || '•••@' || split_part(p_email, '@', 2)
    when p_phone is not null then left(p_phone, 2) || ' ••• ••• ' || right(p_phone, 4)
  end
$$;

-- True while accept_invitation (this transaction) is granting this role to the
-- invitee: the only case in which a signed-in user's own role grant is allowed,
-- and in which the grant needs no fresh 2FA check from the invitee (the
-- inviter passed one when inviting).
create or replace function app.invitation_grant_in_progress(p_center uuid, p_user uuid, p_role text)
returns uuid language sql volatile security definer set search_path = app, public, extensions as $$
  select i.invited_by from app.staff_invitations i
   where i.center_id = p_center and i.accepted_by = p_user and p_user = auth.uid()
     and i.accepted_at = now() and i.revoked_at is null and p_role = any (i.role_keys)
   order by i.accepted_at desc limit 1
$$;

-- Validates a scope: {"kind":"center"} or {"kind":"class"|"event"|"zone"|…,"id":"<uuid>"}.
create or replace function app.invitation_scope(p_scope jsonb, out kind app.scope_kind, out id uuid)
language plpgsql immutable set search_path = app, public, extensions as $$
declare v_kind text := coalesce(nullif(p_scope->>'kind', ''), 'center');
begin
  if v_kind not in ('center', 'zone', 'event', 'campaign', 'class', 'store', 'pathshala') then
    raise exception 'The invitation scope "%" is not one of center, zone, event, campaign, class, store or pathshala.', v_kind;
  end if;
  kind := v_kind::app.scope_kind;
  if v_kind <> 'center' then
    if coalesce(p_scope->>'id', '') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'A % invitation needs the id of the % it is for.', v_kind, v_kind;
    end if;
    id := (p_scope->>'id')::uuid;
  end if;
end $$;

-- ── enforce_role_grant: the invitation case ─────────────────────────────────
-- Identical to 0017 except for the invitation branch: while accept_invitation
-- grants the invited roles, the grant counts as the inviter's (granted_by) and
-- the two-person rule applies to it unchanged.
create or replace function app.enforce_role_grant() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_tier text; v_inviter uuid;
begin
  if auth.uid() is null or app.is_platform_admin() then return new; end if;   -- service role / platform team
  select tier into v_tier from app.roles where key = new.role_key;
  if v_tier = 'platform' then raise exception 'platform roles are granted by the platform team only' using errcode = 'check_violation'; end if;
  if tg_op = 'INSERT' then
    v_inviter := case when new.user_id = auth.uid() then app.invitation_grant_in_progress(new.center_id, new.user_id, new.role_key) end;
    if new.user_id = auth.uid() and v_inviter is null then
      raise exception 'you cannot grant a role to yourself' using errcode = 'check_violation';
    end if;
    new.granted_by := coalesce(v_inviter, auth.uid());
    if new.role_key in ('center_admin','treasurer','finance_volunteer','executive_committee','privacy_officer') then
      new.status := 'pending';           -- activates when a second person approves
      new.starts_at := 'infinity';
    end if;
  end if;
  return new;
end $$;

-- ── Invite ───────────────────────────────────────────────────────────────────
create or replace function app.invite_staff(
  p_center uuid, p_email text, p_phone text, p_person uuid, p_role_keys text[],
  p_scope jsonb default '{"kind":"center"}'::jsonb, p_first_name text default null, p_last_name text default null,
  p_valid_days int default 7)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_email text := lower(nullif(btrim(p_email), '')); v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s().-]', '', 'g'), '');
        v_token text; v_id uuid; v_exp timestamptz; v_bad text; v_scope record; v_me text;
begin
  if auth.uid() is null then raise exception 'Sign in to invite staff.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then raise exception 'That community was not found.'; end if;
  if not (app.has_permission(p_center, 'roles.manage') or app.is_platform_admin()) then
    raise exception 'Inviting staff needs the roles.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  if v_email is null and v_phone is null then raise exception 'Enter the person''s email or mobile number.'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right.'; end if;
  if v_phone is not null and v_phone ~ '^[0-9]{10}$' then v_phone := '+1' || v_phone; end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the mobile number with its country code, for example +1 713 555 0142.';
  end if;
  if p_role_keys is null or cardinality(p_role_keys) = 0 then raise exception 'Choose at least one role.'; end if;
  select string_agg(k, ', ') into v_bad from unnest(p_role_keys) k
   where not exists (select 1 from app.roles r where r.key = k and r.tier in ('center', 'operational'));
  if v_bad is not null then raise exception 'These roles cannot be given by invitation: %.', v_bad; end if;
  select * into v_scope from app.invitation_scope(p_scope);
  if p_person is not null and not exists (select 1 from app.people where id = p_person and center_id = p_center and merged_into_id is null) then
    raise exception 'That person is not in this community.';
  end if;
  select lower(email) into v_me from auth.users where id = auth.uid();
  if v_email is not null and v_email = v_me then raise exception 'You cannot invite yourself.'; end if;
  if exists (select 1 from app.staff_invitations i
              where i.center_id = p_center and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
                and ((v_email is not null and lower(i.email) = v_email) or (v_phone is not null and i.phone_e164 = v_phone))) then
    raise exception 'This person already has an open invitation. Resend it or withdraw it instead.';
  end if;
  perform app.assert_step_up('roles.grant');

  v_token := app.new_invitation_token();
  v_exp := now() + make_interval(days => least(greatest(coalesce(p_valid_days, 7), 1), 30));
  perform app.set_audit_context('Staff invitation: ' || array_to_string(p_role_keys, ', '));
  insert into app.staff_invitations (center_id, email, phone_e164, person_id, first_name, last_name, role_keys, scope,
                                     invited_by, token_hash, expires_at)
  values (p_center, v_email, v_phone, p_person, nullif(btrim(p_first_name), ''), nullif(btrim(p_last_name), ''), p_role_keys,
          jsonb_strip_nulls(jsonb_build_object('kind', v_scope.kind::text, 'id', v_scope.id)),
          auth.uid(), app.invitation_token_hash(v_token), v_exp)
  returning id into v_id;
  return query select v_id, v_token, v_exp;
end $$;

-- A fresh link (the old one stops working) and a fresh expiry.
create or replace function app.resend_invitation(p_invitation uuid, p_valid_days int default 7)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare i app.staff_invitations; v_token text; v_exp timestamptz;
begin
  select * into i from app.staff_invitations where id = p_invitation for update;
  if i.id is null then raise exception 'That invitation was not found.'; end if;
  if not (app.has_permission(i.center_id, 'roles.manage') or app.is_platform_admin()) then
    raise exception 'Resending invitations needs the roles.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  if i.accepted_at is not null then raise exception 'That invitation was already accepted.'; end if;
  if i.revoked_at is not null then raise exception 'That invitation was withdrawn. Send a new one instead.'; end if;
  perform app.assert_step_up('roles.grant');
  v_token := app.new_invitation_token();
  v_exp := now() + make_interval(days => least(greatest(coalesce(p_valid_days, 7), 1), 30));
  perform app.set_audit_context('Invitation re-sent (new link)');
  update app.staff_invitations set token_hash = app.invitation_token_hash(v_token), expires_at = v_exp, last_sent_at = now()
   where id = p_invitation;
  return query select p_invitation, v_token, v_exp;
end $$;

create or replace function app.revoke_invitation(p_invitation uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare i app.staff_invitations;
begin
  select * into i from app.staff_invitations where id = p_invitation for update;
  if i.id is null then raise exception 'That invitation was not found.'; end if;
  if not (app.has_permission(i.center_id, 'roles.manage') or app.is_platform_admin()) then
    raise exception 'Withdrawing invitations needs the roles.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  if i.accepted_at is not null then raise exception 'That invitation was already accepted. Remove the person''s roles instead.'; end if;
  if i.revoked_at is not null then return; end if;
  perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason), 'Invitation withdrawn'));
  update app.staff_invitations set revoked_at = now(), revoked_by = auth.uid() where id = p_invitation;
end $$;

-- What the invite page shows before and after sign-in. Anyone holding the link
-- may call it; it never returns the full address.
create or replace function app.invitation_preview(p_token text)
returns table (status text, center_name text, center_short_name text, contact text, contact_kind text,
               role_names text[], expires_at timestamptz, invited_by_name text)
language sql stable security definer set search_path = app, public, extensions as $$
  select case when i.accepted_at is not null then 'accepted' when i.revoked_at is not null then 'revoked'
              when i.expires_at <= now() then 'expired' else 'pending' end,
         c.name, c.short_name,
         app.mask_contact(i.email, i.phone_e164),
         case when i.email is not null then 'email' else 'phone' end,
         (select array_agg(r.name order by r.name) from app.roles r where r.key = any (i.role_keys)),
         i.expires_at,
         (select coalesce(nullif(p.preferred_name, ''), p.first_name) || ' ' || p.last_name
            from app.center_users cu join app.people p on p.id = cu.person_id
           where cu.center_id = i.center_id and cu.user_id = i.invited_by)
    from app.staff_invitations i join app.centers c on c.id = i.center_id
   where i.token_hash = app.invitation_token_hash(p_token) and length(coalesce(p_token, '')) >= 16
$$;

-- ── Accept ───────────────────────────────────────────────────────────────────
create or replace function app.accept_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare i app.staff_invitations; u record; v_person uuid; v_linked uuid; v_scope record; r text;
        v_active text[] := '{}'; v_pending text[] := '{}'; v_status text;
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

  -- The person record: already linked, the one named on the invitation, the one
  -- person with this email, or a new one.
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

  perform app.set_audit_context('Staff invitation accepted');
  update app.staff_invitations set accepted_by = auth.uid(), accepted_at = now() where id = i.id;

  select * into v_scope from app.invitation_scope(i.scope);
  foreach r in array i.role_keys loop
    if exists (select 1 from app.role_grants g where g.center_id = i.center_id and g.user_id = auth.uid() and g.role_key = r
                  and g.scope_kind = v_scope.kind and g.scope_id is not distinct from v_scope.id
                  and g.status in ('active', 'pending') and (g.ends_at is null or g.ends_at > now())) then
      continue;
    end if;
    insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id, reason)
    values (i.center_id, auth.uid(), r, v_scope.kind, v_scope.id, 'Staff invitation accepted')
    returning status into v_status;
    if v_status = 'pending' then v_pending := v_pending || r; else v_active := v_active || r; end if;
  end loop;

  return jsonb_build_object('center_id', i.center_id, 'person_id', v_person, 'active_roles', to_jsonb(v_active),
                            'pending_roles', to_jsonb(v_pending), 'requires_2fa', app.require_2fa_for_staff(i.center_id));
end $$;

revoke execute on function app.invitation_token_hash(text), app.new_invitation_token(), app.mask_contact(text, text),
  app.invitation_grant_in_progress(uuid, uuid, text), app.invitation_scope(jsonb),
  app.invite_staff(uuid, text, text, uuid, text[], jsonb, text, text, int), app.resend_invitation(uuid, int),
  app.revoke_invitation(uuid, text), app.invitation_preview(text), app.accept_invitation(text) from public, anon;
grant execute on function app.invite_staff(uuid, text, text, uuid, text[], jsonb, text, text, int), app.resend_invitation(uuid, int),
  app.revoke_invitation(uuid, text), app.invitation_preview(text), app.accept_invitation(text) to authenticated;
grant execute on function app.invitation_preview(text) to anon;
revoke execute on function app.invitation_grant_in_progress(uuid, uuid, text) from authenticated;
grant execute on all functions in schema app to service_role;
