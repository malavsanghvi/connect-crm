-- 0004_events.sql
-- Events, checklist templates + actions (ported from EAMS), RSVP, tickets,
-- check-in, lunch slots, volunteers, waivers, background checks.

create type app.event_phase as enum ('pre','during','after');
create type app.action_state as enum ('not_started','in_progress','completed','removed');
create type app.rsvp_status as enum ('invited','rsvpd','confirmed','cancelled','waitlisted','no_show','attended');

create table app.event_templates (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  name          text not null,
  description   text,
  default_owner_person_id uuid references app.people(id),
  lessons_learned jsonb not null default '[]'::jsonb,   -- [{id,text,author,created_at}]
  confidential  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger touch_event_templates before update on app.event_templates for each row execute function app.touch_updated_at();

create table app.event_template_items (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  template_id   uuid not null references app.event_templates(id) on delete cascade,
  phase         app.event_phase not null,
  name          text not null,
  description   text,
  priority      text not null default 'medium' check (priority in ('low','medium','high','critical')),
  action_type   text not null default 'task' check (action_type in ('task','meeting','email','call','whatsapp_announcement')),
  offset_days   integer,                                 -- relative to event date (null = unset)
  sort_order    integer not null default 0,
  confidential  boolean not null default false
);
create index on app.event_template_items (template_id, phase, sort_order);

create table app.events (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  template_id    uuid references app.event_templates(id),
  name           text not null,
  description    text,
  flyer_path     text,
  venue          text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  program_year   text,                                  -- e.g. '2026-2027' (Pathshala year)
  capacity       integer,
  waitlist_enabled boolean not null default false,
  audience       text not null default 'members_and_guests' check (audience in ('members_only','life_members_only','pathshala_families','members_and_guests','public')),
  eligibility    jsonb not null default '{}'::jsonb,
  rsvp_opens_at  timestamptz,
  rsvp_closes_at timestamptz,
  confirmation_hours_before integer not null default 24,
  attendee_flags jsonb not null default '["child_under_12","senior","assistance"]'::jsonb,
  commitment_options jsonb not null default '{"per_person":[300,500,700],"lump_sum":[1000,2500,5000],"open":true}'::jsonb,
  lunch_enabled  boolean not null default false,
  lunch_starts_at timestamptz,
  lunch_slot_minutes integer not null default 15,
  lunch_seats_per_slot integer,
  lunch_priority_rules jsonb not null default '{"family_with_child_under_12_at_start":true,"senior_at_start":true}'::jsonb,
  is_paid        boolean not null default false,
  member_price_cents integer,
  guest_price_cents integer,
  owner_person_id uuid references app.people(id),
  status         text not null default 'draft' check (status in ('draft','published','rsvp_closed','live','completed','cancelled')),
  confidential   boolean not null default false,
  lessons_learned jsonb not null default '[]'::jsonb,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on app.events (center_id, starts_at);
create index on app.events (center_id, status);
create trigger touch_events before update on app.events for each row execute function app.touch_updated_at();

alter table app.opportunities add constraint opportunities_event_fk foreign key (event_id) references app.events(id) on delete set null;
alter table app.bolis add constraint bolis_event_fk foreign key (event_id) references app.events(id) on delete set null;
alter table app.counting_sessions add constraint counting_event_fk foreign key (event_id) references app.events(id) on delete set null;

-- Checklist actions (standalone or per event/phase). "During" actions inherit the event date.
create table app.actions (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  event_id       uuid references app.events(id) on delete cascade,
  phase          app.event_phase,
  template_item_id uuid references app.event_template_items(id) on delete set null,
  name           text not null,
  description    text,
  owner_person_id uuid references app.people(id),
  backup_owner_ids uuid[] not null default '{}',
  due_on         date,
  priority       text not null default 'medium' check (priority in ('low','medium','high','critical')),
  state          app.action_state not null default 'not_started',
  action_type    text not null default 'task' check (action_type in ('task','meeting','email','call','whatsapp_announcement')),
  is_idea        boolean not null default false,
  dependencies   uuid[] not null default '{}',
  status_updates jsonb not null default '[]'::jsonb,   -- [{date,text,author}]
  confidential   boolean not null default false,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on app.actions (center_id, event_id, phase);
create index on app.actions (center_id, owner_person_id, state);
create index on app.actions (center_id, due_on);
create trigger touch_actions before update on app.actions for each row execute function app.touch_updated_at();

-- During-event actions always carry the event date (EAMS rule C).
create or replace function app.sync_during_action_due() returns trigger
language plpgsql as $$
begin
  if new.phase = 'during' and new.event_id is not null then
    select (starts_at at time zone c.time_zone)::date into new.due_on
      from app.events e join app.centers c on c.id = e.center_id where e.id = new.event_id;
  end if;
  return new;
end $$;
create trigger actions_during_due before insert or update of phase, event_id on app.actions
  for each row execute function app.sync_during_action_due();

create or replace function app.sync_event_during_dates() returns trigger
language plpgsql as $$
begin
  if new.starts_at is distinct from old.starts_at then
    update app.actions set due_on = (new.starts_at at time zone (select time_zone from app.centers where id = new.center_id))::date
      where event_id = new.id and phase = 'during';
  end if;
  return new;
end $$;
create trigger events_sync_during after update of starts_at on app.events
  for each row execute function app.sync_event_during_dates();

-- Instantiate an event from a template: each checklist item becomes an action.
create or replace function app.create_event_from_template(p_template uuid, p_name text, p_starts_at timestamptz, p_program_year text default null)
returns uuid language plpgsql security definer set search_path = app, public as $$
declare v_event uuid; v_center uuid; t record;
begin
  select center_id into v_center from app.event_templates where id = p_template;
  insert into app.events (center_id, template_id, name, description, starts_at, program_year, owner_person_id, confidential)
  select center_id, id, p_name, description, p_starts_at, p_program_year, default_owner_person_id, confidential
  from app.event_templates where id = p_template returning id into v_event;
  for t in select * from app.event_template_items where template_id = p_template order by phase, sort_order loop
    insert into app.actions (center_id, event_id, phase, template_item_id, name, description, priority, action_type, confidential, due_on)
    values (v_center, v_event, t.phase, t.id, t.name, t.description, t.priority, t.action_type, t.confidential,
            case when t.offset_days is not null and p_starts_at is not null then (p_starts_at::date + t.offset_days) end);
  end loop;
  return v_event;
end $$;

-- ---------------------------------------------------------------------------
-- RSVP, tickets, check-in, lunch
-- ---------------------------------------------------------------------------
create table app.rsvps (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  event_id       uuid not null references app.events(id) on delete cascade,
  household_id   uuid references app.households(id),          -- null for guest households
  submitted_by_person_id uuid references app.people(id),
  guest_name     text,
  guest_phone_e164 text,
  guest_email    citext,
  commitment_pledge_id uuid references app.pledges(id),
  commitment_mode text check (commitment_mode in ('per_person','lump_sum','none')),
  status         app.rsvp_status not null default 'rsvpd',
  confirmed_at   timestamptz,
  cancelled_at   timestamptz,
  source         text not null default 'app' check (source in ('app','guest_web','admin','walk_in','kiosk','import')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on app.rsvps (event_id, status);
create index on app.rsvps (center_id, household_id);
create trigger touch_rsvps before update on app.rsvps for each row execute function app.touch_updated_at();

create table app.attendees (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  event_id      uuid not null references app.events(id) on delete cascade,
  rsvp_id       uuid not null references app.rsvps(id) on delete cascade,
  person_id     uuid references app.people(id),             -- null for named guests
  display_name  text not null,
  is_child_under_12 boolean not null default false,
  is_senior     boolean not null default false,
  needs_assistance boolean not null default false,
  assistance_note text,
  status        app.rsvp_status not null default 'rsvpd',
  ticket_token  text unique,                                -- signed rotating token for QR
  ticket_revoked boolean not null default false,
  checked_in_at timestamptz,
  checked_in_station text,
  checked_in_by uuid references auth.users(id),
  served_food_at timestamptz,
  gift_given_at timestamptz,
  lunch_slot_id uuid,
  created_at    timestamptz not null default now()
);
create index on app.attendees (event_id, status);
create index on app.attendees (event_id, person_id);

create table app.lunch_slots (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  event_id     uuid not null references app.events(id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  seats        integer not null,
  assigned     integer not null default 0,
  served       integer not null default 0,
  status       text not null default 'scheduled' check (status in ('scheduled','now_serving','done'))
);
create index on app.lunch_slots (event_id, starts_at);
alter table app.attendees add constraint attendees_lunch_slot_fk foreign key (lunch_slot_id) references app.lunch_slots(id) on delete set null;

create table app.scan_log (
  id           bigint generated always as identity primary key,
  center_id    uuid not null references app.centers(id) on delete cascade,
  event_id     uuid not null references app.events(id) on delete cascade,
  attendee_id  uuid references app.attendees(id),
  token        text,
  station      text not null,
  result       text not null check (result in ('ok','duplicate','invalid','revoked','wrong_event')),
  scanned_by   uuid references auth.users(id),
  device_id    text,
  offline_queued boolean not null default false,
  scanned_at   timestamptz not null default now()
);
create index on app.scan_log (event_id, scanned_at desc);

-- Volunteers, stations, waivers, background checks
create table app.volunteer_groups (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  name        text not null,
  coordinator_person_id uuid references app.people(id),
  requires_background_check boolean not null default false,
  requires_waiver_kind text,                                 -- legal_documents.kind
  unique (center_id, name)
);

create table app.volunteer_interests (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  group_id    uuid not null references app.volunteer_groups(id) on delete cascade,
  status      text not null default 'interested' check (status in ('interested','active','inactive')),
  created_at  timestamptz not null default now(),
  unique (person_id, group_id)
);

create table app.volunteer_shifts (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  event_id    uuid not null references app.events(id) on delete cascade,
  station     text not null,                                -- entry, food, gifts, parking, kitchen, app_seva
  starts_at   timestamptz,
  ends_at     timestamptz,
  capacity    integer,
  notes       text
);

create table app.volunteer_assignments (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  shift_id    uuid not null references app.volunteer_shifts(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  status      text not null default 'assigned' check (status in ('assigned','confirmed','declined','no_show','completed')),
  waiver_consent_id uuid references app.consents(id),
  created_at  timestamptz not null default now(),
  unique (shift_id, person_id)
);

create table app.background_checks (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  provider    text,
  provider_ref text,
  status      text not null check (status in ('requested','clear','flagged','expired')),
  cleared_on  date,
  expires_on  date,
  recorded_by uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index on app.background_checks (center_id, person_id, expires_on desc);
