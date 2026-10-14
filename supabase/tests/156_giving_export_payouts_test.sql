-- 0747: Giving exports for the treasurer and card payouts paired with their bank lines (docs/GIVING_REDESIGN.md slice 9).
--   A. data.export: the Treasurer role holds it; no other role gained it.
--   B. Giving exports: the permission and the list's read permission, no authenticator or 2FA code asked for (0787; it was one
--      code, one file in 0747), the audit entry (counts and filter words, never contents), module
--      guards (bank lines need Bank reconciliation, year-end totals need Statements), another community refused.
--   C. Card payouts: pairing needs giving.manage, a typed reason and a sentence when the amounts differ, none when they agree;
--      the same pair again changes nothing; one bank line holds one payout (and the unique index says so to a direct write);
--      the sign check; another community refused; the undo; a locked month refuses both; module guards; the close state; the
--      check constraint; direct writes to the pairing columns refused for staff (the functions pass); the worker's payout sync
--      leaves a matched payout untouched and still updates an unpaired one.
--   D. A non-faith community exports and pairs the same way.
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
-- Sign in as a user. p_code_age: seconds since the last 2FA code (null: no code in this session). No Giving export asks for one
-- since 0787; the code's time is still recorded in the audit entry when the token carries one.
create or replace function pg_temp.claims(p_user uuid, p_code_age int default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_code_age is not null then 'aal2' else 'aal1' end,
    'amr', case when p_code_age is not null
                then jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - p_code_age))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;

\set jc '''15600000-0000-4000-8000-0000000000c1'''
\set np '''15600000-0000-4000-8000-0000000000c2'''
\set treas '''15600000-0000-4000-8000-000000000001'''
\set treas0 '''15600000-0000-4000-8000-000000000002'''
\set vol '''15600000-0000-4000-8000-000000000003'''
\set admin '''15600000-0000-4000-8000-000000000004'''
\set nptreas '''15600000-0000-4000-8000-000000000005'''
\set exec '''15600000-0000-4000-8000-000000000006'''
\set acct '''15600000-0000-4000-8000-0000000000a1'''
\set npacct '''15600000-0000-4000-8000-0000000000a2'''
\set po1 '''15600000-0000-4000-8000-0000000000d1'''
\set po2 '''15600000-0000-4000-8000-0000000000d2'''
\set po3 '''15600000-0000-4000-8000-0000000000d3'''
\set b1 '''15600000-0000-4000-8000-0000000000e1'''
\set b2 '''15600000-0000-4000-8000-0000000000e2'''
\set b3 '''15600000-0000-4000-8000-0000000000e3'''
\set b4 '''15600000-0000-4000-8000-0000000000e4'''
\set gift '''15600000-0000-4000-8000-0000000000e5'''

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
select date_trunc('month', current_date)::date as m \gset
insert into auth.users (id, email) values
  (:treas, 'treasurer156@temple.test'), (:treas0, 'treasurer0156@temple.test'), (:vol, 'volunteer156@temple.test'),
  (:admin, 'admin156@temple.test'), (:nptreas, 'treasurer156@nonprofit.test'), (:exec, 'committee156@temple.test');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('15600000-0000-4000-8000-0000000000f1', :treas, 'phone', 'totp', 'verified'),
  ('15600000-0000-4000-8000-0000000000f2', :nptreas, 'phone', 'totp', 'verified'),
  ('15600000-0000-4000-8000-0000000000f3', :admin, 'phone', 'totp', 'verified'),
  ('15600000-0000-4000-8000-0000000000f4', :vol, 'phone', 'totp', 'verified'),
  ('15600000-0000-4000-8000-0000000000f5', :exec, 'phone', 'totp', 'verified');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:jc, 'jc156', 'Temple 156', 'T156', 'TX', 'active', 'America/Chicago');
