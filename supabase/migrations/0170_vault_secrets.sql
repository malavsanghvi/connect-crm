-- Onboarding (stream o-vault) · 1 of 3: the credential vault.
--
-- Secrets (provider API keys, OAuth tokens, webhook secrets) live only in
-- Supabase Vault (vault.secrets, encrypted at rest). What the app keeps is a
-- fingerprint: the last 4 characters, who set it, when, and when it was last
-- rotated (app.integration_secrets). Nobody reads a secret back over the API:
--   * anon / authenticated have no USAGE on schema vault at all;
--   * app.integration_secrets never holds the value, and its vault_secret_id
--     column is not granted to anyone;
--   * the only reader is app.worker_read_secret(), executable by the DB role
--     connect_worker alone, and every call is written to app.secret_access_log.
--
-- What the hosted `postgres` role can do with Vault (measured on the
-- supabase/postgres 17.4 image, the same grants as a hosted project):
--   USAGE on schema vault; EXECUTE on vault.create_secret / vault.update_secret
--   (SECURITY DEFINER, owned by supabase_admin); SELECT and DELETE on
--   vault.secrets and vault.decrypted_secrets; no INSERT/UPDATE on the table.
-- So every write goes through vault.create_secret / vault.update_secret, reads
-- through vault.decrypted_secrets, and removal is a DELETE on vault.secrets,
-- all inside SECURITY DEFINER functions owned by postgres.
--
-- The DB role connect_worker is created here WITHOUT a password (it cannot log
-- in until one is set). The owner sets it once, outside git (docs/DEPLOY.md):
--   alter role connect_worker with password '<generated>';
-- and stores the matching connection string as the WORKER_DATABASE_URL secret.

-- ── Supabase Vault must be there ─────────────────────────────────────────────
do $$ begin
  if to_regprocedure('vault.create_secret(text,text,text,uuid)') is null then
    begin
      create extension if not exists supabase_vault;
    exception when others then
      raise exception 'Supabase Vault is not available (%). Enable the "supabase_vault" extension under Database › Extensions, then deploy again.', sqlerrm;
    end;
  end if;
end $$;

-- ── Contract functions owned by o-security, stubbed only when missing ────────
-- Same names, argument names and return types as ONBOARDING_CONTRACT.md, so
-- o-security's `create or replace` lands on top of these without a conflict.
do $$ begin
  if to_regprocedure('app.is_aal2()') is null then
    execute $f$
      create function app.is_aal2() returns boolean
      language sql stable set search_path = app, public, extensions as $b$
        select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      $b$ $f$;
    grant execute on function app.is_aal2() to authenticated, service_role;
  end if;

  if to_regprocedure('app.has_recent_step_up(integer)') is null then
    -- The JWT "amr" claim lists how and when the session was authenticated,
    -- e.g. [{"method":"otp","timestamp":…},{"method":"totp","timestamp":…}].
    execute $f$
      create function app.has_recent_step_up(p_minutes int default 5) returns boolean
      language sql stable set search_path = app, public, extensions as $b$
        select exists (
          select 1
            from jsonb_array_elements(case when jsonb_typeof(auth.jwt()->'amr') = 'array'
                                           then auth.jwt()->'amr' else '[]'::jsonb end) e
           where jsonb_typeof(e) = 'object'
             and e->>'method' = 'totp'
             and (e->>'timestamp') ~ '^[0-9]+$'
             and (e->>'timestamp')::bigint >= extract(epoch from now())::bigint - greatest(coalesce(p_minutes, 5), 1) * 60)
      $b$ $f$;
    grant execute on function app.has_recent_step_up(integer) to authenticated, service_role;
  end if;

  if to_regprocedure('app.assert_step_up(text)') is null then
    execute $f$
      create function app.assert_step_up(p_action text) returns void
      language plpgsql stable set search_path = app, public, extensions as $b$
      begin
        if not app.has_recent_step_up(5) then
          raise exception 'This needs a fresh 2FA check.'
            using errcode = 'CCSTP', hint = 'Confirm with your authenticator app, then try again.',
                  detail = coalesce(p_action, '');
        end if;
      end $b$ $f$;
    grant execute on function app.assert_step_up(text) to authenticated, service_role;
  end if;

  if to_regprocedure('app.is_center_owner(uuid)') is null then
    -- Until o-security's app.center_owners exists nobody is an owner: owner-only
    -- actions then need the permission route (or a platform admin, where the
    -- caller allows one). Dynamic SQL, so the table can arrive later.
    execute $f$
      create function app.is_center_owner(p_center uuid) returns boolean
      language plpgsql stable security definer set search_path = app, public, extensions as $b$
      declare v boolean := false;
      begin
        if auth.uid() is null or p_center is null or to_regclass('app.center_owners') is null then return false; end if;
        execute 'select exists (select 1 from app.center_owners where center_id = $1 and user_id = $2)'
           into v using p_center, auth.uid();
        return coalesce(v, false);
      end $b$ $f$;
    grant execute on function app.is_center_owner(uuid) to authenticated, service_role;
  end if;
