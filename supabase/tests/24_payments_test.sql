-- 0210–0213 (stream o-payments): Stripe and PayPal per organization, the
-- webhook inbox, checkouts, provider refunds through the two-person path,
-- payouts, the $1 test, offline methods, Setup steps and readiness check 6.
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
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 3600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
end $$;

\set jsh '''00000000-0000-4000-8000-000000000001'''
-- Users: 01 Priya (adult, Shah household 20…01), 02 Dev (child), 03 Tara (treasurer), 08 second treasurer,
-- 11 Ada (center admin: integrations.manage), 05 Kiran (Mehta household).
grant connect_worker to postgres;

-- A clean slate for the two processors (test 20 left a Stripe test connection behind).
update app.integration_connections set status = 'disconnected', external_account_id = null, settings = '{}'::jsonb
 where center_id = :jsh and provider = 'stripe';
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, pledged_at)
values ('62400000-0000-4000-8000-000000000001', :jsh, '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
        'general', 7500, now() - interval '400 days'),
       ('62400000-0000-4000-8000-000000000002', :jsh, '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000005',
        'general', 5000, now());

-- ── 0210: providers and the webhook inbox ────────────────────────────────────
select pg_temp.assert((select count(*) from unnest(array['paypal','postmark','expo_push','intuit_sandbox']) p
                        where pg_get_constraintdef((select oid from pg_constraint where conname = 'integration_connections_provider_check')) like '%' || p || '%') = 4,
  'the provider check lists paypal, postmark, expo_push and intuit_sandbox');
select pg_temp.assert_raises($$insert into app.integration_connections (center_id, provider) values ('00000000-0000-4000-8000-000000000001', 'venmo_direct')$$,
  'integration_connections_provider_check', 'an unknown provider is still refused');
select pg_temp.assert(enum_range(null::app.payment_method)::text[] @> array['paypal','venmo'], 'payment_method has paypal and venmo');
select pg_temp.assert(app.webhook_job_kind('stripe') = 'payments.webhook.stripe' and app.webhook_job_kind('paypal') = 'payments.webhook.paypal'
                      and app.webhook_job_kind('twilio') = 'messaging.webhook.twilio' and app.webhook_job_kind('postmark') = 'messaging.webhook.email',
  'each provider''s events go to its worker handler kind');

begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
set local role authenticated;
select pg_temp.assert_raises($$select app.ingest_webhook('stripe', 'evt_x', 'checkout.session.completed', null, '{}')$$,
  'permission denied', 'a signed-in user cannot write a webhook (only the verified route, as service_role)');
rollback;
begin;
set local role anon;
select pg_temp.assert_raises($$select app.ingest_webhook('stripe', 'evt_x', 'checkout.session.completed', null, '{}')$$,
  'permission denied', 'anon cannot write a webhook');
rollback;

-- ── 0211: connecting Stripe (Connect OAuth) ──────────────────────────────────
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', false);
set local role authenticated;
select pg_temp.assert_state($$select app.begin_payment_connect('00000000-0000-4000-8000-000000000001', 'stripe', 'https://jsh.example/api/oauth/stripe/callback', 'Connect our Stripe')$$,
  'CCSTP', 'connecting Stripe without a fresh 2FA check gets CCSTP');
rollback;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises($$select app.begin_payment_connect('00000000-0000-4000-8000-000000000001', 'stripe', null, 'x')$$,
  'owner or integrations.manage', 'the treasurer (integrations.view) cannot connect an account');
select pg_temp.assert(jsonb_typeof(app.payment_settings(:jsh)) = 'object', 'the treasurer can read the payment settings');
rollback;

create temp table t_state (state text, conn uuid);
grant all on t_state to authenticated, connect_worker, service_role;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
set local request.headers = '{"x-client-app":"portal","x-client-screen":"/settings/payments"}';
set local role authenticated;
insert into t_state select r->>'state', (r->>'connection_id')::uuid
  from (select app.begin_payment_connect(:jsh, 'stripe', 'https://jsh.example/api/oauth/stripe/callback', 'Connect our Stripe account') r) x;
commit;
select pg_temp.assert((select state ~ '^[0-9a-f-]{36}\.[0-9a-f]{48}$' from t_state), 'the connect state is "<id>.<nonce>"');
select pg_temp.assert((select status = 'pending_verification' from app.center_payment_processors where center_id = :jsh and processor = 'stripe'),
  'Stripe waits for the provider while connecting');
