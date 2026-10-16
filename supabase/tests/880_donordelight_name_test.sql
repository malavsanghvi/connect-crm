-- 0880: the product is named DonorDelight in everything a person reads; the key, permissions and records are unchanged.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
begin;

select pg_temp.assert((select label from app.modules where key = 'care') = 'DonorDelight', 'the module is named DonorDelight');
select pg_temp.assert((select name = 'DonorDelight' and mark = 'DD' from app.marketplace_products where module_key = 'care'), 'the Marketplace card is named DonorDelight, mark DD');
select pg_temp.assert(not exists (select 1 from app.marketplace_products where name like '%WeCare%' or on_note like '%WeCare%' or off_note like '%WeCare%' or line like '%WeCare%' or gets::text like '%WeCare%'),
                      'no Marketplace text says WeCare');
select pg_temp.assert(not exists (select 1 from app.roles where description like '%WeCare%'), 'no role description says WeCare');
select pg_temp.assert((select count(*) from app.roles where description like 'DonorDelight:%') = 2, 'the two care roles say DonorDelight');

-- The messages people read are the new name; the logic is untouched (same functions, same attributes).
select pg_temp.assert(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                   where n.nspname = 'app' and p.prokind = 'f' and pg_get_functiondef(p.oid) like '%WeCare%'),
                      'no function in the app schema says WeCare');
select pg_temp.assert(pg_get_functiondef('app.care_row_adult()'::regprocedure) like '%DonorDelight keeps nothing about anyone under 18%', 'the under-18 refusal names DonorDelight');
select pg_temp.assert(pg_get_functiondef('app.roles_private_guard()'::regprocedure) like '%Roles that open DonorDelight or CatchTheMatch data%', 'the private-role refusal names DonorDelight');

-- The key, the permission keys and the per-kind labels are exactly as they were.
select pg_temp.assert(exists (select 1 from app.modules where key = 'care'), 'the module key is still care');
select pg_temp.assert(exists (select 1 from app.roles where key = 'care_lead' and permissions @> '["care.view","care.manage"]'::jsonb), 'care_lead still holds care.view and care.manage');
select pg_temp.assert(exists (select 1 from app.roles where key = 'relationship_owner' and permissions @> '["care.own"]'::jsonb), 'relationship_owner still holds care.own');
select pg_temp.assert(not exists (select 1 from app.category_modules cm where cm.module_key = 'care' and cm.label like '%DonorDelight%'), 'the per-kind section labels are not changed');
rollback;
