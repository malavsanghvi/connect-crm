-- 0591_pathshala_register_hold_place_bill.sql: Pathshala registration, database pull request 2 of 5 (DB2: register,
-- hold, place, bill). docs/PATHSHALA_REGISTRATION_PLAN.md version 2, accepted by the owner on 2026-10-06 (P15–P32 with
-- every recommended answer). Builds on 0590 (levels, fees, the term's rules, the one pricing function).
--
--   app.register_pathshala_children   a family (an adult of the household) or the office (pathshala.manage) registers
--                                  several learners at once, children and adults, in both payment modes (§2.6):
--                                    pledge mode: a free seat places the learner in the class of that level with the most
--                                    free seats and bills ONE pledge per enrollment (the term's campaign and fund, source
--                                    pathshala_fee, source_ref_id = the enrollment, amount = the locked line), due on the
--                                    first class day or 14 days after the seat was given, whichever is later;
--                                    pay now: the seat is HELD (hold_hours, 48 by default; the office window for an office
--                                    registration), the pledges are created due today, nothing is placed until paid;
--                                  no seat: the level's waitlist (when a class takes one), else refused in plain English;
--                                  not a member: held for membership (P6); "not sure", a children's level outside the
--                                  child's age band, or an office-step term: the office decides (nothing billed); another
--                                  adult learner must agree to the waiver in their own app (P14); a child not yet on the
--                                  family: a pending registration until the office adds the child (P7 of v1).
--                                  Re-prices under a lock per term and level and refuses a changed total or a changed
--                                  outcome (hint "review_again"); idempotent on the client key; records the waiver
--                                  consent per learner; queues the messages (§2.14).
--   app.pathshala_registrations    one row per family submission (the response is kept for a repeated client key)
--   app.pathshala_enrollments      + registration_id, track_id (one enrollment per learner per TRACK, P10: the unique
--                                  key becomes term + learner + track), hold_expires_at, hold_reminded_at, offered_at,
--                                  waitlisted_at, suggested_level_id, suggestion_reason, channel, withdrawn_at, withdrawn_by.
--                                  A held learner stays status "requested". The six statuses stay.
--   app.pathshala_enrollment_fees  + hold_reason (membership | payment | office_payment | assistance | waiver: why a
--                                  "requested" learner waits) and withdrawal_reason: they live on the fee line, which a
--                                  child never reads (P30); app._pathshala_hold(enrollment) reads the reason
--   app.pathshala_pending_registrations   a child the parent added who has no person row yet; converted (at the original
--                                  time) when the office approves the add-member request, cancelled when it is declined
--   app.rsvp_credit_releases       the ONE credit queue for the treasurer: rsvp_id nullable, enrollment_id, kind; exactly
--                                  one of the two is set (B23; app.resolve_rsvp_credit serves both)
--   seats                          a seat held for payment counts as taken until the sweep releases it; seats are given
--                                  under an advisory lock per term and level, so two families never get the last seat
--   app.worker_pathshala_holds_sweep  every 15 minutes (worker job pathshala.holds_sweep): a reminder 6 hours before a hold
--                                  ends; a hold that is no longer live (its window passed and no payment page for it is
--                                  open at the provider, at most 24 hours old; an office hold also while a Zelle report
--                                  for it waits for the treasurer) is released: its fee pledges are cancelled, anything
--                                  paid toward them becomes a credit row for the treasurer, the learner is withdrawn with
--                                  the reason, the family is told, and the seat goes to the waitlist
--   trigger pathshala_fee_paid     when a pathshala_fee pledge becomes paid through ANY channel (card or PayPal webhook,
--                                  an office payment, a matched bank line, the treasurer applying credit) a held learner
--                                  is placed, once; the registration's $0 lines are confirmed with its last paid line. It
--                                  never moves money or bills.
--   money after a release          an online payment for a released hold finds no open pledge, stays unallocated (household
--                                  credit) and gets a credit row: the late-payment task for the treasurer and principal
--   waitlist promotion (P19)       a seat that frees (a release, a withdrawal, a capacity raised, a class added) goes to
--                                  the earliest waitlisted learner of that level: placed and billed (pledge mode) or
--                                  offered and held for payment (pay now); a lapsed offer leaves the waitlist
--   app.place_pathshala_enrollment, app.place_next_from_waitlist, app.release_pathshala_hold, app.extend_pathshala_hold,
--   app.choose_pathshala_office_payment, app.pathshala_registration_queue, app.pathshala_task_counts
--   triggers                       a membership becoming active lifts the household's membership holds; an approved
--                                  add-member request converts the pending registration; a declined one cancels it
--   templates                      pathshala_registration_received, pathshala_registered, pathshala_payment_due,
--                                  pathshala_hold_reminder, pathshala_hold_released, pathshala_waitlisted, pathshala_placed,
--                                  pathshala_membership_hold, pathshala_hold_lifted, pathshala_child_added,
--                                  pathshala_child_not_added (push + email, platform defaults); pushes carry type
--                                  "pathshala" and a deep_link at the payload's top level (0587's pattern)
--
-- The 0565 insert rule (a parent's bare request) stays until PR 11. The portal's direct writes still work for staff, but
-- a learner whose seat is held for payment cannot be moved or re-statused directly (the functions do it).
--
-- ACCESS AND MONEY (the owner approves this pull request before it merges): creates fee pledges (pledge mode at
-- registration; pay now at registration, due today), holds seats, cancels the pledges of an unpaid hold and turns money
-- already paid toward them into credit (never a refund, never applied automatically), and places learners automatically
-- (P12 changed). The new tables are read by the household's adults (never a child), pathshala.manage and giving staff;
-- nobody writes them directly.
set client_min_messages = warning;

-- ═════════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists app.pathshala_registrations (
  id                       uuid primary key default gen_random_uuid(),
  center_id                uuid not null references app.centers(id) on delete cascade,
  term_id                  uuid not null references app.pathshala_terms(id),
  household_id             uuid not null references app.households(id),
  registered_by            uuid references auth.users(id),
  registered_by_person     uuid references app.people(id),
  channel                  text not null check (channel in ('app', 'office')),
  payment_mode             text not null check (payment_mode in ('pledge', 'pay_now')),
  client_key               text check (client_key is null or char_length(client_key) between 8 and 100),
  request_hash             text,
  total_cents              bigint not null default 0 check (total_cents >= 0),
  office_payment_chosen_at timestamptz,
  office_payment_chosen_by uuid references auth.users(id),
  result                   jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  unique (center_id, client_key)
);
create index if not exists pathshala_registrations_household_idx on app.pathshala_registrations (household_id, term_id);
comment on table app.pathshala_registrations is
  'One family submission (0591): who registered, under which household (P32), the channel (app | office), the payment mode at that moment, the client key that makes a retry return the same answer, and that answer (result). Written only by app.register_pathshala_children.';

alter table app.pathshala_enrollments
  add column if not exists registration_id    uuid references app.pathshala_registrations(id),
  add column if not exists track_id           uuid references app.pathshala_tracks(id),
  add column if not exists hold_expires_at    timestamptz,
  add column if not exists hold_reminded_at   timestamptz,
  add column if not exists offered_at         timestamptz,
  add column if not exists waitlisted_at      timestamptz,
  add column if not exists suggested_level_id uuid references app.pathshala_levels(id),
  add column if not exists suggestion_reason  text,
  add column if not exists channel            text,
  add column if not exists withdrawn_at       timestamptz,
  add column if not exists withdrawn_by       uuid references auth.users(id);
alter table app.pathshala_enrollments drop constraint if exists pathshala_enrollments_registration_rules;
alter table app.pathshala_enrollments add constraint pathshala_enrollments_registration_rules check (
  (suggestion_reason is null or suggestion_reason in ('teacher', 'previous', 'age'))
  and (channel is null or channel in ('app', 'office', 'import', 'demo')));
-- Why a learner waits, and why a seat was released, are fee matters: they live on the fee line (the household's adults and
-- the staff read it; a child never does, P30).
alter table app.pathshala_enrollment_fees
  add column if not exists hold_reason       text,
  add column if not exists withdrawal_reason text;
alter table app.pathshala_enrollment_fees drop constraint if exists pathshala_enrollment_fees_hold_rules;
alter table app.pathshala_enrollment_fees add constraint pathshala_enrollment_fees_hold_rules check (
  (hold_reason is null or hold_reason in ('membership', 'payment', 'office_payment', 'assistance', 'waiver'))
  and (withdrawal_reason is null or char_length(withdrawal_reason) <= 500));
comment on column app.pathshala_enrollment_fees.hold_reason is
  'Why a "requested" learner waits (0591): membership (P6), payment (a pay-now seat held for an online payment until the enrollment''s hold_expires_at), office_payment (held for payment at the office), assistance (pay now: held until the fee assistance decision), waiver (another adult learner must agree to the waiver in their own app). A seat held for payment or assistance counts as taken. On the fee line, not the enrollment: a child never reads it (P30).';
comment on column app.pathshala_enrollment_fees.withdrawal_reason is 'Why the learner was withdrawn when it is about the fee ("The fee was not paid by …"): on the fee line, which a child never reads (P30).';
comment on column app.pathshala_enrollments.track_id is 'One enrollment per learner per track per term (P10, 0591). Filled from the class''s level, else the requested level, else the community''s Jainism track.';
comment on column app.pathshala_enrollments.offered_at is 'When a waitlisted learner was offered a seat held for payment (pay now, P19).';
comment on column app.pathshala_enrollments.notes is 'The family''s own note (0591; office notes move to a staff-only table in 0593, P28).';

create table if not exists app.pathshala_pending_registrations (
  id                 uuid primary key default gen_random_uuid(),
  center_id          uuid not null references app.centers(id) on delete cascade,
  term_id            uuid not null references app.pathshala_terms(id),
  household_id       uuid not null references app.households(id),
  registration_id    uuid references app.pathshala_registrations(id),
  change_request_id  uuid references app.household_change_requests(id),
  first_name         text not null check (char_length(first_name) between 1 and 80),
  last_name          text not null check (char_length(last_name) between 1 and 80),
  date_of_birth      date,
  relationship       text,
  track_id           uuid not null references app.pathshala_tracks(id),
  requested_level_id uuid references app.pathshala_levels(id),
  note               text check (note is null or char_length(note) <= 1000),
  quote              jsonb not null default '{}'::jsonb,
  registered_at      timestamptz not null default now(),
  registered_by      uuid references auth.users(id),
  status             text not null default 'pending' check (status in ('pending', 'converted', 'cancelled')),
  enrollment_id      uuid references app.pathshala_enrollments(id),
  decided_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists pathshala_pending_registrations_request_idx on app.pathshala_pending_registrations (change_request_id);
create index if not exists pathshala_pending_registrations_household_idx on app.pathshala_pending_registrations (household_id, term_id, status);
comment on table app.pathshala_pending_registrations is
  'A child the parent added in the registration who has no person row yet (0591): the add-member request (app.request_add_family_member) and the locked quote line. When the office approves the request the child is registered at the ORIGINAL time (waitlist order kept); when it declines, this is cancelled and the parent told.';

-- One credit queue for the treasurer: RSVP (0543) and Pathshala.
alter table app.rsvp_credit_releases alter column rsvp_id drop not null;
alter table app.rsvp_credit_releases add column if not exists enrollment_id uuid references app.pathshala_enrollments(id);
alter table app.rsvp_credit_releases add column if not exists kind text not null default 'rsvp_cancelled';
alter table app.rsvp_credit_releases drop constraint if exists rsvp_credit_releases_one_source;
alter table app.rsvp_credit_releases add constraint rsvp_credit_releases_one_source check (
  num_nonnulls(rsvp_id, enrollment_id) = 1
  and kind in ('rsvp_cancelled', 'pathshala_hold_released', 'pathshala_late_payment', 'pathshala_withdrawn')
  and ((kind = 'rsvp_cancelled') = (rsvp_id is not null)));
create index if not exists rsvp_credit_releases_enrollment_idx on app.rsvp_credit_releases (enrollment_id) where enrollment_id is not null;
comment on table app.rsvp_credit_releases is
  'The treasurer''s credit queue (0543, widened in 0591): money a member paid toward a pledge that was then cancelled (an RSVP cancelled with credit, a Pathshala seat released unpaid, a payment that arrived after the release, from 0592 a Pathshala withdrawal). Never applied to pledges automatically; app.resolve_rsvp_credit marks a row handled.';

alter table app.pathshala_enrollment_fees drop constraint if exists pathshala_enrollment_fees_registration_fk;
alter table app.pathshala_enrollment_fees add constraint pathshala_enrollment_fees_registration_fk
  foreign key (registration_id) references app.pathshala_registrations(id);

insert into app.module_tables (table_name, module_key) values
  ('pathshala_registrations', 'pathshala'), ('pathshala_pending_registrations', 'pathshala')
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_pathshala_registrations on app.pathshala_registrations;
create trigger audit_pathshala_registrations after insert or update or delete on app.pathshala_registrations
  for each row execute function app.audit_row();
drop trigger if exists audit_pathshala_pending_registrations on app.pathshala_pending_registrations;
create trigger audit_pathshala_pending_registrations after insert or update or delete on app.pathshala_pending_registrations
  for each row execute function app.audit_row();

alter table app.pathshala_registrations enable row level security;
alter table app.pathshala_pending_registrations enable row level security;
drop policy if exists pathshala_registrations_read on app.pathshala_registrations;
create policy pathshala_registrations_read on app.pathshala_registrations for select to authenticated
  using (app.pathshala_adult_of_household(center_id, household_id) or app.has_permission(center_id, 'pathshala.manage')
         or app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.manage'));
drop policy if exists pathshala_pending_registrations_read on app.pathshala_pending_registrations;
create policy pathshala_pending_registrations_read on app.pathshala_pending_registrations for select to authenticated
  using (app.pathshala_adult_of_household(center_id, household_id) or app.has_permission(center_id, 'pathshala.manage')
         or app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.manage'));
do $$
declare t text;
begin
  foreach t in array array['pathshala_registrations', 'pathshala_pending_registrations'] loop
    execute format('drop policy if exists module_switch on app.%I', t);
    execute format($p$create policy module_switch on app.%I as restrictive for all to public
      using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('pathshala'))::uuid[])))
      with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('pathshala'))::uuid[])))$p$, t);
    execute format('revoke all on app.%I from public, anon, authenticated, connect_worker', t);
    execute format('grant select on app.%I to authenticated', t);
    execute format('grant all on app.%I to service_role', t);
  end loop;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- One enrollment per learner per track (P10)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function app.pathshala_enrollments_track() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v uuid;
begin
  if new.class_id is not null and (tg_op = 'INSERT' or new.class_id is distinct from old.class_id or new.track_id is null) then
    select l.track_id into v from app.pathshala_classes c join app.pathshala_levels l on l.id = c.level_id where c.id = new.class_id;
    if v is not null then new.track_id := v; end if;
  end if;
  if new.track_id is null and new.requested_level_id is not null then
    select l.track_id into v from app.pathshala_levels l where l.id = new.requested_level_id;
    new.track_id := v;
  end if;
  if new.track_id is null then
    select tr.id into v from app.pathshala_tracks tr where tr.center_id = new.center_id order by (tr.key = 'jainism') desc, tr.key limit 1;
    new.track_id := v;
  end if;
  return new;
end $$;
drop trigger if exists pathshala_enrollments_track on app.pathshala_enrollments;
create trigger pathshala_enrollments_track before insert or update of class_id, requested_level_id, track_id on app.pathshala_enrollments
  for each row execute function app.pathshala_enrollments_track();

do $$
begin
  perform app.set_audit_context('Pathshala 0591: each registration records its track (one per learner per track, P10)');
  update app.pathshala_enrollments e
     set track_id = coalesce(
           (select l.track_id from app.pathshala_classes c join app.pathshala_levels l on l.id = c.level_id where c.id = e.class_id),
           (select l.track_id from app.pathshala_levels l where l.id = e.requested_level_id),
           (select tr.id from app.pathshala_tracks tr where tr.center_id = e.center_id order by (tr.key = 'jainism') desc, tr.key limit 1))
   where e.track_id is null;
end $$;
alter table app.pathshala_enrollments drop constraint if exists pathshala_enrollments_term_id_student_person_id_key;
alter table app.pathshala_enrollments drop constraint if exists pathshala_enrollments_term_student_track_key;
alter table app.pathshala_enrollments add constraint pathshala_enrollments_term_student_track_key unique (term_id, student_person_id, track_id);

-- A direct write through the API (the portal's older screens, the member app's request) cannot set the registration's
-- own columns, and cannot move or re-status a learner whose seat is held for payment: the functions do that (the hold's
-- pledges must be cancelled or paid, never left behind).
create or replace function app.pathshala_enrollments_guard() returns trigger
language plpgsql set search_path = app, public, extensions as $$
declare v_hold text; v_fee text;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.hold_expires_at is not null or new.registration_id is not null or new.offered_at is not null then
      raise exception 'Register learners through Pathshala registration (it holds and bills seats).' using errcode = '22023';
    end if;
    return new;
  end if;
  -- Only the Pathshala principal (pathshala.manage, who reads the fee line) can update an enrollment directly.
  select fl.hold_reason, fl.status into v_hold, v_fee from app.pathshala_enrollment_fees fl where fl.enrollment_id = old.id;
  -- The portal's older Withdraw button wrote the status directly and left the fee pledge open (review B3). A seat whose
  -- fee is billed or paid is given up only when the fee is handled: the treasurer cancels or settles the pledge in Giving
  -- first (withdrawal with the fee handled comes in migration 0592). Finishing the term (completed) is not giving up.
  if old.status in ('placed', 'active') and new.status in ('requested', 'waitlisted', 'withdrawn') and v_fee in ('billed', 'paid') then
    raise exception 'This learner has a Pathshala fee that is %, so the registration cannot be withdrawn or moved back here. The treasurer cancels or settles the fee pledge in Giving first: please ask the Pathshala office.',
      case v_fee when 'paid' then 'paid' else 'billed' end using errcode = '22023';
  end if;
  if v_hold in ('payment', 'office_payment', 'assistance')
     and (new.status is distinct from old.status or new.class_id is distinct from old.class_id) then
    raise exception 'This learner''s seat is held for payment: they are placed when the fee is paid, or the hold is released on the Registrations screen.'
      using errcode = '22023';
  end if;
  if new.hold_expires_at is distinct from old.hold_expires_at
     or new.registration_id is distinct from old.registration_id or new.offered_at is distinct from old.offered_at then
    raise exception 'Holds are released, extended and lifted on the Registrations screen.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists pathshala_enrollments_guard on app.pathshala_enrollments;
