-- 0007_learning_content_calendar.sql
-- Content library (tradition packs), Gyan Path, My Jain Way practices and
-- points, Saathi, calendar layers, special days, guide/directory, Niva sources.

-- ---------------------------------------------------------------------------
-- Content (shared by tradition, overridable per center)
-- ---------------------------------------------------------------------------
create table app.content_items (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid references app.centers(id) on delete cascade,   -- null = shared platform pack
  tradition     app.tradition,
  kind          text not null check (kind in ('sutra','pachchakhan','audio_lesson','video','guide_page','explainer','darshan_stream','niva_source','faq','other')),
  slug          text not null,
  title         text not null,
  body_md       text,
  language      text not null default 'en',
  translations  jsonb not null default '{}'::jsonb,   -- {gu: {title, body_md}, hi: {...}}
  media_path    text,
  media_url     text,
  metadata      jsonb not null default '{}'::jsonb,   -- timing rules for pachchakhan, etc.
  version       integer not null default 1,
  status        text not null default 'draft' check (status in ('draft','in_review','approved','published','retired')),
  approved_by   uuid references auth.users(id),
  published_at  timestamptz,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on app.content_items (center_id, kind, status);
create index on app.content_items (tradition, kind, status);
create unique index content_items_slug_idx on app.content_items (coalesce(center_id,'00000000-0000-0000-0000-000000000000'::uuid), kind, slug, version);
create trigger touch_content_items before update on app.content_items for each row execute function app.touch_updated_at();

create table app.photo_albums (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  event_id    uuid references app.events(id) on delete set null,
  title       text not null,
  external_url text,                                   -- link-out albums
  visibility  text not null default 'members' check (visibility in ('public','members','private')),
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create table app.photos (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  album_id    uuid not null references app.photo_albums(id) on delete cascade,
  storage_path text not null,
  caption     text,
  uploaded_by uuid references auth.users(id),
  contains_children boolean not null default false,
  status      text not null default 'pending' check (status in ('pending','approved','rejected','removed')),
  moderated_by uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index on app.photos (center_id, status);

-- ---------------------------------------------------------------------------
-- Gyan Path (learning goals -> levels -> steps), progress and sign-offs
-- ---------------------------------------------------------------------------
create table app.gyan_goals (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid references app.centers(id) on delete cascade,     -- null = shared by tradition
  tradition   app.tradition,
  key         text not null,
  name        text not null,
  description text,
  sort_order  integer not null default 0
);

create table app.gyan_levels (
  id          uuid primary key default gen_random_uuid(),
  goal_id     uuid not null references app.gyan_goals(id) on delete cascade,
  key         text not null,
  name        text not null,
  sort_order  integer not null default 0,
  points      integer not null default 0,
  treasure    text,                                         -- reward description
  requires_teacher_signoff boolean not null default true,
  unique (goal_id, key)
);
alter table app.pathshala_levels add constraint pathshala_levels_gyan_fk foreign key (gyan_path_level_id) references app.gyan_levels(id);

create table app.gyan_steps (
  id          uuid primary key default gen_random_uuid(),
  level_id    uuid not null references app.gyan_levels(id) on delete cascade,
  kind        text not null check (kind in ('read','listen','recite','quiz','video','practice')),
  title       text not null,
  content_item_id uuid references app.content_items(id),
  quiz        jsonb,                                        -- questions/answers
  sort_order  integer not null default 0
);

create table app.gyan_progress (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  person_id    uuid not null references app.people(id) on delete cascade,
  step_id      uuid not null references app.gyan_steps(id) on delete cascade,
  stars        integer not null default 0 check (stars between 0 and 3),
  completed_at timestamptz,
  recording_path text,                                      -- retention: 90 days
  recording_expires_at timestamptz,
  unique (person_id, step_id)
);
create index on app.gyan_progress (center_id, person_id);

create table app.gyan_signoffs (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  level_id    uuid not null references app.gyan_levels(id),
  status      text not null default 'requested' check (status in ('requested','approved','needs_work')),
  teacher_user uuid references auth.users(id),
  note        text,
  requested_at timestamptz not null default now(),
  decided_at  timestamptz,
  unique (person_id, level_id)
);
create index on app.gyan_signoffs (center_id, status);

-- ---------------------------------------------------------------------------
-- My Jain Way: practices, logs, points ledger, streaks, Saathi
-- ---------------------------------------------------------------------------
create table app.practices (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid references app.centers(id) on delete cascade,     -- null = shared
  tradition   app.tradition,
  category    text not null,                               -- 'ahimsa','tapa','swadhyay','seva','bhakti'
  key         text not null,
  name        text not null,
  description text,
  default_minutes integer,
  points      integer not null default 1,
  sort_order  integer not null default 0,
  active      boolean not null default true
);

create table app.practice_selections (
  center_id   uuid not null references app.centers(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  practice_id uuid not null references app.practices(id) on delete cascade,
  selected_at timestamptz not null default now(),
  primary key (person_id, practice_id)
);

create table app.practice_logs (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  practice_id uuid not null references app.practices(id),
  logged_on   date not null,
  minutes     integer,
  note        text,
  created_at  timestamptz not null default now(),
  unique (person_id, practice_id, logged_on)
);
create index on app.practice_logs (center_id, person_id, logged_on desc);

-- Append-only points ledger
create table app.points_ledger (
  id          bigint generated always as identity primary key,
  center_id   uuid not null references app.centers(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  points      integer not null,
  reason      text not null check (reason in ('practice','level','anumodana_sent','anumodana_received','support','welcome','volunteer','correction','challenge')),
  ref_id      uuid,
  note        text,
  occurred_at timestamptz not null default now()
);
create index on app.points_ledger (center_id, person_id, occurred_at desc);
create trigger points_ledger_immutable before update or delete on app.points_ledger for each row execute function app.audit_immutable();

create table app.streaks (
  center_id   uuid not null references app.centers(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  current_days integer not null default 0,
  longest_days integer not null default 0,
  last_logged_on date,
  rest_days_used_this_week integer not null default 0,
  primary key (center_id, person_id)
);

create table app.saathi_settings (
  center_id   uuid not null references app.centers(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  opted_in    boolean not null default true,
  share_with_family boolean not null default true,
  primary key (center_id, person_id)
);

create table app.anumodana (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  from_person_id uuid not null references app.people(id) on delete cascade,
  to_person_id uuid not null references app.people(id) on delete cascade,
  kind         text not null default 'celebrate' check (kind in ('celebrate','support')),
  message      text,
  created_at   timestamptz not null default now()
);
create index on app.anumodana (center_id, to_person_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Calendar layers, tithi table, special days
-- ---------------------------------------------------------------------------
create table app.calendar_layers (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid references app.centers(id) on delete cascade,     -- null = shared (school districts, tradition)
  key         text not null,                                          -- 'tithi','parva','pathshala','events','isd_katy'
  name        text not null,
  kind        text not null check (kind in ('tithi','festival','pathshala','events','school_district','custom')),
  source_url  text,                                                   -- ICS feed for school districts
  default_on  boolean not null default false,
  color       text
);

create table app.calendar_entries (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid references app.centers(id) on delete cascade,
  layer_id    uuid not null references app.calendar_layers(id) on delete cascade,
  title       text not null,
  starts_on   date not null,
  ends_on     date,
  all_day     boolean not null default true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  event_id    uuid references app.events(id) on delete cascade,
  metadata    jsonb not null default '{}'::jsonb
);
create index on app.calendar_entries (layer_id, starts_on);

-- Tithi table per year. center_id null = shared table for the tradition;
-- a center row overrides it (panchang differs by gachchh).
create table app.tithi_days (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid references app.centers(id) on delete cascade,
  tradition   app.tradition,
  gregorian   date not null,
  tithi       text not null,                                          -- 'Sud 5', 'Vad 14'
  month_name  text not null,                                          -- 'Kartak'
  paksha      text not null check (paksha in ('sud','vad')),
  is_parva    boolean not null default false,                         -- atham, chaudas, punam/amas
  notes       text
);
create unique index tithi_days_idx on app.tithi_days (coalesce(center_id,'00000000-0000-0000-0000-000000000000'::uuid), tradition, gregorian);

create table app.daily_timings (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  on_date     date not null,
  sunrise     time,
  sunset      time,
  navkarsi    time,
  chauvihar   time,
  aarti       time,
  temple_open time,
  temple_close time,
  unique (center_id, on_date)
);

create table app.special_days (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  household_id uuid not null references app.households(id) on delete cascade,
  person_id    uuid references app.people(id) on delete cascade,
  kind         text not null check (kind in ('birthday','anniversary','punyatithi','diksha','other')),
  label        text,
  calendar_date date,                                                 -- month/day recurs yearly
  tithi        text,                                                  -- tithi-based, recalculated yearly
  tithi_month  text,
  reminder_days_before integer not null default 14,
  labh_prompt_enabled boolean not null default true,
  show_on_home boolean not null default false,                       -- punyatithi hidden from Home by default
  created_at   timestamptz not null default now()
);
create index on app.special_days (center_id, household_id);
alter table app.recurring_gifts add constraint recurring_special_day_fk foreign key (special_day_id) references app.special_days(id) on delete set null;

-- Labh menu (what a family can sponsor on a special day)
create table app.labh_options (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  name         text not null,
  amount_cents integer not null,
  fund_id      uuid references app.funds(id),
  sort_order   integer not null default 0,
  active       boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Guide, roster, directory
-- ---------------------------------------------------------------------------
create table app.guide_sections (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  slug        text not null,
  title       text not null,
  body_md     text not null,
  translations jsonb not null default '{}'::jsonb,
  sort_order  integer not null default 0,
  is_checklist boolean not null default false,
  public      boolean not null default true,
  updated_at  timestamptz not null default now(),
  unique (center_id, slug)
);
create trigger touch_guide_sections before update on app.guide_sections for each row execute function app.touch_updated_at();

create table app.role_roster (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  body        text not null,                                          -- 'executive_committee','trustees','pathshala','tech'
  title       text not null,                                          -- 'President'
  person_id   uuid references app.people(id) on delete set null,
  term_starts_on date,
  term_ends_on date,
  contact_role_email citext,                                          -- role mailbox, contact follows the role
  sort_order  integer not null default 0
);
create index on app.role_roster (center_id, body);

-- Niva (assistant) knowledge and logs
create table app.niva_conversations (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  user_id     uuid references auth.users(id),
  question    text not null,
  answer      text,
  sources     jsonb not null default '[]'::jsonb,
  unanswered  boolean not null default false,
  created_at  timestamptz not null default now()                      -- retention 30 days
);
create index on app.niva_conversations (center_id, created_at desc);
