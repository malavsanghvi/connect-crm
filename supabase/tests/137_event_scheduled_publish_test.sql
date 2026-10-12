-- 0700 / 0701: publishing an event at a chosen time (the event creator's flyer and publish panel).
--   A. The columns, the trigger and who may set a schedule (the existing policies: the event's editors, never a member)
--   B. The background service publishes a due event whose approved flyer still matches it, and only when it is due
--   C. It never publishes an event edited into a state that cannot be published: each reason is kept in publish_failure
--   D. An event that leaves draft forgets its schedule; a cancelled one is never brought back
--   E. Who may call what; search_path; the activity keys (0701)
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', 'aal1',
    'amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)))::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- The background service's call, as the worker role.
create or replace function pg_temp.publish_due() returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  r := app.worker_events_publish_due(50);
  reset role;
  return r;
end $$;
-- A flyer approved for the event as it is now (what the portal writes when a person approves it).
create or replace function pg_temp.approve(p_event uuid) returns void language sql as $$
  update app.events
     set flyer_source = 'designed',
         flyer_path = center_id::text || '/events/' || id::text || '/flyer-1.png',
         flyer_design = jsonb_build_object(
           'v', 1, 'template', 'poster', 'size', 'tall', 'headline', name,
           'made_for', jsonb_build_object('starts_at', starts_at, 'ends_at', ends_at,
                                          'venue', btrim(regexp_replace(coalesce(venue, ''), '\s+', ' ', 'g'))),
           'approval', jsonb_build_object('v', 1, 'at', now(), 'by', '13700000-0000-4000-8000-0000000000a2', 'name', name, 'key', 'k1'))
   where id = p_event $$;
grant connect_worker to postgres;

\set c '''13700000-0000-4000-8000-0000000000c1'''
\set u_lead '''13700000-0000-4000-8000-0000000000a2'''
\set u_member '''13700000-0000-4000-8000-0000000000a3'''
\set member '''13700000-0000-4000-8000-0000000000d1'''
\set ev_ok '''13700000-0000-4000-8000-0000000000e1'''
\set ev_later '''13700000-0000-4000-8000-0000000000e2'''
\set ev_none '''13700000-0000-4000-8000-0000000000e3'''
\set ev_moved '''13700000-0000-4000-8000-0000000000e4'''
\set ev_venue '''13700000-0000-4000-8000-0000000000e5'''
\set ev_renamed '''13700000-0000-4000-8000-0000000000e6'''
\set ev_past '''13700000-0000-4000-8000-0000000000e7'''
\set ev_paid '''13700000-0000-4000-8000-0000000000e8'''
\set ev_cancel '''13700000-0000-4000-8000-0000000000e9'''
\set ev_manual '''13700000-0000-4000-8000-0000000000ea'''

select pg_temp.no_claims();
insert into auth.users (id, email) values (:u_lead, 'lead137@chamber.test'), (:u_member, 'member137@chamber.test');
-- A chamber of commerce: a staff member with the event-lead role across the community, and a member.
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c, 'chamber137', 'Riverside Chamber 137', 'RC', 'TX', 'active', 'America/Chicago');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:member, :c, 'Amara', 'Okafor', date '1979-04-02');
insert into app.center_users (center_id, user_id, person_id) values (:c, :u_member, :member);
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values (:c, :u_lead, 'event_lead', 'center', 'test 137');

