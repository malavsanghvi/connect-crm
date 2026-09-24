-- New-member workflow (0130): reference lookup, applying, reference rules, approval grants the
-- membership and records the fee as an open pledge, and the Membership switch refuses it all.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000401', 'applicant-0130@example.com'),
  ('10000000-0000-4000-8000-000000000402', 'lifeRef-0130@example.com'),
  ('10000000-0000-4000-8000-000000000403', 'coordinator-0130@example.com'),
  ('10000000-0000-4000-8000-000000000404', 'ec-0130@example.com');
insert into app.households (id, center_id, display_name) values
  ('20000000-0000-4000-8000-000000000401', :jsh, 'Applicant 0130'),
  ('20000000-0000-4000-8000-000000000402', :jsh, 'Life 0130'),
  ('20000000-0000-4000-8000-000000000403', :jsh, 'Yearly 0130');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email, member_number) values
  ('30000000-0000-4000-8000-000000000401', :jsh, 'Anand', 'Apply0130', '1985-01-01', 'applicant-0130@example.com', null),
  ('30000000-0000-4000-8000-000000000402', :jsh, 'Lata', 'Life0130', '1970-01-01', 'liferef-0130@example.com', 'T-0130-L'),
  ('30000000-0000-4000-8000-000000000403', :jsh, 'Yash', 'Yearly0130', '1975-01-01', 'yearly-0130@example.com', null),
  ('30000000-0000-4000-8000-000000000404', :jsh, 'Mona', 'Coord0130', '1975-01-01', null, null),
  ('30000000-0000-4000-8000-000000000405', :jsh, 'Esha', 'Ec0130', '1975-01-01', null, null);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('20000000-0000-4000-8000-000000000401', '30000000-0000-4000-8000-000000000401', :jsh, 'primary', true),
  ('20000000-0000-4000-8000-000000000402', '30000000-0000-4000-8000-000000000402', :jsh, 'primary', true),
  ('20000000-0000-4000-8000-000000000403', '30000000-0000-4000-8000-000000000403', :jsh, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:jsh, '10000000-0000-4000-8000-000000000401', '30000000-0000-4000-8000-000000000401'),
  (:jsh, '10000000-0000-4000-8000-000000000402', '30000000-0000-4000-8000-000000000402'),
  (:jsh, '10000000-0000-4000-8000-000000000403', '30000000-0000-4000-8000-000000000404'),
  (:jsh, '10000000-0000-4000-8000-000000000404', '30000000-0000-4000-8000-000000000405');
insert into app.role_grants (center_id, user_id, role_key, starts_at) values
  (:jsh, '10000000-0000-4000-8000-000000000403', 'membership_coordinator', now() - interval '1 day'),
  (:jsh, '10000000-0000-4000-8000-000000000404', 'executive_committee', now() - interval '1 day');
insert into app.memberships (center_id, household_id, membership_type_id, tier, status, starts_on)
  select :jsh, h, t.id, t.tier, 'active', date '2020-01-01'
    from (values ('20000000-0000-4000-8000-000000000401'::uuid, 'community'), ('20000000-0000-4000-8000-000000000402'::uuid, 'life'),
                 ('20000000-0000-4000-8000-000000000403'::uuid, 'yearly')) v(h, k)
    join app.membership_types t on t.center_id = :jsh and t.key = v.k;

-- The applicant looks up references by exact contact only.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000401';
select pg_temp.assert(
  (select eligible from app.find_membership_reference(:jsh, (select id from app.membership_types where center_id = :jsh and key = 'life'), 'LIFEREF-0130@example.com')),
  'a Life member found by email is an eligible Life reference');
select pg_temp.assert(
  (select eligible from app.find_membership_reference(:jsh, (select id from app.membership_types where center_id = :jsh and key = 'life'), 't-0130-l')),
  'found by member number too');
select pg_temp.assert(
  (select not eligible and problem like '%must be a Life member%' from app.find_membership_reference(:jsh, (select id from app.membership_types where center_id = :jsh and key = 'life'), 'yearly-0130@example.com')),
  'a Yearly member is not a Life reference, in plain English');
