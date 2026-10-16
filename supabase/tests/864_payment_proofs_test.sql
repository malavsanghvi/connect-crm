-- 0864-0867 (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md, slice 1): payment proofs, Soft credit, verification, evidence, the double-count guard.
--   A. Sending a proof     B. Soft credit and the open balance     C. Verifying (approve, reject, ask, merge)     D. Two people, own household
--   E. Evidence on every pledge a payment credited     F. The guard against counting the same money twice     G. Access (RLS, bucket, module)
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
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/giving"}', true);
  set local role authenticated;
end $$;
create or replace function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Chicago')::date $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- A pledge of the family, pledged on a given day.
create or replace function pg_temp.pledge(p_id uuid, p_center uuid, p_hh uuid, p_cents bigint, p_days_ago int) returns void language plpgsql as $$
begin
  insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at, dedication)
  values (p_id, p_center, p_hh, 'general', p_cents, now() - make_interval(days => p_days_ago), 'Test pledge ' || p_cents);
end $$;
-- Uploaded file descriptors for a proof folder.
create or replace function pg_temp.files(p_center uuid, p_hh uuid, p_proof uuid, p_n int, p_tag text default 'a') returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('path', p_center || '/' || p_hh || '/' || p_proof || '/' || p_tag || g || '.jpg',
         'content_type', 'image/jpeg', 'bytes', 1000 + g, 'sha256', md5(p_proof::text || p_tag || g) || md5(p_tag || g || p_proof::text))), '[]'::jsonb)
  from generate_series(1, p_n) g
$$;