select pg_temp.assert((select nonce_hash <> split_part((select state from t_state), '.', 2) from app.oauth_states order by created_at desc limit 1),
  'only the nonce''s hash is stored');

begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises($$select app.oauth_store_code((select state from t_state), 'ac_TESTCODE1234567')$$,
  'started by someone else', 'another user cannot complete the connect');
rollback;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', false);
set local role authenticated;
select pg_temp.assert_raises($$select app.oauth_store_code(split_part((select state from t_state), '.', 1) || '.' || repeat('0', 48), 'ac_TESTCODE1234567')$$,
  'not valid', 'a wrong nonce is refused');
select pg_temp.assert((app.oauth_store_code((select state from t_state), 'ac_TESTCODE1234567')->>'job_id') is not null,
  'the person who started it hands in the code; oauth.exchange is queued');
select pg_temp.assert_raises($$select app.oauth_store_code((select state from t_state), 'ac_TESTCODE1234567')$$,
  'already used', 'the connect state is single-use');
commit;
select pg_temp.assert((select j.payload->>'provider' = 'stripe' and j.payload->>'code_secret' = 'oauth.code' and not (j.payload ? 'code')
                          and j.payload::text not like '%TESTCODE%'
                         from app.jobs j where j.kind = 'oauth.exchange' order by id desc limit 1),
  'the job names the vault secret, never the code');
select pg_temp.assert((select fingerprint = '4567' from app.integration_secrets where connection_id = (select conn from t_state) and name = 'oauth.code'),
  'the code is in the vault (fingerprint 4567)');
select pg_temp.assert(not exists (select 1 from app.audit_log where coalesce(after::text, '') || coalesce(before::text, '') like '%TESTCODE%'),
  'the code appears in no audit entry');

-- The worker finishes the exchange.
begin;
set local role authenticated;
select pg_temp.assert_raises($$select app.worker_connection_connected((select conn from t_state), 'acct_1TEST', 'Test', null, '{}')$$,
  'permission denied', 'only the background service marks a connection connected');
rollback;
begin;
set local role connect_worker;
select app.worker_connection_connected((select conn from t_state), 'acct_1TEST', 'JSH Stripe', null, '{"charges_enabled": true}');
commit;
select pg_temp.assert((select cp.status = 'test' and ic.status = 'connected' and ic.external_account_id = 'acct_1TEST'
                          and ic.connected_by = '10000000-0000-4000-8000-000000000011' and ic.settings->>'mode' = 'test'
                         from app.center_payment_processors cp join app.integration_connections ic on ic.id = cp.connection_id
                        where cp.center_id = :jsh and cp.processor = 'stripe'),
  'connected: Stripe is in test mode, the account is recorded with who connected it');
select pg_temp.assert((select client_app = 'job' and reason like 'Background service: Stripe connected%'
                         from app.audit_log where action = 'center_payment_processors.update' order by id desc limit 1),
  'the status change is audited as the background service');

-- Stripe's account.updated: not verified yet → waiting on the provider.
begin;
set local role connect_worker;
select pg_temp.assert(app.worker_connection_settings('stripe', 'acct_1TEST', '{"charges_enabled": false}') = 1, 'account.updated reaches the connection');
commit;
select pg_temp.assert((select status = 'pending_verification' from app.center_payment_processors where center_id = :jsh and processor = 'stripe'),
  'charges not enabled: Stripe is waiting on the provider');
begin;
set local role connect_worker;
select app.worker_connection_settings('stripe', 'acct_1TEST', '{"charges_enabled": true}');
commit;

-- Webhooks with the center resolved from the connected account.
begin;
set local role service_role;
select pg_temp.assert(app.ingest_webhook('stripe', 'evt_1', 'account.updated', null, '{"account":"acct_1TEST","type":"account.updated"}')
                      = app.ingest_webhook('stripe', 'evt_1', 'account.updated', null, '{"account":"acct_1TEST","type":"account.updated"}'),
  'the same event twice gives the same row back');
commit;
select pg_temp.assert((select count(*) from app.jobs where kind = 'payments.webhook.stripe' and payload->>'event_id' = 'evt_1') = 1,
  'a re-sent event queues no second job');
select pg_temp.assert((select center_id = :jsh and job_id is not null from app.webhook_events where event_id = 'evt_1'),
  'the center is found from the connected account and the job is linked');
