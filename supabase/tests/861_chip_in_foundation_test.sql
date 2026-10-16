-- 0861 (build slice 1 of docs/PAYMENT_ADDONS.md, part one): the optional Chip In's settings, ledger and the Weaver team's control.
--   A. Nothing is asked by default      B. Only a platform admin writes the setting, with a reason, and every save is audited
--   C. Validation of the limit and the suggestions      D. Who reads the setting, its summary and the ledger (the RLS matrix)
--   E. What a member may be asked (my_chip_in_offer)      F. The yearly limit: what counts, the year and the mode
--   G. The ledger's own rules (states, locks, release)      H. The sweep, the overview, grants and the demo keep list
-- Everything runs in one transaction that is rolled back, in its own two communities and with its own people.
\set ON_ERROR_STOP 1
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
create or replace function pg_temp.assert_state(stmt text, state text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> state then raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/platform"}', true);
  set local role authenticated;
end $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- A ledger row with the checkout (and, when collected, the payment) it belongs to.
create or replace function pg_temp.led(p_id uuid, p_center uuid, p_hh uuid, p_person uuid, p_year integer, p_mode text, p_cents bigint,
                                       p_status text, p_expires interval default interval '26 hours', p_refunded bigint default 0)
returns void language plpgsql as $$
begin
  insert into app.payment_checkouts (id, center_id, household_id, person_id, processor, mode, context, amount_cents, for_label, status)
  values (p_id, p_center, p_hh, p_person, 'stripe', p_mode, 'other', 5000, 'Gift (test fixture)',
          case when p_status in ('collected','refunded') then 'paid' when p_status = 'released' then 'expired' else 'pending' end);
  if p_status in ('collected','refunded') then
    insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, provider_ref, received_on)
    values (p_id, p_center, p_hh, p_person, 5000, 'card', 'captured', 'stripe', 'pi_861_' || p_id::text, current_date);
  end if;
  insert into app.chip_in_ledger (id, center_id, household_id, account_person_id, calendar_year, checkout_id, payment_id, mode, chip_in_cents,
                                  application_fee_cents, refunded_cents, status, expires_at)
  values (p_id, p_center, p_hh, p_person, p_year, p_id, case when p_status in ('collected','refunded') then p_id end, p_mode, p_cents,
          p_cents, p_refunded, p_status, now() + p_expires);
end $$;

grant connect_worker to postgres;
\set c '''00000000-0000-4000-8000-000000008601'''
\set d '''00000000-0000-4000-8000-000000008602'''
\set e '''00000000-0000-4000-8000-000000008603'''
\set h1 '''86100000-0000-4000-8000-0000000000a1'''
\set h2 '''86100000-0000-4000-8000-0000000000a2'''
\set h3 '''86100000-0000-4000-8000-0000000000a3'''
\set mina '''86100000-0000-4000-8000-000000000001'''
\set raj '''86100000-0000-4000-8000-000000000002'''
\set teen '''86100000-0000-4000-8000-000000000003'''
\set tara '''86100000-0000-4000-8000-000000000004'''
\set olga '''86100000-0000-4000-8000-000000000005'''
\set nina '''86100000-0000-4000-8000-000000000006'''
\set plat '''86100000-0000-4000-8000-000000000007'''
\set dee '''86100000-0000-4000-8000-000000000008'''
\set cad '''86100000-0000-4000-8000-000000000009'''
\set pmina '''86100000-0000-4000-8000-000000000101'''
\set praj '''86100000-0000-4000-8000-000000000102'''
\set pteen '''86100000-0000-4000-8000-000000000103'''
\set pnina '''86100000-0000-4000-8000-000000000106'''
\set pdee '''86100000-0000-4000-8000-000000000108'''
\set pcad '''86100000-0000-4000-8000-000000000109'''