insert into app.events (id, center_id, name, starts_at, ends_at, venue, status) values
  (:ev_ok,      :c, 'Small Business Expo',  now() + interval '20 days', now() + interval '20 days 3 hours', 'Main  Hall', 'draft'),
  (:ev_later,   :c, 'Spring Mixer',         now() + interval '30 days', null,                                'Terrace',    'draft'),
  (:ev_none,    :c, 'Awards Night',         now() + interval '25 days', null,                                'Ballroom',   'draft'),
  (:ev_moved,   :c, 'Leaders Breakfast',    now() + interval '12 days', null,                                'Cafe',       'draft'),
  (:ev_venue,   :c, 'Job Fair',             now() + interval '14 days', null,                                'Library',    'draft'),
  (:ev_renamed, :c, 'Golf Day',             now() + interval '16 days', null,                                'Links',      'draft'),
  (:ev_past,    :c, 'Morning Coffee',       now() + interval '2 hours', null,                                'Lobby',      'draft'),
  (:ev_paid,    :c, 'Gala Dinner',          now() + interval '40 days', null,                                'Hotel',      'draft'),
  (:ev_cancel,  :c, 'Ribbon Cutting',       now() + interval '9 days',  null,                                'Plaza',      'draft'),
  (:ev_manual,  :c, 'Networking Lunch',     now() + interval '8 days',  null,                                'Bistro',     'draft');
select pg_temp.approve(id) from app.events where center_id = :c and id <> :ev_none;

-- ══ A. The columns, the trigger, who may set a schedule ════════════════════
select pg_temp.assert((select count(*) = 2 from information_schema.columns
                        where table_schema = 'app' and table_name = 'events' and column_name in ('publish_at', 'publish_failure') and is_nullable = 'YES'),
  'A · events has publish_at and publish_failure, both nullable');
select pg_temp.assert(exists (select 1 from pg_trigger where tgrelid = 'app.events'::regclass and tgname = 'events_forget_publish_schedule' and not tgisinternal),
  'A · the trigger that clears a schedule when the event leaves draft is installed');

set role authenticated;
select pg_temp.claims(:u_lead);
with u as (update app.events set publish_at = now() - interval '1 minute' where id = :ev_ok returning id)
select pg_temp.assert((select count(*) = 1 from u), 'A · the event lead (the existing policy) may schedule the draft');
select pg_temp.claims(:u_member);
with u as (update app.events set publish_at = now() where id = :ev_later returning id)
select pg_temp.assert((select count(*) = 0 from u), 'A · a member may not schedule an event (nothing is updated)');
reset role;
select pg_temp.no_claims();

-- Scheduled for the past minute (due now): all but the later one.
update app.events set publish_at = now() - interval '1 minute'
 where center_id = :c and id not in (:ev_later, :ev_ok);
update app.events set publish_at = now() + interval '2 days' where id = :ev_later;

-- The edits that make an event unpublishable, after the flyer was approved.
update app.events set starts_at = starts_at + interval '1 day' where id = :ev_moved;
update app.events set venue = 'Town Library' where id = :ev_venue;
update app.events set name = 'Charity Golf Day' where id = :ev_renamed;
update app.events set starts_at = now() - interval '1 hour' where id = :ev_past;
update app.events set is_paid = true, member_price_cents = null where id = :ev_paid;

-- ══ D (first part). Leaving draft forgets the schedule ══════════════════════
update app.events set status = 'cancelled' where id = :ev_cancel;
update app.events set status = 'published' where id = :ev_manual;
select pg_temp.assert((select publish_at is null and status = 'cancelled' from app.events where id = :ev_cancel),
  'D · a cancelled event forgets its schedule');
select pg_temp.assert((select publish_at is null and status = 'published' from app.events where id = :ev_manual),
  'D · an event published by hand forgets its schedule (it is never published twice)');
update app.events set publish_at = now() - interval '1 minute' where id = :ev_cancel;
select pg_temp.assert((select publish_at is null from app.events where id = :ev_cancel),
  'D · a schedule cannot be put back on an event that is not a draft');

-- ══ B and C. The background service ═════════════════════════════════════════
select pg_temp.assert((select (r ->> 'published')::int = 1 and (r ->> 'refused')::int = 6 and (r ->> 'more')::boolean = false
                         from (select pg_temp.publish_due() as r) x),
  'B · one due event is published, six are refused, nothing more is waiting');
select pg_temp.assert((select status = 'published' and publish_at is null and publish_failure is null from app.events where id = :ev_ok),
  'B · the event whose approved flyer still matches it is published, and its schedule is cleared');
