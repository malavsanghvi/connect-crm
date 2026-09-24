-- Onboarding · stream o-setup · 1 of 5: the organization's profile, legal
-- identity, documents and key leaders (ONBOARDING_PLAN §4 Step 0.2–0.3).
--
--   app.setup_is_owner(center)     true when the o-security owner designation says so
--                                  (app.is_center_owner); false while that stream's
--                                  migration is not applied. Never raises.
--   app.setup_can_manage(center)   settings.manage, the owner, or a platform admin.
--   app.org_profiles               one row per center: legal identity, public profile,
--                                  map pin, languages, fiscal year, verification state.
--   app.org_documents              non-profit evidence in the private `org-documents`
--                                  bucket (paths start with <center_id>/).
--   app.org_leaders                President, Secretary, Treasurer, … Leaders shown
--                                  publicly are mirrored into app.role_roster, which is
--                                  what the guide's Administration roster reads (see the
--                                  "Roster" note below).
--   app.irs_exempt_orgs            the IRS Exempt Organizations BMF + Pub. 78 (+ the
--                                  auto-revocation list), loaded by tools/load-irs-eo.mjs.
--   app.irs_lookup(ein, name?)     one EIN, with a name match and a revoked flag.
--
-- Verification status only moves through app.submit_org_verification (the
-- organization) and app.decide_org_verification (a platform admin), both in
-- 0183. A direct write to the verification columns is refused; changing the
-- legal name, EIN or entity type after submitting sends the organization back to
-- "unverified" so a changed identity is never shown as verified.
--
-- Every table is core platform (module_tables NULL), audited by app.audit_row(),
-- with RLS that only grants what the plan says. No new permission keys.

-- ── Who may manage setup ─────────────────────────────────────────────────────
create or replace function app.setup_is_owner(p_center uuid) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v boolean;
begin
  -- The owner designation belongs to stream o-security (app.center_owners,
  -- app.is_center_owner). Until it is applied there is no owner to ask about.
  if to_regprocedure('app.is_center_owner(uuid)') is null then return false; end if;
  execute 'select app.is_center_owner($1)' into v using p_center;
  return coalesce(v, false);
end $$;

