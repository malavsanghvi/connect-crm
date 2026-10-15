-- 0822 / 0823: RSVP without signing in (docs/RSVP_WITHOUT_LOGIN.md). Everything a guest can do runs as the role `anon`.
--   A. The masks (the table of the plan, and the rule over generated words)
--   B. The two switches: the community's rule, the event's column, the trigger that keeps them honest, who may set it
--   C. The lookup in mode `open`: the masked family, the masked contacts, and every kind of "no"
--   D. Which events a guest may RSVP to (paid, confidential, members only, closed, draft, switch off, community not open)
--   E. Saving: what is stored, the confirmation email to the address ON FILE, one RSVP per family, all-or-nothing
--   F. Capacity and the share of places an unverified RSVP may hold
--   G. The emailed link and the handle: view, verify, cancel, undo, too late
--   H. Every limit
--   I. Who may call what; nothing leaves that the plan did not list; no phone or email stored or logged
--   J. Staff: who verifies; the old registration email is not sent twice
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- A visit from this address, with the counters empty (so a section is not held back by an earlier one).
create or replace function pg_temp.fresh(p_ip text default '203.0.113.5') returns void language plpgsql as $$
begin
  delete from app.rsvp_contact_attempts;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.headers', jsonb_build_object('x-forwarded-for', p_ip)::text, true);
end $$;
create or replace function pg_temp.visit(p_ip text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', jsonb_build_object('x-forwarded-for', p_ip)::text, true);
end $$;
create or replace function pg_temp.keys(j jsonb) returns text language sql as $$
  select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(j) k
$$;
-- Which real names, emails or phone numbers of the fixtures appear in an answer (the handle aside): none, as '' .
create or replace function pg_temp.leaks(j jsonb) returns text language sql as $$
  select coalesce(string_agg(w, ',' order by w), '')
    from unnest(array['Mira', 'Kiran', 'Aarav', 'Isha', 'Shah', 'Nina', 'Omar', 'Rao', 'Patel', 'mira822', 'kiran822', 'isha822', 'nina822',
                      'family.test', '7135550142', '7135550143', '7135550199', '7135550160', '713555']) w
   where (j - 'handle')::text ilike '%' || w || '%'
$$;
create or replace function pg_temp.has_uuid(j jsonb) returns boolean language sql as $$
  select (j - 'handle')::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
$$;

\set c '82200000-0000-4000-8000-0000000000c1'
\set c2 '82200000-0000-4000-8000-0000000000c2'
\set c3 '82200000-0000-4000-8000-0000000000c3'
\set c4 '82200000-0000-4000-8000-0000000000c4'
\set h1 '82200000-0000-4000-8000-0000000000a1'
\set h2 '82200000-0000-4000-8000-0000000000a2'
\set h3 '82200000-0000-4000-8000-0000000000a3'
\set h4 '82200000-0000-4000-8000-0000000000a4'
\set h5 '82200000-0000-4000-8000-0000000000a5'
\set h6 '82200000-0000-4000-8000-0000000000a6'
\set h7 '82200000-0000-4000-8000-0000000000a7'
\set h8 '82200000-0000-4000-8000-0000000000a8'
\set h9 '82200000-0000-4000-8000-0000000000a9'
\set pm '82200000-0000-4000-8000-000000000001'
\set pk '82200000-0000-4000-8000-000000000002'
\set pa '82200000-0000-4000-8000-000000000003'
\set pi '82200000-0000-4000-8000-000000000004'
\set pd '82200000-0000-4000-8000-000000000005'
\set pn '82200000-0000-4000-8000-000000000006'
\set po '82200000-0000-4000-8000-000000000007'
\set pt1 '82200000-0000-4000-8000-000000000008'
\set pt2 '82200000-0000-4000-8000-000000000009'
\set pg '82200000-0000-4000-8000-00000000000a'
\set pdead '82200000-0000-4000-8000-00000000000b'
\set pmerged '82200000-0000-4000-8000-00000000000c'
\set pleft '82200000-0000-4000-8000-00000000000d'
\set pfar '82200000-0000-4000-8000-00000000000e'
\set pkim '82200000-0000-4000-8000-00000000000f'
\set plee '82200000-0000-4000-8000-000000000010'
\set ev '82200000-0000-4000-8000-0000000000e1'
\set ev_cap '82200000-0000-4000-8000-0000000000e2'
\set ev_quota '82200000-0000-4000-8000-0000000000e3'
\set ev_full '82200000-0000-4000-8000-0000000000e4'
\set ev_off '82200000-0000-4000-8000-0000000000e5'
\set ev_paid '82200000-0000-4000-8000-0000000000e6'
\set ev_conf '82200000-0000-4000-8000-0000000000e7'
\set ev_members '82200000-0000-4000-8000-0000000000e8'
\set ev_draft '82200000-0000-4000-8000-0000000000e9'
\set ev_closed '82200000-0000-4000-8000-0000000000ea'
\set ev_done '82200000-0000-4000-8000-0000000000eb'
\set ev_past '82200000-0000-4000-8000-0000000000ec'
\set ev_onb '82200000-0000-4000-8000-0000000000ed'
\set ev_other '82200000-0000-4000-8000-0000000000ee'
\set ev_code '82200000-0000-4000-8000-0000000000ef'
\set ev_c3 '82200000-0000-4000-8000-0000000000f3'
\set ev_susp '82200000-0000-4000-8000-0000000000f4'
\set ev_b '82200000-0000-4000-8000-0000000000f5'
\set c5 '82200000-0000-4000-8000-0000000000c5'
\set u_lead '82200000-0000-4000-8000-0000000000f1'
\set u_nobody '82200000-0000-4000-8000-0000000000f2'

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- c: the community (RSVP without signing in allowed in every mode). c2: another community. c3: allows only the code. c4: still being set up.
insert into auth.users (id, email) values (:'u_lead', 'lead822@example.com'), (:'u_nobody', 'nobody822@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, environment, time_zone, rules) values
  (:'c',  'rc822',  'RSVP Contact 822', 'RC822', 'TX', 'active',     'production', 'America/Chicago', '{"rsvp": {"contact_lookup": "open"}}'::jsonb),
  (:'c2', 'rc822b', 'Elsewhere 822',    'E822',  'TX', 'active',     'production', 'America/Chicago', '{"rsvp": {"contact_lookup": "open"}}'::jsonb),
  (:'c3', 'rc822c', 'Code Only 822',    'C822',  'TX', 'active',     'production', 'America/Chicago', '{"rsvp": {"contact_lookup": "code"}}'::jsonb),
  (:'c4', 'rc822d', 'Being Set Up 822', 'B822',  'TX', 'onboarding', 'production', 'America/Chicago', '{"rsvp": {"contact_lookup": "open"}}'::jsonb),
  (:'c5', 'rc822e', 'Suspended 822',    'S822',  'TX', 'suspended',  'production', 'America/Chicago', '{"rsvp": {"contact_lookup": "open"}}'::jsonb);
insert into app.households (id, center_id, display_name) values
  (:'h1', :'c', 'Shah family 822'), (:'h2', :'c', 'Patel family 822'), (:'h3', :'c', 'Rao family 822'), (:'h4', :'c', 'Lee A 822'),
  (:'h5', :'c', 'Lee B 822'), (:'h6', :'c', 'Gray family 822'), (:'h7', :'c', 'Seat holders 822'), (:'h8', :'c2', 'Elsewhere family 822'),
  (:'h9', :'c', 'Ng family 822');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email, phone_e164) values
  (:'pm',  :'c', 'Mira',  'Shah', date '1980-03-04', 'mira822@family.test',  '+17135550142'),
  (:'pk',  :'c', 'Kiran', 'Shah', date '1978-06-01', 'kiran822@family.test', '+17135550143'),
  (:'pa',  :'c', 'Aarav', 'Shah', (current_date - interval '8 years')::date, null, '+17135550199'),
  (:'pi',  :'c', 'Isha',  'Shah', (current_date - interval '16 years')::date, 'isha822@family.test', null),
  (:'pd',  :'c', 'Dev',   'Patel', date '1970-01-01', null, '+17135550150'),
  (:'pn',  :'c', 'Nina',  'Rao',  date '1985-05-05', 'nina822@family.test', '+17135550160'),
  (:'po',  :'c', 'Omar',  'Rao',  date '1984-04-04', null, '+17135550160'),
  (:'pt1', :'c', 'Tara',  'Lee',  date '1990-01-01', 'tara822@family.test', '+17135550170'),
  (:'pt2', :'c', 'Tom',   'Lee',  date '1991-01-01', 'tom822@family.test',  '+17135550170'),
  (:'pg',  :'c', 'Sam',   'Gray', date '1975-01-01', 'sam822@family.test',  '+17135550171'),
  (:'pkim', :'c', 'Kim',  'Ng',   date '1992-02-02', 'kim822@family.test',  '+17135550175'),
  (:'plee', :'c', 'Lee',  'Ng',   date '1991-01-01', null, null),
  (:'pfar', :'c2', 'Faraway', 'Person', date '1980-01-01', 'far822@family.test', '+17135550190');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, phone_e164, is_deceased, deceased_on) values
  (:'pdead', :'c', 'Old', 'Gone', date '1940-01-01', '+17135550180', true, current_date - 30);
