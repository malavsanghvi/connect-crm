-- 0002_memberships.sql
-- Membership tiers, applications with reference approval, eligibility.

create table app.membership_types (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  key           text not null,               -- 'community','yearly','life','senior_yearly'
  tier          app.membership_tier not null,
  name          text not null,
  fee_cents     integer not null default 0,
  period_months integer,                     -- null = lifetime
  includes_spouse boolean not null default false,
  reference_required boolean not null default true,
  reference_tier_min app.membership_tier,    -- reference must be at this tier or higher
  ec_approval_required boolean not null default false,
  voting_wait_days integer not null default 180,
  active        boolean not null default true,
  unique (center_id, key)
);

create table app.memberships (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  household_id   uuid not null references app.households(id) on delete cascade,
  person_id      uuid references app.people(id) on delete set null,   -- primary holder
  membership_type_id uuid not null references app.membership_types(id),
  tier           app.membership_tier not null,
  status         app.membership_status not null default 'pending',
  starts_on      date not null default current_date,
  ends_on        date,
  fee_pledge_id  uuid,                       -- set in 0004 (fk added there)
  crm_external_id text,
  granted_by     uuid references auth.users(id),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on app.memberships (center_id, household_id);
create index on app.memberships (center_id, status);
create trigger touch_memberships before update on app.memberships for each row execute function app.touch_updated_at();

create table app.membership_applications (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  applicant_person_id uuid not null references app.people(id) on delete cascade,
  household_id   uuid not null references app.households(id) on delete cascade,
  membership_type_id uuid not null references app.membership_types(id),
  tier           app.membership_tier not null,
  reference_person_id uuid references app.people(id),
  reference_note text,                       -- how the applicant knows the reference
  reference_decision text check (reference_decision in ('approved','declined','unknown')),
  reference_reason text,                     -- private to admins
  reference_decided_at timestamptz,
  reference_requested_at timestamptz,
  reference_expires_at timestamptz,
  fee_authorization_ref text,                -- payment intent id (authorized, not captured)
  fee_cents      integer not null default 0,
  status         app.application_status not null default 'draft',
  center_decided_by uuid references auth.users(id),
  center_decided_at timestamptz,
  center_reason  text,
  ec_decided_by  uuid references auth.users(id),
  ec_decided_at  timestamptz,
  second_approver uuid references auth.users(id),
  membership_id  uuid references app.memberships(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on app.membership_applications (center_id, status);
create index on app.membership_applications (center_id, reference_person_id, status);
create trigger touch_membership_applications before update on app.membership_applications for each row execute function app.touch_updated_at();

-- Eligibility snapshot (recomputed nightly and on every payment).
create table app.eligibility_snapshots (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  person_id     uuid not null references app.people(id) on delete cascade,
  computed_at   timestamptz not null default now(),
  can_vote      boolean not null,
  reasons       jsonb not null default '[]'::jsonb,
  override_can_vote boolean,
  override_reason text,
  override_by   uuid references auth.users(id),
  override_second_approver uuid references auth.users(id)
);
create index on app.eligibility_snapshots (center_id, person_id, computed_at desc);

-- Duplicate / merge queue
create table app.merge_candidates (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  kind          text not null check (kind in ('person','household')),
  left_id       uuid not null,
  right_id      uuid not null,
  score         numeric,
  status        text not null default 'open' check (status in ('open','merged','dismissed')),
  resolved_by   uuid references auth.users(id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index on app.merge_candidates (center_id, status);