insert into app.centers (id, slug, name, environment, category_key, status)
values (:np, 'np156-sandbox', 'Non-profit 156', 'sandbox', 'nonprofit_secular', 'onboarding');
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:jc, :treas, 'treasurer', 'test 156'), (:jc, :treas0, 'treasurer', 'test 156'), (:jc, :vol, 'finance_volunteer', 'test 156'),
  (:jc, :admin, 'center_admin', 'test 156'), (:jc, :exec, 'executive_committee', 'test 156'), (:np, :nptreas, 'treasurer', 'test 156');
insert into app.bank_accounts (id, center_id, name, institution, last4) values
  (:acct, :jc, 'Operating 156', 'Bank', '1560'), (:npacct, :np, 'Checking 156', 'Bank', '1561');
-- Two Stripe payouts that arrived this month in the temple (one $2.00 short at the bank, one exact) and one in the non-profit.
insert into app.payouts (id, center_id, provider, provider_ref, gross_cents, fee_cents, net_cents, arrives_on) values
  (:po1, :jc, 'stripe', 'po_156_one', 10300, 300, 10000, :'m'::date + 1),
  (:po2, :jc, 'stripe', 'po_156_two', 5150, 150, 5000, :'m'::date + 2),
  (:po3, :np, 'stripe', 'po_156_np', 2100, 100, 2000, :'m'::date + 1);
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, channel, status) values
  (:b1, :jc, :acct, :'m'::date + 1, 9800, 'STRIPE TRANSFER 156 ONE', 'card_payout', 'payout'),
  (:b2, :jc, :acct, :'m'::date + 2, 5000, 'STRIPE TRANSFER 156 TWO', 'card_payout', 'payout'),
  (:b3, :np, :npacct, :'m'::date + 1, 2000, 'STRIPE TRANSFER 156 NP', 'card_payout', 'payout'),
  (:gift, :jc, :acct, :'m'::date + 1, 2500, 'Zelle Payment From Someone 156', 'zelle', 'unmatched');

-- ══ A. data.export ═══════════════════════════════════════════════════════════
select pg_temp.assert((select permissions ? 'data.export' from app.roles where key = 'treasurer')
                      and (select count(*) from app.roles where permissions ? 'data.export') = 1,
  'A · the Treasurer role holds data.export, and no other role does');
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert(app.has_permission(:jc, 'data.export') and not app.has_permission(:np, 'data.export'),
  'A · a treasurer may export in their own community only');
select pg_temp.claims(:exec);
select pg_temp.assert(not app.has_permission(:jc, 'data.export') and app.has_permission(:jc, 'giving.view'),
  'A · a committee member who reads Giving has no data.export');

-- ══ B. Giving exports ═══════════════════════════════════════════════════════
select pg_temp.claims(:exec);
select pg_temp.assert_raises(format($$select app.giving_export_check(%L, 'payments')$$, :jc), 'data-export permission',
  'B · a committee member who reads Giving cannot export (no data.export)');
select pg_temp.claims(:vol, 60);
select pg_temp.assert_raises(format($$select app.giving_export_check(%L, 'payments')$$, :jc), 'data-export permission',
  'B · a finance volunteer cannot export');
select pg_temp.claims(:treas0);
select app.giving_export_check(:jc, 'payments');
select pg_temp.assert(true, 'B · a treasurer without an authenticator app can export: no authenticator is asked for any more');
select pg_temp.claims(:treas);
select app.giving_export_check(:jc, 'payments');
select pg_temp.assert(true, 'B · a treasurer with no code in this session can export: no code is asked for any more');
select pg_temp.claims(:treas, 600);
select app.giving_export_check(:jc, 'payments');
select pg_temp.assert(true, 'B · a code from ten minutes ago does not matter either: no fresh code is asked for');
select pg_temp.assert_raises(format($$select app.giving_export_check(%L, 'donors')$$, :jc), 'Unknown Giving export',
  'B · an unknown list is refused');

select pg_temp.claims(:treas, 60);
select app.giving_export_check(:jc, 'payments');
select app.record_giving_export(:jc, 'payments',
  '{"rows": 3, "chips": {"method": "check", "year": "2026", "search": "shah", "source": "Shah household"}, "searched": true,
    "q": "Shah", "file": "R-2026-0413,200.00", "step_up_at": "forged", "list": "forged"}');
