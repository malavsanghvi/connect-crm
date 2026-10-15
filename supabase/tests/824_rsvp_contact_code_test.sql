-- 0824: RSVP without signing in, design B: the masked family only after a 6-digit code (docs/RSVP_WITHOUT_LOGIN.md section 5.4).
--   A. Before the code every contact gets the same answer: found, not found, a child's, one that opted out. Only a contact on an adult's
--      record is sent a code, and only to that contact on file.
--   B. Texting: a phone number is accepted only where texting is set up, under the community's daily cap; the answer never depends on the contact.
--   C. The code: wrong tries, the lock (the handle and the contact), expiry, made-up handles, the right code
--   D. After the right code, and only then, the reasons that tell something about the family
--   E. Saving needs a handle whose code was typed; the RSVP it makes is verified at once
--   F. The limits of this step; who may call what; design A is as it was
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.fresh(p_ip text default '203.0.113.5') returns void language plpgsql as $$
begin
  delete from app.rsvp_contact_attempts;
  perform set_config('request.jwt.claims', '', true);
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
create or replace function pg_temp.leaks(j jsonb) returns text language sql as $$
  select coalesce(string_agg(w, ',' order by w), '')
    from unnest(array['Mira', 'Kiran', 'Aarav', 'Isha', 'Shah', 'Patel', 'Tara', 'Rao', 'Nina', 'mira824', 'kiran824', 'isha824', 'family.test',
                      '7135550142', '7135550150', '7135550170', '713555']) w
   where (j - 'handle')::text ilike '%' || w || '%'
$$;
-- The code that was queued to an address, read from the Vault the way the sender does (one message per address at a time).
create or replace function pg_temp.code_for(p_to text) returns text language sql as $$
  select (v.decrypted_secret::jsonb) ->> 'code'
    from app.messages m join vault.decrypted_secrets v on v.id = (m.payload ->> 'secret_ref')::uuid
   where m.template_key = 'rsvp_contact_code' and m.to_address = p_to and m.status = 'queued'
$$;

\set c '82400000-0000-4000-8000-0000000000c1'
\set c2 '82400000-0000-4000-8000-0000000000c2'
\set h1 '82400000-0000-4000-8000-0000000000a1'
\set h2 '82400000-0000-4000-8000-0000000000a2'
\set h3 '82400000-0000-4000-8000-0000000000a3'
\set h4 '82400000-0000-4000-8000-0000000000a4'
\set h5 '82400000-0000-4000-8000-0000000000a5'
\set h6 '82400000-0000-4000-8000-0000000000a6'
\set pm '82400000-0000-4000-8000-000000000001'
\set pk '82400000-0000-4000-8000-000000000002'
\set pa '82400000-0000-4000-8000-000000000003'
\set pi '82400000-0000-4000-8000-000000000004'
\set pd '82400000-0000-4000-8000-000000000005'
\set pt1 '82400000-0000-4000-8000-000000000006'
\set pt2 '82400000-0000-4000-8000-000000000007'
\set pr '82400000-0000-4000-8000-000000000008'
\set pg '82400000-0000-4000-8000-000000000009'
\set ev '82400000-0000-4000-8000-0000000000e1'
\set ev_open '82400000-0000-4000-8000-0000000000e2'
\set ev_c2 '82400000-0000-4000-8000-0000000000e3'
\set ev_q '82400000-0000-4000-8000-0000000000e4'

-- c allows every mode; c2 allows only the code.
insert into app.centers (id, slug, name, short_name, state_region, status, environment, time_zone, rules) values
  (:'c',  'rc824',  'RSVP Code 824',  'RC824', 'TX', 'active', 'production', 'America/Chicago', '{"rsvp": {"contact_lookup": "open"}}'::jsonb),
  (:'c2', 'rc824b', 'Code Only 824',  'CO824', 'TX', 'active', 'production', 'America/Chicago', '{"rsvp": {"contact_lookup": "code"}}'::jsonb);
