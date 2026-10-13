-- 0744: Offering counts, a count matched to its bank deposit line (docs/GIVING_REDESIGN.md slice 5, B93).
--   A. The shape: the link column (one count per line), the guard trigger, the two functions pin their search path and are
--      not callable by anon.
--   B. Matching: a counter (finance volunteer) picks the line of exactly the counted amount; the line is marked matched and
--      nothing is posted to QuickBooks. Refused: a viewer without giving.record_offline, a line of another community, a count
--      without its total, an amount that differs, a line already matched (to payments, a payout, another count), money out.
--   C. The link is the functions' to write: a direct write cannot set or clear it, and a matched count's total, date and
--      deposit reference cannot change, nor can it be removed.
--   D. The undo: giving.manage only, a reason that lands in the audit trail, refused in a locked month; it reopens the line
--      only when the match had closed it.
--   E. The modules: Offering counts or Bank reconciliation paused refuses both, with the module sentence.
--   F. A non-faith community counts and matches the same way; the counters stay two people from different households.
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
create or replace function pg_temp.claims(p_user uuid, p_step_up boolean default true) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
  perform set_config('request.headers', '', true);
  perform set_config('app.audit_reason', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;

\set admin '''15300000-0000-4000-8000-000000000001'''
\set vol '''15300000-0000-4000-8000-000000000002'''
\set viewer '''15300000-0000-4000-8000-000000000003'''
\set c1 '''15300000-0000-4000-8000-000000000004'''
\set c2 '''15300000-0000-4000-8000-000000000005'''
\set c3 '''15300000-0000-4000-8000-000000000006'''
\set npadmin '''15300000-0000-4000-8000-000000000007'''
\set npc1 '''15300000-0000-4000-8000-000000000008'''
\set jc '''15300000-0000-4000-8000-0000000000c1'''
\set np '''15300000-0000-4000-8000-0000000000c2'''
\set hA '''15300000-0000-4000-8000-0000000000b1'''
\set hB '''15300000-0000-4000-8000-0000000000b2'''
\set hN '''15300000-0000-4000-8000-0000000000b3'''
\set pA '''15300000-0000-4000-8000-0000000000a1'''
\set pB '''15300000-0000-4000-8000-0000000000a2'''
\set pA2 '''15300000-0000-4000-8000-0000000000a3'''
\set pN '''15300000-0000-4000-8000-0000000000a4'''
\set acct '''15300000-0000-4000-8000-0000000000d1'''
\set npacct '''15300000-0000-4000-8000-0000000000d2'''
\set l1 '''15300000-0000-4000-8000-0000000000e1'''
\set l2 '''15300000-0000-4000-8000-0000000000e2'''
\set l3 '''15300000-0000-4000-8000-0000000000e3'''
\set l4 '''15300000-0000-4000-8000-0000000000e4'''
\set l5 '''15300000-0000-4000-8000-0000000000e5'''
\set l6 '''15300000-0000-4000-8000-0000000000e6'''
\set l7 '''15300000-0000-4000-8000-0000000000e7'''
\set lnp '''15300000-0000-4000-8000-0000000000e8'''
\set s1 '''15300000-0000-4000-8000-0000000000f1'''
\set s2 '''15300000-0000-4000-8000-0000000000f2'''
\set s3 '''15300000-0000-4000-8000-0000000000f3'''
\set s4 '''15300000-0000-4000-8000-0000000000f4'''
\set snp '''15300000-0000-4000-8000-0000000000f5'''

-- ══ A. The shape ═════════════════════════════════════════════════════════════
select pg_temp.assert(exists (select 1 from information_schema.columns
                               where table_schema = 'app' and table_name = 'counting_sessions' and column_name = 'bank_transaction_id')
                      and exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'counting_sessions_bank_line_uniq'
                                    and indexdef like '%UNIQUE%' and indexdef like '%bank_transaction_id IS NOT NULL%'),
  'A · counting_sessions.bank_transaction_id exists, one count per bank line');
