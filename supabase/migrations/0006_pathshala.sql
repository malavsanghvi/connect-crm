-- 0006_pathshala.sql
-- Pathshala (Sunday school): terms, levels, classes, teachers, enrollment,
-- QR attendance, progress reports, Gyan Path sign-offs, class announcements.
-- Parent communication happens only via class announcements and the parent
-- inbox; no one-to-one adult-to-minor messaging.

create table app.pathshala_terms (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  name          text not null,                          -- '2026-2027'
  starts_on     date not null,
  ends_on       date not null,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  membership_required boolean not null default true,
  fee_per_child_cents integer not null default 0,
  fee_per_family_cap_cents integer,
  sibling_discount_pct integer not null default 0,
  no_class_dates date[] not null default '{}',
  status        text not null default 'draft' check (status in ('draft','registration','active','closed')),
  created_at    timestamptz not null default now(),
  unique (center_id, name)
);

create table app.pathshala_tracks (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references app.centers(id) on delete cascade,
  key        text not null,                              -- 'jainism','gujarati','hindi'
  name       text not null,
  unique (center_id, key)
);

create table app.pathshala_levels (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references app.centers(id) on delete cascade,
  track_id   uuid not null references app.pathshala_tracks(id) on delete cascade,
  key        text not null,                              -- 'toddler','1'..'7','adult_dads'
  name       text not null,
  sort_order integer not null default 0,
  min_age    integer,
  max_age    integer,
  gyan_path_level_id uuid,                               -- fk in 0007
  unique (track_id, key)
);

create table app.pathshala_classes (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  term_id       uuid not null references app.pathshala_terms(id) on delete cascade,
  level_id      uuid not null references app.pathshala_levels(id),
  name          text not null,                           -- 'Jainism 3 – Room B'
  room          text,
  capacity      integer,
  meets_on      text not null default 'sunday',
  starts_time   time,
  ends_time     time,
  class_email   citext,
  waitlist_enabled boolean not null default true,
  created_at    timestamptz not null default now()
);
create index on app.pathshala_classes (center_id, term_id);

