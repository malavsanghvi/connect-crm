-- 0741-0743: Giving as a core plus seven add-ons (docs/GIVING_REDESIGN.md section 11, slice M2).
--   A. The catalog: seven add-ons that need Giving only; which kinds have them (Giving's availability, Labh like Bolis); the
--      kind's name for Offering counts and Labh; the twelve tables and their restrictive policies on the new keys; the
--      statements bucket, the Setup steps and the import list follow; existing communities are grandfathered.
--   B. Each add-on paused in a Jain Center: its tables are hidden from staff and members, its functions refuse with the
--      module sentence (or answer empty where an installed app still asks), and the core still records and allocates.
--   C. Pausing Giving switches every add-on off in one step; resuming brings them back as they were.
--   D. A non-faith community: no Labh, its own word for counts, and Bank reconciliation paused leaves payments working.
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
-- Sign in as a user; a fresh 2FA check (aal2 and a totp step a minute ago) when asked.
create or replace function pg_temp.claims(p_user uuid, p_step_up boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;

\set jsh '''00000000-0000-4000-8000-000000000001'''
\set admin '''15100000-0000-4000-8000-000000000001'''
\set member '''15100000-0000-4000-8000-000000000002'''
\set npadmin '''15100000-0000-4000-8000-000000000003'''
\set jc '''15100000-0000-4000-8000-0000000000c1'''
\set np '''15100000-0000-4000-8000-0000000000c2'''
\set h1 '''15100000-0000-4000-8000-0000000000b1'''
\set p1 '''15100000-0000-4000-8000-0000000000a1'''
\set h2 '''15100000-0000-4000-8000-0000000000b2'''
\set p2 '''15100000-0000-4000-8000-0000000000a2'''
\set camp '''15100000-0000-4000-8000-0000000000d1'''
\set opp '''15100000-0000-4000-8000-0000000000d2'''
\set acct '''15100000-0000-4000-8000-0000000000d3'''
\set txn '''15100000-0000-4000-8000-0000000000d4'''
\set gift '''15100000-0000-4000-8000-0000000000d5'''
\set lo '''15100000-0000-4000-8000-0000000000d6'''
\set day '''15100000-0000-4000-8000-0000000000d7'''
\set stmt '''15100000-0000-4000-8000-0000000000d8'''
\set pl1 '''15100000-0000-4000-8000-0000000000e1'''
\set pl2 '''15100000-0000-4000-8000-0000000000e2'''
\set plopp '''15100000-0000-4000-8000-0000000000e3'''
\set plrec '''15100000-0000-4000-8000-0000000000e4'''
\set pllabh '''15100000-0000-4000-8000-0000000000e5'''
\set imp '''15100000-0000-4000-8000-0000000000f1'''

-- ══ A. The catalog ══════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) from app.modules
                        where key in ('giving_bank', 'giving_counts', 'giving_opportunities', 'giving_recurring', 'labh',
                                      'giving_statements', 'giving_insights')
                          and not core and depends_on = '{giving}' and sort = (select sort from app.modules where key = 'giving')) = 7
                      and not (select core from app.modules where key = 'giving'),
  'A · seven add-ons, each needing Giving only, listed right after Giving; the core keeps the key giving');
select pg_temp.assert(app._module_chain('giving_bank') = array['giving', 'giving_bank'] and app._module_chain('labh') = array['giving', 'labh'],
  'A · an add-on''s chain is Giving and itself (no add-on needs another)');
