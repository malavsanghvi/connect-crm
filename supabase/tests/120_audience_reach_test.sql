-- 0660: app.audience_reach, the per-channel counts behind a message's audience preview (B90 phase 4, Messages).
--   A. The compose form's segments: all members, a zone, life members, an event's RSVPs; a household in two segments is counted once.
--   B. Adults only: a child (by birth date, or by the household role when there is no birth date) and a deceased person are never
--      counted, and a child's opt-in is never read; the latest opt-in of each person and channel wins; an address must be on file;
--      a withdrawn consent leaves a person out of that channel.
--   C. Custom-field segments are not resolved here and the answer says so; an empty audience matches nobody.
--   D. A role that may send messages but may not see people gets people_visible=false and nulls, not zeros; a person with no
--      messaging role, and a missing community, get null.
--   E. The answer holds no name, address or number; the function is security invoker and callable by signed-in people only.
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
begin perform set_config('t120.' || p_name, p_j::text, true); end $$;
create or replace function pg_temp.got(p_name text) returns jsonb language sql stable as $$ select current_setting('t120.' || p_name)::jsonb $$;
-- The five numbers of an answer, in one comparable string: households, adults, email, text, WhatsApp, nobody-reachable.
create or replace function pg_temp.nums(p_name text) returns text language sql stable as $$
  select concat_ws('/', j->>'households', j->>'adults', j->>'email', j->>'sms', j->>'whatsapp', j->>'no_channel') from (select pg_temp.got(p_name) as j) q $$;

\set c '''12000000-0000-4000-8000-0000000000c1'''
\set u_admin '''12000000-0000-4000-8000-0000000000a1'''
\set u_comm '''12000000-0000-4000-8000-0000000000a2'''
\set u_nobody '''12000000-0000-4000-8000-0000000000a3'''
\set z1 '''12000000-0000-4000-8000-0000000000b1'''
\set z2 '''12000000-0000-4000-8000-0000000000b2'''
\set h1 '''12000000-0000-4000-8000-0000000000e1'''
\set h2 '''12000000-0000-4000-8000-0000000000e2'''
\set h3 '''12000000-0000-4000-8000-0000000000e3'''
\set h4 '''12000000-0000-4000-8000-0000000000e4'''
\set pa1 '''12000000-0000-4000-8000-0000000000d1'''
\set pa2 '''12000000-0000-4000-8000-0000000000d2'''
\set pk1 '''12000000-0000-4000-8000-0000000000d3'''
\set pb1 '''12000000-0000-4000-8000-0000000000d4'''
\set pdead '''12000000-0000-4000-8000-0000000000d5'''
\set pc1 '''12000000-0000-4000-8000-0000000000d6'''
\set pc2 '''12000000-0000-4000-8000-0000000000d7'''
\set px '''12000000-0000-4000-8000-0000000000d8'''
\set mt_y '''12000000-0000-4000-8000-0000000000f1'''
\set mt_l '''12000000-0000-4000-8000-0000000000f2'''
\set ev '''12000000-0000-4000-8000-0000000000f3'''

-- ── Fixtures ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values (:u_admin, 'admin120@example.com'), (:u_comm, 'comm120@example.com'), (:u_nobody, 'nobody120@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values (:c, 'ar120', 'Reach Center', 'RCH', 'TX', 'active', 'America/Chicago');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:c, :u_admin, 'center_admin', 'center'), (:c, :u_comm, 'communications_officer', 'center');

insert into app.zones (id, center_id, name) values (:z1, :c, 'North'), (:z2, :c, 'South');
insert into app.households (id, center_id, display_name, zone_id) values
  (:h1, :c, 'One family', :z1), (:h2, :c, 'Two family', :z1), (:h3, :c, 'Three family', :z2), (:h4, :c, 'Four family', :z2);
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

-- h1, h2 (life) and h3 hold an active membership; h4 does not.
insert into app.membership_types (id, center_id, key, name, tier) values (:mt_y, :c, 'yearly', 'Yearly', 'yearly'), (:mt_l, :c, 'life', 'Life', 'life');
insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on) values
  (:c, :h1, :pa1, :mt_y, 'yearly', 'active', '2025-01-01'),
  (:c, :h2, :pb1, :mt_l, 'life', 'active', '2025-01-01'),
  (:c, :h3, :pc1, :mt_y, 'yearly', 'active', '2025-01-01');

-- Opt-ins: Asha email and text; Amit email then later opted out of email, and WhatsApp; the child opted in to email (must not count);
-- Bina none; Chetan email, but he withdrew his consent for marketing email; Chhaya (a child by her household role) email; Xena email.
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
insert into app.consents (center_id, person_id, kind, granted, recorded_at) values
  (:c, :pc1, 'marketing_email', true, now() - interval '30 days'),
  (:c, :pc1, 'marketing_email', false, now() - interval '3 days');

insert into app.events (id, center_id, name, starts_at, ends_at, status, capacity, lunch_enabled)
  values (:ev, :c, 'Reach event 120', now() + interval '10 days', now() + interval '10 days 4 hours', 'published', 50, false);