insert into app.households (id, center_id, display_name) values
  (:'h1', :'c', 'Shah family 824'), (:'h2', :'c', 'Patel family 824'), (:'h3', :'c', 'Lee A 824'), (:'h4', :'c', 'Lee B 824'),
  (:'h5', :'c', 'Rao family 824'), (:'h6', :'c', 'Gray family 824');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email, phone_e164) values
  (:'pm',  :'c', 'Mira',  'Shah',  date '1980-03-04', 'mira824@family.test',  '+17135550142'),
  (:'pk',  :'c', 'Kiran', 'Shah',  date '1978-06-01', 'kiran824@family.test', '+17135550143'),
  (:'pa',  :'c', 'Aarav', 'Shah',  (current_date - interval '8 years')::date, null, null),
  (:'pi',  :'c', 'Isha',  'Shah',  (current_date - interval '16 years')::date, 'isha824@family.test', null),
  (:'pd',  :'c', 'Dev',   'Patel', date '1970-01-01', null, '+17135550150'),
  (:'pt1', :'c', 'Tara',  'Lee',   date '1990-01-01', 'tara824@family.test', '+17135550170'),
  (:'pt2', :'c', 'Tom',   'Lee',   date '1991-01-01', 'tom824@family.test',  '+17135550170'),
  (:'pr',  :'c', 'Nina',  'Rao',   date '1985-05-05', 'nina824@family.test', '+17135550160'),
  (:'pg',  :'c', 'Sam',   'Gray',  date '1975-01-01', 'sam824@family.test',  '+17135550171');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:'h1', :'pm', :'c', 'primary', true), (:'h1', :'pk', :'c', 'spouse', false), (:'h1', :'pa', :'c', 'child', false), (:'h1', :'pi', :'c', 'child', false),
  (:'h2', :'pd', :'c', 'primary', true), (:'h3', :'pt1', :'c', 'primary', true), (:'h4', :'pt2', :'c', 'primary', true),
  (:'h5', :'pr', :'c', 'primary', true), (:'h6', :'pg', :'c', 'primary', true);
insert into app.channel_optins (center_id, person_id, channel, address, opted_in, source) values (:'c', :'pg', 'email', 'sam824@family.test', false, 'admin');
insert into app.events (id, center_id, name, venue, starts_at, ends_at, status, audience, contact_rsvp, capacity) values
  (:'ev',      :'c',  'Code Day 824',  'Hall 824', now() + interval '10 days', now() + interval '10 days 3 hours', 'published', 'members_and_guests', 'code', null),
  (:'ev_open', :'c',  'Open Day 824',  'Hall 824', now() + interval '10 days', now() + interval '10 days 3 hours', 'published', 'members_and_guests', 'open', null),
  (:'ev_c2',   :'c2', 'Code Only 824', 'Hall 824', now() + interval '10 days', now() + interval '10 days 3 hours', 'published', 'members_and_guests', 'code', null),
  (:'ev_q',    :'c',  'Small Code 824', 'Hall 824', now() + interval '10 days', now() + interval '10 days 3 hours', 'published', 'members_and_guests', 'code', 8);
-- The Rao family already has an RSVP (made through the office).
insert into app.rsvps (id, center_id, event_id, household_id, status, source) values ('82400000-0000-4000-8000-000000000a01', :'c', :'ev', :'h5', 'rsvpd', 'admin');
insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name) values (:'c', :'ev', '82400000-0000-4000-8000-000000000a01', :'pr', 'Nina Rao');

-- ══ A. Before the code ═══════════════════════════════════════════════════════
select pg_temp.fresh('203.0.113.11');
set role anon;
select app.rsvp_contact_lookup(:'ev', 'mira824@family.test') as a_found \gset
select pg_temp.visit('203.0.113.12');
select app.rsvp_contact_lookup(:'ev', 'nobody824@nowhere.test') as a_none \gset
select pg_temp.visit('203.0.113.13');
select app.rsvp_contact_lookup(:'ev', 'isha824@family.test') as a_child \gset
select pg_temp.visit('203.0.113.14');
select app.rsvp_contact_lookup(:'ev', 'sam824@family.test') as a_optout \gset
select pg_temp.visit('203.0.113.15');
select app.rsvp_contact_lookup(:'ev', 'nina824@family.test') as a_rao \gset
reset role;
select pg_temp.assert((select bool_and(pg_temp.keys(j) = 'expires_in,handle,ok,step' and j ->> 'ok' = 'true' and j ->> 'step' = 'code'
                                       and (j ->> 'expires_in')::int = 600 and length(j ->> 'handle') = 32)
                         from unnest(array[:'a_found'::jsonb, :'a_none'::jsonb, :'a_child'::jsonb, :'a_optout'::jsonb, :'a_rao'::jsonb]) j),
  'A · a contact on a family record, an unknown one, a child''s, one that opted out and one whose family already has an RSVP all get the very same answer: a code step and a handle');