select pg_temp.assert(not exists (
    select 1 from app.category_modules a
      join app.category_modules src on src.category_key = a.category_key
                                   and src.module_key = case when a.module_key = 'labh' then 'bolis' else 'giving' end
     where a.module_key in ('giving_bank', 'giving_counts', 'giving_opportunities', 'giving_recurring', 'labh', 'giving_statements', 'giving_insights')
       and a.availability <> src.availability)
                      and (select availability from app.category_modules where category_key = 'jain_center' and module_key = 'labh') = 'default_on'
                      and (select availability from app.category_modules where category_key = 'chamber_of_commerce' and module_key = 'labh') = 'not_available'
                      and (select availability from app.category_modules where category_key = 'chamber_of_commerce' and module_key = 'giving_bank') = 'default_on',
  'A · every kind has each add-on as it has Giving (a new community starts with them on), and Labh as it has Bolis');
select pg_temp.assert((select label from app.category_modules where category_key = 'jain_center' and module_key = 'giving_counts') = 'Bhandar counts'
                      and (select label from app.category_modules where category_key = 'church' and module_key = 'giving_counts') = 'Collection counts'
                      and (select label from app.category_modules where category_key = 'faith_other' and module_key = 'giving_counts') = 'Offering counts'
                      and (select label from app.category_modules where category_key = 'chamber_of_commerce' and module_key = 'giving_counts') = 'Cash counts'
                      and (select label from app.category_modules where category_key = 'nonprofit_secular' and module_key = 'giving_counts') = 'Cash counts'
                      and (select label from app.category_modules where category_key = 'jain_center' and module_key = 'labh') = 'Labh',
  'A · the kind names its counts (Bhandar, Collection, Offering, Cash) and a Jain Center calls the offerings Labh');
select pg_temp.assert((select array_agg(table_name || '=' || module_key order by table_name) from app.module_tables
                        where table_name in ('bank_accounts', 'bank_statement_imports', 'bank_transactions', 'known_originators',
                                             'payment_reports', 'counting_sessions', 'valuables_register', 'opportunities',
                                             'recurring_gifts', 'labh_options', 'labh_fulfillments', 'statements'))
                        = array['bank_accounts=giving_bank', 'bank_statement_imports=giving_bank', 'bank_transactions=giving_bank',
                                'counting_sessions=giving_counts', 'known_originators=giving_bank', 'labh_fulfillments=labh',
                                'labh_options=labh', 'opportunities=giving_opportunities', 'payment_reports=giving_bank',
                                'recurring_gifts=giving_recurring', 'statements=giving_statements', 'valuables_register=giving_counts']
                      and not exists (select 1 from app.module_tables where module_key in ('giving_insights')),
  'A · the twelve tables belong to their add-on');
select pg_temp.assert(not exists (
    select 1 from app.module_tables mt
      join pg_class c on c.relname = mt.table_name join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'app'
      left join pg_policy p on p.polrelid = c.oid and p.polname = 'module_switch' and not p.polpermissive
     where mt.module_key in ('giving_bank', 'giving_counts', 'giving_opportunities', 'giving_recurring', 'labh', 'giving_statements')
       and (p.oid is null
            or position(quote_literal(mt.module_key) in pg_get_expr(p.polqual, p.polrelid)) = 0
            or position(quote_literal(mt.module_key) in pg_get_expr(p.polwithcheck, p.polrelid)) = 0
            or position('''giving''' in pg_get_expr(p.polqual, p.polrelid)) > 0)),
  'A · each of those tables has a restrictive module_switch policy that names its own add-on (and no longer Giving)');
select pg_temp.assert(app.storage_bucket_module('statements') = 'giving_statements' and app.storage_bucket_module('store') = 'store'
                      and app.storage_bucket_module('homework') = 'gyan_path',
  'A · the statements bucket follows Statements; the other buckets are unchanged');
select pg_temp.assert((select array_agg(key || '=' || module_key order by key) from app.setup_steps
                        where key in ('svc.bank_accounts', 'hist.recurring', 'hist.statements', 'tpl.statements'))
                        = array['hist.recurring=giving_recurring', 'hist.statements=giving_statements', 'svc.bank_accounts=giving_bank',
                                'tpl.statements=giving'],
  'A · Setup''s bank, past recurring gifts and past statements steps follow their add-on; the templates stay with Giving');