end $$;

-- ── The worker's database role ───────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'connect_worker') then
    -- LOGIN but no password: nothing can sign in as it until the owner sets one.
    create role connect_worker login noinherit connection limit 10;
  end if;
end $$;
alter role connect_worker set search_path = app, public, extensions;
alter role connect_worker set statement_timeout = '60s';
alter role connect_worker set idle_in_transaction_session_timeout = '60s';
grant usage on schema app to connect_worker;

-- Only the worker, connected as connect_worker, passes. The "role" setting
-- still names the caller inside a SECURITY DEFINER function (PostgREST sets it
-- to anon / authenticated / service_role), so a later blanket
-- `grant execute on all functions … to service_role` cannot open these up.
create or replace function app.assert_worker() returns void
language plpgsql stable set search_path = app, public, extensions as $$
begin
  if coalesce(nullif(current_setting('role', true), 'none'), session_user::text) <> 'connect_worker' then
    raise exception 'Only the background service can do this.' using errcode = 'insufficient_privilege';
  end if;
end $$;

-- ── Secrets ──────────────────────────────────────────────────────────────────
create table if not exists app.integration_secrets (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references app.centers(id) on delete cascade,
  connection_id   uuid not null references app.integration_connections(id) on delete cascade,
  name            text not null check (name ~ '^[a-z][a-z0-9_.-]{0,62}$'),
  vault_secret_id uuid not null unique,
  fingerprint     text not null check (char_length(fingerprint) <= 4),
  set_by          uuid references auth.users(id),
  set_at          timestamptz not null default now(),
  rotated_at      timestamptz,
  unique (connection_id, name)
);
create index if not exists integration_secrets_center_idx on app.integration_secrets (center_id);

-- Every decryption: which connection and secret, which worker, why, when.
create table if not exists app.secret_access_log (
  id            bigserial primary key,
  center_id     uuid references app.centers(id) on delete cascade,
  connection_id uuid not null,
  name          text not null,
  reader        text not null,
  purpose       text not null,
  job_id        bigint,
  outcome       text not null default 'read' check (outcome in ('read','missing')),
  read_at       timestamptz not null default now()
);
create index if not exists secret_access_log_center_idx on app.secret_access_log (center_id, read_at desc);
create index if not exists secret_access_log_connection_idx on app.secret_access_log (connection_id, read_at desc);

insert into app.module_tables (table_name, module_key) values
  ('integration_secrets', null), ('secret_access_log', null)
on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_integration_secrets on app.integration_secrets;
create trigger audit_integration_secrets after insert or update or delete on app.integration_secrets
  for each row execute function app.audit_row();
drop trigger if exists audit_secret_access_log on app.secret_access_log;
create trigger audit_secret_access_log after insert or update or delete on app.secret_access_log
  for each row execute function app.audit_row();