create or replace function pg_temp.u(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
\set c '''00000000-0000-4000-8000-000000086401'''
\set d '''00000000-0000-4000-8000-000000086402'''
\set h1 '''86400000-0000-4000-8000-0000000000a1'''
\set h2 '''86400000-0000-4000-8000-0000000000a2'''
\set mina '''86400000-0000-4000-8000-000000000001'''
\set raj '''86400000-0000-4000-8000-000000000002'''
\set teen '''86400000-0000-4000-8000-000000000003'''
\set nina '''86400000-0000-4000-8000-000000000004'''
\set tara '''86400000-0000-4000-8000-000000000005'''
\set uma '''86400000-0000-4000-8000-000000000006'''
\set olga '''86400000-0000-4000-8000-000000000007'''
\set dee '''86400000-0000-4000-8000-000000000008'''
\set pmina '''86400000-0000-4000-8000-000000000101'''
\set praj '''86400000-0000-4000-8000-000000000102'''
\set pteen '''86400000-0000-4000-8000-000000000103'''
\set pnina '''86400000-0000-4000-8000-000000000104'''
\set pdee '''86400000-0000-4000-8000-000000000108'''
\set hd '''86400000-0000-4000-8000-0000000000d1'''
\set p1 '''86400000-0000-4000-8000-0000000001a1'''
\set p2 '''86400000-0000-4000-8000-0000000001a2'''
\set p3 '''86400000-0000-4000-8000-0000000001a3'''
\set pq1 '''86400000-0000-4000-8000-0000000002a1'''
\set pq2 '''86400000-0000-4000-8000-0000000002a2'''
\set pq3 '''86400000-0000-4000-8000-0000000002a3'''
\set pq4 '''86400000-0000-4000-8000-0000000002a4'''
\set pq5 '''86400000-0000-4000-8000-0000000002a5'''
\set pq6 '''86400000-0000-4000-8000-0000000002a6'''
\set pqd '''86400000-0000-4000-8000-0000000002d1'''

begin;
select set_config('t.' || k, v, false) from (values ('c', :c), ('d', :d), ('h1', :h1), ('h2', :h2), ('hd', :hd), ('p1', :p1), ('p2', :p2), ('p3', :p3), ('pq1', :pq1), ('pq2', :pq2), ('pq3', :pq3), ('pq4', :pq4), ('pq5', :pq5), ('pq6', :pq6), ('pqd', :pqd), ('mina', :mina), ('raj', :raj), ('teen', :teen), ('nina', :nina), ('tara', :tara), ('uma', :uma), ('olga', :olga), ('dee', :dee)) x(k, v);
-- ── Fixtures ─────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  (:mina, 'mina@proof864.test'), (:raj, 'raj@proof864.test'), (:teen, 'teen@proof864.test'), (:nina, 'nina@proof864.test'),
  (:tara, 'tara@proof864.test'), (:uma, 'uma@proof864.test'), (:olga, 'olga@proof864.test'), (:dee, 'dee@proof864.test');
insert into app.centers (id, slug, name, short_name, time_zone, currency) values
  (:c, 'proof864', 'Proof 864 Center', 'P864', 'America/Chicago', 'USD'),
  (:d, 'proof864-off', 'Proof 864 Off', 'O864', 'America/Chicago', 'USD');
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_at) values
  (:c, 'giving', true, 'test', now()), (:c, 'giving_proofs', true, 'test', now()), (:c, 'giving_bank', true, 'test', now()),
  (:d, 'giving', true, 'test', now()), (:d, 'giving_proofs', false, 'test', now())
  on conflict (center_id, module_key) do update set granted = excluded.granted;
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Rao family'), (:h2, :c, 'Shah family'), (:hd, :d, 'Iyer family');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pmina, :c, 'Mina', 'Rao', '1980-01-01'), (:praj, :c, 'Raj', 'Rao', '1979-01-01'),
  (:pteen, :c, 'Teen', 'Rao', pg_temp.today() - interval '12 years'), (:pnina, :c, 'Nina', 'Shah', '1985-01-01'),
  (:pdee, :d, 'Dee', 'Iyer', '1985-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :pmina, :c, 'primary', true), (:h1, :praj, :c, 'spouse', false), (:h1, :pteen, :c, 'child', false),
  (:h2, :pnina, :c, 'primary', true), (:hd, :pdee, :d, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :mina, :pmina), (:c, :raj, :praj), (:c, :teen, :pteen), (:c, :nina, :pnina), (:d, :dee, :pdee);
insert into app.role_grants (center_id, user_id, role_key) values (:c, :tara, 'treasurer'), (:c, :uma, 'treasurer'), (:c, :raj, 'treasurer');
insert into app.center_owners (center_id, user_id) values (:c, :olga);
insert into app.center_payment_methods (center_id, method, accepted) values
  (:c, 'check', true), (:c, 'cash', true), (:c, 'zelle', true), (:c, 'stock', false), (:d, 'check', true)
  on conflict (center_id, method) do update set accepted = excluded.accepted;
select pg_temp.pledge(:p1, :c, :h1, 16000, 60);   -- the oldest
select pg_temp.pledge(:p2, :c, :h1, 30000, 40);
select pg_temp.pledge(:p3, :c, :h1, 10000, 20);

-- ═══════════════════════════════════════════════════════════════════════════════
-- A. Sending a proof: $250 by check covers the oldest pledge fully and part of the next
select pg_temp.as_user(:mina);
select (app.submit_payment_proof(:c, :h1, 'check', 25000, pg_temp.today() - 1, '1048', 'for the supper', null, 'open_pledges', null,
        pg_temp.files(:c, :h1, :pq1, 2), 'key-864-0001') -> 'proof' ->> 'id')::uuid as proof1 \gset
select set_config('t.proof1', :'proof1', false);
select pg_temp.assert(:'proof1'::uuid = :pq1::uuid, 'A · the proof takes the id of its upload folder');
select pg_temp.as_none();
select pg_temp.assert((select count(*) from app.payments where household_id = :h1) = 0
                  and (select count(*) from app.payment_allocations where center_id = :c) = 0,
                      'A · sending a proof records no payment and no allocation');
select pg_temp.assert((select status::text from app.pledges where id = :p1) = 'soft_credit'
                  and (select soft_credit_cents from app.pledges where id = :p1) = 16000,
                      'A · the oldest pledge, fully covered, is Soft credit');
select pg_temp.assert((select status::text from app.pledges where id = :p2) = 'open'
                  and (select soft_credit_cents from app.pledges where id = :p2) = 9000
                  and (select soft_credit_cents from app.pledges where id = :p3) = 0,
                      'A · the next pledge is only partly covered: still open, with $90 of soft credit');
select pg_temp.assert((select coalesce(sum(amount_cents - paid_cents - soft_credit_cents), 0) from app.pledges
                        where household_id = :h1 and status in ('open','partially_paid')) = 31000,
                      'A · the open balance leaves out soft credit: $310, not $560');
select pg_temp.assert((select count(*) from app.payment_proof_files where proof_id = :pq1) = 2
                  and (select count(*) from app.payment_proof_events where proof_id = :pq1 and kind = 'submitted') = 1, 'A · two files and a timeline entry');
select pg_temp.as_user(:mina);
select pg_temp.assert((app.submit_payment_proof(:c, :h1, 'check', 25000, pg_temp.today() - 1, '1048', null, null, 'open_pledges', null,
        pg_temp.files(:c, :h1, :pq1, 2), 'key-864-0001') ->> 'replayed')::boolean, 'A · the same confirmation key is a replay, not a second proof');
select pg_temp.assert_raises($$select app.submit_payment_proof(pg_temp.u('c'), pg_temp.u('h1'), 'check', 25100, pg_temp.today() - 1, '1', null, null, 'open_pledges', null,
        pg_temp.files(pg_temp.u('c'), pg_temp.u('h1'), pg_temp.u('pq2'), 1), 'key-864-0001')$$, 'already used for a different proof', 'A · a reused key with other details is refused');
select pg_temp.assert_raises($$select app.submit_payment_proof(pg_temp.u('c'), pg_temp.u('h1'), 'check', 5000, pg_temp.today(), '2', null, null, 'open_pledges', null, '[]'::jsonb, 'key-864-0002')$$,
        'Add a photo or file', 'A · a check needs a proof');
select pg_temp.assert_raises($$select app.submit_payment_proof(pg_temp.u('c'), pg_temp.u('h1'), 'cash', 5000, pg_temp.today() + 1, null, null, null, 'open_pledges', null, '[]'::jsonb, 'key-864-0003')$$,
        'cannot be in the future', 'A · the date cannot be in the future');
select pg_temp.assert_raises($$select app.submit_payment_proof(pg_temp.u('c'), pg_temp.u('h1'), 'stock', 5000, pg_temp.today(), null, null, null, 'open_pledges', null, '[]'::jsonb, 'key-864-0004')$$,
        'does not take that way', 'A · a method the organization does not accept is refused');
select pg_temp.assert_raises($$select app.submit_payment_proof(pg_temp.u('c'), pg_temp.u('h1'), 'cash', 0, pg_temp.today(), null, null, null, 'open_pledges', null, '[]'::jsonb, 'key-864-0005')$$,
        'Enter the amount', 'A · a zero amount is refused');
select pg_temp.assert_raises($$select app.submit_payment_proof(pg_temp.u('c'), pg_temp.u('h1'), 'cash', 5000, pg_temp.today(), null, null, null, 'open_pledges', null,
        pg_temp.files(pg_temp.u('c'), pg_temp.u('h2'), pg_temp.u('pq2'), 1), 'key-864-0006')$$, 'not uploaded to the right place', 'A · a file in another family''s folder is refused');
select pg_temp.as_user(:teen);
select pg_temp.assert_state($$select app.submit_payment_proof(pg_temp.u('c'), pg_temp.u('h1'), 'cash', 5000, pg_temp.today(), null, null, null, 'open_pledges', null, '[]'::jsonb, 'key-864-0007')$$,
        '42501', 'A · a child cannot send a proof');
select pg_temp.as_user(:nina);
select pg_temp.assert_state($$select app.submit_payment_proof(pg_temp.u('c'), pg_temp.u('h1'), 'cash', 5000, pg_temp.today(), null, null, null, 'open_pledges', null, '[]'::jsonb, 'key-864-0008')$$,
        '42501', 'A · another family''s adult cannot send a proof for this family');
select pg_temp.as_user(:dee);
select pg_temp.assert_raises($$select app.submit_payment_proof(pg_temp.u('d'), pg_temp.u('hd'), 'check', 5000, pg_temp.today(), null, null, null, 'open_pledges', null, pg_temp.files(pg_temp.u('d'), pg_temp.u('hd'), pg_temp.u('pqd'), 1), 'key-864-0009')$$,
        'Payment proofs', 'A · with Payment proofs off, nothing can be sent');

-- B. More than the open balance: the extra is not credited; withdrawing gives everything back
select pg_temp.as_user(:mina);
select (app.submit_payment_proof(:c, :h1, 'cash', 60000, pg_temp.today(), 'envelope 7', null, null, 'open_pledges', null, '[]'::jsonb, 'key-864-0010') -> 'proof' ->> 'id')::uuid as proof2 \gset
select set_config('t.proof2', :'proof2', false);
select pg_temp.as_none();
select pg_temp.assert((select excess_cents from app.payment_proofs where id = :'proof2') = 29000
                  and (select status::text from app.pledges where id = :p2) = 'soft_credit' and (select status::text from app.pledges where id = :p3) = 'soft_credit',
                      'B · $600 against $310 still uncovered: the extra $290 is recorded but not credited');
select pg_temp.as_user(:mina);
select pg_temp.assert_raises($$select app.submit_payment_proof(pg_temp.u('c'), pg_temp.u('h1'), 'cash', 5000, pg_temp.today(), null, null, null, 'open_pledges', null, '[]'::jsonb, 'key-864-0011')$$,
        'no open pledge', 'B · with every pledge covered, a new proof has nothing to cover');
select app.withdraw_payment_proof(:'proof2');
select pg_temp.as_none();
select pg_temp.assert((select status::text from app.pledges where id = :p2) = 'open' and (select soft_credit_cents from app.pledges where id = :p2) = 9000
                  and (select status::text from app.pledges where id = :p3) = 'open' and (select soft_credit_cents from app.pledges where id = :p3) = 0,
                      'B · taking a proof back returns its pledges to Open (the first proof still covers $250)');

-- C. The treasury team
select pg_temp.as_user(:mina);
select pg_temp.assert_state($$select app.payment_proof_queue(pg_temp.u('c'))$$, '42501', 'C · a member cannot read the queue');
select pg_temp.as_user(:tara);
select pg_temp.assert((jsonb_array_length(app.payment_proof_queue(:c)) = 1) and ((app.payment_proof_counts(:c) ->> 'waiting')::int = 1), 'C · the queue and the Home count show the waiting proof');
select pg_temp.assert((app.payment_proof_queue(:c) -> 0 -> 'household' ->> 'household_name') = 'Rao family'
                  and (app.payment_proof_queue(:c) -> 0 ->> 'own_household')::boolean = false, 'C · each card carries its household card');
select pg_temp.as_user(:raj);
select pg_temp.assert_raises($$select app.approve_payment_proof(pg_temp.u('proof1'))$$, 'own household', 'D · a treasurer cannot verify a proof from their own household');
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.reject_payment_proof(pg_temp.u('proof1'), 'x')$$, 'Say why', 'C · a rejection needs a reason');
select app.approve_payment_proof(:'proof1', null, null, null, 'looks right');
select pg_temp.as_none();
select pg_temp.assert((select count(*) from app.payments where household_id = :h1 and idempotency_key = 'proof:' || :'proof1') = 1
                  and (select amount_cents from app.payments where household_id = :h1) = 25000
                  and (select method::text from app.payments where household_id = :h1) = 'check'
                  and (select provider from app.payments where household_id = :h1) = 'offline', 'C · approving records the payment once');