select pg_temp.assert((select array_agg(key || '=' || module_key order by key) from app.import_entities
                        where key in ('bank_accounts', 'opportunities', 'labh_options', 'recurring_gifts', 'pledges', 'payments'))
                        = array['bank_accounts=giving_bank', 'labh_options=labh', 'opportunities=giving_opportunities',
                                'payments=giving', 'pledges=giving', 'recurring_gifts=giving_recurring'],
  'A · imports of bank accounts, opportunities, Labh options and recurring gifts follow their add-on; pledges and payments stay core');
select pg_temp.assert((select count(distinct m->>'module') from app.demo_packs p, jsonb_array_elements(p.contents) m
                        where p.key = 'community' and m->>'module' in ('giving_bank', 'giving_opportunities', 'giving_recurring', 'labh')) = 4
                      and not exists (select 1 from app.demo_packs p, jsonb_array_elements(p.contents) m
                                       where p.key = 'community' and m->>'module' = 'giving' and m->'rows' ? 'bank_accounts'),
  'A · the demo pack lists its bank, opportunity, recurring and Labh rows under their add-on');
select pg_temp.assert(pg_get_functiondef('app.pathshala_hold_live(uuid)'::regprocedure) like '%app.module_enabled(e.center_id, ''giving_bank'')%',
  'A · a member''s Zelle report keeps a Pathshala place on hold only while Bank reconciliation is on (0742)');
-- Grandfathered: wherever Giving is granted, each add-on the kind offers is granted, so nothing anyone sees changes.
select pg_temp.assert(not exists (
    select 1 from app.centers c
      cross join (values ('giving_bank'), ('giving_counts'), ('giving_opportunities'), ('giving_recurring'), ('labh'),
                         ('giving_statements'), ('giving_insights')) a(key)
     where c.id in (select g.center_id from app.center_module_grants g where g.module_key = 'giving' and g.granted)
       and app.module_availability(c.id, a.key) <> 'not_available'
       and not exists (select 1 from app.center_module_grants g where g.center_id = c.id and g.module_key = a.key and g.granted))
                      and not exists (select 1 from app.center_module_grants g where g.module_key = 'labh'
                                        and app.module_availability(g.center_id, 'labh') = 'not_available'),
  'A · every community where Giving was granted has a grant for each add-on its kind offers (none for Labh where it is not offered)');
select pg_temp.assert((select bool_and(app.module_enabled(:jsh, k)) from unnest(array['giving_bank', 'giving_counts', 'giving_opportunities',
                         'giving_recurring', 'labh', 'giving_statements', 'giving_insights']) k),
  'A · JSH has every add-on on');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:admin, 'admin151@temple.test'), (:member, 'member151@temple.test'), (:npadmin, 'admin151@nonprofit.test');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:jc, 'jc151', 'Temple 151', 'T151', 'TX', 'active', 'America/Chicago');
insert into app.centers (id, slug, name, environment, category_key, status)
values (:np, 'np151-sandbox', 'Non-profit 151', 'sandbox', 'nonprofit_secular', 'onboarding');
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:jc, :admin, 'center_admin', 'giving add-ons test 151'), (:np, :npadmin, 'center_admin', 'giving add-ons test 151');
insert into app.households (id, center_id, display_name) values (:h1, :jc, 'Member151, Mira'), (:h2, :np, 'Member151, Noor');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:p1, :jc, 'Mira', 'Member151', date '1980-01-01'), (:p2, :np, 'Noor', 'Member151', date '1982-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p1, :jc, 'primary', true), (:h2, :p2, :np, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:jc, :member, :p1);
insert into app.campaigns (id, center_id, name, kind, status) values (:camp, :jc, 'Temple 151 campaign', 'general', 'published');
insert into app.opportunities (id, center_id, campaign_id, name, amount_cents, status) values (:opp, :jc, :camp, 'Flowers 151', 5100, 'open');
insert into app.bank_accounts (id, center_id, name, institution, last4) values (:acct, :jc, 'Operating 151', 'Bank', '1510');
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description) values
  (:txn, :jc, :acct, current_date, 2500, 'Zelle Payment From Mira Member151');