insert into app.people (id, center_id, first_name, last_name, date_of_birth, phone_e164, merged_into_id) values
  (:'pmerged', :'c', 'Mira', 'Shah Duplicate', date '1980-03-04', '+17135550181', :'pm');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, phone_e164) values
  (:'pleft', :'c', 'Left', 'Member', date '1980-01-01', '+17135550182');
insert into app.household_members (household_id, person_id, center_id, role, is_primary, left_at) values
  (:'h1', :'pm', :'c', 'primary', true, null), (:'h1', :'pk', :'c', 'spouse', false, null),
  (:'h1', :'pa', :'c', 'child', false, null), (:'h1', :'pi', :'c', 'child', false, null),
  (:'h2', :'pd', :'c', 'primary', true, null), (:'h2', :'pdead', :'c', 'other', false, null),
  (:'h2', :'pmerged', :'c', 'other', false, null), (:'h2', :'pleft', :'c', 'other', false, current_date - 1),
  (:'h3', :'pn', :'c', 'primary', true, null), (:'h3', :'po', :'c', 'spouse', false, null),
  (:'h4', :'pt1', :'c', 'primary', true, null), (:'h5', :'pt2', :'c', 'primary', true, null),
  (:'h6', :'pg', :'c', 'primary', true, null),
  (:'h8', :'pfar', :'c2', 'primary', true, null),
  (:'h9', :'pkim', :'c', 'primary', true, null), (:'h9', :'plee', :'c', 'spouse', false, null);
-- The Gray family opted out of email.
insert into app.channel_optins (center_id, person_id, channel, address, opted_in, source) values (:'c', :'pg', 'email', 'sam822@family.test', false, 'admin');

insert into app.events (id, center_id, name, venue, starts_at, ends_at, status, audience, contact_rsvp) values
  (:'ev', :'c', 'Open Day 822', 'Main Hall 822', now() + interval '10 days', now() + interval '10 days 3 hours', 'published', 'members_and_guests', 'open');
insert into app.events (id, center_id, name, starts_at, status, capacity, contact_rsvp) values
  (:'ev_cap',   :'c', 'Small Hall 822',  now() + interval '10 days', 'published', 5, 'open'),
  (:'ev_quota', :'c', 'Quota Hall 822',  now() + interval '10 days', 'published', 8, 'open'),
  (:'ev_full',  :'c', 'Full Hall 822',   now() + interval '10 days', 'published', 4, 'open');
insert into app.events (id, center_id, name, starts_at, status) values
  (:'ev_off', :'c', 'Switch Off 822', now() + interval '10 days', 'published'),
  (:'ev_paid', :'c', 'Paid 822', now() + interval '10 days', 'published'),
  (:'ev_conf', :'c', 'Confidential 822', now() + interval '10 days', 'published'),
  (:'ev_members', :'c', 'Members Only 822', now() + interval '10 days', 'published'),
  (:'ev_draft', :'c', 'Draft 822', now() + interval '10 days', 'draft'),
  (:'ev_done', :'c', 'Done 822', now() + interval '10 days', 'completed');
insert into app.events (id, center_id, name, starts_at, status, rsvp_closes_at, contact_rsvp) values
  (:'ev_closed', :'c', 'Closed Window 822', now() + interval '10 days', 'published', now() - interval '1 day', 'open');
insert into app.events (id, center_id, name, starts_at, ends_at, status, contact_rsvp) values
  (:'ev_past', :'c', 'Past 822', now() - interval '2 days', now() - interval '1 day', 'published', 'open');
insert into app.events (id, center_id, name, starts_at, status, contact_rsvp) values
  (:'ev_onb', :'c4', 'Being Set Up Event 822', now() + interval '10 days', 'published', 'open'),
  (:'ev_susp', :'c5', 'Suspended Event 822', now() + interval '10 days', 'published', 'open'),
  (:'ev_other', :'c2', 'Other Community Event 822', now() + interval '10 days', 'published', 'open'),
  (:'ev_code', :'c', 'Code Event 822', now() + interval '10 days', 'published', 'code'),
  (:'ev_c3', :'c3', 'Code Community Event 822', now() + interval '10 days', 'published', 'code');
-- The switch is on for these events but something about them says no: set it by hand, past the trigger that would turn it off.
set local session_replication_role = replica;
update app.events set contact_rsvp = 'open' where id in (:'ev_paid', :'ev_conf', :'ev_members', :'ev_draft', :'ev_done');
update app.events set is_paid = true where id = :'ev_paid';
update app.events set confidential = true where id = :'ev_conf';
update app.events set audience = 'members_only' where id = :'ev_members';
update app.events set contact_rsvp = 'open' where id = :'ev_c3';
set local session_replication_role = origin;

-- Four places on Small Hall and Full Hall are held by a family that RSVP'd through the office.
insert into app.rsvps (id, center_id, event_id, household_id, status, source) values
  ('82200000-0000-4000-8000-000000000a01', :'c', :'ev_cap', :'h7', 'rsvpd', 'admin'),
  ('82200000-0000-4000-8000-000000000a02', :'c', :'ev_full', :'h7', 'rsvpd', 'admin');
insert into app.attendees (center_id, event_id, rsvp_id, display_name) values
  (:'c', :'ev_cap', '82200000-0000-4000-8000-000000000a01', 'Holder One'), (:'c', :'ev_cap', '82200000-0000-4000-8000-000000000a01', 'Holder Two'),
  (:'c', :'ev_cap', '82200000-0000-4000-8000-000000000a01', 'Holder Three'), (:'c', :'ev_cap', '82200000-0000-4000-8000-000000000a01', 'Holder Four'),
  (:'c', :'ev_full', '82200000-0000-4000-8000-000000000a02', 'Holder One'), (:'c', :'ev_full', '82200000-0000-4000-8000-000000000a02', 'Holder Two'),
  (:'c', :'ev_full', '82200000-0000-4000-8000-000000000a02', 'Holder Three'), (:'c', :'ev_full', '82200000-0000-4000-8000-000000000a02', 'Holder Four');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values (:'c', :'u_lead', 'event_lead', 'event', :'ev');

-- ══ A. The masks ═════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in select * from (values
    ('Malav', 'M***v'), ('Al', 'A*'), ('Jo', 'J*'), ('A', '*'), ('Raj', 'R**'), ('Anil', 'A**l'), ('Priya Shah', 'P***a S**h'),
    ('Mary Ann', 'M**y A**'), ('Jean-Luc', 'J**n-L**'), ('O''Brien', '*''B***n'), ('J. R. R.', '*. *. *.'), ('José', 'J**é'), ('Zoë', 'Z**'),
    ('李伟', '李*'), ('王小明', '王**'), ('محمد', 'م**د'), ('माला', 'मा*'), ('માલવ', 'મા**'), ('', ''),
    ('Jose' || chr(769), 'J**é')) as t(i, o) loop
    if app.mask_name(r.i) is distinct from r.o then
      raise exception 'FAIL: A · mask_name(%) is %, expected %', r.i, app.mask_name(r.i), r.o;
    end if;
  end loop;
  raise notice 'PASS: A · names: Malav is M***v (3 of 5 hidden; the example M**AV hides only 2), and the rest of the table of docs/RSVP_WITHOUT_LOGIN.md section 4';
  for r in select * from (values
    ('name@gmail.com', 'n***@g***.com'), ('a@gmail.com', '***@g***.com'), ('Name@Gmail.com', 'n***@g***.com'),
    ('malav.sanghavi@mail.company.co.uk', 'm***@m***.c***.c***.uk'), ('mira822@family.test', 'm***@f***.test'),
    ('not an email', null), ('', null), ('a@b', null)) as t(i, o) loop
    if app.mask_email(r.i) is distinct from r.o then
      raise exception 'FAIL: A · mask_email(%) is %, expected %', r.i, app.mask_email(r.i), r.o;
    end if;
  end loop;
  raise notice 'PASS: A · emails: first character and *** of the local part, each domain label but the last, the last label stays; not an email = null';
  for r in select * from (values
    ('+13125550187', '+1 *** *** **87'), ('+1 (312) 555-0187', '+1 *** *** **87'), ('3125550187', '+1 *** *** **87'),
    ('+442071234567', '+**********67'), ('12345', null), ('', null)) as t(i, o) loop
    if app.mask_phone(r.i) is distinct from r.o then
      raise exception 'FAIL: A · mask_phone(%) is %, expected %', r.i, app.mask_phone(r.i), r.o;
    end if;
  end loop;
  raise notice 'PASS: A · phones: +1 and the last 2 digits for US / Canada, + and the last 2 digits otherwise';
end $$;
-- The rule, over generated words: never more than half the letters show, and the word keeps its length.
do $$
declare i int; n int; s text; m text; stars int;
begin
  for i in 1 .. 400 loop
    n := 1 + floor(random() * 30)::int;
    s := (select string_agg(chr(97 + floor(random() * 26)::int), '') from generate_series(1, n));
    m := app.mask_name(s);
    stars := length(m) - length(replace(m, '*', ''));
    if length(m) <> n or stars * 2 < n or (n >= 4 and (left(m, 1) <> left(s, 1) or right(m, 1) <> right(s, 1))) then
      raise exception 'FAIL: A · the rule fails for % (%)', s, m;
    end if;
  end loop;
  raise notice 'PASS: A · over 400 generated words: the length is kept and at least half of every word is hidden';
end $$;
select pg_temp.assert(app.mask_name(null) = '' and app.mask_email(null) is null and app.mask_phone(null) is null, 'A · null in, nothing out');