select pg_temp.assert(pg_temp.leaks(:'a_found'::jsonb) = '' and pg_temp.leaks(:'a_none'::jsonb) = '', 'A · and it holds no name, email, phone or id');
select pg_temp.assert((select count(*) = 5 from app.rsvp_contact_handles where event_id = :'ev')
                      and (select array_agg(household_id order by household_id) from app.rsvp_contact_handles where event_id = :'ev' and households_matched = 1) = array[:'h1', :'h5', :'h6']::uuid[]
                      and (select count(*) = 2 from app.rsvp_contact_handles where event_id = :'ev' and households_matched = 0 and household_id is null),
  'A · every lookup made a handle; the three adults'' contacts point at their families, the unknown address and the child''s point at nothing');
select pg_temp.assert((select count(*) = 3 and bool_and(channel::text = 'email' and purpose = 'verification_code' and status = 'queued' and body !~ '[0-9]{6}' and subject !~ '[0-9]{6}' and payload ? 'secret_ref')
                         from app.messages where center_id = :'c' and template_key = 'rsvp_contact_code')
                      and (select array_agg(to_address order by to_address) from app.messages where center_id = :'c')
                            = array['mira824@family.test', 'nina824@family.test', 'sam824@family.test'],
  'A · a code went only to the three contacts that are on an adult''s record, each to its own address on file; none for the unknown address or the child''s; the code itself is in the Vault, not in the queue');
select pg_temp.code_for('mira824@family.test') as code_mira, pg_temp.code_for('nina824@family.test') as code_rao, pg_temp.code_for('sam824@family.test') as code_gray \gset
select pg_temp.assert(:'code_mira' ~ '^[0-9]{6}$' and :'code_rao' ~ '^[0-9]{6}$' and :'code_gray' ~ '^[0-9]{6}$', 'A · the codes are six digits');
select :'a_found'::jsonb ->> 'handle' as h_mira, :'a_none'::jsonb ->> 'handle' as h_none, :'a_child'::jsonb ->> 'handle' as h_child,
       :'a_optout'::jsonb ->> 'handle' as h_gray, :'a_rao'::jsonb ->> 'handle' as h_rao \gset
select pg_temp.assert((select count(*) = 5 from app.rsvp_contact_attempts where kind = 'lookup.contact')
                      and (select count(*) = 5 from app.rsvp_contact_attempts where kind = 'lookup.ip'),
  'A · the counters moved the same for all five (no extra count for a miss: a miss is not told here)');

-- ══ B. Texting ═══════════════════════════════════════════════════════════════
select pg_temp.fresh('203.0.113.21');
select count(*) as n_handles_before from app.rsvp_contact_handles \gset
set role anon;
select app.rsvp_contact_lookup(:'ev', '(713) 555-0142') as b_found \gset
select pg_temp.visit('203.0.113.22');
select app.rsvp_contact_lookup(:'ev', '+17135550999') as b_none \gset
reset role;
select pg_temp.assert(:'b_found'::jsonb = :'b_none'::jsonb and :'b_found'::jsonb ->> 'code' = 'use_email' and pg_temp.keys(:'b_found'::jsonb) = 'code,message,ok'
                      and (select count(*) = :n_handles_before from app.rsvp_contact_handles),
  'B · where texting is not set up a phone number is "use your email", the same for a number on file and one that is not, and nothing is made');
insert into app.integration_connections (center_id, provider, status) values (:'c', 'twilio', 'connected');
select pg_temp.fresh('203.0.113.23');
set role anon;
select app.rsvp_contact_lookup(:'ev', '(713) 555-0142') as b_found2 \gset
select pg_temp.visit('203.0.113.24');
select app.rsvp_contact_lookup(:'ev', '+17135550999') as b_none2 \gset
reset role;
select pg_temp.assert(pg_temp.keys(:'b_found2'::jsonb) = 'expires_in,handle,ok,step' and pg_temp.keys(:'b_none2'::jsonb) = 'expires_in,handle,ok,step'
                      and (select count(*) = 1 and bool_and(channel::text = 'sms' and to_address = '+17135550142' and purpose = 'verification_code' and status = 'queued' and body !~ '[0-9]{6}')
                             from app.messages where template_key = 'rsvp_contact_code' and channel::text = 'sms'),
  'B · with texting set up a phone number gets the same answer found or not; the code is texted only to the number on file, in its international form');