insert into app.counting_sessions (center_id, kind, counters) values (:jc, 'bhandar', array[:admin, :member]::uuid[]);
insert into app.recurring_gifts (id, center_id, household_id, person_id, campaign_id, amount_cents, frequency, status, starts_on, next_charge_on, end_kind)
values (:gift, :jc, :h1, :p1, :camp, 1100, 'monthly', 'active', current_date, current_date, 'until_stopped');
insert into app.labh_options (id, center_id, name, amount_cents) values (:lo, :jc, 'Aarti 151', 2100);
insert into app.special_days (id, center_id, household_id, person_id, kind, label, calendar_date) values
  (:day, :jc, :h1, :p1, 'birthday', 'Mira''s birthday', (current_date + 20) - interval '40 years');
insert into app.statements (id, center_id, household_id, kind, tax_year) values (:stmt, :jc, :h1, 'tax_year', 2025);
insert into app.pledges (id, center_id, household_id, amount_cents) values (:pl1, :jc, :h1, 5000), (:pl2, :np, :h2, 4000);
-- Existing commitments: a pledge on the opportunity, a recurring gift's pledge and a labh pledge with its fulfillment.
insert into app.pledges (id, center_id, household_id, source, source_ref_id, amount_cents, opportunity_id) values
  (:plopp, :jc, :h1, 'sponsorship', null, 5100, :opp), (:plrec, :jc, :h1, 'recurring', :gift, 1100, null),
  (:pllabh, :jc, :h1, 'labh', :day, 2100, null);
insert into app.labh_fulfillments (pledge_id, center_id, labh_option_id, occasion) values (:pllabh, :jc, :lo, 'Birthday');
insert into app.bank_statement_imports (id, center_id, bank_account_id) values (:imp, :jc, :acct);
insert into app.known_originators (center_id, pattern, kind, label) values (:jc, 'TEMPLE151 FUND', 'daf', 'Test 151 fund');
insert into app.valuables_register (center_id, description, kind) values (:jc, 'Silver crown 151', 'silver');
insert into app.payment_reports (center_id, household_id, reported_by, amount_cents, sent_on, window_days, due_on) values
  (:jc, :h1, :member, 2500, current_date - 1, 10, current_date + 9);
-- Zelle is a way to give in the temple, with member reports.
insert into app.center_payment_methods (center_id, method, accepted, instructions, sort) values
  (:jc, 'zelle', true, '{"recipient":"give@temple151.test","name":"Temple 151","memo_hint":"Your member number"}', 3);

-- Every community whose kind offers an add-on has it on exactly where Giving is on, with or without a grant row (the two
-- communities above have none).
select pg_temp.assert(not exists (
    select 1 from app.centers c
      cross join (values ('giving_bank'), ('giving_counts'), ('giving_opportunities'), ('giving_recurring'), ('labh'),
                         ('giving_statements'), ('giving_insights')) a(key)
     where app.module_availability(c.id, a.key) <> 'not_available'
       and app.module_enabled(c.id, a.key) is distinct from app.module_enabled(c.id, 'giving'))
                      and not exists (select 1 from app.center_module_grants where center_id in (:jc, :np) and module_key <> 'ai'),
  'A · every community (with or without grant rows) has each add-on its kind offers on exactly where Giving is on');