-- ══ B. The switches ══════════════════════════════════════════════════════════
select pg_temp.assert(app._rsvp_contact_master(:'c') = 'open' and app._rsvp_contact_master(:'c3') = 'code'
                      and app._rsvp_contact_master('82200000-0000-4000-8000-0000000000ff') = 'off',
  'B · the community''s rule: open, code, and off when it is not set');
select pg_temp.assert(app._rsvp_contact_mode('open', :'c3') = 'code' and app._rsvp_contact_mode('code', :'c') = 'code'
                      and app._rsvp_contact_mode('off', :'c') = 'off' and app._rsvp_contact_mode('bogus', :'c') = 'off',
  'B · an event never has more than the community allows');
select pg_temp.assert((select contact_rsvp = 'off' from app.events where id = :'ev_off'), 'B · a new event starts with the switch off');
select pg_temp.assert_raises(format($$insert into app.events (center_id, name, starts_at, contact_rsvp) values (%L, 'x', now(), 'open')$$, :'c3'),
  'only with a code', 'B · an event cannot be more open than the community allows');
update app.centers set rules = '{}'::jsonb where id = :'c4';
select pg_temp.assert_raises(format($$insert into app.events (center_id, name, starts_at, contact_rsvp) values (%L, 'x', now(), 'code')$$, :'c4'),
  'switched off for this community', 'B · with the community''s rule off, no event can switch it on');
update app.centers set rules = '{"rsvp": {"contact_lookup": "open"}}'::jsonb where id = :'c4';
insert into app.events (id, center_id, name, starts_at, is_paid) values (:'ev_b', :'c', 'Paid B 822', now() + interval '3 days', true);
select pg_temp.assert_raises(format($$insert into app.events (center_id, name, starts_at, is_paid, contact_rsvp) values (%L, 'x', now(), true, 'open')$$, :'c'),
  'free events only', 'B · not on a paid event');
select pg_temp.assert_raises(format($$insert into app.events (center_id, name, starts_at, confidential, contact_rsvp) values (%L, 'x', now(), true, 'open')$$, :'c'),
  'confidential', 'B · not on a confidential event');
select pg_temp.assert_raises(format($$insert into app.events (center_id, name, starts_at, audience, contact_rsvp) values (%L, 'x', now(), 'members_only', 'open')$$, :'c'),
  'public, or to members and guests', 'B · not on a members-only event');
select pg_temp.assert_raises(format($$update app.events set contact_rsvp = 'open' where id = %L$$, :'ev_b'),
  'free events only', 'B · an existing paid event cannot have it switched on');
-- Something else about the event changes: the switch quietly goes back to off.
update app.events set contact_rsvp = 'open' where id = :'ev_off';
select pg_temp.assert((select contact_rsvp = 'open' from app.events where id = :'ev_off'), 'B · the switch can be turned on for a free public event');
update app.events set is_paid = true where id = :'ev_off';
select pg_temp.assert((select contact_rsvp = 'off' from app.events where id = :'ev_off'), 'B · and goes back to off if the event becomes paid');
update app.events set is_paid = false where id = :'ev_off';
select pg_temp.assert((select contact_rsvp = 'off' from app.events where id = :'ev_off'), 'B · (turning paid off again does not turn it back on)');
-- Who sets it: the people who may already edit the event.
select pg_temp.sign_in(:'u_lead');
with u as (update app.events set contact_rsvp = 'code' where id = :'ev' returning 1) select count(*) as n_lead from u \gset
with u as (update app.events set contact_rsvp = 'code' where id = :'ev_cap' returning 1) select count(*) as n_lead_other from u \gset
reset role;
select pg_temp.assert(:n_lead = 1 and :n_lead_other = 0, 'B · the event''s lead can switch their own event, not another one');
select pg_temp.sign_in(:'u_nobody');
with u as (update app.events set contact_rsvp = 'code' where id = :'ev_cap' returning 1) select count(*) as n_nobody from u \gset
reset role;
select pg_temp.assert(:n_nobody = 0, 'B · a person with no role on the event cannot');
update app.events set contact_rsvp = 'open' where id = :'ev';

-- ══ C. The lookup in mode open ═══════════════════════════════════════════════
select pg_temp.fresh('203.0.113.11');
set role anon;
select app.rsvp_contact_lookup(:'ev', '(713) 555-0142') as r_phone \gset
reset role;
select pg_temp.assert(:'r_phone'::jsonb ->> 'ok' = 'true' and :'r_phone'::jsonb ->> 'step' = 'choose'
                      and pg_temp.keys(:'r_phone'::jsonb) = 'expires_in,handle,members,ok,send_to,step'
                      and (:'r_phone'::jsonb ->> 'expires_in')::int = 1800 and length(:'r_phone'::jsonb ->> 'handle') = 32,
  'C · a phone number on an adult''s record gives the family and an opaque handle (30 minutes), and nothing else');
select pg_temp.assert((select jsonb_agg(m -> 'label' order by (m ->> 'slot')::int) from jsonb_array_elements(:'r_phone'::jsonb -> 'members') m)
                        = '["M**a S**h", "K***n S**h", "Child 1", "Child 2"]'::jsonb
                      and (select jsonb_agg(m -> 'kind' order by (m ->> 'slot')::int) from jsonb_array_elements(:'r_phone'::jsonb -> 'members') m)
                        = '["adult", "adult", "child", "child"]'::jsonb
                      and (select jsonb_agg(m -> 'under_12' order by (m ->> 'slot')::int) from jsonb_array_elements(:'r_phone'::jsonb -> 'members') m)
                        = '[false, false, false, true]'::jsonb
                      and (select array_agg(distinct pg_temp.keys(m)) from jsonb_array_elements(:'r_phone'::jsonb -> 'members') m) = array['kind,label,slot,under_12'],
  'C · the family: the adults masked (the primary first), the children as Child 1 (the older) and Child 2, with an "under 12" tag, no letters of a child''s name');
select pg_temp.assert(:'r_phone'::jsonb -> 'send_to' = '{"email": "m***@f***.test", "phone": "+1 *** *** **42"}'::jsonb,
  'C · and where the confirmation will go: the masked email and phone on file');
select pg_temp.assert(pg_temp.leaks(:'r_phone'::jsonb) = '' and not pg_temp.has_uuid(:'r_phone'::jsonb),
  'C · no real name, email or phone number, and no id, anywhere in the answer');
select pg_temp.assert((select count(*) = 1 and bool_and(handle_hash = encode(extensions.digest(:'r_phone'::jsonb ->> 'handle', 'sha256'), 'hex')
                                                         and (handle_hash <> :'r_phone'::jsonb ->> 'handle') and used_at is null
                                                         and expires_at > now() + interval '29 minutes' and mode = 'open' and contact_kind = 'phone')
                         from app.rsvp_contact_handles where household_id = :'h1'),
  'C · the handle is stored only as its SHA-256, for 30 minutes, unused');

select pg_temp.fresh('203.0.113.12');
set role anon;
select app.rsvp_contact_lookup(:'ev', '  KIRAN822@Family.Test ') as r_mail \gset
reset role;
select pg_temp.assert(:'r_mail'::jsonb ->> 'ok' = 'true' and :'r_mail'::jsonb -> 'send_to' = '{"email": "k***@f***.test", "phone": "+1 *** *** **43"}'::jsonb
                      and pg_temp.leaks(:'r_mail'::jsonb) = '',
  'C · an email works too (any case, spaces trimmed); the confirmation goes to the adult whose email it was');

-- Every kind of "no"
select pg_temp.fresh('203.0.113.13');
set role anon;
select app.rsvp_contact_lookup(:'ev', '713-555-0199') as r_child \gset
select pg_temp.visit('203.0.113.14');
select app.rsvp_contact_lookup(:'ev', '+17135550180') as r_dead \gset
select pg_temp.visit('203.0.113.15');
select app.rsvp_contact_lookup(:'ev', '+17135550181') as r_merged \gset
select pg_temp.visit('203.0.113.16');
select app.rsvp_contact_lookup(:'ev', '+17135550182') as r_left \gset
select pg_temp.visit('203.0.113.17');
select app.rsvp_contact_lookup(:'ev', '+17135550190') as r_far \gset
select pg_temp.visit('203.0.113.18');
select app.rsvp_contact_lookup(:'ev', '+17135550111') as r_none \gset
reset role;
select pg_temp.assert(:'r_child'::jsonb = :'r_none'::jsonb and :'r_dead'::jsonb = :'r_none'::jsonb and :'r_merged'::jsonb = :'r_none'::jsonb
                      and :'r_left'::jsonb = :'r_none'::jsonb and :'r_far'::jsonb = :'r_none'::jsonb
                      and :'r_none'::jsonb ->> 'code' = 'not_found' and :'r_none'::jsonb ->> 'ok' = 'false' and pg_temp.keys(:'r_none'::jsonb) = 'code,message,ok',
  'C · a child''s own phone, a deceased person, a merged duplicate, someone who left, another community''s person and an unknown number all give the same "not found"');
