-- Onboarding Wave D · stream o-platform-setup · 1 of 1: the Community Connect
-- platform setup wizard (/platform/setup) — the super admin's first sign-in.
--
--   app.platform_secrets        Community Connect's OWN provider keys (Stripe, PayPal, Intuit,
--                               Resend/Postmark, Twilio, Anthropic, Expo, the Auth hook secrets),
--                               kept in Supabase Vault; the app keeps a fingerprint (last 4) only
--   app.platform_settings       non-secret platform settings (portal domain, wildcard domain,
--                               sender address, client ids, webhook ids, from number, ...)
--   app.platform_setup_steps    the wizard's steps: required or optional; done or parked (who/when)
--
--   app.set_platform_secret(name, value, reason)    platform admin + fresh 2FA; audited, never logged
--   app.set_platform_setting(key, value, reason)    platform admin + fresh 2FA; audited
--   app.complete_platform_setup_step / park_platform_setup_step / reopen_platform_setup_step
--   app.enqueue_platform_test(step)                 queues platform.test_provider for the worker
--   app.platform_auth_hook_activity(since)          did the Auth hooks send a sign-in code?
--   app.platform_domain_allowed(domain)             anon: true/false for Caddy's on-demand TLS ask (o-https)
--   app.worker_platform_config()                    connect_worker: settings + secret NAMES/fingerprints
--   app.worker_read_platform_secret(name, purpose)  connect_worker: one value, logged in secret_access_log
--
-- Who reads the values: the background service and the portal SERVER (both as the
-- connect_worker role, never a browser, never the Supabase secret key). They read
-- the database first and fall back to their environment variables, so a key saved
-- here works without a redeploy (cache <= 60 s). WORKER_DATABASE_URL itself cannot be
-- saved here: the app needs it to reach the database (bootstrap).
--
-- Nothing is deleted: a secret is replaced or rotated, never removed through the app.
set client_min_messages = warning;

-- ── Catalog: which names may be stored (the portal shows the same list) ──────
create or replace function app.platform_secret_names() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    'RESEND_API_KEY','RESEND_WEBHOOK_SECRET','POSTMARK_SERVER_TOKEN','POSTMARK_ACCOUNT_TOKEN','POSTMARK_WEBHOOK_TOKEN',
    'MESSAGING_LINK_SECRET','SEND_EMAIL_HOOK_SECRET','SEND_SMS_HOOK_SECRET',
    'STRIPE_SECRET_KEY','STRIPE_TEST_SECRET_KEY','STRIPE_WEBHOOK_SECRET','PAYPAL_CLIENT_SECRET','PAYPAL_SANDBOX_CLIENT_SECRET',
    'OAUTH_STATE_SECRET','TWILIO_AUTH_TOKEN','INTUIT_CLIENT_SECRET','INTUIT_SANDBOX_CLIENT_SECRET',
    'ANTHROPIC_API_KEY','EXPO_ACCESS_TOKEN']
$$;

create or replace function app.platform_setting_keys() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    'portal_domain','wildcard_domain',
    'MESSAGING_EMAIL_PROVIDER','MESSAGING_FROM_ADDRESS','MESSAGING_FROM_NAME',
    'STRIPE_CLIENT_ID','PAYPAL_CLIENT_ID','PAYPAL_SANDBOX_CLIENT_ID','PAYPAL_PARTNER_ID','PAYPAL_BN_CODE',
    'PAYPAL_WEBHOOK_ID','PAYPAL_SANDBOX_WEBHOOK_ID',
    'TWILIO_ACCOUNT_SID','TWILIO_FROM_NUMBER','TWILIO_MESSAGING_SERVICE_SID',
    'INTUIT_CLIENT_ID','INTUIT_SANDBOX_CLIENT_ID','INTUIT_REDIRECT_URI']
$$;

-- ── Tables ───────────────────────────────────────────────────────────────────
create table if not exists app.platform_secrets (
  name            text primary key check (name ~ '^[A-Z][A-Z0-9_]{1,62}$'),
  vault_secret_id uuid not null unique,
  fingerprint     text not null check (char_length(fingerprint) <= 4),
  set_by          uuid references auth.users(id),
  set_at          timestamptz not null default now(),
  rotated_at      timestamptz
);
comment on table app.platform_secrets is 'Community Connect''s own provider keys: the value is in Supabase Vault; only the last 4 characters are kept here.';