select id as evt1 from app.webhook_events where event_id = 'evt_1' \gset
begin;
set local role connect_worker;
select pg_temp.assert((app.worker_webhook_event(:'evt1')->>'event_type') = 'account.updated', 'the worker reads the event');
select app.worker_webhook_done(:'evt1');
commit;
select pg_temp.assert((select processed_at is not null from app.webhook_events where event_id = 'evt_1'), 'the worker marks it processed');

-- ── Processor settings ───────────────────────────────────────────────────────
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select pg_temp.assert_raises($$select app.set_payment_processor('00000000-0000-4000-8000-000000000001', 'stripe', array['card','venmo'], null, false, 'x')$$,
  'does not take venmo', 'Stripe does not take Venmo');
select pg_temp.assert_raises($$select app.set_payment_processor('00000000-0000-4000-8000-000000000001', 'stripe', array['card'], 'JSH<>', false, 'x')$$,
  'cannot contain', 'a statement descriptor with < > is refused');
select pg_temp.assert_raises($$select app.set_payment_processor('00000000-0000-4000-8000-000000000001', 'stripe', array['card'], 'JAIN SOCIETY OF HOUSTON TX', false, 'x')$$,
  'at most 22', 'a statement descriptor over 22 characters is refused');
select pg_temp.assert_raises($$select app.set_payment_processor('00000000-0000-4000-8000-000000000001', 'stripe', array['card'], 'JSH TEMPLE', false, ' ')$$,
  'say why', 'a reason is required');
select app.set_payment_processor(:jsh, 'stripe', array['card','ach','apple_pay'], 'JSH TEMPLE', true, 'Card, bank and Apple Pay');
commit;
select pg_temp.assert((select methods = array['ach','apple_pay','card'] and statement_descriptor = 'JSH TEMPLE' and donor_covers_fee_allowed
                         from app.center_payment_processors where center_id = :jsh and processor = 'stripe'),
  'the treasurer (giving.manage) sets the methods, descriptor and donor-covers-fee');
select pg_temp.assert((select reason = 'Card, bank and Apple Pay' and module = 'giving'
                         from app.audit_log where action = 'center_payment_processors.update' order by id desc limit 1),
  'settings changes are audited with the reason, module giving');

begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select pg_temp.assert_raises($$select app.set_default_payment_processor('00000000-0000-4000-8000-000000000001', 'paypal', 'x')$$,
  'connect paypal', 'PayPal cannot be the default before it is connected');
select app.set_default_payment_processor(:jsh, 'stripe', 'Stripe at checkout');
select pg_temp.assert_raises($$select app.set_payment_mode('00000000-0000-4000-8000-000000000001', 'stripe', 'live', 'x')$$,
  'owner or integrations.manage', 'the treasurer cannot switch a processor to live');
commit;

-- ── Offline methods and what members see ─────────────────────────────────────
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select pg_temp.assert_raises($$select app.set_payment_method('00000000-0000-4000-8000-000000000001', 'check', true, '{"payee":"Jain Society of Houston"}', 1, 'x')$$,
  'fill in "address"', 'accepting checks needs the mailing address');
select pg_temp.assert_raises($$select app.set_payment_method('00000000-0000-4000-8000-000000000001', 'daf', true, '{"legal_name":"JSH","ein":"12345"}', 6, 'x')$$,
  'ein is 9 digits', 'a DAF EIN must be 9 digits');
select pg_temp.assert_raises($$select app.set_payment_method('00000000-0000-4000-8000-000000000001', 'card', true, '{"details":"x"}', 1, 'x')$$,
  'offline methods', 'card is not an offline method');
select app.set_payment_method(:jsh, 'check', true, '{"payee":"Jain Society of Houston","address":"3905 Arbor St, Houston TX 77004","memo_hint":"Member number"}', 1, 'Checks by mail');
select app.set_payment_method(:jsh, 'zelle', true, '{"recipient":"treasurer@jsh.example","name":"Jain Society of Houston"}', 3, 'Zelle');
select app.set_payment_method(:jsh, 'stock', false, '{"details":"Ask the treasurer"}', 5, 'Not yet');
commit;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000001', false);
set local role authenticated;
select pg_temp.assert((select array_agg(method::text order by method::text) from app.center_payment_methods) = array['check','zelle'],
  'a member reads the accepted offline methods only');