-- Before anything is paused, staff and the family see their rows.
set role authenticated;
select pg_temp.claims(:admin);
select pg_temp.assert((select count(*) from app.bank_accounts where center_id = :jc) = 1
                      and (select count(*) from app.bank_transactions where center_id = :jc) = 1
                      and (select count(*) from app.counting_sessions where center_id = :jc) = 1
                      and (select count(*) from app.opportunities where center_id = :jc) = 1
                      and (select count(*) from app.recurring_gifts where center_id = :jc) = 1
                      and (select count(*) from app.labh_options where center_id = :jc) = 1
                      and (select count(*) from app.statements where center_id = :jc) = 1
                      and (select count(*) from app.bank_statement_imports where center_id = :jc) = 1
                      and (select count(*) from app.known_originators where center_id = :jc) = 1
                      and (select count(*) from app.valuables_register where center_id = :jc) = 1
                      and (select count(*) from app.labh_fulfillments where center_id = :jc) = 1,
  'B · with every add-on on, the treasurer sees the bank, counts, opportunities, recurring gifts, Labh menu and statements');
select pg_temp.claims(:member);
select pg_temp.assert((select count(*) from app.recurring_gifts where center_id = :jc) = 1
                      and (select count(*) from app.labh_options where center_id = :jc) = 1
                      and (select count(*) from app.statements where center_id = :jc) = 1
                      and (select count(*) from app.payment_reports where center_id = :jc) = 1,
  'B · and the family sees its recurring gift, the Labh menu, its statement and its Zelle report');
select pg_temp.assert((select (m->'report'->>'available')::boolean from jsonb_array_elements(app.member_payment_methods(:jc)->'methods') m
                        where m->>'key' = 'zelle'),
  'B · and the ways to give offer "report a Zelle payment"');

-- ══ B. Each add-on paused ═══════════════════════════════════════════════════
-- Bank reconciliation
savepoint bank_off;
select pg_temp.claims(:admin, true);
select app.set_module_enabled(:jc, 'giving_bank', false, 'Test 151: the bank is reconciled elsewhere');
select pg_temp.assert(not app.module_enabled(:jc, 'giving_bank') and app.module_enabled(:jc, 'giving')
                      and (select count(*) from app.bank_accounts where center_id = :jc) = 0
                      and (select count(*) from app.bank_transactions where center_id = :jc) = 0
                      and (select count(*) from app.bank_statement_imports where center_id = :jc) = 0
                      and (select count(*) from app.known_originators where center_id = :jc) = 0
                      and (select count(*) from app.payment_reports where center_id = :jc) = 0,
  'B · Bank reconciliation paused: its tables are hidden from the treasurer; Giving stays on');
select pg_temp.assert_raises(format($$select count(*) from app.suggest_bank_matches(%L)$$, :txn),
  'The Bank reconciliation module is switched off', 'B · suggesting matches for a bank line refuses with the module sentence');
select pg_temp.assert_raises(format($$select app.payment_report_counts(%L)$$, :jc), 'Bank reconciliation module is switched off',
  'B · the Zelle report counts refuse');
select pg_temp.assert_raises(format($$select app.zelle_exact_matches(%L)$$, :jc), 'Bank reconciliation module is switched off',
  'B · exact Zelle matches refuse');
select pg_temp.assert_raises(format($$select app.giving_unmatched_bank_lines(%L)$$, :jc), 'Bank reconciliation module is switched off',
  'B · the bank lines summary refuses');
select pg_temp.assert_raises(format($$select app.giving_zelle_waiting(%L)$$, :jc), 'Bank reconciliation module is switched off',
  'B · the Zelle waiting summary refuses');
-- The core still records and allocates a payment, and the duplicate-Zelle check answers instead of refusing.
select app.record_offline_payment(:h1, 2500, 'check', current_date, array[:pl1]::uuid[], '151', null) as pay1 \gset
select pg_temp.assert((select coalesce(sum(amount_cents), 0) from app.payment_allocations where payment_id = :'pay1') = 2500
                      and (select status from app.pledges where id = :pl1) = 'partially_paid',
  'B · with Bank reconciliation paused the treasurer still records a payment and it is allocated to the pledge');