select pg_temp.fresh('203.0.113.19');
set role anon;
select app.rsvp_contact_lookup(:'ev', '+17135550170') as r_two \gset
select app.rsvp_contact_lookup(:'ev', 'tara822@family.test') as r_tara \gset
select app.rsvp_contact_lookup(:'ev', '+17135550150') as r_noemail \gset
select app.rsvp_contact_lookup(:'ev', '713 555 0171') as r_optout \gset
reset role;
select pg_temp.assert(:'r_two'::jsonb ->> 'code' = 'ambiguous' and pg_temp.keys(:'r_two'::jsonb) = 'code,message,ok'
                      and :'r_tara'::jsonb ->> 'ok' = 'true' and jsonb_array_length(:'r_tara'::jsonb -> 'members') = 1,
  'C · a number on two households opens neither; the same family reached by its own email is found');
select pg_temp.assert(:'r_noemail'::jsonb ->> 'code' = 'no_email', 'C · a family with no email on file: "no email", so no RSVP');
select pg_temp.assert(:'r_optout'::jsonb ->> 'code' = 'cannot_send', 'C · an address that opted out of email: "cannot send", so no RSVP');
select pg_temp.fresh('203.0.113.15');
set role anon;
select app.rsvp_contact_lookup(:'ev', '+17135550160') as r_rao \gset
select app.rsvp_contact_lookup(:'ev', 'abc') as r_bad1 \gset
select app.rsvp_contact_lookup(:'ev', 'nobody@') as r_bad2 \gset
select app.rsvp_contact_lookup(:'ev', '12345') as r_bad3 \gset
select app.rsvp_contact_lookup(null, '+17135550160') as r_noev \gset
reset role;
select pg_temp.assert(:'r_rao'::jsonb ->> 'ok' = 'true' and jsonb_array_length(:'r_rao'::jsonb -> 'members') = 2
                      and :'r_rao'::jsonb -> 'send_to' = '{"email": "n***@f***.test", "phone": "+1 *** *** **60"}'::jsonb
                      and (select jsonb_agg(m -> 'label' order by (m ->> 'slot')::int) from jsonb_array_elements(:'r_rao'::jsonb -> 'members') m) = '["N**a R**", "O**r R**"]'::jsonb,
  'C · two adults of one family on the same number are one family; the confirmation goes to the one who has an email; a 3-letter surname shows its first letter');
select pg_temp.assert(:'r_bad1'::jsonb ->> 'code' = 'bad_contact' and :'r_bad2'::jsonb ->> 'code' = 'bad_contact' and :'r_bad3'::jsonb ->> 'code' = 'bad_contact'
                      and :'r_noev'::jsonb ->> 'code' = 'unavailable',
  'C · something that is not a phone or an email is "bad contact"; no event is "unavailable"');
select pg_temp.assert(not exists (select 1 from app.rsvps where event_id = :'ev') and not exists (select 1 from app.messages where center_id = :'c'),
  'C · looking up writes no RSVP and sends no message');

-- ══ D. Which events a guest may RSVP to ══════════════════════════════════════
select pg_temp.fresh('203.0.113.21');
set role anon;
select app.rsvp_contact_lookup(:'ev_off', '+17135550142') as d_off \gset
select app.rsvp_contact_lookup(:'ev_paid', '+17135550142') as d_paid \gset
select app.rsvp_contact_lookup(:'ev_conf', '+17135550142') as d_conf \gset
select app.rsvp_contact_lookup(:'ev_members', '+17135550142') as d_members \gset
select app.rsvp_contact_lookup(:'ev_draft', '+17135550142') as d_draft \gset
select app.rsvp_contact_lookup(:'ev_onb', '+17135550142') as d_onb \gset
reset role;
select pg_temp.assert(:'d_off'::jsonb ->> 'code' = 'unavailable' and :'d_paid'::jsonb ->> 'code' = 'unavailable' and :'d_conf'::jsonb ->> 'code' = 'unavailable'
                      and :'d_members'::jsonb ->> 'code' = 'unavailable' and :'d_draft'::jsonb ->> 'code' = 'unavailable' and :'d_onb'::jsonb ->> 'code' = 'unavailable',
  'D · switch off, a paid event, a confidential event, a members-only event, a draft and a community still being set up are all "unavailable" (even when the column was forced on)');
select pg_temp.fresh('203.0.113.22');
set role anon;
select app.rsvp_contact_lookup(:'ev_closed', '+17135550142') as d_closed \gset
select app.rsvp_contact_lookup(:'ev_done', '+17135550142') as d_done \gset
select app.rsvp_contact_lookup(:'ev_past', '+17135550142') as d_past \gset
reset role;
select pg_temp.assert(:'d_closed'::jsonb ->> 'code' = 'closed' and :'d_done'::jsonb ->> 'code' = 'closed' and :'d_past'::jsonb ->> 'code' = 'closed',
  'D · a closed RSVP window, a completed event and an event that is over are "closed"');
select pg_temp.fresh('203.0.113.23');
set role anon;
select app.rsvp_contact_lookup(:'ev_code', 'nobody822@nowhere.test') as d_code \gset
select app.rsvp_contact_lookup(:'ev_c3', 'nobody822@nowhere.test') as d_master \gset
select app.rsvp_contact_lookup(:'ev_susp', '+17135550142') as d_susp \gset
reset role;
select pg_temp.assert(:'d_code'::jsonb ->> 'step' = 'code' and :'d_master'::jsonb ->> 'step' = 'code',
  'D · an event set to "code", and an "open" event in a community that allows only "code", ask for the code first (test 824 has the rest)');
select pg_temp.assert(:'d_susp'::jsonb ->> 'code' = 'unavailable', 'D · a suspended community is closed to guests');
select pg_temp.assert(not exists (select 1 from app.rsvps where event_id in (:'ev_off', :'ev_paid', :'ev_conf', :'ev_members', :'ev_draft', :'ev_onb', :'ev_closed', :'ev_done', :'ev_past', :'ev_code', :'ev_c3', :'ev_susp')),
  'D · none of those wrote anything');

-- ══ E. Saving ════════════════════════════════════════════════════════════════
select pg_temp.fresh('203.0.113.31');
set role anon;
select app.rsvp_contact_lookup(:'ev', '(713) 555-0142') as e_look \gset
reset role;
select :'e_look'::jsonb ->> 'handle' as h_shah \gset
-- Slots: 1 Mira, 2 Kiran, 3 Child 1 (Isha), 4 Child 2 (Aarav). Bad selections first: nothing is saved.
select pg_temp.fresh('203.0.113.31');
set role anon;
select app.rsvp_contact_submit(:'h_shah', '{}', '{}') as e_empty \gset
select app.rsvp_contact_submit(:'h_shah', '{1,1}', '{}') as e_dup \gset
select app.rsvp_contact_submit(:'h_shah', '{1,5}', '{}') as e_slot \gset
select app.rsvp_contact_submit(:'h_shah', '{1}', '{2}') as e_assist \gset
select pg_temp.visit('203.0.113.35');
select app.rsvp_contact_submit(:'h_shah', '{0}', '{}') as e_zero \gset
select app.rsvp_contact_submit('not-a-handle', '{1}', '{}') as e_junk \gset
reset role;
select pg_temp.assert(:'e_empty'::jsonb ->> 'code' = 'bad_selection' and :'e_dup'::jsonb ->> 'code' = 'bad_selection' and :'e_slot'::jsonb ->> 'code' = 'bad_selection'
                      and :'e_assist'::jsonb ->> 'code' = 'bad_selection' and :'e_zero'::jsonb ->> 'code' = 'bad_selection' and :'e_junk'::jsonb ->> 'code' = 'expired'
                      and not exists (select 1 from app.rsvps where event_id = :'ev'),
  'E · nobody ticked, a person ticked twice, a slot that is not in the family, "needs help" for someone not ticked, slot 0 and a made-up handle: all refused, nothing saved');
-- All or nothing: with no confirmation wording the email cannot be written, so no RSVP is saved.
savepoint no_template;
delete from app.message_templates where center_id is null and key = 'rsvp_contact_confirmation';
select pg_temp.fresh('203.0.113.31');
set role anon;
select app.rsvp_contact_submit(:'h_shah', '{1,2,4}', '{}') as e_notpl \gset
reset role;
select pg_temp.assert(:'e_notpl'::jsonb ->> 'code' = 'cannot_send' and not exists (select 1 from app.rsvps where event_id = :'ev')
                      and not exists (select 1 from app.attendees where event_id = :'ev') and not exists (select 1 from app.rsvp_manage_links where center_id = :'c')
                      and not exists (select 1 from app.messages where center_id = :'c')
                      and (select used_at is null from app.rsvp_contact_handles where handle_hash = encode(extensions.digest(:'h_shah', 'sha256'), 'hex')),
  'E · when the confirmation cannot be queued nothing is saved (no RSVP, no tickets, no link, no message) and the handle can be used again');
rollback to savepoint no_template;
-- The save.
select pg_temp.fresh('203.0.113.31');
set role anon;
select app.rsvp_contact_submit(:'h_shah', '{1,2,4}', '{4}') as e_save \gset
reset role;
select pg_temp.assert(:'e_save'::jsonb ->> 'ok' = 'true' and :'e_save'::jsonb ->> 'status' = 'rsvpd' and (:'e_save'::jsonb ->> 'count')::int = 3
                      and pg_temp.keys(:'e_save'::jsonb) = 'count,ok,send_to,status,undo_until'
                      and :'e_save'::jsonb -> 'send_to' = '{"email": "m***@f***.test"}'::jsonb
                      and (:'e_save'::jsonb ->> 'undo_until')::timestamptz between now() + interval '14 minutes' and now() + interval '16 minutes'
                      and pg_temp.leaks(:'e_save'::jsonb) = '' and not pg_temp.has_uuid(:'e_save'::jsonb),
  'E · saving returns the count, where the confirmation went (masked) and until when it can be undone, and nothing else');
