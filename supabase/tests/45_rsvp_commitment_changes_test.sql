-- 0542: raise a commitment when people are added; cancel an RSVP with or without its pledge.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''
insert into app.events (id, center_id, name, starts_at, status, capacity) values
  ('50000000-0000-4000-8000-0000000000a1', :jsh, 'Navpad puja 45', now() + interval '10 days', 'published', 100);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';  -- Priya
select app.submit_rsvp('50000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001',
  '[{"person_id":"30000000-0000-4000-8000-000000000001","name":"Priya Shah"}]', 500, 'per_person') as rsvp \gset
select commitment_pledge_id as pledge from app.rsvps where id = :'rsvp' \gset
select pg_temp.assert(app.raise_rsvp_commitment(:'rsvp', 1000, 'per_person') = :'pledge', 'adding two people raises the existing pledge and returns it');
select pg_temp.assert((select amount_cents from app.pledges where id = :'pledge') = 1500, 'the pledge is the old amount plus the added amount');
do $$ begin
  perform app.raise_rsvp_commitment((select id from app.rsvps where event_id = '50000000-0000-4000-8000-0000000000a1'), 0);
  raise exception 'FAIL: a zero amount was accepted';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: a zero amount is refused';
end $$;
-- Keeps the pledge: only the RSVP is cancelled.
select pg_temp.assert((app.cancel_my_rsvp(:'rsvp', false)->>'pledge_cancelled')::boolean = false, 'cancelling and keeping the pledge reports it stayed');
select pg_temp.assert((select status from app.rsvps where id = :'rsvp') = 'cancelled', 'the RSVP is cancelled');
select pg_temp.assert((select status from app.pledges where id = :'pledge') = 'open', 'the pledge stays open when the family says keep it');
select pg_temp.assert(not exists (select 1 from app.attendees where rsvp_id = :'rsvp' and status <> 'cancelled'), 'every ticket is released');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select app.submit_rsvp('50000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001',
  '[{"person_id":"30000000-0000-4000-8000-000000000001","name":"Priya Shah"}]', 700, 'lump_sum') as rsvp2 \gset
select commitment_pledge_id as pledge2 from app.rsvps where id = :'rsvp2' \gset
select pg_temp.assert((app.cancel_my_rsvp(:'rsvp2', true)->>'pledge_cancelled')::boolean, 'cancelling with "also cancel the pledge" cancels an unpaid pledge');
select pg_temp.assert((select status from app.pledges where id = :'pledge2') = 'cancelled', 'the pledge is cancelled');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select app.submit_rsvp('50000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-000000000001',
  '[{"person_id":"30000000-0000-4000-8000-000000000001","name":"Priya Shah"}]', 900, 'lump_sum') as rsvp3 \gset
select commitment_pledge_id as pledge3 from app.rsvps where id = :'rsvp3' \gset
reset role;
update app.pledges set paid_cents = 300, status = 'partially_paid' where id = :'pledge3';
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
-- 0543: money paid toward a cancelled pledge becomes credit; it can then be applied to another open pledge.
reset role;
insert into app.payments (id, center_id, household_id, amount_cents, status, method)
  values ('60000000-0000-4000-8000-0000000000a1', :jsh, '20000000-0000-4000-8000-000000000001', 300, 'captured', 'card');
insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents) values (:jsh, '60000000-0000-4000-8000-0000000000a1', :'pledge3', 300);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select app.household_credit('20000000-0000-4000-8000-000000000001') as base \gset
select pg_temp.assert(true, 'credit before: ' || :base);
select pg_temp.assert((app.cancel_my_rsvp(:'rsvp3', true)->>'credit_cents')::bigint = 300, 'cancelling with the pledge releases what was paid as credit');
select pg_temp.assert((select status from app.pledges where id = :'pledge3') = 'cancelled', 'the paid pledge is cancelled');
select pg_temp.assert(app.household_credit('20000000-0000-4000-8000-000000000001') = :base + 300, 'the household now has 300 more in credit');
reset role;
insert into app.pledges (id, center_id, household_id, source, amount_cents) values ('61000000-0000-4000-8000-0000000000a1', :jsh, '20000000-0000-4000-8000-000000000001', 'general', 1000);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert(app.apply_my_credit('20000000-0000-4000-8000-000000000001', array['61000000-0000-4000-8000-0000000000a1'::uuid]) > 0, 'applying credit reports the amount applied');
select pg_temp.assert((select paid_cents from app.pledges where id = '61000000-0000-4000-8000-0000000000a1') > 0, 'the chosen pledge received credit');
select pg_temp.assert(app.household_credit('20000000-0000-4000-8000-000000000001') < :base + 300, 'the credit went down');
do $$ begin
  perform app.apply_my_credit('20000000-0000-4000-8000-000000000001', array[gen_random_uuid()]);
  raise exception 'FAIL: credit applied to a pledge that is not the household''s';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: credit only goes to open pledges of the household';
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';  -- Dev, 14: a child
do $$ begin
  perform app.cancel_my_rsvp((select id from app.rsvps where event_id = '50000000-0000-4000-8000-0000000000a1' limit 1), true);
  raise exception 'FAIL: a child cancelled';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: only an adult of the household can cancel';
end $$;
commit;
