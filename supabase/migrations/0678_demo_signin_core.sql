-- Demo sign-in (B88) · 2 of 3 · part 1: who a demo visitor is, and the switch that turns it off.
--
-- "Try the demo" lets anyone open a demo community as one of its demo people (an administrator, a treasurer, a member ...)
-- with no code and no real e-mail. The portal holds no service-role key, so the way in is the lightest one that needs none:
--
--   * each demo person gets ONE real sign-in (an auth user on the reserved address, @demo.weaverams.org), created ONCE by a
--     platform admin (app.demo_signin_setup). Its long random password lives only in the Vault (like the other platform keys)
--     and as a hash in Supabase Auth; no browser ever sees it.
--   * the portal server asks the database to start a session (app.worker_demo_begin, 0679: connect_worker only); the database
--     checks the switch, the person, the rate limits, writes the audit entry and hands the password to the portal server, which
--     signs in with it and sets the session cookie. Nobody else can read it.
--   * everything below keeps that sign-in inside the demo community, whatever else happens.
--
--   app.demo_auth_users     one sign-in per demo person (address, Auth user, Vault secret). No policy: nobody reads it through the API.
--   app.demo_sessions       one row per demo sign-in: who (the demo person), the hashed address of the visitor, when it ends
--   app.demo_user_guard     a demo sign-in can only ever belong to its demo community; never a platform admin, never an owner or
--                           staff anywhere else; and a real person's sign-in can never be registered as a demo one
--   app.demo_signin_enabled / set_demo_signin   the kill switch (Platform > Setup > Demo sign-in): off until a platform admin turns it on
--   app.demo_signin_setup   creates the sign-ins once (or rotates their passwords) and links them to the demo people
--   app.demo_link_personas / demo_unlink_personas   the link between a sign-in and its demo person, role and scope. It exists only
--                           while the switch is on: turning the switch off takes every link away at once (so even a token kept
--                           outside the portal sees nothing), turning it on puts them back. A reset takes the links apart before it
--                           clears the community and puts them back after, so the visitor's writes go
--
-- Nothing here changes a policy or a grant of an existing object. New triggers refuse only a demo sign-in.
set client_min_messages = warning;

-- ── Constants and the switch ─────────────────────────────────────────────────
-- Owner decision 2026-10-11: a demo session lasts two hours.
create or replace function app.demo_signin_hours() returns int
language sql immutable set search_path = app, public, extensions as $$ select 2 $$;

-- Per visitor address (hashed) per hour, in the whole platform per hour, and in the whole platform per 5 minutes. The last one keeps
-- the portal under Supabase Auth's own limit for sign-ins from one address (30 per 5 minutes), because every demo sign-in comes from the portal server.
create or replace function app.demo_signin_limits() returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select jsonb_build_object('per_ip_hour', 24, 'global_hour', 300, 'global_5min', 20)
$$;

-- On only when a platform admin switched it on (platform_settings key demo_signin = {"enabled": true, "reason": ...}); no row means off.
create or replace function app.demo_signin_enabled() returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select s.value ->> 'enabled' = 'true' from app.platform_settings s where s.key = 'demo_signin'), false)
$$;

-- ── The sign-ins ─────────────────────────────────────────────────────────────
create table if not exists app.demo_auth_users (
  email           text primary key check (email = lower(email) and email like '%@demo.weaverams.org'),
  user_id         uuid not null unique references auth.users(id) on delete cascade,
  vault_secret_id uuid not null,
  created_at      timestamptz not null default now(),
  rotated_at      timestamptz
);
comment on table app.demo_auth_users is
  'One real sign-in per demo person (B88 part 2): the address is on the reserved domain demo.weaverams.org, the password is in the Vault. Read only by the database functions.';
alter table app.demo_auth_users enable row level security;
revoke all on app.demo_auth_users from anon, authenticated;
grant all on app.demo_auth_users to service_role;

-- No center_id column on purpose: a reset clears every table that has one, and a visitor's sign-in record must outlive a reset.
create table if not exists app.demo_sessions (
  id              uuid primary key default gen_random_uuid(),
  persona_email   text not null check (persona_email like '%@demo.weaverams.org'),
  user_id         uuid not null references auth.users(id) on delete cascade,
  role_key        text not null,
  ip_hash         text not null check (char_length(ip_hash) between 1 and 64),
  started_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  auth_session_id uuid unique,
  ended_at        timestamptz,
  ended_reason    text check (ended_reason in ('left', 'switched', 'expired', 'switched_off', 'failed', 'reset')),
  check ((ended_at is null) = (ended_reason is null))
);
create index if not exists demo_sessions_ip on app.demo_sessions (ip_hash, started_at desc);
create index if not exists demo_sessions_started on app.demo_sessions (started_at desc);
create index if not exists demo_sessions_live on app.demo_sessions (expires_at) where ended_at is null;
comment on table app.demo_sessions is
  'Every demo sign-in (B88 part 2): the demo person, a hash of the visitor''s address (never the address), when it ends and why it ended.';