select pg_temp.assert((select status::text from app.pledges where id = :p1) = 'paid' and (select paid_cents from app.pledges where id = :p1) = 16000
                  and (select soft_credit_cents from app.pledges where id = :p1) = 0, 'C · the oldest pledge is Paid');
select pg_temp.assert((select status::text from app.pledges where id = :p2) = 'partially_paid' and (select paid_cents from app.pledges where id = :p2) = 9000
                  and (select soft_credit_cents from app.pledges where id = :p2) = 0, 'C · the next is part paid, $210 still open');
select pg_temp.assert((select coalesce(sum(amount_cents - paid_cents - soft_credit_cents), 0) from app.pledges
                        where household_id = :h1 and status in ('open','partially_paid')) = 31000,
                      'C · approving does not change the open balance: the proof was already left out ($310)');
select pg_temp.assert((select status from app.payment_proofs where id = :'proof1') = 'approved'
                  and (select count(*) from app.soft_credits where proof_id = :pq1 and state = 'converted') = 2
                  and (select count(*) from app.payment_proof_files where proof_id = :pq1 and payment_id is not null) = 2, 'C · the proof is approved and its files follow the payment');
select pg_temp.assert((select reconciled_at from app.pledges where id = :p1) is null, 'C · Paid is not Bank reconciled until the bank shows it');
select pg_temp.as_user(:uma);
select pg_temp.assert_raises($$select app.approve_payment_proof(pg_temp.u('proof1'))$$, 'already approved', 'C · a decided proof cannot be decided again');

