-- 0001_foundation.sql
-- Connect platform: tenancy, identity, helpers.
--
-- Every domain table carries center_id. Isolation is enforced here (RLS),
-- never only in an app. Roles are granted per center with an optional
-- scope (zone / event / class / campaign). See docs/ROLES.md.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type app.tradition as enum (
  'shvetambar_murtipujak', 'sthanakvasi', 'terapanthi', 'digambar', 'other'
);

create type app.membership_tier as enum ('community', 'yearly', 'life');
create type app.membership_status as enum (
  'pending', 'active', 'lapsed', 'suspended', 'ended'
);
create type app.application_status as enum (
  'draft', 'awaiting_reference', 'reference_declined', 'awaiting_center',
  'awaiting_ec', 'approved', 'rejected', 'expired', 'withdrawn'
);
create type app.person_role_in_household as enum (
  'primary', 'spouse', 'child', 'parent', 'sibling', 'other'
);
create type app.account_status as enum (
  'active', 'deactivated', 'deletion_pending', 'deleted'
);
create type app.scope_kind as enum (
  'platform', 'center', 'zone', 'event', 'campaign', 'class', 'store', 'pathshala'
);

-- ---------------------------------------------------------------------------
-- Centers (tenants)
-- ---------------------------------------------------------------------------
create table app.centers (
  id            uuid primary key default gen_random_uuid(),
  slug          citext not null unique,
  name          text not null,
  short_name    text,
  tradition     app.tradition not null default 'shvetambar_murtipujak',
  time_zone     text not null default 'America/Chicago',
  country       text not null default 'US',
  state_region  text,
  currency      text not null default 'USD',
  branding      jsonb not null default '{}'::jsonb,   -- logo, colors, fonts
  feature_flags jsonb not null default '{}'::jsonb,   -- {store:true, bolis:true, ...}
  rules         jsonb not null default '{}'::jsonb,   -- see docs/DATA_MODEL.md "center rules"
  status        text not null default 'active' check (status in ('onboarding','active','suspended','exited')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table app.centers is 'One row per community (tenant). JSH is tenant #1.';
comment on column app.centers.rules is
  'Per-center rule bag: child_login_age, membership.reference_required, membership.max_pending_sponsorships, lunch.slot_minutes, lunch.seats_per_slot, boli.step, boli.soft_close_minutes, fees.ask_donor_to_cover, voting.life_member_wait_days, etc.';

-- Zones (geographic groupings of households, with a lead)
create table app.zones (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references app.centers(id) on delete cascade,
  name       text not null,
  zip_codes  text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (center_id, name)
);

-- ---------------------------------------------------------------------------
-- People and households
-- ---------------------------------------------------------------------------
create table app.households (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references app.centers(id) on delete cascade,
  display_name    text not null,
  address_line1   text,
  address_line2   text,
  city            text,
  state_region    text,
  postal_code     text,
  zone_id         uuid references app.zones(id) on delete set null,
  household_number text,                   -- Connect-issued, e.g. JSH-H-2041 (set by trigger, 0012)
  directory_opt_in boolean not null default false,
  physical_mail_opt_in boolean not null default true,
  notes           text,
  merged_into_id  uuid references app.households(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on app.households (center_id);
create index on app.households (center_id, zone_id);
create unique index households_number_idx on app.households (center_id, household_number);

create table app.people (
  id               uuid primary key default gen_random_uuid(),
  center_id        uuid not null references app.centers(id) on delete cascade,
  first_name       text not null,
  last_name        text not null,
  preferred_name   text,
  date_of_birth    date,                    -- SENSITIVE for minors
  gender           text,
  email            citext,
  phone_e164       text,
  language         text not null default 'en' check (language in ('en','gu','hi')),
  profession       text,
  employer         text,
  member_number    text,                    -- Connect-issued, e.g. JSH-10421 (set by trigger, 0012); other systems' ids live in app.external_ids
  photo_opt_in     boolean not null default false,
  expertise_opt_in boolean not null default false,
  expertise_tags   text[] not null default '{}',
  expertise_headline text,
  new_member_contact_opt_in boolean not null default false,
  is_verified      boolean not null default false,   -- approved membership in the CRM, not an app sign-up
  verified_at      timestamptz,
  is_deceased      boolean not null default false,
  merged_into_id   uuid references app.people(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on app.people (center_id);
create index on app.people (center_id, lower(last_name), lower(first_name));
create index on app.people (center_id, email);
create index on app.people (center_id, phone_e164);
create unique index people_member_number_idx on app.people (center_id, member_number);

-- A person can belong to more than one household (adult child stays in the
-- parents' household and is primary of their own).
create table app.household_members (
  household_id uuid not null references app.households(id) on delete cascade,
  person_id    uuid not null references app.people(id) on delete cascade,
  center_id    uuid not null references app.centers(id) on delete cascade,
  role         app.person_role_in_household not null default 'other',
  is_primary   boolean not null default false,
  joined_at    date,
  left_at      date,
  primary key (household_id, person_id)
);
create index on app.household_members (person_id);

-- ---------------------------------------------------------------------------
-- App accounts: auth.users <-> person, per center
-- ---------------------------------------------------------------------------
create table app.accounts (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  status         app.account_status not null default 'active',
  is_platform_admin boolean not null default false,
  large_text     boolean not null default false,
  language       text not null default 'en',
  quiet_hours    int4range,                 -- minutes from midnight, local
  deletion_requested_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table app.center_users (
  center_id   uuid not null references app.centers(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  is_default  boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (center_id, user_id),
  unique (center_id, person_id)
);
create index on app.center_users (user_id);

-- ---------------------------------------------------------------------------
-- Roles and grants
-- ---------------------------------------------------------------------------
create table app.roles (
  key         text primary key,            -- 'treasurer', 'event_lead', ...
  tier        text not null check (tier in ('platform','center','operational','family')),
  name        text not null,
  description text,
  default_scope app.scope_kind not null default 'center',
  permissions jsonb not null default '[]'::jsonb  -- ['giving.manage','giving.approve', ...]
);

create table app.role_grants (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role_key     text not null references app.roles(key),
  scope_kind   app.scope_kind not null default 'center',
  scope_id     uuid,                        -- zone/event/class/campaign id when scoped
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,                 -- time-bound roles expire automatically
  granted_by   uuid references auth.users(id),
  delegated_from uuid references app.role_grants(id),
  reason       text,
  created_at   timestamptz not null default now()
);
create index on app.role_grants (center_id, user_id);
create index on app.role_grants (center_id, role_key);

-- ---------------------------------------------------------------------------
-- Consents and legal acceptances
-- ---------------------------------------------------------------------------
create table app.legal_documents (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid references app.centers(id) on delete cascade, -- null = platform template
  kind        text not null check (kind in ('privacy','terms','volunteer_waiver','pathshala_waiver','photo_release','other')),
  version     text not null,
  title       text not null,
  body_md     text not null,
  requires_yearly_resign boolean not null default false,
  published_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (center_id, kind, version)
);

create table app.consents (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  person_id    uuid not null references app.people(id) on delete cascade,
  given_by_user uuid references auth.users(id),      -- parent for a child
  kind         text not null,                         -- 'directory','photos','physical_mail','marketing_email','sms','whatsapp','child_profile', or legal doc kind
  legal_document_id uuid references app.legal_documents(id),
  granted      boolean not null,
  source       text not null default 'app',           -- app | admin | import | kiosk
  recorded_at  timestamptz not null default now(),
  ip           inet,
  user_agent   text
);
create index on app.consents (center_id, person_id, kind, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Audit log (append-only, hash chained)
-- ---------------------------------------------------------------------------
create table app.audit_log (
  id            bigint generated always as identity primary key,
  center_id     uuid references app.centers(id),
  actor_user_id uuid,
  actor_role    text,
  on_behalf_of  uuid,                       -- person id when a parent acts for a child, or support
  action        text not null,              -- 'pledge.create', 'role.grant', 'export.households', ...
  record_table  text,
  record_id     text,
  before        jsonb,
  after         jsonb,
  reason        text,
  correlation_id uuid,
  ip            inet,
  user_agent    text,
  occurred_at   timestamptz not null default now(),
  prev_hash     text,
  hash          text
);
create index on app.audit_log (center_id, occurred_at desc);
create index on app.audit_log (center_id, record_table, record_id);

-- Nobody updates or deletes audit rows (revoked below; enforced by trigger too).
create or replace function app.audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_immutable
  before update or delete on app.audit_log
  for each row execute function app.audit_immutable();

create or replace function app.audit_chain() returns trigger
language plpgsql as $$
declare last_hash text;
begin
  select hash into last_hash from app.audit_log
    where center_id is not distinct from new.center_id
    order by id desc limit 1;
  new.prev_hash := last_hash;
  new.hash := encode(digest(coalesce(last_hash,'') || new.action || coalesce(new.record_table,'')
                || coalesce(new.record_id,'') || coalesce(new.before::text,'') || coalesce(new.after::text,'')
                || new.occurred_at::text, 'sha256'), 'hex');
  return new;
end $$;
create trigger audit_log_chain before insert on app.audit_log
  for each row execute function app.audit_chain();

-- ---------------------------------------------------------------------------
-- Helper functions used by RLS policies (security definer, stable)
-- ---------------------------------------------------------------------------
create or replace function app.uid() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = app, public as $$
  select coalesce((select is_platform_admin from app.accounts where user_id = auth.uid()), false)
$$;

-- Centers the current user belongs to (as a member / account holder).
create or replace function app.my_center_ids() returns setof uuid
language sql stable security definer set search_path = app, public as $$
  select center_id from app.center_users where user_id = auth.uid()
$$;

create or replace function app.is_member_of(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_platform_admin()
      or exists (select 1 from app.center_users where center_id = p_center and user_id = auth.uid())
$$;

-- My person id within a center.
create or replace function app.my_person_id(p_center uuid) returns uuid
language sql stable security definer set search_path = app, public as $$
  select person_id from app.center_users where center_id = p_center and user_id = auth.uid()
$$;

-- Households the current user belongs to in a center.
create or replace function app.my_household_ids(p_center uuid) returns setof uuid
language sql stable security definer set search_path = app, public as $$
  select hm.household_id
  from app.household_members hm
  join app.center_users cu on cu.person_id = hm.person_id and cu.center_id = hm.center_id
  where cu.user_id = auth.uid() and cu.center_id = p_center and hm.left_at is null
$$;

-- Am I an adult (18+ or unknown DOB) in this center? Children act only for themselves.
create or replace function app.i_am_adult(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select coalesce(
    (select p.date_of_birth is null or p.date_of_birth <= (current_date - interval '18 years')
       from app.people p join app.center_users cu on cu.person_id = p.id
      where cu.user_id = auth.uid() and cu.center_id = p_center), false)
$$;

-- Does the user hold any of the given roles in this center (any scope, unexpired)?
create or replace function app.has_role(p_center uuid, variadic p_roles text[]) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_platform_admin()
      or exists (
        select 1 from app.role_grants g
        where g.center_id = p_center and g.user_id = auth.uid()
          and g.role_key = any (p_roles)
          and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
$$;

-- Scoped variant: role held for the center as a whole OR for this specific scope id.
create or replace function app.has_scoped_role(p_center uuid, p_scope_id uuid, variadic p_roles text[]) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_platform_admin()
      or exists (
        select 1 from app.role_grants g
        where g.center_id = p_center and g.user_id = auth.uid()
          and g.role_key = any (p_roles)
          and (g.scope_kind = 'center' or g.scope_id = p_scope_id)
          and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
$$;

-- Permission check by permission string via roles.permissions.
create or replace function app.has_permission(p_center uuid, p_perm text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_platform_admin()
      or exists (
        select 1 from app.role_grants g
        join app.roles r on r.key = g.role_key
        where g.center_id = p_center and g.user_id = auth.uid()
          and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
          and r.permissions ? p_perm)
$$;

-- Center staff = any non-family role.
create or replace function app.is_center_staff(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_platform_admin()
      or exists (
        select 1 from app.role_grants g join app.roles r on r.key = g.role_key
        where g.center_id = p_center and g.user_id = auth.uid() and r.tier in ('center','operational')
          and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
$$;

-- updated_at maintenance
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['centers','households','people','accounts'] loop
    execute format('create trigger touch_%1$s before update on app.%1$s for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;

-- Expose the app schema through PostgREST.
grant usage on schema app to anon, authenticated, service_role;
grant all on all tables in schema app to service_role;
grant select, insert, update, delete on all tables in schema app to authenticated;
grant usage, select on all sequences in schema app to authenticated, service_role;
alter default privileges in schema app grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema app grant all on tables to service_role;
alter default privileges in schema app grant usage, select on sequences to authenticated, service_role;
revoke update, delete on app.audit_log from authenticated;
