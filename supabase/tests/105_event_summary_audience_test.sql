-- 0653: app.event_summary and app.event_reminder_audience, the Events workspace's read-only numbers (counts only, never a name).
--   A. event_summary: RSVP households by status, people (RSVP'd, confirmed, waitlisted, walk-ins, checked in, served), the counts
--      of children under 12, seniors and people needing help, lunch slots and seats, volunteer shifts and assignments, checklist.
--   B. A role that can manage events but not volunteers sees the shift numbers and a null for who is assigned.
--   C. event_reminder_audience: adults only, latest opt-in wins, a child's opt-in does not count, a household that did not RSVP is
--      not counted, guests are counted apart; a role without people or contact access gets null, not 0.
--   D. Both are security invoker, a signed-out or unrelated caller gets nothing, and an unknown event is null.
-- Everything runs as the signed-in person (row-level security) and in one transaction that is not committed.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.keep(p_name text, p_j jsonb) returns void language plpgsql as $$
begin perform set_config('t105.' || p_name, p_j::text, true); end $$;
create or replace function pg_temp.got(p_name text) returns jsonb language sql stable as $$ select current_setting('t105.' || p_name)::jsonb $$;

\set c '''10500000-0000-4000-8000-0000000000c1'''
\set u_admin '''10500000-0000-4000-8000-0000000000a1'''
\set u_comm '''10500000-0000-4000-8000-0000000000a2'''
\set u_nobody '''10500000-0000-4000-8000-0000000000a3'''
\set h1 '''10500000-0000-4000-8000-0000000000e1'''
\set h2 '''10500000-0000-4000-8000-0000000000e2'''
\set h3 '''10500000-0000-4000-8000-0000000000e3'''
\set h4 '''10500000-0000-4000-8000-0000000000e4'''
\set h5 '''10500000-0000-4000-8000-0000000000e5'''
\set pa1 '''10500000-0000-4000-8000-0000000000d1'''
\set pa2 '''10500000-0000-4000-8000-0000000000d2'''
\set pk1 '''10500000-0000-4000-8000-0000000000d3'''
\set pb1 '''10500000-0000-4000-8000-0000000000d4'''
\set pdead '''10500000-0000-4000-8000-0000000000d5'''
\set pc1 '''10500000-0000-4000-8000-0000000000d6'''
\set pc2 '''10500000-0000-4000-8000-0000000000d7'''
\set px '''10500000-0000-4000-8000-0000000000d8'''
\set ev '''10500000-0000-4000-8000-0000000000f1'''
\set r1 '''10500000-0000-4000-8000-000000000101'''
\set r2 '''10500000-0000-4000-8000-000000000102'''
\set r3 '''10500000-0000-4000-8000-000000000103'''
\set r4 '''10500000-0000-4000-8000-000000000104'''
\set r5 '''10500000-0000-4000-8000-000000000105'''
\set r6 '''10500000-0000-4000-8000-000000000106'''
\set sl1 '''10500000-0000-4000-8000-000000000201'''
\set sl2 '''10500000-0000-4000-8000-000000000202'''
\set sl3 '''10500000-0000-4000-8000-000000000203'''
\set sh1 '''10500000-0000-4000-8000-000000000301'''
\set sh2 '''10500000-0000-4000-8000-000000000302'''
\set sh3 '''10500000-0000-4000-8000-000000000303'''

-- ── Fixtures ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values (:u_admin, 'admin105@example.com'), (:u_comm, 'comm105@example.com'), (:u_nobody, 'nobody105@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values (:c, 'ev105', 'Summary Center', 'SMC', 'TX', 'active', 'America/Chicago');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:c, :u_admin, 'center_admin', 'center'), (:c, :u_comm, 'pathshala_committee', 'center');

insert into app.households (id, center_id, display_name) values (:h1, :c, 'One family'), (:h2, :c, 'Two family'), (:h3, :c, 'Three family'), (:h4, :c, 'Four family'), (:h5, :c, 'Five family');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth, is_deceased) values
  (:pa1, :c, 'Asha', 'One', 'a1@example.com', '1980-02-01', false),
  (:pa2, :c, 'Amit', 'One', 'a2@example.com', '1982-03-01', false),
  (:pk1, :c, 'Kiran', 'One', null, current_date - interval '10 years', false),
  (:pb1, :c, 'Bina', 'Two', null, '1975-04-01', false),
  (:pdead, :c, 'Dara', 'Two', null, '1950-04-01', true),
  (:pc1, :c, 'Chetan', 'Three', 'c1@example.com', null, false),
  (:pc2, :c, 'Chhaya', 'Three', 'c2@example.com', null, false),
  (:px, :c, 'Xena', 'Four', 'x@example.com', '1985-05-05', false);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :pa1, :c, 'primary', true), (:h1, :pa2, :c, 'spouse', false), (:h1, :pk1, :c, 'child', false),
  (:h2, :pb1, :c, 'primary', true), (:h2, :pdead, :c, 'spouse', false),
  (:h3, :pc1, :c, 'primary', true), (:h3, :pc2, :c, 'child', false),
  (:h4, :px, :c, 'primary', true);