-- E. The proof stays connected to every pledge the payment credited
select pg_temp.as_user(:mina);
select pg_temp.assert((select jsonb_array_length(app.pledge_evidence(:p1))) = 1 and (select jsonb_array_length(app.pledge_evidence(:p2))) = 1
                  and (app.pledge_evidence(:p1) -> 0 ->> 'covered_cents')::bigint = 16000 and (app.pledge_evidence(:p2) -> 0 ->> 'covered_cents')::bigint = 9000
                  and jsonb_array_length(app.pledge_evidence(:p1) -> 0 -> 'files') = 2, 'E · both pledges show the same proof, each with the share it covered');
select pg_temp.assert((app.pledge_evidence(:p1) -> 0 ->> 'kept_until')::date = make_date(extract(year from pg_temp.today())::int + 7, 12, 31),
                      'E · kept until December 31 of the payment year plus the default 7 years');
select pg_temp.assert((app.pledge_evidence(:p3)) = '[]'::jsonb, 'E · a pledge with no proof shows none');
select pg_temp.as_user(:nina);
select pg_temp.assert_state($$select app.pledge_evidence(pg_temp.u('p1'))$$, '42501', 'E · another family cannot open it');
select pg_temp.as_user(:teen);
select pg_temp.assert_state($$select app.pledge_evidence(pg_temp.u('p1'))$$, '42501', 'E · a child cannot open it');