select pg_temp.assert(jsonb_typeof(app.possible_duplicate_zelle(:h1, 2500, current_date)) = 'array',
  'B · the duplicate-Zelle check still answers (no member reports in it), so recording a Zelle payment works');
select pg_temp.claims(:member);
select pg_temp.assert(app.my_payment_reports(:jc, :h1) = '[]'::jsonb,
  'B · a family''s Zelle reports come back empty (an installed app still asks on its Pledges screen)');
select pg_temp.assert_raises(format($$select app.report_payment(%L, %L, 'zelle', 2500, current_date, null, 'Mira', null, null)$$, :jc, :h1),
  'Bank reconciliation module is switched off', 'B · a member cannot report a Zelle payment');
select pg_temp.assert((select count(*) from app.payment_reports where center_id = :jc) = 0,
  'B · the family no longer sees its Zelle report');
select pg_temp.assert((select (m->'report'->>'available')::boolean = false from jsonb_array_elements(app.member_payment_methods(:jc)->'methods') m
                        where m->>'key' = 'zelle'),
  'B · Zelle stays a way to give, and "report a Zelle payment" is not offered');
rollback to savepoint bank_off;

-- Offering counts
savepoint counts_off;
set role authenticated;
select pg_temp.claims(:admin, true);
select app.set_module_enabled(:jc, 'giving_counts', false, 'Test 151: counting is done on paper');
select pg_temp.assert((select count(*) from app.counting_sessions where center_id = :jc) = 0 and app.module_enabled(:jc, 'giving')
                      and (select count(*) from app.valuables_register where center_id = :jc) = 0,
  'B · Offering counts paused: the counting sessions and the valuables register are hidden');
select pg_temp.assert_raises(format($$insert into app.counting_sessions (center_id, kind, counters) values (%L, 'bhandar', array[%L, %L]::uuid[])$$,
                                    :jc, :admin, :member),
  'row-level security', 'B · and no new count can be written');
rollback to savepoint counts_off;

-- Opportunities
savepoint opps_off;
set role authenticated;
select pg_temp.claims(:admin, true);
select app.set_module_enabled(:jc, 'giving_opportunities', false, 'Test 151: no sponsorships this year');
select pg_temp.assert((select count(*) from app.opportunities where center_id = :jc) = 0
                      and (select count(*) from app.campaigns where center_id = :jc) = 1,
  'B · Opportunities paused: opportunities are hidden; campaigns (core) are not');
select pg_temp.claims(:member);
select pg_temp.assert((select count(*) from app.opportunities where center_id = :jc) = 0, 'B · and a member sees none');
select pg_temp.assert_raises(format($$select count(*) from app.opportunity_availability(%L)$$, :opp),
  'Opportunities module is switched off', 'B · an opportunity''s availability refuses');
select pg_temp.assert_raises(format($$select app.create_recurring_gift(%L, null, null, 1000, 'monthly', current_date, 'until_stopped', null, null, null, %L)$$, :h1, :opp),
  'Opportunities module is switched off', 'B · a recurring gift cannot be linked to an opportunity');
select pg_temp.claims(:admin);
select app.record_offline_payment(:h1, 1000, 'check', current_date, array[:plopp]::uuid[], '153', null) as payopp \gset
select pg_temp.assert((select coalesce(sum(amount_cents), 0) from app.payment_allocations where payment_id = :'payopp' and pledge_id = :plopp) = 1000,
  'B · a payment is still recorded and allocated to an existing pledge on the opportunity (existing commitments are honoured)');
-- The trigger refuses a person's pledge on an opportunity; a write without a person (a provider's webhook) still lands.
reset role;
select pg_temp.claims(:member);
select pg_temp.assert_raises(format($$insert into app.pledges (center_id, household_id, source, amount_cents, opportunity_id) values (%L, %L, 'sponsorship', 5100, %L)$$,
                                    :jc, :h1, :opp),
  'Opportunities module is switched off', 'B · a person cannot pledge to an opportunity while Opportunities is off');