select pg_temp.assert((app.member_payment_options(:jsh)->>'online_unavailable') = 'test_mode'
                      and jsonb_array_length(app.member_payment_options(:jsh)->'offline') = 2,
  'in production a test-mode processor is not offered to members; the two offline methods are, with instructions');
select pg_temp.assert(not exists (select 1 from app.center_payment_processors), 'a member cannot read the processor rows');
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 2500, null, null, 'other', 'Gift')$$,
  'still in test mode', 'no member checkout while Stripe is in test mode in production');
rollback;

-- A sandbox is always test mode: live is refused (CCENT) and members check out in test mode.
begin;
update app.centers set environment = 'sandbox' where id = :jsh;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
set local role authenticated;
select pg_temp.assert_state($$select app.set_payment_mode('00000000-0000-4000-8000-000000000001', 'stripe', 'live', 'Go live')$$,
  'CCENT', 'a sandbox cannot switch a processor to live (CCENT)');
select pg_temp.claims('10000000-0000-4000-8000-000000000001', false);
select pg_temp.assert((app.member_payment_options(:jsh)#>>'{online,mode}') = 'test', 'a sandbox member is offered test-mode checkout');
select pg_temp.assert((app.create_checkout(:jsh, '20000000-0000-4000-8000-000000000001', 2500, null, null, 'other', 'Gift')->>'mode') = 'test',
  'a sandbox checkout is forced to test mode');
rollback;

-- Live in production: step-up, then members can pay.
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', false);
set local role authenticated;
select pg_temp.assert_state($$select app.set_payment_mode('00000000-0000-4000-8000-000000000001', 'stripe', 'live', 'Go live')$$,
  'CCSTP', 'going live needs a fresh 2FA check');
rollback;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
set local role authenticated;
select app.set_payment_mode(:jsh, 'stripe', 'live', 'Go live after the pilot');
commit;
select pg_temp.assert((select cp.status = 'live' and ic.settings->>'mode' = 'live'
                         from app.center_payment_processors cp join app.integration_connections ic on ic.id = cp.connection_id
                        where cp.center_id = :jsh and cp.processor = 'stripe'), 'Stripe is live (processor and connection)');

-- ── A member checkout, paid through the webhook ──────────────────────────────
create temp table t_checkout (id uuid);
grant all on t_checkout to authenticated, connect_worker, service_role;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 2500, null, null, 'other', 'Gift')$$,
  'only an adult', 'a child cannot pay');
rollback;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000001', false);
set local request.headers = '{"x-client-app":"member"}';
set local role authenticated;
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 2500, array['62400000-0000-4000-8000-000000000002']::uuid[], null, 'pledges', 'Pledge')$$,
  'not an open pledge of this family', 'another family''s pledge cannot be paid');
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 2500, null, null, 'other', 'Gift')$$,
  'only an adult', 'another family cannot be paid for');
insert into t_checkout select (r->>'checkout_id')::uuid from (
  select app.create_checkout(:jsh, '20000000-0000-4000-8000-000000000001', 7500, array['62400000-0000-4000-8000-000000000001']::uuid[],
                             null, 'pledges', 'Pledge') r) x;
select pg_temp.assert((select (app.create_checkout(:jsh, '20000000-0000-4000-8000-000000000001', 1000, null, null, 'other', 'Gift')->>'account_id') = 'acct_1TEST'),
  'the checkout names the connected account for the route');
select app.attach_checkout((select id from t_checkout), 'cs_test_1', 'https://checkout.stripe.test/c/cs_test_1');
commit;
select pg_temp.assert((select status = 'pending' and mode = 'live' and person_id = '30000000-0000-4000-8000-000000000001'
                         from app.payment_checkouts where id = (select id from t_checkout)), 'the checkout is pending, live, for Priya');
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000005', false);
set local role authenticated;
select pg_temp.assert(app.checkout_status((select id from t_checkout)) is null, 'another member cannot see Priya''s checkout');
rollback;

begin;
set local role connect_worker;
select pg_temp.assert_raises($$select app.worker_record_online_payment((select id from t_checkout), 'pi_1', 9999, 0, 'card')$$,
  'not recorded', 'a paid amount different from the checkout is never recorded');
rollback;
begin;
set local role connect_worker;
select pg_temp.assert(not (app.worker_record_online_payment((select id from t_checkout), 'pi_1', 7500, 248, 'card', 'Visa 4242')->>'duplicate')::boolean,
  'the worker records the payment');
