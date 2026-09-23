-- 0008_communications.sql
-- One outbound service (push, SMS, WhatsApp, email, in-app), templates,
-- preferences, campaigns/newsletters, shared inboxes, WhatsApp join queue,
-- surveys, alerts.

create type app.channel as enum ('push','sms','whatsapp','email','in_app');

create table app.notification_topics (
  key         text primary key,                        -- 'events','giving','pathshala','jain_way','alerts','newsletter','store'
  name        text not null,
  default_on  boolean not null default true,
  marketing   boolean not null default false           -- children never receive marketing
);

create table app.notification_preferences (
  center_id   uuid not null references app.centers(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  topic_key   text not null references app.notification_topics(key),
  channel     app.channel not null,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (person_id, topic_key, channel)
);

create table app.channel_optins (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  channel     app.channel not null,
  address     text not null,                           -- phone or email
  opted_in    boolean not null,
  source      text not null,                           -- 'onboarding','keyword','admin','import'
  recorded_at timestamptz not null default now()
);
create index on app.channel_optins (center_id, person_id, channel, recorded_at desc);

create table app.push_devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  center_id   uuid references app.centers(id) on delete cascade,
  platform    text not null check (platform in ('ios','android','web')),
  token       text not null unique,
  last_seen_at timestamptz not null default now()
);

create table app.message_templates (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid references app.centers(id) on delete cascade,   -- null = platform default
  key         text not null,                                        -- 'rsvp_confirmation','lunch_reminder','outbid',...
  channel     app.channel not null,
  language    text not null default 'en',
  subject     text,
  body        text not null,                                        -- handlebars-style {{vars}}
  version     integer not null default 1,
  unique (center_id, key, channel, language, version)
);

-- Every outbound message, system or human, goes through this outbox.
create table app.messages (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  campaign_id  uuid,                                                -- comms campaign (fk below)
  person_id    uuid references app.people(id) on delete set null,
  to_address   text,
  channel      app.channel not null,
  topic_key    text references app.notification_topics(key),
  template_key text,
  subject      text,
  body         text not null,
  payload      jsonb not null default '{}'::jsonb,                 -- deep link, data
  scheduled_at timestamptz not null default now(),
  sent_at      timestamptz,
  delivered_at timestamptz,
  opened_at    timestamptz,
  status       text not null default 'queued' check (status in ('queued','sent','delivered','failed','suppressed','cancelled')),
  failure_reason text,
  provider_ref text,
  created_at   timestamptz not null default now()
);
create index on app.messages (center_id, status, scheduled_at);
create index on app.messages (center_id, person_id, created_at desc);

create table app.comms_campaigns (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  kind         text not null check (kind in ('announcement','newsletter','appeal','event','pathshala_update','alert','survey')),
  title        text not null,
  body_md      text,
  translations jsonb not null default '{}'::jsonb,
  channels     app.channel[] not null default '{push,email}',
  audience     jsonb not null default '{"all_members":true}'::jsonb,   -- segment definition
  saved_segment_id uuid,
  scheduled_at timestamptz,
  sent_at      timestamptz,
  status       text not null default 'draft' check (status in ('draft','pending_approval','scheduled','sending','sent','cancelled')),
  requires_second_approver boolean not null default false,
  approved_by  uuid references auth.users(id),
  second_approver uuid references auth.users(id),
  recipients_count integer,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on app.comms_campaigns (center_id, status);
create trigger touch_comms_campaigns before update on app.comms_campaigns for each row execute function app.touch_updated_at();
alter table app.messages add constraint messages_campaign_fk foreign key (campaign_id) references app.comms_campaigns(id) on delete set null;

create table app.saved_segments (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  name        text not null,
  definition  jsonb not null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
alter table app.comms_campaigns add constraint comms_segment_fk foreign key (saved_segment_id) references app.saved_segments(id) on delete set null;

-- Shared role inboxes (zone lead, membership, events, pathshala, donations, temple)
create table app.inboxes (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  key         text not null,
  name        text not null,
  zone_id     uuid references app.zones(id) on delete cascade,
  role_key    text references app.roles(key),
  response_target_hours integer not null default 48,
  unique (center_id, key)
);

create table app.threads (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  inbox_id     uuid not null references app.inboxes(id) on delete cascade,
  from_person_id uuid references app.people(id),
  from_guest_contact text,
  subject      text,
  status       text not null default 'open' check (status in ('open','assigned','waiting','closed')),
  assignee_user uuid references auth.users(id),
  first_response_at timestamptz,
  closed_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on app.threads (center_id, inbox_id, status);
create trigger touch_threads before update on app.threads for each row execute function app.touch_updated_at();

create table app.thread_messages (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  thread_id   uuid not null references app.threads(id) on delete cascade,
  author_user uuid references auth.users(id),
  from_role   boolean not null default false,                       -- replies come from the role, never a personal number
  body        text not null,
  attachments jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index on app.thread_messages (thread_id, created_at);

create table app.whatsapp_groups (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  name        text not null,
  description text,
  zone_id     uuid references app.zones(id) on delete set null,
  invite_link text,
  audience    text not null default 'members' check (audience in ('public','members','zone','pathshala','volunteers')),
  active      boolean not null default true
);

create table app.whatsapp_join_requests (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  group_id    uuid not null references app.whatsapp_groups(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  phone_e164  text not null,
  status      text not null default 'pending' check (status in ('pending','approved','added','declined')),
  handled_by  uuid references auth.users(id),
  handled_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index on app.whatsapp_join_requests (center_id, status);

-- Surveys
create table app.surveys (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  title        text not null,
  description  text,
  questions    jsonb not null,                                       -- [{id,type,label,options,required}]
  audience     jsonb not null default '{"all_members":true}'::jsonb,
  anonymous    boolean not null default false,
  opens_at     timestamptz,
  closes_at    timestamptz,
  status       text not null default 'draft' check (status in ('draft','open','closed')),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create table app.survey_responses (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  survey_id   uuid not null references app.surveys(id) on delete cascade,
  person_id   uuid references app.people(id) on delete set null,     -- null when anonymous
  answers     jsonb not null,
  submitted_at timestamptz not null default now()
);
create index on app.survey_responses (survey_id);

-- Alerts (time-critical; SMS allowed)
create table app.alerts (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  severity    text not null check (severity in ('info','important','urgent')),
  title       text not null,
  body        text not null,
  audience    jsonb not null default '{"all_members":true}'::jsonb,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  campaign_id uuid references app.comms_campaigns(id),
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index on app.alerts (center_id, starts_at desc);

-- Data-subject requests
create table app.data_requests (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  person_id   uuid not null references app.people(id),
  requested_by uuid references auth.users(id),
  kind        text not null check (kind in ('export','deletion','deactivation','reactivation')),
  status      text not null default 'open' check (status in ('open','in_progress','completed','rejected')),
  due_on      date not null default (current_date + 30),
  handled_by  uuid references auth.users(id),
  completed_at timestamptz,
  export_path text,
  created_at  timestamptz not null default now()
);