-- Opt-ins: Asha email and text; Amit email then later opted out of email, and WhatsApp; the child opted in to email (must not count);
-- Bina none; Chetan email; Xena email (her household did not RSVP).
insert into app.channel_optins (center_id, person_id, channel, address, opted_in, source, recorded_at) values
  (:c, :pa1, 'email', 'a1@example.com', true, 'test', now() - interval '5 days'),
  (:c, :pa1, 'sms', '+17135550101', true, 'test', now() - interval '5 days'),
  (:c, :pa2, 'email', 'a2@example.com', true, 'test', now() - interval '5 days'),
  (:c, :pa2, 'email', 'a2@example.com', false, 'test', now() - interval '1 day'),
  (:c, :pa2, 'whatsapp', '+17135550102', true, 'test', now() - interval '2 days'),
  (:c, :pk1, 'email', 'kid@example.com', true, 'test', now() - interval '2 days'),
  (:c, :pc1, 'email', 'c1@example.com', true, 'test', now() - interval '2 days'),
  (:c, :pc2, 'email', 'c2@example.com', true, 'test', now() - interval '2 days'),
  (:c, :px, 'email', 'x@example.com', true, 'test', now() - interval '2 days');

insert into app.events (id, center_id, name, starts_at, ends_at, status, capacity, lunch_enabled) values
  (:ev, :c, 'Summary event 105', now() + interval '10 days', now() + interval '10 days 4 hours', 'published', 50, true);

insert into app.rsvps (id, center_id, event_id, household_id, status, confirmed_at, source) values
  (:r1, :c, :ev, :h1, 'rsvpd', null, 'app'),
  (:r2, :c, :ev, :h2, 'confirmed', now(), 'app'),
  (:r3, :c, :ev, :h3, 'cancelled', null, 'app'),
  (:r4, :c, :ev, null, 'rsvpd', null, 'guest_web'),
  (:r5, :c, :ev, :h5, 'waitlisted', null, 'app'),
  (:r6, :c, :ev, null, 'confirmed', now(), 'walk_in');
insert into app.lunch_slots (id, center_id, event_id, starts_at, ends_at, seats, status) values
  (:sl1, :c, :ev, now() + interval '10 days 1 hour', now() + interval '10 days 2 hours', 10, 'done'),
  (:sl2, :c, :ev, now() + interval '10 days 2 hours', now() + interval '10 days 3 hours', 20, 'scheduled'),
  (:sl3, :c, :ev, now() + interval '10 days 3 hours', now() + interval '10 days 4 hours', 1000000, 'scheduled');
-- r1: an adult and a child under 12 (the adult has a lunch slot); r2: a senior who needs help, arrived, has a slot and was served;
-- r3 (cancelled): a child; r4: one guest; r5 (waitlisted): one person; r6 (walk-in): one person, arrived.
insert into app.attendees (center_id, event_id, rsvp_id, display_name, is_child_under_12, is_senior, needs_assistance, status, checked_in_at, served_food_at, lunch_slot_id) values
  (:c, :ev, :r1, 'Guest A', false, false, false, 'rsvpd', null, null, :sl2),
  (:c, :ev, :r1, 'Guest B', true, false, false, 'rsvpd', null, null, null),
  (:c, :ev, :r2, 'Guest C', false, true, true, 'confirmed', now(), now(), :sl1),
  (:c, :ev, :r3, 'Guest D', true, false, false, 'cancelled', null, null, null),
  (:c, :ev, :r4, 'Guest E', false, false, false, 'rsvpd', null, null, null),
  (:c, :ev, :r5, 'Guest F', false, false, false, 'waitlisted', null, null, null),
  (:c, :ev, :r6, 'Guest G', false, false, false, 'confirmed', now(), null, null);

insert into app.volunteer_shifts (id, center_id, event_id, station, capacity) values
  (:sh1, :c, :ev, 'entry', 2), (:sh2, :c, :ev, 'food', 1), (:sh3, :c, :ev, 'parking', null);
