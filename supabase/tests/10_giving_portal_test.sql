-- 0060 (stream P-GIVING): labh fulfillment rows, their RLS, and audited campaigns/opportunities.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''
-- 09 took two labh on Anya's special day (f9…20) as Priya (01); 03 is the treasurer, 06 a check-in volunteer.

select pg_temp.assert((select count(*) from app.labh_fulfillments f join app.pledges p on p.id = f.pledge_id
                        where p.source_ref_id = 'f9000000-0000-4000-8000-000000000020' and f.status = 'to_schedule'
                          and f.labh_option_id is not null) = 2,
                      'commit_labh records a to-schedule fulfillment row with the chosen labh for each pledge');
select pg_temp.assert((select string_agg(lo.name, ',' order by lo.name) from app.labh_fulfillments f
                         join app.labh_options lo on lo.id = f.labh_option_id
                         join app.pledges p on p.id = f.pledge_id
                        where p.source_ref_id = 'f9000000-0000-4000-8000-000000000020') = 'Ashtaprakari puja,Jeevdaya donation',
                      'the fulfillment remembers which labh the family chose');

-- The family (not staff) cannot read or change fulfillment rows.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert((select count(*) from app.labh_fulfillments) = 0, 'members do not read the fulfillment queue');
update app.labh_fulfillments set status = 'scheduled';
commit;
select pg_temp.assert((select count(*) from app.labh_fulfillments where status = 'scheduled') = 0, 'members cannot mark a labh scheduled');

-- The treasurer (giving.manage) marks one scheduled; it is audited.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
update app.labh_fulfillments set status = 'scheduled'
 where pledge_id = (select f.pledge_id from app.labh_fulfillments f join app.labh_options lo on lo.id = f.labh_option_id where lo.name = 'Ashtaprakari puja');
select pg_temp.assert((select count(*) from app.labh_fulfillments where status = 'scheduled'
                         and updated_by = '10000000-0000-4000-8000-000000000003') = 1, 'the treasurer marks a labh scheduled and is recorded as the updater');
commit;
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'labh_fulfillments' and action = 'labh_fulfillments.update') >= 1,
                      'scheduling a labh is audited');

do $$ begin
  insert into app.labh_fulfillments (pledge_id, center_id)
  select id, center_id from app.pledges where source <> 'labh' and center_id = '00000000-0000-4000-8000-000000000001' limit 1;
  raise exception 'FAIL: fulfillment row on a non-labh pledge';
exception when check_violation then raise notice 'PASS: fulfillment rows only point at labh pledges';
end $$;

-- A check-in volunteer (no giving permission) sees nothing.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000006';
select pg_temp.assert((select count(*) from app.labh_fulfillments) = 0, 'people without giving.view do not see labh fulfillment');
commit;

-- Campaigns and opportunities are audited (the builder says "saved and audited").
insert into app.campaigns (id, center_id, name, kind, status) values ('f9600000-0000-4000-8000-000000000001', :jsh, 'Audit test', 'general', 'draft');
insert into app.opportunities (center_id, campaign_id, name, kind, options)
values (:jsh, 'f9600000-0000-4000-8000-000000000001', 'Tiers', 'tier', '[{"key":"gold","label":"Gold","amount_cents":250000}]');
select pg_temp.assert((select count(*) from app.audit_log where record_table in ('campaigns','opportunities')
                         and record_id in ('f9600000-0000-4000-8000-000000000001',
                                           (select id::text from app.opportunities where name = 'Tiers'))) = 2,
                      'creating a campaign and an opportunity writes audit entries');
select pg_temp.assert(exists (select 1 from information_schema.columns where table_schema = 'app' and table_name = 'labh_options' and column_name = 'fulfilled_by'),
                      'the labh menu records who fulfils each labh');