select pg_temp.assert((select bool_and(p.proconfig::text like '%search_path=app, public, extensions%') from pg_proc p
                        where p.oid in ('app.link_count_to_bank_deposit(uuid,uuid)'::regprocedure,
                                        'app.unlink_count_from_bank_deposit(uuid,text)'::regprocedure,
                                        'app.counting_deposit_link_guard()'::regprocedure))
                      and (select bool_and(p.prosecdef) from pg_proc p
                            where p.oid in ('app.link_count_to_bank_deposit(uuid,uuid)'::regprocedure, 'app.unlink_count_from_bank_deposit(uuid,text)'::regprocedure)),
  'A · the two functions are security definer and every new function pins app, public, extensions');
select pg_temp.assert(not has_function_privilege('anon', 'app.link_count_to_bank_deposit(uuid,uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.unlink_count_from_bank_deposit(uuid,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.link_count_to_bank_deposit(uuid,uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.unlink_count_from_bank_deposit(uuid,text)', 'execute'),
  'A · signed-in people can call them; anon cannot');
select pg_temp.assert(exists (select 1 from pg_trigger where tgname = 'counting_deposit_link_guard' and tgrelid = 'app.counting_sessions'::regclass)
                      and exists (select 1 from pg_trigger where tgname = 'counting_distinct_households' and tgrelid = 'app.counting_sessions'::regclass),
  'A · the guard trigger is on counting_sessions, next to 0016''s distinct-households trigger (kept)');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:admin, 'admin153@temple.test'), (:vol, 'vol153@temple.test'), (:viewer, 'viewer153@temple.test'),
  (:c1, 'c1-153@temple.test'), (:c2, 'c2-153@temple.test'), (:c3, 'c3-153@temple.test'),
  (:npadmin, 'admin153@nonprofit.test'), (:npc1, 'c1-153@nonprofit.test');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:jc, 'jc153', 'Temple 153', 'T153', 'TX', 'active', 'America/Chicago');
insert into app.centers (id, slug, name, environment, category_key, status)
values (:np, 'np153-sandbox', 'Food Bank 153', 'sandbox', 'nonprofit_secular', 'onboarding');
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:jc, :admin, 'center_admin', 'counts test 153'), (:jc, :vol, 'finance_volunteer', 'counts test 153'),
  (:jc, :viewer, 'executive_committee', 'counts test 153'), (:np, :npadmin, 'center_admin', 'counts test 153');
insert into app.households (id, center_id, display_name) values
  (:hA, :jc, 'Counter153, Asha'), (:hB, :jc, 'Counter153, Bina'), (:hN, :np, 'Volunteer153, Noor');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pA, :jc, 'Asha', 'Counter153', date '1975-01-01'), (:pB, :jc, 'Bina', 'Counter153', date '1979-01-01'),
  (:pA2, :jc, 'Arun', 'Counter153', date '1974-01-01'), (:pN, :np, 'Noor', 'Volunteer153', date '1985-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:hA, :pA, :jc, 'primary', true), (:hB, :pB, :jc, 'primary', true), (:hA, :pA2, :jc, 'spouse', false), (:hN, :pN, :np, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:jc, :c1, :pA), (:jc, :c2, :pB), (:jc, :c3, :pA2), (:np, :npc1, :pN);
insert into app.bank_accounts (id, center_id, name, institution, last4) values
  (:acct, :jc, 'Operating 153', 'Bank', '1530'), (:npacct, :np, 'Food Bank 153', 'Bank', '1531');
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, status) values
  (:l1, :jc, :acct, current_date, 41250, 'DEPOSIT 153 A', 'unmatched'),
  (:l2, :jc, :acct, current_date, 41250, 'DEPOSIT 153 B', 'matched'),
  (:l3, :jc, :acct, current_date, 41300, 'DEPOSIT 153 C', 'unmatched'),
  (:l4, :jc, :acct, current_date, 41250, 'DEPOSIT 153 D', 'unmatched'),
  (:l5, :jc, :acct, current_date, -41250, 'WITHDRAWAL 153', 'unmatched'),
  (:l6, :jc, :acct, current_date, 41250, 'DEPOSIT 153 F', 'ignored'),
  (:l7, :jc, :acct, current_date, 38000, 'DEPOSIT 153 G', 'suggested'),
  (:lnp, :np, :npacct, current_date, 41250, 'DEPOSIT 153 NP', 'unmatched');
