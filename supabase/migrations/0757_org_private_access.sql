-- 0757 · The organization's own data: an access check with no platform-admin branch (docs/WECARE.md section 3, W2;
-- docs/CATCH_THE_MATCH.md section 6 and C8), and the older paths that would let Weaver's team reach it closed. Builder PRIV,
-- owner approved 2026-10-13.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   WeCare (module `care`) and CatchTheMatch (module `matching`) hold data that belongs to the organization alone: only the
--   people the organization gives a role see it, amounts only with giving.view, and NOT Weaver's platform admins.
--   app.has_permission cannot be reused for it: it is true for every platform admin in every community (0400, backlog B1).
--
--   app.org_private_can(center, key)    the check. True only when ALL of these hold:
--                                         - the key is one of the five private keys (care.view, care.own, care.manage,
--                                           matching.view, matching.manage); any other key is false, so a typo never passes;
--                                         - the product's module exists and is on for the community (app.module_enabled:
--                                           granted by Weaver, not paused by the community, its dependencies on);
--                                         - the caller is the community's owner, or holds an active, center-wide grant of a
--                                           role (not a platform-tier role) whose permissions hold the key or "*", and the
--                                           caller's account is not a platform admin's.
--                                       There is NO is_platform_admin() branch. platform_owner holds "*" but is a platform-tier
--                                       role, so it never counts here; nor does platform_support.
--   app.care_can(center, level)         'view' (every care record: care.view or care.manage), 'own' (only the households I
--                                       own: care.own, or anything wider), 'manage' (care.manage).
--   app.care_amounts_can(center)        a care reader who ALSO holds giving.view or giving.manage through the organization's
--                                       own grant (or is the owner), with Giving on. Functions that return care rows show a
--                                       gift amount, range or total only when this is true ("thank them warmly" otherwise).
--   app.matching_can(center, level)     the CatchTheMatch twin (0758, which also admits the Weaver filing grant).
--
--   THE CONTRACT FOR EVERY FUTURE care / matching TABLE AND FUNCTION
--     * RLS: every policy calls app.care_can / app.matching_can (or app.org_private_can), never app.has_permission and
--       never app.is_platform_admin(). The restrictive module_switch policy has no platform-admin pass either.
--     * Functions that return rows check the same, and amounts with app.care_amounts_can.
--     * The table is mapped to its product in app.module_tables and audited with app.audit_private_row (0758: who, when,
--       which columns, never the values), so its audit rows carry module = 'care' / 'matching', which 0758's audit_read
--       rule keeps from platform admins and from audit.view alone.
--     * Reads are logged with app.log_private_read (0758).
--
--   As a backstop, app.has_permission(center, key) for a private key now answers app.org_private_can(center, key), so a
--   policy written with has_permission by mistake still refuses a platform admin. Every other key is unchanged (0400).
--
--   ROLES. Roles are shared by every community (seed.sql; no custom roles), so the organization gives access by granting a
--   role that holds the key. Three new roles, granted to nobody; no existing role changes:
--     care_lead           care.view, care.manage
--     relationship_owner  care.own
--     matching_lead       matching.view, matching.manage
--   A role carrying a private key (role_private_products) is granted only by the community's owner or a holder of that
--   product's .manage key (checked without the platform-admin branch), never to oneself, never to a platform-admin account
--   (Weaver's team reaches CatchTheMatch only through the filing grant of 0758), and for the whole community only.
--   roles.manage alone is not enough. Any change to such a grant other than ending it is checked the same way and records
--   who made it. There is no second approver (owner decision 2026-10-13): each such grant writes an audit entry of its
--   product and the owner is emailed (template private_access_granted, sent with app.platform_send_message like 0594's
--   category_changed). Staff invitations that carry such a role follow the same rule. A product's manager who does not
--   hold roles.manage may give, see and end the grants of that product's roles (RLS, may_grant_private_role).
--   Only a migration can make a role hold a private key or "*" (app.roles_private_guard): no API caller, platform admins
--   included (0010's roles_platform policy would otherwise let them).
--
--   NOBODY MAKES THEMSELVES OWNER OR ADMINISTRATOR, WEAVER'S TEAM INCLUDED. Before this, a platform admin could give
--   themselves center_admin (0152's enforce_role_grant returned early for them), become the owner of a community without
--   one (0151's role_grants_zz_owner makes the first center_admin the owner), or transfer ownership to themselves (0151's
--   transfer_ownership), and the owner holds every private key.
--     enforce_role_grant      nobody gives themselves a role or widens a grant of their own, platform admins included;
--                             accepting an invitation someone else sent stays the one way in. Platform admins still set up
--                             other people at once (onboarding, sandboxes, promotion, demo communities).
--     center_owners           nobody makes themselves the owner (insert, transfer), platform admins included, except by
--                             accepting an owner's or administrator's invitation someone else sent.
--     ensure_center_owner     when a signed-in person's change makes a community's first owner, a platform-admin account
--                             is never chosen.
--     notices                 every center_admin grant and every ownership change a platform admin makes is audited and
--                             emailed to the community's owner (template weaver_access_change); demo communities aside.
--   SIGN-IN LINKS. 0010 lets roles.manage holders (and platform admins) write app.center_users, so someone could point their
--   own sign-in at another person and read or forge that person's own records (the employer for gift matching, 0759).
--   Through the API nobody changes the person a sign-in of their own is linked to, and platform admins change no link at
--   all; the functions that link a sign-in (invitations, join codes, onboarding, promotion, demo communities) run as the
--   database owner and keep their own checks.
set client_min_messages = warning;

-- ── The private keys ─────────────────────────────────────────────────────────

-- The product a key belongs to, when the key is the organization's own: 'care' or 'matching'; null for any other key.
create or replace function app.org_private_product(p_perm text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case split_part(coalesce(p_perm, ''), '.', 1) when 'care' then 'care' when 'matching' then 'matching' end
$$;

-- The five keys the products check. Anything else under care.* or matching.* is refused.
create or replace function app.org_private_keys() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['care.view', 'care.own', 'care.manage', 'matching.view', 'matching.manage']::text[]
$$;

-- Does a permission list open the organization's own data (a care.* or matching.* key, or "*")?
create or replace function app._perms_open_private(p jsonb) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(jsonb_typeof(p) = 'array'
                  and exists (select 1 from jsonb_array_elements_text(p) k where k = '*' or app.org_private_product(k) is not null),
                  false)
$$;

-- Does this user hold the key in this community through the ORGANIZATION: its owner, or an active center-wide grant of a
-- role that is not a platform-tier role, holding the key or "*". No platform-admin branch, and a role grant held by a
-- platform-admin account counts for nothing here (Weaver's team reaches CatchTheMatch only through the filing grant, 0758).
-- Any key (giving.view too), so the amounts rule and the granter rule can ask it. Private: it takes a user.
create or replace function app._org_holds(p_center uuid, p_user uuid, p_perm text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_center is not null and p_user is not null and p_perm is not null and (
       exists (select 1 from app.center_owners o where o.center_id = p_center and o.user_id = p_user)
    or (not exists (select 1 from app.accounts a where a.user_id = p_user and a.is_platform_admin)
        and exists (select 1 from app.role_grants g join app.roles r on r.key = g.role_key
                     where g.center_id = p_center and g.user_id = p_user
                       and g.scope_kind = 'center' and g.status = 'active'
                       and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
                       and r.tier <> 'platform'
                       and (r.permissions ? p_perm or r.permissions ? '*'))))
$$;

-- Is the product's module there and on for the community? A module the catalog does not have counts as off (module_enabled
-- alone would call an unknown key on).
create or replace function app._org_private_module_on(p_center uuid, p_product text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_center is not null and p_product in ('care', 'matching')
     and exists (select 1 from app.modules m where m.key = p_product and not m.core)
     and app.module_enabled(p_center, p_product)
$$;

-- ── The check ────────────────────────────────────────────────────────────────
create or replace function app.org_private_can(p_center uuid, p_perm text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null
     and coalesce(p_perm = any (app.org_private_keys()), false)
     and app._org_private_module_on(p_center, app.org_private_product(p_perm))
     and app._org_holds(p_center, auth.uid(), p_perm)
$$;

create or replace function app.care_can(p_center uuid, p_level text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select case p_level
           when 'view' then app.org_private_can(p_center, 'care.view') or app.org_private_can(p_center, 'care.manage')
           when 'own' then app.org_private_can(p_center, 'care.own') or app.org_private_can(p_center, 'care.view')
                        or app.org_private_can(p_center, 'care.manage')
           when 'manage' then app.org_private_can(p_center, 'care.manage')
           else false
         end
$$;

create or replace function app.care_amounts_can(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.care_can(p_center, 'own')
     and app.module_enabled(p_center, 'giving')
     and (app._org_holds(p_center, auth.uid(), 'giving.view') or app._org_holds(p_center, auth.uid(), 'giving.manage'))
$$;

-- Without the filing grant until 0758 replaces it.
create or replace function app.matching_can(p_center uuid, p_level text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select case p_level
           when 'view' then app.org_private_can(p_center, 'matching.view') or app.org_private_can(p_center, 'matching.manage')
           when 'manage' then app.org_private_can(p_center, 'matching.manage')
           else false
         end
$$;

-- ── The backstop in has_permission ───────────────────────────────────────────
-- 0400's body, word for word, for every key that is not private.
create or replace function app.has_permission(p_center uuid, p_perm text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select case when split_part(coalesce(p_perm, ''), '.', 1) in ('care', 'matching') then app.org_private_can(p_center, p_perm)
  else (
    app.is_platform_admin()
      or app.is_center_owner(p_center)
      or exists (
        select 1 from app.role_grants g
        join app.roles r on r.key = g.role_key
        where g.center_id = p_center and g.user_id = auth.uid()
          and g.scope_kind in ('center','platform','pathshala','store')
          and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
          and (r.permissions ? p_perm or r.permissions ? '*'))
  ) end
$$;

-- ── The roles, and who may define them ───────────────────────────────────────
-- Only a migration (or another job without an API role: the seed, the SQL editor) can create or change a role that holds a
-- private key or "*": through the API (anon, authenticated, service_role) such a role cannot be created, nor can a role be
-- changed to hold one, nor can one that holds one be changed at all (its tier, key or permissions). SECURITY INVOKER on
-- purpose: current_user is the role of the statement (inside a SECURITY DEFINER function it is the function's owner).
create or replace function app.roles_private_guard() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  if current_user not in ('anon', 'authenticated', 'service_role') then return new; end if;
  if app._perms_open_private(new.permissions) or (tg_op = 'UPDATE' and app._perms_open_private(old.permissions)) then
    raise exception 'Roles that open WeCare or CatchTheMatch data, or every permission, are changed only by a database migration.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke execute on function app.roles_private_guard() from public, anon, authenticated;
drop trigger if exists roles_private_guard on app.roles;
create trigger roles_private_guard before insert or update on app.roles
  for each row execute function app.roles_private_guard();

-- seed.sql lists them too (a new database loads the seed after the migrations).
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('care_lead', 'center', 'Care lead', 'center',
   'WeCare: every care record, relationship owners, playbooks and care settings. Amounts only with a giving role as well.',
   '["care.view","care.manage"]'),
  ('relationship_owner', 'center', 'Relationship owner', 'center',
   'WeCare: the care records of the households they own, nothing else. Amounts only with a giving role as well.',
   '["care.own"]'),
  ('matching_lead', 'center', 'Matching lead', 'center',
   'CatchTheMatch: claims, employers on file, match history and its settings.',
   '["matching.view","matching.manage"]')
on conflict (key) do nothing;

-- The products a role opens: each product whose private key the role holds ("*": both). A platform-tier role opens none
-- (org_private_can never counts it).
create or replace function app.role_private_products(p_role text) returns text[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(distinct s.p order by s.p), '{}'::text[])
    from (select unnest(case when k = '*' then array['care', 'matching'] else array[app.org_private_product(k)] end) as p
            from app.roles r
           cross join lateral jsonb_array_elements_text(case when jsonb_typeof(r.permissions) = 'array' then r.permissions else '[]'::jsonb end) as k
           where r.key = p_role and r.tier <> 'platform') s
   where s.p is not null
$$;

-- May this user give a role that opens these products? The owner, or a holder of each product's .manage.
create or replace function app._may_grant_private(p_center uuid, p_user uuid, p_products text[]) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_user is not null
     and (exists (select 1 from app.center_owners o where o.center_id = p_center and o.user_id = p_user)
          or not exists (select 1 from unnest(coalesce(p_products, '{}'::text[])) p
                          where not app._org_holds(p_center, p_user, p || '.manage')))
$$;

-- The sentence when someone else tries.
create or replace function app._private_grant_refusal(p_center uuid, p_role text, p_products text[]) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select format('%s can be given only by the organization''s owner or by someone who manages %s.',
                coalesce((select r.name from app.roles r where r.key = p_role), p_role),
                coalesce((select string_agg(app._module_label(p_center, p), ' and ' order by p) from unnest(p_products) p), 'it'))
$$;

-- Does a change to a grant give more than it gave (another role, person, community or scope, an earlier start, a later or
-- no end, or active again)? Ending a grant, or narrowing it, gives nothing.
create or replace function app._grant_widens(o app.role_grants, n app.role_grants) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select n.role_key is distinct from o.role_key or n.user_id is distinct from o.user_id or n.center_id is distinct from o.center_id
      or n.scope_kind is distinct from o.scope_kind or n.scope_id is distinct from o.scope_id
      or n.starts_at < o.starts_at
      or (o.ends_at is not null and (n.ends_at is null or n.ends_at > o.ends_at))
      or (n.status = 'active' and o.status is distinct from 'active')
$$;

-- ── Nobody gives themselves a role, Weaver's team included ───────────────────
-- 0152's enforce_role_grant with the self rules moved ahead of the platform team's early return, and extended to updates:
-- nobody inserts a grant for themselves (accepting an invitation someone else sent is the one exception: the inviter is the
-- giver) or widens a grant of their own. The rest is 0152's: the platform team still sets up other people at once (no
-- platform-role check, no second approver), as onboarding, promotion and demo communities need; for everyone else a platform
-- role is refused on an update that widens a grant too, now that the trigger also fires on updates.
create or replace function app.enforce_role_grant() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_tier text; v_inviter uuid;
begin
  if auth.uid() is null then return new; end if;   -- service role, migrations, workers
  if tg_op = 'INSERT' and new.user_id = auth.uid() then
    v_inviter := app.invitation_grant_in_progress(new.center_id, new.user_id, new.role_key);
    if v_inviter is null then
      raise exception 'you cannot grant a role to yourself' using errcode = 'check_violation';
    end if;
  elsif tg_op = 'UPDATE' and (new.user_id = auth.uid() or old.user_id = auth.uid()) and app._grant_widens(old, new) then
    raise exception 'you cannot widen a role of your own; a different administrator has to' using errcode = 'check_violation';
  end if;
  if app.is_platform_admin() then return new; end if;   -- platform team (0017): as before for other people's grants
  -- A platform role is given (or widened) by the platform team only; ending one stays open to whoever may write the row.
  if tg_op = 'INSERT' or app._grant_widens(old, new) then
    select tier into v_tier from app.roles where key = new.role_key;
    if v_tier = 'platform' then raise exception 'platform roles are granted by the platform team only' using errcode = 'check_violation'; end if;
  end if;
  if tg_op = 'INSERT' then
    new.granted_by := coalesce(v_inviter, auth.uid());
    if new.role_key in ('center_admin','treasurer','finance_volunteer','executive_committee','privacy_officer') then
      new.status := 'pending';           -- activates when a second person approves
      new.starts_at := 'infinity';
    end if;
  end if;
  return new;
end $$;
-- 0017 fired it on INSERT only; the self rule needs updates too.
drop trigger if exists role_grants_rules on app.role_grants;
create trigger role_grants_rules before insert or update on app.role_grants
  for each row execute function app.enforce_role_grant();

-- ── Granting a private role ──────────────────────────────────────────────────
-- BEFORE INSERT OR UPDATE on role_grants (it fires before role_grants_rules). Without a signed-in user (service role,
-- migrations, the seed, workers) nothing is checked, as in 0152. An update that only ends or narrows a private grant (and
-- keeps who gave it) is allowed to whoever may write the row; any other change to a private grant is checked like a new
-- grant and records the person who made it.
create or replace function app.role_grants_private_rule() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_products text[]; v_granter uuid; v_name text;
begin
  if auth.uid() is null then return new; end if;
  v_products := app.role_private_products(new.role_key);
  if cardinality(v_products) = 0 then return new; end if;   -- (an update that turns a private grant into another is checked by its new role)
  if tg_op = 'UPDATE' and not app._grant_widens(old, new)
     and new.granted_by is not distinct from old.granted_by and new.delegated_from is not distinct from old.delegated_from
     and new.second_approver is not distinct from old.second_approver then
    return new;
  end if;

  v_name := coalesce((select r.name from app.roles r where r.key = new.role_key), new.role_key);
  if new.scope_kind <> 'center' or new.scope_id is not null then
    raise exception '% works for the whole organization only. Give it without an event, class or zone.', v_name
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from app.accounts a where a.user_id = new.user_id and a.is_platform_admin) then
    raise exception 'Weaver''s team cannot hold %. For CatchTheMatch filing, the organization gives Weaver''s team filing access instead.', v_name
      using errcode = 'check_violation';
  end if;
  v_granter := auth.uid();
  if new.user_id = auth.uid() then
    -- The invitee accepting an invitation: the inviter is the one who gives the role.
    v_granter := case when tg_op = 'INSERT' then app.invitation_grant_in_progress(new.center_id, new.user_id, new.role_key) end;
    if v_granter is null then
      raise exception 'Nobody can give themselves %. The organization''s owner or someone who manages it has to.', v_name
        using errcode = 'check_violation';
    end if;
  end if;
  if not app._may_grant_private(new.center_id, v_granter, v_products) then
    raise exception '%', app._private_grant_refusal(new.center_id, new.role_key, v_products) using errcode = 'insufficient_privilege';
  end if;
  -- Who gave it (or changed it) is the person who did: 0152 leaves granted_by as sent when a platform admin writes.
  new.granted_by := v_granter;
  return new;
end $$;
revoke execute on function app.role_grants_private_rule() from public, anon, authenticated;
drop trigger if exists role_grants_private on app.role_grants;
create trigger role_grants_private before insert or update on app.role_grants
  for each row execute function app.role_grants_private_rule();

-- May the caller give (or end) this role? Only for a role that opens a private product: the owner, or that product's
-- manager. The RLS policies below use it, so a product's manager who does not hold roles.manage can give, see and end the
-- grants of that product's roles (and only those, in their own community); roles.manage holders keep 0010's policies for
-- every role, and the trigger above still refuses them a private role unless they are the owner or the product's manager.
create or replace function app.may_grant_private_role(p_center uuid, p_role text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select cardinality(app.role_private_products(p_role)) > 0
     and app._may_grant_private(p_center, auth.uid(), app.role_private_products(p_role))
$$;
drop policy if exists role_grants_private_read on app.role_grants;
create policy role_grants_private_read on app.role_grants for select to authenticated
  using (app.may_grant_private_role(center_id, role_key));
drop policy if exists role_grants_private_insert on app.role_grants;
create policy role_grants_private_insert on app.role_grants for insert to authenticated
  with check (app.may_grant_private_role(center_id, role_key));
drop policy if exists role_grants_private_update on app.role_grants;
create policy role_grants_private_update on app.role_grants for update to authenticated
  using (app.may_grant_private_role(center_id, role_key)) with check (app.may_grant_private_role(center_id, role_key));

-- An invitation that carries a private role is made only by someone who may give it.
create or replace function app.staff_invitations_private_rule() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare k text; v_products text[];
begin
  if auth.uid() is null then return new; end if;
  foreach k in array coalesce(new.role_keys, '{}'::text[]) loop
    v_products := app.role_private_products(k);
    if cardinality(v_products) > 0 then
      if coalesce(new.scope->>'kind', 'center') <> 'center' then
        raise exception '% works for the whole organization only. Invite them without an event, class or zone.',
          coalesce((select r.name from app.roles r where r.key = k), k) using errcode = 'check_violation';
      end if;
      if not app._may_grant_private(new.center_id, new.invited_by, v_products) then
        raise exception '%', app._private_grant_refusal(new.center_id, k, v_products) using errcode = 'insufficient_privilege';
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke execute on function app.staff_invitations_private_rule() from public, anon, authenticated;
drop trigger if exists staff_invitations_private on app.staff_invitations;
create trigger staff_invitations_private before insert or update of role_keys, invited_by, scope on app.staff_invitations
  for each row execute function app.staff_invitations_private_rule();

-- ── Every private grant: an audit entry of its product, and the owner is told ──

-- An explicit audit entry that belongs to a product (module = 'care' / 'matching'), whatever table it names: app.log_audit
-- takes the module from the table, and audit_log is append-only, so the entry is written with its module at once. Same
-- context as log_audit (0102).
create or replace function app.log_private_audit(p_product text, p_center uuid, p_action text, p_table text, p_record text,
                                                 p_after jsonb default null, p_reason text default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare c record;
begin
  if p_product is null or p_product not in ('care', 'matching') then
    raise exception 'A private audit entry belongs to care or matching (got "%").', p_product using errcode = '22023';
  end if;
  select * into c from app.audit_context();
  insert into app.audit_log (center_id, actor_user_id, actor_role, action, record_table, record_id, before, after,
                             reason, correlation_id, ip, user_agent, module, client_app, client_screen)
  values (p_center, auth.uid(), auth.jwt()->>'role', p_action, p_table, p_record, null, app.audit_mask(p_after),
          coalesce(app.audit_clean_reason(p_reason), c.reason), c.correlation_id, c.ip, c.user_agent, p_product,
          c.client_app, c.client_screen);
end $$;
revoke execute on function app.log_private_audit(text, uuid, text, text, text, jsonb, text) from public, anon, authenticated;

insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('private_access_granted', 'email', '{{grantee}} can now see {{product}} data in {{center_name}}',
   E'Hello,\n\n{{granter}} gave {{grantee}} access to {{product}} in {{center_name}}: {{what}}.\n\n{{until}}\n\nOnly the people your organization gives this access can see this data. Weaver''s team cannot.\n\nIf this was not expected, open Settings › Roles & entitlements in Weaver to end it.\n\nThe Weaver team'),
  ('weaver_access_change', 'email', 'Weaver''s team changed who runs {{center_name}}',
   E'Hello,\n\n{{actor}} from Weaver''s team {{what}} in {{center_name}}.\n\nReason given: {{reason}}\n\nIf this was not expected, reply to this email and look at Settings › Team in Weaver.\n\nThe Weaver team')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- A person's name as the community knows them, else their email, else "someone".
create or replace function app._user_label(p_center uuid, p_user uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select coalesce(nullif(p.preferred_name, ''), p.first_name) || ' ' || p.last_name
                     from app.center_users cu join app.people p on p.id = cu.person_id
                    where cu.center_id = p_center and cu.user_id = p_user),
                  (select u.email::text from auth.users u where u.id = p_user),
                  'Someone')
$$;

-- Tell the owner (email) that someone can now see a product's data. Returns the send status ({status: queued | no_owner |
-- failed | not_set_up}); a failed send never undoes the grant, and the status is in the audit entry.
create or replace function app._notify_owner_private_access(p_center uuid, p_product text, p_grantee uuid, p_granter uuid,
                                                            p_what text, p_until timestamptz) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_owner text; c app.centers;
begin
  select * into c from app.centers where id = p_center;
  select lower(u.email) into v_owner from app.center_owners o join auth.users u on u.id = o.user_id where o.center_id = p_center;
  if v_owner is null then return jsonb_build_object('status', 'no_owner'); end if;
  return app.platform_send_message(v_owner, 'private_access_granted',
    jsonb_build_object('center_name', c.name, 'product', app._module_label(p_center, p_product),
                       'grantee', app._user_label(p_center, p_grantee), 'granter', app._user_label(p_center, p_granter),
                       'what', p_what,
                       'until', case when p_until is null then 'It has no end date.'
                                     else 'It ends ' || to_char(p_until at time zone coalesce(c.time_zone, 'America/Chicago'), 'FMMonth FMDD, YYYY') || '.' end),
    'notification');
end $$;
revoke execute on function app._notify_owner_private_access(uuid, text, uuid, uuid, text, timestamptz) from public, anon, authenticated;

create or replace function app.role_grants_private_notice() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare p text; v_products text[] := app.role_private_products(new.role_key); v_mail jsonb; v_role text;
begin
  if cardinality(v_products) = 0 or new.status <> 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.role_key = new.role_key and old.user_id = new.user_id then return new; end if;
  select r.name into v_role from app.roles r where r.key = new.role_key;
  foreach p in array v_products loop
    v_mail := app._notify_owner_private_access(new.center_id, p, new.user_id, coalesce(new.granted_by, auth.uid()),
                coalesce(v_role, new.role_key), new.ends_at);
    perform app.log_private_audit(p, new.center_id, p || '.access_granted', 'role_grants', new.id::text,
      jsonb_build_object('role', new.role_key, 'user_id', new.user_id, 'granted_by', coalesce(new.granted_by, auth.uid()),
                         'ends_at', new.ends_at, 'owner_email', coalesce(v_mail->>'status', 'failed')),
      new.reason);
  end loop;
  return new;
end $$;
revoke execute on function app.role_grants_private_notice() from public, anon, authenticated;
drop trigger if exists role_grants_private_notice on app.role_grants;
create trigger role_grants_private_notice after insert or update of status, role_key, user_id on app.role_grants
  for each row execute function app.role_grants_private_notice();

-- ── Owners and administrators: never oneself, and Weaver's changes are told ───

-- An email to one person about a change Weaver's team made ({status: ...}; no address: no_address).
create or replace function app._weaver_change_email(p_center uuid, p_to uuid, p_what text, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_to text; c app.centers;
begin
  select * into c from app.centers where id = p_center;
  select lower(u.email) into v_to from auth.users u where u.id = p_to;
  if v_to is null then return jsonb_build_object('status', 'no_address'); end if;
  return app.platform_send_message(v_to, 'weaver_access_change',
    jsonb_build_object('center_name', c.name, 'actor', coalesce((select u.email::text from auth.users u where u.id = auth.uid()), 'Someone'),
                       'what', p_what, 'reason', coalesce(app.audit_clean_reason(p_reason), 'none given')),
    'notification');
end $$;
revoke execute on function app._weaver_change_email(uuid, uuid, text, text) from public, anon, authenticated;

-- Every center_admin grant a platform admin makes (or approves) is audited and emailed to the community's owner. A demo
-- community (rebuilt by Weaver every night) is left out.
create or replace function app.role_grants_weaver_notice() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_owner uuid; v_mail jsonb := jsonb_build_object('status', 'no_owner'); c record;
begin
  if auth.uid() is null or not app.is_platform_admin() or new.role_key <> 'center_admin' or new.status not in ('active', 'pending') then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = new.status and old.role_key = new.role_key and old.user_id = new.user_id then return null; end if;
  if app.is_demo_center(new.center_id) then return null; end if;
  select * into c from app.audit_context();
  select o.user_id into v_owner from app.center_owners o where o.center_id = new.center_id;
  if v_owner is not null then
    v_mail := app._weaver_change_email(new.center_id, v_owner,
                case when tg_op = 'INSERT' then format('gave %s the Center admin role', app._user_label(new.center_id, new.user_id))
                     else format('approved the Center admin role for %s', app._user_label(new.center_id, new.user_id)) end,
                coalesce(c.reason, new.reason));
  end if;
  -- Its own entry (no record of its own, so the grant's history keeps exactly the rows it had): the grant is in after.
  perform app.log_audit(new.center_id, 'roles.center_admin_by_weaver', null, null, null,
    jsonb_build_object('grant_id', new.id, 'user_id', new.user_id, 'by', auth.uid(), 'status', new.status, 'owner_email', coalesce(v_mail->>'status', 'failed')),
    coalesce(c.reason, new.reason));
  return null;
end $$;
revoke execute on function app.role_grants_weaver_notice() from public, anon, authenticated;
drop trigger if exists role_grants_weaver_notice on app.role_grants;
create trigger role_grants_weaver_notice after insert or update of status, role_key, user_id on app.role_grants
  for each row execute function app.role_grants_weaver_notice();

-- 0151's first-owner rule: the earliest active center_admin becomes the owner when there is none. When a signed-in
-- person's change sets it off, a platform-admin account is never chosen (Weaver's team sets up an owner by invitation, or
-- by giving a person who is not on the team the Center admin role). Without a signed-in user (the SQL editor's
-- bootstrap_first_admin, migrations, jobs) it is 0151's rule as it was.
create or replace function app.ensure_center_owner(p_center uuid) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_user uuid;
begin
  select user_id into v_user from app.center_owners where center_id = p_center;
  if v_user is not null then return v_user; end if;
  select g.user_id into v_user from app.role_grants g
   where g.center_id = p_center and g.role_key = 'center_admin' and g.scope_kind = 'center' and g.status = 'active'
     and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
     and (auth.uid() is null or not exists (select 1 from app.accounts a where a.user_id = g.user_id and a.is_platform_admin))
   order by g.starts_at, g.created_at, g.id limit 1;
  if v_user is null then return null; end if;
  insert into app.center_owners (center_id, user_id) values (p_center, v_user) on conflict (center_id) do nothing;
  return (select user_id from app.center_owners where center_id = p_center);
end $$;

-- Nobody makes themselves the owner, platform admins included: not by a transfer (0151's transfer_ownership lets a
-- platform admin choose any active administrator, themselves too), not by the first-owner rule. The one way in is
-- accepting an owner's or administrator's invitation that someone else sent (0502's accept_invitation).
create or replace function app.center_owners_self_rule() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then return new; end if;
  if new.user_id = auth.uid() and (tg_op = 'INSERT' or old.user_id is distinct from new.user_id) then
    if exists (select 1 from app.staff_invitations i
                where i.center_id = new.center_id and i.accepted_by = auth.uid() and i.accepted_at = now()
                  and i.revoked_at is null and i.invited_by is distinct from auth.uid()
                  and (i.makes_owner or 'center_admin' = any (i.role_keys))) then
      return new;
    end if;
    raise exception 'Nobody can make themselves the owner of a community, Weaver''s team included. The owner transfers ownership to another administrator, or Weaver invites the owner.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function app.center_owners_self_rule() from public, anon, authenticated;
drop trigger if exists center_owners_self on app.center_owners;
create trigger center_owners_self before insert or update on app.center_owners
  for each row execute function app.center_owners_self_rule();

-- Every ownership change a platform admin makes is audited and emailed: on a transfer to the owner it replaces, when a
-- community gets its first owner to that new owner. A demo community is left out.
create or replace function app.center_owners_weaver_notice() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_mail jsonb; c record;
begin
  if auth.uid() is null or not app.is_platform_admin() then return null; end if;
  if tg_op = 'UPDATE' and old.user_id = new.user_id then return null; end if;
  if app.is_demo_center(new.center_id) then return null; end if;
  select * into c from app.audit_context();
  v_mail := app._weaver_change_email(new.center_id, case when tg_op = 'UPDATE' then old.user_id else new.user_id end,
              format('made %s the owner', app._user_label(new.center_id, new.user_id)), c.reason);
  perform app.log_audit(new.center_id, 'ownership.changed_by_weaver', null, null,
    case when tg_op = 'UPDATE' then jsonb_build_object('user_id', old.user_id) end,
    jsonb_build_object('user_id', new.user_id, 'by', auth.uid(), 'email', coalesce(v_mail->>'status', 'failed')), c.reason);
  return null;
end $$;
revoke execute on function app.center_owners_weaver_notice() from public, anon, authenticated;
drop trigger if exists center_owners_weaver_notice on app.center_owners;
create trigger center_owners_weaver_notice after insert or update on app.center_owners
  for each row execute function app.center_owners_weaver_notice();

-- ── Sign-in links: nobody re-links their own, platform admins none ───────────
-- Direct writes through the API only (SECURITY INVOKER: inside the linking functions current_user is the database owner).
create or replace function app.center_users_link_rule() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  if current_user not in ('anon', 'authenticated') or auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' or new.person_id is distinct from old.person_id or new.user_id is distinct from old.user_id
     or new.center_id is distinct from old.center_id then
    if new.user_id = auth.uid() or (tg_op = 'UPDATE' and old.user_id = auth.uid()) then
      raise exception 'Nobody can link their own sign-in to a person record. An invitation or the member app''s join steps do that.'
        using errcode = 'insufficient_privilege';
    end if;
    if app.is_platform_admin() then
      raise exception 'Weaver''s team cannot link a sign-in to a person record. The organization does that, or the person in the member app.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;
revoke execute on function app.center_users_link_rule() from public, anon, authenticated;
drop trigger if exists center_users_link_rule on app.center_users;
create trigger center_users_link_rule before insert or update on app.center_users
  for each row execute function app.center_users_link_rule();

-- ── Demo communities ─────────────────────────────────────────────────────────
-- 0629's rule (every role the community's kind shows has a demo person), except a role that opens only products the demo
-- community does not have: the demo packs make no WeCare or CatchTheMatch data, and both start off for every kind (0750).
-- (create or replace keeps 0629's grants.)
create or replace function app.demo_missing_roles(p_center uuid) returns text[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(r.key order by r.key), '{}'::text[])
    from app.roles r
   where r.tier <> 'platform' and app.catalog_shows(r.category_keys, app.center_category(p_center))
     and not exists (select 1 from app.demo_personas d where d.center_id = p_center and d.role_key = r.key)
     and (cardinality(app.role_private_products(r.key)) = 0
          or exists (select 1 from unnest(app.role_private_products(r.key)) p where app._org_private_module_on(p_center, p)))
$$;

-- ── Counts in the change-of-kind preview ─────────────────────────────────────
-- 0594's counts of one module's records, except WeCare and CatchTheMatch: those are counted only for the community's owner
-- or the product's manager. The preview is a platform admin's screen, so it shows no count for them.
create or replace function app._module_records(p_center uuid, p_module text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t record; n bigint; v jsonb := '{}'::jsonb;
begin
  if p_module in ('care', 'matching') and not (app.is_center_owner(p_center) or app.org_private_can(p_center, p_module || '.manage')) then
    return v;
  end if;
  for t in
    select mt.table_name
      from app.module_tables mt
      join pg_class c on c.relname = mt.table_name and c.relkind in ('r', 'p')
      join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'app'
     where mt.module_key = p_module
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'center_id' and not a.attisdropped)
     order by mt.table_name
  loop
    execute format('select count(*) from app.%I where center_id = $1', t.table_name) into n using p_center;
    if n > 0 then v := v || jsonb_build_object(t.table_name, n); end if;
  end loop;
  return v;
end $$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app._org_holds(uuid, uuid, text), app._org_private_module_on(uuid, text),
  app._may_grant_private(uuid, uuid, text[]), app._private_grant_refusal(uuid, text, text[]), app._user_label(uuid, uuid),
  app._grant_widens(app.role_grants, app.role_grants)
  from public, anon, authenticated;
-- The roles guard runs as the caller (it reads current_user), so what it calls is callable.
revoke execute on function app._perms_open_private(jsonb) from public, anon;
grant execute on function app._perms_open_private(jsonb), app.org_private_product(text) to authenticated, service_role;
revoke execute on function app.org_private_can(uuid, text), app.care_can(uuid, text), app.care_amounts_can(uuid),
  app.matching_can(uuid, text), app.role_private_products(text), app.org_private_product(text), app.org_private_keys(),
  app.may_grant_private_role(uuid, text)
  from public, anon;
grant execute on function app.org_private_can(uuid, text), app.care_can(uuid, text), app.care_amounts_can(uuid),
  app.matching_can(uuid, text), app.role_private_products(text), app.org_private_product(text), app.org_private_keys(),
  app.may_grant_private_role(uuid, text)
  to authenticated;

comment on function app.org_private_can(uuid, text) is
  'The organization''s own data (0757, W2): the owner, or an active center-wide grant of a non-platform role holding the key (or "*") held by an account that is not a platform admin''s, with the product''s module on. No platform-admin branch. Every care/matching table and function uses this (or care_can / matching_can), never has_permission.';
comment on function app.role_private_products(text) is
  'The private products (care, matching) a role opens; empty for platform-tier roles (0757).';
