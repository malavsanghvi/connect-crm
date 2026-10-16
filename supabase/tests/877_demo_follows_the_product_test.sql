-- 0877: a demo community follows the product by itself.
--   A. A new demo community has every module the platform offers its kind (Payment confirmations, Bank reconciliation ...) except the few a
--      demo never switches on by itself, and none the kind does not have
--   B. It accepts the ways to pay another way, Zelle included
--   C. The community member's family has one payment confirmation waiting, with its soft credit on their oldest open pledge
--   D. All of that is still there after a reset (a reset used to delete the ways to pay)
--   E. The load stores a fingerprint; a demo whose fingerprint is not today's is loaded again by the next hourly check
--   F. ... unless someone is in it (it waits for 3 a.m. in its time zone), and a fresh one is left alone
-- Everything runs in one transaction that is rolled back, so no demo community is left behind for the tests that follow.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/platform"}', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '', true); end $$;
-- What the worker's check did to a community: reset, skipped, failed ...
create or replace function pg_temp.did(w jsonb, c text) returns text language sql as $$
  select x ->> 'status' from jsonb_array_elements(w -> 'centers') x where x ->> 'center_id' = c
$$;
create or replace function pg_temp.why(w jsonb, c text) returns text language sql as $$
  select x ->> 'why' from jsonb_array_elements(w -> 'centers') x where x ->> 'center_id' = c
$$;
-- A · B · C · D together, so a reset is held to exactly what a new community is.
create or replace function pg_temp.check_all(c uuid, label text) returns void language plpgsql as $$
declare v_hh uuid; v_proof app.payment_proofs; v_sc app.soft_credits;
begin
  perform pg_temp.assert(app.module_enabled(c, 'giving') and app.module_enabled(c, 'giving_proofs') and app.module_enabled(c, 'giving_bank')
                         and app.module_enabled(c, 'giving_statements') and app.module_enabled(c, 'pathshala') and app.module_enabled(c, 'store'),
    label || ' · A · Giving, Payment confirmations, Bank reconciliation, Statements, the Learning Center and the store are on');
  perform pg_temp.assert(not exists (select 1 from app.center_module_grants g where g.center_id = c and g.granted and g.module_key = any (app.demo_module_exclusions()) and g.reason like 'Demo community:%'),
    label || ' · A · the demo does not switch on iWeaver, WhatsApp, the website builder or the modules that bring a role it has no person for');
  perform pg_temp.assert(not exists (select 1 from app.center_module_grants g where g.center_id = c and g.granted and app.module_availability(c, g.module_key) = 'not_available'),
    label || ' · A · no module the kind does not have is on');
  perform pg_temp.assert((select count(*) from app.center_payment_methods m where m.center_id = c and m.accepted and m.method in ('check', 'cash', 'ach', 'zelle')) = 4,
    label || ' · B · check, cash, bank transfer and Zelle are accepted');
  select d.household_id into v_hh from app.demo_personas d where d.center_id = c and d.role_key = 'primary_adult';
  select * into v_proof from app.payment_proofs where center_id = c;
  perform pg_temp.assert((select count(*) from app.payment_proofs where center_id = c) = 1 and v_proof.status = 'submitted' and v_proof.household_id = v_hh
                         and v_proof.method = 'check' and v_proof.is_test and v_proof.amount_cents between 2500 and 10000,
    label || ' · C · one payment confirmation is waiting, from the community member''s family');
  select * into v_sc from app.soft_credits where proof_id = v_proof.id;
  perform pg_temp.assert((select count(*) from app.soft_credits where center_id = c) = 1 and v_sc.state = 'active' and v_sc.amount_cents = v_proof.amount_cents,
    label || ' · C · with its soft credit');
  perform pg_temp.assert((select p.soft_credit_cents = v_proof.amount_cents and p.household_id = v_hh and p.status in ('open', 'partially_paid') from app.pledges p where p.id = v_sc.pledge_id),
    label || ' · C · on one of the family''s open pledges, which counts the soft credit apart from what was paid');
  perform pg_temp.assert((select detail ->> 'recipe' from app.center_demo_state where center_id = c) = app.demo_recipe_hash(c),
    label || ' · E · the load stored today''s fingerprint');
end $$;

