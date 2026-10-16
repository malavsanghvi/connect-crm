-- 0875: a sandbox community with no accepted offline way gets check, cash and bank transfer; production and configured ones do not.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
\set s '''00000000-0000-4000-8000-000000087501'''
\set p '''00000000-0000-4000-8000-000000087502'''
\set k '''00000000-0000-4000-8000-000000087503'''
begin;
insert into app.centers (id, slug, name, short_name, time_zone, currency, environment) values
  (:s, 'sbx875', 'Sandbox 875', 'S875', 'America/Chicago', 'USD', 'sandbox'),
  (:p, 'prd875', 'Production 875', 'P875', 'America/Chicago', 'USD', 'production'),
  (:k, 'cfg875', 'Configured 875', 'C875', 'America/Chicago', 'USD', 'sandbox');
insert into app.center_payment_methods (center_id, method, accepted) values (:k, 'stock', true) on conflict (center_id, method) do update set accepted = true;
select app._proof_sandbox_methods(:s);
select app._proof_sandbox_methods(:p);
select app._proof_sandbox_methods(:k);
select pg_temp.assert((select array_agg(method::text order by method::text) from app.center_payment_methods where center_id = :s and accepted) = array['ach','cash','check'],
                      'the sandbox community accepts check, cash and bank transfer');
select pg_temp.assert(not exists (select 1 from app.center_payment_methods where center_id = :p), 'a production community is untouched');
select pg_temp.assert((select array_agg(method::text) from app.center_payment_methods where center_id = :k and accepted) = array['stock'], 'a community that chose its own ways keeps them');
select pg_temp.assert(app._proof_sandbox_methods(:s) = 0, 'running it again changes nothing');
rollback;