reset role;
select pg_temp.assert((select count(*) from app.audit_log where action = 'export.giving_payments' and center_id = :jc and actor_user_id = :treas) = 1
                      and (select after->>'rows' = '3' and after->'chips' = '{"method": "check", "year": "2026"}'::jsonb and (after->>'searched')::boolean
                                  and after->>'list' = 'payments' and after->>'step_up_at' = (extract(epoch from now())::bigint - 60)::text
                                  and record_table = 'giving_export' and record_id = :treas::text
                             from app.audit_log where action = 'export.giving_payments' and center_id = :jc),
  'B · one audit entry under (giving_export, the person): the count, the known chips, whether a search was used, the list and the code''s time (not the forged ones)');
select pg_temp.assert((select array_agg(k order by k) from app.audit_log l, jsonb_object_keys(l.after) k
                        where l.action = 'export.giving_payments' and l.center_id = :jc) = array['chips', 'list', 'rows', 'searched', 'step_up_at']
                      and (select position('shah' in lower(after::text)) = 0 and position('R-2026' in after::text) = 0
                             from app.audit_log where action = 'export.giving_payments' and center_id = :jc),
  'B · anything else the caller sends is dropped: the search''s text ("q": "Shah"), an unknown chip, a chip value that is not a fixed word, the file');
set role authenticated;
select pg_temp.claims(:treas, 60);
select app.record_giving_export(:jc, 'pledges', '{"rows": 2}');
select app.giving_export_check(:jc, 'pledges');
select pg_temp.assert(true, 'B · the same code can make a second file: "one code, one file" is gone (0787)');
select pg_temp.claims(:treas, 10);
select pg_temp.assert_raises(format($$select app.giving_export_check(%L, 'payments')$$, :np), 'data-export permission',
  'B · a treasurer of one community cannot export another community''s list');
select app.giving_export_check(:jc, 'bank_lines');
select app.giving_export_check(:jc, 'year_end_totals');
select pg_temp.assert(true, 'B · bank lines and year-end totals pass while Bank reconciliation and Statements are on');

savepoint modules_off;
select pg_temp.claims(:admin, 60);
select app.set_module_enabled(:jc, 'giving_bank', false, 'Test 156: the bank is reconciled elsewhere');
select app.set_module_enabled(:jc, 'giving_statements', false, 'Test 156: no statements here');
select pg_temp.claims(:treas, 10);
select pg_temp.assert_raises(format($$select app.giving_export_check(%L, 'bank_lines')$$, :jc), 'Bank reconciliation module is switched off',
  'B · bank lines are not exported while Bank reconciliation is off');
select pg_temp.assert_raises(format($$select app.giving_export_check(%L, 'year_end_totals')$$, :jc), 'switched off',
  'B · year-end totals are not exported while Statements is off');
select app.giving_export_check(:jc, 'payments');
select pg_temp.assert(true, 'B · payments still export with both add-ons off');
rollback to savepoint modules_off;

-- ══ C. Card payouts ═════════════════════════════════════════════════════════
select pg_temp.claims(:vol);
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L, 'bank_fee', 'Bank fee')$$, :po1, :b1), 'needs giving.manage',
  'C · a finance volunteer cannot pair a payout');
select pg_temp.claims(:exec);
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L, 'bank_fee', 'Bank fee')$$, :po1, :b1), 'needs giving.manage',
  'C · neither can a committee member who reads Giving');
select pg_temp.claims(:treas);
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L)$$, :po1, :b1), 'Choose why',
  'C · a $2.00 difference needs a typed reason');
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L, 'bank_fee', '  ')$$, :po1, :b1), 'Say why',
  'C · and a sentence');
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L, 'because', 'Bank fee')$$, :po1, :b1), 'Choose why',
  'C · and the reason is one of the five');
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L)$$, :po1, :gift), 'not a card payout line',
  'C · a gift line is not a card payout line');
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L)$$, :po1, :b3), 'not one of this community',
  'C · a bank line of another community is refused');
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L)$$, :po3, :b3), 'needs giving.manage',
  'C · another community''s payout is refused');
