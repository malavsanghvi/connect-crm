-- 0868 (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md §5): what a bank line may already be, before it may close anything.
--   A. A line that is a payment already recorded      B. A line that is a waiting proof      C. Ambiguity      D. New money, lookalike, conflict
--   E. The statement preview and the unbanked report      F. Undo, and who may ask
-- Everything runs in one transaction that is rolled back, in its own community and with its own people.
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
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
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/giving/payments/bank"}', true);
  set local role authenticated;
end $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Chicago')::date $$;
-- A bank line.
create or replace function pg_temp.line(p_id uuid, p_acct uuid, p_center uuid, p_cents bigint, p_desc text, p_channel text) returns void language plpgsql as $$
begin
  insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, channel, fingerprint)
  values (p_id, p_center, p_acct, pg_temp.today(), p_cents, p_desc, p_channel, 'fp-868-' || p_id::text);
end $$;
-- The first candidate of a line.
create or replace function pg_temp.top(p_txn uuid) returns jsonb language sql stable as $$
  select to_jsonb(c) from app.reconcile_candidates(p_txn) c order by rank limit 1
$$;

\set c '''00000000-0000-4000-8000-000000086801'''
\set h1 '''86800000-0000-4000-8000-0000000000a1'''
\set h2 '''86800000-0000-4000-8000-0000000000a2'''
\set mina '''86800000-0000-4000-8000-000000000001'''
\set nina '''86800000-0000-4000-8000-000000000004'''
\set tara '''86800000-0000-4000-8000-000000000005'''
\set pmina '''86800000-0000-4000-8000-000000000101'''
\set pnina '''86800000-0000-4000-8000-000000000104'''
\set acct '''86800000-0000-4000-8000-0000000003b1'''
\set l1 '''86800000-0000-4000-8000-0000000004a1'''
\set l2 '''86800000-0000-4000-8000-0000000004a2'''
\set l3 '''86800000-0000-4000-8000-0000000004a3'''
\set l4 '''86800000-0000-4000-8000-0000000004a4'''
\set l5 '''86800000-0000-4000-8000-0000000004a5'''
\set l6 '''86800000-0000-4000-8000-0000000004a6'''
\set pq1 '''86800000-0000-4000-8000-0000000002a1'''
\set pq2 '''86800000-0000-4000-8000-0000000002a2'''
\set pl1 '''86800000-0000-4000-8000-0000000001a1'''
\set pl2 '''86800000-0000-4000-8000-0000000001a2'''
create or replace function pg_temp.u(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;

begin;
select set_config('t.' || k, v, false) from (values ('c', :c), ('h1', :h1), ('h2', :h2), ('mina', :mina), ('nina', :nina), ('tara', :tara),
  ('l1', :l1), ('l2', :l2), ('l3', :l3), ('l4', :l4), ('l5', :l5), ('l6', :l6), ('pq1', :pq1), ('pq2', :pq2), ('pl1', :pl1)) x(k, v);
insert into auth.users (id, email) values (:mina, 'mina@rec868.test'), (:nina, 'nina@rec868.test'), (:tara, 'tara@rec868.test');
insert into app.centers (id, slug, name, short_name, time_zone, currency) values (:c, 'rec868', 'Rec 868 Center', 'R868', 'America/Chicago', 'USD');
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_at) values
  (:c, 'giving', true, 'test', now()), (:c, 'giving_proofs', true, 'test', now()), (:c, 'giving_bank', true, 'test', now())
  on conflict (center_id, module_key) do update set granted = true;
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Rao family'), (:h2, :c, 'Shah family');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pmina, :c, 'Mina', 'Rao', '1980-01-01'), (:pnina, :c, 'Nina', 'Shah', '1985-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:h1, :pmina, :c, 'primary', true), (:h2, :pnina, :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c, :mina, :pmina), (:c, :nina, :pnina);
insert into app.role_grants (center_id, user_id, role_key) values (:c, :tara, 'treasurer');
insert into app.center_payment_methods (center_id, method, accepted) values (:c, 'check', true), (:c, 'zelle', true), (:c, 'ach', true), (:c, 'cash', true)
  on conflict (center_id, method) do update set accepted = true;
insert into app.bank_accounts (id, center_id, name, institution, last4) values (:acct, :c, 'Operating', 'Chase', '4608');
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at, dedication) values
  (:pl1, :c, :h1, 'general', 40000, now() - interval '30 days', 'Older pledge'), (:pl2, :c, :h1, 'general', 5000, now() - interval '10 days', 'Newer pledge');
-- Mina's bank is known by name.
insert into app.external_ids (center_id, household_id, kind, system, value, label, source, confidence)
  values (:c, :h1, 'bank_payer', 'chase', 'MINA RAO', 'Zelle payer name', 'learned', 0.95);