select pg_temp.assert((app.worker_record_online_payment((select id from t_checkout), 'pi_1', 7500, 248, 'card')->>'duplicate')::boolean,
  'a second webhook for the same payment is a duplicate');
commit;
select pg_temp.assert((select count(*) = 1 from app.payments where provider = 'stripe' and provider_ref = 'pi_1'), 'exactly one payment row');
select pg_temp.assert((select p.amount_cents = 7500 and p.fee_cents = 248 and p.method = 'card' and p.status = 'captured'
                          and p.household_id = '20000000-0000-4000-8000-000000000001' and p.payer_person_id = '30000000-0000-4000-8000-000000000001'
                          and p.receipt_number is not null
                         from app.payments p where provider_ref = 'pi_1'), 'amount, fee, method, family, payer and a receipt number');
select pg_temp.assert((select a.pledge_id = '62400000-0000-4000-8000-000000000001' and a.amount_cents = 7500 and a.chosen_by_donor
                         from app.payment_allocations a join app.payments p on p.id = a.payment_id where p.provider_ref = 'pi_1'),
  'allocated to the pledge the donor chose (existing allocation rule)');
select pg_temp.assert((select status = 'paid' from app.pledges where id = '62400000-0000-4000-8000-000000000001'), 'the pledge is paid');
select pg_temp.assert((select count(*) = 2 from app.ledger_postings l join app.payments p on p.id = l.source_id
                        where p.provider_ref = 'pi_1' and l.txn_type in ('donation_card','processor_fee')),
  'queued for QuickBooks once, with the fee (existing posting rule)');
select pg_temp.assert((select status = 'paid' and payment_id is not null from app.payment_checkouts where id = (select id from t_checkout)),
  'the checkout is paid and linked');
select pg_temp.assert((select client_app = 'job' and reason = 'Paid online · Stripe pi_1' and module = 'giving'
                         from app.audit_log where action = 'payments.insert' order by id desc limit 1),
  'the payment is audited as the background service, with the provider reference');
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000001', false);
set local role authenticated;
select pg_temp.assert((app.checkout_status((select id from t_checkout))->>'status') = 'paid'
                      and (app.checkout_status((select id from t_checkout))->>'receipt_number') is not null,
  'Priya sees her checkout paid, with the receipt number');
rollback;

-- ── Refund through the provider: the existing two-person path ────────────────
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises($$select app.request_provider_refund((select id from app.payments where provider_ref = 'pi_1'), 'x')$$,
  'two different approvers', 'no provider refund before two people approved it');
update app.payments set refund_approved_by = '10000000-0000-4000-8000-000000000003', refund_reason = 'Duplicate gift', refund_requested_cents = 2500
 where provider_ref = 'pi_1';
commit;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000008', true);
set local role authenticated;
select app.approve_as_second('payments', (select id from app.payments where provider_ref = 'pi_1'));
commit;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select pg_temp.assert_state($$select app.request_provider_refund((select id from app.payments where provider_ref = 'pi_1'), 'Duplicate gift')$$,
  'CCSTP', 'a provider refund needs a fresh 2FA check');
rollback;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert(app.request_provider_refund((select id from app.payments where provider_ref = 'pi_1'), 'Duplicate gift') is not null,
  'with two approvers and a fresh 2FA check the refund is queued');
select pg_temp.assert_raises($$select app.request_provider_refund((select id from app.payments where provider_ref = 'pi_1'), 'again')$$,
  'already on its way', 'a second refund of the same payment waits for the first');
commit;
select pg_temp.assert((select payload->>'amount_cents' = '2500' and payload->>'refunded_before' = '0' from app.jobs
                        where kind = 'payments.refund' order by id desc limit 1), 'the refund job carries the approved amount');
select id as pay1 from app.payments where provider_ref = 'pi_1' \gset
begin;
set local role connect_worker;
select pg_temp.assert(not (app.worker_record_provider_refund(:'pay1', 2500, 0, 're_1')->>'duplicate')::boolean,
  'the worker records the provider refund');
select pg_temp.assert((app.worker_record_provider_refund(:'pay1', 2500, 0, 're_1')->>'duplicate')::boolean,
  'a retried refund job does not refund twice');