select app.explain_payout(:po1, :b1, 'bank_fee', 'The bank took a $2.00 incoming wire fee') as r1 \gset
select pg_temp.assert((:'r1'::jsonb->>'difference_cents')::bigint = -200 and not (:'r1'::jsonb->>'already')::boolean,
  'C · the treasurer accepts the $2.00 difference');
reset role;
select pg_temp.assert((select matched and variance_cents = -200 and difference_code = 'bank_fee' and matched_by = :treas and matched_at is not null
                         from app.payouts where id = :po1)
                      and (select payout_id = :po1 and status = 'payout' and matched_by = :treas from app.bank_transactions where id = :b1),
  'C · the payout is matched with its difference and reason; the bank line points at it and stays a card payout line');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'payouts' and record_id = :po1::text
                         and reason = 'The bank took a $2.00 incoming wire fee') = 1
                      and (select count(*) from app.audit_log where record_table = 'bank_transactions' and record_id = :b1::text
                             and reason = 'The bank took a $2.00 incoming wire fee') = 1,
  'C · both changes are in the audit log with the reason');
select count(*) as audit_before from app.audit_log where record_table in ('payouts', 'bank_transactions') \gset
select pg_temp.assert(not exists (select 1 from app.ledger_postings where source_id in (:po1, :b1)),
  'C · no ledger posting is made');
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert((app.explain_payout(:po1, :b1, 'bank_fee', 'Again')->>'already')::boolean,
  'C · the same pair again changes nothing');
reset role;
select pg_temp.assert((select count(*) from app.audit_log where record_table in ('payouts', 'bank_transactions')) = :audit_before
                      and (select difference_note from app.payouts where id = :po1) = 'The bank took a $2.00 incoming wire fee',
  'C · and writes nothing');
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L)$$, :po2, :b1), 'already paired with another payout',
  'C · a bank line holds one payout');
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L)$$, :po1, :b2), 'already paired with the bank line of',
  'C · a paired payout is not paired a second time');
select pg_temp.assert((app.explain_payout(:po2, :b2)->>'difference_cents')::bigint = 0,
  'C · amounts that agree are paired without a reason');
reset role;
select pg_temp.assert((select matched and variance_cents = 0 and difference_code is null and difference_note is null from app.payouts where id = :po2),
  'C · with no difference and no reason stored');
select pg_temp.no_claims();
select pg_temp.assert_raises(format($$update app.payouts set variance_cents = 5 where id = %L$$, :po2), 'payouts_difference_explained',
  'C · a matched payout cannot carry a difference without its reason (check constraint)');
select pg_temp.assert_raises(format($$update app.bank_transactions set payout_id = %L where id = %L$$, :po1, :gift), 'bank_transactions_payout_once',
  'C · the unique index refuses a second bank line for the same payout, even written directly');

-- Direct writes cannot pair: the treasurer may write payouts (accounting.manage) and bank lines (giving.manage) through the API,
-- but not the pairing columns.
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert_raises(format($$update app.payouts set matched = false where id = %L$$, :po2), 'never by a direct change',
  'C · a staff member cannot unpair a payout by writing it directly');
select pg_temp.assert_raises(format($$update app.payouts set variance_cents = 0, difference_code = null where id = %L$$, :po1), 'never by a direct change',
  'C · nor change an accepted difference');
select pg_temp.assert_raises(format($$update app.bank_transactions set payout_id = null where id = %L$$, :b1), 'never by a direct change',
  'C · nor take the payout off its bank line');
select pg_temp.assert_raises(format($$insert into app.bank_transactions (center_id, bank_account_id, posted_on, amount_cents, description, channel, status, payout_id)
                                      values (%L, %L, current_date, 100, 'STRIPE TRANSFER 156 FORGED', 'card_payout', 'payout', %L)$$, :jc, :acct, :po3),
  'never by a direct change', 'C · nor import a bank line that already names a payout');
