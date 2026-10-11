-- 0690: the Store module is called "My Store" (it was "Satvik Store"). Only the words changed, and only where the value was
-- exactly the old name.
--   A. The module's own name   B. The experiences' `store` term   C. Module labels   D. The notification topic
--   E. The demo community   F. The public dashboard's KPI list   G. Nothing else moved, and a second run changes nothing
--      (a name a community chose is left alone; the old name, when it reappears, is renamed)
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

-- A. The module's own name (module-off messages and Settings > Modules read it).
select pg_temp.assert((select label from app.modules where key = 'store') = 'My Store'
                      and not exists (select 1 from app.modules where label ilike '%satvik%'),
  'A · the Store module is called My Store, and no module carries the old name');
select pg_temp.assert((select label from app.modules where key = 'pathshala') = 'Pathshala'
                      and (select label from app.modules where key = 'gyan_path') = 'Gyan Path (learning)'
                      and (select label from app.modules where key = 'people') = 'Members & families'
                      and (select label from app.modules where key = 'bolis') = 'Bolis'
                      and (select label from app.modules where key = 'niva') = 'Niva assistant',
  'A · the other modules keep their names');

-- B. The Store term of the experiences.
select pg_temp.assert((select terms->>'store' from app.organization_categories where key = 'jain_center') = 'My Store'
                      and not exists (select 1 from app.organization_categories where terms->>'store' = 'Satvik Store'),
  'B · the Jain Center experience names its store My Store, and no experience keeps the old name');
select pg_temp.assert((select terms->>'greeting' = 'Jai Jinendra' and terms->>'practice_tab' = 'Jain Way' and terms->>'give_tab' = 'Give'
                              and terms->>'family_tab' = 'Family' and terms->>'school' = 'Pathshala' and terms->>'learning' = 'Gyan Path'
                              and terms->>'place' = 'derasar' and terms->>'assistant_context' = 'a Jain community'
                         from app.organization_categories where key = 'jain_center')
                      and (select terms->>'store' = 'Store' and terms->>'greeting' = 'Welcome' and terms->>'give_tab' = 'Pay'
                         from app.organization_categories where key = 'chamber_of_commerce')
                      and (select count(*) from app.organization_categories where terms->>'store' = 'Store') >= 1,
  'B · every other word of the Jain Center, and the Store word of the other experiences, are unchanged');

-- C. Module labels an experience sets.
select pg_temp.assert(not exists (select 1 from app.category_modules where label ilike '%satvik%')
                      and (select label from app.category_modules where category_key = 'chamber_of_commerce' and module_key = 'store') = 'Store'
                      and (select label from app.category_modules where category_key = 'chamber_of_commerce' and module_key = 'giving') = 'Dues & payments'
                      and (select label from app.category_modules where category_key = 'jain_center' and module_key = 'store') is null
                      and (select label from app.category_modules where category_key = 'faith_other' and module_key = 'pathshala') = 'Religious school',
  'C · no module label keeps the old name, and the labels an experience chose (Store, Dues & payments, Religious school) are unchanged');

-- D. The notification topic.
select pg_temp.assert((select name from app.notification_topics where key = 'store') = 'My Store'
                      and not exists (select 1 from app.notification_topics where name ilike '%satvik%')
                      and (select name from app.notification_topics where key = 'events') = 'Events and reminders'
                      and (select name from app.notification_topics where key = 'pathshala') = 'Pathshala updates',
  'D · the Store notification topic is called My Store; the other topics keep their names');

-- E. The demo community (its description and the label of its Store line).
select pg_temp.assert((select description not like '%Satvik Store%' and description like '%the store, a Pathshala term%'
                         from app.demo_packs where key = 'community')
                      and (select count(*) from app.demo_packs p, jsonb_array_elements(p.contents) e
                            where p.key = 'community' and e->>'module' = 'store' and e->>'label' = 'My Store') = 1
                      and not exists (select 1 from app.demo_packs where contents::text like '%Satvik Store%')
                      and (select count(*) from app.demo_packs p, jsonb_array_elements(p.contents) e
                            where p.key = 'community' and e->>'module' = 'people' and e->>'label' = 'Members & families') = 1,
  'E · the demo community says the store, and its Store line is My Store; its other lines are unchanged');

-- F. The public dashboard's KPI list (the function's own text; test 09 covers what it returns).
select pg_temp.assert((select prosrc like '%My Store orders%' and prosrc not ilike '%satvik%' and prosrc like '%Class attendance rate%'
                         from pg_proc where oid = 'app.public_kpi_catalog(uuid)'::regprocedure),
  'F · the public dashboard list calls the KPI My Store orders and still lists the others');

-- G. A second run changes nothing; a name somebody chose is left alone; the old name, when it appears again, is renamed.
select app.set_audit_context('test 136');
update app.modules set label = 'Our Shop' where key = 'store';
update app.organization_categories set terms = jsonb_set(terms, '{store}', '"Seva Shop"') where key = 'jain_center';
update app.notification_topics set name = 'Shop news' where key = 'store';
\ir ../migrations/0690_rename_my_store.sql
select pg_temp.assert((select label from app.modules where key = 'store') = 'Our Shop'
                      and (select terms->>'store' from app.organization_categories where key = 'jain_center') = 'Seva Shop'
                      and (select name from app.notification_topics where key = 'store') = 'Shop news',
  'G · a name the community chose is left alone when the migration runs again');
select app.set_audit_context('test 136');
update app.modules set label = 'Satvik Store' where key = 'store';
update app.organization_categories set terms = jsonb_set(terms, '{store}', '"Satvik Store"') where key = 'jain_center';
update app.notification_topics set name = 'Satvik Store' where key = 'store';
\ir ../migrations/0690_rename_my_store.sql
select pg_temp.assert((select label from app.modules where key = 'store') = 'My Store'
                      and (select terms->>'store' from app.organization_categories where key = 'jain_center') = 'My Store'
                      and (select name from app.notification_topics where key = 'store') = 'My Store'
                      and (select terms->>'greeting' from app.organization_categories where key = 'jain_center') = 'Jai Jinendra'
                      and (select label from app.modules where key = 'pathshala') = 'Pathshala'
                      and (select name from app.notification_topics where key = 'events') = 'Events and reminders',
  'G · the exact old name is renamed again, and nothing else is touched');

rollback;
