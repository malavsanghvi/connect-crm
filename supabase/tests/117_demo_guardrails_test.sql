-- 0627–0629 (B88): the guardrails of a demo community and its nightly reset.
--   A. The flag (app.is_demo_center)   B. Test mode only: a demo community can never take a live payment
--   C. The hourly check the background service runs (job demo.reset): who is due, nothing else is touched, a failure keeps the data
-- (The messaging senders refuse a demo community in the worker: worker/test/messaging.demo.test.ts.)
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', label, sqlerrm;
  end if;
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
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '', true); end $$;
-- What differs between two {table: rows} answers, as text (empty = nothing).
create or replace function pg_temp.diff(a jsonb, b jsonb) returns text language sql as $$
  select coalesce(string_agg(x.k || ' ' || coalesce(a->>x.k, '0') || ' -> ' || coalesce(b->>x.k, '0'), ', ' order by x.k), '')
    from (select jsonb_object_keys(coalesce(a, '{}'::jsonb) || coalesce(b, '{}'::jsonb)) as k) x
   where coalesce(a->>x.k, '0') <> coalesce(b->>x.k, '0')
$$;
create or replace function pg_temp.hash_ids(p_center uuid, p_t text) returns text language plpgsql as $$
declare h text;
begin
  execute format('select md5(coalesce(string_agg(id::text, '','' order by id), '''')) from app.%I where center_id = $1', p_t) into h using p_center;
  return h;
end $$;
-- What the hourly check did to one community: 'reset' | 'skipped' | 'failed' (from its answer).
create or replace function pg_temp.did(p_answer jsonb, p_center text) returns text language sql as $$
  select c->>'status' from jsonb_array_elements(p_answer->'centers') c where c->>'center_id' = p_center
$$;

\set admin '''11700000-0000-4000-8000-0000000000a1'''
\set jsh '''00000000-0000-4000-8000-000000000001'''

select pg_temp.no_claims();
insert into auth.users (id, email) values (:admin, 'admin117@platform.test');
insert into app.accounts (user_id, is_platform_admin) values (:admin, true) on conflict (user_id) do update set is_platform_admin = true;
select pg_temp.claims(:admin, true);
select (app.create_demo_community('faith'))->>'center_id' as fc \gset
select (app.create_demo_community('neutral'))->>'center_id' as nc \gset
select app._create_sandbox_center('plain117', 'Plain sandbox 117', 'TX', 'Dallas', null, '{}'::jsonb) as plain_sbx \gset
insert into app.households (center_id, display_name) values (:'plain_sbx', 'Plain household');
insert into app.centers (id, slug, name, status, environment, rules) values
  ('11700000-0000-4000-8000-0000000000c1', 'prod117', 'Production 117', 'active', 'production', '{}'::jsonb),
  ('11700000-0000-4000-8000-0000000000c2', 'flagged117', 'Flagged production 117', 'active', 'production', jsonb_build_object('demo', true));

select app.demo_counts_raw(:'fc') as snap, pg_temp.hash_ids(:'fc', 'people') as h_people, pg_temp.hash_ids(:'fc', 'households') as h_hh \gset
select (extract(hour from now() at time zone 'America/Chicago')::int = 3) as is3 \gset

-- ── A. The flag ──────────────────────────────────────────────────────────────
select pg_temp.assert(app.is_demo_center(:'fc') and app.is_demo_center(:'nc'), 'both demo communities are flagged');
select pg_temp.assert(not app.is_demo_center(:jsh) and not app.is_demo_center(:'plain_sbx') and not app.is_demo_center('11700000-0000-4000-8000-0000000000c1')
                      and not app.is_demo_center(null) and not app.is_demo_center('11700000-0000-4000-8000-0000000000ff'),
  'JSH, an ordinary sandbox, a production community, nothing and a community that does not exist are not');
select pg_temp.assert(app.is_demo_center('11700000-0000-4000-8000-0000000000c2'), 'the flag alone is what counts for the guardrails');
update app.centers set rules = rules - 'demo' where id = :'fc';
select pg_temp.assert(not app.is_demo_center(:'fc'), 'take the flag away and it is an ordinary community again');
select pg_temp.assert_raises(format('select app.reset_demo_community(%L)', :'fc'), 'not a demo community', 'and then it cannot be reset');
update app.centers set rules = rules || jsonb_build_object('demo', true) where id = :'fc';
select pg_temp.assert(app.is_demo_center(:'fc'), 'put it back');
select pg_temp.assert(has_function_privilege('connect_worker', 'app.is_demo_center(uuid)', 'execute') and has_function_privilege('authenticated', 'app.is_demo_center(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.is_demo_center(uuid)', 'execute'),
  'the background service (which refuses to send) can ask; the public cannot');

-- ── B. Test mode only ────────────────────────────────────────────────────────
insert into app.center_payment_processors (center_id, processor, status) values (:'fc', 'stripe', 'test');
select pg_temp.assert((select status = 'test' from app.center_payment_processors where center_id = :'fc'), 'a demo community may have a processor in test mode');
select pg_temp.assert_raises(format('update app.center_payment_processors set status = %L where center_id = %L', 'live', :'fc'), 'test mode only',
  'but it cannot be switched to live, by any route');
select pg_temp.assert_raises(format('insert into app.center_payment_processors (center_id, processor, status) values (%L, %L, %L)', :'nc', 'paypal', 'live'), 'test mode only',
  'nor created live');
select pg_temp.assert((select status = 'test' from app.center_payment_processors where center_id = :'fc'), 'and it is still in test mode');
select pg_temp.assert_raises(format('update app.center_payment_processors set status = %L where center_id = %L', 'live', :'fc'), 'Nothing real is ever charged',
  'the refusal says why in plain words');
insert into app.center_payment_processors (center_id, processor, status) values ('11700000-0000-4000-8000-0000000000c1', 'stripe', 'live');
select pg_temp.assert((select status = 'live' from app.center_payment_processors where center_id = '11700000-0000-4000-8000-0000000000c1'),
  'an ordinary production community can still go live: nothing changed for anyone else');
select pg_temp.assert(app.payment_api_mode('11700000-0000-4000-8000-0000000000c1', 'stripe') = 'live' and app.payment_api_mode('11700000-0000-4000-8000-0000000000c1', 'paypal') = 'live'
                      and app.payment_api_mode(:'plain_sbx', 'stripe') = 'test',
  'the payment mode of ordinary communities is as it was: live in production, test in a sandbox');
select pg_temp.assert(app.payment_api_mode(:'fc', 'stripe') = 'test' and app.payment_api_mode(:'nc', 'paypal') = 'test'
                      and app.payment_api_mode('11700000-0000-4000-8000-0000000000c2', 'paypal') = 'test'
                      and app.payment_api_mode('11700000-0000-4000-8000-0000000000c2', 'stripe') = 'test',
  'the payment mode of a demo community is always test, even one that carried the flag into production');
select pg_temp.assert_raises(format('select app.set_payment_mode(%L, %L, %L, %L)', :'fc', 'stripe', 'live', 'trying'), '', 'switching a demo community to live through the portal''s function fails as well');
select pg_temp.assert(not exists (select 1 from app.center_payment_processors where center_id in (:'fc', :'nc') and status = 'live'), 'no demo processor is live');

-- ── C. The hourly check ──────────────────────────────────────────────────────
select pg_temp.assert_raises('select app.worker_demo_reset_due()', 'Only the background service', 'only the background service can run the check');
select pg_temp.no_claims();

-- Freshly made: nothing to do. (Only the two demo communities are looked at.)
set local role connect_worker;
select app.worker_demo_reset_due() as w1 \gset
reset role;
select pg_temp.assert((:'w1'::jsonb)->>'checked' = '2' and (:'w1'::jsonb)->>'skipped' = '2' and (:'w1'::jsonb)->>'reset' = '0' and (:'w1'::jsonb)->>'failed' = '0',
  'two demo communities looked at, both fresh, nothing reset');

-- Untouched but 4 days old: its dates are going stale (upcoming events must stay upcoming).
select set_config('app.client_app', 'job', true);
update app.center_demo_state set loaded_at = now() - interval '4 days' where center_id = :'fc';
set local role connect_worker;
select app.worker_demo_reset_due() as w2 \gset
reset role;
select pg_temp.assert(pg_temp.did((:'w2'::jsonb), :'fc') = 'reset' and (:'w2'::jsonb)->'centers' @> '[{"why": "dates going stale"}]'::jsonb and pg_temp.did((:'w2'::jsonb), :'nc') = 'skipped',
  'an untouched community is reset when its dates are 3 days old, the other is left alone: ' || :'w2');
select pg_temp.assert((select loaded_at > now() - interval '1 hour' from app.center_demo_state where center_id = :'fc') and pg_temp.diff(app.demo_counts_raw(:'fc'), :'snap'::jsonb) = '',
  'and its load date is fresh again, with the same data');

-- Loaded 31 hours ago, nobody touched it: still left alone (the audit log would only grow).
update app.center_demo_state set loaded_at = now() - interval '31 hours' where center_id = :'fc';
set local role connect_worker;
select app.worker_demo_reset_due() as w3 \gset
reset role;
select pg_temp.assert(pg_temp.did((:'w3'::jsonb), :'fc') = 'skipped' and pg_temp.did((:'w3'::jsonb), :'nc') = 'skipped', 'a community nobody changed is left alone');

-- Somebody changed it: reset (the night was missed, so at once).
select set_config('app.client_app', 'portal', true);
update app.households set display_name = 'Visitor edit' where id = (select id from app.households where center_id = :'fc' order by id limit 1);
insert into app.pledges (center_id, household_id, fund_id, source, amount_cents, created_by)
select :'fc', h.id, f.id, 'general', 12345, :admin from app.households h, app.funds f where h.center_id = :'fc' and f.center_id = :'fc' order by h.id, f.id limit 1;
set local role connect_worker;
select app.worker_demo_reset_due() as w4 \gset
reset role;
select pg_temp.assert(pg_temp.did((:'w4'::jsonb), :'fc') = 'reset' and pg_temp.did((:'w4'::jsonb), :'nc') = 'skipped'
                      and (:'w4'::jsonb)->'centers' @> '[{"why": "changed"}]'::jsonb,
  'a community someone changed is reset, the other is not');
select pg_temp.assert(not exists (select 1 from app.households where center_id = :'fc' and display_name = 'Visitor edit')
                      and not exists (select 1 from app.pledges where center_id = :'fc' and amount_cents = 12345)
                      and pg_temp.diff(app.demo_counts_raw(:'fc'), :'snap'::jsonb) = '' and pg_temp.hash_ids(:'fc', 'people') = :'h_people' and pg_temp.hash_ids(:'fc', 'households') = :'h_hh',
  'with the visitor''s changes gone and the same data back');
select pg_temp.assert((select status = 'loaded' and last_error is null and operation = 'reset' and requested_by = :admin from app.center_demo_state where center_id = :'fc'),
  'the state shows a reset; the person who made it is still recorded');

-- Changed two hours ago: reset only at 3 a.m. in its own time zone.
select set_config('app.client_app', 'job', true);
update app.center_demo_state set loaded_at = now() - interval '2 hours' where center_id = :'nc';
select set_config('app.client_app', 'portal', true);
update app.households set display_name = 'Visitor edit' where id = (select id from app.households where center_id = :'nc' order by id limit 1);
set local role connect_worker;
select app.worker_demo_reset_due() as w5 \gset
reset role;
select pg_temp.assert(pg_temp.did((:'w5'::jsonb), :'nc') = case when :'is3'::boolean then 'reset' else 'skipped' end,
  'a community changed recently waits for 3 a.m. local time to be reset');
select pg_temp.assert(pg_temp.did((:'w5'::jsonb), :'fc') = 'skipped', 'and the other is left alone');
select set_config('app.client_app', 'job', true);
update app.center_demo_state set loaded_at = now() - interval '31 hours' where center_id = :'nc';
set local role connect_worker;
select app.worker_demo_reset_due() as w6 \gset
reset role;
select pg_temp.assert(pg_temp.did((:'w6'::jsonb), :'nc') = 'reset' and not exists (select 1 from app.households where center_id = :'nc' and display_name = 'Visitor edit'),
  'if the night was missed (over 30 hours) it is reset at once');

-- Failed to load: tried again.
update app.center_demo_state set status = 'failed' where center_id = :'nc';
set local role connect_worker;
select app.worker_demo_reset_due() as w7 \gset
reset role;
select pg_temp.assert(pg_temp.did((:'w7'::jsonb), :'nc') = 'reset' and (select status = 'loaded' from app.center_demo_state where center_id = :'nc'),
  'a community that failed to load is loaded again');

-- Asked for: everything demo is reset; nothing else is touched.
insert into app.pledges (center_id, household_id, fund_id, source, amount_cents, created_by)
select :'nc', h.id, f.id, 'general', 54321, :admin from app.households h, app.funds f where h.center_id = :'nc' and f.center_id = :'nc' order by h.id, f.id limit 1;
select (select count(*) from app.people where center_id = :jsh) as jp, (select count(*) from app.households where center_id = :jsh) as jh \gset
set local role connect_worker;
select app.worker_demo_reset_due(true) as w8 \gset
reset role;
select pg_temp.assert((:'w8'::jsonb)->>'checked' = '2' and (:'w8'::jsonb)->>'reset' = '2' and (:'w8'::jsonb)->>'failed' = '0',
  'asked for, both demo communities are reset (and only they are looked at)');
select pg_temp.assert(not exists (select 1 from app.pledges where center_id = :'nc' and amount_cents = 54321)
                      and (select count(*) = 1 from app.households where center_id = :'plain_sbx' and display_name = 'Plain household')
                      and (select count(*) = :jp from app.people where center_id = :jsh) and (select count(*) = :jh from app.households where center_id = :jsh)
                      and (select count(*) = 0 from app.people where center_id = '11700000-0000-4000-8000-0000000000c2'),
  'an ordinary sandbox, JSH and a production community that carries the flag are not touched');

-- A failure keeps what was there, says why, and does not stop the other community.
select content->'steps'->'store' as store_orig from app.demo_packs where key = 'demo_faith_jain_v1' \gset
update app.demo_packs set content = jsonb_set(content, '{steps,store}', '[{"t":"no_such_table","r":{"x":1}}]'::jsonb) where key = 'demo_faith_jain_v1';
set local role connect_worker;
select app.worker_demo_reset_due(true) as w9 \gset
reset role;
select pg_temp.assert((:'w9'::jsonb)->>'failed' = '1' and (:'w9'::jsonb)->>'reset' = '1' and pg_temp.did((:'w9'::jsonb), :'fc') = 'failed' and pg_temp.did((:'w9'::jsonb), :'nc') = 'reset',
  'a pack that cannot load fails for its own community only');
select pg_temp.assert((:'w9'::jsonb)->'centers' @> jsonb_build_array(jsonb_build_object('center_id', :'fc', 'status', 'failed')) and (:'w9'::jsonb)::text like '%no_such_table%',
  'the answer names the table that is wrong, in the language of the job log');
select pg_temp.assert(pg_temp.diff(app.demo_counts_raw(:'fc'), :'snap'::jsonb) = '' and pg_temp.hash_ids(:'fc', 'people') = :'h_people' and (select count(*) = 25 from app.demo_personas where center_id = :'fc'),
  'the failed reset kept every row and every demo person that was there');
select pg_temp.assert((select status = 'loaded' and last_error like '%no_such_table%' from app.center_demo_state where center_id = :'fc'),
  'the failure is written on the community''s demo state, where a screen can show it');
update app.demo_packs set content = jsonb_set(content, '{steps,store}', :'store_orig'::jsonb) where key = 'demo_faith_jain_v1';
set local role connect_worker;
select app.worker_demo_reset_due(true) as w10 \gset
reset role;
select pg_temp.assert((:'w10'::jsonb)->>'failed' = '0' and (select last_error is null from app.center_demo_state where center_id = :'fc') and pg_temp.diff(app.demo_counts_raw(:'fc'), :'snap'::jsonb) = '',
  'fixed, the next run loads it and clears the error');

-- A community that is not (any longer) a sandbox is never reset, even if flagged.
select pg_temp.assert_raises($$select app.demo_populate('11700000-0000-4000-8000-0000000000c2', 'reset', null)$$, 'only for sandboxes',
  'the loader itself refuses anything that is not a sandbox');
select pg_temp.assert((select count(*) = 0 from app.people where center_id = '11700000-0000-4000-8000-0000000000c2'), 'and nothing was loaded');
rollback;