-- ═══════════════════════════════════════════════════════════════════════════════
-- A. A check recorded by hand, then its line on the statement
select pg_temp.as_user(:tara);
select app.record_offline_payment(:h1, 25000, 'check'::app.payment_method, pg_temp.today() - 3, null, '1048') as pay1 \gset
select set_config('t.pay1', :'pay1', false);
select pg_temp.as_none();
select pg_temp.line(:l1, :acct, :c, 25000, 'CHECK 1048 DEPOSITED', 'check');
select pg_temp.as_user(:tara);
select pg_temp.assert((pg_temp.top(:l1) ->> 'kind') = 'payment' and (pg_temp.top(:l1) ->> 'ref_id')::uuid = :'pay1'::uuid and (pg_temp.top(:l1) ->> 'tier') = 'A',
                      'A · a $250 check line with the check number of a recorded payment is that payment (tier A)');
select pg_temp.assert((pg_temp.top(:l1) ->> 'consequence') like '%No pledge changes%' and not (pg_temp.top(:l1) ->> 'blocked')::boolean,
                      'A · and says in words that attaching changes no pledge');
select pg_temp.assert(not exists (select 1 from app.reconcile_candidates(:l1) where kind = 'new_money'), 'A · it is never offered as new money');

-- B. A waiting proof: the same amount by bank transfer
select pg_temp.as_user(:mina);
select app.submit_payment_proof(:c, :h1, 'ach', 12000, pg_temp.today() - 1, 'trace 5521', null, array[:pl1]::uuid[], 'open_pledges', null,
        jsonb_build_array(jsonb_build_object('path', :c::text || '/' || :h1::text || '/' || :pq1::text || '/a.jpg', 'content_type', 'image/jpeg', 'bytes', 900)), 'key-868-0001');
select pg_temp.as_none();
select pg_temp.line(:l2, :acct, :c, 12000, 'ACH CREDIT ORIG CO NAME RAO MINA', 'ach');
select pg_temp.as_user(:tara);
select pg_temp.assert((pg_temp.top(:l2) ->> 'kind') = 'proof' and (pg_temp.top(:l2) ->> 'ref_id')::uuid = :pq1::uuid, 'B · an ACH line of the same amount is the waiting proof');
select pg_temp.assert((pg_temp.top(:l2) ->> 'consequence') like '%approved and banked in one step%', 'B · and says the proof is approved and banked together');
select app.approve_payment_proof(:pq1::uuid, null, null, null, null, null, null, :l2::uuid);
select pg_temp.as_none();
select pg_temp.assert((select status from app.bank_transactions where id = :l2) = 'matched'
                  and (select deposit_bank_transaction_id from app.payments where idempotency_key = 'proof:' || :pq1::text) = :l2::uuid
                  and (select reconciled_at from app.payments where idempotency_key = 'proof:' || :pq1::text) is not null,
                      'B · approving with the line records the payment already on the bank');
select pg_temp.assert((select count(*) from app.payments where household_id = :h1) = 2, 'B · and creates no third payment');

-- C. Two waiting proofs of the same amount from two families: nothing is a default
select pg_temp.as_user(:mina);
select app.submit_payment_proof(:c, :h1, 'ach', 7000, pg_temp.today() - 1, null, null, array[:pl1]::uuid[], 'open_pledges', null,
        jsonb_build_array(jsonb_build_object('path', :c::text || '/' || :h1::text || '/' || '86800000-0000-4000-8000-0000000002b1' || '/a.jpg', 'content_type', 'image/jpeg', 'bytes', 900)), 'key-868-0002');
select pg_temp.as_none();
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at, dedication)
  values ('86800000-0000-4000-8000-0000000001b1', :c, :h2, 'general', 9000, now() - interval '5 days', 'Shah pledge');
select pg_temp.as_user(:nina);
select app.submit_payment_proof(:c, :h2, 'ach', 7000, pg_temp.today() - 1, null, null, null, 'open_pledges', null,
        jsonb_build_array(jsonb_build_object('path', :c::text || '/' || :h2::text || '/' || '86800000-0000-4000-8000-0000000002b2' || '/a.jpg', 'content_type', 'image/jpeg', 'bytes', 900)), 'key-868-0003');
select pg_temp.as_none();
select pg_temp.line(:l3, :acct, :c, 7000, 'ACH CREDIT ORIG CO NAME UNKNOWN PAYER', 'ach');
select pg_temp.as_user(:tara);
select pg_temp.assert((select count(*) from app.reconcile_candidates(:l3) where kind = 'proof') = 2
                  and not exists (select 1 from app.reconcile_candidates(:l3) where tier in ('A', 'B')), 'C · two families'' proofs fit one line: both are only Possible (tier C)');