select pg_temp.assert((select count(*) = 1 from app.rsvp_contact_attempts where kind = 'code.sms' and subject = :'c'), 'B · and counts toward the community''s daily cap');
select pg_temp.fresh('203.0.113.25');
insert into app.rsvp_contact_attempts (kind, subject) select 'code.sms', :'c' from generate_series(1, 200);
set role anon;
select app.rsvp_contact_lookup(:'ev', '(713) 555-0142') as b_cap \gset
select pg_temp.visit('203.0.113.26');
select app.rsvp_contact_lookup(:'ev', 'kiran824@family.test') as b_cap_mail \gset
reset role;
select pg_temp.assert(:'b_cap'::jsonb ->> 'code' = 'use_email' and :'b_cap_mail'::jsonb ->> 'step' = 'code',
  'B · past 200 code texts a day a phone number is "use your email"; an email still works');

-- ══ C. The code ══════════════════════════════════════════════════════════════
select case when :'code_mira' = '111111' then '222222' else '111111' end as wrong_code \gset
select pg_temp.fresh('203.0.113.31');
set role anon;
select app.rsvp_contact_verify(:'h_mira', :'wrong_code') as c_real_wrong \gset
select pg_temp.visit('203.0.113.32');
select app.rsvp_contact_verify(:'h_none', :'wrong_code') as c_decoy_wrong \gset
select pg_temp.visit('203.0.113.33');
select app.rsvp_contact_verify(:'h_child', '123456') as c_child_wrong \gset
select pg_temp.visit('203.0.113.34');
select app.rsvp_contact_verify('Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1QqPp0', '123456') as c_junk_wrong \gset
select pg_temp.visit('203.0.113.35');
select app.rsvp_contact_verify('short', 'abc') as c_short_wrong \gset
reset role;
select pg_temp.assert(:'c_real_wrong'::jsonb = :'c_decoy_wrong'::jsonb and :'c_real_wrong'::jsonb = :'c_child_wrong'::jsonb and :'c_real_wrong'::jsonb = :'c_junk_wrong'::jsonb
                      and :'c_real_wrong'::jsonb ->> 'code' = 'bad_code' and (:'c_real_wrong'::jsonb ->> 'tries_left')::int = 4
                      and pg_temp.keys(:'c_real_wrong'::jsonb) = 'code,message,ok,tries_left' and (:'c_short_wrong'::jsonb ->> 'code') = 'bad_code',
  'C · a wrong code on a real handle, on a handle that points at nothing, on a child''s, on a handle that never existed and on garbage all answer the same: "bad code", 4 tries left');
-- Four more wrong tries on the real handle: the fifth leaves none, the sixth (even the right code) is locked.
select pg_temp.visit('203.0.113.36');
set role anon;
select app.rsvp_contact_verify(:'h_mira', :'wrong_code') as c_w2 \gset
select app.rsvp_contact_verify(:'h_mira', :'wrong_code') as c_w3 \gset
select app.rsvp_contact_verify(:'h_mira', :'wrong_code') as c_w4 \gset
select app.rsvp_contact_verify(:'h_mira', :'wrong_code') as c_w5 \gset
select app.rsvp_contact_verify(:'h_mira', :'code_mira') as c_locked_right \gset
reset role;
select pg_temp.assert((:'c_w2'::jsonb ->> 'tries_left')::int = 3 and (:'c_w3'::jsonb ->> 'tries_left')::int = 2 and (:'c_w4'::jsonb ->> 'tries_left')::int = 1
                      and (:'c_w5'::jsonb ->> 'tries_left')::int = 0 and :'c_locked_right'::jsonb ->> 'code' = 'locked',
  'C · five wrong codes use up the tries (3, 2, 1, 0 left); after that even the right code is "locked"');