-- C. Reject and ask
select pg_temp.as_user(:mina);
select (app.submit_payment_proof(:c, :h1, 'cash', 4000, pg_temp.today(), 'envelope 9', null, array[:p3]::uuid[], 'open_pledges', null, '[]'::jsonb, 'key-864-0012') -> 'proof' ->> 'id')::uuid as proof3 \gset
select set_config('t.proof3', :'proof3', false);
select pg_temp.as_user(:tara);
select app.reject_payment_proof(:'proof3', 'There is no envelope 9 in the count.');
select pg_temp.as_none();
select pg_temp.assert((select status from app.payment_proofs where id = :'proof3') = 'rejected'
                  and (select soft_credit_cents from app.pledges where id = :p3) = 0 and (select status::text from app.pledges where id = :p3) = 'open',
                      'C · rejecting releases the soft credit; the pledge is Open again');
select pg_temp.as_user(:mina);
select pg_temp.assert((app.pledge_evidence(:p3) -> 0 ->> 'state') = 'rejected' and (app.pledge_evidence(:p3) -> 0 ->> 'reason') like 'There is no envelope%',
                      'E · a proof that was not accepted stays visible under the pledge with its reason');
select (app.submit_payment_proof(:c, :h1, 'cash', 4000, pg_temp.today(), 'envelope 10', null, array[:p3]::uuid[], 'open_pledges', null, '[]'::jsonb, 'key-864-0013') -> 'proof' ->> 'id')::uuid as proof4 \gset
select set_config('t.proof4', :'proof4', false);
select pg_temp.as_user(:tara);
select app.ask_proof_question(:'proof4', 'Which count was this in?');
select pg_temp.as_user(:mina);
select pg_temp.assert(exists (select 1 from jsonb_array_elements(app.my_payment_proofs(:c, :h1)) e where e ->> 'status' = 'needs_info'), 'C · the member sees that the treasury team asked');
select app.answer_proof_question(:'proof4', 'The Sunday count.', '[]'::jsonb);
select pg_temp.assert((select status from app.payment_proofs where id = :'proof4') = 'submitted', 'C · answering puts the proof back in the queue');
select pg_temp.as_user(:tara);
select app.reject_payment_proof(:'proof4', 'Not found in any count.');

-- F. The guard: a bank line never becomes a second payment while the same money is already counted
select pg_temp.as_none();
insert into app.bank_accounts (id, center_id, name, institution, last4) values ('86400000-0000-4000-8000-0000000003b1', :c, 'Operating', 'Chase', '4608');
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, channel, fingerprint) values
  ('86400000-0000-4000-8000-0000000004a1', :c, '86400000-0000-4000-8000-0000000003b1', pg_temp.today(), 25000, 'CHECK 1048 DEPOSITED', 'check', 'fp-864-1'),
  ('86400000-0000-4000-8000-0000000004a2', :c, '86400000-0000-4000-8000-0000000003b1', pg_temp.today(), 7700, 'ZELLE PAYMENT FROM MINA RAO JPM864A', 'zelle', 'fp-864-2');
select pg_temp.as_user(:tara);
select pg_temp.assert_state($$select app.confirm_bank_match('86400000-0000-4000-8000-0000000004a1', pg_temp.u('h1'))$$, 'CCDUP',
        'F · the $250 line is refused as a new payment: the family has an unbanked $250 payment');