update app.bank_transactions set notes = 'Checked against the Stripe dashboard' where id = :b1;
reset role;
select pg_temp.assert((select notes = 'Checked against the Stripe dashboard' and payout_id = :po1 from app.bank_transactions where id = :b1)
                      and (select matched and variance_cents = -200 from app.payouts where id = :po1),
  'C · other columns stay writable, and the pairing is unchanged');

-- The close: both payouts that arrived are paired; one bank card-payout line is still unpaired.
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, channel, status) values
  (:b4, :jc, :acct, :'m'::date + 3, 700, 'STRIPE TRANSFER 156 FOUR', 'card_payout', 'payout');
set role authenticated;
select pg_temp.claims(:treas);
select app.payouts_close_state(:jc, :'m'::date) as cs \gset
select pg_temp.assert((:'cs'::jsonb->>'payouts')::int = 2 and (:'cs'::jsonb->>'paired')::int = 2 and (:'cs'::jsonb->>'unpaired')::int = 0
                      and (:'cs'::jsonb->>'explained')::int = 1 and (:'cs'::jsonb->>'difference_cents')::bigint = -200
                      and (:'cs'::jsonb->>'bank_lines')::int = 3 and (:'cs'::jsonb->>'bank_lines_unpaired')::int = 1
                      and not (:'cs'::jsonb->>'proven')::boolean,
  'C · the close counts both sides: payouts all paired, one bank card-payout line left, so not proven');
select pg_temp.claims(:vol);
select pg_temp.assert_raises(format($$select app.payouts_close_state(%L, %L)$$, :jc, :'m'), 'needs giving.view',
  'C · the close state is for the people who see Giving or close the month');
reset role;
delete from app.bank_transactions where id = :b4;
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert((app.payouts_close_state(:jc, :'m'::date)->>'proven')::boolean,
  'C · with every payout and every card-payout line paired, the close item is proven');
select pg_temp.assert((app.payouts_close_state(:jc, (:'m'::date - interval '1 month')::date)->>'proven')::boolean
                      and (app.payouts_close_state(:jc, (:'m'::date - interval '1 month')::date)->>'payouts')::int = 0,
  'C · a month with no payouts at all is proven too');

-- The undo.
select pg_temp.assert_raises(format($$select app.unpair_payout(%L, '')$$, :po2), 'Say why', 'C · undoing a pairing needs a reason');
select pg_temp.claims(:vol);
select pg_temp.assert_raises(format($$select app.unpair_payout(%L, 'Wrong line')$$, :po2), 'needs giving.manage',
  'C · a finance volunteer cannot undo a pairing');
select pg_temp.claims(:treas);
select pg_temp.assert(not (app.unpair_payout(:po2, 'Paired with the wrong line')->>'already')::boolean,
  'C · the treasurer undoes a pairing');
reset role;
select pg_temp.assert((select not matched and variance_cents = 0 and matched_by is null from app.payouts where id = :po2)
                      and (select payout_id is null and matched_by is null from app.bank_transactions where id = :b2),
  'C · both sides are unpaired again');
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert((app.unpair_payout(:po2, 'Again')->>'already')::boolean, 'C · undoing twice changes nothing');
select pg_temp.assert(not (app.payouts_close_state(:jc, :'m'::date)->>'proven')::boolean
                      and (app.payouts_close_state(:jc, :'m'::date)->>'unpaired')::int = 1,
  'C · and the close is no longer proven');

-- The worker's payout sync: a matched payout is left as the treasurer accepted it; an unpaired one still takes the provider's update.
reset role;
select pg_temp.no_claims();
set role connect_worker;
select app.worker_upsert_payout(:jc, 'stripe', 'po_156_one', 99999, 1, 99998, :'m'::date + 5);
select app.worker_upsert_payout(:jc, 'stripe', 'po_156_two', 5200, 200, 5000, :'m'::date + 2);
reset role;
select pg_temp.assert((select net_cents = 10000 and gross_cents = 10300 and arrives_on = :'m'::date + 1 and matched and variance_cents = -200
                         and difference_code = 'bank_fee' from app.payouts where id = :po1)
                      and (select gross_cents = 5200 and fee_cents = 200 and net_cents = 5000 and not matched from app.payouts where id = :po2),
  'C · the worker leaves a matched payout untouched and still updates an unpaired one');