create table app.pathshala_teachers (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  class_id    uuid not null references app.pathshala_classes(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  role        text not null default 'teacher' check (role in ('teacher','assistant','substitute')),
  background_check_id uuid references app.background_checks(id),
  waiver_consent_id uuid references app.consents(id),
  unique (class_id, person_id)
);
create index on app.pathshala_teachers (center_id, person_id);

create table app.pathshala_enrollments (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  term_id       uuid not null references app.pathshala_terms(id) on delete cascade,
  student_person_id uuid not null references app.people(id) on delete cascade,
  household_id  uuid not null references app.households(id),
  requested_level_id uuid references app.pathshala_levels(id),
  class_id      uuid references app.pathshala_classes(id),   -- placement
  status        text not null default 'requested' check (status in ('requested','waitlisted','placed','active','withdrawn','completed')),
  fee_pledge_id uuid references app.pledges(id),
  waiver_consent_id uuid references app.consents(id),
  registered_by uuid references auth.users(id),
  registered_at timestamptz not null default now(),
  placed_at     timestamptz,
  notes         text,
  unique (term_id, student_person_id)
);
create index on app.pathshala_enrollments (center_id, class_id, status);
create index on app.pathshala_enrollments (center_id, household_id);

create table app.pathshala_sessions (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  class_id    uuid not null references app.pathshala_classes(id) on delete cascade,
  held_on     date not null,
  topic       text,
  attendance_token text,                                   -- rotating QR shown in class
  token_expires_at timestamptz,
  opened_by   uuid references auth.users(id),
  unique (class_id, held_on)
);

create table app.pathshala_attendance (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  session_id   uuid not null references app.pathshala_sessions(id) on delete cascade,
  enrollment_id uuid not null references app.pathshala_enrollments(id) on delete cascade,
  status       text not null check (status in ('present','late','absent','excused')),
  marked_by    uuid references auth.users(id),
  marked_via   text not null default 'teacher' check (marked_via in ('teacher','qr','admin')),
  marked_at    timestamptz not null default now(),
  note         text,
  unique (session_id, enrollment_id)
);
create index on app.pathshala_attendance (center_id, enrollment_id);

create table app.pathshala_progress_reports (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  enrollment_id uuid not null references app.pathshala_enrollments(id) on delete cascade,
  term_id       uuid not null references app.pathshala_terms(id),
  period        text not null,                            -- 'mid_term','end_of_term'
  attendance_present integer not null default 0,
  attendance_total integer not null default 0,
  attendance_late integer not null default 0,
  teacher_comments text,
  gyan_path_summary jsonb not null default '{}'::jsonb,
  recommended_next_level_id uuid references app.pathshala_levels(id),
  published_at  timestamptz,
  authored_by   uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  unique (enrollment_id, period)
);

create table app.class_announcements (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  class_id    uuid references app.pathshala_classes(id) on delete cascade,
  term_id     uuid references app.pathshala_terms(id) on delete cascade,   -- null class = whole Pathshala
  title       text not null,
  body_md     text not null,
  author_user uuid references auth.users(id),
  published_at timestamptz,
  created_at  timestamptz not null default now()
);
create index on app.class_announcements (center_id, class_id, published_at desc);

-- Teacher vacancies and applications (EAMS teachers_appointment)
create table app.teacher_positions (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  term_id       uuid references app.pathshala_terms(id),
  level_id      uuid references app.pathshala_levels(id),
  title         text not null,
  description   text,
  min_qualifications text,
  status        text not null default 'open' check (status in ('open','closed')),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

create table app.teacher_applications (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  position_id   uuid not null references app.teacher_positions(id) on delete cascade,
  person_id     uuid references app.people(id),
  name          text not null,
  email         citext,
  phone_e164    text,
  education     text,
  qualifications text,
  relevant_activities text,
  motivation    text,
  outcome       text not null default 'pending' check (outcome in ('pending','selected','not_selected')),
  outcome_note  text,
  submitted_at  timestamptz not null default now()
);

-- Concerns (teacher / parent) — public forms, tracked to resolution
create table app.concerns (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  source         text not null check (source in ('teacher','parent','member','other')),
  submitter_name text,
  submitter_email citext,
  submitter_phone text,
  submitter_person_id uuid references app.people(id),
  class_id       uuid references app.pathshala_classes(id),
  title          text not null,
  description    text not null,
  suggestions    text,
  status         text not null default 'reported' check (status in ('reported','in_progress','closed')),
  owner_user_id  uuid references auth.users(id),
  resolution     text,
  linked_action_id uuid references app.actions(id),
  status_updates jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on app.concerns (center_id, status);
create trigger touch_concerns before update on app.concerns for each row execute function app.touch_updated_at();

-- Committee resolutions (EAMS governance workflow)
create table app.resolutions (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  body          text not null default 'pathshala_committee',   -- which committee
  title         text not null,
  description   text,
  rationale     text,
  comment_status text not null default 'not_started' check (comment_status in ('not_started','started','paused','completed')),
  comment_period daterange,
  voting_status text not null default 'not_started' check (voting_status in ('not_started','started','paused','completed')),
  voting_period daterange,
  quorum        integer not null default 4,
  outcome_note  text,
  withdrawn_at  timestamptz,
  withdrawn_by  uuid references auth.users(id),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger touch_resolutions before update on app.resolutions for each row execute function app.touch_updated_at();

create table app.resolution_comments (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  resolution_id uuid not null references app.resolutions(id) on delete cascade,
  author_user   uuid not null references auth.users(id),
  body          text not null,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz
);

create table app.resolution_votes (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  resolution_id uuid not null references app.resolutions(id) on delete cascade,
  voter_user    uuid not null references auth.users(id),
  vote          text not null check (vote in ('yes','no','abstain')),
  reason        text,
  vote_history  jsonb not null default '[]'::jsonb,
  voted_at      timestamptz not null default now(),
  unique (resolution_id, voter_user)
);