select id as rsvp_shah from app.rsvps where event_id = :'ev' and household_id = :'h1' \gset
select pg_temp.assert((select count(*) = 1 and bool_and(source = 'guest_contact' and status = 'rsvpd' and submitted_by_person_id is null
                                                        and contact_person_id = :'pm' and contact_kind = 'phone' and contact_verified_at is null
                                                        and commitment_mode = 'none' and commitment_pledge_id is null
                                                        and guest_name is null and guest_phone_e164 is null and guest_email is null)
                         from app.rsvps where event_id = :'ev'),
  'E · the RSVP: the household, source guest_contact, UNVERIFIED, nobody signed in, no pledge, no guest columns (no phone or email stored)');
select pg_temp.assert((select count(*) = 3 and bool_and(ticket_token is not null and status = 'rsvpd' and checked_in_at is null)
                         and bool_and(person_id in (:'pm', :'pk', :'pa'))
                         and array_agg(display_name order by display_name) = array['Aarav Shah', 'Kiran Shah', 'Mira Shah']
                         and (select is_child_under_12 and needs_assistance and not is_senior from app.attendees where rsvp_id = :'rsvp_shah' and person_id = :'pa')
                         and (select count(*) = 2 and bool_and(not is_child_under_12 and not needs_assistance) from app.attendees where rsvp_id = :'rsvp_shah' and person_id <> :'pa')
                         from app.attendees where rsvp_id = :'rsvp_shah'),
  'E · the three ticked people, with their real names for the staff, tickets, and the flags worked out by the database (Aarav is under 12 and ticked "needs help"; the phone sent neither)');
select pg_temp.assert((select count(*) = 1 and bool_and(to_address = 'mira822@family.test' and channel::text = 'email' and template_key = 'rsvp_contact_confirmation'
                                                        and status = 'queued' and purpose = 'notification' and topic_key = 'events'
                                                        and body like '%/rsvp/••••••%' and position('%MEMBER_APP_URL%/rsvp/' in body) > 0 and body like '%Open Day 822%'
                                                        and body like '%People registered: 3%' and body like '%Main Hall 822%'
                                                        and payload ? 'secret_ref' and payload ->> 'rsvp_id' = :'rsvp_shah')
                         from app.messages where center_id = :'c'),
  'E · exactly one confirmation is queued, to the address ON FILE (the visitor typed a phone number), with the link written as %MEMBER_APP_URL%/rsvp/ and the token held back');
select (v.decrypted_secret::jsonb) ->> 'token' as tok_shah
  from app.messages m join vault.decrypted_secrets v on v.id = (m.payload ->> 'secret_ref')::uuid
 where m.center_id = :'c' and m.template_key = 'rsvp_contact_confirmation' \gset
select pg_temp.assert(length(:'tok_shah') = 32 and (select token_hash = encode(extensions.digest(:'tok_shah', 'sha256'), 'hex') and token_hash <> :'tok_shah'
                                                          and expires_at > (select ends_at from app.events where id = :'ev') + interval '1 day 23 hours'
                                                          and revoked_at is null
                                                     from app.rsvp_manage_links where rsvp_id = :'rsvp_shah')
                      and not exists (select 1 from app.messages where center_id = :'c' and (body like '%' || :'tok_shah' || '%' or payload::text like '%' || :'tok_shah' || '%')),
  'E · the emailed token is in the Vault, its SHA-256 is the only thing stored with the RSVP (it ends two days after the event), and it is not in the queue');
select pg_temp.assert((select used_at is not null and rsvp_id = :'rsvp_shah' and undo_until > now() from app.rsvp_contact_handles where handle_hash = encode(extensions.digest(:'h_shah', 'sha256'), 'hex')),
  'E · the handle is used up');
select pg_temp.assert((select count(*) = 1 from app.audit_log where action = 'rsvp.contact_submitted' and record_id = :'rsvp_shah' and center_id = :'c'
                                                          and reason like 'RSVP made without signing in%')
                      and (select count(*) >= 1 from app.audit_log where record_table = 'rsvps' and record_id = :'rsvp_shah' and reason like 'RSVP made without signing in%'),
  'E · the audit log says it was made without signing in, and why');

-- Again with the used handle, and the family again.
select pg_temp.fresh('203.0.113.32');
set role anon;
select app.rsvp_contact_submit(:'h_shah', '{1}', '{}') as e_again \gset
select app.rsvp_contact_lookup(:'ev', '+17135550142') as e_look2 \gset
reset role;
select pg_temp.assert(:'e_again'::jsonb ->> 'code' = 'used' and :'e_look2'::jsonb ->> 'code' = 'already_rsvpd' and pg_temp.keys(:'e_look2'::jsonb) = 'code,message,ok'
                      and (select count(*) = 1 from app.rsvps where event_id = :'ev' and household_id = :'h1'),
  'E · a handle works once; once the family has an RSVP the lookup says so (no names) and a second one cannot be made');
-- Two handles for one family made before either was used: the second save is refused.
select pg_temp.fresh('203.0.113.33');
set role anon;
select app.rsvp_contact_lookup(:'ev', '+17135550160') as e_rao1 \gset
select app.rsvp_contact_lookup(:'ev', 'nina822@family.test') as e_rao2 \gset
reset role;
select :'e_rao1'::jsonb ->> 'handle' as h_rao1, :'e_rao2'::jsonb ->> 'handle' as h_rao2 \gset
select pg_temp.fresh('203.0.113.33');
set role anon;
select app.rsvp_contact_submit(:'h_rao1', '{1,2}', '{}') as e_rao_a \gset
select app.rsvp_contact_submit(:'h_rao2', '{1}', '{}') as e_rao_b \gset
reset role;
select pg_temp.assert(:'e_rao_a'::jsonb ->> 'ok' = 'true' and :'e_rao_b'::jsonb ->> 'code' = 'already_rsvpd'
                      and (select count(*) = 1 from app.rsvps where event_id = :'ev' and household_id = :'h3'),
  'E · two visits for one family at the same time: only the first saves, the second is told the family already has an RSVP');
select pg_temp.assert((select to_address from app.messages where center_id = :'c' and payload ->> 'rsvp_id' = (select id::text from app.rsvps where household_id = :'h3' and event_id = :'ev'))
                        = 'nina822@family.test',
  'E · the number was shared by Nina and Omar; the confirmation went to the adult who has an email on file (Nina), not to anything typed');
select pg_temp.fresh('203.0.113.34');
set role anon;
select app.rsvp_contact_lookup(:'ev', 'kim822@family.test') as e_kim \gset
reset role;
select pg_temp.assert(:'e_kim'::jsonb ->> 'ok' = 'true' and (select jsonb_agg(m -> 'label' order by (m ->> 'slot')::int) from jsonb_array_elements(:'e_kim'::jsonb -> 'members') m) = '["K** N*", "L** N*"]'::jsonb,
  'E · two-letter surnames show their first letter (K** N*), and an adult with no contact on file is still listed');

-- ══ F. Capacity and the unverified share ═════════════════════════════════════
select pg_temp.fresh('203.0.113.41');
set role anon;
select app.rsvp_contact_lookup(:'ev_cap', 'kim822@family.test') as f_look \gset
select app.rsvp_contact_lookup(:'ev_full', 'kim822@family.test') as f_full \gset
reset role;
select :'f_look'::jsonb ->> 'handle' as h_kim \gset
select pg_temp.assert(:'f_look'::jsonb ->> 'ok' = 'true' and :'f_full'::jsonb ->> 'code' = 'full' and pg_temp.keys(:'f_full'::jsonb) = 'code,message,ok',
  'F · four of five places are taken: the lookup still works; an event with no place left says "full" before anything about the family');
select pg_temp.fresh('203.0.113.41');
set role anon;
select app.rsvp_contact_submit(:'h_kim', '{1,2}', '{}') as f_over \gset
reset role;
select pg_temp.assert(:'f_over'::jsonb ->> 'code' = 'full' and not exists (select 1 from app.rsvps where household_id = :'h9'),
  'F · two people on one remaining place: "full", nothing saved');
select pg_temp.fresh('203.0.113.41');
set role anon;
select app.rsvp_contact_submit(:'h_kim', '{1}', '{}') as f_one \gset
reset role;
select pg_temp.assert(:'f_one'::jsonb ->> 'ok' = 'true' and app._rsvp_contact_seats(:'ev_cap') = 5,
  'F · one person on the last place: saved, and the event is now full');
-- The unverified share: a hall of 8 lets RSVPs without signing in hold 2 places (25%) until they are verified.
select pg_temp.fresh('203.0.113.42');
set role anon;
select app.rsvp_contact_lookup(:'ev_quota', '+17135550142') as q_look \gset
reset role;
select :'q_look'::jsonb ->> 'handle' as h_quota \gset
select pg_temp.fresh('203.0.113.42');
set role anon;
select app.rsvp_contact_submit(:'h_quota', '{1,2,3}', '{}') as q_three \gset
select app.rsvp_contact_submit(:'h_quota', '{1,2}', '{}') as q_two \gset
reset role;
select pg_temp.assert(:'q_three'::jsonb ->> 'code' = 'quota' and :'q_two'::jsonb ->> 'ok' = 'true'
                      and app._rsvp_contact_seats(:'ev_quota', true) = 2,
  'F · three people on a hall of 8 is over the 25% share for unverified RSVPs ("quota"); two is not');