-- The sign check: a bank line that takes money out is not a payout that brought money in.
savepoint sign;
insert into app.payouts (id, center_id, provider, provider_ref, gross_cents, fee_cents, net_cents, arrives_on) values
  ('15600000-0000-4000-8000-0000000000d4', :jc, 'stripe', 'po_156_four', 3100, 100, 3000, :'m'::date + 1);
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, channel, status) values
  ('15600000-0000-4000-8000-0000000000e6', :jc, :acct, :'m'::date + 1, -3000, 'STRIPE DEBIT 156', 'card_payout', 'payout');
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert_raises($$select app.explain_payout('15600000-0000-4000-8000-0000000000d4', '15600000-0000-4000-8000-0000000000e6', 'other', 'Debit')$$,
  'do not move money the same way', 'C · a payout and a bank line that move money in opposite directions are not paired');
rollback to savepoint sign;
set role authenticated;
select pg_temp.claims(:treas);

-- A locked month refuses both.
savepoint locked;
reset role;
select pg_temp.no_claims();
insert into app.accounting_periods (center_id, period_month, status, closed_at) values (:jc, :'m'::date, 'closed', now());
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L)$$, :po2, :b2), 'is locked',
  'C · a payout of a locked month cannot be paired');
select pg_temp.assert_raises(format($$select app.unpair_payout(%L, 'Wrong line')$$, :po1), 'is locked',
  'C · nor unpaired');
rollback to savepoint locked;

-- Module guards.
savepoint payouts_modules;
select pg_temp.claims(:admin, 60);
select app.set_module_enabled(:jc, 'accounting', false, 'Test 156: the books are kept elsewhere');
select pg_temp.claims(:treas);
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L)$$, :po2, :b2), 'switched off',
  'C · no pairing while Accounting is off');
select pg_temp.assert_raises(format($$select app.payouts_close_state(%L, %L)$$, :jc, :'m'), 'switched off',
  'C · nor a close state');
rollback to savepoint payouts_modules;
savepoint bank_module;
select pg_temp.claims(:admin, 60);
select app.set_module_enabled(:jc, 'giving_bank', false, 'Test 156: the bank is reconciled elsewhere');
select pg_temp.claims(:treas);
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L)$$, :po2, :b2), 'Bank reconciliation module is switched off',
  'C · no pairing while Bank reconciliation is off');
select pg_temp.assert((app.payouts_close_state(:jc, :'m'::date)->>'proven') is null
                      and not (app.payouts_close_state(:jc, :'m'::date)->>'bank_on')::boolean,
  'C · with Bank reconciliation off the close item is not proven by the app (a person checks it)');
rollback to savepoint bank_module;

-- ══ D. A non-faith community ════════════════════════════════════════════════
select pg_temp.claims(:nptreas, 30);
select pg_temp.assert(app.module_enabled(:np, 'accounting') and app.module_enabled(:np, 'giving_bank'),
  'D · a secular non-profit has Accounting and Bank reconciliation on');
select app.record_giving_export(:np, 'payments', '{"rows": 1}');
select pg_temp.assert((app.explain_payout(:po3, :b3)->>'difference_cents')::bigint = 0,
  'D · the non-profit''s treasurer exports and pairs its payout the same way');
-- A separate statement: a stable function sees the rows as they were when its statement began.
select pg_temp.assert((app.payouts_close_state(:np, :'m'::date)->>'proven')::boolean,
  'D · and the close item is proven');
select pg_temp.assert_raises(format($$select app.explain_payout(%L, %L)$$, :po2, :b2), 'needs giving.manage',
  'D · and cannot touch the temple''s payouts');

reset role;
rollback;