select pg_temp.assert((select verified_at is null from app.rsvp_contact_handles where handle_hash = encode(extensions.digest(:'h_mira', 'sha256'), 'hex')), 'C · and nothing was verified');
-- A new code for the same contact does not give new tries: the contact is locked, not only the handle.
delete from app.messages where template_key = 'rsvp_contact_code' and to_address = 'mira824@family.test';
select pg_temp.visit('203.0.113.37');
set role anon;
select app.rsvp_contact_lookup(:'ev', 'mira824@family.test') as c_again \gset
reset role;
select pg_temp.code_for('mira824@family.test') as code_mira2 \gset
select :'c_again'::jsonb ->> 'handle' as h_mira2 \gset
select pg_temp.visit('203.0.113.38');
set role anon;
select app.rsvp_contact_verify(:'h_mira2', :'code_mira2') as c_contact_locked \gset
reset role;
select pg_temp.assert(:'c_contact_locked'::jsonb ->> 'code' = 'locked', 'C · asking for a new code does not help: the phone or email is locked for 15 minutes');
-- 16 minutes later the lock is gone.
update app.rsvp_contact_attempts set at = now() - interval '16 minutes' where kind = 'verify.wrong';
select pg_temp.visit('203.0.113.39');
set role anon;
select app.rsvp_contact_verify(:'h_mira2', :'code_mira2') as c_ok \gset
select app.rsvp_contact_verify(:'h_mira2', :'code_mira2') as c_ok2 \gset
reset role;
select pg_temp.assert(:'c_ok'::jsonb ->> 'ok' = 'true' and :'c_ok'::jsonb ->> 'step' = 'choose' and pg_temp.keys(:'c_ok'::jsonb) = 'expires_in,handle,members,ok,send_to,step'
                      and :'c_ok'::jsonb ->> 'handle' = :'h_mira2' and :'c_ok2'::jsonb = :'c_ok'::jsonb
                      and (select jsonb_agg(m -> 'label' order by (m ->> 'slot')::int) from jsonb_array_elements(:'c_ok'::jsonb -> 'members') m)
                            = '["M**a S**h", "K***n S**h", "Child 1", "Child 2"]'::jsonb
                      and :'c_ok'::jsonb -> 'send_to' = '{"email": "m***@f***.test", "phone": "+1 *** *** **42"}'::jsonb
                      and pg_temp.leaks(:'c_ok'::jsonb) = '',
  'C · the right code gives the masked family and the masked contacts, as design A does; asking again is harmless; no real name, email or phone');
select pg_temp.assert((select verified_at is not null and jsonb_array_length(members) = 4 from app.rsvp_contact_handles where handle_hash = encode(extensions.digest(:'h_mira2', 'sha256'), 'hex')),
  'C · the handle is now verified and holds the four people behind the slots');
-- Expiry: a code works for 10 minutes; a handle that points at nothing expires the same way.
update app.rsvp_contact_handles set code_expires_at = now() - interval '1 minute' where handle_hash in
  (encode(extensions.digest(:'h_rao', 'sha256'), 'hex'), encode(extensions.digest(:'h_none', 'sha256'), 'hex'));
select pg_temp.visit('203.0.113.40');
set role anon;
select app.rsvp_contact_verify(:'h_rao', :'code_rao') as c_exp_real \gset
select app.rsvp_contact_verify(:'h_none', '123456') as c_exp_decoy \gset
reset role;
select pg_temp.assert(:'c_exp_real'::jsonb = :'c_exp_decoy'::jsonb and :'c_exp_real'::jsonb ->> 'code' = 'expired', 'C · an expired code is "timed out", for a real handle and for one that points at nothing alike');

-- ══ D. After the code ════════════════════════════════════════════════════════
update app.rsvp_contact_handles set code_expires_at = now() + interval '5 minutes' where handle_hash = encode(extensions.digest(:'h_rao', 'sha256'), 'hex');
select pg_temp.fresh('203.0.113.51');
set role anon;
select app.rsvp_contact_verify(:'h_rao', :'code_rao') as d_rao \gset
select pg_temp.visit('203.0.113.52');
select app.rsvp_contact_verify(:'h_gray', :'code_gray') as d_gray \gset
select pg_temp.visit('203.0.113.53');
select app.rsvp_contact_lookup(:'ev', '713 555 0150') as d_dev_look \gset
select app.rsvp_contact_lookup(:'ev', '+17135550170') as d_lee_look \gset
reset role;
select pg_temp.assert(:'d_rao'::jsonb ->> 'code' = 'already_rsvpd' and :'d_gray'::jsonb ->> 'code' = 'cannot_send',
  'D · only after the code: the family already has an RSVP; the address opted out so the confirmation could not be sent');