select pg_temp.fresh('203.0.113.43');
set role anon;
select app.rsvp_contact_lookup(:'ev_quota', '+17135550160') as q_look2 \gset
reset role;
select :'q_look2'::jsonb ->> 'handle' as h_quota2 \gset
select pg_temp.fresh('203.0.113.43');
set role anon;
select app.rsvp_contact_submit(:'h_quota2', '{1}', '{}') as q_more \gset
reset role;
select pg_temp.assert(:'q_more'::jsonb ->> 'code' = 'quota', 'F · and the next family is told the same until some of those RSVPs are verified');
update app.rsvps set contact_verified_at = now() where event_id = :'ev_quota';
select pg_temp.fresh('203.0.113.43');
set role anon;
select app.rsvp_contact_submit(:'h_quota2', '{1}', '{}') as q_more2 \gset
reset role;
select pg_temp.assert(:'q_more2'::jsonb ->> 'ok' = 'true', 'F · once those are verified they stop counting against the share');

-- ══ G. The emailed link and the handle ═══════════════════════════════════════
select pg_temp.fresh('203.0.113.51');
set role anon;
select app.rsvp_contact_view(:'h_rao1') as g_handle_view \gset
reset role;
select pg_temp.assert(:'g_handle_view'::jsonb ->> 'ok' = 'true' and jsonb_array_length(:'g_handle_view'::jsonb -> 'people') = 2
                      and (select contact_verified_at is null from app.rsvps where household_id = :'h3' and event_id = :'ev'),
  'G · for 30 minutes the visit''s handle shows the RSVP, but only the emailed link proves the email: still unverified');
select pg_temp.fresh('203.0.113.51');
set role anon;
select app.rsvp_contact_cancel(:'h_rao1') as g_handle_cancel \gset
reset role;
select pg_temp.assert(:'g_handle_cancel'::jsonb ->> 'code' = 'expired' and (select status = 'rsvpd' from app.rsvps where household_id = :'h3' and event_id = :'ev'),
  'G · the handle cannot cancel; only the emailed link (or "undo" within 15 minutes) does');
select pg_temp.fresh('203.0.113.52');
set role anon;
select app.rsvp_contact_view(:'tok_shah') as g_view \gset
reset role;
select pg_temp.assert(:'g_view'::jsonb ->> 'ok' = 'true' and pg_temp.keys(:'g_view'::jsonb) = 'can_cancel,event,ok,people,status'
                      and pg_temp.keys(:'g_view'::jsonb -> 'event') = 'ends_at,name,starts_at,venue'
                      and :'g_view'::jsonb -> 'event' ->> 'name' = 'Open Day 822' and :'g_view'::jsonb ->> 'status' = 'rsvpd' and (:'g_view'::jsonb ->> 'can_cancel')::boolean
                      and jsonb_array_length(:'g_view'::jsonb -> 'people') = 3
                      and (select array_agg(distinct pg_temp.keys(p)) from jsonb_array_elements(:'g_view'::jsonb -> 'people') p) = array['checked_in,kind,label,slot,status,ticket']
                      and (select jsonb_agg(p -> 'label' order by (p ->> 'slot')::int) from jsonb_array_elements(:'g_view'::jsonb -> 'people') p) <@ '["M**a S**h", "K***n S**h", "Child 2"]'::jsonb
                      and (select bool_and(length(p ->> 'ticket') = 32) from jsonb_array_elements(:'g_view'::jsonb -> 'people') p)
                      and pg_temp.leaks(:'g_view'::jsonb) = '' and not pg_temp.has_uuid(:'g_view'::jsonb),
  'G · the emailed link shows the event, the people (masked) with their ticket codes, and whether it can still be cancelled; no real name, no id');
select pg_temp.assert((select contact_verified_at is not null from app.rsvps where id = :'rsvp_shah')
                      and (select last_opened_at is not null from app.rsvp_manage_links where rsvp_id = :'rsvp_shah'),
  'G · opening the emailed link verifies the RSVP');
-- Wrong, expired and revoked tokens all answer alike.
select (v.decrypted_secret::jsonb) ->> 'token' as tok_rao
  from app.messages m join vault.decrypted_secrets v on v.id = (m.payload ->> 'secret_ref')::uuid
 where m.center_id = :'c' and m.payload ->> 'rsvp_id' = (select r.id::text from app.rsvps r where r.household_id = :'h3' and r.event_id = :'ev') \gset
update app.rsvp_manage_links set expires_at = now() - interval '1 minute' where rsvp_id = (select id from app.rsvps where household_id = :'h3' and event_id = :'ev');
select pg_temp.fresh('203.0.113.53');
set role anon;
select app.rsvp_contact_view('A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6') as g_wrong \gset
select app.rsvp_contact_view('short') as g_short \gset
select app.rsvp_contact_cancel(:'tok_shah' || 'x') as g_longer \gset
select app.rsvp_contact_view(:'tok_rao') as g_expired \gset
reset role;
select pg_temp.assert(:'g_wrong'::jsonb = :'g_short'::jsonb and :'g_wrong'::jsonb = :'g_longer'::jsonb and :'g_wrong'::jsonb = :'g_expired'::jsonb
                      and :'g_wrong'::jsonb ->> 'code' = 'expired',
  'G · a made-up token, a short one, one with an extra character and one whose link has ended all answer the same "timed out"');
-- Cancelling with the emailed link.
select pg_temp.fresh('203.0.113.54');
set role anon;
select app.rsvp_contact_cancel(:'tok_shah') as g_cancel \gset
select app.rsvp_contact_cancel(:'tok_shah') as g_cancel2 \gset
select app.rsvp_contact_view(:'tok_shah') as g_after \gset
reset role;
select pg_temp.assert(:'g_cancel'::jsonb = '{"ok": true, "status": "cancelled"}'::jsonb and :'g_cancel2'::jsonb = :'g_cancel'::jsonb
                      and (select status = 'cancelled' and cancelled_at is not null from app.rsvps where id = :'rsvp_shah')
                      and (select bool_and(status = 'cancelled' and ticket_revoked) from app.attendees where rsvp_id = :'rsvp_shah')
                      and :'g_after'::jsonb ->> 'status' = 'cancelled' and not (:'g_after'::jsonb ->> 'can_cancel')::boolean
                      and (select bool_and(p -> 'ticket' = 'null'::jsonb) from jsonb_array_elements(:'g_after'::jsonb -> 'people') p)
                      and app._rsvp_contact_seats(:'ev') = 2,
  'G · cancelling releases the seats and revokes the tickets (twice is fine); the page then shows it cancelled with no ticket codes');
-- The family can RSVP again after cancelling.
select pg_temp.fresh('203.0.113.55');
set role anon;
select app.rsvp_contact_lookup(:'ev', '+17135550142') as g_relook \gset
reset role;
select pg_temp.assert(:'g_relook'::jsonb ->> 'ok' = 'true', 'G · after cancelling, the family can make a new RSVP');
-- Undo within 15 minutes.
select pg_temp.fresh('203.0.113.56');
set role anon;
select app.rsvp_contact_lookup(:'ev', 'tara822@family.test') as u_look \gset
reset role;
select :'u_look'::jsonb ->> 'handle' as h_tara \gset
select pg_temp.fresh('203.0.113.56');
set role anon;
select app.rsvp_contact_submit(:'h_tara', '{1}', '{}') as u_save \gset
reset role;
select pg_temp.assert((select status = 'queued' from app.messages where center_id = :'c' and to_address = 'tara822@family.test'), 'G · (Tara''s confirmation is waiting to be sent)');
select pg_temp.fresh('203.0.113.56');
set role anon;
select app.rsvp_contact_undo(:'h_tara') as u_undo \gset
reset role;
select pg_temp.assert(:'u_undo'::jsonb = '{"ok": true, "status": "cancelled"}'::jsonb
                      and (select status = 'cancelled' from app.rsvps where household_id = :'h4' and event_id = :'ev')
                      and (select status = 'cancelled' from app.messages where center_id = :'c' and to_address = 'tara822@family.test'),
  'G · undo takes the RSVP back and stops the confirmation that has not gone yet');
select pg_temp.fresh('203.0.113.57');
set role anon;
select app.rsvp_contact_lookup(:'ev', 'tom822@family.test') as u_look2 \gset
reset role;
select :'u_look2'::jsonb ->> 'handle' as h_tom \gset
select pg_temp.fresh('203.0.113.57');
set role anon;
select app.rsvp_contact_submit(:'h_tom', '{1}', '{}') as u_save2 \gset
reset role;
update app.rsvp_contact_handles set undo_until = now() - interval '1 minute' where handle_hash = encode(extensions.digest(:'h_tom', 'sha256'), 'hex');
select pg_temp.fresh('203.0.113.57');
set role anon;
select app.rsvp_contact_undo(:'h_tom') as u_late \gset
reset role;
select pg_temp.assert(:'u_late'::jsonb ->> 'code' = 'expired' and (select status = 'rsvpd' from app.rsvps where household_id = :'h5' and event_id = :'ev'),
  'G · after 15 minutes undo no longer works');