create table if not exists app.platform_settings (
  key     text primary key check (key ~ '^[A-Za-z][A-Za-z0-9_]{1,62}$'),
  value   jsonb not null,
  set_by  uuid references auth.users(id),
  set_at  timestamptz not null default now()
);
comment on table app.platform_settings is 'Non-secret platform settings from the setup wizard (portal_domain, wildcard_domain, sender address, client ids, ...).';

create table if not exists app.platform_setup_steps (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  required     boolean not null,
  sort         int not null default 0,
  status       text not null default 'not_started' check (status in ('not_started','done','parked')),
  parked_by    uuid references auth.users(id),
  parked_at    timestamptz,
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  note         text check (note is null or char_length(note) <= 1000),
  check (not (required and status = 'parked'))
);
comment on table app.platform_setup_steps is 'The platform setup wizard: mandatory steps must be done; optional ones may be parked to revisit later.';

insert into app.platform_setup_steps (key, required, sort) values
  ('background', true, 10), ('portal', true, 20), ('email', true, 30), ('hooks', true, 40),
  ('payments', false, 50), ('texting', false, 60), ('quickbooks', false, 70), ('ai', false, 80),
  ('push', false, 90), ('wildcard', false, 100)
on conflict (key) do update set required = excluded.required, sort = excluded.sort;

insert into app.module_tables (table_name, module_key) values
  ('platform_secrets', null), ('platform_settings', null), ('platform_setup_steps', null)
on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_platform_secrets on app.platform_secrets;
create trigger audit_platform_secrets after insert or update or delete on app.platform_secrets
  for each row execute function app.audit_row('name');
drop trigger if exists audit_platform_settings on app.platform_settings;
create trigger audit_platform_settings after insert or update or delete on app.platform_settings
  for each row execute function app.audit_row('key');
drop trigger if exists audit_platform_setup_steps on app.platform_setup_steps;
create trigger audit_platform_setup_steps after insert or update or delete on app.platform_setup_steps
  for each row execute function app.audit_row('key');

-- A fingerprint row never outlives its vault entry.
create or replace function app.platform_secrets_drop_vault() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end $$;
revoke execute on function app.platform_secrets_drop_vault() from public, anon, authenticated;
drop trigger if exists platform_secrets_drop_vault on app.platform_secrets;
create trigger platform_secrets_drop_vault after delete on app.platform_secrets
  for each row execute function app.platform_secrets_drop_vault();

-- RLS: platform admins read; nobody writes over the API (the RPCs below do).
alter table app.platform_secrets enable row level security;
alter table app.platform_settings enable row level security;
alter table app.platform_setup_steps enable row level security;
drop policy if exists platform_secrets_platform_read on app.platform_secrets;
create policy platform_secrets_platform_read on app.platform_secrets for select to authenticated using (app.is_platform_admin());
drop policy if exists platform_settings_platform_read on app.platform_settings;
create policy platform_settings_platform_read on app.platform_settings for select to authenticated using (app.is_platform_admin());
drop policy if exists platform_setup_steps_platform_read on app.platform_setup_steps;
create policy platform_setup_steps_platform_read on app.platform_setup_steps for select to authenticated using (app.is_platform_admin());

revoke all on app.platform_secrets, app.platform_settings, app.platform_setup_steps
  from public, anon, authenticated, service_role, connect_worker;
-- vault_secret_id is not granted to anyone.
grant select (name, fingerprint, set_by, set_at, rotated_at) on app.platform_secrets to authenticated;
grant select on app.platform_settings, app.platform_setup_steps to authenticated;

-- Platform secret reads are logged in the same access log as organizations'
-- (connection_id NULL, name 'platform:<NAME>'). Platform admins already see
-- every row of it (app.has_permission), center staff never see these (no center).
alter table app.secret_access_log alter column connection_id drop not null;

-- ── Helpers ──────────────────────────────────────────────────────────────────
create or replace function app.assert_platform_admin(p_doing text) returns void
language plpgsql stable set search_path = app, public, extensions as $$
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only Community Connect platform admins can %.', coalesce(p_doing, 'do this')
      using errcode = 'insufficient_privilege';
  end if;