select :'d_dev_look'::jsonb ->> 'handle' as h_dev, :'d_lee_look'::jsonb ->> 'handle' as h_lee \gset
select pg_temp.code_for('+17135550150') as code_dev, pg_temp.code_for('+17135550170') as code_lee \gset
select pg_temp.visit('203.0.113.54');
set role anon;
select app.rsvp_contact_verify(:'h_dev', :'code_dev') as d_dev \gset
select app.rsvp_contact_verify(:'h_lee', :'code_lee') as d_lee \gset
reset role;
select pg_temp.assert(:'d_dev'::jsonb ->> 'code' = 'no_email' and :'d_lee'::jsonb ->> 'code' = 'ambiguous',
  'D · only after the code: no email on file for the family; a number on two households opens neither');
select pg_temp.assert(pg_temp.keys(:'d_lee_look'::jsonb) = 'expires_in,handle,ok,step' and :'d_lee_look'::jsonb ->> 'step' = 'code',
  'D · (and before the code a number on two households looked like any other)');

-- ══ E. Saving ════════════════════════════════════════════════════════════════
-- A handle whose code was never typed saves nothing, and neither does one that points at nothing.
select pg_temp.fresh('203.0.113.61');
set role anon;
select app.rsvp_contact_lookup(:'ev', 'kiran824@family.test') as e_unv \gset
reset role;
select :'e_unv'::jsonb ->> 'handle' as h_unv \gset
select pg_temp.visit('203.0.113.62');
set role anon;
select app.rsvp_contact_submit(:'h_unv', '{1}', '{}') as e_not_typed \gset
select app.rsvp_contact_submit(:'h_none', '{1}', '{}') as e_nothing \gset
reset role;
select pg_temp.assert(:'e_not_typed'::jsonb ->> 'code' = 'expired' and :'e_nothing'::jsonb ->> 'code' = 'expired'
                      and not exists (select 1 from app.rsvps where event_id = :'ev' and source = 'guest_contact'),
  'E · a handle whose code was never typed, and one that points at nothing, save nothing');
select pg_temp.visit('203.0.113.63');
set role anon;
select app.rsvp_contact_submit(:'h_mira2', '{1,2,4}', '{4}') as e_save \gset
reset role;
select pg_temp.assert(:'e_save'::jsonb ->> 'ok' = 'true' and (:'e_save'::jsonb ->> 'count')::int = 3 and pg_temp.keys(:'e_save'::jsonb) = 'count,ok,send_to,status,undo_until'
                      and :'e_save'::jsonb -> 'send_to' = '{"email": "m***@f***.test"}'::jsonb,
  'E · with the code typed the RSVP is saved, as design A saves it');
select pg_temp.assert((select count(*) = 1 and bool_and(source = 'guest_contact' and contact_verified_at is not null and contact_kind = 'email' and contact_person_id = :'pm'
                                                        and submitted_by_person_id is null and commitment_pledge_id is null)
                         from app.rsvps where event_id = :'ev' and household_id = :'h1')
                      and app._rsvp_contact_seats(:'ev', true) = 0 and app._rsvp_contact_seats(:'ev') = 4
                      and exists (select 1 from app.audit_log where action = 'rsvp.contact_submitted' and center_id = :'c' and reason like '%6-digit code%'),
  'E · the RSVP is verified at once (the code proved the contact), so it does not count against the share of places unverified RSVPs may hold; the audit entry says the code was typed');
select pg_temp.assert((select to_address = 'mira824@family.test' from app.messages where center_id = :'c' and template_key = 'rsvp_contact_confirmation'),
  'E · and the confirmation went to the address on file');
-- A small hall: unverified RSVPs may hold 2 of 8 places, verified ones are not held to that.
select pg_temp.fresh('203.0.113.64');
delete from app.messages where template_key = 'rsvp_contact_code' and to_address = 'kiran824@family.test';
set role anon;
select app.rsvp_contact_lookup(:'ev_q', 'kiran824@family.test') as e_q \gset
reset role;
select pg_temp.code_for('kiran824@family.test') as code_q \gset
select :'e_q'::jsonb ->> 'handle' as h_q \gset
select pg_temp.visit('203.0.113.65');
set role anon;
select app.rsvp_contact_verify(:'h_q', :'code_q') as e_q_ok \gset
select app.rsvp_contact_submit(:'h_q', '{1,2,3}', '{}') as e_q_save \gset
reset role;
select pg_temp.assert(:'e_q_ok'::jsonb ->> 'ok' = 'true' and :'e_q_save'::jsonb ->> 'ok' = 'true' and (:'e_q_save'::jsonb ->> 'count')::int = 3 and app._rsvp_contact_seats(:'ev_q') = 3,
  'E · three people on a hall of 8 (over the 25% an unverified RSVP may hold) are saved when the code was typed');

