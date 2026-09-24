-- Minimal stand-in for the pieces of Supabase the migrations depend on, so
-- the schema + RLS can be tested on plain Postgres (CI, no Docker).
-- Never run this against a real Supabase project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- Hosted Supabase keeps pgcrypto in its own `extensions` schema; mirror that so
-- a function that cannot see it fails here instead of in production.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

-- Same contract as Supabase: the JWT "sub" claim.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;

-- Same contract as Supabase: the whole claims object (role, sub, ...).
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

-- Supabase Auth MFA and sessions (o-security, 0150+): the columns the step-up and
-- lost-device reset functions read. Hosted Supabase (GoTrue) owns the real tables.
alter table auth.users add column if not exists phone_confirmed_at timestamptz;
do $$ begin
  create type auth.factor_type as enum ('totp', 'webauthn', 'phone');
exception when duplicate_object then null; end $$;
do $$ begin
  create type auth.factor_status as enum ('unverified', 'verified');
exception when duplicate_object then null; end $$;
create table if not exists auth.mfa_factors (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  friendly_name text,
  factor_type   auth.factor_type not null,
  status        auth.factor_status not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  secret        text,
  phone         text
);
create table if not exists auth.sessions (
  id         uuid primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  aal        text
);