begin;
-- ── Fixtures: three communities, their people, and a platform admin ──────────
insert into auth.users (id, email) values
  (:mina, 'mina@chip861.test'), (:raj, 'raj@chip861.test'), (:teen, 'teen@chip861.test'), (:tara, 'tara@chip861.test'),
  (:olga, 'olga@chip861.test'), (:nina, 'nina@chip861.test'), (:plat, 'plat@chip861.test'), (:dee, 'dee@chip861.test'),
  (:cad, 'cad@chip861.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, time_zone, currency) values
  (:c, 'chip861', 'Chip 861 Temple', 'C861', 'America/Chicago', 'USD'),
  (:d, 'chip861-in', 'Chip 861 India', 'D861', 'Asia/Kolkata', 'USD'),
  (:e, 'chip861-ca', 'Chip 861 Canada', 'E861', 'America/Toronto', 'CAD');
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Rao family'), (:h2, :c, 'Shah family'), (:h3, :d, 'Iyer family');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pmina, :c, 'Mina', 'Rao', '1980-01-01'), (:praj, :c, 'Raj', 'Rao', '1979-01-01'),
  (:pteen, :c, 'Teen', 'Rao', current_date - interval '12 years'), (:pnina, :c, 'Nina', 'Shah', '1985-01-01'),
  (:pdee, :d, 'Dee', 'Iyer', '1985-01-01'), (:pcad, :e, 'Cam', 'Ads', '1985-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :pmina, :c, 'primary', true), (:h1, :praj, :c, 'spouse', false), (:h1, :pteen, :c, 'child', false),
  (:h2, :pnina, :c, 'primary', true), (:h3, :pdee, :d, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :mina, :pmina), (:c, :raj, :praj), (:c, :teen, :pteen), (:c, :nina, :pnina), (:d, :dee, :pdee), (:e, :cad, :pcad);
insert into app.role_grants (center_id, user_id, role_key) values (:c, :tara, 'treasurer');
insert into app.center_owners (center_id, user_id) values (:c, :olga);
-- Stripe is connected in all three communities (live mode in production).
insert into app.integration_connections (center_id, provider, status, external_account_id, display_name, settings)
select x.id, 'stripe', 'connected', 'acct_861' || x.n, 'Stripe', '{"mode":"live"}'::jsonb
  from (values (:c::uuid, 'c'), (:d::uuid, 'd'), (:e::uuid, 'e')) x(id, n)
on conflict (center_id, provider) do update set status = 'connected', external_account_id = excluded.external_account_id;
insert into app.center_payment_processors (center_id, processor, connection_id, is_default, methods, status)
select ic.center_id, 'stripe', ic.id, true, array['card','ach','apple_pay','google_pay'], 'live'
  from app.integration_connections ic where ic.center_id in (:c, :d, :e) and ic.provider = 'stripe'
on conflict (center_id, processor) do update set connection_id = excluded.connection_id, is_default = true, status = 'live',
                                                 methods = excluded.methods;

select app.chip_in_year(:c) as yr_c, app.chip_in_year(:d) as yr_d \gset

-- ═════════════════════════════════════════════════════════════════════════════
-- A. Nothing is asked by default
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(not exists (select 1 from app.chip_in_settings where center_id in (:c, :d, :e)), 'A · a new community has no Chip In setting at all');
select pg_temp.as_user('86100000-0000-4000-8000-000000000001');
select pg_temp.assert((app.my_chip_in_offer(:c)->>'ask')::boolean = false and app.my_chip_in_offer(:c)->>'reason' = 'switched_off',
  'A · with no setting nothing is asked of a member (switched_off)');
select pg_temp.as_user('86100000-0000-4000-8000-000000000004');
select pg_temp.assert((app.chip_in_summary(:c)->>'configured')::boolean = false and (app.chip_in_summary(:c)->>'asking')::boolean = false
                      and app.chip_in_summary(:c)->'suggested_cents' = '[]'::jsonb,
  'A · the organization''s summary says: not set, not asking');
select pg_temp.as_none();
select pg_temp.assert(not has_table_privilege('authenticated', 'app.chip_in_settings', 'insert')
                      and not has_table_privilege('authenticated', 'app.chip_in_settings', 'update')
                      and not has_table_privilege('authenticated', 'app.chip_in_settings', 'delete')
                      and not has_table_privilege('authenticated', 'app.chip_in_ledger', 'insert')
                      and not has_table_privilege('authenticated', 'app.chip_in_ledger', 'update')
                      and not has_table_privilege('authenticated', 'app.chip_in_ledger', 'delete')
                      and not has_table_privilege('anon', 'app.chip_in_ledger', 'select')
                      and not has_table_privilege('connect_worker', 'app.chip_in_ledger', 'select'),
  'A · the API can read the two tables (through RLS) and write neither; anon and the background service have no table rights');

-- ═════════════════════════════════════════════════════════════════════════════
-- B. Only a platform admin writes the setting, with a reason; every save is audited
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user('86100000-0000-4000-8000-000000000001');
select pg_temp.assert_state($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008601', 5000, array[200,500,1000]::bigint[], false, 'I would like to')$$, '42501',
  'B · a member cannot set it');
select pg_temp.as_user('86100000-0000-4000-8000-000000000004');
select pg_temp.assert_state($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008601', 5000, array[200,500,1000]::bigint[], false, 'Treasurer')$$, '42501',
  'B · the treasurer (giving.manage) cannot set it');
select pg_temp.as_user('86100000-0000-4000-8000-000000000005');
select pg_temp.assert_state($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008601', 5000, array[200,500,1000]::bigint[], false, 'Owner')$$, '42501',
  'B · nor the organization''s owner');
select pg_temp.assert_raises($$insert into app.chip_in_settings (center_id, asking) values ('00000000-0000-4000-8000-000000008601', true)$$,
  'permission denied', 'B · nobody writes the table directly, the owner included');
select pg_temp.as_user('86100000-0000-4000-8000-000000000007');
select pg_temp.assert_raises($$insert into app.chip_in_settings (center_id, asking) values ('00000000-0000-4000-8000-000000008601', true)$$,
  'permission denied', 'B · nor a platform admin, directly (only through the function)');
select pg_temp.as_none();
set local role anon;
select pg_temp.assert_raises($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008601', 5000, array[200,500,1000]::bigint[], false, 'Anon')$$,
  'permission denied', 'B · anon cannot call it');
reset role;

select pg_temp.as_user('86100000-0000-4000-8000-000000000007');
select pg_temp.assert_raises($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008601', 5000, array[200,500,1000]::bigint[], false, ' ')$$,
  'say why', 'B · a reason is required');
select pg_temp.assert_raises($$select app.platform_set_chip_in('00000000-0000-4000-8000-0000000086ff', 5000, array[200,500,1000]::bigint[], false, 'No such community')$$,
  'not found', 'B · a community that does not exist is refused');
select pg_temp.assert(not exists (select 1 from app.chip_in_settings where center_id = :c), 'B · the refusals saved nothing');
-- Saving: limit and suggestions first, asking still off.
select app.platform_set_chip_in(:c, 5000, array[200,500,1000]::bigint[], false, 'Owner decision: a $50 yearly limit per account') as saved \gset
select pg_temp.assert((:'saved'::jsonb->>'changed')::boolean and (:'saved'::jsonb->>'asking')::boolean = false
                      and (:'saved'::jsonb->>'yearly_limit_cents')::int = 5000 and :'saved'::jsonb->'suggested_cents' = '[200,500,1000]'::jsonb,
  'B · a platform admin saves the limit and the suggestions with asking off');
select pg_temp.assert((select s.asking = false and s.yearly_limit_cents = 5000 and s.suggested_cents = array[200,500,1000]::bigint[]
                              and s.reason = 'Owner decision: a $50 yearly limit per account'
                              and s.updated_by = '86100000-0000-4000-8000-000000000007'
                         from app.chip_in_settings s where s.center_id = :c),
  'B · the row holds the values and who saved them');
select pg_temp.assert((select a.reason = 'Owner decision: a $50 yearly limit per account' and a.module = 'giving' and a.center_id = :c
                              and a.actor_user_id = '86100000-0000-4000-8000-000000000007' and a.action = 'chip_in_settings.insert'
                              and (a.after->>'yearly_limit_cents') = '5000' and (a.after->>'asking') = 'false'
                         from app.audit_log a where a.record_table = 'chip_in_settings' and a.record_id = :c::text order by a.id desc limit 1),
  'B · the first save is in the audit log: who, the reason, the module and the values');
-- Same values again: nothing changes and nothing new is audited.
select count(*) as n_before from app.audit_log where record_table = 'chip_in_settings' and record_id = :c::text \gset
select app.platform_set_chip_in(:c, 5000, array[200,500,1000]::bigint[], false, 'Saved again, same values') as again \gset
select pg_temp.assert(not (:'again'::jsonb->>'changed')::boolean
                      and (select count(*) = :n_before from app.audit_log where record_table = 'chip_in_settings' and record_id = :c::text),
  'B · saving the same values again changes nothing and writes no audit row');
-- Turning asking on is its own audited change, with old and new values.
select app.platform_set_chip_in(:c, 5000, array[200,500,1000]::bigint[], true, 'Go-live gate passed: ask members') as on_ \gset
select pg_temp.assert((:'on_'::jsonb->>'changed')::boolean and (:'on_'::jsonb->>'asking')::boolean, 'B · asking is switched on by the platform admin');
select pg_temp.assert((select a.action = 'chip_in_settings.update' and a.reason = 'Go-live gate passed: ask members'
                              and (a.before->>'asking') = 'false' and (a.after->>'asking') = 'true'
                         from app.audit_log a where a.record_table = 'chip_in_settings' and a.record_id = :c::text order by a.id desc limit 1),
  'B · turning asking on is audited with the old and the new value and the reason');
select pg_temp.assert(not exists (select 1 from app.chip_in_settings where center_id in (:d, :e)), 'B · another community''s setting is untouched');

-- ═════════════════════════════════════════════════════════════════════════════
-- C. Validation: the limit, the suggestions, and what asking needs
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert_raises($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008602', 99, array[100]::bigint[], false, 'x')$$,
  'between $1.00 and $1,000.00', 'C · a limit under $1.00 is refused');
select pg_temp.assert_raises($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008602', 100001, array[100]::bigint[], false, 'x')$$,
  'between $1.00 and $1,000.00', 'C · a limit over $1,000.00 is refused, so a typo cannot ask for $10,000');
select pg_temp.assert_raises($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008602', 5000, array[100,200,300,400,500]::bigint[], false, 'x')$$,
  'at most four', 'C · more than four suggestions are refused');
select pg_temp.assert_raises($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008602', 5000, array[50,200]::bigint[], false, 'x')$$,
  'at least $1.00', 'C · a suggestion under $1.00 is refused');
select pg_temp.assert_raises($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008602', 5000, array[200,6000]::bigint[], false, 'x')$$,
  'more than the yearly limit', 'C · a suggestion above the limit is refused');
select pg_temp.assert_raises($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008602', 5000, array[500,200]::bigint[], false, 'x')$$,
  'smallest to the largest', 'C · suggestions out of order are refused');
select pg_temp.assert_raises($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008602', 5000, array[200,200]::bigint[], false, 'x')$$,
  'each different', 'C · duplicate suggestions are refused');
select pg_temp.assert_raises($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008602', null, array[200]::bigint[], true, 'x')$$,
  'before asking members', 'C · asking without a limit is refused');
select pg_temp.assert_raises($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008602', 5000, array[]::bigint[], true, 'x')$$,
  'at least one suggested', 'C · asking without a suggestion is refused');
select pg_temp.assert_raises($$select app.platform_set_chip_in('00000000-0000-4000-8000-000000008602', 5000, null, true, 'x')$$,
  'at least one suggested', 'C · asking with no suggestions at all (null) is refused');
select pg_temp.assert(not exists (select 1 from app.chip_in_settings where center_id = :d), 'C · none of the refusals saved anything');
select pg_temp.assert((app.platform_set_chip_in(:d, 100, array[100]::bigint[], false, 'Lowest values')->>'changed')::boolean
                      and (app.platform_set_chip_in(:d, 100000, array[100,100000]::bigint[], false, 'Highest values')->>'changed')::boolean,
  'C · $1.00 and $1,000.00 are the edges: both are accepted');
select (app.platform_set_chip_in(:d, null, '{}'::bigint[], false, 'Cleared')->>'changed')::boolean as cleared \gset
select pg_temp.assert(:'cleared'::boolean
                      and (select yearly_limit_cents is null and suggested_cents = '{}' and not asking from app.chip_in_settings where center_id = :d),
  'C · the limit can be cleared again (asking off)');
select pg_temp.as_none();
-- The table refuses the same things whoever writes.
select pg_temp.assert_raises($$insert into app.chip_in_settings (center_id, asking, yearly_limit_cents, suggested_cents) values ('00000000-0000-4000-8000-000000008603', true, null, '{}')$$,
  'chip_in_settings_asking_needs_setup', 'C · the table itself refuses asking without a limit and a suggestion');
select pg_temp.assert_raises($$insert into app.chip_in_settings (center_id, yearly_limit_cents, suggested_cents) values ('00000000-0000-4000-8000-000000008603', 5000, array[200,100]::bigint[])$$,
  'chip_in_settings_suggestions', 'C · and unordered suggestions');
select pg_temp.assert_raises($$insert into app.chip_in_settings (center_id, yearly_limit_cents) values ('00000000-0000-4000-8000-000000008603', 5)$$,
  'chip_in_settings_yearly_limit_cents_check', 'C · and a limit under $1.00');

-- ═════════════════════════════════════════════════════════════════════════════
-- D. Who reads the setting, its summary and the ledger
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.led('86100000-0000-4000-8000-000000000a01', :c, :h1, :pmina, app.chip_in_year(:c), 'live', 500, 'collected');
select pg_temp.led('86100000-0000-4000-8000-000000000a02', :c, :h2, :pnina, app.chip_in_year(:c), 'live', 200, 'collected');
select pg_temp.led('86100000-0000-4000-8000-000000000a03', :d, :h3, :pdee, app.chip_in_year(:d), 'live', 1000, 'collected');
select pg_temp.as_user('86100000-0000-4000-8000-000000000007');
select pg_temp.assert((select count(*) = 2 from app.chip_in_settings) and (select count(*) = 3 from app.chip_in_ledger
                          where id in ('86100000-0000-4000-8000-000000000a01','86100000-0000-4000-8000-000000000a02','86100000-0000-4000-8000-000000000a03')),
  'D · a platform admin reads the settings and every ledger row');
select pg_temp.as_user('86100000-0000-4000-8000-000000000004');
select pg_temp.assert(not exists (select 1 from app.chip_in_settings), 'D · the treasurer cannot read the setting table');
select pg_temp.assert(not exists (select 1 from app.chip_in_ledger), 'D · nor any ledger row: not even through giving.manage');
select pg_temp.assert((app.chip_in_summary(:c)->>'configured')::boolean and (app.chip_in_summary(:c)->>'asking')::boolean
                      and (app.chip_in_summary(:c)->>'yearly_limit_cents')::int = 5000 and app.chip_in_summary(:c)->'suggested_cents' = '[200,500,1000]'::jsonb
                      and not (app.chip_in_summary(:c) ? 'reason') and not (app.chip_in_summary(:c) ? 'updated_by'),
  'D · but she reads the summary through the function: asking, the limit and the suggestions, with no reason and no names');
select pg_temp.assert_raises($$select app.chip_in_summary('00000000-0000-4000-8000-000000008602')$$, 'needs integrations.view',
  'D · and not another community''s summary');
select pg_temp.as_user('86100000-0000-4000-8000-000000000005');
select pg_temp.assert(not exists (select 1 from app.chip_in_ledger) and not exists (select 1 from app.chip_in_settings)
                      and (app.chip_in_summary(:c)->>'asking')::boolean,
  'D · the organization''s owner reads the summary only');
select pg_temp.as_user('86100000-0000-4000-8000-000000000001');
select pg_temp.assert(not exists (select 1 from app.chip_in_settings), 'D · a member cannot read the setting table');
select pg_temp.assert((select count(*) = 1 and bool_and(id = '86100000-0000-4000-8000-000000000a01') from app.chip_in_ledger),
  'D · Mina reads her own Chip In and nobody else''s');
select pg_temp.assert_raises($$select app.chip_in_summary('00000000-0000-4000-8000-000000008601')$$, 'needs integrations.view',
  'D · and the summary is not for a member');
select pg_temp.assert_raises($$update app.chip_in_ledger set chip_in_cents = 1 where id = '86100000-0000-4000-8000-000000000a01'$$,
  'permission denied', 'D · she cannot change a row');
select pg_temp.assert_raises($$delete from app.chip_in_ledger where id = '86100000-0000-4000-8000-000000000a01'$$,
  'permission denied', 'D · or delete one');
select pg_temp.as_user('86100000-0000-4000-8000-000000000002');
select pg_temp.assert((select count(*) = 1 and bool_and(id = '86100000-0000-4000-8000-000000000a01') from app.chip_in_ledger),
  'D · Raj, the other adult of the household, reads the same one');
select pg_temp.as_user('86100000-0000-4000-8000-000000000003');
select pg_temp.assert(not exists (select 1 from app.chip_in_ledger), 'D · the child of the household reads nothing');
select pg_temp.as_user('86100000-0000-4000-8000-000000000006');
select pg_temp.assert((select count(*) = 1 and bool_and(id = '86100000-0000-4000-8000-000000000a02') from app.chip_in_ledger),
  'D · Nina, of another household, reads only hers');
select pg_temp.as_user('86100000-0000-4000-8000-000000000008');
select pg_temp.assert((select count(*) = 1 and bool_and(id = '86100000-0000-4000-8000-000000000a03') from app.chip_in_ledger),
  'D · Dee, of another community, reads only hers');
select pg_temp.as_none();
set local role anon;
select pg_temp.assert_raises($$select count(*) from app.chip_in_ledger$$, 'permission denied', 'D · anon reads nothing');
reset role;
-- With Giving switched off for the community, its members' reads end (the module switch); a platform admin still passes.
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving', false, 'test 861');
select pg_temp.as_user('86100000-0000-4000-8000-000000000001');
select pg_temp.assert(not exists (select 1 from app.chip_in_ledger), 'D · with Giving off, Mina''s Chip In rows are hidden by the module switch');
select pg_temp.assert_raises($$select app.my_chip_in_offer('00000000-0000-4000-8000-000000008601')$$, 'switched off',
  'D · and the offer refuses in plain words');
select pg_temp.as_user('86100000-0000-4000-8000-000000000007');
select pg_temp.assert((select count(*) = 3 from app.chip_in_ledger where id in ('86100000-0000-4000-8000-000000000a01','86100000-0000-4000-8000-000000000a02','86100000-0000-4000-8000-000000000a03')),
  'D · a platform admin still reads everything');
select pg_temp.as_none();
delete from app.center_modules where center_id = :c and module_key = 'giving';

-- ═════════════════════════════════════════════════════════════════════════════
-- E. What a member may be asked
-- ═════════════════════════════════════════════════════════════════════════════
-- (Mina has $5.00 collected this year against the $50.00 limit; asking is on in c.)
select pg_temp.as_user('86100000-0000-4000-8000-000000000001');
select pg_temp.assert((app.my_chip_in_offer(:c)->>'ask')::boolean and app.my_chip_in_offer(:c)->>'mode' = 'live'
                      and (app.my_chip_in_offer(:c)->>'yearly_limit_cents')::int = 5000 and (app.my_chip_in_offer(:c)->>'used_cents')::int = 500
                      and (app.my_chip_in_offer(:c)->>'left_cents')::int = 4500
                      and app.my_chip_in_offer(:c)->'suggested_cents' = '[200,500,1000]'::jsonb
                      and (app.my_chip_in_offer(:c)->>'min_other_cents')::int = 100 and (app.my_chip_in_offer(:c)->>'max_other_cents')::int = 4500
                      and (app.my_chip_in_offer(:c)->>'calendar_year')::int = :yr_c,
  'E · an adult is asked: the suggestions, "Other" from $1.00 up to what is left, the amount used, left and the limit');
select pg_temp.as_user('86100000-0000-4000-8000-000000000002');
select pg_temp.assert((app.my_chip_in_offer(:c)->>'used_cents')::int = 0, 'E · the allowance is per login: Raj has used nothing, though his spouse has');
select pg_temp.as_user('86100000-0000-4000-8000-000000000003');
select pg_temp.assert(not (app.my_chip_in_offer(:c)->>'ask')::boolean and app.my_chip_in_offer(:c)->>'reason' = 'not_adult',
  'E · a child is not asked (not_adult)');
select pg_temp.as_user('86100000-0000-4000-8000-000000000008');
select pg_temp.assert(not (app.my_chip_in_offer(:c)->>'ask')::boolean and app.my_chip_in_offer(:c)->>'reason' = 'no_account',
  'E · someone with no login in the community is not asked (no_account)');
select pg_temp.assert(not (app.my_chip_in_offer(:d)->>'ask')::boolean and app.my_chip_in_offer(:d)->>'reason' = 'switched_off',
  'E · another community with nothing switched on asks nothing, even when its limit is cleared');
select pg_temp.as_none();
select pg_temp.assert_raises($$select app.my_chip_in_offer('00000000-0000-4000-8000-000000008601')$$, 'sign in to pay', 'E · signed out: refused');
-- Near the limit: only the suggestions that still fit; at the limit, nothing.
select pg_temp.led('86100000-0000-4000-8000-000000000b01', :c, :h1, :pmina, app.chip_in_year(:c), 'live', 3600, 'collected');
select pg_temp.as_user('86100000-0000-4000-8000-000000000001');
select pg_temp.assert((app.my_chip_in_offer(:c)->>'left_cents')::int = 900 and app.my_chip_in_offer(:c)->'suggested_cents' = '[200,500]'::jsonb
                      and (app.my_chip_in_offer(:c)->>'max_other_cents')::int = 900,
  'E · with $9.00 left, the $10.00 suggestion is hidden and "Other" stops at $9.00');
select pg_temp.as_none();
select pg_temp.led('86100000-0000-4000-8000-000000000b02', :c, :h1, :pmina, app.chip_in_year(:c), 'live', 850, 'collected');
select pg_temp.as_user('86100000-0000-4000-8000-000000000001');
select pg_temp.assert(not (app.my_chip_in_offer(:c)->>'ask')::boolean and app.my_chip_in_offer(:c)->>'reason' = 'limit_reached'
                      and (app.my_chip_in_offer(:c)->>'left_cents')::int = 50 and app.my_chip_in_offer(:c)->'suggested_cents' = '[]'::jsonb,
  'E · with under $1.00 left nothing is asked (limit_reached)');
select pg_temp.as_none();
-- Switched off by the platform, or Stripe missing, or the Card way to pay paused, or not US dollars.
select pg_temp.as_user('86100000-0000-4000-8000-000000000007');
select app.platform_set_chip_in(:c, 5000, array[200,500,1000]::bigint[], false, 'Pause asking') as off_ \gset
select pg_temp.as_user('86100000-0000-4000-8000-000000000002');
select pg_temp.assert(not (app.my_chip_in_offer(:c)->>'ask')::boolean and app.my_chip_in_offer(:c)->>'reason' = 'switched_off',
  'E · the platform admin switches asking off and the next offer is switched_off');
select pg_temp.as_user('86100000-0000-4000-8000-000000000007');
select app.platform_set_chip_in(:c, 5000, array[200,500,1000]::bigint[], true, 'Resume asking') as on2 \gset
select pg_temp.as_none();
update app.center_payment_processors set status = 'not_connected' where center_id = :c and processor = 'stripe';
select pg_temp.as_user('86100000-0000-4000-8000-000000000002');
select pg_temp.assert(not (app.my_chip_in_offer(:c)->>'ask')::boolean and app.my_chip_in_offer(:c)->>'reason' = 'no_stripe',
  'E · without Stripe in test or live mode nothing is asked (no_stripe)');
select pg_temp.as_none();
update app.center_payment_processors set status = 'live' where center_id = :c and processor = 'stripe';
insert into app.payment_plugin_suspensions (plugin_key, target_center, reason, suspended_by) values ('card', :c, 'test 861', :plat);
select pg_temp.as_user('86100000-0000-4000-8000-000000000002');
select pg_temp.assert(not (app.my_chip_in_offer(:c)->>'ask')::boolean and app.my_chip_in_offer(:c)->>'reason' = 'paused',
  'E · while the Card way to pay is paused nothing is asked (paused)');
select pg_temp.as_none();
update app.payment_plugin_suspensions set lifted_at = now(), lifted_by = :plat, lift_reason = 'test 861 over' where target_center = :c and lifted_at is null;
select pg_temp.as_user('86100000-0000-4000-8000-000000000002');
select pg_temp.assert((app.my_chip_in_offer(:c)->>'ask')::boolean, 'E · and asking resumes when the pause is lifted');
select pg_temp.as_user('86100000-0000-4000-8000-000000000007');
select app.platform_set_chip_in(:e, 5000, array[200,500]::bigint[], true, 'Canada') as ca \gset
select pg_temp.as_user('86100000-0000-4000-8000-000000000009');
select pg_temp.assert(not (app.my_chip_in_offer(:e)->>'ask')::boolean and app.my_chip_in_offer(:e)->>'reason' = 'not_usd',
  'E · a community that does not use US dollars is not asked (not_usd)');
select pg_temp.as_none();

-- ═════════════════════════════════════════════════════════════════════════════
-- F. The yearly limit: what counts, the year and the mode
-- ═════════════════════════════════════════════════════════════════════════════
-- A fresh account for these checks: Nina, in c, this year, live.
select app.chip_in_used_cents(:c, :pnina, app.chip_in_year(:c), 'live') as base_used \gset
select pg_temp.assert(:base_used = 200, 'F · Nina starts with the $2.00 collected in D');
select pg_temp.led('86100000-0000-4000-8000-000000000c01', :c, :h2, :pnina, app.chip_in_year(:c), 'live', 300, 'reserved');
select pg_temp.assert(app.chip_in_used_cents(:c, :pnina, app.chip_in_year(:c), 'live') = 500, 'F · a reserved row that has not expired counts');
select pg_temp.led('86100000-0000-4000-8000-000000000c02', :c, :h2, :pnina, app.chip_in_year(:c), 'live', 400, 'reserved', interval '-1 minute');
select pg_temp.assert(app.chip_in_used_cents(:c, :pnina, app.chip_in_year(:c), 'live') = 500, 'F · a reserved row past its expiry does not count, even before the sweep releases it');
select pg_temp.led('86100000-0000-4000-8000-000000000c03', :c, :h2, :pnina, app.chip_in_year(:c), 'live', 600, 'released');
select pg_temp.assert(app.chip_in_used_cents(:c, :pnina, app.chip_in_year(:c), 'live') = 500, 'F · a released row does not count');
select pg_temp.led('86100000-0000-4000-8000-000000000c04', :c, :h2, :pnina, app.chip_in_year(:c), 'live', 700, 'refunded', interval '0 seconds', 700);
select pg_temp.assert(app.chip_in_used_cents(:c, :pnina, app.chip_in_year(:c), 'live') = 500, 'F · a fully refunded Chip In gives its allowance back');
select pg_temp.led('86100000-0000-4000-8000-000000000c05', :c, :h2, :pnina, app.chip_in_year(:c), 'live', 800, 'collected', interval '0 seconds', 300);
select pg_temp.assert(app.chip_in_used_cents(:c, :pnina, app.chip_in_year(:c), 'live') = 1000, 'F · a partly refunded one counts at what is left of it ($8.00 less $3.00)');
select pg_temp.led('86100000-0000-4000-8000-000000000c06', :c, :h2, :pnina, app.chip_in_year(:c) - 1, 'live', 4000, 'collected');
select pg_temp.assert(app.chip_in_used_cents(:c, :pnina, app.chip_in_year(:c), 'live') = 1000
                      and app.chip_in_used_cents(:c, :pnina, app.chip_in_year(:c) - 1, 'live') = 4000,
  'F · last year''s Chip In does not count this year: the limit starts again on 1 January');
select pg_temp.led('86100000-0000-4000-8000-000000000c07', :c, :h2, :pnina, app.chip_in_year(:c), 'test', 900, 'collected');
select pg_temp.assert(app.chip_in_used_cents(:c, :pnina, app.chip_in_year(:c), 'live') = 1000
                      and app.chip_in_used_cents(:c, :pnina, app.chip_in_year(:c), 'test') = 900,
  'F · a test-mode Chip In never counts toward a live allowance (and the sandbox enforces the limit among its own test rows)');
select pg_temp.assert(app.chip_in_used_cents(:c, :pmina, app.chip_in_year(:c), 'live') = 4950
                      and app.chip_in_used_cents(:d, :pmina, app.chip_in_year(:d), 'live') = 0,
  'F · other accounts and other communities are separate');
-- The year is the one in the organization's time zone.
select pg_temp.assert(app.chip_in_year(:c, '2026-12-31 23:30:00-06') = 2026 and app.chip_in_year(:c, '2027-01-01 00:00:01-06') = 2027
                      and app.chip_in_year(:c, '2027-01-01 05:59:59+00') = 2026 and app.chip_in_year(:c, '2027-01-01 06:00:00+00') = 2027,
  'F · in Houston 23:30 on 31 December is still that year, and 00:00:01 on 1 January is the next, whatever UTC says');
select pg_temp.assert(app.chip_in_year(:d, '2026-12-31 18:29:59+00') = 2026 and app.chip_in_year(:d, '2026-12-31 18:30:00+00') = 2027,
  'F · in India the new year starts at 18:30 UTC');
select pg_temp.assert(app.chip_in_year(:c) = extract(year from now() at time zone 'America/Chicago')::integer
                      and app.chip_in_year(:d) = extract(year from now() at time zone 'Asia/Kolkata')::integer,
  'F · the default is now, in each community''s own zone');
-- The used amount shows in the offer, and the limit shows as reached when the sum reaches it.
select pg_temp.led('86100000-0000-4000-8000-000000000c08', :c, :h2, :pnina, app.chip_in_year(:c), 'live', 4000, 'reserved');
select pg_temp.as_user('86100000-0000-4000-8000-000000000006');
select pg_temp.assert((app.my_chip_in_offer(:c)->>'used_cents')::int = 5000 and not (app.my_chip_in_offer(:c)->>'ask')::boolean
                      and app.my_chip_in_offer(:c)->>'reason' = 'limit_reached',
  'F · a $40.00 reservation on top of $10.00 brings Nina to the limit: nothing more is asked');
select pg_temp.as_none();

-- ═════════════════════════════════════════════════════════════════════════════
-- G. The ledger's own rules: the lock, the states, release and collection
-- ═════════════════════════════════════════════════════════════════════════════
-- The lock: held until the transaction ends, one per account and year, and the same one twice is no problem.
savepoint lock_check;
select app.chip_in_lock(:c, :pmina, 2026);
select pg_temp.assert((select count(*) = 1 from pg_locks where locktype = 'advisory' and coalesce(pid, pg_backend_pid()) = pg_backend_pid() and granted),
  'G · taking the lock holds one advisory lock for the account and year');
select app.chip_in_lock(:c, :pmina, 2026);
select pg_temp.assert((select count(*) = 1 from pg_locks where locktype = 'advisory' and coalesce(pid, pg_backend_pid()) = pg_backend_pid() and granted),
  'G · taking it again is the same lock');
select app.chip_in_lock(:c, :pmina, 2027);
select app.chip_in_lock(:c, :pnina, 2026);
select pg_temp.assert((select count(*) = 3 from pg_locks where locktype = 'advisory' and coalesce(pid, pg_backend_pid()) = pg_backend_pid() and granted),
  'G · another year, or another account, is another lock');
rollback to savepoint lock_check;
-- (The lock is transaction-scoped: rolling back to the savepoint releases it.)
select pg_temp.assert((select count(*) = 0 from pg_locks where locktype = 'advisory' and coalesce(pid, pg_backend_pid()) = pg_backend_pid() and granted),
  'G · and it is released when the transaction part ends');

-- Collecting and releasing, through the internal functions the worker uses (0862).
select pg_temp.led('86100000-0000-4000-8000-000000000d01', :c, :h1, :praj, app.chip_in_year(:c), 'live', 500, 'reserved');
select app._chip_in_release('86100000-0000-4000-8000-000000000d01') as rel1 \gset
select pg_temp.assert(:rel1 = 1
                      and (select status = 'released' and released_at is not null from app.chip_in_ledger where id = '86100000-0000-4000-8000-000000000d01'),
  'G · a failed or cancelled checkout releases its reservation');
select pg_temp.assert(app._chip_in_release('86100000-0000-4000-8000-000000000d01') = 0, 'G · releasing twice does nothing');
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, provider_ref, received_on)
values ('86100000-0000-4000-8000-000000000e01', :c, :h1, :praj, 5000, 'card', 'captured', 'stripe', 'pi_861_late', current_date);
select app._chip_in_collect('86100000-0000-4000-8000-000000000d01', '86100000-0000-4000-8000-000000000e01', 485) as col1 \gset
select pg_temp.assert(:col1 = 1
                      and (select status = 'collected' and payment_id = '86100000-0000-4000-8000-000000000e01' and application_fee_cents = 485
                                  and released_at is null and collected_at is not null
                             from app.chip_in_ledger where id = '86100000-0000-4000-8000-000000000d01'),
  'G · money that arrives for a released reservation is collected all the same (the allowance is used because the money was taken)');
select pg_temp.assert(app._chip_in_release('86100000-0000-4000-8000-000000000d01') = 0
                      and (select status from app.chip_in_ledger where id = '86100000-0000-4000-8000-000000000d01') = 'collected',
  'G · a collected row is never released');
select pg_temp.assert(app._chip_in_collect('86100000-0000-4000-8000-000000000d01', '86100000-0000-4000-8000-000000000e01', 485) = 0,
  'G · and never collected twice');
-- Guards: the amount and the account never change, the states only move forward, a refund is never taken back.
select pg_temp.assert_raises($$update app.chip_in_ledger set chip_in_cents = 600 where id = '86100000-0000-4000-8000-000000000d01'$$,
  'keeps its account, year, mode and amount', 'G · the amount of a Chip In cannot be changed');
select pg_temp.assert_raises($$update app.chip_in_ledger set account_person_id = '86100000-0000-4000-8000-000000000106' where id = '86100000-0000-4000-8000-000000000d01'$$,
  'keeps its account, year, mode and amount', 'G · nor its account');
select pg_temp.assert_raises($$update app.chip_in_ledger set mode = 'test' where id = '86100000-0000-4000-8000-000000000d01'$$,
  'keeps its account, year, mode and amount', 'G · nor its mode');
select pg_temp.assert_raises($$update app.chip_in_ledger set status = 'reserved', payment_id = null where id = '86100000-0000-4000-8000-000000000d01'$$,
  'cannot change from collected to reserved', 'G · a collected Chip In cannot go back to reserved');
select pg_temp.assert_raises($$update app.chip_in_ledger set status = 'refunded', refunded_cents = 100 where id = '86100000-0000-4000-8000-000000000d01'$$,
  'only when all of it was refunded', 'G · a Chip In is "refunded" only when all of it is');
update app.chip_in_ledger set refunded_cents = 200 where id = '86100000-0000-4000-8000-000000000d01';
select pg_temp.assert(app.chip_in_used_cents(:c, :praj, app.chip_in_year(:c), 'live') = 300, 'G · a partial refund returns that much of the allowance');
select pg_temp.assert_raises($$update app.chip_in_ledger set refunded_cents = 100 where id = '86100000-0000-4000-8000-000000000d01'$$,
  'cannot be taken back', 'G · a refund cannot be taken back');
update app.chip_in_ledger set refunded_cents = 500, status = 'refunded' where id = '86100000-0000-4000-8000-000000000d01';
select pg_temp.assert(app.chip_in_used_cents(:c, :praj, app.chip_in_year(:c), 'live') = 0, 'G · a full refund returns all of it');
select pg_temp.assert_raises($$insert into app.chip_in_ledger (center_id, account_person_id, calendar_year, checkout_id, mode, chip_in_cents, status, expires_at, payment_id)
  values ('00000000-0000-4000-8000-000000008601', '86100000-0000-4000-8000-000000000101', 2026, '86100000-0000-4000-8000-000000000a01', 'live', 100, 'collected', now(), null)$$,
  'chip_in_ledger', 'G · the table refuses a collected row with no payment, and a second row for one checkout');
select pg_temp.assert_raises($$insert into app.chip_in_ledger (center_id, account_person_id, calendar_year, checkout_id, mode, chip_in_cents, application_fee_cents, status, expires_at)
  values ('00000000-0000-4000-8000-000000008601', '86100000-0000-4000-8000-000000000101', 2026, '86100000-0000-4000-8000-000000000a02', 'live', 100, 101, 'reserved', now())$$,
  'chip_in_ledger', 'G · and an application fee larger than the Chip In');

-- ═════════════════════════════════════════════════════════════════════════════
-- H. The sweep, the overview, the grants and the demo keep list
-- ═════════════════════════════════════════════════════════════════════════════
-- Three reservations: one expired, one whose checkout failed, one still good.
select pg_temp.led('86100000-0000-4000-8000-000000000f01', :c, :h2, :pnina, app.chip_in_year(:c) - 1, 'live', 100, 'reserved', interval '-2 hours');
select pg_temp.led('86100000-0000-4000-8000-000000000f02', :c, :h2, :pnina, app.chip_in_year(:c) - 1, 'live', 100, 'reserved', interval '20 hours');
update app.payment_checkouts set status = 'failed' where id = '86100000-0000-4000-8000-000000000f02';
select pg_temp.led('86100000-0000-4000-8000-000000000f03', :c, :h2, :pnina, app.chip_in_year(:c) - 1, 'live', 100, 'reserved', interval '20 hours');
select pg_temp.as_user('86100000-0000-4000-8000-000000000004');
select pg_temp.assert_raises($$select app.worker_release_chip_ins()$$, 'permission denied', 'H · the treasurer cannot run the sweep');
select pg_temp.as_none();
set local role anon;
select pg_temp.assert_raises($$select app.worker_release_chip_ins()$$, 'permission denied', 'H · nor anon');
reset role;
set local role connect_worker;
select app.worker_release_chip_ins() as swept \gset
reset role;
select pg_temp.assert(:swept >= 2 and (select status = 'released' from app.chip_in_ledger where id = '86100000-0000-4000-8000-000000000f01')
                      and (select status = 'released' from app.chip_in_ledger where id = '86100000-0000-4000-8000-000000000f02')
                      and (select status = 'reserved' from app.chip_in_ledger where id = '86100000-0000-4000-8000-000000000f03'),
  'H · the sweep releases the expired reservation and the one whose checkout failed, and leaves the one still good');
select pg_temp.assert((select a.client_app = 'job' and a.reason like 'Background service: released Chip In reservations%' and a.module = 'giving'
                         from app.audit_log a where a.record_table = 'chip_in_ledger' and a.record_id = '86100000-0000-4000-8000-000000000f01' and a.action = 'chip_in_ledger.update'
                        order by a.id desc limit 1),
  'H · and the release is audited as the background service');
set local role connect_worker;
select pg_temp.assert(app.worker_release_chip_ins() = 0, 'H · running it again releases nothing');
reset role;
-- The overview: platform admins only, no names, test apart.
select pg_temp.as_user('86100000-0000-4000-8000-000000000004');
select pg_temp.assert_state($$select app.chip_in_overview('00000000-0000-4000-8000-000000008601')$$, '42501', 'H · the overview is not for the treasurer');
select pg_temp.as_user('86100000-0000-4000-8000-000000000007');
select app.chip_in_overview(:c) as ov \gset
select pg_temp.assert((:'ov'::jsonb->>'calendar_year')::int = :yr_c and (:'ov'::jsonb->>'asking')::boolean
                      and (:'ov'::jsonb#>>'{live,collected_cents}')::int = 500 + 3600 + 850 + 200 + 700 + 800 + 500
                      and (:'ov'::jsonb#>>'{live,refunded_cents}')::int = 700 + 300 + 500
                      and (:'ov'::jsonb#>>'{test,collected_cents}')::int = 900
                      and (:'ov'::jsonb#>>'{live,accounts}')::int = 3
                      and (:'ov'::jsonb#>>'{live,in_flight_cents}')::int = 4300
                      and (:'ov'::jsonb#>>'{live,accounts_at_limit}')::int = 1,
  'H · the overview adds up: collected, refunded, in flight, accounts and accounts at the limit, test mode counted apart');
select pg_temp.assert(:'ov'::text !~* '(mina|nina|raj|rao|shah|@)', 'H · and names no one');
select pg_temp.assert_raises($$select app.chip_in_overview('00000000-0000-4000-8000-0000000086ff')$$, 'not found', 'H · an unknown community is refused');
select pg_temp.as_none();
-- Who may call what.
select pg_temp.assert(not has_function_privilege('anon', 'app.my_chip_in_offer(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.chip_in_summary(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.platform_set_chip_in(uuid,bigint,bigint[],boolean,text)', 'execute')
                      and not has_function_privilege('anon', 'app.chip_in_overview(uuid,integer)', 'execute')
                      and has_function_privilege('authenticated', 'app.my_chip_in_offer(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.chip_in_summary(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.platform_set_chip_in(uuid,bigint,bigint[],boolean,text)', 'execute')
                      and has_function_privilege('connect_worker', 'app.worker_release_chip_ins()', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_release_chip_ins()', 'execute')
                      and not has_function_privilege('authenticated', 'app._chip_in_write(uuid,bigint,bigint[],boolean,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._chip_in_collect(uuid,uuid,bigint)', 'execute')
                      and not has_function_privilege('authenticated', 'app._chip_in_release(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.chip_in_lock(uuid,uuid,integer)', 'execute')
                      and not has_function_privilege('authenticated', 'app.chip_in_used_cents(uuid,uuid,integer,text)', 'execute')
                      and not has_function_privilege('connect_worker', 'app._chip_in_write(uuid,bigint,bigint[],boolean,text)', 'execute'),
  'H · the apps call the offer, the summary and the platform function; the internals and the sweep are not on the API');
select pg_temp.assert((select bool_and(p.prosecdef and 'search_path=app, public, extensions' = any (p.proconfig))
                         from pg_proc p where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('chip_in_year','chip_in_used_cents','chip_in_lock','_chip_in_state','my_chip_in_offer','_chip_in_write',
                                            'platform_set_chip_in','chip_in_summary','chip_in_overview','_chip_in_release','_chip_in_collect',
                                            'worker_release_chip_ins')),
  'H · every function of the foundation is security definer with the pinned search path (pgcrypto-safe)');
-- Audit coverage, module and the demo reset.
select pg_temp.assert(exists (select 1 from pg_trigger where tgrelid = 'app.chip_in_settings'::regclass and tgname = 'audit_chip_in_settings' and tgfoid = 'app.audit_row'::regproc)
                      and exists (select 1 from pg_trigger where tgrelid = 'app.chip_in_ledger'::regclass and tgname = 'audit_chip_in_ledger' and tgfoid = 'app.audit_row'::regproc)
                      and (select module_key from app.module_tables where table_name = 'chip_in_ledger') = 'giving'
                      and (select module_key from app.module_tables where table_name = 'chip_in_settings') = 'giving',
  'H · both tables are audited (hash-chained) and belong to Giving');
select pg_temp.assert('chip_in_settings' = any (app.demo_keep_tables()) and 'chip_in_settings' <> all (app.demo_clear_tables())
                      and 'chip_in_ledger' <> all (app.demo_keep_tables()) and 'chip_in_ledger' = any (app.demo_clear_tables()),
  'H · a demo or sandbox reset keeps the platform''s setting and clears the ledger');
rollback;