insert into app.volunteer_assignments (center_id, shift_id, person_id, status) values
  (:c, :sh1, :pa1, 'assigned'), (:c, :sh1, :pb1, 'declined');

insert into app.actions (center_id, event_id, name, state, due_on) values
  (:c, :ev, 'Done thing', 'completed', current_date - 5),
  (:c, :ev, 'Late thing', 'in_progress', current_date - 2),
  (:c, :ev, 'Later thing', 'not_started', current_date + 5),
  (:c, :ev, 'Dropped thing', 'removed', current_date - 9);

-- ── A. The summary, as a center admin ────────────────────────────────────────────────
select pg_temp.sign_in(:u_admin);
select pg_temp.keep('s', app.event_summary(:ev));
select pg_temp.assert((select j->'event'->>'name' = 'Summary event 105' and (j->'event'->>'capacity')::int = 50 from (select pg_temp.got('s') as j) q), 'A1 the event is named in the answer');
select pg_temp.assert((select (j->'households'->>'rsvpd')::int = 2 and (j->'households'->>'confirmed')::int = 2
                         and (j->'households'->>'cancelled')::int = 1 and (j->'households'->>'waitlisted')::int = 1 from (select pg_temp.got('s') as j) q),
                      'A2 households by status');
select pg_temp.assert((select (j->'people'->>'households_total')::int = 6 and (j->'people'->>'walk_in_households')::int = 1 from (select pg_temp.got('s') as j) q), 'A3 six RSVPs, one walk-in');
select pg_temp.assert((select (j->'people'->>'people_rsvpd')::int = 4 and (j->'people'->>'people_confirmed')::int = 1 from (select pg_temp.got('s') as j) q),
                      'A4 four people RSVP''d (a cancelled RSVP, the walk-in and the waitlisted person left out), one of them confirmed');
select pg_temp.assert((select (j->'people'->>'people_waitlisted')::int = 1 and (j->'people'->>'walk_in_people')::int = 1 from (select pg_temp.got('s') as j) q), 'A5 one waitlisted, one walk-in');
select pg_temp.assert((select (j->'people'->>'checked_in')::int = 2 and (j->'people'->>'served')::int = 1 and (j->'people'->>'not_arrived')::int = 3 from (select pg_temp.got('s') as j) q),
                      'A6 two arrived, one served, three RSVP''d people not arrived yet');
select pg_temp.assert((select (j->'people'->>'children_under_12')::int = 1 and (j->'people'->>'seniors')::int = 1 and (j->'people'->>'needs_assistance')::int = 1 from (select pg_temp.got('s') as j) q),
                      'A7 counts of children, seniors and people needing help skip the cancelled RSVP');
select pg_temp.assert((select (j->'lunch'->>'slots')::int = 3 and (j->'lunch'->>'seats')::int = 30 and (j->'lunch'->>'unlimited_slots')::int = 1
                         and (j->'lunch'->>'assigned')::int = 2 and (j->'lunch'->>'served')::int = 1 and (j->'lunch'->>'slots_done')::int = 1 from (select pg_temp.got('s') as j) q),
                      'A8 lunch: three slots, 30 counted seats plus one unlimited slot, two seated, one served');
select pg_temp.assert((select (j->'volunteers'->>'visible')::boolean and (j->'volunteers'->>'shifts')::int = 3 and (j->'volunteers'->>'spots_needed')::int = 3
                         and (j->'volunteers'->>'assigned')::int = 1 and (j->'volunteers'->>'shifts_empty')::int = 2 and (j->'volunteers'->>'shifts_open')::int = 2 from (select pg_temp.got('s') as j) q),
                      'A9 volunteers: three shifts, three spots, one assigned (a decline does not count), two shifts empty, two still open');
select pg_temp.assert((select (j->'checklist'->>'total')::int = 3 and (j->'checklist'->>'done')::int = 1 and (j->'checklist'->>'in_progress')::int = 1
                         and (j->'checklist'->>'not_started')::int = 1 and (j->'checklist'->>'overdue')::int = 1 from (select pg_temp.got('s') as j) q),
                      'A10 checklist: removed actions are not counted, one is overdue');
select pg_temp.assert(not (select j::text ~* 'guest [a-g]|asha|amit|kiran|bina|dara|chetan|chhaya|xena' from (select pg_temp.got('s') as j) q), 'A11 the answer holds no name');
reset role;

