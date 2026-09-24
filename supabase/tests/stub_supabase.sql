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
