-- Fixes for connect-crm gaps.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''

-- finance volunteer records + allocates in one step
insert into auth.users (id, email) values ('10000000-0000-4000-8000-000000000010', 'finvol@example.com'), ('10000000-0000-4000-8000-000000000011', 'admin@example.com'),
  ('10000000-0000-4000-8000-000000000012', 'ec@example.com');
insert into app.people (id, center_id, first_name, last_name) values
  ('30000000-0000-4000-8000-000000000030', :jsh, 'Fina', 'Volunteer'), ('30000000-0000-4000-8000-000000000031', :jsh, 'Ada', 'Admin'),
  ('30000000-0000-4000-8000-000000000032', :jsh, 'Esha', 'EC');
insert into app.center_users (center_id, user_id, person_id) values
  (:jsh, '10000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000030'),
  (:jsh, '10000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000031'),
  (:jsh, '10000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000032');
insert into app.role_grants (center_id, user_id, role_key) values
  (:jsh, '10000000-0000-4000-8000-000000000010', 'finance_volunteer'),
  (:jsh, '10000000-0000-4000-8000-000000000011', 'center_admin'),
  (:jsh, '10000000-0000-4000-8000-000000000012', 'executive_committee');
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at) values
  ('60000000-0000-4000-8000-000000000041', :jsh, '20000000-0000-4000-8000-000000000009', 'general', 5000, now() - interval '9 days'),
  ('60000000-0000-4000-8000-000000000042', :jsh, '20000000-0000-4000-8000-000000000009', 'general', 7000, now() - interval '2 days');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000010';
select pg_temp.assert((select string_agg(amount_cents::text || ':' || closes, ',') from app.preview_allocation('20000000-0000-4000-8000-000000000009', 8000))
                      = '5000:true,3000:false', 'allocation preview: earliest pledge closes, remainder partial');
select pg_temp.assert((select count(*) from app.staff_household_search('00000000-0000-4000-8000-000000000001', 'Mira')) = 1,
                      'finance volunteer can find a household by a member''s name');
select app.record_offline_payment('20000000-0000-4000-8000-000000000009', 8000, 'check', current_date, null, '1044', 'E-20');
commit;
select pg_temp.assert((select status from app.pledges where id = '60000000-0000-4000-8000-000000000041') = 'paid'
                      and (select paid_cents from app.pledges where id = '60000000-0000-4000-8000-000000000042') = 3000,
                      'finance volunteer records and allocates a check in one step');

-- role grants
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000011';  -- center admin
do $$ begin
  insert into app.role_grants (center_id, user_id, role_key) values ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011', 'treasurer');
  raise exception 'FAIL: self-grant accepted';
exception when check_violation then raise notice 'PASS: nobody can grant a role to themselves';
end $$;
insert into app.role_grants (id, center_id, user_id, role_key) values
  ('f3000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000010', 'treasurer');
select pg_temp.assert((select status from app.role_grants where id = 'f3000000-0000-4000-8000-000000000001') = 'pending', 'a treasurer grant waits for a second approver');
do $$ begin
  perform app.approve_role_grant('f3000000-0000-4000-8000-000000000001');
  raise exception 'FAIL: granter approved own grant';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: the granter cannot approve their own grant';
end $$;
commit;
select pg_temp.assert(not exists (select 1 from app.role_grants where id = 'f3000000-0000-4000-8000-000000000001' and starts_at <= now()),
                      'a pending grant gives no access');

-- life membership needs EC approval by a different person
insert into app.membership_applications (id, center_id, applicant_person_id, household_id, membership_type_id, tier, status, reference_decision)
  select 'f4000000-0000-4000-8000-000000000001', :jsh, '30000000-0000-4000-8000-000000000019', '20000000-0000-4000-8000-000000000009', id, 'life', 'awaiting_center', 'approved'
  from app.membership_types where center_id = :jsh and key = 'life';
do $$ begin
  update app.membership_applications set status = 'approved', center_decided_by = '10000000-0000-4000-8000-000000000011'
   where id = 'f4000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: life membership approved without EC';
exception when check_violation then raise notice 'PASS: life membership cannot be approved without the EC';
end $$;
update app.membership_applications set status = 'approved', center_decided_by = '10000000-0000-4000-8000-000000000011',
       ec_decided_by = '10000000-0000-4000-8000-000000000012' where id = 'f4000000-0000-4000-8000-000000000001';
select pg_temp.assert((select status from app.membership_applications where id = 'f4000000-0000-4000-8000-000000000001') = 'approved',
                      'life membership approved by coordinator + EC member');

-- identical statement lines stay distinct
insert into app.bank_transactions (center_id, bank_account_id, posted_on, amount_cents, description, occurrence) values
  (:jsh, 'a0000000-0000-4000-8000-000000000002', current_date, 1000, 'CASH DEPOSIT', 1),
  (:jsh, 'a0000000-0000-4000-8000-000000000002', current_date, 1000, 'CASH DEPOSIT', 2);
select pg_temp.assert((select count(*) from app.bank_transactions where description = 'CASH DEPOSIT') = 2, 'two identical lines in one statement are both kept');

\echo 'PASS: crm gap tests'