\set pat '''87700000-0000-4000-8000-000000000001'''
select pg_temp.no_claims();
insert into auth.users (id, email) values (:pat, 'pat877@platform.test');
insert into app.accounts (user_id, is_platform_admin) values (:pat, true) on conflict (user_id) do update set is_platform_admin = true;

-- ── A–C. A new faith demo community ──────────────────────────────────────────
select pg_temp.claims(:pat, true);
select app.create_demo_community('faith') as r \gset
select pg_temp.no_claims();
select (:'r'::jsonb)->>'center_id' as fc \gset
select pg_temp.assert(app.is_demo_center(:'fc'), 'the faith demo community exists');
select pg_temp.assert(not app.module_enabled(:'fc', 'bolis'), 'A · a module the kind does not have (Bolis) stays off');
select pg_temp.check_all(:'fc', 'new');

-- ── D. A reset keeps all of it ───────────────────────────────────────────────
-- A reset clears the ways to pay (they are not on the keep list); it must put them back, with the confirmation waiting.
select set_config('app.client_app', 'job', true);
select pg_temp.claims(:pat, true);
select app.reset_demo_community(:'fc') as rr \gset
select pg_temp.no_claims();
select pg_temp.check_all(:'fc', 'after a reset');

-- ── E. A demo built from an older recipe is loaded again ─────────────────────
update app.center_demo_state set detail = detail || jsonb_build_object('recipe', 'an older recipe') where center_id = :'fc';
select pg_temp.assert((select detail ->> 'recipe' from app.center_demo_state where center_id = :'fc') is distinct from app.demo_recipe_hash(:'fc'), 'E · the stored fingerprint is not today''s');
set local role connect_worker;
select app.worker_demo_reset_due() as w1 \gset
reset role;
select pg_temp.assert(pg_temp.did(:'w1'::jsonb, :'fc') = 'reset' and pg_temp.why(:'w1'::jsonb, :'fc') = 'the product changed', 'E · the hourly check loads it again: ' || :'w1');
select pg_temp.check_all(:'fc', 'after the hourly check');

-- A fresh community is left alone.
set local role connect_worker;
select app.worker_demo_reset_due() as w2 \gset
reset role;
select pg_temp.assert(pg_temp.did(:'w2'::jsonb, :'fc') = 'skipped', 'F · a community built from today''s recipe is left alone');

-- ── F. Someone is in it: it waits ────────────────────────────────────────────
-- (At 3 a.m. in its time zone it would not wait, so this part only runs at any other hour.)
select (extract(hour from (now() at time zone time_zone))::int <> 3) as notnight from app.centers where id = :'fc' \gset
\if :notnight
insert into auth.users (id, email) select '87700000-0000-4000-8000-0000000000a1', email from app.demo_personas where center_id = :'fc' and role_key = 'primary_adult' limit 1 on conflict do nothing;
select set_config('app.client_app', 'job', true);
-- (With the demo switch off the hourly check ends every session first, so the switch is on for this part.)
insert into app.platform_settings (key, value) values ('demo_signin', jsonb_build_object('enabled', true, 'reason', 'test 877'))
  on conflict (key) do update set value = excluded.value;
insert into app.demo_sessions (persona_email, user_id, role_key, ip_hash, expires_at)
  select d.email, '87700000-0000-4000-8000-0000000000a1', d.role_key, 'hash-877', now() + interval '1 hour'
    from app.demo_personas d where d.center_id = :'fc' and d.role_key = 'primary_adult';
update app.center_demo_state set detail = detail || jsonb_build_object('recipe', 'an older recipe') where center_id = :'fc';
set local role connect_worker;
select app.worker_demo_reset_due() as w3 \gset
reset role;
select pg_temp.assert(pg_temp.did(:'w3'::jsonb, :'fc') = 'skipped', 'F · a demo someone is in is not loaded again under them: ' || :'w3');
update app.demo_sessions set ended_at = now(), ended_reason = 'left' where persona_email in (select email from app.demo_personas where center_id = :'fc');
set local role connect_worker;
select app.worker_demo_reset_due() as w4 \gset
reset role;
select pg_temp.assert(pg_temp.did(:'w4'::jsonb, :'fc') = 'reset' and pg_temp.why(:'w4'::jsonb, :'fc') = 'the product changed', 'F · and once they have left, it is: ' || :'w4');
\endif
rollback;
