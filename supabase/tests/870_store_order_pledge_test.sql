-- 0870: a store order's pledge, for a payment proof.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.assert_state(stmt text, state text, label text) returns void language plpgsql as $$
begin
  execute stmt; raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> state then raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.u(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
\set c '''00000000-0000-4000-8000-000000087001'''
\set h1 '''87000000-0000-4000-8000-0000000000a1'''
\set h2 '''87000000-0000-4000-8000-0000000000a2'''
\set mina '''87000000-0000-4000-8000-000000000001'''
\set nina '''87000000-0000-4000-8000-000000000004'''
\set pmina '''87000000-0000-4000-8000-000000000101'''
\set pnina '''87000000-0000-4000-8000-000000000104'''
\set o1 '''87000000-0000-4000-8000-0000000005a1'''
begin;
select set_config('t.o1', :o1, false);
insert into auth.users (id, email) values (:mina, 'mina@store870.test'), (:nina, 'nina@store870.test');
insert into app.centers (id, slug, name, short_name, time_zone, currency) values (:c, 'store870', 'Store 870', 'S870', 'America/Chicago', 'USD');
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_at) values
  (:c, 'giving', true, 'test', now()), (:c, 'giving_proofs', true, 'test', now()) on conflict (center_id, module_key) do update set granted = true;
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Rao family'), (:h2, :c, 'Shah family');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:pmina, :c, 'Mina', 'Rao', '1980-01-01'), (:pnina, :c, 'Nina', 'Shah', '1985-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:h1, :pmina, :c, 'primary', true), (:h2, :pnina, :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c, :mina, :pmina), (:c, :nina, :pnina);
insert into app.store_orders (id, center_id, order_number, household_id, person_id, subtotal_cents, total_cents, status)
  values (:o1, :c, 'S870-1', :h1, :pmina, 4250, 4250, 'placed');
select pg_temp.as_user(:mina);
select app.store_order_pledge(:o1) as pl \gset
select set_config('t.pl', :'pl', false);
select pg_temp.assert((select amount_cents from app.pledges where id = :'pl') = 4250 and (select source::text from app.pledges where id = :'pl') = 'store'
                  and (select source_ref_id from app.pledges where id = :'pl') = :o1::uuid, 'the order gets a $42.50 store pledge');
select pg_temp.assert(app.store_order_pledge(:o1) = :'pl'::uuid, 'asking again returns the same pledge');
select pg_temp.assert((select count(*) from app.payments where household_id = :h1) = 0, 'no payment is recorded');
select pg_temp.as_user(:nina);
select pg_temp.assert_state($$select app.store_order_pledge(pg_temp.u('o1'))$$, '42501', 'another family cannot ask for it');
reset role;
update app.store_orders set status = 'cancelled' where id = :o1;
select pg_temp.assert((select status::text from app.pledges where id = :'pl') = 'cancelled', 'cancelling the order cancels its unpaid pledge');
rollback;