-- Someone has arrived: no cancelling.
update app.attendees set checked_in_at = now() where rsvp_id = (select id from app.rsvps where household_id = :'h5' and event_id = :'ev');
select (v.decrypted_secret::jsonb) ->> 'token' as tok_tom
  from app.messages m join vault.decrypted_secrets v on v.id = (m.payload ->> 'secret_ref')::uuid
 where m.center_id = :'c' and m.to_address = 'tom822@family.test' \gset
select pg_temp.fresh('203.0.113.58');
set role anon;
select app.rsvp_contact_cancel(:'tok_tom') as g_toolate \gset
reset role;
select pg_temp.assert(:'g_toolate'::jsonb ->> 'code' = 'too_late' and (select status = 'rsvpd' from app.rsvps where household_id = :'h5' and event_id = :'ev'),
  'G · once someone has been checked in the link cannot cancel');
update app.rsvp_manage_links set revoked_at = now() where rsvp_id = (select id from app.rsvps where household_id = :'h5' and event_id = :'ev');
select pg_temp.fresh('203.0.113.59');
set role anon;
select app.rsvp_contact_view(:'tok_tom') as g_revoked \gset
reset role;
select pg_temp.assert(:'g_revoked'::jsonb = :'g_wrong'::jsonb, 'G · a link that was revoked answers like one that never existed');

-- ══ H. Every limit ═══════════════════════════════════════════════════════════
-- The connection: 10 tries an hour, a miss counts double, so five unknown numbers use them all.
select pg_temp.fresh('198.51.100.1');
set role anon;
select app.rsvp_contact_lookup(:'ev', '+17135559901') as l1 \gset
select app.rsvp_contact_lookup(:'ev', '+17135559902') as l2 \gset
select app.rsvp_contact_lookup(:'ev', '+17135559903') as l3 \gset
select app.rsvp_contact_lookup(:'ev', '+17135559904') as l4 \gset
select app.rsvp_contact_lookup(:'ev', '+17135559905') as l5 \gset
select app.rsvp_contact_lookup(:'ev', '+17135559906') as l6 \gset
reset role;
select pg_temp.assert(:'l1'::jsonb ->> 'code' = 'not_found' and :'l5'::jsonb ->> 'code' = 'not_found' and :'l6'::jsonb ->> 'code' = 'rate_limited'
                      and pg_temp.keys(:'l6'::jsonb) = 'code,message,ok',
  'H · one connection: five misses (each counts twice) use the ten tries an hour; the sixth is "too many tries"');
-- The same limit, but with hits: ten lookups that find nothing to find out ("bad contact") count once each.
select pg_temp.fresh('198.51.100.2');
set role anon;
select app.rsvp_contact_lookup(:'ev', 'bad') as m1 \gset
select app.rsvp_contact_lookup(:'ev', 'bad') as m2 \gset
select app.rsvp_contact_lookup(:'ev', 'bad') as m3 \gset
select app.rsvp_contact_lookup(:'ev', 'bad') as m4 \gset
select app.rsvp_contact_lookup(:'ev', 'bad') as m5 \gset
select app.rsvp_contact_lookup(:'ev', 'bad') as m6 \gset
select app.rsvp_contact_lookup(:'ev', 'bad') as m7 \gset
select app.rsvp_contact_lookup(:'ev', 'bad') as m8 \gset
select app.rsvp_contact_lookup(:'ev', 'bad') as m9 \gset
select app.rsvp_contact_lookup(:'ev', 'bad') as m10 \gset
select app.rsvp_contact_lookup(:'ev', 'bad') as m11 \gset
reset role;
select pg_temp.assert(:'m10'::jsonb ->> 'code' = 'bad_contact' and :'m11'::jsonb ->> 'code' = 'rate_limited', 'H · and the eleventh try of any kind is refused');
-- One contact: 3 an hour, from anywhere.
select pg_temp.fresh('198.51.100.3');
set role anon;
select app.rsvp_contact_lookup(:'ev', '+17135559911') as c1 \gset
select pg_temp.visit('198.51.100.4');
select app.rsvp_contact_lookup(:'ev', '+17135559911') as c2 \gset
select pg_temp.visit('198.51.100.5');
select app.rsvp_contact_lookup(:'ev', '+17135559911') as c3 \gset
select pg_temp.visit('198.51.100.6');
select app.rsvp_contact_lookup(:'ev', '+17135559911') as c4 \gset
select pg_temp.visit('198.51.100.7');
select app.rsvp_contact_lookup(:'ev', '713-555-9911') as c5 \gset
reset role;
select pg_temp.assert(:'c3'::jsonb ->> 'code' = 'not_found' and :'c4'::jsonb ->> 'code' = 'rate_limited' and :'c5'::jsonb ->> 'code' = 'rate_limited',
  'H · one phone number or email: three tries an hour from anywhere, however it is written');
-- One event: 300 an hour.
select pg_temp.fresh('198.51.100.8');
insert into app.rsvp_contact_attempts (kind, subject) select 'lookup.event', :'ev' from generate_series(1, 300);
set role anon;
select app.rsvp_contact_lookup(:'ev', '+17135559921') as ev1 \gset
select app.rsvp_contact_lookup(:'ev_quota', '+17135559921') as ev2 \gset
reset role;
select pg_temp.assert(:'ev1'::jsonb ->> 'code' = 'rate_limited' and :'ev2'::jsonb ->> 'code' = 'not_found', 'H · one event: 300 lookups an hour, and only that event');
-- Everyone: 2000 an hour.
select pg_temp.fresh('198.51.100.9');
insert into app.rsvp_contact_attempts (kind, subject) select 'lookup.all', 'all' from generate_series(1, 2000);
set role anon;
select app.rsvp_contact_lookup(:'ev', '+17135559931') as all1 \gset
reset role;
select pg_temp.assert(:'all1'::jsonb ->> 'code' = 'rate_limited', 'H · everyone together: 2000 lookups an hour');
-- Saves: 5 an hour from one connection.
select pg_temp.fresh('198.51.100.10');
insert into app.rsvp_contact_attempts (kind, subject) select 'submit.ip', app._rsvp_contact_hash(app._rsvp_contact_pepper(), '198.51.100.10') from generate_series(1, 5);
set role anon;
select app.rsvp_contact_submit(:'h_quota2', '{1}', '{}') as s1 \gset
reset role;
select pg_temp.assert(:'s1'::jsonb ->> 'code' = 'rate_limited', 'H · saving: 5 an hour from one connection');
-- Views, cancels and undos: 60 an hour from one connection.
select pg_temp.fresh('198.51.100.11');
insert into app.rsvp_contact_attempts (kind, subject) select 'token.ip', app._rsvp_contact_hash(app._rsvp_contact_pepper(), '198.51.100.11') from generate_series(1, 60);
set role anon;
select app.rsvp_contact_view(:'tok_tom') as t1 \gset
select app.rsvp_contact_cancel(:'tok_tom') as t2 \gset
select app.rsvp_contact_undo(:'h_tom') as t3 \gset
reset role;
select pg_temp.assert(:'t1'::jsonb ->> 'code' = 'rate_limited' and :'t2'::jsonb ->> 'code' = 'rate_limited' and :'t3'::jsonb ->> 'code' = 'rate_limited',
  'H · viewing, cancelling and undoing: 60 an hour from one connection');
-- The same, in all: a flood from many addresses is stopped by the caps that do not depend on the address.
select pg_temp.fresh('198.51.100.20');
insert into app.rsvp_contact_attempts (kind, subject) select 'submit.all', 'all' from generate_series(1, 500);
insert into app.rsvp_contact_attempts (kind, subject) select 'token.all', 'all' from generate_series(1, 3000);
set role anon;
select app.rsvp_contact_submit(:'h_quota2', '{1}', '{}') as sa1 \gset
select app.rsvp_contact_view(:'tok_tom') as ta1 \gset
select app.rsvp_contact_cancel(:'tok_tom') as ta2 \gset
select app.rsvp_contact_undo(:'h_tom') as ta3 \gset
reset role;
select pg_temp.assert(:'sa1'::jsonb ->> 'code' = 'rate_limited' and :'ta1'::jsonb ->> 'code' = 'rate_limited' and :'ta2'::jsonb ->> 'code' = 'rate_limited'
                      and :'ta3'::jsonb ->> 'code' = 'rate_limited',
  'H · saving (500 an hour) and viewing, cancelling and undoing (3000 an hour) are also capped in all, whatever address they come from');
