-- Person IDs vs household IDs; near-identical names never auto-resolve.
-- Runs after 01–03 (same database, their fixtures exist).
\set ON_ERROR_STOP 1

create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

\set jsh '''00000000-0000-4000-8000-000000000001'''

-- A second household headed by another "Rahul Shah" (common at JSH).
insert into app.households (id, center_id, display_name, city) values
  ('20000000-0000-4000-8000-000000000009', :jsh, 'Rahul & Mira Shah Household', 'Katy');
update app.households set city = 'Sugar Land' where id = '20000000-0000-4000-8000-000000000001';
insert into app.people (id, center_id, first_name, last_name) values
  ('30000000-0000-4000-8000-000000000019', :jsh, 'Rahul', 'Shah'),
  ('30000000-0000-4000-8000-000000000020', :jsh, 'Mira', 'Shah');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('20000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000019', :jsh, 'primary', true),
  ('20000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000020', :jsh, 'spouse', false);

-- JSH household IDs are a separate number space: household "0417" is NOT person "0417".
insert into app.external_ids (center_id, household_id, kind, system, value, label) values
  (:jsh, '20000000-0000-4000-8000-000000000009', 'org_household', 'jsh_register', '0417', 'JSH household ID'),
  (:jsh, '20000000-0000-4000-8000-000000000001', 'org_household', 'jsh_register', '0212', 'JSH household ID');
insert into app.external_ids (center_id, person_id, kind, system, value, label) values
  (:jsh, '30000000-0000-4000-8000-000000000019', 'org_member', 'jsh_register', '1188', 'JSH member ID');

do $$ begin
  insert into app.external_ids (center_id, person_id, kind, system, value)
    values ('00000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000019', 'org_household', 'jsh_register', '9999');
  raise exception 'FAIL: household ID attached to a person';
exception when check_violation then raise notice 'PASS: a household ID can only point at a household';
end $$;
do $$ begin
  insert into app.external_ids (center_id, household_id, kind, system, value)
    values ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000009', 'org_member', 'jsh_register', '9998');
  raise exception 'FAIL: person ID attached to a household';
exception when check_violation then raise notice 'PASS: a member ID can only point at a person';
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';  -- treasurer
select pg_temp.assert((select count(*) from app.resolve_identifier('00000000-0000-4000-8000-000000000001', '417')) = 2,
                      '"417" finds person 0417 and household 0417 as two different records');
select pg_temp.assert((select string_agg(kind || ':' || household_name, ' | ' order by kind)
                         from app.resolve_identifier('00000000-0000-4000-8000-000000000001', '417'))
                      = 'org_household:Rahul & Mira Shah Household | org_member:Shah family',
                      'each hit says which kind of ID it is and which household it belongs to');
select pg_temp.assert((select org_household_id || '/' || members from app.household_card('20000000-0000-4000-8000-000000000001'))
                      = '0212/Priya, Rahul, Dev, Anya', 'household card shows the org household ID and members');
commit;

-- A Zelle from "Rahul Shah": two households have a member with that name.
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type) values
  ('e0000000-0000-4000-8000-000000000001', :jsh, 'a0000000-0000-4000-8000-000000000002', current_date, 5100,
   'Zelle Payment From Rahul Shah Jpm55qq66rr7', 'QUICKPAY_CREDIT'),
  ('e0000000-0000-4000-8000-000000000002', :jsh, 'a0000000-0000-4000-8000-000000000002', current_date, 2100,
   'Zelle Payment From Rahul Shah Jpm55qq66rr8 household 212', 'QUICKPAY_CREDIT');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
select pg_temp.assert((select count(*) from app.suggest_bank_matches('e0000000-0000-4000-8000-000000000001')) = 2,
                      'a shared name suggests both households');
select pg_temp.assert((select bool_and(ambiguous) and max(score) < 0.6 from app.suggest_bank_matches('e0000000-0000-4000-8000-000000000001')),
                      'a shared name is flagged ambiguous with low confidence');
select pg_temp.assert((select count(distinct city) from app.suggest_bank_matches('e0000000-0000-4000-8000-000000000001')) = 2,
                      'suggestions carry distinguishing details (city, IDs, members)');
select pg_temp.assert((select household_name from app.suggest_bank_matches('e0000000-0000-4000-8000-000000000002') limit 1) = 'Shah family'
                      and not (select ambiguous from app.suggest_bank_matches('e0000000-0000-4000-8000-000000000002') limit 1),
                      'a household ID in the memo resolves the ambiguity');
select app.confirm_bank_match('e0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001');
commit;

-- Next month: "Rahul Shah" is now a learned payer name for the Shah family only,
-- but the other Rahul Shah still exists, so the suggestion stays ambiguous by name
-- while ranking the learned household first.
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type) values
  ('e0000000-0000-4000-8000-000000000003', :jsh, 'a0000000-0000-4000-8000-000000000002', current_date + 30, 5100,
   'Zelle Payment From Rahul Shah Jpm55qq66rr9', 'QUICKPAY_CREDIT');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
select pg_temp.assert((select household_name from app.suggest_bank_matches('e0000000-0000-4000-8000-000000000003') limit 1) = 'Shah family',
                      'the household that used this payer name before ranks first');
select pg_temp.assert((select count(*) from app.suggest_bank_matches('e0000000-0000-4000-8000-000000000003')) = 2,
                      'the other Rahul Shah household is still offered');
commit;

\echo 'PASS: person and household ID tests'