-- L4 holds a payment deposited by match_deposit's rule (payments.deposit_bank_transaction_id), though its status was left open.
insert into app.payments (center_id, household_id, amount_cents, method, provider, received_on, deposit_bank_transaction_id)
values (:jc, :hA, 41250, 'check', 'offline', current_date, :l4);
insert into app.counting_sessions (id, center_id, kind, counted_on, counters, total_cents, bag_numbers) values
  (:s1, :jc, 'bhandar', current_date, array[:c1, :c2]::uuid[], 41250, '{118,119}'),
  (:s2, :jc, 'bhandar', current_date, array[:c1, :c2]::uuid[], 0, '{120}'),
  (:s3, :jc, 'bhandar', current_date, array[:c1, :c2]::uuid[], 38000, '{121}'),
  (:s4, :jc, 'bhandar', current_date, array[:c1, :c2]::uuid[], 41250, '{122}'),
  (:snp, :np, 'other', current_date, array[:npadmin, :npc1]::uuid[], 41250, '{}');

-- ══ B. Matching ══════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:viewer);
select pg_temp.assert_raises(format('select app.link_count_to_bank_deposit(%L, %L)', :s1, :l1), 'permission',
  'B · a viewer (giving.view, no giving.record_offline) cannot match a count');

select pg_temp.claims(:vol);
select pg_temp.assert_raises(format('select app.link_count_to_bank_deposit(%L, %L)', :s1, :lnp), 'not found in this community',
  'B · a bank line of another community is refused');
select pg_temp.assert_raises(format('select app.link_count_to_bank_deposit(%L, %L)', :s2, :l1), 'counted total',
  'B · a count without its total cannot be matched yet');
select pg_temp.assert_raises(format('select app.link_count_to_bank_deposit(%L, %L)', :s1, :l3), 'The count is 412.50 but the bank line is 413.00',
  'B · an amount that differs is refused, naming both amounts (exact amount only)');
select pg_temp.assert_raises(format('select app.link_count_to_bank_deposit(%L, %L)', :s1, :l2), 'already matched',
  'B · a line already matched is refused');
select pg_temp.assert_raises(format('select app.link_count_to_bank_deposit(%L, %L)', :s1, :l4), 'already matched',
  'B · a line that holds deposited payments is refused');
select pg_temp.assert_raises(format('select app.link_count_to_bank_deposit(%L, %L)', :s1, :l6), 'set aside',
  'B · a line set aside (ignored) is refused');
select pg_temp.assert_raises(format('select app.link_count_to_bank_deposit(%L, %L)', :s1, :l5), 'money going out',
  'B · money going out is not a deposit');

select app.link_count_to_bank_deposit(:s1, :l1);
select pg_temp.assert((select bank_transaction_id = :l1::uuid and bank_line_marked and deposit_ref is null and total_cents = 41250
                         from app.counting_sessions where id = :s1),
  'B · a finance volunteer matches the count to the line of exactly its amount; the slip reference is left as it was');
select pg_temp.assert((select status = 'matched' and matched_by = :vol::uuid and matched_at is not null and payment_id is null
                         from app.bank_transactions where id = :l1),
  'B · the line is marked matched, by the person who picked it, with no payment');
reset role;
select pg_temp.assert(not exists (select 1 from app.ledger_postings where center_id = :jc and source_table in ('bank_transactions', 'counting_sessions'))
                      and not exists (select 1 from app.payments where center_id = :jc and deposit_bank_transaction_id = :l1),
  'B · nothing is posted to QuickBooks and no payment is written (owner: no posting for counts)');
set role authenticated;
select pg_temp.assert_raises(format('select app.link_count_to_bank_deposit(%L, %L)', :s4, :l1), 'already matched',
  'B · one count per line: a second count cannot take the same line');
