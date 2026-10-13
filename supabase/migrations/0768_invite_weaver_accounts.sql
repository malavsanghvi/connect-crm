-- 0768 · A Weaver team account accepting an invitation is never linked to a member's record (follow-up to 0757, #233).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   0757 made link_account refuse a platform-admin account and refused invitations that NAME a member for a Weaver
--   account's email or phone. One path was left: an invitation that names no person, accepted by a platform-admin account,
--   still looked the member up by the invitation's email (0502's accept_invitation) and linked the account to that member.
--   Weaver's team never links to member people in customer communities, so for a platform-admin account accepting an
--   invitation:
--     * a sign-in already linked in the community keeps its link, as before (nothing new is linked);
--     * an invitation that names a person is refused (0757 refuses making one; this covers one made before);
--     * no member is looked up by email: a new person record of their own is made for them, as when nobody matches.
--   Everyone else accepts exactly as before. The founder and owner flows keep working: an owner invitation for a new
--   sandbox (platform_create_sandbox) finds no member and makes the owner's own record, whoever accepts it.
--   app.accept_invitation(token)   0502's body with the three rules above; same signature, same answer.
set client_min_messages = warning;

create or replace function app.accept_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare i app.staff_invitations; u record; v_person uuid; v_linked uuid; v_scope record; r text;
        v_active text[] := '{}'; v_pending text[] := '{}'; v_status text; v_owner boolean := false;
        v_weaver boolean := app.is_platform_admin();
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
  -- 0768: a Weaver team account is never linked to a member's record.
  if v_weaver and v_linked is null and i.person_id is not null then
    raise exception 'This invitation names a member of the community, so a Weaver team account cannot accept it. Ask for an invitation to your own email without a person named.'
      using errcode = 'insufficient_privilege';
  end if;
  v_person := coalesce(v_linked, i.person_id);
  if v_person is null and i.email is not null and not v_weaver then
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
revoke execute on function app.accept_invitation(text) from public, anon;
grant execute on function app.accept_invitation(text) to authenticated;