select pg_temp.assert((select status = 'draft' and publish_at is not null and publish_failure is null from app.events where id = :ev_later),
  'B · an event scheduled for later is left alone');

select pg_temp.assert((select status = 'draft' and publish_at is null and publish_failure like 'Not published at the scheduled time: %flyer is no longer the one that was approved%'
                         from app.events where id = :ev_none),
  'C · without an approved flyer: not published, and the reason says to approve the flyer');
select pg_temp.assert((select status = 'draft' and publish_failure like '%date or time changed after the flyer was approved%' from app.events where id = :ev_moved),
  'C · moved to another day after the approval: not published (the flyer shows the old date)');
select pg_temp.assert((select status = 'draft' and publish_failure like '%venue changed after the flyer was approved%' from app.events where id = :ev_venue),
  'C · a new venue after the approval: not published');
select pg_temp.assert((select status = 'draft' and publish_failure like '%name changed after the flyer was approved%' from app.events where id = :ev_renamed),
  'C · renamed after the approval: not published');
select pg_temp.assert((select status = 'draft' and publish_failure like '%start time had already passed%' from app.events where id = :ev_past),
  'C · an event whose start has passed is never published');
select pg_temp.assert((select status = 'draft' and publish_failure like '%paid event with no member price%' from app.events where id = :ev_paid),
  'C · a paid event without a member price is not published (the same blocker as the portal)');
select pg_temp.assert((select status = 'cancelled' from app.events where id = :ev_cancel),
  'D · the cancelled event was not brought back');

-- A second run finds nothing due: no event is published twice and a refusal is not repeated.
select pg_temp.assert((select (r ->> 'published')::int = 0 and (r ->> 'refused')::int = 0 from (select pg_temp.publish_due() as r) x),
  'B · a second run finds nothing to do');
-- Scheduling again (what the panel does on Try again) clears nothing by itself; publishing clears the old failure.
update app.events set is_paid = false, publish_at = now() - interval '1 minute', publish_failure = null where id = :ev_paid;
select pg_temp.assert((select (r ->> 'published')::int = 1 from (select pg_temp.publish_due() as r) x)
                      and (select status = 'published' and publish_failure is null from app.events where id = :ev_paid),
  'B · fixed and scheduled again, it is published');

-- ══ E. Who may call what ═══════════════════════════════════════════════════
select pg_temp.assert(has_function_privilege('connect_worker', 'app.worker_events_publish_due(integer)', 'execute')
                      and not has_function_privilege('service_role', 'app.worker_events_publish_due(integer)', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_events_publish_due(integer)', 'execute')
                      and not has_function_privilege('anon', 'app.worker_events_publish_due(integer)', 'execute'),
  'E · the publish run is the worker role''s alone');
select pg_temp.assert(not has_function_privilege('authenticated', 'app._event_publish_problem(app.events)', 'execute')
                      and not has_function_privilege('anon', 'app._event_publish_problem(app.events)', 'execute'),
  'E · the check is not callable over the API');
set role authenticated;
select pg_temp.claims(:u_lead);
do $$
begin
  perform app.worker_events_publish_due(10);
  raise exception 'FAIL: E · a signed-in person ran the worker function';
exception when insufficient_privilege then
  raise notice 'PASS: E · a signed-in person cannot run the worker function';
end $$;
reset role;
select pg_temp.no_claims();
select pg_temp.assert((select count(*) = 3 and bool_and(exists (select 1 from unnest(p.proconfig) as g(setting)
                                                                 where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('events_forget_publish_schedule', '_event_publish_problem', 'worker_events_publish_due')),
  'E · every new function pins search_path = app, public, extensions');
select pg_temp.assert((select count(*) = 4 from app.activity_catalog
                        where surface = 'portal' and kind = 'action' and entity_kind = 'event'
                          and key in ('events.flyer_approve', 'events.flyer_unapprove', 'events.publish_schedule', 'events.publish_unschedule')),
  'E · 0701 lists the panel''s four action keys');

rollback;