-- D. New money, a lookalike, a conflict
select pg_temp.as_none();
select pg_temp.line(:l4, :acct, :c, 3300, 'ZELLE PAYMENT FROM MINA RAO JPM99BXK2Q1V', 'zelle');
select pg_temp.as_user(:tara);
select pg_temp.assert((pg_temp.top(:l4) ->> 'kind') = 'new_money' and (pg_temp.top(:l4) ->> 'household_id')::uuid = :h1::uuid and (pg_temp.top(:l4) ->> 'tier') = 'B'
                  and (pg_temp.top(:l4) ->> 'consequence') like '%Oldest uncovered pledges first%', 'D · a known payer with nothing to explain it is new money, with the pledges it would close');
select app.record_offline_payment(:h1, 4000, 'cash'::app.payment_method, pg_temp.today() - 2, null, null, 'env 4');
select pg_temp.as_none();
select pg_temp.line(:l5, :acct, :c, 4000, 'ZELLE PAYMENT FROM MINA RAO JPM99BXK2Q2V', 'zelle');
select pg_temp.as_user(:tara);
select pg_temp.assert((pg_temp.top(:l5) ->> 'kind') = 'lookalike' and (pg_temp.top(:l5) ->> 'blocked')::boolean and (pg_temp.top(:l5) ->> 'tier') = 'D',
                      'D · the family has an unbanked $40 cash payment: a $40 line is a blocked lookalike, not new money');
select pg_temp.assert_state($$select app.confirm_bank_match(pg_temp.u('l5'), pg_temp.u('h1'))$$, 'CCDUP', 'D · and confirming it as a new payment is refused');
select app.record_offline_payment(:h1, 20000, 'zelle'::app.payment_method, pg_temp.today() - 2, null, null, 'zelle by hand');
select pg_temp.as_none();
select pg_temp.line(:l6, :acct, :c, 18000, 'ZELLE PAYMENT FROM MINA RAO JPM99BXK2Q3V', 'zelle');
select pg_temp.as_user(:tara);
select pg_temp.assert((pg_temp.top(:l6) ->> 'kind') = 'conflict' and (pg_temp.top(:l6) ->> 'tier') = 'D' and (pg_temp.top(:l6) ->> 'label') like '%less by $20.00%',
                      'D · a Zelle of $180 against a recorded $200: a conflict that names the $20 difference');

-- E. The statement preview and the unbanked report
select pg_temp.assert(jsonb_array_length(app.reconcile_statement(:c)) = 5, 'E · the preview lists the five unmatched incoming lines (the matched ACH line is gone)');
select pg_temp.assert((select count(*) from jsonb_array_elements(app.reconcile_statement(:c)) e where jsonb_array_length(e -> 'candidates') > 0) = 5,
                      'E · each with at least one candidate');
select pg_temp.assert((app.unbanked_counts(:c) ->> 'total')::int = 3, 'E · three payments count as paid and are not on the bank (the check, the cash, the Zelle)');
select pg_temp.as_none();
update app.payments set received_on = pg_temp.today() - 60 where household_id = :h1 and method = 'check';
select pg_temp.as_user(:tara);
select pg_temp.assert((app.unbanked_counts(:c) ->> 'past_window')::int = 1 and (app.unbanked_counts(:c) ->> 'oldest_days')::int = 60, 'E · a 60-day-old check is past its 30-day window');
select pg_temp.as_user(:mina);
select pg_temp.assert_state($$select app.reconcile_statement(pg_temp.u('c'))$$, '42501', 'F · a member cannot see the reconciliation');
select pg_temp.assert_state($$select app.unbanked_payments_report(pg_temp.u('c'))$$, '42501', 'F · nor the unbanked report');

-- F. Undo
select pg_temp.as_user(:tara);
select app.attach_bank_line_to_payment(:l1, :'pay1'::uuid);
select pg_temp.as_none();
select pg_temp.assert((select reconciled_at from app.payments where id = :'pay1'::uuid) is not null and (select status from app.bank_transactions where id = :l1) = 'matched', 'F · the attached payment is reconciled');
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.unreconcile_bank_line(pg_temp.u('l1'), 'x')$$, 'Say why', 'F · undoing needs a reason');
select app.unreconcile_bank_line(:l1, 'Matched to the wrong check, undoing it');
select pg_temp.as_none();
select pg_temp.assert((select deposit_bank_transaction_id from app.payments where id = :'pay1'::uuid) is null and (select reconciled_at from app.payments where id = :'pay1'::uuid) is null
                  and (select status from app.bank_transactions where id = :l1) = 'unmatched', 'F · undo puts the payment back to unbanked and the line back to unmatched');
select pg_temp.as_user(:tara);
select app.confirm_bank_match(:l4, :h1);
select pg_temp.assert_raises($$select app.unreconcile_bank_line(pg_temp.u('l4'), 'Wrong family by mistake')$$, 'created its payment', 'F · a line that created its own payment cannot be undone here');
rollback;