commit;
select pg_temp.assert((select refunded_cents = 2500 and status = 'partially_refunded' from app.payments where provider_ref = 'pi_1'),
  'recorded exactly like a hand-recorded refund: 25.00 of 75.00, partially refunded');
select pg_temp.assert((select reason like 'Refunded through Stripe · re_1%' and client_app = 'job'
                         from app.audit_log where action = 'payments.update' order by id desc limit 1), 'the refund is audited with the provider''s reference');

-- ── The $1 live test and readiness check 6 ───────────────────────────────────
select pg_temp.assert(not (app.check_payments_live(:jsh)->>'ok')::boolean
                      and app.check_payments_live(:jsh)->>'detail' like '%run the live $1%', 'live without a live $1 test does not pass');
create temp table t_test (id uuid);
grant all on t_test to authenticated, connect_worker, service_role;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', false);
set local role authenticated;
select pg_temp.assert_state($$select app.create_processor_test_checkout('00000000-0000-4000-8000-000000000001', 'stripe')$$,
  'CCSTP', 'a live $1 test needs a fresh 2FA check');
rollback;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
set local role authenticated;
insert into t_test select (app.create_processor_test_checkout(:jsh, 'stripe')->>'checkout_id')::uuid;
select app.attach_checkout((select id from t_test), 'cs_test_dollar', 'https://checkout.stripe.test/c/cs_test_dollar');
commit;
begin;
set local role connect_worker;
select pg_temp.assert((app.worker_record_online_payment((select id from t_test), 'pi_dollar', 100, 33, 'card')->>'test')::boolean,
  'the paid $1 test is not recorded as a gift');
select app.worker_record_processor_test((select id from t_test), true, 'pi_dollar', 're_dollar', 'Charged and refunded');
commit;
select pg_temp.assert(not exists (select 1 from app.payments where provider_ref = 'pi_dollar'), 'no payment row for the $1 test');
select pg_temp.assert((select count(*) = 1 from app.jobs where kind = 'payments.test_charge' and payload->>'checkout_id' = (select id::text from t_test)),
  'the $1 test queues its refund');
select pg_temp.assert((select ok and mode = 'live' and ran_by = '10000000-0000-4000-8000-000000000011' from app.payment_processor_tests
                        where checkout_id = (select id from t_test)), 'the live test is recorded with who ran it');
select pg_temp.assert((app.check_payments_live(:jsh)->>'ok')::boolean, 'default live processor with a passing live test: check 6 passes');

-- Setup steps (as the admin: settings.manage).
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', false);
set local role authenticated;
select pg_temp.assert((select status = 'done' and detail like '%Stripe (live test passed)%' from app.setup_checklist(:jsh) where step_key = 'svc.payments'),
  'Setup step svc.payments is done');
select pg_temp.assert((select status = 'done' and detail = 'Accepted: check, zelle' from app.setup_checklist(:jsh) where step_key = 'data.payment_methods'),
  'Setup step data.payment_methods is done, listing the methods');
select pg_temp.assert((select ok from app.readiness(:jsh) where key = 'payments_live'), 'check 6 is registered in the readiness list');
rollback;