end $$;

-- Platform keys ALWAYS need a fresh authenticator check: unlike app.assert_step_up,
-- a platform admin without an authenticator app is not let through.
create or replace function app.assert_platform_step_up(p_action text) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if app.has_recent_step_up(5) then return; end if;
  raise exception using
    errcode = 'CCSTP',
    message = 'This needs a fresh 2FA check.',
    detail  = coalesce(nullif(btrim(p_action), ''), 'platform setup'),
    hint    = case when app.has_verified_totp(auth.uid()) then 'Enter the 6-digit code from your authenticator app, then try again.'
                   else 'Set up an authenticator app in Account › Security, then try again.' end;
end $$;

-- A bare host name: letters, digits, hyphens, dots; at least one dot or "localhost".
create or replace function app.platform_domain_ok(p text) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select p is not null and char_length(p) <= 253
     and (p = 'localhost' or p ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$')
$$;

-- ── Secrets ──────────────────────────────────────────────────────────────────
create or replace function app.set_platform_secret(p_name text, p_value text, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_name text := upper(btrim(coalesce(p_name, ''))); s app.platform_secrets; v_vault uuid;
begin
  perform app.assert_platform_admin('change Community Connect''s provider keys');
  if not (v_name = any (app.platform_secret_names())) then
    raise exception '"%" is not a platform key the setup wizard stores.', p_name;
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why the key is being changed.'; end if;
  if p_value is null or btrim(p_value) = '' then raise exception 'Paste the value.'; end if;
  if p_value <> btrim(p_value) then raise exception 'The value starts or ends with a space; paste it again without it.'; end if;
  if char_length(p_value) < 8 then raise exception 'That value is too short to be a real key (at least 8 characters).'; end if;
  if char_length(p_value) > 8192 then raise exception 'That value is too long to be a key.'; end if;
  perform app.assert_platform_step_up('platform_secret.set');
  perform app.set_audit_context(p_reason);

  select * into s from app.platform_secrets where name = v_name for update;
  if found then
    perform vault.update_secret(s.vault_secret_id, p_value);
    update app.platform_secrets set fingerprint = right(p_value, 4), set_by = auth.uid(), set_at = now(), rotated_at = now()
     where name = v_name;
    return jsonb_build_object('name', v_name, 'fingerprint', right(p_value, 4), 'rotated', true);
  end if;
  v_vault := vault.create_secret(p_value, 'connect/platform/' || v_name, 'Community Connect platform key ' || v_name);
  insert into app.platform_secrets (name, vault_secret_id, fingerprint, set_by) values (v_name, v_vault, right(p_value, 4), auth.uid());
  return jsonb_build_object('name', v_name, 'fingerprint', right(p_value, 4), 'rotated', false);
end $$;

-- ── Settings ─────────────────────────────────────────────────────────────────
create or replace function app.set_platform_setting(p_key text, p_value text, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_key text := btrim(coalesce(p_key, '')); v text := btrim(coalesce(p_value, ''));
begin
  perform app.assert_platform_admin('change platform settings');
  if not (v_key = any (app.platform_setting_keys())) then
    raise exception '"%" is not a platform setting the setup wizard stores.', p_key;
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why the setting is being changed.'; end if;
  if v = '' then raise exception 'Enter a value.'; end if;
  if char_length(v) > 500 or v ~ '[[:cntrl:]]' then raise exception 'That value is too long or has line breaks.'; end if;
  if v_key in ('portal_domain','wildcard_domain') then
    v := lower(regexp_replace(regexp_replace(v, '^https?://', '', 'i'), '/+$', ''));
    if v_key = 'wildcard_domain' then v := regexp_replace(v, '^\*\.', ''); end if;
    if not app.platform_domain_ok(v) then
      raise exception 'Enter a domain name only, for example crm.communityconnect.app (no https://, no path).';
    end if;
  elsif v_key = 'MESSAGING_EMAIL_PROVIDER' then
    v := lower(v);
    if v not in ('resend','postmark') then raise exception 'Choose Resend or Postmark.'; end if;
  elsif v_key = 'MESSAGING_FROM_ADDRESS' then
    if v !~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' then raise exception 'Enter an email address, for example no-reply@mail.communityconnect.app.'; end if;
  elsif v_key = 'TWILIO_FROM_NUMBER' then
    if v !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Enter the number in international format, for example +18325550100.'; end if;
  elsif v_key = 'INTUIT_REDIRECT_URI' then
    if v !~ '^https://[^\s/]+/api/oauth/intuit/callback$' and v !~ '^http://localhost(:[0-9]+)?/api/oauth/intuit/callback$' then
      raise exception 'The redirect address must be https://<portal>/api/oauth/intuit/callback.';
    end if;
  end if;
  perform app.assert_platform_step_up('platform_setting.set');
  perform app.set_audit_context(p_reason);
  insert into app.platform_settings (key, value, set_by, set_at) values (v_key, to_jsonb(v), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, set_by = excluded.set_by, set_at = excluded.set_at;
  return jsonb_build_object('key', v_key, 'value', v);
end $$;

-- ── Wizard steps ─────────────────────────────────────────────────────────────
-- The portal marks a step done only after its live check passed (the check needs
-- the worker's and the portal's own view, which the database cannot see).
create or replace function app.complete_platform_setup_step(p_key text, p_note text default null)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_platform_admin('complete a setup step');
  if not exists (select 1 from app.platform_setup_steps where key = p_key) then raise exception 'That setup step was not found.'; end if;
  perform app.set_audit_context(coalesce(nullif(btrim(p_note), ''), 'Platform setup step checked and done'));
  update app.platform_setup_steps
     set status = 'done', completed_by = auth.uid(), completed_at = now(), parked_by = null, parked_at = null,
         note = coalesce(nullif(left(btrim(p_note), 1000), ''), note)
   where key = p_key;
end $$;

create or replace function app.park_platform_setup_step(p_key text, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.platform_setup_steps;
begin
  perform app.assert_platform_admin('park a setup step');
  select * into s from app.platform_setup_steps where key = p_key for update;
  if not found then raise exception 'That setup step was not found.'; end if;
  if s.required then raise exception 'This step is required and cannot be parked: Community Connect cannot run without it.'; end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why you are parking it (for example "no Stripe account yet").'; end if;
  perform app.set_audit_context(p_reason);
  update app.platform_setup_steps
     set status = 'parked', parked_by = auth.uid(), parked_at = now(), note = left(btrim(p_reason), 1000)
   where key = p_key;
end $$;

create or replace function app.reopen_platform_setup_step(p_key text, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_platform_admin('reopen a setup step');
  if not exists (select 1 from app.platform_setup_steps where key = p_key) then raise exception 'That setup step was not found.'; end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why the step is being reopened.'; end if;
  perform app.set_audit_context(p_reason);
  update app.platform_setup_steps
     set status = 'not_started', parked_by = null, parked_at = null, completed_by = null, completed_at = null
   where key = p_key;
end $$;

-- ── Tests ────────────────────────────────────────────────────────────────────
-- The worker checks the keys it will actually use (database first, then its env).
create or replace function app.enqueue_platform_test(p_step text)
returns bigint language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_platform_admin('test the platform setup');
  if p_step not in ('email','payments','texting','quickbooks','ai','push') then
    raise exception 'There is no background test for that step.';
  end if;
  perform app.set_audit_context('Platform setup: test ' || p_step);
  return app.enqueue_job(null, 'platform.test_provider', jsonb_build_object('step', p_step), now(), 1);
end $$;

-- Sign-in codes the Auth hook routes sent (app.messages rows they record, 0223).
create or replace function app.platform_auth_hook_activity(p_since timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb;
begin
  perform app.assert_platform_admin('see the sign-in hooks'' activity');
  select jsonb_object_agg(ch, x) into v from (
    select m.channel::text as ch,
           jsonb_build_object('last_at', max(m.created_at), 'sent', count(*) filter (where m.status = 'sent'),
                              'failed', count(*) filter (where m.status = 'failed'),
                              'last_status', (array_agg(m.status::text order by m.created_at desc))[1],
                              'last_error', (array_agg(m.failure_reason order by m.created_at desc))[1],
                              'since', count(*) filter (where p_since is not null and m.created_at >= p_since)) as x
      from app.messages m
     where m.purpose = 'auth_code' and m.template_key = 'sign_in_code' and m.created_at > now() - interval '30 days'
     group by m.channel) t;
  return coalesce(v, '{}'::jsonb);
end $$;

-- ── Caddy's on-demand TLS ask (o-https): the platform's own portal names ─────
-- Answers only true/false for the name asked about; reveals nothing else.
create or replace function app.platform_domain_allowed(p_domain text)
returns boolean language sql stable security definer set search_path = app, public, extensions as $$
  with d as (select lower(btrim(coalesce(p_domain, ''))) as n),
       s as (select (select value #>> '{}' from app.platform_settings where key = 'portal_domain') as portal,
                    (select value #>> '{}' from app.platform_settings where key = 'wildcard_domain') as wild)
  select coalesce(d.n <> '' and (d.n = s.portal or d.n = s.wild or d.n = 'www.' || s.wild), false) from d, s
$$;

-- ── The readers: connect_worker only ─────────────────────────────────────────
-- Names, fingerprints and versions of the stored keys (no values) plus the settings:
-- the worker and the portal server re-read a value only when its version changed.
create or replace function app.worker_platform_config()
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return jsonb_build_object(
    'settings', coalesce((select jsonb_object_agg(key, value) from app.platform_settings), '{}'::jsonb),
    'secrets', coalesce((select jsonb_object_agg(name, jsonb_build_object('fingerprint', fingerprint,
                           'version', to_char(coalesce(rotated_at, set_at) at time zone 'UTC', 'YYYYMMDDHH24MISSUS')))
                         from app.platform_secrets), '{}'::jsonb));
end $$;

create or replace function app.worker_read_platform_secret(p_name text, p_purpose text default null)
returns text language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.platform_secrets; v_value text; v_job bigint; v_job_txt text; v_name text := upper(btrim(coalesce(p_name, '')));
begin
  perform app.assert_worker();
  select * into s from app.platform_secrets where name = v_name;
  v_job_txt := nullif(btrim(current_setting('app.job_id', true)), '');
  v_job := case when v_job_txt ~ '^[0-9]{1,18}$' then v_job_txt::bigint end;
  perform set_config('app.client_app', 'job', true);
  insert into app.secret_access_log (center_id, connection_id, name, reader, purpose, job_id, outcome)
  values (null, null, left('platform:' || v_name, 200),
          left(coalesce(nullif(btrim(current_setting('app.worker_id', true)), ''), session_user::text), 200),
          left(coalesce(nullif(btrim(p_purpose), ''), nullif(btrim(current_setting('app.worker_purpose', true)), ''), 'unspecified'), 500),
          v_job, case when s.name is null then 'missing' else 'read' end);
  if s.name is null then return null; end if;
  select decrypted_secret into v_value from vault.decrypted_secrets where id = s.vault_secret_id;
  return v_value;
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app.platform_secret_names(), app.platform_setting_keys(), app.assert_platform_admin(text), app.assert_platform_step_up(text),
  app.platform_domain_ok(text), app.set_platform_secret(text, text, text), app.set_platform_setting(text, text, text),
  app.complete_platform_setup_step(text, text), app.park_platform_setup_step(text, text), app.reopen_platform_setup_step(text, text),
  app.enqueue_platform_test(text), app.platform_auth_hook_activity(timestamptz), app.platform_domain_allowed(text),
  app.worker_platform_config(), app.worker_read_platform_secret(text, text)
  from public, anon, authenticated, service_role;
grant execute on function app.platform_secret_names(), app.platform_setting_keys(), app.platform_domain_ok(text),
  app.set_platform_secret(text, text, text), app.set_platform_setting(text, text, text),
  app.complete_platform_setup_step(text, text), app.park_platform_setup_step(text, text), app.reopen_platform_setup_step(text, text),
  app.enqueue_platform_test(text), app.platform_auth_hook_activity(timestamptz) to authenticated;
grant execute on function app.platform_domain_allowed(text) to anon, authenticated, connect_worker;
grant execute on function app.worker_platform_config(), app.worker_read_platform_secret(text, text) to connect_worker;