select pg_temp.assert_raises(format('select app.link_count_to_bank_deposit(%L, %L)', :s1, :l7), 'already matched to a bank deposit',
  'B · a count already matched cannot take a second line');
-- A "suggested" line can be matched too.
select app.link_count_to_bank_deposit(:s3, :l7);
select pg_temp.assert((select status from app.bank_transactions where id = :l7) = 'matched',
  'B · a line the bank screen had only suggested is matched the same way');

-- ══ C. The link is the functions' to write ═══════════════════════════════════
select pg_temp.assert_raises(format('update app.counting_sessions set bank_transaction_id = null where id = %L', :s1), 'Match its deposit',
  'C · a direct write cannot clear the link');
select pg_temp.assert_raises(format('update app.counting_sessions set bank_transaction_id = %L where id = %L', :l3, :s4), 'Match its deposit',
  'C · a direct write cannot set the link');
select pg_temp.assert_raises(format('update app.counting_sessions set total_cents = 41000 where id = %L', :s1), 'cannot change',
  'C · a matched count''s total cannot change');
select pg_temp.assert_raises(format('update app.counting_sessions set deposit_ref = %L where id = %L', 'SLIP-1', :s1), 'cannot change',
  'C · a matched count''s deposit reference cannot change');
select pg_temp.assert_raises(format('delete from app.counting_sessions where id = %L', :s1), 'undoes the match',
  'C · a matched count cannot be removed');
select pg_temp.assert_raises(format($$insert into app.counting_sessions (center_id, kind, counters, total_cents, bank_transaction_id) values (%L, 'bhandar', array[%L, %L]::uuid[], 100, %L)$$,
                                    :jc, :c1, :c2, :l3), 'Match its deposit',
  'C · a new count cannot arrive already matched');
update app.counting_sessions set notes = 'Two bags were sealed again' where id = :s1;
select pg_temp.assert((select notes from app.counting_sessions where id = :s1) = 'Two bags were sealed again',
  'C · notes on a matched count still change');
update app.counting_sessions set total_cents = 39000, deposit_ref = 'SLIP-153' where id = :s4;
select pg_temp.assert((select total_cents = 39000 and deposit_ref = 'SLIP-153' from app.counting_sessions where id = :s4),
  'C · a count not matched yet keeps working as before (total and slip reference, Mark deposited)');

-- ══ D. The undo ══════════════════════════════════════════════════════════════
select pg_temp.assert_raises(format('select app.unlink_count_from_bank_deposit(%L, %L)', :s1, 'Wrong line'), 'giving.manage',
  'D · a finance volunteer cannot undo a match');
select pg_temp.claims(:admin);
select pg_temp.assert_raises(format('select app.unlink_count_from_bank_deposit(%L, %L)', :s1, '   '), 'Say why',
  'D · the reason is required');
select pg_temp.assert_raises(format('select app.unlink_count_from_bank_deposit(%L, %L)', :s4, 'Nothing to undo'), 'not matched',
  'D · a count that is not matched has nothing to undo');
-- A locked month refuses the undo.
reset role;
insert into app.accounting_periods (center_id, period_month, status) values (:jc, date_trunc('month', current_date)::date, 'closed');
set role authenticated;
select pg_temp.claims(:admin);
select pg_temp.assert_raises(format('select app.unlink_count_from_bank_deposit(%L, %L)', :s1, 'Wrong line'), 'locked',
  'D · refused once the month is locked');
reset role;
update app.accounting_periods set status = 'open' where center_id = :jc;
set role authenticated;
select pg_temp.claims(:admin);
select app.unlink_count_from_bank_deposit(:s1, '  Picked the Tuesday deposit by mistake  ');
select pg_temp.assert((select bank_transaction_id is null and not bank_line_marked from app.counting_sessions where id = :s1)
                      and (select status = 'unmatched' and matched_by is null and matched_at is null from app.bank_transactions where id = :l1),
  'D · a treasurer undoes the match: the count is waiting again and the line it had closed is open again');