-- ── B. A committee member: events yes, volunteers no ─────────────────────────────────────
select pg_temp.sign_in(:u_comm);
select pg_temp.keep('sb', app.event_summary(:ev));
select pg_temp.assert((select (j->'people'->>'people_rsvpd')::int = 4 from (select pg_temp.got('sb') as j) q), 'B1 the RSVP numbers are the same');
select pg_temp.assert((select not (j->'volunteers'->>'visible')::boolean
                         and j->'volunteers'->'assigned' = 'null'::jsonb and j->'volunteers'->'shifts_empty' = 'null'::jsonb from (select pg_temp.got('sb') as j) q),
                      'B2 who is assigned is null (not 0) when the role cannot see assignments');
reset role;

-- ── C. The reminder audience ─────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_admin);
select pg_temp.keep('a', app.event_reminder_audience(:ev));
-- Households that RSVP'd (rsvpd or confirmed): h1, h2 (one RSVP each); the guest RSVP and the walk-in have no household.
select pg_temp.assert((select (j->>'households')::int = 2 and (j->>'guest_rsvps')::int = 2 from (select pg_temp.got('a') as j) q), 'C1 two households, two guest RSVPs counted apart');
-- Adults: Asha, Amit (h1); Bina (h2; the deceased spouse and the child are left out).
select pg_temp.assert((select (j->>'adults')::int = 3 and (j->>'people_visible')::boolean and (j->>'channels_visible')::boolean from (select pg_temp.got('a') as j) q), 'C2 three adults');
select pg_temp.assert((select (j->>'email')::int = 1 and (j->>'sms')::int = 1 and (j->>'whatsapp')::int = 1 from (select pg_temp.got('a') as j) q),
                      'C3 email: Asha only (Amit opted out later, the child does not count); text: Asha; WhatsApp: Amit');
select pg_temp.assert((select (j->>'no_channel')::int = 1 from (select pg_temp.got('a') as j) q), 'C4 one adult (Bina) cannot be reached on any of the three');
select pg_temp.keep('ab', app.event_reminder_audience(:ev, array['confirmed']));
select pg_temp.assert((select (j->>'households')::int = 1 and (j->>'adults')::int = 1 and (j->>'guest_rsvps')::int = 1 from (select pg_temp.got('ab') as j) q), 'C5 only the confirmed: one household (Bina), the walk-in');
select pg_temp.assert(not (select j::text ~* 'asha|amit|kiran|bina|dara|chetan|xena|@example' from (select pg_temp.got('a') as j) q), 'C6 the answer holds no name or address');
reset role;

select pg_temp.sign_in(:u_comm);
select pg_temp.keep('ac', app.event_reminder_audience(:ev));
select pg_temp.assert((select (j->>'households')::int = 2 and not (j->>'people_visible')::boolean and j->'adults' = 'null'::jsonb and j->'email' = 'null'::jsonb from (select pg_temp.got('ac') as j) q),
                      'C7 a role that cannot see people gets null for adults and channels, not 0');
reset role;

-- ── D. Who can call what ──────────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_nobody);
select pg_temp.assert((select app.event_summary(:ev) is null or (app.event_summary(:ev)->'people'->>'people_rsvpd')::int = 0), 'D1 a signed-in person with no role sees no RSVP numbers');
select pg_temp.assert((select app.event_summary('10500000-0000-4000-8000-0000000009ff') is null), 'D2 an event that does not exist is null');
select pg_temp.assert((select app.event_reminder_audience('10500000-0000-4000-8000-0000000009ff') is null), 'D3 so is its audience');
reset role;
select pg_temp.assert((select bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('event_summary', 'event_reminder_audience')), 'D4 both are security invoker');
select pg_temp.assert((select count(*) = 2 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('event_summary', 'event_reminder_audience')
                          and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')),
                      'D5 signed-in people may call them, signed-out people may not');

-- ── E. 0655: the nine new Events commands are in the activity allowlist, each tied to its command ──────────────────────
select pg_temp.assert((select count(*) = 9 from app.activity_catalog c
                        where c.surface = 'portal' and c.key = 'assistant.' || replace(c.commandable_key, '.', '_')
                          and c.commandable_key in ('events.summary', 'events.readiness', 'events.audience_preview', 'events.rsvps', 'events.clone_draft',
                                                    'events.set_status', 'events.set_rsvp_status', 'events.assign_volunteer', 'events.create_from_clone')),
                      'E1 all nine are registered under assistant.<area>_<verb> with the command as commandable_key');

rollback;