-- ══ F. Limits, who may call what, design A ═══════════════════════════════════
select pg_temp.fresh('198.51.100.1');
insert into app.rsvp_contact_attempts (kind, subject) select 'verify.ip', app._rsvp_contact_hash(app._rsvp_contact_pepper(), '198.51.100.1') from generate_series(1, 30);
set role anon;
select app.rsvp_contact_verify(:'h_mira2', '123456') as f_ip \gset
reset role;
select pg_temp.assert(:'f_ip'::jsonb ->> 'code' = 'rate_limited', 'F · code tries: 30 an hour from one connection');
select pg_temp.fresh('198.51.100.2');
insert into app.rsvp_contact_attempts (kind, subject) select 'verify.all', 'all' from generate_series(1, 3000);
set role anon;
select app.rsvp_contact_verify(:'h_mira2', '123456') as f_all \gset
reset role;
select pg_temp.assert(:'f_all'::jsonb ->> 'code' = 'rate_limited', 'F · and 3000 an hour in all, from any address');
select pg_temp.assert(has_function_privilege('anon', 'app.rsvp_contact_verify(text, text)', 'execute')
                      and not has_function_privilege('anon', 'app._rsvp_contact_code_step(app.events, text, text, text, text, text)', 'execute')
                      and not has_function_privilege('anon', 'app._rsvp_contact_family_answer(uuid, uuid, app.events, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._rsvp_contact_new_code()', 'execute')
                      and not has_function_privilege('anon', 'app._rsvp_contact_code_hash(text, uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app._rsvp_contact_texting_on(uuid)', 'execute'),
  'F · the visitor can call verify; none of the helpers can be called by anon or a signed-in person');
select pg_temp.assert((select bool_and(p.prosecdef and 'search_path=app, public, extensions' = any (p.proconfig))
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('rsvp_contact_verify', 'rsvp_contact_lookup', 'rsvp_contact_submit', '_rsvp_contact_code_step', '_rsvp_contact_family_answer')),
  'F · security definer with the search path pinned to app, public, extensions');
select pg_temp.assert((select code_hash is not null and code_hash !~ '^[0-9]{6}$' and length(code_hash) = 64 from app.rsvp_contact_handles where handle_hash = encode(extensions.digest(:'h_mira2', 'sha256'), 'hex')),
  'F · the code is stored only as a keyed hash');
select pg_temp.assert(not exists (select 1 from app.rsvp_contact_handles h where to_jsonb(h)::text ~ '(7135550|family\.test|nowhere)')
                      and not exists (select 1 from app.messages m where m.template_key = 'rsvp_contact_code'
                                       and (m.body ~ '[0-9]{6}' or m.subject ~ '[0-9]{6}' or m.payload::text ~ '"code": "[0-9]{6}"')),
  'F · no phone or email in the handles; no code in the queue');
-- Design A is as it was.
select pg_temp.fresh('203.0.113.71');
set role anon;
select app.rsvp_contact_lookup(:'ev_open', 'kiran824@family.test') as f_open \gset
select pg_temp.visit('203.0.113.72');
select app.rsvp_contact_lookup(:'ev_open', 'nobody824@nowhere.test') as f_open_none \gset
select pg_temp.visit('203.0.113.73');
select app.rsvp_contact_lookup(:'ev_c2', 'kiran824@family.test') as f_c2 \gset
reset role;
select pg_temp.assert(:'f_open'::jsonb ->> 'step' = 'choose' and jsonb_array_length(:'f_open'::jsonb -> 'members') = 4 and :'f_open_none'::jsonb ->> 'code' = 'not_found',
  'F · an "open" event still shows the masked family straight away, and still says "not found"');
select pg_temp.assert(:'f_c2'::jsonb ->> 'step' = 'code', 'F · an event of a community that allows only the code is code, and a family of another community is not found there (a code step all the same)');

rollback;
