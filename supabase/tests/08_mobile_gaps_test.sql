-- Fixes for connect-mobile gaps.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''

insert into app.events (id, center_id, name, starts_at, status, capacity) values
  ('50000000-0000-4000-8000-000000000003', :jsh, 'Diwali puja', now() + interval '10 days', 'published', 100),
  ('50000000-0000-4000-8000-000000000004', :jsh, 'Life members dinner', now() + interval '10 days', 'published', null);
update app.events set audience = 'life_members_only' where id = '50000000-0000-4000-8000-000000000004';

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';  -- Priya
select app.submit_rsvp('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
  '[{"person_id":"30000000-0000-4000-8000-000000000001","name":"Priya Shah"},{"person_id":"30000000-0000-4000-8000-000000000004","name":"Anya Shah","child_under_12":true},{"name":"Nani (guest)","senior":true}]',
  1500, 'per_person') as rsvp \gset
select pg_temp.assert((select count(*) from app.attendees where rsvp_id = :'rsvp') = 3, 'RSVP with members and a guest is saved in one call');
select pg_temp.assert((select source::text || ':' || amount_cents from app.pledges where id = (select commitment_pledge_id from app.rsvps where id = :'rsvp')) = 'rsvp_commitment:1500',
                      'the donation commitment becomes an open pledge');
do $$ begin
  perform app.submit_rsvp('50000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '[{"name":"Priya"}]');
  raise exception 'FAIL: non-life household RSVP''d to a life-members event';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: event eligibility is enforced (life members only)';
end $$;
select app.cancel_rsvp(:'rsvp');
select pg_temp.assert((select status from app.pledges where id = (select commitment_pledge_id from app.rsvps where id = :'rsvp')) = 'cancelled',
                      'cancelling releases seats and cancels the unpaid commitment');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';  -- Dev, 14
do $$ begin
  perform app.submit_rsvp('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '[{"name":"Dev"}]');
  raise exception 'FAIL: child RSVP''d';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: children cannot RSVP';
end $$;
commit;

-- opportunity slots
insert into app.campaigns (id, center_id, name, kind, status) values ('f5000000-0000-4000-8000-000000000001', :jsh, 'Diwali pujans', 'event', 'published');
insert into app.opportunities (id, center_id, campaign_id, name, amount_cents, quantity_available, status) values
  ('f5000000-0000-4000-8000-000000000002', :jsh, 'f5000000-0000-4000-8000-000000000001', 'Pehli aarti', 25100, 1, 'open');
insert into app.pledges (center_id, household_id, source, amount_cents, opportunity_id) values
  (:jsh, '20000000-0000-4000-8000-000000000002', 'pujan', 25100, 'f5000000-0000-4000-8000-000000000002');
select pg_temp.assert((select quantity_taken || ':' || status from app.opportunities where id = 'f5000000-0000-4000-8000-000000000002') = '1:taken',
                      'taking the last slot marks the opportunity taken');
do $$ begin
  insert into app.pledges (center_id, household_id, source, amount_cents, opportunity_id)
    values ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'pujan', 25100, 'f5000000-0000-4000-8000-000000000002');
  raise exception 'FAIL: pledged a taken opportunity';
exception when check_violation then raise notice 'PASS: a taken opportunity cannot be pledged again';
end $$;

-- survey audience
insert into app.surveys (id, center_id, title, questions, audience, status, event_id, kind) values
  ('f6000000-0000-4000-8000-000000000001', :jsh, 'All members', '[]', '{"all_members":true}', 'open', null, 'general'),
  ('f6000000-0000-4000-8000-000000000002', :jsh, 'Mehta zone only', '[]', '{"zone_ids":["00000000-0000-0000-0000-000000000000"]}', 'open', null, 'general'),
  ('f6000000-0000-4000-8000-000000000003', :jsh, 'Samvatsari feedback', '[]', '{}', 'open', '50000000-0000-4000-8000-000000000002', 'event_feedback');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';  -- Priya: RSVP'd to Samvatsari
select pg_temp.assert((select string_agg(title, ',' order by title) from app.surveys) = 'All members,Samvatsari feedback',
                      'members see only surveys addressed to them (all members + events they attended)');
commit;

-- household change request
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
insert into app.household_change_requests (center_id, household_id, requested_by, kind, details)
  values ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
          'add_member', '{"first_name":"Kavya","last_name":"Shah","relationship":"child"}');
select pg_temp.assert((select count(*) from app.household_change_requests) = 1, 'an adult can ask the office to add a family member');
commit;

\echo 'PASS: mobile gap tests'