select pg_temp.no_claims();
insert into app.pledges (center_id, household_id, source, amount_cents, opportunity_id) values (:jc, :h1, 'sponsorship', 5100, :opp);
select pg_temp.assert((select count(*) from app.pledges where opportunity_id = :opp) = 2,
  'B · a write without a person (a payment provider settling a checkout started earlier) is never refused, so money that arrived is recorded');
rollback to savepoint opps_off;

-- Recurring gifts
savepoint recurring_off;
set role authenticated;
select pg_temp.claims(:admin, true);
select app.set_module_enabled(:jc, 'giving_recurring', false, 'Test 151: no recurring gifts for now');
select pg_temp.assert((select count(*) from app.recurring_gifts where center_id = :jc) = 0, 'B · Recurring gifts paused: hidden from the treasurer');
select app.record_offline_payment(:h1, 1100, 'check', current_date, array[:plrec]::uuid[], '154', null) as payrec \gset
select pg_temp.assert((select coalesce(sum(amount_cents), 0) from app.payment_allocations where payment_id = :'payrec' and pledge_id = :plrec) = 1100,
  'B · a payment is still recorded and allocated to a recurring gift''s existing pledge');
select pg_temp.claims(:member);
select pg_temp.assert((select count(*) from app.recurring_gifts where center_id = :jc) = 0, 'B · and from the family');
select pg_temp.assert_raises(format($$select app.create_recurring_gift(%L, null, %L, 1000, 'monthly')$$, :h1, :camp),
  'Recurring gifts module is switched off', 'B · no new recurring gift');
select pg_temp.assert_raises(format($$select app.commit_labh(%L, array[%L]::uuid[], null, true)$$, :day, :lo),
  'Repeating this every year needs Recurring gifts', 'B · a labh cannot be repeated every year, and the sentence says why');
select app.commit_labh(:day, array[:lo]::uuid[], null, false) as labh_numbers \gset
select pg_temp.assert(cardinality(:'labh_numbers'::text[]) = 1, 'B · the labh itself is still taken (one pledge)');
reset role;
select pg_temp.no_claims();
select pg_temp.assert(app.run_recurring_gift_cycle(:gift) is null
                      and (select count(*) from app.pledges where source = 'recurring' and source_ref_id = :gift) = 1,
  'B · a recurring gift''s cycle does not run: the scheduler gets nothing back and no pledge is made');
select pg_temp.claims(:admin);
select pg_temp.assert_raises(format($$update app.opportunities set allow_recurring = true where id = %L$$, :opp),
  'Recurring gifts module is switched off', 'B · an opportunity cannot turn recurring on');
rollback to savepoint recurring_off;

-- Special-day offerings (Labh)
savepoint labh_off;
set role authenticated;
select pg_temp.claims(:admin, true);
select app.set_module_enabled(:jc, 'labh', false, 'Test 151: no labh menu');
select pg_temp.assert((select count(*) from app.labh_options where center_id = :jc) = 0
                      and (select count(*) from app.labh_fulfillments where center_id = :jc) = 0,
  'B · Labh paused: the menu and the fulfillments are hidden from the treasurer');
select pg_temp.claims(:member);
select pg_temp.assert((select count(*) from app.labh_options where center_id = :jc) = 0, 'B · and from the family');
select pg_temp.assert_raises(format($$select app.commit_labh(%L, array[%L]::uuid[], null, false)$$, :day, :lo),
  'Special-day offerings module is switched off', 'B · a labh cannot be taken');
rollback to savepoint labh_off;