reset role;
select pg_temp.assert((select a.reason = 'Picked the Tuesday deposit by mistake' and a.actor_user_id = :admin::uuid
                         from app.audit_log a where a.record_table = 'counting_sessions' and a.record_id = :s1::text
                         order by a.id desc limit 1),
  'D · the reason is in the audit trail, with who undid it');
-- A line someone else matched afterwards stays matched when the count's match is undone.
update app.bank_transactions set payment_id = (select id from app.payments where deposit_bank_transaction_id = :l4) where id = :l7;
set role authenticated;
select pg_temp.claims(:admin);
select app.unlink_count_from_bank_deposit(:s3, 'Testing a line matched since');
select pg_temp.assert((select status from app.bank_transactions where id = :l7) = 'matched'
                      and (select bank_transaction_id is null from app.counting_sessions where id = :s3),
  'D · a line matched to something else since is left matched; only the count''s link is cleared');
-- Matched again after the undo.
select pg_temp.claims(:vol);
select app.link_count_to_bank_deposit(:s1, :l1);
select pg_temp.assert((select bank_transaction_id from app.counting_sessions where id = :s1) = :l1::uuid,
  'D · after the undo the count can be matched again');

-- ══ E. The modules ═══════════════════════════════════════════════════════════
savepoint counts_off;
select pg_temp.claims(:admin);
select app.set_module_enabled(:jc, 'giving_counts', false, 'Test 153: counting is done on paper');
select pg_temp.assert_raises(format('select app.link_count_to_bank_deposit(%L, %L)', :s4, :l3), 'switched off',
  'E · Offering counts paused: matching refuses with the module sentence');
select pg_temp.assert_raises(format('select app.unlink_count_from_bank_deposit(%L, %L)', :s1, 'Paused'), 'switched off',
  'E · and so does the undo');
rollback to savepoint counts_off;
savepoint bank_off;
select pg_temp.claims(:admin);
select app.set_module_enabled(:jc, 'giving_bank', false, 'Test 153: the bank is reconciled elsewhere');
select pg_temp.assert_raises(format('select app.link_count_to_bank_deposit(%L, %L)', :s4, :l3), 'Bank reconciliation',
  'E · Bank reconciliation paused: no line can be picked (Mark deposited stays)');
update app.counting_sessions set deposit_ref = 'SLIP-153-B' where id = :s4;
select pg_temp.assert((select deposit_ref from app.counting_sessions where id = :s4) = 'SLIP-153-B',
  'E · with Bank reconciliation paused a counter still marks a count deposited with its slip');
rollback to savepoint bank_off;

-- ══ F. A non-faith community; the counters rule ══════════════════════════════
select pg_temp.claims(:npadmin);
select app.link_count_to_bank_deposit(:snp, :lnp);
select pg_temp.assert((select bank_transaction_id from app.counting_sessions where id = :snp) = :lnp::uuid
                      and (select label from app.category_modules where category_key = 'nonprofit_secular' and module_key = 'giving_counts') = 'Cash counts',
  'F · a food bank (not a faith) matches its cash count the same way; its kind calls them Cash counts');
select pg_temp.assert_raises(format('select app.link_count_to_bank_deposit(%L, %L)', :s4, :lnp), 'not found',
  'F · and cannot reach a count of another community');
select pg_temp.claims(:vol);
select pg_temp.assert_raises(format($$insert into app.counting_sessions (center_id, kind, counters, total_cents) values (%L, 'bhandar', array[%L, %L]::uuid[], 100)$$,
                                    :jc, :c1, :c3),
  'different households', 'F · two counters from the same household are still refused (0016, kept)');
insert into app.counting_sessions (center_id, kind, counters, total_cents) values (:jc, 'bhandar', array[:c1, :c2]::uuid[], 100);
select pg_temp.assert((select count(*) from app.counting_sessions where center_id = :jc and total_cents = 100) = 1,
  'F · a finance volunteer still records a count with two counters from different households');

reset role;
rollback;