insert into app.rsvps (center_id, event_id, household_id, status, source) values
  (:c, :ev, :h4, 'rsvpd', 'app'), (:c, :ev, :h3, 'cancelled', 'app');

-- ── A. The compose form's segments ────────────────────────────────────────────────────
select pg_temp.sign_in(:u_admin);
-- All members: h1, h2, h3. Adults: Asha, Amit, Bina, Chetan (the child, the deceased and Chhaya, a child by her role, are left out).
-- Email: Asha only (Amit opted out later, Chetan withdrew consent, the child does not count). Text: Asha. WhatsApp: Amit.
-- Reachable on none: Bina and Chetan.
select pg_temp.keep('all', app.audience_reach(:c, '{"all_members": true}'));
select pg_temp.assert(pg_temp.nums('all') = '3/4/1/1/1/2', 'A1 all members: 3 households, 4 adults, email 1, text 1, WhatsApp 1, none 2');
select pg_temp.assert((select (j->>'people_visible')::boolean and not (j->>'custom_fields_not_counted')::boolean from (select pg_temp.got('all') as j) q), 'A2 people are visible and nothing was left out');
select pg_temp.keep('zone', app.audience_reach(:c, jsonb_build_object('zone_ids', jsonb_build_array(:z1::text))));
select pg_temp.assert(pg_temp.nums('zone') = '2/3/1/1/1/1', 'A3 the North zone: h1 and h2, three adults, Bina cannot be reached');
select pg_temp.keep('zone2', app.audience_reach(:c, jsonb_build_object('zone_ids', jsonb_build_array(:z2::text))));
select pg_temp.assert(pg_temp.nums('zone2') = '2/2/1/0/0/1', 'A4 the South zone: Xena by email; Chetan withdrew his consent');
select pg_temp.keep('life', app.audience_reach(:c, '{"membership_tiers": ["life"]}'));
select pg_temp.assert(pg_temp.nums('life') = '1/1/0/0/0/1', 'A5 life members: Bina, nobody reachable');
select pg_temp.keep('both', app.audience_reach(:c, jsonb_build_object('zone_ids', jsonb_build_array(:z1::text), 'membership_tiers', jsonb_build_array('life'))));
select pg_temp.assert(pg_temp.nums('both') = '2/3/1/1/1/1', 'A6 a household in two segments (h2 is North and life) is counted once');
select pg_temp.keep('event', app.audience_reach(:c, jsonb_build_object('event_id', :ev::text, 'rsvp_statuses', jsonb_build_array('rsvpd'))));
select pg_temp.assert(pg_temp.nums('event') = '1/1/1/0/0/0', 'A7 the RSVPs of an event: h4 only (a cancelled RSVP does not count), Xena by email');
select pg_temp.keep('event_all', app.audience_reach(:c, jsonb_build_object('event_id', :ev::text)));
select pg_temp.assert(pg_temp.nums('event_all') = '2/2/1/0/0/1', 'A8 with no RSVP status chosen every RSVP counts: h3 and h4, two adults, Xena by email');

-- ── B/C. Custom fields and the empty audience ──────────────────────────────────────────
select pg_temp.keep('custom', app.audience_reach(:c, '{"custom_fields": [{"entity": "people", "key": "volunteer", "value": true}]}'));
select pg_temp.assert((select (j->>'custom_fields_not_counted')::boolean and (j->>'households')::int = 0 from (select pg_temp.got('custom') as j) q), 'C1 a custom-field segment is not resolved here, and the answer says so');
select pg_temp.assert((select (app.audience_reach(:c, '{}')->>'households')::int = 0 and (app.audience_reach(:c, null)->>'households')::int = 0), 'C2 an empty audience matches nobody');
select pg_temp.assert((select app.audience_reach(null, '{"all_members": true}') is null), 'C3 no community is null');
reset role;

-- ── D. Who can ask ──────────────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_comm);
select pg_temp.keep('comm', app.audience_reach(:c, '{"all_members": true}'));
select pg_temp.assert((select not (j->>'people_visible')::boolean and j->'households' = 'null'::jsonb and j->'adults' = 'null'::jsonb
                              and j->'email' = 'null'::jsonb and j->'no_channel' = 'null'::jsonb from (select pg_temp.got('comm') as j) q),
                      'D1 a role that may send messages but not see people gets nulls, not zeros');
reset role;
select pg_temp.sign_in(:u_nobody);
select pg_temp.assert((select app.audience_reach(:c, '{"all_members": true}') is null), 'D2 a signed-in person with no messaging role gets null');
reset role;

-- ── E. What is in the answer, and who may call it ──────────────────────────────────────
select pg_temp.assert(not (select j::text ~* 'asha|amit|kiran|bina|dara|chetan|chhaya|xena|@example|\+1713' from (select pg_temp.got('all') as j) q), 'E1 the answer holds no name, address or number');
select pg_temp.assert((select bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'audience_reach'), 'E2 it is security invoker');
select pg_temp.assert((select bool_and(p.provolatile = 's') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'audience_reach'), 'E3 it is stable: it changes nothing');
select pg_temp.assert((select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname = 'audience_reach'
                          and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')),
                      'E4 signed-in people may call it, signed-out people may not');

rollback;