alter table app.demo_sessions enable row level security;
revoke all on app.demo_sessions from anon, authenticated;
grant all on app.demo_sessions to service_role;

drop trigger if exists audit_demo_auth_users on app.demo_auth_users;
create trigger audit_demo_auth_users after insert or update or delete on app.demo_auth_users
  for each row execute function app.audit_row('email');
-- A session is audited when it starts and when it is pruned; how it ended is written by app.demo_end.
drop trigger if exists audit_demo_sessions on app.demo_sessions;
create trigger audit_demo_sessions after insert or delete on app.demo_sessions
  for each row execute function app.audit_row();
insert into app.module_tables (table_name, module_key) values ('demo_auth_users', null), ('demo_sessions', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- ── The audit entry of a demo sign-in or sign-out ───────────────────────────
-- Who = the demo person (their sign-in), where from = the hash of the visitor's address. Recorded as the system's own work
-- (client app 'job'), so a sign-in on its own never makes the nightly check think someone changed the community.
create or replace function app.demo_audit(p_center uuid, p_action text, p_user uuid, p_record text, p_after jsonb, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  insert into app.audit_log (center_id, actor_user_id, actor_role, action, record_table, record_id, after, reason, client_app)
  values (p_center, p_user, 'demo', p_action, 'demo_sessions', p_record, p_after, app.audit_clean_reason(p_reason), 'job');
end $$;

-- End one demo session: the row, the Auth session (so its refresh token stops working) and the audit entry.
create or replace function app.demo_end(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.demo_sessions; v_center uuid;
begin
  update app.demo_sessions set ended_at = now(), ended_reason = p_reason
   where id = p_session and ended_at is null returning * into s;
  if s.id is null then return; end if;
  if s.auth_session_id is not null then
    delete from auth.sessions where id = s.auth_session_id;
  end if;
  select d.center_id into v_center from app.demo_personas d where d.email = s.persona_email;
  perform app.demo_audit(v_center, 'demo.sign_out', s.user_id, s.id::text,
    jsonb_build_object('persona', s.persona_email, 'role', s.role_key, 'ended', p_reason, 'ip_hash', s.ip_hash),
    'Demo session ended: ' || p_reason);
end $$;

-- Ends what has run out: sessions past their time (or all of them when the switch is off), sign-ins the portal never finished,
-- and any Auth session of a demo person that the database does not know. Also prunes old rows. Run at every demo start, by every
-- state check and by the hourly demo.reset job.
create or replace function app.demo_signin_sweep() returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare s record; n int := 0; v_on boolean := app.demo_signin_enabled();
begin
  for s in
    select d.id, d.expires_at, d.auth_session_id, d.started_at
      from app.demo_sessions d
     where d.ended_at is null
       and (d.expires_at <= now() or not v_on or (d.auth_session_id is null and d.started_at < now() - interval '5 minutes'))
  loop
    perform app.demo_end(s.id, case when not v_on then 'switched_off' when s.auth_session_id is null and s.expires_at > now() then 'failed' else 'expired' end);
    n := n + 1;
  end loop;
  delete from auth.sessions x
   where x.user_id in (select a.user_id from app.demo_auth_users a)
     and x.created_at < now() - interval '5 minutes'
     and not exists (select 1 from app.demo_sessions d where d.auth_session_id = x.id and d.ended_at is null);
  delete from app.demo_sessions where ended_at < now() - interval '30 days';
  return n;
end $$;

-- ── Keep a demo sign-in inside its demo community ────────────────────────────
-- (1) A demo sign-in can only be a member, owner or role holder of a demo community, and never a platform admin.
-- (2) A sign-in that already belongs somewhere else, or is a platform admin, or has signed in before, can never be registered as a demo one.
create or replace function app.demo_user_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if tg_table_name = 'demo_auth_users' then
    if exists (select 1 from app.center_users cu where cu.user_id = new.user_id and not app.is_demo_center(cu.center_id))
       or exists (select 1 from app.role_grants g where g.user_id = new.user_id and not app.is_demo_center(g.center_id))
       or exists (select 1 from app.center_owners o where o.user_id = new.user_id and not app.is_demo_center(o.center_id))
       or coalesce((select a.is_platform_admin from app.accounts a where a.user_id = new.user_id), false) then
      raise exception 'That sign-in belongs to a real person or community, so it cannot be a demo sign-in.' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from auth.users u where u.id = new.user_id and lower(u.email) = new.email) then
      raise exception 'The demo sign-in must use the demo person''s own address.' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'accounts' then
    if new.is_platform_admin and exists (select 1 from app.demo_auth_users a where a.user_id = new.user_id) then
      raise exception 'A demo sign-in can never be a platform admin.' using errcode = 'check_violation';
    end if;
  elsif exists (select 1 from app.demo_auth_users a where a.user_id = new.user_id) and not app.is_demo_center(new.center_id) then
    raise exception 'A demo sign-in can only belong to its demo community.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists zz_demo_user_guard on app.demo_auth_users;
create trigger zz_demo_user_guard before insert or update on app.demo_auth_users for each row execute function app.demo_user_guard();
drop trigger if exists zz_demo_user_guard on app.center_users;
create trigger zz_demo_user_guard before insert or update on app.center_users for each row execute function app.demo_user_guard();
drop trigger if exists zz_demo_user_guard on app.role_grants;
create trigger zz_demo_user_guard before insert or update on app.role_grants for each row execute function app.demo_user_guard();
drop trigger if exists zz_demo_user_guard on app.center_owners;
create trigger zz_demo_user_guard before insert or update on app.center_owners for each row execute function app.demo_user_guard();
drop trigger if exists zz_demo_user_guard on app.accounts;
create trigger zz_demo_user_guard before insert or update on app.accounts for each row execute function app.demo_user_guard();

-- ── The link between a sign-in and its demo person ──────────────────────────
-- Put the sign-in back to what the database wants: the persona's address, the stored password, confirmed, not banned, no phone
-- and no authenticator app of its own, marked as a demo user. Written only when something differs (so a normal start writes nothing),
-- which also repairs a sign-in a visitor tried to change from their own browser.
create or replace function app.demo_assert_auth_user(p_user uuid, p_email text, p_pw text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update auth.users u
     set email = p_email,
         encrypted_password = extensions.crypt(p_pw, extensions.gen_salt('bf', 10)),
         email_confirmed_at = coalesce(u.email_confirmed_at, now()),
         banned_until = null,
         phone = null,
         raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'demo', true),
         updated_at = now()
   where u.id = p_user
     and (u.email is distinct from p_email
          or u.email_confirmed_at is null
          or u.banned_until is not null
          or u.phone is not null
          or coalesce(u.raw_app_meta_data ->> 'demo', '') <> 'true'
          or not coalesce(case when u.encrypted_password ~ '^\$2[abxy]\$[0-9]{2}\$.{53}$'
                               then u.encrypted_password = extensions.crypt(p_pw, u.encrypted_password) end, false));
  delete from auth.mfa_factors where user_id = p_user;
end $$;

-- Give every demo person of a demo community that has a sign-in: an account, the membership of their person, and their role with its
-- scope. Only while the switch is on: with it off a demo sign-in holds no membership and no role anywhere, so even a token kept outside
-- the portal can see and change nothing. A demo community asks no one for an authenticator app (nothing in it is real), and a sign-in
-- is never a platform admin.
create or replace function app.demo_link_personas(p_center uuid) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; n int := 0;
begin
  if not app.is_demo_center(p_center) or not app.demo_signin_enabled() then return 0; end if;
  update app.centers
     set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{security}',
                           coalesce(rules -> 'security', '{}'::jsonb) || jsonb_build_object('require_2fa_for_staff', false))
   where id = p_center and coalesce(rules #>> '{security,require_2fa_for_staff}', 'true') <> 'false';
  for r in
    select d.email, d.person_id, d.role_key, d.scope_kind, d.scope_id, a.user_id
      from app.demo_personas d join app.demo_auth_users a on a.email = d.email
     where d.center_id = p_center
     order by d.sort_order, d.email
  loop
    insert into app.accounts (user_id) values (r.user_id)
    on conflict (user_id) do update set status = 'active', is_platform_admin = false;
    insert into app.center_users (center_id, user_id, person_id, is_default)
    values (p_center, r.user_id, r.person_id, true)
    on conflict do nothing;
    insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id, reason)
    select p_center, r.user_id, r.role_key, r.scope_kind, r.scope_id, 'Demo person'
     where not exists (select 1 from app.role_grants g
                        where g.center_id = p_center and g.user_id = r.user_id and g.role_key = r.role_key
                          and g.scope_kind = r.scope_kind and g.scope_id is not distinct from r.scope_id and g.status = 'active');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Take the links apart (before a reset clears the community, so what a visitor changed is not kept).
create or replace function app.demo_unlink_personas(p_center uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  delete from app.role_grants g where g.center_id = p_center and g.user_id in (select a.user_id from app.demo_auth_users a);
  delete from app.center_users cu where cu.center_id = p_center and cu.user_id in (select a.user_id from app.demo_auth_users a);
  -- The demo administrator is the community's owner (the first active administrator becomes one); without the role there is no ownership either.
  -- It comes back with the role (app.ensure_center_owner).
  delete from app.center_owners o where o.center_id = p_center and o.user_id in (select a.user_id from app.demo_auth_users a);
end $$;

-- ── Set up (once) or rotate ──────────────────────────────────────────────────
-- Platform admin, a reason, a fresh 2FA check. Makes the sign-in of every demo person that has none (the auth user, its identity,
-- a long random password in the Vault), refuses an address that already belongs to someone, then links everybody. With p_rotate the
-- passwords of the existing sign-ins are replaced too and every demo session ends.
create or replace function app.demo_signin_setup(p_reason text, p_rotate boolean default false) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; c record; au app.demo_auth_users; s record; v_user uuid; v_pw text; v_secret uuid;
        v_created int := 0; v_kept int := 0; v_rotated int := 0; v_linked int := 0; v_refused jsonb := '[]'::jsonb;
begin
  perform app.assert_platform_admin('set up demo sign-in');
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why demo sign-in is being set up or reset.'; end if;
  perform app.assert_platform_step_up('demo.signin_setup');
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context(p_reason);
  for r in
    select distinct on (d.email) d.email, d.display_name
      from app.demo_personas d join app.centers ce on ce.id = d.center_id
     where app.is_demo_center(ce.id) and ce.environment = 'sandbox'
       and d.email = lower(d.email) and d.email like ('%@' || app.demo_persona_domain())
     order by d.email
  loop
    select * into au from app.demo_auth_users a where a.email = r.email;
    if au.email is not null then
      if coalesce(p_rotate, false) then
        v_pw := encode(extensions.gen_random_bytes(32), 'hex');
        perform vault.update_secret(au.vault_secret_id, v_pw);
        update app.demo_auth_users set rotated_at = now() where email = au.email;
        perform app.demo_assert_auth_user(au.user_id, au.email, v_pw);
        for s in select id from app.demo_sessions where user_id = au.user_id and ended_at is null loop
          perform app.demo_end(s.id, 'reset');
        end loop;
        delete from auth.sessions where user_id = au.user_id;
        v_rotated := v_rotated + 1;
      else
        v_kept := v_kept + 1;
      end if;
      continue;
    end if;
    select u.id into v_user from auth.users u where lower(u.email) = r.email limit 1;
    if v_user is not null then
      -- The address is already an account. It is taken over only if it is clearly nobody's: no membership, no role, not a platform
      -- admin, never signed in. Anything else is left alone and reported.
      if exists (select 1 from app.center_users cu where cu.user_id = v_user)
         or exists (select 1 from app.role_grants g where g.user_id = v_user)
         or exists (select 1 from app.center_owners o where o.user_id = v_user)
         or coalesce((select a.is_platform_admin from app.accounts a where a.user_id = v_user), false)
         or exists (select 1 from auth.users u where u.id = v_user and u.last_sign_in_at is not null) then
        v_refused := v_refused || jsonb_build_object('email', r.email, 'why', 'The address already belongs to someone. Remove that account in Supabase, then run this again.');
        continue;
      end if;
      delete from auth.sessions where user_id = v_user;
    else
      v_user := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                              created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change,
                              email_change_token_current, phone_change, phone_change_token, reauthentication_token)
      values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', r.email, '', now(),
              jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'demo', true),
              jsonb_build_object('demo', true), now(), now(), '', '', '', '', '', '', '', '');
    end if;
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    select gen_random_uuid(), v_user, v_user::text, 'email',
           jsonb_build_object('sub', v_user::text, 'email', r.email, 'email_verified', true, 'phone_verified', false), now(), now(), now()
     where not exists (select 1 from auth.identities i where i.user_id = v_user and i.provider = 'email');
    v_pw := encode(extensions.gen_random_bytes(32), 'hex');
    delete from vault.secrets where name = 'connect/demo/' || r.email;
    v_secret := vault.create_secret(v_pw, 'connect/demo/' || r.email, 'Demo sign-in password for ' || r.email);
    insert into app.demo_auth_users (email, user_id, vault_secret_id) values (r.email, v_user, v_secret);
    perform app.demo_assert_auth_user(v_user, r.email, v_pw);
    v_created := v_created + 1;
  end loop;
  for c in select ce.id from app.centers ce where app.is_demo_center(ce.id) and ce.environment = 'sandbox' order by ce.created_at, ce.id loop
    v_linked := v_linked + app.demo_link_personas(c.id);
  end loop;
  return jsonb_build_object('created', v_created, 'kept', v_kept, 'rotated', v_rotated, 'linked', v_linked, 'refused', v_refused);