create trigger pathshala_enrollments_guard before insert or update on app.pathshala_enrollments
  for each row execute function app.pathshala_enrollments_guard();

-- ═════════════════════════════════════════════════════════════════════════════
-- Small helpers
-- ═════════════════════════════════════════════════════════════════════════════
-- Why an enrollment waits (membership | payment | office_payment | assistance | waiver), null when it does not: kept on the
-- fee line (a child never reads it, P30). Internal: the functions and triggers call it as their definer.
create or replace function app._pathshala_hold(p_enrollment uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select f.hold_reason from app.pathshala_enrollment_fees f where f.enrollment_id = p_enrollment
$$;

create or replace function app.pathshala_today(p_center uuid) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select (now() at time zone coalesce((select nullif(c.time_zone, '') from app.centers c where c.id = p_center), 'America/Chicago'))::date
$$;

-- "Thu Oct 8, 6:00 pm" in the community's time zone.
create or replace function app.pathshala_when(p_ts timestamptz, p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case when p_ts is null then null else
    to_char(p_ts at time zone coalesce((select nullif(c.time_zone, '') from app.centers c where c.id = p_center), 'America/Chicago'),
            'FMDy Mon FMDD, FMHH12:MI am') end
$$;

-- "Sundays 10:00–11:30 · Room C".
create or replace function app.pathshala_class_schedule(p_class uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select initcap(c.meets_on) || 's'
         || case when c.starts_time is not null then ' ' || to_char(c.starts_time, 'HH24:MI')
                   || case when c.ends_time is not null then '–' || to_char(c.ends_time, 'HH24:MI') else '' end else '' end
         || case when nullif(btrim(c.room), '') is not null then ' · Room ' || btrim(c.room) else '' end
    from app.pathshala_classes c where c.id = p_class
$$;

-- The seat lock: one per term and level, taken by everything that gives or frees a seat (§2.5).
create or replace function app._pathshala_lock_level(p_term uuid, p_level uuid) returns void
language sql volatile set search_path = app, public, extensions as $$
  select pg_advisory_xact_lock(hashtextextended('app.pathshala_seats:' || p_term::text || ':' || p_level::text, 0))
$$;

-- Seats of a level: 0590's count plus the seats held for payment (a learner "requested" with a payment, office-payment
-- or assistance hold at that level). A hold counts until it is released, so a seat is never sold twice.
create or replace function app.pathshala_level_seats(p_term uuid, p_level uuid)
returns table (classes integer, seats integer, taken integer, held integer, free integer, waitlist integer, waitlist_on boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_unlimited boolean;
begin
  select count(*)::int, case when count(*) filter (where c.capacity is null) > 0 then null else coalesce(sum(c.capacity), 0)::int end,
         coalesce(bool_or(c.waitlist_enabled), false)
    into classes, seats, waitlist_on
    from app.pathshala_classes c where c.term_id = p_term and c.level_id = p_level;
  select count(*)::int into taken from app.pathshala_enrollments e join app.pathshala_classes c on c.id = e.class_id
   where c.term_id = p_term and c.level_id = p_level and e.status in ('placed', 'active');
  select count(*)::int into held from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
   where e.term_id = p_term and e.requested_level_id = p_level and e.status = 'requested'
     and f.hold_reason in ('payment', 'office_payment', 'assistance');
  v_unlimited := classes > 0 and seats is null;
  free := case when classes = 0 then 0 when v_unlimited then null else greatest(seats - taken - held, 0) end;
  select count(*)::int into waitlist from app.pathshala_enrollments e left join app.pathshala_classes c on c.id = e.class_id
   where e.term_id = p_term and e.status = 'waitlisted' and coalesce(c.level_id, e.requested_level_id) = p_level;
  return next;
end $$;

-- The class of a level with the most free seats (a class with no limit first; ties by name).
create or replace function app._pathshala_class_for(p_term uuid, p_level uuid) returns uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select c.id from app.pathshala_classes c
   where c.term_id = p_term and c.level_id = p_level
   order by (c.capacity is null) desc,
            c.capacity - (select count(*) from app.pathshala_enrollments e where e.class_id = c.id and e.status in ('placed', 'active')) desc nulls last,
            c.name, c.id
   limit 1
$$;

-- Waitlist position at a level (1 = next).
create or replace function app.pathshala_waitlist_position(p_enrollment uuid) returns integer
language sql stable security definer set search_path = app, public, extensions as $$
  select x.pos::int from (
    select e.id, row_number() over (order by e.waitlisted_at nulls last, e.registered_at, e.id) as pos
      from app.pathshala_enrollments e
      join app.pathshala_enrollments me on me.id = p_enrollment
      left join app.pathshala_classes c on c.id = e.class_id
      left join app.pathshala_classes mc on mc.id = me.class_id
     where e.term_id = me.term_id and e.status = 'waitlisted'
       and coalesce(c.level_id, e.requested_level_id) = coalesce(mc.level_id, me.requested_level_id)) x
   where x.id = p_enrollment
$$;

-- Pledge mode: due on the first class day or 14 days after the seat was given, whichever is later (P7 as changed by P15).
create or replace function app._pathshala_due_on(p_term uuid, p_class uuid) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select greatest(app.pathshala_first_class_day(t.id, p_class), app.pathshala_today(t.center_id) + 14)
    from app.pathshala_terms t where t.id = p_term
$$;

-- Children already registered this term, now including the children waiting to be added to the family (their locked
-- quote lines count first, as registered lines do). 0590's definition plus the pending registrations.
create or replace function app._pathshala_existing_lines(p_term uuid, p_household uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'rank_max', greatest(
      coalesce((select max(f.family_rank) from app.pathshala_enrollment_fees f join app.pathshala_enrollments en on en.id = f.enrollment_id
                 where f.term_id = p_term and f.household_id = p_household and f.learner_kind = 'child'
                   and f.status <> 'cancelled' and en.status <> 'withdrawn'), 0),
      coalesce((select max((pr.quote ->> 'family_rank')::int) from app.pathshala_pending_registrations pr
                 where pr.term_id = p_term and pr.household_id = p_household and pr.status = 'pending'
                   and pr.quote ->> 'learner_kind' = 'child'), 0)),
    'running',
      coalesce((select sum(f.base_fee_cents - f.sibling_discount_cents - f.cap_reduction_cents)
                  from app.pathshala_enrollment_fees f join app.pathshala_enrollments en on en.id = f.enrollment_id
                 where f.term_id = p_term and f.household_id = p_household and f.learner_kind = 'child' and f.priced
                   and f.status <> 'cancelled' and en.status <> 'withdrawn'), 0)
      + coalesce((select sum((pr.quote ->> 'base_fee_cents')::bigint - (pr.quote ->> 'sibling_discount_cents')::bigint
                             - (pr.quote ->> 'cap_reduction_cents')::bigint)
                    from app.pathshala_pending_registrations pr
                   where pr.term_id = p_term and pr.household_id = p_household and pr.status = 'pending'
                     and pr.quote ->> 'learner_kind' = 'child' and coalesce((pr.quote ->> 'priced')::boolean, false)), 0),
    'ranks', coalesce((select jsonb_object_agg(x.person::text, x.rank)
                         from (select en.student_person_id as person, min(f.family_rank) as rank
                                 from app.pathshala_enrollment_fees f join app.pathshala_enrollments en on en.id = f.enrollment_id
                                where f.term_id = p_term and f.household_id = p_household and f.learner_kind = 'child'
                                  and f.status <> 'cancelled' and en.status <> 'withdrawn'
                                group by en.student_person_id) x), '{}'::jsonb),
    'late_paid', coalesce((select jsonb_agg(distinct en.student_person_id)
                             from app.pathshala_enrollment_fees f join app.pathshala_enrollments en on en.id = f.enrollment_id
                            where f.term_id = p_term and f.late_fee_cents > 0 and f.status <> 'cancelled' and en.status <> 'withdrawn'
                              and en.household_id = p_household), '[]'::jsonb))
$$;

-- One line priced now, at the rank it already had (a "not sure" learner the office places, P25; a line whose level the
-- office confirmed differently before billing, P26): the level fee, the sibling discount for a child after the first,
-- the cap against the family's other children's lines, and the late fee when the registration was late.
create or replace function app._pathshala_price_line(p_enrollment uuid, p_level uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare e app.pathshala_enrollments; f app.pathshala_enrollment_fees; t app.pathshala_terms; v_base bigint; v_disc bigint := 0;
        v_red bigint := 0; v_late bigint := 0; v_running bigint; v_take bigint; l app.pathshala_levels; v_pct numeric; v_cap bigint;
begin
  select * into e from app.pathshala_enrollments where id = p_enrollment;
  select * into f from app.pathshala_enrollment_fees where enrollment_id = p_enrollment;
  select * into t from app.pathshala_terms where id = e.term_id;
  select * into l from app.pathshala_levels where id = p_level;
  select lf.fee_cents into v_base from app.pathshala_level_fees lf where lf.term_id = t.id and lf.level_id = p_level;
  if v_base is null then
    raise exception '% has no fee for % yet, so it cannot be chosen.', coalesce(l.name, 'That level'), t.name using errcode = '22023';
  end if;
  -- The rules the line was quoted with (its saved snapshot), not the term's rules today; a snapshot without them (a line
  -- entered by hand) falls back to the term's. A cap of $0 or less prices as no cap (as the quote does).
  v_pct := least(greatest(coalesce(nullif(f.rule_snapshot ->> 'sibling_discount_pct', '')::numeric, t.sibling_discount_pct, 0), 0), 100);
  v_cap := case when f.rule_snapshot ? 'family_cap_cents' then nullif(f.rule_snapshot ->> 'family_cap_cents', '')::bigint
                else t.fee_per_family_cap_cents end;
  if v_cap is not null and v_cap <= 0 then v_cap := null; end if;
  if f.learner_kind = 'child' then
    if coalesce(f.family_rank, 1) > 1 then
      v_disc := round(v_base * v_pct / 100.0)::bigint;
    end if;
    v_take := v_base - v_disc;
    if v_cap is not null then
      select coalesce(sum(o.base_fee_cents - o.sibling_discount_cents - o.cap_reduction_cents), 0) into v_running
        from app.pathshala_enrollment_fees o join app.pathshala_enrollments oe on oe.id = o.enrollment_id
       where o.term_id = t.id and o.household_id = e.household_id and o.learner_kind = 'child' and o.priced
         and o.status <> 'cancelled' and oe.status <> 'withdrawn' and o.enrollment_id <> e.id;
      if v_running >= v_cap then v_red := v_take;
      elsif v_running + v_take > v_cap then v_red := v_running + v_take - v_cap;
      end if;
    end if;
  end if;
  -- The late fee is once per learner for the term (P4): not again when another line of theirs already carries one.
  if coalesce((f.rule_snapshot ->> 'late')::boolean, false)
     and not exists (select 1 from app.pathshala_enrollment_fees o join app.pathshala_enrollments oe on oe.id = o.enrollment_id
                      where o.term_id = t.id and oe.student_person_id = e.student_person_id and o.enrollment_id <> e.id
                        and o.status <> 'cancelled' and oe.status <> 'withdrawn' and o.late_fee_cents > 0) then
    v_late := greatest(coalesce(nullif(f.rule_snapshot ->> 'late_fee_cents', '')::bigint, t.late_fee_cents, 0), 0);
  end if;
  return jsonb_build_object('level_id', p_level, 'base_fee_cents', v_base, 'sibling_discount_cents', v_disc,
                            'cap_reduction_cents', v_red, 'late_fee_cents', v_late,
                            'assistance_cents', least(f.assistance_cents, v_base - v_disc - v_red + v_late),
                            'total_cents', greatest(v_base - v_disc - v_red + v_late - f.assistance_cents, 0));
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Messages (§2.14): templates through app.enqueue_message only; the push route at the payload's top level
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function app._pathshala_send(p_center uuid, p_template text, p_channel text, p_to text, p_vars jsonb, p_route jsonb)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid; v_status text; v_why text;
begin
  if p_to is null then return null; end if;
  if to_regprocedure('app.enqueue_message(uuid,text,text,text,jsonb,text)') is null then return null; end if;
  begin
    v_id := app.enqueue_message(p_center, p_channel, p_to, p_template, p_vars, 'notification');
    update app.messages set payload = payload || coalesce(p_route, '{}'::jsonb) where id = v_id;
    select m.status, m.failure_reason into v_status, v_why from app.messages m where m.id = v_id;
    if v_status = 'suppressed' then
      perform app.log_audit(p_center, 'pathshala.notice_failed', 'messages', v_id::text, null,
                            jsonb_build_object('template', p_template, 'channel', p_channel, 'error', v_why), 'Pathshala notice not sent');
    end if;
  exception when others then
    perform app.log_audit(p_center, 'pathshala.notice_failed', 'messages', p_template, null,
                          jsonb_build_object('template', p_template, 'channel', p_channel, 'error', sqlerrm, 'person_id', p_vars ->> 'person_id'),
                          'Pathshala notice not sent');
    return null;
  end;
  return v_id;
end $$;

-- A push to every login of the person and an email to their address, unless they turned that channel of the Pathshala
-- topic off. Returns how many were queued.
create or replace function app._pathshala_notify_person(p_center uuid, p_template text, p_person uuid, p_vars jsonb, p_route jsonb)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; n int := 0; v_email text; v_vars jsonb;
begin
  if p_person is null or not app.module_enabled(p_center, 'pathshala') then return 0; end if;
  v_vars := coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('person_id', p_person::text);
  if not exists (select 1 from app.notification_preferences np where np.person_id = p_person and np.topic_key = 'pathshala'
                   and np.channel = 'push' and not np.enabled) then
    for r in select cu.user_id from app.center_users cu where cu.center_id = p_center and cu.person_id = p_person loop
      if app._pathshala_send(p_center, p_template, 'push', r.user_id::text, v_vars, p_route) is not null then n := n + 1; end if;
    end loop;
  end if;
  if not exists (select 1 from app.notification_preferences np where np.person_id = p_person and np.topic_key = 'pathshala'
                   and np.channel = 'email' and not np.enabled) then
    select nullif(btrim(p.email::text), '') into v_email from app.people p where p.id = p_person and not coalesce(p.is_deceased, false);
    if v_email is not null and app._pathshala_send(p_center, p_template, 'email', v_email, v_vars, p_route) is not null then n := n + 1; end if;
  end if;
  return n;
end $$;

-- The adults of a household (18 or older, or no birth date and not recorded as a child; never a child), except one.
create or replace function app._pathshala_household_adults(p_household uuid, p_except uuid default null) returns setof uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select distinct hm.person_id from app.household_members hm join app.people p on p.id = hm.person_id
   where hm.household_id = p_household and hm.left_at is null and not coalesce(p.is_deceased, false)
     and not app.person_is_minor(hm.person_id) and hm.person_id is distinct from p_except
$$;

create or replace function app._pathshala_notify_household(p_center uuid, p_template text, p_household uuid, p_vars jsonb, p_route jsonb,
                                                           p_except uuid default null)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; n int := 0;
begin
  for r in select * from app._pathshala_household_adults(p_household, p_except) as x(person_id) loop
    n := n + app._pathshala_notify_person(p_center, p_template, r.person_id, p_vars, p_route);
  end loop;
  return n;
end $$;

-- The variables of one learner's notice, and the route a tapped push opens (the learner's Pathshala page).
create or replace function app._pathshala_vars(p_enrollment uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare e app.pathshala_enrollments; t app.pathshala_terms; f app.pathshala_enrollment_fees; v_level text; v_class text; p app.pledges;
        v_amount bigint;
begin
  select * into e from app.pathshala_enrollments where id = p_enrollment;
  select * into t from app.pathshala_terms where id = e.term_id;
  select * into f from app.pathshala_enrollment_fees where enrollment_id = e.id;
  select * into p from app.pledges where id = f.pledge_id;
  select l.name into v_level from app.pathshala_levels l
   where l.id = coalesce((select c.level_id from app.pathshala_classes c where c.id = e.class_id), e.requested_level_id);
  select c.name into v_class from app.pathshala_classes c where c.id = e.class_id;
  v_amount := coalesce(p.amount_cents - p.paid_cents, f.total_cents, 0);
  return jsonb_build_object(
    'learner', coalesce(app.pathshala_first_name(e.student_person_id), ''), 'term', t.name, 'level', coalesce(v_level, 'the level the office chooses'),
    'class', coalesce(v_class, ''), 'schedule', coalesce(app.pathshala_class_schedule(e.class_id), ''),
    'amount', app.pathshala_money(v_amount), 'total', app.pathshala_money(coalesce(f.total_cents, 0)),
    'hold_until', coalesce(app.pathshala_when(e.hold_expires_at, e.center_id), ''),
    'position', coalesce(app.pathshala_waitlist_position(e.id)::text, ''),
    'withdraw_by', coalesce(to_char(app.pathshala_withdrawal_deadline(t.id), 'FMMon FMDD'), ''),
    'pledge_number', coalesce(p.pledge_number, ''), 'due', coalesce(to_char(p.due_on, 'FMMon FMDD, YYYY'), ''),
    'fee_sentence', case when p.id is not null then 'Fee ' || app.pathshala_money(p.amount_cents) || ' (pledge ' || coalesce(p.pledge_number, '')
                                                   || '), due ' || to_char(p.due_on, 'FMMon FMDD') || '.'
                         when f.status = 'no_fee' then 'No fee.'
                         when f.status = 'not_billed_giving_off' then 'The fee is not billed in the app; the office will tell you how to pay.'
                         else '' end,
    'type', 'pathshala', 'deep_link', '/pathshala?person=' || e.student_person_id::text, 'learner_id', e.student_person_id::text,
    'enrollment_id', e.id::text);
end $$;

create or replace function app._pathshala_route(p_vars jsonb) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select jsonb_strip_nulls(jsonb_build_object('type', p_vars -> 'type', 'deep_link', p_vars -> 'deep_link', 'learner_id', p_vars -> 'learner_id'))
$$;

-- One learner's notice to the adults of the household that is billed (except the one who just registered, who gets the
-- summary). Never to a child.
create or replace function app._pathshala_notify_learner(p_enrollment uuid, p_template text, p_except uuid default null) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.pathshala_enrollments; v jsonb;
begin
  select * into e from app.pathshala_enrollments where id = p_enrollment;
  if e.id is null then return 0; end if;
  v := app._pathshala_vars(e.id);
  return app._pathshala_notify_household(e.center_id, p_template, e.household_id, v, app._pathshala_route(v), p_except);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Billing, placing, holding (§2.5–§2.8)
-- ═════════════════════════════════════════════════════════════════════════════
-- Bill one enrollment's locked line: ONE pledge (never twice). $0 gives no_fee; Giving off gives not_billed_giving_off with
-- a note (as membership fees, 0130); a fee assistance request waits for its decision (P8). Returns the pledge id or null.
create or replace function app._pathshala_bill(p_enrollment uuid, p_pay_now boolean) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.pathshala_enrollments; f app.pathshala_enrollment_fees; t app.pathshala_terms; v_level uuid; v_line jsonb;
        v_pledge uuid; v_due date; v_by uuid; v_money jsonb;
begin
  select * into e from app.pathshala_enrollments where id = p_enrollment;
  select * into f from app.pathshala_enrollment_fees where enrollment_id = p_enrollment for update;
  if f.id is null or f.status <> 'quoted' then return f.pledge_id; end if;
  select * into t from app.pathshala_terms where id = e.term_id;
  v_level := coalesce((select c.level_id from app.pathshala_classes c where c.id = e.class_id), e.requested_level_id);
  if v_level is not null and (not f.priced or f.level_id is distinct from v_level) then
    v_line := app._pathshala_price_line(e.id, v_level);
    update app.pathshala_enrollment_fees
       set level_id = v_level, priced = true, base_fee_cents = (v_line ->> 'base_fee_cents')::bigint,
           sibling_discount_cents = (v_line ->> 'sibling_discount_cents')::bigint, cap_reduction_cents = (v_line ->> 'cap_reduction_cents')::bigint,
           late_fee_cents = (v_line ->> 'late_fee_cents')::bigint, assistance_cents = (v_line ->> 'assistance_cents')::bigint,
           total_cents = (v_line ->> 'total_cents')::bigint,
           requotes = requotes || jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(), 'from_level', f.level_id, 'to_level', v_level,
                                                                       'from_total_cents', f.total_cents, 'to_total_cents', (v_line ->> 'total_cents')::bigint,
                                                                       'why', case when f.priced then 'level confirmed by the office' else 'priced when placed' end))
     where id = f.id
    returning * into f;
  end if;
  if not f.priced then return null; end if;
  if f.assistance_requested and f.assistance_approved_at is null then
    update app.pathshala_enrollment_fees set billing_note = 'Waiting for the fee assistance decision before billing (P8).' where id = f.id;
    return null;
  end if;
  if f.total_cents = 0 then
    update app.pathshala_enrollment_fees set status = 'no_fee', billed_at = now(), billing_note = null where id = f.id;
    return null;
  end if;
  if not app.module_enabled(e.center_id, 'giving') then
    update app.pathshala_enrollment_fees
       set status = 'not_billed_giving_off', billing_note = 'Not billed: Pledges & donations is switched off (' || app.pathshala_money(f.total_cents) || ' quoted).'
     where id = f.id;
    return null;
  end if;
  -- A term opened while Pledges & donations was off has no campaign or fund yet: find or create them now (review C6).
  if t.campaign_id is null or t.fund_id is null then
    v_money := app._pathshala_fees_money(t.id, null, false);
    if nullif(v_money ->> 'fund_id', '') is null then
      update app.pathshala_enrollment_fees
         set status = 'not_billed_giving_off',
             billing_note = 'Not billed: there is no fund for the Pathshala fees yet (' || app.pathshala_money(f.total_cents)
                            || ' quoted). Ask the treasurer to add a fund called Pathshala in Setup › Lists.'
       where id = f.id;
      return null;
    end if;
    perform app.set_audit_default_reason('Pathshala fees: the fee fund and campaign were attached to ' || t.name);
    update app.pathshala_terms
       set campaign_id = coalesce(campaign_id, nullif(v_money ->> 'campaign_id', '')::uuid), fund_id = coalesce(fund_id, nullif(v_money ->> 'fund_id', '')::uuid)
     where id = t.id returning * into t;
  end if;
  v_due := case when p_pay_now then app.pathshala_today(e.center_id) else app._pathshala_due_on(e.term_id, e.class_id) end;
  select r.registered_by_person into v_by from app.pathshala_registrations r where r.id = e.registration_id;
  if v_by is null or not exists (select 1 from app.household_members hm where hm.household_id = e.household_id and hm.person_id = v_by and hm.left_at is null) then
    select hm.person_id into v_by from app.household_members hm
     where hm.household_id = e.household_id and hm.left_at is null order by hm.is_primary desc, (hm.role = 'spouse') desc limit 1;
  end if;
  insert into app.pledges (center_id, household_id, pledged_by_person_id, campaign_id, fund_id, source, source_ref_id, amount_cents,
                           status, due_on, created_by)
  values (e.center_id, e.household_id, v_by, t.campaign_id, t.fund_id, 'pathshala_fee', e.id, f.total_cents, 'open', v_due, auth.uid())
  returning id into v_pledge;
  update app.pathshala_enrollment_fees set status = 'billed', pledge_id = v_pledge, billed_at = now(), billing_note = null where id = f.id;
  update app.pathshala_enrollments set fee_pledge_id = v_pledge where id = e.id;
  return v_pledge;
