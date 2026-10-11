-- 0654: app.event_set_rsvp_status changes an RSVP and the people on it who have not arrived in ONE transaction.
--   A. A center admin: confirm, cancel and reopen an RSVP; the people who have not arrived follow, the person who has arrived does not;
--      confirmed_at and cancelled_at are stamped.
--   B. An event lead can change the RSVPs of their own event, not another event's; a person with no role changes nothing (false).
--   C. An RSVP that is not on that event is not touched (false).
--   D. All or nothing: when the second step fails, the first is undone.
--   E. The function is security invoker (row-level security decides) and signed-out callers cannot run it.
-- Everything runs as the signed-in person and in one transaction that is rolled back.
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

\set c '''10600000-0000-4000-8000-0000000000c1'''
\set u_admin '''10600000-0000-4000-8000-0000000000a1'''
\set u_lead '''10600000-0000-4000-8000-0000000000a2'''
\set u_nobody '''10600000-0000-4000-8000-0000000000a3'''
\set h1 '''10600000-0000-4000-8000-0000000000e1'''
\set ev '''10600000-0000-4000-8000-0000000000f1'''
\set ev2 '''10600000-0000-4000-8000-0000000000f2'''
\set r1 '''10600000-0000-4000-8000-000000000101'''
\set r2 '''10600000-0000-4000-8000-000000000102'''
\set at1 '''10600000-0000-4000-8000-000000000201'''
\set at2 '''10600000-0000-4000-8000-000000000202'''
\set at3 '''10600000-0000-4000-8000-000000000203'''

-- ── Fixtures ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values (:u_admin, 'admin106@example.com'), (:u_lead, 'lead106@example.com'), (:u_nobody, 'nobody106@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values (:c, 'ev106', 'RSVP Status Center', 'RSC', 'TX', 'active', 'America/Chicago');
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Status family');
insert into app.events (id, center_id, name, starts_at, status) values
  (:ev, :c, 'RSVP status event 106', now() + interval '5 days', 'published'),
  (:ev2, :c, 'Another event 106', now() + interval '6 days', 'published');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:c, :u_admin, 'center_admin', 'center');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values (:c, :u_lead, 'event_lead', 'event', :ev);
insert into app.rsvps (id, center_id, event_id, household_id, status) values (:r1, :c, :ev, :h1, 'rsvpd'), (:r2, :c, :ev2, :h1, 'rsvpd');
-- r1 has two people who have not arrived and one who has.
insert into app.attendees (id, center_id, event_id, rsvp_id, display_name, status, checked_in_at) values
  (:at1, :c, :ev, :r1, 'Person One', 'rsvpd', null),
  (:at2, :c, :ev, :r1, 'Person Two', 'rsvpd', null),
  (:at3, :c, :ev, :r1, 'Person Three', 'rsvpd', now());

-- ── A. A center admin ────────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_admin);
select pg_temp.assert(app.event_set_rsvp_status(:ev, :r1, 'confirmed'), 'A1 confirming an RSVP returns true');
reset role;
select pg_temp.assert((select status = 'confirmed' and confirmed_at is not null and cancelled_at is null from app.rsvps where id = :r1), 'A2 the RSVP is confirmed and stamped');
select pg_temp.assert((select count(*) = 2 from app.attendees where rsvp_id = :r1 and status = 'confirmed' and checked_in_at is null), 'A3 the two people who had not arrived are confirmed');
select pg_temp.assert((select status = 'rsvpd' from app.attendees where id = :at3), 'A4 the person who had arrived keeps their status');
select pg_temp.sign_in(:u_admin);
select pg_temp.assert(app.event_set_rsvp_status(:ev, :r1, 'cancelled'), 'A5 cancelling returns true');
reset role;
select pg_temp.assert((select status = 'cancelled' and cancelled_at is not null from app.rsvps where id = :r1), 'A6 the RSVP is cancelled and stamped');
select pg_temp.assert((select count(*) = 2 from app.attendees where rsvp_id = :r1 and status = 'cancelled' and checked_in_at is null), 'A7 the two people who had not arrived are cancelled');
select pg_temp.sign_in(:u_admin);
select pg_temp.assert(app.event_set_rsvp_status(:ev, :r1, 'rsvpd'), 'A8 reopening returns true');
reset role;
select pg_temp.assert((select status = 'rsvpd' from app.rsvps where id = :r1) and (select count(*) = 3 from app.attendees where rsvp_id = :r1 and status = 'rsvpd'), 'A9 everyone is back to RSVP''d');

-- ── B. Event lead, and a person with no role ───────────────────────────────────────────
select pg_temp.sign_in(:u_lead);
select pg_temp.assert(app.event_set_rsvp_status(:ev, :r1, 'confirmed'), 'B1 an event lead can change the RSVPs of their own event');
select pg_temp.assert(not app.event_set_rsvp_status(:ev2, :r2, 'confirmed'), 'B2 but not another event''s');
reset role;
select pg_temp.assert((select status = 'rsvpd' from app.rsvps where id = :r2), 'B3 the other event''s RSVP is untouched');
select pg_temp.sign_in(:u_nobody);
select pg_temp.assert(not app.event_set_rsvp_status(:ev, :r1, 'cancelled'), 'B4 a person with no role changes nothing');
reset role;
select pg_temp.assert((select status = 'confirmed' from app.rsvps where id = :r1), 'B5 the RSVP is as the event lead left it');

-- ── C. An RSVP of another event ───────────────────────────────────────────────────────
select pg_temp.sign_in(:u_admin);
select pg_temp.assert(not app.event_set_rsvp_status(:ev, :r2, 'cancelled'), 'C1 an RSVP that is not on this event is not touched');
reset role;
select pg_temp.assert((select status = 'rsvpd' from app.rsvps where id = :r2), 'C2 and stays RSVP''d');

-- ── D. All or nothing ─────────────────────────────────────────────────────────────────
create function app.t106_boom() returns trigger language plpgsql as $$ begin raise exception 'boom: the second step failed'; end $$;
create trigger t106_boom before update on app.attendees for each row execute function app.t106_boom();
do $$
declare v_failed boolean := false;
begin
  begin
    perform app.event_set_rsvp_status('10600000-0000-4000-8000-0000000000f1', '10600000-0000-4000-8000-000000000101', 'no_show');
  exception when others then
    v_failed := sqlerrm like 'boom%';
  end;
  perform pg_temp.assert(v_failed, 'D1 the call fails when the second step fails');
end $$;
select pg_temp.assert((select status = 'confirmed' and cancelled_at is null from app.rsvps where id = :r1), 'D2 and the RSVP is as it was: the first step was undone');
drop trigger t106_boom on app.attendees;

-- ── E. Who can call it ────────────────────────────────────────────────────────────────
select pg_temp.assert((select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname = 'event_set_rsvp_status'), 'E1 it is security invoker');
select pg_temp.assert((select has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'event_set_rsvp_status'),
                      'E2 signed-in people may call it, signed-out people may not');

rollback;