end $$;

-- ── The switch ───────────────────────────────────────────────────────────────
-- Platform admin, a reason, a fresh 2FA check. Off: no new demo session can start and every running one ends at once (its Auth
-- session is deleted, so it cannot be refreshed, and the portal sends its holder back to the demo page on the next request).
create or replace function app.set_demo_signin(p_enabled boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_reason text := app.audit_clean_reason(p_reason); s record; c record; v_ended int := 0;
begin
  perform app.assert_platform_admin('switch demo sign-in on or off');
  if p_enabled is null then raise exception 'Choose on or off.'; end if;
  if v_reason is null then
    raise exception 'Say why demo sign-in is being switched %. The reason is kept in the audit log.', case when p_enabled then 'on' else 'off' end;
  end if;
  perform app.assert_platform_step_up('demo.signin_switch');
  if p_enabled and not exists (select 1 from app.demo_auth_users) then
    raise exception 'Set up demo sign-in first: no demo person has a sign-in yet.';
  end if;
  perform app.set_audit_context(v_reason);
  insert into app.platform_settings (key, value, set_by, set_at)
  values ('demo_signin', jsonb_build_object('enabled', p_enabled, 'reason', v_reason), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, set_by = excluded.set_by, set_at = excluded.set_at;
  if p_enabled then
    for c in select ce.id from app.centers ce where app.is_demo_center(ce.id) and ce.environment = 'sandbox' order by ce.created_at, ce.id loop
      perform app.demo_link_personas(c.id);
    end loop;
  else
    for s in select id from app.demo_sessions where ended_at is null loop
      perform app.demo_end(s.id, 'switched_off');
      v_ended := v_ended + 1;
    end loop;
    delete from auth.sessions where user_id in (select a.user_id from app.demo_auth_users a);
    -- And the demo people lose their membership and role at once, so a token kept outside the portal can see and change nothing either.
    for c in select ce.id from app.centers ce where app.is_demo_center(ce.id) order by ce.created_at, ce.id loop
      perform app.demo_unlink_personas(c.id);
    end loop;
  end if;
  return jsonb_build_object('enabled', p_enabled, 'ended', v_ended);
end $$;

-- What the Platform > Setup panel shows (platform admins only).
create or replace function app.demo_signin_status() returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare st record;
begin
  perform app.assert_platform_admin('see demo sign-in');
  select s.value as v, s.set_at as at, u.email as by_email into st
    from app.platform_settings s left join auth.users u on u.id = s.set_by where s.key = 'demo_signin';
  return jsonb_build_object(
    'enabled', app.demo_signin_enabled(),
    'reason', st.v ->> 'reason',
    'changed_at', st.at,
    'changed_by', st.by_email,
    'people_total', (select count(distinct d.email) from app.demo_personas d join app.centers c on c.id = d.center_id
                      where app.is_demo_center(c.id) and c.environment = 'sandbox'),
    'people_ready', (select count(*) from app.demo_auth_users),
    'live_sessions', (select count(*) from app.demo_sessions where ended_at is null and expires_at > now()),
    'started_24h', (select count(*) from app.demo_sessions where started_at > now() - interval '24 hours'),
    'hours', app.demo_signin_hours(),
    'limits', app.demo_signin_limits(),
    'communities', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.rules ->> 'demo_kind') order by c.name)
                               from app.centers c where app.is_demo_center(c.id) and c.environment = 'sandbox'), '[]'::jsonb));
end $$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app.demo_signin_hours(), app.demo_signin_limits(), app.demo_signin_enabled(),
  app.demo_audit(uuid, text, uuid, text, jsonb, text), app.demo_end(uuid, text), app.demo_signin_sweep(), app.demo_user_guard(),
  app.demo_assert_auth_user(uuid, text, text), app.demo_link_personas(uuid), app.demo_unlink_personas(uuid),
  app.demo_signin_setup(text, boolean), app.set_demo_signin(boolean, text), app.demo_signin_status()
  from public, anon, authenticated, service_role;
grant execute on function app.demo_signin_setup(text, boolean), app.set_demo_signin(boolean, text), app.demo_signin_status() to authenticated;