end $$;

-- Place a learner in a class (the hold, if any, ends).
create or replace function app._pathshala_place(p_enrollment uuid, p_class uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  -- The enrollment first (its trigger sees the seat was held), then the hold on the fee line ends.
  update app.pathshala_enrollments
     set status = 'placed', class_id = p_class, placed_at = now(), hold_expires_at = null, hold_reminded_at = null
   where id = p_enrollment;
  update app.pathshala_enrollment_fees set hold_reason = null where enrollment_id = p_enrollment and hold_reason is not null;
end $$;

-- After billing a pay-now seat: when nothing is to be paid (the fee is $0, or Giving is off so nothing is billed in the app)
-- the seat is not held for payment, it is given at once (a held seat with no pledge would only be released by the sweep).
-- A seat waiting for a fee assistance decision stays held. Returns true when the learner was placed.
create or replace function app._pathshala_place_unbilled(p_enrollment uuid) returns boolean
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.pathshala_enrollments; f app.pathshala_enrollment_fees; v_class uuid;
begin
  select * into e from app.pathshala_enrollments where id = p_enrollment;
  select * into f from app.pathshala_enrollment_fees where enrollment_id = p_enrollment;
  if e.id is null or f.id is null or e.status <> 'requested' or coalesce(f.hold_reason, '') not in ('payment', 'office_payment') then return false; end if;
  if f.status not in ('no_fee', 'not_billed_giving_off') then return false; end if;
  v_class := app._pathshala_class_for(e.term_id, e.requested_level_id);
  if v_class is null then return false; end if;
  perform app._pathshala_place(e.id, v_class);
  return true;
end $$;

-- A learner who may now have a seat (a membership hold lifted, a waiver agreed, a child added to the family, the office
-- confirming a level): "treated as registering at that moment" (§2.6). Under the level's lock: a free seat places and
-- bills (pledge mode) or holds for payment (pay now); else the waitlist (when on); else the office decides. Returns the
-- outcome (seat | waitlist | office).
create or replace function app._pathshala_seat_or_wait(p_enrollment uuid, p_waitlisted_at timestamptz default null) returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.pathshala_enrollments; t app.pathshala_terms; l app.pathshala_levels; s record; v_age int; v_child boolean;
        f app.pathshala_enrollment_fees;
begin
  select * into e from app.pathshala_enrollments where id = p_enrollment for update;
  select * into t from app.pathshala_terms where id = e.term_id;
  select * into l from app.pathshala_levels where id = e.requested_level_id;
  select * into f from app.pathshala_enrollment_fees where enrollment_id = e.id;
  update app.pathshala_enrollment_fees set hold_reason = null where enrollment_id = e.id and hold_reason is not null;
  update app.pathshala_enrollments set hold_expires_at = null, hold_reminded_at = null where id = e.id and (hold_expires_at is not null or hold_reminded_at is not null);
  if l.id is null or t.seat_rule = 'office' then return 'office'; end if;
  v_child := coalesce(f.learner_kind, case when app.pathshala_counts_as_child(e.student_person_id, app.pathshala_age_cutoff(t.id)) then 'child' else 'adult' end) = 'child';
  v_age := app.pathshala_age_on((select date_of_birth from app.people where id = e.student_person_id), app.pathshala_age_cutoff(t.id));
  if v_child and app.pathshala_level_band(l.min_age, l.max_age) <> 'adult' and v_age is not null
     and ((l.min_age is not null and v_age < l.min_age) or (l.max_age is not null and v_age > l.max_age)) then
    return 'office';
  end if;
  perform app._pathshala_lock_level(t.id, l.id);
  select * into s from app.pathshala_level_seats(t.id, l.id);
  if s.classes > 0 and (s.free is null or s.free > 0) then
    if t.payment_mode = 'pay_now' and app.module_enabled(t.center_id, 'giving') then   -- Giving off: nothing is paid in the app, never hold
      if f.id is null and t.fees_locked_at is not null then
        perform app._pathshala_ensure_quote(e.id, l.id);
        select * into f from app.pathshala_enrollment_fees where enrollment_id = e.id;
      end if;
      if f.id is null then return 'office'; end if;   -- no fee line to hold the seat on: the office decides
      update app.pathshala_enrollment_fees
         set hold_reason = case when f.assistance_requested and f.assistance_approved_at is null then 'assistance' else 'payment' end
       where id = f.id;
      update app.pathshala_enrollments
         set hold_expires_at = case when f.assistance_requested and f.assistance_approved_at is null then null
                                    else now() + make_interval(hours => t.hold_hours) end
       where id = e.id;
      perform app._pathshala_bill(e.id, true);
      perform app._pathshala_place_unbilled(e.id);   -- $0: nothing to pay, so nothing to hold for
    else
      perform app._pathshala_place(e.id, app._pathshala_class_for(t.id, l.id));
      perform app._pathshala_bill(e.id, false);
    end if;
    return 'seat';
  end if;
  if s.waitlist_on then
    update app.pathshala_enrollments set status = 'waitlisted', waitlisted_at = coalesce(p_waitlisted_at, now()), class_id = null where id = e.id;
    return 'waitlist';
  end if;
  return 'office';
end $$;

-- Serve the waitlist of a level (P19): while a seat is free, the earliest waitlisted learner is placed and billed (pledge
-- mode) or offered the seat, held for payment for the hold window (pay now). Only for terms that are open with their fees
-- locked and seats given automatically; Pathshala on (and, for pay now, Giving on). Returns how many were served.
create or replace function app._pathshala_fill_seats(p_term uuid, p_level uuid) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; s record; e app.pathshala_enrollments; n int := 0;
begin
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null or p_level is null or t.fees_locked_at is null or t.status not in ('registration', 'active') or t.seat_rule <> 'automatic'
     or not app.module_enabled(t.center_id, 'pathshala') then
    return 0;
  end if;
  if t.payment_mode = 'pay_now' and not app.module_enabled(t.center_id, 'giving') then return 0; end if;
  perform app._pathshala_lock_level(t.id, p_level);
  loop
    exit when n >= 100;
    select * into s from app.pathshala_level_seats(t.id, p_level);
    exit when not (s.classes > 0 and (s.free is null or s.free > 0));
    select en.* into e from app.pathshala_enrollments en left join app.pathshala_classes c on c.id = en.class_id
     where en.term_id = t.id and en.status = 'waitlisted' and coalesce(c.level_id, en.requested_level_id) = p_level
       and exists (select 1 from app.pathshala_enrollment_fees f where f.enrollment_id = en.id and f.status = 'quoted')
     order by en.waitlisted_at nulls last, en.registered_at, en.id
     limit 1 for update of en skip locked;
    exit when e.id is null;
    if t.payment_mode = 'pay_now' then
      update app.pathshala_enrollments
         set status = 'requested', class_id = null, requested_level_id = p_level, offered_at = now(),
             hold_expires_at = now() + make_interval(hours => t.hold_hours), hold_reminded_at = null
       where id = e.id;
      update app.pathshala_enrollment_fees set hold_reason = 'payment' where enrollment_id = e.id;
      perform app._pathshala_bill(e.id, true);
      if app._pathshala_place_unbilled(e.id) then
        perform app._pathshala_notify_learner(e.id, 'pathshala_placed');   -- $0: placed at once, no payment to wait for
      else
        perform app._pathshala_notify_learner(e.id, 'pathshala_payment_due');
      end if;
    else
      perform app._pathshala_place(e.id, app._pathshala_class_for(t.id, p_level));
      perform app._pathshala_bill(e.id, false);
      perform app._pathshala_notify_learner(e.id, 'pathshala_placed');
    end if;
    n := n + 1;
    e := null;
  end loop;
  return n;
end $$;

-- End a hold that was not paid (§2.7): the fee pledges are cancelled, anything paid toward them is released into credit
-- (a row for the treasurer), the learner is withdrawn with the reason and the family told. The freed seat goes to the
-- waitlist (the enrollment trigger). Returns {credit_cents}.
create or replace function app._pathshala_release_hold(p_enrollment uuid, p_reason text, p_notify boolean default true) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.pathshala_enrollments; f app.pathshala_enrollment_fees; p app.pledges; v_released bigint; v_credit bigint := 0;
begin
  select * into e from app.pathshala_enrollments where id = p_enrollment for update;
  if e.id is null or e.status <> 'requested' or coalesce(app._pathshala_hold(e.id), '') not in ('payment', 'office_payment', 'assistance') then
    return jsonb_build_object('credit_cents', 0, 'released', false);
  end if;
  if p_notify then perform app._pathshala_notify_learner(e.id, 'pathshala_hold_released'); end if;
  for p in select * from app.pledges pl where pl.source = 'pathshala_fee' and pl.source_ref_id = e.id
                                         and pl.status in ('open', 'partially_paid') for update loop
    select coalesce(sum(amount_cents), 0) into v_released from app.payment_allocations where pledge_id = p.id;
    delete from app.payment_allocations where pledge_id = p.id;
    update app.pledges set status = 'cancelled', closed_at = now(), paid_cents = 0 where id = p.id;
    if v_released > 0 then
      insert into app.rsvp_credit_releases (center_id, household_id, enrollment_id, pledge_id, released_cents, created_by, kind)
      values (e.center_id, e.household_id, e.id, p.id, v_released, auth.uid(), 'pathshala_hold_released');
      v_credit := v_credit + v_released;
    end if;
  end loop;
  -- The enrollment first (its trigger sees the seat was held and serves the waitlist), then the fee line.
  update app.pathshala_enrollments
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = auth.uid(), hold_expires_at = null, hold_reminded_at = null
   where id = e.id;
  update app.pathshala_enrollment_fees
     set status = 'cancelled', billing_note = left(p_reason, 500), withdrawal_reason = left(p_reason, 500), hold_reason = null
   where enrollment_id = e.id;
  return jsonb_build_object('credit_cents', v_credit, 'released', true);
end $$;

-- Is this hold still live (§2.7)? Its window runs; or a payment page for one of the registration's held pledges is open at
-- the provider (created or pending, under 24 hours old); or, for an office hold, a member's Zelle report naming one of
-- them waits for the treasurer. An assistance hold waits for the decision.
create or replace function app.pathshala_hold_live(p_enrollment uuid) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare e app.pathshala_enrollments; v_pledges uuid[]; v_hold text;
begin
  select * into e from app.pathshala_enrollments where id = p_enrollment;
  if e.id is null or e.status <> 'requested' then return false; end if;
  v_hold := app._pathshala_hold(e.id);
  if v_hold = 'assistance' then return true; end if;
  if coalesce(v_hold, '') not in ('payment', 'office_payment') then return false; end if;
  if e.hold_expires_at is null or e.hold_expires_at > now() then return true; end if;
  select coalesce(array_agg(f.pledge_id) filter (where f.pledge_id is not null), '{}') into v_pledges
    from app.pathshala_enrollments o join app.pathshala_enrollment_fees f on f.enrollment_id = o.id
   where (o.id = e.id or (e.registration_id is not null and o.registration_id = e.registration_id))
     and o.status = 'requested' and f.hold_reason in ('payment', 'office_payment');
  if cardinality(v_pledges) = 0 then return false; end if;
  if exists (select 1 from app.payment_checkouts k where k.center_id = e.center_id and k.context = 'pathshala'
               and k.status in ('created', 'pending') and k.created_at > now() - interval '24 hours' and k.pledge_ids && v_pledges) then
    return true;
  end if;
  if v_hold = 'office_payment' and exists (select 1 from app.payment_reports r where r.household_id = e.household_id
               and r.status = 'reported' and r.pledge_ids && v_pledges) then
    return true;
  end if;
  return false;
end $$;

-- Where a registration stands, in one sentence (messages and the summary).
create or replace function app._pathshala_state_sentence(p_enrollment uuid) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare e app.pathshala_enrollments; v jsonb; v_hold text;
begin
  select * into e from app.pathshala_enrollments where id = p_enrollment;
  if e.id is null then return null; end if;
  v := app._pathshala_vars(e.id);
  v_hold := app._pathshala_hold(e.id);
  return case
    when e.status in ('placed', 'active') then 'registered for ' || (v ->> 'level')
                                               || case when (v ->> 'schedule') <> '' then ' (' || (v ->> 'schedule') || ')' else '' end
    when e.status = 'waitlisted' then 'on the waitlist for ' || (v ->> 'level') || ' (number ' || (v ->> 'position') || '), no charge unless a seat opens'
    when v_hold in ('payment', 'office_payment') then 'seat in ' || (v ->> 'level') || ' held until ' || (v ->> 'hold_until')
                                                             || ' for the fee of ' || (v ->> 'amount')
    when v_hold = 'assistance' then 'seat in ' || (v ->> 'level') || ' held while the fee assistance request is decided'
    when v_hold = 'membership' then 'waiting for the family''s membership, nothing charged yet'
    when v_hold = 'waiver' then 'waiting for ' || (v ->> 'learner') || ' to agree to the waiver in their own app'
    when e.status = 'requested' then 'the office will confirm the level and the class, charged then'
    when e.status = 'withdrawn' then 'withdrawn'
    else e.status end;
end $$;

-- A held learner may go ahead now (a membership hold lifted, a waiver agreed, the office releasing a hold): "treated as
-- registering at that moment". Returns the outcome; tells the household.
create or replace function app._pathshala_lift(p_enrollment uuid, p_template text default 'pathshala_hold_lifted') returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_outcome text; v jsonb; e app.pathshala_enrollments;
begin
  v_outcome := app._pathshala_seat_or_wait(p_enrollment);
  select * into e from app.pathshala_enrollments where id = p_enrollment;
  v := app._pathshala_vars(p_enrollment) || jsonb_build_object('state', coalesce(app._pathshala_state_sentence(p_enrollment), ''));
  if p_template is not null then
    perform app._pathshala_notify_household(e.center_id, p_template, e.household_id, v, app._pathshala_route(v));
  end if;
  return v_outcome;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- The paid-fee hook (§2.8): a fee pledge paid in full, through any channel, completes a held registration
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function app._pathshala_fee_paid(p_pledge uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.pledges; e app.pathshala_enrollments; f app.pathshala_enrollment_fees; o record; v_left int; v_class uuid; v_own boolean;
begin
  select * into p from app.pledges where id = p_pledge;
  if p.id is null or p.source <> 'pathshala_fee' or p.source_ref_id is null then return; end if;
  select * into e from app.pathshala_enrollments where id = p.source_ref_id for update;
  if e.id is null then return; end if;
  select * into f from app.pathshala_enrollment_fees where enrollment_id = e.id;
  if f.id is null then return; end if;
  -- Only the fee line's OWN pledge, still billed, confirms the seat. A pledge a member made up themselves (even one
  -- that names this enrollment) pays nothing toward the seat.
  v_own := (f.pledge_id = p.id and f.status = 'billed');
  if v_own then
    update app.pathshala_enrollment_fees set status = 'paid', paid_at = now() where id = f.id;
  end if;
  if v_own and e.status = 'requested' and f.hold_reason in ('payment', 'office_payment') then
    perform app.set_audit_default_reason('Pathshala fee paid: ' || coalesce(app.pathshala_first_name(e.student_person_id), 'the learner')
                                         || '''s held seat is confirmed');
    perform app._pathshala_lock_level(e.term_id, e.requested_level_id);
    v_class := app._pathshala_class_for(e.term_id, e.requested_level_id);
    if v_class is null then
      -- The level lost its classes meanwhile: the seat stays held (paid) for the office to place by hand.
      perform app.log_audit(e.center_id, 'pathshala.place_failed', 'pathshala_enrollments', e.id::text, null,
                            jsonb_build_object('pledge_id', p.id, 'level_id', e.requested_level_id), 'The fee is paid but the level has no class to place the learner in');
      return;
    end if;
    perform app._pathshala_place(e.id, v_class);
    perform app._pathshala_notify_learner(e.id, 'pathshala_registered');
    -- The registration's $0 lines are confirmed with its last paid line (§2.7).
    if e.registration_id is not null then
      select count(*) into v_left
        from app.pathshala_enrollments o2 join app.pathshala_enrollment_fees f2 on f2.enrollment_id = o2.id
       where o2.registration_id = e.registration_id and o2.status = 'requested' and f2.hold_reason in ('payment', 'office_payment')
         and f2.status = 'billed';
      if v_left = 0 then
        for o in select o2.id, o2.term_id, o2.requested_level_id
                   from app.pathshala_enrollments o2 join app.pathshala_enrollment_fees f2 on f2.enrollment_id = o2.id
                  where o2.registration_id = e.registration_id and o2.status = 'requested' and f2.hold_reason in ('payment', 'office_payment')
                    and f2.status = 'no_fee'
                  order by o2.registered_at, o2.id loop
          perform app._pathshala_lock_level(o.term_id, o.requested_level_id);
          perform app._pathshala_place(o.id, app._pathshala_class_for(o.term_id, o.requested_level_id));
          perform app._pathshala_notify_learner(o.id, 'pathshala_registered');
        end loop;
      end if;
    end if;
  end if;
end $$;

-- The hook runs inside whatever recorded the payment (a webhook, the treasurer's form, a bank match): it must never stop
-- that payment from being recorded. A failure is written to the audit log, and the sweep places the paid learner on its
-- next run (it places, never releases, a held seat whose fee pledge is paid).
create or replace function app.pathshala_fee_paid_trigger() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.source = 'pathshala_fee' then
    begin
      perform app._pathshala_fee_paid(new.id);
    exception when others then
      perform app.log_audit(new.center_id, 'pathshala.fee_paid_failed', 'pledges', new.id::text, null,
                            jsonb_build_object('error', sqlerrm), 'The paid Pathshala fee could not place the learner at once; the sweep retries');
    end;
  end if;
  return null;
end $$;
drop trigger if exists pathshala_fee_paid on app.pledges;
create trigger pathshala_fee_paid after update of status on app.pledges
  for each row execute function app.pathshala_fee_paid_trigger();

-- A fee pledge the treasurer cancels or writes off in Giving ends its fee line too: the office may then withdraw the learner
-- (the enrollments guard refuses a withdrawal while the fee is billed or paid). Never stops the treasurer's action.
create or replace function app.pathshala_fee_pledge_closed_trigger() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.source = 'pathshala_fee' and new.status in ('cancelled', 'written_off') and old.status is distinct from new.status then
    begin
      update app.pathshala_enrollment_fees
         set status = 'cancelled', billing_note = left('The fee pledge was ' || replace(new.status::text, '_', ' ') || ' in Giving.', 500)
       where pledge_id = new.id and status = 'billed';
    exception when others then
      perform app.log_audit(new.center_id, 'pathshala.fee_line_close_failed', 'pledges', new.id::text, null,
                            jsonb_build_object('error', sqlerrm), 'The Pathshala fee line of a closed fee pledge could not be ended');
    end;
  end if;
  return null;
end $$;
drop trigger if exists pathshala_fee_pledge_closed on app.pledges;
create trigger pathshala_fee_pledge_closed after update of status on app.pledges
  for each row execute function app.pathshala_fee_pledge_closed_trigger();

-- ACCESS: a member could insert a pledge of any source with any source_ref_id (0010). A fee pledge is made only by the
-- database (a function), never by the family, and only an RSVP commitment (the mobile app writes it with the RSVP's id)
-- names another record. Staff and the functions are not touched: they do not go through this policy.
drop policy if exists pledges_household_insert on app.pledges;
create policy pledges_household_insert on app.pledges for insert to authenticated
  with check (app.adult_of_household(center_id, household_id)
              and status = 'open' and paid_cents = 0
              and source in ('rsvp_commitment','sponsorship','pujan','labh','construction','general','membership_fee')
              and (source_ref_id is null or source = 'rsvp_commitment'));

-- Money that arrives after a release (§2.7): the checkout named the cancelled fee pledges, so nothing (or not all) was
-- allocated; the rest is household credit. One credit row (kind pathshala_late_payment) puts it in front of the treasurer.
create or replace function app.pathshala_late_payment_trigger() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_left bigint; p app.pledges;
begin
  if new.status <> 'paid' or old.status = 'paid' or new.context <> 'pathshala' or new.payment_id is null then return null; end if;
  select pay.amount_cents - pay.refunded_cents - coalesce((select sum(a.amount_cents) from app.payment_allocations a where a.payment_id = pay.id), 0)
    into v_left from app.payments pay where pay.id = new.payment_id;
  if coalesce(v_left, 0) <= 0 then return null; end if;
  select pl.* into p from app.pledges pl
   where pl.id = any (new.pledge_ids) and pl.source = 'pathshala_fee' and pl.status = 'cancelled'
     and exists (select 1 from app.pathshala_enrollments en where en.id = pl.source_ref_id)
   order by pl.pledged_at limit 1;
  if p.id is null then return null; end if;
  insert into app.rsvp_credit_releases (center_id, household_id, enrollment_id, pledge_id, released_cents, created_by, kind)
  values (new.center_id, p.household_id, p.source_ref_id, p.id, v_left, null, 'pathshala_late_payment');
  return null;
exception when others then
  -- Never stop the payment from being recorded: the money is household credit either way.
  perform app.log_audit(new.center_id, 'pathshala.late_payment_failed', 'payment_checkouts', new.id::text, null,
                        jsonb_build_object('error', sqlerrm), 'A payment after a released seat could not be put in the credit queue');
  return null;
end $$;
drop trigger if exists pathshala_late_payment on app.payment_checkouts;
create trigger pathshala_late_payment after update of status on app.payment_checkouts
  for each row execute function app.pathshala_late_payment_trigger();

-- ═════════════════════════════════════════════════════════════════════════════
-- Seats that free go to the waitlist (P19)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function app._pathshala_fill_seats_safely(p_term uuid, p_level uuid) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  return app._pathshala_fill_seats(p_term, p_level);
exception when others then
  perform app.log_audit((select center_id from app.pathshala_terms where id = p_term), 'pathshala.waitlist_failed', 'pathshala_levels',
                        p_level::text, null, jsonb_build_object('term_id', p_term, 'error', sqlerrm), 'The waitlist could not be served automatically');
  return 0;
end $$;

create or replace function app.pathshala_classes_seats_trigger() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if tg_op = 'INSERT' or new.capacity is distinct from old.capacity or new.level_id is distinct from old.level_id
     or new.waitlist_enabled is distinct from old.waitlist_enabled then
    perform app._pathshala_fill_seats_safely(new.term_id, new.level_id);
  end if;
  return null;
end $$;
drop trigger if exists pathshala_classes_seats on app.pathshala_classes;
create trigger pathshala_classes_seats after insert or update of capacity, level_id, waitlist_enabled on app.pathshala_classes
  for each row execute function app.pathshala_classes_seats_trigger();

create or replace function app.pathshala_enrollments_seat_freed() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_old_level uuid; v_new_level uuid; v_was boolean; v_is boolean; v_hold boolean;
begin
  -- The fee line's hold is still set while the enrollment's status changes (the functions change the enrollment first).
  v_hold := coalesce(app._pathshala_hold(new.id), '') in ('payment', 'office_payment', 'assistance');
  v_was := old.status in ('placed', 'active') or (old.status = 'requested' and v_hold);
  v_is := new.status in ('placed', 'active') or (new.status = 'requested' and v_hold);
  if not v_was then return null; end if;
  v_old_level := coalesce((select c.level_id from app.pathshala_classes c where c.id = old.class_id), old.requested_level_id);
  v_new_level := coalesce((select c.level_id from app.pathshala_classes c where c.id = new.class_id), new.requested_level_id);
  if not v_is or v_old_level is distinct from v_new_level then
    perform app._pathshala_fill_seats_safely(old.term_id, v_old_level);
  end if;
  return null;
end $$;
drop trigger if exists pathshala_enrollments_seat_freed on app.pathshala_enrollments;
create trigger pathshala_enrollments_seat_freed after update of status, class_id on app.pathshala_enrollments
  for each row execute function app.pathshala_enrollments_seat_freed();

-- ═════════════════════════════════════════════════════════════════════════════
-- Registering (§2.6, §2.11, §2.17)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function app._pathshala_outcome_words(p_outcome text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p_outcome when 'seat' then 'a seat' when 'waitlist' then 'the waitlist' when 'membership_hold' then 'waiting for membership'
                        when 'office' then 'waiting for the office' when 'pending_child' then 'waiting to be added to the family'
                        when 'waiver_hold' then 'waiting for the waiver' else coalesce(p_outcome, 'something else') end
$$;

-- The sentence when an outcome changed since the family looked (hint "review_again": the app goes back to the review).
create or replace function app._pathshala_changed_outcome(p_line jsonb, p_expected text) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare v_name text := coalesce(p_line ->> 'first_name', 'This learner'); v_level text := coalesce(p_line ->> 'level', p_line ->> 'track', 'this level');
        v_now text := p_line ->> 'outcome';
begin
  if p_expected = 'seat' and v_now = 'waitlist' then
    return 'The last seat in ' || v_level || ' was just taken. ' || v_name || ' can join the waitlist instead: please review again.';
  end if;
  if p_expected = 'waitlist' and v_now = 'seat' then
    return 'A seat opened in ' || v_level || ' since you looked: please review again.';
  end if;
  return v_name || '''s registration would now be ' || app._pathshala_outcome_words(v_now) || ' instead of '
         || app._pathshala_outcome_words(p_expected) || ': please review again.';
end $$;

-- p_learners: [{person_id, track_id, level_id | null, note, assistance_requested}] or
--             [{new_child: {first_name, last_name, date_of_birth, relationship}, track_id, level_id, note}].
-- p_expected_total_cents: the preview's total_cents (null: not checked). p_expected_outcomes: the preview's lines (objects
-- with person_id, track_id and outcome) or a list of outcomes in the order of p_learners (null: not checked).
-- p_waiver_document: the waiver the adult agreed to (the options' term.waiver.document_id; required when one is
-- published). p_client_key: any 8–100 character key the app keeps for this submission.
create or replace function app.register_pathshala_children(p_term uuid, p_household uuid, p_learners jsonb,
                                                           p_expected_total_cents bigint default null, p_expected_outcomes jsonb default null,
                                                           p_waiver_document uuid default null, p_client_key text default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; h app.households; r app.pathshala_registrations; v_channel text; v_key text; v_hash text; v_plan jsonb;
        v_levels uuid[]; v_level uuid; v_waiver uuid; v_me uuid; x jsonb; v_exp jsonb; v_exp_outcome text; v_actual jsonb; i int;
        v_reg uuid; v_enr uuid; v_pledge uuid; v_consent uuid; v_out jsonb := '[]'::jsonb; v_pending jsonb := '[]'::jsonb;
        v_pay jsonb := null; v_due bigint := 0; v_pay_ids uuid[] := '{}'; v_names text[] := '{}'; v_hold_until timestamptz;
        v_cr uuid; v_pr uuid; v_class uuid; v_status text; v_hold text; v_expires timestamptz; v_sugg jsonb; p app.pledges;
        v_result jsonb; v_tz text; v_summary text[] := '{}'; v_person uuid; v_track uuid; v_reuse uuid; v_outcome text;
        v_pay_now boolean; v_assist boolean; v_line jsonb; v_n int; v_mode text; v_tmpl text; v_new jsonb; v_dob date; y jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then raise exception 'That term was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(t.center_id, 'pathshala');
  select * into h from app.households where id = p_household;
  if h.id is null or h.center_id <> t.center_id then raise exception 'That family was not found in this community.' using errcode = 'P0002'; end if;
  v_channel := app._pathshala_registrant(t.center_id, h.id);
  select coalesce(nullif(c.time_zone, ''), 'America/Chicago') into v_tz from app.centers c where c.id = t.center_id;

  -- The same request twice (a retry, a double tap) gives the same answer; other details under the same key are refused.
  v_key := nullif(btrim(p_client_key), '');
  if v_key is not null then
    if char_length(v_key) not between 8 and 100 then raise exception 'The request key must be 8 to 100 characters.' using errcode = '22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended('app.pathshala_register:' || t.center_id::text || ':' || v_key, 0));
    v_hash := md5(coalesce(p_term::text, '') || '|' || coalesce(p_household::text, '') || '|' || coalesce(p_learners::text, '')
                  || '|' || coalesce(p_waiver_document::text, ''));
    select * into r from app.pathshala_registrations where center_id = t.center_id and client_key = v_key;
    if r.id is not null then
      if r.request_hash is distinct from v_hash then
        raise exception 'This registration was already sent with other details. Start again to register.' using errcode = '22023';
      end if;
      return r.result || jsonb_build_object('replayed', true);
    end if;
  end if;

  -- One registration at a time per family (the ranks and the cap build on what is registered), then the seat lock of every
  -- chosen level, in a fixed order, before anything is counted (§2.5).
  perform 1 from app.households where id = h.id for update;
  select coalesce(array_agg(distinct s.lv order by s.lv), '{}') into v_levels
    from (select (x2 ->> 'level_id')::uuid as lv
            from jsonb_array_elements(case when jsonb_typeof(p_learners) = 'array' then p_learners else '[]'::jsonb end) x2
           where jsonb_typeof(x2) = 'object'
             and coalesce(x2 ->> 'level_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') s;
  foreach v_level in array v_levels loop perform app._pathshala_lock_level(t.id, v_level); end loop;

  v_plan := app._pathshala_plan(t.id, h.id, p_learners, v_channel);

  if p_expected_total_cents is not null and p_expected_total_cents <> (v_plan ->> 'total_cents')::bigint then
    raise exception 'The fee changed since you looked; please review the new total (%).', app.pathshala_money((v_plan ->> 'total_cents')::bigint)
      using errcode = '22023', hint = 'review_again';
  end if;
  if p_expected_outcomes is not null and jsonb_typeof(p_expected_outcomes) <> 'null' then
    if jsonb_typeof(p_expected_outcomes) <> 'array' then
      raise exception 'Send the outcomes you were shown as a list.' using errcode = '22023';
    end if;
    i := 0;
    for v_exp in select a.e2 from jsonb_array_elements(p_expected_outcomes) with ordinality as a(e2, o) order by a.o loop
      i := i + 1;
      v_exp_outcome := case jsonb_typeof(v_exp) when 'string' then v_exp #>> '{}' when 'object' then v_exp ->> 'outcome' end;
      continue when v_exp_outcome is null;
      v_actual := null;
      if jsonb_typeof(v_exp) = 'object' and nullif(v_exp ->> 'person_id', '') is not null then
        select x2 into v_actual from jsonb_array_elements(v_plan -> 'lines') x2
         where x2 ->> 'person_id' = v_exp ->> 'person_id' and (nullif(v_exp ->> 'track_id', '') is null or x2 ->> 'track_id' = v_exp ->> 'track_id')
         limit 1;
      end if;
      if v_actual is null then v_actual := v_plan -> 'lines' -> (i - 1); end if;
      continue when v_actual is null;
      if (v_actual ->> 'outcome') is distinct from v_exp_outcome then
        raise exception '%', app._pathshala_changed_outcome(v_actual, v_exp_outcome) using errcode = '22023', hint = 'review_again';
      end if;
    end loop;
  end if;

  -- The waiver (P14): the published one, agreed for the children and for the registering adult.
  v_waiver := app.pathshala_current_waiver(t.center_id);
  if v_waiver is not null and p_waiver_document is distinct from v_waiver then
    raise exception '%', case when p_waiver_document is null then 'Agree to the Pathshala waiver to register.'
                              else 'The Pathshala waiver was updated: read the new version and agree to it to register.' end
      using errcode = '22023';
  end if;
  if v_channel = 'office' and exists (select 1 from jsonb_array_elements(v_plan -> 'lines') x2 where x2 ->> 'outcome' = 'pending_child') then
    raise exception 'Add the new child to the family in People first, then register them.' using errcode = '22023';
  end if;
  v_me := app.my_person_id(t.center_id);
  v_pay_now := t.payment_mode = 'pay_now';
  v_mode := case when v_pay_now then 'pay now' else 'pledge mode' end;
  v_n := jsonb_array_length(v_plan -> 'lines');
  perform app.set_audit_context(left(case when v_channel = 'office' then 'The Pathshala office registered ' else h.display_name || ' registered ' end
                                     || v_n || case when v_n = 1 then ' learner' else ' learners' end || ' for Pathshala ' || t.name
                                     || ', ' || v_mode || ', ' || app.pathshala_money((v_plan ->> 'total_cents')::bigint), 500));
  insert into app.pathshala_registrations (center_id, term_id, household_id, registered_by, registered_by_person, channel, payment_mode,
                                           client_key, request_hash, total_cents)
  values (t.center_id, t.id, h.id, auth.uid(), v_me, case when v_channel = 'office' then 'office' else 'app' end, t.payment_mode,
          v_key, v_hash, (v_plan ->> 'total_cents')::bigint)
  returning id into v_reg;

  for x in select a.x2 from jsonb_array_elements(v_plan -> 'lines') with ordinality as a(x2, o) order by a.o loop
    v_person := nullif(x ->> 'person_id', '')::uuid;
    v_track := (x ->> 'track_id')::uuid;
    v_level := nullif(x ->> 'level_id', '')::uuid;
    v_outcome := x ->> 'outcome';
    v_assist := coalesce((x ->> 'assistance_requested')::boolean, false);
    v_line := x - 'reuse_enrollment_id' - 'new_child' - 'note' - 'assistance_requested';

    if v_outcome = 'pending_child' then
      v_dob := app._pathshala_date(x -> 'new_child', 'date_of_birth', 'The date of birth');
      v_cr := app.request_add_family_member(h.id, btrim(x -> 'new_child' ->> 'first_name'), btrim(x -> 'new_child' ->> 'last_name'),
                                            nullif(btrim(x -> 'new_child' ->> 'relationship'), ''), v_dob);
      insert into app.pathshala_pending_registrations (center_id, term_id, household_id, registration_id, change_request_id, first_name, last_name,
                                                       date_of_birth, relationship, track_id, requested_level_id, note, quote, registered_at, registered_by)
      values (t.center_id, t.id, h.id, v_reg, v_cr, btrim(x -> 'new_child' ->> 'first_name'), btrim(x -> 'new_child' ->> 'last_name'),
              v_dob, nullif(btrim(x -> 'new_child' ->> 'relationship'), ''), v_track, v_level, nullif(btrim(x ->> 'note'), ''),
              (v_line - 'outcome' - 'first_name' - 'track' - 'level') || jsonb_build_object('rule_snapshot', v_plan -> 'rule_snapshot',
                                                                                           'assistance_requested', v_assist),
              now(), auth.uid())
      returning id into v_pr;
      v_pending := v_pending || jsonb_build_array(jsonb_build_object('pending_registration_id', v_pr, 'change_request_id', v_cr,
                     'first_name', btrim(x -> 'new_child' ->> 'first_name'), 'last_name', btrim(x -> 'new_child' ->> 'last_name'),
                     'track_id', v_track, 'level_id', v_level));
      v_out := v_out || jsonb_build_array(v_line || jsonb_build_object('enrollment_id', null, 'pledge', null, 'pending_registration_id', v_pr));
      v_summary := v_summary || ((x ->> 'first_name') || ': waiting for the office to add ' || (x ->> 'first_name') || ' to your family');
      continue;
    end if;

    v_reuse := nullif(x ->> 'reuse_enrollment_id', '')::uuid;
    v_sugg := null;
    select s2 into v_sugg from jsonb_array_elements(app.pathshala_suggestions(t.id, v_person)) s2 where s2 ->> 'track_id' = v_track::text limit 1;
    v_class := null; v_hold := null; v_expires := null;
    v_status := case v_outcome when 'seat' then case when v_pay_now then 'requested' else 'placed' end
                               when 'waitlist' then 'waitlisted' else 'requested' end;
    if v_outcome = 'seat' and not v_pay_now then v_class := app._pathshala_class_for(t.id, v_level); end if;
    if v_outcome = 'seat' and v_pay_now then
      v_hold := case when v_assist then 'assistance' when v_channel = 'office' then 'office_payment' else 'payment' end;
      v_expires := case v_hold when 'payment' then now() + make_interval(hours => t.hold_hours)
                               when 'office_payment' then now() + make_interval(days => t.office_hold_days) end;
    elsif v_outcome = 'membership_hold' then v_hold := 'membership';
    elsif v_outcome = 'waiver_hold' then v_hold := 'waiver';
    end if;
    if v_reuse is null then
      insert into app.pathshala_enrollments (center_id, term_id, student_person_id, household_id, track_id, requested_level_id, class_id, status,
                                             registration_id, registered_by, registered_at, placed_at, notes, hold_expires_at,
                                             waitlisted_at, suggested_level_id, suggestion_reason, channel)
      values (t.center_id, t.id, v_person, h.id, v_track, v_level, v_class, v_status, v_reg, auth.uid(), now(),
              case when v_status = 'placed' then now() end, nullif(btrim(x ->> 'note'), ''), v_expires,
              case when v_status = 'waitlisted' then now() end, (v_sugg ->> 'level_id')::uuid, v_sugg ->> 'reason',
              case when v_channel = 'office' then 'office' else 'app' end)
      returning id into v_enr;
    else
      update app.pathshala_enrollments
         set household_id = h.id, track_id = v_track, requested_level_id = v_level, class_id = v_class, status = v_status,
             registration_id = v_reg, registered_by = auth.uid(), registered_at = now(),
             placed_at = case when v_status = 'placed' then now() end, notes = coalesce(nullif(btrim(x ->> 'note'), ''), notes),
             hold_expires_at = v_expires, hold_reminded_at = null, offered_at = null,
             waitlisted_at = case when v_status = 'waitlisted' then now() end, fee_pledge_id = null,
             suggested_level_id = (v_sugg ->> 'level_id')::uuid, suggestion_reason = v_sugg ->> 'reason',
             channel = case when v_channel = 'office' then 'office' else 'app' end,
             withdrawn_at = null, withdrawn_by = null
       where id = v_reuse;
      v_enr := v_reuse;
    end if;

    -- The locked line. A re-registration replaces an earlier, cancelled or waiting line; the earlier one is kept in requotes.
    insert into app.pathshala_enrollment_fees (center_id, enrollment_id, registration_id, term_id, household_id, level_id, learner_kind,
                                               family_rank, base_fee_cents, sibling_discount_cents, cap_reduction_cents, late_fee_cents,
                                               assistance_cents, total_cents, priced, rule_snapshot, quoted_at, status, assistance_requested, hold_reason)
    values (t.center_id, v_enr, v_reg, t.id, h.id, v_level, x ->> 'learner_kind', nullif(x ->> 'family_rank', '')::int,
            (x ->> 'base_fee_cents')::bigint, (x ->> 'sibling_discount_cents')::bigint, (x ->> 'cap_reduction_cents')::bigint,
            (x ->> 'late_fee_cents')::bigint, (x ->> 'assistance_cents')::bigint, (x ->> 'total_cents')::bigint,
            coalesce((x ->> 'priced')::boolean, true), v_plan -> 'rule_snapshot', now(), 'quoted', v_assist, v_hold)
    on conflict (enrollment_id) do update
       set registration_id = excluded.registration_id, household_id = excluded.household_id, level_id = excluded.level_id,
           learner_kind = excluded.learner_kind, family_rank = excluded.family_rank, base_fee_cents = excluded.base_fee_cents,
           sibling_discount_cents = excluded.sibling_discount_cents, cap_reduction_cents = excluded.cap_reduction_cents,
           late_fee_cents = excluded.late_fee_cents, assistance_cents = excluded.assistance_cents, total_cents = excluded.total_cents,
           priced = excluded.priced, rule_snapshot = excluded.rule_snapshot, quoted_at = excluded.quoted_at, status = 'quoted',
           pledge_id = null, billed_at = null, paid_at = null, billing_note = null, assistance_requested = excluded.assistance_requested,
           hold_reason = excluded.hold_reason, withdrawal_reason = null,
           requotes = app.pathshala_enrollment_fees.requotes || jsonb_build_array(jsonb_build_object(
             'at', now(), 'by', auth.uid(), 'why', 'registered again', 'from_status', app.pathshala_enrollment_fees.status,
             'from_total_cents', app.pathshala_enrollment_fees.total_cents, 'from_pledge_id', app.pathshala_enrollment_fees.pledge_id));

    -- The waiver consent, once per learner (P14): the registering adult agrees for the children and for themselves; the
    -- office records the family's agreement on paper.
    if v_waiver is not null and v_outcome <> 'waiver_hold' then
      v_consent := app.pathshala_waiver_consent(v_person, v_waiver);
      if v_consent is null then
        insert into app.consents (center_id, person_id, given_by_user, kind, legal_document_id, granted, source)
        values (t.center_id, v_person, auth.uid(), 'pathshala_waiver', v_waiver, true, case when v_channel = 'office' then 'admin' else 'app' end)
        returning id into v_consent;
      end if;
      update app.pathshala_enrollments set waiver_consent_id = v_consent where id = v_enr;
    end if;

    v_pledge := null;
    if v_outcome = 'seat' then v_pledge := app._pathshala_bill(v_enr, v_pay_now); end if;
    p := null;
    select * into p from app.pledges where id = v_pledge;
    v_out := v_out || jsonb_build_array(v_line || jsonb_build_object(
               'enrollment_id', v_enr,
               'pledge', case when p.id is null then null else jsonb_build_object('id', p.id, 'number', p.pledge_number, 'due_on', p.due_on,
                                                                                  'amount_cents', p.amount_cents) end));
    if v_pay_now and v_outcome = 'seat' and p.id is not null then
      v_pay_ids := v_pay_ids || p.id;
      v_due := v_due + p.amount_cents;
    end if;
    if v_outcome = 'seat' and not ((x ->> 'first_name') = any (v_names)) then v_names := v_names || (x ->> 'first_name'); end if;
    v_summary := v_summary || ((x ->> 'first_name') || ': ' || coalesce(app._pathshala_state_sentence(v_enr), v_outcome));
  end loop;

  if v_pay_now then
    select min(e.hold_expires_at) into v_hold_until from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
     where e.registration_id = v_reg and e.status = 'requested' and f.hold_reason in ('payment', 'office_payment');
    -- Nothing to pay at all: the family's $0 seats are confirmed at once.
    if cardinality(v_pay_ids) = 0 then
      for v_enr in select e.id from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
                    where e.registration_id = v_reg and e.status = 'requested' and f.hold_reason in ('payment', 'office_payment')
                      and f.status = 'no_fee' loop
        perform app._pathshala_place(v_enr, app._pathshala_class_for(t.id, (select requested_level_id from app.pathshala_enrollments where id = v_enr)));
      end loop;
      v_hold_until := null;
    end if;
    v_pay := jsonb_build_object('amount_cents', v_due, 'pledge_ids', to_jsonb(v_pay_ids), 'for_label', app.pathshala_fee_label(t.name, v_names),
                                'hold_until', app.pathshala_iso(v_hold_until, v_tz), 'office_payment_allowed', t.office_payment_allowed);
  end if;

  v_result := jsonb_build_object('registration_id', v_reg, 'lines', v_out,
                                 'children_total_cents', v_plan -> 'children_total_cents', 'adults_total_cents', v_plan -> 'adults_total_cents',
                                 'total_cents', v_plan -> 'total_cents',
                                 'due_now_cents', coalesce((select sum((y2 -> 'pledge' ->> 'amount_cents')::bigint) from jsonb_array_elements(v_out) y2
                                                             where jsonb_typeof(y2 -> 'pledge') = 'object'), 0),
                                 'pay', v_pay, 'pending', v_pending, 'late', v_plan -> 'late', 'payment_mode', t.payment_mode);
  update app.pathshala_registrations set result = v_result where id = v_reg;

  -- Messages: the summary to the registering adult (an office registration: to the family's adults), and each learner's
  -- news to the household's other adults.
  v_new := jsonb_build_object('term', t.name, 'summary', array_to_string(v_summary, '; '), 'total', app.pathshala_money((v_plan ->> 'total_cents')::bigint),
                              'next_steps', case when v_pay_now and v_due > 0
                                                   then 'Pay ' || app.pathshala_money(v_due) || ' by ' || coalesce(app.pathshala_when(v_hold_until, t.center_id), 'the time shown')
                                                        || ' to keep the seats.'
                                                 when v_pay_now then 'Nothing to pay now.'
                                                 else 'The fees of the seats given are added to your family''s pledges; pay any time before they are due.' end,
                              'type', 'pathshala',
                              'deep_link', case when nullif(v_out -> 0 ->> 'person_id', '') is not null then '/pathshala?person=' || (v_out -> 0 ->> 'person_id')
                                                else '/pathshala-enroll?term=' || t.id::text end,
                              'learner_id', nullif(v_out -> 0 ->> 'person_id', ''));
  if v_channel = 'family' then
    perform app._pathshala_notify_person(t.center_id, 'pathshala_registration_received', v_me, v_new, app._pathshala_route(v_new));
  else
    perform app._pathshala_notify_household(t.center_id, 'pathshala_registration_received', h.id, v_new, app._pathshala_route(v_new));
  end if;
  for y in select y2 from jsonb_array_elements(v_out) y2 loop
    continue when nullif(y ->> 'enrollment_id', '') is null;
    v_tmpl := case y ->> 'outcome'
                when 'seat' then case when not v_pay_now then 'pathshala_registered'
                                      when jsonb_typeof(y -> 'pledge') = 'object' then 'pathshala_payment_due' end
                when 'waitlist' then 'pathshala_waitlisted'
                when 'membership_hold' then 'pathshala_membership_hold' end;
    if v_tmpl is not null then
      perform app._pathshala_notify_learner((y ->> 'enrollment_id')::uuid, v_tmpl, case when v_channel = 'family' then v_me end);
    end if;
  end loop;
  return v_result;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- The family moves its payment holds to the office window (P18)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function app.choose_pathshala_office_payment(p_registration uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.pathshala_registrations; t app.pathshala_terms; v_until timestamptz; v_tz text; v_amount bigint; v_ids uuid[];
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into r from app.pathshala_registrations where id = p_registration for update;
  if r.id is null then raise exception 'That registration was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(r.center_id, 'pathshala');
  perform app.assert_module_enabled(r.center_id, 'giving');
  if not (app.pathshala_adult_of_household(r.center_id, r.household_id) or app.has_permission(r.center_id, 'pathshala.manage')) then
    raise exception 'Only an adult of the family can choose how to pay for it.' using errcode = '42501';
  end if;
  select * into t from app.pathshala_terms where id = r.term_id;
  if not t.office_payment_allowed then
    raise exception '% takes the fee online only. Ask the Pathshala office if you cannot pay online.', t.name using errcode = '22023';
  end if;
  select coalesce(nullif(c.time_zone, ''), 'America/Chicago') into v_tz from app.centers c where c.id = r.center_id;
  if not exists (select 1 from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
                  where e.registration_id = r.id and e.status = 'requested' and f.hold_reason in ('payment', 'office_payment')) then
    raise exception 'Nothing of this registration is waiting for payment.' using errcode = '22023';
  end if;
  perform app.set_audit_context('The family chose to pay the Pathshala fee at the office (' || t.office_hold_days || ' days)');
  update app.pathshala_enrollments e
     set hold_expires_at = greatest(e.hold_expires_at, now() + make_interval(days => t.office_hold_days)), hold_reminded_at = null
   where e.registration_id = r.id and e.status = 'requested' and app._pathshala_hold(e.id) = 'payment';
  update app.pathshala_enrollment_fees f set hold_reason = 'office_payment'
   where f.registration_id = r.id and f.hold_reason = 'payment'
     and exists (select 1 from app.pathshala_enrollments e where e.id = f.enrollment_id and e.status = 'requested');
  update app.pathshala_registrations set office_payment_chosen_at = now(), office_payment_chosen_by = auth.uid() where id = r.id;
  select max(e.hold_expires_at) into v_until from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
   where e.registration_id = r.id and e.status = 'requested' and f.hold_reason = 'office_payment';
  select coalesce(sum(pl.amount_cents - pl.paid_cents), 0), coalesce(array_agg(pl.id order by pl.pledged_at), '{}') into v_amount, v_ids
    from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id join app.pledges pl on pl.id = f.pledge_id
   where e.registration_id = r.id and e.status = 'requested' and f.hold_reason = 'office_payment' and pl.status in ('open', 'partially_paid');
  return jsonb_build_object('registration_id', r.id, 'hold_until', app.pathshala_iso(v_until, v_tz), 'amount_cents', v_amount,
                            'pledge_ids', to_jsonb(v_ids), 'office_hold_days', t.office_hold_days);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- The office: place, move within a level, place next, release and extend holds (§2.11)
-- ═════════════════════════════════════════════════════════════════════════════
-- An enrollment the office places that has no locked quote yet (the member app's bare request of 0565, a line entered by
-- hand): priced now, as a registration would be.
create or replace function app._pathshala_ensure_quote(p_enrollment uuid, p_level uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.pathshala_enrollments; q jsonb; x jsonb;
begin
  select * into e from app.pathshala_enrollments where id = p_enrollment;
  if exists (select 1 from app.pathshala_enrollment_fees where enrollment_id = e.id) then return; end if;
  q := app._pathshala_price(e.term_id, e.household_id,
                            jsonb_build_array(jsonb_build_object('person_id', e.student_person_id, 'track_id', e.track_id, 'level_id', p_level)),
                            app.pathshala_is_late(e.term_id) and e.registered_at > (select registration_closes_at from app.pathshala_terms where id = e.term_id));
  x := q -> 'lines' -> 0;
  insert into app.pathshala_enrollment_fees (center_id, enrollment_id, registration_id, term_id, household_id, level_id, learner_kind, family_rank,
                                             base_fee_cents, sibling_discount_cents, cap_reduction_cents, late_fee_cents, assistance_cents,
                                             total_cents, priced, rule_snapshot, status)
  values (e.center_id, e.id, e.registration_id, e.term_id, e.household_id, p_level, x ->> 'learner_kind', nullif(x ->> 'family_rank', '')::int,
          (x ->> 'base_fee_cents')::bigint, (x ->> 'sibling_discount_cents')::bigint, (x ->> 'cap_reduction_cents')::bigint,
          (x ->> 'late_fee_cents')::bigint, 0, (x ->> 'total_cents')::bigint, true, q -> 'rule_snapshot', 'quoted');
end $$;

-- Free seats in one class (null: no limit).
create or replace function app._pathshala_class_free(p_class uuid) returns integer
language sql stable security definer set search_path = app, public, extensions as $$
  select case when c.capacity is null then null
              else c.capacity - (select count(*)::int from app.pathshala_enrollments e where e.class_id = c.id and e.status in ('placed', 'active')) end
    from app.pathshala_classes c where c.id = p_class
$$;

-- p_class null: the class of the level with the most free seats. p_over_capacity (with a reason) places into a full class.
-- A requested or waitlisted learner: pledge mode places and bills; pay now offers the seat, held for payment. A placed or
-- active learner moves to another class of the SAME level (another level changes the fee: 0592's move, P26).
create or replace function app.place_pathshala_enrollment(p_enrollment uuid, p_class uuid default null, p_over_capacity boolean default false,
                                                          p_reason text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.pathshala_enrollments; t app.pathshala_terms; c app.pathshala_classes; cur app.pathshala_classes; v_name text; s record;
        v_free int; v_outcome text; v_level uuid; v_hold text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into e from app.pathshala_enrollments where id = p_enrollment for update;
  if e.id is null then raise exception 'That registration was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(e.center_id, 'pathshala');
  if not app.has_permission(e.center_id, 'pathshala.manage') then
    raise exception 'Placing learners needs pathshala.manage (the Pathshala principal).' using errcode = '42501';
  end if;
  v_hold := app._pathshala_hold(e.id);
  select * into t from app.pathshala_terms where id = e.term_id;
  v_name := coalesce(app.pathshala_first_name(e.student_person_id), 'This learner');
  if e.status in ('withdrawn', 'completed') then
    raise exception '% is %, so they cannot be placed. Register them again instead.', v_name, e.status using errcode = '22023';
  end if;
  if v_hold in ('payment', 'office_payment', 'assistance') then
    raise exception '%''s seat is held for payment until %; they are placed when the fee is paid.', v_name,
      coalesce(app.pathshala_when(e.hold_expires_at, e.center_id), 'the decision') using errcode = '22023';
  end if;
  if v_hold = 'membership' then
    raise exception '% waits for the family''s membership. Release the membership hold first (for example when the membership is renewed at the desk).', v_name
      using errcode = '22023';
  end if;
  if v_hold = 'waiver' then
    raise exception '% has not agreed to the Pathshala waiver yet. Release the waiver hold once they have agreed on paper.', v_name using errcode = '22023';
  end if;
  if p_class is not null then
    select * into c from app.pathshala_classes where id = p_class and term_id = e.term_id;
    if c.id is null then raise exception 'Choose a class of %.', t.name using errcode = '22023'; end if;
  else
    v_level := e.requested_level_id;
    if v_level is null then raise exception 'Choose the class for %.', v_name using errcode = '22023'; end if;
    select * into c from app.pathshala_classes where id = app._pathshala_class_for(e.term_id, v_level);
    if c.id is null then raise exception 'There is no class for that level in %.', t.name using errcode = '22023'; end if;
  end if;
  if coalesce(p_over_capacity, false) and app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why % is placed in a full class; the reason is kept in the audit log.', v_name using errcode = '22023';
  end if;
  perform app._pathshala_lock_level(e.term_id, c.level_id);

  -- Already placed: move between the classes of the same level (no money change).
  if e.status in ('placed', 'active') then
    select * into cur from app.pathshala_classes where id = e.class_id;
    if cur.level_id is distinct from c.level_id then
      raise exception 'Moving % to another level changes the fee: use Move, which shows the money first.', v_name using errcode = '22023';
    end if;
    if cur.id = c.id then return jsonb_build_object('enrollment_id', e.id, 'outcome', 'unchanged', 'class_id', c.id); end if;
    v_free := app._pathshala_class_free(c.id);
    if v_free is not null and v_free <= 0 and not coalesce(p_over_capacity, false) then
      raise exception '% is full. Tick "Place even if full", raise the capacity or choose another class.', c.name using errcode = '22023';
    end if;
    perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason), 'Moved ' || v_name || ' from ' || cur.name || ' to ' || c.name));
    update app.pathshala_enrollments set class_id = c.id where id = e.id;
    return jsonb_build_object('enrollment_id', e.id, 'outcome', 'moved', 'class_id', c.id);
  end if;

  -- Requested or waitlisted: a seat must be free in the class and the level (holds count), unless over capacity.
  select * into s from app.pathshala_level_seats(e.term_id, c.level_id);
  v_free := app._pathshala_class_free(c.id);
  if not coalesce(p_over_capacity, false) and ((v_free is not null and v_free <= 0) or (s.free is not null and s.free <= 0)) then
    raise exception '% is full (seats held for payment count). Tick "Place even if full", raise the capacity or choose another class.', c.name
      using errcode = '22023';
  end if;
  perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason),
    case when t.payment_mode = 'pay_now' then 'Offered ' || v_name || ' a seat in ' || c.name || ', held for payment'
         else 'Placed ' || v_name || ' in ' || c.name end));
  if t.fees_locked_at is not null then perform app._pathshala_ensure_quote(e.id, c.level_id); end if;
  if t.payment_mode = 'pay_now' and t.fees_locked_at is not null and app.module_enabled(t.center_id, 'giving') then
    update app.pathshala_enrollments
       set status = 'requested', class_id = null, requested_level_id = c.level_id, offered_at = now(),
           hold_expires_at = now() + make_interval(hours => t.hold_hours), hold_reminded_at = null
     where id = e.id;
    update app.pathshala_enrollment_fees set hold_reason = 'payment' where enrollment_id = e.id;
    perform app._pathshala_bill(e.id, true);
    if app._pathshala_place_unbilled(e.id) then
      perform app._pathshala_notify_learner(e.id, 'pathshala_placed');   -- $0: nothing to pay, placed at once
      v_outcome := 'placed';
    else
      perform app._pathshala_notify_learner(e.id, 'pathshala_payment_due');
      v_outcome := 'offered';
    end if;
  else
    perform app._pathshala_place(e.id, c.id);
    perform app._pathshala_bill(e.id, false);
    perform app._pathshala_notify_learner(e.id, 'pathshala_placed');
    v_outcome := 'placed';
  end if;
  return jsonb_build_object('enrollment_id', e.id, 'outcome', v_outcome, 'class_id', c.id,
                            'fee', (select jsonb_build_object('status', f.status, 'total_cents', f.total_cents, 'pledge_id', f.pledge_id)
                                      from app.pathshala_enrollment_fees f where f.enrollment_id = e.id));
end $$;

-- "Place next" (office-step terms, or any time the office wants to serve the waitlist by hand): the earliest waitlisted
-- learner of the level is placed (pledge mode) or offered the seat (pay now). p_term null: the open term with a waitlist
-- for that level.
create or replace function app.place_next_from_waitlist(p_level uuid, p_term uuid default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare l app.pathshala_levels; v_term uuid; e app.pathshala_enrollments; s record;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into l from app.pathshala_levels where id = p_level;
  if l.id is null then raise exception 'That level was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(l.center_id, 'pathshala');
  if not app.has_permission(l.center_id, 'pathshala.manage') then
    raise exception 'Serving the waitlist needs pathshala.manage (the Pathshala principal).' using errcode = '42501';
  end if;
  v_term := coalesce(p_term, (select t.id from app.pathshala_terms t
                               where t.center_id = l.center_id and t.status in ('registration', 'active')
                                 and exists (select 1 from app.pathshala_enrollments en left join app.pathshala_classes c on c.id = en.class_id
                                              where en.term_id = t.id and en.status = 'waitlisted' and coalesce(c.level_id, en.requested_level_id) = l.id)
                               order by t.starts_on limit 1));
  if v_term is null then raise exception 'Nobody is waiting for %.', l.name using errcode = '22023'; end if;
  perform app._pathshala_lock_level(v_term, l.id);
  select en.* into e from app.pathshala_enrollments en left join app.pathshala_classes c on c.id = en.class_id
   where en.term_id = v_term and en.status = 'waitlisted' and coalesce(c.level_id, en.requested_level_id) = l.id
   order by en.waitlisted_at nulls last, en.registered_at, en.id limit 1;
  if e.id is null then raise exception 'Nobody is waiting for %.', l.name using errcode = '22023'; end if;
  select * into s from app.pathshala_level_seats(v_term, l.id);
  if s.classes = 0 or (s.free is not null and s.free <= 0) then
    raise exception '% has no free seat. Raise a class''s capacity or add a class, then try again.', l.name using errcode = '22023';
  end if;
  return app.place_pathshala_enrollment(e.id, app._pathshala_class_for(v_term, l.id), false, null);
end $$;

-- Lift a membership hold (the membership was renewed at the desk) or a waiver hold (the adult agreed on paper), with a
-- reason: the learner is treated as registering now.
create or replace function app.release_pathshala_hold(p_enrollment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.pathshala_enrollments; v_name text; v_outcome text; v_hold text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into e from app.pathshala_enrollments where id = p_enrollment for update;
  if e.id is null then raise exception 'That registration was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(e.center_id, 'pathshala');
  if not app.has_permission(e.center_id, 'pathshala.manage') then
    raise exception 'Releasing a hold needs pathshala.manage (the Pathshala principal).' using errcode = '42501';
  end if;
  v_name := coalesce(app.pathshala_first_name(e.student_person_id), 'This learner');
  v_hold := app._pathshala_hold(e.id);
  if v_hold is null then raise exception '% is not held.', v_name using errcode = '22023'; end if;
  if v_hold in ('payment', 'office_payment', 'assistance') then
    raise exception '%''s seat is held for payment. To give more time, extend the hold; to end it, withdraw the registration.', v_name
      using errcode = '22023';
  end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why the hold is released; the reason is kept in the audit log.' using errcode = '22023';
  end if;
  perform app.set_audit_context(p_reason);
  if v_hold = 'waiver' then
    perform app.set_audit_context(p_reason || ' (the waiver was agreed on paper)');
  end if;
  v_outcome := app._pathshala_lift(e.id, 'pathshala_hold_lifted');
  return jsonb_build_object('enrollment_id', e.id, 'outcome', v_outcome,
                            'status', (select status from app.pathshala_enrollments where id = e.id),
                            'hold_reason', app._pathshala_hold(e.id));
end $$;

-- Give a seat held for payment more time, at most to the office window (office_hold_days from when it was given).
create or replace function app.extend_pathshala_hold(p_enrollment uuid, p_until timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.pathshala_enrollments; t app.pathshala_terms; v_max timestamptz; v_name text; v_tz text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into e from app.pathshala_enrollments where id = p_enrollment for update;
  if e.id is null then raise exception 'That registration was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(e.center_id, 'pathshala');
  if not app.has_permission(e.center_id, 'pathshala.manage') then
    raise exception 'Extending a hold needs pathshala.manage (the Pathshala principal).' using errcode = '42501';
  end if;
  v_name := coalesce(app.pathshala_first_name(e.student_person_id), 'This learner');
  if coalesce(app._pathshala_hold(e.id), '') not in ('payment', 'office_payment') then
    raise exception '%''s seat is not held for payment.', v_name using errcode = '22023';
  end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why the hold is extended; the reason is kept in the audit log.' using errcode = '22023';
  end if;
  select * into t from app.pathshala_terms where id = e.term_id;
  select coalesce(nullif(c.time_zone, ''), 'America/Chicago') into v_tz from app.centers c where c.id = e.center_id;
  v_max := coalesce(e.offered_at, e.registered_at) + make_interval(days => t.office_hold_days);
  if p_until is null or p_until <= now() then raise exception 'Choose a time in the future.' using errcode = '22023'; end if;
  if p_until > v_max then
    raise exception 'A seat can be held for payment at most until % (the % days of the office window).', app.pathshala_when(v_max, e.center_id),
      t.office_hold_days using errcode = '22023';
  end if;
  perform app.set_audit_context(p_reason);
  update app.pathshala_enrollments set hold_expires_at = p_until, hold_reminded_at = null where id = e.id;
  return jsonb_build_object('enrollment_id', e.id, 'hold_until', app.pathshala_iso(p_until, v_tz));
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Membership and the family's change requests (P6; v1's pending children)
-- ═════════════════════════════════════════════════════════════════════════════
-- A household's membership becoming active (yearly or life) lifts its learners' membership holds by itself: each is
-- treated as registering at that moment. A failure is recorded, never stops the membership.
create or replace function app.pathshala_membership_trigger() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record;
begin
  if new.status <> 'active' or new.tier not in ('yearly', 'life') or (new.ends_on is not null and new.ends_on < current_date) then return null; end if;
  for r in select e.id from app.pathshala_enrollments e join app.pathshala_terms t on t.id = e.term_id
            where e.household_id = new.household_id and e.status = 'requested' and app._pathshala_hold(e.id) = 'membership'
              and t.fees_locked_at is not null and t.status in ('registration', 'active')
            order by e.registered_at, e.id loop
    begin
      perform app.set_audit_default_reason('The family''s membership is active: the Pathshala membership hold lifts');
      perform app._pathshala_lift(r.id, 'pathshala_hold_lifted');
    exception when others then
      perform app.log_audit(new.center_id, 'pathshala.hold_lift_failed', 'pathshala_enrollments', r.id::text, null,
                            jsonb_build_object('error', sqlerrm), 'The membership hold could not be lifted automatically');
    end;
  end loop;
  return null;
end $$;
drop trigger if exists pathshala_membership_active on app.memberships;
create trigger pathshala_membership_active after insert or update of status, tier, ends_on on app.memberships
  for each row execute function app.pathshala_membership_trigger();

-- The person an approved add-member request created: the id the decision recorded, else the member of that household
-- created in the same transaction with the request's names, else one with the same names and birth date who joined since.
create or replace function app._pathshala_added_person(p_request uuid) returns uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(
    (select (r.details ->> 'person_id')::uuid from app.household_change_requests r
      where r.id = p_request and coalesce(r.details ->> 'person_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    (select p.id from app.household_change_requests r
       join app.household_members hm on hm.household_id = r.household_id and hm.left_at is null
       join app.people p on p.id = hm.person_id
      where r.id = p_request and p.created_at = now()
        and lower(p.first_name) = lower(btrim(r.details ->> 'first_name')) and lower(p.last_name) = lower(btrim(r.details ->> 'last_name'))
      order by p.created_at desc limit 1),
    (select p.id from app.household_change_requests r
       join app.household_members hm on hm.household_id = r.household_id and hm.left_at is null
       join app.people p on p.id = hm.person_id
      where r.id = p_request and p.created_at >= r.created_at
        and lower(p.first_name) = lower(btrim(r.details ->> 'first_name')) and lower(p.last_name) = lower(btrim(r.details ->> 'last_name'))
        and p.date_of_birth is not distinct from nullif(r.details ->> 'dob', '')::date
      order by p.created_at desc limit 1))
$$;

-- A pending child is now on the family: registered at the ORIGINAL time with the locked quote line (waitlist order kept).
create or replace function app._pathshala_convert_pending(p_pending uuid, p_person uuid) returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare pr app.pathshala_pending_registrations; t app.pathshala_terms; v_enr uuid; q jsonb; v_outcome text; v_waiver uuid; v_consent uuid;
        v jsonb;
begin
  select * into pr from app.pathshala_pending_registrations where id = p_pending for update;
  if pr.id is null or pr.status <> 'pending' then return null; end if;
  select * into t from app.pathshala_terms where id = pr.term_id;
  if t.status not in ('registration', 'active') or t.fees_locked_at is null
     or exists (select 1 from app.pathshala_enrollments e where e.term_id = t.id and e.student_person_id = p_person and e.track_id = pr.track_id
                  and e.status <> 'withdrawn') then
    update app.pathshala_pending_registrations set status = 'cancelled', decided_at = now(), enrollment_id = null where id = pr.id;
    return 'cancelled';
  end if;
  q := pr.quote;
  insert into app.pathshala_enrollments (center_id, term_id, student_person_id, household_id, track_id, requested_level_id, status,
                                         registration_id, registered_by, registered_at, notes, channel)
  values (pr.center_id, pr.term_id, p_person, pr.household_id, pr.track_id, pr.requested_level_id, 'requested',
          pr.registration_id, pr.registered_by, pr.registered_at, pr.note, 'app')
  returning id into v_enr;
  insert into app.pathshala_enrollment_fees (center_id, enrollment_id, registration_id, term_id, household_id, level_id, learner_kind, family_rank,
                                             base_fee_cents, sibling_discount_cents, cap_reduction_cents, late_fee_cents, assistance_cents,
                                             total_cents, priced, rule_snapshot, quoted_at, status, assistance_requested)
  values (pr.center_id, v_enr, pr.registration_id, pr.term_id, pr.household_id, pr.requested_level_id, coalesce(q ->> 'learner_kind', 'child'),
          case when coalesce(q ->> 'learner_kind', 'child') = 'child' then coalesce(nullif(q ->> 'family_rank', '')::int, 1) end,
          coalesce((q ->> 'base_fee_cents')::bigint, 0), coalesce((q ->> 'sibling_discount_cents')::bigint, 0),
          coalesce((q ->> 'cap_reduction_cents')::bigint, 0), coalesce((q ->> 'late_fee_cents')::bigint, 0),
          coalesce((q ->> 'assistance_cents')::bigint, 0), coalesce((q ->> 'total_cents')::bigint, 0),
          coalesce((q ->> 'priced')::boolean, pr.requested_level_id is not null), coalesce(q -> 'rule_snapshot', '{}'::jsonb), pr.registered_at,
          'quoted', coalesce((q ->> 'assistance_requested')::boolean, false));
  -- The parent agreed to the waiver for this child when registering.
  v_waiver := app.pathshala_current_waiver(pr.center_id);
  if v_waiver is not null then
    v_consent := app.pathshala_waiver_consent(p_person, v_waiver);
    if v_consent is null then
      insert into app.consents (center_id, person_id, given_by_user, kind, legal_document_id, granted, source, recorded_at)
      values (pr.center_id, p_person, pr.registered_by, 'pathshala_waiver', v_waiver, true, 'app', pr.registered_at)
      returning id into v_consent;
    end if;
    update app.pathshala_enrollments set waiver_consent_id = v_consent where id = v_enr;
  end if;
  if app.pathshala_membership_hold_applies(t.id, pr.household_id) then
    update app.pathshala_enrollment_fees set hold_reason = 'membership' where enrollment_id = v_enr;
    v_outcome := 'membership_hold';
  else
    v_outcome := app._pathshala_seat_or_wait(v_enr, pr.registered_at);
  end if;
  update app.pathshala_pending_registrations set status = 'converted', decided_at = now(), enrollment_id = v_enr where id = pr.id;
  v := app._pathshala_vars(v_enr) || jsonb_build_object('state', coalesce(app._pathshala_state_sentence(v_enr), ''));
  perform app._pathshala_notify_person(pr.center_id, 'pathshala_child_added',
                                       (select cu.person_id from app.center_users cu where cu.center_id = pr.center_id and cu.user_id = pr.registered_by),
                                       v, app._pathshala_route(v));
  return v_outcome;
end $$;

create or replace function app.pathshala_change_request_trigger() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare pr app.pathshala_pending_registrations; v_person uuid; v jsonb;
begin
  if new.kind <> 'add_member' or old.status <> 'open' or new.status = 'open' then return null; end if;
  for pr in select * from app.pathshala_pending_registrations where change_request_id = new.id and status = 'pending' loop
    begin
      if new.status = 'rejected' then
        update app.pathshala_pending_registrations set status = 'cancelled', decided_at = now() where id = pr.id;
        v := jsonb_build_object('learner', pr.first_name, 'term', (select name from app.pathshala_terms where id = pr.term_id),
                                'level', coalesce((select name from app.pathshala_levels where id = pr.requested_level_id), 'Pathshala'),
                                'type', 'pathshala', 'deep_link', '/pathshala-enroll?term=' || pr.term_id::text);
        perform app._pathshala_notify_person(pr.center_id, 'pathshala_child_not_added',
                                             (select cu.person_id from app.center_users cu where cu.center_id = pr.center_id and cu.user_id = pr.registered_by),
                                             v, app._pathshala_route(v));
      else
        v_person := app._pathshala_added_person(new.id);
        if v_person is null then
          perform app.log_audit(new.center_id, 'pathshala.pending_child_unmatched', 'pathshala_pending_registrations', pr.id::text, null,
                                jsonb_build_object('change_request_id', new.id), 'The added child could not be matched; the registration still waits');
          continue;
        end if;
        perform app.set_audit_default_reason('The office added ' || pr.first_name || ' to the family: the Pathshala registration goes ahead');
        perform app._pathshala_convert_pending(pr.id, v_person);
      end if;
    exception when others then
      perform app.log_audit(new.center_id, 'pathshala.pending_child_failed', 'pathshala_pending_registrations', pr.id::text, null,
                            jsonb_build_object('error', sqlerrm), 'The pending Pathshala registration could not be completed automatically');
    end;
  end loop;
  return null;
end $$;
drop trigger if exists pathshala_change_request_decided on app.household_change_requests;
create trigger pathshala_change_request_decided after update of status on app.household_change_requests
  for each row execute function app.pathshala_change_request_trigger();

-- ═════════════════════════════════════════════════════════════════════════════
-- The office's queue and the Home tasks (§2.14, §3.3)
-- ═════════════════════════════════════════════════════════════════════════════
-- The household as staff pickers show it (never a name alone): the full card for people and giving staff, else its id,
-- name and Connect number (0587's reduced card).
create or replace function app._pathshala_household_card(p_household uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select to_jsonb(hc) from app.household_card(p_household) hc),
                  (select jsonb_build_object('household_id', h.id, 'household_name', h.display_name, 'household_number', h.household_number)
                     from app.households h where h.id = p_household))
$$;

-- p_view: to_place (the office decides: not sure, outside the band, office step, held for nothing), held (seats held for
-- payment or assistance), waitlisted, membership (held for membership), waiver, placed, active, withdrawn, completed,
-- pending (children waiting to be added to the family), all. Fee columns only for pathshala.manage and giving staff.
create or replace function app.pathshala_registration_queue(p_term uuid, p_view text default 'all') returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; v_fees boolean; v_cut date; v_tz text; v_items jsonb; v_pending jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then raise exception 'That term was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(t.center_id, 'pathshala');
  if not (app.has_permission(t.center_id, 'pathshala.view') or app.has_permission(t.center_id, 'pathshala.manage')) then
    raise exception 'You don''t have access to this area (the registrations need pathshala.view).' using errcode = '42501';
  end if;
  if coalesce(p_view, '') not in ('to_place', 'held', 'waitlisted', 'membership', 'waiver', 'placed', 'active', 'withdrawn', 'completed', 'pending', 'all') then
    raise exception 'The view is one of to_place, held, waitlisted, membership, waiver, placed, active, withdrawn, completed, pending or all.' using errcode = '22023';
  end if;
  v_fees := app.has_permission(t.center_id, 'pathshala.manage') or app.has_permission(t.center_id, 'giving.view')
            or app.has_permission(t.center_id, 'giving.manage');
  v_cut := app.pathshala_age_cutoff(t.id);
  select coalesce(nullif(c.time_zone, ''), 'America/Chicago') into v_tz from app.centers c where c.id = t.center_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'enrollment_id', e.id, 'registration_id', e.registration_id, 'status', e.status, 'hold_reason', f.hold_reason,
           'hold_expires_at', app.pathshala_iso(e.hold_expires_at, v_tz), 'hold_live', app.pathshala_hold_live(e.id),
           'offered_at', app.pathshala_iso(e.offered_at, v_tz),
           'waitlist_position', case when e.status = 'waitlisted' then app.pathshala_waitlist_position(e.id) end,
           'registered_at', app.pathshala_iso(e.registered_at, v_tz), 'channel', e.channel, 'family_note', e.notes,
           'learner', jsonb_build_object('person_id', p.id, 'name', coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name,
                                         'age_on_cutoff', app.pathshala_age_on(p.date_of_birth, v_cut),
                                         'is_child', app.pathshala_counts_as_child(p.id, v_cut), 'needs_birth_date', p.date_of_birth is null),
           'household_id', e.household_id, 'household_card', app._pathshala_household_card(e.household_id),
           'track', jsonb_build_object('id', tr.id, 'name', tr.name),
           'requested_level', case when rl.id is null then null else jsonb_build_object('id', rl.id, 'name', rl.name) end,
           'suggested_level', case when sl.id is null then null else jsonb_build_object('id', sl.id, 'name', sl.name, 'reason', e.suggestion_reason) end,
           'class', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name, 'level_id', c.level_id) end,
           'membership', app.pathshala_household_membership(e.household_id),
           'waiver', jsonb_build_object('needed', app.pathshala_current_waiver(t.center_id) is not null,
                                        'agreed', e.waiver_consent_id is not null
                                                  or (app.pathshala_current_waiver(t.center_id) is not null
                                                      and app.pathshala_waiver_consent(e.student_person_id, app.pathshala_current_waiver(t.center_id)) is not null)),
           'fee', case when not v_fees then null when f.id is null then jsonb_build_object('status', 'not_billed', 'note', 'No fee line (imported, demo or entered by hand)')
                       else jsonb_build_object('status', f.status, 'total_cents', f.total_cents, 'priced', f.priced, 'learner_kind', f.learner_kind,
                                               'family_rank', f.family_rank, 'note', f.billing_note, 'assistance_requested', f.assistance_requested,
                                               'pledge', case when pl.id is null then null
                                                              else jsonb_build_object('id', pl.id, 'number', pl.pledge_number, 'amount_cents', pl.amount_cents,
                                                                                      'paid_cents', pl.paid_cents, 'status', pl.status, 'due_on', pl.due_on) end) end)
           order by case when e.status = 'waitlisted' then e.waitlisted_at end nulls last, e.registered_at, e.id), '[]'::jsonb)
    into v_items
    from app.pathshala_enrollments e
    join app.people p on p.id = e.student_person_id
    left join app.pathshala_tracks tr on tr.id = e.track_id
    left join app.pathshala_levels rl on rl.id = e.requested_level_id
    left join app.pathshala_levels sl on sl.id = e.suggested_level_id
    left join app.pathshala_classes c on c.id = e.class_id
    left join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
    left join app.pledges pl on pl.id = f.pledge_id
   where e.term_id = t.id
     and case p_view
           when 'to_place' then e.status = 'requested' and f.hold_reason is null
           when 'held' then e.status = 'requested' and f.hold_reason in ('payment', 'office_payment', 'assistance')
           when 'waitlisted' then e.status = 'waitlisted'
           when 'membership' then f.hold_reason = 'membership'
           when 'waiver' then f.hold_reason = 'waiver'
           when 'placed' then e.status = 'placed'
           when 'active' then e.status = 'active'
           when 'withdrawn' then e.status = 'withdrawn'
           when 'completed' then e.status = 'completed'
           when 'pending' then false
           else true end;
  select coalesce(jsonb_agg(jsonb_build_object(
           'pending_registration_id', pr.id, 'change_request_id', pr.change_request_id, 'first_name', pr.first_name, 'last_name', pr.last_name,
           'age_on_cutoff', app.pathshala_age_on(pr.date_of_birth, v_cut), 'household_id', pr.household_id,
           'household_card', app._pathshala_household_card(pr.household_id), 'track_id', pr.track_id, 'requested_level_id', pr.requested_level_id,
           'registered_at', app.pathshala_iso(pr.registered_at, v_tz), 'family_note', pr.note,
           'fee', case when v_fees then jsonb_build_object('total_cents', (pr.quote ->> 'total_cents')::bigint) end)
           order by pr.registered_at), '[]'::jsonb)
    into v_pending
    from app.pathshala_pending_registrations pr
   where pr.term_id = t.id and pr.status = 'pending' and p_view in ('pending', 'to_place', 'all');
  return jsonb_build_object('term_id', t.id, 'view', p_view, 'fees_visible', v_fees, 'items', v_items, 'pending', v_pending);
end $$;

-- The Home tasks: the office's to-place list, held seats (and those ending within 6 hours), membership holds, fee
-- assistance waiting (decided from 0592), payments that arrived after a release, offered levels with a class but no fee,
-- the waitlist (open terms only, F20), children waiting to be added. Money counts only for pathshala.manage and giving staff.
create or replace function app.pathshala_task_counts(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_money boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  perform app.assert_module_enabled(p_center, 'pathshala');
  if not (app.has_permission(p_center, 'pathshala.view') or app.has_permission(p_center, 'pathshala.manage')
          or app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'You don''t have access to this area (the Pathshala tasks need pathshala.view).' using errcode = '42501';
  end if;
  v_money := app.has_permission(p_center, 'pathshala.manage') or app.has_permission(p_center, 'giving.view')
             or app.has_permission(p_center, 'giving.manage');
  return (
    with open_terms as (select t.id from app.pathshala_terms t where t.center_id = p_center and t.status in ('registration', 'active')),
         en as (select e.*, f.hold_reason from app.pathshala_enrollments e left join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
                 where e.term_id in (select id from open_terms))
    select jsonb_build_object(
      'to_place', (select count(*) from en where en.status = 'requested' and en.hold_reason is null),
      'held_for_payment', (select count(*) from en where en.status = 'requested' and en.hold_reason in ('payment', 'office_payment', 'assistance')),
      'held_ending_soon', (select count(*) from en where en.status = 'requested' and en.hold_reason in ('payment', 'office_payment')
                             and en.hold_expires_at <= now() + interval '6 hours'),
      'held_for_membership', (select count(*) from en where en.hold_reason = 'membership'),
      'waiting_for_waiver', (select count(*) from en where en.hold_reason = 'waiver'),
      'waitlisted', (select count(*) from en where en.status = 'waitlisted'),
      'children_to_add', (select count(*) from app.pathshala_pending_registrations pr where pr.center_id = p_center and pr.status = 'pending'
                            and pr.term_id in (select id from open_terms)),
      'assistance_to_decide', case when v_money then (select count(*) from app.pathshala_enrollment_fees f join en on en.id = f.enrollment_id
                                                      where f.assistance_requested and f.assistance_approved_at is null and f.status = 'quoted') end,
      'payments_after_release', case when v_money then (select count(*) from app.rsvp_credit_releases cr
                                                        where cr.center_id = p_center and cr.kind = 'pathshala_late_payment' and cr.status = 'pending') end,
      'levels_without_fee', (select count(*) from app.pathshala_terms t join app.pathshala_levels l on l.center_id = t.center_id and l.active
                              where t.id in (select id from open_terms) and t.fees_locked_at is not null
                                and exists (select 1 from app.pathshala_classes c where c.term_id = t.id and c.level_id = l.id)
                                and not exists (select 1 from app.pathshala_level_fees lf where lf.term_id = t.id and lf.level_id = l.id))));
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- The sweep (worker job pathshala.holds_sweep, every 15 minutes)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function app.worker_pathshala_holds_sweep() returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; v_reminded int := 0; v_released int := 0; v_credit bigint := 0; v_credited int := 0; v_served int := 0; v jsonb;
        v_kept int := 0; v_placed int := 0; v_paid uuid;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  -- First, any held seat whose fee pledge is already paid (the hook could not place it at once) is placed, never released.
  perform app.set_audit_context('Pathshala: the fee was paid, so the held seat is confirmed');
  for r in select e.id from app.pathshala_enrollments e
            where e.status = 'requested' and app._pathshala_hold(e.id) in ('payment', 'office_payment')
              and exists (select 1 from app.pathshala_enrollment_fees f join app.pledges p on p.id = f.pledge_id
                           where f.enrollment_id = e.id and p.status = 'paid')
            limit 500 loop
    select f.pledge_id into v_paid from app.pathshala_enrollment_fees f where f.enrollment_id = r.id;
    perform app._pathshala_fee_paid(v_paid);
    if exists (select 1 from app.pathshala_enrollments where id = r.id and status = 'placed') then v_placed := v_placed + 1; end if;
  end loop;
  -- Reminders, 6 hours before a hold ends.
  perform app.set_audit_context('Pathshala: a seat held for payment ends within 6 hours (reminder)');
  for r in select e.id from app.pathshala_enrollments e join app.pathshala_terms t on t.id = e.term_id
            where e.status = 'requested' and app._pathshala_hold(e.id) in ('payment', 'office_payment') and e.hold_reminded_at is null
              and e.hold_expires_at > now() and e.hold_expires_at <= now() + interval '6 hours'
              and app.module_enabled(e.center_id, 'pathshala')
            order by e.hold_expires_at limit 500 for update of e skip locked loop
    update app.pathshala_enrollments set hold_reminded_at = now() where id = r.id;
    perform app._pathshala_notify_learner(r.id, 'pathshala_hold_reminder');
    v_reminded := v_reminded + 1;
  end loop;
  -- Releases: a hold that is no longer live.
  for r in select e.id, e.term_id, e.requested_level_id, e.hold_expires_at, e.center_id from app.pathshala_enrollments e
            where e.status = 'requested' and app._pathshala_hold(e.id) in ('payment', 'office_payment') and e.hold_expires_at <= now()
              and app.module_enabled(e.center_id, 'pathshala')
            order by e.hold_expires_at limit 500 for update of e skip locked loop
    if app.pathshala_hold_live(r.id) then v_kept := v_kept + 1; continue; end if;
    perform app.set_audit_context('Pathshala: the seat was released because the fee was not paid by '
                                  || coalesce(app.pathshala_when(r.hold_expires_at, r.center_id), 'the end of the hold'));
    perform app._pathshala_lock_level(r.term_id, r.requested_level_id);
    v := app._pathshala_release_hold(r.id, 'The fee was not paid by ' || coalesce(app.pathshala_when(r.hold_expires_at, r.center_id), 'the end of the hold')
                                           || ', so the seat was released.');
    if (v ->> 'released')::boolean then
      v_released := v_released + 1;
      if (v ->> 'credit_cents')::bigint > 0 then v_credited := v_credited + 1; v_credit := v_credit + (v ->> 'credit_cents')::bigint; end if;
    end if;
  end loop;
  -- Catch-up: a seat that is free while a waitlist waits (a class changed by an import, a failed trigger) is served.
  perform app.set_audit_context('Pathshala: a free seat goes to the next learner on the waitlist');
  for r in select distinct en.term_id, coalesce(c.level_id, en.requested_level_id) as level_id
             from app.pathshala_enrollments en join app.pathshala_terms t on t.id = en.term_id
             left join app.pathshala_classes c on c.id = en.class_id
            where en.status = 'waitlisted' and t.fees_locked_at is not null and t.status in ('registration', 'active') and t.seat_rule = 'automatic'
              and coalesce(c.level_id, en.requested_level_id) is not null loop
    v_served := v_served + app._pathshala_fill_seats_safely(r.term_id, r.level_id);
  end loop;
  return jsonb_build_object('reminded', v_reminded, 'released', v_released, 'credited', v_credited, 'credit_cents', v_credit,
                            'kept_paying', v_kept, 'waitlist_served', v_served, 'paid_placed', v_placed);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- The treasurer's credit queue serves both (0543's body, with the reason saying which)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function app.resolve_rsvp_credit(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.rsvp_credit_releases;
begin
  select * into c from app.rsvp_credit_releases where id = p_id for update;
  if c.id is null then raise exception 'That credit was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(c.center_id, 'giving');
  if not app.has_permission(c.center_id, 'giving.manage') then raise exception 'Handling credit needs giving.manage.' using errcode = '42501'; end if;
  if c.status = 'handled' then return; end if;
  perform app.set_audit_context(case c.kind
    when 'pathshala_hold_released' then 'Treasurer handled the credit released when a Pathshala seat held for payment was released'
    when 'pathshala_late_payment' then 'Treasurer handled a Pathshala payment that arrived after the seat was released'
    when 'pathshala_withdrawn' then 'Treasurer handled the credit released by a Pathshala withdrawal'
    else 'Treasurer handled the credit released by a cancelled RSVP pledge' end);
  update app.rsvp_credit_releases set status = 'handled', handled_by = auth.uid(), handled_at = now(), handled_note = nullif(trim(p_note), '') where id = c.id;
end $$;
grant execute on function app.resolve_rsvp_credit(uuid, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- Templates (platform defaults; a community may override them in Communications)
-- ═════════════════════════════════════════════════════════════════════════════
-- Variables: learner (first name), term, level, class, schedule ("Sundays 10:00–11:30 · Room C"), amount (what is left to
-- pay), total, hold_until ("Thu Oct 8, 6:00 pm"), position (waitlist), withdraw_by, pledge_number, due, fee_sentence, state
-- (one sentence of where the registration stands); for pathshala_registration_received: term, summary, total, next_steps.
-- Pushes carry type "pathshala" and deep_link "/pathshala?person=<learner>" (registration: "/pathshala-enroll?term=<term>").
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('pathshala_registration_received', 'push', 'Pathshala registration received',
   'We received your {{term}} registration. {{summary}}. {{next_steps}}'),
  ('pathshala_registration_received', 'email', 'Your Pathshala {{term}} registration',
   E'We received your Pathshala {{term}} registration at {{center_short_name}}.\n\n{{summary}}.\n\nTotal: {{total}}. {{next_steps}}\n\nOpen the Community Connect app to see each learner''s page.'),
  ('pathshala_registered', 'push', '{{learner}} is registered',
   '{{learner}} is registered for {{level}} ({{term}}): {{schedule}}. {{fee_sentence}}'),
  ('pathshala_registered', 'email', '{{learner}} is registered for Pathshala',
   E'{{learner}} is registered for {{level}} at {{center_short_name}} ({{term}}): {{schedule}}.\n\n{{fee_sentence}}\n\nOpen the Community Connect app to see {{learner}}''s Pathshala page.'),
  ('pathshala_payment_due', 'push', 'Pay to keep {{learner}}''s seat',
   'Pay {{amount}} by {{hold_until}} to keep {{learner}}''s seat in {{level}} ({{term}}).'),
  ('pathshala_payment_due', 'email', 'Pay to keep {{learner}}''s Pathshala seat',
   E'{{learner}}''s seat in {{level}} ({{term}}) at {{center_short_name}} is held until {{hold_until}}.\n\nPay {{amount}} in the Community Connect app to keep it. If it is not paid by then, the seat goes to the next family.'),
  ('pathshala_hold_reminder', 'push', '{{learner}}''s seat is held until {{hold_until}}',
   'Pay {{amount}} to keep {{learner}}''s seat in {{level}}.'),
  ('pathshala_hold_reminder', 'email', 'Reminder: {{learner}}''s Pathshala seat is held until {{hold_until}}',
   E'{{learner}}''s seat in {{level}} ({{term}}) at {{center_short_name}} is held until {{hold_until}}.\n\nPay {{amount}} in the Community Connect app to keep it.'),
  ('pathshala_hold_released', 'push', '{{learner}}''s seat was released',
   'We released {{learner}}''s seat in {{level}} because the fee was not paid by {{hold_until}}. Register again if a seat is still free.'),
  ('pathshala_hold_released', 'email', '{{learner}}''s Pathshala seat was released',
   E'We released {{learner}}''s seat in {{level}} ({{term}}) at {{center_short_name}} because the fee was not paid by {{hold_until}}.\n\nRegister again in the Community Connect app if a seat is still free. Anything already paid is held as credit for the treasurer; it is never lost.'),
  ('pathshala_waitlisted', 'push', '{{learner}} is on the waitlist',
   '{{learner}} is number {{position}} on the waitlist for {{level}} ({{term}}). No charge unless a seat opens.'),
  ('pathshala_waitlisted', 'email', '{{learner}} is on the Pathshala waitlist',
   E'{{learner}} is number {{position}} on the waitlist for {{level}} ({{term}}) at {{center_short_name}}.\n\nThere is no charge unless a seat opens; we will tell you when it does.'),
  ('pathshala_placed', 'push', 'A seat opened for {{learner}}',
   '{{learner}} is placed in {{class}} ({{term}}): {{schedule}}. {{fee_sentence}} To withdraw at no charge, withdraw by {{withdraw_by}}.'),
  ('pathshala_placed', 'email', 'A Pathshala seat opened for {{learner}}',
   E'{{learner}} is placed in {{class}} ({{term}}) at {{center_short_name}}: {{schedule}}.\n\n{{fee_sentence}}\n\nIf {{learner}} cannot come, withdraw in the Community Connect app by {{withdraw_by}} and nothing is charged.'),
  ('pathshala_membership_hold', 'push', '{{learner}}''s registration waits for membership',
   '{{learner}}''s Pathshala registration for {{level}} waits for your family''s membership. Apply for membership in the app; nothing is charged until then.'),
  ('pathshala_membership_hold', 'email', '{{learner}}''s Pathshala registration waits for membership',
   E'Pathshala at {{center_short_name}} needs a yearly or life membership. {{learner}}''s registration for {{level}} ({{term}}) is kept and goes ahead by itself when your family''s membership is active.\n\nApply for membership in the Community Connect app. Nothing is charged until then.'),
  ('pathshala_hold_lifted', 'push', '{{learner}}''s registration goes ahead',
   '{{learner}}''s Pathshala registration ({{term}}) goes ahead: {{state}}.'),
  ('pathshala_hold_lifted', 'email', '{{learner}}''s Pathshala registration goes ahead',
   E'{{learner}}''s Pathshala registration ({{term}}) at {{center_short_name}} goes ahead: {{state}}.\n\nOpen the Community Connect app to see {{learner}}''s page.'),
  ('pathshala_child_added', 'push', '{{learner}} was added to your family',
   'The office added {{learner}} to your family, so the Pathshala registration ({{term}}) goes ahead: {{state}}.'),
  ('pathshala_child_added', 'email', '{{learner}} was added to your family',
   E'The {{center_short_name}} office added {{learner}} to your family, so {{learner}}''s Pathshala registration ({{term}}) goes ahead: {{state}}.'),
  ('pathshala_child_not_added', 'push', '{{learner}} was not added to your family',
   'The office did not add {{learner}} to your family, so the Pathshala registration ({{term}}) was cancelled. Contact the office if this is not right.'),
  ('pathshala_child_not_added', 'email', '{{learner}} was not added to your family',
   E'The {{center_short_name}} office did not add {{learner}} to your family, so {{learner}}''s Pathshala registration ({{term}}) was cancelled. Nothing was charged.\n\nContact the office if this is not right.')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- ═════════════════════════════════════════════════════════════════════════════
-- Comments
-- ═════════════════════════════════════════════════════════════════════════════
comment on function app.register_pathshala_children(uuid, uuid, jsonb, bigint, jsonb, uuid, text) is
  'An adult of the household (the family) or pathshala.manage (the office) registers learners (§2.17). p_learners: [{person_id, track_id, level_id | null ("not sure", pledge mode only), note, assistance_requested}] or [{new_child: {first_name, last_name, date_of_birth, relationship}, track_id, level_id, note}] (the family only). Re-prices under the seat locks; refuses a changed total (p_expected_total_cents) or outcome (p_expected_outcomes: the preview''s lines, or a list of outcomes) with hint review_again; p_waiver_document: the published waiver agreed to (required when one is published); p_client_key: the same key returns the same answer. Returns {registration_id, lines[{person_id, track_id, level_id, learner_kind, family_rank, outcome: seat | waitlist | membership_hold | office | pending_child | waiver_hold, base_fee_cents, sibling_discount_cents, cap_reduction_cents, late_fee_cents, assistance_cents, total_cents, enrollment_id, pledge {id, number, due_on, amount_cents} | null, ...}], children_total_cents, adults_total_cents, total_cents, due_now_cents, pay (pay now: {amount_cents, pledge_ids, for_label, hold_until, office_payment_allowed}), pending[], late, payment_mode}.';
comment on function app.choose_pathshala_office_payment(uuid) is 'An adult of the household (or the office): when the term allows it (P18), the registration''s seats held for an online payment are held for payment at the office instead, for office_hold_days. Returns {registration_id, hold_until, amount_cents, pledge_ids, office_hold_days}.';
comment on function app.place_pathshala_enrollment(uuid, uuid, boolean, text) is 'pathshala.manage: place a requested or waitlisted learner (pledge mode: placed and billed; pay now: the seat is offered, held for payment), or move a placed learner to another class of the same level (no money change). p_class null: the class of the level with the most free seats; p_over_capacity needs a reason. A held seat cannot be moved (P26).';
comment on function app.place_next_from_waitlist(uuid, uuid) is 'pathshala.manage: "Place next" for a level: the earliest waitlisted learner of that level (in p_term, else the open term with a waitlist) is placed or offered the seat.';
comment on function app.release_pathshala_hold(uuid, text) is 'pathshala.manage, with a reason: lifts a membership hold (membership renewed at the desk) or a waiver hold (agreed on paper); the learner is treated as registering now.';
comment on function app.extend_pathshala_hold(uuid, timestamptz, text) is 'pathshala.manage, with a reason: a seat held for payment is held until p_until, at most office_hold_days after it was given.';
comment on function app.pathshala_registration_queue(uuid, text) is 'The office''s Registrations screen (pathshala.view; fee columns for pathshala.manage and giving staff): {term_id, view, fees_visible, items[{enrollment_id, registration_id, status, hold_reason, hold_expires_at, hold_live, offered_at, waitlist_position, registered_at, channel, family_note, learner, household_id, household_card, track, requested_level, suggested_level, class, membership, waiver, fee}], pending[]}.';
comment on function app.pathshala_task_counts(uuid) is 'The Pathshala Home tasks (§2.14): to_place, held_for_payment, held_ending_soon, held_for_membership, waiting_for_waiver, waitlisted (open terms), children_to_add, assistance_to_decide and payments_after_release (pathshala.manage or giving staff only), levels_without_fee.';
comment on function app.worker_pathshala_holds_sweep() is 'The worker role only (job pathshala.holds_sweep, every 15 minutes): a held seat whose fee pledge is already paid is placed (never released); reminders 6 hours before a hold ends; holds no longer live (window passed, no open payment page under 24 hours, no Zelle report for an office hold) are released (pledges cancelled, money paid toward them to credit rows, the learner withdrawn, the family told, the seat to the waitlist); a free seat with a waitlist is served. Returns {reminded, released, credited, credit_cents, kept_paying, waitlist_served, paid_placed}.';
comment on function app.pathshala_hold_live(uuid) is 'A seat held for payment stays live while its window runs, while a payment page (checkout created or pending, under 24 hours old) names one of its registration''s held pledges, and, for an office hold, while a member''s Zelle report naming one waits for the treasurer; an assistance hold until the decision (§2.7, P17, P18).';

-- ═════════════════════════════════════════════════════════════════════════════
-- Grants
-- ═════════════════════════════════════════════════════════════════════════════
revoke execute on function
  app.register_pathshala_children(uuid, uuid, jsonb, bigint, jsonb, uuid, text), app.choose_pathshala_office_payment(uuid),
  app.place_pathshala_enrollment(uuid, uuid, boolean, text), app.place_next_from_waitlist(uuid, uuid),
  app.release_pathshala_hold(uuid, text), app.extend_pathshala_hold(uuid, timestamptz, text),
  app.pathshala_registration_queue(uuid, text), app.pathshala_task_counts(uuid)
  from public, anon;
grant execute on function
  app.register_pathshala_children(uuid, uuid, jsonb, bigint, jsonb, uuid, text), app.choose_pathshala_office_payment(uuid),
  app.place_pathshala_enrollment(uuid, uuid, boolean, text), app.place_next_from_waitlist(uuid, uuid),
  app.release_pathshala_hold(uuid, text), app.extend_pathshala_hold(uuid, timestamptz, text),
  app.pathshala_registration_queue(uuid, text), app.pathshala_task_counts(uuid)
  to authenticated, service_role;
-- Internal: only the functions above and the triggers call these, as their definer.
revoke execute on function
  app.pathshala_enrollments_track(), app.pathshala_enrollments_guard(), app.pathshala_today(uuid), app.pathshala_when(timestamptz, uuid),
  app.pathshala_class_schedule(uuid), app._pathshala_lock_level(uuid, uuid), app._pathshala_class_for(uuid, uuid),
  app.pathshala_waitlist_position(uuid), app._pathshala_due_on(uuid, uuid), app._pathshala_price_line(uuid, uuid),
  app._pathshala_send(uuid, text, text, text, jsonb, jsonb), app._pathshala_notify_person(uuid, text, uuid, jsonb, jsonb),
  app._pathshala_household_adults(uuid, uuid), app._pathshala_notify_household(uuid, text, uuid, jsonb, jsonb, uuid),
  app._pathshala_vars(uuid), app._pathshala_route(jsonb), app._pathshala_notify_learner(uuid, text, uuid),
  app._pathshala_bill(uuid, boolean), app._pathshala_place(uuid, uuid), app._pathshala_seat_or_wait(uuid, timestamptz),
  app._pathshala_fill_seats(uuid, uuid), app._pathshala_release_hold(uuid, text, boolean), app.pathshala_hold_live(uuid),
  app._pathshala_state_sentence(uuid), app._pathshala_lift(uuid, text), app._pathshala_fee_paid(uuid), app.pathshala_fee_paid_trigger(),
  app.pathshala_late_payment_trigger(), app._pathshala_fill_seats_safely(uuid, uuid), app.pathshala_classes_seats_trigger(),
  app.pathshala_enrollments_seat_freed(), app._pathshala_outcome_words(text), app._pathshala_changed_outcome(jsonb, text),
  app._pathshala_ensure_quote(uuid, uuid), app._pathshala_class_free(uuid), app.pathshala_membership_trigger(),
  app._pathshala_added_person(uuid), app._pathshala_convert_pending(uuid, uuid), app.pathshala_change_request_trigger(),
  app._pathshala_household_card(uuid), app._pathshala_hold(uuid), app._pathshala_place_unbilled(uuid),
  app.pathshala_fee_pledge_closed_trigger()
  from public, anon, authenticated;
grant execute on function
  app.pathshala_today(uuid), app.pathshala_when(timestamptz, uuid), app.pathshala_class_schedule(uuid), app.pathshala_waitlist_position(uuid),
  app.pathshala_hold_live(uuid), app._pathshala_vars(uuid), app._pathshala_state_sentence(uuid), app._pathshala_household_card(uuid)
  to service_role;
-- The sweep's database side: the worker role only (it asserts that itself too).
revoke execute on function app.worker_pathshala_holds_sweep() from public, anon, authenticated, service_role;
grant execute on function app.worker_pathshala_holds_sweep() to connect_worker;