-- A fingerprint row never outlives its vault entry, and a vault entry never
-- outlives its row (a connection deleted with its secrets cascades here).
create or replace function app.integration_secrets_drop_vault() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end $$;
revoke execute on function app.integration_secrets_drop_vault() from public, anon, authenticated;
drop trigger if exists integration_secrets_drop_vault on app.integration_secrets;
create trigger integration_secrets_drop_vault after delete on app.integration_secrets
  for each row execute function app.integration_secrets_drop_vault();

-- The access log is append-only.
create or replace function app.secret_access_log_immutable() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  raise exception 'The secret access log cannot be changed.';
end $$;
drop trigger if exists secret_access_log_immutable on app.secret_access_log;
create trigger secret_access_log_immutable before update on app.secret_access_log
  for each row execute function app.secret_access_log_immutable();

alter table app.integration_secrets enable row level security;
alter table app.secret_access_log enable row level security;

-- Who may change a connection's secrets: the owner, or someone holding
-- integrations.manage through a center-wide grant in THAT center. Unlike
-- app.has_permission there is no platform-admin shortcut: Community Connect
-- staff do not handle an organization's credentials.
create or replace function app.can_manage_integration_secrets(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and (
    app.is_center_owner(p_center)
    or exists (
      select 1 from app.role_grants g join app.roles r on r.key = g.role_key
       where g.center_id = p_center and g.user_id = auth.uid()
         and g.scope_kind in ('center','platform')
         and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
         and (r.permissions ? 'integrations.manage' or r.permissions ? '*')))
$$;

drop policy if exists integration_secrets_staff_read on app.integration_secrets;
create policy integration_secrets_staff_read on app.integration_secrets for select to authenticated
  using (app.has_permission(center_id, 'integrations.view') or app.has_permission(center_id, 'integrations.manage')
         or app.is_center_owner(center_id));
drop policy if exists secret_access_log_staff_read on app.secret_access_log;
create policy secret_access_log_staff_read on app.secret_access_log for select to authenticated
  using (app.has_permission(center_id, 'integrations.view') or app.has_permission(center_id, 'integrations.manage')
         or app.is_center_owner(center_id));

-- Fingerprints only: no writes over the API, and vault_secret_id is not granted.
revoke all on app.integration_secrets, app.secret_access_log from public, anon, authenticated, service_role, connect_worker;
grant select (id, center_id, connection_id, name, fingerprint, set_by, set_at, rotated_at)
  on app.integration_secrets to authenticated;
grant select on app.secret_access_log to authenticated;
revoke all on sequence app.secret_access_log_id_seq from public, anon, authenticated, service_role;

-- ── Set / replace / rotate ───────────────────────────────────────────────────
-- Owner or integrations.manage, a fresh 2FA check, and a reason. The value is
-- never logged or returned: the audit entry carries the fingerprint only.
create or replace function app.set_integration_secret(p_connection uuid, p_name text, p_value text, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_provider text; s app.integration_secrets; v_vault uuid; v_name text := lower(btrim(p_name));
begin
  select center_id, provider into v_center, v_provider from app.integration_connections where id = p_connection;
  if v_center is null then raise exception 'That connection was not found.'; end if;
  if not app.can_manage_integration_secrets(v_center) then
    raise exception 'Changing a connection''s secrets needs the organization owner or the integrations.manage permission.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_name is null or v_name !~ '^[a-z][a-z0-9_.-]{0,62}$' then
    raise exception 'Give the secret a short name in lower case, for example api_key or webhook_secret.';
  end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why the secret is being changed.';
  end if;
  if p_value is null or btrim(p_value) = '' then raise exception 'Paste the secret value.'; end if;
  if char_length(p_value) < 8 then
    raise exception 'That value is too short to be a real secret (at least 8 characters).';
  end if;
  if char_length(p_value) > 65536 then raise exception 'That value is too long to be a secret.'; end if;
  perform app.assert_step_up('integration_secret.set');
  perform app.set_audit_context(p_reason);

  select * into s from app.integration_secrets where connection_id = p_connection and name = v_name for update;
  if found then
    perform vault.update_secret(s.vault_secret_id, p_value);
    update app.integration_secrets
       set fingerprint = right(p_value, 4), set_by = auth.uid(), set_at = now(), rotated_at = now()
     where id = s.id;
    return jsonb_build_object('name', v_name, 'fingerprint', right(p_value, 4), 'rotated', true);
  end if;

  v_vault := vault.create_secret(p_value, 'connect/' || p_connection || '/' || v_name,
                                 'Community Connect ' || v_provider || ' secret "' || v_name || '"');
  insert into app.integration_secrets (center_id, connection_id, name, vault_secret_id, fingerprint, set_by)
  values (v_center, p_connection, v_name, v_vault, right(p_value, 4), auth.uid());
  return jsonb_build_object('name', v_name, 'fingerprint', right(p_value, 4), 'rotated', false);
end $$;

-- Disconnect one secret: the vault entry is deleted with the row (trigger above).
create or replace function app.revoke_integration_secret(p_connection uuid, p_name text, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_id uuid;
begin
  select center_id into v_center from app.integration_connections where id = p_connection;
  if v_center is null then raise exception 'That connection was not found.'; end if;
  if not app.can_manage_integration_secrets(v_center) then
    raise exception 'Removing a connection''s secrets needs the organization owner or the integrations.manage permission.'
      using errcode = 'insufficient_privilege';
  end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why the secret is being removed.';
  end if;
  select id into v_id from app.integration_secrets where connection_id = p_connection and name = lower(btrim(p_name));
  if v_id is null then raise exception 'No secret named "%" is stored for that connection.', p_name; end if;
  perform app.assert_step_up('integration_secret.revoke');
  perform app.set_audit_context(p_reason);
  delete from app.integration_secrets where id = v_id;
end $$;

-- ── The one reader ───────────────────────────────────────────────────────────
-- connect_worker only. Every call is logged, including a call for a secret
-- that is not stored (outcome 'missing', returns NULL). Purpose defaults to
-- the worker's app.worker_purpose setting; the job id to app.job_id.
create or replace function app.worker_read_secret(p_connection uuid, p_name text, p_purpose text default null)
returns text language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.integration_secrets; v_center uuid; v_value text; v_job bigint; v_job_txt text;
begin
  perform app.assert_worker();
  select * into s from app.integration_secrets where connection_id = p_connection and name = lower(btrim(p_name));
  v_center := coalesce(s.center_id, (select center_id from app.integration_connections where id = p_connection));
  v_job_txt := nullif(btrim(current_setting('app.job_id', true)), '');
  v_job := case when v_job_txt ~ '^[0-9]{1,18}$' then v_job_txt::bigint end;
  perform set_config('app.client_app', 'job', true);
  insert into app.secret_access_log (center_id, connection_id, name, reader, purpose, job_id, outcome)
  values (v_center, p_connection, coalesce(lower(btrim(p_name)), ''),
          left(coalesce(nullif(btrim(current_setting('app.worker_id', true)), ''), session_user::text), 200),
          left(coalesce(nullif(btrim(p_purpose), ''), nullif(btrim(current_setting('app.worker_purpose', true)), ''), 'unspecified'), 500),
          v_job, case when s.id is null then 'missing' else 'read' end);
  if s.id is null then return null; end if;
  select decrypted_secret into v_value from vault.decrypted_secrets where id = s.vault_secret_id;
  return v_value;
end $$;

revoke execute on function app.assert_worker(), app.can_manage_integration_secrets(uuid),
  app.set_integration_secret(uuid, text, text, text), app.revoke_integration_secret(uuid, text, text),
  app.worker_read_secret(uuid, text, text), app.secret_access_log_immutable()
  from public, anon, authenticated, service_role;
grant execute on function app.set_integration_secret(uuid, text, text, text),
  app.revoke_integration_secret(uuid, text, text), app.can_manage_integration_secrets(uuid) to authenticated;
grant execute on function app.worker_read_secret(uuid, text, text), app.assert_worker() to connect_worker;