-- Which address is counted: Cloudflare''s, when the platform sets it; otherwise the first of x-forwarded-for; a made-up one is ignored.
select set_config('request.headers', '{"x-forwarded-for": "9.9.9.9, 10.0.0.1", "cf-connecting-ip": "198.51.100.77"}', true);
select pg_temp.assert(app._rsvp_contact_ip() = '198.51.100.77', 'H · the platform''s own connecting address comes first');
select set_config('request.headers', '{"x-forwarded-for": "9.9.9.9, 10.0.0.1", "cf-connecting-ip": "not an address"}', true);
select pg_temp.assert(app._rsvp_contact_ip() = '9.9.9.9', 'H · a connecting address that is not an address is ignored');
select set_config('request.headers', '{"x-forwarded-for": "9.9.9.9"}', true);
select pg_temp.assert(app._rsvp_contact_ip() = '9.9.9.9', 'H · without it, the first address of x-forwarded-for');
select set_config('request.headers', '', true);
select pg_temp.assert(app._rsvp_contact_ip() = 'unknown', 'H · and with no header at all, one shared "unknown"');
-- Confirmation emails: 3 a day to one address.
select pg_temp.fresh('198.51.100.12');
insert into app.rsvp_contact_attempts (kind, subject) select 'confirm.address', app._rsvp_contact_hash(app._rsvp_contact_pepper(), 'kim822@family.test') from generate_series(1, 3);
set role anon;
select app.rsvp_contact_lookup(:'ev', 'kim822@family.test') as a1 \gset
reset role;
select pg_temp.assert(:'a1'::jsonb ->> 'code' = 'cannot_send', 'H · an address that already had 3 confirmations today gets no more (the visitor is told it cannot be sent)');
-- IPv6 visitors are counted by their /64.
select pg_temp.fresh('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
select pg_temp.assert(app._rsvp_contact_ip() = '2001:db8:1:2::' and app._rsvp_contact_hash('p', app._rsvp_contact_ip()) = app._rsvp_contact_hash('p', '2001:db8:1:2::'),
  'H · an IPv6 visitor is counted by the /64 they are in (' || app._rsvp_contact_ip() || ')');
-- Old counters are cleaned up by the next visitor.
select pg_temp.fresh('198.51.100.13');
insert into app.rsvp_contact_attempts (kind, subject, at) values ('lookup.ip', 'old', now() - interval '3 days');
set role anon;
select app.rsvp_contact_lookup(:'ev', 'bad') as cl \gset
reset role;
select pg_temp.assert(not exists (select 1 from app.rsvp_contact_attempts where subject = 'old'), 'H · counters older than two days are deleted');

-- ══ I. Who may call what, and what is kept ═══════════════════════════════════
select pg_temp.assert((select bool_and(has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute') and has_function_privilege('service_role', f, 'execute'))
                         from unnest(array['app.rsvp_contact_lookup(uuid, text)', 'app.rsvp_contact_submit(text, integer[], integer[])', 'app.rsvp_contact_undo(text)',
                                           'app.rsvp_contact_view(text)', 'app.rsvp_contact_cancel(text)']) f),
  'I · the five visitor functions can be called without signing in');
select pg_temp.assert((select bool_and(not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute'))
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and (p.proname like '\_rsvp\_contact\_%' or p.proname in ('_mask_marks', '_mask_word', 'rsvp_contact_limits', 'events_contact_rsvp_guard'))),
  'I · none of the helpers can be called by anon or a signed-in person');
select pg_temp.assert(not has_function_privilege('anon', 'app.rsvp_contact_verify_staff(uuid, text)', 'execute') and has_function_privilege('authenticated', 'app.rsvp_contact_verify_staff(uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app.mask_name(text)', 'execute') and has_function_privilege('authenticated', 'app.mask_name(text)', 'execute'),
  'I · staff verification and the masks are for signed-in people only');
select pg_temp.assert((select bool_and(p.prosecdef and 'search_path=app, public, extensions' = any (p.proconfig))
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('rsvp_contact_lookup', 'rsvp_contact_submit', 'rsvp_contact_undo', 'rsvp_contact_view', 'rsvp_contact_cancel', 'rsvp_contact_verify_staff')),
  'I · every visitor function is security definer with the search path pinned to app, public, extensions');
select pg_temp.assert((select bool_and(not has_table_privilege('anon', 'app.' || t, 'select') and not has_table_privilege('authenticated', 'app.' || t, 'select')
                                       and not has_table_privilege('authenticated', 'app.' || t, 'insert') and not has_table_privilege('anon', 'app.' || t, 'insert')
                                       and (select relrowsecurity from pg_class where oid = ('app.' || t)::regclass))
                         from unnest(array['rsvp_contact_handles', 'rsvp_manage_links', 'rsvp_contact_attempts']) t),
  'I · the three new tables are closed to anon and signed-in people (row security on, no grant)');
set role anon;
select pg_temp.assert_raises($$select count(*) from app.rsvp_contact_handles$$, 'permission denied', 'I · anon cannot read the handles');
select pg_temp.assert_raises($$select count(*) from app.rsvp_manage_links$$, 'permission denied', 'I · or the emailed links');
select pg_temp.assert_raises($$select count(*) from app.rsvp_contact_attempts$$, 'permission denied', 'I · or the counters');
select pg_temp.assert_raises($$select count(*) from app.rsvps$$, 'permission denied', 'I · or the RSVPs');
select pg_temp.assert_raises($$select count(*) from app.attendees$$, 'permission denied', 'I · or the attendees');
select pg_temp.assert_raises($$select count(*) from app.people$$, 'permission denied', 'I · or the people');
select pg_temp.assert_raises($$insert into app.rsvps (center_id, event_id, status, source) values (null, null, 'rsvpd', 'guest_contact')$$, 'permission denied', 'I · and cannot write an RSVP by hand');
reset role;
select pg_temp.assert(not exists (select 1 from app.rsvp_contact_handles h where to_jsonb(h)::text ~ '(7135550|family\.test|Mira|Kiran|Shah|Rao)')
                      and not exists (select 1 from app.rsvp_contact_attempts a where to_jsonb(a)::text ~ '(7135550|family\.test|Mira|Kiran|Shah|Rao)')
                      and not exists (select 1 from app.rsvp_manage_links l where to_jsonb(l)::text ~ '(7135550|family\.test|Mira|Kiran|Shah|Rao)')
                      and not exists (select 1 from app.rsvps r where r.event_id = :'ev' and (to_jsonb(r)::text ~ '(7135550|family\.test)')),
  'I · no phone number or email is stored in the handles, the counters, the links or the RSVPs (only keyed hashes and the kind of contact)');
select pg_temp.assert(not exists (select 1 from app.audit_log l
                                    where l.center_id = :'c' and (l.record_table in ('rsvps', 'attendees', 'rsvp_manage_links') or l.action = 'rsvp.contact_submitted')
                                      and (coalesce(l.before::text, '') || coalesce(l.after::text, '') || coalesce(l.reason, '')) ~ '(7135550|family\.test)'),
  'I · and none in the audit entries of the RSVP');
select pg_temp.assert(not exists (select 1 from app.audit_log l where l.record_table in ('rsvp_contact_handles', 'rsvp_contact_attempts')),
  'I · the handles and the counters are not audited (anonymous traffic), the links and RSVPs are');
select pg_temp.assert(exists (select 1 from pg_trigger t where t.tgrelid = 'app.rsvp_manage_links'::regclass and t.tgname = 'audit_rsvp_manage_links'), 'I · the emailed links are audited');
select pg_temp.assert(not exists (select 1 from vault.decrypted_secrets s where s.name = 'connect/rsvp_contact/pepper' and length(s.decrypted_secret) < 32)
                      and (select count(*) = 1 from vault.decrypted_secrets s where s.name = 'connect/rsvp_contact/pepper'),
  'I · the pepper for the keyed hashes is one random value in the Vault');

-- ══ J. Staff, and the old registration email ═════════════════════════════════
select id as rsvp_tom from app.rsvps where household_id = :'h5' and event_id = :'ev' \gset
select pg_temp.sign_in(:'u_nobody');
select pg_temp.assert_raises(format($$select app.rsvp_contact_verify_staff(%L, 'x')$$, :'rsvp_tom'), 'access to this area', 'J · a person with no role cannot mark an RSVP verified');
reset role;
select pg_temp.sign_in(:'u_lead');
select app.rsvp_contact_verify_staff(:'rsvp_tom', 'Called the family on the number we have') as j_ok \gset
reset role;
select pg_temp.assert(:'j_ok' = 't' and (select contact_verified_at is not null from app.rsvps where id = :'rsvp_tom')
                      and exists (select 1 from app.audit_log where record_table = 'rsvps' and record_id = :'rsvp_tom' and reason = 'Called the family on the number we have'),
  'J · the event''s lead marks it verified, with the reason in the audit log');
select pg_temp.sign_in(:'u_lead');
select pg_temp.assert_raises(format($$select app.rsvp_contact_verify_staff(%L)$$, '82200000-0000-4000-8000-000000000a01'), 'not found', 'J · and only an RSVP made without signing in');
reset role;
-- The registration email (0770) is not queued for this source, even when the community has it on; it still is for the others.
insert into app.email_automations (center_id, kind, trigger_key, template_key, enabled) values (:'c', 'trigger', 'registration_confirmed', 'registration_confirmed', true);
insert into app.rsvps (id, center_id, event_id, household_id, status, source) values
  ('82200000-0000-4000-8000-000000000b02', :'c', :'ev_full', :'h6', 'rsvpd', 'admin');
insert into app.rsvps (id, center_id, event_id, household_id, status, source) values
  ('82200000-0000-4000-8000-000000000b03', :'c', :'ev_full', :'h4', 'rsvpd', 'guest_contact');
select pg_temp.assert((select count(*) from app.jobs where kind = 'messaging.compose' and payload ->> 'ref_id' = '82200000-0000-4000-8000-000000000b02') = 1
                      and (select count(*) from app.jobs where kind = 'messaging.compose' and payload ->> 'ref_id' = '82200000-0000-4000-8000-000000000b03') = 0,
  'J · with the registration email switched on, an office-entered RSVP queues it and an RSVP made without signing in does not (it has its own email)');

rollback;