-- Offline only passes too.
begin;
update app.center_payment_processors set is_default = false where center_id = :jsh;
select pg_temp.assert(not (app.check_payments_live(:jsh)->>'ok')::boolean, 'no default processor: check 6 does not pass');
select pg_temp.claims('10000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select app.set_payments_offline_only(:jsh, true, 'Offline for the first year');
reset role;
select pg_temp.assert((app.check_payments_live(:jsh)->>'ok')::boolean and app.check_payments_live(:jsh)->>'detail' like 'Offline payments only%',
  '"offline only" passes check 6');
rollback;

-- ── PayPal Business email fallback ───────────────────────────────────────────
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
set local role authenticated;
select pg_temp.assert(to_regprocedure('app.enqueue_message(uuid,text,text,text,jsonb,text)') is not null
                      or (app.start_paypal_email_verification(:jsh, 'give@jsh.example')->>'sent')::boolean = false,
  'without the messaging service no code is made, and the answer says it was not sent');
rollback;

-- With a stand-in for o-messaging's app.enqueue_message (only in this transaction).
begin;
create table pg_temp.sent (vars jsonb, tmpl text, purpose text, "to" text);
grant all on pg_temp.sent to authenticated;
create function app.enqueue_message(p_center uuid, p_channel text, p_to text, p_template_key text, p_vars jsonb, p_purpose text)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $f$
begin
  execute 'insert into pg_temp.sent values ($1, $2, $3, $4)' using p_vars, p_template_key, p_purpose, p_to;
  return gen_random_uuid();
end $f$;
grant execute on function app.enqueue_message(uuid, text, text, text, jsonb, text) to authenticated;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', false);
set local role authenticated;
select pg_temp.assert_state($$select app.start_paypal_email_verification('00000000-0000-4000-8000-000000000001', 'give@jsh.example')$$,
  'CCSTP', 'the PayPal email needs a fresh 2FA check');
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
select pg_temp.assert((app.start_paypal_email_verification(:jsh, 'Give@JSH.example')->>'sent')::boolean, 'the code is sent through app.enqueue_message');
select pg_temp.assert((select tmpl = 'paypal_email_code' and purpose = 'verification_code' and "to" = 'give@jsh.example' and vars->>'code' ~ '^\d{6}$'
                         from pg_temp.sent), 'template paypal_email_code, purpose verification_code, a 6-digit code');
select pg_temp.assert(not (app.confirm_paypal_email(:jsh, '000000')->>'ok')::boolean or (select vars->>'code' from pg_temp.sent) = '000000',
  'a wrong code is refused');
select pg_temp.assert_raises('select * from app.paypal_email_verifications', 'permission denied', 'the code table is not readable over the API');
select pg_temp.assert((app.confirm_paypal_email(:jsh, (select vars->>'code' from pg_temp.sent))->>'ok')::boolean, 'the right code verifies the email');
reset role;
select pg_temp.assert((select ic.status = 'connected' and ic.settings->>'paypal_email' = 'give@jsh.example'
                          and ic.settings->>'paypal_email_verified_at' is not null and ic.settings->>'connect_method' = 'email' and cp.status = 'test'
                         from app.center_payment_processors cp join app.integration_connections ic on ic.id = cp.connection_id
                        where cp.center_id = :jsh and cp.processor = 'paypal'),
  'PayPal is connected by its verified Business email, in test mode');
select pg_temp.assert((select code_hash !~ '^\d{6}$' from app.paypal_email_verifications where center_id = :jsh), 'the code is stored hashed');
rollback;

-- ── Payouts ──────────────────────────────────────────────────────────────────
begin;
set local role connect_worker;
select app.worker_upsert_payout(:jsh, 'stripe', 'po_1', 7500, 248, 7252, current_date + 2);
select app.worker_upsert_payout(:jsh, 'stripe', 'po_1', 7500, 248, 7252, current_date + 2);
select pg_temp.assert(app.worker_mark_payout_payments(:jsh, 'stripe', 'po_1', array['pi_1']) = 1, 'the paid-out payments carry the payout');
commit;
select pg_temp.assert((select count(*) = 1 and sum(net_cents) = 7252 from app.payouts where provider_ref = 'po_1'), 'a payout lands once in app.payouts');
select pg_temp.assert((select provider_payout_ref = 'po_1' from app.payments where provider_ref = 'pi_1'), 'the payment names its payout');

-- ── Disconnect keeps everything ──────────────────────────────────────────────
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
set local role authenticated;
select app.disconnect_payment_processor(:jsh, 'stripe', 'Moving to a new account');
reset role;
select pg_temp.assert((select cp.status = 'not_connected' and not cp.is_default and ic.status = 'disconnected'
                          and exists (select 1 from app.integration_secrets s where s.connection_id = ic.id)
                         from app.center_payment_processors cp join app.integration_connections ic on ic.id = cp.connection_id
                        where cp.center_id = :jsh and cp.processor = 'stripe'),
  'disconnect: not taking payments, nothing deleted');
rollback;

-- ── The Giving switch ────────────────────────────────────────────────────────
begin;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:jsh, 'giving', false, 'test 0211')
on conflict (center_id, module_key) do update set enabled = false;
select pg_temp.claims('10000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select pg_temp.assert_raises($$select app.payment_settings('00000000-0000-4000-8000-000000000001')$$, 'switched off',
  'with Giving off the payment settings are refused');
select pg_temp.assert(not exists (select 1 from app.center_payment_methods), 'with Giving off the offline methods are hidden');
reset role;
select pg_temp.assert((app.check_payments_live(:jsh)->>'ok')::boolean, 'with Giving off check 6 passes (no payments taken)');
rollback;