select pg_temp.assert(
  (select count(*) = 0 from app.find_membership_reference(:jsh, (select id from app.membership_types where center_id = :jsh and key = 'life'), 'Life0130')),
  'a name is not enough to find someone (no browsing members)');
do $$ begin
  perform app.submit_membership_application('00000000-0000-4000-8000-000000000001', (select id from app.membership_types where key = 'life' limit 1),
                                            '30000000-0000-4000-8000-000000000403', 'x');
  raise exception 'FAIL: applied with a Yearly reference for Life';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  perform pg_temp.assert(sqlerrm like '%must be a Life member%', 'submitting with a Yearly reference for Life is refused');
end $$;
select pg_temp.assert(
  app.submit_membership_application(:jsh, (select id from app.membership_types where center_id = :jsh and key = 'life'),
                                    '30000000-0000-4000-8000-000000000402', 'Neighbors') is not null,
  'the applicant applies for Life naming a Life member');
select pg_temp.assert((select status = 'awaiting_reference' and fee_cents = 50100 and reference_expires_at > now() + interval '13 days'
                         from app.my_membership_application(:jsh)), 'the application waits for the reference, carries the fee and expires per the rules');
do $$ begin
  perform app.submit_membership_application('00000000-0000-4000-8000-000000000001', (select id from app.membership_types where key = 'life' limit 1),
                                            '30000000-0000-4000-8000-000000000402', 'again');
  raise exception 'FAIL: a second open application was accepted';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  perform pg_temp.assert(sqlerrm like '%already has an application in progress%', 'a second open application is refused');
end $$;
commit;

-- The reference confirms.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000402';
select app.decide_reference((select application_id from app.my_reference_requests() limit 1), 'approved', 'Known them 10 years');
commit;
select pg_temp.assert((select status = 'awaiting_center' from app.membership_applications where household_id = '20000000-0000-4000-8000-000000000401'),
  'reference approval moves it to the center');

-- Center review, then EC approval by a different person: the membership and the fee pledge appear.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000403';
update app.membership_applications set status = 'awaiting_ec', center_decided_by = '10000000-0000-4000-8000-000000000403', center_decided_at = now()
 where household_id = '20000000-0000-4000-8000-000000000401';
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000404';
update app.membership_applications set status = 'approved', ec_decided_by = '10000000-0000-4000-8000-000000000404', ec_decided_at = now()
 where household_id = '20000000-0000-4000-8000-000000000401';
commit;
select pg_temp.assert((select m.tier = 'life' and m.status = 'active' and m.ends_on is null
                         from app.membership_applications a join app.memberships m on m.id = a.membership_id
                        where a.household_id = '20000000-0000-4000-8000-000000000401'), 'approval created an active Life membership');
select pg_temp.assert((select p.amount_cents = 50100 and p.status = 'open' and p.source = 'membership_fee'
                         from app.memberships m join app.pledges p on p.id = m.fee_pledge_id
                        where m.household_id = '20000000-0000-4000-8000-000000000401' and m.status = 'active'), 'the fee is an open membership-fee pledge');
select pg_temp.assert((select count(*) = 1 from app.memberships where household_id = '20000000-0000-4000-8000-000000000401' and status = 'active'),
  'the earlier Community membership ended');

-- Switched off, applying is refused.
-- (set_module_enabled itself is covered by 13_modules_audit_test; the row is toggled directly here.)
insert into app.center_modules (center_id, module_key, enabled, reason) values (:jsh, 'membership', false, 'test 0130')
  on conflict (center_id, module_key) do update set enabled = false;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000403';
do $$ begin
  perform app.find_membership_reference('00000000-0000-4000-8000-000000000001', (select id from app.membership_types where key = 'yearly' limit 1), 'yearly-0130@example.com');
  raise exception 'FAIL: reference lookup worked with Membership off';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  perform pg_temp.assert(sqlerrm like '%switched off%', 'reference lookup refuses while Membership is off');
end $$;
commit;
delete from app.center_modules where center_id = :jsh and module_key = 'membership';
