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

-- Supabase Vault stand-in (o-vault, 0170): same functions, view and grants as
-- the supabase_vault extension; the "encryption" is only base64 here. The
-- hosted postgres role has exactly this: USAGE, create/update_secret, SELECT
-- and DELETE; anon and authenticated have nothing on schema vault.
create schema if not exists vault;
create table if not exists vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text unique,
  description text not null default '',
  secret      text not null,
  key_id      uuid,
  nonce       bytea,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create or replace view vault.decrypted_secrets as
  select id, name, description, secret, convert_from(decode(secret, 'base64'), 'utf8') as decrypted_secret,
         key_id, nonce, created_at, updated_at
    from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '',
                                               new_key_id uuid default null) returns uuid
language plpgsql security definer as $$
declare v uuid;
begin
  insert into vault.secrets (secret, name, description, key_id)
  values (encode(convert_to(new_secret, 'utf8'), 'base64'), new_name, coalesce(new_description, ''), new_key_id)
  returning id into v;
  return v;
end $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null,
                                               new_description text default null, new_key_id uuid default null) returns void
language plpgsql security definer as $$
begin
  update vault.secrets set secret = coalesce(encode(convert_to(new_secret, 'utf8'), 'base64'), secret),
                           name = coalesce(new_name, name), description = coalesce(new_description, description),
                           key_id = coalesce(new_key_id, key_id), updated_at = now()
   where id = secret_id;
end $$;
revoke all on schema vault from public;
revoke all on all tables in schema vault from public, anon, authenticated;
revoke execute on all functions in schema vault from public, anon, authenticated;
grant usage on schema vault to service_role;
grant select, delete on vault.secrets, vault.decrypted_secrets to service_role;
grant execute on function vault.create_secret(text, text, text, uuid), vault.update_secret(uuid, text, text, text, uuid) to service_role;

-- Supabase Storage stand-in (o-vault, 0172): the two tables the policies and
-- triggers sit on, as the storage-api creates them.
create schema if not exists storage;
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets(id),
  name             text,
  owner            uuid,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata         jsonb,
  version          text,
  owner_id         text,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
