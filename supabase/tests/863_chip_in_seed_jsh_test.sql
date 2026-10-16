-- 0863: JSH's yearly Chip In limit ($50 per account, suggestions $2 / $5 / $10), seeded once, with asking OFF (owner, 2026-10-15).
--   A. What the migration leaves behind      B. Running it again changes nothing      C. A database without JSH is left alone
--   D. An existing setting is never overwritten      E. Nothing is asked of any member, and the seed is audited like a platform admin's save
-- Run from the supabase/ directory (as supabase/tests/run_local.sh does): \i reads the migration file itself.
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '', true);
  set local role authenticated;
end $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''

begin;
-- ── A. What the migration left behind ────────────────────────────────────────
-- (In CI the migrations run before the seed creates JSH, so the migration itself found no community and wrote nothing: that is the
-- "no-op on a database without JSH" case, as it ran. In production JSH exists and the same call writes the row.)
select pg_temp.assert(exists (select 1 from app.centers where slug = 'jsh'), 'A · the seed has created JSH');
select pg_temp.assert(app._chip_in_seed_for('no-such-community') = 'no community with that web name'
                      and not exists (select 1 from app.chip_in_settings where center_id not in (select id from app.centers)),
  'A · asking for a community that does not exist writes nothing');
delete from app.chip_in_settings where center_id = :jsh;
select count(*) as n0 from app.audit_log where record_table = 'chip_in_settings' and center_id = :jsh \gset

-- Apply the migration file itself, as the deploy does.
\i migrations/0863_chip_in_seed_jsh.sql
reset client_min_messages;
select pg_temp.assert((select s.asking = false and s.yearly_limit_cents = 5000 and s.suggested_cents = array[200,500,1000]::bigint[]
                              and s.reason = 'Owner decision 2026-10-15: $50 yearly Chip In limit per account for JSH; asking stays off until the go-live gate'
                              and s.updated_by is null
                         from app.chip_in_settings s where s.center_id = :jsh),
  'A · JSH has a $50.00 yearly limit per account, suggestions $2.00, $5.00 and $10.00, and asking OFF');
select pg_temp.assert((select count(*) = 1 from app.chip_in_settings where center_id = :jsh), 'A · exactly one row');
select pg_temp.assert((select count(*) = :n0 + 1 from app.audit_log where record_table = 'chip_in_settings' and center_id = :jsh)
                      and (select a.action = 'chip_in_settings.insert' and a.module = 'giving' and a.actor_user_id is null
                                  and a.reason = 'Owner decision 2026-10-15: $50 yearly Chip In limit per account for JSH; asking stays off until the go-live gate'
                                  and (a.after->>'yearly_limit_cents') = '5000' and (a.after->>'asking') = 'false'
                             from app.audit_log a where a.record_table = 'chip_in_settings' and a.center_id = :jsh order by a.id desc limit 1),
  'E · the seed is in the audit log with the owner''s reason, the module and the values, like a platform admin''s save');

-- ── B. Again: idempotent ─────────────────────────────────────────────────────
select count(*) as n1 from app.audit_log where record_table = 'chip_in_settings' and center_id = :jsh \gset
\i migrations/0863_chip_in_seed_jsh.sql
reset client_min_messages;
select pg_temp.assert((select count(*) = 1 from app.chip_in_settings where center_id = :jsh)
                      and (select count(*) = :n1 from app.audit_log where record_table = 'chip_in_settings' and center_id = :jsh),
  'B · running it again changes nothing and writes no audit entry');
select pg_temp.assert(app._chip_in_seed_for('jsh') = 'already set', 'B · and says so');

-- ── D. A setting somebody else made is never overwritten ─────────────────────
update app.chip_in_settings set yearly_limit_cents = 2500, suggested_cents = array[100,300]::bigint[] where center_id = :jsh;
\i migrations/0863_chip_in_seed_jsh.sql
reset client_min_messages;
select pg_temp.assert((select yearly_limit_cents = 2500 and suggested_cents = array[100,300]::bigint[] from app.chip_in_settings where center_id = :jsh),
  'D · an existing JSH setting keeps its values');

-- ── C. A database without JSH ────────────────────────────────────────────────
delete from app.chip_in_settings where center_id = :jsh;
update app.centers set slug = 'jsh-away-863' where id = :jsh;
\i migrations/0863_chip_in_seed_jsh.sql
reset client_min_messages;
select pg_temp.assert(not exists (select 1 from app.chip_in_settings where center_id = :jsh) and not exists (select 1 from app.centers where slug = 'jsh'),
  'C · with no community called "jsh" the migration writes nothing');
update app.centers set slug = 'jsh' where id = :jsh;
select pg_temp.assert(not exists (select 1 from app.chip_in_settings where center_id = :jsh), 'C · and leaves the real JSH untouched until it is there');
\i migrations/0863_chip_in_seed_jsh.sql
reset client_min_messages;
select pg_temp.assert(exists (select 1 from app.chip_in_settings where center_id = :jsh and yearly_limit_cents = 5000), 'C · once JSH is there, the same file seeds it');

-- ── E. Nothing is asked of any member ────────────────────────────────────────
select pg_temp.as_user('10000000-0000-4000-8000-000000000001');
select pg_temp.assert(not (app.my_chip_in_offer(:jsh)->>'ask')::boolean and app.my_chip_in_offer(:jsh)->>'reason' = 'switched_off',
  'E · a JSH member (Priya) is not asked: asking is off');
select pg_temp.as_none();
select pg_temp.assert(not has_function_privilege('authenticated', 'app._chip_in_seed_for(text)', 'execute')
                      and not has_function_privilege('anon', 'app._chip_in_seed_for(text)', 'execute')
                      and not has_function_privilege('connect_worker', 'app._chip_in_seed_for(text)', 'execute'),
  'E · the seed function is not on the API');
select pg_temp.assert(not exists (select 1 from app.chip_in_ledger) and not exists (select 1 from app.chip_in_settings where asking),
  'E · there is no Chip In in the ledger and no organization is asked');
rollback;