-- Statements
savepoint statements_off;
set role authenticated;
select pg_temp.claims(:admin, true);
select app.set_module_enabled(:jc, 'giving_statements', false, 'Test 151: statements come from the accountant');
select pg_temp.assert((select count(*) from app.statements where center_id = :jc) = 0, 'B · Statements paused: hidden from the treasurer');
select pg_temp.assert_raises(format($$select app.year_end_statement(%L, 2025)$$, :h1), 'Statements module is switched off',
  'B · the year-end statement refuses');
select pg_temp.claims(:member);
select pg_temp.assert((select count(*) from app.statements where center_id = :jc) = 0, 'B · and the family sees no statement');
rollback to savepoint statements_off;

-- ══ C. Pausing Giving switches every add-on off; resuming brings them back as they were ═══════════════════════════════
savepoint giving_off;
set role authenticated;
select pg_temp.claims(:admin, true);
select app.set_module_enabled(:jc, 'giving_statements', false, 'Test 151: paused before Giving');
select app.set_module_enabled(:jc, 'giving', false, 'Test 151: Giving moves to another system');
select pg_temp.assert(not exists (select 1 from unnest(array['giving_bank', 'giving_counts', 'giving_opportunities', 'giving_recurring', 'labh',
                                                             'giving_statements', 'giving_insights']) k where app.module_enabled(:jc, k))
                      and (select count(*) from app.bank_accounts where center_id = :jc) = 0
                      and (select count(*) from app.counting_sessions where center_id = :jc) = 0
                      and (select count(*) from app.opportunities where center_id = :jc) = 0
                      and (select count(*) from app.recurring_gifts where center_id = :jc) = 0
                      and (select count(*) from app.labh_options where center_id = :jc) = 0,
  'C · with Giving paused every add-on is off and its rows are hidden (one step)');
select pg_temp.assert_raises(format($$select app.assert_module_enabled(%L, 'giving_bank')$$, :jc), 'is off because',
  'C · and an add-on says it is off because Giving is off');
select app.set_module_enabled(:jc, 'giving', true, 'Test 151: Giving is back');
select pg_temp.assert(app.module_enabled(:jc, 'giving_bank') and app.module_enabled(:jc, 'labh') and not app.module_enabled(:jc, 'giving_statements')
                      and (select count(*) from app.bank_accounts where center_id = :jc) = 1,
  'C · resuming Giving brings every add-on back as it was (Statements stays paused)');
rollback to savepoint giving_off;

-- ══ D. A non-faith community ════════════════════════════════════════════════
reset role;
select pg_temp.no_claims();
select pg_temp.assert(not app.module_enabled(:np, 'labh') and app.module_availability(:np, 'labh') = 'not_available'
                      and app.module_enabled(:np, 'giving_bank') and app.module_enabled(:np, 'giving_counts')
                      and app.module_enabled(:np, 'giving_statements'),
  'D · a secular non-profit has no Labh and starts with the other add-ons on, like Giving');
set role authenticated;
select pg_temp.claims(:npadmin, true);
select pg_temp.assert((select label from app.module_states(:np) where key = 'giving_counts') = 'Cash counts'
                      and (select availability = 'not_available' and not switchable from app.module_states(:np) where key = 'labh'),
  'D · Settings › Modules calls its counts "Cash counts" and does not offer Labh');
select pg_temp.assert_raises(format($$select app.assert_module_enabled(%L, 'labh')$$, :np), 'is not part of a',
  'D · Labh is refused as not part of this kind of organization');
select app.set_module_enabled(:np, 'giving_bank', false, 'Test 151: no bank feed');
select app.record_offline_payment(:h2, 1500, 'check', current_date, array[:pl2]::uuid[], '152', null) as pay2 \gset
select pg_temp.assert((select coalesce(sum(amount_cents), 0) from app.payment_allocations where payment_id = :'pay2') = 1500
                      and jsonb_typeof(app.possible_duplicate_zelle(:h2, 1500, current_date)) = 'array',
  'D · with Bank reconciliation paused the non-profit still records and allocates a payment');

reset role;
rollback;