create or replace function app.setup_can_manage(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_center is not null and (app.has_permission(p_center, 'settings.manage') or app.setup_is_owner(p_center))
$$;

-- ── Organization profile ─────────────────────────────────────────────────────
create table if not exists app.org_profiles (
  center_id                  uuid primary key references app.centers(id) on delete cascade,
  -- Step 0.2 legal identity
  legal_name                 text check (legal_name is null or length(btrim(legal_name)) between 2 and 200),
  dba                        text check (dba is null or length(dba) <= 200),
  ein                        text check (ein is null or ein ~ '^\d{2}-\d{7}$'),
  entity_type                text check (entity_type is null or entity_type in
                               ('house_of_worship','public_charity','private_foundation','group_exemption_member','other_exempt','other')),
  incorporation_state        text check (incorporation_state is null or incorporation_state ~ '^[A-Z]{2}$'),
  registered_address         jsonb check (registered_address is null or jsonb_typeof(registered_address) = 'object'),
  fiscal_year_start_month    int check (fiscal_year_start_month is null or fiscal_year_start_month between 1 and 12),
  authorized_signer_name     text check (authorized_signer_name is null or length(authorized_signer_name) <= 120),
  authorized_signer_title    text check (authorized_signer_title is null or length(authorized_signer_title) <= 120),
  sales_tax_id               text check (sales_tax_id is null or length(sales_tax_id) <= 60),
  -- Step 0.3 profile
  mission                    text check (mission is null or length(mission) <= 1000),
  about                      text check (about is null or length(about) <= 5000),
  website                    text check (website is null or website ~* '^https?://[^\s]+$'),
  social                     jsonb not null default '{}'::jsonb check (jsonb_typeof(social) = 'object'),
  public_email               citext check (public_email is null or public_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  public_email_verified_at   timestamptz,
  public_phone               text check (public_phone is null or public_phone ~ '^\+[1-9]\d{7,14}$'),
  public_phone_verified_at   timestamptz,
  office_hours               text check (office_hours is null or length(office_hours) <= 500),
  latitude                   numeric(9,6) check (latitude is null or latitude between -90 and 90),
  longitude                  numeric(9,6) check (longitude is null or longitude between -180 and 180),
  languages                  text[] not null default '{en}',
  -- Verification (Community Connect review)
  verification_status        text not null default 'unverified' check (verification_status in ('unverified','submitted','verified','rejected')),
  verified_by                uuid references auth.users(id),
  verified_at                timestamptz,
  verification_note          text,
  submitted_by               uuid references auth.users(id),
  submitted_at               timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid references auth.users(id),
  check ((latitude is null) = (longitude is null))
);
comment on table app.org_profiles is
  'Onboarding Step 0.2–0.3: legal identity, public profile, map pin, fiscal year and non-profit verification. One row per center.';

-- The verification columns move only through the verification RPCs (0183),
-- which set app.org_verification = on for their transaction. Jobs and psql
-- (no signed-in user) are not restricted.
create or replace function app.org_profiles_guard() returns trigger
language plpgsql set search_path = app, public, extensions as $$
declare v_rpc boolean := coalesce(current_setting('app.org_verification', true), '') = 'on';
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.ein is not null then new.ein := app.normalize_ein(new.ein); end if;
  if v_rpc or auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.verification_status <> 'unverified' or new.verified_by is not null or new.verified_at is not null
       or new.submitted_by is not null or new.submitted_at is not null or new.verification_note is not null then
      raise exception 'Verification is set by "Submit for verification" and the Community Connect review, not by editing the profile.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.verification_status, new.verified_by, new.verified_at, new.verification_note, new.submitted_by, new.submitted_at)
     is distinct from (old.verification_status, old.verified_by, old.verified_at, old.verification_note, old.submitted_by, old.submitted_at) then
    raise exception 'Verification is set by "Submit for verification" and the Community Connect review, not by editing the profile.'
      using errcode = '42501';
  end if;
  -- A changed legal identity is no longer the one that was reviewed.
  if old.verification_status in ('submitted','verified')
     and (new.legal_name, new.ein, new.entity_type) is distinct from (old.legal_name, old.ein, old.entity_type) then
    new.verification_status := 'unverified';
    new.verification_note := 'The legal name, EIN or entity type changed after it was ' ||
      case old.verification_status when 'verified' then 'verified' else 'submitted' end || '. Submit it for verification again.';
    new.verified_by := null; new.verified_at := null;
  end if;
  return new;
end $$;

-- "12 3456789", "123456789", "12-3456789" → "12-3456789"; anything else is returned as given (the check constraint refuses it).
create or replace function app.normalize_ein(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case when regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') ~ '^\d{9}$'
              then substr(regexp_replace(p, '[^0-9]', '', 'g'), 1, 2) || '-' || substr(regexp_replace(p, '[^0-9]', '', 'g'), 3)
              else p end
$$;

drop trigger if exists org_profiles_guard on app.org_profiles;
create trigger org_profiles_guard before insert or update on app.org_profiles
  for each row execute function app.org_profiles_guard();

alter table app.org_profiles enable row level security;
drop policy if exists org_profiles_manage_read on app.org_profiles;
create policy org_profiles_manage_read on app.org_profiles for select to authenticated
  using (app.setup_can_manage(center_id));
drop policy if exists org_profiles_manage_insert on app.org_profiles;
create policy org_profiles_manage_insert on app.org_profiles for insert to authenticated
  with check (app.setup_can_manage(center_id));
drop policy if exists org_profiles_manage_update on app.org_profiles;
create policy org_profiles_manage_update on app.org_profiles for update to authenticated
  using (app.setup_can_manage(center_id)) with check (app.setup_can_manage(center_id));

-- What anyone may see about an organization: the public profile only (no
-- legal identity details beyond the name, no verification notes).
create or replace function app.public_org_profile(p_center uuid)
returns table (center_id uuid, legal_name text, mission text, about text, website text, social jsonb,
               public_email text, public_phone text, office_hours text, latitude numeric, longitude numeric,
               languages text[], verified_nonprofit boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  select p.center_id, p.legal_name, p.mission, p.about, p.website, p.social,
         p.public_email::text, p.public_phone, p.office_hours, p.latitude, p.longitude, p.languages,
         p.verification_status = 'verified'
    from app.org_profiles p join app.centers c on c.id = p.center_id
   where p.center_id = p_center and c.status in ('active','onboarding')
$$;

-- ── Organization documents (non-profit evidence) ─────────────────────────────
create table if not exists app.org_documents (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  kind          text not null check (kind in ('w9','determination_letter','group_exemption','board_letter','attorney_letter','other')),
  storage_path  text not null,
  file_name     text check (file_name is null or length(file_name) <= 255),
  content_type  text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by   uuid references auth.users(id) default auth.uid(),
  uploaded_at   timestamptz not null default now(),
  note          text check (note is null or length(note) <= 1000),
  check (split_part(storage_path, '/', 1) = center_id::text and storage_path !~ '\.\.')
);
create index if not exists org_documents_center_idx on app.org_documents (center_id, kind, uploaded_at desc);
comment on table app.org_documents is
  'Onboarding Step 0.2: W-9, determination letter, group exemption, board or attorney letter. Files live in the private org-documents bucket under <center_id>/.';

alter table app.org_documents enable row level security;
drop policy if exists org_documents_manage_read on app.org_documents;
create policy org_documents_manage_read on app.org_documents for select to authenticated
  using (app.setup_can_manage(center_id));
drop policy if exists org_documents_manage_insert on app.org_documents;
create policy org_documents_manage_insert on app.org_documents for insert to authenticated
  with check (app.setup_can_manage(center_id) and uploaded_by = auth.uid());
drop policy if exists org_documents_manage_update on app.org_documents;
create policy org_documents_manage_update on app.org_documents for update to authenticated
  using (app.setup_can_manage(center_id)) with check (app.setup_can_manage(center_id));
-- No delete policy: removing evidence is an owner decision (WAVE3 rules). A
-- newer upload of the same kind supersedes the older one.

-- ── Key leaders ──────────────────────────────────────────────────────────────
create table if not exists app.org_leaders (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  person_id      uuid references app.people(id) on delete set null,
  full_name      text not null check (length(btrim(full_name)) between 2 and 120),
  title          text not null check (length(btrim(title)) between 2 and 80),
  body           text not null default 'executive_committee'
                   check (body in ('executive_committee','trustees','pathshala','tech','other')),
  term_start     date,
  term_end       date,
  photo_path     text check (photo_path is null or (split_part(photo_path, '/', 1) = center_id::text and photo_path !~ '\.\.')),
  show_publicly  boolean not null default true,
  sort           int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (term_end is null or term_start is null or term_end >= term_start)
);
create index if not exists org_leaders_center_idx on app.org_leaders (center_id, sort);
comment on table app.org_leaders is
  'Onboarding Step 0.3: key leaders. Leaders shown publicly are mirrored into role_roster (the guide''s Administration roster).';

create or replace function app.org_leaders_check() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  new.updated_at := now();
  if new.person_id is not null and not exists (select 1 from app.people p where p.id = new.person_id and p.center_id = new.center_id) then
    raise exception 'That person is not in this community.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists org_leaders_check on app.org_leaders;
create trigger org_leaders_check before insert or update on app.org_leaders
  for each row execute function app.org_leaders_check();

alter table app.org_leaders enable row level security;
drop policy if exists org_leaders_public_read on app.org_leaders;
create policy org_leaders_public_read on app.org_leaders for select to anon, authenticated
  using (show_publicly and exists (select 1 from app.centers c where c.id = center_id and c.status in ('active','onboarding')));
drop policy if exists org_leaders_manage_read on app.org_leaders;
create policy org_leaders_manage_read on app.org_leaders for select to authenticated
  using (app.setup_can_manage(center_id));
drop policy if exists org_leaders_manage_insert on app.org_leaders;
create policy org_leaders_manage_insert on app.org_leaders for insert to authenticated
  with check (app.setup_can_manage(center_id));
drop policy if exists org_leaders_manage_update on app.org_leaders;
create policy org_leaders_manage_update on app.org_leaders for update to authenticated
  using (app.setup_can_manage(center_id)) with check (app.setup_can_manage(center_id));
-- No delete policy (owner decision): a leader who stepped down gets a term end
-- date or is hidden, which also takes them off the public roster.
grant select on app.org_leaders to anon;

-- ── Roster ───────────────────────────────────────────────────────────────────
-- Decision: org_leaders is the source; role_roster (read by the member app's
-- Guide › Administration and the portal's Content › Guide) is kept in sync
-- from it, instead of reading two tables in every app. A leader shown publicly
-- becomes one role_roster row (org_leader_id links them; display_name carries
-- the name for leaders not linked to a person record yet). Hiding a leader, or
-- a leader whose term has ended, removes that mirrored row; rows typed into
-- the roster by hand (org_leader_id null) are never touched.
alter table app.role_roster add column if not exists org_leader_id uuid unique references app.org_leaders(id) on delete cascade;
alter table app.role_roster add column if not exists display_name text;
comment on column app.role_roster.display_name is
  'Name shown for a roster row mirrored from org_leaders when it has no person_id (or the person is not in the directory).';

create or replace function app.org_leaders_sync_roster() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if tg_op = 'DELETE' then return old; end if;  -- the foreign key cascades
  if new.show_publicly and (new.term_end is null or new.term_end >= current_date) then
    insert into app.role_roster (center_id, body, title, person_id, term_starts_on, term_ends_on, sort_order, org_leader_id, display_name)
    values (new.center_id, new.body, new.title, new.person_id, new.term_start, new.term_end, new.sort, new.id, new.full_name)
    on conflict (org_leader_id) do update set body = excluded.body, title = excluded.title, person_id = excluded.person_id,
      term_starts_on = excluded.term_starts_on, term_ends_on = excluded.term_ends_on, sort_order = excluded.sort_order,
      display_name = excluded.display_name;
  else
    delete from app.role_roster where org_leader_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists org_leaders_sync_roster on app.org_leaders;
create trigger org_leaders_sync_roster after insert or update on app.org_leaders
  for each row execute function app.org_leaders_sync_roster();

-- ── IRS exempt organizations ─────────────────────────────────────────────────
create table if not exists app.irs_exempt_orgs (
  ein            text primary key check (ein ~ '^\d{9}$'),
  name           text not null,
  city           text,
  state          text,
  subsection     text,             -- EO BMF SUBSECTION ('03' = 501(c)(3))
  deductibility  text,             -- EO BMF DEDUCTIBILITY ('1' deductible) or Pub. 78 codes ('PC', 'POF', …)
  status         text not null default 'active' check (status in ('active','revoked','pub78_only')),
  source         text not null,    -- which files the row came from, e.g. 'eo_bmf+pub78'
  in_pub78       boolean not null default false,
  revoked_on     date,
  loaded_at      timestamptz not null default now()
);
create index if not exists irs_exempt_orgs_name_idx on app.irs_exempt_orgs (lower(name));
comment on table app.irs_exempt_orgs is
  'IRS Tax Exempt Organization Search bulk data (EO BMF, Pub. 78, auto-revocation list). Loaded by tools/load-irs-eo.mjs; read through app.irs_lookup.';

alter table app.irs_exempt_orgs enable row level security;
drop policy if exists irs_exempt_orgs_platform_read on app.irs_exempt_orgs;
create policy irs_exempt_orgs_platform_read on app.irs_exempt_orgs for select to authenticated
  using (app.is_platform_admin());
-- Writes: the loader only (service role / database owner). No policy for anyone else.

-- Comparable name: lower case, "&" → "and", no punctuation, no common suffixes.
create or replace function app.irs_name_key(p text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(p, '')), '&', ' and ', 'g'),
         '[^a-z0-9 ]', ' ', 'g'), '\m(inc|incorporated|corp|corporation|co|ltd|llc|the|of|a)\M', ' ', 'g'))
$$;

-- The IRS record for an EIN (any common format), and whether p_name matches it.
-- Public IRS data, so any signed-in user may look one up.
create or replace function app.irs_lookup(p_ein text, p_name text default null) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_digits text := regexp_replace(coalesce(p_ein, ''), '[^0-9]', '', 'g'); r app.irs_exempt_orgs; v_loaded timestamptz;
        v_a text; v_b text; v_match text;
begin
  if v_digits !~ '^\d{9}$' then
    return jsonb_build_object('ok', false, 'found', false, 'detail', 'An EIN has nine digits, like 12-3456789.');
  end if;
  select max(loaded_at) into v_loaded from app.irs_exempt_orgs;
  if v_loaded is null then
    return jsonb_build_object('ok', false, 'found', false, 'ein', substr(v_digits, 1, 2) || '-' || substr(v_digits, 3),
      'detail', 'The IRS exempt-organization list has not been loaded yet, so the EIN could not be checked automatically.');
  end if;
  select * into r from app.irs_exempt_orgs where ein = v_digits;
  if not found then
    return jsonb_build_object('ok', false, 'found', false, 'ein', substr(v_digits, 1, 2) || '-' || substr(v_digits, 3),
      'data_loaded_at', v_loaded,
      'detail', 'This EIN is not in the IRS exempt-organization list. Houses of worship may not be listed; send a board or attorney letter instead.');
  end if;
  v_a := app.irs_name_key(r.name); v_b := app.irs_name_key(p_name);
  v_match := case when p_name is null or v_b = '' then 'not_checked'
                  when v_a = v_b then 'exact'
                  when position(v_b in v_a) > 0 or position(v_a in v_b) > 0 then 'partial'
                  else 'different' end;
  return jsonb_build_object(
    'ok', r.status <> 'revoked' and v_match in ('exact','partial','not_checked'),
    'found', true, 'ein', substr(r.ein, 1, 2) || '-' || substr(r.ein, 3), 'name', r.name, 'city', r.city, 'state', r.state,
    'subsection', r.subsection, 'deductibility', r.deductibility, 'status', r.status, 'revoked', r.status = 'revoked',
    'revoked_on', r.revoked_on, 'in_pub78', r.in_pub78, 'source', r.source, 'loaded_at', r.loaded_at, 'data_loaded_at', v_loaded,
    'name_match', v_match,
    'detail', case
      when r.status = 'revoked' then 'The IRS revoked this organization''s exemption' || coalesce(' on ' || to_char(r.revoked_on, 'FMMonth FMDD, YYYY'), '') || '.'
      when v_match = 'different' then 'The EIN is listed, but under a different name: ' || r.name || '.'
      when r.subsection is not null and r.subsection <> '03' then 'Listed as exempt under 501(c)(' || ltrim(r.subsection, '0') || '), not 501(c)(3).'
      else 'Listed by the IRS as ' || r.name || coalesce(', ' || r.city, '') || coalesce(', ' || r.state, '') || '.' end);
end $$;

-- ── Module map, audit ────────────────────────────────────────────────────────
insert into app.module_tables (table_name, module_key) values
  ('org_profiles', null), ('org_documents', null), ('org_leaders', null), ('irs_exempt_orgs', null)
on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_org_profiles on app.org_profiles;
create trigger audit_org_profiles after insert or update or delete on app.org_profiles
  for each row execute function app.audit_row('center_id');
drop trigger if exists audit_org_documents on app.org_documents;
create trigger audit_org_documents after insert or update or delete on app.org_documents
  for each row execute function app.audit_row();
drop trigger if exists audit_org_leaders on app.org_leaders;
create trigger audit_org_leaders after insert or update or delete on app.org_leaders
  for each row execute function app.audit_row();
-- The loader disables this trigger for a bulk load and writes one summary entry instead.
drop trigger if exists audit_irs_exempt_orgs on app.irs_exempt_orgs;
create trigger audit_irs_exempt_orgs after insert or update or delete on app.irs_exempt_orgs
  for each row execute function app.audit_row('ein');

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app.org_profiles_guard(), app.org_leaders_check(), app.org_leaders_sync_roster() from public, anon, authenticated;
grant execute on function app.setup_is_owner(uuid), app.setup_can_manage(uuid), app.irs_lookup(text, text),
  app.normalize_ein(text), app.irs_name_key(text) to authenticated;
grant execute on function app.public_org_profile(uuid) to anon, authenticated;
grant select, insert, update on app.org_profiles, app.org_documents, app.org_leaders to authenticated;
grant select on app.irs_exempt_orgs to authenticated;
grant all on app.org_profiles, app.org_documents, app.org_leaders, app.irs_exempt_orgs to service_role;
grant execute on all functions in schema app to service_role;
