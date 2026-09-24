-- 0110 (stream w-giving): the household card hides its money columns while
-- Pledges & donations is switched off, and shows them again when it is on.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''
\set hh '''20000000-0000-4000-8000-000000000001'''
-- Users: 03 Tara (treasurer), 11 Ada (center admin: settings.manage).

insert into app.pledges (center_id, household_id, amount_cents, source, status)
values (:jsh, :hh, 2500, 'general', 'open');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
select pg_temp.assert((select open_pledge_cents > 0 from app.household_card(:hh)),
  'with Giving on the treasurer sees the household''s open pledges on its card');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000011';
select app.set_module_enabled(:jsh, 'bolis', false, 'card test');
select app.set_module_enabled(:jsh, 'accounting', false, 'card test');
select app.set_module_enabled(:jsh, 'giving', false, 'card test');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
select pg_temp.assert((select open_pledge_cents is null and last_gift_on is null and household_name is not null from app.household_card(:hh)),
  'with Giving off the card still identifies the household but hides open pledges and the last gift');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000011';
select app.set_module_enabled(:jsh, 'giving', true, 'card test done');
select app.set_module_enabled(:jsh, 'bolis', true, 'card test done');
select app.set_module_enabled(:jsh, 'accounting', true, 'card test done');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
select pg_temp.assert((select open_pledge_cents > 0 from app.household_card(:hh)),
  'switching Giving back on shows the money columns again');
commit;
select pg_temp.assert(not exists (select 1 from app.center_modules where not enabled), 'the test leaves every module on');