select pg_temp.as_none();
select pg_temp.assert((select count(*) from app.payments where household_id = :h1) = 1, 'F · and nothing was created');
select pg_temp.as_user(:tara);
select app.attach_bank_line_to_payment('86400000-0000-4000-8000-0000000004a1', (select id from app.payments where household_id = :h1));
select pg_temp.as_none();
select pg_temp.assert((select reconciled_at from app.payments where household_id = :h1) is not null
                  and (select reconciled_at from app.pledges where id = :p1) is not null and (select reconciled_kind from app.pledges where id = :p1) = 'bank'
                  and (select reconciled_at from app.pledges where id = :p2) is null,
                      'F · attaching the line banks the payment (no pledge changes); only the fully paid pledge is Bank reconciled');
select pg_temp.assert((select count(*) from app.payments where household_id = :h1) = 1 and (select paid_cents from app.pledges where id = :p2) = 9000,
                      'F · still one payment and the same allocations');
-- an unrelated amount is new money and may close pledges (only the uncovered ones)
select pg_temp.as_user(:tara);
select app.confirm_bank_match('86400000-0000-4000-8000-0000000004a2', :h1);
select pg_temp.as_none();
select pg_temp.assert((select paid_cents from app.pledges where id = :p2) = 16700 and (select paid_cents from app.pledges where id = :p3) = 0,
                      'F · new money is allocated oldest first to what is still uncovered');
-- a waiting proof is also a lookalike for a bank line
select pg_temp.as_user(:mina);
select (app.submit_payment_proof(:c, :h1, 'cash', 1500, pg_temp.today(), 'envelope 11', null, array[:p3]::uuid[], 'open_pledges', null, '[]'::jsonb, 'key-864-0014') -> 'proof' ->> 'id')::uuid as proof5 \gset
select set_config('t.proof5', :'proof5', false);
select pg_temp.as_none();
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, channel, fingerprint)
  values ('86400000-0000-4000-8000-0000000004a3', :c, '86400000-0000-4000-8000-0000000003b1', pg_temp.today(), 1500, 'ZELLE PAYMENT FROM MINA RAO JPM864B', 'zelle', 'fp-864-3');
select pg_temp.as_user(:tara);
select pg_temp.assert_state($$select app.confirm_bank_match('86400000-0000-4000-8000-0000000004a3', pg_temp.u('h1'))$$, 'CCDUP', 'F · a waiting proof of the same amount blocks a new payment too');
select app.approve_payment_proof(:'proof5', null, null, null, null, null, null, null);

-- D. Two people above the organization's limit
select pg_temp.as_user(:olga);
select pg_temp.assert_raises($$select app.set_proof_policy(pg_temp.u('c'), '{"retention_years": 2}'::jsonb, 'x')$$, '3 to 25', 'D · the years are limited to 3 to 25');
select app.set_proof_policy(:c, '{"second_approver_over_cents": 5000, "retention_years": 9}'::jsonb, 'Board decision');
select pg_temp.assert_raises($$select app.set_proof_policy(pg_temp.u('c'), '{"retention_years": 5}'::jsonb, null)$$, 'Say why', 'D · shortening the years needs a reason');
select pg_temp.as_user(:mina);
select pg_temp.assert_state($$select app.set_proof_policy(pg_temp.u('c'), '{"retention_years": 12}'::jsonb, 'x')$$, '42501', 'D · a member cannot change the rules');
select (app.submit_payment_proof(:c, :h1, 'check', 9000, pg_temp.today(), '2001', null, array[:p3]::uuid[], 'open_pledges', null, pg_temp.files(:c, :h1, :pq6, 1), 'key-864-0015') -> 'proof' ->> 'id')::uuid as proof6 \gset
select set_config('t.proof6', :'proof6', false);
select pg_temp.as_user(:tara);
select pg_temp.assert((app.approve_payment_proof(:'proof6') ->> 'state') = 'first_approved', 'D · above the limit the first approval is only recorded');
select pg_temp.assert_raises($$select app.approve_payment_proof(pg_temp.u('proof6'))$$, 'different person', 'D · the same person cannot give both approvals');
select pg_temp.as_user(:uma);
select pg_temp.assert((app.approve_payment_proof(:'proof6') ->> 'state') = 'approved', 'D · a second person completes it');
select pg_temp.as_none();
select pg_temp.assert((select count(*) from app.payments where household_id = :h1) = 4, 'D · payments so far: the check, the bank line, the cash proof and this one');

