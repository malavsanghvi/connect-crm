-- 0872: undo of a deposit line that banked several payments, the staff view log, the soft credit in the chat draft context.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt; raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/giving"}', true);
  set local role authenticated;
end $$;
create or replace function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Chicago')::date $$;
create or replace function pg_temp.u(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
\set c '''00000000-0000-4000-8000-000000087201'''
\set h1 '''87200000-0000-4000-8000-0000000000a1'''
\set mina '''87200000-0000-4000-8000-000000000001'''
\set tara '''87200000-0000-4000-8000-000000000005'''
\set pmina '''87200000-0000-4000-8000-000000000101'''
\set acct '''87200000-0000-4000-8000-0000000003b1'''
\set l1 '''87200000-0000-4000-8000-0000000004a1'''
\set pq1 '''87200000-0000-4000-8000-0000000002a1'''
\set pl1 '''87200000-0000-4000-8000-0000000001a1'''
begin;
select set_config('t.l1', :l1, false);
insert into auth.users (id, email) values (:mina, 'mina@fu872.test'), (:tara, 'tara@fu872.test');
insert into app.centers (id, slug, name, short_name, time_zone, currency) values (:c, 'fu872', 'FU 872', 'F872', 'America/Chicago', 'USD');
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_at) values
  (:c, 'giving', true, 'test', now()), (:c, 'giving_proofs', true, 'test', now()), (:c, 'giving_bank', true, 'test', now())
  on conflict (center_id, module_key) do update set granted = true;
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Rao family');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:pmina, :c, 'Mina', 'Rao', '1980-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:h1, :pmina, :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c, :mina, :pmina);
insert into app.role_grants (center_id, user_id, role_key) values (:c, :tara, 'treasurer');
insert into app.center_payment_methods (center_id, method, accepted) values (:c, 'check', true) on conflict (center_id, method) do update set accepted = true;
insert into app.bank_accounts (id, center_id, name, institution, last4) values (:acct, :c, 'Operating', 'Chase', '4608');
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at, dedication)
  values (:pl1, :c, :h1, 'general', 100000, now() - interval '10 days', 'Big pledge');

-- A deposit of two checks, then undone
select pg_temp.as_user(:tara);
select app.record_offline_payment(:h1, 10000, 'check'::app.payment_method, pg_temp.today() - 3, null, '101') as pay1 \gset
select app.record_offline_payment(:h1, 15000, 'check'::app.payment_method, pg_temp.today() - 3, null, '102') as pay2 \gset
reset role;
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, channel, fingerprint)
  values (:l1, :c, :acct, pg_temp.today(), 25000, 'DEPOSIT', 'cash_deposit', 'fp-872-1');
select pg_temp.as_user(:tara);
select app.match_deposit(:l1, array[:'pay1'::uuid, :'pay2'::uuid]);
reset role;
select pg_temp.assert((select count(*) from app.payments where deposit_bank_transaction_id = :l1) = 2 and (select is_batch_deposit from app.bank_transactions where id = :l1),
                      'the deposit banked both payments');
select pg_temp.as_user(:tara);
select app.unreconcile_bank_line(:l1, 'Matched to the wrong deposit slip');
reset role;
select pg_temp.assert((select count(*) from app.payments where deposit_bank_transaction_id = :l1) = 0
                  and (select count(*) from app.payments where household_id = :h1 and status = 'captured' and reconciled_at is null) = 2
                  and (select status from app.bank_transactions where id = :l1) = 'unmatched' and not (select is_batch_deposit from app.bank_transactions where id = :l1),
                      'undo returns both payments to unbanked and the line to unmatched');

-- The draft context carries soft credit
select pg_temp.as_user(:mina);
select app.submit_payment_proof(:c, :h1, 'check', 20000, pg_temp.today(), '555', null, null, 'open_pledges', null,
        jsonb_build_array(jsonb_build_object('path', :c::text || '/' || :h1::text || '/' || :pq1::text || '/a.jpg', 'content_type', 'image/jpeg', 'bytes', 900)), 'key-872-0001');
select pg_temp.as_user(:tara);
select pg_temp.assert((app.giving_draft_context(:h1) -> 'open_pledges' -> 0 ->> 'soft_credit_cents')::bigint = 20000, 'the chat draft context shows the $200 of soft credit on the pledge');

-- The staff view log
select id as f1 from app.payment_proof_files where proof_id = :pq1 limit 1 \gset
select app.log_proof_view(:'f1'::uuid);
reset role;
select pg_temp.assert((select count(*) from app.audit_log where action = 'payment_proof_files.view' and record_id = :'f1') = 1, 'a staff view of a proof is logged');
select pg_temp.as_user(:mina);
select app.log_proof_view(:'f1'::uuid);
reset role;
select pg_temp.assert((select count(*) from app.audit_log where action = 'payment_proof_files.view' and record_id = :'f1') = 1, 'a family member opening their own proof is not logged');
rollback;