select pg_temp.as_user(:olga);
select app.set_proof_policy(:c, '{"second_approver_over_cents": 0}'::jsonb, 'Back to one approver');
-- C. Merge: a proof for money already recorded becomes evidence on that payment
select pg_temp.as_user(:tara);
select app.record_offline_payment(:h2, 7000, 'check'::app.payment_method, pg_temp.today(), null, '777') as pay_h2 \gset
select set_config('t.pay_h2', :'pay_h2', false);
select pg_temp.pledge('86400000-0000-4000-8000-0000000001b1', :c, :h2, 7000, 10);
select pg_temp.as_user(:nina);
select (app.submit_payment_proof(:c, :h2, 'check', 7000, pg_temp.today(), '777', null, null, 'open_pledges', null, pg_temp.files(:c, :h2, :pq5, 1), 'key-864-0016') -> 'proof' ->> 'id')::uuid as proof7 \gset
select set_config('t.proof7', :'proof7', false);
select pg_temp.as_user(:tara);
select pg_temp.assert_state($$select app.approve_payment_proof(pg_temp.u('proof7'))$$, 'CCDUP', 'C · a proof that looks like a payment already recorded is blocked');
select app.approve_payment_proof(:'proof7', null, null, null, null, :'pay_h2'::uuid);
select pg_temp.as_none();
select pg_temp.assert((select status from app.payment_proofs where id = :'proof7') = 'merged'
                  and (select count(*) from app.payments where household_id = :h2) = 1
                  and (select count(*) from app.payment_proof_files where payment_id = :'pay_h2'::uuid) = 1
                  and (select count(*) from app.soft_credits where proof_id = :'proof7' and state = 'active') = 0,
                      'C · merging adds the files to the existing payment and creates no second payment');

-- G. Access and guards
select pg_temp.as_user(:nina);
select pg_temp.assert((select count(*) from app.payment_proofs where household_id = :h1) = 0, 'G · another family reads none of this family''s proofs');
select pg_temp.assert_state($$insert into app.payment_proofs (center_id, household_id, method, amount_cents, paid_on) values (pg_temp.u('c'), pg_temp.u('h2'), 'cash', 100, pg_temp.today())$$,
        '42501', 'G · nobody writes the table directly');
select pg_temp.as_user(:mina);
select pg_temp.assert((select count(*) from app.payment_proofs where household_id = :h1) >= 5, 'G · the family reads its own proofs');
select pg_temp.assert(app.can_read_object('payment-evidence', :c || '/' || :h1 || '/' || :'proof1' || '/a1.jpg'), 'G · the family reads its own folder in the bucket');
select pg_temp.assert(not app.can_read_object('payment-evidence', :c || '/' || :h2 || '/' || :'proof7' || '/a1.jpg'), 'G · and not another family''s');
select pg_temp.assert(app.can_write_object('payment-evidence', :c || '/' || :h1 || '/' || gen_random_uuid() || '/new.jpg'), 'G · the family writes into its own folder');
select pg_temp.assert(not app.can_write_object('payment-evidence', :c || '/' || :h2 || '/' || gen_random_uuid() || '/new.jpg'), 'G · and not into another''s');
select pg_temp.assert(not app.can_read_object('payment-evidence', :c || '/staff/' || :'pay_h2' || '/x.jpg'), 'G · staff-attached files are not readable by a member');
select pg_temp.as_user(:tara);
select pg_temp.assert(app.can_read_object('payment-evidence', :c || '/' || :h1 || '/' || :'proof1' || '/a1.jpg')
                  and app.can_write_object('payment-evidence', :c || '/staff/' || :'pay_h2' || '/x.jpg'), 'G · the treasury team reads proofs and writes staff files');
select pg_temp.as_none();
select pg_temp.assert_state($$update app.pledges set status = 'cancelled' where id = (select pledge_id from app.soft_credits where state = 'active' limit 1)$$, '22023',
        'G · a pledge with a proof waiting cannot be cancelled behind its back') where exists (select 1 from app.soft_credits where state = 'active');
select pg_temp.assert_state($$update app.pledges set soft_credit_cents = amount_cents + 1 where id = pg_temp.u('p3')$$, '23514', 'G · a pledge can never be over-covered');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'payment_proofs') > 0, 'G · proofs are audited');
rollback;
